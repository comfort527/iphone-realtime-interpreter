export type Direction = 'foreign-to-zh' | 'zh-to-foreign';
export type Language = 'en-US' | 'ja-JP' | 'fr-FR' | 'it-IT';
export interface ProviderConfig { foreignLanguage: Language; password?: string }
export interface TranscriptEvent { id: string; sourceText: string; translatedText: string; direction: Direction | 'uncertain'; confidence: number }
export interface AudioOutputEvent { id: string; direction: Direction; text: string; pcm?: ArrayBuffer; sampleRate: number; mock?: boolean }
export type ProviderStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export interface RealtimeTranslationProvider {
  connect(config: ProviderConfig): Promise<void>;
  disconnect(): Promise<void>;
  pushAudio(chunk: ArrayBuffer): void;
  commit(): void;
  setDirection(direction: Direction): void;
  onTranscript(cb: (event: TranscriptEvent) => void): () => void;
  onAudio(cb: (event: AudioOutputEvent) => void): () => void;
  onStatus(cb: (status: ProviderStatus, message?: string) => void): () => void;
}
export abstract class ProviderEvents implements RealtimeTranslationProvider {
  protected transcripts = new Set<(e: TranscriptEvent) => void>();
  protected audios = new Set<(e: AudioOutputEvent) => void>();
  protected statuses = new Set<(s: ProviderStatus, message?: string) => void>();
  onTranscript(cb: (e: TranscriptEvent) => void) { this.transcripts.add(cb); return () => { this.transcripts.delete(cb); }; }
  onAudio(cb: (e: AudioOutputEvent) => void) { this.audios.add(cb); return () => { this.audios.delete(cb); }; }
  onStatus(cb: (s: ProviderStatus, m?: string) => void) { this.statuses.add(cb); return () => { this.statuses.delete(cb); }; }
  abstract connect(c: ProviderConfig): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract pushAudio(a: ArrayBuffer): void;
  abstract commit(): void;
  abstract setDirection(d: Direction): void;
}
