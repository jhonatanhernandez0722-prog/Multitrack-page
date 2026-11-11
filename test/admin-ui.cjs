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
    await win.loadURL(`${base}/admin`)
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

    // --- Portadas, validación del ZIP, duplicados, orden y tema ------------------------------
    // Herramientas en la página: ZIP sin comprimir (con su CRC), imágenes PNG reales y un WAV.
    await js(`(() => {
      const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
      const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
      window.__zip = (files) => {
        const enc = new TextEncoder(), local = [], central = []
        let off = 0
        for (const f of files) {
          const name = enc.encode(f.name), data = f.data, crc = crc32(data)
          const h = new DataView(new ArrayBuffer(30))
          h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true)
          local.push(new Uint8Array(h.buffer), name, data)
          const c = new DataView(new ArrayBuffer(46))
          c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true)
          central.push(new Uint8Array(c.buffer), name)
          off += 30 + name.length + data.length
        }
        const size = central.reduce((s, x) => s + x.length, 0)
        const e = new DataView(new ArrayBuffer(22))
        e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true)
        return new Blob([...local, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' })
      }
      window.__png = async (color, size = 64) => { const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, size, size); return new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer()) }
      window.__wav = () => { const b = new Uint8Array(44 + 800); b.set(new TextEncoder().encode('RIFF'), 0); b.set(new TextEncoder().encode('WAVE'), 8); return b }
      window.__send = (blob, name) => { const dt = new DataTransfer(); dt.items.add(new File([blob], name, { type: 'application/zip' })); $('file').files = dt.files; $('file').onchange() }
      return 0
    })()`)
    const covers = async () => Object.keys(await state()).filter((k) => k.startsWith('covers/'))
    const before = (await covers()).length

    // 1) Varias imágenes con nombres cualquiera: se elige viendo cada una.
    await js(`(async () => { const z = __zip([{ name: 'Gracia/song.json', data: new TextEncoder().encode(JSON.stringify({ name: 'Gracia sublime' })) }, { name: 'Gracia/Bateria.wav', data: __wav() }, { name: 'Gracia/arte/IMG_2041.png', data: await __png('#e11d48') }, { name: 'Gracia/foto banda final.png', data: await __png('#2563eb') }, { name: '__MACOSX/Gracia/._IMG_2041.png', data: new Uint8Array(10) }]); __send(z, 'Gracia.zip'); return 0 })()`)
    await waitFor(`$('coverPickDialog').open && document.querySelectorAll('#coverPickGrid .cover-opt').length === 2 && [...document.querySelectorAll('#coverPickGrid img')].every(i => i.src.startsWith('blob:'))`, 'elegir entre 2 imágenes', 10000)
    ok(true, 'ZIP con 2 imágenes de nombres cualquiera (IMG_2041.png, «foto banda final.png»): pide elegir con vista previa y no confunde la basura de macOS')
    await js(`document.querySelectorAll('#coverPickGrid .cover-opt')[1].click(); $('coverPickOk').click(); 0`)
    await waitFor(`[...document.querySelectorAll('#queue .job.ok')].some(j => j.innerText.includes('foto banda final.png'))`, 'subida con la portada elegida', 15000)
    const afterPick = await covers()
    ok(afterPick.length === before + 1, `la portada elegida se guarda en la nube con la canción (${afterPick.length - before} nueva)`)

    // 2) Una sola imagen: se usa sola, sin preguntar.
    await js(`(async () => { const z = __zip([{ name: 'Rey/Bajo.wav', data: __wav() }, { name: 'Rey/scan001.jpg', data: await __png('#16a34a', 24) }]); __send(z, 'Rey de reyes.zip'); return 0 })()`)
    await waitFor(`[...document.querySelectorAll('#queue .job.ok')].some(j => j.innerText.includes('scan001.jpg'))`, 'portada única automática', 15000)
    ok(!(await js(`$('coverPickDialog').open`)) && (await covers()).length === before + 2, 'ZIP con una sola imagen (scan001.jpg): se usa como portada sin preguntar')

    // 3) Sin audio: se rechaza antes de subir.
    await js(`(async () => { __send(__zip([{ name: 'solo-foto.png', data: await __png('#000') }]), 'Vacio.zip'); return 0 })()`)
    await waitFor(`[...document.querySelectorAll('#queue .job.fail')].some(j => j.innerText.includes('no trae pistas de audio'))`, 'ZIP sin audio', 8000)
    ok(true, 'un ZIP sin pistas de audio se rechaza antes de subirlo, con el motivo')

    // 4) Duplicado: avisa y se puede omitir.
    await js(`window.__confirmed = []; window.confirm = (m) => { __confirmed.push(m); return false }; 0`)
    await js(`(async () => { __send(__zip([{ name: 'X/song.json', data: new TextEncoder().encode(JSON.stringify({ name: 'Gracia Sublime' })) }, { name: 'X/Piano.wav', data: __wav() }]), 'Otra.zip'); return 0 })()`)
    await waitFor(`[...document.querySelectorAll('#queue .job.fail')].some(j => j.innerText.includes('ya está en la nube'))`, 'duplicado', 8000)
    ok((await js(`__confirmed.length === 1 && __confirmed[0].includes('ya está en la nube')`)), 'subir otra vez «Gracia Sublime» avisa que ya está (sin importar mayúsculas ni tildes) y se puede omitir')

    // 5) Soltar una imagen del equipo sobre una canción: vista previa y se guarda.
    await waitFor(`document.querySelectorAll('#list .row').length === 3`, 'tres canciones', 8000)
    await js(`(async () => { const row = [...document.querySelectorAll('#list .row')].find(r => r.innerText.includes('Eres Todopoderoso')); const dt = new DataTransfer(); dt.items.add(new File([await __png('#f59e0b')], 'mi portada.png', { type: 'image/png' })); row.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); window.__dropHint = row.classList.contains('cover-drop'); row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); return 0 })()`)
    await waitFor(`$('coverConfirmDialog').open && $('coverNew').src.startsWith('blob:')`, 'vista previa de la portada', 5000)
    ok(await js(`window.__dropHint`), 'al arrastrar una imagen sobre una canción se marca que la acepta')
    await js(`$('coverConfirmOk').click(); 0`)
    await waitFor(`!$('coverConfirmDialog').open`, 'portada confirmada', 5000)
    await sleep(800)
    ok((await state())['covers/1700000000000-Eres.zip']?.size > 0, 'soltar «mi portada.png» sobre «Eres Todopoderoso» (con vista previa) la guarda en la nube')

    // 6) Arrastrar la portada de una canción a otra (se copia).
    const keyOf = (t) => js(`[...document.querySelectorAll('#list .row')].find(r => r.innerText.includes(${JSON.stringify(t)})).dataset.key`)
    const reyKey = await keyOf('Rey de reyes')
    await waitFor(`[...document.querySelectorAll('#list .row')].find(r => r.innerText.includes('Gracia sublime'))?.querySelector('.thumb img')?.src.startsWith('blob:')`, 'portada visible', 8000)
    await js(`(() => { const rows = [...document.querySelectorAll('#list .row')]; const from = rows.find(r => r.innerText.includes('Gracia sublime')).querySelector('.thumb'); const to = rows.find(r => r.innerText.includes('Rey de reyes')); const dt = new DataTransfer(); from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); return 0 })()`)
    await waitFor(`$('coverConfirmDialog').open && $('coverConfirmText').textContent.includes('Gracia sublime')`, 'copiar portada', 5000)
    const sizeBefore = (await state())[`covers/${reyKey}`]?.size
    await js(`$('coverConfirmOk').click(); 0`)
    await waitFor(`!$('coverConfirmDialog').open`, 'copia confirmada', 5000)
    await sleep(800)
    const sizeAfter = (await state())[`covers/${reyKey}`]?.size
    ok(sizeAfter > 0 && sizeAfter !== sizeBefore, 'arrastrar la portada de «Gracia sublime» a «Rey de reyes» la reemplaza (la original no cambia)')

    // 7) Orden, filtro y búsqueda sin tildes.
    await js(`(() => { const s = $('sortBy'); s.value = 'name'; s.onchange(); return 0 })()`)
    const names = await js(`[...document.querySelectorAll('#list .row .name')].map(n => n.textContent)`)
    ok(names.join(',') === 'Eres Todopoderoso,Gracia sublime,Rey de reyes', `ordenar por nombre: ${names.join(', ')}`)
    await js(`$('q').value = 'gracia sublíme'; $('q').oninput(); 0`)
    ok((await js(`document.querySelectorAll('#list .row').length`)) === 1, 'la búsqueda no distingue tildes ni mayúsculas')
    await js(`(() => { $('q').value = ''; $('q').oninput(); const f = $('filterBy'); f.value = 'nometa'; f.onchange(); return 0 })()`)
    const noMeta = await js(`[...document.querySelectorAll('#list .row .name')].map(n => n.textContent)`)
    ok(noMeta.join(',') === 'Rey de reyes', `filtro «Sin ficha»: ${noMeta.join(', ')}`)
    await js(`(() => { const f = $('filterBy'); f.value = 'all'; f.onchange(); return 0 })()`)

    // 8) Sesión de 2 horas, vistas separadas y avisos de subida que no quedan.
    const ses = await js(`(() => { const s = JSON.parse(localStorage.getItem('gosen.cloud.session')); return s.panel ? (s.panel.exp - Date.now()) / 3600000 : 0 })()`)
    ok(ses > 1.9 && ses <= 2, `el panel usa una sesión de ${ses.toFixed(2)} horas (las subidas largas no se cortan)`)
    await js(`document.querySelector('.nav-item[data-view="library"]').click(); 0`)
    const lib = await js(`({ list: getComputedStyle($('cloudList')).display !== 'none', upload: getComputedStyle($('upload')).display !== 'none', title: $('viewTitle').textContent })`)
    await js(`document.querySelector('.nav-item[data-view="upload"]').click(); 0`)
    const upl = await js(`({ list: getComputedStyle($('cloudList')).display !== 'none', upload: getComputedStyle($('upload')).display !== 'none', title: $('viewTitle').textContent })`)
    ok(lib.list && !lib.upload && upl.upload && !upl.list && lib.title === 'Biblioteca' && upl.title === 'Subir canciones', '«Biblioteca» muestra la lista de canciones y «Subir canciones» solo la subida (ya no son lo mismo)')
    await waitFor(`!document.querySelector('#queue .job.ok')`, 'los avisos de subidas terminadas se van solos', 9000)
    const left = await js(`document.querySelectorAll('#queue .job.fail').length`)
    await js(`document.querySelectorAll('#queue .job.fail .job-x').forEach((b) => b.click()); 0`)
    await sleep(600)
    ok((await js(`document.querySelectorAll('#queue .job').length`)) === 0 && left > 0, `las subidas que salieron bien se quitan solas; los ${left} avisos de error se cierran con ×`)
    await js(`document.querySelector('.nav-item[data-view="library"]').click(); 0`)

    // 8) Tema claro/oscuro, el mismo de la página principal.
    const t0 = await js(`document.documentElement.dataset.theme`)
    await js(`$('themeBtn').click(); 0`)
    ok((await js(`document.documentElement.dataset.theme`)) !== t0 && (await js(`localStorage.getItem('gosen.web.theme')`)) === (await js(`document.documentElement.dataset.theme`)), 'el panel cambia entre tema claro y oscuro y lo recuerda')
    await js(`$('metadataDialog').open && $('metadataDialog').close(); document.documentElement.dataset.theme = 'light'; document.getElementById('list').scrollIntoView({ block: 'center' }); 0`)
    await sleep(500)
    await shot('admin-claro')
    await js(`document.documentElement.dataset.theme = 'dark'; 0`)
    await sleep(300)
    await shot('admin-oscuro')
  } catch (err) {
    ok(false, `error: ${err.message}`)
  } finally {
    server.kill()
    console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodas las comprobaciones pasaron')
    app.exit(failures ? 1 : 0)
  }
})
