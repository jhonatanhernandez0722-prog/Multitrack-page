/**
 * Prueba en un navegador real (Electron) de la página /contratar, contra test/saas-server.mjs (Worker real
 * + Neon y Neon Auth simulados):
 *  - prueba gratuita de punta a punta: el código llega en el enlace, nombre de la iglesia, correo,
 *    contraseña, las dos casillas (sin ellas no avanza), verificación del correo y la prueba activa;
 *  - contratar con el pago en línea todavía apagado: precios en COP, ahorro anual y aviso claro;
 *  - celular: sin desbordar.
 * Deja capturas en test-output/.
 *
 * Uso (con el Electron de la app): electron test/contratar-ui.cjs
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
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '..')
  const server = spawn(process.env.NODE_BIN || 'node', ['--import', './test/register.mjs', 'test/saas-server.mjs'], { cwd: root })
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
  const open = async (url, width = 1100, height = 900) => {
    const win = new BrowserWindow({ show: false, width, height, webPreferences: { offscreen: true } })
    const errors = []
    win.webContents.on('console-message', (e) => e.level === 'error' && errors.push(e.message))
    await win.loadURL(base + url)
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
  const set = (id, value) => `(() => { const el = document.getElementById('${id}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input')); return 0 })()`

  try {
    console.log('Prueba gratuita desde el enlace del código')
    const t = await open('/contratar?prueba=1#PRB-AAAA-BBBB-CCCC')
    await t.waitFor(`!document.getElementById('stepAccount').hidden && document.getElementById('code').value === 'PRB-AAAA-BBBB-CCCC'`, 'formulario de la prueba')
    ok(await t.js(`/5 días/.test(document.getElementById('lead').textContent) && document.getElementById('accountBtn').textContent === 'Activar prueba'`), 'el código llega en el enlace y la página explica la prueba de 5 días, sin tarjeta')
    ok(await t.js(`!document.getElementById('accTerms').checked && !document.getElementById('accPrivacy').checked && document.querySelector('#accTerms + span a').getAttribute('href') === '/legal/terminos' && document.querySelector('#accPrivacy + span a').getAttribute('href') === '/legal/privacidad'`), 'dos casillas separadas y desmarcadas, cada una con su documento')
    await t.js(`${set('church', 'Iglesia Prueba')}; ${set('email', 'nueva@prueba.co')}; ${set('password', 'clave-segura-1')}; 0`)
    await t.js(`document.getElementById('accountForm').requestSubmit(); 0`)
    await t.waitFor(`!document.getElementById('error').hidden`, 'aviso de las casillas')
    ok(await t.js(`/marca las dos casillas/.test(document.getElementById('error').textContent) && !document.getElementById('stepAccount').hidden`), 'sin marcar las casillas no avanza (y lo dice)')
    await t.shot('contratar-prueba')
    await t.js(`document.getElementById('accTerms').click(); document.getElementById('accPrivacy').click(); document.getElementById('accountForm').requestSubmit(); 0`)
    await t.waitFor(`!document.getElementById('stepVerify').hidden`, 'verificar el correo')
    ok(await t.js(`document.getElementById('verifyEmail').textContent === 'nueva@prueba.co'`), 'reserva el código, crea la cuenta y pide el código que llegó al correo')
    await t.js(`${set('otp', '000000')}; document.getElementById('verifyForm').requestSubmit(); 0`)
    await t.waitFor(`!document.getElementById('error').hidden`, 'código equivocado')
    ok(await t.js(`!document.getElementById('stepVerify').hidden`), 'un código equivocado no sirve')
    await t.js(`${set('otp', '123456')}; document.getElementById('verifyForm').requestSubmit(); 0`)
    await t.waitFor(`!document.getElementById('stepDone').hidden`, 'prueba activa')
    ok(await t.js(`/Tu prueba gratuita de «Iglesia Prueba» está activa hasta el/.test(document.getElementById('doneMsg').textContent) && !!document.querySelector('#stepDone a[href="/descargar/windows"]') && !!document.querySelector('#stepDone a[href="/iphone/"]')`), 'con el correo verificado: la iglesia queda en prueba, con la fecha en que termina, y los enlaces para descargar la app')
    await t.shot('contratar-prueba-lista')
    ok(t.errors.length === 0, `sin errores en la consola${t.errors.length ? ': ' + t.errors.join(' | ') : ''}`)
    t.win.destroy()

    console.log('\nContratar (pago en línea apagado)')
    const c = await open('/contratar?plan=equipo&periodo=anual')
    await c.waitFor(`!document.getElementById('stepPlan').hidden && document.querySelectorAll('#planList .plan-opt').length >= 3`, 'planes')
    ok(await c.js(`document.querySelector('[data-period="anual"]').getAttribute('aria-pressed') === 'true' && /370\\.000/.test(document.getElementById('planSummary').textContent) && /Ahorras/.test(document.getElementById('planSummary').textContent)`), 'llega con el plan y el período del enlace: Equipo anual, con el ahorro frente a 12 meses')
    ok(await c.js(`/Precio internacional de referencia: US\\$105\\.60/.test(document.getElementById('planSummary').textContent) && /pesos colombianos/.test(document.getElementById('planSummary').textContent)`), 'muestra el precio en dólares como referencia y aclara que se cobra en pesos')
    ok(await c.js(`!document.getElementById('offline').hidden && /disponible muy pronto/.test(document.getElementById('offline').textContent) && document.getElementById('stepAccount').hidden`), 'con el pago en línea apagado lo dice claro y no pide cuenta ni tarjeta')
    await c.js(`document.querySelector('[data-period="mensual"]').click(); 0`)
    ok(await c.js(`/35\\.000/.test(document.getElementById('planSummary').textContent)`), 'cambiar a mensual actualiza el precio')
    await c.shot('contratar-planes')
    c.win.destroy()

    const m = await open('/contratar?prueba=1#PRB-AAAA-BBBB-CCCC', 390, 844)
    await m.waitFor(`!document.getElementById('stepAccount').hidden`, 'contratar en el celular')
    ok(await m.js(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'en el celular la página no desborda')
    await m.shot('contratar-celular')
    m.win.destroy()
  } catch (err) {
    ok(false, `error: ${err && err.stack ? err.stack.split('\n')[0] : err}`)
  } finally {
    server.kill()
    console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodas las comprobaciones pasaron')
    app.exit(failures ? 1 : 0)
  }
})
