import { chromium } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = '/iphone-realtime-interpreter/';
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (!path.startsWith(base)) { res.writeHead(404); res.end(); return; }
  const relative = path.slice(base.length) || 'index.html';
  const root = resolve('dist-pages'), file = resolve(root, relative);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    const bytes = await readFile(file);
    res.setHeader('Content-Type', { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' }[extname(file)] || 'application/octet-stream');
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(5175, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
try {
  const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  const failed = []; page.on('response', r => { if (r.status() >= 400) failed.push(r.url()); });
  await page.goto(`http://localhost:5175${base}`);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/ui-simplified.png', fullPage: true });
  await page.locator('#settingsPanel > summary').click();
  await page.locator('#mockPanel > summary').click();
  assert.equal(await page.locator('#provider option[value="openai"]').evaluate(e => e.disabled), true);
  const manifest = await page.evaluate(async () => await (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  assert.equal(manifest.start_url, './');
  await page.locator('#demoMic').uncheck(); await page.locator('#start').click();
  await page.locator('#stateCode').filter({ hasText: /^LISTENING$/ }).waitFor();
  await page.locator('#demoForeign').click(); await page.locator('#chineseTranslation').filter({ hasText: /明天/ }).waitFor();
  await page.locator('#stop').click();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await context.setOffline(true); await page.reload();
  await page.locator('#mockPanel > summary').click();
  await page.locator('#start').click(); await page.locator('#stateCode').filter({ hasText: /^LISTENING$/ }).waitFor();
  await page.locator('#demoForeign').click(); await page.locator('#chineseTranslation').filter({ hasText: /明天/ }).waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(failed, []);
  console.log('PASS: Pages subpath assets, AudioWorklet mic, relative manifest, static-only providers and offline Mock');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
