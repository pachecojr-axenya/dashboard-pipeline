# Growth Performance | `/growth/performance`

Acompanhamento de mídia paga: quanto foi gasto, quantos leads vieram, a que custo
e de quem. Spend vem **ao vivo** das APIs das plataformas; lead vem do HubSpot.

| Item | Onde |
|---|---|
| Página | `public/growth-performance.html` + `public/growth-performance.js` |
| Endpoint | `api/growth-performance.js` |
| Clientes de spend | `lib/ads.js` |
| Semântica de atribuição | `lib/growth-attribution.js` |
| Teste de contrato | `scripts/test-growth-performance.js` (roda no `npm run check`) |
| Smoke funcional | `scripts/smoke-growth-performance-browser.js` (`npm run smoke:growth-perf`) |
| Rota | `vercel.json` **e** `scripts/local-server.js` (duas tabelas, ver armadilha 5) |

## 1. O que a página responde

- Gasto de mídia paga no dia, na semana e no mês, por canal e por campanha.
- Leads gerados por canal (LinkedIn, Meta), separando **pago** de **orgânico**.
- CPL, custo por empresa, CPM, CPC, CTR.
- Cortes do lead pago por cargo, senioridade, área, porte da empresa e setor.
- Diferenciação por iniciativa | campanha (webinar tal, pesquisa tal, observatório).

Toda métrica tem `i` com memória de cálculo e todo número abre drilldown com os
leads que o compõem.

## 2. Decisões de dado (medidas em 2026-08-06)

### 2.1 A origem nativa do HubSpot não serve

`hs_analytics_source` está em `OFFLINE` em **9.321 de 9.321** contatos criados desde
01/05/2026, com `hs_analytics_source_data_1 = INTEGRATION` em 8.539 deles: todo
contato nasce por API (rotas do site, Apollo, prospector). O objeto Lead (`0-136`)
repete o padrão — `hs_lead_source` em `OFFLINE` em 5.760 de 5.842.

`axenya_origem_canonica` também está fora: o backfill do RH Summit colou "stand" em
contato de Apollo por dono (ver memória `ci-origem-canonica-backfill-apollo`), e no
período medido só aparece como `outbound_bdr` e `evento_rh_summit_*`.

**Fonte de canal = `utm_source` do contato**, gravado pelas rotas do site
(`revenue-website/src/app/api/hubspot/*/route.ts`). É a mesma informação que o
alerta de `#hb-sales-alerts` imprime como "UTM: linkedin / social".

### 2.2 CPL usa só lead pago

`utm_medium` separa pago de orgânico dentro do mesmo canal. Em julho/2026 o
LinkedIn trouxe 38 leads no canal, mas só 11 com medium pago:

| Denominador | CPL LinkedIn julho |
|---|---|
| 11 leads pagos (regra adotada) | R$ 403,16 |
| 38 leads do canal | R$ 116,70 |

Dividir por 38 subestima o CPL em 3,5×. A página mostra os dois (`CPL pago` e
`CPL canal`) e o bloco de higiene explica a diferença quando ela é grande.

### 2.3 Coorte por data de criação

O UTM do contato é **last-touch-com-UTM**: as rotas só escrevem o campo quando o
valor chega preenchido, então um preenchimento posterior com UTM diferente
sobrescreve. A coorte é pela data de criação do contato, em `America/Sao_Paulo`
(portal e contas de anúncio estão nesse fuso). A imprecisão residual é declarada
em `coverage`, nunca escondida.

### 2.4 Join campanha de anúncio × `utm_campaign`

Não existe chave comum: a plataforma se chama
`META | P0 | MoFu | Pesquisa RH CONARH 26 | 2026-07` e o site marca
`pesquisa_rh_conarh26_2026_07`.

**Pareamento por sobreposição de tokens foi implementado, testado e descartado.**
Dois defeitos reais:

1. **Spend duplicado** — `webinar_reajuste` e `reajuste-plano-saude-webinar`
   casavam com a mesma campanha e cada uma recebia os R$ 2.790,59 inteiros.
2. **Match falso** — `pesquisa_rh_conarh26_2026_07` colou em
   `LI | ... | Webinar 2026-07 | Ad Set B` com score 0,5, só por compartilhar os
   tokens de data e `rh`.

O que ficou: as duas pontas passam pelo **mesmo classificador de iniciativa** e o
join é por `(canal, iniciativa)`. Anúncio cujo nome não carrega o token da
iniciativa entra em `INITIATIVE_OVERRIDES` pelo nome exato.

> **Correção durável, pendente do lado da operação de mídia:** batizar a campanha
> de anúncio com o mesmo slug usado em `utm_campaign`. Aí o join deixa de precisar
> de regra e o `INITIATIVE_OVERRIDES` pode morrer.

### 2.5 Cobertura conhecida (julho/2026)

| Campo | Cobertura |
|---|---|
| `utm_source` | 108 de 5.557 contatos do período |
| `jobtitle` | 98% dos leads com UTM |
| company associada | 94% |
| `porte` da company | 63% |
| `industry` da company | ~15% |

A fatia sem UTM é esperada (prospecção de BDR e importação de lista nascem sem
UTM) e não é defeito. `industry` tem cobertura baixa o suficiente para o corte por
setor ser ilustrativo, não conclusivo.

## 3. Armadilhas técnicas (não regredir)

1. **LinkedIn exige `LinkedIn-Version: 202503`.** Versões 202406+ devolvem
   `426 NONEXISTENT_VERSION`.
2. **`dateRange` do LinkedIn é objeto REST.li literal na querystring**, não JSON:
   `(start:(year:2026,month:7,day:1),end:(...))`. O fim é inclusivo.
3. **Nome de campanha do LinkedIn só sai em
   `/rest/adAccounts/{id}/adCampaigns?ids=List(123,456)`** — o caminho antigo
   `/rest/adCampaigns` devolve 400 pedindo o account id no path, e os ids são
   **numéricos**: passar URN dá `NumberFormatException`.
4. **O access token do LinkedIn expira em 60 dias.** `lib/ads.js` renova sozinho no
   401 `EXPIRED_ACCESS_TOKEN` usando o refresh token e guarda o novo no KV. Sem
   isso o painel quebraria silenciosamente a cada 2 meses.
5. **Rota nova precisa entrar em DOIS lugares:** `vercel.json` (produção) e a
   tabela `REWRITES` de `scripts/local-server.js` (local). Só o primeiro dá 404 no
   servidor local.
6. **Menu tem duas fontes:** `public/nav.js` e o `NAV_MODEL` de `public/premium.js`.
   As páginas Growth montam o menu por `premium.js`, então mudança de menu exige
   subir o cache-buster (`premium.js?v=N`) em **toda** página que o usa — inclusive
   `public/bdr.html`, que tem 3 bytes NUL e por isso é **invisível para o `grep`**
   (editar em bytes com Python, nunca `sed`). `scripts/test-bdr-workload-v2-ui.js`
   fixa a versão esperada de propósito.
7. **Meta pagina `/insights`**; sem seguir `paging.next` o mês vem truncado.
8. **Campanha pausada continua acumulando spend residual** — nunca tratar
   "pausado" como R$ 0.
9. **Canal sem spend conectado devolve `null`, nunca `0`.** "R$ 0,00 por empresa"
   leria como eficiência infinita quando o correto é "não medido".

## 4. Variáveis de ambiente

| Var | Origem (GCP Secret Manager) |
|---|---|
| `META_ADS_TOKEN` | `meta_token_ads_management` |
| `META_AD_ACCOUNT_ID` | `act_1348847725589056` (conta "Axenya", BRL) |
| `LINKEDIN_AD_ACCOUNT_ID` | `518843783` (conta "Axenya", BRL) |
| `LINKEDIN_CLIENT_ID` | `linkedin_client_id` |
| `LINKEDIN_CLIENT_SECRET` | `linkedin_client_secret` |
| `LINKEDIN_REFRESH_TOKEN` | `linkedin_refresh_token` (validade ~1 ano) |
| `LINKEDIN_ACCESS_TOKEN` | `linkedin_access_token` (bootstrap; renova sozinho) |

Google Ads **não** está conectado. A página mostra o canal como "não conectado" em
vez de R$ 0, para não parecer que não houve gasto.

## 5. Backfill de meses anteriores

Não precisa de ETL: Meta e LinkedIn servem histórico por range nativamente. Basta
escolher o período na barra (presets `Mês passado`, `2 meses atrás`, `Ano até hoje`
ou datas livres). Validado em 2026-08-06:

| Período | Spend | Leads pagos | CPL |
|---|---|---|---|
| mai/2026 | R$ 5.364,66 | 39 | R$ 137,56 |
| jun/2026 | R$ 12.490,45 | 60 | R$ 208,17 |
| jul/2026 | R$ 9.656,38 | 66 | R$ 146,31 |
| 01–06/ago/2026 | R$ 0,00 | 0 | — (nada rodando) |

## 6. Cache

Memória por instância + KV, TTL 15 min por range. `?refresh=1` (botão "Sem cache")
força nova busca. Erro em um canal não derruba o outro: vira entrada em
`spend.erros` e a UI diz qual canal falhou, em vez de mostrar R$ 0.

## 7. Validação

```bash
npm run check                    # inclui test-growth-performance.js
npm run smoke:growth-perf -- --base-url=http://localhost:3007 --from=2026-07-01 --to=2026-07-31
```

O smoke abre Chrome headless e exige: 4 KPIs hero, ≥10 `i` de memória de cálculo,
cards de canal, barras na série, drilldown de KPI com leads dentro, drawer de
fórmula, clique na barra abrindo o período, troca de granularidade redesenhando a
série, bloco de higiene presente e **console sem erro**.

Dois defeitos foram encontrados por esse smoke e corrigidos:

- **Resposta atrasada sobrescrevia a nova** — a carga inicial usa o mês corrente e
  o usuário troca de período antes dela voltar; a resposta antiga chegava depois e
  repintava a tela com o período errado. Corrigido com guarda de sequência
  (`reqSeq`) em `load()`.
- **Colisão de atributo** — o hook de teste `data-gran` em `#content` roubava o
  `querySelector` dos botões de granularidade. Renomeado para `data-gran-atual`.
