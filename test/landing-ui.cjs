/**
 * Prueba de la página pública (/) en un navegador real (Electron), contra el servidor local de pruebas:
 * portada, las 5 demostraciones (avanzan solas, cambian de pestaña), tema claro/oscuro guardado,
 * movimiento reducido, celular y que el panel siga en /admin. Deja capturas en test-output/.
 *
 * Uso (con el Electron de la app): electron test/landing-ui.cjs
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

// La prueba abre y cierra varias ventanas: que cerrar una no termine la app.
app.on('window-all-closed', () => {})

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
  const out = path.join(root, 'test-output')
  fs.mkdirSync(out, { recursive: true })
  const open = async (width, height, opts = {}) => {
    const win = new BrowserWindow({ show: false, width, height, webPreferences: { offscreen: true } })
    const errors = []
    win.webContents.on('console-message', (e) => e.level === 'error' && errors.push(e.message))
    // Reintento: el servidor de pruebas a veces corta la primera conexión de una ventana nueva.
    for (let k = 0; ; k++) {
      try {
        await win.loadURL(`${base}/`)
        if (opts.reduced) {
          // Movimiento reducido emulado (como lo pide el sistema) y la página otra vez.
          win.webContents.debugger.attach('1.3')
          await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
          await win.loadURL(`${base}/`)
        }
        break
      } catch (err) {
        if (k >= 2) throw err
        await sleep(400)
      }
    }
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
    const shot = async (name) => fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    return { win, js, waitFor, shot, errors }
  }

  try {
    // Escritorio, tema claro.
    const d = await open(1366, 860)
    await d.js(`localStorage.setItem('gosen.web.theme', 'light'); location.reload(); 0`)
    await d.waitFor(`document.readyState === 'complete' && !!window.__gosenLanding`, 'página cargada')
    ok(await d.js(`document.title.includes('Gosen Tracks') && !!document.querySelector('.hero h1') && document.documentElement.dataset.theme === 'light'`), 'la portada abre en / con su título (tema claro guardado)')
    ok(await d.js(`!!document.querySelector('a[href="/admin"]') && !!document.querySelector('a[href="/iphone/"]')`), 'botones reales: Entrar (panel en /admin) y la app para iPhone')
    await sleep(900)
    await d.shot('landing-claro')
    // Demostraciones: 5 pestañas; avanzan solas paso a paso.
    await d.js(`document.getElementById('demos').scrollIntoView(); 0`)
    await sleep(600)
    ok((await d.js(`document.querySelectorAll('#tabs .tab').length`)) === 5, '5 demostraciones (canción, mezcla, secciones, salto a tempo, culto)')
    const cap1 = await d.js(`document.getElementById('capTxt').textContent`)
    await sleep(3200)
    const cap2 = await d.js(`document.getElementById('capTxt').textContent`)
    ok(cap1 && cap2 && cap1 !== cap2, `la demostración avanza sola con su texto: «${cap1}» → «${cap2}»`)
    ok(await d.js(`(() => { const c = document.querySelector('#screen .cursor'); return c.classList.contains('show') && /translate/.test(c.style.transform) })()`), 'el cursor se mueve sobre la app')
    await d.shot('landing-demo-cancion')
    for (const [i, name] of [[1, 'mezcla'], [2, 'secciones'], [3, 'salto'], [4, 'culto']]) {
      await d.js(`document.querySelectorAll('#tabs .tab')[${i}].click(); 0`)
      await sleep(5200)
      const st = await d.js(`({ on: document.querySelector('#tabs .tab.on')?.id, cap: document.getElementById('capNum').textContent })`)
      ok(st.on === `tab${i}` && Number(st.cap) >= 2, `pestaña «${name}»: corre su demostración (paso ${st.cap})`)
      await d.shot(`landing-demo-${name}`)
    }
    // Salto a tempo: espera el tiempo 1 y cambia a Coro.
    await d.js(`document.querySelectorAll('#tabs .tab')[3].click(); 0`)
    await d.waitFor(`document.getElementById('jBig')?.textContent === 'Coro'`, 'salto al Coro', 15000)
    ok(await d.js(`document.getElementById('jBar').textContent.startsWith('Compás 17 · 1')`), 'demostración de salto: cambia al Coro justo en el tiempo 1 del compás')
    // Tema oscuro: se guarda.
    await d.js(`document.getElementById('theme').click(); 0`)
    ok(await d.js(`document.documentElement.dataset.theme === 'dark' && localStorage.getItem('gosen.web.theme') === 'dark'`), 'el selector cambia a oscuro y lo recuerda')
    await d.js(`window.scrollTo(0, 0); 0`)
    await sleep(900)
    await d.shot('landing-oscuro')
    await d.js(`document.getElementById('funciones').scrollIntoView(); 0`)
    await sleep(1200)
    await d.shot('landing-funciones-oscuro')
    ok((await d.js(`document.querySelectorAll('#row1 .chip').length + document.querySelectorAll('#row2 .chip').length`)) >= 62, 'galería con las 31 categorías de instrumentos de la nube')
    ok(d.errors.length === 0, `sin errores en la consola${d.errors.length ? ': ' + d.errors.join(' | ') : ''}`)
    d.win.destroy()

    // Celular: sin desbordar a lo ancho y con la demostración a escala.
    const m = await open(390, 844)
    await m.waitFor(`!!window.__gosenLanding`, 'página en celular')
    await sleep(800)
    ok(await m.js(`document.documentElement.scrollWidth <= window.innerWidth + 1`), `celular: sin desplazamiento horizontal (${await m.js('document.documentElement.scrollWidth')} px)`)
    await m.shot('landing-celular')
    await m.js(`document.getElementById('demos').scrollIntoView(); 0`)
    await sleep(2500)
    ok(await m.js(`(() => { const b = document.getElementById('screenBox').getBoundingClientRect(); return b.width <= window.innerWidth && b.height > 150 })()`), 'celular: la demostración se escala al ancho de la pantalla')
    await m.shot('landing-celular-demo')
    m.win.destroy()

    // Movimiento reducido: sin animaciones, cada demostración muestra su resultado y sus pasos.
    const r = await open(1280, 800, { reduced: true })
    await r.waitFor(`!!window.__gosenLanding`, 'página (movimiento reducido)')
    await sleep(400)
    ok(await r.js(`matchMedia('(prefers-reduced-motion: reduce)').matches && document.getElementById('capNum').textContent === '4' && !!document.querySelector('#screen .m-tile:not(.hidden)')`), 'movimiento reducido: sin animar, la demostración queda en su resultado final')
    r.win.destroy()

    // El panel sigue funcionando en /admin.
    const res = await fetch(`${base}/admin`)
    ok(res.ok && (await res.text()).includes('id="login"'), 'el panel de canciones sigue en /admin')
  } catch (err) {
    ok(false, `error: ${err.message}`)
  } finally {
    server.kill()
    console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodas las comprobaciones pasaron')
    app.exit(failures ? 1 : 0)
  }
})
