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
  expert: false,
  /* interface language and target wiki are independent: a Basque speaker may be
   * writing for en.wp, and a wiki may have a template dialect but no UI translation */
  lang: 'en',
  wiki: 'en',
  wikiAuto: true,   // until the target is chosen explicitly, it follows the interface language
  zoom: 1,          // 1 = fit; >1 scrolls the canvas
  sourcePage: null  // { page, wiki } when the block came from a wiki page
};

let TEMPLATE_CSS = '';

/* ------------------------------------------------------------------- i18n */
const I18N = window.I18N || { ui: {}, wikis: {}, languages: ['en'], fallback: 'en' };
const LS_LANG = 'wb.lang';
const LS_WIKI = 'wb.wiki';

function t(key, vars) {
  const cat = I18N.ui[S.lang] || {};
  let s = cat[key];
  if (s == null) s = (I18N.ui[I18N.fallback] || {})[key];
  if (s == null) return key;
  if (vars) Object.keys(vars).forEach((k) => { s = s.split('{' + k + '}').join(String(vars[k])); });
  return s;
}

/* the template dialect of the wiki we are authoring for */
function W() { return I18N.wikis[S.wiki] || I18N.wikis[I18N.fallback]; }
function wikiBase() { return (W() && W().articleBase) || 'https://en.wikipedia.org/wiki/'; }
function pageUrl(page) { return wikiBase() + encodeURI(String(page || '').replace(/ /g, '_')); }

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
  const base = wikiBase();
  t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (m, a, b) =>
    `<a href="${base}${encodeURI(a.trim().replace(/ /g, '_'))}">${b}</a>`);
  t = t.replace(/\[\[([^\]]+)\]\]/g, (m, a) =>
    `<a href="${base}${encodeURI(a.trim().replace(/ /g, '_'))}">${a}</a>`);
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
    ? `<a href="${wikiBase()}${encodeURI(String(it.link).trim().replace(/ /g, '_'))}">${esc(it.name)}</a>`
    : esc(it.name || '');

  const out = [];
  out.push('<div class="irudi-int">');
  if (g.title) out.push(`<div class="irudi-int-izenburua">${renderWikitext(g.title)}</div>`);
  // the module supplies the default note; each wiki phrases it in its own language
  const note = g.note || (g.captions === 'card' ? W().defaults.noteCard : W().defaults.note);
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
      `<span class="irudi-int-kredituak-testua"><a href="${target}">${esc(g.credits || W().defaults.credits)}</a></span></span></div>`);
  }
  out.push('</div>');
  return out.join('\n');
}

/* Fit the canvas to the stage box: the frame is sized to the image's own aspect
 * ratio, so marker percentages still map onto the picture at any window size. */
function fitCanvas() {
  const stage = document.querySelector('.stage');
  const frame = $('frame');
  const img = $('baseImg');
  if (!stage || !frame || !img) return;
  if (!S.base.src || !img.naturalWidth || !img.naturalHeight) { frame.style.maxWidth = ''; return; }
  const cs = getComputedStyle(stage);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const availW = Math.max(120, stage.clientWidth - padX);
  const availH = Math.max(120, stage.clientHeight - padY);
  const ar = img.naturalWidth / img.naturalHeight;
  // fit the box, but never shrink the canvas below a workable width — a very tall
  // image then scrolls inside the stage rather than becoming a postage stamp
  const fitted = Math.min(availW, Math.max(Math.floor(availH * ar), Math.min(240, availW)));
  const w = Math.min(6000, Math.round(fitted * (S.zoom || 1)));
  frame.style.maxWidth = w + 'px';
  const lbl = $('zoomLabel');
  if (lbl) lbl.textContent = Math.abs((S.zoom || 1) - 1) < 0.02 ? t('zoom.fit') : Math.round((S.zoom || 1) * 100) + '%';
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
    fitCanvas();   // the stage's share can shift once the preview has a height
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
    c.innerHTML = `<span class="n">${esc(it.label || (i + 1))}</span><span class="t">${esc(it.name || t('items.unnamed'))}</span>`;
    c.addEventListener('click', () => selectItem(i));
    const x = document.createElement('button');
    x.className = 'x'; x.textContent = '×'; x.title = t('form.delete');
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
  const it = S.items[S.sel];
  if (S.sel < 0 || !it) {
    host.innerHTML = `<div class="empty-note">${t('form.noSelection')}</div>`;
    return;
  }
  const wiz = S.step === 3 && !S.expert;
  const k = W().item;   // field names follow the target wiki's dialect
  const head = wiz
    ? `<div class="wizhead"><span class="wz">${t('banner.3.count', { i: S.sel + 1, n: S.items.length })}</span>
        <span class="nav">
          <button id="wzPrev" title="${t('form.prevRegion')}" ${S.sel === 0 ? 'disabled' : ''}>‹</button>
          <button id="wzNext" title="${t('form.nextRegion')}" ${S.sel === S.items.length - 1 ? 'disabled' : ''}>›</button>
        </span></div>`
    : '<div class="divider"></div>';
  host.innerHTML = `
    ${head}
    <label class="f"><span>N-${k.name} <em style="font-style:normal;color:#bf3e33">${t('form.required')}</em></span>
      <input type="text" data-k="name" value="${esc(it.name)}" placeholder="Skull"></label>
    <div class="row">
      <label class="f"><span>N-${k.label} ${t('form.labelSuffix')}</span><input type="text" data-k="label" value="${esc(it.label)}" placeholder="${S.sel + 1}"></label>
      <label class="f"><span>N-${k.link} ${t('form.linkSuffix')}</span><input type="text" data-k="link" value="${esc(it.link)}" placeholder="Skull"></label>
    </div>
    <label class="f"><span>N-${k.text}</span>
      <textarea data-k="text" placeholder="${t('form.textPlaceholder')}">${esc(it.text)}</textarea></label>
    <label class="f"><span>N-${k.image} — ${t('form.layer')}</span>
      <input type="text" data-k="layerName" value="${esc(it.layerName)}" placeholder="Base - skull.svg" spellcheck="false"></label>
    <div class="row">
      <label class="f"><span>N-${k.x}</span><input type="number" data-k="x" value="${it.x != null ? Math.round(it.x) : ''}" step="1"></label>
      <label class="f"><span>N-${k.y}</span><input type="number" data-k="y" value="${it.y != null ? Math.round(it.y) : ''}" step="1"></label>
    </div>
    <div class="row">
      <button class="btn" id="btnLayerFile" style="flex:1">${t('form.attachLocal')}</button>
      <button class="btn" id="btnFetchLayer" style="flex:1">${t('form.fetchCommons')}</button>
    </div>
    <input type="file" id="fileLayer" accept="image/*" hidden>
    <p class="hintline" style="margin-top:8px">${t('form.layerHint')}</p>
    <button class="btn" id="btnDelete" style="width:100%;color:var(--err)">${t('form.delete')}</button>
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
    renderForm(); schedulePreview(); validate(); toast(t('toast.layerAttached'));
  });
  $('btnFetchLayer').addEventListener('click', async () => {
    const name = ($('itemForm').querySelector('[data-k="layerName"]').value || '').trim();
    if (!name) { toast(t('toast.needLayerName')); return; }
    try {
      const f = await commonsFile(name);
      const it = S.items[S.sel];
      it.layerName = f.name; it.layerSrc = f.src; it.layerW = f.w; it.layerH = f.h;
      renderForm(); schedulePreview(); validate(); toast(t('toast.layerLoaded', { w: f.w, h: f.h }));
    } catch (err) { toast(t('toast.layerFail', { msg: err.message })); }
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

  const P = W().params;
  if (!S.base.src) push('err', t('check.noImage'));
  else if (!imageName()) push('warn', t('check.noName', { p: P.image }));
  if (!S.base.w || !S.base.h) push('err', t('check.noUnits', { ow: P.ow, oh: P.oh }));
  if (S.base.fileW && S.base.w && Math.abs((S.base.fileW / S.base.fileH) - (S.base.w / S.base.h)) > 0.02)
    push('warn', t('check.aspect', { fw: S.base.fileW, fh: S.base.fileH, ow: S.base.w, oh: S.base.h }));
  if (!S.items.length) push('err', t('check.noItems'));
  if (S.items.length > MAX_ITEMS) push('err', t('check.tooMany', { n: S.items.length, max: MAX_ITEMS }));

  S.items.forEach((it, i) => {
    const n = i + 1;
    if (!String(it.name || '').trim()) push('err', t('check.itemNoName', { n }));
    if (it.x == null || it.y == null) push('warn', t('check.itemNoCoords', { n }));
    else if (it.x < 0 || it.x > S.base.w || it.y < 0 || it.y > S.base.h)
      push('warn', t('check.itemOutside', { n, x: Math.round(it.x), y: Math.round(it.y) }));
    if (!it.layerSrc) push('warn', t('check.itemNoLayer', { n }));
    // compare canvas *shapes*: a layer at 2× the base still aligns when stretched,
    // but a different aspect ratio shifts it. Use the files' own sizes, not the
    // declared coordinate grid, which may legitimately differ from either.
    const bw = S.base.fileW || S.base.w, bh = S.base.fileH || S.base.h;
    if (it.layerW && it.layerH && bw && bh && Math.abs((it.layerW / it.layerH) - (bw / bh)) > 0.01)
      push('warn', t('check.layerSize', { n, lw: it.layerW, lh: it.layerH, w: bw, h: bh }));
    if (it.layerSrc && !String(it.layerName || '').trim())
      push('warn', t('check.layerLocal', { n }));
    if (S.g.captions === 'card' && it.text && (it.x == null || it.y == null))
      push('warn', t('check.cardNoCoords', { n }));
  });

  if (!out.some((c) => c.level === 'err') && !out.some((c) => c.level === 'warn'))
    push('ok', t('check.allGood'));
  else if (!out.some((c) => c.level === 'err'))
    push('ok', t('check.noBlocking'));

  ul.innerHTML = out.map((c) => `<li class="${c.level}">${c.text}</li>`).join('');
  renderInlineExport();
  return out;
}

/* --------------------------------------------------------------- export */
function exportText() {
  const g = S.g;
  const P = W().params;     // parameter names of the target wiki
  const K = W().item;
  const V = W().values;
  const rows = [];
  const add = (k, v) => rows.push([k, v]);

  if (imageName()) add(P.image, imageName());
  if (g.title) add(P.title, g.title);
  if (g.note) add(P.note, g.note);
  if (g.layout === 'top') {
    add(P.layout, V.top);
    add(P.columns, clamp(Math.round(num(g.columns, 3)), 1, 4));
  } else if (Math.round(num(g.width, 50)) !== 50) {
    add(P.width, clamp(Math.round(num(g.width, 50)), 20, 80));
  }
  if (g.captions === 'card') add(P.captions, V.card);
  add(P.resolution, Math.max(60, Math.round(num(g.resolution, 600))));
  add(P.ow, S.base.w);
  add(P.oh, S.base.h);
  if (g.color && g.color.toLowerCase() !== DEFAULT_COLOR) add(P.color, g.color);
  if (g.credits) add(P.credits, g.credits);

  S.items.forEach((it, i) => {
    const n = i + 1;
    add(`${n}-${K.name}`, it.name || '');
    if (it.label) add(`${n}-${K.label}`, it.label);
    if (it.text) {
      const multi = /\n/.test(it.text) || /^[*#:;]/.test(it.text.trim());
      add(`${n}-${K.text}`, multi ? '\n' + it.text : it.text);
    }
    if (it.layerName) add(`${n}-${K.image}`, stripFilePrefix(it.layerName));
    if (it.link) add(`${n}-${K.link}`, it.link);
    if (it.x != null) add(`${n}-${K.x}`, Math.round(it.x));
    if (it.y != null) add(`${n}-${K.y}`, Math.round(it.y));
  });

  // Basque keys are longer than "original-height", so size the column to the widest key
  const width = Math.max(15, ...rows.map(([k]) => String(k).length));
  const body = rows.map(([k, v]) => `|${String(k).padEnd(width)} = ${v}`);
  return ['{{' + W().template, ...body, '}}'].join('\n');
}

/* ------------------------------------------------------------ commons UI */
async function loadCommons(name) {
  const f = await commonsFile(name);
  setBase(f.src, f.name, f.w, f.h);
  toast(t('toast.loaded', { name: f.name, w: f.w, h: f.h }));
}

function updateStatus() {
  $('statusline').textContent = S.base.src
    ? t('app.status', { name: S.base.name || 'local file', w: S.base.w, h: S.base.h, n: S.items.length })
    : t('app.idle');
}

function setBase(src, name, w, h, opts) {
  // keepUnits: an imported block declares its own coordinate grid (original-width/height);
  // the file's intrinsic size must not overwrite it, or every marker shifts.
  const keep = opts && opts.keepUnits;
  S.base = {
    src,
    name: stripFilePrefix(name),
    w: keep && S.base.w ? S.base.w : Math.round(w),
    h: keep && S.base.h ? S.base.h : Math.round(h),
    fileW: Math.round(w),
    fileH: Math.round(h)
  };
  const img = $('baseImg');
  img.onload = () => { fitCanvas(); requestAnimationFrame(fitCanvas); };
  img.src = src; img.hidden = false;
  fitCanvas();
  $('stageEmpty').hidden = true;
  $('owInput').value = S.base.w;
  $('ohInput').value = S.base.h;
  renderAll();
  if (!S.expert && S.step === 1) setStep(2, { silent: true });
  setTimeout(fitCanvas, 250);   // fonts/preview settle a tick later
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
  const data = { v: 1, saved: new Date().toISOString(), wiki: S.wiki, lang: S.lang, base: S.base, g: S.g, items: S.items };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (S.base.name ? S.base.name.replace(/\.[a-z0-9]+$/i, '') : 'interactive-image') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast(t('toast.saved'));
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
    if (d.wiki && I18N.wikis[d.wiki]) S.wiki = d.wiki;
    syncGlobalsToForm();
    applyLang();
    if (!S.expert) setStep(S.items.length ? 3 : 2, { silent: true });
    toast(t('toast.projectLoaded'));
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
/* every dialect collapses to one canonical key set, so a block written for any
 * wiki can be opened here and re-emitted for any other */
function dialectTables() {
  const param = {}, suffix = {};
  const layout = { side: 'side', top: 'top' };
  const captions = { legend: 'legend', card: 'card' };
  Object.values(I18N.wikis).forEach((w) => {
    Object.entries(w.params || {}).forEach(([k, v]) => { param[v] = k; param[k] = k; });
    Object.entries(w.item || {}).forEach(([k, v]) => { suffix[v] = k; suffix[k] = k; });
    Object.entries(w.values || {}).forEach(([k, v]) => {
      if (k === 'side' || k === 'top') layout[v] = k;
      if (k === 'legend' || k === 'card') captions[v] = k;
    });
  });
  return { param, suffix, layout, captions };
}

/* Find the first template invocation in a larger text (a whole page, say) by
 * counting braces — a regex cannot do this reliably when the block nests templates. */
function extractBlock(rawText) {
  const text = String(rawText).replace(/<!--[\s\S]*?-->/g, '');   // ignore commented-out templates
  const names = Object.values(I18N.wikis).map((w) => w.template).filter(Boolean);
  const re = new RegExp('\\{\\{\\s*(?:' + names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i');
  const m = re.exec(text);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index; i < text.length - 1; i += 1) {
    if (text[i] === '{' && text[i + 1] === '{') { depth += 1; i += 1; continue; }
    if (text[i] === '}' && text[i + 1] === '}') { depth -= 1; i += 1; if (depth === 0) return text.slice(m.index, i + 1); }
  }
  return null;
}

function parseWikitext(txt) {
  const extracted = extractBlock(txt);
  if (extracted) txt = extracted;
  const names = Object.values(I18N.wikis).map((w) => w.template).filter(Boolean);
  const NAME = '(?:' + names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
  const m = txt.match(new RegExp('\\{\\{\\s*(' + NAME + ')\\b([\\s\\S]*?)\\}\\}\\s*$', 'i'))
         || txt.match(new RegExp('\\{\\{\\s*(' + NAME + ')\\b([\\s\\S]*)\\}\\}', 'i'));
  if (!m) throw new Error(t('import.fail'));
  // the block names its wiki: follow it, so an imported eu.wp block exports as eu.wp
  const found = names.find((n) => n.toLowerCase() === String(m[1]).toLowerCase());
  const code = Object.keys(I18N.wikis).find((c) => (I18N.wikis[c].template || '').toLowerCase() === (found || '').toLowerCase());
  if (code) S.wiki = code;
  const body = m[2];
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
  const T = dialectTables();
  const FIELD = { name: 'name', label: 'label', text: 'text', image: 'layerName', link: 'link', x: 'x', y: 'y' };
  Object.entries(params).forEach(([rawK, v]) => {
    const k = T.param[rawK] || rawK;
    const im = k.match(/^(\d+)-(.+)$/);
    if (im) {
      const n = +im[1], f = T.suffix[im[2]] || im[2];
      const key = FIELD[f];
      if (!key) return;
      const it = items[n - 1] || (items[n - 1] = { name: '', label: '', text: '', link: '', layerName: '', layerSrc: '', x: null, y: null });
      if (key === 'x' || key === 'y') it[key] = parseFloat(v);
      else it[key] = v;
      return;
    }
    if (k === 'ow') { S.base.w = parseInt(v, 10) || S.base.w; return; }
    if (k === 'oh') { S.base.h = parseInt(v, 10) || S.base.h; return; }
    if (k === 'image') { S.base.name = stripFilePrefix(v); return; }
    if (k === 'width' || k === 'columns' || k === 'resolution') { g[k] = parseFloat(v); return; }
    if (k === 'captions') { g.captions = T.captions[v] || 'legend'; return; }
    if (k === 'layout') { g.layout = T.layout[v] || 'side'; return; }
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
      <h3 style="margin:0">${t('export.title')}</h3>
      <button class="btn close" data-close>${t('btn.close')}</button>
    </div>
    ${errs.length ? `<p style="color:#8a2b22">${t('export.blocking', { n: errs.length })}: ${errs.map((e) => e.text.replace(/<[^>]+>/g, '')).join('; ')}</p>` : ''}
    <pre id="exportPre">${esc(txt)}</pre>
    <div class="modalbar">
      <button class="btn primary" id="btnCopy">${t('export.copy')}</button>
      <button class="btn" id="btnDownload">${t('export.download')}</button>
    </div>
    <p>${t('export.note', { cat: W().category })}</p>
  `);
  $('btnCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(txt); toast(t('toast.copied')); }
    catch (e) { toast(t('toast.clipboard')); }
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
      <h3 style="margin:0">${t('import.title')}</h3>
      <button class="btn close" data-close>${t('btn.close')}</button>
    </div>
    <p>${t('import.body')}</p>
    <textarea id="importArea" placeholder="${esc('{{' + W().template + '\n|' + W().params.image + '=A.svg\n|' + W().params.ow + '=1000\n…}}')}"></textarea>
    <div class="modalbar" style="margin-top:10px">
      <button class="btn primary" id="btnDoImport">${t('import.button')}</button>
      <span class="hint" style="color:#72777d;font-size:12px">${t('import.note')}</span>
    </div>
  `);
  $('btnDoImport').addEventListener('click', async () => {
    const txt = $('importArea').value;
    closeModal();
    try {
      const n = await applyBlock(txt);
      toast(t('import.ok', { n }));
    } catch (e) { toast(e.message); }
  });
}

/* ------------------------------------------------------------- load a block */
/* Shared by "Import wikitext" and "Load sample": parse, then resolve the base
 * image and every layer from Commons so the preview and checks are honest. */
async function applyBlock(text, opts) {
  S.sourcePage = null;
  parseWikitext(text);
  syncGlobalsToForm();
  $('owInput').value = S.base.w || '';
  $('ohInput').value = S.base.h || '';
  applyLang();                       // the block may have retargeted the wiki

  if (S.base.name) {
    try {
      const f = await commonsFile(S.base.name);
      setBase(f.src, f.name, f.w, f.h, { keepUnits: true });
    } catch (e) { toast(t('toast.baseFail', { msg: e.message })); }
  }

  const pending = S.items.filter((it) => it.layerName);
  let done = 0;
  for (const it of pending) {
    try {
      const f = await commonsFile(it.layerName);
      it.layerSrc = f.src; it.layerW = f.w; it.layerH = f.h;
    } catch (e) { /* leave unresolved — the checks report it */ }
    done += 1;
    if (opts && opts.progress && pending.length > 3) toast(t('toast.sampleProgress', { done, total: pending.length }));
  }

  applyLang();
  if (!S.expert && S.items.length) setStep(3, { silent: true });
  return S.items.length;
}

/* a real block from en.wikipedia "Voyager 1" — 16 regions, 16 Commons layers */
const SAMPLE_FILE = 'demo/voyager-spacecraft.txt';

async function loadSample(file) {
  const path = !file ? SAMPLE_FILE : (file.indexOf('/') >= 0 ? file : 'demo/' + file + '.txt');
  if ((S.items.length || S.base.src) && !confirm(t('toast.sampleConfirm'))) return;
  try {
    toast(t('toast.sampleLoading'));
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const n = await applyBlock(await r.text(), { progress: true });
    toast(t('toast.sampleLoaded', { n }));
  } catch (e) { toast(t('toast.sampleFail', { msg: e.message })); }
}

function showAbout() {
  const P = W().params;
  const vars = { ow: P.ow, oh: P.oh, example: P.image + '= · ' + P.title + '=' };
  openModal(`
    <div class="modalbar">
      <h3 style="margin:0">${t('about.title')}</h3>
      <button class="btn close" data-close>${t('btn.close')}</button>
    </div>
    <p>${t('about.intro')}</p>
    <p>${t('about.flow')}</p>
    ${t('about.how')}
    ${t('about.decides', vars)}
    ${t('about.not')}
    <p style="margin-top:14px">${t('about.footer')}</p>
    <p><a href="${pageUrl(W().docPage)}" target="_blank" rel="noopener">${W().docPage}</a> ·
       <a href="${pageUrl(W().stylesPage)}" target="_blank" rel="noopener">${W().stylesPage}</a></p>
  `);
}

/* ------------------------------------------------------------ step flow */

function setStep(n, opts) {
  const from = S.step;
  n = clamp(Math.round(n), 1, 4);
  if (n >= 2 && !S.base.src) { toast(t('toast.needImage')); n = 1; }
  if (n >= 3 && !S.items.length) { toast(t('toast.needRegion')); n = 2; }
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
  if (mode) mode.textContent = S.expert ? t('btn.guided') : t('btn.expert');
  requestAnimationFrame(fitCanvas);   // the stage changes size between steps
  renderBanner(); renderForm(); renderInlineExport();
}

function renderBanner() {
  const n = S.step;
  let hint = t('banner.' + n + '.hint');
  if (n === 3) hint = t('banner.3.count', { i: Math.max(1, S.sel + 1), n: S.items.length }) + ' ' + hint;
  if (n === 2) hint += ' ' + t('banner.2.count', { n: S.items.length, max: MAX_ITEMS });
  const title = $('sbTitle');
  if (!title) return;
  title.textContent = t('banner.' + n + '.title');
  $('sbHint').textContent = S.expert ? t('banner.expert') : hint;
  const back = $('sbBack'), next = $('sbNext');
  back.textContent = t('banner.back');
  back.disabled = n === 1;
  next.textContent = t('banner.next' + n);
  next.disabled = (n === 1 && !S.base.src) || (n === 2 && !S.items.length);
}

function renderInlineExport() {
  const pre = $('inlineExport');
  if (!pre) return;
  pre.textContent = (S.base.src && S.items.length) ? exportText() : t('export.empty');
}

async function copyText(body, msgKey) {
  try { await navigator.clipboard.writeText(body); toast(t(msgKey || 'toast.copied')); }
  catch (e) { toast(t('toast.clipboard')); }
}

function downloadText(t, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([t], { type: 'text/plain' }));
  a.download = name || 'interactive-image.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* --------------------------------------------------- load a template from a wiki */
async function loadFromPage(page, wiki) {
  const code = I18N.wikis[wiki] ? wiki : S.wiki;
  toast(t('toast.pageLoad', { page }));
  try {
    const api = `https://${code}.wikipedia.org/w/api.php?` + new URLSearchParams({
      action: 'parse', page, prop: 'wikitext', format: 'json', formatversion: '2',
      redirects: '1', origin: '*'
    });
    const r = await fetch(api);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error.info || j.error.code);
    const block = extractBlock(j.parse.wikitext);
    if (!block) { toast(t('toast.noBlock', { page })); return; }
    S.wiki = code;
    S.wikiAuto = false;
    const n = await applyBlock(block);
    S.sourcePage = { page: j.parse.title, wiki: code };
    toast(t('toast.pageLoaded', { page: j.parse.title }));
    return n;
  } catch (e) {
    toast(t('toast.pageFail', { page, msg: e.message }));
  }
}

/* A URL that reopens exactly this state: the page it came from when we know it,
 * otherwise the wikitext itself. */
function deepLink() {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  if (S.sourcePage) {
    u.searchParams.set('page', S.sourcePage.page);
    if (S.sourcePage.wiki && S.sourcePage.wiki !== 'en') u.searchParams.set('wiki', S.sourcePage.wiki);
  } else if (S.base.src && S.items.length) {
    u.searchParams.set('wikitext', exportText());
    if (S.wiki !== 'en') u.searchParams.set('wiki', S.wiki);
  }
  if (S.lang !== 'en') u.searchParams.set('lang', S.lang);
  return u.toString();
}

/* ?page=  ?wikitext=  ?sample=  ?file=  ?lang=  ?wiki= */
async function handleUrlParams() {
  const q = new URLSearchParams(location.search);
  const lang = q.get('lang');
  const wiki = q.get('wiki');
  let touched = false;
  if (lang && I18N.ui[lang]) { S.lang = lang; touched = true; }
  if (wiki && I18N.wikis[wiki]) { S.wiki = wiki; S.wikiAuto = false; touched = true; }
  if (touched) applyLang();

  const wt = q.get('wikitext');
  const page = q.get('page');
  const sample = q.get('sample');
  const file = q.get('file');
  try {
    if (wt) await applyBlock(wt);
    else if (page) await loadFromPage(page, wiki || S.wiki);
    else if (sample) await loadSample(sample);
    else if (file) await loadCommons(file);
  } catch (e) { toast(e.message); }

  // ?target= pins the export dialect after loading (a block normally sets it itself)
  const target = q.get('target');
  if (target && I18N.wikis[target]) {
    S.wiki = target;
    S.wikiAuto = false;
    applyLang();
  }
}

/* ------------------------------------------------------- interface language */
function buildLangSelectors() {
  const ls = $('selLang'), lw = $('selWiki');
  ls.innerHTML = I18N.languages
    .map((c) => `<option value="${c}">${esc((I18N.ui[c] || {}).langName || c)}</option>`).join('');
  lw.innerHTML = Object.keys(I18N.wikis)
    .map((c) => `<option value="${c}">${esc(I18N.wikis[c].label || c)}</option>`).join('');
  ls.value = S.lang;
  lw.value = S.wiki;
}

/* Re-render every string and every dialect-dependent label. Called on boot and
 * whenever either selector changes — the two are independent on purpose. */
function applyLang() {
  document.documentElement.lang = S.lang;
  document.title = `${t('app.title')} — {{${W().template}}}`;
  $('appTitle').textContent = t('app.title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.innerHTML = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });

  // the target wiki decides parameter names, not the interface language
  $('lblOw').textContent = W().params.ow;
  $('lblOh').textContent = W().params.oh;
  $('gNote').placeholder = W().defaults.note;
  $('gCredits').placeholder = W().defaults.credits;
  $('exportNote').innerHTML = t('export.note', { cat: W().category });
  $('footStyles').href = pageUrl(W().stylesPage);
  $('footStyles').textContent = W().stylesPage;
  $('footDoc').href = pageUrl(W().docPage);
  $('footDoc').textContent = W().docPage;

  $('selLang').value = S.lang;
  $('selWiki').value = S.wiki;
  const tout = $('btnPreviewToggle');
  if (tout) tout.textContent = document.body.classList.contains('hidepreview') ? t('preview.show') : t('preview.hide');
  const mx = $('btnPreviewMax');
  if (mx) mx.textContent = document.body.classList.contains('maxpreview') ? t('preview.collapse') : t('preview.expand');
  renderAll();
  applyStep();
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
    if (!name) { toast(t('toast.needCommonsName')); return; }
    $('btnFetchCommons').disabled = true;
    try { await loadCommons(name); }
    catch (e) { toast(t('toast.commonsFail', { msg: e.message })); }
    finally { $('btnFetchCommons').disabled = false; }
  });
  $('commonsName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnFetchCommons').click(); });

  $('fileBase').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const src = await fileToDataURL(f);
    const dim = await imgSize(src).catch(() => null);
    if (!dim) { toast(t('toast.badImage')); return; }
    const name = $('uploadName').value.trim() || f.name;
    setBase(src, name, dim.w, dim.h);
    toast(t('toast.localImage', { w: dim.w, h: dim.h }));
  });
  $('uploadName').addEventListener('input', () => {
    if (S.base.src) { S.base.name = stripFilePrefix($('uploadName').value); renderAll(); }
  });

  $('btnLoadUrl').addEventListener('click', async () => {
    const url = $('urlSrc').value.trim();
    if (!url) { toast(t('toast.needUrl')); return; }
    try {
      const dim = await imgSize(url);
      setBase(url, $('urlName').value.trim() || url.split('/').pop(), dim.w, dim.h);
    } catch (e) { toast(t('toast.badUrl')); }
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
    if (!S.base.src) { toast(t('toast.needImage')); return; }
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

  $('selLang').addEventListener('change', (e) => {
    S.lang = e.target.value;
    // a Basque speaker writing for eu.wp should not have to pick the wiki twice
    if (S.wikiAuto && I18N.wikis[S.lang]) S.wiki = S.lang;
    try { localStorage.setItem(LS_LANG, S.lang); } catch (_) { /* private mode */ }
    applyLang();
  });
  $('selWiki').addEventListener('change', (e) => {
    S.wiki = e.target.value;
    S.wikiAuto = false;
    try { localStorage.setItem(LS_WIKI, S.wiki); } catch (_) { /* private mode */ }
    applyLang();
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
  const setZoom = (z) => { S.zoom = clamp(z, 0.4, 4); fitCanvas(); };
  $('zoomIn').addEventListener('click', () => setZoom((S.zoom || 1) * 1.25));
  $('zoomOut').addEventListener('click', () => setZoom((S.zoom || 1) / 1.25));
  $('zoomFit').addEventListener('click', () => setZoom(1));

  // drag the bar between canvas and preview
  const split = $('splitter');
  let splitState = null;
  split.addEventListener('pointerdown', (e) => {
    const stage = document.querySelector('.stage');
    splitState = { y: e.clientY, h: stage.getBoundingClientRect().height };
    split.classList.add('dragging');
    try { split.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
    e.preventDefault();
  });
  split.addEventListener('pointermove', (e) => {
    if (!splitState) return;
    const stage = document.querySelector('.stage');
    const wrap = document.querySelector('.workbench');
    const max = wrap.clientHeight - 220;
    const h = clamp(splitState.h + (e.clientY - splitState.y), 240, Math.max(260, max));
    stage.style.flex = `0 0 ${Math.round(h)}px`;
    $('previewWrap').style.flex = '1 1 auto';
    try { localStorage.setItem('wb.split', String(Math.round(h))); } catch (_) { /* private mode */ }
    fitCanvas();
  });
  split.addEventListener('pointerup', () => { splitState = null; split.classList.remove('dragging'); fitCanvas(); });

  $('btnPreviewMax').addEventListener('click', () => {
    const on = document.body.classList.toggle('maxpreview');
    $('btnPreviewMax').textContent = on ? t('preview.collapse') : t('preview.expand');
    requestAnimationFrame(fitCanvas);
  });

  $('btnPreviewToggle').addEventListener('click', () => {
    const hidden = document.body.classList.toggle('hidepreview');
    try { localStorage.setItem('wb.hidepreview', hidden ? '1' : '0'); } catch (_) { /* private mode */ }
    $('btnPreviewToggle').textContent = hidden ? t('preview.show') : t('preview.hide');
    requestAnimationFrame(fitCanvas);
  });
  $('btnCopyInline').addEventListener('click', () => copyText(exportText()));
  $('btnDownloadInline').addEventListener('click', () => downloadText(exportText()));
  $('btnExport').addEventListener('click', showExport);
  $('btnImport').addEventListener('click', showImport);
  $('btnSample').addEventListener('click', loadSample);
  $('btnSampleEmpty').addEventListener('click', loadSample);
  $('btnAbout').addEventListener('click', showAbout);
  $('btnSave').addEventListener('click', saveProject);
  $('btnLink').addEventListener('click', () => copyText(deepLink(), 'toast.linkCopied'));
  $('btnNew').addEventListener('click', () => {
    if (!confirm(t('toast.newConfirm'))) return;
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
    loadProject(f).catch((err) => toast(t('toast.projectFail', { msg: err.message })));
    e.target.value = '';
  });
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  // paste a Commons file name anywhere outside a field → load it
  window.addEventListener('paste', (e) => {
    if (/^(input|textarea)$/i.test(document.activeElement.tagName)) return;
    const clip = (e.clipboardData || window.clipboardData).getData('text');
    if (clip && /\.(svg|png|jpe?g|gif|webp)$/i.test(clip.trim())) {
      $('commonsName').value = clip.trim();
      $('btnFetchCommons').click();
    }
  });
}

function addItem(x, y) {
  if (S.items.length >= MAX_ITEMS) { toast(t('toast.maxItems', { max: MAX_ITEMS })); return; }
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
  // interface language: saved choice, else the browser's language if we ship it
  try {
    const savedLang = localStorage.getItem(LS_LANG);
    const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    S.lang = (savedLang && I18N.ui[savedLang]) ? savedLang : (I18N.ui[nav] ? nav : I18N.fallback);
    const savedWiki = localStorage.getItem(LS_WIKI);
    S.wikiAuto = !(savedWiki && I18N.wikis[savedWiki]);
    S.wiki = S.wikiAuto ? (I18N.wikis[S.lang] ? S.lang : I18N.fallback) : savedWiki;
  } catch (_) { /* storage blocked — the defaults stand */ }

  try {
    if (localStorage.getItem('wb.hidepreview') === '1') document.body.classList.add('hidepreview');
    const sp = parseInt(localStorage.getItem('wb.split'), 10);
    if (sp > 200) document.querySelector('.stage').style.flex = `0 0 ${sp}px`;
  } catch (_) { /* private mode */ }
  wire();
  buildLangSelectors();
  if (window.ResizeObserver) {
    const stage = document.querySelector('.stage');
    if (stage) new ResizeObserver(() => fitCanvas()).observe(stage);
  }
  window.addEventListener('resize', () => {
    clearTimeout(fitCanvas._t);
    fitCanvas._t = setTimeout(fitCanvas, 120);
  });
  syncGlobalsToForm();
  applyLang();

  handleUrlParams().catch((e) => toast(e.message));

  fetch('template-styles.css')
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
    .then((css) => { TEMPLATE_CSS = css; drawPreview(); window.__appReady = true; })
    .catch((e) => { console.warn('template CSS not loaded', e); window.__appReady = true; });
  window.__app = { S, t, W, I18N, applyLang, exportText, addItem, setBase, parseWikitext, buildWidgetHTML, applyBlock, loadSample, loadFromPage, deepLink, handleUrlParams, fitCanvas };
}

document.addEventListener('DOMContentLoaded', boot);
})();
