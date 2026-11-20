#!/usr/bin/env node
/* Static contract checks — no browser, no server, under a second.
 *
 * Catches the class of bug that a passing "does it load" test misses:
 *
 *  1. An element id used from JS that the HTML never defines (renamed button, typo).
 *  2. A translation key used in markup or code that no language defines.
 *  3. A click listener registered with a bare function reference whose signature takes
 *     parameters — the bug that broke "Load sample": the handler received the
 *     MouseEvent as its first argument. Rule: if the function wants arguments, wrap it.
 *
 * Run: node tools/check-dom.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const html = read('index.html');
const app = read('app.js');
const i18n = read('i18n.js');

const problems = [];
const fail = (msg) => problems.push(msg);

/* ---------------------------------------------------------------- 1. element ids */
const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
// ids that app.js creates at runtime, inside template strings
const jsIds = new Set([...app.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const known = new Set([...htmlIds, ...jsIds]);

const refs = new Set();
for (const m of app.matchAll(/\$\('([^']+)'\)/g)) refs.add(m[1]);
for (const m of app.matchAll(/getElementById\('([^']+)'\)/g)) refs.add(m[1]);
for (const m of app.matchAll(/querySelector(?:All)?\('#([A-Za-z0-9_-]+)/g)) refs.add(m[1]);

for (const id of refs) {
  if (!known.has(id)) fail(`JS references #${id}, which neither index.html nor app.js defines`);
}

/* ------------------------------------------------------------- 2. i18n key coverage */
const htmlKeys = new Set([
  ...[...html.matchAll(/data-i18n(?:-title)?="([^"]+)"/g)].map((m) => m[1])
]);
// only literal keys: `t('banner.' + n + '.hint')` builds its key at runtime and is
// covered by check-i18n.js instead
const codeKeys = new Set([...app.matchAll(/\bt\('([^']+)'(?=\s*[,)])/g)].map((m) => m[1]));

const catalog = {};
for (const lang of [...i18n.matchAll(/^    ([a-z]{2}): \{/gm)].map((m) => m[1])) catalog[lang] = lang;
const langs = Object.keys(catalog);
if (langs.length < 2) fail('i18n.js: fewer than two languages parsed — the checker needs updating');

for (const key of new Set([...htmlKeys, ...codeKeys])) {
  for (const lang of langs) {
    // a crude but effective "is this key present in this language block" check
    const block = i18n.split(/^    [a-z]{2}: \{/m);
    const idx = langs.indexOf(lang) + 1;
    if (block[idx] && !block[idx].includes(`'${key}'`)) {
      fail(`i18n: '${key}' used in the app but missing from ${lang}`);
    }
  }
}

/* ------------------------------------------------- 3. bare listener with parameters */
/* Handlers that legitimately receive the event object. Everything else must be
 * wrapped — this list is the whole point of the check, so add to it knowingly. */
const EVENT_HANDLERS = new Set(['onMarkerDown']);

const listeners = [...app.matchAll(/addEventListener\('(\w+)',\s*([A-Za-z_$][\w$]*)\s*\)/g)];
for (const [, event, fn] of listeners) {
  if (EVENT_HANDLERS.has(fn)) continue;
  const decl = app.match(new RegExp(`(?:async\\s+)?function\\s+${fn}\\s*\\(([^)]*)\\)`));
  if (!decl) continue;                                          // imported/built-in
  const params = decl[1].split(',').map((s) => s.trim()).filter(Boolean);
  if (params.length > 0) {
    fail(
      `app.js: addEventListener('${event}', ${fn}) passes the event object into ` +
      `${fn}(${params.join(', ')}) — wrap it: () => ${fn}()`
    );
  }
}

/* ------------------------------------------------------------------------- report */
const unique = [...new Set(problems)];
if (unique.length) {
  console.log(unique.map((p) => 'FAIL  ' + p).join('\n'));
  console.log(`\n${unique.length} problem(s)`);
  process.exit(1);
}
console.log(`ok — ${refs.size} element ids, ${new Set([...htmlKeys, ...codeKeys]).size} i18n keys, ` +
  `${listeners.length} listeners checked across ${langs.length} languages`);
