/**
 * Responsable del tratamiento de los datos y titular de la plataforma. Estos datos aparecen en los
 * documentos legales; mientras falte alguno obligatorio, los documentos se publican como BORRADOR
 * (con el dato marcado como pendiente) y no se piden aceptaciones: nadie acepta un texto incompleto.
 *
 * Al completarlos: poner la fecha de entrada en vigor en src/legal/documents.js (EFFECTIVE) y
 * desplegar. Si después cambian, se publica una versión nueva de los documentos (ver documents.js).
 */
export const OWNER = {
  /** Nombre o razón social exactos. */
  name: 'Comunidad Cristiana Gosen Barranquilla',
  /** NIT (persona jurídica) o identificación del responsable. */
  nit: null,
  /** Dirección de contacto (física). */
  address: null,
  city: 'Barranquilla',
  country: 'Colombia',
  /** Correo para consultas, reclamos y solicitudes sobre datos personales. */
  email: null,
  /** Teléfono (opcional). */
  phone: null
}

/** Datos sin los cuales los documentos no pueden entrar en vigor (Ley 1581 y Decreto 1377, art. 13). */
export const REQUIRED_OWNER_FIELDS = ['name', 'nit', 'address', 'email']

export const OWNER_FIELD_LABELS = {
  name: 'nombre o razón social',
  nit: 'NIT o identificación',
  address: 'dirección',
  email: 'correo de contacto para datos personales',
  phone: 'teléfono'
}

export function missingOwnerFields(owner) {
  return REQUIRED_OWNER_FIELDS.filter((k) => !owner || typeof owner[k] !== 'string' || !owner[k].trim())
}
