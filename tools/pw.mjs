/* Shared Playwright launcher.
 *
 * Two environments matter: this host, where Playwright lives outside the repo and the
 * Chromium build is in the ms-playwright cache, and CI, where `npm install` puts
 * Playwright in node_modules and the browser is installed by `npx playwright install`.
 * Try the bundled browser first, fall back to the cached one.
 */
import fs from 'node:fs';

// Prefer this host's known-good browser cache over any inherited env value (the runtime
// exports a different PLAYWRIGHT_BROWSERS_PATH that holds an unrelated build). In CI
// neither exists, so leave the variable alone and let Playwright use its own install.
const LOCAL_CACHE = '/opt/data/home/.cache/ms-playwright';
const CACHE = fs.existsSync(LOCAL_CACHE)
  ? LOCAL_CACHE
  : (process.env.PLAYWRIGHT_BROWSERS_PATH || LOCAL_CACHE);
if (fs.existsSync(CACHE)) process.env.PLAYWRIGHT_BROWSERS_PATH = CACHE;
else delete process.env.PLAYWRIGHT_BROWSERS_PATH;

const CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  'playwright',
  '/opt/data/browser-test/node_modules/playwright'
].filter(Boolean);

export async function loadChromium() {
  for (const c of CANDIDATES) {
    try {
      const m = await import(c.startsWith('/') ? c + '/index.js' : c);
      const chromium = m.chromium || (m.default && m.default.chromium);
      if (chromium) return chromium;
    } catch (e) { /* try the next candidate */ }
  }
  throw new Error('Playwright not found — run `npm install` or set PLAYWRIGHT_MODULE');
}

function cachedChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  try {
    const builds = fs.readdirSync(CACHE)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const b of builds) {
      const p = `${CACHE}/${b}/chrome-linux/chrome`;
      if (fs.existsSync(p)) return p;
    }
  } catch (e) { /* no cache dir */ }
  return undefined;
}

export async function launch(opts = {}) {
  const chromium = await loadChromium();
  const args = ['--no-sandbox', '--disable-dev-shm-usage', ...(opts.args || [])];
  try {
    return await chromium.launch({ ...opts, args });
  } catch (e) {
    const exe = cachedChrome();
    if (!exe) throw e;
    return await chromium.launch({ ...opts, args, executablePath: exe });
  }
}
