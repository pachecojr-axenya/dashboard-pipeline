# BDR Workload | Spec v1 — Performance intraday / weekly / monthly

> Data: 2026-07-13 | Autor: Samuel Alencar + Claude | Status: PLANNING (aprovado para implementação)
> Rota alvo: `/novo-bdr/workload` | Arquivo: `public/bdr-workload.html` | Endpoint: `/api/bdr-workload`

---

## 1. Objetivo

Dar ao gestor dos BDRs (e a cada BDR) uma visão **verdadeira e auditável** da carga de trabalho e do fluxo dia/semana/mês/quarter, respondendo:

1. **Entrada** — quantas empresas novas cada BDR inseriu vs reaproveitou do HubSpot; quantos contatos novos por empresa.
2. **Atividade** — quantos contatos foram movidos de status hoje/na semana/no mês, para onde (efetivo, perdido, qualificado) e **quem são** (drill-down nominal).
3. **Conversão** — taxas entre estágios do funil pré-reunião, por BDR, por porte, por empresa.
4. **Tempo** — quanto tempo entre criar/assumir uma empresa → primeiro toque → primeiro retorno → qualificado.
5. **Diagnóstico** — storytelling por BDR: o gargalo é montante (volume de entrada), tempo (demora para achar contato/tocar) ou confiança (cria empresa nova em vez de usar o que já existe)?

Princípio inegociável: **a soma dos pequenos tem que dar o todo** — todo KPI agregado reconcilia com a soma dos drill-downs nominais, e o dashboard expõe essa reconciliação (ver §7).

## 2. Decisões travadas (2026-07-13)

| Decisão | Escolha | Racional |
|---|---|---|
| Fonte do funil | `hs_lead_status` do contato, com histórico via `propertiesWithHistory` | É a realidade em produção (12k+ contatos com status). Spec `outbound-hubspot-first` (objeto Leads) ainda não passou o Gate 0. Camada de mapeamento de estágios isolada (`lib/bdr-funnel-map.js`) para migrar ao objeto Leads depois sem reescrever a página. |
| Motivo de desqualificação | **Fora da v1** | Propriedade não existe no portal (smoke test 2026-07-13). Entra quando a spec outbound-hubspot-first criar a enum. Card "Motivos" fica com estado vazio explícito: "propriedade pendente (Gate 0 outbound-hubspot-first)". |
| Onde vive | Subpágina nova `/novo-bdr/workload` | Zero risco de regressão no `bdr.html` validado. Segue convenções (PANELS, vercel.json, local-server). |
| "Primeiro retorno" | Transição para `CONNECTED` no histórico de status (proxy) | Funciona para todo canal e já tem histórico. Atividades reais (communications WhatsApp, calls, emails) entram como enriquecimento na v1.1. |

## 3. O que os smoke tests confirmaram (2026-07-13, API HubSpot ao vivo)

- **`hs_lead_status` — valores reais e volumes (portal inteiro):**
  `NEW` 11.226 · `CONNECTED` 462 · `IN_PROGRESS`+`OPEN` 279 · `ATTEMPTED_TO_CONTACT` 151 · `UNQUALIFIED` 134 · `OPEN_DEAL` 22 · `BAD_TIMING` 8.
  ⚠️ `NEW` é inflado por cargas de lista (Clay/integração) — "carga real de trabalho" NÃO é contagem de NEW; é movimentação de status + toques.
- **Empresas criadas desde 01/06/2026: 880** → `INTEGRATION` 866 · `CRM_UI` (manual) 14 · demais fontes 0. Na amostra de 200 mais recentes, `hs_object_source_detail_1` identifica a integração: **Apollo Integration 121 · Lusha 75 · hubspot-development-growth (app interno) 3**. ⚠️ Clay NÃO está em uso ainda (é plano futuro da spec) — a inserção hoje é o próprio BDR empurrando via extensão Apollo/Lusha.
- **Atribuição de quem inseriu:** nas criadas por integração, `hs_created_by_user_id` vem **vazio** — atribuir pelo `hubspot_owner_id` da empresa, que está preenchido em 796/880 (90%). "Empresa inserida pelo BDR" = criada no período com owner = BDR, segmentada por `hs_object_source_detail_1` (Apollo / Lusha / app interno / manual CRM_UI). **Não precisa de propriedade nova.**
- **Contatos com `hs_lead_status` criados desde 01/06: 261.** Amostra de 200: hubspot-development-growth 87 · Lusha 81 · Apollo 26 · CRM_UI 6; 166/200 com owner. **`hubspot-development-growth` = chave de API do Samuel (automações internas — criações via outras fontes), NÃO é inserção de BDR**; no dashboard aparece como fonte "API interna" separada.
- **Validação com payload real (13/07, servidor local + `/api/bdr-leads`):** 13 BDRs resolvidos; 2.316 contatos com status (7.599 sem); 304 contatos com 2+ transições; transições de HOJE reconstruídas do histórico (15 no dia: 7 ATTEMPTED→CONNECTED, 2 desqualificações, 1 bad timing, 4 entradas) com timezone SP correta. ⚠️ Gap: contatos SEM `hs_lead_status` não aparecem no endpoint atual — o `/api/bdr-workload` busca inserções por `createdate` independente de status.
- **Não existe** propriedade de motivo de desqualificação em contato. Existem `origem`, `axenya_origem_canonica` (⚠️ contaminada por backfill RH Summit — não usar para origem de evento), `bdr` (custom, **vazio em produção** — atribuição é por `hubspot_owner_id`).
- `/api/bdr-leads` já resolve o time BDR (BDR_TEAM + aliases + owners arquivados) e já puxa `propertiesWithHistory` de `hs_lead_status` em batch — é a fundação a reutilizar/estender.

## 4. Modelo do funil (mapeamento canônico v1)

```
NEW ──────────────► ATTEMPTED_TO_CONTACT ──► CONNECTED ──► OPEN_DEAL
 (na fila)             (toque feito)        (contato       (qualificado =
                                             efetivo)       deal Reunião Agendada)
        └──► UNQUALIFIED (desqualificado) / BAD_TIMING (perdido por timing)
        └──► OPEN / IN_PROGRESS (em trabalho — estados intermediários legados)
```

Mapeamento em `lib/bdr-funnel-map.js` (fonte única, consumida pelo endpoint e pela página):

| Bucket dashboard | Valores hs_lead_status | Semântica |
|---|---|---|
| Fila | `NEW` | inserido, não trabalhado |
| Em trabalho | `OPEN`, `IN_PROGRESS`, `ATTEMPTED_TO_CONTACT` | toque(s) sem retorno |
| Contato efetivo | `CONNECTED` | primeiro retorno humano |
| Qualificado | `OPEN_DEAL` | virou deal (Reunião Agendada, pipeline Vendas `782758156`) |
| Desqualificado | `UNQUALIFIED` | motivo: pendente (Gate 0) |
| Perdido/timing | `BAD_TIMING` | re-atacável no futuro |

Quando o objeto Leads entrar em produção, só este arquivo muda (mapa estágio-Lead → bucket).

## 5. Métricas (MECE, todas com recorte por BDR × período × porte)

**Períodos:** Hoje (intraday) · Semana (seg–hoje) · Mês · Quarter · custom. Timezone America/Sao_Paulo. Comparativo com período anterior equivalente em todos os cards.

**Porte:** `numero_de_colaboradores` da company associada, bucketizado (200–500 / 500–5k / >5k — espelho dos tiers T1–T3 da spec).

### 5.1 Entrada (o que o BDR alimentou)
- Empresas inseridas pelo BDR por dia/semana/mês = criadas no período com `hubspot_owner_id` = BDR, quebradas por fonte (`hs_object_source_detail_1`: Apollo / Lusha / app interno / manual CRM_UI). Push via extensão Apollo/Lusha É inserção do BDR; `hs_created_by_user_id` só existe nas manuais.
- Empresas "ativadas" (reaproveitadas): empresa já existente cujo 1º contato do BDR recebeu 1º toque no período — separa "criou do zero" de "confiou no que já tinha". **Taxa de reaproveitamento** = ativadas / (ativadas + criadas).
- Contatos novos inseridos por BDR e **contatos por empresa** (mediana e distribuição — detecta quem trabalha 1 contato por conta vs multi-threading).

### 5.2 Atividade / movimentação (o dia do BDR)
- Transições de status por dia (a partir de `statusHistory`): quantos moveu para cada bucket, hoje/semana/mês.
- Tabela nominal (drill-down): contato, empresa, porte, de → para, quando, quem — responde "quem foram essas pessoas".
- Heatmap dia-da-semana × BDR de transições (padrão de ritmo semanal: "sobe pouco no início da semana").

### 5.3 Conversão (taxas do funil)
Por coorte de entrada (contatos que entraram na fila no período — evita inflar por toque, aprendizado do CI):
- Fila → toque (`ATTEMPTED_TO_CONTACT`+) · toque → efetivo (`CONNECTED`) · efetivo → qualificado (`OPEN_DEAL`) · % desqualificado e % bad timing.
- Benchmark do time em cada taxa (linha de referência) + metas do one-pager de julho (Tx_Contato 9,4% → 11,5%).

### 5.4 Tempo (onde o tempo está indo)
- Empresa criada/ativada → 1º toque no 1º contato dela (mediana, p75).
- 1º toque → `CONNECTED` (proxy de "tempo até primeiro retorno").
- Idade da fila: contatos em `NEW`/`ATTEMPTED` há mais de N dias por BDR (estoque parado).

### 5.5 Diagnóstico por BDR (storytelling)
Card por BDR que classifica o gargalo dominante comparando as métricas dele vs mediana do time:
- **Montante** — entrada (empresas+contatos) abaixo da mediana.
- **Tempo** — entrada ok, mas tempo até 1º toque / até retorno acima da mediana.
- **Conversão** — volume e tempo ok, mas taxa toque→efetivo abaixo (mensagem/lista/canal).
- **Confiança na base** — taxa de reaproveitamento muito baixa (cria em vez de usar o que existe).
Texto gerado por regra (sem LLM na v1), com os 2 números que sustentam o veredito. É a resposta direta a "como posso ajudar cada um".

## 6. Arquitetura (API-first, sem quebrar o que existe)

### 6.1 Endpoint novo `/api/bdr-workload.js`
- Padrão dos demais: `setCORSHeaders` → `methodCheck(['GET'])` → `requireAuth` → `getHubspotToken` (helpers de `api/_helpers.js`, HTTP via `lib/hubspot.js` com retry 429/5xx).
- Pull:
  1. Contatos do time (reusar resolução de owners/aliases do `bdr-leads` — extrair para `lib/bdr-team.js` compartilhado, sem alterar comportamento do endpoint atual).
  2. `propertiesWithHistory: ['hs_lead_status']` em batch (50/req, concorrência 4).
  3. Props do contato: `createdate`, `hs_object_source_label`, `hs_object_source_detail_1`, `hs_created_by_user_id`, `hubspot_owner_id`, `associatedcompanyid`, `notes_last_contacted`, `firstname/lastname/jobtitle`.
  4. Companies em batch: `name`, `numero_de_colaboradores`, `createdate`, `hubspot_owner_id`, `hs_object_source_label`, `hs_object_source_detail_1`, `hs_created_by_user_id`.
- Resposta: contatos enriquecidos + `companies` map + `generated_at`; agregação por período é feita no front (mesmo padrão do bdr.html — permite trocar período sem novo pull).
- Cache in-memory TTL 10 min + `?refresh=1`. `maxDuration: 60` no vercel.json. Total de functions segue < 80 (Pro).
- **Qualificado:** `OPEN_DEAL` do histórico; v1.1 valida contra deals reais em Reunião Agendada (dealstage `1144746905`) para reconciliar.

### 6.2 Página `public/bdr-workload.html`
- Copiar esqueleto de `dashboard.html` (tema dark/light, Inter, Chart.js 4.4.1 + datalabels, i18n PT/EN, separador `|`).
- Registrar rota em `vercel.json` (rewrite `/novo-bdr/workload` → `/bdr-workload.html`) + `scripts/local-server.js` + bloco `PANELS` replicado nos 10 HTMLs existentes (regra primária nº 2).
- Layout: barra de filtros sticky (período · BDR · porte) → linha de KPIs → 4 seções (Entrada / Movimentação / Conversão & Tempo / Diagnóstico por BDR) → drill-down modal nominal em todo card.
- Botão "i" em cada card declarando campo de data e fórmula (padrão AUDITORIA_GRAFICOS, entra com 🟡 até validação).
- Visão dupla: toggle **Gestão** (todos os BDRs, ranking e comparativos) / **Individual** (um BDR, vs mediana do time) — mesma página, mesmo dado.

### 6.3 O que NÃO muda
`bdr.html`, `/api/bdr-leads` (apenas extração de lib compartilhada, comportamento idêntico), receita/forecast (não tocamos), auth/OAuth.

## 7. Verdade e reconciliação ("a soma dos pequenos dá o todo")

1. **Invariante de agregação:** todo KPI numérico tem drill-down nominal e o front assert-a `KPI === rows.length` (badge vermelho se divergir).
2. **Invariante de funil:** por BDR e período, `entradas = saídas + estoque` (transições que entram num bucket = saem + permanecem). Card "Reconciliação" mostra o resíduo.
3. **Smoke tests de dados** (script `scripts/smoke-bdr-workload.js`, rodável local e pós-deploy):
   - amostra 5 contatos e compara `statusHistory` do endpoint com o registro no HubSpot UI (link `urlTemplate`);
   - confere total por status vs busca direta na Search API;
   - confere empresa CRM_UI vs INTEGRATION numa amostra;
   - valida timezone (transição de hoje 20h UTC não pode cair em "amanhã").
4. **Limitações declaradas na UI** (não escondidas): motivo de desqualificação indisponível; `NEW` inflado por cargas de integração (por isso carga = movimentação, não estoque); ligações/e-mails mal registrados não aparecem (v1 usa status como proxy); `axenya_origem_canonica` não confiável para origem de evento; ~10% das empresas recentes sem owner (não atribuíveis a BDR — mostrar como "sem dono"); origem do app interno `hubspot-development-growth` pendente de mapeamento (F1).

## 8. Fases

| Fase | Entrega | Gate |
|---|---|---|
| **F1** | `lib/bdr-team.js` + `lib/bdr-funnel-map.js` + `/api/bdr-workload` + smoke script | smoke tests passam local (`LOCAL_DEV_BYPASS=true`, porta 3002) |
| **F2** | `bdr-workload.html` completo (Entrada/Movimentação/Conversão/Tempo) + PANELS + rotas | validação visual local + reconciliação sem resíduo |
| **F3** | Diagnóstico por BDR + visão Individual + comparativo período anterior | review do gestor com dados reais |
| **Deploy** | preflight (`node scripts/preflight-deploy.js`) → `npm run deploy` → curl prod + `/api/bdr-workload` retorna 401 sem auth | STATUS_LOG.md + AUDITORIA_GRAFICOS.md atualizados |
| **v1.1 (backlog)** | Atividades reais (communications WhatsApp via Treble, calls, emails) como camada sobre o proxy CONNECTED; motivo de desqualificação quando Gate 0 da spec criar a enum; migração ao objeto Leads via `bdr-funnel-map` | — |

## 9. Referências

- Fundação atual: `api/bdr-leads.js`, `public/bdr.html`, `STATUS_LOG.md`, `DEPLOY_GUIDE.md`, `AUDITORIA_GRAFICOS.md`
- Spec do funil futuro: `openspec/changes/outbound-hubspot-first/` (vault)
- Metas: `20_Company/Sales/BDR_Metas_Math_Tree/2026-07-08/ONE_PAGER_META_21_BDR_JULHO.md` (vault)
- Captura WhatsApp: `15_Workspaces/Treble_HubSpot_Realtime/docs/ARCHITECTURE.md` (vault)
