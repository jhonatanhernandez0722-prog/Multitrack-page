/**
 * Responsable del tratamiento de los datos y titular de la plataforma. Estos datos aparecen en los
 * documentos legales; mientras falte alguno obligatorio, los documentos se publican como BORRADOR
 * (con el dato marcado como pendiente) y no se piden aceptaciones: nadie acepta un texto incompleto.
 *
 * Al completarlos: poner la fecha de entrada en vigor en src/legal/documents.js (EFFECTIVE) y
 * desplegar. Si después cambian, se publica una versión nueva de los documentos (ver documents.js).
 */
export const OWNER = {
  /** Nombre o razón social exactos (persona natural: como en la cédula y el RUT). */
  name: 'Miguel Ángel Hernández Hoyos',
  /** NIT (persona jurídica) o identificación del responsable. */
  nit: 'C.C. 1.045.688.860',
  /** Dirección de contacto (física). */
  address: 'Calle 50 # 22-28',
  /** Ciudad de la dirección (opcional: si falta, no se muestra). */
  city: null,
  country: 'Colombia',
  /** Correo para consultas, reclamos y solicitudes sobre datos personales. */
  email: 'gosensupport2027@iccgosen.com',
  /** Teléfono (opcional). */
  phone: null,
  /**
   * Comercio que recibe los pagos con Openpay (titular de esa cuenta). Así aparece el cobro en el extracto
   * de la tarjeta: se informa al pagar y en los documentos, para que nadie desconozca el cobro.
   */
  paymentMerchant: 'ART IN EARS'
}

/** Datos sin los cuales los documentos no pueden entrar en vigor (Ley 1581 y Decreto 1377, art. 13). */
export const REQUIRED_OWNER_FIELDS = ['name', 'nit', 'address', 'email']

export const OWNER_FIELD_LABELS = {
  name: 'nombre o razón social',
  nit: 'NIT o identificación',
  address: 'dirección',
  city: 'ciudad',
  email: 'correo de contacto para datos personales',
  phone: 'teléfono',
  paymentMerchant: 'comercio que recibe los pagos'
}

export function missingOwnerFields(owner) {
  return REQUIRED_OWNER_FIELDS.filter((k) => !owner || typeof owner[k] !== 'string' || !owner[k].trim())
}
