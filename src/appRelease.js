/**
 * Versiones de la app para descargar (Windows, Mac, Android) y para que la app sepa si hay una nueva.
 *
 * Los instaladores se publican en GitHub Releases de este repositorio (público): descarga gratis y sin
 * límite. Cada publicación trae latest.json (versión, novedades y cada archivo con tamaño y sha256).
 * El Worker lee la de la última publicación (con caché) y la sirve en /api/app/latest; la página y
 * /descargar/<plataforma> llevan al instalador de esa versión. Publicar una versión nueva no requiere
 * volver a desplegar el Worker.
 */
const DEFAULT_REPO = 'jhonatanhernandez0722-prog/Multitrack-page'
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/
export const APP_PLATFORMS = ['windows', 'mac', 'android']

export function releasesRepo(env) {
  const r = String(env?.APP_RELEASES_REPO || DEFAULT_REPO)
  return /^[\w.-]+\/[\w.-]+$/.test(r) ? r : DEFAULT_REPO
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function cleanNotes(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const n of raw.slice(0, 30)) {
    if (!n || typeof n !== 'object') continue
    const version = text(n.version, 20)
    if (!VERSION_RE.test(version)) continue
    const items = Array.isArray(n.items) ? n.items.map((i) => text(i, 400)).filter(Boolean).slice(0, 30) : []
    out.push({ version, date: text(n.date, 10), title: text(n.title, 120), items })
  }
  return out
}

/** Valida latest.json: solo archivos de las publicaciones de este repositorio, con su sha256. */
export function cleanLatest(raw, repo) {
  if (!raw || typeof raw !== 'object') return null
  const version = text(raw.version, 20)
  if (!VERSION_RE.test(version)) return null
  const prefix = `https://github.com/${repo}/releases/download/`
  const files = {}
  const rawFiles = raw.files && typeof raw.files === 'object' ? raw.files : {}
  for (const key of APP_PLATFORMS) {
    const f = rawFiles[key]
    if (!f || typeof f !== 'object') continue
    const url = text(f.url, 500)
    const sha256 = text(f.sha256, 64).toLowerCase()
    const size = Number.isSafeInteger(f.size) && f.size > 0 ? f.size : 0
    const name = text(f.name, 120)
    if (!url.startsWith(prefix) || url.includes('..') || !/^[0-9a-f]{64}$/.test(sha256) || !size || !/^[\w.-]+$/.test(name)) continue
    files[key] = { name, url, size, sha256 }
  }
  return { version, date: text(raw.date, 10), notes: cleanNotes(raw.notes), files }
}

let memo = { at: 0, repo: '', value: null }
/** Autoprueba: olvidar la última ficha leída. */
export function resetLatestCache() {
  memo = { at: 0, repo: '', value: null }
}

/** Ficha de la última versión publicada (null si todavía no hay o GitHub no responde). */
export async function latestRelease(env) {
  const repo = releasesRepo(env)
  if (memo.value && memo.repo === repo && Date.now() - memo.at < 60_000) return memo.value
  try {
    const r = await fetch(`https://github.com/${repo}/releases/latest/download/latest.json`, {
      headers: { 'user-agent': 'gosen-tracks-worker', accept: 'application/json' },
      cf: { cacheTtl: 300, cacheEverything: true }
    })
    if (!r.ok) return memo.repo === repo ? memo.value : null
    const value = cleanLatest(await r.json(), repo)
    if (value) memo = { at: Date.now(), repo, value }
    return value
  } catch {
    return memo.repo === repo ? memo.value : null
  }
}

const NAMES = { windows: 'Windows', mac: 'Mac', android: 'Android' }

/** /descargar/<plataforma>: al instalador de la última versión (iPhone: a su app web). */
export async function downloadRedirect(platform, env) {
  if (platform === 'iphone') return new Response(null, { status: 302, headers: { location: '/iphone/' } })
  const latest = await latestRelease(env)
  const file = latest?.files?.[platform]
  if (file) return new Response(null, { status: 302, headers: { location: file.url, 'cache-control': 'no-store' } })
  const name = NAMES[platform] ?? platform
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Descargar Gosen</title>` +
      `<style>body{font:17px/1.5 system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:0 16px;color:#16141f;background:#f5f4f9}a{color:#5a2ee0}</style></head>` +
      `<body><h1>La versión para ${name} todavía no está publicada</h1><p>Vuelve a intentarlo en unos minutos, o escríbenos para recibirla.</p><p><a href="/">Volver a Gosen Tracks</a></p></body></html>`,
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
  )
}
