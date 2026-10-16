# CueCard desktop

CueCard is a local Mac and Windows desktop app for live transcription and context-grounded speaking cues. Its setup form, résumé parsing, floating assistant, and audio capture run in Electron. No website or local server is required. Internet access is required for Deepgram transcription and the selected AI provider.

## Run locally

Install [Node.js](https://nodejs.org/en/download) and npm, then open a terminal in this repository:

```sh
npm ci
npx electron-builder --mac dmg --arm64 --publish never
open release/mac-arm64/CueCard.app
```

Use the `release/mac-arm64/CueCard.app` that was built locally, not the downloaded DMG. On macOS 14.2+, Electron's system-audio capture needs `NSAudioCaptureUsageDescription` in the running app's Info.plist; launching `npm start` from Terminal can use the parent app's permissions and leave a silent audio track. `npm start` is useful for UI development, but the packaged local app is the audio-test target. On an Intel Mac, build with `npx electron-builder --mac dmg --x64 --publish never` and open `release/mac/CueCard.app`. The GitHub preview DMGs are unsigned and may be rejected by Gatekeeper. Do not disable macOS security protections to open them.

In CueCard, enter your own Deepgram key and a key for Google Gemini, Groq, or OpenAI. Add your role, company, job description, PDF/DOCX résumé, and answer instructions, then start a session. In the floating window, enable **System Audio** and/or **My Mic** independently, or type a question in the question box. Select **Answer now** to request a cue. **Previous** and **Next** browse saved cues from this session; at least two answers must be generated before there is somewhere to navigate. A hint below the buttons explains when you are at the first or latest cue. **Clear** empties the question. The down-arrow collapses the floating window to the supplied horse logo; click it to restore the window.

**Analyze screen** is a separate, one-time action: clicking it captures a screenshot and sends that screenshot to the selected AI provider. System Audio sends only audio to transcription; it does not send screen images. Electron's macOS loopback capture still selects a display internally, and macOS may request System Audio Recording or Screen Recording permission depending on its version and settings. Microphone permission is separate. Restart CueCard after granting new permissions. Neither capture mode is guaranteed to work on every Mac or call app without a live device test.

Only enabled audio is sent to Deepgram for transcription. The selected AI provider receives the question and context you supplied when you request an answer. Keys and context stay in app process memory until exit. Provider limits or charges may apply. Use the assistant only where permitted. Screen-share invisibility is not guaranteed.

## Developer checks and local builds

- `npm run check`: JavaScript syntax checks.
- `npm run build:mac`: build Apple silicon and Intel Mac apps and DMGs on a Mac.
- `npm run build:win`: build a Windows x64 installer on Windows.
- `node scripts/smoke-desktop.mjs /absolute/path/to/CueCard`: desktop setup/session smoke test without live audio or provider calls.

The app can be shared as source code so another person can build and run it locally. Distributing a Mac app that opens normally on other computers requires Developer ID signing and Apple notarization. Windows runtime audio capture still needs validation on a Windows PC.
