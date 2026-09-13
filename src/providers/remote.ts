import { ProviderEvents, type Direction, type ProviderConfig } from './types.ts';
export class RemoteProvider extends ProviderEvents {
  private socket?: WebSocket;
  private serial = 0;
  private cancelConnect?: () => void;
  constructor(private kind: 'openai' | 'gemini') { super(); }
  async connect(config: ProviderConfig) {
    const serial = ++this.serial;
    this.statuses.forEach(cb => cb('connecting'));
    const response = await fetch(`/api/session/${this.kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.password ? { Authorization: `Bearer ${config.password}` } : {}) }, body: JSON.stringify({ foreignLanguage: config.foreignLanguage }), signal: AbortSignal.timeout(15000) });
    const session = await response.json();
    if (!response.ok) throw new Error(session.error || 'Session 建立失敗');
    if (serial !== this.serial) return;
    const url = new URL('/api/live', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = this.socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const fail = (message: string) => { clearTimeout(timer); reject(new Error(message)); };
      const timer = setTimeout(() => { fail('Provider 連線逾時'); socket.close(); }, 20000);
      this.cancelConnect = () => fail('連線已取消');
      socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', ticket: session.ticket }));
      socket.onerror = () => fail('Provider 網路連線失敗');
      socket.onclose = () => { fail('Provider 連線已關閉'); if (serial === this.serial) this.statuses.forEach(cb => cb('disconnected', '連線中斷')); };
      socket.onmessage = e => {
        if (serial !== this.serial) return;
        try {
          const message = JSON.parse(e.data);
          if (message.type === 'ready') { clearTimeout(timer); this.cancelConnect = undefined; this.statuses.forEach(cb => cb('connected')); resolve(); }
          else if (message.type === 'error') { fail(message.message); this.statuses.forEach(cb => cb('error', message.message)); }
          else if (message.type === 'result') {
            const event = message.event;
            if (!event || typeof event.id !== 'string' || typeof event.sourceText !== 'string' || typeof event.translatedText !== 'string' || !['foreign-to-zh', 'zh-to-foreign', 'uncertain'].includes(event.direction) || !Number.isFinite(event.confidence)) throw new Error('無效的 Provider 回覆');
            this.transcripts.forEach(cb => cb(event));
            if (event.direction !== 'uncertain' && event.confidence >= 0.8 && message.pcm) {
              const bytes = Uint8Array.from(atob(message.pcm), c => c.charCodeAt(0));
              this.audios.forEach(cb => cb({ id: event.id, direction: event.direction, text: event.translatedText, pcm: bytes.buffer, sampleRate: message.sampleRate }));
            }
          }
        } catch { this.statuses.forEach(cb => cb('error', 'Provider 回覆解析失敗')); }
      };
    });
  }
  async disconnect() { this.serial++; this.cancelConnect?.(); this.cancelConnect = undefined; this.socket?.close(); this.socket = undefined; }
  pushAudio(chunk: ArrayBuffer) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 1_000_000) throw new Error('網路壅塞或連線已中斷');
    this.socket.send(chunk);
  }
  commit() { this.socket?.send(JSON.stringify({ type: 'commit' })); }
  setDirection(_direction: Direction) { /* Automatic pair classification is authoritative. */ }
}
