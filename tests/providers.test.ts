import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { connectUpstream } from '../server/upstream.mjs';
class Socket extends EventEmitter {
  static last: Socket;
  readyState = 1; sent: any[] = [];
  constructor() { super(); Socket.last = this; }
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.emit('close'); }
  receive(m: unknown) { this.emit('message', Buffer.from(JSON.stringify(m))); }
}
const chinese = '我們明天早上在哪裡碰面？', english = 'Where should we meet tomorrow morning?';
test('OpenAI waits for BOTH response and late input transcript; PCM paired correctly', () => {
  const events: any[] = [], errors: string[] = [];
  const upstream = connectUpstream('openai', 'en-US', (e: any) => events.push(e), (e: string) => errors.push(e), Socket);
  const ws = Socket.last; ws.emit('open'); assert.equal(ws.sent[0].type, 'session.update');
  ws.receive({ type: 'session.updated' }); upstream.submit(Buffer.alloc(4800));
  assert.deepEqual(ws.sent.slice(-3).map(m => m.type), ['input_audio_buffer.append', 'input_audio_buffer.commit', 'response.create']);
  ws.receive({ type: 'response.output_audio.delta', delta: Buffer.alloc(20).toString('base64') });
  ws.receive({ type: 'response.output_audio_transcript.delta', delta: chinese });
  ws.receive({ type: 'response.done', response: { status: 'completed' } });
  assert.equal(events.length, 1);
  ws.receive({ type: 'conversation.item.input_audio_transcription.completed', transcript: english });
  assert.equal(events[1].event.direction, 'foreign-to-zh'); assert.equal(Buffer.from(events[1].pcm, 'base64').length, 20);
  upstream.close(); assert.deepEqual(errors, []);
});
test('Gemini manual activity and transcriptions produce matched public audio', () => {
  const events: any[] = [], errors: string[] = [];
  const upstream = connectUpstream('gemini', 'en-US', (e: any) => events.push(e), (e: string) => errors.push(e), Socket);
  const ws = Socket.last; ws.emit('open'); assert.ok(ws.sent[0].setup); ws.receive({ setupComplete: {} });
  upstream.submit(Buffer.alloc(4800)); assert.ok(ws.sent[1].realtimeInput.activityStart); assert.ok(ws.sent.at(-1).realtimeInput.activityEnd);
  ws.receive({ serverContent: { inputTranscription: { text: chinese }, outputTranscription: { text: english }, modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(20).toString('base64') } }] }, turnComplete: true } });
  assert.equal(events[1].event.direction, 'zh-to-foreign'); upstream.close(); assert.deepEqual(errors, []);
});
test('uncertain output has no audio; upstream errors are surfaced without credentials', () => {
  const events: any[] = [], errors: string[] = [];
  const upstream = connectUpstream('gemini', 'en-US', (e: any) => events.push(e), (e: string) => errors.push(e), Socket);
  const ws = Socket.last; ws.emit('open'); ws.receive({ setupComplete: {} }); upstream.submit(Buffer.alloc(4800));
  ws.receive({ serverContent: { inputTranscription: { text: chinese }, outputTranscription: { text: chinese }, turnComplete: true } });
  assert.equal(events[1].event.direction, 'uncertain'); assert.equal(events[1].pcm, undefined);
  ws.receive({ error: { message: 'secret-example-do-not-echo' } }); assert.equal(errors.length, 1); assert.doesNotMatch(errors[0], /secret/); upstream.close();
});
test('disconnect closes upstream and ignores late completion', () => {
  const events: any[] = [];
  const upstream = connectUpstream('openai', 'en-US', (e: any) => events.push(e), () => {}, Socket);
  const ws = Socket.last; ws.emit('open'); ws.receive({ type: 'session.updated' }); upstream.submit(Buffer.alloc(4800));
  upstream.close(); assert.equal(ws.readyState, 3);
  ws.receive({ type: 'response.output_audio.delta', delta: Buffer.alloc(20).toString('base64') });
  ws.receive({ type: 'response.output_audio_transcript.delta', delta: english });
  ws.receive({ type: 'conversation.item.input_audio_transcription.completed', transcript: chinese });
  ws.receive({ type: 'response.done', response: { status: 'completed' } });
  assert.equal(events.length, 1);
});
