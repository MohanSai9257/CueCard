const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require("electron");
const path = require("path");

let win;

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 440,
    height: 680,
    x: sw - 460,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    visibleOnAllWorkspaces: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // THE STEALTH LINE — invisible to all screen capture
  win.setContentProtection(true);

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // macOS: hide from dock
  if (process.platform === "darwin") {
    app.dock.hide();
  }

  win.loadFile("index.html");

  // Global hotkeys (work even when window isn't focused)
  globalShortcut.register("CommandOrControl+Shift+H", () => {
    if (win.isVisible()) win.hide();
    else win.show();
  });

  globalShortcut.register("CommandOrControl+Shift+A", () => {
    win.webContents.send("force-answer");
  });

  globalShortcut.register("CommandOrControl+Shift+S", () => {
    win.webContents.send("toggle-capture");
  });
}

ipcMain.on("win-close", () => app.quit());
ipcMain.on("win-minimize", () => win?.minimize());
ipcMain.on("win-move", (_, { dx, dy }) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy);
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => globalShortcut.unregisterAll());
