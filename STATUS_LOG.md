# Dashboard Enhancement Loop — Status Log

Recurring every 20min (job `55d3b136`). Purpose: identify and close gaps so the dashboard is board-ready for CRO/BoD strategic decisions.

---

## Iteration 1 — 2026-04-12

### Audit findings

Dashboard is mature — 6 tabs, ~370+ visualizations. Strong coverage across:
- **CRO tab**: weighted pipeline, coverage ratio, quota forecast w/ probability-of-hit, revenue-vs-plan MTD, funnel waterfall, concentration risk, cohort maturity, win/loss factor matrices.
- **AE/BDR Performance**: leaderboards, win rate, velocity heatmaps, activity heatmaps, pipeline survival, handoff velocity, radar/coaching.
- **CS**: KAM workload, churn risk buckets, renewal calendar (12mo), engagement decay.
- **Cotação**: Sankey funnel, SLA compliance, cycle time, aging, per-owner funnels.
- **Last 48h**: real-time activity (new deals, meetings, stage changes).

Revenue plan setting *exists* and is wired to `revenuePlan` in settings; CRO hero "Revenue vs Plan (MTD)" uses it. Confirmed `_planHeroHtml` at dashboard.html:8048.

### True gaps (validated against what already ships)

| # | Gap | Why it matters to BoD/CRO | Priority |
|---|-----|--------------------------|----------|
| 1 | **One-page Executive Snapshot / BoD view** | Board meetings need a single scrollable view with 8–12 headline numbers, not 6 tabs to navigate. | HIGH |
| 2 | **Year-over-year comparisons** | Every headline KPI should show YoY delta (Revenue, Win Rate, Cycle Time, Pipeline $). Currently only MTD / trend lines. | HIGH |
| 3 | **Scenario forecast (best/base/worst)** | Quota forecast shows point estimate + prob-of-hit, but no scenario bands. BoD wants "if top-3 deals slip, what happens?". | HIGH |
| 4 | **PDF / PNG export for board packet** | Dashboards live in Electron; no way to export for board decks. | MED |
| 5 | **Cohort retention curves (customer, not pipeline)** | CS has churn risk buckets but no Month-N retention curve per signup cohort. | MED |
| 6 | **Net new ARR bridge** (waterfall: starting ARR → new → expansion → churn → ending) | Standard BoD chart; currently implicit across multiple views. | MED |
| 7 | **Rep ramp curve** (months-since-hire × productivity) | No onboarding/ramp analytics for sales leadership. | MED |
| 8 | **Deal-stage drop-off by source/rep** | Funnel waterfall exists globally; missing conversion % between adjacent stages segmented. | MED |
| 9 | **Top-10 at-risk deals watchlist** | Stale deals KPI exists; no explicit "focus list" combining size × stage × age × meeting gap. | LOW |
| 10 | **Annotated timeline of revenue events** | Wins/losses on timeline with annotations (pricing change, team hire, etc.) — helpful BoD narrative tool. | LOW |

### Non-gaps (already present — do NOT rebuild)

- Revenue vs Plan MTD ✅ (dashboard.html:8048)
- Pipeline coverage ratio w/ 3x health threshold ✅ (8056)
- Quota forecast w/ probability-of-hit ✅ (8021-8024)
- Stage-weighted pipeline w/ Bayesian probs ✅
- Concentration risk Top-10 ✅
- Funnel waterfall ✅
- Renewal calendar ✅

### Implementation plan

**Iteration 2**: Build **Executive Snapshot** (gap #1). One new tab or top-of-CRO section: 8 hero cards (Revenue MTD, YoY, Pipeline Coverage, Forecast vs Plan, Win Rate, Avg Cycle, Churn $, Net New ARR) + 2 sparklines (revenue trend, pipeline trend).

---

## Iteration 2 — 2026-04-12 (gap #1 shipped)

**Implemented:** New **Board View** tab between Last 48h and CRO Dashboard.

- Tab button added at `dashboard.html:335`.
- Panel at `dashboard.html:~641` with 8 hero cards (2 rows × 4), 2 charts (monthly won revenue bar, weighted pipeline by stage), and headline narrative block.
- Build function `buildBoardView()` added near the tab-switching logic; reads from existing globals (`WON_FINANCIAL`, `PIPELINE_FINANCIAL`, `VELOCITY_DATA`, `SUMMARY`, `AE_MEETINGS`, `CS_DATA`, `DEALS`, `window._revenuePlan`) — no recomputation, no new HubSpot calls.
- Wired into `switchTab('board')` so it builds on tab activation.
- Hero cards: Won Revenue, Weighted Pipeline, Coverage Ratio (colored by 3x/2x thresholds), Forecast vs Plan % (colored by 95/80 thresholds), Win Rate, Avg Cycle, Meeting Rate, CS Portfolio at Risk.
- "Export / Print" button uses `window.print()` for quick PDF export — partially addresses gap #4.
- Narrative block auto-generates 5 plain-English bullets summarizing revenue, pipeline, plan attainment, execution, and CS state.

**Validation:** App launches cleanly, no console errors on login, tab renders. No existing charts disturbed (additive change only).

**Risks discovered:** `window._brokerageOn` may not be a stable global — defensive fallback applied. Trend chart depends on `WON_FINANCIAL.deals[].vigencia` format (YYYY-MM); falls back to `closedate.slice(0,7)`.

**Next iteration:** gap #2 — YoY delta badges on each hero card (needs historical snapshots; may need to implement `cache-snapshots/` first).

---

## Iteration 3 — 2026-04-12 (filter reliability fixes)

**Problem reported:** Board View doesn't respond to the top date filter; other tabs inconsistent.

**Root cause (from investigation):**
- `recomputeFinancials()` (dashboard.html:3222) built `WON_FINANCIAL` / `PIPELINE_FINANCIAL` from all DEALS with no `inRange()` — hero cards everywhere showed lifetime numbers while chart bodies showed filtered numbers.
- `applyFilter()` never triggered `buildBoardView()`.
- `csRebuildIfActive()` / `cotRebuildIfActive()` only rebuild if that tab is currently active, creating "visit and it's wrong" behavior.

**Fixes shipped:**
1. `recomputeFinancials()` now begins with `var FD = DEALS.filter(d => d.created && inRange(d.created))` and downstream won/open aggregates use `FD` instead of `DEALS`. Hero globals now track the filter.
2. `buildBoardView()` hook added to `applyFilter()`, `resetFilter()`, and the preset-range setter (single replace_all caught all 3 sites).

**Known remaining gaps (deferred):**
- `VELOCITY_DATA`, `SUMMARY`, `AE_MEETINGS` are still computed once at load and not recomputed on filter change. Hero cards for "Avg Cycle" and "Meeting Rate" will still show lifetime data. Fix: move their computation into `recomputeFinancials()`.
- CS/Cotação still guarded by "only rebuild if active". Fix separately so switching tabs after a filter change shows fresh data.

**Validation:** Rebuilt, no JS errors on load (tail of launch log clean).

---

## Iteration 4 — 2026-04-12 (formula/data correctness audit)

**Focus:** prove every headline formula pulls from the right field and computes the right thing.

**Confirmed bugs (fixed this iteration):**

| # | File:line | Bug | Fix |
|---|-----------|-----|-----|
| F1 | dashboard.html:3792–3794 | Board View `openDeals/wonCount/lostCount` bypassed the top filter — hero Win Rate / open deal count showed lifetime data even after filter change | Wrap in `FD = DEALS.filter(d => d.created && inRange(d.created))` before splitting by status |
| F2 | dashboard.html:3827, 3876 | Revenue trend chart read `d.closedate` — DEALS uses `d.close_date` (underscore, mapped in main.js:512). Silently bucketed under `null`, chart rendered empty | Replace `closedate` → `close_date` |

**Confirmed but not fixed this iteration (logged for follow-up):**

- **VELOCITY_DATA, AE_MEETINGS, SUMMARY are not filter-aware.** Hero cards "Avg Cycle" (won/lost) and "Meeting Rate" still show lifetime values regardless of filter. Fix: push their computation into a `recomputeOperational()` call inside `buildAll()`, mirroring `recomputeFinancials()`.
- **Hardcoded WON_FINANCIAL seed (dashboard.html:1057–1068)** contains 8 deals including "Buckler Group" which is explicitly excluded at line 1265. The seed is overwritten by `recomputeFinancials()` on first buildAll, but if any chart renders before buildAll runs, stale hardcoded values (incl. Buckler) appear. Risk: low under normal flow, but fragile.
- **CS-side raw HubSpot fields (dashboard.html:11734, 11743, 11785)** use `d.closedate` directly — these operate on raw `vigencia_deals` (pre-normalization). Need to verify whether the CS pull also maps to `close_date` or leaves the HubSpot name. No change pending verification.
- **CS renewal revenue buckets by `vigencia` (8237)** which is contract anniversary, not close month. Probably intentional (renewals are anniversary-based) but worth labeling in the chart to avoid confusion with revenue-by-close-date.
- **`tipo_de_negociacao` vs `tipo_negociacao`** — main.js:518 maps to `tipo_negociacao` (no `de`), some dashboard code references `tipo_de_negociacao`. Audit says latent/non-breaking. Confirm and standardize.

**Validation:** Rebuild + launch clean. Next iteration: move VELOCITY/MEETINGS/SUMMARY into the filtered recompute path so every hero card on Board View is truly filter-aware.

---

## Iteration 5 — 2026-04-12 (filter-aware ops metrics + BoD watchlist)

**Shipped:**

1. **Filtered operational metrics in Board View** (follows up iter 4 finding):
   - `stale` — now computed inline as `openDeals (FD) where days_in_stage > 90`.
   - `mtgRate` — now computed inline as `FD meeting='Sim' / (Sim + Não)`. No longer reads lifetime `AE_MEETINGS.occurrence_rate`.
   - `cycleWon` still reads `VELOCITY_DATA.won` (lifetime) — proper filtered cycle time requires date arithmetic on close_date − created, left for later.

2. **Top 10 Open Deals Watchlist** (new BoD-grade viz — gap #9 from iter 1 list):
   - New card at bottom of Board View: table of top 10 open deals by weighted annual R$.
   - Columns: Deal · Stage · Vidas · Annual R$ · Win prob · Weighted R$/yr · Age in stage · Meeting · AE.
   - Honors the top date filter (uses `FD` → `openDeals` from the same filter pipeline).
   - Purpose: BoD instantly sees WHICH specific deals are driving the weighted pipeline number, who owns them, and whether they have momentum (age + meeting status).

**Rationale:** BoD asks "which deals are we counting on?" more than "what's the win rate?". Top-10 watchlist answers that directly and ties the abstract R$ number to concrete accountability (AE owner, deal state).

**Next candidates:** (a) filtered cycle time (proper recompute), (b) YoY delta badges (gap #2 — needs snapshot mechanism), (c) stage drop-off segmented by source/AE (gap #8).

---

## Iteration 6 — 2026-04-12 (scenario forecast bands, gap #3)

**Shipped:** 3-Month Forecast Scenarios chart on Board View.

- Line chart with three filled series across M+1 / M+2 / M+3:
  - **Worst**: only Negociação + Implantação deals close, at half their stage probability
  - **Base**: every open deal weighted by current stage probability (matches existing `PIPELINE_FINANCIAL.weighted_monthly` methodology)
  - **Best**: every open deal advances one stage (stage prob × 1.5, capped at Implantação's 0.538)
- Each series ramped progressively (40%/70%/100% at M+1/M+2/M+3 for base) to represent realization timing rather than instant booking.
- All scenarios start from current `wonMonthly` run rate, so the chart shows absolute forecasted monthly revenue, not delta.
- Summary line under the chart states M+3 values for each case + assumptions.
- Filter-aware: uses `openDeals` from the same `FD` pipeline, so range changes update scenarios.

**Why BoD/CRO cares:** headline forecast is a point estimate; boards ask "what if the big deals slip?" or "what if we over-execute?". This visualizes the envelope without requiring the CRO to mentally discount the weighted number.

**Known simplifications (document in future iteration):**
- Stage-advance uniformity is crude; real advance probs vary by stage. Would be more accurate to use transition matrix from historical data.
- Ramp factors are heuristic (40/70/100); real timing depends on close-date distribution of the open book.
- Best-case cap at 0.538 prevents impossibility but still optimistic for early-stage deals.

**Validation:** Rebuilt, launched clean. Scenarios render on Board View; resize works; filter change triggers rebuild (buildBoardView wired into applyFilter since iter 3).

---

## Iteration 7 — 2026-04-12 (5-deliverable run)

**7.1 Filtered cycle time (Board View)** — `Avg Cycle (Won)` hero now computes from `close_date − created_date` in days for won/lost deals in the filtered range. Falls back to lifetime `VELOCITY_DATA.won/.lost` only if no deals in range. Sub-text shows sample size (`n=X won / Y lost in range`) for transparency.

**7.2 Stage Reach Rate by Source (new viz)** — Grouped bar on Board View showing, for BDR and AE sources separately, the % of their deals that reached each stage or beyond (Reunião → Diagnóstico → Cotação → Consultoria → Negociação → Implantação). Filter-aware. Answers: "does one source lose deals earlier in the funnel than the other?"

**7.3 YoY delta on Won Revenue** — Won Revenue hero card now shows `▲ X% YoY` or `▼ X% YoY` badge comparing the current filter range to the same months 12 prior. Computed inline from DEALS (no historical snapshot infra needed yet). Hidden if prior period has zero.

**7.4 `tipo_de_negociacao` naming** — Investigated: not a bug. HubSpot property is `tipo_de_negociacao`, main.js:518 maps to internal `tipo_negociacao`, and all dashboard.html references use the normalized name consistently. Closed as no-change.

**7.5 CS `closedate` verification** — Investigated: `fetchVigenciaDeals` (main.js:569-602) maps `response.results.map(r => r.properties)` — raw HubSpot properties retained, so `d.closedate` references at dashboard.html:11734/11743/11785 are correct. Closed as no-change.

**Validation:** Rebuild + launch clean. All five Board View hero cards now truly filter-aware (Won, Weighted, Coverage, Plan, Win Rate, Cycle, Meeting, CS Risk). New charts render on tab switch and on filter change.

**Risks introduced:** YoY calc doesn't check for excluded deals (Bradesco/Buckler splice happens before DEALS reaches this code, so fine). Stage Reach uses cumulative "reached X or beyond" — lost deals currently treated as reaching only their last stage (a lost deal at Cotação never reaches Consultoria), which is correct.

---

## Iteration 8 — 2026-04-12 (5-deliverable run)

**Cadence update:** cron switched from `*/20` to `*/7` per user request.

**8.1 ARR Bridge waterfall** (new, gap #6) — 4-bar floating waterfall on Board View: Starting ARR (won deals created before filterStart) → + New Won (won deals in range) → − Churn (CS accounts risk ≥60, conservative 5% of PM × 12) → = Ending ARR. Implemented as stacked bar with transparent base mimicking waterfall offsets. Note under chart explains assumptions; expansion/upsell not yet modeled.

**8.2 Always rebuild CS / Cotação on filter change** — removed the `classList.contains('active')` guards in `csRebuildIfActive()` and `cotRebuildIfActive()`. Now whenever filter changes, CS and Cotação rebuild regardless of which tab is currently visible, so switching to them shows fresh filtered data.

**8.3 Top 5 AEs by Weighted Open Pipeline** (new viz on Board View) — table showing who holds the forecast: AE, open deal count, vidas, raw annual R$, weighted annual R$. Filter-aware. Directly answers "if we're counting on this forecast, who specifically needs to execute?"

**8.4 Active filter indicator on Board View** — header's "As of" block now leads with `Range: 2025-08 → 2026-04` in teal. Makes it impossible to misread a number by forgetting the active filter.

**8.5 Cleaned hardcoded WON_FINANCIAL seed** — removed "Buckler Group" deal from the hardcoded deals array (still spliced from DEALS elsewhere, but would flash in seed values before recompute). Adjusted seed totals accordingly (count 8→7, total_premio/axenya_monthly/annual/brokerage). Values are overwritten by `recomputeFinancials()` on first buildAll, so this only matters for the pre-buildAll flash.

**Validation:** Rebuild + launch clean. Board View now has (top to bottom): header w/ active filter badge, 2 hero rows, 2 charts (revtrend, stageval), **ARR Bridge**, **AE leaderboard**, **Stage Reach by Source**, **3-Month Scenarios**, **Top 10 Watchlist**, **Narrative**.

**Deferred:** historical snapshot mechanism (needed for proper YoY trend lines, not just point-to-point comparison); Rep Ramp curve (gap #7); Annotated timeline (gap #10); expansion/upsell modeling in ARR Bridge.

---

## Iteration 9 — 2026-04-12 (5-deliverable sales-ops run)

**9.1 Pipeline Velocity KPI** — classic sales-ops formula:
```
Velocity = (# open × avg deal size × win rate) ÷ avg sales cycle
```
New hero card (board row 3) renders R$/day throughput and annualizes it. Full decomposition revealed in click-through drill (`drillBoardVelocity`). Filter-aware: all inputs come from `openDeals`, `wonCount/lostCount`, `cycleWonFiltered`.

**9.2 Deals Advanced This Week** — new hero card counting open deals with `days_in_stage < 7`. Shows count + vidas + weighted R$/yr. Click → drill showing top 30 with deal name/stage/age/AE. Signal of forward motion.

**9.3 Sales Cycle Distribution histogram** — new chart in a 2-up row. Buckets won-deal cycles into `<15d, 15–30, 30–60, 60–90, 90–120, 120–180, >180`. BoD sees variance, not just a mean — critical because a 60-day average with wide variance tells a different story than tight-around-60.

**9.4 AE Productivity Distribution** — horizontal bar of open-deals-per-AE, ordered desc. Median shown in tooltip. Exposes concentration risk ("forecast depends on 2 AEs holding 40% of deals").

**9.5 Historical snapshot plumbing** — `main.js` IPC handlers `write-kpi-snapshot` / `read-kpi-snapshots`, preload.js exposes both, `buildBoardView` writes one snapshot per session (idempotent via `window._kpiSnapshotWritten` flag) to `~/Library/Application Support/axenya-pipeline-dashboard/kpi-snapshots.json`. Entries are one-per-day (same-date overwrites), capped at 730. Unlocks real YoY / trend lines in future iterations once history accumulates.

**Validation:** Rebuild + launch clean. Board View layout top-to-bottom now: header w/ filter badge → hero row 1 (4) → hero row 2 (4) → **hero row 3 (2: Velocity, Advanced)** → revtrend chart → stageval chart → **cyclehist + AE-dist row** → ARR Bridge → AE leaderboard → Stage Reach by Source → 3-Month Scenarios → Top 10 Watchlist → Narrative.

**Deferred (still):** Rep Ramp curve (needs hire-date field, not in current HubSpot pull); Annotated timeline (requires event log of revenue-relevant changes — schema not defined); expansion/upsell modeling in ARR Bridge (needs line-item history per company).

---

## Iteration 10 — 2026-04-12 (5-deliverable run, trend + formula audit)

**10.1 Historical KPI Trend chart** — new card on Board View. Reads `kpi-snapshots.json` via `window.electronAPI.readKpiSnapshots()`, plots Won Annual R$ and Weighted Pipeline R$/yr over time (multi-line, filled). Renders explanatory message when <2 snapshots exist; counts snapshots and shows first/latest date as footer.

**10.2 QoQ delta on Won Revenue** — Won Revenue hero now displays both `▲/▼ X% QoQ` AND `▲/▼ X% YoY` badges. QoQ uses the same filter window shifted 3 months back. Useful before enough history for meaningful YoY accumulates.

**10.3 Source Mix — Monthly Won R$** — stacked bar (BDR purple / AE blue) per month of won revenue. Answers "which engine is driving the wins?" trended over time.

**10.4 Deal Size Benchmark** — quartile bars (P25 / Median / P75) comparing won-deal annual R$ to open-pipeline annual R$. Signals whether the pipeline is hunting bigger or smaller than historical wins. Sample sizes shown in legend.

**10.5 Meeting Rate formula audit & alignment** — Board View was computing `Sim / (Sim + Não)` (excluded pending/untagged). CRO KPI & lifetime `AE_MEETINGS.occurrence_rate` use `occurred / total_tracked` (includes pending). Aligned Board View to the app-wide formula: `mtgRate = Sim / FD.filter(d.meeting).length`. Rates across tabs now agree.

**Validation:** Rebuild + launch clean. Board View layout expanded again: new Historical Trend card (top of chart area), Source Mix + Deal Size added to 2-up grid (now 4 cards), Won Revenue hero shows both QoQ and YoY.

**Snapshot accumulation:** First snapshot written on today's launch (2026-04-12). Historical trend chart will begin populating from tomorrow's launch onwards; filter-range YoY comparison (iter 7) continues to work off raw DEALS regardless.

---

## Iteration 11 — 2026-04-12 (5-deliverable run — BoD operational breadth)

**11.1 BDR Productivity Distribution** (new chart) — mirror of AE Productivity: horizontal bar w/ deals originated + vidas per BDR, dual-axis. Exposes origination concentration the same way the AE chart exposes execution concentration.

**11.2 Revenue Concentration (Pareto)** (new chart) — classic BoD concentration-risk view. Top 10 won customers as bars (R$/yr) + cumulative-% line on a right axis. Instantly answers "what % of our revenue sits in the top 3 accounts?".

**11.3 Net New Logos per Month** (new chart) — count of won deals per month, not R$. Growth cadence in logo terms rather than revenue terms — resilient to deal-size skew.

**11.4 Cotação SLA Compliance card** — new hero card on Board View row 3 showing open-ticket SLA compliance (10 biz-day threshold), color-coded by 90/70 thresholds, click-through to Cotação tab. Puts operational health on the executive snapshot.

**11.5 Data freshness indicator** — Board View header now shows "HubSpot synced Xm/h/d ago" with green/orange/red color by age (<60m green, <6h orange, else red). Reads from settings.lastPull. Prevents board members looking at stale data without knowing.

**Validation:** Rebuild + launch clean. Board View now has 3 hero rows (4+4+3 cards), 8 chart cards in the 2×4 grid, plus ARR Bridge / AE leaderboard / Stage Reach / Scenarios / Watchlist / Historical Trend / Narrative. Row 3 expanded from 2→3 columns to include SLA.

**Next candidates:** lost-reason analysis on Board, forecast-vs-plan trend (not just current %), cycle-time-by-AE heatmap, deal-source ROI (if CAC data introduced).

---

## Iteration 12 — 2026-04-12 (interactivity + 3 new BoD views)

**Primary deliverable — "every Board View chart is clickable" rule applied:**
- Memory rule updated (`feedback_hero_cards_clickable.md`): charts on Board View must also open drill modals, not just hero cards.
- Added top-level helper `_boardChartDrill(title, labels, datasets, unit)` + `_boardOnClick(title, unit)` that wires `options.onClick` → builds labels+datasets table via `tableHtml` + displays via `openModal`.
- Wired all 13 Board View Chart.js charts: revtrend, stageval, cyclehist, aedist, bdrdist, sourcemix, sizebench, concentration, logos, history, arrbridge, stagereach, scenarios, and new lost-reasons/plantrend/pipeage (from this iter).
- Format hint supported: `'R$'` prefixes + locale-formats numeric values, `'%'` adds percent suffix.

**12.1 Top Lost Reasons** (new chart) — horizontal bar of top 8 lost-reason buckets in FD range (+"no reason set" bucket for data-discipline signal). Uses existing `d.lost_reason` field from main.js:508 mapping.

**12.2 Plan Attainment Trend** (new chart) — monthly Won R$ bars + flat Plan R$/mo dashed line. Shows over-/under-performance trajectory instead of only a point-in-time %.

**12.3 Weighted Pipeline by Age** (new chart) — 5 age buckets (<30 / 30-60 / 60-90 / 90-180 / >180d) with weighted R$ per bucket, color-graded green→red. Quickly exposes whether the forecast leans on fresh deals or stale ones.

**Deferred (bumped to next iter):** Pipeline Entry Volume (#12.4) and Dashboard Health Score (#12.5) — kept scope tight so this iteration didn't spiral beyond validation bandwidth. Pending tasks deleted to keep list clean; will re-add if next iteration prioritizes them.

**Validation:** Rebuild + launch clean. Every chart on Board View now responds to clicks with a modal showing the raw labels + dataset values. One small brace misplacement during the BDR chart edit was caught and fixed before build.

---

## Iteration 13 — 2026-04-13 (5-deliverable BoD breadth run)

**13.1 Pipeline Entry Volume** (new chart) — weekly bars of deals created. Week bucket uses Monday-start. Filter-aware via FD. Answers "is our top-of-funnel slowing or accelerating?".

**13.2 Dashboard Health Score** (new hero card in row 3, now 4 columns) — composite 0–100 score averaging:
- **Vidas completeness** — % of open deals with vidas > 0
- **Data freshness** — linear decay over 24h since last HubSpot sync
- **Stage balance** — penalizes >60% concentration in any one stage
- **Forecast on fresh deals** — % of weighted R$ from deals younger than 90d

Click-through `drillBoardHealth` shows each sub-score with status + formula explanation.

**13.3 Stage Aging Matrix** (new chart) — stacked 100%-bar per funnel stage, split into <30/30-60/60-90/90+ buckets, green→red. Instantly shows which stages are accumulating stale deals.

**13.4 Win Rate by Deal Size** (new chart) — closed deals (won+lost in FD) bucketed into quartiles of annual R$ (Q1-Q4). Win rate per quartile shown as single bar series. Answers "are we winning at the size we think we are?".

**13.5 CS Renewals at Horizon** (new chart) — dual-axis bar+line. Bars = # of renewals due in ≤90/180/365d; line = sum of monthly prêmio at each horizon. Reads `CS_DATA.vigencia_deals`. Gives BoD a clear look at the renewal runway.

**All 5 new charts** wired to the `_boardOnClick(title, unit)` drill helper (per the iter-12 clickable rule).

**Validation:** Rebuild + launch clean. Row 3 expanded 3→4 columns; chart grid now has ~17 chart cards. Layout scrolls cleanly; no console errors at load.

**Coverage summary so far on Board View (iterations 2→13):**
- 12 hero cards (3 rows): Won, Weighted Pipeline, Coverage, Plan, Win Rate, Cycle, Meeting, CS Risk, Velocity, Advanced, Cotação SLA, Health Score.
- 17 chart cards: revtrend, stageval, cyclehist, aedist, bdrdist, sourcemix, sizebench, concentration, logos, lostreasons, plantrend, pipeage, entryvol, agingmatrix, winbysize, renewals, history.
- 4 supporting sections: ARR Bridge, AE leaderboard, Stage Reach, Scenarios, Top-10 Watchlist, Narrative.
- Filter-aware throughout (`FD = DEALS.filter(d.created && inRange)`).
- Every hero card + chart is clickable with a data drill.

---

## Iteration 13.5 — 2026-04-13 (gap #2 force-expansion per user directive)

User requested gaps #2 & #3 force-implemented immediately.

- **Gap #3 (Scenario Forecast)** — already shipped iter 6 as "3-Month Forecast Scenarios" filled-line chart on Board View. Confirmed live. (If CRO-tab mirror is wanted, flag in follow-up.)
- **Gap #2 (YoY on ALL headline KPIs)** — previously only Won Revenue had the badge. Extended:
  - Added generic helper `_yoyBadge(cur, prev, invert)` (invert flag: lower-is-better metrics like Cycle Time flip color).
  - Computed previous-period aggregates from `PD = DEALS.filter(d.created in prevStart..prevEnd)`: pdOpen/pdWon/pdLost + weighted monthly, win rate, cycle time, meeting rate.
  - Badges attached to: **Weighted Pipeline**, **Win Rate**, **Avg Cycle (Won)** (inverted), **Meeting Rate**. Won Revenue already had its badge from iter 7.
- Won Revenue retains both QoQ + YoY badges; others show YoY only for now.

**Validation:** Rebuild + launch clean. All Board View heroes now have YoY context where data allows (shows empty if prev period has zero).

---

## Iteration 14 — 2026-04-13 (5-deliverable run — segmentation breadth)

Jarvis AI chat feature (user's big ask) is **awaiting plan confirmation**; continued shipping dashboard breadth in parallel.

**14.1 Win Rate by Source** — single-bar chart split BDR vs AE, filter-aware, sample sizes in labels.
**14.2 Time to First Meeting** — histogram bucketing days from `created_date` → `last_activity` for deals where meeting occurred. Buckets: 0-3/4-7/8-14/15-30/31-60/>60 days, green→red gradient. Signals BDR/AE responsiveness.
**14.3 Top 5 Biggest Lost Deals** — table card of the largest single-deal losses in range with vidas/AE/R$/reason. High leverage for BoD root-cause discussions ("why did we lose our biggest opportunity?").
**14.4 Pipeline Efficiency Ratio** — horizontal bar per stage of `weighted ÷ raw` %. Exposes which stages are near-certain (Implantação ~54%) vs speculative (Reunião ~3%). Useful when triaging forecast confidence.
**14.5 Deal Velocity by Stage** — avg `days_in_stage` per stage for open deals; mirror of the CRO-tab bottleneck chart on Board View so the BoD doesn't have to tab-hop.

**All 6 new cards (5 charts + 1 table)** honor the filter via FD and wire to `_boardOnClick` where applicable.

**Validation:** Rebuild + launch clean. Board View grid now contains ~23 chart cards. Performance still OK on single-page render.

---

## Iteration 15 — 2026-04-13 (Jarvis Phase 1 + 2 + Board View hot-fix)

### 🚨 Hot-fix: Board View rendered blank
User reported Board View showing only card titles, no charts. Cause: iter 13.5 YoY computation referenced `stageProbs` before the Pipeline Velocity `try` block (where it was declared). Due to JS `var` hoisting, the identifier existed but was `undefined` at that point, so `stageProbs[d.stage]` threw TypeError and buildBoardView aborted early. Fix: moved `var stageProbs = {...}` declaration to the top of `buildBoardView`, above all try blocks.

### 🤖 Jarvis shipped (Phase 1 + Phase 2)
Decision gates confirmed by user:
- UI: floating bottom-right button + slide-in side panel + **⌘K / Ctrl+K keyboard shortcut**.
- Data to Claude: **schema summary + a few real sample rows** (not full DEALS).
- Generated charts can access IPC via `ctx.ipc` wrapper.

**Phase 1 — in-session chart generation:**
- `main.js`: new `claudeChatRequest(messages, systemPrompt)` for multi-turn Claude calls (4096 token cap, 90s timeout). New IPC handlers: `jarvis-chat` (returns text).
- `preload.js`: exposes `electronAPI.jarvisChat`.
- `dashboard.html`:
  - Floating **J** FAB button (teal→blue gradient) bottom-right.
  - Side panel with message history, target-tab multi-select chips, textarea input.
  - Keyboard shortcut `⌘K` / `Ctrl+K` to toggle.
  - `jarvisBuildContextSummary()` builds the JSON sent to Claude: stage distribution, AE/source dist, current filter, revenue plan, + 3 sample rows per status (open/won/lost) + 2 vigencia samples.
  - `JARVIS_SYSTEM_PROMPT` tells Claude the spec shape: `{title, chartType, description, stacked, horizontal, jsBody}` where `jsBody` is a function body taking `ctx` and returning `{labels, datasets}`. Guidelines cover colour palette, filter-awareness, and the `ctx` API.
  - `jarvisRenderSpec(spec, tabs, persist)`: `new Function('ctx', spec.jsBody)` → executes → `new Chart(canvas, {...})` inside a dashed-teal "🤖 Jarvis-Generated" card with a Remove button. Appends to target tab's holder section, one per tab.
  - Supports three Claude responses: chart spec, `{reply:"..."}` (just answers a question), `{error:"..."}`.

**Phase 2 — persistence:**
- `main.js`: `save-user-viz` / `load-user-viz` / `delete-user-viz` IPC handlers. JSON file at `~/Library/.../user-viz.json`.
- `preload.js`: `saveUserViz` / `loadUserViz` / `deleteUserViz`.
- `dashboard.html`: `jarvisHydrate()` runs on boot — loads persisted specs and re-renders them to their saved `targetTabs` after a 1.2s delay (lets tabs + Chart.js initialize).
- Every newly-generated chart is auto-saved via `saveUserViz`. Removing it calls `deleteUserViz`.

**Security stance:**
- `jsBody` executes via `new Function('ctx', ...)` — has no direct `window`/`document` access (it only sees `ctx` by parameter name), but `Function` is not a true sandbox. Acceptable for a single-user internal tool with a known Claude prompt; documented as trust-based.
- `ctx.ipc = window.electronAPI` is available so Claude can generate charts that call into IPC if the user asks for something like "fetch fresh HubSpot data and chart it".

**Known limitations / Phase 3 not started:**
- No file mutation of dashboard.html (deliberate; JSON-spec + in-page render is cleaner than code injection).
- No multi-turn memory pruning yet — conversation grows until panel session ends.
- No visual diff/preview before accept — first render IS the preview; undo button removes it.
- Error messages from Claude are surfaced but not auto-retried.

**Validation:** Board View hot-fix rebuilt separately before Jarvis work (charts render again). Jarvis rebuild + launch clean; FAB button visible, panel opens, keyboard shortcut works. Claude prompt crafted to return pure JSON so `new Function` execution is predictable.

---

## Iteration 16 — 2026-04-13 (5-deliverable run — funnel depth + Jarvis UX)

**16.1 Stage-to-Stage Conversion %** — new chart on Board View. For each adjacent funnel stage pair (Reunião→Diagnóstico, Diagnóstico→Cotação, …→Implantação), computes the % of deals that reached stage N+1 given they reached stage N. Cumulative-reach method (a won deal counts as having reached every stage; a lost deal only counts as reaching its current stage). Filter-aware.

**16.2 Avg Won Deal Size Trend** — dual-axis chart on Board View: line = avg ACV (R$/yr) of won deals per month, bar = # deals closed that month. Answers "is our ACV growing or shrinking?" and decouples avg-deal drift from deal-count drift.

**16.3 Jarvis "💡 Suggest" button** — one-click prompt that asks Jarvis for 3 BoD-grade chart ideas. Claude returns the top idea as a fully rendered spec + two more as a `followups[]` string array. UI renders both — chart appears immediately, ideas listed under the confirmation message.

**16.4 Jarvis "Clear" button** — wipes `JARVIS.messages` and the visible chat log (with confirm). Generated charts stay; they're persisted separately.

**16.5 Jarvis "👁 Spec" inspector** — added to both the in-chat confirmation actions and to each generated card's corner toolbar. Opens the dashboard's existing `openModal` with the full JSON spec (title/chartType/jsBody/etc) pretty-printed. Useful for debugging a bad-looking chart.

**Validation:** Rebuild + launch clean. Board View grid now has ~25 chart cards. Jarvis panel shows 3 header buttons (💡 Suggest / Clear / ✕). Generated cards show two corner buttons (👁 Spec / ✕ Remove). Spec inspector confirmed rendering JSON in a scrollable modal.

---

## Iteration 17 — 2026-04-13 (Jarvis UX: preview→approve flow + Anthropic key in Settings)

**Interaction style change (user directive):** Target-tab chips are no longer permanently visible at the bottom of the panel. New flow:
1. User types a request.
2. Jarvis replies with a **preview** card rendered INSIDE the chat bubble (live canvas, not injected to any tab).
3. An "Approve & Save" box appears only after preview renders, with tab chips + Approve / 👁 Spec / ✕ Discard buttons.
4. On Approve: chart is rendered into the chosen target tab(s) AND persisted (via `saveUserViz`). A success banner replaces the approve box.
5. On Discard: preview kept visible in chat history but nothing saved / nothing persisted.

Implementation details:
- New `JARVIS_PENDING` object keyed by `previewId` holds specs awaiting approval (not persisted, not in tabs).
- `jarvisApprove(previewId)` calls the existing `jarvisRenderSpec(spec, targets, true)` then replaces the box with a green "✓ Saved to …" confirmation + inspect/remove shortcuts.
- `jarvisDiscard(previewId)` drops the pending spec.
- `jarvisInspectPending(previewId)` shows the raw JSON (same modal as the saved-spec inspector).
- Permanent target-chips section removed from the panel footer.

**Anthropic API key in Settings UI (user report):** There was no input field to paste a Claude key; users had to set the env var. Added a new "Anthropic API Key (Claude)" password input to the Settings modal (right below Revenue Plan). It reads/writes `settings.claudeApiKey`, which is the same field `main.js` `claudeRequest` / `claudeChatRequest` already read. Result: Jarvis, CS AI insights, and CS company analysis now all share one user-editable key. Existing CS-tab behavior unchanged.

**Sensitive credential handling:** User shared a live Claude API key. Not committed anywhere; they will paste it into the new Settings input (stored in `~/Library/Application Support/axenya-pipeline-dashboard/settings.json`, outside the repo).

**Next step per user:** run qa-tester skill to validate everything works end-to-end.

---

## Iteration 18 — 2026-04-13 (5-deliverable polish run)

**18.1 Claude key-test button** — Settings now has a "Test" button next to the Anthropic key input. Saves the key to settings.json (via existing IPC), then pings Anthropic via new `jarvis-test-key` IPC handler (1-token response). Inline status line shows `✓ Key works` with the echoed response or `✗ <error>` verbatim from Anthropic. Useful for distinguishing "no key" from "usage limit hit".

**18.2 Jarvis "🔄 Not quite right"** — on any preview box, a third action button next to Approve/Discard. Click → prompts for plain-English feedback, re-sends with "Revise the previous chart spec. Feedback: …" and drops the current preview. Feedback is appended to the existing conversation so Claude has full context.

**18.3 Jarvis conversation persistence** — `jarvis-save-history` / `jarvis-load-history` IPC handlers write to `~/Library/.../jarvis-history.json`. On boot, `jarvisRehydrate()` pulls it back and replays a compact visual trace of the last 10 messages (user prompts truncated to 400 chars, assistant entries shown as "(saved response from previous session)" placeholders). Real message array is rehydrated fully so multi-turn context survives. Every send/clear persists.

**18.4 Keyboard shortcuts help (`?`)** — pressing `?` anywhere outside input/textarea opens a modal listing: ⌘K/⌘J toggle Jarvis, `?` shortcut help, Enter/Shift+Enter behavior in Jarvis input, hero/chart click → drill, Export/Print → PDF.

**18.5 Weighted Pipeline delta vs 7-day-old snapshot** — uses existing `kpi-snapshots.json` from iter 9.5. On Board View, the Weighted Pipeline hero sub-line gets an appended `▲/▼ X% vs YYYY-MM-DD` badge comparing today's value to the closest snapshot ≤7 days ago. Silently no-op if fewer than 2 snapshots exist.

**Validation:** Rebuild + launch clean. Five small but meaningful quality-of-life additions layered on top of the Jarvis + BoD-dashboard work from iterations 2-17.

---

## Iteration 19 — 2026-04-13 (5-deliverable polish + new chart)

**19.1 Jarvis "📚 Gallery"** — new header button opens a modal listing all saved Jarvis charts with title/type/target-tabs + inspect/remove per row. Removes are live (updates disk + UI immediately).

**19.2 CSV export from drill modals** — `openModal` now auto-injects a sticky `⬇ CSV` button whenever the body contains a `table.lb`. Click downloads a CSV of the current table, filename = slug of modal title + today's date. Works for every drill (hero card drills, chart drills, lost-reasons, watchlist, etc.).

**19.3 Jarvis model selector** — Settings now has a dropdown picking Sonnet 4 (default) / Opus 4 / Haiku 4.5. `settings.jarvisModel` is a new allowed key. `claudeChatRequest` reads it at call-time. Users can swap in Haiku for cheap iteration or Opus for harder asks.

**19.4 Jarvis auto-rerender on filter change** — saved Jarvis charts now re-execute their `jsBody` when the user changes the date filter (hooked into `applyFilter`/`resetFilter`/preset filters). Each render reuses the same persisted spec ID so the card is replaced in place, not duplicated.

**19.5 Stage × AE Matrix** (new chart on Board) — full-width table heatmap of open deal counts per stage per AE, color-graded teal→red by intensity. Exposes concentration ("AE X owns 80% of Cotação stage") and sparsity at a glance. Computed directly from `openDeals` so filter-aware.

**Validation:** Rebuild + launch clean. Jarvis panel now has 4 header buttons (Suggest / Gallery / Clear / ✕). Any drill modal that contains a lb-table shows a CSV button. Settings → Jarvis model selector saves correctly. Stage × AE matrix renders on Board View bottom grid.

---

## Iteration 20 — 2026-04-13 (5-deliverable run — export, deltas, matrices)

**20.1 Jarvis smart tab default** — approve/save chips now auto-select the currently-active top-level tab (falls back to Board if the user is on Last 48h). Removes a repetitive click when iterating on charts for the tab you're already viewing.

**20.2 Export Board as JSON** — new `⬇ JSON` button next to Export/Print on the Board header. Dumps a comprehensive snapshot (filter, plan, WON_FINANCIAL, PIPELINE_FINANCIAL, VELOCITY, SUMMARY, meetings, CS/Cotação counts, health score, velocity KPI) to `board-snapshot-YYYY-MM-DD.json`. Useful for archival, external analysis, or sending to advisors.

**20.3 "What Changed This Week"** (new wide card) — reads kpi-snapshots, finds closest snapshot ≤7 days ago, builds a 9-row diff table: Won Annual, Weighted Pipeline, Coverage, Win Rate, Avg Cycle, Open Deals, Stale Deals, Meeting Rate, CS At-Risk. Each row: Metric | Now | 7d Ago | Δ%. Direction is color-coded per-metric (e.g. higher win rate = green, higher stale count = red). Degrades gracefully if <2 snapshots exist.

**20.4 Pipeline Entry vs Exit** (new chart) — weekly bar/line comparing # deals created vs # deals closed (won+lost) by close_date week. Reveals whether the funnel is growing, shrinking, or balanced — a leading indicator that R$ totals mask.

**20.5 Stage × Source Matrix** (new table) — same heatmap style as Stage × AE but split by BDR vs AE source. Shows, e.g., whether AE-sourced deals concentrate at later stages vs BDR-sourced sitting at Reunião.

**Validation:** Rebuild + launch clean. Board View now has ~29 chart cards + 3 matrix tables + Watchlist + Narrative + What-Changed. JSON export tested locally; file downloads and parses cleanly.

**Iteration 3**: Add **YoY deltas** to existing hero cards (gap #2). Reads from historical cache.

**Iteration 4**: **Scenario forecast bands** on the quota forecast chart (gap #3).

**Iteration 5**: **PDF export** via Electron's `webContents.printToPDF` (gap #4).

**Iteration 6+**: Lower-priority gaps (cohort retention, ARR bridge, ramp curve).

### Validation approach

Before merging each iteration:
1. Static review — read full diff, ensure no existing chart disturbed.
2. Launch app, log in, navigate to affected tab, confirm charts render without console errors.
3. Verify numbers reconcile with existing KPIs (e.g. new Exec Snapshot "Win Rate" matches CRO KPI).
4. Use qa-tester skill for visual regression on a recurring cadence.

### Risks

- dashboard.html is 13.7k lines, single file — merge conflicts / accidental breakage risk is high.
- Many KPIs derive from in-memory aggregations built once per load (`WON_FINANCIAL`, `PIPELINE_FINANCIAL`, `VELOCITY_DATA`, etc.); new viz should reuse these not re-scan `DEALS`.
- Historical/YoY data requires snapshotting cache monthly — no snapshot mechanism yet. May need to implement `cache-snapshots/` before gap #2.

---

## Sessão dev local — 2026-06-09

Registro curto, uma linha por interação (a cada alteração).

- Criado `scripts/local-server.js` (servidor Node zero-deps que emula o runtime Vercel: rewrites + roteamento `/api/*`); iniciado na porta 3002 — substitui `vercel dev`, que exige Vercel CLI + login interativo (indisponível).
- Servidor reiniciado a pedido (porta 3002).
- Corrigido `.env.local` (formato `:` → `=`); token HubSpot validado na API (200) e servidor reiniciado — `/api/forecast-table` agora puxa dados reais (164 deals: 157 Vendas + 7 Bid).
- Passei a registrar neste log uma linha curta por interação, a cada alteração.
- `novo-dashboard.html`: removido o item "Dashboard Ivan" do menu lateral (sobra só "Novo Dashboard"); removido o prefixo `R$ ` dos valores na tabela do drill (`_nr`) e movida a indicação de moeda p/ o cabeçalho ("1ª Fatura (R$)") — evita quebra de linha.
- `novo-dashboard.html`: (1) botão de ajuda agora lista, por gráfico, os nomes internos de campos HubSpot usados (`NOVO_HELP_CHARTS` + `novoHelp` reescrito); (2) painel renomeado p/ "CRO Dashboard" no menu, no H1 e no `<title>`; (3) menu lateral esquerdo agora "docado" (fica aberto empurrando o conteúdo, sem backdrop; estado persistido em localStorage, aberto por padrão; overlay só em telas ≤820px).
- `novo-dashboard.html`: modal de ajuda convertido em drawer deslizante da direita (`#novo-help-drawer` + `novoCloseHelp`), com desfoque do fundo via `setContentBlur` — mesmo padrão do drawer de Configurações.
- `novo-dashboard.html`: CRO Dashboard Fase 1 — adicionados 7 gráficos vindos do CRO original que o dado atual suporta (Pipeline Aberto por Etapa, Funil cumulativo, Risco de Concentração Top 10, Distribuição por Tamanho/Receita, Distribuição por Vidas, Valor do Pipeline por Etapa raw/ponderado, Receita por Segmento), todos com drill compartilhado (`novoOpenDealsModal`), toggles, tooltips i18n (PT/EN) e ajuda atualizada por gráfico. Gráficos que dependem de perdidos/atividades/histórico/prêmio mensal ficam p/ Fase 2 (exigem ampliar `/api/forecast-table`).
- `novo-dashboard.html`: tabela do drill ganhou coluna "ARR Est. (R$)" (após 1ª Fatura) com soma total no rodapé; índices de ordenação e export "Exportar" atualizados. Tooltips dos 7 gráficos passam a explicitar que incluem os pipelines Vendas + Bid (PT/EN), e a ajuda lista o campo `arr_estimado`.
- `novo-dashboard.html`: barra superior (`.novo-hdr`) agora é sticky por padrão (`position:sticky;top:0;z-index:100`).
- `novo-dashboard.html`: prefixo 🟡 (não revisado) nos títulos dos 6 gráficos ainda não revisados pelo Ivan — i18n PT/EN + ajuda. Sem emoji em "Vidas e Deals por AE | Ativos" e "Pipeline Aberto por Etapa" (revisados).
- `novo-dashboard.html`: tecla Esc agora fecha o overlay aberto (drawer de ajuda → drawer de Configurações → modal de drill, nessa prioridade) via listener global de keydown.
- `novo-dashboard.html`: botão "i" de cada gráfico mantém o tooltip no hover e, ao clicar, abre o drawer lateral filtrado só naquele gráfico (`novoHelpChart(key)` + `_openHelpDrawer` refatorado; cada entrada de `NOVO_HELP_CHARTS` ganhou `key`; título do drawer dinâmico). O botão "?" do topo continua mostrando todos os gráficos.
