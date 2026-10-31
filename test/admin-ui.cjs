/**
 * Prueba del panel del admin en un navegador real (Electron), contra el servidor local de pruebas:
 * entrar, abrir una canción, ver sus pistas con nombre y categoría, renombrar, cambiar el orden y la
 * categoría, reemplazar solo el saxofón y guardar. Deja capturas en test-output/.
 *
 * Uso (con el Electron de la app): electron test/admin-ui.cjs
 */
const { app, BrowserWindow } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

let failures = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`)
  if (!cond) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '..')
  const server = spawn(process.env.NODE_BIN || 'node', ['--import', './test/register.mjs', 'test/server.mjs'], { cwd: root })
  const port = await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => {
      const m = /PORT (\d+)/.exec(String(d))
      if (m) resolve(Number(m[1]))
    })
    server.stderr.on('data', (d) => process.stderr.write(d))
    server.on('exit', (c) => reject(new Error(`servidor terminó (${c})`)))
  })
  const base = `http://127.0.0.1:${port}`
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { offscreen: true } })
  const js = (code) => win.webContents.executeJavaScript(code, true)
  const waitFor = async (cond, label, ms = 8000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await js(cond).catch(() => false)) return true
      await sleep(100)
    }
    ok(false, `tiempo agotado: ${label}`)
    return false
  }
  const out = path.join(root, 'test-output')
  fs.mkdirSync(out, { recursive: true })
  const shot = async (name) => fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG())
  const state = async () => (await fetch(`${base}/__test/state`)).json()

  try {
    await win.loadURL(base)
    await js(`localStorage.clear(); $('email').value = 'admin@iglesia.com'; $('pass').value = 'x'; $('lbtn').click(); 0`)
    await waitFor(`!document.getElementById('panel').classList.contains('hide') && document.querySelectorAll('#list .row').length === 1`, 'panel con la canción')
    ok(true, 'el admin entra y ve la canción')

    await js(`document.querySelector('#list .edit-btn').click(); 0`)
    await waitFor(`document.querySelectorAll('#trackRows .track-row').length === 3`, 'pistas en el diálogo')
    const rows = await js(`[...document.querySelectorAll('#trackRows .track-row')].map(r => [r.querySelector('.name').value, r.querySelector('select').value])`)
    ok(JSON.stringify(rows) === JSON.stringify([['Bajo', 'bass'], ['Bateria', 'drums'], ['Saxo alto', 'sax']]), `pistas con nombre y categoría: ${rows.map((r) => r.join('=')).join(', ')}`)
    const groups = await js(`[...document.querySelector('#trackRows select').querySelectorAll('optgroup')].map(g => g.label + ':' + g.children.length)`)
    ok(groups.length === 8 && groups.reduce((s, g) => s + Number(g.split(':')[1]), 0) === 31, `el selector tiene las 31 categorías en 8 familias (${groups.join(' · ')})`)
    ok(await js(`$('metaBpm').readOnly && $('metaBpm').value === '96' && $('metaDuration').readOnly`), 'BPM y duración se muestran, pero los detecta la app (solo lectura)')

    // Renombrar el bajo, pasar la batería a percusión, subir el saxofón y reemplazar su audio.
    await js(`(() => {
      const rows = [...document.querySelectorAll('#trackRows .track-row')]
      const name = rows[0].querySelector('.name'); name.value = 'Bajo eléctrico'; name.dispatchEvent(new Event('input'))
      const sel = rows[1].querySelector('select'); sel.value = 'percussion'; sel.dispatchEvent(new Event('change'))
      rows[2].querySelector('.up').click()
    })(); 0`)
    await js(`(() => {
      const input = document.getElementById('trackFile')
      input.click = () => {}
      const sax = [...document.querySelectorAll('#trackRows .track-row')].find(r => r.querySelector('.name').value === 'Saxo alto')
      sax.querySelector('.replace').click()
      const bytes = new Uint8Array(6000).map((_, i) => (i * 11) & 255)
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'Sax nuevo.wav', { type: 'audio/wav' }))
      input.files = dt.files; input.dispatchEvent(new Event('change'))
    })(); 0`)
    await waitFor(`!!document.querySelector('#trackRows .track-row.changed .track-file')`, 'reemplazo marcado')
    ok(true, 'el reemplazo del saxofón queda marcado hasta guardar')
    await sleep(500)
    await shot('admin-tracks')

    await js(`$('saveMetadata').click(); 0`)
    await waitFor(`!$('metadataDialog').open`, 'guardado', 15000)
    const st = await state()
    const sheet = JSON.parse(st['metadata/1700000000000-Eres.zip'].text)
    const t = sheet.tracks
    ok(t.map((x) => x.name).join(',') === 'Bajo eléctrico,Saxo alto,Bateria', `orden y nombres guardados en la ficha: ${t.map((x) => x.name).join(', ')}`)
    ok(t.find((x) => x.name === 'Bateria').category === 'percussion', 'la nueva categoría se guardó')
    const sx = t.find((x) => x.name === 'Saxo alto')
    ok(sx.source && sx.source.object.startsWith('tracks/1700000000000-Eres.zip/') && /^[0-9a-f]{64}$/.test(sx.source.sha256) && st[sx.source.object]?.size === 6000, 'el saxofón apunta a su archivo nuevo (subido aparte, con SHA-256)')
    ok(t.filter((x) => x !== sx).every((x) => x.source === 'zip'), 'las demás pistas siguen saliendo del ZIP original')
    ok(sheet.bpm === 96 && sheet.duration === 245 && st['1700000000000-Eres.zip'].size > 0, 'BPM, duración y el ZIP original intactos')

    await js(`document.querySelector('#list .edit-btn').click(); 0`)
    await waitFor(`document.querySelectorAll('#trackRows .track-row').length === 3 && document.querySelector('#trackRows .name').value === 'Bajo eléctrico'`, 'reabrir')
    ok(true, 'al volver a abrir la canción se ven los cambios')
    await sleep(500)
    await shot('admin-tracks-saved')
  } catch (err) {
    ok(false, `error: ${err.message}`)
  } finally {
    server.kill()
    console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodas las comprobaciones pasaron')
    app.exit(failures ? 1 : 0)
  }
})
