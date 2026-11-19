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
<p>Gosen Tracks es una plataforma para equipos de música de iglesias: la aplicación de multitracks (Windows, Mac, Android y la aplicación web para iPhone), esta página web, el panel de cada iglesia y la nube donde se guardan sus canciones. La ofrece ${field('name')} (en adelante, «Gosen»).</p>
<p>Gosen la ofrece a iglesias clientes mediante una suscripción (ver la sección 4) y la usa también su propia iglesia. Cada iglesia tiene su espacio independiente: sus canciones, servicios, integrantes y configuración no los ve ninguna otra iglesia.</p>
</section>
<section>
<h2>2. Aceptación de estos términos</h2>
<p>Estos términos regulan el uso de Gosen Tracks. Se aceptan marcando la casilla correspondiente en el formulario donde se piden; esa aceptación electrónica tiene validez conforme a la Ley 527 de 1999 (mensajes de datos). Es independiente de la autorización para el tratamiento de datos personales, que se pide aparte (ver la ${link('privacidad', 'política de privacidad')}).</p>
<p>Si no aceptas estos términos, no puedes usar el panel de administración ni descargar contenido desde la web. Los documentos legales y los canales de contacto siguen disponibles para cualquier persona.</p>
</section>
<section>
<h2>3. Iglesias, cuentas y roles</h2>
<ul>
<li>Gosen crea cada iglesia cliente y entrega a su administrador principal un código de activación. Los administradores de la iglesia invitan a sus integrantes con códigos personales, de un solo uso y con vencimiento.</li>
<li>Cada cuenta es personal y pertenece a una sola iglesia. Usa tu propio correo, verifícalo y no compartas tu contraseña. Cambiar una cuenta de iglesia solo lo puede hacer Gosen, a pedido de la iglesia.</li>
<li>Los administradores de la iglesia gestionan sus integrantes, invitaciones, roles, servicios y canciones, y consultan su suscripción. Las etiquetas de función (por ejemplo, Consola o Músicos) no dan permisos de administrador.</li>
<li>Gosen administra la plataforma (iglesias, planes, suscripciones y pagos) con cuentas protegidas con verificación en dos pasos. Gosen no usa ni descarga el contenido de las iglesias; solo ve los datos necesarios para operar el servicio (por ejemplo, cuánto espacio ocupa cada iglesia).</li>
<li>Si crees que alguien usó tu cuenta sin permiso, cierra la sesión en los demás dispositivos desde la app o el panel y avisa a tu administrador o a Gosen.</li>
</ul>
</section>
<section>
<h2>4. Planes y suscripción</h2>
<ul>
<li>Gosen ofrece planes (por ejemplo, Inicial, Equipo y Premium) con funciones, número de integrantes y espacio de almacenamiento distintos. Las funciones, los límites y los precios vigentes de cada plan se informan antes de contratar y se pueden consultar en la sección «Mi suscripción».</li>
<li>La suscripción es mensual o anual y se paga por adelantado por los medios que se acuerden con Gosen (por ejemplo, transferencia o Nequi). Gosen la activa o la renueva cuando verifica el pago, y registra el período, el valor, el medio y la referencia del pago.</li>
<li>No hay cobros automáticos: cada período se paga y se activa por separado.</li>
<li>Antes del vencimiento, la plataforma avisa. Si el pago no se renueva, hay un período de gracia; al terminar, se suspenden las funciones de la nube del plan (por ejemplo, descargar canciones, compartir servicios o el ensayo múltiple). Las canciones ya guardadas en los equipos siguen sonando.</li>
<li>Al vencer o suspenderse una suscripción, los datos de la iglesia no se borran automáticamente: se conservan y vuelven a estar disponibles al renovar. La iglesia puede pedir su eliminación (ver la sección 9).</li>
<li>Si una iglesia supera el espacio o el número de integrantes de su plan, no podrá subir más canciones ni sumar integrantes hasta liberar espacio o cambiar de plan.</li>
<li>Las condiciones de cancelación, retracto y reembolso están en la ${link('reembolsos', 'política de reembolsos, devoluciones y cancelaciones')}.</li>
</ul>
</section>
<section>
<h2>5. Contenido musical y licencias</h2>
<p>Cada iglesia sube sus propios multitracks y es responsable de contar con las licencias que exigen sus proveedores (por ejemplo, las tiendas de multitracks) y los titulares de los derechos. Gosen solo los guarda y los entrega a esa iglesia; no adquiere ni transfiere derechos sobre las obras.</p>
<ul>
<li>Desde la web, solo los administradores de cada iglesia, con su cuenta, pueden descargar los multitracks de su iglesia, y solo para las actividades de esa iglesia y dentro de lo que permita cada licencia.</li>
<li>Está prohibido redistribuir, publicar, vender, compartir fuera de la iglesia, subir a otras plataformas o usar comercialmente el contenido, así como intentar extraerlo de la aplicación o acceder al de otra iglesia.</li>
<li>Las letras y acordes que se escriben en la aplicación son ayudas internas para el ensayo y el servicio; las obras siguen siendo de sus autores.</li>
</ul>
<p>Estas reglas se basan en la protección de los derechos de autor (Ley 23 de 1982 y Decisión Andina 351 de 1993). Gosen puede retirar contenido o suspender el acceso ante un uso que infrinja derechos de terceros.</p>
</section>
<section>
<h2>6. Uso permitido</h2>
<p>No está permitido:</p>
<ul>
<li>intentar acceder a cuentas, iglesias, datos o funciones para las que no tienes permiso;</li>
<li>interferir con el funcionamiento de la plataforma, sobrecargarla a propósito o probar sus defensas sin autorización;</li>
<li>usar la información de otros integrantes (nombres, correos, asignaciones) para fines distintos a la organización del equipo.</li>
</ul>
</section>
<section>
<h2>7. Disponibilidad</h2>
<p>La plataforma depende de proveedores externos (alojamiento en la nube y autenticación). Gosen procura que funcione bien y avisa con anticipación los mantenimientos que pueda prever, pero puede haber interrupciones. Te recomendamos tener preparadas en tus equipos las canciones de cada servicio con anticipación. Si una falla atribuible a Gosen impide usar el servicio contratado, se aplica lo previsto en la ${link('reembolsos', 'política de reembolsos')}.</p>
</section>
<section>
<h2>8. Responsabilidad</h2>
<p>Gosen responde por la prestación del servicio en los términos de la ley colombiana. Nada en estos términos limita la responsabilidad que la ley no permite limitar, ni los derechos irrenunciables que la ley reconoce a los consumidores.</p>
</section>
<section>
<h2>9. Terminación</h2>
<p>La iglesia puede dejar de usar Gosen Tracks en cualquier momento: basta con no renovar. Puede pedir la eliminación de sus canciones y datos escribiendo a ${field('email')}; Gosen la hace dentro de los plazos de la ley de protección de datos, salvo lo que deba conservar por obligación legal (por ejemplo, los registros de pagos). Gosen puede suspender una iglesia o una cuenta que incumpla estos términos, informando el motivo.</p>
</section>
<section>
<h2>10. Cambios en estos términos</h2>
<p>Si estos términos cambian, se publicará una nueva versión con su fecha de entrada en vigor y un resumen de los cambios. Las versiones anteriores quedan disponibles en el historial de esta página. Cuando el cambio lo requiera, se pedirá de nuevo tu aceptación. Un cambio de precios no afecta el período que ya pagaste.</p>
</section>
<section>
<h2>11. Ley aplicable y contacto</h2>
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
<p>${field('name')} («Gosen») trata los datos personales que se recogen en Gosen Tracks para dar acceso a la plataforma, organizar los equipos de música de las iglesias que la usan y administrar sus suscripciones. No los vendemos, no hacemos publicidad con ellos ni los usamos para perfilarte. Puedes conocer, actualizar, rectificar y pedir la supresión de tus datos, y revocar la autorización, escribiendo a ${field('email')}. La política completa está a continuación.</p>
</section>
<section>
<h2>1. Responsable del tratamiento</h2>
${contact()}
<p>Gosen es responsable de las cuentas, la seguridad, la operación de la plataforma y la administración de las suscripciones. Cada iglesia cliente decide a quién invita y cómo organiza su equipo (servicios, asignaciones): para esos datos de sus integrantes, la iglesia es responsable y Gosen los trata por su encargo, solo para prestarle el servicio.</p>
</section>
<section>
<h2>2. Normas que se aplican</h2>
<p>Esta política se adopta conforme a la Ley Estatutaria 1581 de 2012 y su reglamentación (Decreto 1377 de 2013, compilado en el Decreto Único 1074 de 2015), y aplica a los datos personales tratados en Gosen Tracks: la aplicación, la página web, el panel de cada iglesia y el de Gosen.</p>
</section>
<section>
<h2>3. Qué datos tratamos y para qué</h2>
<table>
<thead><tr><th>Dato</th><th>Para qué se usa</th><th>¿Obligatorio?</th></tr></thead>
<tbody>
<tr><td>Correo electrónico</td><td>Identificar tu cuenta, verificar que es tuyo, iniciar sesión y recuperar la contraseña.</td><td>Sí: sin él no hay cuenta.</td></tr>
<tr><td>Contraseña</td><td>Iniciar sesión. La guarda cifrada nuestro proveedor de autenticación; nosotros no la almacenamos ni podemos verla.</td><td>Sí.</td></tr>
<tr><td>Iglesia y rol</td><td>Saber a qué iglesia perteneces y qué puedes hacer en ella (administrador o integrante).</td><td>Sí.</td></tr>
<tr><td>Nombre</td><td>Mostrarte a tus compañeros en los servicios, la programación del mes y el ensayo.</td><td>No: si falta, se muestra la parte de tu correo antes de la @.</td></tr>
<tr><td>Función en el equipo (etiqueta)</td><td>Asignarte en los servicios según lo que haces (Consola, Músicos, Cantantes…).</td><td>No.</td></tr>
<tr><td>Asignaciones a servicios</td><td>Que tu equipo sepa quién participa en cada servicio y para exportar la programación del mes.</td><td>Solo si un administrador te asigna.</td></tr>
<tr><td>Invitaciones</td><td>Dar acceso con un código personal. El código no se guarda: solo una huella que no permite recuperarlo, y el correo de quien lo usó.</td><td>Solo al unirte con un código.</td></tr>
<tr><td>Verificación en dos pasos</td><td>Proteger las cuentas de administración (obligatoria para Gosen y recomendada para administradores). Se guarda la clave de la app de autenticación y la huella de los códigos de recuperación.</td><td>Solo si la activas.</td></tr>
<tr><td>Contacto de la iglesia</td><td>Nombre, teléfono y correo de la persona de contacto de cada iglesia cliente, para administrar la suscripción y avisar los vencimientos.</td><td>Solo para iglesias clientes.</td></tr>
<tr><td>Suscripción y pagos</td><td>Plan, período, valor, medio de pago, referencia y, si se envía, el comprobante, para activar y renovar la suscripción y atender reclamos.</td><td>Solo para iglesias clientes.</td></tr>
<tr><td>Registro de acciones y de aceptaciones</td><td>Saber quién hizo cambios importantes (por ejemplo, subir o borrar canciones, invitar o cambiar de plan) y demostrar qué versión de los documentos se aceptó o revocó.</td><td>Sí, cuando ocurren.</td></tr>
</tbody>
</table>
<p>No pedimos documentos de identidad, fecha de nacimiento ni dirección de las personas, y no guardamos datos de tarjetas. Tampoco guardamos en nuestras bases de datos tu dirección IP ni los datos de tu navegador. Nuestros proveedores de nube procesan los datos técnicos de cada conexión (como la dirección IP) para entregar el servicio, protegerlo y limitar los intentos de acceso.</p>
<p>En tu dispositivo, la aplicación guarda tu sesión, tus ajustes y las canciones preparadas para funcionar sin internet. Los detalles están en la ${link('cookies', 'política de cookies')}.</p>
</section>
<section>
<h2>4. Datos sensibles</h2>
<p>Pertenecer al equipo de música de una iglesia puede revelar tus convicciones religiosas, que la ley considera un dato sensible (artículo 5 de la Ley 1581 de 2012). Este dato se trata solo para prestar el servicio a tu iglesia y no se entrega a terceros sin tu autorización. No estás obligado a autorizar el tratamiento de datos sensibles; sin embargo, sin esa autorización no es posible darte una cuenta en una herramienta que es, precisamente, la del equipo de tu iglesia.</p>
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
<li><strong>Neon</strong> (Neon Inc.): base de datos y autenticación de cuentas (incluidos los correos de verificación y de recuperación de contraseña), alojadas en Amazon Web Services en Estados Unidos (región us-east-2).</li>
<li><strong>Cloudflare</strong> (Cloudflare, Inc.): alojamiento de la página, la nube de canciones, los comprobantes de pago y los servicios, y la conexión en tiempo real del ensayo.</li>
</ul>
<p>Como estos proveedores están fuera de Colombia, el uso de sus servicios implica una transmisión internacional de datos a encargados del tratamiento, que se hace solo para las finalidades de esta política.</p>
<p>Dentro de tu iglesia, tus compañeros ven tu nombre, tu función y tus asignaciones, y sus administradores ven además tu correo. Ninguna otra iglesia ve tus datos. Gosen ve los datos necesarios para operar la plataforma, administrar las suscripciones y atender solicitudes.</p>
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
<p>Escribe a ${field('email')} desde el correo de tu cuenta (o explica cómo podemos confirmar que eres el titular). Indica qué pides y, si es un reclamo, los hechos y los documentos que quieras aportar. Si tu solicitud es sobre datos que gestiona tu iglesia (por ejemplo, una asignación), también se la puedes hacer a su administrador.</p>
<ul>
<li><strong>Consultas</strong> (qué datos tenemos y cómo se usan): se responden en máximo 10 días hábiles desde que se reciben; si no es posible, te diremos el motivo y la nueva fecha, que no superará 5 días hábiles más.</li>
<li><strong>Reclamos</strong> (corregir, actualizar, suprimir o revocar): se atienden en máximo 15 días hábiles desde el día siguiente a recibirlos; si no es posible, te diremos el motivo y la nueva fecha, que no superará 8 días hábiles más. Si al reclamo le falta información, te la pediremos en los 5 días siguientes.</li>
</ul>
<p>Desde la app y el panel puedes, además, cerrar la sesión en tus otros dispositivos y, si eres administrador, revocar tu autorización en cualquier momento.</p>
</section>
<section>
<h2>9. Cuánto tiempo se conservan</h2>
<ul>
<li><strong>Cuenta</strong> (correo, nombre, iglesia, rol, función): mientras seas integrante. Si pides la supresión, o tu iglesia te retira y lo pides, se elimina.</li>
<li><strong>Datos de una iglesia</strong> (canciones, servicios, programación): mientras la iglesia sea cliente. Si la suscripción vence, no se borran automáticamente; la iglesia puede pedir su eliminación.</li>
<li><strong>Suscripciones y pagos</strong>: el tiempo que exijan las normas contables y tributarias aplicables.</li>
<li><strong>Invitaciones</strong>: la huella del código y quién la usó, mientras exista la iglesia.</li>
<li><strong>Registro de aceptaciones y de acciones</strong>: mientras exista la cuenta y luego por el tiempo necesario para atender reclamaciones (hasta 5 años). Después se anonimiza.</li>
<li><strong>Sesión del panel en el navegador</strong>: 2 horas, o hasta que salgas.</li>
</ul>
</section>
<section>
<h2>10. Seguridad</h2>
<p>Las conexiones van cifradas (HTTPS). Cada iglesia está aislada de las demás en la base de datos y en la nube de canciones, y el acceso depende del rol: los integrantes ven lo que necesitan para su equipo, los administradores administran su iglesia y solo Gosen administra la plataforma, con verificación en dos pasos obligatoria. Los intentos repetidos de acceso se frenan, los códigos de invitación se guardan solo como huella y los archivos privados se entregan con permisos y enlaces temporales. Los registros de acciones y de aceptaciones no se pueden modificar desde la plataforma y su integridad se puede verificar. Ninguna medida es infalible: si detectamos un incidente que afecte tus datos, te lo informaremos y lo reportaremos a la autoridad cuando corresponda.</p>
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
<p>Lo que sí usamos es el almacenamiento del navegador (una tecnología similar a las cookies) para lo siguiente:</p>
<table>
<thead><tr><th>Nombre</th><th>Dónde</th><th>Para qué</th><th>Tipo</th><th>Duración</th></tr></thead>
<tbody>
<tr><td><code>gosen.web.privacy</code></td><td>Toda la web</td><td>Recordar tu elección sobre el almacenamiento opcional.</td><td>Necesaria</td><td>Hasta que la cambies o borres los datos del navegador.</td></tr>
<tr><td><code>gosen.cloud.session</code></td><td>Panel de cada iglesia</td><td>Mantener abierta la sesión del administrador.</td><td>Necesaria</td><td>Hasta salir del panel (la sesión del panel dura 2 horas).</td></tr>
<tr><td><code>gosen.sa.session</code></td><td>Panel de Gosen (Superadmin)</td><td>Mantener la sesión de administración de la plataforma mientras la pestaña está abierta.</td><td>Necesaria</td><td>Se borra al cerrar la pestaña (como mucho 8 horas).</td></tr>
<tr><td><code>gosen.web.theme</code></td><td>Toda la web</td><td>Recordar si prefieres el tema claro u oscuro.</td><td>Preferencias (opcional)</td><td>Hasta que la retires.</td></tr>
<tr><td><code>gosen.cloud.view</code></td><td>Panel de cada iglesia</td><td>Recordar cómo ordenas y filtras la lista de canciones.</td><td>Preferencias (opcional)</td><td>Hasta que la retires.</td></tr>
</tbody>
</table>
<p>La página de invitación (/unirse) muestra tu código sin enviarlo al servidor: el código va después del símbolo «#» del enlace, una parte que el navegador no envía.</p>
<p>La aplicación para iPhone (en /iphone/) guarda en el dispositivo tu sesión, tus ajustes y las canciones preparadas para tocar sin internet. Es necesario para que la aplicación funcione y no se usa para otra cosa.</p>
<p>Nuestro proveedor de alojamiento, Cloudflare, puede usar cookies técnicas de seguridad (por ejemplo, para distinguir tráfico automatizado) cuando su protección lo requiere. Son estrictamente necesarias para proteger el servicio.</p>
</section>
<section>
<h2>2. Tus opciones</h2>
<ul>
<li>Lo necesario funciona siempre: sin ello, la página o los paneles no funcionarían como los pides.</li>
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
<h2>1. Qué se paga</h2>
<p>Las iglesias clientes pagan una suscripción mensual o anual a Gosen Tracks, un servicio digital (la plataforma, la nube de sus canciones y las funciones de su plan). Los precios vigentes se informan antes de contratar. El pago se hace por adelantado y de forma manual, por los medios acordados con Gosen (por ejemplo, transferencia o Nequi); Gosen activa el período cuando verifica el pago. No hay cobros automáticos ni renovaciones automáticas.</p>
<p>La propia iglesia de Gosen y sus integrantes no pagan por usar la plataforma.</p>
</section>
<section>
<h2>2. Cancelación</h2>
<ul>
<li>Puedes cancelar cuando quieras: basta con no renovar. El servicio sigue activo hasta el último día del período pagado.</li>
<li>Al terminar el período (y el de gracia), se suspenden las funciones de la nube; tus datos no se borran automáticamente y vuelven a estar disponibles si renuevas. Puedes pedir su eliminación (ver los ${link('terminos', 'términos')}).</li>
<li>Si cancelas antes de que termine un período pagado, no hay devolución proporcional de los días restantes, salvo en los casos de las secciones 3 y 4, que reconoce la ley.</li>
</ul>
</section>
<section>
<h2>3. Derecho de retracto</h2>
<p>Cuando la contratación se hace a distancia (por ejemplo, por WhatsApp y transferencia) y existe una relación de consumo, la ley reconoce el derecho de retracto: puedes desistir dentro de los 5 días hábiles siguientes a la contratación (artículo 47 de la Ley 1480 de 2011). En ese caso, Gosen devuelve el dinero pagado en un plazo máximo de 15 días calendario desde que ejerces el retracto.</p>
<p>La ley excluye el retracto, entre otros, en los servicios cuya prestación ya comenzó con el acuerdo del consumidor. Si al activar tu suscripción empiezas a usar el servicio, Gosen te lo informará antes de activarla para que decidas.</p>
</section>
<section>
<h2>4. Cobros equivocados, pagos duplicados y servicio no prestado</h2>
<ul>
<li><strong>Pago duplicado o por un valor mayor al acordado</strong>: se devuelve la diferencia.</li>
<li><strong>Cobro que no reconoces</strong>: si recibiste un cobro que dice ser de Gosen Tracks y no lo autorizaste, avísanos de inmediato.</li>
<li><strong>Servicio no prestado</strong>: si por una falla atribuible a Gosen no puedes usar el servicio contratado durante un tiempo importante, Gosen compensa ese tiempo con días adicionales o, si lo prefieres, con la devolución proporcional.</li>
<li>Cuando el pago se haya hecho por un medio electrónico y la ley lo permita, también puedes pedir la reversión del pago (artículo 51 de la Ley 1480 de 2011 y Decreto 587 de 2016).</li>
</ul>
</section>
<section>
<h2>5. Cómo pedirlo</h2>
<p>Escribe a ${field('email')} indicando: la iglesia, el nombre de quien pagó, la fecha, el valor, el medio y la referencia del pago, y el motivo (retracto, cobro duplicado, servicio no prestado u otro), con el comprobante si lo tienes.</p>
<p>Gosen responde en un plazo máximo de 15 días hábiles. Si la solicitud procede, hace la devolución por el mismo medio de pago o por el que se acuerde, en los plazos que fija la ley cuando los hay (por ejemplo, 15 días calendario en el retracto) y, en los demás casos, en la fecha que se acuerde al aprobarla.</p>
<p>Estos derechos no se pierden por ninguna condición de estos documentos. Si no estás de acuerdo con la respuesta, puedes acudir a la Superintendencia de Industria y Comercio.</p>
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
