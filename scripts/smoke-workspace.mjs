import { spawn } from 'node:child_process';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const executable = process.argv[2];
if (!executable) throw new Error('Pass the packaged executable.');
const profile = await mkdtemp(join(tmpdir(), 'cuecard-workspace-'));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child;
let sockets = [];
async function start() {
  child = spawn(executable, ['--remote-debugging-port=9325', `--user-data-dir=${profile}`], {
    stdio: 'ignore',
  });
  let pages;
  for (let i = 0; i < 80; i++) {
    try {
      pages = await (await fetch('http://127.0.0.1:9325/json/list')).json();
    } catch {}
    if (pages?.filter((page) => page.type === 'page' && page.url.includes('index.html')).length === 2) break;
    await pause(150);
  }
  async function connect(page) {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    sockets.push(ws);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const pending = new Map();
    let sequence = 0;
    ws.onmessage = ({ data }) => {
      const result = JSON.parse(data);
      if (result.id) {
        pending.get(result.id)?.(result);
        pending.delete(result.id);
      }
    };
    return async (method, params = {}) => {
      const id = ++sequence;
      const result = new Promise((resolve) => pending.set(id, resolve));
      ws.send(JSON.stringify({ id, method, params }));
      let timer;
      let response;
      try {
        response = await Promise.race([
          result,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Timed out: ' + method)), 20000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (response.error || response.result?.exceptionDetails)
        throw new Error(JSON.stringify(response.error || response.result.exceptionDetails));
      return response.result;
    };
  }
  const setup = await connect(
    pages.find((page) => page.url.includes('index.html') && !page.url.includes('overlay=1')),
  );
  const overlay = await connect(pages.find((page) => page.url.includes('overlay=1')));
  for (let i = 0; i < 60; i++) {
    if (await evaluate(setup, `typeof window.cueWorkspace==='object'`)) break;
    await pause(100);
  }
  return { setup, overlay };
}
async function evaluate(page, expression) {
  return (await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result
    .value;
}
async function stop(setup) {
  const closing = child;
  const exited = new Promise((resolve) => closing.once('exit', resolve));
  await evaluate(setup, 'window.cuecard.close()').catch(() => {});
  for (const socket of sockets) socket.close();
  sockets = [];
  const timer = setTimeout(() => closing.kill('SIGTERM'), 3000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
function check(value, message) {
  if (!value) throw new Error(message);
}
try {
  let { setup, overlay } = await start();
  await evaluate(setup, `window.cueWorkspace.refreshKeys()`);
  check(
    await evaluate(
      setup,
      `!document.querySelector('#createPage input[type=password]') && document.querySelectorAll('.nav-item').length===3`,
    ),
    'Credentials still in session form or missing navigation.',
  );
  await evaluate(setup, `window.cueWorkspace.showPage('keys')`);
  await pause(150);
  for (const provider of ['gemini', 'deepgram', 'claude']) {
    await evaluate(
      setup,
      `(() => { const input=document.getElementById('savedKey-${provider}'); input.value='cuecard-test-secret-${provider}-1793'; input.closest('.key-card').querySelector('.key-save').click(); })()`,
    );
    await pause(250);
    check(
      await evaluate(setup, `window.cuecard.keysStatus().then(data=>data.${provider}.saved)`),
      `Saving ${provider} failed.`,
    );
  }
  check(
    await evaluate(
      setup,
      `document.querySelector('#savedKey-gemini').value==='' && document.querySelector('#savedKey-gemini').type==='password'`,
    ),
    'Saved key was exposed in the form.',
  );
  await evaluate(
    setup,
    `document.querySelector('#savedKey-gemini').closest('.key-card').querySelector('.reveal-key').click()`,
  );
  await pause(150);
  check(
    await evaluate(
      setup,
      `document.querySelector('#savedKey-gemini').value==='cuecard-test-secret-gemini-1793' && document.querySelector('#savedKey-gemini').type==='text'`,
    ),
    'Reveal key failed.',
  );
  await evaluate(setup, `window.cueWorkspace.showPage('create')`);
  check(
    await evaluate(
      setup,
      `document.querySelector('#savedKey-gemini').value==='' && document.querySelector('#savedKey-gemini').type==='password'`,
    ),
    'Revealed key was retained after navigation.',
  );
  await evaluate(setup, `window.cueWorkspace.showPage('keys'); window.cueWorkspace.refreshKeys()`);
  const encrypted = await readFile(join(profile, 'credentials.enc'));
  check(!encrypted.includes(Buffer.from('cuecard-test-secret')), 'Plaintext credentials found on disk.');
  check(
    ((await stat(join(profile, 'credentials.enc'))).mode & 0o777) === 0o600,
    'Credentials permissions are too broad.',
  );
  check(
    await evaluate(overlay, `window.cuecard.revealKey('gemini').then(()=>false,()=>true)`),
    'Overlay can reveal vault keys.',
  );
  check(
    await evaluate(setup, `window.cuecard.getPendingSession().then(value=>value===null)`),
    'Setup exposes pending session secrets.',
  );
  let shot = await setup('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(profile, 'api-keys.png'), Buffer.from(shot.data, 'base64'));
  await evaluate(
    setup,
    `(() => { window.cueWorkspace.showPage('create'); resume={name:'Test.docx',text:'Backend engineering experience'}; document.querySelector('#role').value='Backend Engineer'; document.querySelector('#company').value='Acme'; document.querySelector('#jobDescription').value='Build reliable services'; document.querySelector('#sessionType').value='mock'; document.querySelector('#responsibleUse').checked=true; document.querySelector('#setupForm').requestSubmit(); })()`,
  );
  await pause(450);
  check(
    await evaluate(
      overlay,
      `config?.apiKey===undefined && config?.transcriptionKey==='cuecard-test-secret-deepgram-1793'`,
    ),
    'AI credentials leaked to the overlay or transcription key missing.',
  );
  await evaluate(
    overlay,
    `addAnswer({question:'Tell me about yourself',answer:'A saved cue from supplied context.'}); addAnswer({question:'<img src=x onerror=alert(1)>',answer:'Plain text, safely rendered.'})`,
  );
  await evaluate(overlay, `document.querySelector('#settingsBtn').click()`);
  await pause(400);
  await evaluate(setup, `window.cueWorkspace.showPage('sessions')`);
  await pause(250);
  check(
    await evaluate(
      setup,
      `document.querySelectorAll('.session-card').length===1 && document.querySelector('.session-card').textContent.includes('Acme')`,
    ),
    'Session history missing.',
  );
  shot = await setup('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(profile, 'call-sessions.png'), Buffer.from(shot.data, 'base64'));
  await evaluate(setup, `document.querySelector('[data-filter=interview]').click()`);
  check(
    await evaluate(setup, `document.querySelectorAll('.session-card').length===0`),
    'Session filter failed.',
  );
  await evaluate(
    setup,
    `document.querySelector('[data-filter=mock]').click(); document.querySelector('.session-card .view-transcript').click()`,
  );
  check(
    await evaluate(
      setup,
      `document.querySelectorAll('.transcript-entry').length===2 && !document.querySelector('#transcriptEntries img') && document.querySelector('#transcriptDialog').open`,
    ),
    'Transcript failed or renders unsafe HTML.',
  );
  await evaluate(
    setup,
    `document.querySelector('#closeTranscript').click(); window.cueWorkspace.showPage('create')`,
  );
  shot = await setup('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(profile, 'create-session.png'), Buffer.from(shot.data, 'base64'));
  await stop(setup);
  ({ setup, overlay } = await start());
  check(
    await evaluate(
      setup,
      `window.cuecard.revealKey('gemini').then(key=>key==='cuecard-test-secret-gemini-1793')`,
    ),
    'Key did not survive app restart.',
  );
  check(
    await evaluate(
      setup,
      `window.cuecard.listSessions().then(items=>items.length===1&&items[0].entries.length===2&&!!items[0].endedAt)`,
    ),
    'Session did not survive restart.',
  );
  check(
    await evaluate(
      setup,
      `window.cuecard.listSessions().then(items=>!('context' in items[0])&&items[0].hasContext)`,
    ),
    'Session list leaks full context or context was not saved.',
  );
  await evaluate(setup, `window.cueWorkspace.showPage('sessions')`);
  await pause(250);
  await evaluate(setup, `document.querySelector('.continue-session').click()`);
  await pause(250);
  check(
    await evaluate(
      setup,
      `resumeSessionId!==null && resume?.name==='Test.docx' && resume.text==='Backend engineering experience' && document.querySelector('#role').value==='Backend Engineer' && document.querySelector('#jobDescription').value==='Build reliable services' && document.querySelector('#continuationBanner').textContent.includes('Round 2') && !document.querySelector('#responsibleUse').checked`,
    ),
    'Continue did not restore saved context for review.',
  );
  await evaluate(
    setup,
    `document.querySelector('#instructions').value='Use concise second-round examples'; document.querySelector('#responsibleUse').checked=true; document.querySelector('#setupForm').requestSubmit()`,
  );
  await pause(450);
  check(
    await evaluate(
      overlay,
      `history.length===2 && document.querySelector('#answerPosition').textContent==='2 / 2' && config.roundCount===2 && systemPrompt().includes('A saved cue from supplied context.') && systemPrompt().includes('Use concise second-round examples')`,
    ),
    'Resumed overlay lost history or context.',
  );
  check(
    await evaluate(overlay, `window.cuecard.loadSession(config.resumeSessionId).then(()=>false,()=>true)`),
    'Overlay can load saved private context.',
  );
  await evaluate(overlay, `document.querySelector('#previousAnswer').click()`);
  check(
    await evaluate(overlay, `questionEl.value==='Tell me about yourself'`),
    'Previous failed in resumed session.',
  );
  await evaluate(
    overlay,
    `document.querySelector('#nextAnswer').click(); addAnswer({question:'Second-round question',answer:'A new cue for round two.'}); document.querySelector('#settingsBtn').click()`,
  );
  await pause(350);
  check(
    await evaluate(
      setup,
      `window.cuecard.listSessions().then(items=>items.length===1&&items[0].roundCount===2&&items[0].entries.length===3&&items[0].entries[2].round===2)`,
    ),
    'Continued round created a duplicate or lost transcript entries.',
  );
  const encryptedSessions = await readFile(join(profile, 'sessions.enc'));
  check(
    !encryptedSessions.includes(Buffer.from('Backend engineering experience')),
    'Résumé context was stored in plaintext.',
  );
  await stop(setup);
  ({ setup, overlay } = await start());
  check(
    await evaluate(
      setup,
      `window.cuecard.listSessions().then(async items=>{const details=await window.cuecard.loadSession(items[0].id);return items.length===1&&items[0].roundCount===2&&items[0].entries.length===3&&details.instructions==='Use concise second-round examples'&&details.resumeText==='Backend engineering experience';})`,
    ),
    'Second round did not survive restart.',
  );
  check(
    await evaluate(
      setup,
      `window.cuecard.revealKey('claude').then(key=>key==='cuecard-test-secret-claude-1793')`,
    ),
    'Claude key did not survive restart.',
  );
  await evaluate(
    setup,
    `(() => { window.cueWorkspace.showPage('create'); providerEl.value='claude'; providerEl.dispatchEvent(new Event('change')); resume={name:'Test.docx',text:'Backend engineering experience'}; document.querySelector('#role').value='Backend Engineer'; document.querySelector('#company').value='Acme'; document.querySelector('#jobDescription').value='Build reliable services'; document.querySelector('#responsibleUse').checked=true; document.querySelector('#setupForm').requestSubmit(); })()`,
  );
  for (let i = 0; i < 50; i++) {
    if (await evaluate(overlay, `config?.provider==='claude' && recorder?.state==='recording'`)) break;
    await pause(100);
  }
  check(
    await evaluate(
      overlay,
      `config?.provider==='claude' && config.model==='claude-haiku-5-5' && config.apiKey===undefined && !document.querySelector('#analyzeScreen').disabled`,
    ),
    'Claude selection/start failed.',
  );
  check(
    await evaluate(
      overlay,
      `window.cuecard.generateCue({sessionId:config.sessionId,system:'x'.repeat(200001),question:'test'}).then(result=>!result.ok&&result.error.message.includes('size'))`,
    ),
    'Oversized provider request was not rejected.',
  );
  check(
    await evaluate(
      overlay,
      `window.cuecard.generateCue({sessionId:-1,system:'test',question:'test'}).then(result=>!result.ok&&result.error.cancelled)`,
    ),
    'Stale session could generate an answer.',
  );
  await evaluate(overlay, `document.querySelector('#settingsBtn').click()`);
  await pause(250);
  await evaluate(setup, `window.cuecard.removeKey('deepgram')`);
  check(
    await evaluate(setup, `window.cuecard.keysStatus().then(data=>!data.deepgram.saved&&data.gemini.saved)`),
    'Remove key affected the wrong provider.',
  );
  check(
    await evaluate(
      setup,
      `window.cuecard.startSession({provider:'gemini',model:'gemini-3.8-flash',role:'Test',company:'Test',jobDescription:'Test',resumeText:'Test'}).then(()=>false,()=>true)`,
    ),
    'Missing keys did not prevent session start.',
  );
  await stop(setup);
  console.log(
    JSON.stringify({
      passed: true,
      encryptedCredentials: true,
      restartPersistence: true,
      transcripts: true,
      continuedSession: true,
      roundsPreserved: true,
      providerRemoval: true,
      claudeSelection: true,
      requestValidation: true,
      screenshots: profile,
    }),
  );
} finally {
  for (const socket of sockets) socket.close();
  child?.kill('SIGTERM');
}
