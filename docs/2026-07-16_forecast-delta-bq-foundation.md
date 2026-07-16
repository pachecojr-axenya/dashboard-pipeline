# Forecast Delta — Fundação BigQuery

> Estado em 2026-07-16: guardrails concluídos, PR #2 mergeada e commit `4aab7b5`
> deployado com autorização. Fundação validada em `axenya_forecast_dev` e
> **ativada em `axenya_forecast_prd`** por backfill exclusivo da HubSpot API.

## Linhagem canônica

```text
HubSpot API (fonte)
  ├── snapshot atual diário ──> axenya_forecast_{env}.forecast_snapshots_daily
  └── sexta/fim de mês ───────> axenya_forecast_{env}.forecast_snapshots_weekly_gold

Google Sheet "Forecast" / clone
  └── sanity check independente (NUNCA fonte do BQ)
```

- Projeto único: `gen-lang-client-0423905839` (Growth Axenya).
- Datasets: `axenya_forecast_dev` e `axenya_forecast_prd`, location
  `southamerica-east1`.
- As tabelas Forecast foram removidas dos datasets `axenya_bdr_intraday_*`.
- Nunca usar `growth-487021` nem o projeto pessoal da SA legada da planilha.

## Tabelas

| Tabela | Grão | Uso |
|---|---|---|
| `forecast_snapshots_daily` | 1 deal × dia | datas livres e comparação point-in-time |
| `forecast_snapshots_weekly_gold` | 1 deal × sexta/fim de mês | lista leve de fotos do `/forecast` |

Schema: `snapshot_date`, `snapshot_type`, `captured_at` e `c00..c35`, que
correspondem aos 36 `HEADERS` canônicos de `lib/snapshot-format.js`.

## Ingestão

### Corrente

`api/snapshot.js` busca todos os deals diretamente na HubSpot API. A mesma
resposta bruta grava daily e, quando aplicável, weekly. A planilha legada ainda
é mantida pelo cron, mas não participa da escrita do BQ.

### Histórica

`scripts/backfill-hubspot-bq.js` usa `propertiesWithHistory`, carregadas uma vez,
e reconstrói cada dia às 23:59 BRT:

```bash
node scripts/backfill-hubspot-bq.js \
  --from 2026-05-12 --to 2026-07-16 \
  --gold-dates 2026-05-12
```

Limitação conhecida: deals deletados do HubSpot após o corte são irrecuperáveis.
No período validado isso não gerou divergência: IDs bateram 100%.

## Compatibilidade 35 × 36 colunas

As fotos históricas tinham 35 colunas (sem `É POC?`); o formato atual tem 36.
O insert BQ mapeia valores **pelo nome do header**, nunca apenas por posição.
Isso evita deslocar Probabilidade, Quarter e datas em fotos antigas.

## Leitura

- `action=fotos`: `weekly_gold` (mantém o comportamento do `/forecast`).
- `action=compare` e `compare-drill`: `daily` (datas livres reais).
- `action=snapshot`: daily → weekly → Sheet (fallback).
- Sem credencial/BQ suficiente: fallback para a planilha.

## Evidência de validade em dev

Backfill real: HubSpot API → BQ, 2026-05-12 a 2026-07-16:

- 66 partições daily detalhadas;
- 12 partições weekly/month-end gold;
- 1.141 deals em escopo em 12/mai → 1.378 em 16/jul.

Sanity independente contra o clone autorizado da planilha
`1DwPBPw6n-NezCYGhtQ8X3iVKjqcoA9FnnTHjnvbRaNQ`:

- **286 checks PASS, 0 FAIL, 0 SKIP**;
- 7 fotos: contagem e Deal IDs 100% exatos;
- Pipeline, Etapa, Vidas, ARR, Quarter, Data Prevista e Closed Lost: 0 divergências;
- 14 datas do Histórico Diário: todos os buckets e totais exatos;
- daily = weekly em toda partição gold.

Exceção documentada: a foto de 12/mai contém `Embraer` (`36080066857`) no
pipeline `803749153`, fora de Vendas/Bid. O BQ aplica o pipeline histórico no
cutoff e exclui corretamente esse registro; o sanity o trata como anomalia da
referência, sem contaminar a fonte canônica.

Outros gates:

- `/forecast` e `/forecast-delta`: HTTP 200;
- `action=fotos`: fonte `bq`;
- compare 05/jun × 10/jul: sucesso e invariante `ΣΔ = Δtotal` verdadeiro;
- `scripts/test-delta-invariant.js`: PASS.

Evidências criptográficas finais:

- build gate: `99347e0d070e48d4962d1394ad290b2c83daa1248d530596ef7e9c85c26f135c`;
- sanity HubSpot/BQ/Sheet: `3e5469b8d50a769ecfdc17cb7d4264094b411813cb898ed3869b60cf572f4330`;
- integração BQ: `a27b52dc6e2d38eb5f2577f60f1725ead1d8fb93becc231242dd3a68ee22d612`.

## Ativação em produção

1. Aprovar e mergear PR #2.
2. Deploy com lock do dashboard.
3. Carregar silenciosamente `HUBSPOT_TOKEN` e `GOOGLE_SERVICE_ACCOUNT_JSON`.
4. Rodar `VERCEL_ENV=production node scripts/backfill-hubspot-bq.js ...`.
5. Rodar o sanity com `FORECAST_SANITY_SPREADSHEET_ID=<clone>`.
6. Só então implementar a UI final de datas livres/drills.

### Concluída em 16/jul/2026

- Deploy: `main` / `4aab7b5`, projeto canônico Vercel Pro.
- `daily`: 66 partições, 83.852 linhas, 12/05–16/07.
- `weekly_gold`: 12 partições, 15.116 linhas, 12/05–10/07.
- Sanity: `MATCH: TODOS OS CHECKS PASSARAM`, zero FAIL.
- Cron diário ativo: `59 2 * * *` (02:59 UTC / 23:59 BRT), HubSpot API →
  `daily`; sextas/fins de mês também → `weekly_gold`.
- Evidências: build `99347e0d070e48d4962d1394ad290b2c83daa1248d530596ef7e9c85c26f135c`;
  sanity PRD `e69d2cefcdcf012eeabfe4300babc69fef0f6a0e558a1112d95e9e9087e521d9`;
  integração `a27b52dc6e2d38eb5f2577f60f1725ead1d8fb93becc231242dd3a68ee22d612`.
