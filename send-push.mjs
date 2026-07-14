#!/usr/bin/env node
// send-push.mjs "<title>" "<body>" [tag]
// Sends a Web Push notification to every device registered in push/*.json,
// using the VAPID keys in .vapid.json. Called by listen.sh on status changes,
// so your phone gets alerted even when the app is closed.

import webpush from "web-push";
import { readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const vapidPath = join(__dirname, ".vapid.json");
if (!existsSync(vapidPath)) process.exit(0); // push not set up — no-op
const vapid = JSON.parse(readFileSync(vapidPath, "utf8"));
// VAPID "subject" must be a mailto: or https: contact. Use the app URL, not a
// personal email, so nothing private lands in the public repo.
webpush.setVapidDetails("https://vikthorrr.github.io/trading-reports/", vapid.publicKey, vapid.privateKey);

const title = process.argv[2] || "Trading Reports";
const body = process.argv[3] || "";
const tag = process.argv[4] || "trading-reports";
const payload = JSON.stringify({ title, body, tag, url: "./" });

const pushDir = join(__dirname, "push");
if (!existsSync(pushDir)) process.exit(0);

let sent = 0, stale = 0;
for (const f of readdirSync(pushDir).filter((x) => x.endsWith(".json"))) {
  let sub;
  try { sub = JSON.parse(readFileSync(join(pushDir, f), "utf8")); } catch { continue; }
  try {
    await webpush.sendNotification(sub, payload);
    sent++;
  } catch (e) {
    // 404/410 = the browser dropped the subscription; remove it.
    if (e && (e.statusCode === 404 || e.statusCode === 410)) { try { rmSync(join(pushDir, f)); stale++; } catch {} }
  }
}
console.log(`push: sent=${sent} stale-removed=${stale}`);
