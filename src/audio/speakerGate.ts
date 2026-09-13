import { InterpreterStateMachine } from '../core/stateMachine.ts';
export interface PlaybackReference { id: string; text: string; endedAt: number; pcm?: ArrayBuffer }
export interface Playback { play(signal: AbortSignal, onStarted: () => void): Promise<void> }
export class SpeakerGate {
  readonly cooldownMs = 400;
  private generation = 0;
  private abort?: AbortController;
  private mutedUntil = 0;
  private references: PlaybackReference[] = [];
  constructor(private machine: InterpreterStateMachine, private now = () => performance.now()) {}
  acceptsInput() { return this.machine.canUploadMicAudio() && this.now() >= this.mutedUntil; }
  cancel() {
    // A rapid Stop → Start must still respect room decay after truncated playback.
    if (this.machine.state === 'SPEAKER_PLAYING') this.mutedUntil = this.now() + this.cooldownMs;
    this.generation++; this.abort?.abort(); this.abort = undefined;
  }
  get recentOutputs() { this.references = this.references.filter(r => this.now() - r.endedAt < 5000); return [...this.references]; }
  isLikelyRecentPlayback(text: string, evidence?: { referenceId: string; correlation: number }) {
    if (!evidence || evidence.correlation < 0.92) return false;
    const normalize = (s: string) => s.toLocaleLowerCase().replace(/[\p{P}\p{Z}]/gu, '');
    return this.recentOutputs.some(r => r.id === evidence.referenceId && this.now() - r.endedAt < 1500 && normalize(r.text) === normalize(text));
  }
  async playPublicTranslation(reference: Omit<PlaybackReference, 'endedAt'>, playback: Playback) {
    const generation = ++this.generation;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    // PROCESSING already blocks the gate while playback permission is pending.
    await playback.play(signal, () => {
      if (generation === this.generation && !signal.aborted) this.machine.transition('SPEAKER_PLAYING');
    });
    if (generation !== this.generation || signal.aborted) return;
    if (this.machine.state !== 'SPEAKER_PLAYING') throw new Error('Playback ended without starting');
    this.references = [...this.recentOutputs, { ...reference, endedAt: this.now() }].slice(-8);
    this.mutedUntil = this.now() + this.cooldownMs;
    this.machine.transition('COOLDOWN');
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, this.cooldownMs); signal.addEventListener('abort', done, { once: true });
    });
    if (generation === this.generation && !signal.aborted && (this.machine.state as string) === 'COOLDOWN') this.machine.transition('LISTENING');
  }
}
