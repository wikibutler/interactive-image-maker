#!/usr/bin/env node
/* End-to-end tests: the paths a person takes, driven by clicking.
 *
 *   node tools/e2e.mjs [url]        (default http://127.0.0.1:8811/)
 *
 * Runs in a real browser against a real server, because the bugs that reached
 * production were wiring bugs — a button that passed its event object as an argument,
 * a stale handler — none of which an API-level test would see.
 *
 * Checks: Load sample (button), 16 regions + 16 layers via the Commons API, preview
 * render, export shape, dialect switch, export→import round-trip, a page deep link,
 * canvas zoom, and no page errors along the way.
 */
import { launch } from './pw.mjs';

const url = process.argv[2] || 'http://127.0.0.1:8811/';
const origin = new URL(url).origin;

const fails = [];
const errors = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(label);
};

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());            // "Clear the canvas?" and friends

const waitFor = (fn, timeout = 90000, arg) => page.waitForFunction(fn, arg, { timeout });

try {
  /* ---------------------------------------------------------------- boot + sample */
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitFor(() => window.__appReady === true, 30000);
  check(true, 'app boots');

  await page.click('#btnSampleEmpty');           // the button, not window.__app
  await waitFor(() => window.__app.S.items.length === 16);
  check(true, 'Load sample button produces 16 regions');

  await waitFor(() => window.__app.S.items.every((i) => !i.layerName || i.layerSrc), 120000);
  const layers = await page.evaluate(() => window.__app.S.items.filter((i) => i.layerSrc).length);
  check(layers === 16, 'all 16 layers resolved from Commons', `${layers}/16`);

  const sample = await page.evaluate(() => ({
    step: window.__app.S.step,
    markers: document.querySelectorAll('#markerBox .marker').length,
    exportText: window.__app.exportText()
  }));
  check(sample.step === 3, 'advanced to the describe step', 'step ' + sample.step);
  check(sample.markers === 16, 'canvas shows 16 markers', String(sample.markers));

  await waitFor(() => {
    try {
      const d = document.getElementById('preview').contentDocument;
      return d && d.querySelectorAll('.irudi-int-puntua').length === 16;
    } catch (e) { return false; }
  }, 30000);
  check(true, 'preview renders 16 markers');

  check(sample.exportText.startsWith('{{Interactive image'), 'export is a template block');
  check(/original-width\s*=\s*600/.test(sample.exportText), 'export keeps the declared coordinate grid');

  /* ------------------------------------------------------------------ dialect switch */
  await page.selectOption('#selWiki', 'eu');
  await page.waitForFunction(() => window.__app.S.wiki === 'eu');
  const euHead = await page.evaluate(() => window.__app.exportText().split('\n')[0]);
  check(euHead === '{{Irudi interaktiboa', 'target wiki eu writes Basque parameter names', euHead);
  await page.selectOption('#selWiki', 'en');
  await page.waitForFunction(() => window.__app.S.wiki === 'en');

  /* ------------------------------------------------------------- export → import loop */
  const exported = await page.evaluate(() => window.__app.exportText());
  await page.click('#btnNew');
  await waitFor(() => window.__app.S.items.length === 0);
  await page.click('#btnImport');
  await page.fill('#importArea', exported);
  await page.click('#btnDoImport');
  await waitFor(() => window.__app.S.items.length === 16);
  await waitFor(() => window.__app.S.items.every((i) => !i.layerName || i.layerSrc), 120000);
  const reExported = await page.evaluate(() => window.__app.exportText());
  check(reExported === exported, 'export → import → export is byte-identical');

  /* --------------------------------------------------------------------- deep link */
  await page.goto(origin + '/?page=en:Voyager%201', { waitUntil: 'domcontentloaded' });
  await waitFor(() => window.__app && window.__app.S.sourcePage && window.__app.S.sourcePage.page);
  const src = await page.evaluate(() => window.__app.S.sourcePage);
  check(src.page === 'Voyager 1' && src.wiki === 'en', '?page=en:Voyager 1 loads that article', JSON.stringify(src));

  /* ------------------------------------------------------------------------ zooming */
  await waitFor(() => window.__app.S.items.length > 0);
  const before = await page.evaluate(() => document.getElementById('frame').getBoundingClientRect().width);
  await page.click('#zoomIn');
  await page.waitForTimeout(300);
  const zoomed = await page.evaluate(() => document.getElementById('frame').getBoundingClientRect().width);
  check(zoomed > before, 'canvas zoom in enlarges the frame', `${Math.round(before)} → ${Math.round(zoomed)}`);
  await page.click('#zoomFit');
  await page.waitForTimeout(300);
  const fitted = await page.evaluate(() => document.getElementById('frame').getBoundingClientRect().width);
  check(Math.abs(fitted - before) < 2, 'fit returns to the fitted width', String(Math.round(fitted)));

  /* ------------------------------------------------------------- interface language */
  await page.selectOption('#selLang', 'eu');
  await page.waitForFunction(() => document.documentElement.lang === 'eu');
  const h1 = await page.evaluate(() => document.getElementById('appTitle').textContent);
  check(/sortzailea/i.test(h1), 'interface language switches to Basque', h1);
} catch (e) {
  check(false, 'run completed', e.message);
} finally {
  await browser.close();
}

check(errors.length === 0, 'no page or console errors', errors.slice(0, 3).join(' | '));

if (fails.length) {
  console.log(`\n${fails.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
