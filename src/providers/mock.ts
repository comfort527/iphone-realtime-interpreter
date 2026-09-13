import { ProviderEvents, type Direction, type ProviderConfig, type TranscriptEvent } from './types.ts';
const lines = {
  'en-US': ['Where should we meet tomorrow morning?', "Let's meet in the hotel lobby at eight tomorrow morning."],
  'ja-JP': ['明日の朝はどこで会いましょうか？', '明日の朝八時にホテルのロビーで会いましょう。'],
  'fr-FR': ['Où allons-nous nous retrouver demain matin ?', "Retrouvons-nous dans le hall de l’hôtel à huit heures demain matin."],
  'it-IT': ['Dove ci incontriamo domani mattina?', "Incontriamoci nella hall dell’albergo alle otto domani mattina."],
};
export class MockProvider extends ProviderEvents {
  private config: ProviderConfig = { foreignLanguage: 'en-US' };
  private direction: Direction = 'foreign-to-zh';
  private connected = false;
  private timer?: ReturnType<typeof setTimeout>;
  uploadedBytes = 0;
  async connect(config: ProviderConfig) { this.config = config; this.statuses.forEach(cb => cb('connecting')); this.connected = true; this.statuses.forEach(cb => cb('connected')); }
  async disconnect() { this.connected = false; clearTimeout(this.timer); this.statuses.forEach(cb => cb('disconnected')); }
  setDirection(d: Direction) { this.direction = d; }
  pushAudio(a: ArrayBuffer) { if (!this.connected) throw new Error('Mock disconnected'); this.uploadedBytes += a.byteLength; }
  commit() { this.demo(this.direction); }
  demo(direction: Direction | 'uncertain') {
    if (!this.connected) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.connected) return;
      const foreign = lines[this.config.foreignLanguage];
      const event: TranscriptEvent = { id: crypto.randomUUID(), direction, confidence: direction === 'uncertain' ? 0.3 : 0.99,
        sourceText: direction === 'zh-to-foreign' ? '明天早上八點在飯店大廳碰面。' : direction === 'uncertain' ? '（音訊不清楚）' : foreign[0],
        translatedText: direction === 'zh-to-foreign' ? foreign[1] : direction === 'uncertain' ? '' : '我們明天早上應該在哪裡碰面？' };
      this.transcripts.forEach(cb => cb(event));
      if (direction !== 'uncertain') this.audios.forEach(cb => cb({ id: event.id, direction, text: event.translatedText, sampleRate: 24000, mock: true }));
    }, 250);
  }
}
