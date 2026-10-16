class LiveTranscription {
  constructor({ key, stream, onText, onError }) {
    this.key = key;
    this.stream = stream;
    this.onText = onText;
    this.onError = onError;
    this.finalText = '';
    this.text = '';
  }
  start() {
    if (this.socket) return;
    this.closed = false;
    const query = new URLSearchParams({
      model: 'nova-3',
      language: 'multi',
      interim_results: 'true',
      endpointing: '300',
      smart_format: 'true',
    });
    const socket = (this.socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${query}`, [
      'token',
      this.key,
    ]));
    this.timer = setTimeout(() => {
      if (this.socket === socket)
        this.fail('Live transcription connection timed out. Check your Deepgram key and connection.');
    }, 12000);
    socket.onopen = () => {
      clearTimeout(this.timer);
      if (this.closed || this.socket !== socket) return;
      try {
        this.recorder = new MediaRecorder(this.stream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: 64000,
        });
        this.recorder.ondataavailable = ({ data }) => {
          if (socket.readyState !== WebSocket.OPEN || !data.size) return;
          if (socket.bufferedAmount > 1024 * 1024)
            return this.fail(
              'Live transcription connection is too slow. Toggle audio off and on to reconnect.',
            );
          socket.send(data);
        };
        this.recorder.start(100);
      } catch (error) {
        this.fail(error.message);
      }
    };
    socket.onmessage = (event) => {
      if (this.closed || this.socket !== socket) return;
      try {
        const result = JSON.parse(event.data);
        if (result.type === 'Error') return this.fail(result.description || 'Transcription service error.');
        const text = result.channel?.alternatives?.[0]?.transcript?.trim();
        if (!text) return;
        if (result.is_final) this.finalText = `${this.finalText} ${text}`.trim().slice(-12000);
        this.text = result.is_final ? this.finalText : `${this.finalText} ${text}`.trim();
        this.onText(this.text);
      } catch (error) {
        this.fail(`Invalid transcription response: ${error.message}`);
      }
    };
    socket.onerror = () => {
      if (!this.closed && this.socket === socket)
        this.fail('Deepgram could not connect. Check your transcription API key, credits and connection.');
    };
    socket.onclose = () => {
      if (!this.closed && this.socket === socket)
        this.fail('Live transcription disconnected. Toggle an audio source off and on to reconnect.');
    };
  }
  fail(message) {
    if (this.closed) return;
    this.stop();
    this.onError(message);
  }
  stop() {
    this.closed = true;
    clearTimeout(this.timer);
    if (this.recorder?.state === 'recording') {
      this.recorder.ondataavailable = null;
      this.recorder.stop();
    }
    this.socket?.close();
    this.socket = null;
    this.recorder = null;
  }
}
if (typeof module !== 'undefined') module.exports = LiveTranscription;
