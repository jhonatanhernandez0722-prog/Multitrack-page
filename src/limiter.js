/**
 * Límite de solicitudes por IP para las rutas sensibles (entrar, códigos de verificación, sesión del
 * panel, Superadmin): un Durable Object por tipo de ruta guarda, en memoria, las peticiones recientes
 * de cada IP. Si se pasa del límite, responde cuánto esperar. No guarda nada de forma permanente.
 */
export class Limiter {
  constructor(state) {
    this.state = state
    this.hits = new Map()
  }

  async fetch(req) {
    const { key, limit, windowMs } = await req.json()
    const now = Date.now()
    const recent = (this.hits.get(key) || []).filter((t) => now - t < windowMs)
    if (recent.length >= limit) {
      this.hits.set(key, recent)
      return Response.json({ ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) })
    }
    recent.push(now)
    this.hits.set(key, recent)
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) if (!v.length || now - v[v.length - 1] > windowMs) this.hits.delete(k)
    }
    return Response.json({ ok: true })
  }
}

/** Reglas por tipo de ruta: cuántas peticiones por IP en cuánto tiempo. */
export const LIMITS = {
  login: { limit: 10, windowMs: 60_000 },
  auth: { limit: 30, windowMs: 60_000 },
  refresh: { limit: 60, windowMs: 60_000 },
  panel: { limit: 20, windowMs: 60_000 },
  twofa: { limit: 10, windowMs: 5 * 60_000 },
  superadmin: { limit: 8, windowMs: 5 * 60_000 },
  consent: { limit: 20, windowMs: 60_000 },
  // Registro por la web (prueba y contratación) y pagos.
  signup: { limit: 20, windowMs: 10 * 60_000 },
  checkout: { limit: 10, windowMs: 10 * 60_000 }
}

/**
 * ¿Se pasó del límite? Devuelve la respuesta 429 para enviar, o null si puede seguir. Si el Durable
 * Object no está (pruebas locales o despliegue viejo), no limita.
 */
export async function overLimit(env, req, bucket) {
  const rule = LIMITS[bucket]
  if (!env?.LIMITER || !rule) return null
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'local'
  try {
    const stub = env.LIMITER.get(env.LIMITER.idFromName(bucket))
    const r = await (await stub.fetch('https://limiter/check', { method: 'POST', body: JSON.stringify({ key: `${bucket}:${ip}`, ...rule }) })).json()
    if (r.ok) return null
    return new Response(JSON.stringify({ error: `Demasiados intentos. Espera ${r.retryAfter} segundos e inténtalo de nuevo.`, code: 'rate-limited' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': String(r.retryAfter), 'access-control-allow-origin': '*' }
    })
  } catch {
    return null
  }
}
