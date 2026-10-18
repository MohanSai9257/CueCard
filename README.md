# CueCard desktop

CueCard is a local Mac and Windows desktop app for live transcription and context-grounded speaking cues. Its setup form, résumé parsing, floating assistant, and audio capture run in Electron. No website or local server is required. Internet access is required for Deepgram transcription and the selected AI provider.

## Run locally

For copy-and-paste local setup prompts for **macOS and Windows**, see [SETUP-PROMPTS.md](SETUP-PROMPTS.md). Each person uses their own provider keys and, on Mac, their own local signing certificate.

Install [Node.js 24 or newer](https://nodejs.org/en/download) and npm, then open a terminal in this repository:

```sh
npm ci
npm run signing:check
npm run install:local
open "$HOME/Applications/CueCard.app"
```

Use the installed `Applications/CueCard.app` built by `install:local`, not an old DMG or a copy in Trash. On macOS 14.2+, Electron's system-audio capture needs `NSAudioCaptureUsageDescription` in the running app's Info.plist; launching `npm start` from Terminal can use the parent app's permissions and leave a silent audio track. `npm start` is useful for UI development, but the packaged local app is the audio-test target. The local build command chooses the current Mac architecture automatically. Preview DMGs are not Developer ID-signed and may be rejected by Gatekeeper. Do not disable macOS security protections to open them.

### Stable local signing and permission persistence

The local app version stays **1.3.2** until intentionally changed. Keeping the version number alone does not preserve permissions: macOS also checks the signing identity. Rebuilding an ad-hoc app can invalidate screen/audio capture approval and trigger Keychain prompts even when System Settings still shows CueCard enabled. See [Apple's confirmation](https://developer.apple.com/forums/thread/819406) and [Electron's signing guidance](https://www.electronjs.org/docs/latest/tutorial/code-signing).

For local development, install Xcode from Apple, sign into your Apple Account in **Xcode → Settings → Accounts**, select your team, then **Manage Certificates → + → Apple Development**. Authentication and agreement acceptance must be completed by you. A Personal Team may be available without paid membership; account access and certificate issuance are controlled by Apple. A development certificate is for local use, not trusted public distribution.

`npm run signing:check` checks for a valid Apple application signing identity. `npm run build:local` (also `build:mac`) refuses ad-hoc fallback and pins the selected certificate fingerprint, version, bundle ID and installation path in the ignored local `.cuecard-signing.json` file. If multiple identities exist, set `CUECARD_SIGN_IDENTITY` to the intended SHA-1 fingerprint for the first build. Later builds refuse accidental identity/version/path changes. Do not commit signing certificates, private keys, credentials, or that machine-local pin file.

`npm run install:local` verifies the new signature and app identity before quitting/replacing the current app. It installs at `~/Applications/CueCard.app`, moves the previous app to Trash, and leaves encrypted user data untouched. If signing or verification fails, the installed app is left in place. The first transition to stable signing can require one new OS approval; later rebuilds reuse that identity. OS-mandated periodic confirmations, certificate expiry and revoked permissions are outside CueCard's control. No TCC database is edited or reset.

After certificate creation and a verified build, the full Xcode app is not a CueCard runtime dependency. Keep the signing certificate/private key in Keychain and the standalone Command Line Tools. The local builder prefers those standalone tools when available (unless `DEVELOPER_DIR` is explicitly set), so it can rebuild without the full IDE. Deleting Xcode does not renew or revoke certificates; certificate expiry/account restrictions still apply.

Open **API keys** in the sidebar and save your Deepgram key and a key for **Claude**, Google Gemini, Groq, or OpenAI. For Claude, use [Anthropic Console → API keys](https://platform.claude.com/settings/keys), then choose Claude and a model when creating a session. The default is Haiku for low-latency cues; Sonnet and Opus are also available. A Claude chat subscription is separate from API billing.

Keys are encrypted with Electron safeStorage, whose encryption key is protected by macOS Keychain or Windows DPAPI. They are never saved in plaintext or browser localStorage. AI requests run in the main process; the overlay receives no AI provider key. Deepgram's live socket requires its credential in renderer memory while a session runs. Save, replace, reveal, remove, and test each provider independently. Connection tests validate authentication without sending interview content; they do not guarantee model availability or remaining credits.

Open **Create session** and add your role, company, job description, PDF/DOCX résumé, and answer instructions, then start a session. Saved credentials are loaded automatically. In the floating window, enable **System Audio** and/or **My Mic** independently, or type a question in the question box. Select **Answer now** to request a cue. **Previous** and **Next** browse saved cues from this session. **Clear** empties the question. **Call sessions** lists your latest 200 sessions with their saved questions and cues, filters, and transcript viewer. Transcripts are encrypted locally; résumé files and audio recordings are not stored in this history.

**Analyze screen** is a separate, one-time action: clicking it captures a screenshot and sends that screenshot to the selected AI provider. On macOS 14.2+, System Audio uses a bundled native ScreenCaptureKit helper with audio output only. It captures audio from Mac applications without a browser share picker; no video output is registered. macOS Screen & System Audio Recording permission is required. Windows uses Electron loopback capture. Microphone permission is separate. The compact header controls show capture state; the question box is two lines tall, with Clear on the right. If live transcription misses a question, **Answer now** submits the recent recording to the chosen AI provider for transcription and response.

Mac builds require Xcode Command Line Tools (`xcode-select --install`) to compile the bundled helper automatically. For development, compile it with `xcrun swiftc scripts/system-audio.swift -O -o assets/system-audio-arm64` (use `system-audio-x86_64` on Intel). Capture diagnostics, excluding keys and recorded audio, are stored in `~/Library/Logs/CueCard/audio-capture.log`.

The down-arrow collapses the overlay into a circular horse icon. Drag the icon to reposition it; click it to restore the window. The overlay remains above ordinary application windows while a session is active.

The **+** and **−** controls change only question and answer text size. They do not zoom the page or resize the floating window. Drag the window edges to change its dimensions.

The **◐ appearance button** controls floating-panel transparency. The background starts at 30% opacity; drag the slider down to see more of the application behind it, or up for more contrast. Only this non-sensitive preference is saved locally; text remains opaque. CueCard always receives clicks normally; there is no click-through mode. Setup and API-key pages remain opaque and interactive.

On macOS, CueCard runs without a Dock, Command-Tab entry, or menu-bar icon. Press **Command+Shift+H** to show CueCard again, or reopen the installed app from Finder. The floating window and compact horse still work normally. If you previously pinned an older copy in the Dock, remove that pinned shortcut manually; the app does not edit your Dock preferences. macOS microphone and screen-sharing indicators are controlled by the operating system and are not hidden.

To return for a second interview, open **Call sessions → Continue session**. Review or update the restored résumé text, job description, role, company, model, and instructions, then select **Continue session**. Earlier cues stay available through Previous/Next, and new cues append to the same encrypted transcript with round labels. Current saved API keys are used. Older sessions from before version 1.2.2 did not store résumé/JD context; add those missing details once when continuing them. Résumé text is retained encrypted for continuation; the original PDF/DOCX file is not copied into session history.

Only enabled audio is sent to Deepgram for live transcription. The selected AI provider receives the question and context you supplied when you request an answer. If live text is unavailable, Answer now submits a bounded recent WAV recording: Claude uses Deepgram for transcription, Gemini accepts the recording, and OpenAI/Groq use their transcription endpoints. Recordings are not saved to disk. Keys and session transcripts persist encrypted on this device; active session context stays in app memory. Provider limits or charges may apply. Use the assistant only where permitted.

**Screen-capture protection is on by default** for both CueCard windows, including the compact horse icon and the API keys/transcript pages. It is applied before the windows are shown and remains on when restoring or continuing a session. This requests the OS capture-exclusion mechanism. On macOS, modern apps using ScreenCaptureKit can ignore it, so CueCard cannot guarantee invisibility during full-display sharing. For reliable separation, share only the Teams/Chrome/presentation window you intend to show, and verify the share preview. Native OS menus, file pickers, Dock icons, and external apps are outside this window-content protection. See [Electron’s platform limitations](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows).

## Developer checks and local builds

### Screen-sharing privacy audit

Provider, model, and session-type dropdowns render as in-document listboxes, not native OS select popups. Native selects remain hidden form/data sources. Validation errors are inline; app hover-title tooltips, native spellcheck and context menus are disabled. Both app windows (including compact mode and settings/transcript views) request content protection before showing. These controls reduce extra unprotected UI surfaces; they do not override macOS capture limitations.

Pause screen sharing before opening native file pickers, permission/Keychain dialogs, or external provider/billing websites. macOS application menus, privacy indicators and Activity Monitor remain OS-controlled. Sharing only a specific work/presentation window and checking the view from a second participant/device is the recommended approach. A successful local capture-protection flag check is not proof of invisibility in Teams, Zoom, Meet, or other ScreenCaptureKit clients.

- `npm run check`: JavaScript syntax checks.
- `npm run lint`: static error and unused-code checks.
- `npm test`: isolated provider, audio, transcription, document parsing and vault regression tests; no real keys or billable requests.
- `npm run format`: consistent source formatting.
- `npm run signing:check`: verify a stable Apple application signing certificate is available.
- `npm run build:mac` / `npm run build:local`: certificate-pinned Mac build for the current architecture.
- `npm run install:local`: verified same-version replacement at the fixed local app path; previous app goes to Trash.
- `npm run build:mac:preview`: explicit ad-hoc preview builds for Apple silicon and Intel; not suitable for preserving permissions across rebuilds.
- `npm run build:win`: build a Windows x64 installer on Windows.
- `node scripts/smoke-desktop.mjs /absolute/path/to/CueCard`: desktop setup/session smoke test without live audio or provider calls.
- `node scripts/smoke-workspace.mjs /absolute/path/to/CueCard`: isolated credential encryption, restart persistence, key removal, session history and transcript rendering checks. Uses test credentials only.
- `node scripts/smoke-documents.mjs /absolute/path/to/CueCard`: verifies PDF and DOCX extraction in the packaged app's worker. Uses synthetic documents and a temporary main-process debugger, closed when the test exits.

The app can be shared as source code so another person can build and run it locally with their own development certificate. Distributing a Mac app that opens normally on other computers requires Developer ID signing and Apple notarization; the local-only script deliberately does not notarize. Windows runtime audio capture still needs validation on a Windows PC.

## Release quality and limitations

The CI workflow runs syntax checks, lint, unit tests and a high/critical production-dependency audit on macOS, Windows and Linux. Packaged Mac smoke tests use a separate temporary profile and fake provider responses, exercising saved-key restart persistence, session continuation, question history, font sizing, compact drag/restore, and optional real audio capture (`--audio-probe`). They do not prove provider account credit availability or Windows audio behavior.

Résumé parsing runs in a memory-limited worker with a 20-second timeout and 15 MB input limit; DOCX decompressed sizes are checked before extraction. Audio fallback memory is capped at 45 seconds. In-flight AI calls are cancelled when a session ends; quota failures use bounded cooldowns rather than retry loops.

Known dependency advisory: Mammoth's CLI dependency chain includes the moderate `sprintf-js` precision denial-of-service advisory (GHSA-hp3w-g68c-fv3c), with no compatible patched release currently available. CueCard uses Mammoth's library, not its CLI, and excludes the CLI and argparse from packaged builds. Build tooling also carries this advisory transitively. Recheck `npm audit` before distribution; do not force obsolete major downgrades to silence it. Signing/notarization and live tests with valid provider accounts remain release gates. No application can honestly be guaranteed “100% perfect.”
