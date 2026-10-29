import ADMIN_HTML from './admin.html'
import LOGO from './logo.png'
import { extractSongJson } from './zipMetadata.js'

/**
 * Gosen Tracks en la nube: página del admin (/) y API.
 * La sesión es el mismo JWT de Neon Auth que usa la app; Neon dice si el correo
 * está autorizado y si es admin (rpc gosen_my_access).
 *
 * POST /api/login {email,password}     → {jwt, cookies}
 * POST /api/refresh {cookies}          → {jwt} (el JWT dura minutos; las subidas largas lo renuevan)
 * GET  /api/me                         → acceso, y los límites si es admin
 * GET  /api/tracks                     → lista (músicos y admin)
 * GET  /api/file/<key>                 → descarga (músicos y admin)
 * GET  /api/cover/<key>                → portada de la canción (si tiene)
 * Solo admin: subida multiparte (para archivos grandes), portadas, migración y borrado.
 * PUT/POST /api/metadata/<key>          → ficha compartida (nombre, artista y datos musicales)
 * POST /api/migrate-metadata/<key>      → importar song.json del ZIP si aún no hay ficha
 * PUT    /api/cover/<key> (cuerpo: imagen JPEG/PNG/WebP, máx. 2 MB)
 * DELETE /api/cover/<key>
 * POST   /api/upload/start?name=&size= → {key, uploadId}
 * PUT    /api/upload/part?key=&uploadId=&n= (cuerpo: trozo de 50 MB) → {partNumber, etag}
 * POST   /api/upload/done?key=&uploadId= {parts}
 * POST   /api/upload/abort?key=&uploadId=
 * DELETE /api/file/<key>
 */
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type' }
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } })

async function access(req, env) {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer /, '')
  if (!jwt) return null
  const r = await fetch(`${env.DATA_API_URL}/rpc/gosen_my_access`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: '{}'
  })
  if (!r.ok) return null
  const a = await r.json()
  return a && a.allowed ? a : null
}

async function jwtFromCookies(env, cookies) {
  const t = await fetch(`${env.AUTH_URL}/token`, { headers: { cookie: cookies, origin: new URL(env.AUTH_URL).origin } })
  return t.ok ? (await t.json()).token || null : null
}

async function login(req, env) {
  const { email, password } = await req.json()
  const r = await fetch(`${env.AUTH_URL}/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(env.AUTH_URL).origin },
    body: JSON.stringify({ email: String(email).trim().toLowerCase(), password })
  })
  if (r.status === 401) return json({ error: 'Correo o contraseña incorrectos.' }, 401)
  if (!r.ok) return json({ error: `No se pudo iniciar sesión (${r.status}).` }, 502)
  const cookies = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const jwt = r.headers.get('set-auth-jwt') || (await jwtFromCookies(env, cookies))
  return jwt ? json({ jwt, cookies }) : json({ error: 'No se pudo iniciar sesión.' }, 502)
}

const COVERS = 'covers/'
const METADATA = 'metadata/'
const MAX_COVER_BYTES = 2 * 1024 * 1024

/** Multitracks del bucket; `size` incluye ZIP, portada y ficha compartida. */
async function listAll(env) {
  const items = []
  const covers = new Map()
  const metadata = new Map()
  let cursor
  do {
    const page = await env.TRACKS.list({ cursor, include: ['customMetadata'] })
    for (const o of page.objects) {
      if (o.key.startsWith(COVERS)) covers.set(o.key.slice(COVERS.length), o)
      else if (o.key.startsWith(METADATA)) {
        const data = o.customMetadata?.data
        if (data) metadata.set(o.key.slice(METADATA.length), { data: JSON.parse(data), size: o.size })
      }
      else items.push({ key: o.key, name: o.customMetadata?.name || o.key, size: o.size, uploaded: o.uploaded })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  for (const it of items) {
    const cover = covers.get(it.key)
    const sidecar = metadata.get(it.key)
    const data = sidecar?.data
    it.cover = !!cover
    it.coverUpdated = cover?.uploaded?.toISOString() || null
    it.size += (cover?.size || 0) + (sidecar?.size || 0)
    it.hasMetadata = !!sidecar
    it.title = data?.title ?? null
    it.artist = data?.artist ?? null
    it.duration = data?.duration ?? null
    it.bpm = data?.bpm ?? null
    it.keySignature = data?.key ?? null
    it.timeSignature = data?.timeSignature ?? null
  }
  return items
}

function normalizeMetadata(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('La ficha no es válida.')
  const text = (value, label, max) => {
    if (value == null || value === '') return null
    if (typeof value !== 'string' || value.trim().length > max) throw new Error(`${label} no es válido.`)
    return value.trim() || null
  }
  const number = (value, label, min, max) => {
    if (value == null || value === '') return null
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${label} debe estar entre ${min} y ${max}.`)
    }
    return value
  }
  const timeSignature = raw.timeSignature
  let signature = null
  if (timeSignature != null) {
    const denominators = [1, 2, 4, 8, 16]
    if (
      typeof timeSignature !== 'object' ||
      !Number.isInteger(timeSignature.num) ||
      timeSignature.num < 1 ||
      timeSignature.num > 12 ||
      !denominators.includes(timeSignature.den)
    ) {
      throw new Error('El compás debe tener un numerador de 1 a 12 y denominador 1, 2, 4, 8 o 16.')
    }
    signature = { num: timeSignature.num, den: timeSignature.den }
  }
  return {
    title: text(raw.title, 'El nombre', 160),
    artist: text(raw.artist, 'El artista', 160),
    duration: number(raw.duration, 'La duración', 0, 86400),
    bpm: number(raw.bpm, 'El tempo', 20, 400),
    key: text(raw.key, 'La tonalidad', 32),
    timeSignature: signature
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const p = url.pathname
    const q = (k) => url.searchParams.get(k)
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...CORS, 'access-control-allow-methods': 'GET,POST,PUT,DELETE' } })
    if (p === '/') return new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    if (p === '/logo.png') return new Response(LOGO, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } })
    if (p === '/api/login' && req.method === 'POST') return login(req, env)
    if (p === '/api/refresh' && req.method === 'POST') {
      const { cookies } = await req.json().catch(() => ({}))
      const jwt = cookies ? await jwtFromCookies(env, String(cookies)) : null
      return jwt ? json({ jwt }) : json({ error: 'Sesión caducada' }, 401)
    }

    const me = await access(req, env)
    if (!me) return json({ error: 'Sin acceso' }, 401)

    if (p === '/api/me')
      return json(me.admin ? { ...me, maxTotalBytes: Number(env.MAX_TOTAL_BYTES), maxFileBytes: Number(env.MAX_FILE_BYTES) } : me)
    if (p === '/api/tracks') return json(await listAll(env))

    if (p.startsWith('/api/file/') && req.method === 'GET') {
      const obj = await env.TRACKS.get(decodeURIComponent(p.slice(10)))
      if (!obj) return json({ error: 'No existe' }, 404)
      return new Response(obj.body, {
        headers: { ...CORS, 'content-type': 'application/zip', 'content-length': String(obj.size) }
      })
    }

    if (p.startsWith('/api/cover/') && req.method === 'GET') {
      const obj = await env.TRACKS.get(COVERS + decodeURIComponent(p.slice(11)))
      if (!obj) return json({ error: 'Sin portada' }, 404)
      return new Response(obj.body, {
        headers: { ...CORS, 'content-type': obj.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'private, max-age=300' }
      })
    }

    if (!me.admin) return json({ error: 'Solo el administrador' }, 403)

    if (p.startsWith('/api/migrate-metadata/') && req.method === 'POST') {
      const key = decodeURIComponent(p.slice('/api/migrate-metadata/'.length))
      const zip = await env.TRACKS.head(key)
      if (!zip) return json({ error: 'Ese multitrack no existe.' }, 404)
      const metadataKey = METADATA + key
      if (await env.TRACKS.head(metadataKey)) return json({ status: 'exists' })
      let source
      try {
        source = await extractSongJson(env.TRACKS, key)
      } catch (err) {
        return json({ error: err.message || 'No se pudo leer song.json.' }, 422)
      }
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return json({ status: 'missing' })
      }
      let metadata
      try {
        const fallbackTitle = (zip.customMetadata?.name || key).replace(/\.zip$/i, '')
        const signature = source.timeSignature
        const validSignature = signature &&
          Number.isInteger(signature.num) && signature.num >= 1 && signature.num <= 12 &&
          [1, 2, 4, 8, 16].includes(signature.den)
          ? { num: signature.num, den: signature.den }
          : null
        metadata = normalizeMetadata({
          title: (typeof source.name === 'string' && source.name.trim() ? source.name.trim() : fallbackTitle).slice(0, 160),
          artist: typeof source.artist === 'string' && source.artist.trim().length <= 160 ? source.artist : null,
          duration: typeof source.duration === 'number' && source.duration > 0 && source.duration <= 86400 ? source.duration : null,
          bpm: typeof source.bpm === 'number' && source.bpm >= 20 && source.bpm <= 400 ? source.bpm : null,
          key: typeof source.key === 'string' && source.key.trim().length <= 32 ? source.key : null,
          timeSignature: validSignature
        })
      } catch (err) {
        return json({ error: `song.json no contiene datos válidos: ${err.message}` }, 422)
      }
      const data = JSON.stringify(metadata)
      const saved = await env.TRACKS.put(metadataKey, data, {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { data }
      })
      return saved ? json({ status: 'migrated' }) : json({ status: 'exists' })
    }

    if (p.startsWith('/api/metadata/') && (req.method === 'PUT' || req.method === 'POST')) {
      const key = decodeURIComponent(p.slice(14))
      if (!(await env.TRACKS.head(key))) return json({ error: 'Ese multitrack no existe' }, 404)
      let metadata
      try {
        metadata = normalizeMetadata(await req.json())
      } catch (err) {
        return json({ error: err.message || 'La ficha no es válida.' }, 400)
      }
      const metadataKey = METADATA + key
      if (Object.values(metadata).every((value) => value === null)) {
        await env.TRACKS.delete(metadataKey)
      } else {
        const data = JSON.stringify(metadata)
        await env.TRACKS.put(metadataKey, data, {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: { data }
        })
      }
      return json({ ok: true })
    }

    if (p.startsWith('/api/file/') && req.method === 'DELETE') {
      const key = decodeURIComponent(p.slice(10))
      await env.TRACKS.delete([key, COVERS + key, METADATA + key])
      return json({ ok: true })
    }
    if (p.startsWith('/api/cover/') && req.method === 'PUT') {
      const key = decodeURIComponent(p.slice(11))
      const type = req.headers.get('content-type') || ''
      if (!/^image\/(jpeg|png|webp)$/.test(type)) return json({ error: 'La portada debe ser JPG, PNG o WebP' }, 400)
      if (!(await env.TRACKS.head(key))) return json({ error: 'Ese multitrack no existe' }, 404)
      const bytes = await req.arrayBuffer()
      if (!bytes.byteLength || bytes.byteLength > MAX_COVER_BYTES) return json({ error: 'La portada debe pesar menos de 2 MB' }, 413)
      await env.TRACKS.put(COVERS + key, bytes, { httpMetadata: { contentType: type } })
      return json({ ok: true })
    }
    if (p.startsWith('/api/cover/') && req.method === 'DELETE') {
      await env.TRACKS.delete(COVERS + decodeURIComponent(p.slice(11)))
      return json({ ok: true })
    }
    if (p === '/api/upload/start' && req.method === 'POST') {
      const name = q('name') || ''
      const size = Number(q('size') || 0)
      if (!/\.zip$/i.test(name)) return json({ error: 'Solo se pueden subir archivos .zip' }, 400)
      if (!(size > 0)) return json({ error: 'El archivo está vacío' }, 400)
      if (size > Number(env.MAX_FILE_BYTES)) return json({ error: 'Archivo demasiado grande' }, 413)
      const max = Number(env.MAX_TOTAL_BYTES)
      if (max > 0) {
        const used = (await listAll(env)).reduce((s, o) => s + o.size, 0)
        if (used + size > max) return json({ error: 'Se alcanzó el límite de almacenamiento' }, 507)
      }
      const key = `${Date.now()}-${name.replace(/[^\w.\- ]/g, '_')}`
      const up = await env.TRACKS.createMultipartUpload(key, { customMetadata: { name } })
      return json({ key, uploadId: up.uploadId })
    }
    const upload = () => env.TRACKS.resumeMultipartUpload(q('key'), q('uploadId'))
    if (p === '/api/upload/part' && req.method === 'PUT') return json(await upload().uploadPart(Number(q('n')), req.body))
    if (p === '/api/upload/done' && req.method === 'POST') {
      const { parts } = await req.json()
      await upload().complete(parts)
      return json({ ok: true })
    }
    if (p === '/api/upload/abort' && req.method === 'POST') {
      await upload().abort()
      return json({ ok: true })
    }
    return json({ error: 'No encontrado' }, 404)
  }
}
