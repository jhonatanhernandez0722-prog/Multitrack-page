/**
 * Preferencias de privacidad de la web (/web/privacidad.js), en todas las páginas.
 *
 * Qué guarda la web en el navegador (verificado en el código):
 *  - Necesario: la sesión del panel (gosen.cloud.session) y esta misma elección (gosen.web.privacy).
 *  - Preferencias (opcional): el tema claro/oscuro (gosen.web.theme) y el orden/filtro de la lista del
 *    panel (gosen.cloud.view). Solo se guardan si la persona lo acepta; si lo rechaza o lo retira, se borran.
 *  - No hay analítica, publicidad ni seguimiento (y las fuentes se sirven desde el propio dominio).
 *
 * API para las páginas: window.gosenPrivacy.allows('preferencias'), .open(), .choice(); y el evento
 * 'gosen:privacy' cuando cambia la elección. Cualquier elemento con [data-privacy-settings] abre el panel.
 */
export const PRIVACY_JS = String.raw`;(function () {
  'use strict'
  if (window.gosenPrivacy) return
  var KEY = 'gosen.web.privacy'
  var OPTIONAL = { preferencias: ['gosen.web.theme', 'gosen.cloud.view'] }
  var VERSION = 1

  function read() {
    try {
      var c = JSON.parse(localStorage.getItem(KEY) || 'null')
      return c && c.v === VERSION && typeof c.preferencias === 'boolean' ? c : null
    } catch (e) { return null }
  }
  function write(prefs) {
    var c = { v: VERSION, preferencias: !!prefs, at: new Date().toISOString() }
    try { localStorage.setItem(KEY, JSON.stringify(c)) } catch (e) {}
    if (!c.preferencias) {
      OPTIONAL.preferencias.forEach(function (k) { try { localStorage.removeItem(k) } catch (e) {} })
    } else if (document.documentElement.dataset.themeChosen === '1') {
      // Eligió el tema antes de aceptar: ahora sí se recuerda.
      try { localStorage.setItem('gosen.web.theme', document.documentElement.dataset.theme) } catch (e) {}
    }
    hideBar()
    try { window.dispatchEvent(new CustomEvent('gosen:privacy', { detail: c })) } catch (e) {}
    return c
  }

  var css = [
    '.gp-bar{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:760px;margin:0 auto;display:flex;flex-wrap:wrap;gap:12px 16px;align-items:center;padding:14px 16px;border-radius:16px;font:15px/1.45 Barlow,"Segoe UI",system-ui,sans-serif;background:#16141f;color:#f1eff8;box-shadow:0 20px 50px -18px rgba(0,0,0,.55)}',
    '[data-theme=dark] .gp-bar{background:#f1eff8;color:#16141f}',
    '.gp-bar p{margin:0;flex:1 1 320px}.gp-bar a{color:inherit}',
    '.gp-actions{display:flex;flex-wrap:wrap;gap:8px}',
    '.gp-btn{font:600 14px/1 Barlow,"Segoe UI",sans-serif;padding:10px 14px;border-radius:10px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;min-height:40px}',
    '.gp-btn.primary{background:#6b3cf6;border-color:#6b3cf6;color:#fff}',
    '.gp-btn:focus-visible,.gp-switch input:focus-visible+span{outline:3px solid #8b6cff;outline-offset:2px}',
    '.gp-dialog{border:0;border-radius:18px;padding:0;max-width:min(560px,calc(100vw - 24px));width:100%;font:15px/1.5 Barlow,"Segoe UI",system-ui,sans-serif;background:#fff;color:#16141f}',
    '[data-theme=dark] .gp-dialog{background:#15131f;color:#f1eff8}',
    '.gp-dialog::backdrop{background:rgba(10,9,16,.55)}',
    '.gp-dialog form{padding:20px 22px;display:grid;gap:14px}',
    '.gp-dialog h2{margin:0;font-size:20px}',
    '.gp-cat{border:1px solid rgba(127,120,160,.35);border-radius:12px;padding:12px 14px;display:grid;gap:4px}',
    '.gp-cat-head{display:flex;justify-content:space-between;align-items:center;gap:12px;font-weight:600}',
    '.gp-cat p{margin:0;font-size:14px;opacity:.85}',
    '.gp-tag{font-size:13px;opacity:.75;font-weight:500}',
    '.gp-switch{position:relative;display:inline-flex;align-items:center;gap:8px;cursor:pointer}',
    '.gp-switch input{position:absolute;opacity:0;width:44px;height:26px;margin:0;cursor:pointer}',
    '.gp-switch span{width:44px;height:26px;border-radius:999px;background:#b9b5c9;position:relative;transition:background .2s}',
    '.gp-switch span::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s}',
    '.gp-switch input:checked+span{background:#6b3cf6}.gp-switch input:checked+span::after{transform:translateX(18px)}',
    '.gp-foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}',
    '@media (prefers-reduced-motion:reduce){.gp-switch span,.gp-switch span::after{transition:none}}'
  ].join('')

  var bar = null
  var dialog = null
  function el(tag, attrs, html) {
    var e = document.createElement(tag)
    for (var k in attrs || {}) e.setAttribute(k, attrs[k])
    if (html != null) e.innerHTML = html
    return e
  }
  function style() {
    if (document.getElementById('gp-style')) return
    var s = el('style', { id: 'gp-style' })
    s.textContent = css
    document.head.appendChild(s)
  }
  function hideBar() {
    if (bar) { bar.remove(); bar = null }
    document.body.style.paddingBottom = ''
  }
  function showBar() {
    if (bar || read()) return
    style()
    bar = el('section', { class: 'gp-bar', role: 'region', 'aria-label': 'Preferencias de privacidad' },
      '<p>Usamos solo el almacenamiento del navegador que la página necesita para funcionar. Si nos dejas, también recordamos tus preferencias (como el tema claro u oscuro). No usamos analítica ni publicidad. <a href="/legal/cookies">Política de cookies</a></p>' +
      '<div class="gp-actions"><button type="button" class="gp-btn" data-gp="reject">Rechazar</button><button type="button" class="gp-btn" data-gp="settings">Configurar</button><button type="button" class="gp-btn primary" data-gp="accept">Aceptar</button></div>')
    bar.addEventListener('click', function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-gp')
      if (a === 'accept') write(true)
      else if (a === 'reject') write(false)
      else if (a === 'settings') open()
    })
    document.body.appendChild(bar)
    // Espacio al final de la página: el aviso no tapa nada (se puede desplazar por encima de él).
    document.body.style.paddingBottom = bar.offsetHeight + 32 + 'px'
  }
  function open() {
    style()
    if (!dialog) {
      dialog = el('dialog', { class: 'gp-dialog', 'aria-labelledby': 'gp-title' },
        '<form method="dialog">' +
        '<h2 id="gp-title">Configurar cookies y almacenamiento</h2>' +
        '<p style="margin:0">Elige qué podemos guardar en este navegador. Puedes cambiarlo cuando quieras desde «Configurar cookies», al pie de cada página.</p>' +
        '<div class="gp-cat"><div class="gp-cat-head">Necesarias <span class="gp-tag">Siempre activas</span></div><p>Tu sesión en el panel de administración y esta misma elección. Sin ellas la página no funciona como la pides.</p></div>' +
        '<div class="gp-cat"><div class="gp-cat-head"><label for="gp-pref">Preferencias</label><span class="gp-switch"><input type="checkbox" id="gp-pref" role="switch" /><span aria-hidden="true"></span></span></div><p>Recordar el tema claro u oscuro y cómo ordenas la lista de canciones del panel.</p></div>' +
        '<div class="gp-cat"><div class="gp-cat-head">Analítica y medición <span class="gp-tag">No se usan</span></div><p>No medimos tu navegación ni usamos herramientas de estadísticas.</p></div>' +
        '<div class="gp-cat"><div class="gp-cat-head">Publicidad y seguimiento <span class="gp-tag">No se usan</span></div><p>No hay publicidad, píxeles ni seguimiento de terceros.</p></div>' +
        '<p style="margin:0;font-size:14px"><a href="/legal/cookies">Política de cookies</a> · <a href="/legal/privacidad">Política de privacidad</a></p>' +
        '<div class="gp-foot"><button type="button" class="gp-btn" data-gp="reject">Rechazar opcionales</button><button type="button" class="gp-btn primary" data-gp="save">Guardar mi elección</button></div>' +
        '</form>')
      dialog.addEventListener('click', function (e) {
        var a = e.target && e.target.getAttribute && e.target.getAttribute('data-gp')
        if (a === 'reject') { write(false); dialog.close() }
        else if (a === 'save') { write(dialog.querySelector('#gp-pref').checked); dialog.close() }
      })
      document.body.appendChild(dialog)
    }
    var c = read()
    dialog.querySelector('#gp-pref').checked = !!(c && c.preferencias)
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }

  window.gosenPrivacy = {
    allows: function (cat) { var c = read(); return !!(c && c[cat]) },
    choice: read,
    open: open,
    set: function (prefs) { return write(prefs) }
  }
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-privacy-settings]')
    if (t) { e.preventDefault(); open() }
  })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBar)
  else showBar()
})()
`
