const { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, screen, shell } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");

if (process.platform === "darwin") app.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
let setupWindow;
let overlayWindow;
let pendingSession = null;
let sessionSequence = 0;

function showSetup() {
  if (!setupWindow || setupWindow.isDestroyed()) return;
  if (setupWindow.isMinimized()) setupWindow.restore();
  setupWindow.show();
  setupWindow.focus();
}
function send(channel, payload) {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send(channel, payload);
}
function configureWindow(window) {
  const allowedLinks = new Set(["https://aistudio.google.com/apikey", "https://console.groq.com/keys", "https://platform.openai.com/api-keys", "https://console.deepgram.com/"]);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedLinks.has(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", event => event.preventDefault());
}
function createWindows() {
  const webPreferences = { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true };
  setupWindow = new BrowserWindow({
    title: "CueCard — Prepare your session", width: 1040, height: 900,
    minWidth: 700, minHeight: 600, frame: false, backgroundColor: "#080b10",
    show: false, icon: path.join(__dirname, "assets/icon.png"), webPreferences,
  });
  setupWindow.loadFile("index.html");
  setupWindow.once("ready-to-show", showSetup);
  configureWindow(setupWindow);
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  overlayWindow = new BrowserWindow({
    title: "CueCard — Live session", width: 520, height: 760, minWidth: 420, minHeight: 520,
    x: Math.max(0, width - 540), y: 20, show: false, frame: false,
    backgroundColor: "#080b10", alwaysOnTop: true, resizable: true,
    icon: path.join(__dirname, "assets/icon.png"), webPreferences,
  });
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadFile("index.html", { query: { overlay: "1" } });
  configureWindow(overlayWindow);
  const session = overlayWindow.webContents.session;
  session.setPermissionRequestHandler((contents, permission, callback) => callback(contents === overlayWindow.webContents && permission === "media"));
  session.setPermissionCheckHandler((contents, permission) => contents === overlayWindow.webContents && permission === "media");
  session.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      if (!sources[0]) return callback({});
      callback({ video: sources[0], ...(request.audioRequested ? { audio: "loopback" } : {}) });
    } catch { callback({}); }
  }, { useSystemPicker: false });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "CueCard", submenu: [{ label: "Session settings", click: showSetup }, { role: "quit" }] },
    { role: "editMenu" },
    { label: "Window", submenu: [{ label: "Show assistant", click: () => { if (pendingSession) { overlayWindow.show(); overlayWindow.focus(); } else showSetup(); } }, { role: "minimize" }] },
  ]));
  globalShortcut.register("CommandOrControl+Shift+A", () => send("force-answer"));
  globalShortcut.register("CommandOrControl+Shift+S", () => send("toggle-capture"));
}
function trusted(event) {
  return event.sender === setupWindow?.webContents || event.sender === overlayWindow?.webContents;
}
ipcMain.handle("pick-resume", async event => {
  if (!trusted(event)) throw new Error("Unknown window.");
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: "Select your résumé", properties: ["openFile"], filters: [{ name: "Résumé", extensions: ["pdf", "docx"] }],
  });
  if (result.canceled) return null;
  const fileName = result.filePaths[0];
  if ((await fs.stat(fileName)).size > 15 * 1024 * 1024) throw new Error("Résumé files must be smaller than 15 MB.");
  const buffer = await fs.readFile(fileName);
  const extension = path.extname(fileName).toLowerCase();
  let text;
  if (extension === ".pdf") text = (await pdfParse(buffer)).text;
  else if (extension === ".docx") text = (await mammoth.extractRawText({ buffer })).value;
  else throw new Error("Please select a PDF or DOCX résumé.");
  text = text.replace(/\u0000/g, "").trim().slice(0, 100000);
  if (!text) throw new Error("No selectable text was found. Use a text-searchable PDF or DOCX.");
  return { name: path.basename(fileName), text };
});
ipcMain.handle("start-session", async (event, config) => {
  if (event.sender !== setupWindow?.webContents) throw new Error("Open session settings to start.");
  for (const key of ["apiKey", "transcriptionKey", "provider", "model", "role", "company", "jobDescription", "resumeText"]) {
    if (typeof config?.[key] !== "string" || !config[key].trim()) throw new Error("Complete all required session fields.");
  }
  pendingSession = { ...config, sessionId: ++sessionSequence };
  send("start-session", pendingSession);
  overlayWindow.setAlwaysOnTop(true, "floating");
  overlayWindow.show();
  overlayWindow.focus();
  setupWindow.hide();
  return { ok: true };
});
ipcMain.handle("get-pending-session", event => trusted(event) ? pendingSession : null);
ipcMain.on("win-close", event => { if (trusted(event)) app.quit(); });
ipcMain.on("win-minimize", event => { if (trusted(event)) BrowserWindow.fromWebContents(event.sender)?.minimize(); });
ipcMain.on("session-settings", event => {
  if (!trusted(event)) return;
  pendingSession = null;
  send("end-session");
  overlayWindow.hide();
  showSetup();
});
ipcMain.on("win-resize", (event, delta) => {
  if (!trusted(event) || !Number.isFinite(delta)) return;
  const window = BrowserWindow.fromWebContents(event.sender);
  const [width, height] = window.getSize();
  window.setSize(Math.max(420, Math.min(1100, width + delta)), Math.max(520, Math.min(1100, height + delta)), true);
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", showSetup);
  app.whenReady().then(() => {
    createWindows();
  });
  app.on("activate", showSetup);
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => globalShortcut.unregisterAll());
}
