/**
 * Registro por autoservicio en la web (v43): prueba gratuita con código y contratación de un plan.
 *
 * El navegador no habla directo con Neon (CORS): el Worker hace de puente, con límite de intentos por IP.
 * Las reglas las pone la base (neon/v43-suscripciones.sql): un código de prueba es de un solo uso, una
 * prueba por correo, el correo se reserva 24 h y la iglesia se crea cuando la persona entra con el correo
 * VERIFICADO (gosen_my_access). La activación de un plan pagado depende solo del pago confirmado.
 *
 *   POST /api/signup/trial-check {code}                  → ¿el código de prueba sirve? (sin usarlo)
 *   POST /api/signup/trial {code, email, church}          → reserva el código para ese correo e iglesia
 *   POST /api/signup/start {email, church, plan, period}  → reserva el correo para contratar
 *   POST /api/signup/account {email, password}            → crea la cuenta en Neon Auth (si está reservada)
 *   POST /api/signup/otp {email}                          → (re)envía el código para verificar el correo
 *   POST /api/signup/verify {email, otp}                  → verifica el correo
 *   POST /api/signup/access (Authorization: Bearer <JWT>) → acceso de la cuenta (completa la iglesia)
 * Después, la página entra con /api/login y pide /api/signup/access: la base completa la iglesia.
 */

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MIN_PASSWORD = 8

/** Función de la base que se puede llamar sin cuenta (rol anónimo de la Data API). */
async function anonRpc(env, fn, body) {
  let r
  try {
    r = await fetch(`${env.DATA_API_URL}/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    return { error: 'No se pudo contactar la base de datos. Intenta de nuevo en un momento.', status: 503 }
  }
  const text = await r.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (r.status === 404 || data?.code === 'PGRST202') return { error: 'Falta ejecutar neon/v43-suscripciones.sql en Neon.', status: 503, code: 'sql-missing' }
  if (r.status === 401 || r.status === 403) return { error: 'El registro en línea no está disponible en este momento. Escríbenos.', status: 503, code: 'anon' }
  if (!r.ok) return { error: data?.message || `La base respondió ${r.status}.`, status: 502 }
  return { data }
}

/** Petición a Neon Auth (sin sesión). */
async function auth(env, path, body) {
  const origin = new URL(env.AUTH_URL).origin
  let r
  try {
    r = await fetch(`${env.AUTH_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) })
  } catch {
    return { status: 0, data: null }
  }
  const text = await r.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  return { status: r.status, data, cookies: (r.headers.getSetCookie?.() ?? []).length > 0 }
}

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function signupApi(req, env, p, json, overLimit) {
  if (!p.startsWith('/api/signup/') || req.method !== 'POST') return null
  const limited = await overLimit(env, req, 'signup')
  if (limited) return limited
  const b = await req.json().catch(() => ({}))
  const email = clean(b.email, 254).toLowerCase()
  const reply = (r) => (r.error ? json({ error: r.error, code: r.code }, r.status || 400) : json(r.data))

  // Acceso de la cuenta recién creada (con su JWT): la base completa aquí la iglesia de la prueba o de la
  // contratación, o dice qué falta (verificar el correo, cupo…). Igual que la app al entrar.
  if (p === '/api/signup/access') {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer /, '')
    if (!jwt || jwt.startsWith('gps.')) return json({ error: 'Inicia sesión.' }, 401)
    let r
    try {
      r = await fetch(`${env.DATA_API_URL}/rpc/gosen_my_access`, { method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: '{}' })
    } catch {
      return json({ error: 'No se pudo contactar la base de datos.' }, 503)
    }
    if (!r.ok) return json({ error: 'Tu sesión venció. Vuelve a entrar.' }, 401)
    return json(await r.json())
  }
  if (p === '/api/signup/trial-check') return reply(await anonRpc(env, 'gosen_trial_check', { p_code: clean(b.code, 40) }))
  if (p === '/api/signup/trial') {
    return reply(await anonRpc(env, 'gosen_trial_redeem', { p_code: clean(b.code, 40), p_email: email, p_church: clean(b.church, 80) }))
  }
  if (p === '/api/signup/start') {
    return reply(await anonRpc(env, 'gosen_signup_start', { p_email: email, p_church: clean(b.church, 80), p_plan: clean(b.plan, 30), p_period: clean(b.period, 10) }))
  }
  if (!EMAIL.test(email)) return json({ error: 'Escribe un correo válido.' }, 400)

  if (p === '/api/signup/account') {
    const password = typeof b.password === 'string' ? b.password : ''
    if (password.length < MIN_PASSWORD || password.length > 128) return json({ error: `La contraseña debe tener entre ${MIN_PASSWORD} y 128 caracteres.` }, 400)
    const r = await auth(env, '/sign-up/email', { email, password, name: clean(b.name, 80) || email.split('@')[0] })
    if (r.status === 0) return json({ error: 'No se pudo contactar el servicio de cuentas.' }, 503)
    if (r.status >= 200 && r.status < 300) return json({ created: true, verify: !r.cookies })
    const msg = String(r.data?.message || r.data?.code || '')
    if (/GOSEN_EMAIL_NOT_ALLOWED/i.test(msg)) return json({ error: 'Primero reserva tu correo con el código de prueba o eligiendo un plan.', code: 'not-allowed' }, 403)
    if (/exist/i.test(msg)) return json({ error: 'Ese correo ya tiene cuenta: entra con tu contraseña.', code: 'exists' }, 409)
    return json({ error: msg ? `No se pudo crear la cuenta: ${msg.slice(0, 160)}` : `No se pudo crear la cuenta (${r.status}).` }, 400)
  }
  if (p === '/api/signup/otp') {
    const r = await auth(env, '/email-otp/send-verification-otp', { email, type: 'email-verification' })
    return r.status >= 200 && r.status < 300 ? json({ ok: true }) : json({ error: 'No se pudo enviar el código. Intenta de nuevo en un momento.' }, 502)
  }
  if (p === '/api/signup/verify') {
    const otp = clean(b.otp, 12).replace(/\s/g, '')
    if (!/^[0-9A-Za-z]{4,12}$/.test(otp)) return json({ error: 'Escribe el código que llegó a tu correo.' }, 400)
    const r = await auth(env, '/email-otp/verify-email', { email, otp })
    return r.status >= 200 && r.status < 300 ? json({ ok: true }) : json({ error: 'El código no es correcto o ya venció. Pide otro.', code: 'otp' }, 400)
  }
  return json({ error: 'No existe' }, 404)
}
