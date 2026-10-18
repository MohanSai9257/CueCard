const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  shell,
  systemPreferences,
} = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { parseResume } = require('./resume-parser');
const { spawn } = require('child_process');
const { randomUUID } = require('node:crypto');
const { SecureStore } = require('./secure-store');
const providers = require('./providers');
const { generateCue, authHeaders } = require('./ai-client');
let activeAIRequest = null;
function cancelAIRequest() {
  activeAIRequest?.abort();
  activeAIRequest = null;
}
function publicSession(session) {
  if (!session) return null;
  const { apiKey: _apiKey, ...visible } = session;
  return visible;
}
let keyStore;
let sessionStore;
let currentRecordId = null;
const keyProviders = new Set(Object.keys(providers));
function requireSetup(event) {
  if (event.sender !== setupWindow?.webContents)
    throw new Error('Open CueCard settings to manage saved data.');
}
async function credentialStatus() {
  const data = await keyStore.snapshot();
  return Object.fromEntries(
    [...keyProviders].map((provider) => {
      const item = data[provider];
      return [
        provider,
        {
          saved: !!item?.key,
          updatedAt: item?.updatedAt,
          testedAt: item?.testedAt,
          verified: !!item?.verified,
        },
      ];
    }),
  );
}
async function finishRecord() {
  cancelAIRequest();
  const id = currentRecordId;
  currentRecordId = null;
  if (!id) return;
  await sessionStore.update((data) => {
    if (data[id])
      Object.assign(data[id], { endedAt: new Date().toISOString(), lastActiveAt: new Date().toISOString() });
  });
}

let setupWindow;
let overlayWindow;
let expandedBounds;
let pendingSession = null;
let showShortcutRegistered = false;
let sessionSequence = 0;
let nativeAudioProcess = null;
// Apply before any CueCard window is shown, including future windows and dialogs
// implemented as BrowserWindows. The compact horse uses the same protected overlay.
app.on('browser-window-created', (_, window) => {
  if (!['darwin', 'win32'].includes(process.platform)) return;
  window.setContentProtection(true);
  window.on('show', () => window.setContentProtection(true));
});
function stopNativeAudio() {
  const capture = nativeAudioProcess;
  nativeAudioProcess = null;
  capture?.kill('SIGTERM');
}
function captureLog(event, details = {}) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    version: app.getVersion(),
    event,
    ...details,
  });
  fs.mkdir(app.getPath('logs'), { recursive: true })
    .then(() => fs.appendFile(path.join(app.getPath('logs'), 'audio-capture.log'), line + '\n'))
    .catch(() => {});
}

function showSetup() {
  if (!setupWindow || setupWindow.isDestroyed()) return;
  if (setupWindow.isMinimized()) setupWindow.restore();
  setupWindow.show();
  setupWindow.focus();
}
function showAssistant() {
  if (!pendingSession || !overlayWindow || overlayWindow.isDestroyed()) return showSetup();
  if (overlayWindow.isMinimized()) overlayWindow.restore();
  overlayWindow.show();
  pinOverlay();
  overlayWindow.focus();
}
function send(channel, payload) {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send(channel, payload);
}
function pinOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return;
  overlayWindow.setAlwaysOnTop(true, process.platform === 'darwin' ? 'screen-saver' : 'pop-up-menu');
  overlayWindow.moveTop();
}
function restoreOverlayBounds() {
  if (!expandedBounds || !overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setMinimumSize(72, 72);
  overlayWindow.setBounds(expandedBounds, true);
  overlayWindow.setMinimumSize(420, 520);
  expandedBounds = null;
}
function configureWindow(window) {
  const allowedLinks = new Set(Object.values(providers).map((provider) => provider.link));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedLinks.has(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
}
function createWindows() {
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }
  const webPreferences = {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
  };
  setupWindow = new BrowserWindow({
    title: 'CueCard',
    width: 1240,
    height: 900,
    minWidth: 850,
    minHeight: 650,
    frame: false,
    backgroundColor: '#071222',
    show: false,
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences,
  });
  setupWindow.loadFile('index.html');
  setupWindow.once('ready-to-show', showSetup);
  configureWindow(setupWindow);
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  overlayWindow = new BrowserWindow({
    title: 'CueCard — Live session',
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 520,
    x: Math.max(0, width - 540),
    y: 20,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: true,
    ...(process.platform === 'darwin' ? { type: 'panel', fullscreenable: false } : {}),
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: { ...webPreferences, backgroundThrottling: false },
  });
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.on('show', pinOverlay);
  overlayWindow.on('blur', pinOverlay);
  // App/Space transitions can reorder native windows after the blur event.
  // Reassert the overlay level without activating CueCard or taking keyboard focus.
  const pinTimer = setInterval(() => {
    if (pendingSession && !overlayWindow.isMinimized()) pinOverlay();
  }, 1000);
  pinTimer.unref();
  overlayWindow.once('closed', () => clearInterval(pinTimer));
  overlayWindow.loadFile('index.html', { query: { overlay: '1' } });
  configureWindow(overlayWindow);
  const session = overlayWindow.webContents.session;
  session.setPermissionRequestHandler((contents, permission, callback) => {
    const allowed =
      ['media', 'display-capture'].includes(permission) &&
      contents === overlayWindow.webContents &&
      contents.getURL().startsWith('file://');
    captureLog('permission-request', { permission, allowed });
    callback(allowed);
  });
  session.setPermissionCheckHandler((contents, permission, requestingOrigin) => {
    const allowed =
      ['media', 'display-capture'].includes(permission) &&
      requestingOrigin.startsWith('file://') &&
      (!contents || contents === overlayWindow.webContents);
    captureLog('permission-check', { permission, allowed });
    return allowed;
  });
  session.setDisplayMediaRequestHandler(
    async (request, callback) => {
      captureLog('display-request', {
        frameMatches: request.frame === overlayWindow.webContents.mainFrame,
        audio: request.audioRequested,
        video: request.videoRequested,
        userGesture: request.userGesture,
        permission: systemPreferences.getMediaAccessStatus('screen'),
      });
      if (request.frame !== overlayWindow.webContents.mainFrame) return callback({});
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 },
        });
        captureLog('display-sources', { count: sources.length });
        if (!sources[0]) return callback({});
        callback({ video: sources[0], ...(request.audioRequested ? { audio: 'loopback' } : {}) });
      } catch (error) {
        captureLog('display-error', { name: error.name, message: error.message });
        callback({});
      }
    },
    { useSystemPicker: false },
  );
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'CueCard',
        submenu: [
          { label: 'Session settings', click: showSetup },
          { label: 'Screen-capture protection enabled (best effort)', enabled: false },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'Window',
        submenu: [{ label: 'Show assistant', click: showAssistant }, { role: 'minimize' }],
      },
    ]),
  );
  globalShortcut.register('CommandOrControl+Shift+A', () => send('force-answer'));
  globalShortcut.register('CommandOrControl+Shift+S', () => send('toggle-capture'));
  showShortcutRegistered = globalShortcut.register('CommandOrControl+Shift+H', showAssistant);
}
function trusted(event) {
  return event.sender === setupWindow?.webContents || event.sender === overlayWindow?.webContents;
}
ipcMain.handle('capture-protection-status', (event) => {
  if (!trusted(event)) throw new Error('Unknown window.');
  return {
    setup: setupWindow.isContentProtected(),
    overlay: overlayWindow.isContentProtected(),
    platform: process.platform,
    dockVisible: process.platform === 'darwin' ? app.dock.isVisible() : null,
    menuBarAvailable: false,
    showShortcutRegistered,
  };
});
ipcMain.handle('pick-resume', async (event) => {
  requireSetup(event);
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Select your résumé',
    properties: ['openFile'],
    filters: [{ name: 'Résumé', extensions: ['pdf', 'docx'] }],
  });
  if (result.canceled) return null;
  return parseResume(result.filePaths[0]);
});
ipcMain.handle('start-session', async (event, config) => {
  if (event.sender !== setupWindow?.webContents) throw new Error('Open session settings to start.');
  for (const key of ['provider', 'model', 'role', 'company', 'jobDescription', 'resumeText']) {
    if (typeof config?.[key] !== 'string' || !config[key].trim())
      throw new Error('Complete all required session fields.');
  }
  if (!providers[config.provider]?.models?.some(([model]) => model === config.model))
    throw new Error('Select a supported provider and model.');
  for (const [field, max] of Object.entries({
    role: 200,
    company: 200,
    jobDescription: 30000,
    resumeText: 100000,
    instructions: 10000,
    resumeName: 255,
  })) {
    if (config[field] !== undefined && (typeof config[field] !== 'string' || config[field].length > max))
      throw new Error(`${field} exceeds its supported length.`);
  }
  if (
    config.resumeSessionId !== undefined &&
    config.resumeSessionId !== null &&
    (typeof config.resumeSessionId !== 'string' || !/^[\da-f-]{36}$/i.test(config.resumeSessionId))
  )
    throw new Error('Select a valid saved session.');
  const saved = await keyStore.snapshot();
  const apiKey = saved[config.provider]?.key;
  const transcriptionKey = saved.deepgram?.key;
  if (!apiKey || !transcriptionKey)
    throw new Error('Save your selected provider key and Deepgram key in API Keys first.');
  const previous = config.resumeSessionId ? (await sessionStore.snapshot())[config.resumeSessionId] : null;
  if (config.resumeSessionId && !previous) throw new Error('This saved session is no longer available.');
  await finishRecord();
  const recordId = previous?.id || randomUUID();
  const now = new Date().toISOString();
  const context = {
    jobDescription: config.jobDescription,
    resumeText: config.resumeText,
    resumeName: typeof config.resumeName === 'string' ? config.resumeName : 'Saved résumé',
    instructions: typeof config.instructions === 'string' ? config.instructions : '',
  };
  const roundCount = previous ? (previous.roundCount || 1) + 1 : 1;
  const record = {
    ...previous,
    id: recordId,
    company: config.company,
    role: config.role,
    provider: config.provider,
    model: config.model,
    type: ['interview', 'regular', 'mock'].includes(config.sessionType) ? config.sessionType : 'interview',
    startedAt: previous?.startedAt || now,
    lastActiveAt: now,
    endedAt: null,
    roundCount,
    context,
    entries: previous?.entries || [],
  };
  await sessionStore.update((data) => {
    data[record.id] = record;
    const records = Object.values(data).sort((a, b) =>
      (b.lastActiveAt || b.startedAt).localeCompare(a.lastActiveAt || a.startedAt),
    );
    for (const old of records.slice(200)) delete data[old.id];
  });
  currentRecordId = recordId;
  stopNativeAudio();
  restoreOverlayBounds();
  config = { ...config, apiKey, transcriptionKey, roundCount, previousAnswers: record.entries };
  pendingSession = { ...config, sessionId: ++sessionSequence };
  send('start-session', publicSession(pendingSession));
  overlayWindow.show();
  pinOverlay();
  overlayWindow.focus();
  setupWindow.hide();
  return { ok: true };
});
ipcMain.handle('keys-status', async (event) => {
  requireSetup(event);
  return credentialStatus();
});
ipcMain.handle('keys-save', async (event, provider, key) => {
  requireSetup(event);
  if (!keyProviders.has(provider) || typeof key !== 'string' || !key.trim() || key.length > 4096)
    throw new Error('Enter a valid API key.');
  await keyStore.update((data) => {
    data[provider] = { key: key.trim(), updatedAt: new Date().toISOString(), verified: false };
  });
  return credentialStatus();
});
ipcMain.handle('keys-remove', async (event, provider) => {
  requireSetup(event);
  if (!keyProviders.has(provider)) throw new Error('Unknown provider.');
  await keyStore.update((data) => {
    delete data[provider];
  });
  return credentialStatus();
});
ipcMain.handle('keys-reveal', async (event, provider) => {
  requireSetup(event);
  if (!keyProviders.has(provider)) throw new Error('Unknown provider.');
  return (await keyStore.snapshot())[provider]?.key || '';
});
ipcMain.handle('keys-test', async (event, provider) => {
  requireSetup(event);
  if (!keyProviders.has(provider)) throw new Error('Unknown provider.');
  const item = (await keyStore.snapshot())[provider];
  if (!item?.key) throw new Error('Save a key first.');
  let response;
  try {
    response = await fetch(providers[provider].testUrl, {
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
      headers: authHeaders(provider, item.key),
    });
  } catch {
    throw new Error('Could not reach the provider. Check your connection and retry.');
  }
  await response.body?.cancel();
  const verified = response.ok;
  await keyStore.update((data) => {
    if (data[provider]?.key === item.key)
      Object.assign(data[provider], { verified, testedAt: new Date().toISOString() });
  });
  return {
    verified,
    message: verified
      ? 'Connection successful. Usage limits still apply.'
      : `Provider returned ${response.status}. Check this key's access and billing.`,
    status: await credentialStatus(),
  };
});
ipcMain.handle('sessions-list', async (event) => {
  requireSetup(event);
  return Object.values(await sessionStore.snapshot())
    .sort((a, b) => (b.lastActiveAt || b.startedAt).localeCompare(a.lastActiveAt || a.startedAt))
    .map(({ context, ...record }) => ({
      ...record,
      hasContext: !!context?.resumeText && !!context?.jobDescription,
    }));
});
ipcMain.handle('session-load', async (event, id) => {
  requireSetup(event);
  if (typeof id !== 'string') throw new Error('Select a saved session.');
  const record = (await sessionStore.snapshot())[id];
  if (!record) throw new Error('This saved session is no longer available.');
  return {
    id: record.id,
    company: record.company,
    role: record.role,
    provider: record.provider,
    model: record.model,
    sessionType: record.type,
    roundCount: record.roundCount || 1,
    ...record.context,
  };
});
ipcMain.handle('session-entry', async (event, entry) => {
  if (event.sender !== overlayWindow?.webContents || !currentRecordId) return;
  if (typeof entry?.question !== 'string' || typeof entry?.answer !== 'string') return;
  const id = currentRecordId;
  await sessionStore.update((data) => {
    if (!data[id]) return;
    data[id].entries.push({
      question: entry.question.slice(0, 8000),
      answer: entry.answer.slice(0, 50000),
      at: new Date().toISOString(),
      round: data[id].roundCount || 1,
    });
    data[id].entries = data[id].entries.slice(-200);
    data[id].lastActiveAt = new Date().toISOString();
  });
});
ipcMain.handle('get-pending-session', (event) =>
  event.sender === overlayWindow?.webContents ? publicSession(pendingSession) : null,
);
ipcMain.handle('generate-cue', async (event, input) => {
  if (
    event.sender !== overlayWindow?.webContents ||
    !pendingSession ||
    input?.sessionId !== pendingSession.sessionId
  )
    return { ok: false, error: { message: 'This session has ended.', cancelled: true } };
  if (activeAIRequest) return { ok: false, error: { message: 'An answer is already being prepared.' } };
  const invalid =
    typeof input.system !== 'string' ||
    input.system.length > 200000 ||
    (input.question !== undefined && (typeof input.question !== 'string' || input.question.length > 16000)) ||
    (input.image !== undefined &&
      (typeof input.image !== 'string' ||
        input.image.length > 8 * 1024 * 1024 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(input.image))) ||
    (input.audio !== undefined &&
      (!(input.audio instanceof ArrayBuffer || input.audio instanceof Uint8Array) ||
        !input.audio.byteLength ||
        input.audio.byteLength > 15 * 1024 * 1024 ||
        !['audio/webm', 'audio/mp4', 'audio/wav', 'audio/ogg'].includes(input.mimeType)));
  if (invalid)
    return { ok: false, error: { message: 'Question or recording exceeds the supported size or format.' } };
  const controller = (activeAIRequest = new AbortController());
  try {
    return { ok: true, value: await generateCue(pendingSession, input, { signal: controller.signal }) };
  } catch (error) {
    return {
      ok: false,
      error: {
        message: error.message,
        retrySeconds: error.retrySeconds,
        billingRequired: error.billingRequired,
        cancelled: error.cancelled,
      },
    };
  } finally {
    if (activeAIRequest === controller) activeAIRequest = null;
  }
});
ipcMain.on('cancel-answer', (event, sessionId) => {
  if (event.sender === overlayWindow?.webContents && pendingSession?.sessionId === sessionId)
    cancelAIRequest();
});
ipcMain.handle('start-system-audio', async (event) => {
  if (event.sender !== overlayWindow?.webContents || !pendingSession)
    throw new Error('Start a session first.');
  if (process.platform !== 'darwin') return { native: false };
  stopNativeAudio();
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const root = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : __dirname;
  const helper = spawn(path.join(root, 'assets', `system-audio-${arch}`), [], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  nativeAudioProcess = helper;
  return new Promise((resolve, reject) => {
    let ready = false;
    let stderr = '';
    let remainder = Buffer.alloc(0);
    const timer = setTimeout(() => {
      if (nativeAudioProcess === helper) stopNativeAudio();
      reject(
        new Error('System audio did not start. Check whether macOS is showing a capture permission dialog.'),
      );
    }, 30000);
    const fail = (message) => {
      clearTimeout(timer);
      captureLog('native-error', { message });
      if (ready && nativeAudioProcess === helper) send('system-audio-error', message);
      if (!ready) reject(new Error(message));
    };
    helper.stdout.on('data', (data) => {
      if (nativeAudioProcess !== helper || !ready) return;
      const bytes = Buffer.concat([remainder, data]);
      const length = bytes.length - (bytes.length % 4);
      if (length) send('system-audio-data', new Uint8Array(bytes.subarray(0, length)));
      remainder = Buffer.from(bytes.subarray(length));
    });
    helper.stderr.on('data', (data) => {
      stderr += data.toString();
      let end;
      while ((end = stderr.indexOf('\n')) !== -1) {
        const line = stderr.slice(0, end);
        stderr = stderr.slice(end + 1);
        let result;
        try {
          result = JSON.parse(line);
        } catch {
          continue;
        }
        if (result.event === 'ready') {
          clearTimeout(timer);
          ready = true;
          captureLog('native-ready');
          resolve({ native: true, sampleRate: 16000 });
        } else if (result.event === 'error') fail(result.message);
      }
    });
    helper.on('error', (error) => fail(error.message));
    helper.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (nativeAudioProcess !== helper) return;
      fail(`System audio capture stopped (${signal || code}).`);
      nativeAudioProcess = null;
    });
  });
});
ipcMain.on('stop-system-audio', (event) => {
  if (event.sender === overlayWindow?.webContents) stopNativeAudio();
});
ipcMain.on('win-close', (event) => {
  if (trusted(event)) app.quit();
});
ipcMain.on('win-minimize', (event) => {
  if (trusted(event)) BrowserWindow.fromWebContents(event.sender)?.minimize();
});
ipcMain.on('win-maximize', (event) => {
  if (event.sender !== setupWindow?.webContents) return;
  if (setupWindow.isMaximized()) setupWindow.unmaximize();
  else setupWindow.maximize();
});
ipcMain.handle('toggle-compact', (event) => {
  if (event.sender !== overlayWindow?.webContents) return false;
  if (expandedBounds) {
    restoreOverlayBounds();
    pinOverlay();
    overlayWindow.focus();
    return false;
  }
  expandedBounds = overlayWindow.getBounds();
  overlayWindow.setMinimumSize(72, 72);
  overlayWindow.setBounds(
    { x: expandedBounds.x + expandedBounds.width - 72, y: expandedBounds.y, width: 72, height: 72 },
    true,
  );
  pinOverlay();
  return true;
});
ipcMain.on('move-compact', (event, dx, dy) => {
  if (
    event.sender !== overlayWindow?.webContents ||
    !expandedBounds ||
    !Number.isFinite(dx) ||
    !Number.isFinite(dy)
  )
    return;
  const shiftX = Math.round(dx);
  const shiftY = Math.round(dy);
  if (!shiftX && !shiftY) return;
  const [x, y] = overlayWindow.getPosition();
  overlayWindow.setPosition(x + shiftX, y + shiftY, false);
  expandedBounds.x += shiftX;
  expandedBounds.y += shiftY;
  pinOverlay();
});
ipcMain.handle('capture-screen', async (event) => {
  if (event.sender !== overlayWindow?.webContents || !pendingSession)
    throw new Error('Start a session first.');
  const { width, height } = screen.getPrimaryDisplay().size;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.min(width, 1600), height: Math.min(height, 1000) },
  });
  const image = sources[0]?.thumbnail;
  if (!image || image.isEmpty())
    throw new Error('Screen capture is unavailable. Check macOS Screen Recording permission.');
  return image.toDataURL();
});
ipcMain.handle('request-microphone', async (event) => {
  if (event.sender !== overlayWindow?.webContents) return false;
  return process.platform !== 'darwin' || systemPreferences.askForMediaAccess('microphone');
});
ipcMain.on('session-settings', async (event) => {
  if (!trusted(event)) return;
  pendingSession = null;
  stopNativeAudio();
  send('end-session');
  restoreOverlayBounds();
  overlayWindow.hide();
  showSetup();
  try {
    await finishRecord();
    setupWindow.webContents.send('workspace-refresh');
  } catch {
    setupWindow.webContents.send(
      'workspace-error',
      'The session could not be saved. Check local secure storage.',
    );
  }
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showAssistant);
  app.whenReady().then(() => {
    keyStore = new SecureStore(path.join(app.getPath('userData'), 'credentials.enc'));
    sessionStore = new SecureStore(path.join(app.getPath('userData'), 'sessions.enc'));
    createWindows();
  });
  let finishingQuit = false;
  app.on('before-quit', (event) => {
    if (finishingQuit) return;
    event.preventDefault();
    finishingQuit = true;
    stopNativeAudio();
    finishRecord()
      .catch(() => {})
      .then(() => Promise.all([keyStore?.queue, sessionStore?.queue]))
      .finally(() => app.quit());
  });
  app.on('activate', showAssistant);
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    stopNativeAudio();
    globalShortcut.unregisterAll();
  });
}
