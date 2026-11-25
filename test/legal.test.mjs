/**
 * Pruebas del cumplimiento legal en el Worker (src/legal/*, descargas en src/index.js), con R2 y Neon
 * simulados (el SQL real se prueba aparte en test/sql.test.mjs con Postgres):
 *  - documentos públicos, versiones, historial y huella; borrador mientras falten datos del responsable;
 *  - aceptaciones independientes, validadas en el servidor y ligadas a la versión exacta;
 *  - el panel y las descargas exigen las aceptaciones vigentes; retirar tiene efecto;
 *  - descargas solo para administradores, con enlaces firmados que vencen;
 *  - sin datos innecesarios ni terceros (fuentes propias, sin analítica).
 *
 * Uso: node --import ./test/register.mjs test/legal.test.mjs
 */
import worker from '../src/index.js'
import { FakeBucket, audio, makeZip } from './fakes.mjs'

let failures = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`)
  if (!cond) failures++
}

// --- Neon simulado: cuentas por token y el registro de aceptaciones (mismas reglas que el SQL) ------
const ACCOUNTS = { 'jwt-admin': { email: 'admin@iglesia.com', admin: true }, 'jwt-ana': { email: 'ana@iglesia.com', admin: false } }
const consentLog = []
const rpcCalls = []
let sqlInstalled = true
globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  const jwt = String(init.headers?.authorization || '').replace(/^Bearer /, '')
  const acc = ACCOUNTS[jwt]
  const body = init.body ? JSON.parse(init.body) : {}
  const name = u.split('/rpc/')[1]
  if (name) rpcCalls.push({ name, body })
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status })
  if (name === 'gosen_my_access') return reply(acc ? { allowed: true, admin: acc.admin, email: acc.email } : { allowed: false })
  if (name?.startsWith('gosen_consent') || name === 'gosen_record_consent' || name === 'gosen_my_consents') {
    if (!sqlInstalled) return reply({ code: 'PGRST202', message: `Could not find the function public.${name}` }, 404)
    if (!acc) return reply({ message: 'JWT inválido' }, 401)
  }
  if (name === 'gosen_record_consent') {
    const rows = []
    for (const it of body.p_items) {
      const dup = consentLog.find((r) => r.email === acc.email && r.operation === body.p_operation && r.document === it.document && r.action === it.action)
      if (dup) {
        rows.push(dup)
        continue
      }
      const prev = consentLog.at(-1)?.row_hash ?? '0'.repeat(64)
      const row = { ...it, email: acc.email, operation: body.p_operation, channel: body.p_channel, trace: body.p_trace, event_id: crypto.randomUUID(), recorded_at: new Date().toISOString(), prev_hash: prev, row_hash: crypto.randomUUID().replace(/-/g, '').padEnd(64, '0') }
      consentLog.push(row)
      rows.push(row)
    }
    return reply(rows.map((r) => ({ event_id: r.event_id, document: r.document, action: r.action, version: r.version, recorded_at: r.recorded_at, row_hash: r.row_hash })))
  }
  if (name === 'gosen_my_consents') {
    const out = []
    for (const doc of ['privacidad', 'terminos']) {
      const last = consentLog.filter((r) => r.email === acc.email && r.document === doc).at(-1)
      if (last) out.push({ document: doc, action: last.action, version: last.version, content_sha256: last.sha256, effective_date: last.effective, recorded_at: last.recorded_at, event_id: last.event_id })
    }
    return reply(out)
  }
  if (name === 'gosen_consent_evidence') {
    if (!acc.admin) return reply({ message: 'Solo el administrador puede consultar el registro.' }, 400)
    const rows = consentLog.filter((r) => !body.p_email || r.email === body.p_email).slice().reverse()
    return reply(rows.map((r) => ({ event_id: r.event_id, subject_email: r.email, document: r.document, version: r.version, action: r.action, channel: r.channel, recorded_at: r.recorded_at, row_hash: r.row_hash, anonymized: false })))
  }
  if (name === 'gosen_consent_verify') {
    if (!acc.admin) return reply({ message: 'Solo el administrador' }, 400)
    return reply([{ total: consentLog.length, intact: true, first_broken_id: null, last_hash: consentLog.at(-1)?.row_hash ?? null }])
  }
  return reply({ ok: true })
}

const TODAY = new Date().toISOString().slice(0, 10)
const COMPLETE = { name: 'Comunidad Cristiana Gosen Barranquilla', nit: '900.000.000-1', address: 'Calle 1 # 2-3', email: 'datos@iglesia.test' }
const bucket = new FakeBucket()
const draftEnv = { TRACKS: bucket, AUTH_URL: 'https://a.neonauth.test/neondb/auth', DATA_API_URL: 'https://a.apirest.test/neondb/rest/v1', MAX_TOTAL_BYTES: '0', MAX_FILE_BYTES: '2147483648' }
const liveEnv = { ...draftEnv, LEGAL_PREVIEW: JSON.stringify({ owner: COMPLETE, effective: TODAY }) }

const call = async (env, method, path, { body, token = 'jwt-admin' } = {}) =>
  worker.fetch(
    new Request(`https://gosen.test${path}`, {
      method,
      headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {},
      body: body === undefined ? undefined : JSON.stringify(body)
    }),
    env
  )
const jsonOf = async (res) => res.json().catch(() => ({}))

await bucket.put('1-Eres.zip', makeZip([{ name: 'Eres/tracks/Bat.wav', data: audio(3) }, { name: 'Eres/tracks/Sx.wav', data: audio(5) }]), { customMetadata: { name: 'Eres.zip' } })
await bucket.put('tracks/1-Eres.zip/sx-nuevo.wav', audio(11))
await bucket.put('metadata/1-Eres.zip', JSON.stringify({ title: 'Eres Todopoderoso', artist: 'Gosen', tracks: [{ id: 'Eres/tracks/Bat.wav', name: 'Batería', category: 'drums' }, { id: 'Eres/tracks/Sx.wav', name: 'Saxo', category: 'sax', source: { object: 'tracks/1-Eres.zip/sx-nuevo.wav', size: 22, sha256: 'a'.repeat(64) } }] }))

// --- 1. Documentos -------------------------------------------------------------------------------------
console.log('Documentos legales (públicos, con versiones)')
{
  const idx = await call(draftEnv, 'GET', '/legal', { token: null })
  const html = await idx.text()
  ok(idx.status === 200 && ['terminos', 'privacidad', 'cookies', 'reembolsos'].every((d) => html.includes(`href="/legal/${d}"`)), 'índice con los 4 documentos, sin iniciar sesión')
  ok(/Borrador/.test(html) && /NIT o identificación/.test(html), 'mientras faltan datos del responsable, se publica como BORRADOR y dice qué falta')
  for (const d of ['terminos', 'privacidad', 'cookies', 'reembolsos']) {
    const r = await call(draftEnv, 'GET', `/legal/${d}`, { token: null })
    const t = await r.text()
    ok(r.status === 200 && t.includes('Versión 1.0') && t.includes('Huella SHA-256') && t.includes('pendiente de confirmar') && t.includes('Historial de versiones'), `/legal/${d}: versión, historial, huella y el dato pendiente marcado`)
  }
  const st = await jsonOf(await call(draftEnv, 'GET', '/api/legal', { token: null }))
  ok(st.active === false && st.documents.every((d) => d.status === 'borrador' && d.effective === null), 'en borrador: no hay fecha de vigencia y no se piden aceptaciones')
  ok((await call(draftEnv, 'GET', '/legal/terminos/9.9', { token: null })).status === 404 && (await call(draftEnv, 'GET', '/legal/otro', { token: null })).status === 404, 'una versión o un documento que no existen dan 404')

  const live = await jsonOf(await call(liveEnv, 'GET', '/api/legal', { token: null }))
  const terms = live.documents.find((d) => d.id === 'terminos')
  ok(live.active === true && terms.status === 'vigente' && terms.effective === TODAY && /^[0-9a-f]{64}$/.test(terms.sha256), 'con los datos completos y la fecha: vigentes, con fecha y huella')
  const page = await (await call(liveEnv, 'GET', '/legal/terminos/1.0', { token: null })).text()
  ok(page.includes(terms.sha256) && page.includes('900.000.000-1') && !page.includes('pendiente de confirmar'), 'la página muestra la misma huella que se registra al aceptar, y los datos del responsable')
  const priv = await (await call(liveEnv, 'GET', '/legal/privacidad', { token: null })).text()
  ok(['Ley Estatutaria 1581 de 2012', 'Decreto 1377 de 2013', 'datos@iglesia.test', '10 días hábiles', '15 días hábiles', 'Superintendencia de Industria y Comercio', 'dato sensible', 'Neon', 'Cloudflare', 'Suscripción y pagos', 'Ninguna otra iglesia ve tus datos'].every((x) => priv.includes(x)), 'la política de privacidad trae responsable, normas, derechos, plazos, datos sensibles, encargados, pagos y aislamiento entre iglesias')
  const refunds = await (await call(liveEnv, 'GET', '/legal/reembolsos', { token: null })).text()
  ok(
    /suscripción mensual o anual/.test(refunds) && /se renueva automáticamente/.test(refunds) && /Prueba gratuita/.test(refunds) && /cambio de opinión/.test(refunds) &&
      /artículo 47 de la Ley 1480/.test(refunds) && /15 días calendario/.test(refunds) && /Pago duplicado/.test(refunds) && /artículo 51/.test(refunds) &&
      /ART IN EARS/.test(refunds) && /sin penalidad/.test(refunds) && !/no se hacen reembolsos/i.test(refunds) && !/en ningún caso/i.test(refunds),
    'reembolsos: prueba gratuita antes de pagar, renovación automática que se cancela sin penalidad, sin reembolso por cambio de opinión PERO con retracto (15 días), cobros duplicados o no reconocidos y reversión; dice quién cobra (ART IN EARS); nunca «no se hacen reembolsos» ni «en ningún caso»'
  )
  const terms2 = await (await call(liveEnv, 'GET', '/legal/terminos', { token: null })).text()
  ok(/Prueba gratuita/.test(terms2) && /renovación automática/.test(terms2) && /Openpay/.test(terms2) && /ART IN EARS/.test(terms2) && /mayor de 18 años/.test(terms2), 'términos: prueba gratuita, pago en línea con renovación automática (Openpay, cobra ART IN EARS) y cuentas solo para mayores de 18')
  ok(/Openpay/.test(priv) && /ART IN EARS/.test(priv) && /Evidencia de la contratación/.test(priv) && /últimos 4 dígitos/.test(priv), 'privacidad: Openpay y el comercio que cobra como encargados, la evidencia de la contratación y solo los 4 últimos dígitos de la tarjeta')
}

// --- 2. Web sin terceros ni datos de más -----------------------------------------------------------------
console.log('\nCookies y terceros')
{
  const landing = await (await call(draftEnv, 'GET', '/', { token: null })).text()
  const admin = await (await call(draftEnv, 'GET', '/admin', { token: null })).text()
  ok(![landing, admin].some((h) => /fonts\.googleapis|fonts\.gstatic|googletagmanager|google-analytics|facebook\.net|hotjar/.test(h)), 'la página y el panel no cargan nada de Google ni de analítica o publicidad')
  ok([landing, admin].every((h) => h.includes('/fonts/fonts.css') && h.includes('/web/privacidad.js')), 'las fuentes se sirven desde el propio dominio; las preferencias de privacidad, en todas las páginas')
  ok(['terminos', 'privacidad', 'cookies', 'reembolsos'].every((d) => landing.includes(`/legal/${d}`)) && landing.includes('data-privacy-settings'), 'el pie de la página tiene los 4 documentos y «Configurar cookies»')
  const js = await call(draftEnv, 'GET', '/web/privacidad.js', { token: null })
  ok(js.status === 200 && /javascript/.test(js.headers.get('content-type')) && (await js.text()).includes('gosen.web.privacy'), '/web/privacidad.js se sirve como script')
  const set = [...(await call(draftEnv, 'GET', '/', { token: null })).headers.keys()].includes('set-cookie')
  ok(!set, 'la página no pone cookies')
}

// --- 3. Descargas (en borrador: solo administradores; aún no se exigen aceptaciones) ----------------------
console.log('\nDescargas para administradores')
{
  ok((await call(draftEnv, 'POST', '/api/download/1-Eres.zip', { token: 'jwt-ana' })).status === 403, 'un integrante no puede pedir descargas')
  ok((await call(draftEnv, 'POST', '/api/download/1-Eres.zip', { token: null })).status === 401, 'sin sesión, tampoco')
  const r = await jsonOf(await call(draftEnv, 'POST', '/api/download/1-Eres.zip'))
  ok(r.files?.length === 2 && r.files[0].name === 'Eres Todopoderoso - Gosen.zip' && /reemplazada/.test(r.files[1].label) && r.expires - Date.now() <= 5 * 60 * 1000, 'el admin recibe el ZIP original y la pista reemplazada, con enlaces de 5 minutos')
  const dl = await call(draftEnv, 'GET', r.files[0].url, { token: null })
  const bytes = new Uint8Array(await dl.arrayBuffer())
  ok(dl.status === 200 && bytes[0] === 0x50 && /attachment/.test(dl.headers.get('content-disposition')) && /no-store/.test(dl.headers.get('cache-control')), 'el enlace descarga el ZIP como archivo (sin guardarse en cachés)')
  ok(dl.headers.get('content-disposition').includes("filename*=UTF-8''Eres%20Todopoderoso%20-%20Gosen.zip"), 'con el nombre de la canción')
  const tampered = r.files[0].url.replace(/\.([^.]+)$/, '.AAAA')
  ok((await call(draftEnv, 'GET', tampered, { token: null })).status === 403, 'un enlace alterado no sirve')
  const token = r.files[0].url.slice('/api/dl/'.length)
  ok((await call(draftEnv, 'GET', '/api/me', { token })).status === 401, 'un enlace de descarga no sirve como sesión del panel')
  const panel = await jsonOf(await call(draftEnv, 'POST', '/api/panel-session'))
  ok((await call(draftEnv, 'GET', `/api/dl/${panel.token}`, { token: null })).status === 403, 'ni una sesión del panel sirve como enlace de descarga')
  for (const k of ['system/panel-session-key', 'metadata/1-Eres.zip', 'tracks/1-Eres.zip/sx-nuevo.wav', '../1-Eres.zip']) {
    ok((await call(draftEnv, 'POST', `/api/download/${encodeURIComponent(k)}`)).status === 404, `no se pueden pedir otros archivos del bucket (${k})`)
  }
  const realNow = Date.now
  Date.now = () => realNow() + 6 * 60 * 1000
  const late = await call(draftEnv, 'GET', r.files[0].url, { token: null })
  Date.now = realNow
  ok(late.status === 403, 'el enlace vence a los 5 minutos')
}

// --- 4. Aceptaciones (documentos vigentes) ------------------------------------------------------------
console.log('\nAceptación de términos y privacidad')
const state = async (token = 'jwt-admin') => jsonOf(await call(liveEnv, 'GET', '/api/legal/status', { token }))
const op = () => crypto.randomUUID()
{
  let st = await state()
  ok(st.active && !st.ok && st.documents.length === 2 && st.documents.every((d) => d.accepted === false), 'al principio no hay nada aceptado (nada se da por aceptado)')
  const ps = await call(liveEnv, 'POST', '/api/panel-session')
  ok(ps.status === 428 && (await jsonOf(ps)).code === 'consent-required', 'sin aceptar, el servidor no entrega la sesión del panel (no basta con ocultar el botón)')
  ok((await call(liveEnv, 'POST', '/api/download/1-Eres.zip')).status === 428, 'ni enlaces de descarga')

  const docs = st.documents
  const T = docs.find((d) => d.id === 'terminos')
  const P = docs.find((d) => d.id === 'privacidad')
  ok((await call(liveEnv, 'POST', '/api/legal/accept', { body: { operation: op(), channel: 'panel-web:inicio-sesion', accept: [] } })).status === 400, 'enviar sin marcar nada se rechaza')
  ok((await call(liveEnv, 'POST', '/api/legal/accept', { body: { channel: 'panel-web:inicio-sesion', accept: [{ document: 'terminos', version: T.version, sha256: T.sha256 }] } })).status === 400, 'sin identificador de operación se rechaza')
  const wrong = await call(liveEnv, 'POST', '/api/legal/accept', { body: { operation: op(), channel: 'panel-web:inicio-sesion', accept: [{ document: 'terminos', version: '0.9', sha256: T.sha256 }] } })
  ok(wrong.status === 409 && (await jsonOf(wrong)).code === 'outdated', 'aceptar una versión que no es la vigente se rechaza (hay que revisar la nueva)')
  ok((await call(liveEnv, 'POST', '/api/legal/accept', { body: { operation: op(), channel: 'otro', accept: [{ document: 'terminos', version: T.version, sha256: T.sha256 }] } })).status === 400, 'un formulario desconocido se rechaza')
  const panelToken = (await jsonOf(await call(draftEnv, 'POST', '/api/panel-session'))).token
  ok((await call(liveEnv, 'POST', '/api/legal/accept', { token: panelToken, body: { operation: op(), channel: 'panel-web:inicio-sesion', accept: [{ document: 'terminos', version: T.version, sha256: T.sha256 }] } })).status === 401, 'se acepta con la sesión de la propia cuenta (Neon), no con la del panel')

  // Solo la privacidad: queda registrada, pero los términos siguen pendientes (independientes).
  const o1 = op()
  const a1 = await jsonOf(await call(liveEnv, 'POST', '/api/legal/accept', { body: { operation: o1, channel: 'panel-web:inicio-sesion', accept: [{ document: 'privacidad', version: P.version, sha256: P.sha256 }] } }))
  st = await state()
  ok(a1.recorded?.length === 1 && st.documents.find((d) => d.id === 'privacidad').accepted && !st.documents.find((d) => d.id === 'terminos').accepted, 'aceptar la privacidad no acepta los términos')
  ok((await call(liveEnv, 'POST', '/api/panel-session')).status === 428, 'y con una sola aceptación el panel sigue cerrado')
  await call(liveEnv, 'POST', '/api/legal/accept', { body: { operation: o1, channel: 'panel-web:inicio-sesion', accept: [{ document: 'privacidad', version: P.version, sha256: P.sha256 }] } })
  ok(consentLog.length === 1, 'repetir la misma operación (doble clic) no duplica el registro')

  await call(liveEnv, 'POST', '/api/legal/accept', { body: { operation: op(), channel: 'panel-web:inicio-sesion', accept: [{ document: 'terminos', version: T.version, sha256: T.sha256 }] } })
  const rec = consentLog.at(-1)
  ok(rec.document === 'terminos' && rec.version === T.version && rec.sha256 === T.sha256 && rec.effective === TODAY && rec.channel === 'panel-web:inicio-sesion' && rec.action === 'acepta', 'cada aceptación queda con su documento, versión exacta, huella, vigencia, formulario y resultado')
  const sent = rpcCalls.filter((c) => c.name === 'gosen_record_consent').at(-1).body
  ok(Object.keys(sent).sort().join(',') === 'p_channel,p_items,p_operation,p_trace' && !JSON.stringify(sent).match(/password|user-agent|"ip"|card/i), 'al registro solo va lo necesario (sin contraseña, IP ni navegador): la cuenta la pone la base con el token')
  ok(!!(await bucket.head(`system/consent-anchors/${rec.recorded_at}_${rec.event_id}`)), 'cada registro deja un anclaje de su huella fuera de la base (sin datos personales)')

  st = await state()
  ok(st.ok === true, 'con las dos aceptaciones, el estado queda completo')
  const sess = await call(liveEnv, 'POST', '/api/panel-session')
  const session = await jsonOf(sess)
  ok(sess.status === 200 && session.token.startsWith('gps.'), 'y el servidor entrega la sesión del panel')
  const dl = await call(liveEnv, 'POST', '/api/download/1-Eres.zip', { token: session.token })
  ok(dl.status === 200 && (await jsonOf(dl)).files.length === 2, 'con esa sesión, el admin descarga')

  // Integrante: también puede aceptar (su cuenta), pero no ver evidencias ni descargar.
  ok((await call(liveEnv, 'GET', '/api/legal/evidence', { token: 'jwt-ana' })).status === 403, 'un integrante no puede ver las evidencias')
  ok((await call(liveEnv, 'GET', '/api/legal/evidence', { token: session.token })).status === 401, 'las evidencias se consultan con la sesión de Neon del admin')
  const ev = await jsonOf(await call(liveEnv, 'GET', '/api/legal/evidence?email=admin@iglesia.com'))
  ok(ev.rows.length === 2 && ev.rows.every((r) => r.subject_email === 'admin@iglesia.com' && r.event_id && r.recorded_at), 'el admin consulta quién aceptó qué y cuándo')
  const v = await jsonOf(await call(liveEnv, 'GET', '/api/legal/verify'))
  ok(v.ok === true && v.total === 2 && v.anchors === 2 && v.missingAnchors === 0, 'la verificación compara la cadena de la base con los anclajes')

  // Nueva versión publicada (cambia el texto: otra huella): hay que aceptarla de nuevo.
  const newer = { ...liveEnv, LEGAL_PREVIEW: JSON.stringify({ owner: { ...COMPLETE, address: 'Carrera 9 # 8-7' }, effective: TODAY }) }
  const st2 = await jsonOf(await call(newer, 'GET', '/api/legal/status'))
  ok(st2.ok === false && st2.documents.every((d) => d.accepted === false && d.last?.action === 'acepta'), 'si cambia el texto vigente, lo aceptado antes no cubre la versión nueva')
  ok((await call(newer, 'POST', '/api/download/1-Eres.zip', { token: session.token })).status === 428, 'y la sesión abierta con la versión anterior ya no permite descargar')

  // Retirar la autorización: tiene efecto en la sesión que ya estaba abierta.
  const rv = await call(liveEnv, 'POST', '/api/legal/revoke', { body: { operation: op(), document: 'privacidad' } })
  ok(rv.status === 200 && consentLog.at(-1).action === 'revoca' && consentLog.length === 3, 'retirar la autorización queda registrado (lo anterior no se borra)')
  ok((await call(liveEnv, 'POST', '/api/download/1-Eres.zip', { token: session.token })).status === 428, 'después de retirarla, la sesión del panel ya abierta no puede descargar')
  ok((await call(liveEnv, 'POST', '/api/panel-session')).status === 428, 'ni se entrega una sesión nueva hasta aceptar otra vez')

  sqlInstalled = false
  const miss = await jsonOf(await call(liveEnv, 'GET', '/api/legal/status'))
  ok(miss.ok === false && miss.code === 'sql-missing' && /legal-consentimientos\.sql/.test(miss.error), 'si falta el SQL en Neon, lo dice claro (no se finge una aceptación)')
  sqlInstalled = true
}

console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodas las comprobaciones pasaron')
process.exit(failures ? 1 : 0)
