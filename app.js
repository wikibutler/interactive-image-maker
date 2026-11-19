/* Interactive image workbench — authoring tool for {{Interactive image}} (en.wp / eu.wp)
 * Vanilla JS, no build step. Emits wikitext; renders a faithful preview using the
 * template's own TemplateStyles CSS (template-styles.css, fetched from en.wp).
 */
(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const MAX_ITEMS = 24;
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const DEFAULT_COLOR = '#202122';

const S = {
  base: { src: '', name: '', w: 0, h: 0 },
  g: {
    title: '', note: '', layout: 'side', captions: 'legend',
    width: 50, columns: 3, resolution: 600, color: DEFAULT_COLOR, credits: ''
  },
  items: [],
  sel: -1,
  previewW: '100%',
  step: 1,
  expert: false
};

let TEMPLATE_CSS = '';

/* ---------------------------------------------------------------- utils */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), 1900);
}

function imgSize(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = () => reject(new Error('image failed to load'));
    i.src = src;
  });
}

function stripFilePrefix(name) {
  return String(name || '').replace(/^\s*(file|image)\s*:\s*/i, '').trim();
}

async function commonsFile(name) {
  const title = 'File:' + stripFilePrefix(name);
  if (!stripFilePrefix(name)) throw new Error('empty file name');
  const url = COMMONS_API + '?' + new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*',
    prop: 'imageinfo', iiprop: 'url|size|mime', iiurlwidth: '1600', titles: title
  });
  const r = await fetch(url);
  if (!r.ok) throw new Error('Commons API returned ' + r.status);
  const j = await r.json();
  const p = j?.query?.pages?.[0];
  if (!p) throw new Error('Commons API returned no page');
  if (p.missing) throw new Error('not found on Commons: ' + title);
  const ii = (p.imageinfo || [])[0];
  if (!ii) throw new Error('no imageinfo (is it a file?)');
  return {
    name: String(p.title).replace(/^File:/, ''),
    src: ii.thumburl || ii.url,
    full: ii.url,
    w: ii.width, h: ii.height, mime: ii.mime
  };
}

/* --------------------------------------------------------- mini wikitext */
function renderWikitext(s) {
  let t = esc(s);
  t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (m, a, b) =>
    `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(a.trim().replace(/ /g, '_'))}">${b}</a>`);
  t = t.replace(/\[\[([^\]]+)\]\]/g, (m, a) =>
    `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(a.trim().replace(/ /g, '_'))}">${a}</a>`);
  t = t.replace(/'{3}([^']+)'{3}/g, '<strong>$1</strong>');
  t = t.replace(/''([^']+)''/g, '<em>$1</em>');
  // crude list handling: lines starting with * become bullets
  const lines = t.split('\n');
  if (lines.some((l) => /^\s*[*#]/.test(l))) {
    const out = [];
    let mode = null;
    lines.forEach((l) => {
      const m = l.match(/^\s*([*#])\s*(.*)$/);
      const tag = m && m[1] === '*' ? 'ul' : 'ol';
      if (m) {
        if (mode !== tag) { if (mode) out.push(`</${mode}>`); out.push(`<${tag}>`); mode = tag; }
        out.push(`<li>${m[2]}</li>`);
      } else {
        if (mode) { out.push(`</${mode}>`); mode = null; }
        out.push(l);
      }
    });
    if (mode) out.push(`</${mode}>`);
    t = out.join('\n');
  } else {
    t = t.replace(/\n/g, '<br>');
  }
  return t;
}

/* ------------------------------------------------------------- rendering */
function imageName() { return stripFilePrefix(S.base.name); }

function buildWidgetHTML() {
  const g = S.g, items = S.items;
  const count = Math.max(items.length, 1);
  const col = g.color || DEFAULT_COLOR;
  const px = Math.max(60, Math.round(num(g.resolution, 600)));
  const pxFile = (src, alt) =>
    `<img src="${esc(src)}" alt="${esc(alt || '')}" width="${px}">`;
  const nameLink = (it) => it.link
    ? `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(String(it.link).trim().replace(/ /g, '_'))}">${esc(it.name)}</a>`
    : esc(it.name || '');

  const out = [];
  out.push('<div class="irudi-int">');
  if (g.title) out.push(`<div class="irudi-int-izenburua">${renderWikitext(g.title)}</div>`);
  const note = g.note || (g.captions === 'card'
    ? 'Hover over a number or a list item to see details.'
    : 'Hover over a number or a list item to compare.');
  out.push(`<div class="irudi-int-interaktiboa">${renderWikitext(note)}</div>`);

  if (g.layout === 'top') {
    out.push(`<div class="irudi-int-edukia irudi-int-goian" style="grid-template-columns:repeat(${clamp(Math.round(num(g.columns, 3)), 1, 4)},minmax(0,1fr))">`);
  } else {
    const w = clamp(num(g.width, 50), 20, 80);
    out.push(`<div class="irudi-int-edukia" style="grid-template-columns:minmax(0,${w}fr) minmax(0,${100 - w}fr)">`);
  }

  // legend first — these must be preceding siblings of the image wrapper
  items.forEach((it, i) => {
    const n = i + 1;
    const gr = g.layout === 'top' ? '' : ` style="grid-row:${n}"`;
    out.push(`<div class="irudi-int-elementua irudi-int-${n}"${gr}>`);
    out.push(`<span class="irudi-int-zbk" style="background-color:${esc(col)}">${esc(it.label || n)}</span>`);
    out.push(`<span class="irudi-int-izena">${nameLink(it)}</span>`);
    if (it.text) {
      const isCard = g.captions === 'card' && it.x != null && it.y != null;
      if (isCard) out.push(`<div class="irudi-int-testua irudi-int-testua-txartela">${renderWikitext(it.text)}</div>`);
      else out.push(`<span class="irudi-int-testua">${renderWikitext(it.text)}</span>`);
    }
    out.push('</div>');
  });

  // image wrapper
  out.push(g.layout === 'top'
    ? '<div class="irudi-int-irudia">'
    : `<div class="irudi-int-irudia" style="grid-row:1 / span ${count}">`);
  out.push(`<div class="irudi-int-oinarria">${S.base.src ? pxFile(S.base.src, g.title) : ''}</div>`);

  items.forEach((it, i) => {
    const n = i + 1;
    if (it.x == null || it.y == null || !S.base.w || !S.base.h) return;
    const xp = (it.x / S.base.w) * 100, yp = (it.y / S.base.h) * 100;
    out.push(`<div class="irudi-int-puntua irudi-int-${n}" style="left:${fx(xp)}%;top:${fx(yp)}%">`);
    out.push(`<span class="irudi-int-marka" style="background-color:${esc(col)}"${g.captions === 'card' && it.text ? '' : ` title="${esc(it.name || '')}"`}>${esc(it.label || n)}</span>`);
    if (g.captions === 'card' && it.text) {
      const k = ['irudi-int-txartela-puntua'];
      if (yp > 55) k.push('irudi-int-gora');
      if (xp > 65) k.push('irudi-int-eskuin');
      else if (xp >= 35) k.push('irudi-int-erdian');
      out.push(`<div class="irudi-int-txartela ${k.join(' ')}"><div class="irudi-int-txartela-edukia">` +
        `<div class="irudi-int-txartela-izena">${nameLink(it)}</div>` +
        `<div class="irudi-int-txartela-testua">${renderWikitext(it.text)}</div></div></div>`);
    }
    out.push('</div>');
  });

  items.forEach((it, i) => {
    if (!it.layerSrc) return;
    out.push(`<div class="irudi-int-geruza irudi-int-geruza-${i + 1}">${pxFile(it.layerSrc, it.name)}</div>`);
  });

  out.push('</div></div>'); // image wrapper, edukia

  // credits
  if (imageName()) {
    const target = 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(imageName().replace(/ /g, '_'));
    out.push('<div class="irudi-int-kredituak"><span class="irudi-int-kredituak-edukia">' +
      '<span class="irudi-int-kredituak-logoa"><img src="https://upload.wikimedia.org/wikipedia/commons/4/4a/Commons-logo.svg" width="14" alt="Wikimedia Commons"></span>' +
      `<span class="irudi-int-kredituak-testua"><a href="${target}">${esc(g.credits || 'Image credits')}</a></span></span></div>`);
  }
  out.push('</div>');
  return out.join('\n');
}

function fx(v) {
  let s = (Math.round(v * 100) / 100).toFixed(2);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(drawPreview, 220);
}

function drawPreview() {
  const f = $('preview');
  if (!S.base.src) {
    f.srcdoc = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:28px;font:14px sans-serif;color:#72777d;text-align:center">Load a base image to see the rendered template.</body>`;
    return;
  }
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>${TEMPLATE_CSS}</style>
<style>body{margin:0;padding:14px;background:#fff;font-family:sans-serif;color:#202122}
.mw-parser-output a{color:#3366cc}img{max-width:100%}</style>
</head><body class="mw-parser-output">${buildWidgetHTML()}</body></html>`;
  f.srcdoc = html;
  f.onload = () => {
    try {
      const h = f.contentDocument.documentElement.scrollHeight;
      f.style.height = Math.max(120, h + 8) + 'px';
    } catch (e) { /* ignore */ }
  };
}

function renderMarkers() {
  const box = $('markerBox');
  box.innerHTML = '';
  if (!S.base.src) return;
  S.items.forEach((it, i) => {
    if (it.x == null || it.y == null || !S.base.w || !S.base.h) return;
    const d = document.createElement('div');
    d.className = 'marker' + (i === S.sel ? ' sel' : '');
    d.dataset.i = i;
    d.style.left = (it.x / S.base.w * 100) + '%';
    d.style.top = (it.y / S.base.h * 100) + '%';
    const b = document.createElement('span');
    b.className = 'badge';
    b.style.background = S.g.color || DEFAULT_COLOR;
    b.textContent = it.label || (i + 1);
    d.appendChild(b);
    d.addEventListener('pointerdown', onMarkerDown);
    d.addEventListener('mouseenter', () => showLayer(i));
    d.addEventListener('mouseleave', hideLayer);
    box.appendChild(d);
  });
}

function showLayer(i) {
  const it = S.items[i];
  const box = $('layerBox');
  if (!it || !it.layerSrc) { box.innerHTML = ''; return; }
  box.innerHTML = `<img src="${esc(it.layerSrc)}" alt="">`;
  box.style.opacity = '1';
}
function hideLayer() {
  $('layerBox').style.opacity = '0';
}

/* -------------------------------------------------------------- dragging */
let drag = null;
function onMarkerDown(e) {
  const el = e.currentTarget;
  const i = +el.dataset.i;
  selectItem(i);
  drag = { i, moved: false };
  el.classList.add('dragging');
  el.setPointerCapture(e.pointerId);
  e.preventDefault();
}
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const frame = $('frame');
  const r = frame.getBoundingClientRect();
  const it = S.items[drag.i];
  if (!it) return;
  const px = clamp((e.clientX - r.left) / r.width, 0, 1) * S.base.w;
  const py = clamp((e.clientY - r.top) / r.height, 0, 1) * S.base.h;
  it.x = Math.round(px); it.y = Math.round(py);
  drag.moved = true;
  updateMarkerPos(drag.i);
  syncFormCoords();
  schedulePreview();
});
document.addEventListener('pointerup', () => {
  if (!drag) return;
  document.querySelectorAll('.marker.dragging').forEach((m) => m.classList.remove('dragging'));
  drag = null;
  validate(); renderList();
});
function updateMarkerPos(i) {
  const el = $('markerBox').querySelector(`.marker[data-i="${i}"]`);
  const it = S.items[i];
  if (!el || !it) return;
  el.style.left = (it.x / S.base.w * 100) + '%';
  el.style.top = (it.y / S.base.h * 100) + '%';
}

/* ------------------------------------------------------------- item list */
function renderList() {
  const box = $('itemList');
  box.innerHTML = '';
  $('countHint').textContent = `${S.items.length} / ${MAX_ITEMS}`;
  updateStatus(); renderBanner(); renderInlineExport();
  if (!S.items.length) {
    box.innerHTML = '<div class="empty-note" style="width:100%">No items yet — click the image to place marker 1.</div>';
    return;
  }
  S.items.forEach((it, i) => {
    const c = document.createElement('div');
    c.className = 'chip' + (i === S.sel ? ' on' : '');
    c.innerHTML = `<span class="n">${esc(it.label || (i + 1))}</span><span class="t">${esc(it.name || 'unnamed')}</span>`;
    c.addEventListener('click', () => selectItem(i));
    const x = document.createElement('button');
    x.className = 'x'; x.textContent = '×'; x.title = 'Delete item';
    x.addEventListener('click', (ev) => { ev.stopPropagation(); removeItem(i); });
    c.appendChild(x);
    box.appendChild(c);
  });
}

function removeItem(i) {
  S.items.splice(i, 1);
  if (S.sel >= S.items.length) S.sel = S.items.length - 1;
  renderAll();
  if (S.step >= 3 && !S.items.length) setStep(2, { silent: true });
}

function renderForm() {
  const host = $('itemForm');
  if (S.sel < 0 || !S.items[S.sel]) {
    host.innerHTML = '<div class="empty-note">Select a marker to edit its name, text, layer and link.</div>';
    return;
  }
  const it = S.items[S.sel];
  const wiz = S.step === 3 && !S.expert;
  const head = wiz
    ? `<div class="wizhead"><span class="wz">Region ${S.sel + 1} of ${S.items.length}</span>
        <span class="nav">
          <button id="wzPrev" title="Previous region" ${S.sel === 0 ? 'disabled' : ''}>‹</button>
          <button id="wzNext" title="Next region" ${S.sel === S.items.length - 1 ? 'disabled' : ''}>›</button>
        </span></div>`
    : '<div class="divider"></div>';
  host.innerHTML = `
    ${head}
    <label class="f"><span>N-name <em style="font-style:normal;color:#bf3e33">required</em></span>
      <input type="text" data-k="name" value="${esc(it.name)}" placeholder="Skull"></label>
    <div class="row">
      <label class="f"><span>N-label (badge)</span><input type="text" data-k="label" value="${esc(it.label)}" placeholder="${S.sel + 1}"></label>
      <label class="f"><span>N-link (page)</span><input type="text" data-k="link" value="${esc(it.link)}" placeholder="Skull"></label>
    </div>
    <label class="f"><span>N-text</span>
      <textarea data-k="text" placeholder="The horse's skull is long…">${esc(it.text)}</textarea></label>
    <label class="f"><span>N-image — layer file on Commons</span>
      <input type="text" data-k="layerName" value="${esc(it.layerName)}" placeholder="Base - skull.svg" spellcheck="false"></label>
    <div class="row">
      <label class="f"><span>N-x</span><input type="number" data-k="x" value="${it.x != null ? Math.round(it.x) : ''}" step="1"></label>
      <label class="f"><span>N-y</span><input type="number" data-k="y" value="${it.y != null ? Math.round(it.y) : ''}" step="1"></label>
    </div>
    <div class="row">
      <button class="btn" id="btnLayerFile" style="flex:1">Attach local layer…</button>
      <button class="btn" id="btnFetchLayer" style="flex:1">Fetch from Commons</button>
    </div>
    <input type="file" id="fileLayer" accept="image/*" hidden>
    <p class="hintline" style="margin-top:8px">Layers must be the same canvas as the base (same <code>viewBox</code>), otherwise the revealed region is shifted.</p>
    <button class="btn" id="btnDelete" style="width:100%;color:var(--err)">Delete this item</button>
  `;
  host.querySelectorAll('[data-k]').forEach((el) => {
    el.addEventListener('input', () => {
      const k = el.dataset.k;
      if (k === 'x' || k === 'y') {
        const v = el.value === '' ? null : parseFloat(el.value);
        S.items[S.sel][k] = Number.isFinite(v) ? clamp(v, 0, k === 'x' ? S.base.w : S.base.h) : null;
        renderMarkers(); schedulePreview(); validate();
      } else {
        S.items[S.sel][k] = el.value;
        if (k === 'name' || k === 'label') { renderList(); renderMarkers(); }
        schedulePreview(); validate();
      }
    });
  });
  const wzPrev = $('itemForm').querySelector('#wzPrev');
  const wzNext = $('itemForm').querySelector('#wzNext');
  if (wzPrev) wzPrev.addEventListener('click', () => selectItem(Math.max(0, S.sel - 1)));
  if (wzNext) wzNext.addEventListener('click', () => selectItem(Math.min(S.items.length - 1, S.sel + 1)));
  $('btnDelete').addEventListener('click', () => removeItem(S.sel));
  $('btnLayerFile').addEventListener('click', () => $('fileLayer').click());
  $('fileLayer').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const src = await fileToDataURL(f);
    const dim = await imgSize(src).catch(() => null);
    const it = S.items[S.sel];
    it.layerSrc = src; it.layerW = dim ? dim.w : null; it.layerH = dim ? dim.h : null;
    if (!it.layerName) it.layerName = f.name;
    renderForm(); schedulePreview(); validate(); toast('Layer attached — remember to upload it to Commons');
  });
  $('btnFetchLayer').addEventListener('click', async () => {
    const name = ($('itemForm').querySelector('[data-k="layerName"]').value || '').trim();
    if (!name) { toast('Type the layer file name first'); return; }
    try {
      const f = await commonsFile(name);
      const it = S.items[S.sel];
      it.layerName = f.name; it.layerSrc = f.src; it.layerW = f.w; it.layerH = f.h;
      renderForm(); schedulePreview(); validate(); toast('Layer loaded: ' + f.w + '×' + f.h);
    } catch (err) { toast('Layer: ' + err.message); }
  });
}

function syncFormCoords() {
  const x = $('itemForm').querySelector('[data-k="x"]');
  const y = $('itemForm').querySelector('[data-k="y"]');
  const it = S.items[S.sel];
  if (!it) return;
  if (x && document.activeElement !== x) x.value = it.x != null ? Math.round(it.x) : '';
  if (y && document.activeElement !== y) y.value = it.y != null ? Math.round(it.y) : '';
}

function selectItem(i) {
  S.sel = i;
  renderList(); renderForm(); renderMarkers();
}

/* --------------------------------------------------------------- checks */
function validate() {
  const ul = $('checkList');
  const out = [];
  const push = (level, text) => out.push({ level, text });

  if (!S.base.src) push('err', 'No base image loaded.');
  else if (!imageName()) push('warn', 'Base image has no file name for the wikitext <code>image=</code>.');
  if (!S.base.w || !S.base.h) push('err', 'original-width / original-height are not set.');
  if (!S.items.length) push('err', 'No items — an empty box renders nothing useful.');
  if (S.items.length > MAX_ITEMS) push('err', `${S.items.length} items: the module caps at ${MAX_ITEMS}.`);

  S.items.forEach((it, i) => {
    const n = i + 1;
    if (!String(it.name || '').trim()) push('err', `#${n} has no name — it will not render at all.`);
    if (it.x == null || it.y == null) push('warn', `#${n} has no marker coordinates (legend-only item).`);
    else if (it.x < 0 || it.x > S.base.w || it.y < 0 || it.y > S.base.h)
      push('warn', `#${n} sits outside the canvas (${Math.round(it.x)}, ${Math.round(it.y)}).`);
    if (!it.layerSrc) push('warn', `#${n} has no layer file — hovering it reveals nothing.`);
    if (it.layerW && S.base.w && (it.layerW !== S.base.w || it.layerH !== S.base.h))
      push('warn', `#${n} layer is ${it.layerW}×${it.layerH} but base is ${S.base.w}×${S.base.h} — regions will be misplaced.`);
    if (it.layerSrc && !String(it.layerName || '').trim())
      push('warn', `#${n} layer is local only: add its Commons file name for the export.`);
    if (S.g.captions === 'card' && it.text && (it.x == null || it.y == null))
      push('warn', `#${n} text lives in a card, but a card needs a marker — its text will vanish for readers.`);
  });

  if (!out.some((c) => c.level === 'err') && !out.some((c) => c.level === 'warn'))
    push('ok', 'Looks consistent. Export, preview in a sandbox page, then hover every marker.');
  else if (!out.some((c) => c.level === 'err'))
    push('ok', 'No blocking errors.');

  ul.innerHTML = out.map((c) => `<li class="${c.level}">${c.text}</li>`).join('');
  renderInlineExport();
  return out;
}

/* --------------------------------------------------------------- export */
function pad(k) { return (k + ' ').padEnd(15, ' '); }

function exportText() {
  const g = S.g;
  const L = [];
  L.push('{{Interactive image');
  if (imageName()) L.push(`|${pad('image')}= ${imageName()}`);
  if (g.title) L.push(`|${pad('title')}= ${g.title}`);
  if (g.note) L.push(`|${pad('note')}= ${g.note}`);
  if (g.layout === 'top') {
    L.push(`|${pad('layout')}= top`);
    L.push(`|${pad('columns')}= ${clamp(Math.round(num(g.columns, 3)), 1, 4)}`);
  } else if (Math.round(num(g.width, 50)) !== 50) {
    L.push(`|${pad('width')}= ${clamp(Math.round(num(g.width, 50)), 20, 80)}`);
  }
  if (g.captions === 'card') L.push(`|${pad('captions')}= card`);
  L.push(`|${pad('resolution')}= ${Math.max(60, Math.round(num(g.resolution, 600)))}`);
  L.push(`|${pad('original-width')}= ${S.base.w}`);
  L.push(`|${pad('original-height')}= ${S.base.h}`);
  if (g.color && g.color.toLowerCase() !== DEFAULT_COLOR) L.push(`|${pad('color')}= ${g.color}`);
  if (g.credits) L.push(`|${pad('credits')}= ${g.credits}`);

  S.items.forEach((it, i) => {
    const n = i + 1;
    L.push(`|${pad(n + '-name')}= ${it.name || ''}`);
    if (it.label) L.push(`|${pad(n + '-label')}= ${it.label}`);
    if (it.text) {
      const multi = /\n/.test(it.text) || /^[*#:;]/.test(it.text.trim());
      L.push(`|${pad(n + '-text')}= ${multi ? '\n' + it.text : it.text}`);
    }
    if (it.layerName) L.push(`|${pad(n + '-image')}= ${stripFilePrefix(it.layerName)}`);
    if (it.link) L.push(`|${pad(n + '-link')}= ${it.link}`);
    if (it.x != null) L.push(`|${pad(n + '-x')}= ${Math.round(it.x)}`);
    if (it.y != null) L.push(`|${pad(n + '-y')}= ${Math.round(it.y)}`);
  });
  L.push('}}');
  return L.join('\n');
}

/* ------------------------------------------------------------ commons UI */
async function loadCommons(name) {
  const f = await commonsFile(name);
  setBase(f.src, f.name, f.w, f.h);
  toast(`Loaded ${f.name} — ${f.w}×${f.h}`);
}

function updateStatus() {
  $('statusline').textContent = S.base.src
    ? `${S.base.name || 'local file'} · ${S.base.w}×${S.base.h}px · ${S.items.length} item(s)`
    : 'No image loaded — start with a Commons file name or an upload';
}

function setBase(src, name, w, h) {
  S.base = { src, name: stripFilePrefix(name), w: Math.round(w), h: Math.round(h) };
  const img = $('baseImg');
  img.src = src; img.hidden = false;
  $('stageEmpty').hidden = true;
  $('owInput').value = S.base.w;
  $('ohInput').value = S.base.h;
  renderAll();
  if (!S.expert && S.step === 1) setStep(2, { silent: true });
}

function renderAll() {
  renderList(); renderForm(); renderMarkers(); schedulePreview(); validate();
  if (S.base.name && !$('commonsName').value) $('commonsName').value = S.base.name;
  updateStatus();
}

/* ------------------------------------------------------------ project io */
function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function saveProject() {
  const data = { v: 1, saved: new Date().toISOString(), base: S.base, g: S.g, items: S.items };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (S.base.name ? S.base.name.replace(/\.[a-z0-9]+$/i, '') : 'interactive-image') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('Project saved');
}

function loadProject(file) {
  return file.text().then((t) => {
    const d = JSON.parse(t);
    S.base = d.base || S.base;
    S.g = Object.assign(S.g, d.g || {});
    S.items = d.items || [];
    S.sel = S.items.length ? 0 : -1;
    if (S.base.src) { $('baseImg').src = S.base.src; $('baseImg').hidden = false; $('stageEmpty').hidden = true; }
    $('owInput').value = S.base.w || ''; $('ohInput').value = S.base.h || '';
    $('commonsName').value = S.base.name || '';
    syncGlobalsToForm();
    renderAll();
    if (!S.expert) setStep(S.items.length ? 3 : 2, { silent: true });
    toast('Project loaded');
  });
}

function syncGlobalsToForm() {
  $('gTitle').value = S.g.title || '';
  $('gNote').value = S.g.note || '';
  $('gLayout').value = S.g.layout || 'side';
  $('gCaptions').value = S.g.captions || 'legend';
  $('gWidth').value = S.g.width;
  $('gColumns').value = S.g.columns;
  $('gResolution').value = S.g.resolution;
  $('gColor').value = S.g.color;
  $('gCredits').value = S.g.credits || '';
}

/* ------------------------------------------------------- wikitext import */
function parseWikitext(txt) {
  const NAME = '(?:Interactive image|Irudi interaktiboa|Imagen interactiva|Imatge interactiva|Interaktives Bild)';
  const m = txt.match(new RegExp('\\{\\{\\s*' + NAME + '\\b([\\s\\S]*?)\\}\\}\\s*$', 'i'))
         || txt.match(new RegExp('\\{\\{\\s*' + NAME + '\\b([\\s\\S]*)\\}\\}', 'i'));
  if (!m) throw new Error('No {{Interactive image …}} block found');
  const body = m[1];
  const re = /\|\s*([A-Za-z0-9_-]+)\s*=\s*([\s\S]*?)(?=\s*\|\s*[A-Za-z0-9_-]+\s*=|$)/g;
  const params = {};
  let r;
  while ((r = re.exec(body))) {
    const k = r[1].trim();
    if (k in params) continue;
    params[k] = r[2].trim().replace(/\n\s*$/, '');
  }

  const g = { ...S.g };
  const items = [];
  const map = {
    irudia: 'image', izenburua: 'title', oharra: 'note', diseinua: 'layout',
    zabalera: 'width', zutabeak: 'columns', bereizmena: 'resolution',
    'jatorrizko-zabalera': 'original-width', 'jatorrizko-altuera': 'original-height',
    azalpenak: 'captions', kolorea: 'color', estiloa: 'style', kredituak: 'credits',
    imagen: 'image', título: 'title', ancho: 'width'
  };
  const cv = (v) => v;
  Object.entries(params).forEach(([rawK, v]) => {
    const k = map[rawK] || rawK;
    const im = k.match(/^(\d+)-(izena|etiketa|testua|irudia|esteka|name|label|text|image|link|x|y)$/);
    if (im) {
      const n = +im[1], f = im[2];
      const key = {
        izena: 'name', etiketa: 'label', testua: 'text', irudia: 'layerName', esteka: 'link',
        image: 'layerName'
      }[f] || f;
      const it = items[n - 1] || (items[n - 1] = { name: '', label: '', text: '', link: '', layerName: '', layerSrc: '', x: null, y: null });
      if (key === 'x' || key === 'y') it[key] = parseFloat(v);
      else it[key] = cv(v);
      return;
    }
    if (/^(original-width|jatorrizko-zabalera)$/.test(rawK)) S.base.w = parseInt(v, 10) || S.base.w;
    if (/^(original-height|jatorrizko-altuera)$/.test(rawK)) S.base.h = parseInt(v, 10) || S.base.h;
    if (k === 'image') { S.base.name = stripFilePrefix(v); return; }
    if (k === 'width' || k === 'columns' || k === 'resolution') { g[k] = parseFloat(v); return; }
    if (k === 'captions') { g.captions = /txartela|card/.test(v) ? 'card' : 'legend'; return; }
    if (k === 'layout') { g.layout = /goian|top/.test(v) ? 'top' : 'side'; return; }
    if (k in g) g[k] = v;
  });
  S.g = g;
  S.items = items.filter(Boolean).map((it, i) => ({
    name: it.name || '', label: it.label || '', text: it.text || '', link: it.link || '',
    layerName: stripFilePrefix(it.layerName || ''), layerSrc: '', x: it.x, y: it.y
  }));
  S.sel = S.items.length ? 0 : -1;
}

/* ---------------------------------------------------------------- modals */
function openModal(html) {
  $('sheet').innerHTML = html;
  $('modal').classList.add('on');
  $('modal').querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
}
function closeModal() { $('modal').classList.remove('on'); }

function showExport() {
  const txt = exportText();
  const checks = validate();
  const errs = checks.filter((c) => c.level === 'err');
  openModal(`
    <div class="modalbar">
      <h3 style="margin:0">Wikitext</h3>
      <button class="btn close" data-close>Close</button>
    </div>
    ${errs.length ? `<p style="color:#8a2b22">${errs.length} blocking problem(s): ${errs.map((e) => e.text.replace(/<[^>]+>/g, '')).join('; ')}</p>` : ''}
    <pre id="exportPre">${esc(txt)}</pre>
    <div class="modalbar">
      <button class="btn primary" id="btnCopy">Copy wikitext</button>
      <button class="btn" id="btnDownload">Download .txt</button>
    </div>
    <p>Paste into a sandbox page and hover every marker before saving. The category
    <code>Category:Pages using Interactive image</code> is added by the template itself.
    Files must already be on Commons — the wikitext only names them.</p>
  `);
  $('btnCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(txt); toast('Copied'); }
    catch (e) { toast('Clipboard blocked — select the text instead'); }
  });
  $('btnDownload').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
    a.download = 'interactive-image.txt';
    a.click();
  });
}

function showImport() {
  openModal(`
    <div class="modalbar">
      <h3 style="margin:0">Import an existing block</h3>
      <button class="btn close" data-close>Close</button>
    </div>
    <p>Paste a <code>{{Interactive image}}</code> or <code>{{Irudi interaktiboa}}</code> block — English or Basque parameter names both work.</p>
    <textarea id="importArea" placeholder="{{Interactive image&#10;|image=A.svg&#10;|original-width=1000&#10;…}}"></textarea>
    <div class="modalbar" style="margin-top:10px">
      <button class="btn primary" id="btnDoImport">Import</button>
      <span class="hint" style="color:#72777d;font-size:12px">Layer images are re-fetched from Commons when the file name resolves.</span>
    </div>
  `);
  $('btnDoImport').addEventListener('click', async () => {
    try {
      parseWikitext($('importArea').value);
      closeModal();
      syncGlobalsToForm();
      $('owInput').value = S.base.w || ''; $('ohInput').value = S.base.h || '';
      renderAll();
      if (S.base.name) {
        try { await loadCommons(S.base.name); } catch (e) { toast('Base image not loaded: ' + e.message); }
      }
      // re-fetch layers
      for (const it of S.items) {
        if (it.layerName) {
          try {
            const f = await commonsFile(it.layerName);
            it.layerSrc = f.src; it.layerW = f.w; it.layerH = f.h;
          } catch (e) { /* leave unresolved */ }
        }
      }
      renderAll();
      if (!S.expert && S.items.length) setStep(3, { silent: true });
      toast('Imported ' + S.items.length + ' item(s)');
    } catch (e) { toast(e.message); }
  });
}

function showAbout() {
  openModal(`
    <div class="modalbar">
      <h3 style="margin:0">About this workbench</h3>
      <button class="btn close" data-close>Close</button>
    </div>
    <p>Authoring tool for <a href="https://en.wikipedia.org/wiki/Template:Interactive_image" target="_blank" rel="noopener">{{Interactive image}}</a>
    — the pure-CSS marker + hover-layer template ported to English Wikipedia from Basque Wikipedia's
    <a href="https://eu.wikipedia.org/wiki/Txantiloi:Irudi_interaktiboa" target="_blank" rel="noopener">{{Irudi interaktiboa}}</a>.</p>
    <h3 style="font-size:14px;margin-top:14px">How the rendering works</h3>
    <ul>
      <li><code>Module:Interactive image</code> (Lua) emits the markup; <code>Template:Interactive image/styles.css</code> (20 KB of TemplateStyles) does all the interaction.</li>
      <li>Legend rows are emitted <em>before</em> the image wrapper so one general-sibling rule can reveal a layer: <code>.irudi-int-elementua.irudi-int-5:hover ~ .irudi-int-irudia .irudi-int-geruza-5{opacity:1}</code>.</li>
      <li>There is no JavaScript, no gadget and no <code>:has()</code> (TemplateStyles' sanitizer refuses it), which is why items are capped at 24 and the rules are unrolled by hand.</li>
    </ul>
    <p style="margin-top:10px">The default view is a four-step guide — choose image, place regions,
    describe them, export. <strong>Show all panels</strong> (top right) switches to the free-form
    three-panel layout, which is what you want when editing an existing project.</p>
    <h3 style="font-size:14px;margin-top:14px">What this tool decides for you</h3>
    <ul>
      <li><strong>Units.</strong> Marker coordinates are written in the base file's own pixel size and <code>original-width</code>/<code>original-height</code> are filled in from the image. Percentages are never emitted — they silently misplace markers.</li>
      <li><strong>Card placement.</strong> When <code>captions=card</code>, cards flip above the marker past 55% height and left past 65% width, matching the module's own class logic.</li>
      <li><strong>Geometry check.</strong> Every layer's natural size is compared with the base; a different canvas is flagged, because that layer would appear shifted or scaled.</li>
    </ul>
    <h3 style="font-size:14px;margin-top:14px">What it does not do</h3>
    <ul>
      <li>It does not upload anything. File names in the export must already exist on Commons.</li>
      <li>Wikitext in <code>N-text</code> is previewed with a small parser (links, bold, italics, lists). Templates, tables and references inside text are not rendered.</li>
      <li>Fonts and skin colours come from your browser, not Vector 2022, so text metrics differ slightly from the live page.</li>
      <li>Hover is the only trigger in the template itself — check the mobile preview, where cards collapse into legend text.</li>
    </ul>
    <p style="margin-top:14px">Preview CSS is fetched verbatim from
    <a href="https://en.wikipedia.org/wiki/Template:Interactive_image/styles.css" target="_blank" rel="noopener">Template:Interactive image/styles.css</a>
    (CC BY-SA 4.0, Wikipedia contributors). Documentation lives only at
    <a href="https://en.wikipedia.org/wiki/Template:Interactive_image/doc" target="_blank" rel="noopener">Template:Interactive image/doc</a>.</p>
  `);
}

/* ------------------------------------------------------------ step flow */
const STEP_TEXT = {
  1: ['Step 1 — choose a base image', "A Commons file name, an upload or a URL. The file's own pixel size becomes the coordinate system."],
  2: ['Step 2 — click the image once per region', 'Each click drops a numbered marker; drag to adjust, arrow keys nudge.'],
  3: ['Step 3 — describe each region', 'Name is required. Text shows in the legend, or in a hover card when the box is in card mode.'],
  4: ['Step 4 — copy the wikitext', 'Paste into a sandbox page and hover every marker before saving. Files must already be on Commons.']
};

function setStep(n, opts) {
  const from = S.step;
  n = clamp(Math.round(n), 1, 4);
  if (n >= 2 && !S.base.src) { toast('Load a base image first'); n = 1; }
  if (n >= 3 && !S.items.length) { toast('Place at least one region first'); n = 2; }
  S.step = n;
  // entering the describe step starts at the first region, not whichever was last clicked
  if (n === 3 && from !== 3) S.sel = 0;
  if (n === 3 && (S.sel < 0 || S.sel >= S.items.length)) S.sel = 0;
  applyStep();
  if (!(opts && opts.silent)) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function applyStep() {
  const main = document.querySelector('main');
  if (!main) return;
  main.dataset.step = S.expert ? 'x' : String(S.step);
  document.body.classList.toggle('expert', S.expert);
  const done = {
    1: !!S.base.src,
    2: S.items.length > 0,
    3: S.items.length > 0 && S.items.every((i) => String(i.name || '').trim()),
    4: false
  };
  document.querySelectorAll('#stepper .step').forEach((b) => {
    const n = +b.dataset.step;
    b.classList.toggle('on', !S.expert && n === S.step);
    b.classList.toggle('done', !S.expert && !!done[n] && n !== S.step);
  });
  const mode = $('btnExpert');
  if (mode) mode.textContent = S.expert ? 'Guided steps' : 'Show all panels';
  renderBanner(); renderForm(); renderInlineExport();
}

function renderBanner() {
  const t = STEP_TEXT[S.step] || STEP_TEXT[1];
  let hint = t[1];
  if (S.step === 2) hint = t[1] + ' ' + S.items.length + ' of ' + MAX_ITEMS + ' placed.';
  if (S.step === 3) hint = 'Region ' + Math.max(1, S.sel + 1) + ' of ' + S.items.length + '. ' + t[1];
  const title = $('sbTitle');
  if (!title) return;
  title.textContent = t[0];
  $('sbHint').textContent = S.expert ? 'All panels shown — steps are off.' : hint;
  const back = $('sbBack'), next = $('sbNext');
  back.disabled = S.step === 1;
  if (S.step === 1) { next.textContent = 'Next: place regions'; next.disabled = !S.base.src; }
  if (S.step === 2) { next.textContent = 'Next: describe them'; next.disabled = !S.items.length; }
  if (S.step === 3) { next.textContent = 'Next: export'; next.disabled = false; }
  if (S.step === 4) { next.textContent = 'Copy wikitext'; next.disabled = false; }
}

function renderInlineExport() {
  const pre = $('inlineExport');
  if (!pre) return;
  pre.textContent = (S.base.src && S.items.length)
    ? exportText()
    : 'Load an image and place at least one region — the wikitext appears here.';
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Wikitext copied'); }
  catch (e) { toast('Clipboard blocked — select the text instead'); }
}

function downloadText(t, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([t], { type: 'text/plain' }));
  a.download = name || 'interactive-image.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ---------------------------------------------------------------- wiring */
function wire() {
  // source mode switch
  $('srcSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    $('srcSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    const m = b.dataset.mode;
    $('paneCommons').hidden = m !== 'commons';
    $('paneUpload').hidden = m !== 'upload';
    $('paneUrl').hidden = m !== 'url';
  });

  $('btnFetchCommons').addEventListener('click', async () => {
    const name = $('commonsName').value.trim();
    if (!name) { toast('Type a Commons file name'); return; }
    $('btnFetchCommons').disabled = true;
    try { await loadCommons(name); }
    catch (e) { toast('Commons: ' + e.message); }
    finally { $('btnFetchCommons').disabled = false; }
  });
  $('commonsName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnFetchCommons').click(); });

  $('fileBase').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const src = await fileToDataURL(f);
    const dim = await imgSize(src).catch(() => null);
    if (!dim) { toast('Could not read that image'); return; }
    const name = $('uploadName').value.trim() || f.name;
    setBase(src, name, dim.w, dim.h);
    toast(`Local image ${dim.w}×${dim.h} — upload it to Commons before exporting`);
  });
  $('uploadName').addEventListener('input', () => {
    if (S.base.src) { S.base.name = stripFilePrefix($('uploadName').value); renderAll(); }
  });

  $('btnLoadUrl').addEventListener('click', async () => {
    const url = $('urlSrc').value.trim();
    if (!url) { toast('Paste an image URL'); return; }
    try {
      const dim = await imgSize(url);
      setBase(url, $('urlName').value.trim() || url.split('/').pop(), dim.w, dim.h);
    } catch (e) { toast('Could not load that URL'); }
  });

  $('owInput').addEventListener('input', () => {
    S.base.w = Math.max(1, parseInt($('owInput').value, 10) || 0);
    renderMarkers(); schedulePreview(); validate();
  });
  $('ohInput').addEventListener('input', () => {
    S.base.h = Math.max(1, parseInt($('ohInput').value, 10) || 0);
    renderMarkers(); schedulePreview(); validate();
  });

  // globals
  const bindGlobal = (id, key, cast) => {
    $(id).addEventListener('input', () => {
      S.g[key] = cast ? cast($(id).value) : $(id).value;
      renderMarkers(); schedulePreview(); validate();
    });
  };
  bindGlobal('gTitle', 'title');
  bindGlobal('gNote', 'note');
  bindGlobal('gLayout', 'layout');
  bindGlobal('gCaptions', 'captions');
  bindGlobal('gWidth', 'width', (v) => clamp(num(v, 50), 20, 80));
  bindGlobal('gColumns', 'columns', (v) => clamp(Math.round(num(v, 3)), 1, 4));
  bindGlobal('gResolution', 'resolution', (v) => Math.max(60, num(v, 600)));
  bindGlobal('gColor', 'color', (v) => /^#[0-9a-f]{3}$|^#[0-9a-f]{6}$|^[a-z]+$/i.test(v.trim()) ? v.trim() : DEFAULT_COLOR);
  bindGlobal('gCredits', 'credits');

  // stage: click to add a marker
  $('frame').addEventListener('click', (e) => {
    if (!S.base.src) return;
    if (e.target.closest('.marker')) return;
    const r = $('frame').getBoundingClientRect();
    addItem(
      Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * S.base.w),
      Math.round(clamp((e.clientY - r.top) / r.height, 0, 1) * S.base.h)
    );
  });
  $('frame').addEventListener('mousemove', (e) => {
    if (!S.base.src) return;
    const r = $('frame').getBoundingClientRect();
    const x = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * S.base.w);
    const y = Math.round(clamp((e.clientY - r.top) / r.height, 0, 1) * S.base.h);
    const cp = $('cursorPos');
    cp.hidden = false;
    cp.textContent = `${x}, ${y}`;
  });
  $('frame').addEventListener('mouseleave', () => { $('cursorPos').hidden = true; });

  $('btnAdd').addEventListener('click', () => {
    if (!S.base.src) { toast('Load a base image first'); return; }
    addItem(Math.round(S.base.w / 2), Math.round(S.base.h / 2));
  });

  // keyboard nudge / delete
  document.addEventListener('keydown', (e) => {
    if (/^(input|textarea|select)$/i.test(e.target.tagName)) return;
    if (S.sel < 0) return;
    const it = S.items[S.sel];
    if (!it) return;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (it.x == null || it.y == null) return;
      if (e.key === 'ArrowLeft') it.x = clamp(it.x - step, 0, S.base.w);
      if (e.key === 'ArrowRight') it.x = clamp(it.x + step, 0, S.base.w);
      if (e.key === 'ArrowUp') it.y = clamp(it.y - step, 0, S.base.h);
      if (e.key === 'ArrowDown') it.y = clamp(it.y + step, 0, S.base.h);
      updateMarkerPos(S.sel); syncFormCoords(); schedulePreview(); validate();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault(); removeItem(S.sel);
    }
    if (e.key === 'Escape') closeModal();
  });

  // preview width pills
  document.querySelectorAll('[data-pw]').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-pw]').forEach((x) => x.classList.toggle('on', x === b));
      const w = b.dataset.pw;
      $('preview').style.width = w;
      $('preview').style.margin = w === '100%' ? '0' : '0 auto';
      const wrap = $('previewWrap');
      wrap.classList.toggle('box', w !== '100%');
    });
  });

  $('stepper').addEventListener('click', (e) => {
    const b = e.target.closest('.step');
    if (b) setStep(+b.dataset.step);
  });
  $('btnExpert').addEventListener('click', () => { S.expert = !S.expert; applyStep(); });
  $('sbBack').addEventListener('click', () => setStep(S.step - 1));
  $('sbNext').addEventListener('click', () => {
    if (S.step < 4) { setStep(S.step + 1); return; }
    copyText(exportText());
  });
  $('btnCopyInline').addEventListener('click', () => copyText(exportText()));
  $('btnDownloadInline').addEventListener('click', () => downloadText(exportText()));
  $('btnExport').addEventListener('click', showExport);
  $('btnImport').addEventListener('click', showImport);
  $('btnAbout').addEventListener('click', showAbout);
  $('btnSave').addEventListener('click', saveProject);
  $('btnNew').addEventListener('click', () => {
    if (!confirm('Clear the workbench? Unsaved work is lost.')) return;
    S.base = { src: '', name: '', w: 0, h: 0 };
    S.g = { title: '', note: '', layout: 'side', captions: 'legend', width: 50, columns: 3, resolution: 600, color: DEFAULT_COLOR, credits: '' };
    S.items = []; S.sel = -1;
    $('baseImg').hidden = true; $('baseImg').src = ''; $('stageEmpty').hidden = false;
    $('commonsName').value = ''; $('uploadName').value = ''; syncGlobalsToForm();
    $('owInput').value = ''; $('ohInput').value = '';
    renderAll();
    S.step = 1; S.expert = false; applyStep();
  });
  $('fileProject').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    loadProject(f).catch((err) => toast('Project: ' + err.message));
    e.target.value = '';
  });
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  // paste a Commons file name anywhere outside a field → load it
  window.addEventListener('paste', (e) => {
    if (/^(input|textarea)$/i.test(document.activeElement.tagName)) return;
    const t = (e.clipboardData || window.clipboardData).getData('text');
    if (t && /\.(svg|png|jpe?g|gif|webp)$/i.test(t.trim())) {
      $('commonsName').value = t.trim();
      $('btnFetchCommons').click();
    }
  });
}

function addItem(x, y) {
  if (S.items.length >= MAX_ITEMS) { toast('24 items is the module maximum'); return; }
  S.items.push({ name: '', label: '', text: '', link: '', layerName: '', layerSrc: '', x, y });
  S.sel = S.items.length - 1;
  renderList(); renderForm(); renderMarkers(); schedulePreview(); validate();
  if (S.step === 3) {
    const inp = $('itemForm').querySelector('[data-k="name"]');
    if (inp) inp.focus();
  }
}

/* ------------------------------------------------------------------ boot */
function boot() {
  wire();
  syncGlobalsToForm();
  renderAll();
  applyStep();
  fetch('template-styles.css')
    .then((r) => r.ok ? r.text() : Promise.reject(new Error(r.status)))
    .then((t) => { TEMPLATE_CSS = t; drawPreview(); window.__appReady = true; })
    .catch((e) => { console.warn('template CSS not loaded', e); window.__appReady = true; });
  window.__app = { S, exportText, addItem, setBase, parseWikitext, buildWidgetHTML };
}

document.addEventListener('DOMContentLoaded', boot);
})();
