#!/usr/bin/env node
// decrypt-request.mjs <path-to-request.json>
// Decrypts an analysis request written by the phone app (same AES-GCM +
// passphrase as the reports) and prints tab-separated:
//   ticker <TAB> analysts_csv <TAB> depth <TAB> analysisDate
// so the shell listener can read it. The passphrase never leaves this machine.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto as crypto } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

function passphrase() {
  if (process.env.TR_PASSPHRASE) return process.env.TR_PASSPHRASE.trim();
  return readFileSync(join(__dirname, ".publish-passphrase"), "utf8").trim();
}

const blob = JSON.parse(readFileSync(process.argv[2], "utf8"));
const b64 = (x) => Uint8Array.from(Buffer.from(x, "base64"));
const bk = await crypto.subtle.importKey(
  "raw", new TextEncoder().encode(passphrase()), "PBKDF2", false, ["deriveKey"]
);
const key = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt: b64(blob.salt), iterations: blob.iterations, hash: "SHA-256" },
  bk, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
);
const pt = await crypto.subtle.decrypt(
  { name: "AES-GCM", iv: b64(blob.iv) }, key, b64(blob.ct)
);
const d = JSON.parse(new TextDecoder().decode(pt));

const ticker = (d.ticker || "").toString().trim().toUpperCase();
const analysts = Array.isArray(d.analysts) && d.analysts.length
  ? d.analysts.join(",")
  : "market,social,news,fundamentals";
const depth = [1, 3, 5].includes(Number(d.depth)) ? Number(d.depth) : 3;
const date = (d.analysisDate || "").toString().trim();
const device = (d.device || "").toString().trim().replace(/[\t\n\r]/g, " ").slice(0, 40);

if (!ticker) { process.stderr.write("no ticker in request\n"); process.exit(1); }
process.stdout.write([ticker, analysts, depth, date, device].join("\t"));
