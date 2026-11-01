/**
 * Pruebas del Worker sin Cloudflare: R2 simulado en memoria, Neon simulado y un ZIP de prueba.
 * Cubre el catálogo, la ficha con pistas (migración desde song.json y por nombre de archivo), las
 * versiones por pista, la descarga por rangos, la edición de pistas (reemplazar una sola), el borrado
 * y el puente /api/proxy de iPhone.
 *
 * Uso: node --import ./test/register.mjs test/worker.test.mjs
 */
import { createHash } from 'node:crypto'
import { crc32, inflateRawSync } from 'node:zlib'
import { FakeBucket, audio, makeZip } from './fakes.mjs'
import worker from '../src/index.js'
import { relay } from '../src/live.js'
import { CATEGORIES } from '../src/catalog.js'

let failures = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`)
  if (!cond) failures++
}


// --- Entorno -------------------------------------------------------------------------------------
const env = {
  TRACKS: new FakeBucket(),
  AUTH_URL: 'https://ep-x.neonauth.test.neon.tech/neondb/auth',
  DATA_API_URL: 'https://ep-x.apirest.test.neon.tech/neondb/rest/v1',
  MAX_TOTAL_BYTES: '0',
  MAX_FILE_BYTES: '2147483648'
}
let isAdmin = true
const proxied = []
let accessChecks = 0
globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  if (u.endsWith('/rpc/gosen_my_access')) {
    accessChecks++
    return new Response(JSON.stringify({ allowed: true, admin: isAdmin }))
  }
  proxied.push({ url: u, init })
  return new Response('{"ok":true}', { headers: { 'set-cookie': 'session=abc; Path=/', 'set-auth-jwt': 'jwt123' } })
}
const call = async (method, path, { body, headers = {} } = {}) => {
  const res = await worker.fetch(
    new Request(`https://gosen.test${path}`, {
      method,
      headers: { authorization: 'Bearer t', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body)
    }),
    env
  )
  return res
}
const getJson = async (path) => (await call('GET', path)).json()

// Canción 1: ZIP con song.json de la app (nombres y tipos ya puestos) y una pista sin comprimir.
const songJson = JSON.stringify({ name: 'Eres Todopoderoso', tracks: [{ file: 'tracks/Bat.wav', name: 'Batería Live', type: 'drums' }, { file: 'tracks/Sx.wav', name: 'Saxo alto', type: 'sax' }] })
const zip1 = makeZip([
  { name: 'Eres/song.json', data: songJson },
  { name: 'Eres/tracks/Bat.wav', data: audio(3), extra: 7 },
  { name: 'Eres/tracks/Sx.wav', data: audio(5), store: true },
  { name: 'Eres/tracks/Bajo.wav', data: audio(7) },
  { name: '__MACOSX/._Bajo.wav', data: 'x' },
  { name: 'Eres/cover.jpg', data: 'img' }
])
await env.TRACKS.put('1-Eres.zip', zip1, { customMetadata: { name: 'Eres.zip' } })
// Canción 2: ZIP sin song.json (las pistas se nombran por el archivo).
await env.TRACKS.put('2-Otra.zip', makeZip([{ name: 'Click.wav', data: audio(2) }, { name: 'Guitarra Acustica.mp3', data: audio(9) }]), { customMetadata: { name: 'Otra.zip' } })

console.log('Catálogo de categorías')
{
  const r = await (await call('GET', '/api/categories', { headers: { authorization: '' } })).json()
  ok(r.categories.length === 31 && r.families.reduce((s, f) => s + f.ids.length, 0) === 31, `31 categorías en ${r.families.length} familias, sin iniciar sesión`)
  const ids = new Set(CATEGORIES.map((c) => c.id))
  ok(['sax', 'guitar', 'acoustic', 'keys', 'piano', 'bass', 'drums', 'percussion', 'strings', 'violin', 'brass', 'synth', 'vocals', 'choir', 'pad'].every((i) => ids.has(i)), 'incluye saxofón, guitarras, teclados, piano, bajo, batería, percusión, cuerdas, violines, metales, sintetizadores, voces, coros y pads')
}

console.log('\nListado')
let list = await getJson('/api/tracks')
ok(list.length === 2 && list.every((s) => typeof s.rev === 'string'), 'solo las canciones (no las fichas ni portadas), cada una con su versión `rev`')

console.log('\nFicha de una canción (migración automática)')
let m1 = await getJson(`/api/song/${encodeURIComponent('1-Eres.zip')}`)
ok(m1.tracks.length === 3, `3 pistas de audio (sin song.json, portada ni __MACOSX): ${m1.tracks.map((t) => t.name).join(', ')}`)
const bat = m1.tracks.find((t) => t.id === 'Eres/tracks/Bat.wav')
const sx = m1.tracks.find((t) => t.id === 'Eres/tracks/Sx.wav')
const bajo = m1.tracks.find((t) => t.id === 'Eres/tracks/Bajo.wav')
ok(bat.name === 'Batería Live' && bat.category === 'drums' && sx.name === 'Saxo alto' && sx.category === 'sax', 'conserva los nombres y categorías que traía el song.json de la app')
ok(bajo.name === 'Bajo' && bajo.category === 'bass', 'sin datos de la app, nombre y categoría por el nombre del archivo')
ok(bat.version === `z${crc32(audio(3)).toString(16).padStart(8, '0')}-${audio(3).length}`, 'versión de pista = CRC32 + tamaño del ZIP')
const m2 = await getJson(`/api/song/${encodeURIComponent('2-Otra.zip')}`)
ok(m2.tracks.map((t) => t.category).join(',') === 'click,acoustic', 'ZIP sin song.json: Click → click, Guitarra Acustica → acoustic')

console.log('\nDescarga por rangos (solo los bytes de una pista)')
for (const t of [bat, sx]) {
  const res = await call('GET', `/api/file/${encodeURIComponent(t.file)}`, { headers: { range: `bytes=${t.range.offset}-${t.range.offset + t.range.length - 1}` } })
  const part = new Uint8Array(await res.arrayBuffer())
  const plain = t.range.method === 8 ? inflateRawSync(part) : Buffer.from(part)
  ok(res.status === 206 && part.length === t.range.length && crc32(plain) === t.range.crc32, `"${t.name}" ${t.range.method === 8 ? 'comprimida' : 'sin comprimir'}: 206, ${part.length} bytes, CRC32 correcto (aunque la cabecera local tenga otro "extra")`)
}
{
  const full = await call('GET', `/api/file/${encodeURIComponent('1-Eres.zip')}`)
  ok(full.status === 200 && full.headers.get('accept-ranges') === 'bytes' && !!full.headers.get('etag'), 'sin rango: el ZIP completo, con ETag y Accept-Ranges (compatible con la app anterior)')
  const again = await call('GET', `/api/file/${encodeURIComponent('1-Eres.zip')}`, { headers: { 'if-none-match': full.headers.get('etag') } })
  ok(again.status === 304, 'If-None-Match con el mismo ETag → 304 (no se vuelve a descargar)')
}

console.log('\nEditar pistas en la web (fuente única)')
{
  const before = env.TRACKS.gets.length
  await getJson(`/api/song/${encodeURIComponent('1-Eres.zip')}`)
  ok(env.TRACKS.gets.filter((g) => g.key === '1-Eres.zip').length === 0 || env.TRACKS.gets.length - before < 4, 'la segunda vez el índice sale de la caché (no se vuelve a leer el ZIP)')
  const revBefore = (await getJson('/api/tracks')).find((s) => s.key === '1-Eres.zip').rev
  const tracks = m1.tracks.map((t) => ({ id: t.id, name: t.id === bajo.id ? 'Bajo eléctrico' : t.name, category: t.category }))
  const bad = await call('PUT', `/api/song/${encodeURIComponent('1-Eres.zip')}/tracks`, { body: { tracks: [{ ...tracks[0], category: 'kazoo' }] } })
  ok(bad.status === 400, 'rechaza una categoría que no está en el catálogo')
  const res = await call('PUT', `/api/song/${encodeURIComponent('1-Eres.zip')}/tracks`, { body: { tracks: [tracks[2], tracks[0], tracks[1]] } })
  ok(res.status === 200, 'el admin renombra una pista y cambia el orden')
  m1 = await getJson(`/api/song/${encodeURIComponent('1-Eres.zip')}`)
  ok(
    m1.tracks.map((t) => t.id).join('|') === [sx.id, bajo.id, bat.id].join('|') && m1.tracks.find((t) => t.id === bajo.id).name === 'Bajo eléctrico',
    'la ficha devuelve el nuevo nombre y el nuevo orden'
  )
  ok(m1.tracks.find((t) => t.id === bat.id).version === bat.version, 'renombrar no cambia la versión del audio (no se vuelve a descargar)')
  const revAfter = (await getJson('/api/tracks')).find((s) => s.key === '1-Eres.zip').rev
  ok(revAfter !== revBefore, 'el `rev` del listado cambia: la app sabe que debe mirar la ficha')
  const meta = await call('PUT', `/api/metadata/${encodeURIComponent('1-Eres.zip')}`, { body: { title: 'Eres Todopoderoso', artist: 'Gosen', key: 'G', timeSignature: { num: 6, den: 8 } } })
  ok(meta.status === 200 && (await getJson(`/api/song/${encodeURIComponent('1-Eres.zip')}`)).tracks.length === 3, 'editar los datos de la canción conserva sus pistas')
  const det = await call('POST', `/api/detected/${encodeURIComponent('1-Eres.zip')}`, { body: { bpm: 96, duration: 245.5 } })
  const m = await getJson(`/api/song/${encodeURIComponent('1-Eres.zip')}`)
  ok(det.status === 200 && m.bpm === 96 && m.duration === 245.5 && m.artist === 'Gosen' && m.keySignature === 'G' && m.timeSignature.num === 6, 'lo detectado por la app (BPM y duración) no pisa lo que puso el admin')
  // Secciones del admin: quedan en la ficha y las reciben todos.
  const revS = (await getJson('/api/tracks')).find((s) => s.key === '1-Eres.zip').rev
  const secs = [{ id: 'b', label: 'Coro 1', time: 30.456 }, { id: 'a', label: 'Intro', time: 0, end: 12 }]
  const ps = await call('POST', `/api/detected/${encodeURIComponent('1-Eres.zip')}`, { body: { bpm: 96, duration: 245.5, sections: secs } })
  const ms = await getJson(`/api/song/${encodeURIComponent('1-Eres.zip')}`)
  ok(ps.status === 200 && ms.sections.map((x) => `${x.label}@${x.time}`).join(',') === 'Intro@0,Coro 1@30.46' && ms.bpm === 96, `las secciones del admin quedan en la ficha (${ms.sections.map((x) => x.label).join(', ')})`)
  ok((await getJson('/api/tracks')).find((s) => s.key === '1-Eres.zip').rev !== revS, 'y cambia el `rev`: las apps de los músicos se ponen al día')
  const badSecs = await call('POST', `/api/detected/${encodeURIComponent('1-Eres.zip')}`, { body: { bpm: 96, sections: [{ id: 'x', label: '', time: -1 }] } })
  ok(badSecs.status === 400, 'secciones mal formadas se rechazan')
  const keep = await call('POST', `/api/detected/${encodeURIComponent('1-Eres.zip')}`, { body: { bpm: 97, duration: 245.5 } })
  ok(keep.status === 200 && (await getJson(`/api/song/${encodeURIComponent('1-Eres.zip')}`)).sections.length === 2, 'mandar solo el BPM no borra las secciones')
  isAdmin = false
  const denied = await call('POST', `/api/detected/${encodeURIComponent('1-Eres.zip')}`, { body: { bpm: 96, sections: [] } })
  isAdmin = true
  ok(denied.status === 403, 'un músico no puede cambiar las secciones de la nube')
}

console.log('\nReemplazar solo el saxofón')
{
  const sax = audio(11, 5000)
  const start = await (await call('POST', `/api/upload/start?name=${encodeURIComponent('Sax nuevo.wav')}&size=${sax.length}&song=${encodeURIComponent('1-Eres.zip')}`)).json()
  ok(start.key.startsWith('tracks/1-Eres.zip/') && start.key.endsWith('.wav'), `la pista suelta se guarda junto a su canción (${start.key.slice(0, 30)}…)`)
  const qs = `key=${encodeURIComponent(start.key)}&uploadId=${start.uploadId}`
  const part = await (await call('PUT', `/api/upload/part?${qs}&n=1`, { body: new Uint8Array(sax) })).json()
  await call('POST', `/api/upload/done?${qs}`, { body: { parts: [part] } })
  const sha256 = createHash('sha256').update(sax).digest('hex')
  const tracks = m1.tracks.map((t) => ({ id: t.id, name: t.name, category: t.category, ...(t.id === sx.id ? { source: { object: start.key, sha256 } } : {}) }))
  const res = await call('PUT', `/api/song/${encodeURIComponent('1-Eres.zip')}/tracks`, { body: { tracks } })
  ok(res.status === 200, 'la ficha apunta el saxofón al archivo nuevo')
  const m = await getJson(`/api/song/${encodeURIComponent('1-Eres.zip')}`)
  const s = m.tracks.find((t) => t.id === sx.id)
  ok(s.version === `s${sha256}` && s.file === start.key && s.size === sax.length && !s.range, 'el saxofón tiene versión nueva (SHA-256), mismo id')
  ok(m.tracks.filter((t) => t.id !== sx.id).every((t) => m1.tracks.find((o) => o.id === t.id).version === t.version), 'las demás pistas conservan su versión: la app solo descargará el saxofón')
  ok(env.TRACKS.objects.has('1-Eres.zip') && env.TRACKS.objects.get('1-Eres.zip').size === zip1.length, 'el ZIP original no se modificó')
  const list2 = await getJson('/api/tracks')
  ok(list2.length === 2 && list2.find((x) => x.key === '1-Eres.zip').size > zip1.length, 'la pista suelta no aparece como canción; su tamaño cuenta en el de la canción')
  // Reemplazarlo otra vez borra el archivo anterior que ya nadie usa.
  const start2 = await (await call('POST', `/api/upload/start?name=s.wav&size=10&song=${encodeURIComponent('1-Eres.zip')}`)).json()
  const qs2 = `key=${encodeURIComponent(start2.key)}&uploadId=${start2.uploadId}`
  const p2 = await (await call('PUT', `/api/upload/part?${qs2}&n=1`, { body: new Uint8Array(audio(13, 10)) })).json()
  await call('POST', `/api/upload/done?${qs2}`, { body: { parts: [p2] } })
  const sha2 = createHash('sha256').update(audio(13, 10)).digest('hex')
  await call('PUT', `/api/song/${encodeURIComponent('1-Eres.zip')}/tracks`, {
    body: { tracks: tracks.map((t) => (t.id === sx.id ? { ...t, source: { object: start2.key, sha256: sha2 } } : t)) }
  })
  ok(!env.TRACKS.objects.has(start.key) && env.TRACKS.objects.has(start2.key), 'reemplazarlo de nuevo borra el archivo anterior que ya nadie usa')
  const bogus = await call('PUT', `/api/song/${encodeURIComponent('1-Eres.zip')}/tracks`, { body: { tracks: [{ id: 'x', name: 'X', category: 'sax', source: { object: 'tracks/otra/x.wav', sha256: sha2 } }] } })
  ok(bogus.status === 400, 'no deja apuntar a archivos de otra canción')
}

console.log('\nVersiones optimizadas (AAC-LC en M4A) hechas por la app del admin')
{
  const enc = encodeURIComponent('1-Eres.zip')
  const before = await getJson(`/api/song/${enc}`)
  const bajo = before.tracks.find((t) => t.id.endsWith('Bajo.wav'))
  const m4a = audio(17, 3000)
  ok((await call('POST', `/api/upload/start?name=x.m4a&size=${m4a.length}&song=${enc}`)).status === 400, 'una pista normal no se puede subir como .m4a (solo como versión optimizada)')
  const st = await (await call('POST', `/api/upload/start?name=${encodeURIComponent('Bajo.m4a')}&size=${m4a.length}&song=${enc}&optimized=1`)).json()
  ok(st.key.startsWith('tracks/1-Eres.zip/opt-') && st.key.endsWith('.m4a'), `la versión optimizada se guarda junto a su canción (${st.key.slice(0, 32)}…)`)
  const q2 = `key=${encodeURIComponent(st.key)}&uploadId=${st.uploadId}`
  const pt = await (await call('PUT', `/api/upload/part?${q2}&n=1`, { body: new Uint8Array(m4a) })).json()
  await call('POST', `/api/upload/done?${q2}`, { body: { parts: [pt] } })
  const sha = createHash('sha256').update(m4a).digest('hex')
  const aac = { frames: 441000, rate: 44100, channels: 1, delay: 1024, packets: 432, bitrate: 128000 }
  const reg = await call('POST', `/api/optimized/${enc}`, { body: { track: bajo.id, file: st.key, size: m4a.length, sha256: sha, aac, source: bajo.version } })
  const m = await getJson(`/api/song/${enc}`)
  const t = m.tracks.find((x) => x.id === bajo.id)
  ok(reg.status === 200 && t.file === st.key && t.version === `a${sha}` && t.sha256 === sha && t.aac.delay === 1024 && t.master === bajo.version && !t.range, 'la ficha entrega la versión AAC (con su retardo del codificador) en lugar del WAV')
  ok(m.tracks.filter((x) => x.id !== bajo.id).every((x) => before.tracks.find((o) => o.id === x.id).version === x.version), 'las demás pistas siguen igual')
  ok(env.TRACKS.objects.has('1-Eres.zip') && env.TRACKS.objects.get('1-Eres.zip').size === zip1.length, 'el WAV maestro (en el ZIP) no se toca')
  const stale = await call('POST', `/api/optimized/${enc}`, { body: { track: bajo.id, file: st.key, size: m4a.length + 1, sha256: sha, aac, source: bajo.version } })
  ok(stale.status === 400, 'no se registra un archivo optimizado incompleto')
  ok((await call('POST', `/api/optimized/${enc}`, { body: { track: bajo.id, file: 'tracks/otra/x.m4a', size: 1, sha256: sha, aac, source: bajo.version } })).status === 400, 'ni uno de otra canción')
  // Si el admin cambia el audio maestro, la versión vieja deja de servir: vuelve el WAV hasta re-optimizarlo.
  const doc = JSON.parse(await (await env.TRACKS.get('metadata/1-Eres.zip')).text())
  doc.optimized[bajo.id].source = 'zviejo-1'
  await env.TRACKS.put('metadata/1-Eres.zip', JSON.stringify(doc))
  const m2 = await getJson(`/api/song/${enc}`)
  ok(m2.tracks.find((x) => x.id === bajo.id).version === bajo.version, 'si cambió el audio maestro, se vuelve a entregar el WAV (nunca un AAC desactualizado)')
  doc.optimized[bajo.id].source = bajo.version
  await env.TRACKS.put('metadata/1-Eres.zip', JSON.stringify(doc))
  // Editar las pistas no borra las versiones optimizadas.
  const cur = await getJson(`/api/song/${enc}`)
  const sheetTracks = JSON.parse(await (await env.TRACKS.get('metadata/1-Eres.zip')).text()).tracks
  await call('PUT', `/api/song/${enc}/tracks`, { body: { tracks: sheetTracks.map((x) => (x.id === bajo.id ? { ...x, name: 'Bajo eléctrico' } : x)) } })
  ok(env.TRACKS.objects.has(st.key) && (await getJson(`/api/song/${enc}`)).tracks.find((x) => x.id === bajo.id).version === `a${sha}`, 'renombrar pistas no borra ni invalida la versión optimizada')
  void cur
  isAdmin = false
  const deny = await call('POST', `/api/optimized/${enc}`, { body: { track: bajo.id, file: st.key, size: m4a.length, sha256: sha, aac, source: bajo.version } })
  isAdmin = true
  ok(deny.status === 403, 'solo el admin registra versiones optimizadas')
}

console.log('\nControl en vivo entre los dispositivos del admin (PC ↔ celular)')
{
  const fake = () => ({ got: [], send(m) { this.got.push(m) } })
  const pc = fake()
  const cel = fake()
  const st = JSON.stringify({ type: 'state', state: { song: 'Eres', position: 12.5, playing: true } })
  let last = relay([pc, cel], pc, st, null)
  ok(cel.got.length === 1 && pc.got.length === 0 && last === st, 'el estado del PC llega al celular (y no vuelve al PC); la sala lo recuerda para quien entre después')
  const cmd = JSON.stringify({ type: 'cmd', cmd: { cmd: 'jump', t: 30 } })
  last = relay([pc, cel], cel, cmd, last)
  ok(pc.got.at(-1) === cmd && last === st, 'la orden del celular (ir a una sección) llega al PC')
  last = relay([pc, cel], cel, '{"type":"otra"}', last)
  last = relay([pc, cel], cel, 'no es json', last)
  ok(pc.got.length === 1, 'mensajes desconocidos o mal formados no se reenvían')
  last = relay([pc, cel], pc, JSON.stringify({ type: 'bye' }), last)
  ok(last === null, 'cuando el PC deja de reproducir, la sala olvida su estado')
  const noTok = await worker.fetch(new Request('https://gosen.test/api/live'), env)
  ok(noTok.status === 401, `sin sesión no se entra a la sala (${noTok.status})`)
  isAdmin = false
  const musician = await worker.fetch(new Request('https://gosen.test/api/live?token=t'), env)
  isAdmin = true
  ok(musician.status === 403, 'solo el administrador usa el control en vivo')
}

console.log('\nPermisos')
{
  isAdmin = false
  ok((await call('PUT', `/api/song/${encodeURIComponent('1-Eres.zip')}/tracks`, { body: { tracks: [] } })).status === 403, 'un músico no puede editar pistas')
  ok((await call('GET', `/api/song/${encodeURIComponent('1-Eres.zip')}`)).status === 200, 'un músico sí puede leer la ficha')
  isAdmin = true
}

console.log('\nPuente para iPhone (/api/proxy)')
{
  const r = await (await call('POST', '/api/proxy', { headers: { authorization: '' }, body: { url: `${env.AUTH_URL}/sign-in/email`, method: 'POST', headers: { 'content-type': 'application/json', 'x-evil': '1' }, body: '{}' } })).json()
  ok(r.status === 200 && r.setCookies.length === 1 && r.headers['set-auth-jwt'] === 'jwt123', 'reenvía a Neon y devuelve cookies y JWT con la forma de la app')
  ok(!('x-evil' in (proxied.at(-1).init.headers ?? {})), 'solo pasa las cabeceras permitidas')
  const blocked = await (await call('POST', '/api/proxy', { headers: { authorization: '' }, body: { url: 'https://example.com/x', method: 'GET' } })).json()
  ok(blocked.status === 403, 'no sirve de puente hacia otros servidores')
}

console.log('\nAcceso comprobado una vez por sesión (descargas por trozos más rápidas)')
{
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  const jwt = (exp) => `${b64({ alg: 'none' })}.${b64({ sub: 'u', exp })}.firma`
  const live = jwt(Math.floor(Date.now() / 1000) + 600)
  const before = accessChecks
  for (let i = 0; i < 5; i++) await call('GET', '/api/tracks', { headers: { authorization: `Bearer ${live}` } })
  ok(accessChecks - before === 1, `5 peticiones seguidas con el mismo JWT: Neon se consulta ${accessChecks - before} vez`)
  const expired = jwt(Math.floor(Date.now() / 1000) - 10)
  const b2 = accessChecks
  for (let i = 0; i < 2; i++) await call('GET', '/api/tracks', { headers: { authorization: `Bearer ${expired}` } })
  ok(accessChecks - b2 === 2, 'un JWT caducado no se guarda (Neon decide cada vez)')
}

console.log('\nBorrar una canción')
{
  await call('DELETE', `/api/file/${encodeURIComponent('1-Eres.zip')}`)
  ok(![...env.TRACKS.objects.keys()].some((k) => k.includes('1-Eres.zip')), 'se borran el ZIP, su ficha, su índice y sus pistas sueltas')
  ok((await getJson('/api/tracks')).length === 1, 'la otra canción sigue')
}

console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodas las comprobaciones pasaron')
process.exit(failures ? 1 : 0)
