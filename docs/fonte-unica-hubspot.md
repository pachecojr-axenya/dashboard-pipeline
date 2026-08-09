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
| `company-activities` | migrado | `fact_engagement` | 3/3 empresas com 20 toques e corpo; conjunto **não comparável** porque a API trunca — ver abaixo |
| `deal-activities` | migrado | `fact_engagement` | 3/3 deals, idem |
| `bdr-leads` | migrado | `dim_contact` + `fact_crm_change` + `dim_company` | **2.127/2.127** exato; 7 campos 100% iguais; `semStatus` 0,16% de defasagem |
| `funnel-stages` | migrado | `fact_stage_entry` + `dim_deal` + `fact_crm_change` | contagens de etapa **maiores e certas** no funil Vendas; `owner_changes` e `stage_medians` também mudam — ver abaixo |
| `explore-tickets` | **fica na API** | — | ver abaixo |
| `bdr-workload` | migrado | `dim_company` + `dim_contact` + `fact_crm_change` + `fact_engagement` | **19/19 · 92/92 · 1/1 · 3.054/3.054** toques, mesmo mix por tipo |

### O armazém não via remoção de valor — CORRIGIDO

`LAST_VALUE(... IGNORE NULLS)` nos `filled` do `10_silver.sql` carrega o último
valor conhecido adiante. É necessário (o histórico de uma propriedade não dispara
em toda linha de evento), mas fazia **esvaziar um campo ficar indistinguível de
"não houve evento"**: o dono removido sobrevivia como atual.

| objeto | `is_current` | dono fantasma (antes) | dono errado | depois |
|---|---:|---:|---:|---:|
| contact | 53.687 | **11.625 (21,7%)** | 0 | 0 |
| company | 19.879 | 59 (0,3%) | 0 | 0 |
| deal | 4.218 | 3 (0,07%) | 0 | 0 |

`dono errado = 0` nos três: quando o portal TEM dono, o armazém sempre acertou. O
defeito era só "não vê a remoção", e valia para `lead_status`, `lifecyclestage`,
`bdr`, `ativo_inativo`, `kam_responsavel`, `vidas`, `porte` e `segmento`.

**A remoção chega como `value = NULL`, não como `''`** — a primeira tentativa de
correção não mudou nada por atacar o `''`. `MAX(IF(property=P, value, NULL))`
devolve NULL tanto para "sem evento para esta propriedade" quanto para
"esvaziado", e ali estava a conflação. Correção: sentinela `'!LIMPO!'` quando
existe linha de histórico sem valor, com literal que ordena abaixo de dígitos e
letras para o `MAX` preferir valor real num empate. No `fact_owner_assignment` a
sentinela FICA para o `LEAD` encerrar a posse anterior e é descartada no fim:
remoção termina uma posse, não inaugura outra.

**Double check: `current_matches_payload`** (suíte 68 → 73). Rodado ANTES da
correção de propósito — reprovava em 4 dos 5 alvos; depois, 0 em todos. Check que
passa no estado defeituoso não é prova, é espelho.

O efeito no `bdr-leads` mede o tamanho do defeito: era 3.872 contra 2.173 da API
(+78%, 1.699 contatos hoje sem dono creditados a BDRs); passou a **2.127/2.127
exato**.

### Onde o armazém DISCORDA da API por estar certo

**Regra:** quando o número novo divergir do que o time já reconhece, adotar o
certo — e documentar o como e as premissas junto com ele. Todo endpoint migrado
carrega `premissas` e `divergencias_conhecidas` no próprio payload, e não só na
doc: número certo sem premissa explícita é indistinguível de número novo sem
explicação, e aí ninguém confia. O inverso também vale e vale mais: quando a fonte
NOVA é que está errada, não migrar — foi o caso do `bdr-leads`. "Adotar o certo"
não é "adotar o novo".

No **feed de atividades** (`company-activities` / `deal-activities`), o conjunto
nem é comparável: a versão da API busca as associações de cada tipo com
`?limit=50` e só depois ordena e corta em 20. Para objeto com muito toque de um
tipo, esses 50 não são os mais recentes — então as "últimas 20 atividades" do modal
antigo **nunca foram as últimas 20**. Medido: a empresa 18490469550 tem **33.207
e-mails** (mais 21 ligações, 18 notas, 12 reuniões), e a API devolvia notas e
ligações de abril a agosto e nenhum e-mail do próprio dia. Outros casos: 4.635 e
2.034 e-mails em empresas, 1.911 / 1.601 / 1.017 em deals. O armazém pega o top 20
global de verdade. O `compare-warehouse-endpoints.js` detecta a truncagem e reporta
"conjunto não comparável" em vez de marcar falha — script que grita em tudo é script
que ninguém lê.

No `funnel-stages`, três coisas mudam:

**1. Contagem de etapa — maior, e certa.** O funil é sempre `(pipeline, stage)`. A
versão antiga bucketizava toda entrada pelo pipeline **atual** do deal, então a
entrada de um deal hoje em Bid que passou por Vendas era testada contra o mapa de
etapas do Bid, não casava (id de etapa é único por pipeline) e caía fora **em
silêncio**. Medido: 2.200 de 7.796 entradas (28%), em 1.612 deals, têm pipeline
diferente do atual. Efeito no funil Vendas: RA 615 vs 607, Diagnóstico 262 vs 258,
Cotação 80 vs 78, Consultoria 49 vs 47, Negociação 29 vs 28.

**2 e 3. `owner_changes` e `stage_medians`.** O `propertiesWithHistory` do HubSpot
**repete o mesmo valor** quando houve re-save, ação em massa ou `MERGE_OBJECTS`, e
`fact_crm_change` colapsa valor igual consecutivo. No deal 28356544839 a API lista
`657736716` três vezes seguidas e reporta 6 trocas de dono; o dono mudou de mão 4
vezes.

Consequência na mediana de tempo em etapa: uma entrada duplicada depois de o deal
chegar em Perdido dava à API um "período seguinte", e ela contava tempo
**concluído** numa etapa que o deal nunca deixou (Perdido n=4 no armazém vs 12 na
API). O armazém marca `is_open` e não conta.

O N07 foi validado contra o relatório do HubSpot em 02/07/2026, e o relatório
conta o mesmo ruído — então **bater com o relatório e estar aritmeticamente certo
deixaram de ser a mesma coisa**. Decisão registrada: vale o número certo, e a
validação de 02/07 **deixou de ser prova de acerto**. Isso está escrito nos três
lugares em que a tela documenta o N07 (catálogo do card + tooltip PT + tooltip EN
em `public/dashboard.html`), não só aqui.

Uma premissa que **não** mudou, e é limitação conhecida: o universo continua sendo
"deals cujo pipeline ATUAL é Vendas ou Bid". Deal que migrou para um terceiro
pipeline fica fora dos dois funis mesmo tendo passado por eles. Corrigir isso é
outra mudança, com outro efeito, e não foi feita.

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

## O que ainda difere no `bdr-leads`, e por que está certo

`hist` difere em 15 de 2.127 contatos. Nos 15 o armazém está certo: a API REPETE
o mesmo status em re-save (`NEW@18:49` e `NEW@19:22`) e às vezes no mesmo instante
(`CONNECTED@14:14` duas vezes). `fact_crm_change` colapsa valor igual consecutivo,
e `NEW → NEW` não é transição — contá-la infla "quantos contatos mudaram de status
hoje".

`semStatus` difere 0,16% (8.298 vs 8.311). É **defasagem, não defeito**: a extração
é das 06:30 e o portal segue sendo editado. É exatamente o que o selo de frescor
existe para dizer. O `compare-warehouse-endpoints.js` tolera 1% aqui e falha acima
disso.

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

**Destino: DM do salencar** (`U0A20338SQL`), configurado nos dois Jobs em
`SLACK_ALERT_CHANNEL`. Decisão de 07/08/2026: nenhum token do workspace tem
`channels:write`, então criar canal exigiria passo manual — e o bot
(`hubspot-helper-slack-bot-token`) posta em DM sem scope adicional. Testado ao
vivo: `chat.postMessage` com `channel=U0A20338SQL` devolve `ok=true` e a mensagem
renderiza com o Block Kit correto.

Contrapartida a assumir: **ninguém mais vê o alerta.** Quando houver um canal de
dados, é uma linha:

```bash
gcloud run jobs update hubspot-platform-close --region southamerica-east1 \
  --project gen-lang-client-0423905839 \
  --update-env-vars SLACK_ALERT_CHANNEL=<ID_DO_CANAL>
# idem para hubspot-platform-reconcile
```

Sem a variável o job **loga** que o BLOCK não foi avisado e segue — nunca falha
por causa do alerta. Perder o aviso é ruim; perder a informação de que a suíte
falhou é pior.

Smoke do alerta, sem esperar um BLOCK de verdade:

```bash
cd 15_Workspaces/GCP_Axenya/scripts/hubspot-platform
SLACK_ALERT_CHANNEL=U0A20338SQL python3 -c "
from hubspot_platform.alert import notify_blocked
notify_blocked('smoke', [{'check_name':'parity_vs_hubspot','severity':'BLOCK',
  'passed':False,'subject':'deals_ganho_90d','observed':14,'expected':15,
  'detail':'TESTE — ignore.'}], mode='close')"
```
