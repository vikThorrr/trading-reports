# Dashboard redesign — plan & data contract

**Status (2026-10-02):** WS2 shipped in v16 — renderer, theme, publish hook,
all 14 pages verified against the fixture in both themes. WS1 (the emitter) in
progress in the TradingAgents repo. Deviations from the mockups, both for
phone legibility: Business-quality cards stack one per row below ~500px (two
across needs ~8pt labels), and the cover shows the rating as a headline badge
rather than a tile. Geography is bars in v1 (map is phase 2).

Target: rebuild the report **detail view** as a paged, mockup-style dashboard
(cream/green cards, tab nav, "N/14" counter), retheme the rest of the app to
match, and keep every existing feature (lock, list, live-run card, share, push,
PDF) working. Built from 5 mockups (pages 2–6 of 14, MSFT example).

## 0. The one decision everything hangs on

Almost no number on the mockups exists in today's reports. The report markdown
is narrative prose whose shape varies by model — scraping it is a dead end.
So the redesign is split into **three workstreams around one frozen contract**:

| WS | Who | What |
|---|---|---|
| WS1 | TradingAgents session (prompt in §8) | Emit `dashboard.json` next to `run_metadata.json` at the end of every successful run |
| WS2 | Opus 5.5 ultracode session (spec §4–§6) | App renderer + theme + a 6-line publish.mjs hook. Builds against the fixture in §3 — does NOT wait for WS1 |
| WS3 | Either, after both land | One real end-to-end run → publish → deploy → phone check |

The schema in §2 is **frozen at "schema": 1**. Both sides build against it.
Every field is nullable; the renderer shows "—" for null and *hides whole
pages* whose data is absent. A failed dashboard emission must NEVER fail or
delay a run — it's enrichment, not a dependency.

## 1. Data truth table (what can actually be sourced)

Reachable vendors (egress allowlist, `deploy/squid/squid.conf`): **Yahoo
Finance, Alpha Vantage, FRED, Reddit, Stocktwits, Polymarket.** Nothing else —
do not touch the allowlist.

| Mockup element | Source | Confidence |
|---|---|---|
| Margins, health, valuation multiples, yields | yfinance `info` + statements | High, deterministic |
| Growth CAGRs 3/5/10-yr (rev, EPS, FCF) | **Alpha Vantage** annual statements (20 yrs; yfinance only has ~4) | High; mind AV free tier 25 req/day → ≤4 calls/run, cache raw JSON in the run dir |
| Revenue & profit history (5 FY + LTM) | AV + yfinance TTM | High |
| Phase checks (growing / profitable / returning capital) | computed from the above | High |
| Rating / PT / horizon / summary (cover & verdict pages) | already in `decision.md` → existing report fields | Done today |
| Risks, bull/bear points | distilled by LLM **from the run's own debate text** (final_state in memory at save time) | Good — it's the pipeline's unique strength |
| Mission / what-it-does / customers / quality verdicts / moat / management | LLM general knowledge | OK for large caps; weak for small caps → emit null when unsure |
| **Revenue by segment** | **No API source exists on the allowlist.** LLM-known only | Low — must carry `"source":"llm"`; renderer labels it "approx."; null is fine |
| **Revenue by geography (map)** | Same as segments | Low — same handling |

## 2. `dashboard.json` — schema 1 (FROZEN)

Written to `<report folder>/dashboard.json`, UTF-8, single JSON object.
Numbers are raw (332000000000, 45.1) — the app formats ($332B, 45.1%).
All strings ≤ 280 chars. Arrays capped: segments ≤ 8, regions ≤ 6, drivers ≤ 4,
risks ≤ 6, bull/bear points ≤ 5. Any field may be null or absent.

```json
{
  "schema": 1,
  "ticker": "MSFT",
  "as_of": "2026-10-02",
  "currency": "USD",
  "sources": { "quant": ["yfinance", "alphavantage"], "qual": "llm:qwen2.5:7b" },

  "snapshot": { "company_name": "Microsoft", "exchange": "NASDAQ",
                "price": 517.3, "market_cap": 3850000000000,
                "one_liner": "Software and computing infrastructure that businesses run on." },

  "overview": {
    "mission": "To empower every person and every organization on the planet to achieve more.",
    "what_it_does": "Builds the software and computing infrastructure that businesses, governments, and individuals run on.",
    "how_it_makes_money": "Subscriptions and consumption contracts rather than one-time licenses, so customers keep paying while they keep using the product.",
    "segments": {
      "source": "llm", "fiscal_label": "FY26", "total_revenue": 332000000000,
      "rows": [
        { "name": "Server Products and Cloud Services", "revenue": 129000000000, "yoy_pct": 31 },
        { "name": "Microsoft 365 Commercial", "revenue": 102000000000, "yoy_pct": 16 },
        { "name": "Gaming", "revenue": 21800000000, "yoy_pct": -7 },
        { "name": "LinkedIn", "revenue": 19800000000, "yoy_pct": 11 }
      ]
    }
  },

  "customers": {
    "who": "Large enterprises and government bodies: they rent Azure capacity and buy Microsoft 365 seats for staff.",
    "why": "Fit — the servers, databases, and tools their teams use come from the same supplier.",
    "geography": { "source": "llm",
      "regions": [ { "name": "United States", "pct": 51, "iso": ["US"] },
                   { "name": "Rest of World", "pct": 49, "iso": [] } ] }
  },

  "financials": {
    "margins":  { "gross_pct": 67.9, "operating_pct": 46.8, "net_pct": 40.3, "fcf_pct": 20.2 },
    "health":   { "cash": 76800000000, "total_debt": 56800000000,
                  "debt_to_equity": 0.13, "ebit_interest_cover": null },
    "growth":   { "revenue_cagr": { "y3": 16.1, "y5": 14.6, "y10": 13.8 },
                  "eps_cagr":     { "y3": 22.9, "y5": 17.4, "y10": 21.5 },
                  "fcf_cagr":     { "y3": 4.0,  "y5": 3.6,  "y10": 10.4 } },
    "valuation": { "ps": 11.5, "pe": 28.6, "pb": 8.6, "pfcf": 56.9 },
    "returns":  { "dividend_yield_pct": 0.7, "buyback_yield_pct": 0.5,
                  "debt_paydown_yield_pct": 0.1, "total_yield_pct": 1.3 }
  },

  "quality": {
    "predictable_revenue":  { "verdict": 2, "note": "~70% of revenue is consumption and per-seat subscriptions that renew without a fresh buying decision; revenue rose each of the last seven quarters." },
    "pricing_power":        { "verdict": 2, "note": "Operating margin edged up to 45.1% while revenue grew 17.7%, and a paid AI tier was added on top of existing subscriptions." },
    "recession_proof":      { "verdict": 2, "note": "Cloud infrastructure and workplace software businesses must run to operate; advertising is only 4.6% of revenue." },
    "competitive_position": { "verdict": 2, "note": "ROIC of 25.3% is roughly double the 12.6% peer median; category-defining in both revenue drivers." },
    "roic_pct": 25.3, "peer_roic_median_pct": 12.6
  },

  "phase": {
    "revenue_growing":   { "answer": false, "note": "+0% in the last year" },
    "profitable":        { "answer": true,  "note": "$183B operating cash flow" },
    "returning_capital": { "answer": true,  "note": "buybacks and dividends" },
    "profit_metric": { "key": "ocf", "label": "Operating Cash Flow", "why": "best signal for asset-light" },
    "history": { "labels": ["FY22","FY23","FY24","FY25","FY26","LTM"],
                 "revenue": [198e9, 212e9, 245e9, 282e9, 332e9, 332e9],
                 "profit":  [89e9, 87.6e9, 119e9, 136e9, 183e9, 183e9] },
    "stage": 4, "stage_note": "Profitable, still growing, returning capital through dividends and buybacks."
  },

  "moat":   { "rating": 2, "drivers": [ { "name": "Switching costs", "note": "…" } ], "note": "…" },
  "growth": { "drivers": [ { "name": "Azure AI consumption", "note": "…" } ], "note": "…" },
  "management": { "ceo": "Satya Nadella", "ceo_since": 2014,
                  "note": "…", "capital_allocation_note": "…" },
  "risks": [ { "name": "Antitrust pressure", "severity": 2, "note": "…" } ],
  "bull_bear": { "bull_points": ["…"], "bear_points": ["…"] }
}
```

`quality.*.verdict` and `moat.rating`: 0 = weak/✗, 1 = middle/–, 2 = strong/✓.
`risks[].severity`: 1 low · 2 medium · 3 high. `phase.stage`: 1 Startup,
2 Hyper Growth, 3 Operating Leverage, 4 Capital Return, 5 Decline.

Stage rule (deterministic first, LLM may shift ±1 with a reason in stage_note):
rev 3-yr CAGR < 0 → 5; unprofitable & rev growth > 25% → 2; unprofitable &
small → 1; profitable & (dividends+buybacks) returning capital → 4; else → 3.

## 3. Fixture

WS2 uses the §2 MSFT example verbatim as its test fixture (save as
`fixtures/dashboard.msft.json`, git-ignored or committed — either fine). App
work must not block on WS1.

## 4. Publish hook (tiny)

In `publish.mjs` `collectReports()`: if `<dir>/dashboard.json` exists,
`JSON.parse` it and attach as `dashboard` on the report entry (null + console
warning on parse error). Blob grows ~8 KB/report — negligible. Old app
versions ignore the unknown key; new app handles its absence.

## 5. App spec (WS2)

**Keep untouched:** lock flow, list logic, live-run card, share crypto, push,
settings, pull-to-refresh, request sending. This is a re-skin + a new detail
renderer.

**Theme** — replace the palette in `style.css` tokens (everything already uses
vars). Light: `--bg:#F7F4EC; --surface:#FFFFFF; --surface-2:#EFEAE0;
--border:#E5DFD2; --text:#2E3338; --muted:#7A8089; --accent:#3BA55D;
--accent-deep:#1E7A46; --buy:#3BA55D; --sell:#E5484D; --hold:#F5A623;
--radius:20px`. Dark (prefers-color-scheme): `--bg:#17160F; --surface:#201E16;
--surface-2:#2A2820; --border:#3A3729; --text:#EDEAE0; --muted:#9A968A` (same
accents). Headings: `font-family: ui-rounded, "SF Pro Rounded", -apple-system,
sans-serif; font-weight: 800` — gives the mockups' rounded look on iOS with no
webfont, offline-safe. Update `<meta name="theme-color">` for both schemes.
Check list view, modals, lock screen contrast after the token swap.

**New file `dashboard.js`** (plain script, loaded by index.html; share.html in
a later phase): a page registry + pure render functions.

```js
PAGES = [ { slug, tab, title, needs(r), render(r) → html string }, … ]
```

Nav shows only pages whose `needs(r)` is true; the counter is "pos/available".
A report with no `dashboard` key → Cover + Verdict + Full report only.

**Page map (14 when fully populated):**

| # | Tab | Page | Data |
|---|---|---|---|
| 1 | — | Cover: monogram tile (ticker initials — no logo fetching), rating badge, price target, horizon, one_liner | existing fields + snapshot |
| 2 | Business | Overview: mission / what / how cards + segment bar & table (top 4 + "Other · N segments", share computed client-side; "approx." chip when source=llm) | overview |
| 3 | Business | Customers: who/why cards + geography (v1: horizontal region bars; v2: static `assets/world.svg` recolored by iso, bars as fallback) | customers |
| 4 | Business | Financial overview: 5 metric groups, "—" for nulls (mock itself shows "EBIT / interest —") | financials |
| 5 | Business | Business quality: 4 verdict-triple cards (✗/–/✓) + note | quality |
| 6 | Phase | 3 check rows (✗No/✓Yes pills) + profit-metric callout + revenue/profit SVG line chart + lifecycle diagram | phase |
| 7 | Moat | rating triple + driver cards | moat |
| 8 | Growth | driver cards + CAGR table reuse | growth + financials.growth |
| 9 | Mgmt | CEO facts + notes (page hidden if all null) | management |
| 10 | Risk | severity-chip rows | risks |
| 11 | Valuation | multiples vs yields + valuation notes | financials.valuation + bull_bear context |
| 12 | Verdict | rating, PT, horizon, executive summary | existing fields |
| 13 | Verdict | Bull vs Bear two-column | bull_bear |
| 14 | Report | Full report: the existing `splitSections`/`mdToHtml` render, unchanged | r.md |

**Navigation/UX:** sticky top bar = monogram + horizontally scrollable tab
pills + "N/M" counter chip. Swipe left/right to change page (threshold ~50 px;
ignore gestures starting inside `.table-wrap` or a chart scroller). Arrow keys
on desktop. Route: `#/r/<id>/<slug>` extending `route()` — back button and
reload restore the page.

**Charts (all dependency-free inline SVG helpers):**
- `svgLineChart`: 2 series, dot + value label per point, segment drawn red
  when the value declined vs the prior point (mock: FY22→FY23 OCF).
- Segment bar: stacked `<div>`s, no SVG needed.
- Lifecycle: one static SVG template (5 columns, decorative dashed curves);
  JS only positions the highlight band + ticker badge from `phase.stage`.
- Map (phase 2): static `world.svg` with ISO-classed paths; fill from
  `geography.regions[].iso`; if asset missing or no iso data → bars.

**PDF:** v1 keeps the existing markdown print path. **Share page:** v1
unchanged (dashboard flows into share blobs automatically but share.js ignores
it); wiring share.html to dashboard.js is phase 3.

**Versioning:** bump `?v=` (currently 15) on index.html + share.html, CACHE in
sw.js, and add `dashboard.js?v=N` (+ world.svg later) to the SW SHELL list.

## 6. Build order + verification (WS2)

1. Token swap + theme pass over existing views (light & dark, 430×932).
2. `dashboard.js` registry + pager + cover/fallback pages; publish.mjs hook.
3. Pages 2–6 against the fixture (inject via console onto a real report).
4. Pages 7–13. 5. Polish: swipe, hash routing, a11y (verdicts need text, not
   color alone; pager announces page title via the existing role=status
   pattern — do NOT make the whole card aria-live).

Verify before deploy, in the preview browser: fixture report renders all 14;
a dashboard-less report degrades to 3 pages; an all-null dashboard renders
dashes and hides empty pages; swipe/tabs/hash/back all agree; both themes;
console clean. **Traps from this repo's history:** bump versions AFTER the
last edit (stale-SW burned a session); the preview service worker caches
aggressively — unregister + clear caches when testing; never leave
trading-reports dirty for long (listener), never edit listen.sh in place while
it runs (this workstream shouldn't touch it at all); the TRADING AGENTS
session must stay off app files — coordination precedent exists.

## 7. Open questions for Victor

1. Full-app retheme to cream/green (assumed yes) — or detail view only?
2. Geography v1 as bars with the map in phase 2 — OK? (A decent world SVG is
   ~60 KB; bars are free and the data is only "US vs rest" anyway.)
3. Segments/geography have **no API source** — show LLM-sourced numbers with
   an "approx." chip (default), or omit entirely?
4. Old reports won't get dashboards (no backfill) — acceptable?

## 8. Prompt for the TradingAgents session (WS1)

Copy-paste from the chat message, or see the same text in
`REDESIGN-WS1-PROMPT.txt` next to this file.
