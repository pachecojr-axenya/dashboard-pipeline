# Fonte única HubSpot — operação e consumo (F5)

Doc de operação do armazém canônico `axenya_hubspot_prd_{bronze,silver,gold}` do
lado do dashboard. O ETL e a modelagem vivem em
`15_Workspaces/GCP_Axenya/scripts/hubspot-platform/`; o handoff da fase está em
`20_Company/Sales/Pipeline_Dashboard/2026-08-07_Handoff_F5_Operacao_Fonte_Unica.md`.

## O princípio da migração

**Leitura analítica migra; escrita, ação e tempo real ficam ao vivo.**

Endpoint que escreve no CRM, que monitora em tempo real, ou cuja lógica não está
modelada, continua batendo na API do HubSpot. Não há ganho em forçar.

Todo endpoint migrado aceita `fonte=api` (query string ou corpo) para responder
pela rota antiga, e devolve `fonte: 'bq' | 'api'` na resposta. É isso que permite
migrar um por vez comparando — e continuar comparando depois, em produção, quando
alguém desconfiar de um número.

```bash
# comparação reprodutível, endpoint por endpoint
node scripts/compare-warehouse-endpoints.js --adc            # todos
node scripts/compare-warehouse-endpoints.js --adc calls       # só um caso
```

## Estado da migração

| Endpoint | Estado | Lê de | Paridade medida |
|---|---|---|---|
| `pull-tickets` | migrado | `dim_ticket` + `fact_stage_entry` + `bridge_association` | **187/187 tickets**, 0 divergência em createdate, closed_date, dono, etapa e empresa |
| `bdr-workload-calls` | migrado | `fact_engagement` + `disposition_label` + `dim_contact`/`dim_company` | **13/13 BDRs** em 30d, exato em total, conversas, discagens, taxa, desfecho e bucket |
| `deal-prob-history` | migrado | `fact_crm_change` | **5/5 deals**, série (valor, data) idêntica |
| `company-deals` | migrado | `dim_deal` + `bridge_association` | **4/4 empresas**, mesmo conjunto de deals |
| `company-activities` | migrado | `fact_engagement` | pendente do backfill de corpo dos toques |
| `deal-activities` | migrado | `fact_engagement` | pendente do backfill de corpo dos toques |
| `bdr-leads` | migrado | `dim_contact` + `fact_crm_change` + `dim_company` | pendente do re-extract de contatos |
| `explore-tickets` | **fica na API** | — | ver abaixo |
| `funnel-stages` | pendente | `fact_stage_entry` | — |
| `bdr-workload` | pendente | `fact_engagement` + `dim_company`/`dim_contact` + `fact_crm_change` | — |

Ficam ao vivo por decisão do handoff: `forecast-table` (probabilidade manual),
`growth-performance` (atribuição de marketing, fora do escopo), `cs-accounts` e
`pull-cs-data` (CS não modelado), `bdr-list-attack` (**escreve** no CRM),
`watcher-deals` (tempo real), `pull-hubspot` (pull genérico). `snapshot` e
`history` são híbridos e exigem desmontar a lógica de snapshot manual — fase
própria.

### A ressalva dos tickets, explícita

Só o **Pipeline de Cotação (847948895, 187 tickets)** está no armazém. Os outros
**18 pipelines — 109.013 tickets — não estão.** `pull-tickets` sempre foi só de
Cotação, então para ele a migração é completa. Qualquer tela que precise dos
demais pipelines fica na API até o escopo ser ampliado. `lib/hubspot-warehouse.js`
expõe `cotacaoOnly(pipelineId)` para essa decisão não ser feita de cabeça.

`explore-tickets` **não migrou** por essa ressalva: ele enumera os 19 pipelines e
as definições de propriedade do portal. O armazém tem 17 pipelines de ticket e não
modela dicionário de propriedade. Um explorador que mostra 17 de 19 e diz
"pipelines de ticket" é pior que um que bate na API.

## O botão Atualizar

Sem ele, migrar para o BigQuery **piora** a experiência: a tela trocaria "dado de
agora" por "dado de horas atrás sem aviso". O botão e o selo são o que torna a
migração aceitável.

```
POST /api/refresh   { escopo: "workload" | "leads" | "tudo" }
  → 202 { run_id, iniciado_em, eta_segundos }
  → 429 { motivo: "concorrencia", em_andamento: true, run_id, iniciado_em }
  → 429 { motivo: "teto", run_id, espere_s }

GET  /api/freshness
  → 200 { extraido_em, idade_minutos, ultimo_run, checks, em_andamento,
          proxima_execucao_agendada, estado }
```

`estado` é `ok` | `velho` | `alerta` | `indisponivel`, e é o front que só pinta —
a regra fica no servidor.

### As cinco regras e onde cada uma vive

| Regra | Onde |
|---|---|
| 1. Trava de concorrência | `lib/hubspot-jobs.gate()`, motivo `concorrencia` |
| 2. Janela curta (2 dias, não backfill) | `LOOKBACK_DAYS` em `api/refresh.js` |
| 3. Selo sempre visível | `public/freshness.js`, renderizado no load |
| 4. Estado de falha visível | `checks.block` em `/api/freshness` → faixa de alerta |
| 5. Teto de 1 a cada 5 min por escopo | `gate()`, motivo `teto` |

**A trava lê as execuções do Cloud Run, não o BigQuery.** Motivo medido: o job
leva ~15s entre ser disparado e escrever `RUNNING` em `raw_extract_run`, e nessa
janela dois cliques viravam duas execuções. O MERGE é idempotente; o orçamento de
request da API do HubSpot não é.

Regressão das travas: `node scripts/test-refresh-gate.js` (11 casos, inclui a
fronteira 4min59s × 5min01s — testar isso esperando de verdade levaria 5 minutos
e daria resultado diferente a cada execução).

### Ligar o selo numa tela

```html
<script src="/freshness.js?v=1"></script>
```
```js
// dentro da barra de filtros
AxFresh.badgeHtml()
// depois do primeiro render
AxFresh.init({ escopo: 'workload', onRefreshed: () => recarregarDados() });
// se a barra de filtros re-renderiza, repinte sem novo request:
AxFresh.remount();
```

`onRefreshed` tem de **invalidar o cache local** da tela. Sem isso o selo passa a
dizer "agora mesmo" em cima dos números velhos — pior que não ter selo.

## Infra

| Peça | Valor |
|---|---|
| Imagem | `southamerica-east1-docker.pkg.dev/gen-lang-client-0423905839/cloud-run-source-deploy/hubspot-platform:v1` |
| Job manhã | `hubspot-platform-reconcile` (MODE=reconcile, LOOKBACK_DAYS=3, SCOPE=tudo) |
| Job noite | `hubspot-platform-close` (MODE=close — só remodela e prova, não toca a API) |
| Scheduler | `hubspot-reconcile-0630` (`30 6 * * *`) · `hubspot-close-2030` (`30 20 * * 1-5`), America/Sao_Paulo |
| Service account | `hubspot-platform-run@gen-lang-client-0423905839.iam.gserviceaccount.com` |
| SA do dashboard | `growth@…` — precisa de `roles/run.developer` no job reconcile e `cloudscheduler.viewer` |

`SCOPE` traduz o escopo da tela para os objetos do armazém, e o mapa vive no
`entrypoint.sh` do container, não no JavaScript: quem sabe quais objetos alimentam
qual mart é o repositório do ETL. Mapa duplicado no front é como a tela pede
refresh de uma coisa e recebe outra.

## Alerta de BLOCK

`hubspot_platform/alert.py` posta no Slack quando a suíte trava, nomeando o check,
o observado e o esperado — alerta de log sabe que o job saiu != 0 e não sabe qual
número está errado, e é o segundo que decide se alguém precisa agir.

**Falta um passo manual:** nenhum token do workspace tem `channels:write`, então o
canal tem de ser criado à mão. Depois:

```bash
gcloud run jobs update hubspot-platform-close --region southamerica-east1 \
  --project gen-lang-client-0423905839 \
  --update-env-vars SLACK_ALERT_CHANNEL=<ID_DO_CANAL>
# idem para hubspot-platform-reconcile
```

Sem a variável o job **loga** que o BLOCK não foi avisado e segue — nunca falha
por causa do alerta. Perder o aviso é ruim; perder a informação de que a suíte
falhou é pior.
