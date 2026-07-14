"use strict";
/* Trading Reports — encrypted, mobile-first report reader.
   Data is a single AES-GCM blob (reports.enc.json) produced by publish.mjs.
   The passphrase decrypts it in the browser; nothing is ever sent anywhere. */

const DATA_URL = "reports.enc.json";
const LS_READ = "tr_read";          // set of report ids marked read
const LS_ARCHIVED = "tr_archived";  // set of report ids archived
const LS_PASS = "tr_pass";          // remembered passphrase (opt-in)
const LS_GH_TOKEN = "tr_gh_token";  // GitHub token for sending analysis requests
const LS_GH_REPO = "tr_gh_repo";    // owner/name of the repo requests go to
const LS_AUTOARCHIVE = "tr_autoarchive";
const LS_NOTIFS = "tr_notifs";
const LS_SHARES = "tr_shares"; // { reportId: { shareId, password } }
const LS_DEVICE = "tr_device"; // friendly name of this device
const DEFAULT_REPO = "vikThorrr/trading-reports";
// Web Push public key (VAPID). The matching private key lives only on the Mac.
const VAPID_PUBLIC_KEY = "BJoOhMteYJpXLvEFfJ1Gr3FWuQbdUBdOqjU6u7HueUX4VvT8LFc0Wn4k1NEI5mvlq4hX8yjk_C9z3x_l-c6_BCs";

const $ = (sel, el = document) => el.querySelector(sel);
const state = {
  reports: [], read: new Set(), archived: new Set(),
  search: "", sort: "date", view: "active", pass: null,
};

/* ---------------- Crypto ---------------- */
const b64ToBuf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function decryptBlob(blob, passphrase) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64ToBuf(blob.salt), iterations: blob.iterations, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBuf(blob.iv) }, key, b64ToBuf(blob.ct)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ---------------- Markdown -> HTML ---------------- */
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s) {
  // order matters: escape already done by caller
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function isTableSep(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}
function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let html = "", i = 0;
  const flushPara = (buf) => { if (buf.length) html += `<p>${inline(esc(buf.join(" ")))}</p>`; };

  while (i < lines.length) {
    let line = lines[i];

    // blank
    if (!line.trim()) { i++; continue; }

    // code fence
    if (/^```/.test(line)) {
      let code = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      html += `<pre><code>${esc(code.join("\n"))}</code></pre>`;
      continue;
    }

    // heading
    let h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const lvl = h[1].length; html += `<h${lvl}>${inline(esc(h[2]))}</h${lvl}>`; i++; continue; }

    // hr
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { html += "<hr/>"; i++; continue; }

    // blockquote
    if (/^\s*>/.test(line)) {
      let buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      html += `<blockquote>${inline(esc(buf.join(" ")))}</blockquote>`;
      continue;
    }

    // table: current line has a pipe and next line is a separator
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      let rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
      let t = '<div class="table-wrap"><table><thead><tr>';
      head.forEach((c) => (t += `<th>${inline(esc(c))}</th>`));
      t += "</tr></thead><tbody>";
      rows.forEach((r) => {
        t += "<tr>";
        for (let k = 0; k < head.length; k++) t += `<td>${inline(esc(r[k] || ""))}</td>`;
        t += "</tr>";
      });
      t += "</tbody></table></div>";
      html += t;
      continue;
    }

    // lists
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      let items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      html += `<${tag}>` + items.map((it) => `<li>${inline(esc(it))}</li>`).join("") + `</${tag}>`;
      continue;
    }

    // paragraph (gather consecutive non-blank, non-block lines)
    let buf = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^(#{1,6}\s|\s*>|```|\s*([-*+]|\d+\.)\s)/.test(lines[i]) &&
      !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) buf.push(lines[i++]);
    flushPara(buf);
  }
  return html;
}

/* Split the full report markdown into top-level (## ) sections. */
function splitSections(md) {
  const lines = md.split("\n");
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) { cur = { title: m[1].trim(), body: [] }; sections.push(cur); }
    else if (cur) cur.body.push(line);
    // lines before the first ## (the H1 title) are ignored — shown in header
  }
  return sections.map((s) => ({ title: s.title, html: mdToHtml(s.body.join("\n")) }));
}

/* ---------------- Rating helpers ---------------- */
function ratingClass(r) {
  if (!r) return "na";
  const s = r.toLowerCase();
  if (/(buy|long|bull|overweight|accumulate|add)/.test(s)) return "buy";
  if (/(sell|short|bear|underweight|reduce|trim|exit)/.test(s)) return "sell";
  if (/(hold|neutral|market ?perform)/.test(s)) return "hold";
  return "na";
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function sourceLabel(s) {
  if (!s) return null;
  if (s === "phone") return "📱 Phone";
  if (s === "mac") return "💻 Mac";
  return s;
}
function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "device";
}
function deviceName() { return (localStorage.getItem(LS_DEVICE) || guessDeviceName()).trim().slice(0, 40); }
// Icon + device name (or generic Phone/Mac) for the "triggered from" display.
function sourceDisplay(r) {
  if (!r || !r.source) return null;
  const icon = r.source === "phone" ? "📱" : r.source === "mac" ? "💻" : "";
  const name = r.sourceDevice || (r.source === "phone" ? "Phone" : r.source === "mac" ? "Mac" : r.source);
  return `${icon} ${name}`.trim();
}

/* ---------------- Rendering ---------------- */
function renderList() {
  const cards = $("#cards");
  // Filter by the active/archived tab first.
  let items = state.reports.filter((r) =>
    state.view === "archived" ? state.archived.has(r.id) : !state.archived.has(r.id)
  );
  if (state.search) {
    const q = state.search.toLowerCase();
    items = items.filter((r) => r.ticker.toLowerCase().includes(q));
  }
  const depthOrder = { Shallow: 1, Medium: 2, Deep: 3 };
  items.sort((a, b) => {
    if (state.sort === "ticker") return a.ticker.localeCompare(b.ticker);
    if (state.sort === "rating") return ratingClass(a.rating).localeCompare(ratingClass(b.rating));
    if (state.sort === "analysis") return (b.analysisDate || "").localeCompare(a.analysisDate || "");
    if (state.sort === "depth") return (depthOrder[b.depth] || 0) - (depthOrder[a.depth] || 0);
    return a.date < b.date ? 1 : -1; // newest run first
  });

  cards.innerHTML = "";
  items.forEach((r) => {
    const unread = !state.read.has(r.id);
    const archived = state.archived.has(r.id);
    const card = document.createElement("div");
    card.className = "card" + (unread && !archived ? " unread" : "");
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    const open = () => (location.hash = "#/r/" + encodeURIComponent(r.id));
    card.onclick = open;
    card.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
    const rc = ratingClass(r.rating);
    card.innerHTML = `
      <div class="card-top">
        <span class="ticker">${esc(r.ticker)}</span>
        <span class="badge ${rc}">${esc(r.rating || "—")}</span>
        <span class="card-date" style="margin-left:auto">${fmtDate(r.date)}</span>
      </div>
      ${r.summary ? `<p class="card-summary">${esc(r.summary)}</p>` : ""}
      <div class="card-meta">
        ${sourceDisplay(r) ? `<span>${esc(sourceDisplay(r))}</span>` : ""}
        ${r.analysisDate ? `<span>📅 As-of <b>${esc(r.analysisDate)}</b></span>` : ""}
        ${r.depth ? `<span>🔬 <b>${esc(r.depth)}</b></span>` : ""}
        ${r.priceTarget ? `<span>🎯 <b>${esc(r.priceTarget)}</b></span>` : ""}
        ${r.timeHorizon ? `<span>⏱ <b>${esc(r.timeHorizon)}</b></span>` : ""}
      </div>
      <button class="card-archive">${archived ? "↩︎ Unarchive" : "🗄 Archive"}</button>`;
    card.querySelector(".card-archive").onclick = (e) => { e.stopPropagation(); toggleArchive(r.id); };
    cards.appendChild(card);
  });

  const empty = $("#empty");
  empty.hidden = items.length > 0;
  empty.textContent = state.view === "archived"
    ? "No archived reports yet."
    : "No reports yet. Generate one and it'll appear here.";
  const unreadCount = state.reports.filter((r) => !state.read.has(r.id) && !state.archived.has(r.id)).length;
  const pill = $("#unread-pill");
  pill.hidden = unreadCount === 0;
  pill.textContent = unreadCount + " new";
  const ac = $("#arch-count");
  ac.hidden = state.archived.size === 0;
  ac.textContent = state.archived.size;
  $("#foot").textContent = `${items.length} ${state.view === "archived" ? "archived" : "report" + (items.length === 1 ? "" : "s")}`;
}

function renderDetail(id) {
  const r = state.reports.find((x) => x.id === id);
  if (!r) { location.hash = "#/"; return; }
  const rc = ratingClass(r.rating);
  const sections = splitSections(r.md);
  const params = [
    ["Triggered from", sourceDisplay(r)],
    ["Generated", r.date ? fmtDate(r.date) : null],
    ["As-of date", r.analysisDate],
    ["Research depth", r.depth],
    ["Analysts", r.analysts ? r.analysts.join(", ") : null],
    ["Model", r.model ? r.model + (r.provider ? ` (${r.provider})` : "") : null],
    ["Effort", r.effort],
    ["Price target", r.priceTarget],
    ["Time horizon", r.timeHorizon],
    ["Language", r.language],
  ].filter(([, v]) => v);

  const detail = $("#detail");
  detail.innerHTML = `
    <h1 class="report-title">${esc(r.ticker)}</h1>
    <div class="report-meta">
      <span class="badge ${rc}">${esc(r.rating || "—")}</span>
      <span>${fmtDate(r.date)}</span>
    </div>
    <dl class="params">
      ${params.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join("")}
    </dl>
    ${sections.map((s, idx) => `
      <details class="section" ${idx === sections.length - 1 ? "open" : ""}>
        <summary>${esc(s.title)}</summary>
        <div class="section-body md">${s.html}</div>
      </details>`).join("")}`;
  window.scrollTo(0, 0);

  // mark read
  markRead(id, true);
  updateToggleReadBtn(id);
  updateToggleArchiveBtn(id);
  $("#download-pdf").onclick = () => downloadPdf(id);
  $("#share-report").onclick = () => openShareModal(id);
}

function updateToggleReadBtn(id) {
  const btn = $("#toggle-read");
  const read = state.read.has(id);
  btn.textContent = read ? "Mark unread" : "Mark read";
  btn.onclick = () => { markRead(id, !read); updateToggleReadBtn(id); };
}

function updateToggleArchiveBtn(id) {
  const btn = $("#toggle-archive");
  const archived = state.archived.has(id);
  btn.textContent = archived ? "Unarchive" : "Archive";
  btn.onclick = () => { toggleArchive(id); updateToggleArchiveBtn(id); };
}

function markRead(id, read) {
  if (read) state.read.add(id); else state.read.delete(id);
  localStorage.setItem(LS_READ, JSON.stringify([...state.read]));
}

/* ---------------- PDF export (print-to-PDF) ---------------- */
// Builds a clean, standalone research-report document in #print-root and opens
// the browser's print dialog (→ "Save as PDF"). Vector text, real page breaks,
// no app chrome. Modeled on standard equity-research report layouts.
function buildPrintDoc(r) {
  const rc = ratingClass(r.rating);
  const sections = splitSections(r.md);
  const metaRow = (label, val) =>
    val ? `<div class="pd-metaitem"><span>${esc(label)}</span><b>${esc(String(val))}</b></div>` : "";
  const html = `
    <article class="print-doc">
      <div class="pd-brandbar">TRADINGAGENTS · MULTI-AGENT ANALYSIS REPORT</div>
      <header class="pd-head">
        <div class="pd-titlerow">
          <h1>${esc(r.ticker)}</h1>
          <span class="pd-badge ${rc}">${esc(r.rating || "—")}</span>
        </div>
        <div class="pd-metagrid">
          ${metaRow("Price Target", r.priceTarget)}
          ${metaRow("Time Horizon", r.timeHorizon)}
          ${metaRow("As-of Date", r.analysisDate)}
          ${metaRow("Research Depth", r.depth)}
          ${metaRow("Analysts", r.analysts ? r.analysts.join(", ") : null)}
          ${metaRow("Model", r.model ? r.model + (r.provider ? ` (${r.provider})` : "") : null)}
          ${metaRow("Triggered from", r.source ? (r.source === "phone" ? "Phone" : "Mac") : null)}
          ${metaRow("Generated", r.date ? fmtDate(r.date) : null)}
        </div>
        ${r.summary ? `<div class="pd-summary"><div class="pd-summary-h">Executive Summary</div><p>${esc(r.summary)}</p></div>` : ""}
      </header>
      ${sections.map((s) => `<section class="pd-section"><h2>${esc(s.title)}</h2><div class="md">${s.html}</div></section>`).join("")}
      <footer class="pd-foot">
        Generated by TradingAgents on ${esc(fmtDate(r.date))}. For informational purposes only — not financial advice.
      </footer>
    </article>`;
  $("#print-root").innerHTML = html;
}

function downloadPdf(id) {
  const r = state.reports.find((x) => x.id === id);
  if (!r) return;
  buildPrintDoc(r);
  document.title = `${r.ticker} — TradingAgents Report`;
  // Give the DOM a tick to lay out, then open the print dialog.
  setTimeout(() => window.print(), 60);
}

function toggleArchive(id) {
  if (state.archived.has(id)) state.archived.delete(id);
  else { state.archived.add(id); revokeShareFor(id); } // archiving auto-revokes any share
  localStorage.setItem(LS_ARCHIVED, JSON.stringify([...state.archived]));
  if (!$("#view-list").hidden) renderList();
}

/* Re-fetch the encrypted data (bypassing cache) and re-render — the "check for
   new reports" button. Uses the passphrase kept in memory from unlock. */
async function refresh() {
  const btn = $("#refresh");
  if (!state.pass || btn.classList.contains("spinning")) return;
  btn.classList.add("spinning");
  try {
    const res = await fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("no-data");
    const data = await decryptBlob(await res.json(), state.pass);
    state.reports = data.reports || [];
    applyAutoArchive();
    renderList();
  } catch (e) {
    // Keep showing what we have; a transient failure shouldn't blank the list.
    console.warn("refresh failed", e);
  } finally {
    btn.classList.remove("spinning");
  }
}

function setView(view) {
  state.view = view;
  $("#tab-active").classList.toggle("active", view === "active");
  $("#tab-archived").classList.toggle("active", view === "archived");
  renderList();
}

/* ---------------- Routing ---------------- */
function route() {
  const hash = location.hash;
  const m = hash.match(/^#\/r\/(.+)$/);
  if (m) {
    $("#view-list").hidden = true;
    $("#view-detail").hidden = false;
    renderDetail(decodeURIComponent(m[1]));
  } else {
    $("#view-detail").hidden = true;
    $("#view-list").hidden = false;
    renderList();
  }
}

/* ---------------- Unlock flow ---------------- */
async function loadAndUnlock(passphrase, remember) {
  const errEl = $("#lock-error");
  errEl.hidden = true;
  const btn = $("#unlock-btn");
  btn.disabled = true; btn.textContent = "Unlocking…";
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error("no-data");
    const blob = await res.json();
    const data = await decryptBlob(blob, passphrase);
    state.reports = data.reports || [];
    state.pass = passphrase; // kept in memory so the refresh button can re-decrypt
    state.read = new Set(JSON.parse(localStorage.getItem(LS_READ) || "[]"));
    state.archived = new Set(JSON.parse(localStorage.getItem(LS_ARCHIVED) || "[]"));
    applyAutoArchive();
    if (remember) localStorage.setItem(LS_PASS, passphrase);
    $("#lock").hidden = true;
    $("#app").hidden = false;
    route();
  } catch (e) {
    if (e && e.message === "no-data") {
      errEl.textContent = "No reports published yet — generate one and publish, then it'll appear here.";
    } else {
      errEl.textContent = "Wrong passphrase. Try again.";
      localStorage.removeItem(LS_PASS);
    }
    errEl.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "Unlock";
  }
}

/* ---------------- New-analysis request ---------------- */
// Encrypt a small request payload with the same scheme publish.mjs uses, so the
// ticker never appears in plaintext in the public repo.
async function encryptForRequest(obj, passphrase) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bk = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" },
    bk, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
  );
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return { v: 1, kdf: "PBKDF2-SHA256", iterations: 210000, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

function openNewModal() {
  $("#na-repo").value = localStorage.getItem(LS_GH_REPO) || DEFAULT_REPO;
  $("#na-token").value = localStorage.getItem(LS_GH_TOKEN) || "";
  // If the token is already saved, keep the setup section collapsed.
  $(".na-settings").open = !localStorage.getItem(LS_GH_TOKEN);
  $("#na-status").hidden = true;
  $("#new-modal").hidden = false;
  $("#na-ticker").focus();
}
function closeNewModal() { $("#new-modal").hidden = true; }

async function submitRequest(e) {
  e.preventDefault();
  const status = $("#na-status");
  const submit = $("#na-submit");
  const setStatus = (msg, kind) => {
    status.hidden = false; status.textContent = msg;
    status.className = "na-status" + (kind ? " " + kind : "");
  };

  const ticker = $("#na-ticker").value.trim().toUpperCase();
  const analysts = [...document.querySelectorAll('input[name="analyst"]:checked')].map((c) => c.value);
  const depth = Number($("#na-depth").value);
  const repo = ($("#na-repo").value.trim() || DEFAULT_REPO).replace(/^https?:\/\/github\.com\//, "");
  const token = $("#na-token").value.trim();

  if (!ticker) return setStatus("Enter a ticker.", "error");
  if (!analysts.length) return setStatus("Pick at least one analyst.", "error");
  if (!token) return setStatus("Add your GitHub token (one-time setup).", "error");
  if (!state.pass) return setStatus("Unlock the app first.", "error");

  localStorage.setItem(LS_GH_REPO, repo);
  localStorage.setItem(LS_GH_TOKEN, token);

  submit.disabled = true;
  setStatus("Sending…");
  try {
    const payload = { ticker, analysts, depth, device: deviceName(), analysisDate: "", requestedAt: new Date().toISOString() };
    const blob = await encryptForRequest(payload, state.pass);
    const stem = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const path = "requests/" + stem + ".json";
    const contentB64 = btoa(unescape(encodeURIComponent(JSON.stringify(blob))));
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ message: "Analysis request", content: contentB64 }),
    });
    if (res.status === 201) {
      $("#na-ticker").value = "";
      setStatus(`Sent — waiting for your Mac to pick up ${ticker}…`, "pending");
      // Poll for the listener's status (confirms processing / done / failed / offline).
      pollRequestStatus(repo, token, stem, ticker, setStatus);
    } else {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) setStatus("Token rejected. Check it has Contents: write on the repo.", "error");
      else if (res.status === 404) setStatus("Repo not found. Check owner/name and token access.", "error");
      else setStatus(`GitHub error ${res.status}: ${err.message || "failed"}`, "error");
    }
  } catch (err) {
    setStatus("Network error sending the request.", "error");
  } finally {
    submit.disabled = false;
  }
}

// Poll the status file the Mac listener writes, to confirm the request was
// received and report its outcome (or that the Mac never responded).
async function pollRequestStatus(repo, token, stem, ticker, setStatus) {
  const url = `https://api.github.com/repos/${repo}/contents/status/${stem}.json`;
  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const deadline = Date.now() + 150000; // ~2.5 min to at least get "processing"
  let sawProcessing = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 7000));
    let st;
    try {
      const res = await fetch(url + "?t=" + Date.now(), { headers, cache: "no-store" });
      if (res.status === 404) continue; // not picked up yet
      if (!res.ok) continue;
      const j = await res.json();
      st = JSON.parse(decodeURIComponent(escape(atob((j.content || "").replace(/\s/g, "")))));
    } catch { continue; }
    if (st.state === "processing") {
      sawProcessing = true;
      setStatus(`✅ Your Mac is analyzing ${ticker} now — it'll appear here in a few minutes.`, "ok");
    } else if (st.state === "done") {
      setStatus(`✅ ${ticker} is ready! Loading it in…`, "ok");
      await refresh();
      return;
    } else if (st.state === "failed") {
      setStatus(`⚠️ ${ticker} failed: ${st.reason || "analysis error on the Mac"}`, "error");
      return;
    }
  }
  if (sawProcessing) {
    setStatus(`Still analyzing ${ticker}… taking longer than usual. Tap ↻ later to check.`, "pending");
  } else {
    setStatus(
      `⚠️ No response from your Mac — it's likely offline or the listener isn't running. Your request is saved and will run automatically when your Mac is back.`,
      "error"
    );
  }
}

/* ---------------- Auto-archive ---------------- */
// When enabled, keep only the newest report per ticker in the active list;
// older same-ticker reports get archived automatically.
function applyAutoArchive() {
  if (localStorage.getItem(LS_AUTOARCHIVE) !== "1") return;
  const newest = {};
  for (const r of state.reports) {
    if (!newest[r.ticker] || r.date > newest[r.ticker].date) newest[r.ticker] = r;
  }
  let changed = false;
  for (const r of state.reports) {
    if (newest[r.ticker].id !== r.id && !state.archived.has(r.id)) {
      state.archived.add(r.id);
      revokeShareFor(r.id); // auto-archived reports lose any share link
      changed = true;
    }
  }
  if (changed) localStorage.setItem(LS_ARCHIVED, JSON.stringify([...state.archived]));
}

/* ---------------- Settings ---------------- */
function openSettings() {
  $("#set-device").value = localStorage.getItem(LS_DEVICE) || guessDeviceName();
  $("#set-autoarchive").checked = localStorage.getItem(LS_AUTOARCHIVE) === "1";
  const notifOn = localStorage.getItem(LS_NOTIFS) === "1" &&
    typeof Notification !== "undefined" && Notification.permission === "granted";
  $("#set-notifs").checked = notifOn;
  $("#notif-status").hidden = true;
  $("#settings-modal").hidden = false;
}
function closeSettings() { $("#settings-modal").hidden = true; }

function onToggleAutoArchive(e) {
  localStorage.setItem(LS_AUTOARCHIVE, e.target.checked ? "1" : "0");
  if (e.target.checked) { applyAutoArchive(); if (!$("#view-list").hidden) renderList(); }
}

/* ---------------- Web Push ---------------- */
function ghHeaders(token) {
  return {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
function urlBase64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from([...atob(s)].map((c) => c.charCodeAt(0)));
}

async function enablePush(setStatus) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    setStatus("Push isn't available here. On iPhone, add the app to your Home Screen first, then try again.", "error");
    return false;
  }
  const token = localStorage.getItem(LS_GH_TOKEN);
  const repo = localStorage.getItem(LS_GH_REPO) || DEFAULT_REPO;
  if (!token) { setStatus("Add your GitHub token first (＋ New → GitHub connection).", "error"); return false; }
  if (Notification.permission === "denied") { setStatus("Notifications are blocked in your browser settings for this site.", "error"); return false; }
  if ((await Notification.requestPermission()) !== "granted") { setStatus("Notification permission was not granted.", "error"); return false; }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const id = "d" + Math.abs([...sub.endpoint].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
  const path = `push/${id}.json`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(sub))));
  let sha;
  try {
    const g = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?t=${Date.now()}`, { headers: ghHeaders(token), cache: "no-store" });
    if (g.ok) sha = (await g.json()).sha;
  } catch {}
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: "PUT", headers: ghHeaders(token),
    body: JSON.stringify({ message: "Register push device", content, ...(sha ? { sha } : {}) }),
  });
  if (res.status === 201 || res.status === 200) {
    localStorage.setItem(LS_NOTIFS, "1");
    setStatus("✅ Notifications on — you'll get a push when a report is processing, ready, or failed.", "ok");
    return true;
  }
  setStatus(`Couldn't register for push (GitHub ${res.status}). Check your token has Contents: write.`, "error");
  return false;
}

async function disablePush(setStatus) {
  localStorage.setItem(LS_NOTIFS, "0");
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch {}
  setStatus("Notifications turned off on this device.", "pending");
}

async function onToggleNotifs(e) {
  const el = $("#notif-status");
  const setStatus = (m, k) => { el.hidden = false; el.textContent = m; el.className = "na-status" + (k ? " " + k : ""); };
  e.target.disabled = true;
  try {
    if (e.target.checked) { if (!(await enablePush(setStatus))) e.target.checked = false; }
    else { await disablePush(setStatus); }
  } finally { e.target.disabled = false; }
}

/* ---------------- Share ---------------- */
function getShares() { try { return JSON.parse(localStorage.getItem(LS_SHARES) || "{}"); } catch { return {}; } }
function setShares(s) { localStorage.setItem(LS_SHARES, JSON.stringify(s)); }
function randId(n) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return [...a].map((b) => "0123456789abcdefghijklmnopqrstuvwxyz"[b % 36]).join("");
}
function randPassword() {
  const a = new Uint8Array(9); crypto.getRandomValues(a);
  const cs = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return [...a].map((b) => cs[b % cs.length]).join("");
}
function shareUrl(shareId) {
  return new URL("share.html", location.href).href.split("#")[0].split("?")[0] + "#" + shareId;
}

async function publishShare(r, shareId, password, token, repo) {
  const payload = {
    sharedAt: new Date().toISOString(),
    report: {
      ticker: r.ticker, rating: r.rating, priceTarget: r.priceTarget, timeHorizon: r.timeHorizon,
      analysisDate: r.analysisDate, depth: r.depth, analysts: r.analysts, model: r.model,
      provider: r.provider, source: r.source, sourceDevice: r.sourceDevice, date: r.date, summary: r.summary, md: r.md,
    },
  };
  const blob = await encryptForRequest(payload, password);
  // Wrap with a small PLAINTEXT preview so the share page can show the report's
  // headline attributes before the guest enters the password. The full report
  // body stays encrypted in `blob`.
  const file = {
    preview: {
      ticker: r.ticker, rating: r.rating, date: r.date, depth: r.depth,
      priceTarget: r.priceTarget, timeHorizon: r.timeHorizon,
      source: r.source, sourceDevice: r.sourceDevice,
    },
    blob,
  };
  const path = `shared/${shareId}.json`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(file))));
  let sha;
  try {
    const g = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?t=${Date.now()}`, { headers: ghHeaders(token), cache: "no-store" });
    if (g.ok) sha = (await g.json()).sha;
  } catch {}
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: "PUT", headers: ghHeaders(token),
    body: JSON.stringify({ message: "Share report", content, ...(sha ? { sha } : {}) }),
  });
  return res.status === 201 || res.status === 200;
}
async function deleteShareFile(shareId, token, repo) {
  const path = `shared/${shareId}.json`;
  try {
    const g = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?t=${Date.now()}`, { headers: ghHeaders(token), cache: "no-store" });
    if (!g.ok) return true;
    const sha = (await g.json()).sha;
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: "DELETE", headers: ghHeaders(token),
      body: JSON.stringify({ message: "Revoke share", sha }),
    });
    return res.ok;
  } catch { return false; }
}
// Best-effort revoke used when a report is archived.
async function revokeShareFor(reportId) {
  const shares = getShares();
  const entry = shares[reportId];
  if (!entry) return;
  const token = localStorage.getItem(LS_GH_TOKEN);
  const repo = localStorage.getItem(LS_GH_REPO) || DEFAULT_REPO;
  if (token) { try { await deleteShareFile(entry.shareId, token, repo); } catch {} }
  delete shares[reportId];
  setShares(shares);
}

let shareCtx = null;
function shareStatus(m, k) { const el = $("#share-status"); el.hidden = !m; el.textContent = m || ""; el.className = "na-status" + (k ? " " + k : ""); }

async function openShareModal(reportId) {
  const r = state.reports.find((x) => x.id === reportId);
  if (!r) return;
  const token = localStorage.getItem(LS_GH_TOKEN);
  const repo = localStorage.getItem(LS_GH_REPO) || DEFAULT_REPO;
  shareCtx = { reportId, r, token, repo };
  $("#share-link").value = ""; $("#share-pass").value = "";
  shareStatus("");
  $("#share-modal").hidden = false;
  if (!token) { shareStatus("Add your GitHub token first (＋ New → GitHub connection).", "error"); return; }
  const shares = getShares();
  let entry = shares[reportId];
  if (!entry) {
    shareStatus("Creating share link…", "pending");
    const shareId = randId(16), password = randPassword();
    if (!(await publishShare(r, shareId, password, token, repo))) { shareStatus("Couldn't create the share (check token has Contents: write).", "error"); return; }
    entry = { shareId, password }; shares[reportId] = entry; setShares(shares);
    shareStatus("");
  }
  $("#share-link").value = shareUrl(entry.shareId);
  $("#share-pass").value = entry.password;
}
async function rotateSharePassword() {
  if (!shareCtx || !shareCtx.token) return;
  const { reportId, r, token, repo } = shareCtx;
  const shares = getShares();
  const shareId = (shares[reportId] && shares[reportId].shareId) || randId(16);
  const password = randPassword();
  shareStatus("Updating password…", "pending");
  if (!(await publishShare(r, shareId, password, token, repo))) { shareStatus("Couldn't update (GitHub error).", "error"); return; }
  shares[reportId] = { shareId, password }; setShares(shares);
  $("#share-link").value = shareUrl(shareId);
  $("#share-pass").value = password;
  shareStatus("New password set — the old one no longer works.", "ok");
}
async function revokeCurrentShare() {
  if (!shareCtx) return;
  const { reportId, token, repo } = shareCtx;
  const shares = getShares();
  const entry = shares[reportId];
  shareStatus("Revoking…", "pending");
  if (entry && token) await deleteShareFile(entry.shareId, token, repo);
  delete shares[reportId]; setShares(shares);
  $("#share-link").value = ""; $("#share-pass").value = "";
  shareStatus("Access revoked — the link no longer works.", "ok");
}
function shareText() {
  return `Trading report:\n${$("#share-link").value}\nPassword: ${$("#share-pass").value}`;
}
async function copyShareBoth() {
  if (!$("#share-link").value) return;
  try { await navigator.clipboard.writeText(shareText()); shareStatus("Copied link + password together — just paste to share.", "ok"); }
  catch { shareStatus("Couldn't copy automatically — long-press a field to copy.", "error"); }
}
async function nativeShare() {
  if (!$("#share-link").value) return;
  if (navigator.share) { try { await navigator.share({ title: "Trading report", text: shareText() }); } catch {} }
  else { copyShareBoth(); }
}

/* ---------------- Mac status (on-demand ping) ---------------- */
async function pingMac() {
  const el = $("#mac-status"), btn = $("#ping-mac");
  const token = localStorage.getItem(LS_GH_TOKEN);
  const repo = localStorage.getItem(LS_GH_REPO) || DEFAULT_REPO;
  if (!token) { el.textContent = "Add your GitHub token first (＋ New → GitHub connection)."; return; }
  btn.disabled = true;
  el.textContent = "⏳ Pinging your Mac…";
  const nonce = randId(10);
  try {
    let sha;
    try { const g = await fetch(`https://api.github.com/repos/${repo}/contents/status/ping.json?t=${Date.now()}`, { headers: ghHeaders(token), cache: "no-store" }); if (g.ok) sha = (await g.json()).sha; } catch {}
    const content = btoa(JSON.stringify({ nonce, at: new Date().toISOString() }));
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/status/ping.json`, {
      method: "PUT", headers: ghHeaders(token),
      body: JSON.stringify({ message: "Ping", content, ...(sha ? { sha } : {}) }),
    });
    if (!res.ok) { el.textContent = `Couldn't send ping (GitHub ${res.status}).`; btn.disabled = false; return; }
  } catch { el.textContent = "Network error sending ping."; btn.disabled = false; return; }
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 6000));
    try {
      const g = await fetch(`https://api.github.com/repos/${repo}/contents/status/pong.json?t=${Date.now()}`, { headers: ghHeaders(token), cache: "no-store" });
      if (g.ok) {
        const j = await g.json();
        const pong = JSON.parse(decodeURIComponent(escape(atob((j.content || "").replace(/\s/g, "")))));
        if (pong.nonce === nonce) { el.textContent = `🟢 Online & ready — replied ${new Date(pong.at).toLocaleTimeString()}`; btn.disabled = false; return; }
      }
    } catch {}
  }
  el.textContent = "🔴 No reply — your Mac is offline or the listener isn't running.";
  btn.disabled = false;
}

/* ---------------- Pull-to-refresh ---------------- */
function setupPullToRefresh() {
  const ptr = $("#ptr");
  const THRESHOLD = 70;
  let startY = null, pulling = false;
  const reset = () => { ptr.style.transition = "transform .2s"; ptr.style.transform = ""; ptr.classList.remove("ready", "spinning"); };
  addEventListener("touchstart", (e) => {
    if ($("#view-list").hidden || $("#app").hidden) return;
    if (window.scrollY > 0) return;
    startY = e.touches[0].clientY; pulling = true;
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (!pulling || startY == null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { pulling = false; reset(); return; }
    const pull = Math.min(dy * 0.5, 90);
    ptr.style.transition = "none";
    ptr.style.transform = `translateY(${pull}px)`;
    ptr.classList.toggle("ready", pull >= THRESHOLD);
    $(".ptr-text").textContent = pull >= THRESHOLD ? "Release to refresh" : "Pull to refresh";
  }, { passive: true });
  addEventListener("touchend", async () => {
    if (!pulling) return;
    pulling = false;
    const ready = ptr.classList.contains("ready");
    startY = null;
    if (ready) {
      ptr.style.transition = "transform .2s"; ptr.style.transform = "translateY(52px)";
      ptr.classList.add("spinning"); ptr.classList.remove("ready");
      $(".ptr-text").textContent = "Refreshing…";
      await refresh();
      reset();
    } else reset();
  });
}

/* ---------------- Wire up ---------------- */
function init() {
  $("#lock-form").addEventListener("submit", (e) => {
    e.preventDefault();
    loadAndUnlock($("#pass").value, $("#remember").checked);
  });
  $("#lock-again").addEventListener("click", () => {
    localStorage.removeItem(LS_PASS);
    location.reload();
  });
  $("#back").addEventListener("click", () => history.back());
  $("#search").addEventListener("input", (e) => { state.search = e.target.value; renderList(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; renderList(); });
  $("#refresh").addEventListener("click", refresh);
  $("#tab-active").addEventListener("click", () => setView("active"));
  $("#tab-archived").addEventListener("click", () => setView("archived"));
  $("#new-analysis").addEventListener("click", openNewModal);
  $("#new-close").addEventListener("click", closeNewModal);
  $("#new-form").addEventListener("submit", submitRequest);
  $("#new-modal").addEventListener("click", (e) => { if (e.target.id === "new-modal") closeNewModal(); });
  $("#open-settings").addEventListener("click", openSettings);
  $("#settings-close").addEventListener("click", closeSettings);
  $("#settings-modal").addEventListener("click", (e) => { if (e.target.id === "settings-modal") closeSettings(); });
  $("#set-autoarchive").addEventListener("change", onToggleAutoArchive);
  $("#set-notifs").addEventListener("change", onToggleNotifs);
  $("#set-device").addEventListener("input", (e) => localStorage.setItem(LS_DEVICE, e.target.value.trim()));
  $("#ping-mac").addEventListener("click", pingMac);
  // Share modal
  $("#share-close").addEventListener("click", () => ($("#share-modal").hidden = true));
  $("#share-modal").addEventListener("click", (e) => { if (e.target.id === "share-modal") $("#share-modal").hidden = true; });
  $("#share-copyboth").addEventListener("click", copyShareBoth);
  $("#share-native").addEventListener("click", nativeShare);
  $("#share-rotate").addEventListener("click", rotateSharePassword);
  $("#share-revoke").addEventListener("click", revokeCurrentShare);
  document.querySelectorAll(".copybtn").forEach((b) => b.addEventListener("click", () => {
    const el = $("#" + b.dataset.copy);
    el.select();
    navigator.clipboard.writeText(el.value).catch(() => {});
    const t = b.textContent; b.textContent = "Copied"; setTimeout(() => (b.textContent = t), 1200);
  }));
  setupPullToRefresh();
  window.addEventListener("hashchange", route);

  // auto-unlock if remembered
  const saved = localStorage.getItem(LS_PASS);
  if (saved) { $("#remember").checked = true; loadAndUnlock(saved, true); }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
init();
