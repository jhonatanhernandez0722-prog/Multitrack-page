/**
 * Panel de cada iglesia y de Superadmin (v37). Todo pasa por las funciones de Neon
 * (neon/v37-iglesias.sql), que comprueban permisos e iglesia; el Worker suma lo que solo él puede hacer
 * con R2 (logo, comprobantes, espacio usado, registro de acciones de contenido, respaldos).
 *
 * Iglesia (con la sesión de Neon de la cuenta, salvo donde se indica):
 *   GET    /api/church                    → resumen: iglesia, plan, estado, funciones, límites, uso (también con la sesión del panel)
 *   GET    /api/church/logo               → logo de la propia iglesia (cualquier integrante)
 *   PUT    /api/church/logo               → (admin, «personalizacion») imagen PNG/JPG/WebP de hasta 1 MB
 *   DELETE /api/church/logo
 *   GET    /api/church/storage            → (admin) espacio usado y cuota; con «admin_avanzado», qué ocupa más
 *   GET    /api/church/info               → perfil completo        PATCH /api/church/info {name, city, contact_*, accent}
 *   GET    /api/church/members            → integrantes            POST /api/church/members/role {email, role}
 *   PATCH  /api/church/members/<correo> {tag, name}                DELETE /api/church/members/<correo>
 *   GET    /api/church/invitations        POST /api/church/invitations {note, days} → código (UNA vez), enlace y texto para WhatsApp
 *   DELETE /api/church/invitations/<id>
 *   GET    /api/church/subscriptions      → historial de pagos
 *   GET    /api/church/audit              → (Premium) acciones de la iglesia
 *   GET    /api/2fa · POST /api/2fa/enroll · POST /api/2fa/confirm {code} · POST /api/2fa/disable {code}
 *   POST   /api/sessions/others {cookies} → cierra la sesión en los demás dispositivos (Neon Auth)
 *
 * Superadmin (sesión de Neon + cabecera x-gosen-sa con la sesión de 2FA que entrega /api/sa/login):
 *   GET  /api/sa/2fa · POST /api/sa/2fa/enroll · POST /api/sa/2fa/confirm {code} · POST /api/sa/login {code} · POST /api/sa/logout
 *   GET  /api/sa/overview                 → iglesias, planes, ajustes y espacio usado de cada una
 *   POST /api/sa/churches {…}             PATCH /api/sa/churches/<id> {…}   POST /api/sa/churches/<id>/status {status, reason}
 *   GET  /api/sa/churches/<id>/members    GET|POST /api/sa/churches/<id>/invitations   DELETE /api/sa/invitations/<id>
 *   GET  /api/sa/churches/<id>/storage    POST /api/sa/members {email, church, role}
 *   POST /api/sa/plans {…}                POST /api/sa/settings {key, value}
 *   GET  /api/sa/subscriptions?church=    POST /api/sa/subscriptions {…}    POST /api/sa/subscriptions/<id>/void {reason}
 *   POST /api/sa/receipt?church=&type=    GET /api/sa/receipt?key=           (comprobantes en R2, privados)
 *   GET  /api/sa/audit?church=            GET /api/sa/audit/verify          POST /api/sa/backup   POST /api/sa/reset-2fa {email}
 */
import { neonRpc } from './legal/legal.js'
import { INTERNAL, brandingPrefix, can, churchOf, planMessage } from './tenancy.js'

const SQL_MISSING = 'Falta ejecutar neon/v37-iglesias.sql en Neon (SQL Editor).'
const LOGO_MAX = 1024 * 1024
const RECEIPT_MAX = 5 * 1024 * 1024
const RECEIPT_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' }
const CHURCH_ID = /^[a-z0-9][a-z0-9-]{2,39}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Respuesta de una función de Neon: datos, falta de SQL o el error (los mensajes ya están en español). */
function reply(json, r, ok = (d) => d) {
  if (r.missing) return json({ error: SQL_MISSING, code: 'sql-missing' }, 503)
  if (r.error) {
    if (/GOSEN_SA_SESSION/.test(r.error)) return json({ error: 'Tu sesión de Superadmin venció. Escribe otra vez el código de verificación.', code: 'sa-session' }, 401)
    return json({ error: r.error }, r.status === 401 ? 401 : 400)
  }
  return json(ok(r.data))
}

const body = (req) => req.json().catch(() => ({}))

/** Datos de una invitación recién creada: el código (se muestra una sola vez), el enlace y el texto para WhatsApp. */
function invitationShare(origin, churchName, row, role) {
  const link = `${origin}/unirse#${row.code}`
  const until = new Date(row.expires_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'America/Bogota' })
  const text =
    role === 'admin'
      ? `Hola. Ya está lista la cuenta de ${churchName} en Gosen Tracks. Para activarla como administrador: instala Gosen (${origin}), elige «Crear cuenta» y escribe este código: ${row.code} (vence el ${until}). Instrucciones: ${link}`
      : `Hola. Te invito al equipo de ${churchName} en Gosen Tracks. Instala Gosen (${origin}), elige «Crear cuenta» y escribe este código: ${row.code} (vence el ${until}). Instrucciones: ${link}`
  return { id: row.id, code: row.code, expires_at: row.expires_at, link, whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`, text }
}

// --- Iglesia -------------------------------------------------------------------------------------------------

export async function churchApi(req, env, p, me, bearer, h) {
  const { json } = h
  const church = churchOf(me)
  const neon = !!bearer && !bearer.startsWith('gps.')
  const needNeon = () => json({ error: 'Vuelve a iniciar sesión para continuar.', code: 'neon-session' }, 401)
  const call = (fn, args = {}) => neonRpc(env, bearer, fn, args)
  const origin = new URL(req.url).origin

  // Verificación en dos pasos y sesiones: cualquier cuenta.
  if (p === '/api/2fa' || p.startsWith('/api/2fa/')) {
    if (!neon) return needNeon()
    if (p === '/api/2fa' && req.method === 'GET') return reply(json, await call('gosen_2fa_status'))
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
    const limited = await h.overLimit(env, req, 'twofa')
    if (limited) return limited
    if (p === '/api/2fa/enroll') return reply(json, await call('gosen_2fa_enroll'))
    if (p === '/api/2fa/confirm') return reply(json, await call('gosen_2fa_confirm', { p_code: String((await body(req)).code || '') }))
    if (p === '/api/2fa/disable') return reply(json, await call('gosen_2fa_disable', { p_code: String((await body(req)).code || '') }))
    return json({ error: 'No existe' }, 404)
  }
  if (p === '/api/sessions/others' && req.method === 'POST') {
    const limited = await h.overLimit(env, req, 'auth')
    if (limited) return limited
    const { cookies } = await body(req)
    if (!cookies || typeof cookies !== 'string' || cookies.length > 8192) return json({ error: 'Falta la sesión.' }, 400)
    const r = await fetch(`${env.AUTH_URL}/revoke-other-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookies, origin: new URL(env.AUTH_URL).origin },
      body: '{}'
    })
    if (r.status === 404) return json({ error: 'Neon Auth no ofrece esta opción en este proyecto.', code: 'unsupported' }, 501)
    return r.ok ? json({ ok: true }) : json({ error: `No se pudieron cerrar las otras sesiones (${r.status}).` }, 502)
  }

  // Resumen de la iglesia (también con la sesión del panel).
  if (p === '/api/church' && req.method === 'GET') {
    const usage = me.admin ? await h.churchUsage(env, church) : null
    return json({
      church: me.church ?? { id: church, name: null, internal: church === INTERNAL },
      plan: me.plan ?? null,
      subscription: me.subscription ?? null,
      features: me.features ?? null,
      limits: me.limits ?? null,
      members: me.members ?? null,
      contact: me.contact ?? null,
      admin: !!me.admin,
      usage: usage ? { bytes: usage.bytes, songs: usage.songs } : null
    })
  }

  if (p === '/api/church/logo') {
    const key = brandingPrefix(church) + 'logo'
    if (req.method === 'GET') {
      const obj = await env.TRACKS.get(key)
      if (!obj) return json({ error: 'Sin logo' }, 404)
      return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'image/png', 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' } })
    }
    if (!me.admin) return json({ error: 'Solo el administrador' }, 403)
    if (!can(me, 'personalizacion')) return json({ error: planMessage(me, 'personalizacion'), code: 'plan', feature: 'personalizacion' }, 403)
    if (!neon) return needNeon()
    if (req.method === 'PUT') {
      const type = req.headers.get('content-type') || ''
      if (!/^image\/(png|jpeg|webp)$/.test(type)) return json({ error: 'El logo debe ser PNG, JPG o WebP.' }, 400)
      const bytes = await req.arrayBuffer()
      if (!bytes.byteLength || bytes.byteLength > LOGO_MAX) return json({ error: 'El logo debe pesar menos de 1 MB.' }, 413)
      const r = await call('gosen_update_my_church', { p_patch: { logo: true } })
      if (r.missing || r.error) return reply(json, r)
      await env.TRACKS.put(key, bytes, { httpMetadata: { contentType: type } })
      h.forgetUsage(church)
      await h.contentLog(env, me, church, 'iglesia.logo', church, { bytes: bytes.byteLength })
      return json(r.data)
    }
    if (req.method === 'DELETE') {
      const r = await call('gosen_update_my_church', { p_patch: { logo: false } })
      if (r.missing || r.error) return reply(json, r)
      await env.TRACKS.delete(key)
      h.forgetUsage(church)
      return json(r.data)
    }
    return json({ error: 'Método no permitido' }, 405)
  }

  if (!p.startsWith('/api/church/')) return null
  if (!me.admin) return json({ error: 'Solo el administrador' }, 403)

  if (p === '/api/church/storage' && req.method === 'GET') {
    const u = await h.churchUsage(env, church, true)
    return json({
      bytes: u.bytes,
      songs: u.songs,
      quota: me.limits?.storage_bytes ?? null,
      top: can(me, 'admin_avanzado') ? [...u.items].sort((a, b) => b.size - a.size).slice(0, 50).map((i) => ({ key: i.key, title: i.title || i.name, size: i.size })) : null
    })
  }

  if (!neon) return needNeon()

  if (p === '/api/church/info') {
    if (req.method === 'GET') return reply(json, await call('gosen_my_church'))
    if (req.method === 'PATCH' || req.method === 'POST') return reply(json, await call('gosen_update_my_church', { p_patch: await body(req) }))
  }
  if (p === '/api/church/members' && req.method === 'GET') return reply(json, await call('gosen_list_access'))
  if (p === '/api/church/members/role' && req.method === 'POST') {
    const b = await body(req)
    return reply(json, await call('gosen_set_role', { p_email: String(b.email || ''), p_role: String(b.role || '') }), () => ({ ok: true }))
  }
  if (p.startsWith('/api/church/members/')) {
    const email = decodeURIComponent(p.slice('/api/church/members/'.length)).trim().toLowerCase()
    if (!/^[^@\s/]+@[^@\s/]+$/.test(email)) return json({ error: 'Correo no válido.' }, 400)
    if (req.method === 'PATCH' || req.method === 'POST') {
      const b = await body(req)
      return reply(json, await call('gosen_set_member', { p_email: email, p_tag: b.tag ?? '', p_note: b.name ?? null }), () => ({ ok: true }))
    }
    if (req.method === 'DELETE') {
      if (email === String(me.email || '').toLowerCase()) return json({ error: 'No puedes quitarte a ti mismo.' }, 400)
      // Directo a la tabla, con la sesión del admin: la base solo deja quitar a integrantes de SU iglesia.
      const r = await fetch(`${env.DATA_API_URL}/gosen_allowed_emails?email=eq.${encodeURIComponent(email)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${bearer}`, prefer: 'return=representation' }
      })
      const rows = await r.json().catch(() => [])
      if (!r.ok) return json({ error: rows?.message || 'No se pudo quitar.' }, 400)
      return Array.isArray(rows) && rows.length ? json({ ok: true }) : json({ error: 'Ese correo no está en tu iglesia.' }, 404)
    }
  }
  if (p === '/api/church/invitations') {
    if (req.method === 'GET') return reply(json, await call('gosen_list_invitations'))
    if (req.method === 'POST') {
      const b = await body(req)
      const days = b.days === undefined || b.days === null || b.days === '' ? null : Number(b.days)
      const r = await call('gosen_create_invitation', { p_note: b.note ? String(b.note).slice(0, 120) : null, p_days: days })
      return reply(json, r, (rows) => invitationShare(origin, me.church?.name || 'tu iglesia', rows[0], 'member'))
    }
  }
  if (p.startsWith('/api/church/invitations/') && req.method === 'DELETE') {
    const id = p.slice('/api/church/invitations/'.length)
    if (!UUID.test(id)) return json({ error: 'Invitación no válida.' }, 400)
    return reply(json, await call('gosen_revoke_invitation', { p_id: id }), () => ({ ok: true }))
  }
  if (p === '/api/church/subscriptions' && req.method === 'GET') return reply(json, await call('gosen_my_subscriptions'))
  if (p === '/api/church/audit' && req.method === 'GET') {
    if (!can(me, 'admin_avanzado')) return json({ error: planMessage(me, 'admin_avanzado'), code: 'plan', feature: 'admin_avanzado' }, 403)
    const r = await call('gosen_church_audit', { p_limit: 300 })
    if (r.missing || r.error) return reply(json, r)
    const content = await h.readContentLog(env, church, 300)
    const rows = [...(r.data || []).map((a) => ({ at: a.at, actor: a.actor_email, role: a.actor_role, action: a.action, target: a.target, details: a.details })), ...content]
    return json(rows.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 300))
  }
  return json({ error: 'No existe' }, 404)
}

// --- Superadmin ----------------------------------------------------------------------------------------------

export async function superadminApi(req, env, p, h) {
  const { json } = h
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer /, '')
  if (!bearer || bearer.startsWith('gps.')) return json({ error: 'Inicia sesión con tu cuenta de Superadmin.', code: 'neon-session' }, 401)
  const call = (fn, args = {}) => neonRpc(env, bearer, fn, args)
  const sa = req.headers.get('x-gosen-sa') || ''
  const origin = new URL(req.url).origin

  // Verificación en dos pasos (obligatoria) y sesión de Superadmin. Con límite de intentos por IP.
  if (p === '/api/sa/2fa' && req.method === 'GET') return reply(json, await call('gosen_2fa_status'))
  if (['/api/sa/2fa/enroll', '/api/sa/2fa/confirm', '/api/sa/login'].includes(p) && req.method === 'POST') {
    const limited = await h.overLimit(env, req, 'superadmin')
    if (limited) return limited
    const code = String((await body(req)).code || '')
    if (p === '/api/sa/2fa/enroll') return reply(json, await call('gosen_2fa_enroll'))
    if (p === '/api/sa/2fa/confirm') return reply(json, await call('gosen_2fa_confirm', { p_code: code }))
    return reply(json, await call('gosen_sa_login', { p_code: code }))
  }
  if (p === '/api/sa/logout' && req.method === 'POST') return reply(json, await call('gosen_sa_logout', { p_sa: sa }), () => ({ ok: true }))
  if (!sa) return json({ error: 'Escribe el código de verificación para entrar como Superadmin.', code: 'sa-session' }, 401)
  /** Para lo que el Worker hace en R2: primero se confirma en la base que la sesión es válida. */
  const ping = async () => {
    const r = await call('gosen_sa_ping', { p_sa: sa })
    return r.data === true ? null : reply(json, r.missing || r.error ? r : { error: 'GOSEN_SA_SESSION' })
  }
  const parts = p.split('/').filter(Boolean) // ['api','sa',…]

  if (p === '/api/sa/overview' && req.method === 'GET') {
    const r = await call('gosen_sa_overview', { p_sa: sa })
    if (r.missing || r.error) return reply(json, r)
    const data = r.data
    for (const c of data.churches || []) {
      try {
        const u = await h.churchUsage(env, c.id)
        c.usage = { bytes: u.bytes, songs: u.songs }
      } catch {
        c.usage = null
      }
    }
    return json(data)
  }

  if (p === '/api/sa/churches' && req.method === 'POST') {
    const r = await call('gosen_sa_create_church', { p_sa: sa, p_church: await body(req) })
    return reply(json, r)
  }
  if (parts[2] === 'churches' && parts[3]) {
    const id = decodeURIComponent(parts[3])
    if (!CHURCH_ID.test(id)) return json({ error: 'Iglesia no válida.' }, 400)
    if (parts.length === 4 && req.method === 'PATCH') {
      const r = await call('gosen_sa_update_church', { p_sa: sa, p_id: id, p_patch: await body(req) })
      if (!r.missing && !r.error) await h.bumpEpoch(env, id)
      return reply(json, r, () => ({ ok: true }))
    }
    if (parts[4] === 'status' && req.method === 'POST') {
      const b = await body(req)
      const r = await call('gosen_sa_set_church_status', { p_sa: sa, p_id: id, p_status: String(b.status || ''), p_reason: b.reason ? String(b.reason) : null })
      if (!r.missing && !r.error) await h.bumpEpoch(env, id)
      return reply(json, r, () => ({ ok: true }))
    }
    if (parts[4] === 'members' && req.method === 'GET') return reply(json, await call('gosen_sa_members', { p_sa: sa, p_church: id }))
    if (parts[4] === 'invitations' && req.method === 'GET') return reply(json, await call('gosen_sa_invitations', { p_sa: sa, p_church: id }))
    if (parts[4] === 'invitations' && req.method === 'POST') {
      const b = await body(req)
      const role = b.role === 'member' ? 'member' : 'admin'
      const r = await call('gosen_sa_create_invitation', { p_sa: sa, p_church: id, p_role: role, p_days: Number(b.days) || 14, p_note: b.note ? String(b.note).slice(0, 120) : null })
      if (r.missing || r.error) return reply(json, r)
      return json(invitationShare(origin, String(b.church_name || 'tu iglesia'), r.data[0], role))
    }
    if (parts[4] === 'storage' && req.method === 'GET') {
      const denied = await ping()
      if (denied) return denied
      const u = await h.churchUsage(env, id, true)
      // Superadmin ve tamaños y nombres, no el contenido: no puede descargar canciones de las iglesias.
      return json({ bytes: u.bytes, songs: u.songs, top: [...u.items].sort((a, b) => b.size - a.size).slice(0, 100).map((i) => ({ title: i.title || i.name, size: i.size, uploaded: i.uploaded })) })
    }
  }
  if (parts[2] === 'invitations' && parts[3] && req.method === 'DELETE') {
    if (!UUID.test(parts[3])) return json({ error: 'Invitación no válida.' }, 400)
    return reply(json, await call('gosen_sa_revoke_invitation', { p_sa: sa, p_id: parts[3] }), () => ({ ok: true }))
  }
  if (p === '/api/sa/members' && req.method === 'POST') {
    const b = await body(req)
    const r = await call('gosen_sa_set_member', { p_sa: sa, p_email: String(b.email || ''), p_church: b.church ? String(b.church) : null, p_role: b.role ? String(b.role) : null })
    if (!r.missing && !r.error) await h.bumpEpoch(env)
    return reply(json, r, () => ({ ok: true }))
  }
  if (p === '/api/sa/plans' && req.method === 'POST') {
    const r = await call('gosen_sa_upsert_plan', { p_sa: sa, p_plan: await body(req) })
    if (!r.missing && !r.error) await h.bumpEpoch(env)
    return reply(json, r, () => ({ ok: true }))
  }
  if (p === '/api/sa/settings' && req.method === 'POST') {
    const b = await body(req)
    return reply(json, await call('gosen_sa_set_setting', { p_sa: sa, p_key: String(b.key || ''), p_value: b.value ?? null }), () => ({ ok: true }))
  }
  if (p === '/api/sa/subscriptions' && req.method === 'GET') {
    const c = new URL(req.url).searchParams.get('church')
    return reply(json, await call('gosen_sa_subscriptions', { p_sa: sa, p_church: c || null }))
  }
  if (p === '/api/sa/subscriptions' && req.method === 'POST') {
    const b = await body(req)
    const r = await call('gosen_sa_add_subscription', { p_sa: sa, p_sub: b })
    if (!r.missing && !r.error && b.church_id) await h.bumpEpoch(env, String(b.church_id))
    return reply(json, r)
  }
  if (parts[2] === 'subscriptions' && parts[4] === 'void' && req.method === 'POST') {
    if (!UUID.test(parts[3] || '')) return json({ error: 'Pago no válido.' }, 400)
    const r = await call('gosen_sa_void_subscription', { p_sa: sa, p_id: parts[3], p_reason: String((await body(req)).reason || '') })
    if (!r.missing && !r.error) await h.bumpEpoch(env)
    return reply(json, r, () => ({ ok: true }))
  }
  if (p === '/api/sa/receipt') {
    const denied = await ping()
    if (denied) return denied
    const sp = new URL(req.url).searchParams
    if (req.method === 'POST') {
      const church = sp.get('church') || ''
      const ext = RECEIPT_TYPES[req.headers.get('content-type') || '']
      if (!CHURCH_ID.test(church)) return json({ error: 'Iglesia no válida.' }, 400)
      if (!ext) return json({ error: 'El comprobante debe ser PNG, JPG, WebP o PDF.' }, 400)
      const bytes = await req.arrayBuffer()
      if (!bytes.byteLength || bytes.byteLength > RECEIPT_MAX) return json({ error: 'El comprobante debe pesar menos de 5 MB.' }, 413)
      const key = `system/receipts/${church}/${crypto.randomUUID()}.${ext}`
      await env.TRACKS.put(key, bytes, { httpMetadata: { contentType: req.headers.get('content-type') } })
      return json({ key })
    }
    if (req.method === 'GET') {
      const key = sp.get('key') || ''
      if (!/^system\/receipts\/[a-z0-9-]+\/[0-9a-f-]{36}\.(png|jpg|webp|pdf)$/.test(key)) return json({ error: 'Comprobante no válido.' }, 400)
      const obj = await env.TRACKS.get(key)
      if (!obj) return json({ error: 'No existe' }, 404)
      return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'application/octet-stream', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
    }
  }
  if (p === '/api/sa/audit' && req.method === 'GET') {
    const c = new URL(req.url).searchParams.get('church')
    const r = await call('gosen_sa_audit', { p_sa: sa, p_church: c || null, p_limit: 500 })
    if (r.missing || r.error) return reply(json, r)
    const content = await h.readContentLog(env, c && CHURCH_ID.test(c) ? c : null, 500)
    const rows = [...(r.data || []).map((a) => ({ at: a.at, actor: a.actor_email, role: a.actor_role, church: a.church_id, action: a.action, target: a.target, details: a.details })), ...content]
    return json(rows.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 500))
  }
  if (p === '/api/sa/audit/verify' && req.method === 'GET') return reply(json, await call('gosen_sa_audit_verify', { p_sa: sa }))
  if (p === '/api/sa/reset-2fa' && req.method === 'POST') {
    return reply(json, await call('gosen_sa_reset_2fa', { p_sa: sa, p_email: String((await body(req)).email || '') }), () => ({ ok: true }))
  }
  if (p === '/api/sa/backup' && req.method === 'POST') {
    const r = await call('gosen_sa_export', { p_sa: sa })
    if (r.missing || r.error) return reply(json, r)
    const text = JSON.stringify(r.data, null, 1)
    const key = `system/backups/${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    await env.TRACKS.put(key, text, { httpMetadata: { contentType: 'application/json' } })
    return new Response(text, {
      headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="gosen-respaldo-${new Date().toISOString().slice(0, 10)}.json"`, 'cache-control': 'no-store', 'x-gosen-backup': key }
    })
  }
  return json({ error: 'No existe' }, 404)
}
