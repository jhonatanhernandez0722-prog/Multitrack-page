/** R2 simulado en memoria, generador de ZIP de prueba y audio sintético (para las pruebas del Worker). */
import { createHash, randomUUID } from 'node:crypto'
import { crc32, deflateRawSync } from 'node:zlib'

// --- R2 simulado -----------------------------------------------------------------------------
export class Obj {
  constructor(key, bytes, opts = {}) {
    this.key = key
    this.bytes = bytes
    this.size = bytes.byteLength
    this.etag = createHash('md5').update(bytes).digest('hex') + randomUUID().slice(0, 4)
    this.httpEtag = `"${this.etag}"`
    this.uploaded = new Date()
    this.customMetadata = opts.customMetadata ?? {}
    this.httpMetadata = opts.httpMetadata ?? {}
  }
  get body() {
    return new Blob([this.bytes]).stream()
  }
  text() {
    return Promise.resolve(new TextDecoder().decode(this.bytes))
  }
}
export class FakeBucket {
  objects = new Map()
  gets = []
  async head(key) {
    return this.objects.get(key) ?? null
  }
  async get(key, opts = {}) {
    const o = this.objects.get(key)
    if (!o) return null
    this.gets.push({ key, range: opts.range ?? null })
    if (!opts.range) return o
    const view = Object.create(o)
    const part = o.bytes.subarray(opts.range.offset, opts.range.offset + opts.range.length)
    Object.defineProperty(view, 'body', { get: () => new Blob([part]).stream() })
    view.text = () => Promise.resolve(new TextDecoder().decode(part))
    return view
  }
  async put(key, value, opts = {}) {
    if (opts.onlyIf?.etagDoesNotMatch === '*' && this.objects.has(key)) return null
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
    const o = new Obj(key, bytes, opts)
    this.objects.set(key, o)
    return o
  }
  async list({ prefix = '' } = {}) {
    return { objects: [...this.objects.values()].filter((o) => o.key.startsWith(prefix)), truncated: false }
  }
  async delete(keys) {
    for (const k of [keys].flat()) this.objects.delete(k)
  }
  createMultipartUpload(key, opts) {
    this.uploads ??= new Map()
    const uploadId = randomUUID()
    this.uploads.set(uploadId, { key, opts, parts: [] })
    return { uploadId }
  }
  resumeMultipartUpload(key, uploadId) {
    const up = this.uploads.get(uploadId)
    return {
      uploadPart: async (n, body) => {
        up.parts[n - 1] = new Uint8Array(await new Response(body).arrayBuffer())
        return { partNumber: n, etag: `p${n}` }
      },
      complete: async () => {
        const total = up.parts.reduce((s, p) => s + p.byteLength, 0)
        const all = new Uint8Array(total)
        let o = 0
        for (const p of up.parts) {
          all.set(p, o)
          o += p.byteLength
        }
        await this.put(key, all, up.opts)
      },
      abort: async () => this.uploads.delete(uploadId)
    }
  }
}

// --- ZIP de prueba (una pista guardada sin comprimir, el resto con deflate) ---------------------
export function makeZip(files) {
  const local = []
  const central = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name)
    const data = Buffer.from(f.data)
    const stored = f.store === true
    const comp = stored ? data : deflateRawSync(data)
    const crc = crc32(data)
    const extra = Buffer.alloc(f.extra ?? 0) // "extra" distinto en la cabecera local que en el índice
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(stored ? 0 : 8, 8)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(comp.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(name.length, 26)
    lh.writeUInt16LE(extra.length, 28)
    local.push(lh, name, extra, comp)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(stored ? 0 : 8, 10)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(comp.length, 20)
    ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(offset, 42)
    central.push(ch, name)
    offset += 30 + name.length + extra.length + comp.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...local, cd, end]))
}
export const audio = (seed, n = 4000) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + (i >> 3)) & 255))
