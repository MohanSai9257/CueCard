const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, shell, systemPreferences } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
// Use the documented Screen & System Audio Recording path in development.
if (process.platform === "darwin") app.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");

let win;
let server;
let pendingSession = null;
let sessionSequence = 0;
const HOSTED_ORIGIN = "https://cuecard-interview-assistant.groovy-ghost-2604.chatgpt.site";

const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/overlay.html": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/renderer.js": ["renderer.js", "text/javascript; charset=utf-8"],
  "/live-transcription.js": ["live-transcription.js", "text/javascript; charset=utf-8"],
  "/mammoth.browser.min.js": ["node_modules/mammoth/mammoth.browser.min.js", "text/javascript; charset=utf-8"],
};

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request is too large."));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function parseResume(buffer, fileName) {
  if (buffer.length > 15 * 1024 * 1024) throw new Error("Résumé files must be smaller than 15 MB.");
  const extension = path.extname(fileName).toLowerCase();
  let text = "";
  if (extension === ".pdf") text = (await pdfParse(buffer)).text;
  else if (extension === ".docx") text = (await mammoth.extractRawText({ buffer })).value;
  else throw new Error("Only PDF and DOCX résumés are supported.");
  const cleanedText = text.replace(/\u0000/g, "").trim().slice(0, 100000);
  if (!cleanedText) {
    throw new Error("No selectable text was found. For scanned PDFs, export an OCR/text-searchable PDF and try again.");
  }
  return { name: path.basename(fileName), text: cleanedText };
}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const origin = request.headers.origin;
    if (origin && origin !== HOSTED_ORIGIN && origin !== "http://127.0.0.1:32145") {
      return json(response, 403, { error: "This website is not allowed to control CueCard." });
    }
    if (origin === HOSTED_ORIGIN) {
      response.setHeader("Access-Control-Allow-Origin", HOSTED_ORIGIN);
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-File-Name");
      response.setHeader("Access-Control-Allow-Private-Network", "true");
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, { ready: true, desktopCapture: true });
    }
    if (request.method === "POST" && url.pathname === "/api/resume") {
      const rawName = request.headers["x-file-name"] || "resume";
      const fileName = decodeURIComponent(String(rawName));
      return json(response, 200, await parseResume(await readBody(request, 15 * 1024 * 1024), fileName));
    }
    if (request.method === "POST" && url.pathname === "/api/start") {
      const config = JSON.parse((await readBody(request, 2 * 1024 * 1024)).toString("utf8"));
      if (!config.apiKey || !config.role || !config.company || !config.jobDescription || !config.resumeText) {
        return json(response, 400, { error: "Complete all required session fields." });
      }
      pendingSession = { ...config, sessionId: ++sessionSequence };
      win.setAlwaysOnTop(true, "floating");
      win.setSkipTaskbar(false);
      win.setSize(520, 760, false);
      win.show();
      win.focus();
      send("start-session", pendingSession);
      return json(response, 200, { ok: true });
    }
    if (request.method !== "GET" || !STATIC_FILES[url.pathname]) {
      response.writeHead(404).end("Not found");
      return;
    }
    const [fileName, contentType] = STATIC_FILES[url.pathname];
    let content = await fs.readFile(path.join(__dirname, fileName));
    if (url.pathname === "/overlay.html") {
      content = Buffer.from(content.toString("utf8").replace("<body>", '<body class="overlay-shell">'));
    }
    response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    response.end(content);
  } catch (error) {
    if (!response.headersSent) json(response, 400, { error: error.message });
  }
}

function createWindow(baseUrl) {
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 520,
    x: Math.max(0, sw - 540),
    y: 20,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    visibleOnAllWorkspaces: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadURL(`${baseUrl}overlay.html?overlay=1`);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(webContents === win.webContents && permission === "media");
  });
  win.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    return webContents === win.webContents && permission === "media";
  });
  win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ["screen"] }).then(sources => {
      if (!sources[0]) return callback(null);
      const grant = { video: sources[0] };
      if (request.audioRequested) grant.audio = "loopback";
      callback(grant);
    }).catch(() => callback(null));
  }, { useSystemPicker: false });

  globalShortcut.register("CommandOrControl+Shift+A", () => send("force-answer"));
  globalShortcut.register("CommandOrControl+Shift+S", () => send("toggle-capture"));
}

function openSetupInChrome(url) {
  if (process.platform === "darwin") {
    const child = spawn("open", ["-a", "Google Chrome", url], { detached: true, stdio: "ignore" });
    child.on("error", () => shell.openExternal(url));
    child.unref();
  } else {
    shell.openExternal(url);
  }
}

ipcMain.on("win-close", () => app.quit());
ipcMain.on("win-minimize", () => win?.hide());
ipcMain.on("win-resize", (_, delta) => {
  if (!win || !Number.isFinite(delta)) return;
  const [width, height] = win.getSize();
  win.setSize(Math.max(420, Math.min(900, width + delta)), Math.max(520, Math.min(1000, height + delta)), true);
});

ipcMain.handle("capture-protection-status", () => ({ enabled: false, platform: process.platform }));
ipcMain.handle("get-pending-session", () => pendingSession);

app.whenReady().then(() => {
  server = http.createServer((request, response) => handleRequest(request, response));
  server.on("error", error => {
    console.error("CueCard local server failed:", error.message);
    app.quit();
  });
  server.listen(32145, "127.0.0.1", () => {
    const baseUrl = "http://127.0.0.1:32145/";
    createWindow(baseUrl);
    openSetupInChrome(baseUrl);
  });
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  server?.close();
});
