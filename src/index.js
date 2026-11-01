import ADMIN_HTML from './admin.html'
import LOGO from './logo.png'
import { CATEGORIES, FAMILIES, guessTrack, isAudioFile } from './catalog.js'
import { extractSongJson } from './zipMetadata.js'
import {
  INDEX,
  METADATA,
  TRACK_FILES,
  deleteOrphanTrackFiles,
  normalizeTracks,
  readSheet,
  songFields,
  songManifest,
  trackPrefix,
  writeSheet,
  zipTrackIndex
} from './songs.js'

/**
 * Gosen Tracks en la nube: página del admin (/), la app para iPhone (/iphone/, archivos estáticos)
 * y la API. La sesión es el mismo JWT de Neon Auth que usa la app; Neon dice si el correo está
 * autorizado y si es admin (rpc gosen_my_access).
 *
 * La ficha de cada canción (metadata/<clave>) es la FUENTE ÚNICA de sus datos: nombre, artista,
 * tonalidad, compás y sus pistas (nombre, categoría y orden). La app solo detecta BPM y duración.
 *
 * POST /api/login {email,password}     → {jwt, cookies}
 * POST /api/refresh {cookies}          → {jwt} (el JWT dura minutos; las subidas largas lo renuevan)
 * POST /api/proxy {url,method,…}       → petición a Neon (solo sus dominios) para la app de iPhone
 * GET  /api/categories                 → catálogo de categorías instrumentales
 * GET  /api/guess?file=                → nombre y categoría sugeridos para un archivo de audio
 * GET  /api/me                         → acceso, y los límites si es admin
 * GET  /api/tracks                     → lista de canciones (con `rev`, que cambia si cambia algo)
 * GET  /api/song/<key>                 → ficha completa: datos y pistas con su versión
 * GET  /api/file/<key>                 → ZIP o pista suelta; admite Range (bytes=a-b) y ETag
 * GET  /api/cover/<key>                → portada de la canción (si tiene)
 * POST /api/detected/<key> {bpm,duration} → lo que detectó la app (el admin), sin tocar lo demás
 * Solo admin: subida multiparte (ZIP o, con ?song=, una pista suelta), portadas, fichas y borrado.
 * PUT/POST /api/metadata/<key>          → datos de la canción (se conservan sus pistas)
 * PUT    /api/song/<key>/tracks {tracks} → pistas: nombre, categoría, orden y archivo
 * POST /api/migrate-metadata/<key>      → importar song.json del ZIP si aún no hay ficha
 * PUT    /api/cover/<key> (cuerpo: imagen JPEG/PNG/WebP, máx. 2 MB)
 * DELETE /api/cover/<key>
 * POST   /api/upload/start?name=&size=[&song=] → {key, uploadId}
 * PUT    /api/upload/part?key=&uploadId=&n= (cuerpo: trozo de 50 MB) → {partNumber, etag}
 * POST   /api/upload/done?key=&uploadId= {parts}
 * POST   /api/upload/abort?key=&uploadId=
 * DELETE /api/file/<key>
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, range, if-none-match',
  'access-control-expose-headers': 'content-range, content-length, etag, accept-ranges'
}
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } })

/**
 * Acceso ya comprobado por JWT (en la memoria de este Worker, como mucho 60 s y nunca más allá de
 * que caduque el JWT). Una descarga pide muchos trozos seguidos: así Neon se consulta una vez y no
 * en cada trozo (las descargas van más rápido). Quitar el acceso a alguien tarda como mucho 60 s.
 */
const ACCESS_TTL_MS = 60_000
const accessCache = new Map()

function jwtExpiry(jwt) {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0
  } catch {
    return 0
  }
}

async function access(req, env) {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer /, '')
  if (!jwt) return null
  const now = Date.now()
  const hit = accessCache.get(jwt)
  if (hit && hit.until > now) return hit.access
  const r = await fetch(`${env.DATA_API_URL}/rpc/gosen_my_access`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: '{}'
  })
  if (!r.ok) return null
  const a = await r.json()
  const ok = a && a.allowed ? a : null
  const exp = jwtExpiry(jwt)
  if (ok && exp > now) {
    if (accessCache.size > 500) for (const [k, v] of accessCache) if (v.until <= now || accessCache.size > 400) accessCache.delete(k)
    accessCache.set(jwt, { access: ok, until: Math.min(now + ACCESS_TTL_MS, exp) })
  }
  return ok
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

/**
 * La app de iPhone (Safari) no puede hablar directamente con Neon por CORS: el Worker hace de puente,
 * solo hacia los dominios de Neon configurados y solo con las cabeceras que usa la app. Responde con
 * la misma forma que el puente de red de escritorio (status, setCookies, headers, body).
 */
const PROXY_HEADERS = new Set(['content-type', 'cookie', 'authorization', 'origin', 'accept', 'prefer'])
async function proxy(req, env) {
  const fail = (status, message) => json({ status, setCookies: [], headers: {}, body: JSON.stringify({ message }) })
  let input
  try {
    const text = await req.text()
    if (text.length > 64 * 1024) return fail(413, 'Petición demasiado grande')
    input = JSON.parse(text)
  } catch {
    return fail(400, 'Petición no válida')
  }
  let url
  try {
    url = new URL(String(input?.url))
  } catch {
    return fail(400, 'URL inválida')
  }
  const allowed = [new URL(env.AUTH_URL).origin, new URL(env.DATA_API_URL).origin]
  if (url.protocol !== 'https:' || !allowed.includes(url.origin)) return fail(403, 'Servidor no permitido')
  const method = ['GET', 'POST', 'DELETE', 'PATCH'].includes(input.method) ? input.method : 'GET'
  const headers = {}
  for (const [k, v] of Object.entries(input.headers ?? {})) if (PROXY_HEADERS.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v
  try {
    const r = await fetch(url, { method, headers, body: method === 'GET' ? undefined : input.body })
    const out = {}
    for (const k of ['content-type', 'set-auth-jwt', 'set-auth-token']) {
      const v = r.headers.get(k)
      if (v) out[k] = v
    }
    return json({ status: r.status, setCookies: r.headers.getSetCookie(), headers: out, body: await r.text() })
  } catch {
    return json({ status: 0, setCookies: [], headers: {}, body: '' })
  }
}

const COVERS = 'covers/'
const MAX_COVER_BYTES = 2 * 1024 * 1024
/** Objetos del bucket que no son canciones. */
const isAuxiliary = (key) => [COVERS, METADATA, INDEX, TRACK_FILES].some((prefix) => key.startsWith(prefix))

/** Canciones del bucket; `size` incluye ZIP, pistas sueltas, portada y ficha. */
async function listAll(env) {
  const items = []
  const covers = new Map()
  const metadata = new Map()
  const extraBytes = new Map()
  let cursor
  do {
    const page = await env.TRACKS.list({ cursor, include: ['customMetadata'] })
    for (const o of page.objects) {
      if (o.key.startsWith(COVERS)) covers.set(o.key.slice(COVERS.length), o)
      else if (o.key.startsWith(METADATA)) {
        const data = o.customMetadata?.data
        metadata.set(o.key.slice(METADATA.length), { data: data ? JSON.parse(data) : {}, size: o.size, etag: o.etag })
      } else if (o.key.startsWith(TRACK_FILES)) {
        const song = o.key.slice(TRACK_FILES.length).split('/')[0]
        extraBytes.set(song, (extraBytes.get(song) || 0) + o.size)
      } else if (!isAuxiliary(o.key)) {
        items.push({ key: o.key, name: o.customMetadata?.name || o.key, size: o.size, uploaded: o.uploaded, etag: o.etag })
      }
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  for (const it of items) {
    const cover = covers.get(it.key)
    const sidecar = metadata.get(it.key)
    const data = sidecar?.data
    it.cover = !!cover
    it.coverUpdated = cover?.uploaded?.toISOString() || null
    it.size += (cover?.size || 0) + (sidecar?.size || 0) + (extraBytes.get(it.key) || 0)
    it.hasMetadata = !!sidecar
    it.title = data?.title ?? null
    it.artist = data?.artist ?? null
    it.duration = data?.duration ?? null
    it.bpm = data?.bpm ?? null
    it.keySignature = data?.key ?? null
    it.timeSignature = data?.timeSignature ?? null
    // Cambia si cambia el ZIP o la ficha (datos o pistas): la app solo vuelve a mirar entonces.
    it.rev = `${it.etag}:${sidecar?.etag ?? '-'}`
    delete it.etag
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

/** Descarga de un ZIP o pista suelta, completa o por rango ("bytes=a-b"), con su ETag. */
async function serveFile(req, env, key) {
  const head = await env.TRACKS.head(key)
  if (!head) return json({ error: 'No existe' }, 404)
  const base = { ...CORS, 'accept-ranges': 'bytes', etag: head.httpEtag }
  if (req.headers.get('if-none-match') === head.httpEtag) return new Response(null, { status: 304, headers: base })
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range') || '')
  if (range) {
    const start = Number(range[1])
    const end = range[2] ? Math.min(Number(range[2]), head.size - 1) : head.size - 1
    if (start > end || start >= head.size) {
      return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${head.size}` } })
    }
    const obj = await env.TRACKS.get(key, { range: { offset: start, length: end - start + 1 } })
    return new Response(obj.body, {
      status: 206,
      headers: {
        ...base,
        'content-type': 'application/octet-stream',
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${head.size}`
      }
    })
  }
  const obj = await env.TRACKS.get(key)
  return new Response(obj.body, {
    headers: { ...base, 'content-type': isAudioFile(key) ? 'application/octet-stream' : 'application/zip', 'content-length': String(head.size) }
  })
}

/** Ficha para guardar: los datos de la canción nuevos, conservando sus pistas. */
async function saveSongFields(env, key, fields) {
  const sheet = await readSheet(env.TRACKS, key)
  const doc = { ...(sheet?.doc ?? {}), ...fields }
  if (Object.values(songFields(doc)).every((value) => value === null) && !doc.tracks) {
    await env.TRACKS.delete(METADATA + key)
  } else {
    await writeSheet(env.TRACKS, key, doc)
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
    if (p === '/api/proxy' && req.method === 'POST') return proxy(req, env)
    if (p === '/api/categories') return json({ categories: CATEGORIES, families: FAMILIES })
    // Nombre y categoría sugeridos para un archivo (mismas reglas que al migrar un ZIP).
    if (p === '/api/guess') return json(guessTrack(q('file') || ''))
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

    if (p.startsWith('/api/song/') && req.method === 'GET') {
      try {
        const manifest = await songManifest(env.TRACKS, decodeURIComponent(p.slice(10)))
        return manifest ? json(manifest) : json({ error: 'No existe' }, 404)
      } catch (err) {
        return json({ error: err.message || 'No se pudo leer la canción.' }, 422)
      }
    }

    if (p.startsWith('/api/file/') && req.method === 'GET') return serveFile(req, env, decodeURIComponent(p.slice(10)))

    if (p.startsWith('/api/cover/') && req.method === 'GET') {
      const obj = await env.TRACKS.get(COVERS + decodeURIComponent(p.slice(11)))
      if (!obj) return json({ error: 'Sin portada' }, 404)
      return new Response(obj.body, {
        headers: { ...CORS, 'content-type': obj.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'private, max-age=300' }
      })
    }

    if (!me.admin) return json({ error: 'Solo el administrador' }, 403)

    // Lo que la app detecta al analizar el audio (tempo y duración): solo esos dos datos.
    if (p.startsWith('/api/detected/') && req.method === 'POST') {
      const key = decodeURIComponent(p.slice(14))
      if (!(await env.TRACKS.head(key))) return json({ error: 'Ese multitrack no existe' }, 404)
      const body = await req.json().catch(() => ({}))
      let detected
      try {
        const n = normalizeMetadata({ bpm: body.bpm ?? null, duration: body.duration ?? null })
        detected = { bpm: n.bpm, duration: n.duration }
      } catch (err) {
        return json({ error: err.message }, 400)
      }
      const sheet = await readSheet(env.TRACKS, key)
      const doc = sheet?.doc ?? {}
      if (doc.bpm === detected.bpm && doc.duration === detected.duration) return json({ ok: true })
      await writeSheet(env.TRACKS, key, { ...doc, ...detected })
      return json({ ok: true })
    }

    if (p.startsWith('/api/song/') && p.endsWith('/tracks') && req.method === 'PUT') {
      const key = decodeURIComponent(p.slice(10, -7))
      const idx = await zipTrackIndex(env.TRACKS, key).catch((err) => ({ error: err }))
      if (!idx) return json({ error: 'Ese multitrack no existe' }, 404)
      if (idx.error) return json({ error: idx.error.message || 'No se pudo leer el ZIP.' }, 422)
      let tracks
      try {
        tracks = await normalizeTracks(env.TRACKS, key, (await req.json().catch(() => ({}))).tracks, idx)
      } catch (err) {
        return json({ error: err.message }, 400)
      }
      const sheet = await readSheet(env.TRACKS, key)
      await writeSheet(env.TRACKS, key, { ...(sheet?.doc ?? {}), tracks })
      await deleteOrphanTrackFiles(env.TRACKS, key, tracks)
      return json({ ok: true, manifest: await songManifest(env.TRACKS, key) })
    }

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
      const saved = await writeSheet(env.TRACKS, key, metadata, { etagDoesNotMatch: '*' })
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
      await saveSongFields(env, key, metadata)
      return json({ ok: true })
    }

    if (p.startsWith('/api/file/') && req.method === 'DELETE') {
      const key = decodeURIComponent(p.slice(10))
      const extra = []
      let cursor
      do {
        const page = await env.TRACKS.list({ prefix: trackPrefix(key), cursor })
        extra.push(...page.objects.map((o) => o.key))
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor)
      await env.TRACKS.delete([key, COVERS + key, METADATA + key, INDEX + key, ...extra])
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
      const song = q('song')
      if (song ? !isAudioFile(name) : !/\.zip$/i.test(name)) {
        return json({ error: song ? 'La pista debe ser WAV o MP3' : 'Solo se pueden subir archivos .zip' }, 400)
      }
      if (!(size > 0)) return json({ error: 'El archivo está vacío' }, 400)
      if (size > Number(env.MAX_FILE_BYTES)) return json({ error: 'Archivo demasiado grande' }, 413)
      if (song && (isAuxiliary(song) || !(await env.TRACKS.head(song)))) return json({ error: 'Ese multitrack no existe' }, 404)
      const max = Number(env.MAX_TOTAL_BYTES)
      if (max > 0) {
        const used = (await listAll(env)).reduce((s, o) => s + o.size, 0)
        if (used + size > max) return json({ error: 'Se alcanzó el límite de almacenamiento' }, 507)
      }
      const safe = name.replace(/[^\w.\- ]/g, '_')
      // Pista suelta: dentro de la carpeta de su canción, con un nombre que no se repite.
      const key = song ? `${trackPrefix(song)}${crypto.randomUUID()}${safe.slice(safe.lastIndexOf('.')).toLowerCase()}` : `${Date.now()}-${safe}`
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
