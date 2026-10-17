# Set up CueCard with a local coding assistant

Repository: https://github.com/MohanSai9257/CueCard

Use the prompt for your operating system. Run it in a local coding assistant that can access your terminal and files. Each person needs their own AI-provider and Deepgram credentials. Source access does not include API credits or signing credentials. Use CueCard only where assistance and recording are permitted.

## macOS prompt

```text
Set up the CueCard desktop application locally from https://github.com/MohanSai9257/CueCard.

First inspect this Mac's OS version and CPU architecture. The native system-audio helper requires macOS 14.2 or newer. Use ~/Documents/Projects/CueCard, creating its parent folder if needed. If a checkout exists, inspect its remote and uncommitted changes before updating; preserve all local work. Otherwise clone the repository there. Read README.md, package.json, and any AGENTS.md instructions before proceeding.

Check Git, Node.js 24 or newer, npm, and Apple Command Line Tools. Explain missing prerequisites and install only from official sources with any required approval. Run npm ci, npm run lint, npm run check, and npm test.

Use a stable Apple Development signing identity from MY Mac, not the repository owner's certificate. Run npm run signing:check. If no valid identity exists, guide me through Xcode > Settings > Accounts > my team > Manage Certificates > + > Apple Development. Pause for me to sign in, accept agreements, create/approve a certificate, or enter passwords in Apple's dialogs. Do not export private keys, use ad-hoc signing as a fallback, or disable Gatekeeper. If multiple identities exist, ask me which one to use. Do not copy or commit another computer's .cuecard-signing.json.

Run npm run install:local. Keep the repository's current version, bundle ID, signing identity, and fixed install path. Verify the app and native audio helper signatures. This installs at ~/Applications/CueCard.app and moves the prior installed copy to Trash without deleting saved keys or sessions. Do not empty Trash or remove unrelated apps. Never reset the macOS privacy database.

Run the packaged desktop, workspace, and document smoke scripts documented in README.md using isolated test profiles. Open the installed app, not npm start or an old DMG. Guide me through microphone and screen/system-audio permission approval if required; don't toggle ambiguous duplicate entries. Test My Mic and System Audio independently with my consent. Confirm real microphone input and real system playback, not just a green status dot. No test should transmit audio or interview content to providers without my approval.

Show me where to enter MY Deepgram key and MY selected AI-provider key in the app's API keys page. Do not ask me to paste keys into chat, commit them, or read existing saved secrets. Explain that provider access/credits and network connectivity are required. With my approval, test transcription and an answer using non-sensitive sample context, plus PDF/DOCX upload, Clear, Previous/Next after two answers, session continuation, text sizing, compact dragging, and Command+Shift+H to reopen the app. The Dock and menu-bar icon should stay hidden; OS privacy indicators must remain intact. Never promise invisibility during screen sharing or hide running processes.

Report the installed path, passed checks, and any checks blocked by permissions or missing API credits. Full Xcode is not needed to run the finished app; retain Command Line Tools and the signing certificate/private key for future builds. Do not claim full completion until the installed app is verified, or clearly state the remaining blocker.
```

## Windows prompt

```text
Set up the CueCard desktop application locally from https://github.com/MohanSai9257/CueCard on this Windows PC.

First inspect Windows version and CPU architecture. The current installer target is Windows x64; flag unsupported configurations instead of assuming compatibility. Use a CueCard folder under my user's Documents/Projects directory, creating its parent if needed. If a checkout exists, inspect its remote and uncommitted changes before updating and preserve local work. Otherwise clone the repository there. Read README.md, package.json, and any AGENTS.md instructions.

Check Git, Node.js 24 or newer, and npm. Explain missing prerequisites and use only official installers with required approval. Run npm ci, npm run lint, npm run check, and npm test. Then run npm run build:win on Windows. Do not run Mac-only signing/install commands, install Xcode, or copy another person's credentials.

Locate the generated CueCard Windows x64 NSIS installer in release/, report its exact path, and install it for my user with my approval. The Windows build currently has no trusted publisher signature: do not disable Defender, SmartScreen, or other security protections, and do not bypass warnings. Hand off any security warning to me and report if it blocks installation. Preserve existing encrypted user data. Use the normal installer upgrade path, not duplicate installations, and do not delete unrelated files or empty Trash/Recycle Bin.

Launch the installed application, not merely npm start. Run the packaged desktop, workspace, and document smoke scripts in README.md with the installed executable path and isolated test profiles where supported. Verify Windows microphone access for desktop apps and test My Mic and System Audio independently with my consent. System audio uses Electron loopback capture on Windows; verify real PC playback produces recorded audio, rather than relying on an active icon. Windows live audio has to be validated on this PC; do not treat Mac test results as proof. Keep Analyze screen separate from audio capture. Do not send audio or interview content to providers without my approval.

Show me where to save MY Deepgram key and MY selected AI-provider key inside the app's API keys page. Never ask for keys in chat, commit them, or expose existing saved secrets. Explain internet access and provider credits/limits. With my approval, test live transcription and an answer with non-sensitive sample context, PDF/DOCX uploads, Clear, Previous/Next after two answers, session continuation, text-size controls, floating-window behavior, compact dragging, and Ctrl+Shift+H to reopen CueCard. Do not promise screen-share invisibility or hide OS privacy indicators or running processes.

Report the exact installed executable path, how to reopen the app, passed checks, and any remaining permission, API-credit, security-warning, or Windows compatibility blocker. Do not claim completion if installation or real audio capture could not be tested.
```
