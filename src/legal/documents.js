/**
 * Documentos legales de Gosen Tracks, con sus versiones.
 *
 * Cómo se actualiza un documento (procedimiento):
 *  1. Se agrega una versión NUEVA al final de `versions` (no se edita una versión ya vigente: quien
 *     la aceptó debe poder consultar exactamente ese texto). Se sube el número (1.0 → 1.1 para
 *     cambios menores de redacción; 2.0 si cambian finalidades, datos o condiciones).
 *  2. Se pone su fecha de entrada en vigor (`effective`, AAAA-MM-DD) y un resumen de los cambios.
 *  3. Al desplegar, la versión anterior queda en el historial (/legal/<documento>/<versión>) y, si es
 *     el de términos o el de privacidad, el panel vuelve a pedir la aceptación de la nueva versión.
 *
 * Cada versión se identifica también por la huella SHA-256 de su texto exacto: es lo que se guarda
 * en el registro de aceptaciones, así se puede demostrar qué texto se aceptó.
 */
import { OWNER_FIELD_LABELS } from './owner.js'

/**
 * Fecha de entrada en vigor de la versión 1.0. Queda en null hasta completar los datos del
 * responsable (src/legal/owner.js): mientras tanto los documentos son un borrador.
 */
export const EFFECTIVE_1_0 = null

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Ayudas para el texto: datos del responsable (o "pendiente") y enlaces entre documentos. */
function helpers(owner) {
  const field = (k) => (owner && typeof owner[k] === 'string' && owner[k].trim() ? esc(owner[k].trim()) : `<mark class="pending">${esc(OWNER_FIELD_LABELS[k] || k)}: pendiente de confirmar</mark>`)
  const contact = () => {
    const parts = [
      `<li><strong>Responsable:</strong> ${field('name')}</li>`,
      `<li><strong>NIT o identificación:</strong> ${field('nit')}</li>`,
      `<li><strong>Dirección:</strong> ${field('address')}, ${field('city')}, ${field('country')}</li>`,
      `<li><strong>Correo para datos personales:</strong> ${field('email')}</li>`
    ]
    if (owner?.phone) parts.push(`<li><strong>Teléfono:</strong> ${field('phone')}</li>`)
    return `<ul class="contact">${parts.join('')}</ul>`
  }
  const link = (id, text) => `<a href="/legal/${id}">${esc(text)}</a>`
  return { field, contact, link }
}

// --- Términos y condiciones -----------------------------------------------------------------------

function termsV1(owner) {
  const { field, contact, link } = helpers(owner)
  return `
<section>
<h2>1. Qué es Gosen Tracks y quién lo ofrece</h2>
<p>Gosen Tracks es una herramienta privada del ministerio de música de ${field('name')} (en adelante, «la Comunidad»). Incluye la aplicación de reproducción de multitracks (Windows, Mac, Android y la aplicación web para iPhone), esta página web y el panel de administración en la nube.</p>
<p>No es un servicio abierto al público: solo pueden tener cuenta las personas cuyo correo autoriza un administrador de la Comunidad. La página pública solo presenta la herramienta.</p>
</section>
<section>
<h2>2. Aceptación de estos términos</h2>
<p>Estos términos regulan el uso de Gosen Tracks. Se aceptan marcando la casilla correspondiente en el formulario donde se piden; esa aceptación electrónica tiene validez conforme a la Ley 527 de 1999 (mensajes de datos). La aceptación de estos términos es independiente de la autorización para el tratamiento de datos personales, que se pide aparte (ver la ${link('privacidad', 'política de privacidad')}).</p>
<p>Si no aceptas estos términos, no puedes usar el panel de administración ni descargar contenido desde la web. Los documentos legales y los canales de contacto siguen disponibles para cualquier persona.</p>
</section>
<section>
<h2>3. Cuentas</h2>
<ul>
<li>Cada cuenta es personal. Usa tu propio correo y no compartas tu contraseña.</li>
<li>Los administradores de la Comunidad autorizan y retiran el acceso, asignan las funciones dentro del equipo (por ejemplo, Consola, Músicos, Cantantes) y pueden crear cuentas para integrantes.</li>
<li>Ser administrador permite subir, editar y borrar canciones, organizar los servicios y descargar el contenido desde la web. Las etiquetas de función no dan permisos de administrador.</li>
<li>Si crees que alguien usó tu cuenta sin permiso, avisa de inmediato a un administrador o al correo de contacto.</li>
</ul>
</section>
<section>
<h2>4. Contenido musical y licencias</h2>
<p>Los multitracks, pistas, letras y obras musicales disponibles en Gosen Tracks pertenecen a sus autores, compositores, productores o distribuidores. La Comunidad adquiere los multitracks a terceros bajo las licencias de esos proveedores, que normalmente permiten su uso dentro de la iglesia que los adquirió. Gosen Tracks no te transfiere ningún derecho sobre esas obras.</p>
<ul>
<li>Solo los administradores de la Comunidad, con su cuenta, pueden descargar los multitracks desde la web, y solo para las actividades de la Comunidad y dentro de lo que permita la licencia de cada proveedor.</li>
<li>Está prohibido redistribuir, compartir fuera de la Comunidad, publicar, vender, subir a otras plataformas o usar comercialmente el contenido, así como intentar extraerlo de la aplicación.</li>
<li>Las letras y acordes que se escriben en la aplicación son ayudas internas para el ensayo y el servicio; las obras siguen siendo de sus autores.</li>
</ul>
<p>Estas reglas se basan en la protección de los derechos de autor (Ley 23 de 1982 y Decisión Andina 351 de 1993). Quien las incumpla puede perder el acceso, sin perjuicio de las acciones que correspondan a los titulares de los derechos.</p>
</section>
<section>
<h2>5. Uso permitido</h2>
<p>Gosen Tracks se usa para preparar, ensayar y acompañar las actividades musicales de la Comunidad. No está permitido:</p>
<ul>
<li>intentar acceder a cuentas, datos o funciones para las que no tienes permiso;</li>
<li>interferir con el funcionamiento de la plataforma o sobrecargarla a propósito;</li>
<li>usar la información de otros integrantes (nombres, correos, asignaciones) para fines distintos a la organización del equipo.</li>
</ul>
</section>
<section>
<h2>6. Servicio sin costo y disponibilidad</h2>
<p>Hoy Gosen Tracks no tiene costo para los integrantes y no se realizan cobros ni pagos a través de la plataforma (ver la ${link('reembolsos', 'política de reembolsos')}). Si en el futuro se cobrara por algún servicio, se informará antes con condiciones comerciales separadas, que habrá que aceptar expresamente; nada de lo que aceptes hoy te obliga a pagar.</p>
<p>La plataforma depende de proveedores externos (alojamiento en la nube y autenticación). Procuramos que funcione bien, pero puede haber interrupciones, cambios o mejoras en sus funciones. Te recomendamos tener preparado lo necesario para los servicios con anticipación (por ejemplo, las canciones guardadas en tu equipo).</p>
</section>
<section>
<h2>7. Responsabilidad</h2>
<p>La Comunidad responde por el funcionamiento de la plataforma en los términos de la ley colombiana. Nada en estos términos limita la responsabilidad que la ley no permite limitar, ni los derechos irrenunciables que te reconozca la ley.</p>
</section>
<section>
<h2>8. Retiro del acceso</h2>
<p>Puedes dejar de usar Gosen Tracks en cualquier momento y pedir que se elimine tu cuenta (ver la ${link('privacidad', 'política de privacidad')}). Los administradores pueden retirar el acceso de quien deje el equipo o incumpla estos términos.</p>
</section>
<section>
<h2>9. Cambios en estos términos</h2>
<p>Si estos términos cambian, se publicará una nueva versión con su fecha de entrada en vigor y un resumen de los cambios. Las versiones anteriores quedan disponibles en el historial de esta página. Cuando el cambio lo requiera, se pedirá de nuevo tu aceptación antes de seguir usando las funciones que dependen de ella.</p>
</section>
<section>
<h2>10. Ley aplicable y contacto</h2>
<p>Estos términos se rigen por la ley de la República de Colombia. Antes de acudir a otra instancia, escríbenos para buscar una solución directa:</p>
${contact()}
</section>`
}

// --- Política de privacidad y tratamiento de datos personales -------------------------------------

function privacyV1(owner) {
  const { field, contact, link } = helpers(owner)
  return `
<section class="notice">
<h2>Aviso de privacidad (resumen)</h2>
<p>${field('name')} es responsable del tratamiento de los datos personales que se recogen en Gosen Tracks. Los usamos solo para darte acceso a la plataforma y organizar el equipo de música de la Comunidad: tu cuenta, tu función en los servicios y las herramientas de ensayo. No los vendemos, no hacemos publicidad con ellos ni los usamos para perfilarte. Puedes conocer, actualizar, rectificar y pedir la supresión de tus datos, y revocar la autorización, escribiendo a ${field('email')}. La política completa está a continuación.</p>
</section>
<section>
<h2>1. Responsable del tratamiento</h2>
${contact()}
</section>
<section>
<h2>2. Normas que se aplican</h2>
<p>Esta política se adopta conforme a la Ley Estatutaria 1581 de 2012 y su reglamentación (Decreto 1377 de 2013, compilado en el Decreto Único 1074 de 2015), y aplica a los datos personales tratados en Gosen Tracks: la aplicación, la página web y el panel de administración.</p>
</section>
<section>
<h2>3. Qué datos tratamos y para qué</h2>
<table>
<thead><tr><th>Dato</th><th>Para qué se usa</th><th>¿Obligatorio?</th></tr></thead>
<tbody>
<tr><td>Correo electrónico</td><td>Identificar tu cuenta, comprobar que estás autorizado e iniciar sesión.</td><td>Sí: sin él no hay cuenta.</td></tr>
<tr><td>Contraseña</td><td>Iniciar sesión. La guarda cifrada nuestro proveedor de autenticación; nosotros no la almacenamos ni podemos verla.</td><td>Sí.</td></tr>
<tr><td>Nombre</td><td>Mostrarte a tus compañeros en los servicios, la programación del mes y el ensayo (por ejemplo, «Dirige: Ana»).</td><td>No: si falta, se muestra la parte de tu correo antes de la @.</td></tr>
<tr><td>Función en el equipo (etiqueta)</td><td>Asignarte en los servicios según lo que haces (Consola, Músicos, Cantantes…).</td><td>No.</td></tr>
<tr><td>Asignaciones a servicios</td><td>Que el equipo sepa quién participa en cada servicio y para exportar la programación del mes.</td><td>Solo si un administrador te asigna.</td></tr>
<tr><td>Autoría de cambios</td><td>Saber qué administrador creó o cambió un servicio, una canción o una letra.</td><td>Solo administradores.</td></tr>
<tr><td>Registro de aceptaciones</td><td>Demostrar qué versión de los términos y de esta política aceptaste o revocaste, cuándo y desde qué formulario.</td><td>Sí, cuando aceptas o revocas.</td></tr>
</tbody>
</table>
<p>No pedimos documentos de identidad, fecha de nacimiento, teléfono, dirección ni datos de pago. Tampoco guardamos en nuestras bases de datos tu dirección IP ni los datos de tu navegador. Nuestros proveedores de nube procesan los datos técnicos de cada conexión (como la dirección IP) para entregar el servicio y protegerlo.</p>
<p>En tu dispositivo, la aplicación guarda tu sesión, tus ajustes y las canciones preparadas para funcionar sin internet. Los detalles están en la ${link('cookies', 'política de cookies')}.</p>
</section>
<section>
<h2>4. Datos sensibles</h2>
<p>Pertenecer al equipo de música de una comunidad cristiana puede revelar tus convicciones religiosas, que la ley considera un dato sensible (artículo 5 de la Ley 1581 de 2012). Este dato se trata solo en el curso de las actividades de la Comunidad y referido a sus integrantes, y no se entrega a terceros sin tu autorización. No estás obligado a autorizar el tratamiento de datos sensibles; sin embargo, sin esa autorización no es posible darte una cuenta en una herramienta que es, precisamente, la del equipo de la Comunidad.</p>
<p>Gosen Tracks no está dirigido a menores de edad. No se crean cuentas para menores de 18 años.</p>
</section>
<section>
<h2>5. Cómo y cuándo autorizas</h2>
<p>La autorización se pide en el primer uso que la requiere, con una casilla propia y desmarcada, separada de la aceptación de los términos. Queda registrada con la versión exacta de esta política que se te mostró, la fecha y hora del servidor y el formulario en el que la diste. Si esta política cambia en algo que afecte tu autorización, te la pediremos de nuevo.</p>
</section>
<section>
<h2>6. Con quién se comparten los datos</h2>
<p>Los datos no se venden ni se ceden a terceros. Solo los tratan, por encargo nuestro y para prestar el servicio, estos proveedores:</p>
<ul>
<li><strong>Neon</strong> (Neon Inc.): base de datos y autenticación de cuentas, alojadas en Amazon Web Services en Estados Unidos (región us-east-2).</li>
<li><strong>Cloudflare</strong> (Cloudflare, Inc.): alojamiento de la página, la nube de canciones y los servicios, y la conexión en tiempo real del ensayo.</li>
</ul>
<p>Como estos proveedores están fuera de Colombia, el uso de sus servicios implica una transmisión internacional de datos a encargados del tratamiento, que se hace solo para las finalidades de esta política.</p>
<p>Dentro de la Comunidad, tus compañeros ven tu nombre, tu función y tus asignaciones. Los administradores ven además tu correo y el registro de tus aceptaciones.</p>
</section>
<section>
<h2>7. Tus derechos</h2>
<p>Como titular de los datos puedes, de forma gratuita:</p>
<ul>
<li>conocer, actualizar y rectificar tus datos;</li>
<li>pedir prueba de la autorización que diste;</li>
<li>saber cómo se han usado tus datos;</li>
<li>revocar la autorización o pedir la supresión de tus datos, cuando no exista un deber legal o contractual de conservarlos;</li>
<li>presentar quejas ante la Superintendencia de Industria y Comercio, después de haber agotado el trámite de consulta o reclamo ante nosotros.</li>
</ul>
</section>
<section>
<h2>8. Cómo ejercer tus derechos</h2>
<p>Escribe a ${field('email')} desde el correo de tu cuenta (o explica cómo podemos confirmar que eres el titular). Indica qué pides y, si es un reclamo, los hechos y los documentos que quieras aportar.</p>
<ul>
<li><strong>Consultas</strong> (qué datos tenemos y cómo se usan): se responden en máximo 10 días hábiles desde que se reciben; si no es posible, te diremos el motivo y la nueva fecha, que no superará 5 días hábiles más.</li>
<li><strong>Reclamos</strong> (corregir, actualizar, suprimir o revocar): se atienden en máximo 15 días hábiles desde el día siguiente a recibirlos; si no es posible, te diremos el motivo y la nueva fecha, que no superará 8 días hábiles más. Si al reclamo le falta información, te la pediremos en los 5 días siguientes.</li>
</ul>
<p>Los administradores de la Comunidad pueden además ayudarte a corregir tu nombre o tu función. Desde el panel de administración, un administrador puede revocar su propia autorización en cualquier momento.</p>
</section>
<section>
<h2>9. Cuánto tiempo se conservan</h2>
<ul>
<li><strong>Cuenta</strong> (correo, nombre, función): mientras seas integrante autorizado. Si pides la supresión o se retira tu acceso y lo pides, se elimina.</li>
<li><strong>Servicios y programación</strong>: se conservan como historial del ministerio. Puedes pedir que se quite tu nombre de los servicios pasados.</li>
<li><strong>Registro de aceptaciones</strong>: mientras exista tu cuenta y luego por el tiempo necesario para atender reclamaciones (hasta 5 años). Después se anonimiza: se quita tu correo y queda solo una huella que no te identifica directamente.</li>
<li><strong>Sesión del panel en el navegador</strong>: 2 horas, o hasta que salgas.</li>
</ul>
</section>
<section>
<h2>10. Seguridad</h2>
<p>Las conexiones van cifradas (HTTPS). El acceso depende del rol: los integrantes ven lo que necesitan para el equipo y solo los administradores administran contenido y cuentas. El registro de aceptaciones no se puede modificar ni borrar desde la aplicación ni desde la web, y su integridad se puede verificar. Ninguna medida es infalible: si detectamos un incidente que afecte tus datos, te lo informaremos y lo reportaremos a la autoridad cuando corresponda.</p>
</section>
<section>
<h2>11. Vigencia y cambios</h2>
<p>Esta política rige desde la fecha indicada arriba. Los cambios se publican como una nueva versión con su fecha y un resumen; las versiones anteriores quedan en el historial de esta página. Los cambios sustanciales se informarán antes de aplicarse y, si afectan la autorización, se pedirá de nuevo. Las bases de datos estarán vigentes mientras se mantengan las finalidades descritas.</p>
</section>`
}

// --- Política de cookies --------------------------------------------------------------------------

function cookiesV1(owner) {
  const { field, link } = helpers(owner)
  return `
<section>
<h2>1. Qué usamos</h2>
<p>Esta página web no usa cookies de analítica, de publicidad ni de seguimiento, ni píxeles o herramientas de medición de terceros. Las fuentes tipográficas se sirven desde nuestro propio dominio, así que visitarla no envía tus datos a terceros como Google.</p>
<p>Lo que sí usamos es el almacenamiento local del navegador (una tecnología similar a las cookies) para lo siguiente:</p>
<table>
<thead><tr><th>Nombre</th><th>Dónde</th><th>Para qué</th><th>Tipo</th><th>Duración</th></tr></thead>
<tbody>
<tr><td><code>gosen.web.privacy</code></td><td>Toda la web</td><td>Recordar tu elección sobre el almacenamiento opcional.</td><td>Necesaria</td><td>Hasta que la cambies o borres los datos del navegador.</td></tr>
<tr><td><code>gosen.cloud.session</code></td><td>Panel de administración</td><td>Mantener abierta la sesión del administrador.</td><td>Necesaria</td><td>Hasta salir del panel (la sesión del panel dura 2 horas).</td></tr>
<tr><td><code>gosen.web.theme</code></td><td>Toda la web</td><td>Recordar si prefieres el tema claro u oscuro.</td><td>Preferencias (opcional)</td><td>Hasta que la retires.</td></tr>
<tr><td><code>gosen.cloud.view</code></td><td>Panel de administración</td><td>Recordar cómo ordenas y filtras la lista de canciones.</td><td>Preferencias (opcional)</td><td>Hasta que la retires.</td></tr>
</tbody>
</table>
<p>La aplicación para iPhone (en /iphone/) guarda en el dispositivo tu sesión, tus ajustes y las canciones preparadas para tocar sin internet. Es necesario para que la aplicación funcione y no se usa para otra cosa.</p>
<p>Nuestro proveedor de alojamiento, Cloudflare, puede usar cookies técnicas de seguridad (por ejemplo, para distinguir tráfico automatizado) cuando su protección lo requiere. Son estrictamente necesarias para proteger el servicio.</p>
</section>
<section>
<h2>2. Tus opciones</h2>
<ul>
<li>Lo necesario funciona siempre: sin ello, la página o el panel no funcionarían como los pides.</li>
<li>Lo opcional (preferencias) solo se guarda si lo aceptas. Si lo rechazas, la página funciona igual, pero no recordará tu tema ni tu forma de ordenar la lista.</li>
<li>Puedes cambiar o retirar tu elección cuando quieras con el enlace «Configurar cookies» que está al pie de cada página. Al retirarla, lo que se había guardado se borra de inmediato.</li>
<li>También puedes borrar estos datos desde la configuración de tu navegador.</li>
</ul>
<p>Esta política se refiere solo al almacenamiento en tu navegador. El tratamiento de tus datos personales en general se explica en la ${link('privacidad', 'política de privacidad')}. Para dudas: ${field('email')}.</p>
</section>`
}

// --- Política de reembolsos, devoluciones y cancelaciones ------------------------------------------

function refundsV1(owner) {
  const { field, link } = helpers(owner)
  return `
<section>
<h2>1. Hoy no hay cobros</h2>
<p>Gosen Tracks no vende productos ni servicios y no recibe pagos: no tiene precios, carrito ni medios de pago, y su uso no tiene costo para los integrantes de la Comunidad. Por eso hoy no hay compras que cancelar, devolver ni reembolsar.</p>
<p>Si recibiste un cobro que dice ser de Gosen Tracks, no proviene de esta plataforma. Escríbenos a ${field('email')} para avisarnos.</p>
</section>
<section>
<h2>2. Si en el futuro se cobra algún servicio</h2>
<p>Antes de cobrar por cualquier servicio se publicará una nueva versión de esta política con sus condiciones concretas (qué se cobra, cómo se cancela, plazos y procedimiento) y se pedirá aceptar las condiciones comerciales aparte, de forma expresa. Esa versión respetará, cuando se aplique la relación de consumo, los derechos que la ley reconoce al consumidor y que no se pueden excluir, entre ellos:</p>
<ul>
<li>el <strong>derecho de retracto</strong> en las ventas a distancia y por comercio electrónico (artículo 47 de la Ley 1480 de 2011, con las excepciones que la propia ley establece), con devolución del dinero en el plazo legal;</li>
<li>la <strong>reversión del pago</strong> en compras por comercio electrónico en los casos del artículo 51 de la Ley 1480 de 2011 (por ejemplo, fraude, operación no solicitada o servicio no prestado);</li>
<li>la <strong>garantía</strong> y la atención de cobros duplicados o equivocados.</li>
</ul>
<p>Nada de lo anterior es una oferta comercial: es el compromiso de informar las condiciones antes de cualquier cobro. Ver también los ${link('terminos', 'términos y condiciones')}.</p>
</section>`
}

// --- Catálogo -------------------------------------------------------------------------------------

export const DOCUMENTS = {
  terminos: {
    title: 'Términos y condiciones',
    short: 'Términos',
    consent: 'aceptacion_terminos',
    versions: [{ version: '1.0', effective: EFFECTIVE_1_0, changes: 'Primera versión.', body: termsV1 }]
  },
  privacidad: {
    title: 'Política de privacidad y tratamiento de datos personales',
    short: 'Privacidad',
    consent: 'autorizacion_tratamiento_datos',
    versions: [{ version: '1.0', effective: EFFECTIVE_1_0, changes: 'Primera versión.', body: privacyV1 }]
  },
  cookies: {
    title: 'Política de cookies',
    short: 'Cookies',
    versions: [{ version: '1.0', effective: EFFECTIVE_1_0, changes: 'Primera versión.', body: cookiesV1 }]
  },
  reembolsos: {
    title: 'Política de reembolsos, devoluciones y cancelaciones',
    short: 'Reembolsos',
    versions: [{ version: '1.0', effective: EFFECTIVE_1_0, changes: 'Primera versión.', body: refundsV1 }]
  }
}

/** Documentos que se aceptan en los formularios (cada uno con su casilla). */
export const CONSENT_DOCUMENTS = ['terminos', 'privacidad']

export const DOC_IDS = Object.keys(DOCUMENTS)
