#!/usr/bin/env node
/* Smoke test: the first thing a new user clicks must work.
 *
 *   node tools/smoke.mjs [url]
 *
 * Default target is the local server (python3 app.py → http://127.0.0.1:8811); pass a
 * URL to check a deployment. It clicks "Load sample", waits for the 16 regions and
 * their 16 layer files to resolve through the Commons API, and asserts the export is
 * a real block — i.e. the whole happy path from a cold page, by clicking, not by
 * calling internals.
 *
 * Exists because a regression slipped through that way: the click handler passed the
 * MouseEvent as the sample's file name, so the button did nothing while ?sample= kept
 * working. Anything that is only reachable from a button belongs in here.
 */
import fs from 'node:fs';
import path from 'node:path';

const PW_CACHE = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/data/home/.cache/ms-playwright';
process.env.PLAYWRIGHT_BROWSERS_PATH = PW_CACHE;
const PW = process.env.PLAYWRIGHT_MODULE || '/opt/data/browser-test/node_modules/playwright';
const pw = await import(PW + '/index.js');
const chromium = pw.chromium || (pw.default && pw.default.chromium);

function chromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const builds = fs.readdirSync(PW_CACHE)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const b of builds) {
    const p = path.join(PW_CACHE, b, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
}

const url = process.argv[2] || 'http://127.0.0.1:8811/';
const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const fails = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(label);
};

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__appReady === true, { timeout: 30000 });

  // the button, not the API — this is the path a person takes
  await page.click('#btnSampleEmpty');
  await page.waitForFunction(() => window.__app.S.items.length === 16, { timeout: 90000 });
  check(true, 'Load sample button produced 16 regions');

  await page.waitForFunction(
    () => window.__app.S.items.every((i) => !i.layerName || i.layerSrc),
    { timeout: 120000 }
  );
  const layers = await page.evaluate(() => window.__app.S.items.filter((i) => i.layerSrc).length);
  check(layers === 16, 'all 16 layers resolved from Commons', `${layers}/16`);

  await page.waitForFunction(() => {
    try {
      const d = document.getElementById('preview').contentDocument;
      return d && d.querySelectorAll('.irudi-int-puntua').length === 16;
    } catch (e) { return false; }   // iframe mid-reload
  }, { timeout: 30000 }).catch(() => {});

  const info = await page.evaluate(() => ({
    step: window.__app.S.step,
    markers: document.querySelectorAll('#markerBox .marker').length,
    previewMarkers: document.getElementById('preview').contentDocument
      .querySelectorAll('.irudi-int-puntua').length,
    exportText: window.__app.exportText()
  }));
  check(info.step === 3, 'advanced to the describe step', 'step ' + info.step);
  check(info.markers === 16, 'canvas shows 16 markers', String(info.markers));
  check(info.previewMarkers === 16, 'preview renders 16 markers', String(info.previewMarkers));
  check(/original-width\s*=\s*600/.test(info.exportText),
    'export carries the declared coordinate grid', 'original-width 600');
  check(info.exportText.startsWith('{{Interactive image'), 'export is a template block');

  // a URL-scoped load must agree with the button
  await page.goto(url.split('?')[0] + '?page=en:Voyager%201', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__app && window.__app.S.sourcePage && window.__app.S.sourcePage.page,
    { timeout: 90000 }
  );
  const src = await page.evaluate(() => window.__app.S.sourcePage);
  check(src && src.page === 'Voyager 1', 'deep link ?page=en:Voyager 1 loads that article', JSON.stringify(src));
} catch (e) {
  check(false, 'run completed', e.message);
} finally {
  await browser.close();
}

if (errors.length) console.log('\npage errors:', errors.slice(0, 5));
if (fails.length) {
  console.log(`\n${fails.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
