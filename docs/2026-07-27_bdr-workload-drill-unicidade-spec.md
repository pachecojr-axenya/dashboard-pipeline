# BDR Workload v2 | Drill único por bloco clicado — spec de correção

> Criado: 2026-07-27 | Dono: Samuel Alencar | Status: em implementação
> Escopo: subpágina `/novo-bdr/workload`. Runbook: `20_Company/Sales/Pipeline_Dashboard/BDR_Workload_Subpage_Runbook.md`

## Reclamação do usuário (literal)

> "Quando clico nos cards ou cada coisas como lig conectadas, era esperado eu ver somente
> os dados relacionados ao bloco. O que eu acabo vendo são tudo. Clique em emails de um
> bdr e mostrou tudo dele. Preciso que seja unico cada clique."

## Invariante que passa a valer (Definition of Done)

**Todo elemento clicável abre exatamente o subconjunto de linhas que o próprio elemento
contabiliza.** Elemento que não corresponde a um conjunto de linhas (ex.: delta, taxa
derivada de dois conjuntos) **não deve ser clicável** — melhor não ter clique do que ter
clique que abre o conjunto errado.

Corolário de reconciliação: `valor exibido no card` == `total` do drill, para o mesmo
recorte. Divergência só é aceitável entre live (HubSpot, dia corrente) e Gold (BQ,
histórico), e nesse caso precisa estar declarada na tela.

## Diagnóstico validado contra BQ real (janela 2026-06-28..2026-07-27)

### Bug 1 | Cards de qualidade de ligação são indistinguíveis

Na aba Canais, 6 cards passam idêntico `context:'channel:calls'`: `Ligações`,
`Conectadas`, `Taxa de conexão`, `Tempo em linha`, `Sem conexão`, `Recado/voicemail`.

COUNT real por clique — quatro cards diferentes, resultado idêntico:

| Card clicado | context enviado | linhas abertas |
|---|---|---|
| Ligações | `channel:calls` | 5.781 |
| Conectadas | `channel:calls` | 5.781 |
| Sem conexão | `channel:calls` | 5.781 |
| Recado/voicemail | `channel:calls` | 5.781 |

O card exibe "Conectadas = 415" e o drill abre 5.781 linhas.

### Bug 2 | Colunas da tabela de Gestão sem contexto caem no total do BDR

`metricContext()` em `public/bdr-workload-v2.js` cobre apenas canais e `connected`.
As demais colunas retornam string vazia → drill sem filtro → total do BDR.

Prova real (BDR Allan Valença):

| Coluna clicada | kind | context | linhas | veredito |
|---|---|---|---:|---|
| total | activity | (vazio) | 708 | ok (é o total) |
| calls | activity | `channel:calls` | 405 | ok |
| callsConversation | activity | (vazio) | 708 | **BUG** |
| connRate | activity | (vazio) | 708 | **BUG** |
| talkTime | activity | (vazio) | 708 | **BUG** |
| emails | activity | `channel:emails` | 196 | ok |
| whatsapp | activity | `channel:whatsapp` | 62 | ok |
| linkedin | activity | `channel:linkedin` | 44 | ok |
| meetings | activity | `channel:meetings` | 1 | ok |
| crmMovements | crm | (vazio) | 150 | ok (kind isola) |
| connected | crm | `event:connected` | 4 | ok |
| sqlDeals | sql | (vazio) | 10 | ok (kind isola) |
| companiesInserted | penetration | (vazio) | 117 | ok (kind isola) |
| deltaHistorical | activity | (vazio) | 708 | **BUG** |

### Bug 3 | Gráficos ignoram o contexto do bloco

- `charts.stacked()` e `charts.lineArea()` passam context vazio → clique no dia abre todos
  os canais do dia, mesmo com filtro de canal ativo.
- `charts.grouped()` (Dia a dia A×B) passa context vazio, ignora o dia da barra clicada e
  ignora se a barra pertence ao período A ou B → qualquer barra abre o range inteiro.
- `charts.waterfall()` na aba Evolução passa `domain:<dominio>`, que o back-end aceita e
  descarta: o ramo `domain` de `addContext` não adiciona cláusula nenhuma → drill do
  componente devolve o total do domínio.
- `charts.ranking()` com `kind='activity'` (rankings de desfecho e bucket em
  `WorkloadBDRV2.calls()`) passa context vazio → clique num desfecho abre a base inteira.

### Bug 4 | Filtro global de canal não chega ao drill

`drillParams()` monta o payload a partir de `params()`, que envia `channels`, porém
`api/bdr-workload-drill.js` nunca lê `channels`. Com filtro "Canal = E-mails" ativo, o
card "Atividades" exibe só e-mails e o drill abre todos os canais.

## Schema real (confirmado via INFORMATION_SCHEMA)

`bdr_workload_touch_detail_v2`: `interaction_id, metric_date, occurred_at, owner_id,
owner_name, company_id, company_name, contact_id, channel, direction_effective,
atividade_tipo, call_outcome, call_natureza_final, call_duration_s, porte, segmento,
persona, outcome_real, deal_id, source_layer, refreshed_at`

⚠ A coluna `outcome_real` está **vazia** na view — não usar. A discriminação de ligação
vive em **`call_outcome`**.

Valores reais e agregação MECE que reconcilia com os cards:

```
calls = 5781   connected = 415   voicemail = 203   dial = 5163
dial     = no_answer(2732) + busy(2279) + wrong_number(36) + no_outcome(116)  [exato]
connected + voicemail + dial = 5781 = calls                                   [exato]
talk_s   = SUM(call_duration_s) WHERE call_outcome='connected' = 55.023
```

Regra de negócio já vigente em `api/bdr-workload-semantic.js`: conectada =
`call_outcome='connected'`; voicemail é bucket próprio, fora de conectadas e fora de
"sem conexão"; tempo em linha soma duração apenas das conectadas.

`bdr_workload_crm_events_v2.event_type`: attempted=1577, disqualified=990, connected=501,
qualified=100.

## Implementação

### 1. `api/bdr-workload-drill.js` — novo tipo de context `outcome`

Aplicado sobre `channel='call'`, válido **somente** com `kind=activity` (senão 400,
seguindo o padrão da mensagem `context channel incompatível com kind`):

| context | cláusula SQL |
|---|---|
| `outcome:connected` | `x.channel='call' AND x.call_outcome='connected'` |
| `outcome:voicemail` | `x.channel='call' AND x.call_outcome='voicemail'` |
| `outcome:dial` | `x.channel='call' AND COALESCE(x.call_outcome,'') NOT IN ('connected','voicemail')` |
| `outcome:no_answer` | `x.channel='call' AND x.call_outcome='no_answer'` |
| `outcome:busy` | `x.channel='call' AND x.call_outcome='busy'` |
| `outcome:wrong_number` | `x.channel='call' AND x.call_outcome='wrong_number'` |
| `outcome:no_outcome` | `x.channel='call' AND COALESCE(x.call_outcome,'')=''` |
| `outcome:talk_time` | `x.channel='call' AND x.call_outcome='connected' AND x.call_duration_s>0` |

Suporte a `channels` (filtro global multi-canal), apenas para `kind=activity`:
parse de CSV → validar cada valor contra `CHANNEL_DB` → `x.channel IN UNNEST(@channels)`.

**Precedência:** quando existe context do tipo `channel` ou `outcome`, o context é mais
específico e prevalece; não aplicar `channels` por cima (evita interseção vazia).

Corrigir o ramo `domain` de `addContext`, que hoje valida e não filtra: para
`kind=activity` + `domain:ritmo`, filtrar pelo conjunto de canais de ritmo. Nos demais
domínios a semântica vem do `kind` — deixar explícito em comentário, sem cláusula morta.

`contractVersion` sobe para `'2.3'`; `channels` passa a aparecer em `filtersApplied`.

### 2. `public/bdr-workload-v2-core.js`

`validContext()` passa a aceitar
`outcome:(connected|voicemail|dial|no_answer|busy|wrong_number|no_outcome|talk_time)`,
preservando o que já é aceito.

### 3. `public/bdr-workload-v2.js`

Cards de ligação da aba Canais, um context por card:

| Card | context |
|---|---|
| Ligações | `channel:calls` |
| Conectadas | `outcome:connected` |
| Taxa de conexão | `outcome:connected` |
| Tempo em linha | `outcome:talk_time` |
| Sem conexão | `outcome:dial` |
| Recado/voicemail | `outcome:voicemail` |

`metricContext()`: `callsConversation`→`outcome:connected`, `connRate`→`outcome:connected`,
`talkTime`→`outcome:talk_time`.

`deltaHistorical`: renderizar como texto simples, **sem botão** (delta não corresponde a
conjunto de linhas), seguindo o tratamento visual que `connRate` e `talkTime` já recebem.

`drillParams()`: propagar `channels`.

`WorkloadBDRV2.calls()`: cards Total/Conversas/Discagens/Taxa recebem `channel:calls`,
`outcome:connected`, `outcome:dial`, `outcome:connected`. Os rankings de desfecho e bucket
passam context de outcome quando o rótulo for mapeável para um `call_outcome` conhecido;
rótulo não mapeável renderiza sem clique.

Aba Evolução: usar o `kind` correto e propagar o dia quando a barra representa um dia.

### 4. `public/bdr-workload-v2-charts.js`

- `stacked()`: aceitar `opts.context` e propagar. Clique em segmento de canal envia
  `channel:<key>` do segmento clicado; clique na linha do dia mantém o context do bloco.
- `lineArea()`: aceitar `opts.context` e propagar.
- `grouped()`: cada barra abre o dia correspondente e o período correto (A ou B). Se o
  payload tiver `date`/`aDate`/`bDate`, usar; se só tiver índice, derivar de `aSince+idx`
  e `bSince+idx` — validar contra o payload real de `/api/bdr-workload-compare`.
- `ranking()`: aceitar context por linha via `opts.contextFn`.
- `waterfall()`: garantir que todos os chamadores passam context que de fato filtra.

### 5. `scripts/test-bdr-workload-v2.js`

Asserts que provam unicidade (não apenas que a query executa):

- `parseContext('outcome:connected')` devolve o objeto esperado; `outcome:foo` lança.
- SQL de `outcome:connected` contém `call_outcome` e `'connected'`; de `outcome:dial`
  contém `NOT IN`; de `outcome:talk_time` contém `call_duration_s`.
- SQL com `channels=emails,calls` contém `IN UNNEST(@channels)`.
- **Unicidade:** SQLs de `channel:calls`, `outcome:connected`, `outcome:dial` e
  `outcome:voicemail` são distintos entre si (comparar strings normalizadas).
- `outcome:*` com `kind=crm` lança 400.

## Validação obrigatória

1. `npm run check` verde (gate do projeto: `node --check` + suíte de testes).
2. Contagem real no BQ por clique, janela `2026-06-28..2026-07-27`, provando:
   `outcome:connected`=415 · `outcome:voicemail`=203 · `outcome:dial`=5163 ·
   `channel:calls`=5781 · e `415+203+5163 = 5781` (MECE fecha).
   Allan Valença: `callsConversation` deixa de devolver 708; `talkTime` devolve apenas
   conectadas com duração > 0.
3. Os quatro contextos de ligação devolvem contagens **distintas** entre si.
4. Reconciliação card × drill para conectadas, voicemail e sem conexão.

Secret para validação (carregar em silêncio, nunca imprimir valor/prefixo/comprimento):
`axenya-opencode-gsc-service-account-json-shared` → env `GOOGLE_SERVICE_ACCOUNT_JSON`.

## Restrições

- Zero regressão nos outros painéis (`npm run check` cobre).
- Sem dependências novas (`"dependencies": {}` é decisão de design).
- ES5 no `public/` (sem arrow function, sem `const`/`let`).
- SQL sempre parametrizado (`@param`); nunca concatenar valor de usuário.
- Preservar o estilo denso de `public/bdr-workload-v2.js`; diff precisa ficar legível.
- `sanitizeRow` (remove email, telefone, `contact_id`) permanece intacto.
