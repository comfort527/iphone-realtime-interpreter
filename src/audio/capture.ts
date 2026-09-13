export class Segmenter {
  private frames: Int16Array[] = [];
  private pre: Int16Array[] = [];
  private quiet = 0;
  private samples = 0;
  private voiced = 0;
  reset() { this.frames = []; this.pre = []; this.quiet = this.samples = this.voiced = 0; }
  feed(frame: Int16Array): ArrayBuffer | undefined {
    const rms = Math.sqrt(frame.reduce((sum, v) => sum + (v / 32768) ** 2, 0) / frame.length);
    const speaking = rms > 0.018;
    if (!this.frames.length && !speaking) { this.pre.push(frame); if (this.pre.length > 5) this.pre.shift(); return; }
    if (!this.frames.length) { this.frames.push(...this.pre); this.samples = this.pre.reduce((n, f) => n + f.length, 0); this.pre = []; }
    this.frames.push(frame); this.samples += frame.length;
    this.voiced += speaking ? frame.length : 0;
    this.quiet = speaking ? 0 : this.quiet + frame.length;
    if (this.quiet < 24000 * 0.55 && this.samples < 24000 * 10) return;
    if (this.voiced < 24000 * 0.18) { this.reset(); return; }
    const joined = new Int16Array(this.samples); let offset = 0;
    for (const f of this.frames) { joined.set(f, offset); offset += f.length; }
    this.reset(); return joined.buffer;
  }
}
export class Capture {
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private serial = 0;
  async start(frame: (pcm: Int16Array) => void, interrupted: () => void) {
    const serial = ++this.serial;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('麥克風需要 HTTPS 或 localhost。');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    if (serial !== this.serial) { stream.getTracks().forEach(t => t.stop()); return; }
    this.stream = stream;
    const context = this.context = new AudioContext();
    await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}capture-worklet.js`);
    if (serial !== this.serial) return;
    await context.resume();
    this.node = new AudioWorkletNode(context, 'pcm-capture');
    this.node.port.onmessage = e => { if (serial === this.serial) frame(new Int16Array(e.data)); };
    // Worklet writes silence to its output; mic audio is never monitored locally.
    context.createMediaStreamSource(stream).connect(this.node).connect(context.destination);
    for (const track of stream.getTracks()) { track.onended = interrupted; track.onmute = interrupted; }
    context.onstatechange = () => { if (serial === this.serial && context.state !== 'running') interrupted(); };
  }
  stop() {
    this.serial++; this.node?.disconnect(); this.node = undefined;
    this.stream?.getTracks().forEach(t => { t.onended = t.onmute = null; t.stop(); }); this.stream = undefined;
    if (this.context) { this.context.onstatechange = null; void this.context.close(); this.context = undefined; }
  }
}
