const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cuecard", {
  close: () => ipcRenderer.send("win-close"),
  minimize: () => ipcRenderer.send("win-minimize"),
  moveWindow: (dx, dy) => ipcRenderer.send("win-move", { dx, dy }),
  onForceAnswer: (cb) => ipcRenderer.on("force-answer", cb),
  onToggleCapture: (cb) => ipcRenderer.on("toggle-capture", cb),
});
