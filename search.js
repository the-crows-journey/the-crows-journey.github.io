// One state (category from the URL hash + search text) drives everything on the page.
const B = document.currentScript.dataset.base, V = document.currentScript.dataset.v || '', q = document.getElementById('q'), x = document.getElementById('x'),
  r = document.getElementById('results'), lists = document.querySelectorAll('.listsec'), bar = document.querySelector('.cats'); // .cats exists only on the Blog page
const known = bar ? [...bar.querySelectorAll('[data-c]')].map(b => b.dataset.c) : [];
let data, run = 0;
const hashCat = () => { let c = ''; try { c = decodeURIComponent(location.hash.slice(1)); } catch {} return known.includes(c) ? c : ''; };
function setCat(c) { if (c === hashCat()) c = ''; history.pushState(null, '', location.pathname + location.search + (c ? '#' + encodeURIComponent(c) : '')); render(); }
const result = p => { const e = document.createElement('article'); e.className = 'entry nocover';
  e.innerHTML = '<div><h3><a></a></h3><p class="meta"></p><p class="ex"></p></div>'; const a = e.querySelector('a'); a.href = p.u; a.textContent = p.t;
  e.querySelector('.meta').textContent = p.d + ' | ' + [].concat(p.c).join(', '); e.querySelector('.ex').textContent = p.e; return e; };
async function render() {
  const id = ++run, cat = hashCat(), v = q ? q.value.trim().toLowerCase() : '';
  if (x) x.hidden = !v;
  document.querySelectorAll('[data-c],a[data-cat]').forEach(el => { const on = (el.dataset.c ?? el.dataset.cat) === cat; el.classList.toggle('on', on); if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', on); });
  document.querySelectorAll('#list .entry,#list .lead').forEach(e => e.hidden = !!cat && !JSON.parse(e.dataset.cats || '[]').includes(cat));
  const empty = document.getElementById('empty'); if (empty) empty.hidden = !cat || !!document.querySelector('#list .entry:not([hidden])');
  lists.forEach(l => { l.hidden = !!v; });
  if (!r) return;
  if (!v) { r.replaceChildren(); return; }
  try { data = data || await (await fetch(B + '/search.json?v=' + V)).json(); }
  catch { const n = document.createElement('p'); n.textContent = 'Search is unavailable right now. Browse the Blog page instead.'; r.replaceChildren(n); return; }
  if (id !== run) return; // a newer render started while loading
  const words = v.split(/\s+/), hit = data.filter(p => (!cat || [].concat(p.c).includes(cat)) && words.every(w => p.s.includes(w)));
  if (hit.length) r.replaceChildren(...hit.map(result)); else { const n = document.createElement('p'); n.textContent = 'No articles found.'; r.replaceChildren(n); }
}
if (q) q.addEventListener('input', render);
if (x) x.addEventListener('click', () => { q.value = ''; render(); q.focus(); });
if (bar) document.addEventListener('click', e => { const el = e.target.closest('[data-c],a[data-cat]'); if (!el) return; e.preventDefault(); setCat(el.dataset.c ?? el.dataset.cat); });
addEventListener('pageshow', e => { if (e.persisted) render(); }); // restored from the back/forward cache
addEventListener('hashchange', render); addEventListener('popstate', render); render();
