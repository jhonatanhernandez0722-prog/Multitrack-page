/**
 * Servidor local para probar en un navegador el panel de Superadmin y las secciones «Tu iglesia» del
 * panel: el Worker real (src/index.js) con R2 en memoria y un Neon simulado CON ESTADO que sigue las
 * mismas reglas que neon/v37-iglesias.sql (sesión de 2FA, cupo comercial, pagos, invitaciones…).
 * Cuentas: super@gosen.co (Superadmin, código 2FA «123456») y admin@alfa.co (admin de Alfa, plan Inicial).
 *
 * Uso: node --import ./test/register.mjs test/saas-server.mjs   (imprime "PORT <n>")
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import worker from '../src/index.js'
import { FakeBucket, audio, makeZip } from './fakes.mjs'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwtFor = (email) => `${b64({ alg: 'none' })}.${b64({ sub: email, email, exp: Math.floor(Date.now() / 1000) + 3600 })}.x`
const emailOf = (jwt) => {
  try {
    return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString()).email
  } catch {
    return null
  }
}

const INICIAL = ['reproductor', 'biblioteca', 'click_guia', 'mezclador', 'repertorios', 'ensayo_individual', 'programacion_basica']
const EQUIPO = [...INICIAL, 'ensayo_multiple', 'programacion_completa', 'asignacion_integrantes', 'exportar_excel', 'letras_acordes', 'letras_secciones', 'transposicion_acordes', 'letras_sincronizadas', 'personalizacion']
const PREMIUM = [...EQUIPO, 'holyrics', 'admin_avanzado', 'config_avanzada', 'soporte_prioritario']
const db = {
  settings: { max_commercial_churches: 3, grace_days: 7, reminder_days: 10, invite_days_default: 7, invite_days_max: 30, require_email_verification: true, contact_whatsapp: '573001112233', contact_email: null },
  features: PREMIUM.map((id) => ({ id, label: id })),
  plans: [
    { id: 'inicial', name: 'Gosen Inicial', price_month_cop: 39900, price_year_cop: null, max_members: 10, storage_gb: 50, features: INICIAL, is_internal: false, active: true, sort: 1 },
    { id: 'equipo', name: 'Gosen Equipo', price_month_cop: 69900, price_year_cop: null, max_members: 25, storage_gb: 150, features: EQUIPO, is_internal: false, active: true, sort: 2 },
    { id: 'premium', name: 'Gosen Premium', price_month_cop: 119900, price_year_cop: null, max_members: 25, storage_gb: 300, features: PREMIUM, is_internal: false, active: true, sort: 3 },
    { id: 'interno', name: 'Gosen Interno', price_month_cop: 0, price_year_cop: null, max_members: null, storage_gb: null, features: PREMIUM, is_internal: true, active: true, sort: 9 }
  ],
  churches: [
    { id: 'gosen', name: 'Comunidad Cristiana Gosen Barranquilla', internal: true, status: 'activa', plan_id: 'interno' },
    { id: 'iglesia-alfa-1a2b3', name: 'Iglesia Alfa', internal: false, status: 'activa', plan_id: 'inicial', contact_phone: '+57 300 555 1234', contact_name: 'Pastor Alfa' }
  ],
  members: [
    { email: 'admin@alfa.co', church: 'iglesia-alfa-1a2b3', name: 'Pastor Alfa', admin: true },
    { email: 'ana@alfa.co', church: 'iglesia-alfa-1a2b3', name: 'Ana', admin: false }
  ],
  subs: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', church_id: 'iglesia-alfa-1a2b3', plan_id: 'inicial', kind: 'alta', period: 'mensual', starts_on: '2026-11-01', ends_on: '2026-11-30', price_cop: 39900, discount_cop: 0, extra_days: 0, payment_method: 'nequi', payment_reference: 'NQ-1', status: 'pagada', created_at: '2026-11-01T10:00:00Z' }],
  invitations: [],
  audit: [],
  twofa: { 'super@gosen.co': false, 'admin@alfa.co': false },
  saTokens: new Set(),
  // v43: prueba gratuita, colección demo y cobro.
  trialCodes: [],
  // Prueba de punta a punta en /contratar: un código sin usar, reservas y cuentas de Neon Auth.
  trialSeed: { code: 'AAAABBBBCCCC', reserved: null, church: null, used: false },
  authUsers: new Map(),
  verified: new Set(),
  trials: [{ id: 'iglesia-nueva-9f8e7', name: 'Iglesia Nueva Vida', owner_email: 'nueva@vida.co', trial_started_at: '2026-11-24T10:00:00Z', trial_ends_at: '2026-11-29T10:00:00Z', plan_id: 'prueba', state: 'prueba', converted: false, demos: 3, members: 1 }],
  demos: [],
  payments: [{ created_at: '2026-11-24T11:00:00Z', church_id: 'iglesia-alfa-1a2b3', church: 'Iglesia Alfa', env: 'sandbox', provider_tx: 'trpago0001', kind: 'alta', method: 'tarjeta', amount_cop: 35000, status: 'aprobado', card_brand: 'visa', card_last4: '1111', plan_id: 'equipo', period: 'mensual' }]
}
const today = () => new Date().toISOString().slice(0, 10)
const plan = (id) => db.plans.find((p) => p.id === id)
const stateOf = (c) => {
  if (c.status !== 'activa') return { state: c.status }
  if (c.internal) return { state: 'interna', ends_on: null, days_left: null }
  if (c.trial_ends_at) return { state: 'prueba', ends_on: c.trial_ends_at.slice(0, 10), days_left: 5, reminder: true, trial_ends_at: c.trial_ends_at }
  const end = db.subs.filter((s) => s.church_id === c.id && s.status === 'pagada').map((s) => s.ends_on).sort().at(-1)
  if (!end) return { state: 'sin_suscripcion' }
  const days = Math.round((Date.parse(end) - Date.parse(today())) / 864e5)
  return { state: days >= 0 ? 'activa' : days >= -7 ? 'gracia' : 'vencida', ends_on: end, days_left: days, reminder: days <= 10 }
}
const audit = (actor, church, action, target) => db.audit.unshift({ id: db.audit.length + 1, at: new Date().toISOString(), actor_email: actor, actor_role: actor === 'super@gosen.co' ? 'superadmin' : 'admin', church_id: church, action, target })
const access = (email) => {
  const t = db.trialSeed
  if (t.reserved === email && !t.used && !db.members.some((x) => x.email === email)) {
    if (!db.verified.has(email)) return { allowed: false, admin: false, email, pending: 'verificar-correo', pending_church: t.church }
    const id = 'iglesia-prueba-1f2e3'
    db.churches.push({ id, name: t.church, internal: false, status: 'activa', plan_id: 'inicial', trial_ends_at: new Date(Date.now() + 5 * 864e5).toISOString() })
    db.members.push({ email, church: id, name: null, admin: true })
    t.used = true
  }
  const m = db.members.find((x) => x.email === email)
  if (!m) return { allowed: false, admin: false, email, superadmin: email === 'super@gosen.co' }
  const c = db.churches.find((x) => x.id === m.church)
  const p = plan(c.plan_id)
  const st = stateOf(c)
  return {
    allowed: true, admin: m.admin, email, name: m.name, superadmin: false,
    church: { id: c.id, name: c.name, internal: c.internal, status: c.status, logo: c.logo || null },
    plan: { id: p.id, name: p.name, price_month: p.price_month_cop },
    subscription: st,
    features: ['activa', 'gracia', 'interna'].includes(st.state) ? p.features : [],
    limits: { members: p.max_members, storage_bytes: p.storage_gb ? p.storage_gb * 1073741824 : null },
    members: db.members.filter((x) => x.church === c.id).length,
    contact: { whatsapp: db.settings.contact_whatsapp, email: db.settings.contact_email }
  }
}
const ok = (data) => new Response(JSON.stringify(data))
const fail = (message, status = 400) => new Response(JSON.stringify({ message }), { status })

function rpc(name, email, b) {
  if (!email && (name === 'gosen_trial_check' || name === 'gosen_trial_redeem')) {
    const t = db.trialSeed
    const norm = String(b.p_code || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^PRB/, '')
    if (norm !== t.code) return ok({ ok: false, code: 'invalid', error: 'El código no es válido. Revísalo o pide uno nuevo.' })
    if (t.used) return ok({ ok: false, code: 'usada', error: 'Este código ya se usó.' })
    if (name === 'gosen_trial_check') return ok({ ok: true, kind: 'prueba', days: 5 })
    t.reserved = b.p_email
    t.church = b.p_church
    return ok({ ok: true, kind: 'prueba', church: b.p_church, days: 5, account_exists: db.authUsers.has(b.p_email) })
  }
  if (!email && name === 'gosen_signup_start') return ok({ ok: false, code: 'checkout-off', error: 'La contratación en línea aún no está disponible. Escríbenos para contratar.' })
  const me = access(email)
  const sa = () => email === 'super@gosen.co' && db.saTokens.has(b.p_sa)
  const needSa = () => fail('GOSEN_SA_SESSION: tu sesión de Superadmin venció.')
  const myChurch = () => db.churches.find((c) => c.id === me.church?.id)
  switch (name) {
    case 'gosen_my_access':
      return ok(me)
    case 'gosen_2fa_status':
      return ok({ enabled: !!db.twofa[email], required: email === 'super@gosen.co', recovery_left: db.twofa[email] ? 8 : null })
    case 'gosen_2fa_enroll':
      return ok({ secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Gosen%20Tracks:x?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' })
    case 'gosen_2fa_confirm':
      if (b.p_code !== '123456') return ok({ ok: false, error: 'El código no coincide.' })
      db.twofa[email] = true
      return ok({ ok: true, recovery_codes: Array.from({ length: 8 }, (_, i) => `AAAA${i}-BBBB${i}`) })
    case 'gosen_2fa_verify':
      return ok({ ok: b.p_code === '123456', result: b.p_code === '123456' ? 'ok' : 'incorrecto' })
    case 'gosen_sa_login': {
      if (email !== 'super@gosen.co') return ok({ ok: false, error: 'Esta cuenta no es de Superadmin.' })
      if (!db.twofa[email]) return ok({ ok: false, code: '2fa-setup', error: 'Activa primero la verificación en dos pasos.' })
      if (b.p_code !== '123456') return ok({ ok: false, code: 'bad-code', error: 'Código incorrecto.' })
      const t = `sa-${db.saTokens.size + 1}`
      db.saTokens.add(t)
      audit(email, null, 'superadmin.entrada', email)
      return ok({ ok: true, token: t, expires_at: new Date(Date.now() + 8 * 3600e3).toISOString() })
    }
    case 'gosen_sa_ping':
      return sa() ? ok(true) : needSa()
    case 'gosen_sa_logout':
      db.saTokens.delete(b.p_sa)
      return ok(null)
    case 'gosen_sa_overview':
      if (!sa()) return needSa()
      return ok({
        settings: db.settings,
        features: db.features,
        plans: db.plans,
        churches: db.churches.map((c) => ({
          ...c, members: db.members.filter((m) => m.church === c.id).length,
          admins: db.members.filter((m) => m.church === c.id && m.admin).map((m) => m.email),
          limits: { max_members: plan(c.plan_id).max_members, storage_bytes: plan(c.plan_id).storage_gb ? plan(c.plan_id).storage_gb * 1073741824 : null },
          subscription: stateOf(c), pending_invitations: db.invitations.filter((i) => i.church_id === c.id && i.status === 'pendiente').length
        })),
        commercial: { used: db.churches.filter((c) => !c.internal && c.status !== 'archivada').length, max: db.settings.max_commercial_churches }
      })
    case 'gosen_sa_create_church': {
      if (!sa()) return needSa()
      if (db.churches.filter((c) => !c.internal && c.status !== 'archivada').length >= db.settings.max_commercial_churches) return fail(`Ya hay ${db.settings.max_commercial_churches} iglesias comerciales (el cupo es ${db.settings.max_commercial_churches}).`)
      const id = b.p_church.name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-9f9f9'
      db.churches.push({ id, name: b.p_church.name, internal: false, status: 'activa', plan_id: b.p_church.plan_id, city: b.p_church.city, contact_name: b.p_church.contact_name, contact_phone: b.p_church.contact_phone })
      audit(email, id, 'iglesia.creada', b.p_church.name)
      return ok({ id, name: b.p_church.name })
    }
    case 'gosen_sa_update_church': {
      if (!sa()) return needSa()
      const c = db.churches.find((x) => x.id === b.p_id)
      Object.assign(c, b.p_patch)
      audit(email, c.id, 'iglesia.editada', c.name)
      return ok(null)
    }
    case 'gosen_sa_set_church_status': {
      if (!sa()) return needSa()
      db.churches.find((x) => x.id === b.p_id).status = b.p_status
      return ok(null)
    }
    case 'gosen_sa_members':
      if (!sa()) return needSa()
      return ok(db.members.filter((m) => m.church === b.p_church).map((m) => ({ email: m.email, name: m.name, tag: null, is_admin: m.admin, registered: true, verified: true, added_at: '2026-11-01' })))
    case 'gosen_sa_invitations':
      if (!sa()) return needSa()
      return ok(db.invitations.filter((i) => i.church_id === b.p_church))
    case 'gosen_sa_create_invitation':
    case 'gosen_create_invitation': {
      if (name === 'gosen_sa_create_invitation' ? !sa() : !me.admin) return name === 'gosen_sa_create_invitation' ? needSa() : fail('Solo el administrador puede invitar.')
      const id = `bbbbbbbb-0000-4000-8000-${String(db.invitations.length + 1).padStart(12, '0')}`
      const church = name === 'gosen_sa_create_invitation' ? b.p_church : me.church.id
      const code = `GSN-TEST-${String(db.invitations.length + 1).padStart(4, '0')}-ABCD`
      db.invitations.unshift({ id, church_id: church, role: b.p_role || 'member', hint: 'ABCD', note: b.p_note, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), status: 'pendiente' })
      audit(email, church, 'invitacion.creada', id)
      return ok([{ id, code, expires_at: db.invitations[0].expires_at }])
    }
    case 'gosen_sa_revoke_invitation':
    case 'gosen_revoke_invitation': {
      const i = db.invitations.find((x) => x.id === b.p_id)
      if (i) i.status = 'anulada'
      return ok(null)
    }
    case 'gosen_sa_subscriptions':
      if (!sa()) return needSa()
      return ok(db.subs.filter((s) => !b.p_church || s.church_id === b.p_church).map((s) => ({ ...s, church: db.churches.find((c) => c.id === s.church_id).name })))
    case 'gosen_sa_add_subscription': {
      if (!sa()) return needSa()
      const s = b.p_sub
      const c = db.churches.find((x) => x.id === s.church_id)
      const last = db.subs.filter((x) => x.church_id === c.id && x.status === 'pagada').map((x) => x.ends_on).sort().at(-1)
      const start = s.starts_on || (last && last >= today() ? new Date(Date.parse(last) + 864e5).toISOString().slice(0, 10) : today())
      const end = new Date(Date.parse(start) + (s.period === 'anual' ? 365 : 30) * 864e5 + (s.extra_days || 0) * 864e5).toISOString().slice(0, 10)
      const row = { id: `cccccccc-0000-4000-8000-${String(db.subs.length + 1).padStart(12, '0')}`, church_id: c.id, plan_id: s.plan_id, kind: last ? (s.plan_id === c.plan_id ? 'renovacion' : 'cambio_plan') : 'alta', period: s.period, starts_on: start, ends_on: end, price_cop: s.price_cop, discount_cop: s.discount_cop, extra_days: s.extra_days, payment_method: s.payment_method, payment_reference: s.payment_reference, receipt_key: s.receipt_key, status: 'pagada', created_at: new Date().toISOString() }
      db.subs.unshift(row)
      c.plan_id = s.plan_id
      audit(email, c.id, 'suscripcion.registrada', row.id)
      return ok({ id: row.id, kind: row.kind, starts_on: start, ends_on: end })
    }
    case 'gosen_sa_void_subscription': {
      if (!sa()) return needSa()
      db.subs.find((x) => x.id === b.p_id).status = 'anulada'
      return ok(null)
    }
    case 'gosen_sa_upsert_plan': {
      if (!sa()) return needSa()
      Object.assign(plan(b.p_plan.id), { ...b.p_plan, price_month_cop: Number(b.p_plan.price_month_cop) })
      return ok(null)
    }
    case 'gosen_sa_set_setting':
      if (!sa()) return needSa()
      db.settings[b.p_key] = b.p_value
      return ok(null)
    case 'gosen_sa_audit':
      if (!sa()) return needSa()
      return ok(db.audit.filter((a) => !b.p_church || a.church_id === b.p_church))
    case 'gosen_sa_audit_verify':
      if (!sa()) return needSa()
      return ok({ total: db.audit.length, intact: true, first_broken_id: null })
    case 'gosen_sa_export':
      if (!sa()) return needSa()
      return ok({ exported_at: new Date().toISOString(), churches: db.churches })
    case 'gosen_sa_reset_2fa':
      if (!sa()) return needSa()
      db.twofa[b.p_email] = false
      return ok(null)
    case 'gosen_my_church': {
      const c = myChurch()
      return ok({ id: c.id, name: c.name, city: c.city || null, contact_name: c.contact_name || null, contact_phone: c.contact_phone || null, contact_email: null, accent: null, logo: c.logo || null })
    }
    case 'gosen_update_my_church': {
      const c = myChurch()
      if (b.p_patch.logo !== undefined && !access(email).features.includes('personalizacion')) return fail('El logo propio es parte del plan Equipo o Premium.')
      Object.assign(c, { name: b.p_patch.name ?? c.name, city: b.p_patch.city ?? c.city })
      return ok({ id: c.id, name: c.name })
    }
    case 'gosen_list_access':
      return ok(db.members.filter((m) => m.church === me.church?.id).map((m) => ({ email: m.email, note: m.name, added_at: '2026-11-01', registered: true, is_admin: m.admin, tag: null })))
    case 'gosen_set_role': {
      const m = db.members.find((x) => x.email === b.p_email && x.church === me.church?.id)
      if (!m) return fail('Ese correo no está en tu iglesia.')
      m.admin = b.p_role === 'admin'
      return ok(null)
    }
    case 'gosen_list_invitations':
      return ok(db.invitations.filter((i) => i.church_id === me.church?.id))
    case 'gosen_my_subscriptions':
      return ok(db.subs.filter((s) => s.church_id === me.church?.id).map((s) => ({ ...s, plan: plan(s.plan_id).name, has_receipt: !!s.receipt_key })))
    case 'gosen_sa_trial_codes':
      return sa() ? ok(db.trialCodes) : needSa()
    case 'gosen_sa_trials':
      return sa() ? ok(db.trials) : needSa()
    case 'gosen_sa_demo_songs':
      return sa() ? ok(db.demos) : needSa()
    case 'gosen_sa_create_trial_code': {
      if (!sa()) return needSa()
      const row = { id: `33333333-3333-4333-8333-${String(db.trialCodes.length + 1).padStart(12, '0')}`, code: 'PRB-7K3M-Q9WX-2T4D', expires_at: '2026-12-24T00:00:00Z' }
      db.trialCodes.unshift({ id: row.id, hint: '2T4D', note: b.p_note, created_at: new Date().toISOString(), expires_at: row.expires_at, status: 'pendiente', used_email: null, church: null, church_state: null })
      return ok([row])
    }
    case 'gosen_sa_revoke_trial_code': {
      if (!sa()) return needSa()
      const t = db.trialCodes.find((x) => x.id === b.p_id)
      if (t) t.status = 'anulada'
      return ok(null)
    }
    case 'gosen_sa_set_trial': {
      if (!sa()) return needSa()
      const t = db.trials.find((x) => x.id === b.p_church)
      if (!t) return fail('Esa iglesia no tiene prueba gratuita.')
      t.trial_ends_at = b.p_ends_at
      t.state = Date.parse(b.p_ends_at) > Date.now() ? 'prueba' : 'prueba_vencida'
      return ok(null)
    }
    case 'gosen_sa_set_demo': {
      if (!sa()) return needSa()
      const d = db.demos.find((x) => x.song_key === b.p_key)
      if (d) d.active = b.p_active
      else db.demos.push({ song_key: b.p_key, title: b.p_title, active: b.p_active, in_trials: 0 })
      return ok(null)
    }
    case 'gosen_sa_billing':
      return sa() ? ok({ subscriptions: [], events: [], checkouts: [] }) : needSa()
    case 'gosen_sa_payments':
      return sa() ? ok(db.payments) : needSa()
    default:
      return fail(`Could not find the function public.${name}`, 404)
  }
}

const env = { TRACKS: new FakeBucket(), AUTH_URL: 'https://ep-x.neonauth.test.neon.tech/neondb/auth', DATA_API_URL: 'https://ep-x.apirest.test.neon.tech/neondb/rest/v1', MAX_TOTAL_BYTES: '0', MAX_FILE_BYTES: '2147483648' }
globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  if (u.endsWith('/sign-in/email')) {
    const { email } = JSON.parse(init.body)
    return new Response('{}', { headers: { 'set-cookie': `s=${email}; Path=/`, 'set-auth-jwt': jwtFor(email) } })
  }
  if (u.endsWith('/token')) return new Response(JSON.stringify({ token: jwtFor(String(init.headers?.cookie || '').replace(/^s=/, '')) }))
  if (u.endsWith('/sign-up/email')) {
    const { email } = JSON.parse(init.body)
    if (db.authUsers.has(email)) return new Response('{"message":"User already exists"}', { status: 422 })
    if (db.trialSeed.reserved !== email) return new Response('{"message":"GOSEN_EMAIL_NOT_ALLOWED"}', { status: 422 })
    db.authUsers.set(email, true)
    return new Response('{"user":{}}')
  }
  if (u.endsWith('/email-otp/send-verification-otp')) return new Response('{"success":true}')
  if (u.endsWith('/email-otp/verify-email')) {
    const { email, otp } = JSON.parse(init.body)
    if (otp !== '123456') return new Response('{"message":"Invalid OTP"}', { status: 400 })
    db.verified.add(email)
    return new Response('{"status":true}')
  }
  if (u.endsWith('/revoke-other-sessions')) return new Response('{"status":true}')
  const name = u.split('/rpc/')[1]
  if (name) return rpc(name, emailOf(String(init.headers?.authorization || '').replace(/^Bearer /, '')), init.body ? JSON.parse(init.body) : {})
  return new Response('{}', { status: 404 })
}

await env.TRACKS.put('c/iglesia-alfa-1a2b3/1-Alfa.zip', makeZip([{ name: 'Alfa/tracks/Bat.wav', data: audio(3) }]), { customMetadata: { name: 'Alfa.zip' } })
await env.TRACKS.put('1-Gosen.zip', makeZip([{ name: 'Gosen/tracks/Bat.wav', data: audio(3) }]), { customMetadata: { name: 'Gosen.zip' } })

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
http
  .createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    if (req.url === '/__test/db') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ churches: db.churches, subs: db.subs, invitations: db.invitations, plans: db.plans, settings: db.settings, twofa: db.twofa, trials: db.trials, trialCodes: db.trialCodes, demos: db.demos }))
    }
    if (req.url.startsWith('/fonts/')) {
      try {
        res.writeHead(200)
        return res.end(await readFile(path.join(root, 'public', 'fonts', path.basename(req.url))))
      } catch {
        res.writeHead(404)
        return res.end()
      }
    }
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
    })
    const response = await worker.fetch(request, env)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  })
  .listen(0, '127.0.0.1', function () {
    console.log(`PORT ${this.address().port}`)
  })
