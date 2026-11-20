/* Runs INSIDE a proxied page. It (1) stops the phone's native keyboard, (2) tells the Safari app a field was
   tapped, (3) types whatever the Safari app sends back, (4) keeps links/forms going through the proxy. */
(function () {
  if (window.__slurpBridge || window.parent === window) return; window.__slurpBridge = 1;
  var PROXY = window.__SLURP_PROXY__, EDIT = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]):not([type=color]):not([type=image]):not([type=hidden]),textarea';
  var active = null, tell = function (m) { m.slurpFrame = 1; window.parent.postMessage(m, '*'); };
  var editable = function (n) { return n && n.nodeType === 1 && n.matches && n.matches(EDIT) && !n.disabled && !n.readOnly; };
  var prox = function (u) { return PROXY + '/proxy?url=' + encodeURIComponent(u); };

  // 1. no native keyboard: inputmode=none on every field, plus a brief readOnly so iOS never opens it
  var lock = function (n) { if (n.getAttribute('inputmode') !== 'none') n.setAttribute('inputmode', 'none'); };
  var scan = function (r) { if (r.matches && r.matches(EDIT)) lock(r); r.querySelectorAll && r.querySelectorAll(EDIT).forEach(lock); };
  scan(document.documentElement);
  // pages (Wikipedia's search overlay) create a field and focus() it in the same tick, before the observer runs,
  // so lock the field synchronously inside focus() itself
  var _focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function () { if (this.matches && this.matches(EDIT)) lock(this); return _focus.apply(this, arguments); };
  var _create = Document.prototype.createElement;
  Document.prototype.createElement = function () { var el = _create.apply(this, arguments); if (el.matches && el.matches(EDIT)) lock(el); return el; };
  new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { n.nodeType === 1 && scan(n); }); }); })
    .observe(document.documentElement, { childList: true, subtree: true });
  ['touchstart', 'mousedown'].forEach(function (t) {
    document.addEventListener(t, function (e) {
      var n = e.target.closest && e.target.closest(EDIT); if (!n || n.readOnly) return;
      n.readOnly = true; n.__slurpRO = 1; setTimeout(function () { n.readOnly = false; n.__slurpRO = 0; }, 400);
    }, true);
  });

  // 2. a field was tapped: describe it to the Safari app
  var info = function (n) {
    return { value: n.value || '', pos: typeof n.selectionStart === 'number' ? n.selectionStart : (n.value || '').length,
      multi: n.tagName === 'TEXTAREA', ftype: n.type || 'text', hint: n.enterKeyHint || n.getAttribute('enterkeyhint') || (n.type === 'search' ? 'search' : ''),
      nocap: /off|none/.test(n.getAttribute('autocapitalize') || '') };
  };
  document.addEventListener('focusin', function (e) { if (editable(e.target)) { active = e.target; tell({ type: 'focus', f: info(active) }); } }, true);
  document.addEventListener('pointerdown', function (e) {     // tapping anywhere that isn't a field closes the keyboard
    if (active && !(e.target.closest && e.target.closest(EDIT))) { active = null; tell({ type: 'blur' }); }
  }, true);

  // 3. keys coming back from the Safari app
  var setNative = function (n, v) {
    var proto = n.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(n, v);   // the setter React/Vue don't override
  };
  var key = function (t, k, c) { return active.dispatchEvent(new KeyboardEvent(t, { key: k, keyCode: c, which: c, bubbles: true, cancelable: true })); };
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return; var d = e.data; if (!d || d.slurpHost !== 1 || !active) return;
    if (d.type === 'set') {
      setNative(active, d.value);
      try { active.setSelectionRange(d.pos, d.pos); } catch (x) {}
      active.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: d.last || null }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (d.type === 'enter') {
      if (key('keydown', 'Enter', 13) && key('keypress', 'Enter', 13)) {
        var f = active.form; if (f) { var ev = new Event('submit', { bubbles: true, cancelable: true }); if (f.dispatchEvent(ev)) f.requestSubmit ? f.requestSubmit() : f.submit(); }
      }
      key('keyup', 'Enter', 13);
    }
  });

  // 4. stay inside the proxy: links and GET forms
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]'); if (!a || e.defaultPrevented) return;
    var h = a.href; if (!/^https?:/i.test(h) || a.target === '_blank' && false) return;
    e.preventDefault(); location.href = prox(h); tell({ type: 'nav', url: h });
  }, true);
  document.addEventListener('submit', function (e) {
    var f = e.target; if (e.defaultPrevented || (f.method || 'get').toLowerCase() !== 'get') return;
    var u = new URL(f.action || location.href, window.__SLURP_URL__); new FormData(f).forEach(function (v, k) { if (typeof v === 'string') u.searchParams.set(k, v); });
    e.preventDefault(); location.href = prox(u.href); tell({ type: 'nav', url: u.href });
  }, true);
})();
