#!/usr/bin/env node
/* Start the real server on a free port, run the end-to-end suite against it, stop it.
 *
 *   node tools/test-server.mjs
 *
 * Uses the same `app.py` the container runs, so the test exercises the deployment
 * code path (PORT env, static handler, /healthz) rather than a simulated one.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const port = await freePort();
const server = spawn('python3', ['app.py'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stdout.on('data', () => {});
server.stderr.on('data', (d) => process.stderr.write(d));

const base = `http://127.0.0.1:${port}/`;
const up = await waitForServer(base + 'healthz');
if (!up) {
  console.error('server did not come up on ' + base);
  server.kill('SIGTERM');
  process.exit(1);
}

const e2e = spawn('node', ['tools/e2e.mjs', base], { cwd: ROOT, stdio: 'inherit' });
const code = await new Promise((resolve) => e2e.on('exit', resolve));

server.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 200));
process.exit(code);
