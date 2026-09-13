import type { AudioOutputEvent } from '../providers/types.ts';
import type { Playback } from './speakerGate.ts';
// A browser device label or setSinkId success cannot certify no fallback on unplug.
// Private speech is disabled in the web build. A native bridge must enforce this
// invariant at the audio device layer before private playback can be enabled.
export class OutputRouter {
  context?: AudioContext;
  private serial = 0;
  async unlock() { this.context ??= new AudioContext(); await this.context.resume(); }
  stop() { this.serial++; speechSynthesis?.cancel(); }
  close() { this.stop(); if (this.context) { void this.context.close(); this.context = undefined; } }
  canPlayPrivate() { return false; }
  publicPlayback(event: AudioOutputEvent, locale: string): Playback {
    return { play: (signal, started) => event.pcm ? this.playPCM(event.pcm, event.sampleRate, signal, started) : this.speak(event.text, locale, signal, started) };
  }
  silentPrivateSimulation(): Playback {
    // A real AudioBufferSource lifecycle, with all-zero samples. Never private speech.
    return { play: (signal, started) => this.playPCM(new Int16Array(24000).buffer, 24000, signal, started) };
  }
  private async playPCM(pcm: ArrayBuffer, rate: number, signal: AbortSignal, started: () => void) {
    if (signal.aborted) return;
    const context = this.context;
    if (!context || context.state !== 'running') throw new Error('音訊播放被中斷，請按停止後重新開始。');
    const samples = new Int16Array(pcm);
    if (!samples.length || rate < 8000 || rate > 48000) throw new Error('無效的音訊格式');
    const buffer = context.createBuffer(1, samples.length, rate);
    const channel = buffer.getChannelData(0); for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: Error) => { if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort); source.onended = null; source.disconnect(); error ? reject(error) : resolve(); };
      const abort = () => { source.stop(); finish(); };
      const timer = setTimeout(() => { source.stop(); finish(new Error('播放逾時')); }, buffer.duration * 1000 + 5000);
      source.onended = () => finish(); signal.addEventListener('abort', abort, { once: true });
      try { source.start(); started(); } catch (e) { finish(e as Error); }
    });
  }
  private speak(text: string, locale: string, signal: AbortSignal, started: () => void) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) { resolve(); return; }
      const utterance = new SpeechSynthesisUtterance(text); utterance.lang = locale;
      const finish = (error?: Error) => { clearTimeout(timer); signal.removeEventListener('abort', abort); utterance.onstart = utterance.onend = utterance.onerror = null; error ? reject(error) : resolve(); };
      const abort = () => { speechSynthesis.cancel(); finish(); };
      const timer = setTimeout(() => { speechSynthesis.cancel(); finish(new Error('語音播放逾時或未獲允許')); }, 45000);
      utterance.onstart = started; utterance.onend = () => finish(); utterance.onerror = e => finish(new Error(`語音播放失敗：${e.error}`));
      signal.addEventListener('abort', abort, { once: true }); speechSynthesis.speak(utterance);
    });
  }
}
