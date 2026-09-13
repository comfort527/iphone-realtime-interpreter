import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { openaiSetup, geminiSetup, result } from './protocol.mjs';
export function connectUpstream(kind, language, emit, failed, Socket = WebSocket) {
  const key = process.env[kind === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'];
  const model = kind === 'openai' ? process.env.OPENAI_MODEL || 'gpt-realtime' : process.env.GEMINI_MODEL || 'gemini-3.1-flash-live-preview';
  const url = kind === 'openai' ? `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}` : `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`;
  const ws = new Socket(url, kind === 'openai' ? { headers: { Authorization: `Bearer ${key}` }, maxPayload: 8_000_000 } : { maxPayload: 8_000_000 });
  let ready = false, closed = false, turn, timer;
  const send = message => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
  const fail = message => { if (!closed) { closed = true; clearTimeout(timer); ws.close(); failed(message); } };
  timer = setTimeout(() => fail('上游連線逾時'), 18000);
  ws.on('open', () => send(kind === 'openai' ? openaiSetup(language) : geminiSetup(language, model)));
  const flush = () => {
    if (!turn?.done || !turn.sourceDone) return;
    clearTimeout(timer);
    const event = result(turn.source, turn.text, language, turn.id);
    const pcm = Buffer.concat(turn.audio);
    if (event.direction !== 'uncertain' && !pcm.length) { fail('Provider 未回傳音訊'); return; }
    emit({ type: 'result', event, sampleRate: 24000, pcm: event.direction === 'uncertain' ? undefined : pcm.toString('base64') });
    turn = undefined;
  };
  ws.on('message', data => {
    if (closed) return;
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'error' || m.error) { fail('Provider 拒絕請求，請檢查金鑰、模型與額度。'); return; }
      if (m.type === 'session.updated' || m.setupComplete) { if (!ready) { ready = true; clearTimeout(timer); emit({ type: 'ready' }); } return; }
      if (m.goAway) { fail('Provider session 即將到期，請重新連線'); return; }
      if (!turn) return;
      if (kind === 'openai') {
        if (m.type === 'conversation.item.input_audio_transcription.completed') { turn.source = m.transcript || ''; turn.sourceDone = true; }
        if (m.type === 'conversation.item.input_audio_transcription.failed') { fail('原文辨識失敗，已停止播放'); return; }
        if (m.type === 'response.output_audio.delta') turn.audio.push(Buffer.from(m.delta, 'base64'));
        if (m.type === 'response.output_audio_transcript.delta') turn.text += m.delta;
        if (m.type === 'response.done') {
          if (m.response?.status !== 'completed') { fail('翻譯未完成'); return; }
          turn.done = true;
        }
      } else {
        const c = m.serverContent;
        if (c?.interrupted) { fail('Gemini 回覆被中斷'); return; }
        if (c?.inputTranscription) turn.source += c.inputTranscription.text || '';
        if (c?.outputTranscription) turn.text += c.outputTranscription.text || '';
        for (const p of c?.modelTurn?.parts || []) if (p.inlineData?.data) {
          if (!/^audio\/pcm(?:;rate=24000)?$/.test(p.inlineData.mimeType || '')) { fail('Gemini 音訊格式不支援'); return; }
          turn.audio.push(Buffer.from(p.inlineData.data, 'base64'));
        }
        if (c?.turnComplete) { turn.done = turn.sourceDone = true; }
      }
      if (turn && (turn.audio.reduce((n, a) => n + a.length, 0) > 5_000_000 || turn.text.length > 12000)) { fail('Provider 回覆超過上限'); return; }
      flush();
    } catch { fail('Provider 協定解析失敗'); }
  });
  ws.on('error', () => fail('上游網路或認證失敗'));
  ws.on('close', () => fail('上游連線已中斷'));
  return {
    submit(pcm) {
      if (!ready || turn || ws.readyState !== WebSocket.OPEN) throw new Error('Provider 忙碌或尚未連線');
      turn = { id: randomUUID(), source: '', sourceDone: false, text: '', audio: [], done: false };
      timer = setTimeout(() => fail('翻譯逾時，已停止本次工作'), 45000);
      if (kind === 'openai') {
        send({ type: 'input_audio_buffer.clear' });
        for (let i = 0; i < pcm.length; i += 24000) send({ type: 'input_audio_buffer.append', audio: pcm.subarray(i, i + 24000).toString('base64') });
        send({ type: 'input_audio_buffer.commit' }); send({ type: 'response.create' });
      } else {
        send({ realtimeInput: { activityStart: {} } });
        // Gemini accepts explicit sample-rate PCM; keep 24 kHz capture unchanged.
        for (let i = 0; i < pcm.length; i += 24000) send({ realtimeInput: { audio: { data: pcm.subarray(i, i + 24000).toString('base64'), mimeType: 'audio/pcm;rate=24000' } } });
        send({ realtimeInput: { activityEnd: {} } });
      }
    },
    close() { closed = true; clearTimeout(timer); ws.close(); },
  };
}
