import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = []; const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
// Deterministic speech backend tests browser wiring; physical TTS is a manual test.
await page.addInitScript(() => {
  let timer;
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', { value: {
    speak(u) { setTimeout(() => u.onstart?.(), 0); timer = setTimeout(() => u.onend?.(), 850); },
    cancel() { clearTimeout(timer); },
  } });
});
const state = async s => { await page.locator('#stateCode').filter({ hasText: new RegExp(`^${s}$`) }).waitFor(); };
const stats = async () => JSON.parse(await page.locator('#stats').textContent());
try {
  await page.goto('http://localhost:5173/?debug=1');
  await page.locator('#debug').evaluate(e => e.open = true);
  await page.locator('#publicRoute').check(); await page.locator('#simulatePrivate').check();
  await page.locator('#start').click(); await state('LISTENING');
  await page.locator('#demoForeign').click(); await state('AIRPODS_PLAYING');
  assert.match(await page.locator('#chineseTranslation').textContent(), /明天/); await state('LISTENING');
  await page.locator('#demoChinese').click(); await state('SPEAKER_PLAYING');
  const before = await stats(); await page.locator('#inject').click();
  const during = await stats(); assert.equal(during.uploadedBytes, before.uploadedBytes); assert.equal(during.blocked, before.blocked + 1);
  await state('COOLDOWN'); await page.locator('#inject').click(); assert.equal((await stats()).uploadedBytes, before.uploadedBytes);
  await state('LISTENING');
  await page.locator('#uncertain').click(); await state('LISTENING'); assert.match(await page.locator('#message').textContent(), /低信心/);
  await page.locator('#demoForeign').click(); await state('AIRPODS_PLAYING'); await page.locator('#routeLost').click(); await state('ROUTE_LOST');
  await page.waitForTimeout(1200); await state('ROUTE_LOST');
  await page.locator('#start').click(); await state('LISTENING'); await page.locator('#demoForeign').click(); await state('LISTENING');
  assert.match(await page.locator('#message').textContent(), /靜音/);
  await page.locator('#demoChinese').click(); await state('SPEAKER_PLAYING'); await page.locator('#stop').click();
  await page.waitForTimeout(1300); await state('IDLE');
  await page.locator('#start').click(); await state('LISTENING');
  await page.evaluate(() => window.dispatchEvent(new Event('offline'))); await state('NETWORK_LOST');
  await page.locator('#stop').click(); await page.waitForTimeout(1200); await state('IDLE');
  await page.locator('#provider').selectOption('openai'); await page.locator('#start').click();
  // Headless real microphone permission is denied: explicit error, no silent failure.
  await state('ERROR'); await page.locator('#stop').click(); await page.locator('#provider').selectOption('mock');
  await page.locator('#start').click(); await state('LISTENING');
  await page.locator('#demoForeign').click(); await state('LISTENING');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  assert.deepEqual(errors, []); console.log('PASS: Mock private/public, playback gate, cooldown, uncertain, route loss, stop races, offline, permission denial, mobile layout');
  await page.locator('#stop').click();
} finally { await browser.close(); }
