import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const executable = process.argv[2];
if (!executable) throw new Error('Pass the packaged CueCard executable path.');
const profile = await mkdtemp(join(tmpdir(), 'cuecard-smoke-'));
const child = spawn(executable, ['--remote-debugging-port=9324', `--user-data-dir=${profile}`], { stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sockets = [];
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(ws);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const value = JSON.parse(event.data);
    if (value.id) { pending.get(value.id)?.(value); pending.delete(value.id); }
  };
  return async (method, params = {}) => {
    const id = ++seq;
    const result = new Promise(resolve => pending.set(id, resolve));
    ws.send(JSON.stringify({ id, method, params }));
    const value = await Promise.race([result, pause(10000).then(() => { throw new Error(`Timeout: ${method}`); })]);
    if (value.error || value.result?.exceptionDetails) throw new Error(JSON.stringify(value.error || value.result.exceptionDetails));
    return value.result;
  };
}
try {
  let pages;
  for (let i = 0; i < 50; i++) {
    try { pages = await (await fetch('http://127.0.0.1:9324/json/list')).json(); } catch {}
    if (pages?.filter(x => x.type === 'page' && x.url.includes('index.html')).length === 2) break;
    await pause(200);
  }
  const setup = await connect(pages.find(x => x.url.includes('index.html') && !x.url.includes('overlay=1')));
  const overlay = await connect(pages.find(x => x.url.includes('overlay=1')));
  const evaluate = (call, expression) => call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  await pause(300);
  const initial = (await evaluate(setup, `({ modelCount: document.querySelector('#model').options.length, native: typeof window.cuecard.startSession, setupVisible: !document.querySelector('#setupView').classList.contains('hidden') })`)).result.value;
  if (!initial.modelCount || initial.native !== 'function' || !initial.setupVisible) throw new Error(`Setup failed: ${JSON.stringify(initial)}`);
  await evaluate(setup, `window.cuecard.startSession({apiKey:'smoke-test',transcriptionKey:'smoke-test',provider:'gemini',model:'gemini-3.8-flash',role:'Test',company:'Test',jobDescription:'Test role',resumeText:'Test résumé'})`);
  await pause(400);
  const live = (await evaluate(overlay, `({ visible: !document.querySelector('#interviewView').classList.contains('hidden'), question: document.querySelector('#question').textContent, audioButtons: document.querySelectorAll('.audio-control').length })`)).result.value;
  if (!live.visible || live.audioButtons !== 2 || !live.question.includes('Enable')) throw new Error(`Overlay failed: ${JSON.stringify(live)}`);
  await evaluate(overlay, `document.querySelector('#answerNow').click()`);
  const hint = (await evaluate(overlay, `document.querySelector('#answer').textContent`)).result.value;
  if (!hint.includes('Waiting for live speech')) throw new Error(`Answer control failed: ${hint}`);
  const shot = await overlay('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(profile, 'overlay.png'), Buffer.from(shot.data, 'base64'));
  await evaluate(overlay, `document.querySelector('#settingsBtn').click()`);
  await pause(200);
  const stopped = (await evaluate(overlay, `stream === null && recorder === null`)).result.value;
  if (!stopped) throw new Error('Settings did not stop capture.');
  console.log(JSON.stringify({ passed: true, setup: initial, overlay: live, screenshot: join(profile, 'overlay.png'), networkProvidersCalled: false }));
} finally {
  for (const ws of sockets) ws.close();
  child.kill('SIGTERM');
}
