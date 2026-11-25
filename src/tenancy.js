/**
 * Varias iglesias en el mismo bucket R2, cada una aislada.
 *
 *  - La iglesia interna («gosen») usa las claves de siempre: canciones en la raíz (`<ts>-<nombre>.zip`),
 *    `metadata/<clave>`, `covers/<clave>`, `tracks/<clave>/…`, `services/<id>.json`. No se mueve nada.
 *  - Cada iglesia nueva usa el prefijo `c/<church_id>/`: canciones `c/<id>/<ts>-<nombre>.zip`, y sus
 *    fichas, portadas y pistas quedan en `metadata/c/<id>/…`, `covers/c/<id>/…`, `tracks/c/<id>/…`;
 *    los servicios en `c/<id>/services/<id>.json`; el logo en `branding/<id>/logo`.
 *
 * La clave de una canción sigue siendo opaca para la app. En cada petición el Worker comprueba con
 * `keyOwner` que la clave sea de la iglesia de la sesión (si no, responde como si no existiera).
 *
 * Funciones por plan: `can(me, feature)` con la lista que entrega Neon (gosen_my_access → features).
 * Si Neon aún no tiene la actualización v37 (no hay `church` en el acceso), todo sigue como antes:
 * iglesia interna con todas las funciones.
 */
export const INTERNAL = 'gosen'
export const CHURCH_PREFIX = 'c/'
const AUX_PREFIXES = ['metadata/', 'covers/', 'index/', 'tracks/']
const CHURCH_RE = /^[a-z0-9][a-z0-9-]{2,39}$/

/** Iglesia de la sesión (la interna si Neon todavía no sabe de iglesias). */
export function churchOf(me) {
  const id = me?.church?.id
  return typeof id === 'string' && CHURCH_RE.test(id) ? id : INTERNAL
}

/** Prefijo de las canciones de una iglesia ('' para la interna). */
export const songPrefix = (church) => (church === INTERNAL ? '' : `${CHURCH_PREFIX}${church}/`)

/** Prefijo de los servicios de una iglesia. */
export const servicesPrefix = (church) => (church === INTERNAL ? 'services/' : `${CHURCH_PREFIX}${church}/services/`)

/** Carpeta del logo y la personalización de una iglesia. */
export const brandingPrefix = (church) => `branding/${church}/`

/** Iglesia dueña de la clave de una canción (`c/<id>/…` o, si no, la interna). */
export function churchOfSongKey(key) {
  if (typeof key !== 'string') return null
  if (!key.startsWith(CHURCH_PREFIX)) return INTERNAL
  const id = key.split('/')[1]
  return CHURCH_RE.test(id || '') ? id : null
}

/**
 * Iglesia dueña de CUALQUIER objeto (canción, ficha, portada, índice o pista suelta). null si la clave
 * no es de ninguna (p. ej. `system/…`): nadie la puede pedir.
 */
export function keyOwner(key) {
  if (typeof key !== 'string' || !key || key.includes('..') || key.startsWith('/') || key.startsWith('system/') || key.startsWith('branding/')) return null
  const aux = AUX_PREFIXES.find((p) => key.startsWith(p))
  return churchOfSongKey(aux ? key.slice(aux.length) : key)
}

/** La canción a la que pertenece una pista suelta (`tracks/<clave de la canción>/<archivo>`). */
export function trackSongKey(objectKey) {
  const rest = objectKey.slice('tracks/'.length)
  const parts = rest.split('/')
  return rest.startsWith(CHURCH_PREFIX) ? parts.slice(0, 3).join('/') : parts[0]
}

/** ¿La sesión puede usar esta función de su plan? (sin datos de plan → todo, como antes de v37) */
export function can(me, feature) {
  if (!me) return false
  if (!Array.isArray(me.features)) return true
  return me.features.includes(feature)
}

/** Nombres de las funciones (para los mensajes cuando el plan no las incluye). */
export const FEATURE_LABELS = {
  reproductor: 'Reproductor multitrack',
  biblioteca: 'Biblioteca de canciones',
  click_guia: 'Click y guía',
  mezclador: 'Mezclador',
  repertorios: 'Repertorios',
  ensayo_individual: 'Ensayo individual',
  programacion_basica: 'Programación básica',
  ensayo_multiple: 'Ensayo múltiple sincronizado',
  programacion_completa: 'Programación completa de servicios',
  asignacion_integrantes: 'Asignación de músicos y cantantes',
  exportar_excel: 'Exportación a Excel',
  letras_acordes: 'Letras y acordes',
  letras_secciones: 'Organización por secciones',
  transposicion_acordes: 'Transposición de acordes',
  letras_sincronizadas: 'Letras sincronizadas con el reproductor',
  personalizacion: 'Personalización de la iglesia',
  holyrics: 'Holyrics Connect',
  admin_avanzado: 'Herramientas avanzadas de administración',
  config_avanzada: 'Mayor capacidad de configuración',
  soporte_prioritario: 'Soporte prioritario'
}

/**
 * Canción demo que la sesión puede ver y tocar (solo lectura) durante su prueba gratuita: la clave de la
 * canción (también para sus pistas `tracks/<clave>/…`), o null. Las demo son de la iglesia de las canciones
 * demo (v44) o de la interna; solo Superadmin las marca (y el Worker valida de qué iglesia son), y la base
 * las entrega en `me.demos` solo mientras la prueba sigue activa.
 */
export function demoSongOf(me, key) {
  if (!Array.isArray(me?.demos) || !me.demos.length || typeof key !== 'string' || key.includes('..')) return null
  const song = key.startsWith('tracks/') ? trackSongKey(key) : key
  return churchOfSongKey(song) && me.demos.includes(song) ? song : null
}

/** Mensaje claro cuando la suscripción no está al día o el plan no incluye la función. */
export function planMessage(me, feature) {
  const state = me?.subscription?.state
  if (state && !['activa', 'gracia', 'interna', 'prueba'].includes(state)) {
    if (state === 'suspendida' || state === 'archivada') return 'La cuenta de tu iglesia está suspendida. Escribe a Gosen para reactivarla.'
    if (state === 'prueba_vencida') return 'La prueba gratuita de tu iglesia terminó. Contrata un plan para seguir usando la nube (tus datos se conservan).'
    if (state === 'sin_suscripcion') return 'Tu iglesia todavía no tiene un plan activo. Termina la contratación para usar la nube.'
    return 'La suscripción de tu iglesia no está al día. Renuévala para seguir usando la nube (tus datos se conservan).'
  }
  return `«${FEATURE_LABELS[feature] || feature}» no está incluido en el plan de tu iglesia${me?.plan?.name ? ` (${me.plan.name})` : ''}. Puedes consultar la actualización con Gosen.`
}
