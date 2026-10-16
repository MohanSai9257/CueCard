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
  const live = (await evaluate(overlay, `({ visible: !document.querySelector('#interviewView').classList.contains('hidden'), questionHint: document.querySelector('#question').placeholder, audioButtons: document.querySelectorAll('.audio-control').length, screenButton: !!document.querySelector('#analyzeScreen') })`)).result.value;
  if (!live.visible || live.audioButtons !== 2 || !live.questionHint.includes('Enable') || !live.screenButton) throw new Error(`Overlay failed: ${JSON.stringify(live)}`);
  await evaluate(overlay, `document.querySelector('#answerNow').click()`);
  const hint = (await evaluate(overlay, `document.querySelector('#answer').textContent`)).result.value;
  if (!hint.includes('Type a question')) throw new Error(`Answer control failed: ${hint}`);
  const controls = (await evaluate(overlay, `(() => { const q = document.querySelector('#question'); q.value = 'Typed question'; q.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#clearQuestion').click(); if (q.value !== '') throw new Error('Clear failed'); addAnswer({question:'First',answer:'Answer one'}); addAnswer({question:'Second',answer:'Answer two'}); document.querySelector('#previousAnswer').click(); const previous = {question:q.value, answer:document.querySelector('#answer').textContent, nextDisabled:document.querySelector('#nextAnswer').disabled}; document.querySelector('#nextAnswer').click(); return {previous, next:q.value, count:document.querySelector('#answerPosition').textContent}; })()`)).result.value;
  if (controls.previous.question !== 'First' || controls.previous.answer !== 'Answer one' || controls.previous.nextDisabled || controls.next !== 'Second' || controls.count !== '2 / 2') throw new Error(`Question/history controls failed: ${JSON.stringify(controls)}`);
  await evaluate(overlay, `(() => { config.provider = 'openai'; window.__originalFetch = window.fetch; window.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ question: 'Typed question', answer: 'Typed answer' }) } }] }) }); const q = document.querySelector('#question'); q.value = 'Typed question'; q.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#answerNow').click(); })()`);
  await pause(300);
  const typedAnswer = (await evaluate(overlay, `({ answer:document.querySelector('#answer').textContent, count:document.querySelector('#answerPosition').textContent })`)).result.value;
  await evaluate(overlay, `window.fetch = window.__originalFetch`);
  if (typedAnswer.answer !== 'Typed answer' || typedAnswer.count !== '3 / 3') throw new Error(`Typed answer failed: ${JSON.stringify(typedAnswer)}`);
  await evaluate(overlay, `document.querySelector('#hideBtn').click()`);
  await pause(200);
  const compact = (await evaluate(overlay, `document.body.classList.contains('mini-mode')`)).result.value;
  if (!compact) throw new Error('Collapse did not enter mini mode.');
  await evaluate(overlay, `document.querySelector('#miniRestore').click()`);
  await pause(200);
  const restored = (await evaluate(overlay, `!document.body.classList.contains('mini-mode')`)).result.value;
  if (!restored) throw new Error('Mini mode did not restore.');
  if (process.argv.includes('--audio-probe')) {
    const audio = (await evaluate(overlay, `Promise.race([ (async () => { config.transcriptionKey = ''; await toggleMicAudio(); const mic = { live: !!micStream?.getAudioTracks().some(t => t.readyState === 'live'), error: document.querySelector('#answer').textContent }; await toggleSystemAudio(); const system = { live: !!systemStream?.getAudioTracks().some(t => t.readyState === 'live'), error: document.querySelector('#answer').textContent }; return { mic, system }; })(), new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 8000)) ])`)).result.value;
    console.log(JSON.stringify({ audioProbe: audio }));
    if (audio.system?.live) {
      await evaluate(overlay, `(() => { window.__cuecardProbeMax = 0; const analyser = audioContext.createAnalyser(); analyser.fftSize = 1024; audioContext.createMediaStreamSource(systemStream).connect(analyser); const samples = new Uint8Array(analyser.fftSize); window.__cuecardProbeTimer = setInterval(() => { analyser.getByteTimeDomainData(samples); let sum = 0; for (const sample of samples) { const value = (sample - 128) / 128; sum += value * value; } window.__cuecardProbeMax = Math.max(window.__cuecardProbeMax, Math.sqrt(sum / samples.length)); }, 25); })()`);
      const sound = spawn('afplay', ['/System/Library/Sounds/Glass.aiff'], { stdio: 'ignore' });
      await pause(2000);
      sound.kill('SIGTERM');
      const level = (await evaluate(overlay, `(() => { clearInterval(window.__cuecardProbeTimer); return window.__cuecardProbeMax; })()`)).result.value;
      console.log(JSON.stringify({ systemAudioMaxRms: level }));
    }
  }
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
