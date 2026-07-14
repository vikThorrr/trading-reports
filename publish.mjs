#!/usr/bin/env node
// publish.mjs — turn the TradingAgents report folders on this Mac into an
// encrypted blob for the web reader, then commit & push to GitHub Pages.
//
// Flow:
//   1. Scan ~/Downloads/TradingAgents Reports/<TICKER>_<YYYYMMDD>_<HHMMSS>/
//   2. For each, read complete_report.md + 5_portfolio/decision.md and pull out
//      ticker, timestamp, rating, price target, time horizon, summary.
//   3. Bundle everything as JSON, encrypt it (AES-GCM, key from your passphrase
//      via PBKDF2) so the public repo never exposes report contents.
//   4. Write reports.enc.json, then git add/commit/push (unless --no-push).
//
// The passphrase is read from ./.publish-passphrase (git-ignored) or the
// TR_PASSPHRASE env var. It NEVER leaves your machine and is never committed.
//
// Usage:
//   node publish.mjs                 # build + commit + push
//   node publish.mjs --no-push       # build only (local testing)
//   TR_REPORTS_DIR=/path node publish.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { webcrypto as crypto } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PBKDF2_ITERATIONS = 210000;

const REPORTS_DIR =
  process.env.TR_REPORTS_DIR ||
  join(homedir(), "Downloads", "TradingAgents Reports");
const OUT_FILE = join(__dirname, "reports.enc.json");
const noPush = process.argv.includes("--no-push");

function getPassphrase() {
  if (process.env.TR_PASSPHRASE) return process.env.TR_PASSPHRASE.trim();
  const f = join(__dirname, ".publish-passphrase");
  if (existsSync(f)) {
    const p = readFileSync(f, "utf8").trim();
    if (p) return p;
  }
  console.error(
    "No passphrase found. Set one once with:\n" +
      `  printf 'YOUR-SECRET-PIN' > "${join(__dirname, ".publish-passphrase")}"\n` +
      "(this file is git-ignored). Or export TR_PASSPHRASE."
  );
  process.exit(1);
}

// Folder name -> { ticker, iso date }. e.g. RKLB_20260710_170205
function parseFolderName(name) {
  const m = name.match(/^(.+)_(\d{8})_(\d{6})$/);
  if (!m) return null;
  const [, ticker, d, t] = m;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
  return { ticker, date: iso };
}

function field(md, label) {
  // matches "**Label**: value" up to end of line
  const re = new RegExp(`\\*\\*${label}\\*\\*\\s*:?\\s*(.+)`, "i");
  const m = md.match(re);
  return m ? m[1].trim() : null;
}

function collectReports() {
  if (!existsSync(REPORTS_DIR)) {
    console.error(`Reports dir not found: ${REPORTS_DIR}`);
    process.exit(1);
  }
  const reports = [];
  for (const name of readdirSync(REPORTS_DIR)) {
    const dir = join(REPORTS_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const meta = parseFolderName(name);
    if (!meta) continue;
    // Only publish COMPLETE runs. A report needs both the consolidated
    // markdown and the final portfolio decision (stage V) — if TradingAgents
    // errored partway, one of these is missing and we skip it, so broken runs
    // never reach the app.
    const completePath = join(dir, "complete_report.md");
    const decisionPath = join(dir, "5_portfolio", "decision.md");
    if (!existsSync(completePath) || !existsSync(decisionPath)) continue;
    const md = readFileSync(completePath, "utf8");

    let rating = null,
      priceTarget = null,
      timeHorizon = null,
      summary = null;
    {
      const dec = readFileSync(decisionPath, "utf8");
      rating = field(dec, "Rating");
      priceTarget = field(dec, "Price Target");
      timeHorizon = field(dec, "Time Horizon");
      summary = field(dec, "Executive Summary");
    }

    // Run parameters (present on reports generated after this feature shipped).
    let rm = {};
    const rmPath = join(dir, "run_metadata.json");
    if (existsSync(rmPath)) {
      try { rm = JSON.parse(readFileSync(rmPath, "utf8")); } catch { rm = {}; }
    }

    reports.push({
      id: name,
      ticker: meta.ticker,
      date: meta.date, // when the report was generated (from folder name)
      rating,
      priceTarget,
      timeHorizon,
      summary,
      // run parameters
      analysisDate: rm.analysis_date || null,
      depth: rm.research_depth_label || null,
      analysts: rm.analysts || null,
      provider: rm.llm_provider || null,
      model: rm.deep_model || null,
      effort: rm.effort || null,
      language: rm.language || null,
      source: rm.source || null, // "phone" or "mac"
      sourceDevice: rm.source_device || null, // e.g. "Victor's iPhone"
      md,
    });
  }
  // newest first
  reports.sort((a, b) => (a.date < b.date ? 1 : -1));
  return reports;
}

async function encrypt(plaintext, passphrase) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );
  const b64 = (buf) => Buffer.from(buf).toString("base64");
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: b64(salt),
    iv: b64(iv),
    ct: b64(new Uint8Array(ct)),
  };
}

function git(args) {
  return execFileSync("git", args, { cwd: __dirname, stdio: "pipe" })
    .toString()
    .trim();
}

async function main() {
  const passphrase = getPassphrase();
  const reports = collectReports();
  const payload = JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: reports.length,
    reports,
  });
  const blob = await encrypt(payload, passphrase);
  writeFileSync(OUT_FILE, JSON.stringify(blob));
  console.log(`Encrypted ${reports.length} report(s) -> reports.enc.json`);

  if (noPush) {
    console.log("--no-push: skipping git.");
    return;
  }
  // Only push if this is a git repo with a remote.
  try {
    git(["rev-parse", "--is-inside-work-tree"]);
  } catch {
    console.log("Not a git repo yet; skipping push.");
    return;
  }
  git(["add", "reports.enc.json"]);
  const status = git(["status", "--porcelain", "reports.enc.json"]);
  if (!status) {
    console.log("No report changes to publish.");
    return;
  }
  git(["commit", "-m", `Publish ${reports.length} report(s)`]);
  try {
    git(["push", "origin", "HEAD"]);
    console.log("Pushed to GitHub. Live shortly at your Pages URL.");
  } catch (e) {
    console.error("Push failed:", e.message);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
