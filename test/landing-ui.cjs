/**
 * Prueba de la página pública (/) en un navegador real (Electron), contra el servidor local de pruebas:
 * portada, las 5 demostraciones (avanzan solas, cambian de pestaña), tema claro/oscuro guardado,
 * movimiento reducido, celular, planes y precios (de /api/plans) y que el panel siga en /admin.
 * Deja capturas en test-output/.
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
    // Con permiso para recordar preferencias (ver test/legal-ui.cjs: sin permiso no se guarda).
    await d.js(`window.gosenPrivacy.set(true); document.getElementById('theme').click(); 0`)
    ok(await d.js(`document.documentElement.dataset.theme === 'dark' && localStorage.getItem('gosen.web.theme') === 'dark'`), 'con permiso para las preferencias, el selector cambia a oscuro y lo recuerda')
    await d.js(`window.scrollTo(0, 0); 0`)
    await sleep(900)
    await d.shot('landing-oscuro')
    await d.js(`document.getElementById('funciones').scrollIntoView(); 0`)
    await sleep(1200)
    await d.shot('landing-funciones-oscuro')
    ok((await d.js(`document.querySelectorAll('#row1 .chip').length + document.querySelectorAll('#row2 .chip').length`)) >= 62, 'galería con las 31 categorías de instrumentos de la nube')
    // Planes y precios: públicos, con lo que incluye cada uno.
    ok(await d.js(`!!document.querySelector('.nav-links a[href="#planes"]')`), 'el menú tiene «Planes»')
    await d.js(`document.getElementById('planes').scrollIntoView(); 0`)
    await d.waitFor(`document.querySelectorAll('#plans .plan').length === 3`, 'tarjetas de planes')
    await sleep(1200)
    const plans = await d.js(`[...document.querySelectorAll('#plans .plan')].map((c) => ({ name: c.querySelector('h3').textContent, price: c.querySelector('.price b').textContent, limits: c.querySelector('.limits').innerText.replace(/\\s+/g, ' '), from: c.querySelector('.from')?.textContent ?? '', items: [...c.querySelectorAll('li')].map((l) => l.textContent) }))`)
    ok(plans.map((p) => `${p.name} ${p.price}`).join(' · ') === 'Gosen Inicial $39.900 · Gosen Equipo $69.900 · Gosen Premium $119.900', `los 3 planes con su precio mensual: ${plans.map((p) => `${p.name} ${p.price}`).join(' · ')}`)
    ok(/10 integrantes/.test(plans[0].limits) && /50 GB/.test(plans[0].limits) && /300 GB/.test(plans[2].limits), `cada uno con sus integrantes y su espacio (${plans.map((p) => p.limits).join(' | ')})`)
    ok(
      plans[0].items.includes('Reproductor multitrack') && plans[1].from === 'Todo lo de Gosen Inicial, más:' && plans[1].items.includes('Ensayo múltiple sincronizado') && !plans[1].items.includes('Reproductor multitrack') && plans[2].items.includes('Holyrics Connect e integración con Holyrics'),
      'qué incluye: Inicial con lo básico; Equipo y Premium dicen «Todo lo de…, más:» y lo que agregan'
    )
    ok(await d.js(`!document.querySelector('#plans .btn') && document.getElementById('plansNote').innerText.includes('COP') && !!document.querySelector('#plansNote a[href="/legal/reembolsos"]')`), 'sin contacto configurado no hay botón vacío; nota de moneda y enlace a reembolsos')
    await d.shot('landing-planes-oscuro')
    ok(
      await d.js(`document.querySelectorAll('#iphone .ios-step').length === 4 && document.getElementById('iosUrl').textContent === location.origin + '/iphone/' && document.querySelectorAll('a[href="#iphone"]').length >= 2 && !!document.querySelector('#iphone a[href="/iphone/"]')`),
      'paso a paso para instalar en iPhone: 4 pasos, el enlace real para copiar, y «App para iPhone» / «Instalar en iPhone» llevan ahí'
    )
    // Descargas arriba del todo: un botón por sistema, la versión publicada y sus novedades.
    await d.js(`document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); document.querySelectorAll('.hero .reveal').forEach((e) => e.classList.add('in')); 0`)
    await sleep(900)
    await d.waitFor(`!document.getElementById('dlVer').hidden`, 'versión publicada en la barra de descargas')
    const bar = await d.js(`(() => {
      const b = document.getElementById('dlBar').getBoundingClientRect()
      const nav = document.querySelector('.nav-in').getBoundingClientRect()
      // Posición del título en la página (sin contar lo desplazado) frente al final del menú fijo.
      const h1 = { top: document.querySelector('.hero h1').getBoundingClientRect().top + scrollY - nav.bottom + b.bottom }
      const links = [...document.querySelectorAll('.dl-btn')].map((a) => ({ t: a.textContent.trim(), href: a.getAttribute('href'), pop: a.hasAttribute('data-ios-pop') }))
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), navTop: Math.round(nav.top), h1: Math.round(h1.top), links, ver: document.getElementById('dlVer').textContent, mine: document.querySelector('.dl-btn.mine')?.dataset.os ?? '' }
    })()`)
    ok(bar.top === 0 && bar.navTop >= bar.bottom - 1, `la barra de descargas va arriba del todo, sobre el menú (${bar.top}–${bar.bottom} px)`)
    ok(
      bar.links.map((l) => l.t).join() === 'Windows,Mac,Android,iPhone' && bar.links[0].href === '/descargar/windows' && bar.links[1].href === '/descargar/mac' && bar.links[2].href === '/descargar/android' && bar.links[3].pop,
      'un botón para descargar en cada sistema (Windows, Mac, Android) y el de iPhone con su paso a paso'
    )
    ok(bar.ver === 'v0.40.0' && bar.mine === 'windows', `muestra la versión publicada (${bar.ver}) y resalta el sistema de quien visita (${bar.mine || 'ninguno'})`)
    ok(bar.h1 > bar.bottom + 40, `el título de la portada no queda tapado por la barra ni el menú (${bar.h1 - bar.bottom} px de aire)`)
    await d.js(`document.getElementById('dlNews').click(); 0`)
    await sleep(200)
    ok(
      await d.js(`(() => { const p = document.getElementById('dlNotes'); const r = p.getBoundingClientRect(); return !p.hidden && p.innerText.includes('Actualizaciones desde la app') && p.innerText.includes('se vuelve a abrir sola') && r.right <= innerWidth && r.top >= document.getElementById('dlBar').getBoundingClientRect().bottom })()`),
      '«Novedades» muestra lo que trae la última versión, debajo de la barra'
    )
    await d.shot('landing-descargas')
    await d.js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 0`)
    ok(await d.js(`document.getElementById('dlNotes').hidden`), 'y se cierra con Escape')
    const dl = await fetch(`${base}/descargar/windows`, { redirect: 'manual' })
    ok(dl.status === 302 && /releases\/download\/app-v0\.40\.0\/Gosen-Multitrack-Windows\.exe$/.test(dl.headers.get('location') ?? ''), '«Windows» descarga el instalador de la última versión')
    await d.js(`document.querySelector('.nav a[data-ios-pop]').click(); 0`)
    await new Promise((r) => setTimeout(r, 200))
    ok(
      await d.js(`(() => { const p = document.getElementById('iosPop'); const b = document.querySelector('.nav a[data-ios-pop]').getBoundingClientRect(); const r = p.getBoundingClientRect(); return !p.hidden && r.top >= b.bottom && r.top - b.bottom < 30 && r.right <= innerWidth && p.innerText.includes('Agregar a pantalla de inicio') })()`),
      'al tocar «App para iPhone», el paso a paso aparece justo debajo del botón'
    )
    await d.shot('landing-iphone-pop')
    await d.js(`document.querySelector('#iosPop .ios-pop-x').click(); 0`)
    ok(await d.js(`document.getElementById('iosPop').hidden`), 'y se cierra con la ×')
    ok(d.errors.length === 0, `sin errores en la consola${d.errors.length ? ': ' + d.errors.join(' | ') : ''}`)
    d.win.destroy()

    // Celular: sin desbordar a lo ancho y con la demostración a escala.
    const m = await open(390, 844)
    await m.waitFor(`!!window.__gosenLanding`, 'página en celular')
    await sleep(800)
    ok(await m.js(`document.documentElement.scrollWidth <= window.innerWidth + 1`), `celular: sin desplazamiento horizontal (${await m.js('document.documentElement.scrollWidth')} px)`)
    ok(
      await m.js(`(() => { const bar = document.getElementById('dlBar').getBoundingClientRect(); const bs = [...document.querySelectorAll('.dl-btn')].map((b) => b.getBoundingClientRect()); return bs.length === 4 && bs.every((r) => r.left >= 0 && r.right <= innerWidth && r.top >= bar.top && r.bottom <= bar.bottom) && bar.height < 60 })()`),
      'celular: los 4 botones de descarga caben en una línea arriba del todo'
    )
    await m.shot('landing-descargas-celular')
    await m.shot('landing-celular')
    await m.js(`document.getElementById('demos').scrollIntoView(); 0`)
    await sleep(2500)
    ok(await m.js(`(() => { const b = document.getElementById('screenBox').getBoundingClientRect(); return b.width <= window.innerWidth && b.height > 150 })()`), 'celular: la demostración se escala al ancho de la pantalla')
    await m.shot('landing-celular-demo')
    await m.js(`document.getElementById('planes').scrollIntoView(); 0`)
    await m.waitFor(`document.querySelectorAll('#plans .plan').length === 3`, 'planes en celular')
    await sleep(1200)
    ok(await m.js(`(() => { const cs = [...document.querySelectorAll('#plans .plan')].map((c) => c.getBoundingClientRect()); return cs.every((r) => r.right <= window.innerWidth && r.left >= 0) && cs[1].top > cs[0].bottom - 1 })()`), 'celular: los planes van uno debajo del otro, sin salirse')
    await m.shot('landing-celular-planes')
    ok(
      await m.js(`(() => { const cs = [...document.querySelectorAll('#iphone .ios-step')].map((c) => c.getBoundingClientRect()); return cs.length === 4 && cs.every((r) => r.right <= window.innerWidth && r.left >= 0) && cs[1].top > cs[0].bottom - 1 })()`),
      'celular: los pasos para instalar en iPhone van uno debajo del otro, sin salirse'
    )
    await m.js(`document.querySelector('.cta a[data-ios-pop]').scrollIntoView({ block: 'center' }); document.querySelector('.cta').classList.add('in'); document.querySelector('.cta a[data-ios-pop]').click(); 0`)
    await new Promise((r) => setTimeout(r, 300))
    ok(
      await m.js(`(() => { const r = document.getElementById('iosPop').getBoundingClientRect(); return !document.getElementById('iosPop').hidden && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && innerHeight - r.bottom < 40 })()`),
      'celular: «Instalar en iPhone» muestra el paso a paso abajo de la pantalla, sin salirse'
    )
    await m.shot('landing-iphone-pop-movil')
    await m.js(`document.querySelector('#iosPop .ios-pop-x').click(); window.scrollTo(0, 0); 0`)
    await new Promise((r) => setTimeout(r, 300))
    const heroBtn = await m.js(`(() => { const b = document.querySelector('.hero-cta a[data-ios-pop]'); const r = b.getBoundingClientRect(); return { w: Math.round(r.width), top: Math.round(r.top + scrollY), right: Math.round(r.right), vw: innerWidth, vh: innerHeight } })()`)
    ok(
      heroBtn.w > 0 && heroBtn.top < heroBtn.vh && heroBtn.right <= heroBtn.vw,
      `celular: «Instalar en iPhone» está arriba, en la portada, visible al abrir la página (${JSON.stringify(heroBtn)})`
    )
    await m.js(`document.querySelector('#iosPop .ios-pop-x').click(); 0`)
    await m.js(`document.getElementById('iphone').scrollIntoView(); document.querySelectorAll('#iphone .reveal').forEach((el) => el.classList.add('in')); 0`)
    await new Promise((r) => setTimeout(r, 700))
    await m.shot('landing-iphone-movil')
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
