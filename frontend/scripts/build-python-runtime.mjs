// Builds a portable, self-contained Python runtime for the Electron desktop app
// so the packaged installer does not depend on a system Python / .venv.
//
// What it does:
//   1. Downloads a relocatable CPython ("python-build-standalone", install_only)
//      for the host platform into runtime/python/.
//   2. Stages the backend source (backend/**) and the model artifacts it
//      cannot download into runtime/backend/, so
//      `python -m backend.electron_server` resolves.
//   3. pip-installs the requirements into the portable interpreter.
//
// Must run on each target OS (native wheels can't be cross-compiled).
//
// Usage:
//   node scripts/build-python-runtime.mjs [--requirements <file>] [--python 3.12]
// Env overrides: PBS_URL (skip release lookup), PYTHON_VERSION, REQUIREMENTS.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, ".."); // frontend/
const repoRoot = path.resolve(appDir, ".."); // repo root
const runtimeDir = path.join(appDir, "runtime");
const pythonDir = path.join(runtimeDir, "python");
const backendStageDir = path.join(runtimeDir, "backend");

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const PYTHON_VERSION = process.env.PYTHON_VERSION || argValue("--python", "3.12");
const REQUIREMENTS = path.resolve(
  appDir,
  process.env.REQUIREMENTS || argValue("--requirements", "requirements-desktop.txt"),
);

const TRIPLES = {
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
};

function hostKey() {
  const key = `${process.platform}-${process.arch}`;
  if (!TRIPLES[key]) {
    throw new Error(`Unsupported host platform: ${key}`);
  }
  return key;
}

function run(cmd, cmdArgs, opts = {}) {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", ...opts });
  if (res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd} ${cmdArgs.join(" ")}`);
  }
}

function resolvePbsUrl() {
  if (process.env.PBS_URL) return process.env.PBS_URL;
  const triple = TRIPLES[hostKey()];

  // Preferred: build the asset URL directly from pinned versions. No API call,
  // so it's reproducible and immune to rate limits / cross-repo token scoping
  // (which is what broke the macOS/Windows CI runners). Requires both the
  // release date tag and the full CPython version, e.g. PBS_RELEASE=20260610
  // PBS_PYTHON=3.12.13.
  if (process.env.PBS_RELEASE && process.env.PBS_PYTHON) {
    const { PBS_RELEASE, PBS_PYTHON } = process.env;
    return (
      "https://github.com/astral-sh/python-build-standalone/releases/download/" +
      `${PBS_RELEASE}/cpython-${PBS_PYTHON}%2B${PBS_RELEASE}-${triple}-install_only.tar.gz`
    );
  }

  console.log(`Resolving python-build-standalone for ${triple} (CPython ${PYTHON_VERSION}.x)...`);

  // Fallback: query the GitHub API. Pin a release tag (PBS_RELEASE) for
  // reproducible builds; otherwise latest.
  const apiUrl = process.env.PBS_RELEASE
    ? `https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/${process.env.PBS_RELEASE}`
    : "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest";

  // curl rather than fetch: undici can be flaky behind proxies/CDNs. Auth when a
  // token is available so shared CI runner IPs don't hit the 60/hr anon limit.
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const curlArgs = ["-fsSL", "-H", "User-Agent: warden-ship-build"];
  if (token) curlArgs.push("-H", `Authorization: Bearer ${token}`);
  curlArgs.push(apiUrl);

  const res = spawnSync("curl", curlArgs, { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(
      "GitHub release lookup failed. Set PBS_URL to a python-build-standalone asset URL manually.",
    );
  }
  const release = JSON.parse(res.stdout);
  const re = new RegExp(
    `^cpython-${PYTHON_VERSION.replace(".", "\\.")}\\.\\d+\\+.*${triple}-install_only\\.tar\\.gz$`,
  );
  const asset = (release.assets || []).find((a) => re.test(a.name));
  if (!asset) {
    throw new Error(`No matching install_only asset for ${triple} / CPython ${PYTHON_VERSION}`);
  }
  return asset.browser_download_url;
}

async function downloadPython() {
  if (fs.existsSync(path.join(pythonDir, "bin")) || fs.existsSync(path.join(pythonDir, "python.exe"))) {
    console.log("Portable Python already present; skipping download.");
    return;
  }
  const url = await resolvePbsUrl();
  const tarball = path.join(runtimeDir, "python.tar.gz");
  fs.mkdirSync(runtimeDir, { recursive: true });
  console.log(`Downloading ${url}`);
  // curl handles the release-CDN redirect + large binary more reliably than fetch.
  run("curl", [
    "-fSL",
    "--retry", "5",
    "--retry-connrefused",
    "--retry-all-errors",
    "-o", tarball,
    url,
  ]);
  // install_only tarballs extract to a top-level "python/" directory.
  run("tar", ["-xzf", tarball, "-C", runtimeDir]);
  fs.rmSync(tarball, { force: true });
}

function pythonExe() {
  return process.platform === "win32"
    ? path.join(pythonDir, "python.exe")
    : path.join(pythonDir, "bin", "python3");
}

const COPY_SKIP_DIRS = new Set(["__pycache__", "training", ".pytest_cache", "node_modules"]);
const COPY_SKIP_EXT = new Set([".pyc", ".pt", ".pth", ".h5", ".onnx", ".tflite", ".bin", ".npy"]);
// Weights the app cannot fetch at runtime: the year head is ours, there is
// nothing to download it from.
const COPY_KEEP_FILES = new Set(["f5_year_head.pt"]);

function copyTree(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (COPY_SKIP_DIRS.has(path.basename(src))) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyTree(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    if (COPY_SKIP_EXT.has(path.extname(src)) && !COPY_KEEP_FILES.has(path.basename(src))) return;
    fs.copyFileSync(src, dest);
  }
}

function stageBackend() {
  console.log("Staging backend source -> runtime/backend/");
  fs.rmSync(backendStageDir, { recursive: true, force: true });
  fs.mkdirSync(backendStageDir, { recursive: true });
  copyTree(path.join(repoRoot, "backend"), path.join(backendStageDir, "backend"));
}

// Trained artifacts that live under data/ and have no download URL. year_head.py
// resolves its default path as parents[2]/data/..., which is exactly
// runtime/backend/data/ once staged — so the packaged app finds the same file the
// dev checkout does. Without this the F5 map cannot date an undated work at all.
const STAGED_DATA_DIRS = ["f5_year_head"];

function stageModelData() {
  for (const name of STAGED_DATA_DIRS) {
    const src = path.join(repoRoot, "data", name);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing model artifact: ${src}`);
    }
    console.log(`Staging data/${name} -> runtime/backend/data/${name}/`);
    copyTree(src, path.join(backendStageDir, "data", name));
  }
}

function installRequirements() {
  const py = pythonExe();
  // -s + PYTHONNOUSERSITE keep the build hermetic: without them pip sees the
  // host user's ~/.local site-packages and skips installing them into the
  // bundle, silently breaking portability.
  const hermetic = { env: { ...process.env, PYTHONNOUSERSITE: "1" } };
  run(py, ["-s", "-m", "pip", "install", "--upgrade", "pip"], hermetic);
  run(py, ["-s", "-m", "pip", "install", "-r", REQUIREMENTS], hermetic);
}

async function main() {
  console.log(`Building portable Python runtime in ${runtimeDir}`);
  console.log(`Requirements: ${REQUIREMENTS}`);
  await downloadPython();
  stageBackend();
  stageModelData();
  installRequirements();
  console.log("\nDone. Portable runtime ready:");
  console.log(`  interpreter: ${pythonExe()}`);
  console.log(`  backend:     ${backendStageDir}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
