import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'release/**', 'assets/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['renderer.js', 'workspace.js', 'live-transcription.js', 'audio-recorder.js'],
    languageOptions: {
      globals: {
        LiveTranscription: 'readonly',
        AudioClipRecorder: 'readonly',
        resume: 'writable',
        resumeSessionId: 'writable',
      },
    },
  },
];
