const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cuecard", {
  close: () => ipcRenderer.send("win-close"),
  minimize: () => ipcRenderer.send("win-minimize"),
  resize: delta => ipcRenderer.send("win-resize", delta),
  pickResume: () => ipcRenderer.invoke("pick-resume"),
  getProtectionStatus: () => ipcRenderer.invoke("capture-protection-status"),
  getPendingSession: () => ipcRenderer.invoke("get-pending-session"),
  onForceAnswer: callback => ipcRenderer.on("force-answer", callback),
  onToggleCapture: callback => ipcRenderer.on("toggle-capture", callback),
  onStartSession: callback => ipcRenderer.on("start-session", (_, config) => callback(config)),
});
