/**
 * Pruebas del Worker multiiglesia (v37) con R2 y Neon simulados:
 *  - aislamiento: catálogo, canciones, archivos, portadas, letras, servicios, descargas y borrado solo
 *    dentro de la propia iglesia (la interna sigue con sus claves de siempre);
 *  - subidas en la carpeta de la iglesia y dentro de su cuota;
 *  - funciones por plan comprobadas en el servidor (letras, ensayo múltiple, asignación, logo, historial);
 *  - suscripción vencida: sin funciones de la nube, sin borrar nada;
 *  - sesión del panel con 2FA (si la activó) y que se invalida cuando Superadmin cambia la iglesia;
 *  - panel de la iglesia (invitaciones, logo) y de Superadmin (sesión de 2FA, uso, comprobantes, respaldo);
 *  - registro de acciones de contenido y límite de intentos.
 *
 * Uso: node --import ./test/register.mjs test/churches.test.mjs
 */
import worker from '../src/index.js'
import { Limiter } from '../src/limiter.js'
import { FakeBucket, audio, makeZip } from './fakes.mjs'

let failures = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`)
  if (!cond) failures++
}

const ALFA = 'iglesia-alfa-1a2b3'
const BETA = 'iglesia-beta-4c5d6'
const CETA = 'iglesia-ceta-7e8f9'
const INICIAL = ['reproductor', 'biblioteca', 'click_guia', 'mezclador', 'repertorios', 'ensayo_individual', 'programacion_basica']
const EQUIPO = [...INICIAL, 'ensayo_multiple', 'programacion_completa', 'asignacion_integrantes', 'exportar_excel', 'letras_acordes', 'letras_secciones', 'transposicion_acordes', 'letras_sincronizadas', 'personalizacion']
const ALL = [...EQUIPO, 'holyrics', 'admin_avanzado', 'config_avanzada', 'soporte_prioritario']
const acc = (email, admin, church, plan, features, storage, state = 'activa') => ({
  allowed: true,
  admin,
  email,
  church: { id: church, name: church, internal: church === 'gosen' },
  plan: { id: plan, name: plan },
  subscription: { state },
  features,
  limits: { members: 10, storage_bytes: storage },
  members: 3
})
const ACCOUNTS = {
  'jwt-gosen': acc('pastor@gosen.co', true, 'gosen', 'interno', ALL, null, 'interna'),
  'jwt-alfa': acc('admin@alfa.co', true, ALFA, 'inicial', INICIAL, 200000),
  'jwt-alfa-m': acc('ana@alfa.co', false, ALFA, 'inicial', INICIAL, 200000),
  'jwt-beta': acc('admin@beta.co', true, BETA, 'equipo', EQUIPO, 50 * 1024 * 1024),
  'jwt-beta-m': acc('luis@beta.co', false, BETA, 'equipo', EQUIPO, 50 * 1024 * 1024),
  'jwt-ceta': acc('admin@ceta.co', true, CETA, 'premium', [], 50 * 1024 * 1024, 'vencida'),
  'jwt-sa': { allowed: false, admin: false, email: 'super@gosen.co', superadmin: true }
}
const rpcLog = []
const twofaOn = new Set(['admin@beta.co'])
globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  const jwt = String(init.headers?.authorization || '').replace(/^Bearer /, '')
  const me = ACCOUNTS[jwt]
  const name = u.split('/rpc/')[1]
  const b = init.body ? JSON.parse(init.body) : {}
  if (name) rpcLog.push({ name, jwt, body: b })
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status })
  if (name === 'gosen_my_access') return reply(me ?? { allowed: false })
  if (!me) return reply({ message: 'JWT inválido' }, 401)
  const saOk = b.p_sa === 'sa-ok' && me.superadmin
  const needSa = () => reply({ message: 'GOSEN_SA_SESSION: tu sesión de Superadmin venció.' }, 400)
  switch (name) {
    case 'gosen_2fa_status':
      return reply({ enabled: twofaOn.has(me.email) || !!me.superadmin, required: !!me.superadmin })
    case 'gosen_2fa_verify':
      return reply({ ok: b.p_code === '123456', result: b.p_code === '123456' ? 'ok' : 'incorrecto' })
    case 'gosen_create_invitation':
      return me.admin ? reply([{ id: '11111111-2222-4333-8444-555555555555', code: 'GSN-AB12-CD34-EF56', expires_at: '2026-12-01T00:00:00Z' }]) : reply({ message: 'Solo el administrador puede invitar.' }, 400)
    case 'gosen_list_invitations':
      return reply([])
    case 'gosen_update_my_church':
      return reply({ id: me.church.id, name: me.church.name, logo: b.p_patch.logo ? new Date().toISOString() : null })
    case 'gosen_church_audit':
      return reply([{ at: '2026-11-18T10:00:00Z', actor_email: me.email, actor_role: 'admin', action: 'integrante.rol', target: 'x', details: null }])
    case 'gosen_sa_login':
      return reply(me.superadmin && b.p_code === '654321' ? { ok: true, token: 'sa-ok', expires_at: '2026-11-19T00:00:00Z' } : { ok: false, error: 'Código incorrecto.', code: 'bad-code' })
    case 'gosen_sa_ping':
      return saOk ? reply(true) : needSa()
    case 'gosen_sa_overview':
      return saOk
        ? reply({ churches: [{ id: 'gosen', name: 'Gosen', internal: true }, { id: ALFA, name: 'Alfa' }, { id: BETA, name: 'Beta' }], plans: [], settings: {}, commercial: { used: 2, max: 3 } })
        : needSa()
    case 'gosen_sa_update_church':
      return saOk ? reply(null) : needSa()
    case 'gosen_plans_public':
      return reply({
        plans: [
          { id: 'inicial', name: 'Gosen Inicial', price_month: 45000, price_year: 450000, max_members: 10, storage_gb: 50, features: INICIAL, notas_internas: 'no publicar' },
          { id: 'equipo', name: 'Gosen Equipo', price_month: 69900, price_year: null, max_members: 25, storage_gb: 150, features: EQUIPO }
        ],
        features: [{ id: 'reproductor', label: 'Reproductor multitrack' }],
        contact: { whatsapp: '+57 300 123 4567', email: 'ventas@gosen.co', secreto: 'x' }
      })
    case 'gosen_sa_export':
      return saOk ? reply({ exported_at: new Date().toISOString(), churches: [{ id: ALFA }] }) : needSa()
    case 'gosen_sa_audit':
      return saOk ? reply([{ at: '2026-11-18T09:00:00Z', actor_email: 'super@gosen.co', actor_role: 'superadmin', church_id: ALFA, action: 'iglesia.creada', target: 'Alfa' }]) : needSa()
    default:
      return reply({ ok: true })
  }
}

const bucket = new FakeBucket()
const roomNames = []
const env = {
  TRACKS: bucket,
  AUTH_URL: 'https://a.neonauth.test/neondb/auth',
  DATA_API_URL: 'https://a.apirest.test/neondb/rest/v1',
  MAX_TOTAL_BYTES: '0',
  MAX_FILE_BYTES: '2147483648',
  REHEARSAL: { idFromName: (n) => (roomNames.push(n), n), get: () => ({ fetch: async () => new Response('sala') }) },
  LIMITER: (() => {
    const rooms = new Map()
    return { idFromName: (n) => n, get: (id) => ({ fetch: async (_u, init) => (rooms.get(id) ?? rooms.set(id, new Limiter({})).get(id)).fetch(new Request('https://x', init)) }) }
  })()
}
const call = async (method, path, { token = 'jwt-alfa', body, headers = {} } = {}) =>
  worker.fetch(
    new Request(`https://gosen.test${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body)
    }),
    env
  )
const jsonOf = (r) => r.json().catch(() => ({}))
const enc = encodeURIComponent

// Canciones: la de Gosen en la raíz (como hoy), las de Alfa y Beta en su carpeta.
const zip = (n) => makeZip([{ name: `${n}/tracks/Bat.wav`, data: audio(3) }, { name: `${n}/tracks/Bajo.wav`, data: audio(5) }])
await bucket.put('1-Eres.zip', zip('Eres'), { customMetadata: { name: 'Eres.zip' } })
await bucket.put(`c/${ALFA}/2-Alfa.zip`, zip('Alfa'), { customMetadata: { name: 'Alfa.zip' } })
await bucket.put(`c/${BETA}/3-Beta.zip`, zip('Beta'), { customMetadata: { name: 'Beta.zip' } })
await bucket.put(`covers/c/${ALFA}/2-Alfa.zip`, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/png' } })
await bucket.put(`tracks/c/${BETA}/3-Beta.zip/nueva.wav`, audio(4))
await bucket.put(`metadata/c/${BETA}/3-Beta.zip`, JSON.stringify({ title: 'Beta', chart: { text: 'Verso\nG D\nLetra' } }), { customMetadata: { data: JSON.stringify({ title: 'Beta' }) } })
const svc = (id, name) => JSON.stringify({ id, name, date: '2026-12-01', members: [], items: [], updatedAt: '2026-11-18T00:00:00.000Z' })
await bucket.put('services/aaaaaaaa-0000-4000-8000-000000000001.json', svc('aaaaaaaa-0000-4000-8000-000000000001', 'Servicio Gosen'))
await bucket.put(`c/${ALFA}/services/bbbbbbbb-0000-4000-8000-000000000002.json`, svc('bbbbbbbb-0000-4000-8000-000000000002', 'Servicio Alfa'))

console.log('Aislamiento entre iglesias')
{
  const keys = async (token) => (await jsonOf(await call('GET', '/api/tracks', { token }))).map((s) => s.key)
  const g = await keys('jwt-gosen')
  const a = await keys('jwt-alfa')
  const b = await keys('jwt-beta')
  ok(g.join() === '1-Eres.zip' && a.join() === `c/${ALFA}/2-Alfa.zip` && b.join() === `c/${BETA}/3-Beta.zip`, 'cada iglesia ve solo sus canciones (Gosen sigue con las suyas en el mismo lugar)')
  const beta = (await jsonOf(await call('GET', '/api/tracks', { token: 'jwt-beta' })))[0]
  ok(beta.size > 0 && beta.title === 'Beta', 'el tamaño y la ficha de cada canción se calculan dentro de su iglesia')
  for (const [path, label] of [
    [`/api/song/${enc('1-Eres.zip')}`, 'la ficha'],
    [`/api/file/${enc('1-Eres.zip')}`, 'el ZIP'],
    [`/api/file/${enc(`tracks/c/${BETA}/3-Beta.zip/nueva.wav`)}`, 'una pista suelta de otra iglesia'],
    [`/api/cover/${enc(`c/${BETA}/3-Beta.zip`)}`, 'la portada'],
    [`/api/chart/${enc(`c/${BETA}/3-Beta.zip`)}`, 'la letra']
  ]) {
    ok((await call('GET', path, { token: 'jwt-alfa' })).status === 404, `Alfa no puede leer ${label} de otra iglesia (como si no existiera)`)
  }
  ok((await call('GET', `/api/file/${enc(`c/${ALFA}/2-Alfa.zip`)}`, { token: 'jwt-gosen' })).status === 404, 'ni Gosen las de Alfa')
  ok((await call('GET', `/api/file/${enc(`c/${ALFA}/2-Alfa.zip`)}`, { token: 'jwt-alfa-m' })).status === 200, 'pero un integrante de Alfa sí baja las de Alfa')
  ok((await call('DELETE', `/api/file/${enc(`c/${ALFA}/2-Alfa.zip`)}`, { token: 'jwt-beta' })).status === 404 && !!(await bucket.head(`c/${ALFA}/2-Alfa.zip`)), 'Beta no puede borrar canciones de Alfa')
  ok((await call('PUT', `/api/metadata/${enc('1-Eres.zip')}`, { token: 'jwt-beta', body: { title: 'Hackeado' } })).status === 404, 'ni cambiar fichas de Gosen')
  ok((await call('POST', `/api/download/${enc(`c/${ALFA}/2-Alfa.zip`)}`, { token: 'jwt-beta' })).status === 404, 'ni pedir enlaces de descarga de otra iglesia')
  ok((await call('GET', '/api/file/system%2Fpanel-session-key', { token: 'jwt-gosen' })).status === 404, 'las claves del sistema no se sirven a nadie')
  const sg = (await jsonOf(await call('GET', '/api/services', { token: 'jwt-gosen' }))).map((x) => x.name)
  const sa = (await jsonOf(await call('GET', '/api/services', { token: 'jwt-alfa' }))).map((x) => x.name)
  ok(sg.join() === 'Servicio Gosen' && sa.join() === 'Servicio Alfa', 'los servicios también van por iglesia')
}

console.log('\nSubidas y cuotas')
{
  const g = await jsonOf(await call('POST', '/api/upload/start?name=Nueva.zip&size=100', { token: 'jwt-gosen' }))
  ok(/^\d+-Nueva\.zip$/.test(g.key), `Gosen sube en la raíz, como siempre (${g.key})`)
  const a = await jsonOf(await call('POST', '/api/upload/start?name=Nueva.zip&size=100', { token: 'jwt-alfa' }))
  ok(a.key.startsWith(`c/${ALFA}/`), 'Alfa sube dentro de su carpeta')
  const big = await call('POST', '/api/upload/start?name=Grande.zip&size=500000', { token: 'jwt-alfa' })
  ok(big.status === 507 && (await jsonOf(big)).code === 'quota', 'si no cabe en la cuota de su plan, la subida no empieza (y lo explica)')
  const bad = await call('PUT', `/api/upload/part?key=${enc(`c/${BETA}/x.zip`)}&uploadId=x&n=1`, { token: 'jwt-alfa', body: new Uint8Array([1]) })
  ok(bad.status === 404, 'no se puede escribir en una subida de otra iglesia')
  const up = await jsonOf(await call('POST', '/api/upload/start?name=Llena.zip&size=150000', { token: 'jwt-alfa' }))
  await call('PUT', `/api/upload/part?key=${enc(up.key)}&uploadId=${up.uploadId}&n=1`, { token: 'jwt-alfa', body: new Uint8Array(199500) })
  const done = await call('POST', `/api/upload/done?key=${enc(up.key)}&uploadId=${up.uploadId}`, { token: 'jwt-alfa', body: { parts: [{ partNumber: 1, etag: 'x' }] } })
  ok(done.status === 507 && !(await bucket.head(up.key)), 'si al terminar se pasa de la cuota, lo recién subido se quita (no se cuela espacio de más)')
}

console.log('\nFunciones según el plan (en el servidor)')
{
  const own = enc(`c/${ALFA}/2-Alfa.zip`)
  const chart = await call('GET', `/api/chart/${own}`, { token: 'jwt-alfa' })
  const cj = await jsonOf(chart)
  ok(chart.status === 403 && cj.code === 'plan' && /no está incluido en el plan/.test(cj.error), 'Inicial: sin letras y acordes, con una explicación clara')
  ok((await call('GET', `/api/chart/${enc(`c/${BETA}/3-Beta.zip`)}`, { token: 'jwt-beta' })).status === 200, 'Equipo: la letra sí está')
  const room = await call('GET', '/api/ensayo?token=jwt-alfa', { token: null })
  ok(room.status === 403 && (await jsonOf(room)).code === 'plan', 'Inicial: sin ensayo múltiple')
  roomNames.length = 0
  await call('GET', '/api/ensayo?token=jwt-beta', { token: null })
  await call('GET', '/api/ensayo?token=jwt-gosen', { token: null })
  ok(roomNames.join() === `ensayo:${BETA},ensayo`, 'cada iglesia tiene su propia sala de ensayo (la de Gosen es la de siempre)')
  const svcBody = (members) => ({ name: 'Domingo', date: '2026-12-06', members, items: [], updatedAt: new Date().toISOString() })
  ok((await call('POST', '/api/services/cccccccc-0000-4000-8000-000000000003', { token: 'jwt-alfa', body: svcBody([]) })).status === 200, 'Inicial: crea servicios (programación básica)')
  ok((await call('POST', '/api/services/cccccccc-0000-4000-8000-000000000003', { token: 'jwt-alfa', body: svcBody([{ email: 'ana@alfa.co', role: 'cantantes' }]) })).status === 403, 'pero no asigna músicos y cantantes (es de Equipo)')
  ok(!!(await bucket.head(`c/${ALFA}/services/cccccccc-0000-4000-8000-000000000003.json`)), 'y el servicio quedó en la carpeta de Alfa')
  const logo = await call('PUT', '/api/church/logo', { token: 'jwt-alfa', body: new Uint8Array([137, 80, 78, 71]), headers: { 'content-type': 'image/png' } })
  ok(logo.status === 403 && (await jsonOf(logo)).feature === 'personalizacion', 'Inicial: sin logo propio')
  ok((await call('PUT', '/api/church/logo', { token: 'jwt-beta', body: new Uint8Array([137, 80, 78, 71]), headers: { 'content-type': 'image/png' } })).status === 200, 'Equipo: sube su logo')
  ok((await call('GET', '/api/church/logo', { token: 'jwt-beta-m' })).status === 200 && (await call('GET', '/api/church/logo', { token: 'jwt-alfa' })).status === 404, 'los integrantes de Beta ven su logo; Alfa no ve el de Beta')
  ok((await call('GET', '/api/church/audit', { token: 'jwt-beta' })).status === 403, 'el historial de acciones es de Premium')
  const exp = await call('GET', '/api/tracks', { token: 'jwt-ceta' })
  ok(exp.status === 403 && /no está al día/.test((await jsonOf(exp)).error), 'suscripción vencida: sin funciones de la nube, con el aviso para renovar')
}

console.log('\nPanel de la iglesia')
{
  const sum = await jsonOf(await call('GET', '/api/church', { token: 'jwt-alfa' }))
  ok(sum.church.id === ALFA && sum.usage.songs === 1 && sum.limits.storage_bytes === 200000, 'resumen: iglesia, plan, límites y espacio usado')
  const inv = await jsonOf(await call('POST', '/api/church/invitations', { token: 'jwt-alfa', body: { note: 'Ana', days: 7 } }))
  ok(inv.code === 'GSN-AB12-CD34-EF56' && inv.link === 'https://gosen.test/unirse#GSN-AB12-CD34-EF56' && inv.whatsapp.startsWith('https://wa.me/?text='), 'el admin genera la invitación: código, enlace (el código va después de «#») y mensaje para WhatsApp')
  ok((await call('POST', '/api/church/invitations', { token: 'jwt-alfa-m', body: {} })).status === 403, 'un integrante no puede invitar')
  const dl = await jsonOf(await call('POST', `/api/download/${enc(`c/${ALFA}/2-Alfa.zip`)}`, { token: 'jwt-alfa' }))
  ok(dl.files?.length === 1 && dl.files[0].name === 'Alfa.zip', 'el admin de Alfa descarga lo de Alfa (enlace firmado)')
  const panel = await jsonOf(await call('POST', '/api/panel-session', { token: 'jwt-alfa' }))
  ok((await call('POST', '/api/church/invitations', { token: panel.token, body: {} })).status === 401, 'las invitaciones se piden con la sesión de la cuenta (no con la del panel)')
}

console.log('\nSesión del panel: 2FA e invalidación')
{
  const no = await call('POST', '/api/panel-session', { token: 'jwt-beta' })
  ok(no.status === 401 && (await jsonOf(no)).code === '2fa-required', 'si el admin activó la 2FA, el panel pide el código')
  ok((await jsonOf(await call('POST', '/api/panel-session', { token: 'jwt-beta', headers: { 'x-gosen-totp': '000000' } }))).code === '2fa-bad', 'un código malo no abre el panel')
  const s = await jsonOf(await call('POST', '/api/panel-session', { token: 'jwt-beta', headers: { 'x-gosen-totp': '123456' } }))
  ok(s.token?.startsWith('gps.'), 'con el código correcto se abre')
  const viaPanel = (await jsonOf(await call('GET', '/api/tracks', { token: s.token }))).map((x) => x.key)
  ok(viaPanel.join() === `c/${BETA}/3-Beta.zip`, 'la sesión del panel conoce su iglesia y solo ve lo de Beta')
  ok((await call('GET', `/api/file/${enc(`c/${ALFA}/2-Alfa.zip`)}`, { token: s.token })).status === 404, 'y no llega a lo de Alfa')
  // Superadmin cambia la iglesia: la sesión abierta del panel deja de valer.
  const sa = await jsonOf(await call('POST', '/api/sa/login', { token: 'jwt-sa', body: { code: '654321' } }))
  await new Promise((r) => setTimeout(r, 5))
  ok((await call('PATCH', `/api/sa/churches/${BETA}`, { token: 'jwt-sa', body: { plan_id: 'inicial' }, headers: { 'x-gosen-sa': sa.token } })).status === 200, 'Superadmin cambia el plan de Beta')
  ok((await call('GET', '/api/tracks', { token: s.token })).status === 401, 'y la sesión del panel abierta antes ya no sirve (hay que entrar con el plan nuevo)')
}

console.log('\nSuperadmin')
{
  ok((await call('GET', '/api/sa/overview', { token: 'jwt-sa' })).status === 401, 'sin el código de 2FA no hay panel de Superadmin')
  ok((await jsonOf(await call('POST', '/api/sa/login', { token: 'jwt-sa', body: { code: '000000' } }))).ok === false, 'un código malo no abre la sesión')
  ok((await jsonOf(await call('POST', '/api/sa/login', { token: 'jwt-alfa', body: { code: '654321' } }))).ok === false, 'un admin de iglesia no es Superadmin')
  const sa = (await jsonOf(await call('POST', '/api/sa/login', { token: 'jwt-sa', body: { code: '654321' } }))).token
  const H = { 'x-gosen-sa': sa }
  const ov = await jsonOf(await call('GET', '/api/sa/overview', { token: 'jwt-sa', headers: H }))
  ok(ov.churches.find((c) => c.id === ALFA).usage.songs === 1 && ov.churches.find((c) => c.id === 'gosen').usage.songs >= 1, 've todas las iglesias con su espacio usado')
  const sto = await jsonOf(await call('GET', `/api/sa/churches/${BETA}/storage`, { token: 'jwt-sa', headers: H }))
  ok(sto.top.length === 1 && !('key' in sto.top[0]), 've qué ocupa espacio (nombres y tamaños), sin las claves para descargar')
  ok((await call('GET', `/api/file/${enc(`c/${BETA}/3-Beta.zip`)}`, { token: 'jwt-sa' })).status === 401, 'Superadmin no puede descargar las canciones de las iglesias')
  const pdf = new TextEncoder().encode('%PDF-1.4 comprobante')
  const rec = await jsonOf(await call('POST', `/api/sa/receipt?church=${ALFA}`, { token: 'jwt-sa', headers: { ...H, 'content-type': 'application/pdf' }, body: pdf }))
  ok(/^system\/receipts\/iglesia-alfa-1a2b3\/[0-9a-f-]{36}\.pdf$/.test(rec.key), 'sube el comprobante de un pago (privado, en la carpeta del sistema)')
  const got = await call('GET', `/api/sa/receipt?key=${enc(rec.key)}`, { token: 'jwt-sa', headers: H })
  ok(got.status === 200 && (await got.text()).startsWith('%PDF'), 'y lo vuelve a ver')
  ok((await call('GET', `/api/sa/receipt?key=${enc(rec.key)}`, { token: 'jwt-sa' })).status === 401, 'sin la sesión de 2FA, no')
  ok((await call('GET', `/api/file/${enc(rec.key)}`, { token: 'jwt-alfa' })).status === 404, 'ni una iglesia puede leer comprobantes por otra ruta')
  const bk = await call('POST', '/api/sa/backup', { token: 'jwt-sa', headers: H })
  ok(bk.status === 200 && /attachment/.test(bk.headers.get('content-disposition')) && !!(await bucket.head(bk.headers.get('x-gosen-backup'))), 'el respaldo se descarga y queda una copia privada en la nube')
  const audit = await jsonOf(await call('GET', `/api/sa/audit?church=${ALFA}`, { token: 'jwt-sa', headers: H }))
  ok(audit.some((a) => a.action === 'iglesia.creada') && audit.some((a) => a.action === 'cancion.subida' || a.action === 'cancion.descargada'), 'el registro junta las acciones de cuentas (Neon) y de contenido (subidas, descargas…)')
}

console.log('\nPlanes y precios en la página principal (/api/plans, sin cuenta)')
{
  await bucket.delete('system/public-plans.json')
  const r0 = await call('GET', '/api/plans', { token: null })
  const d0 = await jsonOf(r0)
  ok(
    r0.status === 200 && d0.plans.map((p) => `${p.name}:${p.price_month}:${p.max_members}:${p.storage_gb}`).join('|') === 'Gosen Inicial:39900:10:50|Gosen Equipo:69900:25:150|Gosen Premium:119900:25:300',
    'sin cuenta y antes de que Superadmin abra el panel: los planes iniciales (Inicial $39.900 · Equipo $69.900 · Premium $119.900)'
  )
  ok(d0.plans[2].features.includes('holyrics') && !d0.plans[0].features.includes('letras_acordes') && d0.features.length === 20, 'con lo que incluye cada uno (20 funciones con nombre)')
  ok(/max-age=300/.test(r0.headers.get('cache-control') || ''), 'se guarda en caché unos minutos (la página carga rápido)')
  const sa = (await jsonOf(await call('POST', '/api/sa/login', { token: 'jwt-sa', body: { code: '654321' } }))).token
  await call('GET', '/api/sa/overview', { token: 'jwt-sa', headers: { 'x-gosen-sa': sa } })
  const d1 = await jsonOf(await call('GET', '/api/plans', { token: null }))
  ok(d1.plans.length === 2 && d1.plans[0].price_month === 45000 && d1.plans[0].price_year === 450000, 'al abrir Superadmin, la página muestra los precios que dice la base (Inicial a $45.000, $450.000 al año)')
  ok(!JSON.stringify(d1).includes('no publicar') && !('secreto' in d1.contact) && d1.contact.whatsapp === '+57 300 123 4567', 'solo se publica lo de los planes y el contacto comercial (nada interno)')
  ok(!rpcLog.some((x) => x.name === 'gosen_plans_public' && !x.jwt), 'la página pública nunca consulta la base: usa la copia que guardó Superadmin')
}

console.log('\nPáginas y límite de intentos')
{
  const join = await call('GET', '/unirse', { token: null })
  ok(join.status === 200 && join.headers.get('referrer-policy') === 'no-referrer' && (await join.text()).includes('location.hash'), '/unirse muestra el código del enlace sin que llegue al servidor')
  const sap = await call('GET', '/superadmin', { token: null })
  ok(sap.status === 200 && sap.headers.get('x-frame-options') === 'DENY', '/superadmin se sirve (y no se puede incrustar en otra página)')
  let last
  for (let k = 0; k < 11; k++) last = await call('POST', '/api/login', { token: null, body: { email: 'x@y.co', password: 'malamala' }, headers: { 'cf-connecting-ip': '203.0.113.9' } })
  ok(last.status === 429 && Number(last.headers.get('retry-after')) > 0, 'tras 10 intentos de entrar en un minuto desde la misma IP, responde «espera» (429)')
  const other = await call('POST', '/api/login', { token: null, body: { email: 'x@y.co', password: 'malamala' }, headers: { 'cf-connecting-ip': '198.51.100.7' } })
  ok(other.status !== 429, 'otra IP no queda bloqueada')
}

console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodas las comprobaciones pasaron')
process.exit(failures ? 1 : 0)
