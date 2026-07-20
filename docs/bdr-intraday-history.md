# BDR Intraday — cache durável, drill-down de ligações e ambientes

> Fase 1 live desde 2026-07-14. Proposta completa (com Fase 2 = histórico BigQuery):
> `openspec/changes/bdr-intraday-history-drilldown/`.

## Ambientes (separação de primeira classe) — `lib/env.js`

Fonte única de verdade para ambiente. Resolve `VERCEL_ENV` → `NODE_ENV` → `development`.
`preview` e local contam como **development** para dados (não contaminam produção).

| | dev / preview / local | production |
|---|---|---|
| `env.name` / `env.isProd` | development/preview · false | production · true |
| `env.gcpProject` | `gen-lang-client-0423905839` (nunca `growth-487021`) | idem |
| `env.bqDataset()` | `axenya_bdr_intraday_dev` | `axenya_bdr_intraday_prd` |
| `env.ciDataset()` | `axenya_commercial_intel_prd` (read-only) | idem |
| `env.kvKey(ns)` | `dev:<ns>` | `prd:<ns>` |
| `env.flag(NAME)` | lê `BDR_FLAG_<NAME>` (default off) | idem |

Datasets BQ criados em `southamerica-east1`, rotulados `env`/`owner`/`domain`. Regra:
**dev/preview nunca escrevem em `_prd`**. Fundação CI é read-only nos dois.

## Cache durável — `api/bdr-workload.js`

Antes: `let _cache={}` em memória (morria em cold start, não compartilhado). Agora, 2 camadas:

```
L1 memória (instância, 5 min) → L2 KV (durável, compartilhado, env-namespaced, 5 min) → live HubSpot
```

- Chave: `env.kvKey('workload:<since>|<until>')`. Resposta indica `cacheLayer: memory|kv`.
- **KV é dependência mole**: se `KV_REST_API_URL/TOKEN` ausentes ou erro, degrada para L1 + live sem lançar. Local sem KV = comportamento antigo.

## Drill-down de ligações — o "72 do Anderson"

Clicar no número de **Ligações** de um BDR abre o detalhe:

- **Instantâneo (client-side, custo zero):** conversa × discagem (≥1 min), por desfecho, por faixa de duração. Reconcilia com o número clicado.
- **Lazy "para quem":** `GET /api/bdr-workload-calls?bdr&since&until` busca a associação call→contato/empresa **só ao abrir o modal**. Degrada: se falhar, mostra o breakdown sem "para quem".
- **Privacidade:** sem telefone, e-mail ou payload bruto — só nome do contato + empresa. Cache KV env-namespaced.

Exemplo real (2026-07-13): Anderson = **72 ligações, 4 conversas (6%), 68 discagens** (25 com 0s). O número bruto inflava ~18×. Obs.: `hs_call_disposition` vem vazio ("Sem desfecho") — BDRs não preenchem; o sinal real é duração (conversa ≥ 1 min), coerente com a CI (`enr_call_semantics`: ~16% de conversa real).

## Fonte GCP canônica do Workload (patch 2026-07-20)

Sem criar recursos novos: o dashboard agora lê recursos existentes e read-only.

| Recurso | Região | Uso |
|---|---:|---|
| Cloud Run ETL BDR HubSpot | `us-central1` | job idempotente acionado pelo scheduler em quatro checkpoints úteis |
| Cloud Scheduler ETL | `us-central1` | `0 8,12,16,20 * * 1-5`, `America/Sao_Paulo` |
| `gen-lang-client-0423905839.axenya_sales_hubspot_bdr_prd_sae1_gold.bdr_daily_ops` | `southamerica-east1` | histórico agregado de atividades e SQL diário por BDR |
| `gen-lang-client-0423905839.axenya_sales_hubspot_bdr_prd_sae1_silver.sql_deals` | `southamerica-east1` | deals SQL deduplicáveis por `deal_id`, sem PII no dashboard |

Regra de leitura: hoje usa HubSpot live para atividades; histórico e SQL real usam BigQuery gold/silver com freshness explícita. Se BigQuery não estiver configurado, a API falha fechado (503) e o front não renderiza SQL como zero.

## Fase 2 (histórico)

Implementação mínima aditiva em auditoria: `api/bdr-workload-history.js` + merge no front. Permanece 🟡 até smoke pós-deploy autenticado.
