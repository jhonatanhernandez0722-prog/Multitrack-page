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

5. Abre `https://gosen-tracks.gosentracks.workers.dev/` y entra con la cuenta de administrador de la app.

El archivo `wrangler.toml` define el nombre del Worker, la vinculación al bucket R2 y las URL de Neon Auth y Data API. No se requiere una base de datos D1 para este panel. La autenticación y autorización se comprueban con Neon; los ZIP, portadas y fichas musicales se guardan en R2.

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

## App para iPhone

`public/iphone/` es la PWA (se genera en la app con `npm run dist:iphone` y se copia aquí). Se instala desde
Safari en `https://gosen-tracks.gosentracks.workers.dev/iphone/` (Compartir → Agregar a pantalla de inicio).
`/api/proxy` hace de puente hacia Neon (solo sus dominios) para el inicio de sesión desde Safari.

## Pruebas

```powershell
node --import ./test/register.mjs test/worker.test.mjs   # Worker con R2 y Neon simulados
electron test/admin-ui.cjs                                # panel del admin en un navegador real
```

## Contenido compartido

- Los multitracks se almacenan como ZIP en R2.
- Las portadas y los metadatos de canción se guardan como objetos adicionales en el mismo bucket.
- La app obtiene el catálogo desde el Worker. Los metadatos incluyen nombre, artista, duración, tempo, tonalidad y compás.
- El panel permite migrar metadatos de ZIP existentes. La migración lee únicamente los rangos necesarios de `song.json`, no vuelve a subir ni descarga el ZIP completo y nunca reemplaza una ficha que ya exista.

No guardes contraseñas, tokens ni archivos `.dev.vars` en Git.
