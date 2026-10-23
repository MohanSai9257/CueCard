const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cuecard', {
  platform: process.platform,
  captureProtectionStatus: () => ipcRenderer.invoke('capture-protection-status'),
  keysStatus: () => ipcRenderer.invoke('keys-status'),
  saveKey: (provider, key) => ipcRenderer.invoke('keys-save', provider, key),
  removeKey: (provider) => ipcRenderer.invoke('keys-remove', provider),
  revealKey: (provider) => ipcRenderer.invoke('keys-reveal', provider),
  testKey: (provider) => ipcRenderer.invoke('keys-test', provider),
  listSessions: () => ipcRenderer.invoke('sessions-list'),
  loadSession: (id) => ipcRenderer.invoke('session-load', id),
  generateCue: (input) => ipcRenderer.invoke('generate-cue', input),
  cancelAnswer: (sessionId) => ipcRenderer.send('cancel-answer', sessionId),
  saveSessionEntry: (entry) => ipcRenderer.invoke('session-entry', entry),
  onWorkspaceRefresh: (callback) => ipcRenderer.on('workspace-refresh', () => callback()),
  onWorkspaceError: (callback) => ipcRenderer.on('workspace-error', (_, message) => callback(message)),
  close: () => ipcRenderer.send('win-close'),
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  onMaximized: (callback) => ipcRenderer.on('window-maximized', (_, maximized) => callback(maximized)),
  toggleCompact: () => ipcRenderer.invoke('toggle-compact'),
  moveCompact: (dx, dy) => ipcRenderer.send('move-compact', dx, dy),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  requestMicrophone: () => ipcRenderer.invoke('request-microphone'),
  startSystemAudio: () => ipcRenderer.invoke('start-system-audio'),
  stopSystemAudio: () => ipcRenderer.send('stop-system-audio'),
  onSystemAudio: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('system-audio-data', listener);
    return () => ipcRenderer.removeListener('system-audio-data', listener);
  },
  onSystemAudioError: (callback) => {
    const listener = (_, message) => callback(message);
    ipcRenderer.on('system-audio-error', listener);
    return () => ipcRenderer.removeListener('system-audio-error', listener);
  },
  pickResume: () => ipcRenderer.invoke('pick-resume'),
  startSession: (config) => ipcRenderer.invoke('start-session', config),
  settings: () => ipcRenderer.send('session-settings'),
  getPendingSession: () => ipcRenderer.invoke('get-pending-session'),
  onForceAnswer: (callback) => ipcRenderer.on('force-answer', () => callback()),
  onToggleCapture: (callback) => ipcRenderer.on('toggle-capture', () => callback()),
  onStartSession: (callback) => ipcRenderer.on('start-session', (_, config) => callback(config)),
  onEndSession: (callback) => ipcRenderer.on('end-session', () => callback()),
});
