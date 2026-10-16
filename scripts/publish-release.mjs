import { execFileSync } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';

const repository = 'MohanSai9257/CueCard';
const tag = 'v1.1.0';
// Use the user's configured Git credential helper; never persist or print credentials.
const raw = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
const credential = Object.fromEntries(raw.trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
const headers = { Authorization: `Bearer ${credential.password}`, 'User-Agent': 'CueCard-release', Accept: 'application/vnd.github+json' };
async function api(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${body.message}`);
  return body;
}
const files = ['CueCard-1.1.0-mac-arm64.dmg', 'CueCard-1.1.0-mac-x64.dmg', 'CueCard-1.1.0-windows-x64.exe'].map(name => resolve('release', name));
const checksums = [];
for (const file of files) {
  if (!(await stat(file)).size) throw new Error(`Empty installer: ${file}`);
  checksums.push(`${createHash('sha256').update(await readFile(file)).digest('hex')}  ${basename(file)}`);
}
const checksumFile = resolve('release', 'SHA256SUMS.txt');
await writeFile(checksumFile, `${checksums.join('\n')}\n`);
files.push(checksumFile);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
let release = (await api('/releases')).find(item => item.tag_name === tag);
if (!release) release = await api('/releases', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tag_name: tag, target_commitish: commit, name: 'CueCard 1.1.0 — Desktop preview', draft: true, prerelease: true,
    body: 'Installable CueCard for Apple silicon Macs, Intel Macs, and Windows x64.\n\nSetup, PDF/DOCX résumé parsing, and microphone/system audio capture run inside the app. No local development server or browser bridge is required. Bring your own Deepgram key and AI-provider key.\n\nPreview status: installers are unsigned; macOS notarization is not configured. The packaged Mac setup/session flow passed smoke testing. Windows installer construction is verified, but live Windows audio and live provider calls still require device testing. Automatic updates and account/subscription services are not included. Use the operating system’s normal permission controls and assistance only where permitted.\n\nChoose the installer matching your device. SHA256SUMS.txt contains file checksums.' }),
});
for (const file of files) {
  const name = basename(file);
  if (release.assets.some(asset => asset.name === name)) { console.log(`Already uploaded: ${name}`); continue; }
  const response = await fetch(`${release.upload_url.split('{')[0]}?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: await readFile(file),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Asset upload failed (${response.status}): ${result.message}`);
  console.log(`Uploaded ${result.name} (${result.size} bytes)`);
}
release = await api(`/releases/${release.id}`);
if (!files.every(file => release.assets.some(asset => asset.name === basename(file) && asset.state === 'uploaded'))) throw new Error('Release assets are incomplete.');
if (release.draft) release = await api(`/releases/${release.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: false }) });
console.log(JSON.stringify({ url: release.html_url, assets: release.assets.map(asset => ({ name: asset.name, size: asset.size, url: asset.browser_download_url })) }));
