/**
 * Cumplimiento legal en el Worker: páginas de los documentos (/legal), su estado y versiones, el
 * registro de aceptaciones (en Neon, sql/legal-consentimientos.sql) y las comprobaciones que piden
 * esa aceptación antes de usar el panel o descargar.
 *
 * GET  /legal                         → índice: documentos, versión vigente, historial
 * GET  /legal/<doc>[/<versión>]       → un documento (la versión vigente o una anterior)
 * GET  /api/legal                     → estado público: versiones, fechas, huellas, si ya rigen
 * Con la sesión de Neon (no la del panel), porque se registran a nombre de la cuenta:
 * GET  /api/legal/status              → qué falta aceptar a esta cuenta
 * POST /api/legal/accept              → registrar aceptaciones { operation, channel, accept: [{document, version, sha256}] }
 * POST /api/legal/revoke              → retirar { operation, document }
 * GET  /api/legal/evidence?email=     → (admin) evidencias de una cuenta o las últimas
 * GET  /api/legal/verify              → (admin) integridad de la cadena y de los anclajes
 *
 * Mientras falten datos del responsable (owner.js) o la fecha de vigencia, los documentos son un
 * borrador: se publican marcados como tal y NO se piden ni registran aceptaciones.
 */
import { CONSENT_DOCUMENTS, DOCUMENTS, DOC_IDS } from './documents.js'
import { OWNER, OWNER_FIELD_LABELS, missingOwnerFields } from './owner.js'

const SYSTEM = 'system/'
/** Copia de la huella de cada registro fuera de la base (en R2): ancla para detectar manipulaciones. */
export const ANCHORS = SYSTEM + 'consent-anchors/'
/** Marca de retiro de una aceptación (por huella del correo): invalida las sesiones del panel anteriores. */
export const REVOKED = SYSTEM + 'legal-revoked/'
export const CHANNELS = ['panel-web:inicio-sesion', 'panel-web:nueva-version', 'panel-web:retiro']

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const longDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} de ${MONTHS[m - 1]} de ${y}`
}

export async function sha256hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// --- Estado de los documentos ---------------------------------------------------------------------

/**
 * Datos del responsable y fecha de vigencia. LEGAL_PREVIEW (JSON {owner, effective}) solo existe para
 * las pruebas: permite ver los documentos en vigor sin tocar owner.js.
 */
export function legalContext(env) {
  let owner = OWNER
  let effective = null
  if (env?.LEGAL_PREVIEW) {
    try {
      const p = JSON.parse(env.LEGAL_PREVIEW)
      owner = { ...OWNER, ...(p.owner || {}) }
      effective = typeof p.effective === 'string' ? p.effective : null
    } catch {
      // sin vista previa
    }
  }
  return { owner, effective, today: new Date().toISOString().slice(0, 10) }
}

const bodyCache = new Map()
/** Texto exacto de una versión (con los datos del responsable) y su huella SHA-256. */
async function rendered(id, v, ctx) {
  const k = `${id}@${v.version}@${JSON.stringify(ctx.owner)}`
  let hit = bodyCache.get(k)
  if (!hit) {
    const html = v.body(ctx.owner)
    hit = { html, sha256: await sha256hex(html) }
    if (bodyCache.size > 64) bodyCache.clear()
    bodyCache.set(k, hit)
  }
  return hit
}

/** Versiones de un documento con su fecha efectiva (la del archivo o, en pruebas, la de LEGAL_PREVIEW). */
function versionsOf(id, ctx) {
  return DOCUMENTS[id].versions.map((v) => ({ ...v, effective: v.effective ?? ctx.effective }))
}

/** La versión que rige hoy (la última ya en vigor) o, si ninguna rige, la última (borrador). */
export async function docState(id, ctx) {
  const versions = versionsOf(id, ctx)
  const inForce = versions.filter((v) => v.effective && v.effective <= ctx.today)
  const current = inForce.at(-1) ?? versions.at(-1)
  const missing = missingOwnerFields(ctx.owner)
  const status = inForce.length && !missing.length ? 'vigente' : 'borrador'
  const { sha256 } = await rendered(id, current, ctx)
  return {
    id,
    title: DOCUMENTS[id].title,
    version: current.version,
    effective: status === 'vigente' ? current.effective : null,
    status,
    sha256,
    url: `/legal/${id}`,
    missing: missing.map((k) => OWNER_FIELD_LABELS[k]),
    consent: DOCUMENTS[id].consent ?? null
  }
}

export async function legalSummary(env) {
  const ctx = legalContext(env)
  const documents = await Promise.all(DOC_IDS.map((id) => docState(id, ctx)))
  // Se piden aceptaciones solo cuando términos y privacidad están en vigor.
  const active = CONSENT_DOCUMENTS.every((id) => documents.find((d) => d.id === id).status === 'vigente')
  return { active, documents }
}

// --- Páginas --------------------------------------------------------------------------------------

const PAGE_CSS = `
:root{--font:'Barlow','Segoe UI',system-ui,sans-serif;--font-label:'Barlow Condensed','Barlow','Segoe UI',sans-serif;--mono:'JetBrains Mono',Consolas,monospace}
:root,:root[data-theme='light']{color-scheme:light;--bg:#f5f4f9;--panel:#fff;--line:#e6e3ef;--text:#16141f;--text-2:#4d4960;--text-3:#6e6a85;--accent:#6b3cf6;--accent-tx:#5a2ee0;--accent-soft:#f0ebff;--warn-bg:#fff6e0;--warn-line:#f1b44c}
:root[data-theme='dark']{color-scheme:dark;--bg:#0a0910;--panel:#15131f;--line:#262236;--text:#f1eff8;--text-2:#b5b0c8;--text-3:#8a85a0;--accent:#7b52ff;--accent-tx:#c4b5fd;--accent-soft:rgba(123,82,255,.16);--warn-bg:rgba(241,180,76,.12);--warn-line:#a87a24}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--text);font:17px/1.6 var(--font);-webkit-font-smoothing:antialiased}
a{color:var(--accent-tx)}
.wrap{width:min(860px,calc(100% - 32px));margin:0 auto}
header.top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:18px 0}
header.top .brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--text);font-weight:700;white-space:nowrap}
header.top .brand img{width:30px;height:30px;border-radius:8px}
header.top nav{margin-left:auto;display:flex;gap:16px;flex-wrap:wrap;font-size:15px}
header.top nav a{color:var(--text-2);text-decoration:none;white-space:nowrap}header.top nav a:hover{color:var(--text)}
main{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:28px clamp(18px,4vw,44px) 36px;margin-bottom:28px}
h1{font-size:clamp(26px,4vw,36px);line-height:1.15;margin:0 0 10px;letter-spacing:-.02em}
h2{font-size:20px;margin:28px 0 8px;letter-spacing:-.01em}
.meta{color:var(--text-3);font-size:14px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.chip{font:600 12px/1 var(--font-label);letter-spacing:.06em;text-transform:uppercase;padding:5px 9px;border-radius:999px;background:var(--accent-soft);color:var(--accent-tx)}
.chip.draft{background:var(--warn-bg);color:inherit;border:1px solid var(--warn-line)}
.draft-banner{margin:16px 0 0;padding:12px 14px;border-radius:12px;background:var(--warn-bg);border:1px solid var(--warn-line);font-size:15px}
mark.pending{background:var(--warn-bg);color:inherit;border-bottom:1px dashed var(--warn-line);padding:0 3px;border-radius:3px}
section.notice{background:var(--accent-soft);border-radius:14px;padding:4px 18px 14px;margin-top:20px}
table{width:100%;border-collapse:collapse;font-size:15px;margin:10px 0;display:block;overflow-x:auto}
th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--line)}
th{font:600 13px/1.3 var(--font-label);letter-spacing:.04em;text-transform:uppercase;color:var(--text-3)}
code,.hash{font-family:var(--mono);font-size:13px;word-break:break-all}
ul{padding-left:22px}li{margin:4px 0}
.history{margin-top:32px;padding-top:16px;border-top:1px solid var(--line);font-size:15px;color:var(--text-2)}
.doclist{list-style:none;padding:0}.doclist li{padding:14px 0;border-bottom:1px solid var(--line)}
.doclist a{font-weight:600;font-size:18px}
footer.legal-foot{padding:4px 0 36px;color:var(--text-3);font-size:14px;display:flex;flex-wrap:wrap;gap:8px 18px}
footer.legal-foot a,footer.legal-foot button{color:var(--text-2);background:none;border:0;padding:0;font:inherit;cursor:pointer;text-decoration:underline}
@media print{header.top nav,footer.legal-foot{display:none}main{border:0}}
`

/** Pie de página con los enlaces legales (el mismo en todas las páginas). */
export function legalLinksHtml() {
  return (
    DOC_IDS.map((id) => `<a href="/legal/${id}">${esc(DOCUMENTS[id].short)}</a>`).join('') +
    '<button type="button" data-privacy-settings>Configurar cookies</button>'
  )
}

function page(title, inner) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · Gosen Tracks</title>
<link rel="icon" href="/logo.png" />
<link rel="stylesheet" href="/fonts/fonts.css" />
<script>;(function(){var t=null;try{t=localStorage.getItem('gosen.web.theme')}catch(e){}if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t})()</script>
<style>${PAGE_CSS}</style>
<script src="/web/privacidad.js" defer></script>
</head>
<body>
<div class="wrap">
<header class="top"><a class="brand" href="/"><img src="/logo.png" alt="" />Gosen Tracks</a>
<nav aria-label="Documentos legales"><a href="/legal">Documentos legales</a><a href="/">Inicio</a></nav></header>
${inner}
<footer class="legal-foot" aria-label="Enlaces legales">${legalLinksHtml()}</footer>
</div>
</body>
</html>`
}

const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } })

/** /legal y /legal/<doc>[/<versión>]. Devuelve null si la ruta no es de documentos. */
export async function legalPage(path, env) {
  if (path !== '/legal' && path !== '/legal/' && !path.startsWith('/legal/')) return null
  const ctx = legalContext(env)
  const parts = path.split('/').filter(Boolean).slice(1)
  if (!parts.length) {
    const states = await Promise.all(DOC_IDS.map((id) => docState(id, ctx)))
    const items = states
      .map(
        (s) =>
          `<li><a href="${s.url}">${esc(s.title)}</a><div class="meta"><span class="chip${s.status === 'vigente' ? '' : ' draft'}">${s.status === 'vigente' ? 'Vigente' : 'Borrador'}</span><span>Versión ${esc(s.version)}</span>${s.effective ? `<span>Desde el ${longDate(s.effective)}</span>` : ''}</div></li>`
      )
      .join('')
    const draft = states.some((s) => s.status !== 'vigente')
    return html(
      page(
        'Documentos legales',
        `<main><h1>Documentos legales</h1><p class="meta">Gosen Tracks · ${esc(ctx.owner.name)}</p>${
          draft ? `<p class="draft-banner">Estos documentos están en preparación: faltan datos del responsable (${esc(states[0].missing.join(', '))}). Mientras tanto no se piden aceptaciones.</p>` : ''
        }<ul class="doclist">${items}</ul><p class="meta">Cada documento conserva su historial de versiones. Cuando un documento cambia, se publica una versión nueva con su fecha de entrada en vigor; las anteriores siguen disponibles para consulta.</p></main>`
      )
    )
  }
  const [id, wanted] = parts
  if (!DOCUMENTS[id] || parts.length > 2) return html(page('No encontrado', '<main><h1>Documento no encontrado</h1><p><a href="/legal">Ver los documentos legales</a></p></main>'), 404)
  const state = await docState(id, ctx)
  const versions = versionsOf(id, ctx)
  const v = wanted ? versions.find((x) => x.version === wanted) : versions.find((x) => x.version === state.version)
  if (!v) return html(page('No encontrado', `<main><h1>Esa versión no existe</h1><p><a href="/legal/${id}">Ver la versión vigente</a></p></main>`), 404)
  const { html: body, sha256 } = await rendered(id, v, ctx)
  const isCurrent = v.version === state.version
  const status = isCurrent ? state.status : 'anterior'
  const chip = status === 'vigente' ? '<span class="chip">Vigente</span>' : status === 'borrador' ? '<span class="chip draft">Borrador</span>' : '<span class="chip draft">Versión anterior</span>'
  const history = versions
    .slice()
    .reverse()
    .map((x) => `<li><a href="/legal/${id}/${esc(x.version)}">Versión ${esc(x.version)}</a>${x.effective ? ` · desde el ${longDate(x.effective)}` : ' · sin fecha de vigencia'} · ${esc(x.changes)}</li>`)
    .join('')
  return html(
    page(
      DOCUMENTS[id].title,
      `<main><h1>${esc(DOCUMENTS[id].title)}</h1>
<div class="meta">${chip}<span>Versión ${esc(v.version)}</span>${v.effective && status !== 'borrador' ? `<span>Vigente desde el ${longDate(v.effective)}</span>` : ''}</div>
${
  status === 'borrador'
    ? `<p class="draft-banner">Borrador: este documento aún no está en vigor porque faltan datos del responsable (${esc(state.missing.join(', ') || 'fecha de vigencia')}). No se piden aceptaciones sobre un borrador.</p>`
    : status === 'anterior'
      ? `<p class="draft-banner">Esta es una versión anterior, publicada para consulta. <a href="/legal/${id}">Ver la versión vigente</a>.</p>`
      : ''
}
<article>${body}</article>
<div class="history"><strong>Historial de versiones</strong><ul>${history}</ul><p>Huella SHA-256 de este texto (permite comprobar que es el mismo que se aceptó): <span class="hash">${sha256}</span></p></div></main>`
    )
  )
}

// --- Registro de aceptaciones (Neon) --------------------------------------------------------------

/** Llama a una función de Neon con la sesión de la cuenta. {missing} si la función no existe aún. */
export async function neonRpc(env, jwt, name, body = {}) {
  const r = await fetch(`${env.DATA_API_URL}/rpc/${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await r.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (r.status === 404 || data?.code === 'PGRST202') return { missing: true }
  if (!r.ok) return { error: data?.message || `Neon respondió ${r.status}`, status: r.status }
  return { data }
}

const SQL_MISSING = 'Falta ejecutar sql/legal-consentimientos.sql en Neon (SQL Editor) para registrar aceptaciones.'

/**
 * ¿Esta cuenta aceptó las versiones vigentes de términos y privacidad? (y su último registro de cada uno).
 * {ok, active, claims, pending, error}. Si los documentos no están en vigor, no se exige nada.
 */
export async function consentState(env, jwt) {
  const { active, documents } = await legalSummary(env)
  const required = documents.filter((d) => CONSENT_DOCUMENTS.includes(d.id))
  if (!active) return { ok: true, active: false, documents: required.map((d) => ({ ...d, accepted: null })) }
  const res = await neonRpc(env, jwt, 'gosen_my_consents')
  if (res.missing) return { ok: false, active: true, error: SQL_MISSING, code: 'sql-missing', documents: required.map((d) => ({ ...d, accepted: false })) }
  if (res.error) return { ok: false, active: true, error: res.error, code: 'neon', documents: required.map((d) => ({ ...d, accepted: false })) }
  const rows = Array.isArray(res.data) ? res.data : []
  const out = required.map((d) => {
    const last = rows.find((r) => r.document === d.id)
    const accepted = !!last && last.action === 'acepta' && last.version === d.version && last.content_sha256 === d.sha256
    return { ...d, accepted, last: last ? { action: last.action, version: last.version, at: last.recorded_at } : null }
  })
  const claims = Object.fromEntries(out.map((d) => [d.id, `${d.version}@${d.sha256.slice(0, 16)}`]))
  return { ok: out.every((d) => d.accepted), active: true, documents: out, claims }
}

/** Las sesiones del panel guardan qué versiones había aceptado el admin: ¿siguen siendo las vigentes? */
export async function claimsCurrent(env, claims, email, iat) {
  const { active, documents } = await legalSummary(env)
  if (!active) return true
  if (!claims) return false
  for (const d of documents.filter((x) => CONSENT_DOCUMENTS.includes(x.id))) {
    if (claims[d.id] !== `${d.version}@${d.sha256.slice(0, 16)}`) return false
  }
  // Si retiró una aceptación después de abrir esta sesión, la sesión ya no sirve para lo que la exige.
  if (email) {
    const mark = await env.TRACKS.head(REVOKED + (await sha256hex(email)))
    if (mark && Number(mark.customMetadata?.at || 0) >= (iat || 0)) return false
  }
  return true
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Guarda fuera de la base una copia de la huella de cada registro (sin datos personales). */
async function anchor(env, rows) {
  for (const r of rows || []) {
    if (!r?.row_hash || !r?.event_id) continue
    const at = String(r.recorded_at || new Date().toISOString()).replace(/[^0-9TZ:.-]/g, '')
    await env.TRACKS.put(`${ANCHORS}${at}_${r.event_id}`, JSON.stringify({ event_id: r.event_id, document: r.document, action: r.action, version: r.version, row_hash: r.row_hash }), {
      httpMetadata: { contentType: 'application/json' }
    })
  }
}

/**
 * Rutas /api/legal/* que requieren sesión. `jwt` es el token tal como llegó; `me` el acceso de Neon.
 * Devuelve null si la ruta no es de aquí.
 */
export async function legalApi(req, env, path, jwt, me, json) {
  if (!path.startsWith('/api/legal/')) return null
  const action = path.slice('/api/legal/'.length)
  // Se registran a nombre de la cuenta: hace falta la sesión de Neon, no la del panel.
  if (!jwt || jwt.startsWith('gps.')) return json({ error: 'Vuelve a iniciar sesión para continuar.', code: 'neon-session' }, 401)

  if (action === 'status' && req.method === 'GET') {
    const st = await consentState(env, jwt)
    return json({ active: st.active, ok: st.ok, error: st.error, code: st.code, documents: st.documents })
  }

  if ((action === 'accept' || action === 'revoke') && req.method === 'POST') {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return json({ error: 'Petición no válida.' }, 400)
    if (!UUID.test(String(body.operation || ''))) return json({ error: 'Falta el identificador de la operación.' }, 400)
    const { active, documents } = await legalSummary(env)
    if (!active) return json({ error: 'Los documentos aún son un borrador: no se registran aceptaciones.', code: 'draft' }, 409)
    const current = new Map(documents.map((d) => [d.id, d]))
    let items
    let channel
    if (action === 'accept') {
      channel = CHANNELS.includes(body.channel) && body.channel !== 'panel-web:retiro' ? body.channel : null
      if (!channel) return json({ error: 'Formulario no válido.' }, 400)
      const list = Array.isArray(body.accept) ? body.accept : []
      if (!list.length || list.length > CONSENT_DOCUMENTS.length) return json({ error: 'Marca las casillas que aceptas.', code: 'nothing' }, 400)
      const seen = new Set()
      items = []
      for (const a of list) {
        const d = a && current.get(a.document)
        if (!d || !CONSENT_DOCUMENTS.includes(d.id) || seen.has(d.id)) return json({ error: 'Documento no válido.' }, 400)
        seen.add(d.id)
        // Se acepta exactamente la versión vigente que se mostró: si cambió mientras tanto, se avisa.
        if (a.version !== d.version || a.sha256 !== d.sha256) {
          return json({ error: `Hay una versión nueva de «${d.title}». Revísala antes de aceptar.`, code: 'outdated', documents }, 409)
        }
        items.push({ document: d.id, version: d.version, sha256: d.sha256, effective: d.effective, action: 'acepta' })
      }
    } else {
      channel = 'panel-web:retiro'
      const d = current.get(body.document)
      if (!d || !CONSENT_DOCUMENTS.includes(d.id)) return json({ error: 'Documento no válido.' }, 400)
      items = [{ document: d.id, version: d.version, sha256: d.sha256, effective: d.effective, action: 'revoca' }]
    }
    const trace = (req.headers.get('cf-ray') || crypto.randomUUID()).slice(0, 80)
    const res = await neonRpc(env, jwt, 'gosen_record_consent', { p_operation: body.operation, p_channel: channel, p_trace: trace, p_items: items })
    if (res.missing) return json({ error: SQL_MISSING, code: 'sql-missing' }, 503)
    if (res.error) return json({ error: res.error }, res.status === 401 ? 401 : 502)
    const rows = Array.isArray(res.data) ? res.data : []
    await anchor(env, rows)
    if (action === 'revoke' && me?.email) {
      await env.TRACKS.put(REVOKED + (await sha256hex(String(me.email).toLowerCase())), '', { customMetadata: { at: String(Date.now()) } })
    }
    const st = await consentState(env, jwt)
    return json({ recorded: rows.map((r) => ({ event_id: r.event_id, document: r.document, action: r.action, version: r.version, recorded_at: r.recorded_at })), ok: st.ok, documents: st.documents })
  }

  if (action === 'evidence' && req.method === 'GET') {
    if (!me?.admin) return json({ error: 'Solo el administrador' }, 403)
    const email = (new URL(req.url).searchParams.get('email') || '').trim().toLowerCase().slice(0, 254)
    const res = await neonRpc(env, jwt, 'gosen_consent_evidence', { p_email: email || null, p_limit: 200 })
    if (res.missing) return json({ error: SQL_MISSING, code: 'sql-missing' }, 503)
    if (res.error) return json({ error: res.error }, 502)
    return json({ rows: res.data || [] })
  }

  if (action === 'verify' && req.method === 'GET') {
    if (!me?.admin) return json({ error: 'Solo el administrador' }, 403)
    const [v, ev] = await Promise.all([neonRpc(env, jwt, 'gosen_consent_verify'), neonRpc(env, jwt, 'gosen_consent_evidence', { p_email: null, p_limit: 1000 })])
    if (v.missing || ev.missing) return json({ error: SQL_MISSING, code: 'sql-missing' }, 503)
    if (v.error || ev.error) return json({ error: v.error || ev.error }, 502)
    const chain = (Array.isArray(v.data) ? v.data[0] : v.data) || {}
    // Cada anclaje guardado en R2 debe seguir existiendo en la base con la misma huella.
    const hashes = new Set((ev.data || []).map((r) => r.row_hash))
    let anchors = 0
    let missingAnchors = 0
    let cursor
    do {
      const page = await env.TRACKS.list({ prefix: ANCHORS, cursor, limit: 1000 })
      for (const o of page.objects) {
        const a = await env.TRACKS.get(o.key)
        let data = null
        try {
          data = a ? JSON.parse(await a.text()) : null
        } catch {
          data = null
        }
        anchors++
        if (!data || !hashes.has(data.row_hash)) missingAnchors++
      }
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor && anchors < 1000)
    return json({ total: Number(chain.total || 0), intact: !!chain.intact, firstBroken: chain.first_broken_id ?? null, anchors, missingAnchors, ok: !!chain.intact && missingAnchors === 0 })
  }

  return json({ error: 'No existe' }, 404)
}
