class PCMCapture extends AudioWorkletProcessor {
  constructor() { super(); this.phase = 0; this.sum = 0; this.count = 0; this.frame = new Int16Array(480); this.index = 0; }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const input = inputs[0]?.[0]; if (!input) return true;
    // Stateful box-filter resampling to mono PCM16 / 24 kHz; phase spans render quanta.
    for (const value of input) {
      this.sum += value; this.count++; this.phase += 24000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        this.frame[this.index++] = Math.round(Math.max(-1, Math.min(1, this.sum / this.count)) * 32767);
        this.sum = this.count = 0;
        if (this.index === 480) { this.port.postMessage(this.frame.buffer, [this.frame.buffer]); this.frame = new Int16Array(480); this.index = 0; }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
