---

# Delta Dashboard — Implementation Specification

### "Comparativo" tab for Dashboard Axenya — compare two points in time across the CRO funnel and cash forecast

## 1. Purpose

Today the CRO Dashboard and Forecast pages are point-in-time views: they tell you what the pipeline looks like _right now_. This project adds a new view that answers a different question: _what changed between two dates?_ The user picks Date A ("before") and Date B ("after"), and the dashboard shows, for every metric the CRO Dashboard already tracks, how much it moved — lives, funnel-stage counts, conversion rates, and, as the centerpiece, a waterfall chart showing exactly how the weighted cash forecast shifted, broken down stage by stage (e.g. "Diagnóstico's forecasted cash went up R$120K, Cotação went down R$40K").

## 2. What already exists today (research summary)

Before specifying anything new, I inspected the live app and its network calls. This matters because a lot of the plumbing needed for this feature already exists in some form, and duplicating it would be wasteful.

The app is a Next.js-style app hosted on Vercel, with data ultimately sourced from HubSpot (deal objects carry an `hs_id`). Client-side calculation logic lives in separate JS files loaded by the browser: `forecast-engine.js` (computes Receita Real / Receita Probabilizada per deal per month from raw deal fields), `revenue-engine.js`, and `faturamento-manual.js` (manual invoice overrides for Ganho/Implantação deals). Data is served from `/api/forecast-table` (current live deal list with all fields needed for forecasting), `/api/funnel-stages` (deal counts and entry dates per stage), and `/api/faturamento-manual`.

Critically, there is already a snapshot system. The Forecast → Pipeline page has a "Comparação" dropdown that calls `/api/history?action=fotos` and returns a list of stored point-in-time snapshots ("fotos"), each with a label and date, e.g. `2026-07-03` (weekly), `Jun 2026` (monthly), `2026-06-26`, `2026-06-19`, `2026-06-12`, `2026-06-05`, `2026-05-12`. Selecting one already renders a comparison banner: _"Comparando com a foto de 2026-07-03 · Foto: 280 deals · Δ Vidas: +22.041 · Δ Colaboradores: +194.236 · Novos: 9 · Avançaram: 16 | Regrediram: 1 · Saíram: 48 (48 perdidos)"_ — and it annotates individual deal rows with stage transitions like "Diagnóstico → Cotação ▲". There's also a "Histórico" sub-tab with a "Mês de referência" selector, which appears to be a related but separate/partially-built feature.

Separately, the Forecast → Overall page (`/forecast-overall`) already renders exactly the kind of matrix this feature needs for its centerpiece metric: rows are funnel stages (MQL/Reunião, Diagnóstico, Cotação, Consultoria, Negociação, BID | Proposta Comercial, BID | Negociação, Ganho/Implantação) and columns are months (Jan 2026 → Dez 2027+), with a toggle between "Receita Real" and "Receita Probabilizada." This is effectively today's live-only version of the table our waterfall needs to diff.

Snapshot cadence today is weekly (roughly every Thursday) plus occasional monthly markers, going back to at least May 2026. There is no evidence of daily snapshots.

**Implication for this project:** the new Delta Dashboard should be built as a consumer of an extended version of this existing snapshot system, not a parallel one. The main gap to fill is that snapshots need to carry enough raw data to reconstruct the full stage-by-month revenue table (not just deal counts/vidas), and the comparison UI needs to move from "one deal-movement banner" to "a full CRO-Dashboard-shaped set of delta metrics" with the waterfall as the flagship visual.

## 3. Goals and non-goals

**Phase 1 (build now):** two date pickers (Input 1 / Input 2, any date that has snapshot data available); a cash-forecast waterfall chart broken down by funnel stage, using Receita Probabilizada (weighted) as the default metric with a toggle to switch to Receita Real, matching the toggle already present on the Overall page; supporting KPI delta cards for the metrics that most directly relate to the waterfall (deals count, lives, ARR/TCV totals); and a funnel-stage delta view mirroring the CRO Dashboard's conversion funnel (C06), showing count and conversion-rate changes per stage.

**Phase 2 (documented now, built later):** full parity with every CRO Dashboard card (P01–P09, S01–S05, C01–C08, N01–N09) shown as before/after/delta, per the mapping table in section 10.

**Non-goals for this spec:** this document does not redesign the calculation logic already used by `forecast-engine.js` — it reuses it. It does not change how snapshots are captured today beyond extending their payload. It does not address navigation placement (sidebar location was explicitly deprioritized by the requester).

## 4. Key definitions

_Snapshot_ — a stored, dated copy of the deal dataset, sufficient to recompute the forecast as it looked on that date. _Date A / Date B_ — the two dates the user selects for comparison; each resolves to the nearest available snapshot at or before that date (see section 6.1) since data isn't continuous. _Receita Real_ — actual/estimated invoiced revenue per the existing ruler logic (manual values for Ganho/Implantação, estimated ruler for earlier stages). _Receita Probabilizada_ — Receita Real × stage win probability; this is the "weighted" / cash-forecast figure and the default basis for the waterfall. _Funnel stage_ — one of the seven canonical stages already used across the app: Reunião Agendada (MQL), Diagnóstico, Cotação, Consultoria, Negociação, BID (Proposta Enviada / Negociação), Ganho/Implantação.

## 5. The centerpiece: Cash Forecast Waterfall by Funnel Stage

### 5.1 What it shows

A horizontal or vertical waterfall/bridge chart with these bars, in order: **Total forecast @ Date A** (starting bar) → one delta bar per funnel stage, each showing that stage's net change in forecasted cash between Date A and Date B (colored green if up, red if down) → **Total forecast @ Date B** (ending bar). This directly matches the request: "Diagnóstico went up/down by XYZ."

### 5.2 Formula

For a given snapshot date `D` and stage `S`:

`CashForecast(S, D) = Σ over all open deals whose current stage == S at snapshot D of Σ over all forecast months in that deal's monthly Receita Probabilizada series`

Then:

`Δ(S) = CashForecast(S, DateB) − CashForecast(S, DateA) Total(D) = Σ over all stages S of CashForecast(S, D) Σ Δ(S) across all stages == Total(DateB) − Total(DateA) // this must always hold — see QA checklist`

The waterfall bars are simply `Total(DateA)`, then each `Δ(S)` in canonical stage order, then `Total(DateB)`.

### 5.3 Handling deals that changed stage, entered, or left the pipeline between the two dates

This is the part that needs to be precise, because it's the most common source of a "confusing waterfall." The rule is: **attribute revenue to whatever stage the deal was in at each snapshot, independently** — do not try to manually reassign a moved deal's revenue between buckets. This falls out naturally from the formula above:

- A deal that was in Diagnóstico at Date A and moved to Cotação by Date B contributes its Date-A revenue to Diagnóstico's bucket and its Date-B revenue to Cotação's bucket. Diagnóstico's Δ goes down by (roughly) that deal's revenue, and Cotação's Δ goes up by it (adjusted for the fact stage progression usually also raises the win probability, so the "up" side is typically larger than the "down" side — this is expected and desirable, it's literally the deal getting more valuable as it advances).
- A brand-new deal that entered the pipeline between Date A and Date B contributes zero to Date A and its full value to whatever stage it's in at Date B — it shows up entirely as that stage's increase.
- A deal that left the pipeline (Won and fully invoiced in a way that drops out of "open forecast," or Lost, or disqualified) between the two dates contributes its Date-A revenue and zero at Date B — it shows up entirely as that stage's decrease.
- A deal that regressed (moved backward, e.g. Negociação → Cotação) is treated exactly the same way — it decreases the stage it left and increases the stage it's now in.

This means the per-stage Δ is a **net figure** that already blends "new/advanced/regressed/exited" deals together. That's intentional and matches the ask (per-stage delta), but it does mean the same waterfall can't tell you _why_ a stage moved. **Recommended phase 1 add-on:** clicking a stage's delta bar opens a drill-down table listing exactly which deals contributed to that stage's increase or decrease and by how much (reusing the existing "Avançaram / Regrediram / Novos / Saíram" deal-list pattern already built for the Forecast Comparação feature). This is cheap to add since the underlying deal-level data is already being computed, and it's the difference between a chart that looks nice and one that's actually actionable for a CRO.

### 5.4 Toggle: Real vs. Probabilizada

Exactly mirror the toggle already on the Overall page. Recompute the entire waterfall using Receita Real instead of Receita Probabilizada when toggled — same formula, same drill-down, just swap which of the two monthly series is summed.

### 5.5 Time horizon of "Total forecast"

One decision to make explicit: `CashForecast(S, D)` as defined sums _all_ future forecast months visible in that deal's projection (today the Overall/Forecast tables project out roughly 24 months). If a shorter, fixed window is preferred instead (e.g. always "next 12 months from D," matching the existing TCV(12M) indicator), the formula is identical except the inner sum is restricted to `D` through `D+12mo`. **Recommendation:** default to TCV(12M)-style (rolling 12-month total) for the headline waterfall since it matches an indicator users already understand, and offer "Total pipeline (all months)" as a secondary toggle. This should be confirmed with the requester/stakeholder if not obvious from usage, but isn't blocking — it's a one-line change in the aggregation window.

### 5.6 Worked example

Suppose Date A total forecast = R$5,000,000 and Date B total forecast = R$5,350,000 (net +R$350,000). The bars would read: Reunião Agendada +R$40,000 (a few new MQLs entered and started accruing projected value), Diagnóstico −R$60,000 (some deals advanced out, a couple went stale/lost), Cotação +R$120,000 (deals advancing in plus their probability increased), Consultoria +R$10,000, Negociação +R$180,000 (a large deal advanced here), BID −R$90,000 (a large BID deal was lost), Ganho/Implantação +R$150,000 (deals closed and started invoicing). Sum of deltas = +R$350,000, matching the end-to-start difference exactly — this identity is the primary correctness check for QA.

## 6. Supporting requirements

### 6.1 Date resolution ("any date with data available")

Since underlying snapshots are currently weekly/monthly, not continuous, the two date pickers should not be raw free-text calendars that accept literally any day — instead, fetch the list of available snapshot dates (extending `/api/history?action=fotos` or equivalent) and constrain/steer the picker to those dates, or accept any date and silently resolve to the nearest available snapshot at or before it, clearly labeling the resolved date next to each picker (e.g. "Você selecionou 15/06 → usando snapshot de 12/06/2026"), exactly following the existing "Foto: 03/07/2026" labeling convention already in the app. **Recommendation for a real fix, not just a workaround:** move snapshot capture to a daily automated job going forward (e.g., Vercel Cron or equivalent, once a day before business hours) so that from this point on, any date really does have data; older/pre-rollout history will remain at whatever weekly/monthly resolution already exists and that's fine — it should just be communicated in the UI rather than silently faked.

### 6.2 Supporting KPI delta cards (phase 1)

Small cards, each showing Value@DateA → Value@DateB and the delta (absolute and %), for: Deals Abertos, Vidas (lives) em pipeline ativo, ARR Total em Pipeline, ARR Ponderado, MRR Ponderado, TCV (12M). These map directly to indicators that already exist verbatim on the Forecast page, so the same underlying computation just needs to run twice (once per snapshot) instead of once.

### 6.3 Funnel-stage delta view (mirrors CRO Dashboard's C06)

A funnel visualization (or simple stacked comparison bars) showing deal counts per stage at Date A vs Date B, plus the conversion-rate-between-stages delta (e.g. "Reunião → Diagnóstico conversion moved from 48% to 51%, +3pp"), directly mirroring the existing C06 "Funil de Conversão Histórico" chart but rendered as two overlaid funnels or paired bars instead of one.

## 7. Data requirements (backend)

Each snapshot must store, per open deal, at minimum the same field set already returned by `/api/forecast-table` for a live deal (`hs_id`, `dealname`, `pipeline`, `stage`, `ae`, `colaboradores`, `vidas`, `fatura_atual`, `primeira_fatura`, `arr_estimado`, `modelo_remuneracao`, `possui_agenciamento`, `possui_vitalicio`, `probabilidade`, `quarter`, `data_prevista_para_receita`, `close_date`, `data_ganho`, `data_implantacao`, `data_perdido`, `vigencia`, `vencimento_primeira_fatura`, and whatever manual-invoice overrides `faturamento-manual.js` applies). Storing these _raw_ fields (rather than the already-computed monthly revenue table) means the exact same `forecast-engine.js` logic already running in the browser today can simply be re-run against a historical snapshot's raw fields to regenerate its monthly Receita Real/Probabilizada series on demand — avoiding a second, parallel implementation of the forecasting formulas, and guaranteeing the delta dashboard and the live Forecast page can never drift out of sync in their math. The trade-off (flagged for the stakeholder) is that if the forecasting formulas are updated later, historical snapshots will be recalculated under the new rules rather than frozen exactly as originally displayed — if true point-in-time fidelity of "what we told the CRO back then" is required instead, the snapshot payload would need to store the already-computed monthly series rather than raw inputs, which is a larger storage footprint. Confirm which behavior is wanted before building.

New/extended endpoints needed: an endpoint to list available snapshot dates (likely just extending the existing `/api/history?action=fotos`), and a comparison endpoint that accepts two dates (or two snapshot identifiers) and returns the per-stage `CashForecast` totals, deal-level diffs (new/advanced/regressed/exited), and the supporting KPI values for both dates in one payload, so the frontend does one request rather than recomputing two full forecasts client-side against potentially large deal lists.

## 8. UI layout

Top of page: two date inputs (Date A, Date B) defaulting to "most recent snapshot" and "snapshot from ~1 month prior," with the resolved-date labels described in 6.1, and a Real/Probabilizada toggle. Below that: the waterfall chart as the primary, largest element. Below the waterfall: a row of the supporting KPI delta cards (section 6.2). Below that: the funnel delta view (section 6.3). Each stage bar in the waterfall and each stage row in the funnel view should be clickable to expand the deal-level drill-down table described in 5.3.

## 9. Edge cases and integrity rules

If either selected date has no snapshot at or before it (e.g. a date before the earliest recorded snapshot), disable comparison and show a clear message rather than silently comparing against nothing. If Date A and Date B resolve to the same snapshot (e.g. user picked two nearby days that round to the same week), show a message rather than a meaningless zero-delta chart. Deals with incomplete data (`dados_completos: false` per the existing field already present in `/api/forecast-table`) should be handled the same way the live Forecast page already handles them — excluded or flagged consistently, not silently dropped only from one side of the comparison. The invariant in 5.2 (sum of stage deltas equals total delta) must be a unit test / automated check in CI, not just a visual sanity check, since it's the easiest way to catch a bug in the attribution logic.

## 10. Phase 2 — full CRO Dashboard parity mapping

|CRO Dashboard card|Delta treatment|
|---|---|
|P01 Deals Ativos, P02 Vidas, P03 Receita Ponderada, P04 Reuniões Agendadas, P05 Vidas Ponderadas, P06–P09 Receita/Vidas Ganhas-Perdidas|Simple before/after/delta number cards, same pattern as section 6.2|
|S01 Taxa de Ganho, S02 Conversão BDR, S03 Conversão AE, S04 Taxa de Reunião, S05 Deals Estagnados|Percentage-point delta cards|
|C02 Pipeline Ativo por Etapa, C04/C08 Valor do Pipe por Etapa/Bucket|Paired bar or delta-per-segment chart, similar construction to the main waterfall but per size-bucket instead of per stage|
|C03 Distribuição por Tamanho|Two donut charts side by side (Date A / Date B) rather than a forced single delta visual — distribution shape changes don't compress well into one delta number|
|C06 Funil de Conversão Histórico|Covered in section 6.3|
|C07 Probabilidade de Ganho por Etapa|Delta per stage (probability moved from X% to Y%)|
|N01 Maturidade por Coorte, N02 Frescor de Engajamento, N07 Tempo em Etapa, N08 Velocidade de Qualificação, N09 Reatribuição|These are cohort/distribution analyses that don't map cleanly onto a two-point-in-time delta; recommend keeping these as single-date views filterable by either Date A or Date B rather than forcing a delta representation — flag this as a design decision for the stakeholder rather than assuming|
|N05 Cobertura de Pipeline, N06B Forecast Total|Same treatment as the main waterfall, just using existing coverage/forecast-total figures instead of the stage-cash breakdown|

## 11. Acceptance criteria checklist

Waterfall bars sum correctly (start + all deltas = end, verified by automated test). Toggling Real/Probabilizada updates every number on the page consistently, not just the waterfall. Selecting two dates with no available snapshot shows a clear resolved-date label rather than silently substituting data. Drill-down from any stage bar shows the exact list of deals responsible for that stage's movement, with each deal's before/after revenue contribution. Supporting KPI cards match the equivalent number on the live Forecast/CRO Dashboard pages when Date B = today. Performance: comparison of two arbitrary snapshots returns in a reasonable time even as the deal count and snapshot history grow (push the heavy aggregation to the backend endpoint from section 7, not client-side).

---

## 12. Plano de execução — faseamento da Fase 1

_Esta seção foi escrita depois de cruzar a spec com o código real em `dashboard-ivan-visual/` (não só a inspeção do app ao vivo). Ela ajusta as premissas da spec ao que já está construído._

### 12.1 Reality-check — o que já existe (de-risca a Fase 1)

| Peça que a spec pede | Estado real no `dashboard-ivan-visual` |
|---|---|
| Sistema de snapshots | ✅ Existe. Cron diário (`api/snapshot.js`) grava foto **semanal (sexta)** e **mensal**, com autocorreção de foto perdida. Armazenado em Google Sheet (`lib/sheets`). |
| Listar datas disponíveis | ✅ `GET /api/history?action=fotos` retorna as fotos ordenadas (semanais `YYYY-MM-DD` + mensais `Mmm AAAA`, formato bruto a partir de Jun/2026). |
| Ler uma foto | ✅ `?action=snapshot&tab=...` devolve os deals daquela data. |
| Motor de forecast reutilizável | ✅ `ForecastEngine.dealMonthly(deal, probAdj)` (`public/forecast-engine.js`) — função **pura**, fonte única, já produz série mensal Real + Probabilizada. |
| Matriz etapa × mês (base do waterfall) | ✅ `forecast.html` / `forecast-stage.html` já montam isso ao vivo. |
| Deal-diff (novos / avançaram / regrediram / saíram) | ✅ Já existe no modo Comparação do `/forecast`. |

Conclusão: **a Fase 1 é majoritariamente reuso/montagem, não construção do zero.**

### 12.2 Os 3 gaps reais que o plano precisa endereçar

- **🔴 Gap 1 — a engine ancora receita em "hoje", não na data da foto.** Em `public/forecast-engine.js:51`, Diagnóstico (e Reunião Agendada) calculam o início da receita com `new Date()` = mês atual. Recomputar a foto de 12/jun **hoje** faz o início da receita "escorregar" para o mês corrente → **não reproduz o que o CRO viu naquela data** e quebra a identidade de QA (Σ Δ = Total B − Total A). **Correção obrigatória:** injetar uma `referenceDate` na engine via `config()` em vez de `new Date()`. É o maior risco e vem primeiro.
- **🟠 Gap 2 — a foto guarda 35 colunas BRUTAS, sem série mensal** (regra do projeto 2026-07-02: "nenhum cálculo na foto"; HEADERS em `lib/snapshot-format.js`). Isso **resolve a dúvida da seção 7**: o projeto já escolheu "guardar bruto + recomputar", não "congelar calculado". Logo o Delta **tem que rodar a engine** sobre a foto. Fidelidade ponto-no-tempo vem da correção do Gap 1, não de congelar números.
- **🟠 Gap 3 — o motor mensal só existe no browser.** `api/forecast-table.js` serve campos brutos; quem calcula a série mensal é o `ForecastEngine` client-side (consumido por `forecast.html`, `forecast-stage.html`, `dashboard.html`, `ae.html`). **Não há porta Node.** Resolvido pela decisão 5 da seção 12.3 (módulo compartilhado browser+Node).

**Nuance de resolução temporal:** o cron grava foto _deal-level_ só **semanal** (diário é só contagem, aba "Historico Diario"). Mantemos o cadence semanal (decisão 4, seção 12.3): "qualquer data" resolve para a sexta/marco mais próximo anterior ou igual, rotulado (seção 6.1).

### 12.3 Decisões

**Já respondidas pelo código (não precisam de reunião):**
- Guardar bruto e recomputar? → **Sim, já é a regra do projeto.**
- Reusar engine ou reescrever? → **Reusar** `ForecastEngine`, tornando a `referenceDate` injetável.

**Fechadas com o requisitante (2026-07-12):**
1. **Painel novo, autônomo.** O Delta Dashboard é uma view própria (irmã de `forecast.html` / `dashboard.html`), que consome as fotos + o `ForecastEngine` como biblioteca. Não altera o comportamento das telas ponto-no-tempo existentes.
2. **Filtro de datas: B sempre posterior a A.** O seletor **trava** a escolha de `Data B ≤ Data A` (não só avisa depois). Casos de borda da seção 9 seguem valendo: A e B que caem na mesma foto → mensagem, não waterfall zerado; data anterior à foto mais antiga → comparação desabilitada com rótulo claro.
3. **Horizonte do waterfall: TCV(12M) rolante**, com o **rótulo do horizonte visível no gráfico** (ex.: "Forecast — próximos 12 meses"). "Pipeline total (todos os meses)" fica como toggle secundário, também rotulado.
4. **Resolução temporal: semanal** (mantém o cadence atual; **sem** promover foto deal-level para diária neste momento). O seletor oferece as sextas/marcos mensais disponíveis; data digitada resolve para a foto mais próxima **anterior ou igual**, com rótulo honesto ("Você escolheu 15/06 → usando foto de 12/06/2026"). Sem interpolação nem dado falso.
5. **Onde recomputar: opção B — backend Node (`/api/compare`), na variante "módulo compartilhado".** A engine passa a ser um módulo único importável por browser **e** Node (não uma cópia), preservando **fonte única de verdade** (elimina o risco de drift que a seção 7 alerta) e habilitando o teste de integridade das seções 9/11 como teste Node puro, além do payload único por requisição. Impacto pro sistema: cálculo, teste e a correção do Gap 1 centralizados num só lugar; escala com o histórico. Impacto pro usuário: comparação rápida e consistente, com o peso no servidor. Custo: portar as dependências injetadas (`MONTHS`, `calcReceita`, etc.) para o lado Node — modesto, porque `forecast-engine.js` já é função pura com wrapper quase dual-loadável.

**Limitação conhecida (registrar na UI):** verificado no ambiente local (2026-07-12) que há **8 fotos** disponíveis via `?action=fotos`, todas em formato bruto de 35 colunas, indo de **2026-05-12** (semanal, mais antiga) até **2026-07-10**, mais o marco mensal "Jun 2026". Logo a **data mais antiga comparável no deal-level é 2026-05-12**. Fotos mensais legadas anteriores a Jun/2026 (formato calculado) já são filtradas pelo `history.js` e ficam de fora.

### 12.4 Faseamento da Fase 1

Ordenado por dependência; cada sub-fase é entregável e testável isoladamente.

- **1A — Fundação de correção temporal** (desbloqueia tudo). Injetar `referenceDate` no `ForecastEngine.config()`; provar que recomputar a foto de X em data ≠ X reproduz os números daquela data. _Sem isso, todo o resto nasce errado._
- **1B — Camada de dados de comparação (`/api/compare` em Node).** Endpoint que recebe (dataA, dataB) — validando **B > A** (decisão 2) —, resolve para as fotos disponíveis mais próximas anteriores ou iguais (reusando `?action=fotos`), roda a engine (agora módulo compartilhado, decisão 5) com a `referenceDate` correta em cada uma e devolve num só payload, por etapa: `CashForecast(S, D)` para A e B + o deal-diff + os KPIs de apoio. Horizonte padrão TCV(12M) rolante (decisão 3).
- **1C — Waterfall (peça central).** Barras Total@A → Δ por etapa → Total@B; toggle Real/Probabilizada; ordem canônica das etapas. Inclui **normalização de nomes de etapa** (a foto usa "Proposta Enviada / Implantação / Ganho / Standby"; o waterfall agrupa nas 7 canônicas).
- **1D — Teste de integridade em CI.** Assert automatizado: `Σ Δ(etapa) == Total(B) − Total(A)` (seções 9 e 11).
- **1E — Cards de KPI delta + funil delta (C06).** A@ → B@ + Δ para deals / vidas / ARR / ARR-ponderado / MRR-ponderado / TCV(12M); funil pareado com variação de conversão. Reusa cálculos existentes rodados 2×.
- **1F — Drill-down por barra.** Clique numa etapa → lista de deals que causaram o movimento (reusa o padrão "Avançaram / Regrediram / Novos / Saíram" já pronto). Barato porque o dado deal-level já é computado em 1B.

**Caminho crítico:** 1A → 1B → 1C → 1D. As sub-fases 1E e 1F correm em paralelo após 1B.

---

## 13. Plano de execução detalhado — Fase 1

_Escrito após rodar o protocolo `/axenya-dashboard` (2026-07-12): servidor local no ar (`node scripts/local-server.js`, porta 3002) e leitura dos canônicos `README.md`, `STATUS_LOG.md` (Diretrizes) e `AUDITORIA_GRAFICOS.md`._

### 13.0 Estado verificado no ambiente (2026-07-12)

Checado ao vivo em `http://localhost:3002`, não só no código:

- Rotas `/novo`, `/forecast`, `/api/auth/me`, `/api/history?action=fotos`, `/api/forecast-table` → **200** (bypass local ativo).
- `?action=fotos` → **8 fotos**: `2026-05-12`, `2026-06-05`, `2026-06-12`, `2026-06-19`, `2026-06-26`, `Jun 2026` (mensal), `2026-07-03`, `2026-07-10`.
- `?action=snapshot&tab=<data>` → cada foto devolve os deals em **35 colunas brutas** com a coluna `Etapa` (confirmado para 07-03, 06-12 e 05-12). A foto inclui **todas as etapas** (Ganho/Perdido/Standby inclusive), diferente do `forecast-table` ao vivo (227 deals, só abertos Vendas+Bid) → a camada de comparação precisa **filtrar os deals abertos** com a mesma regra do painel ao vivo.
- `forecast-table` ao vivo → 227 deals, payload com chaves `success/deals/total/pipelines/context/timestamp`.

### 13.1 Restrições de engenharia que moldam o plano

Vêm dos canônicos e **não são negociáveis** ao construir:

1. **Limite de 12 funções serverless (Vercel Hobby).** "Endpoint NOVO em `api/` → checar antes o limite" (STATUS_LOG). **Decisão de implementação:** o `/api/compare` NÃO nasce como arquivo novo — vira **`action=compare` dentro do `api/history.js`** (que já lista fotos e lê snapshots). Colocaliza com a infra de snapshot e não consome uma função nova. _(Ajuste à decisão 5 da seção 12.3: "backend Node" = nova action no `history.js`, não novo arquivo.)_
2. **ES5 puro, sem framework, sem bundler, sem dependência npm** no front (`var`/`function`, não `const`/`let` em closures críticas). Chart.js 4.4.1 já disponível.
3. **Separador de texto é SEMPRE `|`** — em títulos, tooltips, labels, fórmulas. Travessão só como placeholder de "sem dado".
4. **Fonte única de receita (Regra primária nº 3).** O Delta consome as MESMAS duas séries (Real / Probabilizada) via `forecast-engine.js`; não recalcula receita por conta própria. Se divergir do Forecast Overall, é bug de fonte.
5. **Menu lateral / dropdown = bloco `PANELS`** replicado. Adicionar a nova view = editar `PANELS` e propagar aos HTMLs, nunca a `<ul>` estática de um só.
6. **Coordenação de sessões.** `history.js`/`lib/` e os compartilhados (`forecast-engine.js`, `revenue-engine.js`, `faturamento-manual.js`) têm raio de explosão grande: mexer neles exige declarar território e **reiniciar o servidor local** (cacheia `require`). Só uma sessão deploya, com confirmação.
7. **Marcação de validação por emoji.** Todo gráfico/KPI novo nasce **🟡 (não analisado)** no título até validação explícita; nada "verde" antes de bater contra o HubSpot/Forecast Overall.

### 13.2 Riscos e caveats de fidelidade ponto-no-tempo (endereçar em 1A/1B)

- **🔴 Âncora temporal (Gap 1).** `forecast-engine.js:51` usa `new Date()` como piso do início de receita (Diagnóstico/Reunião Agendada). Recomputar foto antiga hoje escorrega a receita para o mês corrente. **Correção:** injetar `referenceDate` via `config()` e usá-la no lugar de `new Date()` e de `todayStr()`.
- **🟠 Faturamento manual não é snapshotado.** `faturamento-manual.js` lê overrides manuais (Upstash KV) de Ganho/Implantação que substituem o forecast. Esses valores são **estado atual**, não ponto-no-tempo — recomputar uma foto antiga aplica os valores manuais de HOJE ao bucket Ganho/Implantação. **Ação:** documentar o caveat na UI da fase 1; congelar/snapshotar o KV fica para depois (não bloqueia).
- **🟠 Filtro de deals abertos.** A foto tem todas as etapas; o forecast ao vivo filtra (createdate ≥ set/25, tratamento de Ganho, Bid desde jan/25, dedup Fee×Corretagem). A camada de comparação deve aplicar **exatamente o mesmo filtro** dos dois lados, senão a identidade de QA quebra e some deal só de um lado (seção 9).

### 13.3 Plano por sub-fase

Cada sub-fase é entregável, testável e commitada isoladamente (ponto de restauração).

**1A — Fundação de correção temporal.** _Objetivo: tornar a engine determinística em relação a uma data de referência._
- 1A.1 — Adicionar `referenceDate` ao `ForecastEngine.config()`; substituir `new Date()` (linha ~51) e o piso via `todayStr()` por essa data.
- 1A.2 — Garantir retrocompatibilidade: sem `referenceDate`, cai em "hoje" (comportamento atual dos painéis ao vivo intacto).
- 1A.3 — Validar o "escorregamento": recomputar a foto de 12/06 com `referenceDate=2026-06-12` e comparar com o número que o Forecast Overall mostrava então; medir a diferença vs. recompute âncora-hoje.
- **Arquivos:** `public/forecast-engine.js` (compartilhado → coordenar + restart). Consumidores atuais (`forecast.html`, `forecast-stage.html`, `dashboard.html`, `ae.html`) não mudam de comportamento.
- **Aceite:** recompute de foto X com `referenceDate=X` reproduz os números daquela data; painéis ao vivo inalterados.

**1B — Camada de dados de comparação (`history.js?action=compare`).** _Objetivo: um payload por requisição, calculado no servidor._
- 1B.1 — Tornar `forecast-engine.js` + `revenue-engine.js` + `faturamento-manual.js` carregáveis em Node (módulo compartilhado, fonte única — sem cópia da matemática).
- 1B.2 — Fornecer no servidor as dependências injetadas hoje pelo escopo de página (`MONTHS`, `getVpv`, `parseRevenueDate`, `addMonths`, `calcReceita`, `monthLabels`) + `referenceDate`.
- 1B.3 — `action=compare&a=<data>&b=<data>`: valida **B > A**; resolve A e B para a foto ≤ data (reusa a lista de `fotos`); lê as duas fotos; aplica o filtro de deals abertos (13.2); roda a engine com a `referenceDate` de cada foto.
- 1B.4 — Agrega `CashForecast(S, D)` por etapa (Prob e Real), no horizonte **TCV(12M) rolante** (default) e total; monta o deal-diff (novos/avançaram/regrediram/saíram) reusando o padrão do modo Comparação do `/forecast`; calcula os KPIs de apoio (13/6.2). Devolve tudo num payload.
- **Arquivos:** `api/history.js` (nova action), engine compartilhada (1A/1B.1). **API + compartilhados → coordenar + restart.**
- **Aceite:** `curl action=compare` para duas fotos retorna totais por etapa A/B, deltas, deal-diff e KPIs; `Σ Δ(etapa) == Total(B) − Total(A)` bate no payload; B=foto mais recente reproduz o Forecast Overall ao vivo.

**1C — Waterfall (peça central) + nova view.** _Objetivo: a tela._
- 1C.1 — Criar `public/forecast-delta.html` (nova view autônoma); registrar rota em `vercel.json` + `scripts/local-server.js`; adicionar ao bloco `PANELS` e propagar.
- 1C.2 — Dois seletores de data que travam **B > A** (decisão 2), alimentados pela lista de fotos, com rótulo de resolução ("escolheu 15/06 → foto de 12/06").
- 1C.3 — Waterfall (barras flutuantes em Chart.js: Total@A → Δ por etapa em ordem canônica → Total@B; verde sobe / vermelho desce), com **normalização de nomes de etapa** (foto usa "Proposta Enviada/Implantação/Ganho/Standby" → 7 canônicas).
- 1C.4 — Toggle Real ↔ Probabilizada (segmented control `.tab-sub`), recalculando tudo. Rótulo do horizonte **TCV(12M) visível** + toggle secundário "Pipeline total".
- 1C.5 — Botão `i` (memória de cálculo: campos + fórmula) e título **🟡**.
- **Arquivos:** `public/forecast-delta.html` (front-only após 1B), `vercel.json`, `local-server.js`, `PANELS`.
- **Aceite:** waterfall renderiza com dados reais; soma visual = KPI de total; toggle atualiza tudo; datas resolvidas rotuladas; casos de borda (mesma foto / sem foto) com mensagem (seção 9).

**1D — Teste de integridade automatizado.** _Objetivo: guardrail da atribuição (seções 9 e 11)._
- 1D.1 — Script Node (ex.: `scripts/test-delta-invariant.js`) que, para pares de fotos reais, afirma `Σ Δ(etapa) == Total(B) − Total(A)` (tolerância de arredondamento) em Real e Prob.
- 1D.2 — Casos de borda: A=B → erro claro; data < foto mais antiga (2026-05-12) → comparação desabilitada; deal `dados_completos:false` tratado igual dos dois lados.
- **Aceite:** teste roda pelo Node puro (viabilizado pela decisão 5) e passa para todos os pares de fotos disponíveis.

**1E — Cards de KPI delta + funil delta (C06).** _Paraleliza após 1B._
- 1E.1 — Cards A@ → B@ + Δ (abs e %) para: Deals Abertos, Vidas, ARR Total, ARR Ponderado, MRR Ponderado, TCV(12M) — mesmos números do Forecast ao vivo, rodados 2×.
- 1E.2 — Funil delta espelhando o **C06**: contagem por etapa A vs B (barras pareadas/dois funis) + variação de conversão entre etapas (pp). Reusar `prob-engine.js`/lógica do C06.
- **Aceite:** com B=hoje, cada card bate com o número equivalente do CRO/Forecast ao vivo; funil delta consistente com o C06.

**1F — Drill-down por barra.** _Paraleliza após 1B._
- 1F.1 — Clique numa barra de etapa → modal com os deals que causaram o movimento (contribuição before/after por deal), reusando `_novoOpenFunnelDealsModal`/`novoOpenDealsModal` e o padrão "Avançaram/Regrediram/Novos/Saíram".
- **Aceite:** o drill lista os deals responsáveis e a soma das contribuições = Δ da etapa.

### 13.4 Sequenciamento e paralelização

```
1A ──▶ 1B ──▶ 1C ──▶ 1D        (caminho crítico)
              └─▶ 1E  (paralelo após 1B)
              └─▶ 1F  (paralelo após 1B)
```

- 1A e 1B tocam compartilhados/`api` → **território exclusivo, com restart** do servidor a cada mudança; commitar ao fim de cada uma.
- 1C, 1E, 1F são majoritariamente **front-only** (dentro do `forecast-delta.html`, consumindo o payload de 1B) → paralelizáveis entre si.
- 1D depende de 1B (payload estável).

### 13.5 Definition of Done da Fase 1

- Nova view `/forecast-delta` no ar (local), acessível pelo menu (`PANELS`).
- Waterfall por etapa com toggle Real/Prob e horizonte TCV(12M) rotulado.
- Cards de KPI delta + funil delta (C06) coerentes com o Forecast ao vivo quando B=hoje.
- Drill-down por barra funcional.
- Teste de integridade `Σ Δ = Total B − Total A` passando no CI.
- Caveats documentados na UI (faturamento manual não é ponto-no-tempo; data mínima 2026-05-12; resolução semanal).
- Títulos em **🟡** até validação explícita contra o HubSpot/Forecast Overall; `STATUS_LOG.md` atualizado a cada entrega.

### 13.6 Fora do escopo da Fase 1 (confirmado)

Cron diário / snapshot do KV de faturamento manual; paridade total dos cards CRO (Fase 2, seção 10); posição definitiva na navegação; deploy em produção (só após validação e confirmação, regra de sessão única).

