class AudioClipRecorder {
  static async create(context, stream) {
    await context.audioWorklet.addModule('audio-worklet.js');
    return new AudioClipRecorder(context, stream);
  }
  constructor(context, stream) {
    this.state = 'inactive';
    this.mimeType = 'audio/wav';
    this.samples = new Float32Array(16000 * 45);
    this.reset();
    this.source = context.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(context, 'cue-audio-recorder', {
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    this.silent = context.createGain();
    this.silent.gain.value = 0;
    this.source.connect(this.node).connect(this.silent).connect(context.destination);
    this.node.port.onmessage = ({ data }) => {
      if (data === 'flushed') {
        if (this.state !== 'stopping') return;
        this.state = 'inactive';
        const blob = this.snapshot();
        this.reset();
        this.ondataavailable?.({ data: blob });
        this.onstop?.();
      } else if (this.state !== 'inactive') this.append(data);
    };
  }
  append(block) {
    for (let offset = 0; offset < block.length;) {
      const length = Math.min(block.length - offset, this.samples.length - this.position);
      this.samples.set(block.subarray(offset, offset + length), this.position);
      this.position = (this.position + length) % this.samples.length;
      this.length = Math.min(this.samples.length, this.length + length);
      offset += length;
    }
  }
  reset() {
    this.position = 0;
    this.length = 0;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    if (this.state !== 'recording') return;
    this.state = 'stopping';
    this.node.port.postMessage('flush');
  }
  snapshot() {
    const buffer = new ArrayBuffer(44 + this.length * 2);
    const view = new DataView(buffer);
    const text = (offset, value) =>
      [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, buffer.byteLength - 8, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, this.length * 2, true);
    const first = (this.position - this.length + this.samples.length) % this.samples.length;
    for (let i = 0; i < this.length; i++) {
      const value = Math.max(-1, Math.min(1, this.samples[(first + i) % this.samples.length]));
      view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    return new Blob([buffer], { type: this.mimeType });
  }
  destroy() {
    this.state = 'inactive';
    this.node.port.onmessage = null;
    this.node.port.close();
    this.source.disconnect();
    this.node.disconnect();
    this.silent.disconnect();
    this.reset();
  }
}
if (typeof module !== 'undefined') module.exports = AudioClipRecorder;
