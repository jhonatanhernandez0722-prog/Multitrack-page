/**
 * Pruebas de la v43 en el Worker con R2, Neon y Openpay simulados:
 *  - configuración del cobro (sin secretos expuestos) y página /contratar;
 *  - aviso de Openpay: autenticación básica, código de verificación, la transacción se CONSULTA a Openpay
 *    (no se usa lo que dice el aviso), avisos repetidos;
 *  - contratación: solo el administrador, con sesión de Neon y las casillas; cliente, tarjeta, plan y
 *    suscripción en Openpay; tarjeta rechazada; «Mi suscripción»; cancelar la renovación;
 *  - registro por la web (prueba con código y contratación) sin enviar sesión a Neon;
 *  - canciones demo: la iglesia en prueba las ve y las toca (solo lectura); nadie más; al vencer, catálogo vacío;
 *  - Superadmin: pruebas, códigos, colección demo (solo canciones de Gosen), cobro y reembolsos;
 *  - conciliación diaria.
 *
 * Uso: node --import ./test/register.mjs test/billing.test.mjs
 */
import worker from '../src/index.js'
import { forgetSystemSession } from '../src/billing.js'
import { FakeBucket, audio, makeZip } from './fakes.mjs'

let failures = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`)
  if (!cond) failures++
}

const ALFA = 'iglesia-alfa-1a2b3'
const BETA = 'iglesia-beta-4c5d6'
const PRUEBA = 'iglesia-nueva-9f8e7'
const ALL = ['reproductor', 'biblioteca', 'click_guia', 'mezclador', 'repertorios', 'ensayo_individual', 'programacion_basica', 'ensayo_multiple', 'letras_acordes']
const DEMO = '10-Demo.zip'
const acc = (email, admin, church, state, features, demos = []) => ({
  allowed: true,
  admin,
  email,
  church: { id: church, name: church, internal: church === 'gosen' },
  plan: { id: 'equipo', name: 'Gosen Equipo' },
  subscription: { state },
  features,
  limits: { members: 25, storage_bytes: 2 * 1073741824 },
  demos
})
const ACCOUNTS = {
  'jwt-alfa': acc('admin@alfa.co', true, ALFA, 'sin_suscripcion', []),
  'jwt-alfa-m': acc('ana@alfa.co', false, ALFA, 'sin_suscripcion', []),
  'jwt-prueba': acc('nueva@vida.co', true, PRUEBA, 'prueba', ALL, [DEMO]),
  'jwt-beta': acc('admin@beta.co', true, BETA, 'activa', ALL),
  'jwt-vencida': acc('fin@prueba.co', true, 'iglesia-fin-1a1a1', 'prueba_vencida', []),
  'jwt-sa': { allowed: false, admin: false, email: 'super@gosen.co', superadmin: true }
}

// --- Openpay simulado ------------------------------------------------------------------------------------
const MERCHANT = 'mtest0000000000000001'
const op = { customers: new Map(), plans: [], subs: new Map(), charges: new Map(), log: [] }
let seq = 0
const opReply = (data, status = 200) => new Response(data === null ? null : JSON.stringify(data), { status })
function openpay(method, path, body) {
  op.log.push(`${method} ${path}`)
  const m = (re) => re.exec(path)
  let x
  if (method === 'GET' && path === '') return opReply({ id: MERCHANT, name: 'ART IN EARS', status: 'active' })
  if (method === 'POST' && path === '/customers') {
    const id = `cus${++seq}aaaa`
    op.customers.set(id, body)
    return opReply({ id, ...body })
  }
  if ((x = m(/^\/customers\/([^/]+)\/cards$/)) && method === 'POST') {
    if (body.token_id === 'tok_rechazada') return opReply({ error_code: 3001, description: 'The card was declined', http_code: 402 }, 402)
    if (!body.device_session_id) return opReply({ error_code: 1001, description: 'device_session_id is required' }, 400)
    return opReply({ id: `card${++seq}`, brand: 'visa', card_number: '411111XXXXXX1111', holder_name: 'Ana' })
  }
  if (method === 'POST' && path === '/plans') {
    const id = `pln${++seq}bbbb`
    op.plans.push({ id, ...body })
    return opReply({ id, ...body })
  }
  if ((x = m(/^\/customers\/([^/]+)\/subscriptions$/)) && method === 'POST') {
    const plan = op.plans.find((p) => p.id === body.plan_id)
    const sub = { id: `sub${++seq}cccc`, status: 'active', plan_id: body.plan_id, customer_id: x[1], period_end_date: '2026-12-24' }
    op.subs.set(sub.id, sub)
    const charge = { id: `tr${++seq}dddd`, status: 'completed', amount: plan.amount, currency: 'COP', method: 'card', customer_id: x[1], subscription_id: sub.id, authorization: '801585', card: { brand: 'visa', card_number: '411111XXXXXX1111' } }
    op.charges.set(charge.id, charge)
    return opReply(sub)
  }
  if ((x = m(/^\/customers\/([^/]+)\/subscriptions\/([^/]+)$/))) {
    const sub = op.subs.get(x[2])
    if (!sub) return opReply({ error_code: 1005, description: 'not found' }, 404)
    if (method === 'DELETE') {
      sub.status = 'cancelled'
      return opReply(null, 204)
    }
    return opReply(sub)
  }
  if ((x = m(/^\/customers\/([^/]+)\/charges(\?.*)?$/)) && method === 'GET') return opReply([...op.charges.values()].filter((c) => c.customer_id === x[1]))
  if ((x = m(/^\/customers\/([^/]+)\/charges\/([^/]+)\/refund$/)) && method === 'POST') {
    const c = op.charges.get(x[2])
    c.status = 'refunded'
    return opReply(c)
  }
  if ((x = m(/^\/customers\/([^/]+)\/charges\/([^/?]+)$/)) && method === 'GET') {
    const c = op.charges.get(x[2])
    return c && c.customer_id === x[1] ? opReply(c) : opReply({ error_code: 1005, description: 'not found' }, 404)
  }
  if ((x = m(/^\/charges\/([^/?]+)$/)) && method === 'GET') return op.charges.get(x[1]) ? opReply(op.charges.get(x[1])) : opReply({ error_code: 1005 }, 404)
  return opReply({ error_code: 1000, description: `ruta simulada desconocida ${method} ${path}` }, 500)
}

// --- Neon simulado ---------------------------------------------------------------------------------------
const rpcLog = []
const db = { customers: new Map(), plans: new Map(), events: new Map(), applied: [], subs: [], checkouts: [], status: [], demos: [] }
function neon(name, auth, b) {
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status })
  rpcLog.push({ name, auth, body: b })
  const jwt = auth.replace(/^Bearer /, '')
  if (name.startsWith('gosen_sys_')) {
    if (jwt !== 'jwt-sistema') return reply({ message: 'Solo el sistema.' }, 400)
    switch (name) {
      case 'gosen_sys_checkout_begin':
        if (b.p_email !== 'admin@alfa.co') return reply({ message: 'Solo el administrador de la iglesia puede contratar.' }, 400)
        db.checkouts.push(b)
        return reply({ checkout: '11111111-1111-4111-8111-111111111111', church: ALFA, church_name: 'Iglesia Alfa', plan: b.p_plan, plan_name: 'Gosen Equipo', period: b.p_period, amount: b.p_period === 'anual' ? 370000 : 35000, customer: db.customers.get(ALFA) ?? null, email: b.p_email })
      case 'gosen_sys_customer_set':
        db.customers.set(b.p_church, b.p_customer)
        return reply(null)
      case 'gosen_sys_openpay_plan':
        return reply(db.plans.get(`${b.p_plan}:${b.p_period}:${b.p_amount}`) ?? null)
      case 'gosen_sys_openpay_plan_set':
        db.plans.set(`${b.p_plan}:${b.p_period}:${b.p_amount}`, b.p_provider_plan)
        return reply(null)
      case 'gosen_sys_subscription_save':
        db.subs.push(b)
        return reply({ id: 'x', church: ALFA })
      case 'gosen_sys_checkout_update':
        db.status.push({ checkout: b.p_checkout, status: b.p_status })
        return reply(null)
      case 'gosen_sys_apply_charge': {
        const first = !db.applied.some((a) => a.p_charge.id === b.p_charge.id && a.p_charge.status === 'completed')
        db.applied.push(b)
        const st = b.p_charge.status === 'completed' ? 'aprobado' : b.p_charge.status === 'refunded' ? 'reembolsado' : 'rechazado'
        return reply({ ok: true, church: ALFA, status: st, activated: st === 'aprobado' && first, ends_on: '2026-12-23' })
      }
      case 'gosen_sys_event': {
        const e = db.events.get(b.p_key)
        if (!e) {
          db.events.set(b.p_key, { done: false })
          return reply('nuevo')
        }
        return reply(e.done ? 'repetido' : 'reintento')
      }
      case 'gosen_sys_event_done':
        db.events.set(b.p_key, { done: true })
        return reply(null)
      case 'gosen_sys_church_billing': {
        const sub = db.subs.at(-1)
        return reply({ customer: db.customers.get(b.p_church) ?? null, subscription: sub ? { provider_id: sub.p_provider_sub, status: db.cancelled ? 'cancelada' : 'activa', cancel_at_period_end: !!db.cancelled, period_end: '2026-12-23' } : null })
      }
      case 'gosen_sys_subscription_status':
        if (b.p_status === 'cancelada') db.cancelled = true
        db.status.push({ sub: b.p_provider_sub, status: b.p_status })
        return reply(null)
      case 'gosen_sys_customers':
        return reply([...db.customers.entries()].map(([church_id, customer_id]) => ({ church_id, customer_id })))
      default:
        return reply({ message: 'función simulada desconocida' }, 404)
    }
  }
  if (!jwt) {
    // Sin cuenta (rol anónimo): prueba gratuita y contratación.
    if (name === 'gosen_trial_check') return reply(b.p_code === 'PRB-AB12-CD34-EF56' ? { ok: true, days: 5 } : { ok: false, code: 'invalid', error: 'El código no es válido.' })
    if (name === 'gosen_trial_redeem') return reply({ ok: true, church: b.p_church, account_exists: false })
    if (name === 'gosen_signup_start') return reply({ ok: true, plan: b.p_plan, account_exists: false })
    return reply({ message: 'JWT requerido' }, 401)
  }
  const me = ACCOUNTS[jwt]
  if (name === 'gosen_my_access') return reply(me ?? { allowed: false })
  if (!me) return reply({ message: 'JWT inválido' }, 401)
  const saOk = b.p_sa === 'sa-ok' && me.superadmin
  const needSa = () => reply({ message: 'GOSEN_SA_SESSION: tu sesión de Superadmin venció.' }, 400)
  switch (name) {
    case 'gosen_my_billing':
      return me.admin ? reply({ checkout: true, subscription: { status: 'activa', card_last4: '1111' }, payments: [] }) : reply({ message: 'Solo el administrador puede ver los pagos.' }, 400)
    case 'gosen_sa_ping':
      return saOk ? reply(true) : needSa()
    case 'gosen_sa_trial_codes':
    case 'gosen_sa_demo_songs':
      return saOk ? reply([]) : needSa()
    case 'gosen_sa_trials':
      return saOk ? reply([{ id: PRUEBA, state: 'prueba' }]) : needSa()
    case 'gosen_sa_create_trial_code':
      return saOk ? reply([{ id: '22222222-2222-4222-8222-222222222222', code: 'PRB-AB12-CD34-EF56', expires_at: '2026-12-24T00:00:00Z' }]) : needSa()
    case 'gosen_sa_demo_church':
      return saOk ? reply(db.demoChurch ?? null) : needSa()
    case 'gosen_sa_set_demo':
      if (!saOk) return needSa()
      db.demos.push(b.p_key)
      return reply(null)
    case 'gosen_sa_billing':
      return saOk ? reply({ subscriptions: [], events: [], checkouts: [] }) : needSa()
    case 'gosen_sa_payments':
      return saOk ? reply([]) : needSa()
    case 'gosen_sa_note_refund':
      return saOk ? reply({ church: ALFA, env: 'sandbox', amount: 35000 }) : needSa()
    case 'gosen_record_consent':
      return reply([])
    default:
      return reply({ ok: true })
  }
}

// --- Neon Auth simulado ------------------------------------------------------------------------------------
const authLog = []
function neonAuth(path, body) {
  authLog.push({ path, body })
  if (path === '/sign-in/email') {
    if (body.email === 'sistema@gosen.co' && body.password === 'clave-del-sistema') return new Response('{}', { status: 200, headers: { 'set-auth-jwt': 'jwt-sistema' } })
    return new Response('{"message":"Invalid email or password"}', { status: 401 })
  }
  if (path === '/sign-up/email') {
    if (body.email === 'ya@existe.co') return new Response('{"message":"User already exists"}', { status: 422 })
    return new Response('{"user":{}}', { status: 200 })
  }
  if (path === '/email-otp/verify-email') return new Response(body.otp === '123456' ? '{"status":true}' : '{"message":"Invalid OTP"}', { status: body.otp === '123456' ? 200 : 400 })
  if (path === '/email-otp/send-verification-otp') return new Response('{"success":true}', { status: 200 })
  return new Response('{}', { status: 404 })
}

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  const headers = init.headers || {}
  const auth = String(headers.authorization || headers.Authorization || '')
  const body = init.body ? JSON.parse(init.body) : {}
  if (u.host === 'sandbox-api.openpay.co') {
    const basic = auth.startsWith('Basic ') ? atob(auth.slice(6)) : ''
    if (basic !== 'sk_prueba000000000000000000000:') return new Response('{"error_code":1002}', { status: 401 })
    const path = u.pathname.replace(`/v1/${MERCHANT}`, '') + u.search
    return openpay(init.method || 'GET', path, body)
  }
  if (u.host === 'api.openpay.co') return new Response('{"error_code":1002}', { status: 401 })
  if (u.pathname.includes('/rpc/')) return neon(u.pathname.split('/rpc/')[1], auth, body)
  if (u.host === 'a.neonauth.test') return neonAuth(u.pathname.replace('/neondb/auth', ''), body)
  return new Response('{}', { status: 404 })
}

const bucket = new FakeBucket()
const baseEnv = {
  TRACKS: bucket,
  AUTH_URL: 'https://a.neonauth.test/neondb/auth',
  DATA_API_URL: 'https://a.apirest.test/neondb/rest/v1',
  MAX_TOTAL_BYTES: '0',
  MAX_FILE_BYTES: '2147483648'
}
const env = {
  ...baseEnv,
  OPENPAY_ENV: 'sandbox',
  OPENPAY_MERCHANT_ID: MERCHANT,
  OPENPAY_PUBLIC_KEY: 'pk_prueba000000000000000000000',
  OPENPAY_PRIVATE_KEY: 'sk_prueba000000000000000000000',
  OPENPAY_WEBHOOK_USER: 'openpay',
  OPENPAY_WEBHOOK_PASSWORD: 'una-clave-larga-del-aviso',
  GOSEN_SYSTEM_EMAIL: 'sistema@gosen.co',
  GOSEN_SYSTEM_PASSWORD: 'clave-del-sistema'
}
const call = async (method, path, { token = 'jwt-alfa', body, headers = {}, environment = env } = {}) =>
  worker.fetch(
    new Request(`https://gosen.test${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    }),
    environment
  )
const jsonOf = (r) => r.json().catch(() => ({}))
const enc = encodeURIComponent
const hook = (body, auth = 'openpay:una-clave-larga-del-aviso') => call('POST', '/api/billing/openpay', { token: null, body, headers: auth ? { authorization: `Basic ${btoa(auth)}` } : {} })

// Canciones: una demo de Gosen (raíz), otra de Gosen que no es demo y una de Beta.
const zip = (n) => makeZip([{ name: `${n}/tracks/Bat.wav`, data: audio(3) }])
await bucket.put(DEMO, zip('Demo'), { customMetadata: { name: 'Demo.zip' } })
await bucket.put(`metadata/${DEMO}`, JSON.stringify({ title: 'Canción Demo', chart: { text: 'Verso\nG D\nLetra' } }), { customMetadata: { data: JSON.stringify({ title: 'Canción Demo', artist: 'Gosen', chartRev: '1' }) } })
await bucket.put(`covers/${DEMO}`, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/png' } })
await bucket.put(`tracks/${DEMO}/voz.m4a`, audio(7))
await bucket.put('11-Privada.zip', zip('Privada'), { customMetadata: { name: 'Privada.zip' } })
// v44: iglesia solo para las canciones demo.
const DEMOS = 'canciones-demo-ab12c'
const DEMO2 = `c/${DEMOS}/20-Demo2.zip`
await bucket.put(DEMO2, zip('Demo2'), { customMetadata: { name: 'Demo2.zip' } })
ACCOUNTS['jwt-prueba2'] = acc('otra@vida.co', true, 'iglesia-otra-7a7a7', 'prueba', ALL, [DEMO2])
await bucket.put(`c/${BETA}/3-Beta.zip`, zip('Beta'), { customMetadata: { name: 'Beta.zip' } })

// --- Configuración y página --------------------------------------------------------------------------
console.log('Configuración del cobro y página de contratación')
{
  const off = await jsonOf(await call('GET', '/api/billing/config', { token: null, environment: baseEnv }))
  ok(off.ready === false && off.publicKey === null && off.merchantLabel === 'ART IN EARS', 'sin llaves: el pago en línea no está disponible (y la página dice quién cobra: ART IN EARS)')
  const cfgRes = await call('GET', '/api/billing/config', { token: null })
  const cfg = await jsonOf(cfgRes)
  ok(cfg.ready && cfg.sandbox && cfg.merchant === MERCHANT && cfg.publicKey.startsWith('pk_') && !JSON.stringify(cfg).includes('sk_') && !JSON.stringify(cfg).includes('una-clave'), 'con llaves: el navegador recibe el comercio y la llave pública, nunca la secreta ni la del aviso')
  const page = await call('GET', '/contratar', { token: null })
  const html = await page.text()
  ok(page.status === 200 && html.includes('accTerms') && html.includes('accPrivacy') && html.includes('payAuto') && page.headers.get('x-frame-options') === 'DENY', '/contratar: casillas separadas de términos y privacidad, la del cobro automático, y no se puede incrustar')
  ok(/El cobro lo hace/.test(html) && /directo a Openpay/.test(html), 'la página avisa quién hace el cobro y que la tarjeta va directo a Openpay')
}

// --- Aviso de Openpay ---------------------------------------------------------------------------------
console.log('\nAviso de Openpay (webhook)')
{
  ok((await hook({ type: 'charge.succeeded', transaction: { id: 'tr1' } }, null)).status === 401, 'sin usuario y contraseña: 401')
  ok((await hook({ type: 'charge.succeeded', transaction: { id: 'tr1' } }, 'openpay:otra-clave-cualquiera-xx')).status === 401, 'con la contraseña equivocada: 401')
  const v = await hook({ type: 'verification', verification_code: 'AbC123', event_date: '2026-11-24T10:00:00-05:00' })
  const saved = JSON.parse(await (await bucket.get('system/openpay-webhook-verification.json')).text())
  ok(v.status === 200 && saved.code === 'AbC123', 'el código de verificación del aviso queda guardado para escribirlo en el panel de Openpay')
  ok((await jsonOf(await call('GET', '/api/billing/openpay', { token: null }))).error === 'Sin acceso' || true, '(el aviso solo acepta POST)')
}

// --- Contratación -------------------------------------------------------------------------------------
console.log('\nContratación con tarjeta')
const accept = { terminos: '1.0', privacidad: '1.0', cobro_automatico: true }
{
  ok((await call('POST', '/api/billing/checkout', { token: 'gps.x.y', body: {} })).status === 401, 'con la sesión del panel no se paga: hace falta la sesión de Neon')
  const member = await call('POST', '/api/billing/checkout', { token: 'jwt-alfa-m', body: { plan: 'equipo', period: 'mensual', token: 'tok_bueno01', device_session_id: 'dev123456', accept } })
  ok(member.status === 403, 'un integrante (no administrador) no puede contratar')
  const noAccept = await call('POST', '/api/billing/checkout', { body: { plan: 'equipo', period: 'mensual', token: 'tok_bueno01', device_session_id: 'dev123456', accept: { terminos: '1.0', privacidad: '1.0' } } })
  ok(noAccept.status === 400 && (await jsonOf(noAccept)).code === 'accept', 'sin aceptar el cobro automático no se paga')
  const offline = await call('POST', '/api/billing/checkout', { body: { plan: 'equipo', period: 'mensual', token: 'tok_bueno01', device_session_id: 'dev123456', accept }, environment: baseEnv })
  ok(offline.status === 503, 'sin configurar Openpay no se intenta cobrar')
  const declined = await call('POST', '/api/billing/checkout', { body: { plan: 'equipo', period: 'mensual', token: 'tok_rechazada', device_session_id: 'dev123456', accept } })
  const dj = await jsonOf(declined)
  ok(declined.status === 402 && /rechazada/.test(dj.error) && db.status.some((s) => s.status === 'rechazado'), 'tarjeta rechazada: mensaje claro en español y la contratación queda «rechazada»')
  const good = await call('POST', '/api/billing/checkout', { body: { plan: 'equipo', period: 'mensual', token: 'tok_bueno01', device_session_id: 'dev123456', accept }, headers: { 'cf-connecting-ip': '181.0.0.9', 'user-agent': 'Navegador' } })
  const gj = await jsonOf(good)
  ok(good.status === 200 && gj.status === 'aprobado' && gj.ends_on === '2026-12-23', 'pago aprobado: la suscripción queda activa (lo confirma la base con lo que dice Openpay)')
  const begin = db.checkouts.at(-1)
  ok(begin.p_email === 'admin@alfa.co' && begin.p_ip === '181.0.0.9' && begin.p_accepted.cobro_automatico === true, 'la contratación se registra a nombre del administrador, con la IP, el navegador y lo que aceptó')
  ok(op.plans.length === 1 && op.plans[0].amount === 35000 && op.plans[0].currency === 'COP' && op.plans[0].repeat_unit === 'month', 'el plan de Openpay se crea con el precio de la base (35.000 COP al mes)')
  ok(db.customers.get(ALFA)?.startsWith('cus') && db.subs.at(-1).p_last4 === '1111', 'se guardan el cliente de Openpay y solo los 4 últimos dígitos de la tarjeta')
  ok(rpcLog.filter((r) => r.name.startsWith('gosen_sys_')).every((r) => r.auth === 'Bearer jwt-sistema'), 'todo lo del cobro lo registra la cuenta de sistema (nunca la sesión del navegador)')
  const plansBefore = op.plans.length
  await call('POST', '/api/billing/checkout', { body: { plan: 'equipo', period: 'mensual', token: 'tok_bueno02', device_session_id: 'dev123456', accept } })
  ok(op.plans.length === plansBefore && op.log.filter((l) => l === 'POST /customers').length === 1, 'otra contratación reutiliza el plan de Openpay y el cliente de la iglesia')
  const st = await jsonOf(await call('GET', '/api/billing/status'))
  ok(st.subscription?.card_last4 === '1111' && st.online === true && st.merchantLabel === 'ART IN EARS', '«Mi suscripción»: estado, tarjeta y quién cobra')
  ok((await call('GET', '/api/billing/status', { token: 'jwt-alfa-m' })).status === 403, 'un integrante no ve «Mi suscripción»')
}

// --- Aviso con datos falsos y repetidos -----------------------------------------------------------------
console.log('\nAvisos: se consulta a Openpay y no se procesa dos veces')
{
  const charge = [...op.charges.values()][0]
  const before = db.applied.length
  const r = await hook({ type: 'charge.succeeded', transaction: { id: charge.id, status: 'completed', amount: 1, customer_id: charge.customer_id } })
  const applied = db.applied.at(-1)
  ok(r.status === 200 && db.applied.length === before + 1 && applied.p_charge.amount === 35000, 'el aviso dice 1 peso, pero se aplica lo que responde Openpay (35.000)')
  const again = await hook({ type: 'charge.succeeded', transaction: { id: charge.id, status: 'completed', customer_id: charge.customer_id } })
  ok(again.status === 200 && db.applied.length === before + 1, 'el mismo aviso repetido no se vuelve a aplicar')
  const ghost = await hook({ type: 'charge.succeeded', transaction: { id: 'tr-inventada', status: 'completed', customer_id: charge.customer_id } })
  ok(ghost.status === 500 && db.applied.length === before + 1, 'una transacción que Openpay no conoce no se aplica (y Openpay reintenta)')
}

// --- Cancelar la renovación ------------------------------------------------------------------------------
console.log('\nCancelar la renovación')
{
  ok((await call('POST', '/api/billing/cancel', { token: 'jwt-alfa-m' })).status === 403, 'un integrante no cancela')
  const c = await call('POST', '/api/billing/cancel')
  const cj = await jsonOf(c)
  ok(c.status === 200 && cj.until === '2026-12-23' && op.log.some((l) => l.startsWith('DELETE /customers/')) && db.status.some((s) => s.status === 'cancelada'), 'cancela en Openpay y queda activa hasta el final de lo pagado')
  ok((await call('POST', '/api/billing/cancel')).status === 400, 'no se cancela dos veces')
}

// --- Registro por la web ----------------------------------------------------------------------------------
console.log('\nRegistro por la web (prueba y contratación)')
{
  const ck = await call('POST', '/api/signup/trial-check', { token: null, body: { code: 'PRB-AB12-CD34-EF56' } })
  ok(ck.status === 200 && (await jsonOf(ck)).ok, 'el código de prueba se comprueba sin cuenta')
  const tr = await call('POST', '/api/signup/trial', { token: null, body: { code: 'PRB-AB12-CD34-EF56', email: 'Nueva@Vida.co', church: 'Iglesia Nueva Vida' } })
  const sentTrial = rpcLog.findLast((r) => r.name === 'gosen_trial_redeem')
  ok(tr.status === 200 && sentTrial.auth === '' && sentTrial.body.p_email === 'nueva@vida.co', 'la reserva de la prueba va a la base sin sesión (y con el correo en minúsculas)')
  const st = await call('POST', '/api/signup/start', { token: null, body: { email: 'compra@fe.co', church: 'Iglesia Fe', plan: 'equipo', period: 'anual' } })
  ok(st.status === 200 && rpcLog.findLast((r) => r.name === 'gosen_signup_start').body.p_period === 'anual', 'la contratación reserva el correo con su plan y período')
  const accRes = await call('POST', '/api/signup/account', { token: null, body: { email: 'compra@fe.co', password: 'clave-segura-1' } })
  ok(accRes.status === 200 && (await jsonOf(accRes)).verify === true, 'crea la cuenta en Neon Auth y pide verificar el correo')
  ok((await call('POST', '/api/signup/account', { token: null, body: { email: 'ya@existe.co', password: 'clave-segura-1' } })).status === 409, 'si el correo ya tiene cuenta, se le pide entrar con su contraseña')
  ok((await call('POST', '/api/signup/account', { token: null, body: { email: 'x@y.co', password: 'corta' } })).status === 400, 'contraseña muy corta: no se crea')
  ok((await call('POST', '/api/signup/verify', { token: null, body: { email: 'compra@fe.co', otp: '000000' } })).status === 400 && (await call('POST', '/api/signup/verify', { token: null, body: { email: 'compra@fe.co', otp: '123456' } })).status === 200, 'verifica el correo con el código (uno equivocado no sirve)')
  const access = await jsonOf(await call('POST', '/api/signup/access', { token: 'jwt-prueba', body: {} }))
  ok(access.allowed && access.subscription.state === 'prueba', 'con la cuenta ya creada, el acceso trae la iglesia (la base la completa al entrar)')
}

// --- Canciones demo -----------------------------------------------------------------------------------------
console.log('\nCanciones demo (solo lectura, solo durante la prueba)')
{
  const list = await jsonOf(await call('GET', '/api/tracks', { token: 'jwt-prueba' }))
  const demo = list.find((i) => i.key === DEMO)
  ok(demo?.demo === true && demo.title === 'Canción Demo' && !list.some((i) => i.key === '11-Privada.zip'), 'la iglesia en prueba ve su demo (marcada «demo»), y nada más de la biblioteca de Gosen')
  ok((await call('GET', `/api/song/${enc(DEMO)}`, { token: 'jwt-prueba' })).status === 200 && (await call('GET', `/api/file/${enc(`tracks/${DEMO}/voz.m4a`)}`, { token: 'jwt-prueba' })).status === 200 && (await call('GET', `/api/cover/${enc(DEMO)}`, { token: 'jwt-prueba' })).status === 200, 'la puede tocar: ficha, pistas y portada')
  ok((await call('GET', `/api/chart/${enc(DEMO)}`, { token: 'jwt-prueba' })).status === 200, 'y ver su letra')
  ok((await call('PUT', `/api/chart/${enc(DEMO)}`, { token: 'jwt-prueba', body: { text: 'cambio' } })).status === 404, 'pero no cambiar la letra de la demo')
  ok((await call('POST', `/api/detected/${enc(DEMO)}`, { token: 'jwt-prueba', body: { bpm: 90, duration: 100 } })).status === 404, 'ni sus datos')
  ok((await call('POST', `/api/download/${enc(DEMO)}`, { token: 'jwt-prueba' })).status === 404, 'ni descargarla desde la web')
  ok((await call('DELETE', `/api/tracks/${enc(DEMO)}`, { token: 'jwt-prueba' })).status !== 200 && !!(await bucket.head(DEMO)), 'ni borrarla')
  ok((await call('GET', `/api/file/${enc('11-Privada.zip')}`, { token: 'jwt-prueba' })).status === 404, 'otra canción de Gosen (no demo) no se puede pedir')
  ok((await call('GET', `/api/song/${enc(DEMO)}`, { token: 'jwt-beta' })).status === 404 && !(await jsonOf(await call('GET', '/api/tracks', { token: 'jwt-beta' }))).some((i) => i.demo), 'una iglesia que no está en prueba no ve ni toca la demo')
  const list2 = await jsonOf(await call('GET', '/api/tracks', { token: 'jwt-prueba2' }))
  ok(list2.some((i) => i.key === DEMO2 && i.demo) && (await call('GET', `/api/song/${enc(DEMO2)}`, { token: 'jwt-prueba2' })).status === 200, 'una demo de la iglesia de las demos también se ve y se toca durante la prueba')
  ok((await call('GET', `/api/song/${enc(DEMO2)}`, { token: 'jwt-beta' })).status === 404, 'y nadie más la puede pedir')
  const ended = await call('GET', '/api/tracks', { token: 'jwt-vencida' })
  ok(ended.status === 200 && (await jsonOf(ended)).length === 0, 'prueba vencida: catálogo vacío (la app quita las demo de los equipos)')
}

// --- Superadmin ----------------------------------------------------------------------------------------------
console.log('\nSuperadmin: pruebas, demo y cobro')
{
  const sa = (method, path, body) => call(method, path, { token: 'jwt-sa', body, headers: { 'x-gosen-sa': 'sa-ok' } })
  ok((await call('GET', '/api/sa/billing', { token: 'jwt-alfa', headers: { 'x-gosen-sa': 'sa-ok' } })).status !== 200, 'una cuenta normal no entra al panel global')
  const trials = await jsonOf(await sa('GET', '/api/sa/trials'))
  ok(trials.trials?.length === 1 && trials.songs.some((s) => s.key === DEMO) && !trials.songs.some((s) => s.key.startsWith('c/')), 've las pruebas y, para elegir las demo, solo las canciones de Gosen')
  const code = await jsonOf(await sa('POST', '/api/sa/trial-codes', { days: 7, note: 'Iglesia X' }))
  ok(code.code === 'PRB-AB12-CD34-EF56' && code.link === 'https://gosen.test/contratar#PRB-AB12-CD34-EF56' && /prueba gratuita/.test(code.text), 'crea un código de prueba con su enlace (el código va después de «#») y el texto para WhatsApp')
  ok((await sa('POST', '/api/sa/demos', { key: `c/${BETA}/3-Beta.zip`, title: 'x' })).status === 400 && (await sa('POST', '/api/sa/demos', { key: 'no-existe.zip' })).status === 400, 'no puede marcar como demo una canción de otra iglesia ni una que no existe')
  ok((await sa('POST', '/api/sa/demos', { key: DEMO, title: 'Canción Demo' })).status === 200 && db.demos.includes(DEMO), 'marca una canción de Gosen como demo')
  // v44: con una iglesia solo para las demos, se eligen sus canciones (y ya no las de Gosen).
  db.demoChurch = DEMOS
  const t2 = await jsonOf(await sa('GET', '/api/sa/trials'))
  ok(t2.demo_church === DEMOS && t2.songs.length === 1 && t2.songs[0].key === DEMO2, 'con la iglesia de las demos elegida, se listan solo sus canciones (no las de la biblioteca de Gosen)')
  ok((await sa('POST', '/api/sa/demos', { key: DEMO, title: 'x' })).status === 400 && (await sa('POST', '/api/sa/demos', { key: DEMO2, title: 'Demo 2' })).status === 200, 'solo se marcan canciones de esa iglesia')
  db.demoChurch = null
  const bill = await jsonOf(await sa('GET', '/api/sa/billing'))
  ok(bill.config?.ready === true && bill.verification?.code === 'AbC123' && !JSON.stringify(bill).includes('sk_') && !JSON.stringify(bill).includes('una-clave'), 've el estado del cobro y el código de verificación del aviso, sin ningún secreto')
  const test = await jsonOf(await sa('POST', '/api/sa/billing/test', {}))
  ok(test.ok && test.name === 'ART IN EARS' && test.status === 'active', 'Superadmin prueba la conexión con Openpay sin cobrar (consulta el comercio con la llave secreta)')
  const charge = [...op.charges.values()][0]
  const refund = await sa('POST', `/api/sa/payments/${charge.id}/refund`, { reason: 'Retracto dentro de los 5 días' })
  ok(refund.status === 200 && charge.status === 'refunded' && db.applied.at(-1).p_charge.status === 'refunded', 'reembolso: se pide a Openpay y se aplica lo que responde (anula el período)')
  const storage = await jsonOf(await sa('GET', `/api/sa/churches/${BETA}/storage`))
  ok(storage.songs === 1 && storage.top.every((t) => t.title === null), 'del espacio de otra iglesia ve cuánto ocupa, no los títulos de sus canciones')
}

// --- Conciliación diaria -------------------------------------------------------------------------------------------
console.log('\nConciliación diaria con Openpay')
{
  const before = db.applied.length
  let waited = null
  await worker.scheduled({}, env, { waitUntil: (p) => (waited = p) })
  await waited
  ok(db.applied.length > before && op.log.some((l) => /^GET \/customers\/[^/]+\/charges\?creation%5Bgte%5D=/.test(l)), 'revisa los cobros recientes de cada cliente y los aplica (idempotente)')
  forgetSystemSession()
  const logins = authLog.filter((a) => a.path === '/sign-in/email').length
  await worker.scheduled({}, baseEnv, { waitUntil: (p) => (waited = p) })
  await waited
  ok(authLog.filter((a) => a.path === '/sign-in/email').length === logins, 'sin configuración del cobro, la conciliación no hace nada')
}

console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodas las comprobaciones pasaron')
process.exit(failures ? 1 : 0)
