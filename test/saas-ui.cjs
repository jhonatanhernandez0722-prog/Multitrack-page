/**
 * Prueba en un navegador real (Electron) del panel de Superadmin (/superadmin) y de las secciones
 * «Tu iglesia» del panel (/admin), contra test/saas-server.mjs (Worker real + Neon simulado con estado).
 *
 * Superadmin: entra → activa la 2FA obligatoria (clave, código, códigos de recuperación) → código →
 * ve las iglesias y el cupo → crea una iglesia → registra su pago → genera la invitación del
 * administrador (código, WhatsApp) → cambia un precio → ajustes → registro → respaldo.
 * Iglesia (admin de Alfa, plan Inicial): integrantes y cupos → invitación → Mi suscripción → logo
 * bloqueado por el plan con «Consultar actualización» → activa su 2FA → el panel la pide al entrar.
 * Deja capturas en test-output/.
 *
 * Uso (con el Electron de la app): electron test/saas-ui.cjs
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
  const db = async () => (await fetch(`${base}/__test/db`)).json()
  const open = async (url, width = 1300, height = 900) => {
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

  try {
    console.log('Superadmin')
    const s = await open('/superadmin')
    await s.js(`sessionStorage.clear(); localStorage.setItem('gosen.web.privacy', JSON.stringify({ v: 1, preferencias: false, at: 'x' })); 0`)
    await s.js(`document.getElementById('email').value = 'super@gosen.co'; document.getElementById('pass').value = 'x'; document.getElementById('lbtn').click(); 0`)
    await s.waitFor(`!document.getElementById('enrollForm').classList.contains('hide')`, 'activar 2FA')
    ok(await s.js(`/^[A-Z2-7 ]{39}$/.test(document.getElementById('secret').textContent) && document.getElementById('otpLink').href.startsWith('otpauth://')`), 'la primera vez obliga a activar la verificación en dos pasos (clave y enlace para la app)')
    await s.shot('saas-superadmin-2fa')
    await s.js(`document.getElementById('enrollCode').value = '000000'; document.getElementById('enrollForm').requestSubmit(); 0`)
    await s.waitFor(`!document.getElementById('eerr').classList.contains('hide')`, 'código malo')
    ok(true, 'un código equivocado no la activa')
    await s.js(`document.getElementById('enrollCode').value = '123456'; document.getElementById('enrollForm').requestSubmit(); 0`)
    await s.waitFor(`document.querySelectorAll('#codes span').length === 8`, 'códigos de recuperación')
    ok(true, 'al activarla muestra 8 códigos de recuperación (una sola vez)')
    await s.js(`document.getElementById('codesDone').click(); 0`)
    await s.waitFor(`!document.getElementById('totpForm').classList.contains('hide')`, 'pide el código')
    await s.js(`document.getElementById('totp').value = '123456'; document.getElementById('totpForm').requestSubmit(); 0`)
    await s.waitFor(`!document.getElementById('app').classList.contains('hide') && document.querySelectorAll('#churchRows tr').length === 2`, 'panel de Superadmin')
    ok(await s.js(`document.getElementById('slots').textContent === 'Cupo comercial: 1 de 3'`), 've las iglesias (la interna y Alfa) y el cupo comercial: 1 de 3')
    await s.shot('saas-superadmin-iglesias')
    // Nueva iglesia.
    await s.js(`document.getElementById('newChurchBtn').click(); document.getElementById('n_name').value = 'Iglesia Vida'; document.getElementById('n_plan').value = 'equipo'; document.getElementById('n_cphone').value = '+57 301 222 3344'; document.getElementById('newChurchForm').requestSubmit(); 0`)
    await s.waitFor(`document.getElementById('churchDlg').open && document.getElementById('cTitle').textContent === 'Iglesia Vida'`, 'iglesia creada')
    ok((await db()).churches.some((c) => c.name === 'Iglesia Vida' && c.plan_id === 'equipo'), 'crea la iglesia con su plan y abre su ficha')
    // Invitación del administrador.
    await s.js(`document.querySelector('#churchDlg [data-sub="admins"]').click(); 0`)
    await s.js(`document.getElementById('invBtn').click(); 0`)
    await s.waitFor(`/GSN-/.test(document.getElementById('invResult').textContent)`, 'código del administrador')
    ok(await s.js(`!!document.querySelector('#invResult a[href^="https://wa.me/?text="]') && document.querySelectorAll('#invRows tr').length === 1`), 'genera el código de activación del administrador, con envío por WhatsApp')
    await s.shot('saas-superadmin-invitacion')
    // Pago.
    await s.js(`document.querySelector('#churchDlg [data-sub="subs"]').click(); 0`)
    await s.js(`document.getElementById('cPayBtn').click(); 0`)
    await s.waitFor(`document.getElementById('payDlg').open`, 'registrar pago')
    ok(await s.js(`document.getElementById('p_price').value === '69900' && document.getElementById('p_church').selectedOptions[0].textContent === 'Iglesia Vida'`), 'el formulario de pago sugiere el precio del plan (Equipo: 69.900)')
    await s.js(`document.getElementById('p_period').value = 'anual'; document.getElementById('p_period').dispatchEvent(new Event('change')); document.getElementById('p_price').value = '699000'; document.getElementById('p_method').value = 'nequi'; document.getElementById('p_ref').value = 'NQ-77'; document.getElementById('payForm').requestSubmit(); 0`)
    await s.waitFor(`!document.getElementById('payDlg').open && /Pago registrado/.test(document.getElementById('msg').textContent)`, 'pago registrado')
    const vida = (await db()).churches.find((c) => c.name === 'Iglesia Vida')
    ok((await db()).subs.some((x) => x.church_id === vida.id && x.period === 'anual' && x.price_cop === 699000 && x.payment_reference === 'NQ-77'), 'registra el pago anual (Nequi, referencia) y activa la suscripción')
    ok(await s.js(`[...document.querySelectorAll('#churchRows tr')].some(r => r.textContent.includes('Iglesia Vida') && r.textContent.includes('Activa'))`), 'en la lista queda «Activa» con su vencimiento')
    // Planes y ajustes.
    await s.js(`document.querySelector('nav.tabs [data-tab="plans"]').click(); 0`)
    await s.js(`document.getElementById('pl_inicial_pm').value = '42900'; document.getElementById('pl_inicial_pm').closest('form').requestSubmit(); 0`)
    await s.waitFor(`/Gosen Inicial/.test(document.getElementById('msg').textContent)`, 'plan guardado')
    ok((await db()).plans.find((p) => p.id === 'inicial').price_month_cop === 42900, 'cambia el precio de un plan desde el panel')
    await s.shot('saas-superadmin-planes')
    await s.js(`document.querySelector('nav.tabs [data-tab="settings"]').click(); document.getElementById('s_max').value = '4'; document.getElementById('settingsForm').requestSubmit(); 0`)
    await s.waitFor(`/Ajustes guardados/.test(document.getElementById('msg').textContent)`, 'ajustes')
    ok((await db()).settings.max_commercial_churches === 4, 'el cupo de iglesias comerciales se configura (ahora 4)')
    // v43: pruebas gratuitas, colección demo y cobro en línea.
    await s.js(`document.querySelector('nav.tabs [data-tab="trials"]').click(); 0`)
    await s.waitFor(`document.querySelectorAll('#trialRows tr').length === 1 && document.querySelectorAll('#demoRows tr').length >= 1`, 'pruebas y demo')
    ok(await s.js(`document.querySelector('#trialRows tr').textContent.includes('Iglesia Nueva Vida') && document.querySelector('#trialRows tr').textContent.includes('En prueba')`), 'Superadmin ve las pruebas con su estado')
    ok(await s.js(`[...document.querySelectorAll('#demoRows tr')].every((r) => !/Alfa/.test(r.textContent))`), 'para la colección demo solo aparecen canciones de Gosen (nunca de otras iglesias)')
    await s.js(`document.getElementById('t_note').value = 'Iglesia Vida Nueva'; document.getElementById('trialForm').requestSubmit(); 0`)
    await s.waitFor(`!document.getElementById('trialResult').classList.contains('hide') && /PRB-7K3M-Q9WX-2T4D/.test(document.getElementById('trialResult').textContent)`, 'código de prueba')
    ok(await s.js(`!!document.querySelector('#trialResult a[href^="https://wa.me/?text="]') && document.querySelectorAll('#trialCodeRows tr').length === 1`), 'crea un código de prueba (se muestra una vez) con su mensaje para WhatsApp')
    await s.js(`document.querySelector('#demoRows input[type="checkbox"]').click(); 0`)
    await s.waitFor(`/es demo/.test(document.getElementById('msg').textContent)`, 'demo marcada')
    ok((await db()).demos.some((d) => d.song_key === '1-Gosen.zip' && d.active), 'marca una canción de Gosen como demo')
    await s.js(`document.querySelector('#trialRows button').click(); 0`)
    await s.waitFor(`/alargada/.test(document.getElementById('msg').textContent)`, 'prueba alargada')
    ok(Date.parse((await db()).trials[0].trial_ends_at) > Date.parse('2026-11-29T10:00:00Z'), 'alarga una prueba (+3 días)')
    await s.shot('saas-superadmin-pruebas')
    await s.js(`document.querySelector('nav.tabs [data-tab="billing"]').click(); 0`)
    await s.waitFor(`document.querySelectorAll('#opPayRows tr').length === 1 && /Falta configurar/.test(document.getElementById('billingConfig').textContent)`, 'cobro en línea')
    ok(await s.js(`/ART IN EARS/.test(document.getElementById('billingConfig').textContent) && document.getElementById('billingConfig').textContent.includes('/api/billing/openpay') && !!document.querySelector('#opPayRows button')`), 'cobro en línea: qué falta configurar, a nombre de quién se cobra, la dirección del aviso y los pagos con «Reembolsar»')
    await s.shot('saas-superadmin-cobro')
    await s.js(`document.querySelector('nav.tabs [data-tab="payments"]').click(); 0`)
    await s.waitFor(`document.querySelectorAll('#dueRows tr').length === 2 && !!document.querySelector('#dueRows a[href^="https://wa.me/57"]')`, 'vencimientos')
    ok(true, 'pagos y vencimientos: recordatorio por WhatsApp al contacto de cada iglesia')
    await s.shot('saas-superadmin-pagos')
    await s.js(`document.querySelector('nav.tabs [data-tab="audit"]').click(); 0`)
    await s.waitFor(`document.querySelectorAll('#auditRows tr').length >= 4`, 'registro')
    ok(true, 'el registro muestra las acciones (iglesia creada, invitación, pago…)')
    ok(await s.js(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'sin desplazamiento horizontal')
    ok(s.errors.length === 0, `sin errores en la consola${s.errors.length ? ': ' + s.errors.join(' | ') : ''}`)
    s.win.destroy()

    // Superadmin en el celular.
    const m = await open('/superadmin', 390, 844)
    await m.waitFor(`!document.getElementById('app').classList.contains('hide') || !document.getElementById('loginForm').classList.contains('hide')`, 'superadmin celular')
    ok(await m.js(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'en el celular la página de Superadmin no desborda')
    m.win.destroy()

    console.log('\nPanel de la iglesia (Alfa, plan Inicial)')
    const a = await open('/admin')
    await a.js(`localStorage.clear(); localStorage.setItem('gosen.web.privacy', JSON.stringify({ v: 1, preferencias: false, at: 'x' })); $('email').value = 'admin@alfa.co'; $('pass').value = 'x'; $('lbtn').click(); 0`)
    await a.waitFor(`!$('panel').classList.contains('hide') && document.querySelectorAll('#list .row').length === 1`, 'panel de Alfa')
    ok(await a.js(`$('brandSub').textContent === 'Iglesia Alfa' && document.querySelector('#list .row').textContent.includes('Alfa')`), 'el panel muestra la iglesia y solo sus canciones')
    ok(await a.js(`$('cost').textContent === 'Inicial' && /de tu plan/.test($('meterText').textContent)`), 'el almacenamiento se mide contra la cuota de su plan')
    await a.js(`document.querySelector('.nav-item[data-view="members"]').click(); 0`)
    await a.waitFor(`document.querySelectorAll('#memberRows tr').length === 2`, 'integrantes')
    ok(await a.js(`$('seatInfo').textContent === '2 de 10 integrantes'`), 'integrantes con el cupo de su plan (2 de 10)')
    await a.js(`$('invNote').value = 'Pedro'; $('invBtn').click(); 0`)
    await a.waitFor(`/GSN-/.test($('invResult').textContent) && document.querySelectorAll('#invRows tr').length === 1`, 'invitación')
    ok(await a.js(`!!document.querySelector('#invResult a[href^="https://wa.me/?text="]')`), 'genera el código de un integrante y lo comparte por WhatsApp')
    await a.shot('saas-iglesia-integrantes')
    await a.js(`document.querySelector('.nav-item[data-view="subscription"]').click(); 0`)
    await a.waitFor(`document.querySelectorAll('#payRows tr').length >= 1 && document.querySelectorAll('#featureList li').length === 20`, 'mi suscripción')
    ok(await a.js(`$('subPlan').textContent === 'Gosen Inicial' && document.querySelectorAll('#featureList li.off').length === 13 && $('contactBtn').href.startsWith('https://wa.me/573001112233')`), 'Mi suscripción: plan, funciones incluidas y no incluidas, pagos y contacto con Gosen por WhatsApp')
    ok(await a.js(`$('auditCard').classList.contains('hide')`), 'el historial de acciones no aparece (es de Premium)')
    await a.shot('saas-iglesia-suscripcion')
    await a.js(`document.querySelector('.nav-item[data-view="church"]').click(); 0`)
    await a.waitFor(`$('ch_name').value === 'Iglesia Alfa'`, 'perfil')
    ok(await a.js(`$('logoBtn').disabled && !$('personalNote').classList.contains('hide') && !!$('personalNote').querySelector('a[href^="https://wa.me/"]')`), 'el logo propio está bloqueado en Inicial, con «Consultar actualización»')
    await a.js(`document.querySelector('.nav-item[data-view="security"]').click(); 0`)
    await a.waitFor(`$('tfState').textContent === 'Desactivada'`, 'seguridad')
    await a.js(`$('tfStart').click(); 0`)
    await a.waitFor(`!$('tfEnroll').classList.contains('hide')`, 'activar 2FA')
    await a.js(`$('tfCode').value = '123456'; $('tfConfirm').click(); 0`)
    await a.waitFor(`document.querySelectorAll('#tfCodeList span').length === 8`, 'códigos')
    ok((await db()).twofa['admin@alfa.co'] === true, 'el administrador activa su verificación en dos pasos (recomendada)')
    await a.shot('saas-iglesia-seguridad')
    ok(a.errors.length === 0, `sin errores en la consola${a.errors.length ? ': ' + a.errors.join(' | ') : ''}`)
    a.win.destroy()

    // Al volver a entrar, el panel pide el código.
    const a2 = await open('/admin')
    await a2.js(`localStorage.clear(); $('email').value = 'admin@alfa.co'; $('pass').value = 'x'; $('lbtn').click(); 0`)
    await a2.waitFor(`$('totpDialog').open`, 'pide el código')
    ok(true, 'con la 2FA activa, al entrar el panel pide el código')
    await a2.js(`$('totpInput').value = '123456'; $('totpOk').click(); 0`)
    await a2.waitFor(`!$('panel').classList.contains('hide')`, 'entra con el código')
    ok(true, 'con el código correcto entra')
    a2.win.destroy()
  } catch (err) {
    ok(false, `error: ${err.stack || err.message}`)
  } finally {
    server.kill()
    console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodas las comprobaciones pasaron')
    app.exit(failures ? 1 : 0)
  }
})
