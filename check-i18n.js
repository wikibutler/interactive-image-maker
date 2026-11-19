#!/usr/bin/env node
/* Checks that every language defines the same interface keys as the fallback, and
 * that every target wiki declares a complete template dialect.
 *
 *   node check-i18n.js
 *
 * Exit code 1 on any missing key, so it can gate a commit.
 */
global.window = {};
require('./i18n.js');
const I = global.window.I18N;

const fallback = I.fallback;
const baseKeys = Object.keys(I.ui[fallback]);
let problems = 0;

console.log(`fallback: ${fallback} (${baseKeys.length} UI keys)`);

Object.entries(I.ui).forEach(([code, cat]) => {
  const keys = Object.keys(cat);
  const missing = baseKeys.filter((k) => !(k in cat));
  const extra = keys.filter((k) => !baseKeys.includes(k));
  if (missing.length) {
    problems += missing.length;
    console.log(`\n✗ ${code}: ${missing.length} missing key(s)`);
    missing.forEach((k) => console.log(`    ${k}`));
  }
  if (extra.length) {
    console.log(`\n! ${code}: ${extra.length} key(s) not in ${fallback} (harmless, but check spelling)`);
    extra.forEach((k) => console.log(`    ${k}`));
  }
  if (!missing.length) console.log(`✓ ${code}: complete`);
});

const paramKeys = ['image', 'title', 'note', 'width', 'layout', 'columns', 'captions',
  'resolution', 'color', 'credits', 'style', 'ow', 'oh'];
const itemKeys = ['name', 'label', 'text', 'image', 'link', 'x', 'y'];
const valueKeys = ['side', 'top', 'legend', 'card'];

Object.entries(I.wikis).forEach(([code, w]) => {
  const miss = [];
  paramKeys.forEach((k) => { if (!w.params || !w.params[k]) miss.push(`params.${k}`); });
  itemKeys.forEach((k) => { if (!w.item || !w.item[k]) miss.push(`item.${k}`); });
  valueKeys.forEach((k) => { if (!w.values || !w.values[k]) miss.push(`values.${k}`); });
  ['template', 'articleBase', 'stylesPage', 'docPage', 'category', 'label'].forEach((k) => {
    if (!w[k]) miss.push(k);
  });
  if (!w.defaults || !w.defaults.note || !w.defaults.noteCard || !w.defaults.credits) miss.push('defaults');
  if (miss.length) {
    problems += miss.length;
    console.log(`\n✗ wiki ${code}: ${miss.length} missing field(s)`);
    miss.forEach((k) => console.log(`    ${k}`));
  } else {
    console.log(`✓ wiki ${code}: ${w.template} (${w.code}.wikipedia.org)`);
  }
});

if (problems) {
  console.log(`\n${problems} problem(s).`);
  process.exit(1);
}
console.log('\nAll languages and wikis consistent.');
