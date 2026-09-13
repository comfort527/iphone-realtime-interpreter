import './style.css';
import { InterpreterStateMachine, type AppState } from './core/stateMachine.ts';
import { SpeakerGate } from './audio/speakerGate.ts';
import { Capture, Segmenter } from './audio/capture.ts';
import { OutputRouter } from './audio/playback.ts';
import { MockProvider } from './providers/mock.ts';
import { OpenAIRealtimeProvider } from './providers/openai.ts';
import { GeminiLiveProvider } from './providers/gemini.ts';
import type { AudioOutputEvent, Direction, Language, RealtimeTranslationProvider, TranscriptEvent } from './providers/types.ts';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<main class="shell">
  <header><div><span class="eyebrow">兩種語言，一段對話</span><h1>即時口譯<span class="version">PWA · 01</span></h1></div><span class="badge">台灣繁中</span></header>
  <section class="status-card" aria-live="polite"><span id="dot"></span><div><strong id="status"></strong><small id="stateCode"></small></div><span id="micLevel">● MIC</span></section>
  <section class="card settings"><label>我的語言<input value="繁體中文（台灣）" disabled></label>
    <div class="grid"><label>對方語言<select id="language"><option value="en-US">English (US)</option><option value="ja-JP">日本語</option><option value="fr-FR">Français</option><option value="it-IT">Italiano</option></select></label>
    <label>翻譯引擎<select id="provider"><option value="mock">Mock · 離線展示</option><option value="openai">OpenAI Realtime</option><option value="gemini">Gemini Live</option></select></label></div>
    <label id="passwordRow" hidden>伺服器密碼<input id="password" type="password" autocomplete="off" placeholder="僅遠端伺服器需要"></label>
    <label class="check" id="demoMicRow"><input id="demoMic" type="checkbox" checked>純展示（不啟用麥克風）</label>
    <label class="check"><input id="publicRoute" type="checkbox">已將系統輸出切到 iPhone 喇叭，可公開播放外語</label>
  </section>
  <div class="actions"><button id="start" class="primary">開始口譯</button><button id="stop" disabled>停止</button></div>
  <p id="message" role="status">先以 Mock 體驗；正式翻譯請選擇引擎並允許麥克風。</p>
  <section class="card conversation"><div class="section-title"><span>對方 → 我</span><span class="tag">私人 · 繁中靜音</span></div><small>對方原文</small><p id="foreignSource">—</p><small>繁中譯文</small><p id="chineseTranslation" class="translation">—</p></section>
  <section class="card conversation"><div class="section-title"><span>我 → 對方</span><span class="tag public">公開 · 外語</span></div><small>我的中文</small><p id="chineseSource">—</p><small>將播放的外語</small><p id="foreignTranslation" class="translation">—</p></section>
  <section class="privacy"><strong>私人譯音已保護</strong><p id="routeNotice">網頁無法保證耳機中斷後不會切到喇叭，因此繁中譯音僅顯示字幕。耳機名稱或手動勾選不會解除靜音。</p><span id="devices">耳機路由：無法安全確認</span></section>
  <section id="mockPanel" class="card"><div class="section-title">Mock 驗收控制 <span class="tag">不呼叫 API</span></div><div class="grid"><button id="demoForeign">對方說外語</button><button id="demoChinese">我說中文</button><button id="uncertain">低信心輸入</button><button id="routeLost">模擬耳機中斷</button></div><label class="check"><input id="simulatePrivate" type="checkbox">模擬耳機播放生命週期（全程無聲）</label><small>麥克風版 Mock 以固定範例回覆，不辨識真實語意。</small></section>
  <details id="debug" hidden><summary>診斷面板</summary><pre id="stats"></pre><button id="inject">注入麥克風事件</button><pre id="history"></pre></details>
  <footer>前景、短句、輪流說話。播放外語及冷卻期間暫停收音處理。</footer>
</main>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const check = (id: string) => el<HTMLInputElement>(id).checked;
const staticDemo = import.meta.env.VITE_STATIC_DEMO === 'true';
if (staticDemo) {
  for (const option of el<HTMLSelectElement>('provider').options) if (option.value !== 'mock') option.disabled = true;
  el('message').textContent = 'GitHub Pages 展示版：可測試 Mock 與麥克風；正式 AI 翻譯需要獨立後端。';
}
const labels: Record<AppState, string> = { IDLE: '準備開始', REQUESTING_PERMISSION: '正在取得權限與連線', LISTENING: '正在聽', PROCESSING: '正在翻譯', AIRPODS_PLAYING: '模擬耳機播放（無聲）', SPEAKER_PLAYING: '正在播放外語', COOLDOWN: '冷卻中 · 400 ms', NETWORK_LOST: '網路中斷', ROUTE_LOST: '私人路由已中斷', INTERRUPTED: '翻譯已暫停', ERROR: '需要處理錯誤' };
const machine = new InterpreterStateMachine(), gate = new SpeakerGate(machine), capture = new Capture(), segmenter = new Segmenter(), router = new OutputRouter();
let provider: RealtimeTranslationProvider | undefined, epoch = 0, privateAbort: AbortController | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined, processTimer: ReturnType<typeof setTimeout> | undefined;
let retries = 0, accepted: TranscriptEvent | undefined;
const counters = { micEvents: 0, blocked: 0, uploadedBytes: 0, segments: 0 };
const history: string[] = [];
function message(text: string) { el('message').textContent = text; }
function render() {
  const active = !['IDLE', 'ERROR', 'INTERRUPTED', 'NETWORK_LOST', 'ROUTE_LOST'].includes(machine.state);
  el('status').textContent = labels[machine.state]; el('stateCode').textContent = machine.state;
  el('dot').className = machine.state === 'LISTENING' ? 'live' : '';
  el<HTMLButtonElement>('start').disabled = active;
  el('start').textContent = machine.state === 'IDLE' ? '開始口譯' : '重新開始';
  el<HTMLButtonElement>('stop').disabled = machine.state === 'IDLE';
  for (const id of ['language', 'provider', 'demoMic', 'password']) (el(id) as HTMLInputElement).disabled = active;
  for (const id of ['demoForeign', 'demoChinese', 'uncertain']) el<HTMLButtonElement>(id).disabled = machine.state !== 'LISTENING';
  el('stats').textContent = JSON.stringify({ ...counters, gateOpen: gate.acceptsInput(), retries }, null, 2);
  el('history').textContent = history.join('\n');
}
machine.addEventListener('change', () => { history.unshift(`${new Date().toLocaleTimeString()} ${machine.state}`); history.length = Math.min(25, history.length); segmenter.reset(); render(); });
function cleanup() {
  epoch++; clearTimeout(retryTimer); clearTimeout(processTimer); accepted = undefined;
  gate.cancel(); privateAbort?.abort(); privateAbort = undefined; capture.stop(); segmenter.reset(); router.close();
  const old = provider; provider = undefined; void old?.disconnect();
}
function fail(state: AppState, text: string) {
  if (machine.state === 'IDLE') return;
  cleanup(); machine.transition(state); message(text);
  if (state === 'NETWORK_LOST') scheduleRetry();
}
function scheduleRetry() {
  if (retries >= 3 || document.hidden || !navigator.onLine) { message('連線已暫停；確認網路後按「重新開始」。最多自動重試 3 次。'); return; }
  const delay = 1000 * 2 ** retries++; render();
  retryTimer = setTimeout(() => { if (machine.state === 'NETWORK_LOST') void start(false); }, delay);
}
function ingest(frame: Int16Array) {
  counters.micEvents++;
  // Gate is checked BEFORE VAD/classification and again before provider upload.
  if (!gate.acceptsInput()) { counters.blocked++; segmenter.reset(); return; }
  const segment = segmenter.feed(frame); if (segment) submit(segment);
}
function submit(segment: ArrayBuffer, demoDirection?: Direction | 'uncertain') {
  if (!gate.acceptsInput() || !provider) { counters.blocked++; return; }
  try {
    provider.pushAudio(segment); counters.uploadedBytes += segment.byteLength; counters.segments++;
    machine.transition('PROCESSING');
    processTimer = setTimeout(() => fail('ERROR', '翻譯逾時；請重新開始。'), 50000);
    if (provider instanceof MockProvider && demoDirection) provider.demo(demoDirection); else provider.commit();
  } catch (e) { fail('NETWORK_LOST', String(e)); }
}
function transcript(event: TranscriptEvent) {
  if (machine.state !== 'PROCESSING') return;
  accepted = event;
  if (event.direction === 'uncertain' || event.confidence < 0.8) {
    clearTimeout(processTimer); accepted = undefined; message(`低信心：${event.sourceText}。請再說一次。`); machine.transition('LISTENING'); return;
  }
  el(event.direction === 'foreign-to-zh' ? 'foreignSource' : 'chineseSource').textContent = event.sourceText;
  el(event.direction === 'foreign-to-zh' ? 'chineseTranslation' : 'foreignTranslation').textContent = event.translatedText;
}
async function audio(event: AudioOutputEvent, generation: number) {
  if (generation !== epoch || machine.state !== 'PROCESSING' || !accepted || accepted.id !== event.id || accepted.direction !== event.direction || accepted.confidence < 0.8) return;
  clearTimeout(processTimer); accepted = undefined;
  try {
    if (event.direction === 'foreign-to-zh') {
      if (event.mock && check('simulatePrivate')) {
        privateAbort = new AbortController();
        await router.silentPrivateSimulation().play(privateAbort.signal, () => machine.transition('AIRPODS_PLAYING'));
        if (generation === epoch) { machine.transition('LISTENING'); message('已完成無聲耳機模擬；繁中語音未送往任何輸出。'); }
      } else {
        message('繁中字幕已更新。私人路由無法安全確認，譯音維持靜音。');
        machine.transition('LISTENING');
      }
    } else {
      if (!check('publicRoute')) { message('外語字幕已更新。請先切換系統至手機喇叭，再勾選公開輸出。'); machine.transition('LISTENING'); return; }
      await gate.playPublicTranslation({ id: event.id, text: event.text, pcm: event.pcm }, router.publicPlayback(event, el<HTMLSelectElement>('language').value));
      if (generation === epoch) message('外語播放與 400 ms 冷卻已完成，可以繼續說話。');
    }
  } catch (e) { if (generation === epoch) fail('ERROR', String(e)); }
}
async function start(manual = true) {
  cleanup(); if (manual) retries = 0;
  const generation = epoch;
  machine.transition('REQUESTING_PERMISSION'); message('正在準備音訊與翻譯引擎…');
  const kind = el<HTMLSelectElement>('provider').value;
  if (staticDemo && kind !== 'mock') { fail('ERROR', 'GitHub Pages 未提供 AI 後端，請使用 Mock。'); return; }
  provider = kind === 'mock' ? new MockProvider() : kind === 'openai' ? new OpenAIRealtimeProvider() : new GeminiLiveProvider();
  const current = provider;
  current.onTranscript(e => { if (generation === epoch) transcript(e); });
  current.onAudio(e => { void audio(e, generation); });
  current.onStatus((status, detail) => { if (generation === epoch && (status === 'error' || status === 'disconnected')) fail(status === 'error' ? 'ERROR' : 'NETWORK_LOST', detail || 'Provider 已中斷'); });
  try {
    await router.unlock(); if (generation !== epoch) return;
    if (!(kind === 'mock' && check('demoMic'))) await capture.start(ingest, () => fail('INTERRUPTED', '麥克風或音訊被系統中斷；請回到前景重新開始。'));
    if (generation !== epoch) return;
    if (kind !== 'mock' && !navigator.onLine) { fail('NETWORK_LOST', '網路已離線'); return; }
    await current.connect({ foreignLanguage: el<HTMLSelectElement>('language').value as Language, password: el<HTMLInputElement>('password').value });
    if (generation !== epoch) { void current.disconnect(); return; }
    machine.transition('LISTENING'); message(kind === 'mock' ? 'Mock 就緒。按下方按鈕測試雙向翻譯。' : '請輪流說短句；不確定的語言不會播放。');
  } catch (e) { if (generation === epoch) fail(manual ? 'ERROR' : 'NETWORK_LOST', String(e)); }
}
el('start').onclick = () => { void start(); };
el('stop').onclick = () => { cleanup(); retries = 0; machine.transition('IDLE'); message('已停止；麥克風、連線與播放已釋放。'); };
el('demoForeign').onclick = () => submit(new Int16Array(4800).buffer, 'foreign-to-zh');
el('demoChinese').onclick = () => submit(new Int16Array(4800).buffer, 'zh-to-foreign');
el('uncertain').onclick = () => submit(new Int16Array(4800).buffer, 'uncertain');
el('routeLost').onclick = () => { el<HTMLInputElement>('simulatePrivate').checked = false; fail('ROUTE_LOST', '耳機路由已失去；已取消所有播放與上傳，繁中不會轉到喇叭。'); };
el('publicRoute').onchange = () => { if (!check('publicRoute') && machine.state === 'SPEAKER_PLAYING') fail('INTERRUPTED', '已取消公開輸出並停止播放。'); };
el('provider').onchange = () => { const mock = el<HTMLSelectElement>('provider').value === 'mock'; el('mockPanel').hidden = el('demoMicRow').hidden = !mock; el('passwordRow').hidden = mock; };
el('debug').hidden = !new URLSearchParams(location.search).has('debug');
el('inject').onclick = () => { ingest(new Int16Array(480).fill(6000)); render(); };
window.addEventListener('offline', () => fail('NETWORK_LOST', '網路已離線；已停止上傳。'));
window.addEventListener('online', () => { if (machine.state === 'NETWORK_LOST') scheduleRetry(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) fail('INTERRUPTED', '頁面已進入背景；回前景後請按重新開始。'); });
window.addEventListener('pagehide', () => { if (machine.state !== 'IDLE') fail('INTERRUPTED', '頁面已離開；請重新開始。'); });
navigator.mediaDevices?.addEventListener('devicechange', () => { el('devices').textContent = '音訊裝置已變更；私人輸出仍保持靜音'; el<HTMLInputElement>('publicRoute').checked = false; if (machine.state !== 'IDLE') fail('ROUTE_LOST', '音訊裝置已變更，請重新檢查系統輸出後再開始。'); });
render();
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => message('離線快取安裝失敗；目前仍可在線使用。'));
