import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
try {
  const context = await browser.newContext({ permissions: ['microphone'] }); const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:5173/');
  for (const kind of ['openai', 'gemini']) {
    const r = await page.evaluate(async kind => {
      const response = await fetch(`/api/session/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ foreignLanguage: 'en-US' }) });
      return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
    }, kind);
    assert.equal(r.status, 503); assert.match(r.body.error, /API Key/); assert.equal(r.cache, 'no-store');
    await page.locator('#provider').selectOption(kind); await page.locator('#start').click();
    await page.locator('#stateCode').filter({ hasText: /^ERROR$/ }).waitFor();
    assert.match(await page.locator('#message').textContent(), /API Key/); await page.locator('#stop').click();
  }
  // A genuine AudioWorklet graph with browser fake mic, and explicit stop cleanup.
  await page.locator('#provider').selectOption('mock'); await page.locator('#demoMic').uncheck();
  await page.locator('#start').click(); await page.locator('#stateCode').filter({ hasText: /^LISTENING$/ }).waitFor();
  await page.locator('#stop').click(); await page.locator('#stateCode').filter({ hasText: /^IDLE$/ }).waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    const cache = await caches.open(keys.find(k => k.startsWith('interpreter-shell-')));
    const requests = await cache.keys();
    if (!requests.some(r => /\/assets\/.*\.js$/.test(r.url))) throw new Error('JS was not precached');
  });
  await page.reload(); await context.setOffline(true); await page.reload();
  await page.locator('#start').waitFor(); assert.equal(await page.locator('#provider').inputValue(), 'mock');
  await page.locator('#start').click(); await page.locator('#stateCode').filter({ hasText: /^LISTENING$/ }).waitFor();
  await page.locator('#demoForeign').click(); await page.locator('#chineseTranslation').filter({ hasText: /明天/ }).waitFor();
  await page.locator('#stop').click(); assert.deepEqual(errors, []);
  console.log('PASS: both credential failures, no-store endpoints, real AudioWorklet fake-mic graph, offline PWA shell and Mock');
} finally { await browser.close(); }
