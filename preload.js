const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cuecard", {
  close: () => ipcRenderer.send("win-close"),
  minimize: () => ipcRenderer.send("win-minimize"),
  toggleCompact: () => ipcRenderer.invoke("toggle-compact"),
  captureScreen: () => ipcRenderer.invoke("capture-screen"),
  requestMicrophone: () => ipcRenderer.invoke("request-microphone"),
  resize: delta => ipcRenderer.send("win-resize", delta),
  pickResume: () => ipcRenderer.invoke("pick-resume"),
  startSession: config => ipcRenderer.invoke("start-session", config),
  settings: () => ipcRenderer.send("session-settings"),
  getPendingSession: () => ipcRenderer.invoke("get-pending-session"),
  onForceAnswer: callback => ipcRenderer.on("force-answer", callback),
  onToggleCapture: callback => ipcRenderer.on("toggle-capture", callback),
  onStartSession: callback => ipcRenderer.on("start-session", (_, config) => callback(config)),
  onEndSession: callback => ipcRenderer.on("end-session", callback),
});
