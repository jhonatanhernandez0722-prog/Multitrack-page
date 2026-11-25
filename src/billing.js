/**
 * Cobro con Openpay (Colombia) — v43. Suscripción mensual o anual con renovación automática, con tarjeta.
 *
 *  - La tarjeta la escribe la persona en el formulario de Openpay.js, que la envía DIRECTO a Openpay y
 *    devuelve un token: Gosen nunca recibe ni guarda el número (solo la marca y los últimos 4 dígitos).
 *  - Nada se activa por una página de «pago exitoso» ni por lo que diga un aviso: cada transacción se
 *    CONSULTA a Openpay con la llave secreta y se aplica en la base (neon/v43-suscripciones.sql,
 *    gosen_sys_apply_charge), que no procesa dos veces la misma transacción.
 *  - Openpay no firma sus avisos (webhooks): solo admite autenticación básica. Por eso el aviso exige
 *    usuario y contraseña propios (comparados en tiempo constante) y, además, se consulta la transacción.
 *  - Lo registra la cuenta de sistema (correo GOSEN_SYSTEM_EMAIL, contraseña en un secreto): solo puede
 *    ejecutar las funciones de cobro. Nunca se usa la conexión de dueño de la base.
 *  - Una vez al día se concilia con Openpay (por si se perdió un aviso).
 *
 * Configuración (wrangler.toml [vars] y secretos `npx wrangler secret put …`):
 *   OPENPAY_ENV            'sandbox' (pruebas, por defecto) o 'production'
 *   OPENPAY_MERCHANT_ID    id de comercio del entorno
 *   OPENPAY_PUBLIC_KEY     llave pública (pk_…), la usa el navegador
 *   OPENPAY_PRIVATE_KEY    (secreto) llave secreta (sk_…)
 *   OPENPAY_WEBHOOK_USER / OPENPAY_WEBHOOK_PASSWORD   (secretos) para el aviso de Openpay
 *   GOSEN_SYSTEM_EMAIL     cuenta de sistema · GOSEN_SYSTEM_PASSWORD (secreto)
 *   OPENPAY_JS_BASE        (opcional) dónde están openpay.v1.min.js y openpay-data.v1.min.js
 *
 * Rutas:
 *   GET  /api/billing/config      → (público) si el pago está disponible y lo que necesita el navegador
 *   POST /api/billing/openpay     → (Openpay) avisos de transacciones
 *   POST /api/billing/checkout    → (administrador) contratar: {plan, period, token, device_session_id, accept}
 *   GET  /api/billing/status      → (administrador) «Mi suscripción»: estado, tarjeta y pagos
 *   POST /api/billing/cancel      → (administrador) cancelar la renovación automática
 * Superadmin (desde src/churches.js): estado del cobro, pagos, código de verificación del aviso, reembolsos.
 */
import { legalSummary, neonRpc } from './legal/legal.js'
import { OWNER } from './legal/owner.js'
import { churchOf } from './tenancy.js'

const API_BASE = { sandbox: 'https://sandbox-api.openpay.co/v1', production: 'https://api.openpay.co/v1' }
const JS_BASE = 'https://openpay.s3.amazonaws.com'
const VERIFY_KEY = 'system/openpay-webhook-verification.json'
const SQL_MISSING = 'Falta ejecutar neon/v43-suscripciones.sql en Neon (SQL Editor).'

/** Configuración del cobro y lo que falta para activarlo (nunca expone la llave secreta). */
export function billingConfig(env) {
  const mode = env.OPENPAY_ENV === 'production' ? 'production' : 'sandbox'
  const missing = []
  if (!/^[a-z0-9]{10,40}$/i.test(env.OPENPAY_MERCHANT_ID || '')) missing.push('OPENPAY_MERCHANT_ID')
  if (!/^pk_[A-Za-z0-9]{10,64}$/.test(env.OPENPAY_PUBLIC_KEY || '')) missing.push('OPENPAY_PUBLIC_KEY')
  if (!/^sk_[A-Za-z0-9]{10,64}$/.test(env.OPENPAY_PRIVATE_KEY || '')) missing.push('OPENPAY_PRIVATE_KEY')
  if (!env.OPENPAY_WEBHOOK_USER || String(env.OPENPAY_WEBHOOK_PASSWORD || '').length < 16) missing.push('OPENPAY_WEBHOOK_USER / OPENPAY_WEBHOOK_PASSWORD (16+ caracteres)')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env.GOSEN_SYSTEM_EMAIL || '') || !env.GOSEN_SYSTEM_PASSWORD) missing.push('GOSEN_SYSTEM_EMAIL / GOSEN_SYSTEM_PASSWORD')
  return {
    mode,
    ready: missing.length === 0,
    missing,
    merchant: env.OPENPAY_MERCHANT_ID || null,
    publicKey: env.OPENPAY_PUBLIC_KEY || null,
    jsBase: String(env.OPENPAY_JS_BASE || JS_BASE).replace(/\/+$/, ''),
    /** Nombre con el que el cobro aparece en el extracto (titular de la cuenta de Openpay). */
    merchantLabel: OWNER.paymentMerchant || null
  }
}

// --- Openpay ------------------------------------------------------------------------------------------

export class OpenpayError extends Error {
  constructor(message, code = null, status = 0) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** Mensaje claro para la persona según el código de error de Openpay (los demás, su descripción). */
const CARD_MESSAGES = {
  2004: 'El número de la tarjeta no es válido.',
  2005: 'La fecha de vencimiento de la tarjeta ya pasó.',
  2006: 'Falta el código de seguridad de la tarjeta.',
  3001: 'La tarjeta fue rechazada. Prueba con otra o comunícate con tu banco.',
  3002: 'La tarjeta está vencida.',
  3003: 'La tarjeta no tiene fondos suficientes.',
  3004: 'La tarjeta fue rechazada. Prueba con otra o comunícate con tu banco.',
  3005: 'El pago fue rechazado por el sistema antifraude. Prueba con otra tarjeta o comunícate con tu banco.',
  3006: 'Esta operación no está permitida con esta tarjeta.',
  3009: 'La tarjeta fue rechazada. Prueba con otra o comunícate con tu banco.',
  3010: 'La tarjeta fue rechazada. Prueba con otra o comunícate con tu banco.',
  3011: 'La tarjeta fue rechazada. Prueba con otra o comunícate con tu banco.',
  3012: 'Tu banco pide autorizar este pago. Comunícate con él e intenta de nuevo.'
}

async function op(env, method, path, body) {
  const cfg = billingConfig(env)
  let r
  try {
    r = await fetch(`${API_BASE[cfg.mode]}/${env.OPENPAY_MERCHANT_ID}${path}`, {
      method,
      headers: { authorization: `Basic ${btoa(`${env.OPENPAY_PRIVATE_KEY}:`)}`, 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch {
    throw new OpenpayError('No se pudo contactar a Openpay. Intenta de nuevo en un momento.', 'network', 0)
  }
  const text = await r.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!r.ok) {
    const code = data?.error_code ?? null
    throw new OpenpayError(CARD_MESSAGES[code] || (data?.description ? `Openpay: ${String(data.description).slice(0, 200)}` : `Openpay respondió ${r.status}.`), code, r.status)
  }
  return data
}

/** Transacción tal como la tiene Openpay (la única fuente que se usa para activar o anular). */
async function fetchCharge(env, id, customer) {
  const tx = encodeURIComponent(id)
  const c = customer ? await op(env, 'GET', `/customers/${encodeURIComponent(customer)}/charges/${tx}`) : await op(env, 'GET', `/charges/${tx}`)
  return customer && c && !c.customer_id ? { ...c, customer_id: customer } : c
}

// --- Cuenta de sistema (registra lo de Openpay en la base) ---------------------------------------------

let sysSession = null

function jwtExp(jwt) {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0
  } catch {
    return 0
  }
}

async function systemJwt(env) {
  if (sysSession && sysSession.exp - Date.now() > 60_000) return sysSession.jwt
  const origin = new URL(env.AUTH_URL).origin
  const r = await fetch(`${env.AUTH_URL}/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email: String(env.GOSEN_SYSTEM_EMAIL).trim().toLowerCase(), password: env.GOSEN_SYSTEM_PASSWORD })
  })
  if (!r.ok) throw new Error(`La cuenta de sistema no pudo iniciar sesión (${r.status}).`)
  const cookies = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  let jwt = r.headers.get('set-auth-jwt')
  if (!jwt) {
    const t = await fetch(`${env.AUTH_URL}/token`, { headers: { cookie: cookies, origin } })
    jwt = t.ok ? (await t.json()).token || null : null
  }
  if (!jwt) throw new Error('La cuenta de sistema no obtuvo su token.')
  sysSession = { jwt, exp: jwtExp(jwt) || Date.now() + 5 * 60_000 }
  return jwt
}

/** Función de cobro en la base, con la cuenta de sistema (una vez más si el token venció). */
async function sys(env, fn, args = {}) {
  let r = await neonRpc(env, await systemJwt(env), fn, args)
  if (r.status === 401) {
    sysSession = null
    r = await neonRpc(env, await systemJwt(env), fn, args)
  }
  return r
}

/** Para las pruebas: olvida la sesión de la cuenta de sistema. */
export const forgetSystemSession = () => {
  sysSession = null
}

function sysError(json, r) {
  if (r.missing) return json({ error: SQL_MISSING, code: 'sql-missing' }, 503)
  return json({ error: r.error || 'No se pudo completar.' }, r.status === 401 ? 401 : 400)
}

// --- Avisos de Openpay ----------------------------------------------------------------------------------

function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a))
  const y = new TextEncoder().encode(String(b))
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

function webhookAuthorized(req, env) {
  const h = req.headers.get('authorization') || ''
  if (!h.startsWith('Basic ')) return false
  let decoded
  try {
    decoded = atob(h.slice(6).trim())
  } catch {
    return false
  }
  return safeEqual(decoded, `${env.OPENPAY_WEBHOOK_USER}:${env.OPENPAY_WEBHOOK_PASSWORD}`)
}

async function webhook(req, env) {
  const text = (status, body = '') => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  const cfg = billingConfig(env)
  if (!cfg.ready) return text(503, 'El cobro no está configurado.')
  if (!webhookAuthorized(req, env)) return new Response('No autorizado', { status: 401, headers: { 'www-authenticate': 'Basic realm="openpay"' } })
  const raw = await req.text()
  if (raw.length > 200_000) return text(413)
  let ev
  try {
    ev = JSON.parse(raw)
  } catch {
    return text(400)
  }
  // Al configurar el aviso, Openpay manda un código que se escribe en su panel para activarlo.
  if (ev?.type === 'verification' && typeof ev.verification_code === 'string') {
    await env.TRACKS.put(VERIFY_KEY, JSON.stringify({ code: ev.verification_code.slice(0, 64), at: new Date().toISOString(), env: cfg.mode }), {
      httpMetadata: { contentType: 'application/json' }
    })
    return text(200, 'ok')
  }
  const tx = ev?.transaction
  const id = typeof tx?.id === 'string' && /^[A-Za-z0-9_-]{3,60}$/.test(tx.id) ? tx.id : null
  if (!id) return text(200, 'ok') // sin transacción propia (p. ej. pagos a terceros): nada que hacer
  const type = String(ev.type || 'desconocido').slice(0, 60)
  const key = `${type}:${id}:${String(tx.status || '').slice(0, 30)}`
  const seen = await sys(env, 'gosen_sys_event', { p_key: key, p_env: cfg.mode, p_type: type, p_tx: id })
  if (seen.missing || seen.error) return text(500, 'reintentar') // Openpay lo vuelve a mandar
  if (seen.data === 'repetido') return text(200, 'ok')
  try {
    const customer = typeof tx.customer_id === 'string' && /^[A-Za-z0-9_-]{6,60}$/.test(tx.customer_id) ? tx.customer_id : null
    const charge = await fetchCharge(env, id, customer)
    const r = await sys(env, 'gosen_sys_apply_charge', { p_env: cfg.mode, p_charge: charge })
    if (r.missing || r.error) throw new Error(r.error || 'sin SQL')
    await sys(env, 'gosen_sys_event_done', { p_key: key, p_result: JSON.stringify(r.data).slice(0, 300) })
    return text(200, 'ok')
  } catch {
    return text(500, 'reintentar')
  }
}

// --- Contratación -----------------------------------------------------------------------------------------

/** Plan de Openpay para este plan, período y precio (se crea la primera vez y se guarda). */
async function ensurePlan(env, cfg, k) {
  const found = await sys(env, 'gosen_sys_openpay_plan', { p_plan: k.plan, p_period: k.period, p_env: cfg.mode, p_amount: k.amount })
  if (found.data) return found.data
  if (found.missing || found.error) throw new Error(found.error || SQL_MISSING)
  const created = await op(env, 'POST', '/plans', {
    name: `Gosen Tracks · ${k.plan_name} · ${k.period}`.slice(0, 80),
    amount: k.amount,
    currency: 'COP',
    repeat_every: 1,
    repeat_unit: k.period === 'anual' ? 'year' : 'month',
    retry_times: 3,
    status_after_retry: 'cancelled',
    trial_days: 0
  })
  await sys(env, 'gosen_sys_openpay_plan_set', { p_plan: k.plan, p_period: k.period, p_env: cfg.mode, p_amount: k.amount, p_provider_plan: created.id })
  return created.id
}

/** Cobros recientes de un cliente en Openpay, aplicados en la base (idempotente). */
async function settleCustomer(env, cfg, customer, since) {
  const q = since ? `?creation%5Bgte%5D=${since}&limit=25` : '?limit=10'
  const charges = await op(env, 'GET', `/customers/${encodeURIComponent(customer)}/charges${q}`)
  let last = null
  for (const c of Array.isArray(charges) ? charges : []) {
    if (!c || typeof c.id !== 'string') continue
    const r = await sys(env, 'gosen_sys_apply_charge', { p_env: cfg.mode, p_charge: c.customer_id ? c : { ...c, customer_id: customer } })
    if (r.data && (r.data.activated || !last)) last = r.data
  }
  return last
}

const PLAN_RE = /^[a-z0-9-]{2,30}$/
const TOKEN_RE = /^[A-Za-z0-9_-]{6,80}$/
const DEVICE_RE = /^[A-Za-z0-9_-]{6,255}$/

async function checkout(req, env, me, json) {
  const cfg = billingConfig(env)
  if (!cfg.ready) return json({ error: 'El pago en línea aún no está configurado.', code: 'not-configured' }, 503)
  if (!me.admin) return json({ error: 'Solo el administrador de la iglesia puede contratar.' }, 403)
  if (me.church?.internal) return json({ error: 'La iglesia interna no necesita suscripción.' }, 400)
  const b = await req.json().catch(() => ({}))
  const plan = String(b.plan || '')
  const period = b.period === 'anual' || b.period === 'mensual' ? b.period : null
  const token = String(b.token || '')
  const device = String(b.device_session_id || '')
  if (!PLAN_RE.test(plan) || !period) return json({ error: 'Elige el plan y si pagas mensual o anual.' }, 400)
  if (!TOKEN_RE.test(token) || !DEVICE_RE.test(device)) return json({ error: 'Los datos de la tarjeta no llegaron completos. Vuelve a escribirlos.' }, 400)
  const a = b.accept || {}
  if (!a.terminos || !a.privacidad || a.cobro_automatico !== true) {
    return json({ error: 'Para continuar, acepta los términos, la política de privacidad y el cobro automático.', code: 'accept' }, 400)
  }
  // Lo que aceptó, con las versiones vigentes de los documentos (si ya están en vigor).
  const legal = await legalSummary(env)
  const ver = Object.fromEntries((legal.documents || []).map((d) => [d.id, { version: d.version, sha256: d.sha256, estado: d.status }]))
  const accepted = { terminos: ver.terminos ?? true, privacidad: ver.privacidad ?? true, reembolsos: ver.reembolsos ?? null, cobro_automatico: true, documentos_vigentes: !!legal.active, at: new Date().toISOString() }
  const begin = await sys(env, 'gosen_sys_checkout_begin', {
    p_email: me.email,
    p_plan: plan,
    p_period: period,
    p_env: cfg.mode,
    p_ip: req.headers.get('cf-connecting-ip') || null,
    p_ua: (req.headers.get('user-agent') || '').slice(0, 300) || null,
    p_accepted: accepted
  })
  if (begin.missing || begin.error) return sysError(json, begin)
  const k = begin.data
  try {
    let customer = k.customer
    if (!customer) {
      const c = await op(env, 'POST', '/customers', { name: String(k.church_name).slice(0, 80), email: k.email, external_id: `${cfg.mode}-${k.church}`.slice(0, 100) })
      customer = c.id
      await sys(env, 'gosen_sys_customer_set', { p_church: k.church, p_env: cfg.mode, p_customer: customer })
    }
    const card = await op(env, 'POST', `/customers/${encodeURIComponent(customer)}/cards`, { token_id: token, device_session_id: device })
    const planId = await ensurePlan(env, cfg, k)
    const sub = await op(env, 'POST', `/customers/${encodeURIComponent(customer)}/subscriptions`, { plan_id: planId, card_id: card.id })
    const last4 = String(card.card_number || '').replace(/\D/g, '').slice(-4)
    const saved = await sys(env, 'gosen_sys_subscription_save', {
      p_checkout: k.checkout,
      p_provider_sub: sub.id,
      p_status: 'pendiente',
      p_period_end: typeof sub.period_end_date === 'string' ? sub.period_end_date.slice(0, 10) : null,
      p_brand: card.brand ? String(card.brand).slice(0, 20) : null,
      p_last4: last4.length === 4 ? last4 : null
    })
    if (saved.missing || saved.error) throw new Error(saved.error || SQL_MISSING)
    // Openpay hace el primer cobro al crear la suscripción: se consulta y se aplica (también llega su aviso).
    let result = null
    try {
      result = await settleCustomer(env, cfg, customer, null)
    } catch {
      result = null
    }
    const status = result?.activated ? 'aprobado' : result?.status === 'rechazado' ? 'rechazado' : 'pendiente'
    return json({ status, checkout: k.checkout, ends_on: result?.ends_on ?? null })
  } catch (err) {
    const declined = err instanceof OpenpayError && err.status >= 400 && err.status < 500
    await sys(env, 'gosen_sys_checkout_update', { p_checkout: k.checkout, p_status: declined ? 'rechazado' : 'error', p_error: String(err.message || err).slice(0, 300) }).catch(() => null)
    return json({ error: err.message || 'No se pudo completar el pago.', code: declined ? 'declined' : 'error' }, declined ? 402 : 502)
  }
}

async function status(env, bearer, me, json) {
  const r = await neonRpc(env, bearer, 'gosen_my_billing')
  if (r.missing) return json({ error: SQL_MISSING, code: 'sql-missing' }, 503)
  if (r.error) return json({ error: r.error }, r.status === 401 ? 401 : 400)
  const cfg = billingConfig(env)
  return json({ ...r.data, state: me.subscription ?? null, plan: me.plan ?? null, church: me.church ?? null, online: cfg.ready && !!r.data?.checkout, merchantLabel: cfg.merchantLabel })
}

async function cancel(env, me, json) {
  const cfg = billingConfig(env)
  if (!cfg.ready) return json({ error: 'El pago en línea no está configurado.', code: 'not-configured' }, 503)
  if (!me.admin) return json({ error: 'Solo el administrador de la iglesia.' }, 403)
  const b = await sys(env, 'gosen_sys_church_billing', { p_church: churchOf(me), p_env: cfg.mode })
  if (b.missing || b.error) return sysError(json, b)
  const sub = b.data?.subscription
  if (!b.data?.customer || !sub || !['activa', 'pendiente', 'fallida'].includes(sub.status) || sub.cancel_at_period_end) {
    return json({ error: 'Tu iglesia no tiene una renovación automática activa.' }, 400)
  }
  try {
    await op(env, 'DELETE', `/customers/${encodeURIComponent(b.data.customer)}/subscriptions/${encodeURIComponent(sub.provider_id)}`)
  } catch (err) {
    if (!(err instanceof OpenpayError && err.status === 404)) return json({ error: err.message }, 502)
  }
  const r = await sys(env, 'gosen_sys_subscription_status', { p_env: cfg.mode, p_provider_sub: sub.provider_id, p_status: 'cancelada', p_cancel_at_end: true, p_period_end: null })
  if (r.missing || r.error) return sysError(json, r)
  return json({ ok: true, until: sub.period_end })
}

/** Rutas públicas del cobro (sin sesión): la configuración para el navegador y el aviso de Openpay. */
export async function billingPublic(req, env, p, json) {
  if (p === '/api/billing/config' && req.method === 'GET') {
    const cfg = billingConfig(env)
    const r = json({ ready: cfg.ready, sandbox: cfg.mode === 'sandbox', merchant: cfg.ready ? cfg.merchant : null, publicKey: cfg.ready ? cfg.publicKey : null, jsBase: cfg.jsBase, merchantLabel: cfg.merchantLabel })
    r.headers.set('cache-control', 'no-store')
    return r
  }
  if (p === '/api/billing/openpay' && req.method === 'POST') return webhook(req, env)
  return null
}

/** Rutas del cobro con la sesión de la cuenta. */
export async function billingApi(req, env, p, me, bearer, json) {
  if (!p.startsWith('/api/billing/')) return null
  // Se registran a nombre de la cuenta: hace falta la sesión de Neon, no la del panel.
  if (!bearer || bearer.startsWith('gps.')) return json({ error: 'Vuelve a iniciar sesión para continuar.', code: 'neon-session' }, 401)
  if (p === '/api/billing/checkout' && req.method === 'POST') return checkout(req, env, me, json)
  if (p === '/api/billing/status' && req.method === 'GET') {
    if (!me.admin) return json({ error: 'Solo el administrador de la iglesia.' }, 403)
    return status(env, bearer, me, json)
  }
  if (p === '/api/billing/cancel' && req.method === 'POST') return cancel(env, me, json)
  return json({ error: 'No existe' }, 404)
}

// --- Superadmin ------------------------------------------------------------------------------------------

/** Estado del cobro para Superadmin (sin secretos): configuración, código de verificación del aviso y movimientos. */
export async function saBilling(env, call, sa) {
  const cfg = billingConfig(env)
  const r = await call('gosen_sa_billing', { p_sa: sa })
  if (r.missing || r.error) return r
  let verification = null
  try {
    const o = await env.TRACKS.get(VERIFY_KEY)
    verification = o ? JSON.parse(await o.text()) : null
  } catch {
    verification = null
  }
  return { data: { ...r.data, config: { mode: cfg.mode, ready: cfg.ready, missing: cfg.missing, merchantLabel: cfg.merchantLabel }, verification } }
}

/** Reembolso pedido por Superadmin: se registra quién y por qué, se pide a Openpay y se aplica lo que responda. */
export async function saRefund(env, call, sa, tx, reason) {
  const cfg = billingConfig(env)
  if (!cfg.ready) return { error: 'El cobro no está configurado.' }
  if (!/^[A-Za-z0-9_-]{3,60}$/.test(tx)) return { error: 'Pago no válido.' }
  const note = await call('gosen_sa_note_refund', { p_sa: sa, p_tx: tx, p_reason: String(reason || '') })
  if (note.missing || note.error) return note
  if (note.data.env !== cfg.mode) return { error: `Ese pago es del entorno ${note.data.env} y la nube está en ${cfg.mode}.` }
  const b = await sys(env, 'gosen_sys_church_billing', { p_church: note.data.church, p_env: cfg.mode })
  if (b.missing || b.error) return b
  const customer = b.data?.customer
  try {
    const path = customer ? `/customers/${encodeURIComponent(customer)}/charges/${encodeURIComponent(tx)}/refund` : `/charges/${encodeURIComponent(tx)}/refund`
    await op(env, 'POST', path, { description: `Reembolso Gosen Tracks: ${String(reason).slice(0, 200)}` })
    const charge = await fetchCharge(env, tx, customer)
    const r = await sys(env, 'gosen_sys_apply_charge', { p_env: cfg.mode, p_charge: charge })
    if (r.missing || r.error) return r
    return { data: { ok: true, status: r.data?.status } }
  } catch (err) {
    return { error: err.message || 'Openpay no hizo el reembolso.' }
  }
}

// --- Conciliación diaria ----------------------------------------------------------------------------------

const SUB_STATUS = { active: 'activa', trial: 'activa', past_due: 'fallida', unpaid: 'fallida', cancelled: 'cancelada' }

/** Revisa con Openpay los cobros de los últimos días y el estado de cada suscripción (por si se perdió un aviso). */
export async function reconcileBilling(env) {
  const cfg = billingConfig(env)
  if (!cfg.ready) return { skipped: true }
  const list = await sys(env, 'gosen_sys_customers', { p_env: cfg.mode })
  if (!Array.isArray(list.data)) return { error: list.error || 'sin datos' }
  const since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)
  let checked = 0
  for (const row of list.data) {
    try {
      await settleCustomer(env, cfg, row.customer_id, since)
      const b = await sys(env, 'gosen_sys_church_billing', { p_church: row.church_id, p_env: cfg.mode })
      const sub = b.data?.subscription
      if (sub && ['activa', 'pendiente', 'fallida'].includes(sub.status) && !sub.cancel_at_period_end) {
        let next = null
        try {
          const s = await op(env, 'GET', `/customers/${encodeURIComponent(row.customer_id)}/subscriptions/${encodeURIComponent(sub.provider_id)}`)
          next = SUB_STATUS[s?.status] || null
        } catch (err) {
          if (err instanceof OpenpayError && err.status === 404) next = 'cancelada'
        }
        if (next && next !== sub.status) {
          await sys(env, 'gosen_sys_subscription_status', { p_env: cfg.mode, p_provider_sub: sub.provider_id, p_status: next, p_cancel_at_end: null, p_period_end: null })
        }
      }
      checked++
    } catch {
      // Una iglesia con problemas no frena a las demás; se vuelve a intentar mañana.
    }
  }
  return { checked }
}
