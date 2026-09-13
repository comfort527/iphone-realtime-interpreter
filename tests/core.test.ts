import test from 'node:test';
import assert from 'node:assert/strict';
import { InterpreterStateMachine } from '../src/core/stateMachine.ts';
import { SpeakerGate, type Playback } from '../src/audio/speakerGate.ts';
import { Segmenter } from '../src/audio/capture.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { classify, result, openaiSetup, geminiSetup } from '../server/protocol.mjs';
const delay = (n: number) => new Promise(r => setTimeout(r, n));
function listening() { const m = new InterpreterStateMachine(); m.transition('REQUESTING_PERMISSION'); m.transition('LISTENING'); return m; }
function controlled() {
  let end!: () => void;
  const playback: Playback = { play: (signal, started) => new Promise<void>(resolve => { end = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); started(); }) };
  return { playback, end: () => end() };
}
test('invalid transitions rejected and only LISTENING admits microphone', () => {
  const m = listening(); assert.equal(m.canUploadMicAudio(), true);
  assert.throws(() => m.transition('COOLDOWN'));
  for (const state of ['PROCESSING', 'SPEAKER_PLAYING', 'COOLDOWN', 'LISTENING', 'NETWORK_LOST', 'REQUESTING_PERMISSION', 'LISTENING', 'INTERRUPTED', 'IDLE'] as const) { m.transition(state); assert.equal(m.canUploadMicAudio(), state === 'LISTENING'); }
});
test('gate stays shut through actual playback completion plus 400 ms', async () => {
  const m = listening(), gate = new SpeakerGate(m), player = controlled(); m.transition('PROCESSING');
  const task = gate.playPublicTranslation({ id: 'one', text: 'Hello' }, player.playback);
  assert.equal(m.state, 'SPEAKER_PLAYING'); assert.equal(gate.acceptsInput(), false);
  await delay(30); assert.equal(m.state, 'SPEAKER_PLAYING');
  player.end(); await delay(0); const end = performance.now();
  assert.equal(m.state, 'COOLDOWN'); await delay(300); assert.equal(gate.acceptsInput(), false);
  await task; assert.ok(performance.now() - end >= 390); assert.equal(m.state, 'LISTENING');
});
test('stop cancels playback and prevents stale LISTENING resurrection', async () => {
  const m = listening(), gate = new SpeakerGate(m), player = controlled(); m.transition('PROCESSING');
  const task = gate.playPublicTranslation({ id: 'one', text: 'Hello' }, player.playback);
  gate.cancel(); m.transition('IDLE'); player.end(); await task; await delay(420); assert.equal(m.state, 'IDLE');
});
test('route loss during cooldown cannot reopen gate', async () => {
  const m = listening(), gate = new SpeakerGate(m), player = controlled(); m.transition('PROCESSING');
  const task = gate.playPublicTranslation({ id: 'one', text: 'Hello' }, player.playback);
  player.end(); await delay(0); gate.cancel(); m.transition('ROUTE_LOST'); await task; assert.equal(m.state, 'ROUTE_LOST');
});
test('rapid Stop and Start retains 400ms residual audio fence', async () => {
  let now = 1000; const m = listening(), gate = new SpeakerGate(m, () => now), player = controlled(); m.transition('PROCESSING');
  const task = gate.playPublicTranslation({ id: 'one', text: 'Hello' }, player.playback);
  gate.cancel(); m.transition('IDLE'); m.transition('REQUESTING_PERMISSION'); m.transition('LISTENING');
  assert.equal(gate.acceptsInput(), false); now += 399; assert.equal(gate.acceptsInput(), false);
  now++; assert.equal(gate.acceptsInput(), true); await task;
});
test('playback rejection never reopens microphone', async () => {
  const m = listening(), gate = new SpeakerGate(m); m.transition('PROCESSING');
  await assert.rejects(gate.playPublicTranslation({ id: 'a', text: 'a' }, { play: async () => { throw new Error('denied'); } }));
  assert.equal(gate.acceptsInput(), false);
});
test('same words alone never suppressed, references expire after 5s', async () => {
  let now = 0; const m = listening(), gate = new SpeakerGate(m, () => now); m.transition('PROCESSING');
  await gate.playPublicTranslation({ id: 'one', text: 'Hello!' }, { play: async (_signal, start) => start() });
  assert.equal(gate.isLikelyRecentPlayback('Hello!'), false);
  assert.equal(gate.isLikelyRecentPlayback('Hello!', { referenceId: 'other', correlation: 1 }), false);
  assert.equal(gate.isLikelyRecentPlayback('Hello!', { referenceId: 'one', correlation: 0.2 }), false);
  assert.equal(gate.isLikelyRecentPlayback('hello', { referenceId: 'one', correlation: 0.99 }), true);
  now = 5001; assert.equal(gate.recentOutputs.length, 0);
});
test('VAD drops silence, commits voice, and reset discards prior speech', () => {
  const s = new Segmenter(); for (let i = 0; i < 40; i++) assert.equal(s.feed(new Int16Array(480)), undefined);
  for (let i = 0; i < 20; i++) s.feed(new Int16Array(480).fill(6000));
  let segment: ArrayBuffer | undefined; for (let i = 0; i < 30; i++) segment = s.feed(new Int16Array(480)) || segment;
  assert.ok(segment && segment.byteLength > 18000);
  for (let i = 0; i < 20; i++) s.feed(new Int16Array(480).fill(6000)); s.reset();
  for (let i = 0; i < 30; i++) assert.equal(s.feed(new Int16Array(480)), undefined);
});
test('Mock emits matched transcript/audio and disconnect cancels pending work', async () => {
  const p = new MockProvider(); const events: string[] = [];
  const unsub = p.onTranscript(e => events.push(`text:${e.id}`)); p.onAudio(e => events.push(`audio:${e.id}`));
  await p.connect({ foreignLanguage: 'fr-FR' }); p.demo('foreign-to-zh'); await delay(280);
  assert.equal(events.length, 2); assert.equal(events[0].slice(5), events[1].slice(6));
  p.demo('zh-to-foreign'); await p.disconnect(); await delay(280); assert.equal(events.length, 2); unsub();
});
test('classifier rejects unknown/mixed language and Chinese public output', () => {
  assert.equal(classify('Where should we meet tomorrow morning?', 'en-US'), 'foreign-to-zh');
  assert.equal(classify('我們明天在哪裡碰面？', 'en-US'), 'zh-to-foreign');
  assert.equal(classify('bonjour merci', 'en-US'), 'uncertain');
  assert.equal(classify('hello 我們 tomorrow', 'en-US'), 'uncertain');
  assert.equal(classify('明日八時', 'ja-JP'), 'uncertain');
  assert.equal(result('我們明天見', '我們明天見', 'en-US', '1').direction, 'uncertain');
});
test('upstream protocol disables automatic turn detection and enables transcripts', () => {
  assert.equal(openaiSetup('en-US').session.audio.input.turn_detection, null);
  assert.equal(geminiSetup('en-US', 'test').setup.realtimeInputConfig.automaticActivityDetection.disabled, true);
  assert.ok(geminiSetup('en-US', 'test').setup.inputAudioTranscription);
});
