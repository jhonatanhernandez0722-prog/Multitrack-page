/**
 * Servicios (programación del equipo): la fuente única es la nube. El admin los crea y edita desde la
 * app; todos los integrantes autorizados los leen. Uno por archivo en R2: services/<id>.json.
 *
 * Cada servicio guarda nombre, fecha, hora, descripción, integrantes (correo + función; nombre y
 * etiqueta solo como respaldo para mostrar) y sus canciones (por la clave de la canción en la nube).
 * Si dos equipos del admin lo cambian, gana el cambio más nuevo (updatedAt): uno viejo no pisa a uno nuevo.
 */
export const SERVICES = 'services/'

const ID_RE = /^[A-Za-z0-9-]{8,64}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+$/
const SLUG_RE = /^[a-z0-9-]{1,32}$/
const END_ACTIONS = ['wait', 'continue', 'overlap', 'crossfade', 'trigger']

export const isServiceId = (id) => ID_RE.test(String(id ?? ''))

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 100) / 100 : undefined)

/** Servicio validado (lanza un Error con el motivo si no sirve). */
export function normalizeService(raw, id, who) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('El servicio no es válido.')
  const name = str(raw.name, 120)
  if (!name) throw new Error('El servicio necesita un nombre.')
  if (typeof raw.updatedAt !== 'string' || Number.isNaN(Date.parse(raw.updatedAt))) throw new Error('Falta la fecha del cambio.')
  if (raw.date !== undefined && raw.date !== null && !DATE_RE.test(raw.date)) throw new Error('La fecha no es válida.')
  if (raw.time !== undefined && raw.time !== null && !TIME_RE.test(raw.time)) throw new Error('La hora no es válida.')
  const seen = new Set()
  const members = []
  for (const m of Array.isArray(raw.members) ? raw.members.slice(0, 200) : []) {
    const email = typeof m?.email === 'string' ? m.email.trim().toLowerCase() : ''
    if (!EMAIL_RE.test(email) || seen.has(email)) continue
    seen.add(email)
    members.push({
      email,
      ...(str(m.name, 80) ? { name: str(m.name, 80) } : {}),
      ...(typeof m.tag === 'string' && SLUG_RE.test(m.tag) ? { tag: m.tag } : {}),
      ...(typeof m.role === 'string' && SLUG_RE.test(m.role) ? { role: m.role } : {})
    })
  }
  const items = []
  for (const it of Array.isArray(raw.items) ? raw.items.slice(0, 200) : []) {
    const title = str(it?.title, 160)
    if (!title) continue
    items.push({
      id: str(it.id, 64) ?? crypto.randomUUID(),
      title,
      ...(str(it.cloudKey, 300) ? { cloudKey: str(it.cloudKey, 300) } : {}),
      onEnd: END_ACTIONS.includes(it.onEnd) ? it.onEnd : 'wait',
      gapSeconds: num(it.gapSeconds, 0, 60) ?? 3,
      ...(num(it.transitionSeconds, 0.5, 30) !== undefined ? { transitionSeconds: num(it.transitionSeconds, 0.5, 30) } : {}),
      ...(num(it.startAt, 0, 36000) ? { startAt: num(it.startAt, 0, 36000) } : {}),
      ...(num(it.endAt, 0.5, 36000) !== undefined ? { endAt: num(it.endAt, 0.5, 36000) } : {}),
      ...(num(it.fadeOutSeconds, 0, 30) ? { fadeOutSeconds: num(it.fadeOutSeconds, 0, 30) } : {})
    })
  }
  return {
    id,
    name,
    ...(raw.date ? { date: raw.date } : {}),
    ...(raw.time ? { time: raw.time } : {}),
    ...(str(raw.description, 1000) ? { description: str(raw.description, 1000) } : {}),
    members,
    items,
    updatedAt: new Date(Date.parse(raw.updatedAt)).toISOString(),
    updatedBy: who?.email ?? null
  }
}

/** Todos los servicios (para cualquier integrante autorizado). */
export async function listServices(bucket) {
  const out = []
  let cursor
  do {
    const page = await bucket.list({ prefix: SERVICES, cursor })
    for (const o of page.objects) {
      const obj = await bucket.get(o.key)
      if (!obj) continue
      try {
        out.push(JSON.parse(await obj.text()))
      } catch {
        // archivo dañado: se ignora
      }
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return out.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.time ?? '').localeCompare(b.time ?? '') || a.name.localeCompare(b.name))
}

async function readService(bucket, id) {
  const obj = await bucket.get(`${SERVICES}${id}.json`)
  if (!obj) return null
  try {
    return JSON.parse(await obj.text())
  } catch {
    return null
  }
}

/** Guarda el servicio. Si en la nube hay uno más nuevo, no lo pisa: devuelve { conflict: actual }. */
export async function putService(bucket, doc) {
  const current = await readService(bucket, doc.id)
  if (current && Date.parse(current.updatedAt) > Date.parse(doc.updatedAt)) return { conflict: current }
  await bucket.put(`${SERVICES}${doc.id}.json`, JSON.stringify(doc), { httpMetadata: { contentType: 'application/json' } })
  return { service: doc }
}

export async function deleteService(bucket, id) {
  await bucket.delete(`${SERVICES}${id}.json`)
}
