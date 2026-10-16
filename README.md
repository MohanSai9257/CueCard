# CueCard desktop

CueCard is a local Mac and Windows desktop app for live transcription and context-grounded speaking cues. Its setup form, résumé parsing, floating assistant, and audio capture run in Electron. No website or local server is required. Internet access is required for Deepgram transcription and the selected AI provider.

## Run locally

Install [Node.js 24 or newer](https://nodejs.org/en/download) and npm, then open a terminal in this repository:

```sh
npm ci
npx electron-builder --mac dmg --arm64 --publish never
open release/mac-arm64/CueCard.app
```

Use the `release/mac-arm64/CueCard.app` that was built locally, not the downloaded DMG. On macOS 14.2+, Electron's system-audio capture needs `NSAudioCaptureUsageDescription` in the running app's Info.plist; launching `npm start` from Terminal can use the parent app's permissions and leave a silent audio track. `npm start` is useful for UI development, but the packaged local app is the audio-test target. On an Intel Mac, build with `npx electron-builder --mac dmg --x64 --publish never` and open `release/mac/CueCard.app`. The GitHub preview DMGs are unsigned and may be rejected by Gatekeeper. Do not disable macOS security protections to open them.

Open **API keys** in the sidebar and save your Deepgram key and a key for **Claude**, Google Gemini, Groq, or OpenAI. For Claude, use [Anthropic Console → API keys](https://platform.claude.com/settings/keys), then choose Claude and a model when creating a session. The default is Haiku for low-latency cues; Sonnet and Opus are also available. A Claude chat subscription is separate from API billing.

Keys are encrypted with Electron safeStorage, whose encryption key is protected by macOS Keychain or Windows DPAPI. They are never saved in plaintext or browser localStorage. AI requests run in the main process; the overlay receives no AI provider key. Deepgram's live socket requires its credential in renderer memory while a session runs. Save, replace, reveal, remove, and test each provider independently. Connection tests validate authentication without sending interview content; they do not guarantee model availability or remaining credits.

Open **Create session** and add your role, company, job description, PDF/DOCX résumé, and answer instructions, then start a session. Saved credentials are loaded automatically. In the floating window, enable **System Audio** and/or **My Mic** independently, or type a question in the question box. Select **Answer now** to request a cue. **Previous** and **Next** browse saved cues from this session. **Clear** empties the question. **Call sessions** lists your latest 200 sessions with their saved questions and cues, filters, and transcript viewer. Transcripts are encrypted locally; résumé files and audio recordings are not stored in this history.

**Analyze screen** is a separate, one-time action: clicking it captures a screenshot and sends that screenshot to the selected AI provider. On macOS 14.2+, System Audio uses a bundled native ScreenCaptureKit helper with audio output only. It captures audio from Mac applications without a browser share picker; no video output is registered. macOS Screen & System Audio Recording permission is required. Windows uses Electron loopback capture. Microphone permission is separate. The System/Mic meter below the question shows whether audio is actually arriving; if live transcription misses a question, **Answer now** submits the recent recording to the chosen AI provider for transcription and response.

Mac builds require Xcode Command Line Tools (`xcode-select --install`) to compile the bundled helper automatically. For development, compile it with `xcrun swiftc scripts/system-audio.swift -O -o assets/system-audio-arm64` (use `system-audio-x86_64` on Intel). Capture diagnostics, excluding keys and recorded audio, are stored in `~/Library/Logs/CueCard/audio-capture.log`.

The down-arrow collapses the overlay into a circular horse icon. Drag the icon to reposition it; click it to restore the window. The overlay remains above ordinary application windows while a session is active.

The **+** and **−** controls change only question and answer text size. They do not zoom the page or resize the floating window. Drag the window edges to change its dimensions.

To return for a second interview, open **Call sessions → Continue session**. Review or update the restored résumé text, job description, role, company, model, and instructions, then select **Continue session**. Earlier cues stay available through Previous/Next, and new cues append to the same encrypted transcript with round labels. Current saved API keys are used. Older sessions from before version 1.2.2 did not store résumé/JD context; add those missing details once when continuing them. Résumé text is retained encrypted for continuation; the original PDF/DOCX file is not copied into session history.

Only enabled audio is sent to Deepgram for live transcription. The selected AI provider receives the question and context you supplied when you request an answer. If live text is unavailable, Answer now submits a bounded recent WAV recording: Claude uses Deepgram for transcription, Gemini accepts the recording, and OpenAI/Groq use their transcription endpoints. Recordings are not saved to disk. Keys and session transcripts persist encrypted on this device; active session context stays in app memory. Provider limits or charges may apply. Use the assistant only where permitted.

**Screen-capture protection is on by default** for both CueCard windows, including the compact horse icon and the API keys/transcript pages. It is applied before the windows are shown and remains on when restoring or continuing a session. This requests the OS capture-exclusion mechanism. On macOS, modern apps using ScreenCaptureKit can ignore it, so CueCard cannot guarantee invisibility during full-display sharing. For reliable separation, share only the Teams/Chrome/presentation window you intend to show, and verify the share preview. Native OS menus, file pickers, Dock icons, and external apps are outside this window-content protection. See [Electron’s platform limitations](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows).

## Developer checks and local builds

- `npm run check`: JavaScript syntax checks.
- `npm run lint`: static error and unused-code checks.
- `npm test`: isolated provider, audio, transcription, document parsing and vault regression tests; no real keys or billable requests.
- `npm run format`: consistent source formatting.
- `npm run build:mac`: build Apple silicon and Intel Mac apps and DMGs on a Mac.
- `npm run build:win`: build a Windows x64 installer on Windows.
- `node scripts/smoke-desktop.mjs /absolute/path/to/CueCard`: desktop setup/session smoke test without live audio or provider calls.
- `node scripts/smoke-workspace.mjs /absolute/path/to/CueCard`: isolated credential encryption, restart persistence, key removal, session history and transcript rendering checks. Uses test credentials only.
- `node scripts/smoke-documents.mjs /absolute/path/to/CueCard`: verifies PDF and DOCX extraction in the packaged app's worker. Uses synthetic documents and a temporary main-process debugger, closed when the test exits.

The app can be shared as source code so another person can build and run it locally. Mac builds use an ad-hoc signature for local integrity, not a trusted Developer ID certificate. Distributing a Mac app that opens normally on other computers requires overriding `mac.identity` with your Developer ID identity and completing Apple notarization. Windows runtime audio capture still needs validation on a Windows PC.

## Release quality and limitations

The CI workflow runs syntax checks, lint, unit tests and a high/critical production-dependency audit on macOS, Windows and Linux. Packaged Mac smoke tests use a separate temporary profile and fake provider responses, exercising saved-key restart persistence, session continuation, question history, font sizing, compact drag/restore, and optional real audio capture (`--audio-probe`). They do not prove provider account credit availability or Windows audio behavior.

Résumé parsing runs in a memory-limited worker with a 20-second timeout and 15 MB input limit; DOCX decompressed sizes are checked before extraction. Audio fallback memory is capped at 45 seconds. In-flight AI calls are cancelled when a session ends; quota failures use bounded cooldowns rather than retry loops.

Known dependency advisory: Mammoth's CLI dependency chain includes the moderate `sprintf-js` precision denial-of-service advisory (GHSA-hp3w-g68c-fv3c), with no compatible patched release currently available. CueCard uses Mammoth's library, not its CLI, and excludes the CLI and argparse from packaged builds. Build tooling also carries this advisory transitively. Recheck `npm audit` before distribution; do not force obsolete major downgrades to silence it. Signing/notarization and live tests with valid provider accounts remain release gates. No application can honestly be guaranteed “100% perfect.”
