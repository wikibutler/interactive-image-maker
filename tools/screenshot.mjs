#!/usr/bin/env node
/* Regenerate assets/tool-screenshot.png — the shot used in README.md.
 *
 *   node tools/screenshot.mjs [url] [out]
 *
 * Needs Playwright with a Chromium build. On this host:
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/data/home/.cache/ms-playwright \
 *   node tools/screenshot.mjs
 *
 * It loads the app, waits for the Voyager sample to finish resolving its 16 layers
 * (so the screenshot never shows a half-loaded canvas), lets the toast fade, and
 * writes a 2× image for a crisp README on high-density displays.
 */
import fs from 'node:fs';
import path from 'node:path';

const PW_CACHE = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/data/home/.cache/ms-playwright';
process.env.PLAYWRIGHT_BROWSERS_PATH = PW_CACHE;

const PW = process.env.PLAYWRIGHT_MODULE || '/opt/data/browser-test/node_modules/playwright';
const pw = await import(PW + '/index.js');
const chromium = pw.chromium || (pw.default && pw.default.chromium);   // CJS module
if (!chromium) throw new Error('playwright not found at ' + PW);

function chromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const builds = fs.readdirSync(PW_CACHE)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const b of builds) {
    const p = path.join(PW_CACHE, b, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

const url = process.argv[2] || 'http://127.0.0.1:8811/?sample=voyager-spacecraft';
const out = process.argv[3] || 'assets/tool-screenshot.png';

const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => window.__app && window.__app.S.items.length > 0 &&
        window.__app.S.items.every((i) => !i.layerName || i.layerSrc),
  { timeout: 90000 }
);
await page.waitForTimeout(4000);           // toast fades, preview settles, canvas refits
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out });
const { width, height } = await page.evaluate(() => ({
  width: innerWidth, height: innerHeight
}));
await browser.close();
console.log(`wrote ${out} (${width}x${height} @2x) from ${url}`);
