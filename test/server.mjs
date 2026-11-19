/**
 * Servidor local para probar el panel del admin en un navegador real: sirve el Worker de verdad
 * (src/index.js) con R2 simulado en memoria y Neon simulado (cualquier correo entra como admin).
 * /__test/state devuelve el contenido del bucket para comprobar lo guardado; /__test/consents, el
 * registro de aceptaciones simulado. Con GOSEN_LEGAL_PREVIEW (JSON {owner, effective}) los documentos
 * legales están en vigor y el panel pide las aceptaciones. /fonts/… se sirve de public/ (como Cloudflare).
 *
 * Uso: node --import ./test/register.mjs test/server.mjs   (imprime "PORT <n>")
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import worker from '../src/index.js'
import { FakeBucket, audio, makeZip } from './fakes.mjs'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = () => `${b64({ alg: 'none' })}.${b64({ sub: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`

const env = {
  TRACKS: new FakeBucket(),
  AUTH_URL: 'https://ep-x.neonauth.test.neon.tech/neondb/auth',
  DATA_API_URL: 'https://ep-x.apirest.test.neon.tech/neondb/rest/v1',
  MAX_TOTAL_BYTES: '0',
  MAX_FILE_BYTES: '2147483648',
  ...(process.env.GOSEN_LEGAL_PREVIEW ? { LEGAL_PREVIEW: process.env.GOSEN_LEGAL_PREVIEW } : {})
}
// Registro de aceptaciones simulado (mismas respuestas que las funciones de sql/legal-consentimientos.sql).
const consents = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  const u = String(url)
  if (u.endsWith('/rpc/gosen_my_access')) return new Response(JSON.stringify({ allowed: true, admin: true, email: 'admin@iglesia.com' }))
  const rpc = u.split('/rpc/')[1]
  if (rpc === 'gosen_record_consent') {
    const b = JSON.parse(init.body)
    const rows = b.p_items.map((it) => {
      const row = { ...it, email: 'admin@iglesia.com', operation: b.p_operation, channel: b.p_channel, event_id: crypto.randomUUID(), recorded_at: new Date().toISOString(), row_hash: crypto.randomUUID().replace(/-/g, '').padEnd(64, '0') }
      if (!consents.some((c) => c.operation === row.operation && c.document === row.document && c.action === row.action)) consents.push(row)
      return row
    })
    return new Response(JSON.stringify(rows))
  }
  if (rpc === 'gosen_my_consents') {
    const out = ['privacidad', 'terminos'].map((d) => consents.filter((c) => c.document === d).at(-1)).filter(Boolean)
    return new Response(JSON.stringify(out.map((c) => ({ document: c.document, action: c.action, version: c.version, content_sha256: c.sha256, effective_date: c.effective, recorded_at: c.recorded_at, event_id: c.event_id }))))
  }
  if (rpc === 'gosen_consent_evidence') {
    return new Response(JSON.stringify(consents.slice().reverse().map((c) => ({ event_id: c.event_id, subject_email: c.email, document: c.document, version: c.version, action: c.action, channel: c.channel, recorded_at: c.recorded_at, row_hash: c.row_hash, anonymized: false }))))
  }
  if (rpc === 'gosen_consent_verify') return new Response(JSON.stringify([{ total: consents.length, intact: true, first_broken_id: null }]))
  if (rpc === 'gosen_2fa_status') return new Response(JSON.stringify({ enabled: false, required: false }))
  // Cualquier otra función: como si Neon aún no tuviera la actualización (nunca se sale a internet).
  if (rpc) return new Response(JSON.stringify({ code: 'PGRST202', message: `Could not find the function public.${rpc}` }), { status: 404 })
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
  if (req.url === '/__test/consents') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(consents))
  }
  // Archivos estáticos de public/ (fuentes), como los sirve Cloudflare antes del Worker.
  if (req.url.startsWith('/fonts/')) {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts', path.basename(req.url.split('?')[0]))
    try {
      const data = await readFile(file)
      res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'text/plain' })
      return res.end(data)
    } catch {
      res.writeHead(404)
      return res.end()
    }
  }
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
