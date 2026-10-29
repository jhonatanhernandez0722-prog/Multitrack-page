const MAX_ZIP_INDEX_BYTES = 16 * 1024 * 1024
const MAX_ZIP_ENTRIES = 5000
const MAX_METADATA_BYTES = 1024 * 1024

async function readRange(bucket, key, offset, length) {
  if (length === 0) return new ArrayBuffer(0)
  const object = await bucket.get(key, { range: { offset, length } })
  if (!object?.body) throw new Error('No se pudo leer una parte del ZIP.')
  const bytes = await new Response(object.body).arrayBuffer()
  if (bytes.byteLength !== length) throw new Error('El ZIP está incompleto o dañado.')
  return bytes
}

async function readLimited(stream, limit) {
  const reader = stream.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        throw new Error('La ficha descomprimida supera 1 MB.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export async function extractSongJson(bucket, key) {
  const object = await bucket.head(key)
  if (!object) throw new Error('Ese multitrack no existe.')
  const tailLength = Math.min(object.size, 65_557)
  if (tailLength < 22) return null
  const tailOffset = object.size - tailLength
  const tailBuffer = await readRange(bucket, key, tailOffset, tailLength)
  const tail = new DataView(tailBuffer)
  let endOffset = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50 && i + 22 + tail.getUint16(i + 20, true) === tail.byteLength) {
      endOffset = i
      break
    }
  }
  if (endOffset < 0) throw new Error('No se encontró el índice final del ZIP.')

  const diskNumber = tail.getUint16(endOffset + 4, true)
  const directoryDisk = tail.getUint16(endOffset + 6, true)
  const diskEntries = tail.getUint16(endOffset + 8, true)
  const count = tail.getUint16(endOffset + 10, true)
  const directorySize = tail.getUint32(endOffset + 12, true)
  const directoryOffset = tail.getUint32(endOffset + 16, true)
  if (
    diskNumber !== 0 ||
    directoryDisk !== 0 ||
    diskEntries !== count ||
    count === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new Error('No se admiten ZIP divididos ni formato ZIP64.')
  }
  const endPosition = tailOffset + endOffset
  if (
    count > MAX_ZIP_ENTRIES ||
    directorySize > MAX_ZIP_INDEX_BYTES ||
    directoryOffset + directorySize > endPosition
  ) {
    throw new Error('El índice del ZIP excede el límite permitido o está dañado.')
  }
  if (!count) return null

  const directoryBuffer = await readRange(bucket, key, directoryOffset, directorySize)
  const directory = new DataView(directoryBuffer)
  const decoder = new TextDecoder()
  let offset = 0
  let entry = null
  for (let i = 0; i < count; i++) {
    if (offset + 46 > directory.byteLength || directory.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('El índice del ZIP está dañado.')
    }
    const flags = directory.getUint16(offset + 8, true)
    const method = directory.getUint16(offset + 10, true)
    const compressedSize = directory.getUint32(offset + 20, true)
    const uncompressedSize = directory.getUint32(offset + 24, true)
    const nameLength = directory.getUint16(offset + 28, true)
    const extraLength = directory.getUint16(offset + 30, true)
    const commentLength = directory.getUint16(offset + 32, true)
    const localOffset = directory.getUint32(offset + 42, true)
    const nameStart = offset + 46
    const next = nameStart + nameLength + extraLength + commentLength
    if (next > directory.byteLength) throw new Error('El índice del ZIP está incompleto.')
    const name = decoder.decode(new Uint8Array(directoryBuffer, nameStart, nameLength))
    if (name.replace(/\\/g, '/').split('/').pop().toLowerCase() === 'song.json') {
      entry = { flags, method, compressedSize, uncompressedSize, localOffset }
      break
    }
    offset = next
  }
  if (!entry) return null
  if (
    (entry.flags & 1) !== 0 ||
    entry.compressedSize === 0xffffffff ||
    entry.uncompressedSize === 0xffffffff ||
    entry.localOffset === 0xffffffff ||
    entry.uncompressedSize > MAX_METADATA_BYTES ||
    entry.compressedSize > MAX_METADATA_BYTES
  ) {
    throw new Error('La ficha del ZIP está cifrada, usa ZIP64 o supera 1 MB.')
  }

  const localHeaderBuffer = await readRange(bucket, key, entry.localOffset, 30)
  const localHeader = new DataView(localHeaderBuffer)
  if (localHeader.getUint32(0, true) !== 0x04034b50) throw new Error('La ficha del ZIP está dañada.')
  const dataOffset = entry.localOffset + 30 + localHeader.getUint16(26, true) + localHeader.getUint16(28, true)
  if (dataOffset + entry.compressedSize > object.size) throw new Error('La ficha del ZIP está incompleta.')
  const compressed = await readRange(bucket, key, dataOffset, entry.compressedSize)
  let contents
  if (entry.method === 0) {
    contents = new Uint8Array(compressed)
  } else if (entry.method === 8 && typeof DecompressionStream === 'function') {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    contents = await readLimited(stream, MAX_METADATA_BYTES)
  } else {
    throw new Error('La compresión de song.json no es compatible.')
  }
  if (contents.byteLength !== entry.uncompressedSize) throw new Error('La ficha del ZIP está incompleta o dañada.')
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contents))
}
