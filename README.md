# CueCard desktop

CueCard is a local Mac and Windows desktop app for live transcription and context-grounded speaking cues. Its setup form, résumé parsing, floating assistant, and audio capture run in Electron. No website or local server is required. Internet access is required for Deepgram transcription and the selected AI provider.

## Run locally

Install [Node.js](https://nodejs.org/en/download) and npm, then open a terminal in this repository:

```sh
npm ci
npm start
```

On Mac, running from source is the recommended option until the app is signed and notarized. The GitHub preview DMGs are unsigned and may be rejected by Gatekeeper. Do not disable macOS security protections to open them.

In CueCard, enter your own Deepgram key and a key for Google Gemini, Groq, or OpenAI. Add your role, company, job description, PDF/DOCX résumé, and answer instructions, then start a session. In the floating window, enable **System Audio** and/or **My Mic** independently. macOS may require Microphone and Screen & System Audio Recording permissions in System Settings; restart CueCard after granting them. Select **Answer now** to request a cue.

Only enabled audio is sent to Deepgram for transcription. The selected AI provider receives the question and context you supplied when you request an answer. Keys and context stay in app process memory until exit. Provider limits or charges may apply. Use the assistant only where permitted. Screen-share invisibility is not guaranteed.

## Developer checks and local builds

- `npm run check`: JavaScript syntax checks.
- `node scripts/make-icon.mjs`: regenerate the app icon from its SVG source.
- `npm run build:mac`: build Apple silicon and Intel Mac apps and DMGs on a Mac.
- `npm run build:win`: build a Windows x64 installer on Windows.
- `node scripts/smoke-desktop.mjs /absolute/path/to/CueCard`: desktop setup/session smoke test without live audio or provider calls.

The app can be shared as source code so another person can build and run it locally. Distributing a Mac app that opens normally on other computers requires Developer ID signing and Apple notarization. Windows runtime audio capture still needs validation on a Windows PC.
