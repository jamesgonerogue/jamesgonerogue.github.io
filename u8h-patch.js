
(function () {
  'use strict';

  var PATCH_VERSION = 'U8H-SEARCH-v4.4';
  window.__U8H_SEARCH_PATCH__ = PATCH_VERSION;

  var synthetic = false;
  var lastValue = '';
  var lastSubmit = '';
  var lastSearchInput = null;
  var lastReleasedQuery = '';

  function isSearchRoute() {
    return /^#\/search(?:\?|$)/.test(window.location.hash || '');
  }

  function getRouteQuery() {
    try {
      var hash = window.location.hash || '';
      var q = hash.indexOf('?');
      if (q < 0) return '';
      var params = new URLSearchParams(hash.slice(q + 1));
      return String(params.get('query') || '').trim();
    } catch (e) { return ''; }
  }

  function isTextInput(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea';
  }

  function isVisible(el) {
    try {
      var r = el.getBoundingClientRect();
      var s = window.getComputedStyle(el);
      return r.width > 20 && r.height > 10 &&
             s.display !== 'none' && s.visibility !== 'hidden' &&
             Number(s.opacity || 1) !== 0 &&
             r.bottom > 0 && r.right > 0 &&
             r.top < window.innerHeight && r.left < window.innerWidth;
    } catch (e) { return false; }
  }

  function scoreInput(el) {
    var score = 0;
    try {
      if (el === document.activeElement) score += 1000;
      var p = (el.getAttribute('placeholder') || '').toLowerCase();
      var a = (el.getAttribute('aria-label') || '').toLowerCase();
      var n = (el.getAttribute('name') || '').toLowerCase();
      var v = String(el.value || '');
      if (p.indexOf('search') >= 0) score += 600;
      if (a.indexOf('search') >= 0) score += 600;
      if (n.indexOf('search') >= 0 || n === 'q' || n === 'query') score += 400;
      if (v.length) score += 100 + Math.min(300, v.length * 20);
      var r = el.getBoundingClientRect();
      score += Math.min(150, Math.max(0, 150 - r.top / 5));
    } catch (e) {}
    return score;
  }

  function findSearchInput() {
    if (!isSearchRoute()) return null;
    try {
      var list = Array.prototype.slice.call(document.querySelectorAll('input, textarea'))
        .filter(isVisible)
        .sort(function (a, b) { return scoreInput(b) - scoreInput(a); });
      return list.length ? list[0] : null;
    } catch (e) { return null; }
  }

  function patchInput(el) {
    if (!el || !isSearchRoute()) return;
    try {
      if (el.tagName.toLowerCase() === 'input') el.setAttribute('type', 'search');
      el.setAttribute('inputmode', 'search');
      el.setAttribute('enterkeyhint', 'search');
      el.setAttribute('role', 'searchbox');
      el.setAttribute('aria-label', el.getAttribute('aria-label') || 'Search');
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('autocapitalize', 'none');
      el.setAttribute('spellcheck', 'false');
      el.setAttribute('data-u8h-search-patched', '4.4');
      lastSearchInput = el;
    } catch (e) {}
  }

  // VIDAA's launcher keyboard can remain logically attached to the search
  // input even after the UI focus highlight moves to Home/Discover. That is
  // why pressing OK on a sidebar item can reopen the keyboard. Explicitly
  // blur the input and briefly make it readonly to force the native keyboard
  // context to detach. The readonly flag is removed immediately afterwards.
  function releaseKeyboard(reason) {
    var el = lastSearchInput;
    if (!el || !isTextInput(el)) return;
    try { el.blur(); } catch (e) {}
    try { el.setAttribute('readonly', 'readonly'); } catch (e) {}
    setTimeout(function () {
      try { el.removeAttribute('readonly'); } catch (e) {}
    }, 180);
    try {
      if (document.activeElement === el) document.activeElement.blur();
    } catch (e) {}
    lastSubmit = reason || lastSubmit;
    updateDebug();
  }

  function fire(el, name) {
    try { el.dispatchEvent(new Event(name, { bubbles: true, cancelable: true })); } catch (e) {
      try {
        var ev = document.createEvent('Event');
        ev.initEvent(name, true, true);
        el.dispatchEvent(ev);
      } catch (_) {}
    }
  }

  function forceRoute(value) {
    if (!value) return;
    var target = '#/search?query=' + encodeURIComponent(value);
    try { if (window.location.hash !== target) window.location.hash = target; } catch (e) {}
  }

  function submitNow(origin) {
    var el = findSearchInput();
    if (!el) { lastSubmit = 'NO INPUT'; updateDebug(); return; }
    patchInput(el);
    var value = '';
    try { value = String(el.value || '').trim(); } catch (e) {}
    if (!value) { lastSubmit = 'EMPTY'; updateDebug(); return; }

    synthetic = true;
    fire(el, 'input');
    fire(el, 'change');
    synthetic = false;

    forceRoute(value);
    lastValue = value;
    lastSubmit = (origin || 'manual') + ': ' + value;

    // Give Stremio a moment to consume the value, then detach the native
    // keyboard from the input. Do not focus another control artificially.
    setTimeout(function () { releaseKeyboard('submitted: ' + value); }, 120);
    updateDebug();
  }

  document.addEventListener('focusin', function (e) {
    if (isSearchRoute() && isTextInput(e.target)) {
      patchInput(e.target);
      return;
    }
    // If visual focus moves to Home/Discover/results, release any stale native
    // keyboard ownership immediately.
    if (!isTextInput(e.target) && lastSearchInput) releaseKeyboard('focus left search');
  }, true);

  ['input', 'change', 'compositionend'].forEach(function (name) {
    document.addEventListener(name, function (e) {
      if (synthetic || !isSearchRoute() || !isTextInput(e.target)) return;
      patchInput(e.target);
      try { lastValue = String(e.target.value || ''); } catch (_) {}
      updateDebug();
    }, true);
  });

  // If the installed keyboard's OK action submits normally, the hash gains a
  // query. That is our reliable signal to close/detach the keyboard, even when
  // VIDAA does not emit a useful Enter key event to JavaScript.
  function maybeReleaseAfterNativeSubmit() {
    var q = getRouteQuery();
    if (!q || q === lastReleasedQuery) return;
    var el = findSearchInput() || lastSearchInput;
    var v = '';
    try { if (el) v = String(el.value || '').trim(); } catch (_) {}
    if (!v || v.toLowerCase() === q.toLowerCase()) {
      lastReleasedQuery = q;
      setTimeout(function () { releaseKeyboard('native submit: ' + q); }, 120);
    }
  }

  window.addEventListener('hashchange', function () {
    if (!isSearchRoute()) {
      releaseKeyboard('left search route');
      lastReleasedQuery = '';
    } else {
      maybeReleaseAfterNativeSubmit();
    }
    ensureControls();
  });

  function ensureControls() {
    var el = findSearchInput();
    var searchUiVisible = !!el;
    var routeQuery = getRouteQuery();
    var inputValue = '';
    try { if (el) inputValue = String(el.value || '').trim(); } catch (_) {}

    var badge = document.getElementById('u8h-search-patch-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'u8h-search-patch-badge';
      badge.textContent = PATCH_VERSION + ' ' + window.innerWidth + 'x' + window.innerHeight;
      badge.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;background:rgba(0,0,0,.78);color:#fff;padding:7px 11px;border-radius:6px;font:600 13px sans-serif;pointer-events:none;letter-spacing:.4px;';
      document.documentElement.appendChild(badge);
    }

    var btn = document.getElementById('u8h-search-submit');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'u8h-search-submit';
      btn.type = 'button';
      btn.textContent = 'SEARCH NOW';
      btn.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;min-width:240px;height:58px;border:3px solid #fff;border-radius:10px;background:#6b46ff;color:#fff;font:700 22px sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.45);';
      btn.addEventListener('click', function () { submitNow('button'); });
      btn.addEventListener('keydown', function (e) {
        var c = e.keyCode || e.which || 0;
        if ((e.key || '') === 'Enter' || c === 13 || c === 16777221 || c === 65376) submitNow('button-OK');
      }, true);
      document.documentElement.appendChild(btn);
    }

    var dbg = document.getElementById('u8h-search-debug');
    if (!dbg) {
      dbg = document.createElement('div');
      dbg.id = 'u8h-search-debug';
      dbg.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:2147483647;max-width:42%;background:rgba(0,0,0,.78);color:#fff;padding:6px 9px;border-radius:6px;font:12px monospace;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      document.documentElement.appendChild(dbg);
    }

    // Only show our controls when the actual Stremio search input is visible.
    // This avoids relying on the URL hash alone, which can remain on /search
    // while VIDAA visually moves focus elsewhere.
    badge.style.display = searchUiVisible ? 'block' : 'none';
    dbg.style.display = searchUiVisible ? 'block' : 'none';

    // SEARCH NOW is a fallback, not a permanent navigation item. Keep it only
    // while editing/pending. Once the current query is already processed, hide
    // it so it cannot interfere with result/sidebar spatial navigation.
    var pending = searchUiVisible && inputValue && inputValue.toLowerCase() !== routeQuery.toLowerCase();
    var editing = searchUiVisible && document.activeElement === el;
    var showButton = !!(pending || editing);
    btn.style.display = showButton ? 'block' : 'none';
    btn.tabIndex = showButton ? 0 : -1;
    btn.disabled = !showButton;
  }

  function updateDebug() {
    var dbg = document.getElementById('u8h-search-debug');
    if (!dbg) return;
    var el = findSearchInput();
    var v = '';
    try { if (el) v = String(el.value || ''); } catch (_) {}
    dbg.textContent = 'value="' + v + '" | route="' + getRouteQuery() + '" | ' + lastSubmit;
  }

  function tick() {
    if (isSearchRoute()) {
      var el = findSearchInput();
      if (el) {
        patchInput(el);
        try {
          var v = String(el.value || '');
          if (v !== lastValue) { lastValue = v; updateDebug(); }
        } catch (_) {}
      }
      maybeReleaseAfterNativeSubmit();
    }
    ensureControls();
  }

  var observer = new MutationObserver(function () { tick(); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: false });
  setInterval(tick, 160);

  console.log('[U8H] Search patch loaded:', PATCH_VERSION);
})();
