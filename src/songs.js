/**
 * Ficha completa de una canción: la FUENTE ÚNICA de sus metadatos y de sus pistas.
 *
 * En R2:
 *   <clave>              ZIP original que subió el admin (nunca se modifica)
 *   metadata/<clave>     ficha: datos de la canción y, cuando el admin las edita, sus pistas
 *                        (customMetadata.data lleva solo los datos de la canción, para el listado)
 *   index/<clave>        caché del índice de pistas del ZIP (se puede borrar: se vuelve a calcular)
 *   tracks/<clave>/…     pistas sueltas que el admin reemplazó o añadió
 *
 * Cada pista tiene una versión: "z<crc32>-<tamaño>" si sale del ZIP (el CRC32 que guarda el propio
 * ZIP) o "s<sha256>" si es un archivo suelto. La app compara versiones pista a pista y descarga solo
 * las que cambiaron; las del ZIP las pide por rango de bytes (solo esa pista).
 */
import { CATEGORY_IDS, guessTrack, isAudioFile } from './catalog.js'
import { extractSongJson, readCentralDirectory, readZipIndex } from './zipMetadata.js'

export const METADATA = 'metadata/'
export const INDEX = 'index/'
export const TRACK_FILES = 'tracks/'
export const trackPrefix = (songKey) => `${TRACK_FILES}${songKey}/`

const INDEX_SCHEMA = 1
const MAX_TRACKS = 64

/** Entradas del ZIP que son pistas (mismas reglas que la app: WAV/MP3, sin ocultos ni __MACOSX). */
export function isTrackEntry(e) {
  if (e.name.endsWith('/') || (e.flags & 1) !== 0) return false
  if (e.name.split('/').some((s) => s.startsWith('.') || s === '__MACOSX')) return false
  if (e.compressedSize === 0xffffffff || e.uncompressedSize === 0xffffffff) return false
  return isAudioFile(e.name) && (e.method === 0 || e.method === 8)
}

const hex8 = (n) => (n >>> 0).toString(16).padStart(8, '0')
const fileName = (name) => name.split('/').pop()

/** Ficha guardada: { doc, etag } o null. */
export async function readSheet(bucket, key) {
  const obj = await bucket.get(METADATA + key)
  if (!obj) return null
  let doc = {}
  try {
    doc = JSON.parse(await obj.text())
  } catch {
    doc = obj.customMetadata?.data ? JSON.parse(obj.customMetadata.data) : {}
  }
  return { doc: doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {}, etag: obj.etag }
}

/** Datos de la canción (lo que va en el listado) a partir de la ficha. */
export function songFields(doc) {
  return {
    title: doc.title ?? null,
    artist: doc.artist ?? null,
    duration: doc.duration ?? null,
    bpm: doc.bpm ?? null,
    key: doc.key ?? null,
    timeSignature: doc.timeSignature ?? null
  }
}

/** Guarda la ficha: el cuerpo completo y, aparte, los datos de la canción para el listado. */
export async function writeSheet(bucket, key, doc, onlyIf) {
  const data = JSON.stringify(songFields(doc))
  return bucket.put(METADATA + key, JSON.stringify(doc), {
    ...(onlyIf ? { onlyIf } : {}),
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { data }
  })
}

/** Índice de las pistas del ZIP (de la caché si el ZIP no cambió; si no, se lee por rangos). */
export async function zipTrackIndex(bucket, key) {
  const head = await bucket.head(key)
  if (!head) return null
  const cached = await bucket.get(INDEX + key)
  if (cached) {
    try {
      const idx = JSON.parse(await cached.text())
      if (idx.schema === INDEX_SCHEMA && idx.etag === head.etag) return idx
    } catch {
      // Caché dañada: se recalcula.
    }
  }
  const central = await readCentralDirectory(bucket, key)
  const { entries } = await readZipIndex(bucket, key, isTrackEntry, central)
  let songJson = null
  try {
    songJson = await extractSongJson(bucket, key, central)
  } catch {
    songJson = null
  }
  // Nombres y tipos que la app ya había puesto (si el ZIP trae su song.json): se conservan.
  const fromApp = new Map()
  if (songJson && Array.isArray(songJson.tracks)) {
    for (const t of songJson.tracks) {
      if (t && typeof t.file === 'string') fromApp.set(fileName(t.file).toLowerCase(), t)
    }
  }
  const idx = {
    schema: INDEX_SCHEMA,
    etag: head.etag,
    entries: entries
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
      .map((e) => {
        const guess = guessTrack(fileName(e.name))
        const prior = fromApp.get(fileName(e.name).toLowerCase())
        return {
          ...e,
          name: e.name,
          defaultName: typeof prior?.name === 'string' && prior.name.trim() ? prior.name.trim().slice(0, 80) : guess.name,
          defaultCategory: typeof prior?.type === 'string' && CATEGORY_IDS.has(prior.type) ? prior.type : guess.category
        }
      })
  }
  await bucket.put(INDEX + key, JSON.stringify(idx), { httpMetadata: { contentType: 'application/json' } })
  return idx
}

/** Pistas de la ficha; si el admin aún no las configuró, las del ZIP con sus valores sugeridos. */
export function configuredTracks(doc, idx) {
  if (Array.isArray(doc.tracks) && doc.tracks.length) return doc.tracks
  return idx.entries.map((e) => ({ id: e.name, name: e.defaultName, category: e.defaultCategory, source: 'zip' }))
}

/**
 * Ficha resuelta para la app: datos de la canción y cada pista con su versión y de dónde se descarga.
 * `rev` cambia cuando cambia algo (ZIP o ficha), para que la app sepa cuándo volver a mirar.
 */
export async function songManifest(bucket, key) {
  const idx = await zipTrackIndex(bucket, key)
  if (!idx) return null
  const sheet = await readSheet(bucket, key)
  const doc = sheet?.doc ?? {}
  const byName = new Map(idx.entries.map((e) => [e.name, e]))
  const tracks = []
  for (const t of configuredTracks(doc, idx)) {
    if (t.source && typeof t.source === 'object') {
      tracks.push({
        id: t.id,
        name: t.name,
        category: t.category,
        file: t.source.object,
        size: t.source.size,
        sha256: t.source.sha256,
        version: `s${t.source.sha256}`
      })
      continue
    }
    const e = byName.get(t.id)
    if (!e) continue
    tracks.push({
      id: t.id,
      name: t.name,
      category: t.category,
      file: key,
      size: e.uncompressedSize,
      version: `z${hex8(e.crc32)}-${e.uncompressedSize}`,
      range: { offset: e.dataOffset, length: e.compressedSize, method: e.method, crc32: e.crc32 }
    })
  }
  return {
    key,
    rev: `${idx.etag}:${sheet?.etag ?? '-'}`,
    title: doc.title ?? null,
    artist: doc.artist ?? null,
    keySignature: doc.key ?? null,
    timeSignature: doc.timeSignature ?? null,
    bpm: doc.bpm ?? null,
    duration: doc.duration ?? null,
    sections: Array.isArray(doc.sections) ? doc.sections : null,
    tracks
  }
}

/**
 * Valida las pistas que manda el admin. Las del ZIP deben existir en él; las sueltas, estar subidas
 * en tracks/<clave>/ con el tamaño indicado. Devuelve la lista limpia o lanza un error legible.
 */
export async function normalizeTracks(bucket, key, raw, idx) {
  if (!Array.isArray(raw) || !raw.length) throw new Error('La canción necesita al menos una pista.')
  if (raw.length > MAX_TRACKS) throw new Error(`Una canción puede tener como máximo ${MAX_TRACKS} pistas.`)
  const entries = new Set(idx.entries.map((e) => e.name))
  const seen = new Set()
  const out = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') throw new Error('Pista no válida.')
    const id = typeof t.id === 'string' ? t.id.trim() : ''
    if (!id || id.length > 300 || seen.has(id)) throw new Error('Cada pista necesita un identificador único.')
    seen.add(id)
    const name = typeof t.name === 'string' ? t.name.trim() : ''
    if (!name || name.length > 80) throw new Error('Cada pista necesita un nombre (máximo 80 caracteres).')
    if (!CATEGORY_IDS.has(t.category)) throw new Error(`La categoría de "${name}" no es válida.`)
    if (t.source && typeof t.source === 'object') {
      const object = String(t.source.object ?? '')
      const sha256 = String(t.source.sha256 ?? '').toLowerCase()
      if (!object.startsWith(trackPrefix(key)) || !isAudioFile(object)) throw new Error(`El archivo de "${name}" no es válido.`)
      if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Falta la huella del archivo de "${name}".`)
      const head = await bucket.head(object)
      if (!head) throw new Error(`El archivo de "${name}" no terminó de subirse.`)
      out.push({ id, name, category: t.category, source: { object, sha256, size: head.size } })
    } else {
      if (!entries.has(id)) throw new Error(`"${name}" no está en el ZIP de la canción.`)
      out.push({ id, name, category: t.category, source: 'zip' })
    }
  }
  return out
}

/** Borra las pistas sueltas que ya no usa ninguna pista de la ficha (p. ej. tras reemplazarla otra vez). */
export async function deleteOrphanTrackFiles(bucket, key, tracks) {
  const used = new Set(tracks.flatMap((t) => (t.source && typeof t.source === 'object' ? [t.source.object] : [])))
  const orphans = []
  let cursor
  do {
    const page = await bucket.list({ prefix: trackPrefix(key), cursor })
    for (const o of page.objects) if (!used.has(o.key)) orphans.push(o.key)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  if (orphans.length) await bucket.delete(orphans)
  return orphans.length
}
