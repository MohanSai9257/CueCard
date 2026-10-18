import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const executable = process.argv[2];
if (!executable) throw new Error('Pass the packaged CueCard executable path.');
if (process.argv.includes('--installed-profile'))
  throw new Error('Smoke checks use isolated profiles to protect saved user credentials.');
const profile = await mkdtemp(join(tmpdir(), 'cuecard-smoke-'));
const debugPort = process.argv.includes('--source-app') ? 9328 : 9324;
const child = spawn(
  executable,
  [
    ...(process.argv.includes('--source-app') ? [process.cwd()] : []),
    `--remote-debugging-port=${debugPort}`,
    ...(process.argv.includes('--installed-profile') ? [] : [`--user-data-dir=${profile}`]),
  ],
  { stdio: process.argv.includes('--verbose') ? 'inherit' : 'ignore' },
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sockets = [];
const execFileAsync = promisify(execFile);
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(ws);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const value = JSON.parse(event.data);
    if (value.id) {
      pending.get(value.id)?.(value);
      pending.delete(value.id);
    }
  };
  return async (method, params = {}) => {
    const id = ++seq;
    const result = new Promise((resolve) => pending.set(id, resolve));
    ws.send(JSON.stringify({ id, method, params }));
    const value = await Promise.race([
      result,
      pause(10000).then(() => {
        throw new Error(`Timeout: ${method}`);
      }),
    ]);
    if (value.error || value.result?.exceptionDetails)
      throw new Error(JSON.stringify(value.error || value.result.exceptionDetails));
    return value.result;
  };
}
try {
  let pages;
  for (let i = 0; i < 50; i++) {
    try {
      pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    } catch {}
    if (pages?.filter((x) => x.type === 'page' && x.url.includes('index.html')).length === 2) break;
    await pause(200);
  }
  const setup = await connect(
    pages.find((x) => x.url.includes('index.html') && !x.url.includes('overlay=1')),
  );
  const overlay = await connect(pages.find((x) => x.url.includes('overlay=1')));
  const evaluate = (call, expression) =>
    call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  await pause(300);
  const initial = (
    await evaluate(
      setup,
      `({ modelCount: document.querySelector('#model').options.length, native: typeof window.cuecard.startSession, setupVisible: !document.querySelector('#setupView').classList.contains('hidden') })`,
    )
  ).result.value;
  if (!initial.modelCount || initial.native !== 'function' || !initial.setupVisible)
    throw new Error(`Setup failed: ${JSON.stringify(initial)}`);
  const protection = (await evaluate(setup, `window.cuecard.captureProtectionStatus()`)).result.value;
  if (!protection.setup || !protection.overlay)
    throw new Error(`Capture protection is not on by default: ${JSON.stringify(protection)}`);
  if (
    protection.platform === 'darwin' &&
    (protection.dockVisible || protection.menuBarAvailable || !protection.showShortcutRegistered)
  )
    throw new Error(`Dock/menu-bar behavior failed: ${JSON.stringify(protection)}`);
  console.log(JSON.stringify({ captureProtection: protection }));
  let privacyProbe;
  async function probePrivacy(mode) {
    if (!process.argv.includes('--privacy-probe')) return;
    if (!privacyProbe) {
      privacyProbe = join(profile, 'privacy-probe');
      await execFileAsync('swiftc', [
        new URL('./privacy-probe.swift', import.meta.url).pathname,
        '-o',
        privacyProbe,
      ]);
    }
    const page = mode === 'setup' ? setup : overlay;
    const dimensions = (await evaluate(page, `[outerWidth,outerHeight]`)).result.value;
    const { stdout } = await execFileAsync(privacyProbe, [
      String(child.pid),
      join(profile, `capture-${mode}.png`),
      ...dimensions.map(String),
    ]);
    const result = JSON.parse(stdout);
    if (!result.nativeSharingStates?.length || result.nativeSharingStates.some((state) => state !== 0))
      throw new Error(`Native sharing protection not set: ${stdout}`);
    console.log(JSON.stringify({ privacyProbe: mode, ...result }));
    if (mode === 'overlay') {
      await evaluate(
        overlay,
        `(() => { const canvas=document.createElement('canvas'); canvas.id='privacyTestMarker'; canvas.width=innerWidth; canvas.height=innerHeight; Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100%',height:'100%',zIndex:'2147483647'}); const context=canvas.getContext('2d'); for(let y=0;y<canvas.height;y+=32)for(let x=0;x<canvas.width;x+=32){context.fillStyle=(x/32+y/32)%2?'#08f040':'#f008d0';context.fillRect(x,y,32,32);}document.body.append(canvas); })()`,
      );
      await pause(250);
      try {
        const display = await execFileAsync(privacyProbe, [
          String(child.pid),
          join(profile, 'unused.png'),
          ...dimensions.map(String),
          'display',
        ]);
        console.log(JSON.stringify({ privacyProbe: 'full-display', ...JSON.parse(display.stdout) }));
      } finally {
        await evaluate(overlay, `document.querySelector('#privacyTestMarker')?.remove()`);
      }
    }
  }
  await probePrivacy('setup');
  await evaluate(
    setup,
    `Promise.all([window.cuecard.saveKey('gemini','smoke-test'),window.cuecard.saveKey('deepgram','smoke-test')])`,
  );
  if (process.argv.includes('--manual-system-probe')) {
    await evaluate(
      setup,
      `(() => { resume = {name:'Test.docx',text:'Test résumé'}; for (const id of ['role','company','jobDescription']) document.getElementById(id).value = 'smoke-test'; document.querySelector('.policy-check input').checked = true; })()`,
    );
    console.log(JSON.stringify({ manualSetupReady: true, pid: child.pid }));
    for (let attempt = 0; attempt < 120; attempt++) {
      if (
        (await evaluate(overlay, `!document.querySelector('#interviewView').classList.contains('hidden')`))
          .result.value
      )
        break;
      await pause(500);
    }
  } else {
    await evaluate(
      setup,
      `window.cuecard.startSession({apiKey:'smoke-test',transcriptionKey:'smoke-test',provider:'gemini',model:'gemini-3.8-flash',role:'Test',company:'Test',jobDescription:'Test role',resumeText:'Test résumé'})`,
    );
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await evaluate(overlay, `recorder?.state === 'recording'`)).result.value) break;
    await pause(100);
  }
  const live = (
    await evaluate(
      overlay,
      `({ visible: !document.querySelector('#interviewView').classList.contains('hidden'), questionHint: document.querySelector('#question').placeholder, audioButtons: document.querySelectorAll('.audio-control').length, screenButton: !!document.querySelector('#analyzeScreen'), answer:document.querySelector('#answer').textContent, audioState:audioContext?.state, recorder:recorder?.state })`,
    )
  ).result.value;
  if (!live.visible || live.audioButtons !== 2 || !live.questionHint.includes('Enable') || !live.screenButton)
    throw new Error(`Overlay failed: ${JSON.stringify(live)}`);
  await probePrivacy('overlay');
  const compactLayout = (
    await evaluate(
      overlay,
      `(() => {
      const question = document.querySelector('#question');
      const style = getComputedStyle(question);
      const lines = (question.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / parseFloat(style.lineHeight);
      return { lines, headingRemoved: !document.querySelector('.question-heading .section-label'), statusHidden: getComputedStyle(document.querySelector('#audioStatus')).display === 'none', toolbarHeight: document.querySelector('.window-bar').getBoundingClientRect().height, audioHeight: document.querySelector('.audio-control').getBoundingClientRect().height };
    })()`,
    )
  ).result.value;
  if (
    Math.abs(compactLayout.lines - 2) > 0.1 ||
    !compactLayout.headingRemoved ||
    !compactLayout.statusHidden ||
    compactLayout.toolbarHeight !== 48 ||
    compactLayout.audioHeight !== 40
  )
    throw new Error('Compact layout failed: ' + JSON.stringify(compactLayout));
  console.log(JSON.stringify({ compactLayout }));
  const textSizing = (
    await evaluate(
      overlay,
      `(() => {
    const geometry = () => JSON.stringify({ width:outerWidth, height:outerHeight, viewport:[innerWidth,innerHeight], boxes:['.window-bar','.answer-nav'].map(selector=>{const box=document.querySelector(selector).getBoundingClientRect();return [box.x,box.y,box.width,box.height];}) });
    const before = geometry();
    const toolbarFont = getComputedStyle(document.querySelector('#zoomIn')).fontSize;
    for(let i=0;i<30;i++) document.querySelector('#zoomIn').click();
    const larger = { answer:getComputedStyle(answerEl).fontSize, question:getComputedStyle(questionEl).fontSize, geometry:geometry(), limited:document.querySelector('#zoomIn').disabled };
    for(let i=0;i<30;i++) document.querySelector('#zoomOut').click();
    const smaller = { answer:getComputedStyle(answerEl).fontSize, question:getComputedStyle(questionEl).fontSize, geometry:geometry(), limited:document.querySelector('#zoomOut').disabled };
    for(let i=0;i<3;i++) document.querySelector('#zoomIn').click();
    return { larger:larger.answer, smaller:smaller.answer, stable:before===larger.geometry&&before===smaller.geometry, limits:larger.limited&&smaller.limited, questionSized:larger.question==='27px'&&smaller.question==='10px', toolbarStable:toolbarFont===getComputedStyle(document.querySelector('#zoomIn')).fontSize, pageZoom:getComputedStyle(document.documentElement).zoom };
  })()`,
    )
  ).result.value;
  if (
    !textSizing.stable ||
    !textSizing.limits ||
    !textSizing.questionSized ||
    !textSizing.toolbarStable ||
    textSizing.larger !== '28px' ||
    textSizing.smaller !== '11px' ||
    textSizing.pageZoom !== '1'
  )
    throw new Error(`Text sizing changed window/layout: ${JSON.stringify(textSizing)}`);
  console.log(JSON.stringify({ textSizing }));
  const appearance = (
    await evaluate(
      overlay,
      `(async () => {
    const background = getComputedStyle(document.body).backgroundColor;
    const textOpacity = getComputedStyle(answerEl).opacity;
    document.querySelector('#appearanceBtn').click();
    const opened = !document.querySelector('#appearancePanel').classList.contains('hidden');
    const range = document.querySelector('#panelOpacity'); range.value='15'; range.dispatchEvent(new Event('input', {bubbles:true}));
    const lower = getComputedStyle(document.body).backgroundColor;
    const interactive = !document.querySelector('#clickThroughToggle') && !('setClickThrough' in window.cuecard);
    range.value='30'; range.dispatchEvent(new Event('input', {bubbles:true})); closeAppearance();
    return {background, lower, textOpacity, opened, interactive, stored:localStorage.getItem('cuecard.overlay.opacity')};
  })()`,
    )
  ).result.value;
  if (
    !appearance.background.includes('0.3') ||
    !appearance.lower.includes('0.15') ||
    appearance.textOpacity !== '1' ||
    !appearance.opened ||
    !appearance.interactive ||
    appearance.stored !== '30'
  )
    throw new Error('Appearance/interactivity failed: ' + JSON.stringify(appearance));
  console.log(JSON.stringify({ appearance }));
  if (process.argv.includes('--manual-system-probe')) {
    await evaluate(overlay, `config.transcriptionKey = ''`);
    console.log(JSON.stringify({ manualSystemProbeReady: true, pid: child.pid }));
    let capture;
    for (let attempt = 0; attempt < 120; attempt++) {
      await pause(500);
      capture = (
        await evaluate(
          overlay,
          `({live:!!systemStream?.getAudioTracks().some(t=>t.readyState==='live'),message:answerEl.textContent})`,
        )
      ).result.value;
      if (capture.live || capture.message.startsWith('System audio:')) break;
    }
    console.log(JSON.stringify({ manualSystemCapture: capture }));
    if (!capture.live) throw new Error(`Real-click system capture failed: ${JSON.stringify(capture)}`);
    console.log(JSON.stringify({ passed: true, realButtonClick: true }));
    process.exitCode = 0;
    await evaluate(overlay, `stopInterview(false)`);
    for (const ws of sockets) ws.close();
    child.kill('SIGTERM');
    // Manual capture probes run separately from the history/answer smoke test.
    await pause(100);
    process.exit(0);
  }
  if (process.argv.includes('--window-probe')) {
    const nativeProbe = join(profile, 'window-order');
    await execFileAsync('swiftc', [
      new URL('./window-order.swift', import.meta.url).pathname,
      '-o',
      nativeProbe,
    ]);
    for (const compact of [false, true]) {
      if (compact) {
        await evaluate(overlay, `document.querySelector('#hideBtn').click()`);
        await pause(400);
      }
      for (const app of ['Google Chrome', 'Microsoft Teams', 'WhatsApp']) {
        console.log(JSON.stringify({ windowProbeReady: app, compact, pid: child.pid }));
        let order;
        for (let attempt = 0; attempt < 50; attempt++) {
          await pause(700);
          const { stdout } = await execFileAsync(nativeProbe, [String(child.pid), app]);
          order = JSON.parse(stdout);
          if (order.targetFocused && order.aboveTarget) break;
        }
        console.log(JSON.stringify({ windowProbe: order, compact }));
        if (!order.targetFocused || !order.aboveTarget)
          throw new Error(`Overlay stacking failed: ${JSON.stringify(order)}`);
      }
      if (compact) {
        await evaluate(overlay, `document.querySelector('#miniRestore').click()`);
        await pause(400);
      }
    }
  }
  await evaluate(overlay, `document.querySelector('#answerNow').click()`);
  const hint = (await evaluate(overlay, `document.querySelector('#answer').textContent`)).result.value;
  if (!hint.includes('No speech detected yet')) throw new Error(`Answer control failed: ${hint}`);
  const controls = (
    await evaluate(
      overlay,
      `(() => { const q = document.querySelector('#question'); q.value = 'Typed question'; q.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#clearQuestion').click(); if (q.value !== '') throw new Error('Clear failed'); addAnswer({question:'First',answer:'Answer one'}); addAnswer({question:'Second',answer:'Answer two'}); document.querySelector('#previousAnswer').click(); const previous = {question:q.value, answer:document.querySelector('#answer').textContent, nextDisabled:document.querySelector('#nextAnswer').disabled}; document.querySelector('#nextAnswer').click(); return {previous, next:q.value, count:document.querySelector('#answerPosition').textContent}; })()`,
    )
  ).result.value;
  if (
    controls.previous.question !== 'First' ||
    controls.previous.answer !== 'Answer one' ||
    controls.previous.nextDisabled ||
    controls.next !== 'Second' ||
    controls.count !== '2 / 2'
  )
    throw new Error(`Question/history controls failed: ${JSON.stringify(controls)}`);
  await evaluate(
    overlay,
    `(() => { window.__originalRequestCue = requestCue; requestCue = async () => ({ question: 'Typed question', answer: 'Typed answer' }); const q = document.querySelector('#question'); q.value = 'Typed question'; q.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#answerNow').click(); })()`,
  );
  await pause(300);
  const typedAnswer = (
    await evaluate(
      overlay,
      `({ answer:document.querySelector('#answer').textContent, count:document.querySelector('#answerPosition').textContent })`,
    )
  ).result.value;
  await evaluate(overlay, `requestCue = window.__originalRequestCue`);
  if (typedAnswer.answer !== 'Typed answer' || typedAnswer.count !== '3 / 3')
    throw new Error(`Typed answer failed: ${JSON.stringify(typedAnswer)}`);
  const navigation = (
    await evaluate(
      overlay,
      `(() => { document.querySelector('#previousAnswer').click(); const back = document.querySelector('#answer').textContent; document.querySelector('#nextAnswer').click(); const forward = document.querySelector('#answer').textContent; document.querySelector('#nextAnswer').click(); const edge = document.querySelector('#historyHint').textContent; return { back, forward, edge }; })()`,
    )
  ).result.value;
  if (
    navigation.back !== 'Answer two' ||
    navigation.forward !== 'Typed answer' ||
    !navigation.edge.includes('latest')
  )
    throw new Error(`Generated cue navigation failed: ${JSON.stringify(navigation)}`);
  const retryFlow = (
    await evaluate(
      overlay,
      `(async () => {
    const original = requestCue;
    const savedHistory = [...history]; const savedIndex = historyIndex;
    try {
      requestCue = async () => { const error = new Error('Temporary limit'); error.retrySeconds = 1; throw error; };
      await processAudio('Old question');
      const saved = retryRecording === 'Old question';
      questionEl.value = 'New question'; questionEl.dispatchEvent(new Event('input', {bubbles:true}));
      const replaced = retryRecording === null && retryAfter > Date.now();
      retryAfter = 0; clearInterval(cooldownTimer);
      let submitted;
      requestCue = async input => { submitted = input.question; return {question:input.question, answer:'New answer'}; };
      forceAnswer(); await new Promise(resolve => setTimeout(resolve, 100));
      const latestAnswered = submitted === 'New question' && answerEl.textContent === 'New answer';
      let release;
      requestCue = () => new Promise(resolve => { release = resolve; });
      const pending = processAudio('Earlier request');
      await new Promise(resolve => setTimeout(resolve, 0));
      questionEl.value = 'Next draft'; questionEl.dispatchEvent(new Event('input', {bubbles:true}));
      release({question:'Earlier request',answer:'Earlier answer'}); await pending;
      const draftPreserved = questionEl.value === 'Next draft' && questionManuallyEdited;
      const oldRecorder = recorder; const oldSpeech = speechStartedAt; const oldLive = liveTranscription; const oldKey = config.transcriptionKey;
      let freshAudioSelected = false;
      try {
        retryRecording = null; questionEl.value = 'Earlier displayed question'; questionManuallyEdited = false;
        liveTranscription = null; config.transcriptionKey = ''; speechStartedAt = performance.now();
        recorder = {state:'recording', stop(){ freshAudioSelected = true; }};
        forceAnswer();
      } finally { recorder = oldRecorder; speechStartedAt = oldSpeech; liveTranscription = oldLive; config.transcriptionKey = oldKey; }
      retryRecording = 'Old audio'; document.querySelector('#clearQuestion').click();
      return {saved, replaced, latestAnswered, draftPreserved, freshAudioSelected, clearDropsRetry:retryRecording === null};
    } finally {
      requestCue = original; clearInterval(cooldownTimer); retryAfter = 0; retryRecording = null;
      history = savedHistory; historyIndex = savedIndex; renderHistory();
      document.querySelector('#answerNow').disabled = false; document.querySelector('#answerNow').textContent = 'Answer now';
    }
  })()`,
    )
  ).result.value;
  if (Object.values(retryFlow).some((value) => value !== true))
    throw new Error('Question retry regression: ' + JSON.stringify(retryFlow));
  console.log(JSON.stringify({ retryFlow }));
  for (const [name, page] of [
    ['setup', setup],
    ['overlay', overlay],
  ]) {
    const titles = (
      await evaluate(
        page,
        `Array.from(document.querySelectorAll('[title]')).map(element => element.id || element.tagName)`,
      )
    ).result.value;
    if (titles.length) throw new Error(name + ' still has hover tooltips: ' + JSON.stringify(titles));
  }
  console.log(JSON.stringify({ hoverTooltips: false }));
  await evaluate(overlay, `document.querySelector('#hideBtn').click()`);
  await pause(200);
  const compact = (await evaluate(overlay, `document.body.classList.contains('mini-mode')`)).result.value;
  if (!compact) throw new Error('Collapse did not enter mini mode.');
  const compactProtection = (await evaluate(overlay, `window.cuecard.captureProtectionStatus()`)).result
    .value;
  if (!compactProtection.setup || !compactProtection.overlay)
    throw new Error('Capture protection was lost in compact mode.');
  await probePrivacy('compact');
  const compactBefore = (
    await evaluate(
      overlay,
      `({ x: window.screenX, y: window.screenY, radius: getComputedStyle(document.body).borderRadius, buttonRadius: getComputedStyle(document.querySelector('#miniRestore')).borderRadius })`,
    )
  ).result.value;
  await overlay('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 36,
    y: 36,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await overlay('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 48, y: 46, button: 'left', buttons: 1 });
  await overlay('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 48,
    y: 46,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await pause(150);
  const pointerDrag = (
    await evaluate(
      overlay,
      `({ x:window.screenX, y:window.screenY, compact:document.body.classList.contains('mini-mode') })`,
    )
  ).result.value;
  if (!pointerDrag.compact || (pointerDrag.x === compactBefore.x && pointerDrag.y === compactBefore.y))
    throw new Error(`Pointer drag failed: ${JSON.stringify({ compactBefore, pointerDrag })}`);
  await evaluate(overlay, `window.cuecard.moveCompact(-35, 25)`);
  await pause(200);
  const compactAfter = (await evaluate(overlay, `({ x: window.screenX, y: window.screenY })`)).result.value;
  if (
    compactBefore.radius !== '50%' ||
    compactBefore.buttonRadius !== '50%' ||
    compactAfter.x !== pointerDrag.x - 35 ||
    compactAfter.y !== pointerDrag.y + 25
  )
    throw new Error(`Compact drag failed: ${JSON.stringify({ compactBefore, pointerDrag, compactAfter })}`);
  await evaluate(overlay, `document.querySelector('#miniRestore').click()`);
  await pause(200);
  const restored = (await evaluate(overlay, `!document.body.classList.contains('mini-mode')`)).result.value;
  if (!restored) throw new Error('Mini mode did not restore.');
  if (process.argv.includes('--audio-probe')) {
    // Isolate provider networking while exercising the real local audio pipeline.
    await evaluate(
      overlay,
      `(() => { if(liveTranscription){liveTranscription.onError=()=>{};liveTranscription.stop();liveTranscription=null;} LiveTranscription.prototype.start=function(){}; })()`,
    );
    const audio = (
      await evaluate(
        overlay,
        `Promise.race([ (async () => { config.transcriptionKey = ''; await toggleMicAudio(); const mic = { live: !!micStream?.getAudioTracks().some(t => t.readyState === 'live'), error: document.querySelector('#answer').textContent }; await toggleSystemAudio(); const system = { live: !!systemStream?.getAudioTracks().some(t => t.readyState === 'live'), error: document.querySelector('#answer').textContent }; return { mic, system }; })(), new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 8000)) ])`,
      )
    ).result.value;
    console.log(JSON.stringify({ audioProbe: audio }));
    if (!audio.mic?.live || !audio.system?.live)
      throw new Error(`Audio capture failed: ${JSON.stringify(audio)}`);
    if (audio.system?.live) {
      await evaluate(
        overlay,
        `(() => { window.__cuecardProbeMax = 0; const analyser = audioContext.createAnalyser(); analyser.fftSize = 1024; audioContext.createMediaStreamSource(systemStream).connect(analyser); const samples = new Uint8Array(analyser.fftSize); window.__cuecardProbeTimer = setInterval(() => { analyser.getByteTimeDomainData(samples); let sum = 0; for (const sample of samples) { const value = (sample - 128) / 128; sum += value * value; } window.__cuecardProbeMax = Math.max(window.__cuecardProbeMax, Math.sqrt(sum / samples.length)); }, 25); })()`,
      );
      const sound = spawn('afplay', ['/System/Library/Sounds/Glass.aiff'], { stdio: 'ignore' });
      await pause(2000);
      sound.kill('SIGTERM');
      const level = (
        await evaluate(
          overlay,
          `(() => { clearInterval(window.__cuecardProbeTimer); return window.__cuecardProbeMax; })()`,
        )
      ).result.value;
      console.log(JSON.stringify({ systemAudioMaxRms: level }));
      if (level < 0.01) throw new Error(`System audio track opened but captured no sound: ${level}`);
      await evaluate(
        overlay,
        `(() => { config.transcriptionKey = 'smoke-test'; window.__originalRequestCue = requestCue; window.__transcriptionCalls = 0; requestCue = async input => { if (!(input.audio instanceof ArrayBuffer) || input.audio.byteLength <= 44) throw new Error('Invalid WAV recording'); window.__transcriptionCalls++; return {question:'Question heard from system audio',answer:'Audio answer'}; }; questionEl.value = ''; questionManuallyEdited = false; speechStartedAt = performance.now(); document.querySelector('#answerNow').click(); })()`,
      );
      await pause(600);
      const fallback = (
        await evaluate(
          overlay,
          `({calls:window.__transcriptionCalls,answer:document.querySelector('#answer').textContent})`,
        )
      ).result.value;
      await evaluate(overlay, `requestCue = window.__originalRequestCue`);
      if (!fallback.calls || fallback.answer !== 'Audio answer')
        throw new Error(`Recorded-audio fallback failed: ${JSON.stringify(fallback)}`);
    }
  }
  const shot = await overlay('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(profile, 'overlay.png'), Buffer.from(shot.data, 'base64'));
  await evaluate(overlay, `document.querySelector('#settingsBtn').click()`);
  await pause(200);
  const stopped = (await evaluate(overlay, `stream === null && recorder === null`)).result.value;
  if (!stopped) throw new Error('Settings did not stop capture.');
  console.log(
    JSON.stringify({
      passed: true,
      setup: initial,
      overlay: live,
      screenshot: join(profile, 'overlay.png'),
      networkProvidersCalled: false,
    }),
  );
} finally {
  for (const ws of sockets) ws.close();
  child.kill('SIGTERM');
}
