# CueCard desktop

CueCard is a Mac and Windows application for live transcription and context-grounded speaking cues. The website distributes installers. Session setup, résumé parsing and audio capture run inside the installed application; no localhost service or browser bridge is required.

## Install the preview

Download the matching installer from [Releases](https://github.com/MohanSai9257/CueCard/releases/tag/v1.1.0). macOS builds are provided for Apple silicon and Intel; the Windows installer targets x64 PCs.

These preview installers are unsigned and the Mac app is not notarized. Publisher signing, notarization and automatic updates are not configured. OS security warnings are expected; verify the release and checksum before proceeding through your OS's normal approval UI. Do not disable system security protections.

Open CueCard, enter an AI provider key and a Deepgram key, upload a text-based PDF/DOCX résumé, and complete the session details. Start opens the floating assistant. Enable System Audio and/or My Mic explicitly. Use Answer now to request a cue. The gear ends capture and returns to settings. macOS may require Microphone and Screen & System Audio Recording permissions in System Settings, followed by an app restart.

Only audio is sent for transcription. Deepgram receives enabled audio; the selected AI provider receives your question and supplied context. Keys and session context remain in process memory until the app exits. Provider charges and limits apply. Use assistance only where permitted. No guarantee of screen-share invisibility is provided.

## Develop and build

Requires Node.js and npm. Run `npm ci`, then `npm start`.

- `npm run check`: JavaScript syntax checks.
- `node scripts/make-icon.mjs`: generate the application icon from its SVG source.
- `npm run build:mac`: Apple silicon and Intel DMG installers.
- `npm run build:win`: Windows x64 NSIS installer.
- `npm run build:web`: static download page in `dist`.
- `node scripts/smoke-desktop.mjs /absolute/path/to/CueCard`: native setup/session IPC smoke test without microphone or provider calls.

The manual GitHub Actions workflow builds on native Mac and Windows runners and retains installers as artifacts. Release publishing is separate. No developer keys or signing credentials belong in source control.

## Release status

Version 1.1.0 introduces native setup and resume selection, independent audio controls, Deepgram streaming, answer history, desktop protocol launching, and installers. It is a preview, not full feature parity with Parakeet AI. Accounts, subscriptions, hosted AI credits, automatic updates, meeting detection and post-call summaries are not implemented. Windows runtime audio requires validation on a Windows PC; packaged Mac UI is smoke-tested separately from live-call/provider testing.
