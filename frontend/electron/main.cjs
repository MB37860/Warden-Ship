// Electron main process for Warden Ship.
//
// Responsibilities:
//   1. In a packaged build, launch a bundled MongoDB (mongod) against a data dir
//      in userData, so the app is fully local with no system database install.
//   2. Launch the local Flask backend as a managed child process (unless one is
//      already running on the port), pointed at that database.
//   3. Wait until the backend answers before opening the window.
//   4. Load the Vite dev server in development, or the built dist in production.
//   5. Tear the database + backend down cleanly on quit.
//
// Online dependencies (CLIP weights, Google Fonts) are left as-is;
// only the local frontend + local backend + local database are wrapped here.

const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const isWin = process.platform === "win32";

// GPU/perf switches for the Three.js-heavy renderer. Must be set before the app
// is ready. Enabling GPU rasterization + zero-copy and ignoring the driver
// blocklist keeps the 3D scenes smooth on a wider range of hardware.
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");

// electron/ -> frontend/ -> <repoRoot>
const repoRoot = path.resolve(__dirname, "..", "..");

const BACKEND_HOST = "127.0.0.1";
const BACKEND_PORT = Number(process.env.FLASK_PORT || process.env.PORT || 5000);
// Port 5000 is popular (macOS AirPlay, other Flask apps). If it is taken by
// something that is not our backend, fall through to one of these instead.
const BACKEND_PORT_FALLBACKS = [5100, 5101, 5102, 5103];
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL || "http://localhost:5173";
const BACKEND_READY_TIMEOUT_MS = 90_000; // torch/transformers import can be slow

// Bundled database. A dedicated port keeps it isolated from any system MongoDB.
const MONGO_HOST = "127.0.0.1";
const MONGO_PORT = Number(process.env.WARDEN_SHIP_MONGO_PORT || 27090);
const MONGO_READY_TIMEOUT_MS = 30_000;

let mainWindow = null;
let backendProcess = null; // only set when WE spawned it (so we only kill ours)
let mongoProcess = null;
let effectiveMongoUri = null; // MONGO_URI passed to the backend (null = its default)
let backendPort = BACKEND_PORT; // resolved at startup; the renderer is told about it
let logStream = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Everything the app writes at runtime (database, pipeline state, feature
// output, logs) goes here. The app bundle itself is read-only once installed.
function dataDir() {
  return path.join(app.getPath("userData"), "data");
}

// Mirror console output into userData/logs/main.log. Without this a failure in
// a shipped build is invisible: the user has no terminal to read.
function startLogging() {
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, "main.log");
    // Truncate on launch so the file stays small and describes THIS run.
    logStream = fs.createWriteStream(logPath, { flags: "w" });
    for (const level of ["log", "error", "warn"]) {
      const original = console[level].bind(console);
      console[level] = (...args) => {
        original(...args);
        try {
          logStream.write(`${new Date().toISOString()} ${args.join(" ")}\n`);
        } catch {
          /* logging must never break startup */
        }
      };
    }
    console.log(`[app] log file: ${logPath}`);
  } catch (err) {
    console.error(`[app] could not open log file: ${err.message}`);
  }
}

function logChunk(tag, chunk) {
  const text = `[${tag}] ${chunk}`;
  process.stdout.write(text);
  if (logStream) {
    try {
      logStream.write(text);
    } catch {
      /* ignore */
    }
  }
}

function pingPort(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function defaultPythonExecutable() {
  // Packaged: use the bundled portable runtime shipped via extraResources.
  if (app.isPackaged) {
    return isWin
      ? path.join(process.resourcesPath, "python", "python.exe")
      : path.join(process.resourcesPath, "python", "bin", "python3");
  }
  // Dev: use the repo's .venv.
  return isWin
    ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
    : path.join(repoRoot, ".venv", "bin", "python");
}

function defaultBackendCwd() {
  // Packaged: staged backend source lives alongside the runtime in resources/.
  return app.isPackaged ? path.join(process.resourcesPath, "backend") : repoRoot;
}

function mongodExecutable() {
  return path.join(process.resourcesPath, "mongo", "bin", isWin ? "mongod.exe" : "mongod");
}

function spawnMongo() {
  const dbPath = path.join(app.getPath("userData"), "mongo-data");
  fs.mkdirSync(dbPath, { recursive: true });

  mongoProcess = spawn(
    mongodExecutable(),
    ["--dbpath", dbPath, "--port", String(MONGO_PORT), "--bind_ip", MONGO_HOST, "--quiet"],
    { detached: !isWin, stdio: ["ignore", "pipe", "pipe"] },
  );
  console.log(`[mongo] spawning ${mongodExecutable()} --dbpath ${dbPath} --port ${MONGO_PORT}`);
  mongoProcess.stdout.on("data", (d) => logChunk("mongo", d));
  mongoProcess.stderr.on("data", (d) => logChunk("mongo", d));
  mongoProcess.on("exit", (code, signal) => {
    console.log(`[mongo] exited code=${code} signal=${signal}`);
    mongoProcess = null;
  });
  mongoProcess.on("error", (err) => console.error(`[mongo] failed to spawn: ${err.message}`));
}

async function ensureMongo() {
  // Dev uses the developer's own MongoDB (backend default localhost:27017).
  if (!app.isPackaged) return true;

  // Explicit override: point the backend at an external database, don't manage one.
  if (process.env.MONGO_URI) {
    effectiveMongoUri = process.env.MONGO_URI;
    console.log("[mongo] using external MONGO_URI; not spawning bundled mongod");
    return true;
  }

  effectiveMongoUri = `mongodb://${MONGO_HOST}:${MONGO_PORT}/`;

  if (await pingPort(MONGO_HOST, MONGO_PORT)) {
    console.log("[mongo] already running on dedicated port; reusing");
    return true;
  }

  spawnMongo();
  const start = Date.now();
  while (Date.now() - start < MONGO_READY_TIMEOUT_MS) {
    if (mongoProcess === null) return false; // crashed during startup
    if (await pingPort(MONGO_HOST, MONGO_PORT)) return true;
    await delay(400);
  }
  return false;
}

function killProcessTree(child) {
  if (!child || child.killed) return;
  const pid = child.pid;
  try {
    if (isWin) {
      spawn("taskkill", ["/pid", String(pid), "/t", "/f"]);
    } else {
      process.kill(-pid, "SIGTERM"); // negative pid -> kill the whole group
    }
  } catch (err) {
    console.error(`process kill failed: ${err.message}`);
  }
}

function killMongo() {
  killProcessTree(mongoProcess);
  mongoProcess = null;
}

// Ask whoever holds the port to identify itself.
//   "ours"     -> an Warden Ship backend answered /api/health
//   "stranger" -> something answered, but it is not us
//   "none"     -> nothing is listening (yet)
// Two MongoDB URIs point at the same server. Compared by host and port only:
// "localhost" and "127.0.0.1" are the same machine, and credentials, database
// name or query options do not change which server answers.
function sameMongoTarget(a, b) {
  const norm = (uri) => {
    try {
      const { hostname, port } = new URL(uri);
      const host = hostname === "localhost" ? "127.0.0.1" : hostname;
      return `${host}:${port || "27017"}`;
    } catch {
      return null;
    }
  };
  const left = norm(a);
  return left !== null && left === norm(b);
}

function probeBackend(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: BACKEND_HOST, port, path: "/api/health", timeout: 2000 },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            const health = JSON.parse(body);
            if (health.app !== "warden-ship") return resolve("stranger");
            // A backend of ours that talks to a different MongoDB is worse than
            // a stranger: adopting it strands the database we just started, and
            // the UI blames MongoDB for being offline. Only relevant once we
            // manage a database ourselves, i.e. in a packaged build.
            if (effectiveMongoUri && !sameMongoTarget(health.mongo_uri, effectiveMongoUri)) {
              return resolve("foreign-db");
            }
            resolve("ours");
          } catch {
            resolve("stranger");
          }
        });
      },
    );
    req.on("error", () => resolve("none"));
    req.on("timeout", () => {
      req.destroy();
      resolve("none");
    });
  });
}

// A backend from before this fix answers "/" but has no /api/health. Treat a
// listening socket that fails the identity check as "stranger" only when the
// port is genuinely occupied.
async function inspectPort(port) {
  const verdict = await probeBackend(port);
  if (verdict !== "none") return verdict;
  return (await pingPort(BACKEND_HOST, port)) ? "stranger" : "none";
}

function spawnBackend() {
  const pythonExe = process.env.WARDEN_SHIP_PYTHON || defaultPythonExecutable();
  const cwd = process.env.WARDEN_SHIP_BACKEND_CWD || defaultBackendCwd();

  const env = {
    ...process.env,
    FLASK_HOST: BACKEND_HOST,
    FLASK_PORT: String(backendPort),
    PORT: String(backendPort),
  };
  if (app.isPackaged) {
    // The bundle is read-only: pipeline state and feature output must be
    // written under userData instead of next to the code.
    env.WARDEN_SHIP_DATA_DIR = dataDir();
    // Keep the bundled interpreter from picking up a host Python's stdlib/paths
    // or the end user's ~/.local site-packages.
    delete env.PYTHONHOME;
    env.PYTHONPATH = cwd; // resolves `backend.electron_server`
    env.PYTHONNOUSERSITE = "1";
  }
  if (effectiveMongoUri) {
    env.MONGO_URI = effectiveMongoUri; // point the backend at the bundled database
  }

  const pyArgs = app.isPackaged
    ? ["-s", "-m", "backend.electron_server"]
    : ["-m", "backend.electron_server"];

  backendProcess = spawn(pythonExe, pyArgs, {
    cwd,
    env,
    detached: !isWin, // own process group on POSIX so we can kill children too
    stdio: ["ignore", "pipe", "pipe"],
  });

  console.log(`[backend] spawning ${pythonExe} on port ${backendPort} (cwd ${cwd})`);
  backendProcess.stdout.on("data", (d) => logChunk("backend", d));
  backendProcess.stderr.on("data", (d) => logChunk("backend", d));
  backendProcess.on("exit", (code, signal) => {
    console.log(`[backend] exited code=${code} signal=${signal}`);
    backendProcess = null;
  });
  backendProcess.on("error", (err) => {
    console.error(`[backend] failed to spawn: ${err.message}`);
  });
}

async function ensureBackend() {
  // Reuse an existing Warden Ship backend (e.g. one started by hand for dev),
  // but never adopt an unrelated program that merely holds the port: it would
  // be talking to a different database, which surfaces in the UI as the
  // baffling "MongoDB is offline" even though our own database is running.
  for (const candidate of [BACKEND_PORT, ...BACKEND_PORT_FALLBACKS]) {
    const verdict = await inspectPort(candidate);
    if (verdict === "ours") {
      backendPort = candidate;
      console.log(`[backend] reusing the backend already running on ${candidate}`);
      return true;
    }
    if (verdict === "none") {
      backendPort = candidate;
      break;
    }
    if (verdict === "foreign-db") {
      console.log(
        `[backend] port ${candidate} holds an Warden Ship backend bound to a different ` +
          `database (we use ${effectiveMongoUri}); not adopting it, trying the next one`,
      );
    } else {
      console.log(`[backend] port ${candidate} is held by another program; trying the next one`);
    }
    backendPort = null;
  }

  if (!backendPort) {
    console.error("[backend] no free port available");
    return false;
  }

  spawnBackend();

  const start = Date.now();
  while (Date.now() - start < BACKEND_READY_TIMEOUT_MS) {
    if (backendProcess === null) return false; // it crashed during startup
    if ((await probeBackend(backendPort)) === "ours") return true;
    await delay(500);
  }
  return false;
}

function killBackend() {
  killProcessTree(backendProcess);
  backendProcess = null;
}

function loadRenderer(win) {
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  } else {
    win.loadURL(DEV_SERVER_URL).catch(() => {
      // Dev server not running -> fall back to a build if one exists.
      win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#0b0b0f",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      // Tell the renderer which port the backend actually ended up on.
      additionalArguments: [`--warden-ship-api=http://${BACKEND_HOST}:${backendPort}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep rendering (animation loop, R3F frames) at full rate even when the
      // window is backgrounded; avoids janky catch-up when refocusing.
      backgroundThrottling: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open external links (e.g. Google Fonts has none, but be safe) in the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://localhost") || url.startsWith(DEV_SERVER_URL)) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  loadRenderer(mainWindow);
}

async function startup() {
  startLogging();
  if (app.isPackaged) {
    fs.mkdirSync(dataDir(), { recursive: true });
    console.log(`[app] data dir: ${dataDir()}`);
  }

  const dbReady = await ensureMongo();
  if (!dbReady) {
    dialog.showErrorBox(
      "Database failed to start",
      `The bundled MongoDB did not become ready on ${MONGO_HOST}:${MONGO_PORT}.\n\n` +
        `See ${path.join(app.getPath("userData"), "logs", "main.log")} for details.\n\n` +
        "Set MONGO_URI to point at an external MongoDB if you'd rather run your own.",
    );
    app.quit();
    return;
  }

  const ready = await ensureBackend();
  if (!ready) {
    dialog.showErrorBox(
      "Backend failed to start",
      `The Warden Ship backend did not become ready on ${BACKEND_HOST}:${backendPort || BACKEND_PORT}.\n\n` +
        `See ${path.join(app.getPath("userData"), "logs", "main.log")} for details.\n\n` +
        "Check that Python and the backend dependencies are installed, or set " +
        "WARDEN_SHIP_PYTHON to a Python interpreter that has them.",
    );
    app.quit();
    return;
  }
  console.log(`[app] backend ready on ${BACKEND_HOST}:${backendPort}`);
  createWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(startup);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("window-all-closed", () => {
    app.quit(); // backend-bound app: no point staying alive without a window
  });

  app.on("will-quit", () => {
    killBackend(); // stop the backend first (it talks to the database)
    killMongo();
  });
}
