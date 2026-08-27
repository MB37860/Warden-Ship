// Downloads a standalone MongoDB server (mongod) for the host OS so the Electron
// app can run a fully local database with no system MongoDB install. Only the
// `mongod` binary is kept (the rest of the tarball — other tools, debug symbols —
// is discarded to keep the bundle small).
//
// Must run on each target OS (per-OS binaries). Output: runtime/mongo/bin/mongod[.exe].
//
// Usage:   node scripts/fetch-mongo.mjs
// Env:     MONGO_VERSION (default 7.0.14)

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");
const runtimeDir = path.join(appDir, "runtime");
const mongoDir = path.join(runtimeDir, "mongo");
const isWin = process.platform === "win32";

const MONGO_VERSION = process.env.MONGO_VERSION || "7.0.14";

// fastdl.mongodb.org asset name per host. NOTE: MongoDB 5.0+ requires a CPU with
// AVX support — fine for essentially all hardware from ~2013 onward.
const ASSETS = {
  "linux-x64": ["linux", `mongodb-linux-x86_64-ubuntu2204-${MONGO_VERSION}.tgz`],
  "linux-arm64": ["linux", `mongodb-linux-aarch64-ubuntu2204-${MONGO_VERSION}.tgz`],
  "darwin-x64": ["osx", `mongodb-macos-x86_64-${MONGO_VERSION}.tgz`],
  "darwin-arm64": ["osx", `mongodb-macos-arm64-${MONGO_VERSION}.tgz`],
  "win32-x64": ["windows", `mongodb-windows-x86_64-${MONGO_VERSION}.zip`],
};

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) throw new Error(`Command failed (${res.status}): ${cmd}`);
}

function hostKey() {
  const key = `${process.platform}-${process.arch}`;
  if (!ASSETS[key]) throw new Error(`Unsupported host platform: ${key}`);
  return key;
}

function mongodPath() {
  return path.join(mongoDir, "bin", isWin ? "mongod.exe" : "mongod");
}

// Recursively locate a file by name (the archive's internal layout varies by OS).
function findFile(dir, target) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, target);
      if (found) return found;
    } else if (entry.name === target) {
      return full;
    }
  }
  return null;
}

function main() {
  if (fs.existsSync(mongodPath())) {
    console.log("mongod already present; skipping download.");
    return;
  }

  const [osDir, assetName] = ASSETS[hostKey()];
  const url = `https://fastdl.mongodb.org/${osDir}/${assetName}`;
  const archive = path.join(runtimeDir, assetName);

  fs.mkdirSync(runtimeDir, { recursive: true });
  console.log(`Downloading ${url}`);
  run("curl", [
    "-fSL",
    "--retry", "5",
    "--retry-connrefused",
    "--retry-all-errors",
    "-o", archive,
    url,
  ]);

  // The directory inside the archive is NOT always the asset filename (Windows
  // uses mongodb-win32-*, macOS differs too), so read the real top-level dir
  // from the archive instead of guessing. bsdtar (shipped as `tar` on all
  // runners) lists/extracts both .tgz and .zip.
  const listing = spawnSync("tar", ["-tf", archive], { encoding: "utf8" });
  if (listing.status !== 0) throw new Error("Failed to list archive contents");
  const topDir = listing.stdout.split(/\r?\n/).find(Boolean).split("/")[0];

  run("tar", ["-xf", archive, "-C", runtimeDir]);

  const extractedDir = path.join(runtimeDir, topDir);
  const mongodName = isWin ? "mongod.exe" : "mongod";
  const srcMongod =
    (fs.existsSync(path.join(extractedDir, "bin", mongodName))
      ? path.join(extractedDir, "bin", mongodName)
      : findFile(extractedDir, mongodName));
  if (!srcMongod) {
    throw new Error(`mongod not found under ${extractedDir}`);
  }
  fs.mkdirSync(path.join(mongoDir, "bin"), { recursive: true });
  fs.copyFileSync(srcMongod, mongodPath());
  if (!isWin) fs.chmodSync(mongodPath(), 0o755);

  // Discard the archive + the rest of the extracted tree (mongos, debug symbols).
  fs.rmSync(archive, { force: true });
  fs.rmSync(extractedDir, { recursive: true, force: true });

  console.log(`\nDone. mongod ready: ${mongodPath()}`);
}

main();
