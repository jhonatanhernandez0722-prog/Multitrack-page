/**
 * Servidor local para probar el panel del admin en un navegador real: sirve el Worker de verdad
 * (src/index.js) con R2 simulado en memoria y Neon simulado (cualquier correo entra como admin).
 * /__test/state devuelve el contenido del bucket para comprobar lo guardado.
 *
 * Uso: node --import ./test/register.mjs test/server.mjs   (imprime "PORT <n>")
 */
import http from 'node:http'
import worker from '../src/index.js'
import { FakeBucket, audio, makeZip } from './fakes.mjs'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = () => `${b64({ alg: 'none' })}.${b64({ sub: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`

const env = {
  TRACKS: new FakeBucket(),
  AUTH_URL: 'https://ep-x.neonauth.test.neon.tech/neondb/auth',
  DATA_API_URL: 'https://ep-x.apirest.test.neon.tech/neondb/rest/v1',
  MAX_TOTAL_BYTES: '0',
  MAX_FILE_BYTES: '2147483648'
}
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  const u = String(url)
  if (u.endsWith('/rpc/gosen_my_access')) return new Response(JSON.stringify({ allowed: true, admin: true, email: 'admin@iglesia.com' }))
  if (u.endsWith('/sign-in/email')) return new Response('{}', { headers: { 'set-cookie': 's=1; Path=/', 'set-auth-jwt': jwt() } })
  if (u.endsWith('/token')) return new Response(JSON.stringify({ token: jwt() }))
  return realFetch(url, init)
}

const songJson = JSON.stringify({ name: 'Eres Todopoderoso', tracks: [{ file: 'tracks/Sax.wav', name: 'Saxo alto', type: 'sax' }] })
await env.TRACKS.put(
  '1700000000000-Eres.zip',
  makeZip([
    { name: 'Eres/song.json', data: songJson },
    { name: 'Eres/tracks/Bateria.wav', data: audio(3) },
    { name: 'Eres/tracks/Sax.wav', data: audio(5) },
    { name: 'Eres/tracks/Bajo.wav', data: audio(7) }
  ]),
  { customMetadata: { name: 'Eres.zip' } }
)
await env.TRACKS.put('metadata/1700000000000-Eres.zip', JSON.stringify({ title: 'Eres Todopoderoso', bpm: 96, duration: 245 }), {
  customMetadata: { data: JSON.stringify({ title: 'Eres Todopoderoso', bpm: 96, duration: 245 }) }
})

const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = Buffer.concat(chunks)
  if (req.url === '/__test/state') {
    const out = {}
    for (const [k, o] of env.TRACKS.objects) out[k] = { size: o.size, text: k.startsWith('metadata/') ? new TextDecoder().decode(o.bytes) : undefined }
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(out))
  }
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body
  })
  const response = await worker.fetch(request, env)
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(Buffer.from(await response.arrayBuffer()))
})
server.listen(0, '127.0.0.1', () => console.log(`PORT ${server.address().port}`))
