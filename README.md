# Gosen Multitrack Cloud

Panel web de administración y Cloudflare Worker para la biblioteca compartida de Gosen Multitrack.

## Despliegue en Cloudflare

Este proyecto usa el Worker `gosen-tracks` y el bucket R2 existente `gosen-tracks`. Desplegarlo actualiza ese Worker, que también utiliza la app; no cambies el nombre del Worker ni el binding R2 si quieres conservar esa conexión.

1. Instala Node.js y Git, y clona este repositorio.
2. Abre una terminal en la carpeta del proyecto e inicia sesión en Cloudflare:

   ```powershell
   npx wrangler@latest login
   npx wrangler@latest whoami
   ```

3. Confirma que la cuenta de Cloudflare tenga el bucket R2 `gosen-tracks` y que sea la misma cuenta que administra el Worker actual.
4. Publica el Worker desde la raíz del repositorio:

   ```powershell
   npx wrangler@latest deploy
   ```

5. Abre `https://gosen-tracks.gosentracks.workers.dev/admin` y entra con la cuenta de administrador de la app.

## Páginas

- `/` — página pública de Gosen Tracks (`src/landing.html`): presentación con demostraciones animadas tipo
  tutorial (elegir la canción, mezclar, seccionar, saltar a tempo y armar el culto), tema claro/oscuro y
  movimiento reducido. Sin dependencias: HTML, CSS y JavaScript nativos.
- `/admin` — panel de canciones (`src/admin.html`). Portadas: se toman de cualquier imagen del ZIP (si hay
  varias, el admin elige con vista previa), y se pueden arrastrar desde el equipo o de una canción a otra.
  Antes de subir se valida el ZIP (que tenga audio y no esté cifrado) y se avisa si la canción ya existe.
- `/superadmin` — panel de Gosen para administrar la plataforma (`src/superadmin.html`): iglesias, planes,
  cupo, pagos y suscripciones, invitaciones de administradores, registro de acciones y respaldos. Exige 2FA.
- `/unirse#GSN-…` — página para quien recibe una invitación (`src/unirse.html`): muestra el código (con
  «Copiar») y explica cómo crear la cuenta en la app. El código va después de `#`, así que no llega al
  servidor.
- La app solo usa `/api/…` y `/iphone/`; las páginas se pueden cambiar sin afectarla.

El archivo `wrangler.toml` define el nombre del Worker, la vinculación al bucket R2 y las URL de Neon Auth y Data API. No se requiere una base de datos D1 para este panel. La autenticación y autorización se comprueban con Neon; los ZIP, portadas y fichas musicales se guardan en R2.

## Varias iglesias (v37)

Diseño completo: `docs/multiiglesia.md` en el repositorio de la app. En resumen:

- Cada cuenta pertenece a una iglesia (`church_id`), que se deduce siempre de la sesión. La iglesia interna
  `gosen` no ocupa cupo y conserva sus claves de R2 de siempre (en la raíz).
- Las demás iglesias guardan con prefijo: `c/<id>/` (canciones), `metadata/c/<id>/`, `covers/c/<id>/`,
  `tracks/c/<id>/`, `c/<id>/services/` y `branding/<id>/logo`. `keyOwner` (`src/tenancy.js`) comprueba en
  cada petición que la clave sea de la iglesia de la sesión; si no, responde como si no existiera.
- Funciones por plan: `can(me, función)` (`src/tenancy.js`), con las funciones que entrega Neon según el plan
  y el estado de la suscripción. Cuotas de almacenamiento por plan, comprobadas al subir.
- Una sala de ensayo por iglesia. Límite de intentos por IP en las rutas de acceso (Durable Object
  `Limiter`, migración `v3`: la aplica `wrangler deploy`).
- Planes y precios en la página principal (sección «Planes»): `GET /api/plans`, público. Sale de una copia que el
  Worker guarda en R2 (`system/public-plans.json`) cada vez que Superadmin abre o cambia los planes o el contacto;
  mientras no exista, muestra los planes iniciales. Si hay WhatsApp o correo de contacto, cada plan trae su botón.
- Antes de desplegar: ejecutar `neon/v37-iglesias.sql` (repositorio de la app) en el SQL Editor de Neon,
  con el correo del superadministrador en la última línea.

## Fuente única de los datos

La ficha de cada canción (`metadata/<clave>` en R2) es la fuente de verdad:

- **La web administra**: nombre, artista, tonalidad, compás y, por pista, nombre, categoría y orden.
- **La app detecta**: tempo (BPM) y duración; los publica con `/api/detected/<clave>` sin tocar lo demás.
- **Categorías**: el catálogo completo de la app (31 categorías en 8 familias, `src/catalog.js`), con los
  mismos ids que usa la app (`TRACK_TYPE_IDS`). Si se añade una, hay que añadirla en los dos sitios.

## Caché por pista (descargas rápidas)

- `GET /api/song/<clave>` devuelve la ficha resuelta: cada pista con su versión (`z<crc32>-<tamaño>` si sale
  del ZIP, `s<sha256>` si el admin la reemplazó) y de dónde descargarla.
- Las pistas del ZIP se descargan por rango (`Range: bytes=a-b`): solo esa pista, sin bajar el ZIP entero.
- Reemplazar una pista en el panel sube solo ese archivo a `tracks/<clave>/…`; el ZIP original no se toca y
  la app descarga solo esa pista.
- `GET /api/tracks` incluye `rev` por canción: si no cambia, la app no vuelve a mirar su ficha.

## Descargas de la app y actualizaciones (v0.40)

- Los instaladores (Windows, Mac y Android) se publican en **GitHub Releases** de este repositorio, con la
  etiqueta `app-v<versión>` y nombres fijos: `Gosen-Multitrack-Windows.exe`, `Gosen-Multitrack-Mac.zip` y
  `Gosen-Tracks-Android.apk`. Junto a ellos va `latest.json`, con la versión, las novedades y el tamaño y
  sha256 de cada archivo.
- Los publica la app con `node scripts/publish-release.mjs`. Publicar una versión **no** requiere volver a
  desplegar el Worker.
- `GET /api/app/latest` (`src/appRelease.js`) lee `latest.json` de la última publicación, lo valida (solo
  archivos de las publicaciones de este repositorio) y lo guarda en caché unos minutos. Lo usan la barra
  de descargas de la página y el botón «Actualizar» de las apps.
- `GET /descargar/<windows|mac|android>` lleva al instalador de la última versión; `/descargar/iphone`
  lleva a `/iphone/`.
- La barra de descargas va arriba del todo en la página principal: un botón por sistema, el del
  visitante resaltado, el número de versión y «Novedades».

## App para iPhone

`public/iphone/` es la PWA (se genera en la app con `npm run dist:iphone` y se copia aquí). Se instala desde
Safari en `https://gosen-tracks.gosentracks.workers.dev/iphone/` (Compartir → Agregar a pantalla de inicio).
`/api/proxy` hace de puente hacia Neon (solo sus dominios) para el inicio de sesión desde Safari.

## Legal, privacidad y descargas

- `/legal` — términos, política de privacidad y tratamiento de datos, cookies y reembolsos, con versiones
  e historial (`src/legal/documents.js`). Mientras falten datos del responsable (`src/legal/owner.js`) o la
  fecha de vigencia, se publican como **borrador** y no se piden aceptaciones.
- Al entrar al panel (con los documentos vigentes) se piden dos casillas independientes, desmarcadas:
  términos y autorización de datos. Se registran en Neon con versión y huella exacta
  (`sql/legal-consentimientos.sql`: ejecutarlo una vez en el SQL Editor de Neon). El servidor exige esas
  aceptaciones para entregar la sesión del panel y los enlaces de descarga.
- Descargas: solo administradores, desde «Descargar» en cada canción (enlaces firmados de 5 minutos: el ZIP
  original y las pistas reemplazadas).
- Cookies: no hay analítica ni publicidad; las preferencias (tema, vista) solo se guardan con permiso
  («Configurar cookies» al pie). Las fuentes se sirven desde `public/fonts/` (sin Google Fonts).
- Análisis legal, inventario de datos y pendientes: `docs/cumplimiento-legal.md`.

## Pruebas

```powershell
node --import ./test/register.mjs test/worker.test.mjs   # Worker con R2 y Neon simulados
electron test/admin-ui.cjs                                # panel del admin en un navegador real
electron test/landing-ui.cjs                              # página pública: demostraciones, temas, celular
node --import ./test/register.mjs test/legal.test.mjs    # documentos, aceptaciones y descargas (Worker)
GOSEN_PGLITE=<carpeta con node_modules/@electric-sql/pglite> node test/sql.test.mjs   # el SQL de aceptaciones en Postgres
electron test/legal-ui.cjs                                # aceptación, cookies y descargas en un navegador
node --import ./test/register.mjs test/churches.test.mjs # varias iglesias: aislamiento, cuotas, planes, 2FA, límites
electron test/saas-ui.cjs                                 # Superadmin y panel de la iglesia en un navegador
```

## Contenido compartido

- Los multitracks se almacenan como ZIP en R2.
- Las portadas y los metadatos de canción se guardan como objetos adicionales en el mismo bucket.
- La app obtiene el catálogo desde el Worker. Los metadatos incluyen nombre, artista, duración, tempo, tonalidad y compás.
- El panel permite migrar metadatos de ZIP existentes. La migración lee únicamente los rangos necesarios de `song.json`, no vuelve a subir ni descarga el ZIP completo y nunca reemplaza una ficha que ya exista.

No guardes contraseñas, tokens ni archivos `.dev.vars` en Git.
