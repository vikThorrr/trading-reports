"use strict";
/* Report dashboard — the paged, card-style detail view (REDESIGN.md §5).

   Renders from the `dashboard` object publish.mjs attaches to a report
   (schema 1, REDESIGN.md §2). Every field is optional and much of it is
   LLM-written, so the code is defensive throughout: values are type-checked
   before use, a missing value renders as "—", a page whose data is entirely
   absent is dropped from the nav, and a page that throws while drawing is
   replaced by a notice instead of blanking the view. Reports without a
   dashboard (everything published before it existed) fall back to
   Summary / Verdict / Full report.

   Uses globals from app.js at call time: esc, ratingClass, fmtDate,
   splitSections, sourceDisplay. */

const Dashboard = (() => {
  /* ---------- type guards (LLM output is not to be trusted) ---------- */
  const DASH = "—";
  const MINUS = "−";
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
  const has = (v) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length);
  const anyStr = (o, keys) => !!o && keys.some((k) => str(o[k]));
  const inRange = (v, lo, hi) => {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    return isNum(n) && Number.isInteger(n) && n >= lo && n <= hi ? n : null;
  };
  const verdictOf = (v) => inRange(v, 0, 2);
  const boolOf = (v) => {
    if (typeof v === "boolean") return v;
    const s = str(v).toLowerCase();
    return s === "yes" || s === "true" ? true : s === "no" || s === "false" ? false : null;
  };

  /* ---------- formatting ---------- */
  const strip0 = (s) => s.replace(/\.0$/, "");
  const curOf = (d) => (d && /^[A-Z]{3}$/.test(d.currency) ? d.currency : "USD");
  const sym = (cur) => (cur === "USD" ? "$" : cur + " ");

  function money(n, cur = "USD") {
    if (!isNum(n)) return DASH;
    const a = Math.abs(n), sign = n < 0 ? MINUS : "";
    for (const [v, u] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
      if (a >= v) {
        const x = a / v;
        return sign + sym(cur) + (x >= 100 ? String(Math.round(x)) : strip0(x.toFixed(1))) + u;
      }
    }
    return sign + sym(cur) + a.toFixed(2);
  }
  const price = (n, cur = "USD") => (isNum(n) ? sym(cur) + n.toFixed(2) : DASH);
  function pct(n, { sign = false, strip = false } = {}) {
    if (!isNum(n)) return DASH;
    let s = Math.abs(n).toFixed(1);
    if (strip) s = strip0(s);
    return (n < 0 ? MINUS : sign && n > 0 ? "+" : "") + s + "%";
  }
  // Valuation multiples: zero or negative means the denominator is a loss, so
  // the multiple is not meaningful rather than "negative".
  function mult(n) {
    if (!isNum(n)) return DASH;
    if (n <= 0) return "n/m";
    return (n < 1 ? n.toFixed(2) : n >= 100 ? String(Math.round(n)) : n.toFixed(1)) + "×";
  }
  function ratio(n) {
    if (!isNum(n)) return DASH;
    if (n < 0) return "n/m";
    return (n < 10 ? n.toFixed(2) : n.toFixed(1)) + "×";
  }

  /* ---------- icons ---------- */
  const ICON = {
    compass: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>',
    cash: '<svg viewBox="0 0 24 24"><rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 12h.01M17.5 12h.01"/></svg>',
    users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.6 14.2c2.4.3 4.2 1.9 4.9 4.8"/></svg>',
    award: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="5"/><path d="M9 13.5L8 21l4-2.2 4 2.2-1-7.5"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5.5c0 4.4-3 8.1-7 9.5-4-1.4-7-5.1-7-9.5V6z"/></svg>',
    trend: '<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
    person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6"/></svg>',
    coins: '<svg viewBox="0 0 24 24"><ellipse cx="9" cy="7" rx="5" ry="2.5"/><path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7"/><path d="M10 15.4c.9.8 2.9 1.4 5 1.4 2.8 0 5-1.1 5-2.5v-4c0-1.4-2.2-2.5-5-2.5"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/></svg>',
  };
  const MARK = [
    '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M6.5 12h11"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M5.5 12.5l4.2 4.2L18.5 8"/></svg>',
  ];

  /* ---------- shared bits ---------- */
  const approx = (src) => (str(src) === "llm"
    ? '<span class="db-chip" title="Estimated by the language model — no data feed provides this breakdown">approx.</span>'
    : "");
  function companyName(r, d) {
    const s = obj(d && d.snapshot);
    return (s && str(s.company_name)) || r.ticker;
  }
  const monogram = (r) => String(r.ticker || "?").slice(0, 4).toUpperCase();
  function infoCard(icon, label, text) {
    return `<div class="db-card db-info"><span class="db-ico" aria-hidden="true">${ICON[icon]}</span>
      <div><div class="db-eyebrow">${esc(label)}</div><p class="db-lead">${esc(text)}</p></div></div>`;
  }
  function noteCard(label, text, icon) {
    if (!str(text)) return "";
    return icon ? infoCard(icon, label, str(text))
      : `<div class="db-card"><div class="db-eyebrow">${esc(label)}</div><p class="db-lead">${esc(str(text))}</p></div>`;
  }
  function tile(label, valueHtml, small) {
    return `<div class="db-tile"><span>${esc(label)}</span><b${small ? ' class="sm"' : ""}>${valueHtml}</b></div>`;
  }
  // A three-way verdict (✕ / – / ✓), with the selected option named in text
  // for screen readers — colour alone must not carry the meaning.
  function triple(v, labels) {
    const opts = labels.map((l, i) => `
      <div class="db-opt v${i}${i === v ? " on" : ""}">
        <span class="db-markbox"><span class="db-mark" aria-hidden="true">${MARK[i]}</span></span>
        <span class="db-opt-l">${esc(l)}</span></div>`).join("");
    const said = v === null ? "Not assessed" : `Assessed: ${labels[v]}`;
    return `<div class="db-triple"><span class="sr-only">${esc(said)}</span>${opts}</div>`;
  }
  function yesNo(v) {
    if (v === true) return '<span class="db-pill yes">✓ Yes</span>';
    if (v === false) return '<span class="db-pill no">✕ No</span>';
    return `<span class="db-pill na">${DASH}</span>`;
  }

  /* ---------- data accessors ---------- */
  function segRows(d) {
    const seg = obj(obj(d && d.overview) && d.overview.segments);
    return arr(seg && seg.rows).filter((x) => obj(x) && str(x.name) && isNum(x.revenue) && x.revenue >= 0)
      .sort((a, b) => b.revenue - a.revenue);
  }
  function geoRegions(d) {
    const g = obj(obj(d && d.customers) && d.customers.geography);
    return arr(g && g.regions).filter((x) => obj(x) && str(x.name) && isNum(x.pct) && x.pct >= 0)
      .sort((a, b) => b.pct - a.pct);
  }
  const fin = (d) => obj(d && d.financials) || {};
  const finVals = (d) => {
    const f = fin(d);
    const flat = [];
    for (const k of ["margins", "health", "valuation", "returns"]) {
      const o = obj(f[k]); if (o) flat.push(...Object.values(o));
    }
    const g = obj(f.growth);
    if (g) for (const k of ["revenue_cagr", "eps_cagr", "fcf_cagr"]) { const o = obj(g[k]); if (o) flat.push(...Object.values(o)); }
    return flat.filter(isNum);
  };
  function history(d) {
    const h = obj(obj(d && d.phase) && d.phase.history);
    if (!h) return null;
    const labels = arr(h.labels).map((x) => String(x));
    if (labels.length < 2) return null;
    const rev = arr(h.revenue), pro = arr(h.profit);
    if (!rev.some(isNum) && !pro.some(isNum)) return null;
    return { labels, rev, pro };
  }
  // Price targets are free text from the decision ("$95.00 (12-month)", "N/A").
  function parsePrice(s) {
    const m = str(s).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  }

  /* ---------- pages ---------- */
  const QUALITY = [
    ["predictable_revenue", "How predictable is revenue?", ["Unpredictable", "Modest", "Predictable"]],
    ["pricing_power", "Can the company raise prices?", ["No", "Sometimes", "Easily"]],
    ["recession_proof", "How recession-proof is it?", ["Weak", "Okay", "Strong"]],
    ["competitive_position", "What is their competitive position?", ["Weak", "Average", "Dominant"]],
  ];
  const STAGES = [["1:", "Startup"], ["2: Hyper", "Growth"], ["3: Operating", "Leverage"], ["4: Capital", "Return"], ["5:", "Decline"]];
  const STAGE_NAMES = ["Startup", "Hyper Growth", "Operating Leverage", "Capital Return", "Decline"];

  function runParams(r) {
    return [
      ["Triggered from", sourceDisplay(r)],
      ["Generated", r.date ? fmtDate(r.date) : null],
      ["As-of date", r.analysisDate],
      ["Research depth", r.depth],
      ["Analysts", Array.isArray(r.analysts) ? r.analysts.join(", ") : null],
      ["Model", r.model ? r.model + (r.provider ? ` (${r.provider})` : "") : null],
      ["Effort", r.effort],
      ["Language", r.language],
    ].filter(([, v]) => v);
  }
  const paramsDl = (r) => `<dl class="params">${runParams(r)
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join("")}</dl>`;

  function pageSummary(r, d, ctx) {
    const s = obj(d && d.snapshot) || {};
    const cur = curOf(d);
    const rc = ratingClass(r.rating);
    const name = companyName(r, d);
    const sub = [name !== r.ticker ? r.ticker : "", str(s.exchange)].filter(Boolean).join(" · ");
    let html = `<div class="db-cover">
      <div class="db-mono-lg" aria-hidden="true">${esc(monogram(r))}</div>
      <h1 class="db-title">${esc(name)}</h1>
      ${sub ? `<div class="db-sub">${esc(sub)}</div>` : ""}
      <div class="db-cover-rating"><span class="badge ${rc}">${esc(r.rating || DASH)}</span></div>
      ${str(s.one_liner) ? `<p class="db-lead db-oneliner">${esc(str(s.one_liner))}</p>` : ""}
    </div>`;
    // The rating is the headline, so it sits under the name rather than in a
    // tile — "OVERWEIGHT" doesn't fit a phone-width tile without breaking.
    const tiles = [
      tile("Price target", esc(r.priceTarget || DASH), true),
      tile("Horizon", esc(r.timeHorizon || DASH), true),
    ];
    if (isNum(s.price)) tiles.push(tile("Price", esc(price(s.price, cur)), true));
    if (isNum(s.market_cap)) tiles.push(tile("Market cap", esc(money(s.market_cap, cur)), true));
    html += `<div class="db-tiles db-tiles-2">${tiles.join("")}</div>`;

    const rest = ctx.pages.slice(1);
    if (rest.length) {
      html += `<div class="db-card db-contents"><div class="db-eyebrow">In this report</div>
        ${rest.map((p, i) => `<button type="button" data-go="${p.slug}">
          <span class="n">${i + 2}</span><span>${esc(p.title)}</span><span class="t">${esc(p.tab || "")}</span></button>`).join("")}
      </div>`;
    }
    html += `<div class="db-card"><div class="db-eyebrow">About this run</div>${paramsDl(r)}</div>`;
    return html;
  }

  function pageOverview(r, d) {
    const o = obj(d.overview) || {};
    const cur = curOf(d);
    let html = [
      ["compass", "Mission", str(o.mission)],
      ["box", `What does ${companyName(r, d)} do?`, str(o.what_it_does)],
      ["cash", "How does it make money?", str(o.how_it_makes_money)],
    ].filter((c) => c[2]).map((c) => infoCard(...c)).join("");

    const rows = segRows(d);
    if (rows.length) {
      const seg = obj(o.segments) || {};
      const sum = rows.reduce((t, x) => t + x.revenue, 0);
      const total = isNum(seg.total_revenue) && seg.total_revenue >= sum ? seg.total_revenue : sum;
      const unaccounted = Math.max(0, total - sum);
      // Top 4 by revenue; everything else — plus revenue the rows don't cover —
      // rolls into "Other", as in the mockup.
      let shown = rows, other = null;
      if (rows.length > 5 || (rows.length > 4 && unaccounted > 0)) {
        shown = rows.slice(0, 4);
        const rest = rows.slice(4);
        other = { name: `Other · ${rest.length} segment${rest.length === 1 ? "" : "s"}`, revenue: rest.reduce((t, x) => t + x.revenue, 0) + unaccounted, yoy: null };
      } else if (unaccounted > total * 0.005) {
        other = { name: "Other", revenue: unaccounted, yoy: null };
      }
      const list = shown.map((x) => ({ name: str(x.name), revenue: x.revenue, yoy: isNum(x.yoy_pct) ? x.yoy_pct : null }));
      if (other) list.push(other);
      const SHADES = ["#2e6b3a", "#4c9e55", "#6db86f", "#97cf87", "#c5e59f"];
      const shade = (i) => SHADES[Math.min(i, SHADES.length - 1)];
      const share = (v) => (total > 0 ? (v / total) * 100 : 0);
      html += `<h2 class="db-h2">Revenue by segment ${approx(seg.source)}
          ${str(seg.fiscal_label) ? `<small class="muted">${esc(str(seg.fiscal_label))}</small>` : ""}
          <span class="db-right">${esc(money(total, cur))}</span></h2>
        <div class="db-segbar" role="img" aria-label="Revenue split by segment">
          ${list.map((x, i) => {
            const p = share(x.revenue);
            return `<span class="${i >= 3 ? "light" : ""}" style="flex-basis:${p.toFixed(3)}%;background:${shade(i)}">${p >= 12 ? esc(pct(p, { strip: true })) : ""}</span>`;
          }).join("")}
        </div>
        <div class="db-table">
          <div class="db-trow head"><span>Segment</span><span>Share</span><span>Revenue</span><span>1-yr</span></div>
          ${list.map((x, i) => `<div class="db-trow">
            <span class="db-segname"><i class="db-swatch" style="background:${shade(i)}"></i>${esc(x.name)}</span>
            <b>${esc(pct(share(x.revenue), { strip: true }))}</b>
            <span>${esc(money(x.revenue, cur))}</span>
            ${x.yoy === null ? `<span class="muted">${DASH}</span>`
              : `<b class="${x.yoy < 0 ? "down" : "up"}">${x.yoy < 0 ? "▼" : "▲"} ${esc(pct(Math.abs(x.yoy), { strip: true }))}</b>`}
          </div>`).join("")}
        </div>`;
    }
    return html;
  }

  function pageCustomers(r, d) {
    const c = obj(d.customers) || {};
    let html = "";
    if (str(c.who)) html += infoCard("users", "Who are the customers?", str(c.who));
    if (str(c.why)) html += infoCard("award", `Why do they buy from ${companyName(r, d)}?`, str(c.why));
    const regions = geoRegions(d);
    if (regions.length) {
      const g = obj(c.geography) || {};
      const COLORS = ["#3ba55d", "#c9a96e", "#8fbf9c", "#d9c39a", "#6e9e7c", "#b8a07a"];
      const total = regions.reduce((t, x) => t + x.pct, 0) || 1;
      html += `<h2 class="db-eyebrow db-geo-h">Revenue by geography ${approx(g.source)}</h2>
        <div class="db-card">
          <div class="db-segbar db-geobar" role="img" aria-label="Revenue split by region">
            ${regions.map((x, i) => `<span style="flex-basis:${((x.pct / total) * 100).toFixed(3)}%;background:${COLORS[i % COLORS.length]}"></span>`).join("")}
          </div>
          <div class="db-legend">${regions.map((x, i) => `<span><i class="db-swatch round" style="background:${COLORS[i % COLORS.length]}"></i>${esc(str(x.name))} · <b>${esc(pct(x.pct, { strip: true }))}</b></span>`).join("")}</div>
        </div>`;
    }
    return html;
  }

  function pageFinancials(r, d) {
    const f = fin(d), cur = curOf(d);
    const m = obj(f.margins) || {}, h = obj(f.health) || {}, v = obj(f.valuation) || {}, s = obj(f.returns) || {};
    const g = obj(f.growth) || {};
    const rev = obj(g.revenue_cagr) || {}, eps = obj(g.eps_cagr) || {}, fcf = obj(g.fcf_cagr) || {};
    // Hide a whole horizon (5-yr, 10-yr) when no metric has it — without an
    // Alpha Vantage key only ~4 years of statements exist, and a column of
    // dashes says nothing.
    const horizons = [["y3", "3-yr"], ["y5", "5-yr"], ["y10", "10-yr"]].filter(([k]) => [rev, eps, fcf].some((o) => isNum(o[k])));
    const growthRows = [];
    for (const [name, o] of [["Revenue", rev], ["EPS", eps], ["FCF", fcf]]) {
      for (const [k, lbl] of horizons) growthRows.push([`${name} ${lbl}`, pct(o[k], { sign: true })]);
    }
    const group = (title, rows) => (rows.length ? `<div class="db-fgroup"><h3>${esc(title)}</h3>
      ${rows.map(([k, val]) => `<div class="db-frow"><span>${esc(k)}</span><b>${esc(val)}</b></div>`).join("")}</div>` : "");
    const col = (...groups) => { const html = groups.join(""); return html ? `<div class="db-fcol">${html}</div>` : ""; };
    return `<div class="db-fin">
      ${col(
        group("Profitability", [["Gross margin", pct(m.gross_pct)], ["Operating margin", pct(m.operating_pct)], ["Net margin", pct(m.net_pct)], ["Free cash flow margin", pct(m.fcf_pct)]]),
        group("Financial health", [["Cash & investments", money(h.cash, cur)], ["Total debt", money(h.total_debt, cur)], ["Debt / equity", ratio(h.debt_to_equity)], ["EBIT / interest", ratio(h.ebit_interest_cover)]]))}
      ${col(group("Growth · annualised", growthRows))}
      ${col(
        group("Valuation", [["Price / sales", mult(v.ps)], ["Price / earnings", mult(v.pe)], ["Price / book", mult(v.pb)], ["Price / free cash flow", mult(v.pfcf)]]),
        group("Shareholder returns", [["Dividend yield", pct(s.dividend_yield_pct)], ["Buyback yield", pct(s.buyback_yield_pct)], ["Debt paydown yield", pct(s.debt_paydown_yield_pct)], ["Total shareholder yield", pct(s.total_yield_pct)]]))}
    </div>`;
  }

  function pageQuality(r, d) {
    const q = obj(d.quality) || {};
    let html = `<div class="db-grid2">${QUALITY.map(([key, question, labels]) => {
      const item = obj(q[key]);
      if (!item || (verdictOf(item.verdict) === null && !str(item.note))) return "";
      return `<div class="db-card db-q"><h3>${esc(question)}</h3>${triple(verdictOf(item.verdict), labels)}
        ${str(item.note) ? `<p class="db-note">${esc(str(item.note))}</p>` : ""}</div>`;
    }).join("")}</div>`;
    const tiles = [];
    if (isNum(q.roic_pct)) tiles.push(tile("Return on invested capital", esc(pct(q.roic_pct))));
    if (isNum(q.peer_roic_median_pct)) tiles.push(tile("Peer median ROIC", esc(pct(q.peer_roic_median_pct))));
    if (tiles.length) html += `<div class="db-tiles">${tiles.join("")}</div>`;
    return html;
  }

  function lineChart(h, profitLabel, cur) {
    const n = h.labels.length;
    const series = [
      { name: "Revenue", vals: h.rev.slice(0, n), above: true },
      { name: profitLabel || "Profit", vals: h.pro.slice(0, n), above: false },
    ].filter((s) => s.vals.some(isNum));
    const all = series.flatMap((s) => s.vals.filter(isNum));
    let lo = Math.min(...all), hi = Math.max(...all);
    const crossesZero = lo < 0;
    if (crossesZero) lo = Math.min(lo, 0);
    if (hi === lo) { hi += Math.abs(hi) || 1; lo -= Math.abs(lo) || 1; }
    const W = 380, H = 246, L = 30, R = 104, T = 30, B = 60;
    const pw = W - L - R, ph = H - T - B;
    const X = (i) => L + (pw * i) / (n - 1);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * ph;
    let g = "";
    const baseY = crossesZero ? Y(0) : T + ph + 30;
    g += `<line class="base" x1="${L - 18}" x2="${W - R + 10}" y1="${baseY}" y2="${baseY}"/>`;
    const legends = [];
    for (const s of series) {
      for (let i = 1; i < n; i++) {
        const a = s.vals[i - 1], b = s.vals[i];
        if (!isNum(a) || !isNum(b)) continue;
        g += `<line class="ln ${b < a ? "down" : "up"}" x1="${X(i - 1)}" y1="${Y(a)}" x2="${X(i)}" y2="${Y(b)}"/>`;
      }
      for (let i = 0; i < n; i++) {
        const v = s.vals[i];
        if (!isNum(v)) continue;
        const prev = s.vals[i - 1], next = s.vals[i + 1];
        // Red when this point closes a decline (or opens one, at the start).
        const down = isNum(prev) ? v < prev : isNum(next) && next < v;
        g += `<circle class="pt ${down ? "down" : "up"}" cx="${X(i)}" cy="${Y(v)}" r="4.6"/>`;
        g += `<text class="lab" x="${X(i)}" y="${s.above ? Y(v) - 11 : Y(v) + 21}" text-anchor="middle">${esc(money(v, cur))}</text>`;
      }
      let li = -1;
      for (let i = n - 1; i >= 0; i--) if (isNum(s.vals[i])) { li = i; break; }
      if (li >= 0) legends.push({ name: s.name, y: Y(s.vals[li]) });
    }
    legends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < legends.length; i++) if (legends[i].y - legends[i - 1].y < 30) legends[i].y = legends[i - 1].y + 30;
    for (const lg of legends) {
      // Wrap long series names onto two lines inside the legend gutter.
      const words = lg.name.split(" ");
      const lines = lg.name.length > 12 && words.length > 1
        ? [words.slice(0, Math.floor(words.length / 2)).join(" "), words.slice(Math.floor(words.length / 2)).join(" ")]
        : [lg.name];
      g += `<text class="leg" x="${W - R + 18}" y="${lg.y + 4 - (lines.length - 1) * 7}">${lines
        .map((t, i) => `<tspan x="${W - R + 18}" dy="${i ? 14 : 0}">${esc(t)}</tspan>`).join("")}</text>`;
    }
    h.labels.forEach((t, i) => {
      g += `<text class="axis${i === n - 1 ? " last" : ""}" x="${X(i)}" y="${H - 8}" text-anchor="middle">${esc(t)}</text>`;
    });
    return `<svg class="db-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenue and ${esc(profitLabel || "profit")} history">${g}</svg>`;
  }

  function lifecycle(stage, ticker) {
    const L = 28, Rr = 352, cw = (Rr - L) / 5, top = 6, bot = 228, zero = 170;
    const b = (i) => L + cw * i;
    let g = `<defs><marker id="dbArrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M1 1L6 5L1 9" fill="none" stroke="#e0574f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>`;
    if (stage) g += `<rect class="hl" x="${b(stage - 1)}" y="${top}" width="${cw}" height="${bot - top}"/>`;
    g += `<rect class="grid" x="${L}" y="${top}" width="${Rr - L}" height="${bot - top}"/>`;
    for (let i = 1; i < 5; i++) g += `<line class="grid" x1="${b(i)}" x2="${b(i)}" y1="${top}" y2="${bot}"/>`;
    g += `<line class="grid" x1="${L}" x2="${Rr}" y1="${zero}" y2="${zero}"/>`;
    g += `<text class="zero" x="${L - 5}" y="${zero + 4}" text-anchor="end">$0</text>`;
    STAGES.forEach(([a, c], i) => {
      g += `<text class="hd${stage === i + 1 ? " on" : ""}" x="${b(i) + cw / 2}" y="24">${esc(a)}</text>`;
      g += `<text class="hd${stage === i + 1 ? " on" : ""}" x="${b(i) + cw / 2}" y="37">${esc(c)}</text>`;
    });
    const path = (cls, d, arrow) => `<path class="curve ${cls}" d="${d}"${arrow ? ' marker-end="url(#dbArrow)"' : ""}/>`;
    g += path("c-rev", `M${L + 2} 165 C ${b(0) + 40} 162, ${b(1) + 20} 158, ${b(2)} 147 C ${b(2) + 30} 138, ${b(3) - 18} 118, ${b(3)} 108 C ${b(3) + 20} 92, ${b(4) - 22} 64, ${b(4)} 62`);
    g += path("c-dec", `M${b(4)} 62 C ${b(4) + 24} 60, ${b(4) + 40} 68, ${b(4) + 50} 88`, true);
    g += path("c-loss", `M${L + 2} 170 C ${b(0) + 22} 190, ${b(0) + 46} 200, ${b(1)} 201`);
    g += path("c-rise", `M${b(1)} 201 C ${b(1) + 24} 200, ${b(2) - 18} 186, ${b(2)} 170`);
    g += path("c-pro", `M${b(2)} 170 C ${b(2) + 28} 155, ${b(3) - 18} 145, ${b(3)} 138 C ${b(3) + 22} 128, ${b(4) - 22} 117, ${b(4)} 114`);
    g += path("c-dec", `M${b(4)} 114 C ${b(4) + 22} 113, ${b(4) + 36} 120, ${b(4) + 44} 142`, true);
    g += path("c-div", `M${b(3)} 170 C ${b(3) + 22} 160, ${b(4) - 26} 150, ${b(4)} 145`);
    g += path("c-dec", `M${b(4)} 145 C ${b(4) + 18} 146, ${b(4) + 26} 152, ${b(4) + 32} 166`, true);
    g += `<text class="ann a-rev" transform="translate(${b(1) + 24} 146) rotate(-8)">Revenue</text>`;
    g += `<text class="ann a-pro" transform="translate(${b(2) + 26} 147) rotate(-16)">Profits</text>`;
    g += `<text class="ann a-rise" x="${b(1) + 5}" y="219">Losses Peak</text>`;
    g += `<line class="ptr" x1="${b(1) + 8}" y1="212" x2="${b(1) + 2}" y2="205"/>`;
    g += `<text class="ann a-pro" x="${b(2) + 8}" y="192">Breakeven</text>`;
    g += `<line class="ptr" x1="${b(2) + 7}" y1="183" x2="${b(2) + 2}" y2="174"/>`;
    g += `<text class="ann a-div" x="${b(3) + 6}" y="186">Dividends /</text><text class="ann a-div" x="${b(3) + 6}" y="197">Buybacks</text>`;
    if (stage) {
      const x = b(stage - 1) + 7;
      g += `<rect class="badge-bg" x="${x}" y="205" width="${cw - 14}" height="18" rx="6"/>`;
      g += `<text class="badge-t" x="${x + (cw - 14) / 2}" y="218" text-anchor="middle">${esc(ticker)}</text>`;
    }
    const label = stage ? `Company lifecycle: stage ${stage} of 5, ${STAGE_NAMES[stage - 1]}` : "Company lifecycle";
    return `<svg class="db-life" viewBox="0 0 360 236" role="img" aria-label="${esc(label)}">${g}</svg>`;
  }

  function pagePhase(r, d) {
    const p = obj(d.phase) || {};
    const cur = curOf(d);
    let html = "";
    const checks = [
      ["revenue_growing", "Is revenue growing?"],
      ["profitable", "Is it profitable?"],
      ["returning_capital", "Is it returning capital?"],
    ].filter(([k]) => obj(p[k]) && (boolOf(p[k].answer) !== null || str(p[k].note)));
    const pm = obj(p.profit_metric);
    if (checks.length || pm) {
      html += `<div class="db-phase-top">
        ${checks.length ? `<div class="db-card db-checks">${checks.map(([k, q]) => `<div class="db-check">
          <div><b>${esc(q)}</b>${str(p[k].note) ? `<small>${esc(str(p[k].note))}</small>` : ""}</div>${yesNo(boolOf(p[k].answer))}</div>`).join("")}</div>` : ""}
        ${pm && str(pm.label) ? `<div class="db-callout"><div class="db-eyebrow">Profit metric</div>
          <strong>${esc(str(pm.label))}</strong>${str(pm.why) ? `<p>${esc(str(pm.why))}</p>` : ""}</div>` : ""}
      </div>`;
    }
    const h = history(d);
    if (h) html += `<div class="db-card db-chart-card">${lineChart(h, pm && str(pm.label), cur)}</div>`;
    const stage = inRange(p.stage, 1, 5);
    if (stage) {
      html += `<div class="db-card db-life-card">${lifecycle(stage, monogram(r))}
        <p class="db-note"><b>Stage ${stage}: ${esc(STAGE_NAMES[stage - 1])}.</b> ${esc(str(p.stage_note))}</p></div>`;
    }
    return html;
  }

  function pageMoat(r, d) {
    const m = obj(d.moat) || {};
    let html = "";
    const v = verdictOf(m.rating);
    if (v !== null) html += `<div class="db-card db-q"><h3>How durable is the moat?</h3>${triple(v, ["None", "Narrow", "Wide"])}
      ${str(m.note) ? `<p class="db-note">${esc(str(m.note))}</p>` : ""}</div>`;
    else html += noteCard("The moat", m.note);
    html += arr(m.drivers).filter((x) => obj(x) && str(x.name))
      .map((x) => infoCard("shield", str(x.name), str(x.note) || "")).join("");
    return html;
  }

  function cagrTable(d) {
    const g = obj(fin(d).growth) || {};
    const rows = [["Revenue", obj(g.revenue_cagr)], ["EPS", obj(g.eps_cagr)], ["Free cash flow", obj(g.fcf_cagr)]].filter(([, o]) => o);
    const hz = [["y3", "3-yr"], ["y5", "5-yr"], ["y10", "10-yr"]].filter(([k]) => rows.some(([, o]) => isNum(o[k])));
    if (!rows.length || !hz.length) return "";
    return `<h2 class="db-h2">Compound annual growth</h2><div class="db-card db-cagr" style="--cols:${hz.length}">
      <div class="db-crow head"><span></span>${hz.map(([, l]) => `<span>${l}</span>`).join("")}</div>
      ${rows.map(([name, o]) => `<div class="db-crow"><span>${esc(name)}</span>${hz.map(([k]) => {
        const v = o[k];
        return `<b class="${isNum(v) ? (v < 0 ? "down" : "up") : "muted"}">${esc(pct(v, { sign: true }))}</b>`;
      }).join("")}</div>`).join("")}</div>`;
  }

  function pageGrowth(r, d) {
    const gr = obj(d.growth) || {};
    let html = noteCard("Where growth comes from", gr.note);
    html += arr(gr.drivers).filter((x) => obj(x) && str(x.name))
      .map((x) => infoCard("trend", str(x.name), str(x.note) || "")).join("");
    html += cagrTable(d);
    return html;
  }

  function returnsTiles(d) {
    const s = obj(fin(d).returns) || {};
    const t = [["Dividend yield", s.dividend_yield_pct], ["Buyback yield", s.buyback_yield_pct], ["Total yield", s.total_yield_pct]]
      .filter(([, v]) => isNum(v)).map(([k, v]) => tile(k, esc(pct(v))));
    return t.length ? `<h2 class="db-h2">Shareholder returns</h2><div class="db-tiles">${t.join("")}</div>` : "";
  }

  function pageManagement(r, d) {
    const m = obj(d.management) || {};
    let html = "";
    if (str(m.ceo)) {
      const since = inRange(m.ceo_since, 1900, 2100);
      const yr = Number((str(d.as_of) || new Date().toISOString()).slice(0, 4));
      const tenure = since && yr >= since ? ` · ${yr - since} year${yr - since === 1 ? "" : "s"}` : "";
      html += `<div class="db-card db-info"><span class="db-ico" aria-hidden="true">${ICON.person}</span><div>
        <div class="db-eyebrow">Chief executive</div><p class="db-lead"><b>${esc(str(m.ceo))}</b></p>
        ${since ? `<small class="muted">CEO since ${since}${tenure}</small>` : ""}</div></div>`;
    }
    html += noteCard("Leadership", m.note);
    html += noteCard("Capital allocation", m.capital_allocation_note, "coins");
    html += returnsTiles(d);
    return html;
  }

  function pageRisk(r, d) {
    const SEV = { 1: "Low", 2: "Medium", 3: "High" };
    const risks = arr(d.risks).filter((x) => obj(x) && str(x.name))
      .map((x) => ({ ...x, sev: inRange(x.severity, 1, 3) }))
      .sort((a, b) => (b.sev || 0) - (a.sev || 0));
    return risks.map((x) => `<div class="db-card db-risk">
      ${x.sev ? `<span class="db-sev s${x.sev}">${SEV[x.sev]}</span>` : ""}
      <div><b>${esc(str(x.name))}</b>${str(x.note) ? `<p class="db-note">${esc(str(x.note))}</p>` : ""}</div></div>`).join("");
  }

  function pageValuation(r, d) {
    const v = obj(fin(d).valuation) || {};
    const s = obj(d.snapshot) || {};
    const cur = curOf(d);
    let html = "";
    const pt = parsePrice(r.priceTarget);
    if (isNum(s.price) && s.price > 0 && pt) {
      const up = ((pt - s.price) / s.price) * 100;
      html += `<div class="db-card db-target">
        <div><div class="db-eyebrow">Price</div><b>${esc(price(s.price, cur))}</b></div>
        <div class="db-arrow ${up < 0 ? "down" : "up"}">${up < 0 ? "↘" : "↗"} ${esc(pct(up, { sign: true }))}</div>
        <div><div class="db-eyebrow">Target</div><b>${esc(price(pt, cur))}</b></div></div>`;
    }
    const tiles = [["Price / sales", v.ps], ["Price / earnings", v.pe], ["Price / book", v.pb], ["Price / free cash flow", v.pfcf]]
      .filter(([, x]) => isNum(x)).map(([k, x]) => tile(k, esc(mult(x))));
    if (tiles.length) html += `<h2 class="db-h2">Multiples</h2><div class="db-tiles">${tiles.join("")}</div>`;
    html += returnsTiles(d);
    if (isNum(s.market_cap)) html += `<p class="db-foot">Market cap ${esc(money(s.market_cap, cur))}</p>`;
    return html;
  }

  function pageVerdict(r, d) {
    const rc = ratingClass(r.rating);
    let html = `<div class="db-verdict"><span class="badge xl ${rc}">${esc(r.rating || DASH)}</span></div>
      <div class="db-tiles">
        ${tile("Price target", esc(r.priceTarget || DASH), true)}
        ${tile("Horizon", esc(r.timeHorizon || DASH), true)}
        ${r.analysisDate ? tile("As of", esc(r.analysisDate), true) : ""}
      </div>`;
    if (str(r.summary)) html += noteCard("Executive summary", r.summary, "doc");
    if (d) {
      const chips = [];
      const stage = inRange(obj(d.phase) && d.phase.stage, 1, 5);
      if (stage) chips.push(`Stage ${stage} · ${STAGE_NAMES[stage - 1]}`);
      const q = obj(d.quality) || {};
      const vs = QUALITY.map(([k]) => verdictOf(obj(q[k]) && q[k].verdict)).filter((x) => x !== null);
      if (vs.length) chips.push(`Quality ${vs.filter((x) => x === 2).length}/${vs.length} strong`);
      const mr = verdictOf(obj(d.moat) && d.moat.rating);
      if (mr !== null) chips.push(`Moat: ${["none", "narrow", "wide"][mr]}`);
      const top = arr(d.risks).filter((x) => obj(x) && str(x.name)).sort((a, b) => (inRange(b.severity, 1, 3) || 0) - (inRange(a.severity, 1, 3) || 0))[0];
      if (top) chips.push(`Top risk: ${str(top.name)}`);
      if (chips.length) html += `<div class="db-chips">${chips.map((c) => `<span>${esc(c)}</span>`).join("")}</div>`;
    }
    return html;
  }

  function pageBullBear(r, d) {
    const bb = obj(d.bull_bear) || {};
    const list = (xs, cls, glyph) => `<ul>${arr(xs).map(str).filter(Boolean)
      .map((x) => `<li><span class="${cls}" aria-hidden="true">${glyph}</span><span>${esc(x)}</span></li>`).join("")}</ul>`;
    return `<div class="db-bb">
      <div class="db-card bull"><h3>Bull case</h3>${list(bb.bull_points, "up", "▲")}</div>
      <div class="db-card bear"><h3>Bear case</h3>${list(bb.bear_points, "down", "▼")}</div></div>`;
  }

  function pageReport(r) {
    const sections = splitSections(r.md || "");
    return `${paramsDl(r)}${sections.map((s, i) => `
      <details class="section" ${i === sections.length - 1 ? "open" : ""}>
        <summary>${esc(s.title)}</summary><div class="section-body md">${s.html}</div></details>`).join("")}`;
  }

  /* ---------- registry ---------- */
  const PAGES = [
    { slug: "summary", tab: null, title: "Summary", needs: () => true, body: pageSummary },
    { slug: "overview", tab: "Business", title: "Overview", body: pageOverview,
      needs: (r, d) => anyStr(obj(d.overview), ["mission", "what_it_does", "how_it_makes_money"]) || segRows(d).length > 0 },
    { slug: "customers", tab: "Business", title: "Customers", body: pageCustomers,
      needs: (r, d) => anyStr(obj(d.customers), ["who", "why"]) || geoRegions(d).length > 0 },
    { slug: "financials", tab: "Business", title: "Financial overview", body: pageFinancials,
      needs: (r, d) => finVals(d).length > 0 },
    { slug: "quality", tab: "Business", title: "Business quality", body: pageQuality,
      needs: (r, d) => QUALITY.some(([k]) => { const q = obj(obj(d.quality) && d.quality[k]); return q && (verdictOf(q.verdict) !== null || str(q.note)); }) },
    { slug: "phase", tab: "Phase", title: "Phase", body: pagePhase,
      needs: (r, d) => { const p = obj(d.phase); return !!p && (["revenue_growing", "profitable", "returning_capital"].some((k) => obj(p[k]) && (boolOf(p[k].answer) !== null || str(p[k].note))) || (obj(p.profit_metric) && str(p.profit_metric.label)) || !!history(d) || inRange(p.stage, 1, 5) !== null); } },
    { slug: "moat", tab: "Moat", title: "Moat", body: pageMoat,
      needs: (r, d) => { const m = obj(d.moat); return !!m && (verdictOf(m.rating) !== null || !!str(m.note) || arr(m.drivers).some((x) => obj(x) && str(x.name))); } },
    { slug: "growth", tab: "Growth", title: "Growth", body: pageGrowth,
      needs: (r, d) => { const g = obj(d.growth); return (!!g && (!!str(g.note) || arr(g.drivers).some((x) => obj(x) && str(x.name)))) || cagrTable(d) !== ""; } },
    { slug: "management", tab: "Management", title: "Management", body: pageManagement,
      needs: (r, d) => anyStr(obj(d.management), ["ceo", "note", "capital_allocation_note"]) },
    { slug: "risk", tab: "Risk", title: "Risks", body: pageRisk,
      needs: (r, d) => arr(d.risks).some((x) => obj(x) && str(x.name)) },
    { slug: "valuation", tab: "Valuation", title: "Valuation", body: pageValuation,
      needs: (r, d) => { const v = obj(fin(d).valuation) || {}; return ["ps", "pe", "pb", "pfcf"].some((k) => isNum(v[k])); } },
    { slug: "verdict", tab: "Verdict", title: "Verdict", needs: () => true, body: pageVerdict },
    { slug: "bull-bear", tab: "Verdict", title: "Bull vs bear", body: pageBullBear,
      needs: (r, d) => { const bb = obj(d.bull_bear); return !!bb && (arr(bb.bull_points).some(str) || arr(bb.bear_points).some(str)); } },
    { slug: "report", tab: "Report", title: "Full report", needs: (r) => !!str(r.md), body: pageReport },
  ];
  const ALWAYS = new Set(["summary", "verdict", "report"]);

  function dashOf(r) {
    const d = obj(r && r.dashboard);
    return d && d.schema === 1 ? d : null;
  }
  function pages(r) {
    const d = dashOf(r);
    return PAGES.filter((p) => {
      if (!d && !ALWAYS.has(p.slug)) return false;
      try { return !!p.needs(r, d); } catch { return false; }
    });
  }

  function navHtml(r, list, i) {
    const cur = list[i];
    const tabs = [];
    for (const p of list) if (p.tab && !tabs.some((t) => t.tab === p.tab)) tabs.push(p);
    return `<button type="button" class="dn-mono${cur.tab ? "" : " on"}" data-go="${list[0].slug}" aria-label="Summary"${cur.tab ? "" : ' aria-current="page"'}>${esc(monogram(r))}</button>
      <div class="dn-tabs">${tabs.map((t) => `<button type="button" class="dn-tab${t.tab === cur.tab ? " on" : ""}" data-go="${t.slug}"${t.tab === cur.tab ? ' aria-current="page"' : ""}>${esc(t.tab)}</button>`).join("")}</div>
      <span class="dn-count" aria-hidden="true">${i + 1}/${list.length}</span>`;
  }

  function sourcesFoot(d) {
    const s = obj(d.sources) || {};
    const quant = arr(s.quant).map(str).filter(Boolean).join(" · ");
    const bits = [quant && `Figures: ${quant}`, str(s.qual) && `Narrative: ${str(s.qual)}`, str(d.as_of) && `as of ${str(d.as_of)}`].filter(Boolean);
    return bits.length ? `<p class="db-foot">${esc(bits.join(" — "))}</p>` : "";
  }

  function render(r, slug) {
    const d = dashOf(r);
    const list = pages(r);
    let i = list.findIndex((p) => p.slug === slug);
    if (i < 0) i = 0;
    const p = list[i];
    let body;
    try {
      body = p.body(r, d, { pages: list, index: i });
    } catch (e) {
      console.warn("dashboard page failed:", p.slug, e);
      body = `<div class="db-card"><p class="muted">This page couldn't be drawn from this report's data.</p></div>`;
    }
    const prev = list[i - 1], next = list[i + 1];
    const html = `<article class="db-page" data-slug="${p.slug}">
      ${p.slug === "summary" ? "" : `<h1 class="db-h1">${esc(p.title)}</h1><hr class="db-rule"/>`}
      ${body}
      ${d && p.slug !== "report" && p.slug !== "summary" ? sourcesFoot(d) : ""}
      <nav class="db-pager" aria-label="Page navigation">
        ${prev ? `<button type="button" class="db-prev" data-go="${prev.slug}">‹ ${esc(prev.title)}</button>` : "<span></span>"}
        ${next ? `<button type="button" class="db-next" data-go="${next.slug}">${esc(next.title)} ›</button>` : "<span></span>"}
      </nav></article>`;
    return { html, nav: navHtml(r, list, i), slug: p.slug, index: i, total: list.length, title: p.title };
  }

  function neighbor(r, slug, dir) {
    const list = pages(r);
    const i = list.findIndex((p) => p.slug === slug);
    const n = list[(i < 0 ? 0 : i) + dir];
    return n ? n.slug : null;
  }

  return { render, pages, neighbor };
})();
