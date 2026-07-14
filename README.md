# Trading Reports

A private, mobile-friendly reader for [TradingAgents](../TradingAgents) analysis
reports. Reports are **encrypted on your Mac** before publishing, so even though
the site is hosted publicly on GitHub Pages, the contents are unreadable without
your passphrase (AES-GCM, key derived from the passphrase via PBKDF2). You enter
the passphrase in the web app and everything is decrypted in your browser.

Live: https://vikthorrr.github.io/trading-reports/

## How it works
- `publish.mjs` scans `~/Downloads/TradingAgents Reports/`, bundles every report,
  encrypts the bundle to `reports.enc.json`, and pushes to GitHub.
- The PWA (`index.html`, `app.js`, `style.css`) fetches `reports.enc.json`,
  decrypts it in-browser, and shows a scannable list + full report reader.
  A service worker caches everything so it works offline on your commute.

## One-time setup
Set your passphrase (git-ignored, never leaves your machine):
```bash
printf 'YOUR-SECRET-PIN' > ".publish-passphrase"
```
Use the same passphrase in the web app to unlock.

## Publishing
Automatic: the TradingAgents `start.sh` runs `node publish.mjs` after each app
session. Manual:
```bash
export PATH="$HOME/.local/node22/bin:$PATH"
node publish.mjs            # build + commit + push
node publish.mjs --no-push  # build only
```

Install to your home screen (iOS Share → Add to Home Screen) for a full-screen,
offline-capable app.
