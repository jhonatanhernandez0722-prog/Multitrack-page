/**
 * Prueba en un navegador real (Electron) del cumplimiento legal en la web, contra el servidor local con
 * los documentos EN VIGOR (GOSEN_LEGAL_PREVIEW) y Neon simulado:
 *  - Página pública: nada opcional se guarda antes de elegir; rechazar y retirar tienen efecto; sin
 *    peticiones a terceros; pie con los documentos; documentos accesibles (escritorio y celular).
 *  - Panel: casillas independientes y desmarcadas; no se envía sin las dos; enlaces en otra pestaña
 *    (no se pierde el formulario); aceptación registrada; descarga; privacidad: evidencias,
 *    verificación y retiro (cierra el panel y vuelve a pedir solo lo retirado).
 * Deja capturas en test-output/.
 *
 * Uso (con el Electron de la app): electron test/legal-ui.cjs
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
  const today = new Date().toISOString().slice(0, 10)
  const preview = JSON.stringify({ owner: { nit: '900.000.000-1', address: 'Calle 1 # 2-3', email: 'datos@iglesia.test' }, effective: today })
  const server = spawn(process.env.NODE_BIN || 'node', ['--import', './test/register.mjs', 'test/server.mjs'], { cwd: root, env: { ...process.env, GOSEN_LEGAL_PREVIEW: preview } })
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

  const open = async (url, width = 1280, height = 900) => {
    const win = new BrowserWindow({ show: false, width, height, webPreferences: { offscreen: true } })
    const errors = []
    const requests = []
    win.webContents.on('console-message', (e) => e.level === 'error' && errors.push(e.message))
    win.webContents.session.webRequest.onBeforeRequest((d, cb) => {
      requests.push(d.url)
      cb({})
    })
    for (let k = 0; ; k++) {
      try {
        await win.loadURL(base + url)
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
    return { win, js, waitFor, shot, errors, requests }
  }

  try {
    // --- Página pública: almacenamiento opcional solo con permiso -------------------------------------
    console.log('Página pública: cookies y documentos')
    let p = await open('/')
    await p.js(`localStorage.clear(); location.reload(); 0`)
    await sleep(300)
    await p.waitFor(`!!window.gosenPrivacy && !!document.querySelector('.gp-bar')`, 'aviso de privacidad')
    ok(await p.js(`localStorage.getItem('gosen.web.privacy') === null && document.cookie === ''`), 'al entrar no hay nada elegido ni cookies (no se acepta por entrar o por no hacer nada)')
    await p.js(`document.getElementById('theme').click(); 0`)
    ok(await p.js(`localStorage.getItem('gosen.web.theme') === null && !!document.documentElement.dataset.theme`), 'antes de elegir, cambiar el tema funciona pero no se guarda')
    await p.shot('legal-aviso-cookies')
    ok(p.requests.every((u) => u.startsWith(base) || u.startsWith('data:') || u.startsWith('devtools:')) && p.requests.some((u) => u.includes('/fonts/barlow')), 'ninguna petición a terceros: las fuentes salen del propio dominio')
    await p.js(`document.querySelector('.gp-bar [data-gp="reject"]').click(); 0`)
    ok(await p.js(`!document.querySelector('.gp-bar') && JSON.parse(localStorage.getItem('gosen.web.privacy')).preferencias === false`), '«Rechazar» guarda la elección y quita el aviso')
    await p.js(`document.getElementById('theme').click(); 0`)
    ok(await p.js(`localStorage.getItem('gosen.web.theme') === null`), 'rechazado: el tema no se recuerda')
    // Configurar desde el pie, aceptar preferencias, y retirarlas después.
    await p.js(`document.querySelector('footer [data-privacy-settings]').click(); 0`)
    await p.waitFor(`document.querySelector('.gp-dialog')?.open`, 'configurar cookies')
    ok(await p.js(`!document.getElementById('gp-pref').checked && /No se usan/.test(document.querySelector('.gp-dialog').textContent)`), 'el panel de cookies muestra las categorías: necesarias, preferencias (apagada) y que no hay analítica ni publicidad')
    await p.shot('legal-configurar-cookies')
    await p.js(`document.getElementById('gp-pref').click(); document.querySelector('.gp-dialog [data-gp="save"]').click(); 0`)
    ok(await p.js(`window.gosenPrivacy.allows('preferencias') && localStorage.getItem('gosen.web.theme') === document.documentElement.dataset.theme`), 'al permitir las preferencias, se recuerda el tema elegido')
    await p.js(`window.gosenPrivacy.open(); document.querySelector('.gp-dialog [data-gp="reject"]').click(); 0`)
    ok(await p.js(`!window.gosenPrivacy.allows('preferencias') && localStorage.getItem('gosen.web.theme') === null`), 'al retirar el permiso, lo guardado se borra de inmediato')
    const links = await p.js(`[...document.querySelectorAll('footer a[href^="/legal/"]')].map(a => a.getAttribute('href'))`)
    ok(['/legal/terminos', '/legal/privacidad', '/legal/cookies', '/legal/reembolsos'].every((h) => links.includes(h)), `el pie enlaza los 4 documentos (${links.length})`)
    for (const h of links) {
      const r = await fetch(base + h)
      ok(r.ok && /Vigente/.test(await r.text()), `${h} abre y está vigente`)
    }
    ok(p.errors.length === 0, `sin errores en la consola${p.errors.length ? ': ' + p.errors.join(' | ') : ''}`)
    p.win.destroy()

    // Documento en el celular, legible y sin desbordar.
    const doc = await open('/legal/privacidad', 375, 812)
    await doc.waitFor(`!!document.querySelector('article h2')`, 'política en el celular')
    ok(await doc.js(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'la política se lee en el celular sin desplazamiento horizontal')
    await doc.shot('legal-privacidad-celular')
    doc.win.destroy()

    // --- Panel: aceptación al entrar -------------------------------------------------------------
    console.log('\nPanel: aceptación de términos y privacidad')
    const a = await open('/admin')
    const downloads = []
    a.win.webContents.session.on('will-download', (e, item) => {
      downloads.push(item.getFilename())
      e.preventDefault()
    })
    await a.js(`localStorage.clear(); $('email').value = 'admin@iglesia.com'; $('pass').value = 'x'; $('lbtn').click(); 0`)
    await a.waitFor(`!$('consentForm').classList.contains('hide')`, 'formulario de aceptación')
    const st = await a.js(`({ t: $('cTerms').checked, p: $('cPrivacy').checked, dis: $('cbtn').disabled, panel: !$('panel').classList.contains('hide'), tl: $('cTermsLink').getAttribute('href'), tt: $('cTermsLink').target, pl: $('cPrivacyLink').getAttribute('href'), pt: $('cPrivacyLink').target, tx: $('cTerms').closest('label').textContent.trim(), px: $('cPrivacy').closest('label').textContent.trim() })`)
    ok(!st.t && !st.p && st.dis && !st.panel, 'las dos casillas empiezan desmarcadas, el botón desactivado y el panel cerrado')
    ok(st.tx === 'He leído y acepto los términos y condiciones' && st.px === 'He leído la política de privacidad y autorizo el tratamiento de mis datos personales conforme a lo allí informado', 'los textos de las casillas son los pedidos')
    ok(st.tl === '/legal/terminos' && st.pl === '/legal/privacidad' && st.tt === '_blank' && st.pt === '_blank', 'debajo de cada casilla, su documento (se abre en otra pestaña y no se pierde el formulario)')
    await a.shot('legal-panel-aceptacion')
    await a.js(`$('cPrivacy').click(); 0`)
    const one = await a.js(`({ t: $('cTerms').checked, dis: $('cbtn').disabled, why: $('consentWhy').textContent })`)
    ok(!one.t && one.dis && /términos/.test(one.why), 'marcar la privacidad no marca los términos; sigue sin poder enviarse y explica qué falta y por qué')
    await a.js(`$('consentForm').requestSubmit(); 0`)
    await sleep(400)
    ok((await (await fetch(`${base}/__test/consents`)).json()).length === 0, 'forzar el envío con una sola casilla no registra nada')
    await a.js(`$('cTerms').click(); 0`)
    ok(!(await a.js(`$('cbtn').disabled`)), 'con las dos marcadas se puede continuar')
    await a.js(`$('cbtn').click(); 0`)
    await a.waitFor(`!$('panel').classList.contains('hide') && document.querySelectorAll('#list .row').length === 1`, 'panel tras aceptar')
    const rec = await (await fetch(`${base}/__test/consents`)).json()
    ok(rec.length === 2 && rec.every((r) => r.action === 'acepta' && r.version === '1.0' && /^[0-9a-f]{64}$/.test(r.sha256) && r.channel === 'panel-web:inicio-sesion'), 'se registraron las dos aceptaciones, cada una con su versión y huella')

    // Descarga.
    await a.js(`document.querySelector('#list .dl-btn').click(); 0`)
    const end = Date.now() + 6000
    while (!downloads.length && Date.now() < end) await sleep(100)
    ok(downloads[0] === 'Eres Todopoderoso.zip', `el botón «Descargar» baja el multitrack (${downloads[0] || 'nada'})`)
    await a.shot('legal-panel-descarga')

    // Privacidad: mis aceptaciones, evidencias, verificación y retiro.
    await a.js(`$('privacyBtn').click(); 0`)
    await a.waitFor(`document.querySelectorAll('#myConsents .doc-status').length === 2`, 'mis aceptaciones')
    ok(await a.js(`[...document.querySelectorAll('#myConsents .doc-status')].every(r => /Aceptada la versión 1.0/.test(r.textContent))`), 'el admin ve qué versión aceptó de cada documento y cuándo')
    await a.js(`$('evSearch').click(); 0`)
    await a.waitFor(`document.querySelectorAll('#evRows tr').length === 2`, 'evidencias')
    await a.js(`$('evVerify').click(); 0`)
    await a.waitFor(`/Registro íntegro/.test($('evStatus').textContent)`, 'verificación')
    ok(true, 'consulta las evidencias y verifica la integridad del registro')
    await a.shot('legal-panel-privacidad')
    await a.js(`window.confirm = () => true; [...document.querySelectorAll('#myConsents .doc-status')].find(r => /privacidad/i.test(r.textContent)).querySelector('button').click(); 0`)
    await a.waitFor(`!$('login').classList.contains('hide') && /Retiraste/.test($('lerr').textContent)`, 'retiro')
    ok((await (await fetch(`${base}/__test/consents`)).json()).at(-1).action === 'revoca', 'retirar la autorización cierra el panel y queda registrado')
    await a.js(`$('email').value = 'admin@iglesia.com'; $('pass').value = 'x'; $('lbtn').click(); 0`)
    await a.waitFor(`!$('consentForm').classList.contains('hide')`, 'volver a pedir')
    ok(await a.js(`$('cTermsItem').classList.contains('hide') && !$('cPrivacyItem').classList.contains('hide') && !$('cPrivacy').checked`), 'al volver, solo se pide de nuevo lo que retiró (no se repite lo que sigue aceptado)')
    await a.js(`$('cno').click(); 0`)
    ok(await a.js(`!$('login').classList.contains('hide') && /no están disponibles/.test($('lerr').textContent)`), '«Ahora no» explica qué no puede usar y no registra nada')
    ok(a.errors.length === 0, `sin errores en la consola${a.errors.length ? ': ' + a.errors.join(' | ') : ''}`)
    a.win.destroy()

    // Celular: el formulario de aceptación se ve completo.
    const m = await open('/admin', 375, 812)
    await m.js(`localStorage.clear(); $('email').value = 'admin@iglesia.com'; $('pass').value = 'x'; $('lbtn').click(); 0`)
    await m.waitFor(`!$('consentForm').classList.contains('hide')`, 'aceptación en el celular')
    ok(await m.js(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'en el celular, el formulario de aceptación no desborda')
    await m.shot('legal-panel-aceptacion-celular')
    m.win.destroy()
  } catch (err) {
    ok(false, `error: ${err.stack || err.message}`)
  } finally {
    server.kill()
    console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodas las comprobaciones pasaron')
    app.exit(failures ? 1 : 0)
  }
})
