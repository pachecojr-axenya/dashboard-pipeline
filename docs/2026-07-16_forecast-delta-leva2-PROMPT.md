# Prompt — Leva 2 do Forecast Delta

Cole numa nova sessão depois que a PR #2 estiver mergeada, deployada e o dataset
`axenya_forecast_prd` estiver populado.

---

Você é o orchestrator do vault Axenya. Trabalhe no repo
`15_Workspaces/Pipeline_Dashboard/dashboard-pipeline`. Leia primeiro
`docs/2026-07-16_forecast-delta-bq-foundation.md`, README, Diretrizes do
STATUS_LOG e `docs/github-source-of-truth.md`.

## Passo 0 — gate obrigatório

Confirme, sem assumir:

```bash
P=gen-lang-client-0423905839
bq --project_id=$P query --use_legacy_sql=false --format=csv \
  'SELECT COUNT(*) FROM `gen-lang-client-0423905839.axenya_forecast_prd.forecast_snapshots_daily`'
bq --project_id=$P query --use_legacy_sql=false --format=csv \
  'SELECT COUNT(*) FROM `gen-lang-client-0423905839.axenya_forecast_prd.forecast_snapshots_weekly_gold`'
```

Se alguma tabela estiver vazia, PARE. Nunca use a planilha para popular o BQ.
O backfill correto é `scripts/backfill-hubspot-bq.js` com HubSpot API.

Rode o sanity externo:

```bash
FORECAST_SANITY_SPREADSHEET_ID=1DwPBPw6n-NezCYGhtQ8X3iVKjqcoA9FnnTHjnvbRaNQ \
  node scripts/check-bq-ingestion.js
```

Exija `MATCH: TODOS OS CHECKS PASSARAM`.

## Escopo UI — request da Auris

1. Trocar Foto A/B de dropdown por `input type=date`. `action=compare` já usa
   `forecast_snapshots_daily`, então a data deve resolver para o dia exato quando
   houver snapshot; mostrar claramente `requested` e `resolvedTab`.
2. Tornar cards Vidas, ARR Total e ARR Ponderado clicáveis, abrindo drill de
   contas responsáveis pelo delta.
3. Tornar barras do funil clicáveis, reutilizando o modal de deals.
4. Adicionar visão/toggle de ARR Total e Ponderado por Quarter previsto.
5. Criar visão unificada por etapa: nº deals + vidas + receita.

## Regras

- Branch nova `samuel/forecast-delta-leva2-ui`; commit/push/PR pré-merge.
- Não mergear nem deployar.
- Autor: `Samuel Alencar <salencar@axenya.com>`.
- Zero dependência nova; fonte única de receita intacta.
- Sheet é somente sanity check, nunca fonte.
- Validar `npm run check`, inline JS, rotas `/forecast` e `/forecast-delta`,
  compare entre datas não-sextas e `scripts/test-delta-invariant.js`.
- PR deve mapear cada item 1–6 da Auris para estado entregue/pendente.
