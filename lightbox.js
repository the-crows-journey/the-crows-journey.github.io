// Click-to-open image lightbox with zoom, pan, pinch and gallery navigation.
// Standalone: no dependencies, no changes to existing markup except marking clickable photos with data-lbx.
// Styles live in lightbox.css (every selector is scoped to .lbx-*).
(function () {
  'use strict';
  if (window.ImageLightbox) return;

  var SCOPE = 'main';                                   // only photos inside the page content open the viewer
  var GROUPS = '.gallery, .compare, .mrow';              // photos inside one of these can be browsed with prev/next
  var SKIP = 'a[href], button, summary, label, input, select, textarea'; // photos that are links or controls keep their own behaviour
  var PAD_X = 12, PAD_Y = 56;                            // room kept free around the picture (controls sit in the top and bottom bands)
  var STEP = 1.5, DBL_ZOOM = 2.5, SWIPE = 60;

  var ICON = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>'
  };

  var st = null; // state of the open viewer (null while closed)

  function el(tag, cls, attrs, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html) e.innerHTML = html;
    return e;
  }
  function btn(cls, label, icon, onclick) {
    var b = el('button', 'lbx-btn ' + cls, { type: 'button', 'aria-label': label, title: label }, icon);
    b.addEventListener('click', function (ev) { ev.stopPropagation(); onclick(); });
    return b;
  }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  // ---------------------------------------------------------------- which photos belong to the viewer
  function eligible(img) {
    return img && img.tagName === 'IMG' && !!img.closest(SCOPE) && !img.closest(SKIP) && !img.closest('.lbx') && !!(img.currentSrc || img.src);
  }
  function itemOf(img) {
    var fig = img.closest('figure'), c = fig && fig.querySelector('figcaption');
    return { el: img, src: img.currentSrc || img.src, alt: img.getAttribute('alt') || '', cap: c ? c.textContent.trim() : '', px: img.classList.contains('px') };
  }
  function groupOf(img) {
    var box = img.closest(GROUPS), list = box ? Array.prototype.filter.call(box.querySelectorAll('img'), eligible) : [img];
    if (list.indexOf(img) < 0) list = [img];
    return { items: list.map(itemOf), index: list.indexOf(img) };
  }
  function prepare() { // make eligible photos reachable by keyboard and announce them as buttons
    Array.prototype.forEach.call(document.querySelectorAll(SCOPE + ' img'), function (img) {
      if (!eligible(img) || img.hasAttribute('data-lbx')) return;
      img.setAttribute('data-lbx', '');
      if (!img.hasAttribute('tabindex')) img.setAttribute('tabindex', '0');
      img.setAttribute('role', 'button');
      img.setAttribute('aria-haspopup', 'dialog');
      img.setAttribute('aria-label', 'View larger: ' + (img.getAttribute('alt') || 'image'));
    });
  }

  // ---------------------------------------------------------------- open / close
  function open(items, index, opener) {
    if (st || !items.length) return;
    var root = el('div', 'lbx', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Image viewer', tabindex: '-1' });
    var stage = el('div', 'lbx-stage');
    var img = el('img', 'lbx-img', { draggable: 'false', alt: '' });
    var msg = el('p', 'lbx-msg'); msg.hidden = true;
    stage.appendChild(img); stage.appendChild(msg);
    var bar = el('div', 'lbx-bar');
    var count = el('span', 'lbx-count', { 'aria-hidden': 'true' });
    var live = el('span', 'lbx-sr', { 'aria-live': 'polite' });
    var out = btn('lbx-out', 'Zoom out', ICON.minus, function () { zoomBy(1 / STEP, true); });
    var reset = btn('lbx-reset', 'Reset zoom', '100%', function () { setView(1, 0, 0, true); });
    var inn = btn('lbx-in', 'Zoom in', ICON.plus, function () { zoomBy(STEP, true); });
    var close = btn('lbx-close', 'Close (Escape)', ICON.close, closeViewer);
    bar.appendChild(count); bar.appendChild(out); bar.appendChild(reset); bar.appendChild(inn); bar.appendChild(close);
    var prev = btn('lbx-nav lbx-prev', 'Previous image', ICON.prev, function () { go(-1); });
    var next = btn('lbx-nav lbx-next', 'Next image', ICON.next, function () { go(1); });
    var cap = el('div', 'lbx-cap');
    root.appendChild(stage); root.appendChild(bar); root.appendChild(prev); root.appendChild(next); root.appendChild(cap); root.appendChild(live);

    st = {
      items: items, i: index, opener: opener, root: root, stage: stage, img: img, msg: msg, count: count, live: live, out: out, reset: reset, inn: inn,
      close: close, prev: prev, next: next, cap: cap,
      s: 1, tx: 0, ty: 0, nw: 0, nh: 0, fw: 0, fh: 0, max: 8, token: 0, ptrs: {}, g: null, lastTap: null, animT: 0,
      saved: { htmlOverflow: document.documentElement.style.overflow, bodyOverflow: document.body.style.overflow, bodyPad: document.body.style.paddingRight },
      inerted: []
    };

    // lock page scrolling (and keep the layout from shifting when the scrollbar disappears)
    var sb = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden';
    if (sb > 0) document.body.style.paddingRight = (parseFloat(getComputedStyle(document.body).paddingRight) || 0) + sb + 'px';
    // hide the page from assistive technology and the tab order while the dialog is open
    Array.prototype.forEach.call(document.body.children, function (c) {
      if (c !== root && !c.inert && c.tagName !== 'SCRIPT') { c.inert = true; st.inerted.push(c); }
    });
    document.body.appendChild(root);

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onCancel);
    stage.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);

    show(index);
    root.focus({ preventScroll: true });
  }

  function closeViewer() {
    if (!st) return;
    var s = st; st = null;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    clearTimeout(s.animT);
    s.root.remove();
    document.documentElement.style.overflow = s.saved.htmlOverflow;
    document.body.style.overflow = s.saved.bodyOverflow;
    document.body.style.paddingRight = s.saved.bodyPad;
    s.inerted.forEach(function (c) { c.inert = false; });
    var back = s.items[s.i] && s.items[s.i].el;
    if (!back || !back.isConnected) back = s.opener;
    if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- showing one picture
  function show(i) {
    var it = st.items[i], img = st.img, tok = ++st.token;
    st.i = i; st.s = 1; st.tx = 0; st.ty = 0;
    img.classList.remove('lbx-loaded', 'lbx-zoomed'); img.classList.toggle('lbx-px', it.px);
    st.msg.hidden = true;
    img.alt = it.alt;
    st.cap.textContent = it.cap;
    var n = st.items.length, label = n > 1 ? (i + 1) + ' / ' + n : '';
    st.count.textContent = label; st.count.hidden = !label;
    st.live.textContent = (n > 1 ? 'Image ' + (i + 1) + ' of ' + n + '. ' : '') + (it.alt || it.cap || '');
    st.prev.hidden = st.next.hidden = n < 2;
    img.onload = function () { if (!st || tok !== st.token) return; st.nw = img.naturalWidth; st.nh = img.naturalHeight; fit(); img.classList.add('lbx-loaded'); };
    img.onerror = function () { if (!st || tok !== st.token) return; st.msg.textContent = 'This image could not be loaded.'; st.msg.hidden = false; };
    img.removeAttribute('width'); img.removeAttribute('height'); img.style.width = img.style.height = '';
    img.src = it.src;
    if (img.complete && img.naturalWidth) img.onload();
    [i - 1, i + 1].forEach(function (j) { if (st.items[j]) { var p = new Image(); p.src = st.items[j].src; } }); // warm the cache for prev/next
    syncUi();
  }
  function go(d) {
    if (!st || st.items.length < 2) return;
    show((st.i + d + st.items.length) % st.items.length);
  }

  // ---------------------------------------------------------------- geometry
  function fit() { // size the picture to the largest size that fits the screen, always at its own aspect ratio
    if (!st || !st.nw || !st.nh) return;
    var aw = Math.max(40, st.stage.clientWidth - PAD_X * 2), ah = Math.max(40, st.stage.clientHeight - PAD_Y * 2);
    var cap = st.items[st.i].px ? 8 : 2; // small pictures may grow, but not blur endlessly
    var k = Math.min(aw / st.nw, ah / st.nh, cap);
    st.fw = st.nw * k; st.fh = st.nh * k;
    var img = st.img;
    img.style.width = st.fw + 'px'; img.style.height = st.fh + 'px';
    img.style.marginLeft = -st.fw / 2 + 'px'; img.style.marginTop = -st.fh / 2 + 'px';
    st.max = clamp(Math.max(6, (st.nw / st.fw) * 4), 6, 40);
    apply();
  }
  function bounds(s) {
    var mx = Math.max(0, (st.fw * s - st.stage.clientWidth) / 2), my = Math.max(0, (st.fh * s - st.stage.clientHeight) / 2);
    return [mx, my];
  }
  function apply() {
    var s = clamp(st.s, 1, st.max), b = bounds(s);
    st.s = s; st.tx = s <= 1.0001 ? 0 : clamp(st.tx, -b[0], b[0]); st.ty = s <= 1.0001 ? 0 : clamp(st.ty, -b[1], b[1]);
    st.img.style.transform = 'translate(' + st.tx + 'px,' + st.ty + 'px) scale(' + s + ')';
    st.img.classList.toggle('lbx-zoomed', s > 1.0001);
    syncUi();
  }
  function syncUi() {
    if (!st) return;
    st.reset.textContent = Math.round(st.s * 100) + '%';
    st.out.disabled = st.s <= 1.0001; st.inn.disabled = st.s >= st.max - 0.0001;
  }
  function setView(s, tx, ty, animate) {
    if (animate) { st.img.classList.add('lbx-anim'); clearTimeout(st.animT); st.animT = setTimeout(function () { if (st) st.img.classList.remove('lbx-anim'); }, 200); }
    st.s = s; st.tx = tx; st.ty = ty; apply();
  }
  function zoomAt(cx, cy, ns) { // keep the point under (cx, cy) (relative to the stage centre) fixed while zooming
    ns = clamp(ns, 1, st.max); var r = ns / st.s;
    st.tx = cx - (cx - st.tx) * r; st.ty = cy - (cy - st.ty) * r; st.s = ns;
  }
  function zoomBy(f, animate) {
    if (animate) { st.img.classList.add('lbx-anim'); clearTimeout(st.animT); st.animT = setTimeout(function () { if (st) st.img.classList.remove('lbx-anim'); }, 200); }
    zoomAt(0, 0, st.s * f); apply();
  }
  function rel(e) { var r = st.stage.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; }
  function onResize() { fit(); }

  // ---------------------------------------------------------------- pointer, wheel and pinch
  function onWheel(e) {
    e.preventDefault();
    var d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1), p = rel(e);
    st.img.classList.remove('lbx-anim');
    zoomAt(p[0], p[1], st.s * Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0015))); apply();
  }
  function ptrList() { return Object.keys(st.ptrs).map(function (k) { return st.ptrs[k]; }); }
  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    st.img.classList.remove('lbx-anim');
    try { st.stage.setPointerCapture(e.pointerId); } catch (x) {}
    st.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, onImg: e.target === st.img, type: e.pointerType };
    var n = ptrList().length;
    if (n === 1) st.g = { moved: false, pinched: false };
    if (n === 2) { st.g.pinched = true; st.g.moved = true; var a = ptrList(); st.g.dist = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); st.g.mid = [(a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2]; }
    st.root.classList.toggle('lbx-drag', n === 1 && st.s > 1.0001);
    e.preventDefault();
  }
  function onMove(e) {
    var p = st && st.ptrs[e.pointerId]; if (!p) return;
    var px = p.x, py = p.y; p.x = e.clientX; p.y = e.clientY;
    var list = ptrList();
    if (list.length >= 2) {
      var a = list[0], b = list[1], d = Math.hypot(a.x - b.x, a.y - b.y), m = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      if (st.g.dist > 0) {
        var r = st.stage.getBoundingClientRect();
        zoomAt(m[0] - r.left - r.width / 2, m[1] - r.top - r.height / 2, st.s * (d / st.g.dist));
        st.tx += m[0] - st.g.mid[0]; st.ty += m[1] - st.g.mid[1];
        apply();
      }
      st.g.dist = d; st.g.mid = m;
      return;
    }
    if (!st.g.moved && Math.hypot(p.x - p.sx, p.y - p.sy) > 6) st.g.moved = true;
    if (st.s > 1.0001 && st.g.moved) { st.tx += p.x - px; st.ty += p.y - py; apply(); }
  }
  function onUp(e) {
    var p = st && st.ptrs[e.pointerId]; if (!p) return;
    var wasLast = ptrList().length === 1, g = st.g;
    delete st.ptrs[e.pointerId];
    try { st.stage.releasePointerCapture(e.pointerId); } catch (x) {}
    st.root.classList.remove('lbx-drag');
    if (!wasLast || !g || g.pinched) { if (!ptrList().length) st.g = null; return; }
    st.g = null;
    var dx = p.x - p.sx, dy = p.y - p.sy;
    if (g.moved) { // a swipe at normal size flips to the neighbouring picture
      if (p.type !== 'mouse' && st.s <= 1.0001 && Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      return;
    }
    if (p.onImg) { // a tap on the picture: double tap / double click toggles zoom
      var now = Date.now(), t = st.lastTap;
      if (t && now - t.t < 320 && Math.hypot(p.x - t.x, p.y - t.y) < 30) {
        st.lastTap = null;
        var c = rel(e);
        if (st.s > 1.0001) setView(1, 0, 0, true); else { st.img.classList.add('lbx-anim'); clearTimeout(st.animT); st.animT = setTimeout(function () { if (st) st.img.classList.remove('lbx-anim'); }, 200); zoomAt(c[0], c[1], DBL_ZOOM); apply(); }
      } else st.lastTap = { t: now, x: p.x, y: p.y };
      return;
    }
    closeViewer(); // a plain click on the dark area outside the picture
    swallowClick();
  }
  function swallowClick() { // the click that follows this tap must not reach whatever lies under the closed overlay
    var h = function (ev) { ev.preventDefault(); ev.stopPropagation(); off(); }, off = function () { document.removeEventListener('click', h, true); clearTimeout(t); }, t = setTimeout(off, 400);
    document.addEventListener('click', h, true);
  }
  function onCancel(e) { if (!st) return; delete st.ptrs[e.pointerId]; st.g = null; st.root.classList.remove('lbx-drag'); }

  // ---------------------------------------------------------------- keyboard
  function onKey(e) {
    if (!st) return;
    var k = e.key, used = true;
    if (k === 'Escape') closeViewer();
    else if (k === 'ArrowLeft') go(-1);
    else if (k === 'ArrowRight') go(1);
    else if (k === '+' || k === '=') zoomBy(STEP, true);
    else if (k === '-' || k === '_') zoomBy(1 / STEP, true);
    else if (k === '0') setView(1, 0, 0, true);
    else if (k === 'Tab') { // keep focus inside the dialog
      var f = Array.prototype.filter.call(st.root.querySelectorAll('button'), function (b) { return !b.disabled && !b.hidden; });
      if (!f.length) { e.preventDefault(); return; }
      var at = f.indexOf(document.activeElement), n = e.shiftKey ? at - 1 : at + 1;
      if (at < 0) n = e.shiftKey ? f.length - 1 : 0; else if (n < 0) n = f.length - 1; else if (n >= f.length) n = 0;
      f[n].focus(); used = true;
    } else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }

  // ---------------------------------------------------------------- opening from the page
  document.addEventListener('click', function (e) {
    if (st || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var img = e.target && e.target.closest ? e.target.closest('img') : null;
    if (!eligible(img)) return;
    e.preventDefault();
    var g = groupOf(img); open(g.items, g.index, img);
  });
  document.addEventListener('keydown', function (e) {
    if (st || (e.key !== 'Enter' && e.key !== ' ') || !e.target || !e.target.hasAttribute || !e.target.hasAttribute('data-lbx')) return;
    e.preventDefault(); var img = e.target, g = groupOf(img); open(g.items, g.index, img);
  });

  window.ImageLightbox = { open: function (items, index) { open(items, index || 0, document.activeElement); }, close: closeViewer, refresh: prepare };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prepare); else prepare();
})();
