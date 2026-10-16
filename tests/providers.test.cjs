const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateCue, requestJSON, parseCue } = require('../ai-client');
const providers = require('../providers');

const cue = { question: 'Tell me about yourself', answer: 'A grounded answer.' };
function config(provider) {
  return {
    provider,
    model: providers[provider].models[0][0],
    apiKey: 'private-ai-key',
    transcriptionKey: 'private-transcription-key',
  };
}
const input = { question: cue.question, system: 'Use only supplied resume facts.' };
function reply(value) {
  return { ok: true, json: async () => value };
}

for (const provider of ['claude', 'gemini', 'openai', 'groq']) {
  test(`${provider}: text request uses correct model, JSON and private auth headers`, async () => {
    let observed;
    const result = await generateCue(config(provider), input, {
      fetchImpl: async (url, options) => {
        observed = { url, ...options, body: JSON.parse(options.body) };
        if (provider === 'claude') return reply({ content: [{ type: 'text', text: JSON.stringify(cue) }] });
        if (provider === 'gemini')
          return reply({ candidates: [{ content: { parts: [{ text: JSON.stringify(cue) }] } }] });
        return reply({ choices: [{ message: { content: JSON.stringify(cue) } }] });
      },
    });
    assert.deepEqual(result, cue);
    assert.ok(!observed.url.includes('private-ai-key'));
    assert.equal(observed.redirect, 'error');
    if (provider === 'claude') {
      assert.equal(observed.headers['x-api-key'], 'private-ai-key');
      assert.equal(observed.headers['anthropic-version'], '2023-06-01');
      assert.equal(observed.body.model, config(provider).model);
      assert.match(observed.body.system, /resume facts/);
    } else if (provider === 'gemini') assert.equal(observed.headers['x-goog-api-key'], 'private-ai-key');
    else assert.equal(observed.headers.Authorization, 'Bearer private-ai-key');
  });
}
test('Claude screen request sends PNG image block', async () => {
  await generateCue(
    config('claude'),
    { ...input, image: 'data:image/png;base64,YQ==' },
    {
      fetchImpl: async (_url, options) => {
        const image = JSON.parse(options.body).messages[0].content[0];
        assert.deepEqual(image.source, { type: 'base64', media_type: 'image/png', data: 'YQ==' });
        return reply({ content: [{ type: 'text', text: JSON.stringify(cue) }] });
      },
    },
  );
});
test('Claude recorded audio uses Deepgram then Claude, not unsupported audio blocks', async () => {
  const urls = [];
  const result = await generateCue(
    config('claude'),
    { ...input, audio: new Uint8Array([1, 2]), mimeType: 'audio/wav' },
    {
      fetchImpl: async (url, options) => {
        urls.push(url);
        if (urls.length === 1) {
          assert.equal(options.headers.Authorization, 'Token private-transcription-key');
          return reply({ results: { channels: [{ alternatives: [{ transcript: cue.question }] }] } });
        }
        assert.match(JSON.parse(options.body).messages[0].content[0].text, /Tell me about yourself/);
        return reply({ content: [{ type: 'text', text: JSON.stringify(cue) }] });
      },
    },
  );
  assert.deepEqual(result, cue);
  assert.match(urls[0], /api.deepgram.com/);
  assert.equal(urls[1], 'https://api.anthropic.com/v1/messages');
});
test('quota errors redact keys and expose bounded retry timing', async () => {
  await assert.rejects(
    requestJSON(
      'https://example.invalid',
      {},
      {
        secrets: ['secret'],
        fetchImpl: async () => ({
          ok: false,
          status: 429,
          json: async () => ({ error: { message: 'bad secret', details: [{ retryDelay: '57s' }] } }),
        }),
      },
    ),
    (error) => error.message === 'bad [redacted]' && error.retrySeconds === 57,
  );
});
test('aborted session is classified as cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    requestJSON(
      'https://example.invalid',
      {},
      {
        signal: controller.signal,
        fetchImpl: async () => {
          throw new Error('aborted');
        },
      },
    ),
    (error) => error.cancelled === true,
  );
});
test('malformed provider output fails without rendering raw response', () => {
  assert.throws(() => parseCue('<script>bad</script>'), /unreadable/);
  assert.throws(() => parseCue('{"question":2,"answer":null}'), /unreadable/);
  assert.deepEqual(parseCue('```json\n' + JSON.stringify(cue) + '\n```'), cue);
});
test('unsupported vision model fails without a request', async () => {
  await assert.rejects(
    generateCue(
      config('groq'),
      { ...input, image: 'data:image/png;base64,YQ==' },
      { fetchImpl: () => assert.fail('No network call expected') },
    ),
    /does not support/,
  );
});
