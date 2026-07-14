# Trading Reports — Architecture & Handoff

A private, encrypted, mobile-first reader **and remote control** for
[TradingAgents](https://github.com/TauricResearch/TradingAgents) analysis
reports. This doc is the source of truth for continuing development.

> **No secrets are in this repo.** The report passphrase, Web-Push private key,
> Google API key, and GitHub token all live only on the owner's Mac/phone
> (git-ignored) — never committed. Security relies on those, not on obscurity.

Live: https://vikthorrr.github.io/trading-reports/

---

## Big picture

There are two halves:

1. **`trading-reports/` (this repo → GitHub Pages)** — a static, dependency-free
   vanilla-JS PWA. It reads reports, and also acts as a remote that queues
   analysis requests. Everything user-facing is here.
2. **`TradingAgents/` (sibling folder on the Mac, not this repo)** — the Python
   multi-agent analysis engine, run in Docker via Colima. A shell **listener**
   (`listen.sh`) watches this repo for requests and drives it.

GitHub is the message bus between phone and Mac (no server, no open ports).

```
Phone PWA ──(GitHub Contents API, encrypted)──► repo ──(git pull)──► Mac listener
   ▲                                                                      │
   └──────── reports.enc.json (encrypted) ◄── git push ◄── run + publish ─┘
```

## Crypto model

- **Reports**: all reports live in one AES-GCM blob `reports.enc.json`
  (PBKDF2-SHA256, 210k iters, key from the owner's passphrase). Decrypted in the
  browser after the passphrase is entered. The passphrase never leaves devices.
- **Requests** (phone → Mac): `requests/<id>.json` — the payload
  `{ticker, analysts, depth, device, …}` is AES-GCM encrypted with the *same*
  passphrase, so tickers aren't public. The Mac decrypts with the local
  passphrase file.
- **Shares**: `shared/<shareId>.json` = `{ preview:{…plaintext headline…}, blob:{…encrypted report…} }`
  encrypted with a *per-share* password (separate from the main passphrase).
  Guests open `share.html#<shareId>` — a standalone, isolated page.
- **Push**: VAPID. Public key is hard-coded in `app.js`; the private key is
  git-ignored on the Mac and used by `send-push.mjs`.

## Repo file map

| File | Role |
|---|---|
| `index.html` / `app.js` / `style.css` | The main PWA (reader + remote). |
| `sw.js` | Service worker: offline cache + Web-Push `push`/`notificationclick`. |
| `share.html` / `share.js` | Standalone guest viewer for one shared report (isolated; own crypto+renderer). |
| `publish.mjs` | Mac: scan `~/Downloads/TradingAgents Reports/`, encrypt → `reports.enc.json`, commit+push. Skips incomplete runs. |
| `decrypt-request.mjs` | Mac: decrypt one request → `ticker\tanalysts\tdepth\tdate\tdevice`. |
| `send-push.mjs` | Mac: send Web Push to all `push/*.json` via `web-push` + VAPID. |
| `reports.enc.json` | Encrypted reports blob (published). |
| `requests/`, `status/`, `push/`, `shared/` | Message-bus dirs (see below). |
| `manifest.webmanifest`, `icon*.png/svg` | PWA install assets. |

**Not committed (git-ignored):** `.publish-passphrase`, `.vapid.json`,
`node_modules/`.

**On the Mac, in `TradingAgents/`:** `listen.sh` (the poller), `start.sh`
(manual launch), plus a Dockerized fork of TradingAgents whose CLI
(`cli/main.py`) has an **unattended mode**: when `TRADINGAGENTS_TICKER` is set it
runs with no prompts and records run metadata (depth, analysts, models,
`source`, `source_device`, …) into each report folder as `run_metadata.json`.

## Message-bus directories (in this repo)

- `requests/<id>.json` — encrypted analysis request from the phone. Listener
  runs it, then deletes it.
- `status/<id>.json` — `{state: processing|done|failed, reason, at}` the listener
  writes so the phone can confirm receipt / outcome. **Ticker is intentionally
  omitted** so the public repo doesn't reveal what's analyzed. Pruned after 3h.
- `status/ping.json` / `status/pong.json` — on-demand "is the Mac online" check.
- `push/<id>.json` — a device's Web-Push subscription (safe to be public: only
  the VAPID private key on the Mac can actually send to it).
- `shared/<shareId>.json` — a shared report (see crypto model).

## Features (all built)

- Encrypted reader with passphrase lock; offline; light/dark.
- Cards + detail: rating badge, price target, horizon, as-of date, research
  depth, analysts, model, **trigger source + device** (📱 iPhone / 💻 Mac).
- Sort, search, Active/Archived tabs, read/unread, **pull-to-refresh**.
- **PDF export** (print-to-PDF, research-report styling) — detail view.
- **Remote trigger**: "＋ New" → encrypted request → Mac runs it unattended →
  auto-publishes. Send-confirmation polls `status/` (processing/done/failed or
  "Mac offline"). Errored runs are never published.
- **Push notifications** to the phone on processing/done/failed.
- **Share links**: rotating per-share password, manual **revoke**, **auto-revoke
  on archive**, combined "copy link+password", report preview on the login page.
- **Settings** (⚙): device name, push toggle, auto-archive-by-ticker toggle,
  **Mac status ping**.

## How to run / operate (Mac)

- Generate reports & auto-publish: `TradingAgents/start.sh` (or the phone remote).
- Remote listener: `TradingAgents/listen.sh` (auto-starts at login via a
  LaunchAgent). It boots Colima, watches `requests/`, replies to pings, sends
  push, and publishes results.
- Publish manually: `node publish.mjs` (needs Node 22 + the local passphrase).
- **Cache busting:** bump `?v=N` on `app.js`/`style.css` in `index.html` +
  `share.html`, and the `CACHE` name in `sw.js`, on every frontend change
  (currently **v10 / tr-v10**).
- After editing `listen.sh`, reload it:
  `launchctl kickstart -k gui/$(id -u)/com.victor.tradingagents-listen`.

## Known limitations / next ideas

- Shares are not truly single-use (static hosting can't enforce one-view);
  re-sharing rotates the password to revoke. Share previews are plaintext by
  design (headline only; body stays encrypted).
- Push on iOS requires the PWA added to the Home Screen (16.4+).
- Free-tier Gemini rate limits can fail a run mid-way (it just won't publish).
- Possible next: "download all as one PDF", grouping by ticker, richer Mac
  status (last-seen heartbeat), scrubbing older git history if desired.
