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

## Contenido compartido

- Los multitracks se almacenan como ZIP en R2.
- Las portadas y los metadatos de canción se guardan como objetos adicionales en el mismo bucket.
- La app obtiene el catálogo desde el Worker. Los metadatos incluyen nombre, artista, duración, tempo, tonalidad y compás.
- El panel permite migrar metadatos de ZIP existentes. La migración lee únicamente los rangos necesarios de `song.json`, no vuelve a subir ni descarga el ZIP completo y nunca reemplaza una ficha que ya exista.

No guardes contraseñas, tokens ni archivos `.dev.vars` en Git.
