# Cumplimiento legal, privacidad y consentimiento — Gosen Tracks (web)

Documento de trabajo del responsable (Comunidad Cristiana Gosen Barranquilla). Resume qué datos trata
la plataforma, qué normas colombianas aplican, qué se implementó y qué falta confirmar.

**No es una certificación de cumplimiento.** Es un análisis técnico con base en las normas citadas.
Antes de dar por cerrados los puntos de la sección 7, conviene que los revise un abogado.

Fecha del análisis: 18 de noviembre de 2026.

**Actualización (v37, plataforma multiiglesia):** Gosen Tracks pasó a ofrecerse a varias iglesias con planes
de pago (Inicial, Equipo y Premium), pagos manuales y suscripciones mensuales o anuales. Los documentos
(todavía en borrador) se reescribieron para ese modelo. Los puntos nuevos están en las secciones 3, 5 y 7.

---

## 1. Qué es la plataforma (para delimitar el análisis)

| Pieza | Qué hace | Quién la usa |
|---|---|---|
| Página pública (`/`) | Presenta Gosen Tracks. **No tiene formularios** ni recoge datos. | Cualquier visitante. |
| Documentos (`/legal`) | Términos, privacidad, cookies y reembolsos, con versiones. | Cualquier visitante. |
| Panel (`/admin`) | Sube y edita canciones, y **descarga multitracks**. | Solo administradores con cuenta. |
| App (Windows, Mac, Android, iPhone en `/iphone/`) | Reproductor, servicios, letras y ensayo. | Integrantes autorizados. |
| Nube | Worker y R2 de Cloudflare; cuentas y base de datos en Neon (AWS us-east-2, EE. UU.). | Encargados del tratamiento. |

**Modelo de negocio (v37).**
- Suscripción mensual o anual por iglesia, con pago manual (transferencia, Nequi…) que Gosen verifica y
  registra.
- No hay pasarela de pagos, cobros automáticos ni datos de tarjetas.
- Hasta 3 iglesias clientes (cupo configurable) más la iglesia interna de Gosen, que no paga.

**Contenido.** Los multitracks se compran a terceros con licencia. Solo los administradores de la
iglesia pueden descargarlos.

**Usuarios.** No hay menores de edad (lo confirmó el propietario).

---

## 2. Inventario de datos personales (minimización)

| Dato | Dónde se guarda | Para qué (funcionalidad que depende de él) | ¿Obligatorio? | Quién accede | Conservación |
|---|---|---|---|---|---|
| Correo | Neon (`gosen_allowed_emails`, Neon Auth) | Identificar la cuenta, autorizarla e iniciar sesión. | Sí | Admins; la persona misma | Mientras sea integrante, o hasta que pida la supresión |
| Contraseña | Neon Auth (cifrada por el proveedor) | Iniciar sesión. El Worker solo la reenvía a Neon y **no la guarda**. | Sí | Nadie (solo su huella cifrada) | Igual que la cuenta |
| Nombre | Neon (`note`) y copia en los servicios (R2) | Mostrar a la persona en servicios, programación y ensayo. | No: si falta, se usa la parte del correo antes de la @ | Integrantes del equipo | Igual que la cuenta; en servicios pasados, como historial |
| Función (etiqueta) | Neon (`tag`) y copia en los servicios | Asignar a la persona según su función. | No | Integrantes | Igual que la cuenta |
| Asignaciones a servicios | R2 (`services/<id>.json`): correo, nombre y función | Saber quién participa y exportar el mes. | Solo si un admin asigna | Integrantes | Historial del ministerio |
| Autoría de cambios | R2 (`updatedBy` en servicios, `by` en letras) | Saber qué admin hizo un cambio. | Solo admins | Integrantes y admins | Mientras exista el objeto |
| Registro de aceptaciones | Neon (`gosen_consent_log`) | Probar quién aceptó qué versión, cuándo y desde qué formulario. | Sí, al aceptar o retirar | Solo admins (y la persona, lo suyo) | Mientras exista la cuenta + hasta 5 años (por confirmar); después se anonimiza |
| Anclajes del registro | R2 (`system/consent-anchors/`): solo huellas, sin datos personales | Detectar manipulaciones del registro. | — | Nadie por API | Igual que el registro |
| Sesión del panel | Navegador (`gosen.cloud.session`) | Mantener la sesión abierta. | Necesaria | La persona | 2 h, o hasta salir |
| Preferencias | Navegador (`gosen.web.theme`, `gosen.cloud.view`) | Recordar el tema y la vista de la lista. | **Opcional, con permiso** | La persona | Hasta retirar el permiso |
| Elección de cookies | Navegador (`gosen.web.privacy`) | Recordar la elección. | Necesaria | La persona | Hasta cambiarla |

**Qué NO se recoge** (verificado en el código):
- Documento de identidad, fecha de nacimiento, teléfono, dirección ni datos de pago.
- La IP o el navegador en nuestras bases de datos. Cloudflare y Neon procesan los datos de conexión
  para prestar el servicio.
- Analítica, píxeles, publicidad ni seguimiento.
- Peticiones a Google Fonts: antes había y se eliminaron. Las fuentes ahora se sirven desde el propio
  dominio.

**Hallazgos para una próxima versión de la app (no se cambiaron porque iban solo a la web):**
- **Nombre y etiqueta duplicados en los servicios.** Los servicios guardan una copia del nombre y la
  etiqueta de cada integrante. Desde la v0.36 la app ya los toma del directorio del equipo
  (`gosen_team`), así que la copia solo sirve de respaldo sin conexión. Se podría guardar únicamente
  el correo y la función.
- **El registro en la app no pide la autorización.** Las cuentas se crean en la app. El registro de
  aceptaciones (`/api/legal/accept`) ya acepta cualquier cuenta autorizada, así que una versión futura
  de la app puede pedir las casillas al registrarse o al primer inicio. Hoy la autorización se pide
  solo en el panel web (administradores).
- **Riesgo técnico de copia por la API.** Un integrante con conocimientos técnicos podría bajar las
  pistas por partes con su sesión (`/api/file/<clave>` con rangos), porque la app las necesita para
  sonar. No se bloqueó porque rompería la reproducción en los dispositivos. Se puede endurecer en una
  versión futura, por ejemplo con enlaces firmados por pista.

---

## 3. Normas identificadas

| Norma | ¿Aplica? | Por qué |
|---|---|---|
| **Ley Estatutaria 1581 de 2012** (protección de datos) y **Decreto 1377 de 2013**, compilado en el **Decreto Único 1074 de 2015** | **Sí** | La Comunidad trata datos personales (correo, nombre, función) de personas en Colombia. |
| Ley 1581, art. 5–6 (**datos sensibles**) | **Probablemente sí** | Pertenecer al equipo de una comunidad religiosa puede revelar convicciones religiosas. El art. 6, lit. d permite ese tratamiento a organismos sin ánimo de lucro de finalidad religiosa, referido a sus miembros. De todas formas se pide autorización expresa y se informa que no es obligatorio darla. |
| Ley 1581, art. 26 y Decreto 1377 (**transferencia o transmisión internacional**) | **Sí** | Neon (EE. UU.) y Cloudflare actúan como encargados fuera de Colombia. Requiere un contrato de transmisión o las garantías del proveedor (ver 7). |
| **Registro Nacional de Bases de Datos** (RNBD, Decreto 090 de 2018) | **Probablemente no** | Solo están obligadas las sociedades y entidades sin ánimo de lucro con activos totales de más de 100.000 UVT, y las entidades públicas. Hay que confirmar los activos de la Comunidad. |
| **Ley 1480 de 2011** (Estatuto del Consumidor) | **Sí, probablemente** | Las iglesias clientes pagan una suscripción para su propio uso como destinatarias finales. El artículo 5 incluye a las personas jurídicas como consumidoras en ese caso. La contratación es a distancia (WhatsApp y transferencia): aplican el deber de información, el retracto con sus excepciones, la reversión del pago y la atención de reclamos. Ver la sección 5. |
| **Facturación electrónica** (DIAN) | **Por confirmar** | Si quien vende está obligado a facturar, cada pago debe tener su factura electrónica. La plataforma registra el pago, pero no factura. |
| Ley 1581: **responsable y encargado** | **Sí** | Gosen es responsable de las cuentas, la seguridad y las suscripciones. Cada iglesia cliente es responsable de los datos de sus integrantes que gestiona (asignaciones, servicios), y Gosen es su encargado. Hace falta un acuerdo de transmisión entre cada iglesia y Gosen (Decreto 1377, art. 25); los términos pueden servir, pero hay que revisarlo. |
| Ley 1480, art. 47 (retracto) y art. 51 (reversión del pago), con la Ley 2439 de 2024 y la sentencia C-192 de 2026 | **Al cobrar** | El retracto es de 5 días hábiles, con las excepciones legales. La devolución del dinero se hace en un máximo de 15 días calendario (Ley 2439 de 2024, aplicado a todas las modalidades del art. 47 según la C-192 de 2026). La reversión del pago aplica a compras por comercio electrónico (Decreto 587 de 2016). |
| **Ley 527 de 1999** (mensajes de datos) | **Sí** | Da validez a la aceptación electrónica (arts. 5 y 14). El registro sirve como prueba del mensaje de datos. |
| **Ley 23 de 1982** y **Decisión Andina 351 de 1993** (derechos de autor) | **Sí** | Los multitracks y las obras son de terceros: descarga restringida y prohibición de redistribuir. |
| Cookies | **Sin norma específica en Colombia** | La SIC aplica la Ley 1581 a las cookies que recogen datos personales. Esta web no tiene cookies de seguimiento. Igual se pide permiso para guardar preferencias, que es más de lo que la ley exige. |

---

## 4. Obligaciones, medidas y estado

### 4.1 Obligaciones legales aplicables → medida técnica implementada

| Obligación (norma) | Implementación | Estado |
|---|---|---|
| Política de tratamiento con el contenido mínimo (Decreto 1377, art. 13) | `/legal/privacidad`: responsable, tratamiento y finalidades, derechos, procedimiento y vigencia | ⚠️ Lista. Faltan los datos del responsable y designar a la persona o área que atiende (sección 7) |
| Aviso de privacidad (Decreto 1377, art. 14–15) | Resumen al inicio de la política | ✅ |
| Autorización previa, expresa e informada, que se pueda probar (Ley 1581, art. 9; Decreto 1377, art. 7–8) | Casilla propia, desmarcada, con enlace al documento. El registro en Neon guarda versión, huella SHA-256, fecha y hora UTC del servidor, formulario y evento | ✅ |
| Informar que los datos sensibles son opcionales (Decreto 1377, art. 6) | Sección 4 de la política | ✅ |
| Revocar la autorización (Ley 1581, art. 8; Decreto 1377, art. 9) | Botón «Retirar» en Privacidad. Queda registrado, cierra el panel y anula la sesión abierta | ✅ |
| Consultas en 10 días hábiles (+5) y reclamos en 15 (+8) (Ley 1581, arts. 14–15) | Plazos y canal en la política | ⚠️ Falta el correo de contacto |
| Seguridad y confidencialidad (Ley 1581, art. 17) | Roles, HTTPS, registro de solo agregar, cadena de huellas y anclajes, verificación | ✅ |
| Validez de la aceptación electrónica (Ley 527) | Mensaje de datos con evidencia: quién, qué, cuándo y cómo | ✅ |
| Derechos de autor | Descarga solo para admins, con aceptación vigente, enlaces de 5 minutos y prohibición en los términos | ✅ |

### 4.2 Cómo funciona el consentimiento

- **Dónde se pide:** al entrar al panel web, la primera vez y cada vez que cambia la versión de un
  documento. **Solo se piden los documentos pendientes**, para no repetir lo ya aceptado.
- **Casillas:** dos, independientes y desmarcadas, cada una con su documento debajo. El enlace se abre
  en otra pestaña, así no se pierde el formulario. No se acepta por inactividad ni por entrar.
- **Validación en el servidor:**
  - `/api/legal/accept` rechaza una versión o huella que no sea la vigente, envíos vacíos y
    formularios desconocidos.
  - `/api/panel-session` y `/api/download/…` exigen las dos aceptaciones vigentes.
  - La sesión del panel guarda qué versiones estaban aceptadas, y una marca de retiro la invalida.
- **Si no acepta:** se le explica qué no puede usar (el panel y las descargas) y por qué. Los
  documentos y el canal de contacto siguen disponibles.
- **Sin finalidades opcionales:** no hay marketing ni publicidad, así que no se piden consentimientos
  de más. Si algún día los hubiera, irían en una casilla aparte y voluntaria.
- **Mientras los documentos sean BORRADOR** (faltan datos del responsable), no se piden ni se
  registran aceptaciones. Nadie acepta un texto incompleto. El panel y las descargas funcionan para
  los administradores.

### 4.3 El registro de aceptaciones (`sql/legal-consentimientos.sql`)

- **Una fila por aceptación o retiro.** Guarda:
  - el correo, el id de Neon Auth y la huella del correo;
  - documento, tipo, versión, huella del texto exacto y fecha de vigencia;
  - acción, formulario, operación (para no duplicar) y traza de la petición (cf-ray);
  - hora del servidor (UTC).
- **Solo agregar.** La tabla no se puede leer ni escribir directamente. Las funciones validan todo, y
  un disparador rechaza `UPDATE`, `DELETE` y `TRUNCATE`, incluso con acceso de dueño, salvo la
  anonimización controlada.
- **Resistente a manipulaciones.** Cada fila guarda la huella de la anterior (una cadena), y una copia
  de cada huella queda en R2. «Verificar integridad», en el panel, recalcula la cadena y compara los
  anclajes.
- **Límite.** Quien tenga acceso de dueño a Neon podría desactivar el disparador. La cadena y los
  anclajes lo **detectan**, pero no lo **impiden**. Conviene limitar quién tiene ese acceso.
- **Lo que no prueba.** El registro demuestra que la cuenta autenticada hizo la aceptación. No
  demuestra por sí solo la identidad de la persona física, ni hay IP o dispositivo que lo hagan.
- **Conservación.** `gosen_consent_anonymize(fecha)` quita el correo de las cuentas que ya no existen y
  cuya última actividad es anterior a esa fecha. La cadena sigue verificable. Solo la ejecuta el
  dueño de la base, a mano.

### 4.4 Cookies

- **Inspección.** No hay cookies propias. El almacenamiento local se resume así:
  - necesario: la sesión del panel y la elección de cookies;
  - preferencias (opcional): el tema y la vista de la lista;
  - analítica y publicidad: ninguna.
- **Antes de elegir:** nada opcional se guarda. El cambio de tema funciona solo durante esa visita.
- **Opciones:** aceptar, rechazar, configurar por categoría y cambiar o retirar desde «Configurar
  cookies», al pie de cada página. Al retirar, lo guardado se borra al momento.
- **Terceros:** Google Fonts se reemplazó por las fuentes propias (licencia OFL, en `public/fonts/`).
  Cloudflare puede poner cookies técnicas de seguridad cuando su protección lo requiere; están
  declaradas como necesarias.

### 4.5 Buenas prácticas recomendadas (no exigidas o no implementadas aquí)

1. **Designar a la persona o el área que atiende las solicitudes de datos** (Decreto 1377, art. 23) y
   ponerla en la política.
2. **Revisar la licencia de cada proveedor de multitracks** (cuántas descargas o equipos permite, si
   cubre ensayos personales, etc.) y ajustar los términos si alguno es más restrictivo.
3. **Limitar el acceso de dueño** a Neon y a la cuenta de Cloudflare, con autenticación en dos pasos.
4. **Revisar una vez al año:**
   - el registro (verificación de integridad);
   - la anonimización de cuentas que ya no existen;
   - si cambian los proveedores o las finalidades.
5. **Pedir la autorización en el registro de la app** (próxima versión). El endpoint ya existe.
6. **Antes de cobrar:**
   - publicar la versión 2.0 de los términos y de la política de reembolsos, con precio, plazos,
     retracto, reversión y garantía;
   - pedir una casilla aparte para las condiciones comerciales;
   - revisar la facturación electrónica y los medios de pago (fuera de este análisis).

---

## 5. Política de reembolsos: por qué dice lo que dice

**Qué dice (v37):**
- **Qué se paga:** una suscripción por adelantado, con pago manual, sin cobros ni renovaciones
  automáticas.
- **Cancelación:** basta con no renovar; el servicio sigue hasta el fin del período pagado. No hay
  devolución proporcional, salvo los casos que reconoce la ley.
- **Retracto (art. 47):** 5 días hábiles, con devolución en máximo 15 días calendario (Ley 2439 de 2024 y
  sentencia C-192 de 2026). Explica la excepción de los servicios ya iniciados con el acuerdo del
  consumidor y que Gosen debe avisarlo **antes** de activar.
- **Otros casos:** pago duplicado o mayor al acordado (se devuelve la diferencia), cobro no reconocido,
  servicio no prestado por falla de Gosen (días adicionales o devolución proporcional) y reversión del
  pago cuando aplique (art. 51 y Decreto 587 de 2016).
- **Procedimiento:** respuesta en máximo 15 días hábiles. La devolución se hace en los plazos legales
  donde existen y, en los demás casos, en la fecha que se acuerde. No se inventan plazos.
- **Lo que no dice:** nunca «no se hacen reembolsos» como regla general.

---

## 6. Procedimientos

**Actualizar un documento.** Está en `src/legal/documents.js`:
1. Agregar una versión nueva al final (no editar una vigente), con número, fecha de vigencia y
   resumen.
2. Desplegar. La anterior queda en `/legal/<doc>/<versión>`, y el panel vuelve a pedir la aceptación
   de términos o privacidad.

**Completar los datos del responsable:**
1. Llenar `src/legal/owner.js` (NIT, dirección, correo).
2. Poner la fecha en `EFFECTIVE_1_0` (`src/legal/documents.js`).
3. Ejecutar `sql/legal-consentimientos.sql` en Neon.
4. Desplegar.

**Atender una solicitud de datos:**
1. Verificar que la escriba el titular desde el correo de su cuenta.
2. Responder en los plazos legales.
3. **Supresión:** quitar el correo en el panel de integrantes de la app y borrar el usuario en Neon
   Auth. Las evidencias de aceptación se conservan hasta el plazo de conservación y luego se
   anonimizan.

**Incidente de seguridad:**
1. Contenerlo.
2. Evaluar a quién afecta.
3. Avisar a los titulares y reportarlo a la SIC cuando corresponda.

---

## 7. Pendiente de confirmar por el propietario o por un abogado

1. **Datos del responsable** (bloquean la entrada en vigor):
   - NIT o identificación;
   - dirección;
   - correo para datos personales;
   - teléfono (opcional).
2. **¿La Comunidad es una persona jurídica?** Por ejemplo, una entidad religiosa con personería
   jurídica. Esto determina quién figura como responsable y cómo se identifica.
3. **Activos totales frente a 100.000 UVT**, para confirmar que no aplica la inscripción en el RNBD.
4. **Contratos o cláusulas de transmisión internacional** con Neon y Cloudflare. Sus términos o
   acuerdos de procesamiento de datos (DPA) pueden servir; revisar si bastan.
5. **Plazo de conservación** de las evidencias: se propusieron 5 años, por confirmar.
6. **Datos sensibles:** confirmar el enfoque (autorización expresa frente a la excepción del art. 6,
   lit. d).
7. **Licencias** de los proveedores de multitracks frente a las descargas de los administradores.
8. **Persona o área que atiende** las consultas y reclamos de datos (Decreto 1377, art. 23), para ponerla en la política.
10. **(v37) Quién vende las suscripciones.** ¿Es la Comunidad Cristiana Gosen Barranquilla, una persona o
    una empresa? De eso dependen:
    - quién figura en los documentos;
    - la facturación electrónica;
    - el régimen tributario de los pagos.
11. **(v37) Acuerdo de encargo del tratamiento** con cada iglesia cliente (Decreto 1377, art. 25):
    confirmar si los términos bastan o si hace falta un documento aparte.
12. **(v37) Retracto:** confirmar con un abogado cómo informar y documentar el inicio del servicio
    (excepción del art. 47) antes de activar cada suscripción.
13. **(v37) Conservación de pagos y comprobantes:** confirmar el plazo exacto según las normas contables
    y tributarias que apliquen a quien vende.
9. **Cómo se avisará de los cambios** de la política a los integrantes que usan solo la app (correo o
   aviso de la app en una próxima versión).

---

## 8. Fuentes consultadas

- [Decreto 1377 de 2013 — Función Pública](https://www1.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=53646)
- [Decreto 1074 de 2015 (compilación), parte de datos personales](https://normativa.colpensiones.gov.co/colpensiones/docs/decreto_1074_2015_pr026.htm)
- [Decreto 090 de 2018 — RNBD (SIC)](https://sedeelectronica.sic.gov.co/sites/default/files/normatividad/042018/18036981RNBDobligados.PDF)
- [Ley 2439 de 2024 — Rama Judicial](https://sidn.ramajudicial.gov.co/SIDN//NORMATIVA/TEXTOS_COMPLETOS/7_LEYES/LEYES%202024/Ley%202439%20de%202024.pdf)
- [Sentencia C-192 de 2026 — Corte Constitucional](https://www.corteconstitucional.gov.co/relatoria/2026/c-192-26.htm)
- [Decreto 587 de 2016 (reversión del pago) — Función Pública](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=69037)
- [SIC — Concepto sobre cookies y datos personales](https://sedeelectronica.sic.gov.co/sites/default/files/normatividad/Concepto_13-291504.pdf)
