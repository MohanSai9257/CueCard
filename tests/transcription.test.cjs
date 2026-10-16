const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function connection() {
  const sockets = [],
    recordings = [],
    text = [],
    errors = [];
  class Socket {
    static OPEN = 1;
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = 1;
      this.bufferedAmount = 0;
      sockets.push(this);
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    send() {}
  }
  class Recorder {
    constructor() {
      recordings.push(this);
    }
    start(interval) {
      this.interval = interval;
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
    }
  }
  const context = {
    WebSocket: Socket,
    MediaRecorder: Recorder,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    module: { exports: {} },
  };
  vm.runInNewContext(readFileSync(require.resolve('../live-transcription'), 'utf8'), context);
  const client = new context.module.exports({
    key: 'test-key',
    stream: {},
    onText: (value) => text.push(value),
    onError: (error) => errors.push(error),
  });
  client.start();
  sockets[0].onopen();
  return { client, sockets, recordings, text, errors };
}
test('live transcription streams at 100ms and displays interim accented speech without waiting for final', () => {
  const value = connection();
  assert.equal(value.recordings[0].interval, 100);
  assert.match(value.sockets[0].url, /language=multi/);
  value.sockets[0].onmessage({
    data: JSON.stringify({
      is_final: false,
      channel: { alternatives: [{ transcript: 'Tell me about yourself' }] },
    }),
  });
  assert.deepEqual(value.text, ['Tell me about yourself']);
  value.client.stop();
});
test('stale socket cannot change text, stop new recorder, or produce repeated errors', () => {
  const value = connection();
  const stale = value.sockets[0];
  value.client.stop();
  value.client.start();
  value.sockets[1].onopen();
  stale.onmessage({ data: JSON.stringify({ channel: { alternatives: [{ transcript: 'stale' }] } }) });
  stale.onerror();
  stale.onclose();
  assert.equal(value.client.socket, value.sockets[1]);
  assert.deepEqual(value.text, []);
  assert.deepEqual(value.errors, []);
  value.sockets[1].onerror();
  value.sockets[1].onerror();
  assert.equal(value.errors.length, 1);
  assert.equal(value.recordings[1].state, 'inactive');
});
