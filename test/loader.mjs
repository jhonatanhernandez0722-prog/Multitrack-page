import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Node no sabe importar .html ni .png (en Cloudflare lo hace wrangler): la página como texto, el logo vacío. */
export async function load(url, context, next) {
  if (url.endsWith('.html')) {
    const html = await readFile(fileURLToPath(url), 'utf8')
    return { format: 'module', source: `export default ${JSON.stringify(html)}`, shortCircuit: true }
  }
  if (url.endsWith('.png')) return { format: 'module', source: 'export default ""', shortCircuit: true }
  return next(url, context)
}
