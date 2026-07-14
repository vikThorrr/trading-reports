"use strict";
/* share.js — standalone viewer for a single shared report.
   Isolated from the main app: it only ever decrypts the one shared file with
   the guest password. No access to your main passphrase or other reports. */

const $ = (s, el = document) => el.querySelector(s);
const shareId = (location.hash || "").replace(/^#/, "").trim();

/* ---- crypto ---- */
const b64ToBuf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
async function decryptBlob(blob, passphrase) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64ToBuf(blob.salt), iterations: blob.iterations, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBuf(blob.iv) }, key, b64ToBuf(blob.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ---- markdown (compact, same as the main app) ---- */
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
function splitRow(line) { let s = line.trim(); if (s.startsWith("|")) s = s.slice(1); if (s.endsWith("|")) s = s.slice(0, -1); return s.split("|").map((c) => c.trim()); }
function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let html = "", i = 0;
  const flush = (buf) => { if (buf.length) html += `<p>${inline(esc(buf.join(" ")))}</p>`; };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) { let code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; html += `<pre><code>${esc(code.join("\n"))}</code></pre>`; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { html += `<h${h[1].length}>${inline(esc(h[2]))}</h${h[1].length}>`; i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { html += "<hr/>"; i++; continue; }
    if (/^\s*>/.test(line)) { let buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, "")); html += `<blockquote>${inline(esc(buf.join(" ")))}</blockquote>`; continue; }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line); i += 2; let rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
      let t = '<div class="table-wrap"><table><thead><tr>';
      head.forEach((c) => (t += `<th>${inline(esc(c))}</th>`)); t += "</tr></thead><tbody>";
      rows.forEach((r) => { t += "<tr>"; for (let k = 0; k < head.length; k++) t += `<td>${inline(esc(r[k] || ""))}</td>`; t += "</tr>"; });
      html += t + "</tbody></table></div>"; continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line); let items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
      const tag = ordered ? "ol" : "ul";
      html += `<${tag}>` + items.map((it) => `<li>${inline(esc(it))}</li>`).join("") + `</${tag}>`; continue;
    }
    let buf = [];
    while (i < lines.length && lines[i].trim() &&
      !/^(#{1,6}\s|\s*>|```|\s*([-*+]|\d+\.)\s)/.test(lines[i]) &&
      !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))) buf.push(lines[i++]);
    flush(buf);
  }
  return html;
}
function splitSections(md) {
  const lines = md.split("\n"); const sections = []; let cur = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) { cur = { title: m[1].trim(), body: [] }; sections.push(cur); }
    else if (cur) cur.body.push(line);
  }
  return sections.map((s) => ({ title: s.title, html: mdToHtml(s.body.join("\n")) }));
}
function ratingClass(r) {
  if (!r) return "na"; const s = r.toLowerCase();
  if (/(buy|long|bull|overweight|accumulate|add)/.test(s)) return "buy";
  if (/(sell|short|bear|underweight|reduce|trim|exit)/.test(s)) return "sell";
  if (/(hold|neutral|market ?perform)/.test(s)) return "hold";
  return "na";
}
function fmtDate(iso) { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
function sourceDisplay(r) {
  if (!r || !r.source) return null;
  const icon = r.source === "phone" ? "📱" : r.source === "mac" ? "💻" : "";
  const name = r.sourceDevice || (r.source === "phone" ? "Phone" : r.source === "mac" ? "Mac" : r.source);
  return `${icon} ${name}`.trim();
}

/* ---- render ---- */
function renderReport(r) {
  const rc = ratingClass(r.rating);
  const sections = splitSections(r.md || "");
  const params = [
    ["Triggered from", sourceDisplay(r)],
    ["Generated", r.date ? fmtDate(r.date) : null],
    ["As-of date", r.analysisDate],
    ["Research depth", r.depth],
    ["Analysts", r.analysts ? r.analysts.join(", ") : null],
    ["Model", r.model ? r.model + (r.provider ? ` (${r.provider})` : "") : null],
    ["Price target", r.priceTarget],
    ["Time horizon", r.timeHorizon],
  ].filter(([, v]) => v);
  $("#report").innerHTML = `
    <div class="share-banner">Shared report · read-only</div>
    <h1 class="report-title">${esc(r.ticker)}</h1>
    <div class="report-meta">
      <span class="badge ${rc}">${esc(r.rating || "—")}</span>
      <span>${fmtDate(r.date)}</span>
    </div>
    <dl class="params">
      ${params.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join("")}
    </dl>
    ${r.summary ? `<div class="pd-summary" style="background:var(--surface-2);border-left:3px solid var(--accent);padding:12px 14px;border-radius:10px;margin:0 0 14px"><b>Executive Summary</b><p style="margin:4px 0 0">${esc(r.summary)}</p></div>` : ""}
    ${sections.map((s, i) => `
      <details class="section" ${i === sections.length - 1 ? "open" : ""}>
        <summary>${esc(s.title)}</summary>
        <div class="section-body md">${s.html}</div>
      </details>`).join("")}`;
}

/* ---- load + unlock flow ---- */
let sharedFile = null;

function renderPreview(p) {
  if (!p) return;
  const rc = ratingClass(p.rating);
  const el = $("#preview");
  el.innerHTML = `
    <div class="pv-top">
      <span class="pv-ticker">${esc(p.ticker || "")}</span>
      <span class="badge ${rc}">${esc(p.rating || "—")}</span>
    </div>
    <div class="pv-meta">
      ${p.date ? `<span>${esc(fmtDate(p.date))}</span>` : ""}
      ${p.priceTarget ? `<span>🎯 ${esc(p.priceTarget)}</span>` : ""}
      ${p.timeHorizon ? `<span>⏱ ${esc(p.timeHorizon)}</span>` : ""}
      ${p.depth ? `<span>🔬 ${esc(p.depth)}</span>` : ""}
      ${sourceDisplay(p) ? `<span>${esc(sourceDisplay(p))}</span>` : ""}
    </div>`;
  el.hidden = false;
}

async function loadShare() {
  const err = $("#err");
  if (!shareId) { err.textContent = "Invalid share link."; err.hidden = false; $("#view-btn").disabled = true; return; }
  try {
    const res = await fetch(`shared/${encodeURIComponent(shareId)}.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.status === 404) {
      err.textContent = "This link has been revoked or no longer exists.";
      err.hidden = false; $("#view-btn").disabled = true; $("#pass").disabled = true; return;
    }
    if (!res.ok) throw new Error("net");
    sharedFile = await res.json();
    renderPreview(sharedFile.preview);
  } catch {
    err.textContent = "Couldn't load the report. Check your connection.";
    err.hidden = false;
  }
}

async function unlock(password) {
  const err = $("#err"); err.hidden = true;
  if (!sharedFile) { await loadShare(); if (!sharedFile) return; }
  const btn = $("#view-btn"); btn.disabled = true; btn.textContent = "Opening…";
  try {
    const blob = sharedFile.blob || sharedFile; // wrapped (preview+blob) or legacy
    const data = await decryptBlob(blob, password);
    renderReport(data.report || data);
    $("#lock").hidden = true;
    $("#report").hidden = false;
  } catch {
    err.textContent = "Wrong password.";
    err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "View report";
  }
}
$("#lock-form").addEventListener("submit", (e) => { e.preventDefault(); unlock($("#pass").value); });
loadShare();
