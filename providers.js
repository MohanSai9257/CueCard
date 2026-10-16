(function (root, factory) {
  const providers = factory();
  if (typeof module === 'object' && module.exports) module.exports = providers;
  else root.CueProviders = providers;
})(globalThis, () =>
  Object.freeze({
    gemini: {
      name: 'Google Gemini',
      mark: 'G',
      detail: 'AI provider for tailored interview cues',
      link: 'https://aistudio.google.com/apikey',
      vision: true,
      models: [['gemini-3.8-flash', 'Gemini 3.8 Flash']],
      testUrl: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    },
    claude: {
      name: 'Claude',
      mark: '✳',
      detail: 'Anthropic AI for interview cues and screen analysis',
      link: 'https://platform.claude.com/settings/keys',
      vision: true,
      models: [
        ['claude-haiku-5-5', 'Claude Haiku 5.5 · Fast'],
        ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
        ['claude-opus-5-5', 'Claude Opus 5.5'],
      ],
      testUrl: 'https://api.anthropic.com/v1/models?limit=1',
    },
    deepgram: {
      name: 'Deepgram',
      mark: 'D',
      detail: 'Live transcription for system audio and microphone',
      link: 'https://console.deepgram.com/',
      testUrl: 'https://api.deepgram.com/v1/auth/token',
    },
    openai: {
      name: 'OpenAI',
      mark: '◎',
      detail: 'An additional AI provider for your sessions',
      link: 'https://platform.openai.com/api-keys',
      vision: true,
      models: [
        ['gpt-4.1-mini', 'GPT-4.1 Mini'],
        ['gpt-4.1', 'GPT-4.1'],
      ],
      testUrl: 'https://api.openai.com/v1/models',
    },
    groq: {
      name: 'Groq',
      mark: 'g',
      detail: 'Fast responses with open models',
      link: 'https://console.groq.com/keys',
      vision: false,
      models: [
        ['llama-3.3-70b-versatile', 'Llama 3.3 70B'],
        ['llama-3.1-8b-instant', 'Llama 3.1 8B'],
      ],
      testUrl: 'https://api.groq.com/openai/v1/models',
    },
  }),
);
