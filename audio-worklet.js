// Downmix/resample locally; only short mono PCM blocks cross to the UI thread.
class CueAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.output = new Float32Array(1024);
    this.position = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.port.onmessage = ({ data }) => {
      if (data === 'flush') {
        this.flush();
        this.port.postMessage('flushed');
      }
    };
  }
  flush() {
    if (!this.position) return;
    const block = this.output.slice(0, this.position);
    this.port.postMessage(block, [block.buffer]);
    this.position = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    const ratio = sampleRate / 16000;
    for (const sample of channel) {
      this.sum += sample;
      this.count++;
      this.phase++;
      if (this.phase >= ratio) {
        this.output[this.position++] = this.sum / this.count;
        this.phase -= ratio;
        this.sum = 0;
        this.count = 0;
        if (this.position === this.output.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('cue-audio-recorder', CueAudioProcessor);
