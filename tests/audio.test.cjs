const { test } = require('node:test');
const assert = require('node:assert/strict');
const AudioClipRecorder = require('../audio-recorder');
const vm = require('node:vm');
const fs = require('node:fs');

test('audio worklet downsamples 48 kHz to 16 kHz and acknowledges flushed samples', () => {
  let Processor;
  const blocks = [];
  class Base {
    constructor() {
      this.port = { postMessage: (value) => blocks.push(value) };
    }
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../audio-worklet'), 'utf8'), {
    AudioWorkletProcessor: Base,
    sampleRate: 48000,
    registerProcessor: (_name, value) => {
      Processor = value;
    },
  });
  const processor = new Processor();
  for (let i = 0; i < 375; i++) processor.process([[new Float32Array(128).fill(0.25)]]);
  processor.port.onmessage({ data: 'flush' });
  assert.equal(blocks.at(-1), 'flushed');
  const samples = blocks.slice(0, -1).flatMap((block) => Array.from(block));
  assert.equal(samples.length, 16000);
  assert.ok(samples.every((value) => value === 0.25));
});

function recorder(capacity = 8) {
  const value = Object.create(AudioClipRecorder.prototype);
  value.samples = new Float32Array(capacity);
  value.mimeType = 'audio/wav';
  value.reset();
  return value;
}
test('recording retains only latest samples in bounded ring buffer', async () => {
  const value = recorder(4);
  value.append(new Float32Array([0, 0.1, 0.2, 0.3, 0.4, 0.5]));
  const buffer = await value.snapshot().arrayBuffer();
  const view = new DataView(buffer);
  assert.equal(value.length, 4);
  assert.equal(buffer.byteLength, 52);
  assert.equal(view.getInt16(44, true), Math.round(0.2 * 32767));
  assert.equal(view.getInt16(50, true), Math.round(0.5 * 32767));
});
test('each fallback clip is an independent valid mono WAV with clamped PCM', async () => {
  const value = recorder();
  for (let index = 0; index < 3; index++) {
    value.append(new Float32Array([-2, 0, 2]));
    const buffer = await value.snapshot().arrayBuffer();
    const view = new DataView(buffer);
    assert.equal(Buffer.from(buffer).subarray(0, 4).toString(), 'RIFF');
    assert.equal(Buffer.from(buffer).subarray(8, 12).toString(), 'WAVE');
    assert.equal(view.getUint32(24, true), 16000);
    assert.equal(view.getUint32(40, true), 6);
    assert.equal(view.getInt16(44, true), -32768);
    assert.equal(view.getInt16(48, true), 32767);
    value.reset();
  }
});
