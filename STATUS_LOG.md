# Dashboard Enhancement Loop — Status Log

### 🚀 DEPLOY DE PRODUÇÃO | BDR Workload v2 — fallback live A×B e correção visual KPI (2026-07-21)

- Causa raiz: a aba Evolução A×B usa `/api/bdr-workload-compare`, que lia somente BigQuery; quando a janela B continha hoje antes do snapshot Gold existir, B ficava zero embora o Pulso tivesse live do HubSpot.
- Compare v2 agora aplica fallback live agregado via `_service.liveRowsForToday`, sem PII, apenas para `domain=ritmo` quando A ou B contém hoje e a linha BQ de hoje está ausente/zerada. Linhas históricas anteriores do mesmo período são preservadas; linhas BQ zeradas de hoje são removidas antes do live. CRM/SQL/inserção não recebem zeros inventados; fim de semana com `businessDays=true` não aplica fallback.
- Filtros dimensionais `porte`/`segmento`/`persona` bloqueiam o fallback live por ausência de dimensão no agregado live; `source`/`quality` indicam `liveFallbackUsed` e mensagem honesta.
- CSS dos KPIs v2: `.v2-kpi-main` transparente, sem borda, largura 100%, cor herdada, texto à esquerda e foco visível em turquesa.
- **PR/merge:** PR `#11`, merge `d88b988` (`8c7822e` funcional).
- **Deploy canônico:** `dpl_H6Bn8kBikbemJsZszUK9o9B2J8pU` (READY), aliases `https://axenya-pipeline-dashboard.vercel.app` e `https://project-bsmfu.vercel.app`.
- **Evidências:** check `2bb566c14898b97e476f69883c72a251fc06d5b64ceb8a4ba92b8fec5e9ceaef`; predeploy `f5098c54366490e4521579cdb82a1463eddae3327fc85e9a74afef74e4f71884`; deploy `40072f3ec728a7212a092432664501b14957a175c627edbe78214a373c028914`; smoke público `974569c0c0a40fb77c614411f70a41cb89aab4ab02e8edbfd33f2c0bc518e0bc`.
- **Pós-deploy:** sete rotas críticas = 200; módulos core/charts/main e CSS KPI ativos; APIs sem sessão = 401 esperado. Smoke autenticado de dados permanece dependente de sessão Google do usuário.

---

### BDR Workload v2 | backlog residual implementado e publicado (2026-07-21)

- Território restrito ao Workload v2; publicado pelo PR `#11`.
- Canais: período anterior equivalente agora usa a mesma duração da janela atual e aparece no card; memória de cálculo atualizada.
- Drill: buckets agrupados `2–3` e `4–5` aceitos ponta a ponta com allowlist estrita e query parametrizada; buckets exatos preservados.
- Gate browser: novo smoke CDP zero-dependency em Chrome headless, por restrição de supply chain, cobrindo cinco abas, drawer, drill e console errors; integrado como script npm e syntax check. O smoke público pós-deploy passou; a execução autenticada das cinco abas depende de sessão Google.
- Modularização: core/utilitários e charts/renderers separados em arquivos ES5 estáticos; `WorkloadBDRV2` público preservado no arquivo principal.
- Compatibilidade: v1 preservado em `?workload=v1`; feature flag/fail-closed e ordem explícita de scripts mantidas.

---

### 🚀 DEPLOY DE PRODUÇÃO | BDR Workload v2 — cinco visões auditáveis (2026-07-20)

- **PR/merge:** PR `#9`, merge `fd7fc4a`; fix de fixture determinística em `c5526a7`.
- **Deploy canônico:** `dpl_GFgmPDma6Mxo8rFiYUTNKJcirQH2` (READY), aliases
  `https://axenya-pipeline-dashboard.vercel.app` e `https://project-bsmfu.vercel.app`.
- **Experiência v2:** cinco abas — Pulso & Reatividade, Atividades & Canais, Gestão
  por BDR, Penetração & ICP e Evolução A×B. Metas foram removidas da v2; fallback
  v1 preservado em `?workload=v1`.
- **Dados:** hoje usa HubSpot live agregado no servidor; histórico usa
  `gold.bdr_daily_ops`; penetração usa snapshot observado da CI; A×B reconcilia por
  invariante. Reatividade, CRM, segmento e persona ficam indisponíveis onde não há
  fonte auditável.
- **Segurança:** `BDR_FLAG_WORKLOAD_V2` fail-closed e habilitada explicitamente em
  produção; APIs autenticadas; payload agregado sem PII; drill nominal de ligações
  paginado em no máximo 50 linhas.
- **Evidências:** unit `1a5de3eb49babd077b1252e8490f59d06f0dd961c46d65b6d35e5f124625b9ea`;
  full check `08c33410f059c4e41921ae14666f20a646cb6cbd3759abdc171c34a2b8162210`;
  predeploy `011251c9d0a343c36eb50ca6993415b57970c3917e8ca1d8be1d2d89110f3afd`;
  deploy `eba766dd770402e9dd01e227aa0892719c941a510ee5f49588524eb22916cb3d`.
- **Pós-deploy:** sete rotas HTML críticas + asset v2 = 200; quatro APIs v2 sem
  sessão = 401 esperado; HTML/JS live confirmam cinco abas, config gate e fallback.
- **Quality gates:** reviewer code = PASS 9/10; experiment-skeptic = PASS com
  ressalvas não bloqueantes. Penetração permanece experimental e A×B com hoje é
  rotulado como comparação parcial não equivalente.

---

### 🚀 DEPLOY DE PRODUÇÃO | Forecast Delta — Visão Unificada por Etapa = funil completo + avançou×perdido (2026-07-20)

> Decisão do dono: mesmo com o filtro geral em Ativos, a Visão Unificada por Etapa
> deve contar TODAS as etapas do funil e distinguir o que saiu por avançar do que foi
> perdido.

- `stageUnified` passa a contar **todas as etapas do funil** independente do
  Ativos/Tudo: no app (com escopo) computa sobre o conjunto `tudo` (+filtro AE/Quarter);
  waterfall/KPIs/funil/quarters continuam no escopo. Sem escopo (legado/testes):
  inalterado (invariante Σ=headline preservado).
- Movimento por etapa agora distingue **avancou** (saiu p/ etapa posterior, via `_RANK`,
  inclui Ganho/Implantação), **regrediu**, **caiuPerdido** (Perdido) e **saiuOutro**.
- Drill de etapa (`stage:`) usa o funil completo no app; `quarter:`/`kpi:` seguem no escopo.
- UI: coluna "Novo / Avançou / Perdido", etapas sem atividade ocultas, nota da seção.
- **Deploy:** commit `5ea9a46` (branch `pacheco/delta-stage-table-full-funnel-2026-07-20`,
  ff sem force) | deployment `dpl_FR3SRBeMR4ZzpwZ5t5baUzFABqxW` (READY). `npm run check` verde.
- **Pós-deploy ao vivo (scope=ativos):** waterfall = Cotação/Consultoria/Negociação;
  stageUnified = funil completo (Reunião→Implantação) com avançou > 0. Rotas 200, auth 401.

---

### 🚀 DEPLOY DE PRODUÇÃO | BDR Workload — inteligência avançada de coorte (2026-07-20)

- **PR/merge:** PR `#8`, merge `7eaf0a8`.
- **Deploy canônico:** `dpl_3U8NAj5kudSCqQKFK1bDwZYLAZhr` (READY), alias
  `https://axenya-pipeline-dashboard.vercel.app` reatribuído explicitamente.
- **Novas views BQ:** `vw_dash_bdr_cohort_base_v1`,
  `vw_dash_bdr_effort_sql_v1`, `vw_dash_bdr_penetration_v1` e
  `vw_dash_bdr_sql_by_porte_v1`, todas no grão Company×BDR e com
  `is_valid_ts=TRUE`.
- **Novas visões:** associação observacional esforço→SQL, penetração observada por
  empresa/contato e conversão por porte, sempre com tamanho da amostra, IC95% e
  bucket desconhecido.
- **Guardrails:** conversão nunca usa toque como denominador; correlação não é
  causal; esforço conta até a data do SQL; janela mínima de 30 dias; payload sem PII.
- **Freshness + automação:** `fact_touch` foi reconstruída sobre `interaction` atual;
  coortes com Company vão até `2026-07-13` (a interação bruta vai até 20/07). Scheduled
  Query `ci-fact-touch-daily` (`6a60b9a3-0000-27ae-8cc3-ac3eb14583d8`) roda diariamente
  às `10:30 UTC` (`07:30 BRT`) via `bdr-etl-runner`; primeira execução `SUCCEEDED`.
  A UI mostra a data máxima e usa janela histórica equivalente/expandida sem fingir realtime.
- **Evidências:** tests `b8bfe03c3a12b811bb9aac6054d2c6fb617fe38ec5392ee5652176c521cbaf48`;
  build `feaa7b47c6f93fed1ae88274cacab6a62cc041d20ad0359498b337a106fb3da5`;
  smoke real `4307b30d95ba75a1c518ca0678641cb90707c71e748e2827dbf6ae93df19637b`;
  predeploy `677fa6952d8877d0c7aca430020b875672617fc683b2dbec16fc2d9a532cc046`.
- **Pós-deploy:** HTML serve `bdr-workload.js?v=8`; JS live contém as três visões;
  7 rotas mínimas = 200; APIs sem sessão, inclusive cohort analytics, = 401.

---

### 🚀 DEPLOY DE PRODUÇÃO | Forecast Delta — "Ativos" deixa de incluir Diagnóstico (2026-07-20)

> Decisão do dono: no Comparativo, o escopo "Ativos" deve considerar só
> Cotação/Consultoria/Negociação; Diagnóstico só no "Tudo".

- `DELTA_ACTIVE_STAGES` = `['Cotação','Consultoria','Negociação']` (era com Diagnóstico);
  `deltaScopeStages('ativos')` idem. Ajustados rótulo/tooltip do toggle, caveat da API
  e o teste `test-forecast-delta-scope.js`. Bid/Standby seguem fora dos dois modos.
- **Deploy:** commit `d4736c1` (branch `pacheco/delta-ativos-sem-diagnostico-2026-07-20`,
  ff sem force) | deployment `dpl_4pCcyomLLXRgfEXu6cejvaUb4Mi5` (READY). `npm run check` verde.
- **Pós-deploy ao vivo:** 7 rotas 200, auth 401. `compare` scope=ativos → funil
  Cotação/Consultoria/Negociação; scope=tudo → inclui Diagnóstico/Reunião/Ganho/Implantação.

---

### 🚀 DEPLOY DE PRODUÇÃO | BDR Workload — visões P0/P1 + BigQuery Gold (2026-07-20)

- **PR/merge:** PR `#7`, merge `696ba61` (`31ea06b` funcional).
- **Deploy canônico:** `dpl_4sHkaX7UEpR31nn2swxhf4ziUVhP` (READY), alias
  `https://axenya-pipeline-dashboard.vercel.app` reatribuído explicitamente.
- **Dados:** histórico passou a ler `gold.bdr_daily_ops`; metas vigentes vêm de
  `gold.bdr_daily_target`; total real é a soma MECE dos cinco canais. Cíntia é
  consolidada por nome canônico apesar dos dois owner IDs.
- **Visões:** Pulso Executivo, tendência com média móvel 7d, comparativo de canais,
  ranking ordenável com metas/deltas, quality checks API×BQ e waterfall por BDR.
- **Correções críticas:** removida leitura da coluna inexistente
  `bdr_daily_ops.bdr_daily_target`; timestamps BQ aceitam epoch decimal/científico;
  asset atualizado para `bdr-workload.js?v=7`.
- **Evidências:** testes `6bdbc44f9c3c8af3ecd65c8d9541ec661d3c0d046036cab0c75aede6033947a2`;
  build `713598592aaac66f2b651f20ce3c0494b86072e22dd8d8d2a2aa950bcc0fa0bc`;
  smoke local HubSpot+BQ `3544ad9e32577a508b993cc91bfb7b8ac1ced17d5427bb646b093e85a50bd060`;
  predeploy `8137ea7af2956a9823d6de99f2449210dec97a19a936933269b71b6ca4a3e265`.
- **Pós-deploy:** 7 rotas mínimas = 200; APIs sem sessão = 401; HTML serve `v=7`;
  JS live contém quality checks, waterfall, níveis 0/1/2, média móvel, comparativo
  de canais e metas BQ.

---

### 🚀 DEPLOY DE PRODUÇÃO | Forecast — 3º fallback de ARR por VPV (Diagnóstico/Cotação/Consultoria/Negociação) (2026-07-20)

> Pedido do Pacheco: o ARR desses deals precisa ser CALCULADO (não só a projeção de
> caixa) — deals de Cot/Cons/Neg sem 1ª Fatura ficavam com ARR "—".

- Derivação do ARR ganhou 3º nível: `arr_estimado` → `1ª Fatura × 12` →
  **`(vidas||colaboradores) × VPV × 12`** (faixas 36/24/12) nas etapas Diagnóstico/
  Cotação/Consultoria/Negociação → senão "—".
- Aplicado espelhado em `api/forecast-table.js` (coluna "ARR Est." do `/forecast`) e
  `lib/forecast-compute.js` `mapFotoDeal` (KPIs ARR Total/Ponderado do `/forecast-delta`).
- Deals com `arr_estimado`/`1ª Fatura`: inalterados. "Fatura Atual" não entra.
- **Deploy:** commit `132a16a` (branch `pacheco/forecast-arr-vpv-fallback-2026-07-20`,
  ff sem force) | deployment `dpl_44uCQ4Q84cNP2bHj9WPiMc4xi51C` (READY, production).
  `npm run check` verde.
- **Pós-deploy validado ao vivo:** 7 rotas 200, `/forecast-delta` 200, `/api/auth/me`
  401. `/api/forecast-table`: 59 deals passaram a ter ARR via VPV, matemática conferida
  (EPTV 1653→476.064; EagleBurgmann 200→86.400; Grupo Malwee 6300→907.200).
- Doc: `docs/forecast-revenue-rules.md` seção 2b.

---

### 🚀 DEPLOY DE PRODUÇÃO | Forecast — fallback vidas×VPV em Cotação/Consultoria/Negociação sem 1ª Fatura (2026-07-20)

> Pedido do Pacheco: deal aberto de Cotação+ sem 1ª Fatura não deveria ficar
> invisível no forecast — deveria cair na régua de VPV (12/24/36 por vida).

- **Motor único** (`public/forecast-engine.js`, `dealMonthly`): em Cotação/Consultoria/
  Negociação, quando a régua da 1ª Fatura não produz receita (tipicamente 1ª Fatura
  vazia), o deal cai em `(vidas||colaboradores) × VPV` (faixas 36/24/12) com o
  **delay/piso do Diagnóstico** (9/14/18m + piso na referência), recorrente,
  **probabilizado pela prob da própria etapa** (não os 6% do Diagnóstico).
- Deals **com** 1ª Fatura: inalterados (régua exata). Vale em **todos os painéis** que
  usam o motor: `/forecast`, `/forecast-stage`, `/forecast-delta`.
- Efeito: deals de Cot/Cons/Neg antes zerados (ex.: EPTV, CONSORCIO) passam a
  contribuir → totais do forecast sobem. A coluna "ARR Est." segue vinda do campo
  (não muda com o fallback — afeta só a projeção de caixa).
- Escopo/detalhe decididos com o dono (escopo Cot/Cons/Neg; início/prob = recomendação).
- Doc canônico atualizado: `docs/forecast-revenue-rules.md` (+ comentário do engine).
- **Deploy:** commit `3624768` (branch `pacheco/forecast-vpv-fallback-cot-cons-neg-2026-07-20`,
  ff sem force) | deployment `dpl_FruDMAHs2yGKBxgJHY8zfkP9vWTF` (READY, production).
  `npm run check` verde (gate completo do CI).
- **Pós-deploy:** 7 rotas mínimas 200, `/forecast-delta` 200, `/api/auth/me` 401,
  `compare` ao vivo com invariante Σ Δ = Δtotal ✓.

---

### 🚀 DEPLOY DE PRODUÇÃO | Forecast Delta — polish de CSS (menu sticky em 2 linhas + dropdowns frosted-glass + remoção card TCV) (2026-07-20)

> Feedback do Pacheco no visual: mover toggles + seletores de foto pro menu sticky;
> usar a mesma paleta/efeitos das outras páginas; remover o card TCV 12M da foto de hoje.

- Topbar sticky em 2 linhas: topo (hambúrguer + panel-switcher "Comparativo" + filtros
  Executivo/Quarter + ações) e linha de controles (Foto A/B + Medida/Horizonte/Escopo +
  Capturar). O card de controles separado foi removido — tudo fixo no topo ao rolar.
- Dropdowns de filtro com efeito frosted-glass (`backdrop-filter: blur` + animação
  `fddIn`), espelhando o `panel-dd`/filtros das outras páginas.
- `renderTodaySnapshot`: removido o card "TCV 12M ponderado".
- Só `public/forecast-delta.html` (HTML/CSS/JS); backend inalterado.
- **Deploy:** commit `d203f62` (branch `pacheco/forecast-delta-ui-polish-2026-07-20`,
  integrada em main por ff sobre os commits do Samuel, sem force) | deployment
  `dpl_CqSk6xnnDgHB1nuxu9UJoAWZr6Jw` (READY, production). Inline-JS check verde + delta e2e/leva2.
- **Pós-deploy:** 7 rotas mínimas 200, `/forecast-delta` 200, `/api/auth/me` 401.

---

### 🚀 DEPLOY DE PRODUÇÃO | BDR Treble Storytelling with Data V2 (2026-07-20)

- Commit `8de1307` promovido por fast-forward para `main` e publicado no projeto
  Vercel canônico `dashboard-axenya`.
- Deployment `dpl_3UxaFRRHLHDBM5t8SvpLXPG7qMvQ` ficou `READY` e assumiu os aliases
  `axenya-pipeline-dashboard.vercel.app` e `project-bsmfu.vercel.app`.
- Entregue: filtros Hoje/Ontem/7d/30d/90d/custom, atribuição direta/inferida de
  agente, ranking “Quem tentou enviar”, composição total/% por status bruto,
  headline narrativa, funil com deltas, timeline acessível e Arquitetura API V2.
- Build/deploy PASS: evidência SHA-256
  `1b38abfb3e24064e9ba8fe90c44e2c8d75fe49a409d6a1e67955243f76f17383`.
- Smoke produção PASS: 8 rotas 200, HTML/asset V2 ativos, APIs sem sessão em 401 e
  variáveis DW presentes. Evidência SHA-256
  `cb5c1d2b4677599c3cb4aa7b49dd348ab33a8d059c78492763b4df73aebacebc`.

---

### 🚀 DEPLOY DE PRODUÇÃO | Forecast Delta — drawer + topbar sticky + toggles seg-ctrl + loading + filtros Executivo/Quarter (2026-07-20)

> Pedidos do Pacheco: menu drawer esquerdo no /forecast-delta; visual aid de
> carregamento; CSS dos toggles igual ao dashboard geral; header sticky; e filtros
> multiselect de Executivo e Quarter no topo (como no /forecast).

- **Shell:** menu drawer esquerdo via `/nav.js` (mesmo das outras páginas) + topbar
  sticky (hambúrguer + panel-switcher "Comparativo"), docking em telas largas,
  glue global (`closeDrawer`/`toggleDrawer`/`toggleTheme`/`logout`), estado em
  `localStorage`. Espelha o shell canônico do `forecast-stage.html`.
- **Toggles:** migrados do `.tab-sub` local para o segmented control canônico
  `.seg-ctrl`/`.seg-btn` (pill deslizante) — Medida/Horizonte/Escopo/ARR-quarter.
- **Loading:** spinner durante o `compare`.
- **Filtros Executivo + Quarter (multiselect)** no topo, classes `.fdd`/`.custom-cb`
  do `/forecast`. Server-side aditivo/retrocompatível: `/api/history` `compare` e
  `compare-drill` aceitam `ae`/`q` (além de `scope`) e retornam `filters` (opções).
  `lib/forecast-compute`: `mapFotoDeal` ganhou `executivo`; novos
  `deltaFilterOptions`/`applyAeQuarterFilter`. Waterfall/KPIs/funil/tabela respeitam
  o filtro; invariante Σ Δ = Δtotal preservado.
- **Deploy:** commit `4d45b03` (branch `pacheco/forecast-delta-ui-drawer-2026-07-20`,
  integrada em main por ff sem force) | deployment `dpl_HMAPv21Y4UtbthVL48TwZaVvHPui`
  (READY, production). `npm run check` verde (inclui `_check-inline-js` do
  forecast-delta + e2e/leva2).
- **Pós-deploy validado:** 7 rotas mínimas 200, `/forecast-delta` 200, `/nav.js` 200,
  `/api/auth/me` 401. Recurso ao vivo: `compare` retorna `filters` (6 execs, 7 quarters),
  filtro `ae` reduz o conjunto (113→1 num AE), invariante ✓.
- Sem sobreposição de arquivos com a sessão paralela do Samuel.

---

### BDR | Treble Storytelling with Data V2 local (2026-07-20)

> Implementação local, sem commit/push/deploy, para evoluir `/novo-bdr/treble` com filtros de data BRT, atribuição de agente, quebras por status e narrativa executiva.

- `/api/bdr-treble-dw`: contrato V2 com `preset=today|yesterday|7d|30d|90d|custom`, custom inclusivo validado (máx. 90 dias), `dateRange`, `LEFT ANY JOIN` com `dim_agents` sem email/PII e payload sanitizado sem `origin_id`.
- Atribuição de agente: direta por `origin_id = dim_agents.id` quando houver match; inferência por nome do flow canonicalizada para nomes completos dos agentes ativos; `origin_id=59580` segue não tratado como pessoa.
- Status bruto preservado: `statusLabel`/`statusGroup` representam o raw status; resposta pode implicar entrega no funil, mas não pinta falha como verde nem renomeia o status.
- Frontend V2: headline dinâmica, hero Tentativas, KPIs secundários, funil Tentativas→Entregues→Respondidas com deltas, composição 100% por status, ranking “Quem tentou enviar”, timeline SVG acessível e Arquitetura API com contrato/cobertura.
- Fallback REST normalizado para shape V2 e explicitado como “Fallback REST | últimos 30 dias”; erros 400 de intervalo custom inválido mostram erro humano e não caem silenciosamente para fallback.
- Testes ampliados em `scripts/test-bdr-treble-dw.js` e smoke browser V2 atualizado em `scripts/smoke-bdr-treble-dw-browser.js`.

---

### 🚀 DEPLOY DE PRODUÇÃO | Forecast Delta — toggle "Escopo: Ativos/Tudo" + remoção de Bid/Standby (2026-07-20)

> Pedido do Pacheco: o comparativo do `/forecast` deve ignorar Bid e Standby e ter
> um toggle geral Ativos/Tudo, com Ativos (padrão) considerando só
> Diagnóstico/Cotação/Consultoria/Negociação.

- Novo parâmetro `scope=ativos|tudo` em `/api/history?action=compare` e
  `compare-drill`. **Aditivo/retrocompatível**: sem `scope`, mantém o toggle legado
  `includeClosedStages` — por isso `test-forecast-delta-e2e`/`leva2`/`delta-invariant`
  seguem verdes.
- `lib/forecast-compute.js`: `applyDeltaScope`/`deltaScopeStages`/`deltaRowInScope`.
  Remove **sempre** pipeline Bid e etapa Standby. `ativos` = Diagnóstico, Cotação,
  Consultoria, Negociação; `tudo` = todas menos Bid/Standby/Perdido (inclui Reunião
  Agendada + Ganho + Implantação).
- Waterfall, funil e tabela por etapa alinhados ao escopo; invariante Σ Δ = Δtotal
  preservado (linhas fora do escopo são zero).
- `public/forecast-delta.html`: o toggle "Implantação/Ganho" virou o toggle geral
  **"Escopo: Ativos | Tudo"** (padrão **Ativos**).
- Teste novo `scripts/test-forecast-delta-scope.js`.
- **Deploy:** commit `0e191dc` (sobre `c18c1bc` do Samuel, ff sem force) |
  deployment `dpl_CLvj9cm3ijxS1geUT9Pd1rwFXatW` (READY, production).
- **Pós-deploy validado:** 7 rotas mínimas 200, `/forecast-delta` 200,
  `/api/auth/me` 401. Escopo confirmado ao vivo: `ativos`→funil 4 etapas,
  `tudo`→7 etapas, ambos sem Bid/Standby, invariante ✓.
- Sem sobreposição de arquivos com a sessão paralela do Samuel (interseção vazia
  vs `origin/main`).

---

### 🚀 BDR | Treble ClickHouse real em produção (2026-07-20)

- Commit canônico `c18c1bc` promovido por fast-forward para `main` e publicado no
  projeto Vercel `dashboard-axenya`.
- Deployment `dpl_H1MPDKa67hi2TwSxQUdfckx6315S` ficou `READY` e assumiu os aliases
  `axenya-pipeline-dashboard.vercel.app` e `project-bsmfu.vercel.app`.
- As cinco variáveis `TREBLE_WAREHOUSE_*` estão presentes em Production; valores
  permanecem criptografados e nunca foram versionados/logados.
- Smoke público: 7 rotas críticas em HTTP 200, `/api/bdr-treble-dw` sem sessão em
  401, marker `ClickHouse Treble` presente. Evidência SHA-256
  `08c5f361032e60724c6797d1290042aa6574cacbd503b4df73cfac7a3d545fa9`.
- Build/deploy completo PASS: evidência SHA-256
  `0cc2e3492ed7619e7f665cad3b4833c39f2df93bb434df2ee92a6486039707b7`.

---

### BDR | Treble | consumo real do ClickHouse preparado (2026-07-20)

- `/api/bdr-treble-dw` passa a consultar `client_analytics.fact_deployment_status`
  com uma linha sanitizada por tentativa real, em vez de colapsar cada flow em um
  único booleano no frontend.
- Transporte endurecido: SQL via `POST`, autenticação Basic em header e nenhuma
  credencial na URL ou no payload. Telefone, conteúdo e IDs sensíveis não são
  selecionados nem retornados.
- Contrato corrigido: resposta usa sentinel temporal, `SUCCESS` sem evidência de
  entrega não vira `DELIVERED`, não entregues são separados de entregues sem
  resposta e leitura fica explicitamente indisponível nesta fato.
- Frontend DW-first preserva fallback REST, respeita retenção de 7–90 dias, aplica
  filtros às tentativas reais e mostra detalhe por deployment sem PII.
- Gate novo `scripts/test-bdr-treble-dw.js` cobre transporte, granularidade,
  sentinel, semântica de entrega e privacidade. As cinco variáveis
  `TREBLE_WAREHOUSE_*` já estão configuradas no Vercel Production. Estado:
  **local, sem deploy nesta entrada**; ativação exige commit/push/deploy coordenado.

---

### 📸 Forecast Delta | botão de captura manual na própria tela (2026-07-20)

- O botão **Capturar agora** também está em `/forecast-delta`, visível somente
  para `jpacheco@axenya.com` e `salencar@axenya.com`.
- Reusa o endpoint seguro `POST /api/snapshot?promote=weekly` e, após sucesso,
  recarrega as fotos daily e seleciona a data mais recente automaticamente.

---

### 📸 Forecast | captura manual pós-reunião direto no BigQuery (2026-07-20)

> Necessidade do Pacheco: como a reunião muda de horário, a foto oficial precisa
> ser disparada manualmente e aparecer imediatamente no comparativo do `/forecast`.

- `POST /api/snapshot?promote=weekly`: captura autenticada e restrita a editores;
  ignora Sheets e grava `daily` + `weekly_gold` com tipo `semanal_manual`.
- Botão **Capturar foto** adicionado ao `/forecast`; após sucesso, recarrega o
  dropdown e seleciona automaticamente a foto criada.
- Captura é imutável/idempotente por data; o cron posterior não sobrescreve uma
  foto manual mesmo se o pipe mudar no restante do dia.
- Fotos 17/07 e 20/07 confirmadas no `weekly_gold`; 20/07 foi promovida a partir
  da partição daily já reconstruída.
- `jpacheco@axenya.com`: acesso READER ao dataset `axenya_forecast_prd` + permissão
  de execução de jobs BigQuery no projeto canônico.

---

### 🚑 Forecast Delta | cron diário BQ recuperado após falhas de permissão (2026-07-20)

> Incidente confirmado: o front novo estava deployado, mas `forecast_snapshots_daily`
> parou em **16/07**. Logs Vercel mostraram BQ 403 em 17/07 e Sheets 403 em
> 18–20/07. Como o legado Sheets rodava antes do BQ, o 403 impedia a foto canônica.

- **Correção:** Sheets virou best-effort e não bloqueia BQ; qualquer erro no BQ agora
  retorna 500 para tornar o cron observável e permitir retry.
- **IAM:** acesso da credencial de produção restaurado para executar jobs e escrever
  no BigQuery do projeto canônico.
- **Backfill:** HubSpot API → BQ restaurou 17–20/07; última foto = **20/07**, com
  1.392 deals. A sexta 17/07 também foi materializada no `weekly_gold`.
- **Regressão:** `scripts/test-snapshot-resilience.js` prova Sheets 403 → daily BQ
  gravado e BQ 403 → HTTP 500; passa também em simulação de sexta.

---

### 🚀 BDR | Treble → Data Warehouse migration (2026-07-20)

> **Objetivo:** Migrar fonte do dashboard `/novo-bdr/treble` de **API REST** (100+ chamadas, 30-60s) para **Treble Data Warehouse (ClickHouse)** (1-5 queries, < 5s).

**Criados:**
- `api/bdr-treble-dw.js`: endpoint novo usando ClickHouse HTTP API
- Queries: funil principal, por flow, por BDR, falhas, sessões
- Fallback automático: se DW falhar, usa API REST original

**Modificados:**
- `public/bdr-treble.js`: tenta DW primeiro, fallback para API REST
- Compatibilidade: converte formato DW para estrutura esperada pelo frontend

**Arquitetura:**
```
Browser → /api/bdr-treble-dw (ClickHouse) → fallback → /api/bdr-treble (API REST)
```

**Variáveis de ambiente necessárias (produção):**
- `TREBLE_WAREHOUSE_HOST`
- `TREBLE_WAREHOUSE_USER`
- `TREBLE_WAREHOUSE_PASSWORD`
- `TREBLE_WAREHOUSE_PORT` (default: 8443)
- `TREBLE_WAREHOUSE_DATABASE` (default: client_analytics)

**Spec completa:** `15_Workspaces/Treble_Data_Warehouse/docs/DASHBOARD_MIGRATION_SPEC.md`

---

### 🚀 Forecast Delta | Toggle I/G + "saiu = Perdido" + card fotografia de hoje (2026-07-20)

> **Pedido do Samuel:** 3 fixes no `/forecast-delta`:

- **Toggle Implantação/Ganho:** novo segmented control "Implantação/Ganho [Excluir|Incluir]" filtra estágios fechados do escopo. Default **Excluir**. Backend aceita `includeClosedStages=0|1` em `action=compare` e `compare-drill`. Quando excluídos, Ganho e Implantação não entram em waterfall, KPIs, funil, stageUnified, quarters nem drills.
- **"Saiu" só conta Perdido:** na tabela "Visão unificada por etapa", a coluna nova **"Novo / Perdido"** mostra `+N / -M` onde `+N` = deals que entraram na etapa e `-M` = deals que saíram PARA PERDIDO. Deals que saíram para **Ganho** são classificados como `ganho` (tag teal) no drill e **não entram** na contagem de "Perdido".
- **Fotografia de hoje:** card "Fotografia de hoje do forecast" (ou "Fotografia selecionada (B)" se a foto B for antiga) mostra KPIs da foto B: Deals, Vidas, ARR Total, ARR Ponderado, TCV 12M. Título muda automaticamente se `resolvedTab == hoje BRT`.

**Arquivos alterados:**

- `lib/forecast-compute.js`: adicionados `CLOSED_STAGES`, `excludeClosedStages()`, `stageUnified()` recebe `rawBStageById` e retorna `movement: {novos, caiuPerdido, saiuGanhoIgnorado}`, `drillGeneric()` e `drillRow()` classificam `tipo = 'ganho'` quando destino é Ganho.
- `api/history.js`: `action=compare` e `compare-drill` aceitam `includeClosedStages`, aplicam filtro antes do compute, passam `rawBStageById` para `stageUnified`.
- `public/forecast-delta.html`: toggle "Implantação/Ganho", card de fotografia, tabela stageUnified com coluna "Novo / Perdido", CSS `.tag.ganho`, tipo `ganho` no drill.

**Testes:** `test-delta-invariant.js` PASS (13 checks), `test-forecast-delta-e2e.js` PASS (22 checks), `_check-inline-js` 0 erros. Syntax check OK.

**Estado da automação BQ:** cron `59 2 * * *` ativo em `vercel.json`,endpoint `/api/snapshot` grava `forecast_snapshots_daily` todo dia às 23:59 BRT. STATUS_LOG 16/07 confirma backfill até 16/07 e automação funcionando. Para verificar última foto em PRD, chamar autenticado: `/api/history?action=fotos&cadence=daily` — deve retornar `source: "bq"` e `fotos[0].tab` com a data mais recente.

---

### 🚀 BDR No Show | integridade métrica, evals e telemetria em produção (2026-07-20)

> PR **#5** mergeada no commit **`9cc106c`** e deploy canônico concluído em `dashboard-axenya`: `dashboard-axenya-z1kkudsji-axenya-f1a041f6.vercel.app`, aliado a `project-bsmfu.vercel.app` e `axenya-pipeline-dashboard.vercel.app`. O gráfico usa os 13 BDRs do roster sem fallback para AE, incidência sobre desfechos conhecidos + cobertura, média móvel ponderada de 4 semanas, lacunas sem amostra e eixo 0–100%. Fora SLA agora é backlog aberto e reconcilia com a tabela operacional. Gate integrado em `npm run gate:no-show` grava telemetria agregada sem PII em `80_System/Telemetry/no_show_release_gate.jsonl`. Evidências: gate `df4ef02284d80e31507f2269c8b6945fdc33371ae27bbdabf06f38d67559f1f3`, predeploy `63d38cb1720d4adf5d495f7aede9a0cc82b17637304abe57159915f732b3d0a0`, smoke estático de produção `c99778c1dd8c28dcc2851d32f91f2d17a9384d7b578d6c20d58deeab4a26f5f5`.

### BDR No Show | incidente de validação e correção de integridade métrica (2026-07-20)

> Auditoria após três iterações sem smoke funcional identificou: AEs misturados a BDRs via fallback, gráfico últimas 16 semanas vs rankings no período inteiro, semanas sem dado como 0%, eixo 130% e fora SLA incluindo estados fechados. Correção preparada em branch, sem deploy: roster canônico, incidência sobre desfechos conhecidos + cobertura, média móvel ponderada, lacunas sem amostra, eixo 0–100% e reconciliação ranking/tabela. Gates novos: teste de domínio, auditoria de dados reais, Chrome CDP clicando no filtro e evidence ledger. Incidente completo: `docs/2026-07-20_no-show-validation-incident.md`.

Recurring every 20min (job `55d3b136`). Purpose: identify and close gaps so the dashboard is board-ready for CRO/BoD strategic decisions.

---

### BDR Workload | GCP source patch em produção, auditoria 🟡 (2026-07-20)

- Patch publicado em produção: `/novo-bdr/workload` busca HubSpot live para atividades de hoje e BigQuery para histórico/SQL real.
- Nova API read-only `api/bdr-workload-history.js` consulta `gold.bdr_daily_ops` e `silver.sql_deals`, com freshness explícita e fail-closed quando BigQuery não está configurado.
- KPI principal vira **SQL real (deals)**; `OPEN_DEAL` fica como proxy secundário. Comparativos usam período anterior equivalente via série estendida do BigQuery.
- Smokes autenticados locais contra fontes reais: 14–20/07 = 12 SQLs reconciliados e 6.089+ atividades live; 20/07 = 2 SQLs e 1.216+ atividades live. Produção: HTML/JS 200 nos aliases `axenya-pipeline-dashboard` e `project-bsmfu`; API sem sessão 401 (auth ativa). Status permanece 🟡 até confirmação visual autenticada no navegador de produção.
- Scheduler GCP corrigido de um snapshot único às 08:00 para checkpoints às 08:00, 12:00, 16:00 e 20:00 BRT em dias úteis. Execução manual pós-ajuste concluiu com sucesso; BQ passou a registrar 2 SQLs e 286 atividades no snapshot de 20/07 às 16:30 UTC. Hoje no gráfico continua HubSpot live.
- **Incidente de cobertura por owner:** o job ainda usava 8 IDs antigos. Thauan tinha 909 atividades live/7D e zero no BQ. Job atualizado para 14 owner IDs dos 13 BDRs vigentes, imagem versionada com timezone `America/Sao_Paulo` e backfill de 365 dias reexecutado.
- **Auditoria 60D:** silver cobre 22/05–20/07; único dia sem linha no time foi domingo 19/07. Para Thauan, BQ vs HubSpot reconciliou exatamente chamadas 510, e-mails enviados 1.174, WhatsApp 220, LinkedIn 128 e reuniões 12. Nos 13 BDRs × 4 canais comparáveis, 40/52 pares foram exatos e os demais tiveram delta absoluto máximo 3 por atualização/deleção entre snapshot e consulta live.
- **MECE/MBB:** histórico passa a agregar objetos reais diretamente da silver, excluindo notas, tarefas e `Task LinkedIn`; `activities_total` é a soma das cinco categorias. A correlação Apollo → SQL foi suspensa até existir coorte contato→deal com controle de porte/persona e amostra explícita.

---

### 🚀 DEPLOY DE PRODUÇÃO | Forecast Delta Leva 2 no ar (2026-07-16)

> Autorização explícita do dono. PR **#3** mergeada sem force no commit **`d83aca9`**; `main == origin/main`, working tree limpa e zero avanço concorrente do Pacheco desde `4aab7b5`. Build e preflight PASS antes do deploy. Produção: `dashboard-axenya-rlg0q9sbz-axenya-f1a041f6.vercel.app`, aliada a **`project-bsmfu.vercel.app`**.

- **No ar:** datas livres no Comparativo, requested→resolved, acesso “Saiu”, drills de waterfall/funil/KPIs/quarter/etapa, ARR Total/Ponderado por quarter e visão unificada por etapa. `/forecast` legado continua weekly por default.
- **Smokes públicos:** 9 rotas 200; HTML da Leva 2 confirmado; `/api/auth/me`, `/api/forecast-table` e `/api/history` sem sessão = 401 (auth ativa). Evidência SHA-256 `18e95cc51323903759227ab7d2b83b4400dd62b68370eddaaf68293f5a163c8b`.
- **Dados PRD:** weekly (12 gold) + daily até 16/07; compare não-sexta, snapshot, drills e invariante PASS. Evidências `a27b52dc6e2d38eb5f2577f60f1725ead1d8fb93becc231242dd3a68ee22d612`, `86375618611ca58007d57ed38611d9ab8d744077071b1510930e27c74ae8c9fe` e `8b6ae7ac31a9b470aa9ab19bec4ea73dec39260ffa05ed60a17142db3f5ce5aa`.
- **Automação diária confirmada:** Vercel tem 1 cron ativo, `/api/snapshot`, schedule `59 2 * * *` (23:59 BRT). HubSpot API segue fonte única do BQ; Sheet continua apenas sanity.

---

### 🚀 Forecast Delta | Fundação BigQuery ativada em produção (2026-07-16)

> Deploy autorizado da `main` canônica no commit **`4aab7b5`** para o projeto Vercel Pro `dashboard-axenya`, aliado a `project-bsmfu.vercel.app`. Lock/unlock realizados; build e preflight passaram antes do deploy. HubSpot API permanece a única fonte do BigQuery; a Sheet foi usada somente no sanity independente.

- **Backfill PRD:** `scripts/backfill-hubspot-bq.js --from 2026-05-12 --to 2026-07-16 --gold-dates 2026-05-12 --allow-prod`, com `VERCEL_ENV=production`. Resultado: `axenya_forecast_prd.forecast_snapshots_daily` com **66 partições / 83.852 linhas** (12/05–16/07) e `forecast_snapshots_weekly_gold` com **12 partições / 15.116 linhas** (12/05–10/07).
- **Automação diária ativa:** Vercel Cron `59 2 * * *` chama `/api/snapshot` às **02:59 UTC = 23:59 BRT**. A mesma leitura da HubSpot API grava `daily` todo dia, de forma idempotente, e `weekly_gold` em sextas/fins de mês. Produção tem `CRON_SECRET`, `HUBSPOT_TOKEN` e `GOOGLE_SERVICE_ACCOUNT_JSON` configurados.
- **Sanity PRD:** `MATCH: TODOS OS CHECKS PASSARAM`, zero FAIL. Evidência SHA-256 `e69d2cefcdcf012eeabfe4300babc69fef0f6a0e558a1112d95e9e9087e521d9`.
- **Integração PRD:** `action=fotos` via BQ (12 gold), compare não-sexta 08/07→09/07 com resolução exata no daily, snapshot, drill e invariante. Evidência SHA-256 `a27b52dc6e2d38eb5f2577f60f1725ead1d8fb93becc231242dd3a68ee22d612`. Smokes de produção: `/forecast` e `/forecast-delta` 200; APIs sem sessão 401 (auth ativa).

---

### Forecast Delta | Leva 2 UI (datas livres + drills de KPI/etapa/quarter + tabela unificada + acesso "Saiu") (2026-07-16)

> Segunda leva do `/forecast-delta` (request da Auris). Território: `public/forecast-delta.html` (front), `api/history.js` + `lib/forecast-compute.js` (contrato ADITIVO no `action=compare`/`compare-drill`), `package.json` (check) + 2 testes zero-deps novos. **Fonte única de receita intacta** (Regra primária nº 3): tudo reusa `computeSnapshot`/`dealContributions` do motor canônico, então os novos números batem com o waterfall por construção. Zero dependência nova. Commit `adb8556`, merge `d83aca9`, deploy real autorizado e concluído.

- **Inputs de data LIVRE:** Foto A/B trocaram `<select>` por `<input type=date>`. O `/forecast-delta` pede `action=fotos&cadence=daily`, então min/max cobrem o daily até a data mais recente; o default de `action=fotos` continua weekly e preserva o `/forecast` legado. A data resolve para a foto em/antes dela no backend; a UI exibe `Pedido: <requested> → foto <resolvedTab> (<tipo>)`, deixando claro requested × resolved.
- **KPIs clicáveis:** Vidas, ARR Total e ARR Ponderado viraram drills (`kpi:vidas|arrTotal|arrPond`). O modal mostra conta, valor A, valor B, Δ e classificação Novo/Permaneceu/Saiu; para "Saiu" traz o destino final (etapa bruta em B, incl. Perdido/Ganho) e o valor. Formatador da coluna casa o KPI (vidas = número; ARR = R$).
- **Funil e etapas clicáveis:** barras do funil e cada linha da nova tabela unificada abrem o drill por etapa (`stage:<Etapa>`), reusando o mesmo modal. Waterfall clicável preservado.
- **ARR por Quarter previsto:** nova tabela com ARR Total e Ponderado por quarter (toggle), Δ A→B, cada quarter drillável (`quarter:<Q>`) na métrica selecionada. Σ por quarter reconcilia com o KPI de ARR (Total e Ponderado). `applyBidRevDate` passou a preservar o quarter existente do AE e só deriva da régua fixa do BID quando vazio; receita não mudou.
- **Tabela unificada por etapa:** nº deals + vidas + receita real/ponderada (12M) + Δ por etapa; cada etapa drillável. Cobre as 8 etapas do funil + Stand by/Standby unificado. Deals sem linha de receita e gêmeos zerados pela dedup continuam nas dimensões de deals/vidas/ARR, mas com receita zero, preservando simultaneamente a reconciliação dos KPIs e a fonte única de receita. Σ Δ(etapa, prob12) == Δtotal e Σ deals == KPI deals por construção.
- **Acesso dedicado "Saiu":** card com contagem + botão que abre o drill de escopo filtrado por Movimentação = Saiu (destino final + valor).
- **Backend aditivo:** `dealContributions` passou a carregar `vidas`/`arr`/`arrPond`/`quarter` (nada removido); novas funções `stageUnified`, `quarterAgg`, `drillGeneric` (roteia `stage:`/`quarter:`/`kpi:` além dos rowKeys do waterfall — `drillRow` mantido para compat). `action=compare` ganhou `stageUnified` e `quarters`; `compare-drill` ganhou `field` (aditivo). HubSpot segue fonte única do BQ; Sheet só sanity; sem PII além dos deals já autenticados.
- **Validação:** `npm run check` PASS (inclui os 2 testes novos). **`scripts/test-forecast-delta-leva2.js`**: 26 checks. **`scripts/test-forecast-delta-e2e.js`**: 22 checks. Cobertura: campos aditivos, stageUnified, quarterAgg, drillGeneric (stage/quarter/kpi + saiu/destino/valor), quarter do AE em BID divergente da régua fixa, cadence weekly/daily, ARR Total/Ponderado selecionado, invariante e compatibilidade do waterfall. `scripts/test-delta-invariant.js` atualizado para o contrato daily e passou UNIT + integração completa em 3 pares reais. `_check-inline-js` do `forecast-delta.html`: 0 erros. **PRD real**, porta 3007: default weekly até 10/07 + daily até 16/07, compare 08/07→09/07, requested/resolved exatos, reconciliação de deals/vidas/receita por etapa, ARR Total/Ponderado por quarter, drill quarter/etapa/KPI e 3 deals “Saiu” com destino/valor passaram; evidência SHA-256 `5db6b884fa48644eac4068d4cd2e869b89d7fb7f93b8533c2d9f74e6ff5062fc`. `/forecast` legado preservado: `action=fotos` continua weekly por default. Acessibilidade: modal com semântica/foco/Escape, controles e chips como botões, labels/grupos ARIA, tabelas com caption/scope e suporte a teclado/mobile. `forecast.html`/`forecast-stage.html`/`forecast-engine.js`/`revenue-engine.js`/`faturamento-manual.js`/`forecast-table.js` NÃO tocados; `forecast-overall-core.js` mudou somente para preservar quarter do AE sem alterar receita.

---

### Forecast Delta | HubSpot API → BQ Forecast (daily + weekly) validado contra Sheet (2026-07-16)

> PR #2 com guardrails concluídos e merge autorizado pelo dono; **deploy não faz parte deste passo**. Linhagem corrigida: **HubSpot API é a única fonte do BQ**; a planilha Forecast é somente sanity check independente. Removidos `?backfill=1` e o migrador Sheet→BQ. Backfill histórico usa `propertiesWithHistory` (`scripts/backfill-hubspot-bq.js`).

- **BQ único no Growth Axenya:** projeto `gen-lang-client-0423905839`, datasets próprios `axenya_forecast_dev`/`axenya_forecast_prd`; tabelas Forecast removidas de `axenya_bdr_intraday_*`. `daily` = deal×dia; `weekly_gold` = sextas/fim de mês.
- **Compatibilidade histórica:** fotos até 10/07 tinham 35 colunas (sem `É POC?`), formato atual tem 36. Insert passou a mapear por **nome do header**, evitando deslocamento silencioso de Probabilidade/Quarter/datas.
- **Prova em dev:** HubSpot API → BQ de 12/05 a 16/07 (66 daily, 12 gold). Sanity contra clone autorizado da planilha: **286 PASS, 0 FAIL, 0 SKIP** — 7 fotos com IDs/campos exatos + 14 dias agregados exatos. Exceção transparente: Embraer `36080066857` aparece em 12/05 na planilha num pipeline fora de Vendas/Bid (`803749153`) e é corretamente excluída pelo filtro point-in-time do BQ. `/forecast` e `/forecast-delta` 200; `action=fotos` fonte BQ; compare daily com invariante OK.
- **Fix integração:** `/forecast` continua listando weekly; `action=compare`/drill usam daily, permitindo datas livres reais; `action=snapshot` roteia daily→weekly→Sheet.

---

### 🚀 DEPLOY DE PRODUÇÃO | 8 commits da leva do dono (16/07) no ar (2026-07-16)

> Push + deploy autorizados pelo dono. Sincronização limpa: working tree limpa, `origin/main` não avançou (Samuel sem trabalho novo no remoto), push **fast-forward** de 8 commits (`2986bf6..6a19de3`) — sem force, sem divergência, sobreposição com o Samuel vazia. `HEAD == origin/main == 6a19de3`.
>
> **Commit deployado:** `6a19de3` (feat leva-dono: colunas configuráveis no Forecast + Board B12 removido / B15 chips de AE / B15-B16 sem 🟡). Inclui a leva toda de hoje: nomenclatura de código único por card (a1c5853), menu enxuto + cursor + H09 + BDR leads 403 (9e43661), AE leva 1 e 2 (5752a7e, 345bedf), BDR empilhados sem "Top 6 + Outros" (2a517be), TCV unificado com o Forecast (6afb930), receita probabilizada régua flat no A07/N06B (87bcb4e).
>
> **Deployment:** `dpl_8uj9yVT7HVnpi62UpPThmqaeLcLd` → `dashboard-axenya-689zeoa9q-axenya-f1a041f6.vercel.app`, aliado a **project-bsmfu.vercel.app**. Preflight PASS; build READY em ~2s. Produção anterior: `ossv6i148` (15/07 16:42) — rollback disponível.
>
> **Smokes pós-deploy (2 domínios, `axenya-pipeline-dashboard` + `project-bsmfu`):** 7/7 rotas do runbook **200** (`/novo`, `/forecast`, `/novo-bdr` + `/treble` `/workload` `/no-show` `/list-attack` — rotas do Samuel intactas), `/api/auth/me` e `/api/forecast-table` **401** (auth ativa, bypass ausente). ⚠ LOCK do Slack: fazer o UNLOCK manualmente.

---

### 🚀 DEPLOY DE PRODUÇÃO | 7a5aa19 no ar (comparação com foto inline no modal do Forecast) (2026-07-16)

> Push + deploy autorizados pelo dono. Sincronização limpa: branch própria commitada/pushada, **zero conflito** com o Samuel (`comm -12` vazio, `origin/main` inalterado desde `ced1039`), fast-forward de `main` (`ced1039..7a5aa19`) sem force. `HEAD == origin/main == 7a5aa19`. Preflight PASS.
>
> **Commit deployado:** `7a5aa19` (feat forecast: comparação com foto inline no próprio campo do modal, foto → agora; valor da foto menor e apagado, sem risco). Front-only, sem mudança em api/lib.
>
> **Deployment:** `dpl_EuCUWHmNUasZ83y28TqgWRQowSsb` → `dashboard-axenya-mxhsjck3z-axenya-f1a041f6.vercel.app`, aliado a **project-bsmfu.vercel.app**. Build READY. Produção anterior: `620cfb6` — rollback disponível.
>
> **Smokes pós-deploy (2 domínios):** 7/7 rotas do runbook **200** (incl. as rotas BDR do Samuel intactas), `/api/auth/me` e `/api/forecast-table` **401** (auth ativa, bypass ausente). ⚠ LOCK/UNLOCK do Slack: passo manual do dono.

### Forecast | comparação com foto passou para INLINE no próprio campo do modal (pedido do dono) (2026-07-16)

> Ajuste do pedido anterior: o dono quer a comparação **dentro do próprio dado** do modal ("valor antigo → valor novo"), não numa seção "Variação desde a foto" à parte. Refatorado (front-only, `forecast.html`): a seção separada foi **removida** e cada campo do grid do `renderDealModal` agora é decorado por `cmpInline(d, chave, tipo, htmlAtual)` — quando o campo mudou desde a foto, o valor vira `foto → agora` ali mesmo (foto riscada/esmaecida, seta, novo em verde/vermelho para numéricos↑↓ e teal para texto/data/bool). Sem mudança → só o valor atual (estilo original preservado, ex.: `probCls` da Prob. AE, `per()` do Período). Etapa e Executivo decorados no cabeçalho; Dt. Criação no bloco Rastreamento. Deal novo → dica "novo | não existia na foto {tab}" no cabeçalho. Dica "vs foto {tab} | valor da foto → agora" quando comparando.
>
> Campos decorados (os que a foto captura e estão no modal): Etapa, Executivo (via `compAeEq`), Solução, Fatura atual, Colaboradores, Vidas, 1ª Fatura, ARR, Modelo, Agenciamento, Vitalício, Prob. AE, Quarter (via `quarterEmpty`), Dt. Receita, Dt. Vigência, Dt. Criação. Fora (a foto não captura): TCV, Período, POC, Prob. Etapa, Prob. Ajustada, Origem, BDR — mostram só o atual. `premio_mensal`/`vencimento_primeira_fatura`/`close_date` existem na foto mas não são exibidos no modal, então não entram (nenhum campo novo foi adicionado ao modal). Helpers `_cmpFmtK`/`_cmpChg`/`_cmpDir`/`cmpInline` em escopo de módulo; catálogo `CMP_MODAL_FIELDS` e a seção removidos (CSS enxugado: `.cmp-ov`/`.cmp-arw`/`.cmp-nv`/`.dm-cmp-hint`).
>
> Validado: `npm run check` PASS; `_check-inline-js` forecast.html 0 erros; sem referências órfãs (`CMP_MODAL_FIELDS`/`cmp-row`/`cmp-note`/`cmp-count`/`cmp-eq` limpos); harness com casos reais (Vidas 10.000→8.000 down, ARR up, Dt. Receita neu; inalterado sem seta; deal novo valor puro); Edge headless de `/forecast` carrega e renderiza. Sem mudança api/lib — servidor local NÃO reiniciado.

### 🚀 DEPLOY DE PRODUÇÃO | 620cfb6 no ar (variação campo a campo no modal do Forecast + fix reuniao_ocorreu) (2026-07-16)

> Push + deploy autorizados pelo dono. Sincronização limpa: branch própria (`pacheco/forecast-modal-varia-e-reuniao-2026-07-16`) commitada e pushada, **zero conflito** com o Samuel (`comm -12` vazio, `origin/main` inalterado desde `b810860`), fast-forward de `main` (`b810860..620cfb6`) sem force. `HEAD == origin/main == 620cfb6`. Preflight PASS.
>
> **Commit deployado:** `620cfb6` (feat forecast: variação de todos os campos no modal de detalhe na comparação com foto + fix reuniao_ocorreu tipo único). Front-only, sem mudança em api/lib.
>
> **Deployment:** `dpl_8aFfDiGmkFiXpcknTVoX6LzxWwY9` → `dashboard-axenya-6ugove9vk-axenya-f1a041f6.vercel.app`, aliado a **project-bsmfu.vercel.app**. Build READY em ~3s. Produção anterior: `689zeoa9q` (leva do dono 16/07) — rollback disponível.
>
> **Smokes pós-deploy (2 domínios, `project-bsmfu` + `axenya-pipeline-dashboard`):** 7/7 rotas do runbook **200** (`/novo`, `/forecast`, `/novo-bdr` + `/treble` `/workload` `/no-show` `/list-attack` — rotas do Samuel intactas), `/api/auth/me` e `/api/forecast-table` **401** (auth ativa, bypass ausente). ⚠ LOCK/UNLOCK do Slack: passo manual do dono.

---

### Forecast | modal de detalhe do deal mostra a variação de TODOS os campos desde a foto (2026-07-16)

> Pedido do dono: no `/forecast`, com o modo "Comparar com fotografia" ligado, o modal de detalhe do deal (`openDealModal`/`renderDealModal`) mostrava só "Mudança" (avançou/regrediu de etapa) + Δs de receita (estes desligados por `COMP_SHOW_REV_DELTAS=false`). Agora mostra a **variação campo a campo, foto → agora**, de todos os campos que a foto captura.
>
> **Implementação (front-only, `forecast.html`):** novo catálogo `CMP_MODAL_FIELDS` (19 campos que o `compRowToDeal` captura: Etapa, Executivo, Solução, Vidas, Colaboradores, Fatura atual, 1ª Fatura, Prêmio Mensal, ARR, Modelo, Agenciamento, Vitalício, Prob. AE, Quarter, Dt. Receita, Dt. Vigência, Venc. 1ª Fatura, Dt. Criação, Dt. Fechamento). Seção "Variação desde a foto | {tab}" com contador "N de M campos mudaram" + o texto de movimento de etapa. Cada campo vira uma linha: mudou → `valor da foto → valor atual` (novo em verde/vermelho para numéricos↑↓, teal para texto/data/bool); sem mudança → valor único esmaecido. Deal **novo** (sem par na foto) mostra "Novo | não existia na foto". Comparação por tipo com tolerância (money 0,5 | pct 0,0005 | num exato | Executivo via `compAeEq` tolerante a grafia | Quarter via `quarterEmpty`). Rodapé lista os campos **sem histórico na foto** (fora da comparação): TCV, Período, POC, Prob. Etapa, Prob. Ajustada, Origem, BDR. Reusa os formatadores já existentes do modal (brl/num/pct/dt/boolv/txt) e as classes de delta; CSS próprio `.cmp-row`/`.cmp-ov`/`.cmp-arw`/`.cmp-nv`/`.cmp-note`.
>
> **Escopo:** só `forecast.html` — é o ÚNICO painel com o modo de comparação (o `forecast-stage.html`/Overall+etapas tem modal de deal mas NÃO tem comparação com foto). Se o dono quiser a comparação lá também, é tarefa maior (portar `compRowToDeal`/`compAugment`/`compMap`).
>
> **Validação:** `npm run check` PASS; `_check-inline-js` em forecast.html 0 erros; harness com foto real (`2026-07-10`) × payload vivo — 138 de 194 deals comuns tiveram algum campo alterado, mudanças reais pareadas corretamente (Dt. Receita, Vidas, Dt. Fechamento, etc.); Edge headless de `/forecast` carrega e renderiza (tabela, botão de comparação e modal presentes, sem erro de JS). Sem mudança api/lib — servidor local NÃO reiniciado. Não commitado/deployado.

### CRM | a_reuniao_ocorreu_ virou seleção única (era checkbox) | verificação de impacto + hardening do N38 (2026-07-16)

> O dono mudou o tipo do campo `a_reuniao_ocorreu_` no HubSpot (checkbox múltiplo → **seleção única** `enumeration`/`select`, opções Sim/Nao; `updatedAt` 16/07 17:11). Isso **resolve** a pendência de 15/07 (o valor composto "Nao;Sim" de 3tentos/Mangels que cada painel tratava diferente). Payload ao vivo agora **limpo**: 153 Sim | 21 Não | 38 vazio, **zero compostos**.
>
> **Verificação de impacto (nada quebra ao vivo):** todos os consumidores normalizam sem depender do tipo. **AE** (`_aeMeetingClass`, regex `/sim/i`→`/n[aã]o/i`) robusto. **No-Show** (`bdr-no-show.js` `normalizeMeetingOccurred`, território Samuel) lê só dados ao vivo (sem replay de foto), agora limpos → OK, **não tocado**. **CRO N38** (`buildNovoTimeToMeeting`) usava match exato. **Metadata** (`semantic/dados.json`) já dizia `"unidade":"enum"` — nada a mudar; nenhuma regeneração/cache-buster.
>
> **Único risco real (latente): replay de fotos antigas.** O N38 do CRO classificava por igualdade exata; numa foto pré-16/07 um deal `"Nao;Sim"` caía em **nenhum** dos 3 buckets (nem Sim/Não/vazio, pois `!"Nao;Sim"` é `false`) e **evaporava** da contagem. **Fix (front-only, `dashboard.html`):** N38 passou a classificar por substring (Sim vence), igual ao AE — helper `_mtg()`. **AE (`ae.html`):** ficha do A16 atualizada (removida a ressalva stale do checkbox múltiplo; nota de que o campo virou seleção única e a classificação segue robusta a fotos antigas).
>
> Validado: `npm run check` PASS; `_check-inline-js` em dashboard.html + ae.html 0 erros; `_smoke-render` do dashboard.html sem exceção (212 deals); harness com deal composto sintético prova que `Nao;Sim` cai em `sim` e a soma dos buckets = total (nada evapora). Zero mudança em api/lib — servidor local NÃO reiniciado. Não commitado/deployado.

### Forecast | colunas configuráveis (todos os painéis) + Board: B12 removido, B15 chips de AE, B15/B16 sem 🟡 (2026-07-16)

> Leva do dono, front-only (payload já tinha os campos; zero mudança em api/lib — servidor local NÃO reiniciado). Território: Forecast + Board (não tocou ae.html/bdr* da(s) sessão(ões) paralela(s)).

- **Show/hide de colunas no Forecast (`/forecast` + todos os painéis de etapa):** nova seção "Colunas visíveis" no modal de Configurações, via **fonte única `public/forecast-columns.js`** (ES5, persistência + UI de checkboxes + CSS próprio injetado, mesmo padrão do filter-bar). Visibilidade **por painel** (localStorage `fc_cols_hidden_v1::<painel>`: `forecast` no principal, `stage::<Etapa>` nos de etapa) — atende "simplicidade dependendo do painel". Default = tudo visível (nenhuma coluna perdida por padrão). Implementação: `let INFO` + `INFO = INFO.filter(c => c.sticky || !FC_HIDDEN_COLS.has(c.k))` na render (âncora Deal nunca esconde); header/corpo/tfoot e offset dos meses derivam de `INFO`, então propaga sem tocar no resto; `currentInfoFull` guarda todas p/ o modal de detalhe (drill nunca perde campo); export/hover refletem as visíveis (o que está na tela). Overall (sem lista) esconde a seção.
- **Catálogo IDÊNTICO entre os painéis (requisito do dono):** `forecast.html` e `forecast-stage.html` reconciliados — `createdate`, `periodo_contrato` e `vencimento_primeira_fatura` viraram colunas **base em ambos** (antes: splice condicional só-stage / só-forecast). Provado por harness: **29 keys alternáveis idênticas e na mesma ordem** nos dois arquivos.
- **Board:** **B12 (ARR Bridge) removido** (pedido do dono; resolve o 🔴 da auditoria — não é bridge, negativo ≠ churn). **B15 e B16 sem 🟡** no título (`cTbl` ganhou parâmetro `noEmoji`). **B15 (Top 5 AEs):** clique no AE abre modal com **chips de filtro por EXECUTIVO no topo** (todos os AEs do pipe ativo, ranqueados, troca sem fechar) + sub-filtro por etapa + tabela rica (reusa `_novoSf*`).
- **Decisões que tomei:** (a) visibilidade **por painel** (não global) — "dependendo do painel que eu estou acessando" pede leitura por painel; catálogo idêntico garante o "mesmas colunas". (b) **CSS/DOM via filtro de array** (não display:none) — o export lê o DOM por posição em `currentInfo`; filtrar mantém tudo consistente e exporta o que está na tela. (c) contextuais (`createdate`/`vencimento`) promovidas a base em todos p/ o catálogo bater 1:1, e ficam alternáveis (o usuário oculta onde não quer).
- **Validação:** `npm run check` PASS (0 avisos); `_check-inline-js` nos 3 HTMLs 0 erros; **catálogo idêntico** (harness) ✓; **hide end-to-end** (harness ao vivo, painel Negociação: 30→28 th ao ocultar 2, resto intacto, 0 erro JS) ✓; **modal B15** (harness: 12 chips de executivo + 8 de etapa + coluna TCV) ✓; Edge headless no DOM real de `/forecast`, `/forecast-negociacao` (colunas novas + seção presentes), `/forecast-overall` (sem tabela, correto) e `/novo-board` (B12 fora, B15/B16 sem 🟡, 3 links do B15); smoke-render do board OK. Novo cache-buster: **`forecast-columns.js?v=1`** incluído em forecast/forecast-stage. `dashboard.html` NÃO tocado nesta leva.

### Receita probabilizada | DECISÃO DO DONO: régua flat (não funil C07) no N06B do CRO + A07 do AE (2026-07-16)

> Resolvendo o achado da entrada "A07 não bate com o forecast" (abaixo), o dono decidiu: **a probabilização da RECEITA usa a régua flat** (D4/D4b | semantic-ref `forecast_flat`), não o funil C07. Alinhados os dois consumidores que ainda usavam funil:
>
> - **`ae.html` A07** e **`dashboard.html` N06B (+ N05 Cobertura, derivado):** `_novoFcStageProbForwd()` agora retorna direto a régua flat (`NOVO_FC_STAGE_PROB_DEFAULT[stage]`), sem consultar `NOVO_FUNNEL_PROB_PIPE`. O mqlConv dos cohorts BDR passa a 6% (RA flat) em vez de ~1,5% (funil). Diagnóstico fixo 6%, BID fixo 0,5%, ajuste ±10% do AE — idêntico ao Forecast Overall (`forecast-stage.html`, que já era flat).
> - **O funil C07 continua intacto** nos gráficos de CONVERSÃO e ponderação (C07, C04, pipeline ponderado via `_novoStageProbFor`/`_aeProbAdj`) — só a RECEITA deixou de usá-lo.
> - **Efeito medido (A07, harness com dados ao vivo):** Probabilizada FULL sobe de ~5,5M (funil) para **8,66M** (flat); Real inalterado (95,8M). Reconcilia por construção com o Forecast Overall (mesma régua + BID 0,5% + mesmo motor/conjunto/dedup). Emoji 🟡 do A07 **removido**.
> - **Pendência residual (fora deste escopo):** a tela `/forecast` (`forecast.html`) ainda dá ao BID a régua cheia (Proposta 28,5%/Negociação 49,3%) em vez dos 0,5% do Overall/A07/N06B — ~11M só nessa tela. `forecast.html`/`forecast-stage.html` estão em edição pela **sessão paralela**, então NÃO toquei; a sessão do forecast deve alinhar o BID de `forecast.html` a 0,5% (`FC_BID_PROB`) para fechar a fonte única.
>
> Validado: sintaxe inline OK nos 2 arquivos, `npm run check` PASS, DOM headless (`/novo-ae` sem 🟡 no A07 e renderizando; `/novo` do CRO renderiza sem erro, N06B presente). ⚠ Mudança consciente de número board-facing (N06B/N05 do CRO e A07 do AE sobem a probabilizada). Sem mudança api/lib.

### Forecast | BUG CRÍTICO: quarter do AE sobrescrito pela régua fixa do Bid (Pernambucanas Q4 2026 → Q2 2027) (2026-07-16)

> Bug reportado pelo dono, gravíssimo: **Grupo Pernambucanas** (Bid, Proposta Enviada) tem `qual_quarter_de_fechamento` = **Q4 2026** no HubSpot, mas o `/forecast` exibia **Q2 2027**. **Causa raiz:** o override "régua de receita fixa do Bid" (Negociação → out/2026, Proposta Enviada → jun/2027) — que imputa `data_prevista_para_receita` para colocar a receita dos deals Bid sem data — **também sobrescrevia `d.quarter`** derivando-o da data imputada, ignorando o campo do AE. Isso violava frontalmente a decisão do dono de 2026-07-15 ("campo do AE tem precedência sobre a data prevista"). A API (`/api/forecast-table`) sempre retornou Q4 2026 correto; quem corrompia era o front.
>
> **Fix (front-only, 3 blocos):** o override do Bid segue imputando `data_prevista_para_receita` (receita INALTERADA), mas o quarter só é derivado da régua quando o deal **não tem** um (`if (!d.quarter)`) — o quarter do AE ganha precedência. Corrigido no caminho ao vivo E no replay de foto de `public/forecast.html` (2 blocos) e no caminho ao vivo de `public/forecast-stage.html` (`/forecast-overall` + painéis de etapa).
>
> **Alcance:** o bug afetava TODOS os deals Bid em Negociação/Proposta com quarter do AE divergente da régua. Provado no DOM real (Edge headless de `/forecast`): Pernambucanas Q2 2027 → **Q4 2026** ✓; **ADM do Brasil** (Bid Negociação) mostrava Q4 2026 e agora **Q1 2027** ✓; APS-Grupo Cosan Q1 2027; Cosan-Raízen/CPFL Q4 2026; Ford Q2 2027 — todos = campo do AE. `npm run check` PASS + `_check-inline-js` nos 2 HTMLs 0 erros. **Não commitado/deployado** (sessão paralela ativa em ae.html/board.html).
>
> **Pendência (revenue-only, latente):** `public/forecast-overall-core.js` (`applyBidRevDate`, consumido só por `lib/forecast-compute.js` p/ a série de receita) tem o MESMO clobber de quarter, porém o quarter dali NÃO é exibido (saída = receita mensal). Deixado como está p/ não expandir o raio para shared+lib (restart); corrigir junto numa leva coordenada.

### AE Performance | leva 2 do dono + ACHADO: A07 não bate com o forecast (funil × flat) (2026-07-16)

> Segunda leva no `/novo-ae`, front-only em `ae.html`. Quatro ajustes feitos + um achado que exige decisão do dono.
>
> **A16 (Reuniões com o Executivo):** base cortada em **set/2025** (`AE_MTG_FLOOR`; reuniões anteriores são de ciclos antigos, ruído) — 965→947 reuniões vencidas ao vivo. 🟡 removido. A18 já estava aposentado (fundido no A16 na leva 1). **A12 (Idade Média):** 🟡 removido. **A14 (Scorecard):** coluna **Completude removida** (sobram Deals abertos, Vidas, ARR, Win Rate); 🟡 removido. **A13 (Age Distribution):** contava 184 e não 173 porque era o ÚNICO card de idade que **não filtrava pelo time** — os 9-11 deals extras são os mesmos owners fora do time do A11 (Peterson 4, Aurilia, Yokyko, Anderson, Pacheco, sem-owner). Religado à **mesma base do A12** (`_aeAgingBase`: time + sem Implantação + com data de RA) → agora A13 == A12 (172 ao vivo).
>
> **⛔ ACHADO A07 (emoji 🟡 MANTIDO — NÃO bate com o forecast):** validei por harness (motor real do ae.html, dados ao vivo) + DOM do `/forecast`. A **Receita Real** reconcilia (A07 core+não-core+sem-AE+cohorts ≈ 95,8M vs 96,9M do /forecast, gap ~1%), mas a **Probabilizada diverge muito** (A07 8,7M em modo flat / 5,5M em modo funil vs **20,8M** do /forecast). Causa raiz — inconsistência SISTÊMICA de probabilização entre painéis, não bug do A07:
> 1. **A07 e o N06B do CRO** probabilizam com o **funil C07 por pipeline** (`_novoFcStageProbForwd` → `NOVO_FUNNEL_PROB_PIPE`); probs baixas (RA Vendas 1,5%).
> 2. **`/forecast` (forecast.html) e `/forecast-overall` (forecast-stage.html)** probabilizam com a **régua flat** (`_fcStageProbFor` → STAGE_PROB default+manual; RA 6%, Cotação 18,6%…). O funil só alimenta a coluna informativa P. Realtime, não o `prob_ajustada`.
> 3. **BID diverge ATÉ ENTRE as duas superfícies de forecast:** `forecast-stage.html` usa `FC_BID_PROB=0,5%` (= A07/N06B), mas `forecast.html` dá a régua cheia ao BID (Proposta Enviada 28,5% sobre 33M de Real ≈ 9,5M) — sozinho responde por ~11M do gap.
>
> O A07 espelha fielmente o N06B (ambos funil); quem diverge é o par CRO/AE (funil) × Forecast (flat), provável resíduo não migrado da decisão "régua única" de 15/07. **Decisão do dono necessária:** qual probabilização é a canônica (funil C07 ou régua flat) para a receita probabilizada — e alinhar CRO N06B + AE A07 + as DUAS superfícies de forecast (incl. o BID). Não mexi em nada disso: muda número board-facing em vários painéis e é decisão de fonte única (Regra nº 3). Caveat 🟡 anotado na ficha do A07.
>
> Validado: sintaxe inline OK, `npm run check` PASS, DOM headless (A13=A12=172, A14 sem Completude, A16 com toggle + piso set/25, 🟡 só em A07/A11). Sem mudança api/lib. ⚠ Sessão paralela ativa (board.html no working tree dela) — commit desta leva toca só `ae.html`, STATUS_LOG e AUDITORIA.

### AE Performance | leva do dono: A11 explicado, A12 sem Implantação, A16+A18 fundidos, A14 vira scorecard (2026-07-16)

> Cinco pedidos do dono no `/novo-ae`, todos front-only em `ae.html` (o payload já trazia os campos). Detalhe completo no adendo de 16/07 da AUDITORIA_GRAFICOS.
>
> **A11:** o "180 de 189" NÃO era o toggle RA/Standby — são 9 deals ativos de owners fora do time (Peterson 4, Aurilia, Yokyko, Anderson, Pacheco, sem owner); subtítulo novo "X de Y ativos | fora do time: N" + fichas atualizadas. **A12:** Implantação SEMPRE fora da idade média (base própria `_aeAgingBase`; antes entrava com o toggle Implantação=Ganho desligado); contagem do card corrigida para a base real do gráfico. **A16+A18:** fundidos num card único "Reuniões com o Executivo | Occurrence Rate" com toggle Mensal | Executivo; base NOVA = data da reunião com o executivo (`data_do_reagendamento_com_o_executivo` tem precedência sobre `data_da_reuniao_com_executivo`), só datas ≤ hoje, filtro de período sobre essa data (antes: entrada na etapa RA, com reuniões futuras como falso "sem preenchimento"). Ao vivo: 965 reuniões = 548 Sim | 321 Não | 96 vazio (Occurrence Rate 63%). Código A18 aposentado (tag: A16+A18); ressalva "Nao;Sim" conta como Sim (pendência CRM de 15/07) declarada na ficha. **A14:** radar aposentado → Scorecard em tabela com cada métrica na SUA unidade (Deals | Vidas | ARR | Win Rate do período | Completude), cor comparando por coluna, linha Time com taxas agregadas, clique no AE abre os deals.
>
> Validado: Edge headless no DOM real (toggle ativo, scorecard renderizado, contagens 965 | 176 | "de 187 ativos | fora do time: 9"), sintaxe inline OK, `npm run check` PASS. Sem mudança de api/lib — servidor não reiniciado por esta sessão. Coordenação: este commit de `ae.html` carrega TAMBÉM as duas linhas da leva paralela (nav.js?v=2 + cursor pointer no `_novoMkChart`), conforme nota da entrada abaixo ("a sessão do AE commita junto"). Títulos seguem 🟡 (fila da AUDITORIA atualizada com os nomes novos).

### BDR | fim do "Top 6 + Outros" nos empilhados + leads restabelecido (2026-07-16)

> Follow-up da leva do dono: (1) **Escopo do token reconcedido pelo dono no portal** → `/api/bdr-leads` voltou (`success:true` validado ao vivo; a seção Cadência de Leads renderiza de novo, sem mudança de código). (2) **Decisão revisada dos empilhados:** em vez de expandir o "Outros" no tooltip (versão anterior desta leva), o colapso foi **REMOVIDO** — R13 (Weekly), R14 (Monthly) e Trabalhados por Dia agora empilham **TODOS os BDRs/grupos como segmentos próprios**, sem bucket "Outros"; o tooltip lista todo mundo naturalmente. Paleta ampliada para 14 cores; onClick simplificado (todo segmento pré-seleciona seu grupo no drill); fichas de ajuda, tooltips de card e comentários sincronizados. Validado: `npm run check` PASS, 3 NULs do bdr.html preservados, Edge headless sem "Outros" no DOM e sem erro de leads.

### Leva do dono | menu enxuto + cursor de clique + H09 Colab. + BDR leads/tooltips (2026-07-16)

> Cinco pedidos executados em lote (autorização explícita do dono, incl. território BDR — Samuel, coordenar ao retomar):
>
> 1. **CS Dashboard e Cotação OCULTOS do menu** — `hidden:true` no `PANELS` do `nav.js` (drawer + dropdown filtram) e entradas removidas do `NAV_MODEL` do `premium.js` (espelho). Rotas `/novo-cs` e `/novo-cotacao` continuam vivas (só saem da navegação). Cache-busters: `nav.js?v=2` nas 10 páginas (bdr.html via replace byte-safe, 3 NULs preservados) + `premium.js` +1 nas 4 subpáginas BDR.
> 2. **Cursor "mãozinha" nos gráficos clicáveis** — `_novoMkChart` de board/ae/48h/cs/cotacao/bdr agora injeta `onHover` (pointer só sobre elemento ativo) quando o gráfico tem `onClick`; waterfall do `/forecast-delta` idem (com exclusão das barras de Total, que não drillam). O CRO já tinha pointer no canvas (inalterado).
> 3. **H09 (Last 48h | Todos os Novos Deals): coluna Vidas → Colab.** (`quantidade_de_colaboradores`, campo `colaboradores` que já vinha no payload). Ficha de ajuda atualizada. H08 (ganhos) mantém Vidas.
> 4. **BDR | Cadência de Leads: causa raiz do erro diagnosticada** — o token do HubSpot está SEM o escopo `crm.objects.contacts.read` (contacts/search e batch/read retornam **403**; deals, owners e companies OK — provado com sondas diretas na API). Não é bug de código: a seção funcionava em 10/07, o escopo foi perdido depois (rotação do token ou edição do private app). **Ação manual pendente (dono): reconceder o escopo de contatos no private app do portal** (e conferir o token do Vercel prod). Código: `lib/hubspot.js` agora distingue 401 (token inválido) de **403 (falta de escopo, com o endpoint na mensagem)** — o painel deixou de culpar o token falsamente. ⚠ Mudou `lib/` → **servidor local reiniciado** (aviso à sessão paralela).
> 5. **BDR | tooltips R13/R14/Trabalhados-por-Dia sem colapso** — a linha "Outros" do tooltip agora expande TODOS os grupos restantes (BDR a BDR, com valor), em ordem decrescente; barras/legenda mantêm o desenho Top 6 + Outros. Vale para as 3 stacks com esse padrão (weekly, monthly, daily).
>
> Validado: `npm run check` PASS; Edge headless — menu sem CS/Cotação em /novo, /novo-48h, /novo-bdr e /novo-board; H09 com "Colab." no DOM; R13/R14 renderizando; rotas todas 200; `/api/bdr-leads` respondendo a mensagem nova de escopo. **Nota de coordenação:** `public/ae.html` tem trabalho NÃO COMMITADO de sessão paralela (tooltips A11/A12/A14, Radar→Scorecard) — as mudanças desta leva em ae.html (nav v2 + cursor) ficaram FORA do commit para não arrastar trabalho alheio; a sessão do AE commita junto.

### Leva do dono | TCV unificado com o Forecast (C04/C08/B07/B09) + drill do B15 + coluna ARR Pond. no Forecast (2026-07-16)

> Leva de 4 pedidos executada de uma vez. **Núcleo: o TCV do CRO/Board agora é a MESMA conta do Forecast.** Causa raiz da divergência que o dono reportou (Diagnóstico 72,5MM no C04 × 9,5MM no Forecast): o `_novoDealTcv` de CRO/Board usava 12 meses FIXOS + proxy de Diagnóstico (vidas × R$/vida × 12, 44 deals sem régua inflando 63MM) e ignorava a dedup Fee×Corretagem; o Forecast usa `calcTCV` (régua × período do contrato 12/24/36) e zera o gêmeo da dedup no total.
>
> **Fix (fonte única, sem 4ª cópia):** `_novoDealTcv` de `dashboard.html` e `board.html` delega a `calcTCV` (revenue-engine) + `OverallCore.revExcluded` (forecast-overall-core.js, novo include nas 2 páginas — a MESMA dedup do Forecast Overall, dual-load já testado em Node; gêmeo excluído = 0; dedup calculada sobre o payload sem Perdido, cache por referência do array). ⚠ MUDANÇA CONSCIENTE DE NÚMEROS (pedido do dono): C04/B07 por etapa e C08/B09 por bucket agora batem 1:1 com a coluna TCV dos painéis Forecast — **provado com dados reais** (harness Node carregando os engines + interceptando `_novoMkChart`): Diagnóstico 9.491.060 | Cotação 1.950.481 | Proposta 57.130.056 | Consultoria 5.608.659 (dedup do gêmeo Ultrafarma ativa) | Negociação 7.926.418, idênticos em C04, B07 e Forecast. O proxy de Diagnóstico foi APOSENTADO (deals sem 1ª fatura/modelo ficam fora; fatia "Sem receita" do C08/B09 tende a vazia — note do drawer atualizada). Drawers/tooltips/i18n dos 4 cards reescritos; catálogo: `tcv_bruto` e `dedup_fee_corretagem` ganharam os novos consumidores em `fonte_codigo`.
>
> **Demais entregas da leva:** (a) **B09 sem 🟡** no título (pedido do dono; lastro = unificação acima). (b) **Coluna TCV (R$)** na tabela rica dos modais de CRO e Board (fatias do C08/B09, filtro por etapa do C04/B07 e demais drills; sortável, com total no tfoot; valor = a métrica do gráfico, gêmeo dedup mostra 0). (c) **B15 clicável**: nome do AE abre modal com os deals ativos dele (chips por etapa + tabela rica, `bdTopAeOpen`; validado no DOM real: 5 links). (d) **Coluna 🟡 ARR Pond. (R$)** em `/forecast` e nos painéis de etapa (`forecast-stage.html`): ARR estimado (fallback 1ª fatura × 12) × P. Ajust. — a MESMA leitura de ARR ponderado de B15/B16/P03/B04, para auditar paridade entre painéis; informativa (não altera a probabilizada); no Overall/etapas o total zera dedup como as demais colunas; incluída no export; nasce 🟡; regra `arr_ponderado_forecast` catalogada (diferença residual vs CRO/Board = fonte da probabilidade, flat × C07 — documentada na regra).
>
> **Validação:** `npm run check` PASS; `_check-inline-js` nos 4 HTMLs 0 erros; smoke-render OK (board+dashboard); Edge headless no DOM real de `/novo`, `/novo-board`, `/forecast`, `/forecast-overall`, `/forecast-negociacao` (títulos, canvases, th da coluna nova, 5 links do B15); tabelas dos modais alinhadas (22 th = 22 td = 22 células do tfoot); `test-delta-invariant` PASS. `semantic-ref.js` regenerado (regras novas) → cache-buster **v=6** em board/dashboard/forecast/forecast-stage/forecast-delta; ⚠ `ae.html` ficou em v=5 de propósito (sessão paralela ativa no arquivo; payload é aditivo, cache velho inofensivo — bump pendente para a sessão do AE). Zero mudança em `api/`/`lib/` — servidor local NÃO reiniciado.

### Nomenclatura | código ÚNICO por card em CRO/Board/AE + origem dos compartilhados (2026-07-16)

> Decisão do dono: código de card repetido entre painéis mentia — os KPIs com mesmo código (P07 no CRO, Board E AE) são fórmulas COPIADAS que podem driftar. Convenção nova: **cada painel tem códigos próprios**; onde o builder é genuinamente compartilhado (`shared-charts.js`), a tag mostra a origem (`B07 | =C04`, `A28 | =C01`) — código COM `=` não drifta por construção, código SEM `=` é fórmula própria do painel. Códigos do CRO (C07, N06B, N05, vocabulário do catálogo/STATUS_LOG) preservados.
>
> **Mudanças (display-only, mapas `*_CARD_CODES` + títulos do drawer de ajuda; zero lógica):** CRO: 12 cards com `N00` genérico ganharam **N30–N41** (N13–N29 reservados para não colidir com a numeração histórica da AUDITORIA de 12/06) e 3 títulos de ajuda dessincronizados corrigidos (N14→N06, N22→N10, N24→N12) — a UI mostrava (N01)/(N02)/(N03)/(N08) duplicados em cards diferentes. Board: P07→**B01**, P03→**B04 | =P03**, C04→**B07 | =C04**, C08→**B09 | =C08**. AE: P01/P02/P08/P07/S05/P04→**A22–A27**, C01→**A28 | =C01** (A01–A06 não reutilizados — históricos). De-para completo em adendo da **AUDITORIA_GRAFICOS.md**. Fora do escopo: `bdr.html` (Samuel) e painéis Forecast (sem tags). Emojis de veredito intocados.
>
> **Validado no DOM real (Edge headless nas 3 rotas):** tags novas renderizando sem duplicata em `/novo` (30 cards), `/novo-board` (11) e `/novo-ae` (22); `npm run check` PASS. **Achado colateral:** os 12 ex-N00 NÃO estão renderizados no `/novo` — são entradas órfãs de cards removidos (alguns "a pedido" nos comentários do render; `buildNovoWeeklyFlow`/`t_waterfall` nunca chamados). Códigos N30–N41 ficam de reserva; limpeza do código morto é decisão separada. ⚠ A fila 🟡 de 14/07 cita "Fluxo Semanal" no `/novo` — o card não está na página hoje.

### Forecast | Quarter sem ano deixava de aparecer (Canopus) — convenção "Qx = 2026" (2026-07-15)

> Bug reportado pelo dono: Grupo Canopus com Q3 no HubSpot aparecia vazio no `/forecast`. **Causa raiz:** as opções do radio `qual_quarter_de_fechamento` no portal são `Q1..Q4` (SEM ano) + `Q1 2027..Q4 2027`, e o `quarterEmpty()` exigia ano de 4 dígitos — impossível um AE preencher um quarter de 2026 aceito pelo painel. Alcance medido: **114 dos 145** deals ativos com quarter preenchido eram descartados (13 viravam "—"; 39 eram sobrescritos pelo fallback da data prevista DIVERGINDO do quarter que o AE escolheu, ex.: EPTV Q4 → painel mostrava Q1 2027). Receita Real/Probabilizada nunca foi afetada (motor usa data_prevista, não quarter).
>
> **Decisão do dono:** todo Q1–Q4 sem ano = **2026**. Implementado `normalizeQuarter()` ("Qx" → "Qx 2026"; lixo 'false'/'true' → null) com **precedência do campo do AE sobre a data prevista** em: `api/forecast-table.js`, replay de fotos do `forecast.html` (fotos guardam o valor cru) e `lib/forecast-compute.js` (espelho). Regra `quarter_fallback` + dado `quarter_fechamento` atualizados no catálogo; `semantic-ref.js` regenerado (cache-buster **v=4** nas 6 páginas). Pós-fix: quarter null caiu de 76 → 64 (só os realmente vazios); distribuição toda com ano. Validado: API ao vivo (Canopus Q3 2026, EPTV Q4 2026), Edge headless no DOM do `/forecast`, `npm run check` PASS, `test-delta-invariant` PASS. ⚠ Mudou api/+lib/ → **servidor local reiniciado**.
>
> **Pendência CRM (recomendada, não feita):** trocar as opções sem ano por opções com ano no portal e migrar os 114 valores — "Q3" puro fica ambíguo na virada de 2027. Achado colateral registrado: `a_reuniao_ocorreu_` é CHECKBOX múltiplo (2 deals ativos com "Nao;Sim": 3tentos e Mangels) e cada painel trata diferente (CRO ignora, AE conta como Sim, No-Show trata como pendente) — pede decisão.

### 🚀 DEPLOY DE PRODUÇÃO | Dashboard 2.0 no ar (2026-07-15)

> **Merge fast-forward** da `pacheco/nav-single-source-2026-07-13` no `main` (40 commits, 65 arquivos, +7.597 linhas; zero conflito) → push → `npm run check`+`predeploy` PASS (1 fix no caminho: comparação EOL-insensível no check-semantic, o autocrlf do checkout acusava falso drift) → **deploy de PREVIEW** com smokes REAIS (Deployment Protection do Vercel desativada temporariamente via API e RESTAURADA em seguida — estado idêntico): páginas 200, `semantic-ref/help` servidos, **APIs 401 com o JSON do nosso handler = `semantic/` empacotado e funcionando no runtime** (o único risco técnico não testado, agora provado) → **deploy de produção** (`dashboard-axenya-ossv6i148`, autorização explícita do dono).
>
> **Smokes de produção nos 2 domínios** (`project-bsmfu` + `axenya-pipeline-dashboard`): TODAS as rotas do runbook 200 (incl. `/forecast-delta` nova e as 5 rotas BDR do Samuel intactas), `/api/forecast-table` 401 (auth ativa, bypass ausente). Rollback disponível: deployment anterior `mn28zqld4` (Samuel, 21h antes).
>
> **No ar agora (mudanças intencionais a comunicar ao time):** camada semântica completa (catálogo + drawers gerados + P. Realtime=C07 + régua única com Implantação 80% + quarters sem ano=2026 + selo ✏️ + config global + coluna nova) — detalhes nas entradas abaixo. ⚠ Faltou só o UNLOCK no Slack (fazer manualmente).

### Forecast | P. Realtime UNIFICADA com o C07 (decisão do dono) + quarters commitados (2026-07-15)

> Decisão do dono: "C07 e realtime deveriam ser a mesma leitura — os dados precisam conversar". A coluna **P. Realtime** de `/forecast` e `/forecast-overall`+etapas agora é alimentada pelo **`ProbEngine.funnelDerivedProbPipe`** (o MESMO C07 do CRO/Board: Ganho ÷ entraram, POR pipeline, amostra >= 20) — a variante anterior do Forecast (Implantação ÷ entraram, combinado) foi **aposentada** e removida do código. Cache novo `fc_funnel_prob_pipe_v1`; `prob-engine.js` incluído nas duas páginas; tooltip e regra `prob_realtime_forecast` atualizados (agora `depende_de: prob_etapa_calculada` — fonte única). Validado em Edge headless: tabela com 235 linhas + coluna no DOM real.
>
> Antes disso: trabalho da sessão paralela dos **quarters** commitado (43c7eb9) após validação ao vivo — 150 quarters no payload, 0 fora do formato `Qx YYYY`, 118×2026/32×2027 (regra "sem ano = 2026" funcionando nas 3 camadas: API, fotos, replay client).

### Dashboard 2.0 | Fase 4b (núcleo) | config global no KV: toggle de probabilidade + etapas ativas (2026-07-15)

> Implementa as decisões D1–D3 do dono: **`api/config-global.js`** (NOVO endpoint; GET/POST; KV `forecast:config_global` com fallback /tmp; meta ADR-004 em/por/anterior; validação de valores). Campos: `prob_fonte` ('calculada' default | 'premissas') e `etapas_ativas` ({stage_id: bool}, ADR-007 global). ⚠ Endpoint novo adicionado ao guard do preflight.

- **Toggle de probabilidade:** `prob-engine.js` honra `window.CONFIG_GLOBAL.prob_fonte` ('premissas' pula o C07 → régua única direto) e carrega a config no load com re-render — **CRO e Board seguem o toggle**; Forecast fora (D1). UI: seção "Global | todos os usuários" no `settings-modal.js` (Board/AE/48h/BDR), com autor/data da última mudança (✏️). **Pendente declarado:** AE ainda não consome C07 na posição 'calculada' (D2 completa no passe do header, quando o ae.html ganha o funil); UI de etapas_ativas globais idem — a API já funciona.
- **Etapas ativas globais (server-side):** `forecast-table` aplica override do KV no filtro de deals ativos (leitor COMPARTILHADO com o endpoint — mesma cadeia KV→/tmp; cache 60s/instância). Sem config = paridade exata.
- **Provado ao vivo:** GET defaults ✓; POST premissas + meta + anterior ✓; valor inválido rejeitado ✓; paridade sem config (214 deals, 55 RA) ✓; RA global OFF → payload sem RA (159 = 214−55 exato) ✓; reset ✓; seção Global no DOM real do Board ✓. Bug pego pelo teste: leitor inicial só olhava KV e ignorava o fallback /tmp — corrigido antes do commit. Cache-busters `settings-modal?v=2`/`prob-engine?v=2` (bdr.html intocado — NUL; pega no deploy).

### Forecast | coluna "🟡 P. Realtime" nas listagens + gates F1/F3 fechados (2026-07-15)

> Pedido do dono: nova coluna informativa ao lado da P. Etapa em `/forecast` e `/forecast-overall`+painéis de etapa — a probabilidade da etapa **calculada ao vivo do funil** (Implantação ÷ entraram, Vendas+Bid combinados, amostra >= 20, cache 1h; "—" sem amostra). Reusa o `FC_FUNNEL_PROB` que as páginas já computavam. **Puramente informativa: não altera a receita probabilizada.** Nasce 🟡 (régua da auditoria). Regra `prob_realtime_forecast` catalogada — com o alerta de que é VARIANTE do C07 do CRO (lá: Ganho ÷ entraram, por pipeline). Incluída no export CSV.
>
> **Gates fechados pelo dono no roteiro:** Fase 1 (catálogo todo revisado) ✅ e Fase 3 (ajuda gerada dos 3 painéis auditada) ✅.

### Dashboard 2.0 | Drawer gerado v2 (redesign) + metodologia de remuneração reconciliada (2026-07-15)

> **semantic-help v2** (feedback do dono: "frankenstein"): narrativa de negócio primeiro (explicação → como calculamos → tabela → regras práticas nomeadas), metadados técnicos recolhidos em `<details>`, campos exibidos pelo **label oficial do portal**, CSS próprio injetado (`sh-*`) — consistente nos 3 painéis que geram ajuda. Cache-busters `semantic-ref?v=3` (label_portal embutido) + `semantic-help?v=2` nas 6 páginas. Validado em Node + Edge headless.
>
> **Metodologia oficial de remuneração** (imagem do dono, arquivada em `docs/dashboard-2.0/fonte/`): cards Fee e Corretagem+agenciamento batem EXATAMENTE com a régua mensal do motor anualizada. Card 4 (vitalício sem agenc): % praticado nos deals mensuráveis = 2%/5% por porte → matematicamente igual à cauda atual; gap = % fixo por porte vs por deal. Proposta de campo `percentual_vitalicio` no HubSpot registrada — dono pediu para AGUARDAR (ainda revisando cálculos). Vitalício hoje NÃO alimenta cálculo nenhum nos painéis principais (só a coluna booleana informativa).

### Dashboard 2.0 | Pente-fino HubSpot + migração periodo_contrato + decisões finais do toggle (2026-07-15)

> Segunda leva da revisão do dono. **Pente-fino dos campos (pedido dele):** as 983 propriedades de deal do portal foram baixadas via API e batidas contra `dados.json` e contra os literais de `forecast-table`/`snapshot-format` — **zero nomes errados**; a estranheza era nome interno × label. Correção estrutural: todo dado de fonte agora carrega **`label_portal`** (rótulo oficial do HubSpot, 41 campos anotados) ao lado do nome técnico.

- **`periodo_contrato` migrado (decisão do dono):** fonte primária = `periodo_do_contrato___vg` ("Período do Contrato"), fallback = campo legado. Motivo do fallback: preenchimento 4×43 no pente-fino — migração seca perderia 39 deals. `api/forecast-table.js` busca os dois e aplica a cadeia; payload validado ao vivo (14 deals com período). ⚠ Mudou api/ → servidor reiniciado.
- **⛔ DISPUTA ABERTA registrada (regra `receita_regua_mensal`):** dono afirma que Corretagem SEM agenciamento = "pf × % do vitalício × 12", diferente da cauda 2%/5% do motor. Portal NÃO tem campo de % de vitalício (existem `possui_vitalicio`, `vitalicio_ou_comissionamento`, `receita_vitalicio_estimada` c/ 11 deals). **Motor NÃO alterado** — reescreve receita/TCV/forecast; aguardando fórmula exata do dono.
- **Toggle ADR-008 — TODAS as decisões fechadas:** D1 Forecast fora na v1 (registrada inclusão futura) · D2 AE segue o toggle · D3 KV global · D4/D4b régua única flat (já implementada). Implementação do toggle liberada (Fase 4b).
- **Fila registrada (pedidos do dono, 15/07):** (a) padronizar menu superior direito em todos os painéis: Como funciona | Configurações | Toggle de código | Informações — via fonte única incluída; (b) coluna "Probabilidade Realtime" (C07 ao vivo) ao lado da P. Etapa nas listagens dos painéis Forecast; (c) REDESIGN do modal "Como funciona" gerado — feedback do dono: "frankenstein", precisa narrativa lógica e visual para não-programador (refazer o renderer semantic-help.js).

### Dashboard 2.0 | RÉGUA ÚNICA de probabilidade (D4/D4b do dono) implementada (2026-07-15)

> Decisões da revisão do dono: (1) valores da flat confirmados; (2) **painel_default REMOVIDA** — "as probabilidades fixas e o fallback têm que ser idênticos"; (3) **Implantação usa o valor da flat (80%)**, SUPERSEDENDO o 1.0 de 14/07. ⚠ MUDANÇA CONSCIENTE DE NÚMEROS: fallbacks de CRO/Board/AE/Configurações onde o C07 não tem amostra passam da régua antiga (Cotação 33%, Consultoria 61,1%, Negociação 42%, Implantação 100%) para a flat validada (18,6% | 28,5% | 49,3% | 80%).

- **Catálogo:** `forecast_flat` agora é A régua única (chave 'Stand by' adicionada como alias p/ replay de fotos históricas); `painel_default` virou nota histórica (`painel_default_APOSENTADA`); regra `prob_final_deal` atualizada.
- **Código religado:** `prob-engine.js` (DEFAULT ← SEMANTIC_REF, fallback espelhado), `settings-modal.js` (SP_DEFAULT idem — bdr/48h usam o espelho), `ae.html`/`board.html` (NOVO_STAGE_PROB_DEFAULT ← SEMANTIC_REF; board ganhou include do semantic-ref), `dashboard.html` (fallback inline espelhado). `gen-semantic-front` só embute a régua única.
- **`semantic-view.js` corrigido:** não renderizava `tabela`, `ajuda` e as listas de times — por isso o dono não achou remuneração/AEs/BDRs no catalogo.md. Agora renderiza tudo.
- Validado: `npm run check` PASS; Edge headless nas 3 páginas alteradas (JS rodando); catálogo regenerado com remuneração e times visíveis.

### Revisão dos títulos 🟡 | sincronização com os vereditos da AUDITORIA (2026-07-14)

> Pedido do dono: revisar os gráficos com 🟡 e garantir confiabilidade sinalizada. Vários títulos ainda diziam 🟡 apesar de a AUDITORIA já ter veredito — título dessincronizado = sinalização mentirosa.

- **`dashboard.html`:** 14 chaves i18n (PT+EN) sincronizadas com a tabela N01–N26 por NOME: 2 viram 🔴 (Progressão por Etapa/N03, Taxa de Passagem/N08 — foto-como-funil), 6 viram 🟠, 6 viram 🟢. Chaves i18n mortas (t_funnel/t_sizedist/t_vidasdist) intocadas.
- **`board.html`:** ARR Bridge 🟡→🔴 (veredito: não é bridge, negativo ≠ churn — aviso agora no próprio tooltip).
- **Nada foi promovido sem lastro:** só vereditos já existentes da auditoria de 12/06+adendos. Fila do que CONTINUA 🟡 (AE 7 cards, board 3, /forecast-delta, bdr-workload, S01–S04/KPIs novos do CRO) registrada na AUDITORIA com o que cada validação exige. Delta: invariante retestado hoje (PASS); prova externa agendada para a próxima foto de sexta (comparar B=foto do dia com o Overall ao vivo no mesmo momento — sem forçar foto fora do cron).
- Método: títulos extraídos do DOM real (Edge headless), não de grep de código. Validado: board renderiza 🔴 no ARR Bridge sem emoji duplicado; `npm run check` PASS.

### Dashboard 2.0 | Fase 4a | faturamento manual vira dado de primeira classe (2026-07-14)

> ADR-004 aplicado ao faturamento manual, SEM mudar nenhum número: (1) **API** (`api/faturamento-manual.js`): toda escrita grava `entry.meta = { em, por, anterior }` — quem editou (email da sessão), quando, e o estado anterior (log de 1 nível); sibling inofensivo, consumidores leem manual/months por acesso direto. (2) **Cliente** (`public/faturamento-manual.js`): novo `FaturamentoManual.meta(d)`. (3) **UI** (painel Ganho, `forecast-stage.html`): selo **✏️** nas linhas manuais com autor/data no tooltip, **⚠** após 45 dias sem revisão (`validade_dias` declarado em `semantic/dados.json`), e entradas legadas (pré-Fase 4) marcadas como "sem registro de autor".

- Testado ao vivo: roundtrip completo na API (1ª escrita grava meta com `dev@axenya.com`; 2ª preserva `anterior`; limpeza remove entrada de teste — KV limpo); Edge headless mostrou 2 selos ✏️ renderizados nas linhas manuais reais. `npm run check` PASS. Servidor reiniciado (mudança em api/).
- **`docs/dashboard-2.0/design-toggle-probabilidade.md`** (novo): proposta de design do ADR-008 para decisão do dono — o toggle escolhe a preferência (Calculada×Premissas), CRO/Board/AE respeitam, Forecast declara-se fora na v1, defaults reproduzem o comportamento atual. 3 decisões marcadas no doc.
- Restante da Fase 4 aguardando o dono: decisão do toggle, chave de etapas ativas (default = comportamento atual) e a virada consciente do Stand by.

### Dashboard 2.0 | Fase 3 | TODOS os painéis de forecast com drawer gerado (2026-07-14)

> Fechada a cobertura do grupo Forecast: **/forecast-delta** teve a memória de cálculo (`#info`) inteira substituída por seção gerada da nova regra **`comparacao_fotos_delta`** (catalogada de: texto do #info + `action=compare` + spec do Delta — fórmula CashForecast por etapa/foto, invariante Σ Δ = Total B − A, resolução de fotos, caveats de ponto-no-tempo). Constatação de rota: os 8 painéis de etapa (`/forecast-mql`, `/forecast-diagnostico`, …, `/forecast-bid`, `/forecast-ganho`) são TODOS o mesmo `forecast-stage.html` (vercel.json) — já cobertos pela entrada anterior.

- `forecast-delta.html`: includes `semantic-ref.js?v=2` + `semantic-help.js?v=1`; CSS mínimo local das classes `.help-*` (a página não tinha); toggle do botão `i` intacto.
- Validado em Edge headless: seção gerada no DOM real (invariante e caveat presentes), seletores de foto intactos; `test-delta-invariant` PASS; `npm run check` PASS.

### Dashboard 2.0 | Fase 3 (replicação) | Forecast Overall com seções geradas (2026-07-14)

> Drawer gerado replicado no `/forecast-overall` (`forecast-stage.html`): as seções **Ajuste pelo AE** e **Deduplicação Fee×Corretagem** (estáticas, sem mutação por JS) viraram containers `data-semantic-help`. As seções sensíveis ao painel ativo (`help-sec-overall/diag/mql/ganho/rev`, mutadas por `getElementById` conforme a etapa) e as instruções de UI (botão ✎, olho) **ficam à mão de propósito** — são ajuda de interface, não proveniência de regra; entram no manifesto das Fases 5/6.

- Catálogo enriquecido de novo na extração: dedup ganhou o detalhe "deal perdedor continua na lista com receita ZERADA (não soma no total)" — estava só na ajuda do Overall.
- `id="help-sec-dedup"` preservado no container (toggle do JS intacto). Include `semantic-help.js?v=1` adicionado.
- Validado em Edge headless no DOM real: 2 seções geradas presentes, detalhe do perdedor presente, tabela dinâmica de probabilidades intacta. `npm run check` PASS.
- Trabalho autônomo sem revisão do dono (pedido de 2026-07-14, "reviso tudo de uma vez amanhã"): APENAS mudanças aditivas/paridade — Fase 4 (etapas ativas, toggle prob) e ADR-009 (deploy GitHub) continuam PARADOS aguardando o dono.

### Dashboard 2.0 | Fase 3 (golden template) | ajuda do /forecast GERADA do catálogo (2026-07-14)

> Primeiro drawer de proveniência gerado (ADR-006): as 5 seções de regra do modal "Como funciona" do `/forecast` (ajuste do AE, receita por etapa, modelos de cobrança, originação BDR, dedup) deixaram de ser texto à mão e passam a ser **renderizadas do catálogo** por **`public/semantic-help.js`** (novo, ES5) sobre o payload de `semantic-ref.js?v=2` (agora embute `regras` + dicionário de `dados`). Container declarativo: `<div data-semantic-help="regra1,regra2,...">`.

- Cada seção gerada expõe: ajuda de negócio, cálculo, tabela estruturada (quando houver), precedência, faltantes, **campos usados com a propriedade HubSpot**, tipo, status (🟠/🟢) e `vigente_desde` — o contrato do drawer sai da camada semântica, não de prosa.
- **Catálogo enriquecido na extração:** dedup corrigido para o comportamento real (1º etapa mais avançada > menor TCV 12m > vigência mais distante; doc das Premissas dizia diferente — anotado); nova regra `prob_final_forecast` (régua flat + ajuste AE ±10%/30pp); tabela estruturada da régua de remuneração.
- **Mantidos à mão de propósito:** intro Real×Probabilizada (2 linhas), tabela dinâmica de probabilidades (mostra valores AO VIVO com override — melhor que estático) e rodapé.
- Validação: renderer testado em Node (5 seções, conteúdo da ajuda antiga coberto: ±10%, 95%/2%/5% da pf, R$ 36, dedup, premissas BDR); `npm run check` PASS; `/forecast` servido com ref→help→container na ordem certa. ⚠ Front mudou: cache-busters `semantic-ref.js?v=2` (4 páginas) + `semantic-help.js?v=1`.
- **Gate pendente (dono):** abrir a ajuda do `/forecast` e auditar seção a seção se o gerado descreve o comportamento real. Depois: replicar no `forecast-stage.html` e demais painéis.

### Dashboard 2.0 | Fase 2 FECHADA | libs + front consomem o catálogo (2026-07-14)

> Fase 2 concluída: além de forecast-table/funnel-stages (entrada anterior), religados **lib/snapshot-format.js**, **lib/hubspot.js** (pipes, mapas Vendas/Bid, tickets Cotação) e a **régua flat do front** nos 4 HTMLs (forecast, forecast-stage, dashboard, ae) via **`public/semantic-ref.js`** — arquivo ES5 GERADO do catálogo por `scripts/gen-semantic-front.js` (commitado; check-semantic acusa se desatualizar). ⚠ Front mudou → cache-buster `semantic-ref.js?v=1` incluído antes do revenue-engine em cada página.

- **Paridade provada:** constantes dos libs byte-idênticas (assert before/after); `pull-tickets` idêntico excluindo `hs_time_in_*` (cronômetro do HubSpot, avança com o relógio); régua flat gerada == literal histórico em valores E ordem de chaves (ordem legada preservada de propósito — spreads/tabelas iteram chaves); `npm run check` PASS; rotas 200; include antes do uso verificado no HTML servido.
- **Scan repo-wide:** ZERO IDs de etapa fora do catálogo em api/lib/scripts/public. Cauda com IDs hardcoded conhecidos (bdr-list-attack, watcher-deals, build-pipeline-flow, reconstruct-snapshot, drills nos HTMLs) adicionada aos vigiados do check-semantic — migração oportunística.
- **Achado agravado (registrado no catálogo, exige decisão do dono):** `dashboard.html:572` lê `ProbEngine.DEFAULT` quando o prob-engine carrega → CRO e Board usam **Implantação=1.0**; ae.html/settings-modal usam **0.581**. Unificar muda números — decisão pendente: qual é o valor certo?
- Playwright indisponível nesta máquina; validação de runtime do front = identidade de valores por construção + ordem include/uso + sintaxe. Recomendado: olhada visual nos 4 painéis no próximo uso.

### Dashboard 2.0 | Fase 2 (parcial) | forecast-table + funnel-stages consomem o catálogo (2026-07-14)

> Primeiros dois consumidores religados na camada semântica via **`lib/semantic.js`** (porta Node do `semantic/referencia.json`). **Gate de paridade PASSOU:** payloads before/after byte-idênticos (fora `timestamp`) em `/api/forecast-table`, `?includeLost=true`, `/api/funnel-stages` e `action=compare`; `test-delta-invariant` PASS; `npm run check` OK; rotas 200. Servidor local reiniciado (mudança em `api/` + `lib/`).

- **`api/forecast-table.js`:** PIPELINE ids/labels, STAGE_MAP, ACTIVE_STAGE_IDS e LOST_STAGE_IDS agora derivados do catálogo. Removido `STAGE_PROB` (código morto — definido e nunca usado).
- **`api/funnel-stages.js`:** idem, com os quirks históricos preservados EXPLICITAMENTE: alias `'Standby'` (1317543716) e exclusão da Reunião Pré-RFP no map do Bid.
- **🔴 Bug pré-existente achado e registrado (não corrigido, paridade):** no funnel-stages o map produz `'Standby'` mas os buckets do funil Vendas usam `'Stand by'` → a linha Stand by do C06 Vendas conta SEMPRE 0. Anotado no catálogo (etapa 1317543716).
- **Edit do dono no catálogo:** `Stand by.ativa_default: false` = intenção declarada para a config de etapas ativas (ADR-007/Fase 4); comportamento do 1.0 (Stand by ATIVO no payload) preservado e documentado em `regras.filtro_deals_ativos.intencao_declarada`. Aplicar a intenção muda números e será ato consciente da Fase 4.
- Próximos consumidores da Fase 2: `lib/hubspot.js` (tickets Cotação), `lib/snapshot-format.js`, e a régua flat do front (JS ES5 gerado do catálogo).

### Dashboard 2.0 | Fase 1 | camada semântica extraída (3 arquivos base) (2026-07-14)

> Catálogo máquina-legível criado por EXTRAÇÃO do 1.0 — nenhum painel/engine/api tocado (diff: `semantic/`, `scripts/`, `docs/`, 1 linha no `package.json`). O código ainda NÃO consome o catálogo (isso é a Fase 2).

- **`semantic/referencia.json`:** pipes Vendas (9 etapas) + Bid (12 etapas, incl. as 4 fora do STAGE_MAP do 1.0), tickets Cotação (7 etapas confirmadas no portal + 3 que o `lib/hubspot.js` ainda consulta mas foram REMOVIDAS do portal), réguas de probabilidade (flat do Forecast + default dos painéis + calculada C07), VPV, porte, times AE/BDR com IDs, fuso canônico.
- **`semantic/dados.json`:** ~45 dados com label PT/EN, unidade, origem (`fonte`/`manual`), dono. Dados manuais com persistência declarada — incl. `premissas_bdr_originacao` (hardcoded no forecast-engine, regularizar na Fase 4) e `meta_receita`/`vpv_tiers`/`prob_override_etapa` (localStorage por navegador, migrar p/ KV).
- **`semantic/regras.json`:** 14 regras extraídas (régua de remuneração, receita_mensal_deal = Regra primária nº 3 em catálogo, prob C07, prob final ±10%, filtro de ativos, dedup fee×corretagem, conversão ajustada, etc.), todas com `tipo`, `vigente_desde`, `status: em_revisao` e ponteiro `fonte_codigo`.
- **`scripts/check-semantic.js`** (plugado no `npm run check`): sintaxe + consistência interna + drift contra o código (ids hardcoded vigiados em forecast-table/funnel-stages/snapshot-format/hubspot). **`scripts/semantic-view.js`** gera `docs/dashboard-2.0/catalogo.md` (visão legível, só leitura).
- **Achados da extração (registrados no catálogo, não mascarados):** (1) `prob-engine.js` usa Implantação=1.0 vs 0.581 dos demais consumidores da régua default; (2) 3 etapas de ticket removidas do portal ainda consultadas; (3) 4 etapas do Bid (Convite/Documentação/RFP/Perdido) fora do payload do 1.0; (4) nome 'Stand by'×'Standby' diverge entre forecast-table e funnel-stages; (5) fallback ARR pf×12 superestima Corretagem.
- Gate da fase: `npm run check` PASS ✅; falta revisão do dono via `catalogo.md`.

### Dashboard 2.0 | Fase 0 | charter + ADRs + plano de migração (2026-07-14)

> Kickoff do projeto **Dashboard 2.0** dentro do repo, estratégia strangler fig (nada do 1.0 é reescrito; camadas novas nascem por baixo com gate de paridade). Só documentos, zero código.

- **Nova pasta canônica `docs/dashboard-2.0/`:** `README.md` (índice + estado das fases), `charter.md` (consumidores + 20 perguntas propostas + build-vs-buy — 🟠 rascunho em validação com o dono), `decisoes-adr.md` (ADR-001…011; 003 e 009 em status Proposta), `plano-migracao.md` (fases 0–7 com objetivo/entregável/gate/rollback) e `fonte/` (cópias congeladas dos 3 docs de planejamento originais).
- **Fases seguintes dependem do gate da Fase 0:** aprovação do charter e dos ADRs propostos pelo dono. Nenhum arquivo de painel/engine/api foi tocado.
- `CLAUDE.md` ganhou ponteiro para a pasta nova.

### Forecast | P. Etapa alinhada à tabela de probabilidades (2026-07-14)

> Ajuste cirúrgico na aba `/forecast`: a coluna **P. Etapa** volta a usar a régua flat exibida na ajuda (`Reunião Agendada 6,0%`, `Diagnóstico 6,0%`, `Cotação 18,6%`, `Proposta Enviada 28,5%`, `Consultoria 28,5%`, `Negociação 49,3%`, `Implantação 80,0%`, `Ganho 100,0%`, `Standby 12,0%`).

- **Escopo restrito:** `public/forecast.html`, `public/forecast-stage.html` e compatibilidade em `public/forecast-overall-core.js`; sem tocar menu, `public/nav.js`, `public/premium.js`, BDR/Treble/Workload ou alterações recentes do Pacheco.
- **Causa:** a tabela dedicada de Forecast podia aplicar probabilidade por pipeline/cache C07 para alguns deals, enquanto a ajuda da própria aba mostra a régua flat do Forecast. Além disso, browsers com override local antigo (`forecast_stage_prob`) podiam manter os defaults legados `33%/61,1%/42%/58,1%`.
- **Correção:** `P. Etapa` agora lê a régua flat validada do Forecast (ou override manual explícito) e overrides locais legados são limpos automaticamente quando batem com os valores antigos.

### BDR Workload | janela "Últimos 30 dias" sem truncar (2026-07-14)

> Adicionado o período **Últimos 30 dias** (contando hoje) à subpágina Workload/Intraday. Verificado ao vivo: janela 2026-06-15→07-14 = 20.188 atividades, 5.361 ligações, 13/13 BDRs, incluindo hoje.

- **Anti-truncamento (`api/bdr-workload.js`):** o search do HubSpot tem teto ~10k por consulta (`searchAll` para em 9.800). Nova `searchWindow()` divide a janela no tempo e recorre quando bate no teto (dedup por id) — 30 dias de ligações (que passam de 11k em dias cheios) não subcontam mais. Rede de segurança: no dataset atual 30d ficou em 5,3k, abaixo do teto, mas a proteção fica para janelas/times maiores.
- **Cliente (`public/bdr-workload.js`):** chip "Últimos 30 dias" + `periodRange('30d')` = `hoje-29`. Reusa o render multi-dia existente; drill-down de ligações funciona igual na janela de 30d.
- **Latência:** 1ª carga de 30d ~36s (cabe no limite de 60s da função); KV cacheia por 5 min. História rápida de verdade = Fase 2 (BigQuery pré-agregado).
- Validado headless (13/13 BDRs clicáveis, 0 erro JS) e `npm run check` OK.

### BDR Intraday | cache durável (KV) + drill-down de ligações + ambientes separados (2026-07-14)

> Fase 1 da proposta `openspec/changes/bdr-intraday-history-drilldown/`. Responde direto ao "72 ligações do Anderson parece muito" e ao medo de "cache não persiste". Deploy prod concluído.

- **Ambientes (`lib/env.js`):** fonte única — resolve VERCEL_ENV→NODE_ENV→development (preview=dev p/ dados). Expõe `gcpProject` (sempre `gen-lang-client-0423905839`), `bqDataset()` (`axenya_bdr_intraday_dev`×`_prd`), `ciDataset()` (`axenya_commercial_intel_prd` read-only), `kvKey(ns)` (prefixo `dev:`/`prd:`), `flag()`. Datasets BQ criados em `southamerica-east1` com labels. Regra: dev/preview nunca escrevem em `_prd`.
- **Cache durável (`api/bdr-workload.js`):** troca o `_cache` em memória (efêmero, por instância) por 2 camadas L1 memória + **L2 KV** (durável, compartilhado, env-namespaced, TTL 5 min). KV é dependência mole: ausente/erro → degrada para L1+live sem lançar. Resposta indica `cacheLayer`.
- **Drill-down (`api/bdr-workload-calls.js` + `public/bdr-workload.{html,js}`):** "Ligações" clicável → modal com conversa×discagem (≥1 min), por desfecho, por duração (client-side, custo zero) + "para quem" (contato·empresa) lazy via associação call→contact, sanitizado (sem telefone/e-mail), degradável. Verificado com dado real: **Anderson 2026-07-13 = 72 ligações, 4 conversas (6%), 68 discagens** (25 com 0s). `hs_call_disposition` vem vazio (BDRs não preenchem) → sinal real = duração.
- **Sem quebrar:** `npm run check` OK; Playwright headless validou o modal (72 linhas reconciliam, enriquecimento lazy, 0 erro JS). Endpoints novos adicionados ao guard do `preflight-deploy.js`.
- **Fase 2 (histórico BigQuery):** especificada, NÃO deployada — `lib/bq.js` + ingestão diária idempotente + cron só após verificação + UI weekly + join com `enr_call_semantics`. Doc: `docs/bdr-intraday-history.md`.

### BDR | Treble V6 | analytics real de deployment.failure conectado (2026-07-14)

> Corrige o gap apontado pelo usuário: só renomear a métrica não bastava; era preciso configurar a fonte real de falhas.

- **Cloud Run analytics:** `treble-hubspot-sync` redeployado com `analytics_store.py`; `deployment.failure` passa a ser persistido em `treble_delivery_events` sem PII/texto. Serviço permanece `DRY_RUN=true` para não mutar HubSpot pelo webhook, mas grava analytics.
- **Treble UI:** webhooks globais configurados para o endpoint `/webhooks/treble`; evento **Falha de implantação** fica marcado junto com HSM status e fechamento de sessão.
- **Dashboard API:** `/api/bdr-treble` chama o endpoint interno `/analytics/delivery` com secret server-side e calcula `Entrega real observada = entregues em sessions / (enviadas em sessions + deployment.failure capturados)`.
- **UX:** se ainda não houver `deployment.failure` capturado, o KPI mostra **Em coleta** em vez de 100%, evitando falsa precisão. Quando o primeiro failure real chegar, a taxa cai automaticamente.
- **Timeline:** linha vermelha adicionada para `Falhas deployment` no gráfico temporal.

### BDR | Treble V7 | HSM deployments report retroativo conectado (2026-07-14)

> Double-check do caso citado pelo usuário: `pri_face_scan`/HSM com 21 envios, 17 entregues e 1 resposta em 23/junho. A fonte correta não era `/sessions` nem apenas webhook novo; era o relatório histórico `general_deployments_report` da Treble.

- **Fonte nova:** `/api/bdr-treble` passa a ler o CSV `general_deployments_report` server-side (`TREBLE_DEPLOYMENTS_REPORT_URL`) e retorna apenas agregados sem telefone/user/session payload.
- **Caso validado:** `conversation_id=1368340`, dia `2026-06-23`: enviados `21`, entregues `17`, respostas `1`, falhas `4` (`FAILURE_BY_UNABLE_TO_CONTACT=3`, `SUCCESS sem delivered=1`).
- **Taxa real observada:** agora prioriza o relatório histórico de deployments quando disponível. No recorte de 30d validado localmente: `1253 entregues / 2073 envios = 60,4%`.
- **UI:** adicionada tabela `Deployments HSM | relatório Treble` por conversa/dia; timeline incorpora falhas históricas do report.

### BDR | Treble V3 | corrige semântica de entrega + linha temporal (2026-07-14)

> Ajuste após validação operacional: 100% de entrega era verdadeiro apenas dentro de `/sessions` + `/history`, mas enganoso como taxa real de campanha porque falhas pré-session aparecem em `deployment.failure`.

- **Métrica corrigida:** labels mudaram para `Entrega (sessions)` / `Entregues em sessions`; o painel explicita que a métrica é scoped a sessões materializadas e não inclui falhas de deployment.
- **API map:** adicionada linha `POST /treble-webhooks | event_type=deployment.failure` como requisito para taxa real de entrega e motivo bruto de não entrega; cache `v4`.
- **Timeline:** aba `Linha do tempo` agora usa gráfico de linha SVG para enviadas, entregues em sessions, lidas e respondidas; tabela fica só como apoio.
- **Próximo passo analítico:** persistir `deployment.failure` + `on-delivered`/`on-read` para recalcular `delivery_real = delivered / tentativas_deployment`.

### BDR | Treble V2 | full picture operacional MBB (2026-07-14)

> Refinada a subpágina `/novo-bdr/treble` para sair de um diagnóstico agregado simples e virar painel operacional piramidal: funil total, ranking por BDR, linha do tempo, público inferido, pessoas anonimizadas, agrupamento semântico e mapa de arquitetura da API.

- **API ampliada:** `api/bdr-treble.js` agora pagina sessões por flow (`next_id`, até 3 páginas/flow), aumenta `history` analisável para 1.200 sessões no recorte, usa cache `v3` e retorna `apiMap` com chamadas/retornos: `poll/api/all`, `devapi/poll/{poll_id}/sessions`, `devapi/session/{session_id}/history`.
- **Privacidade:** pessoas são pseudonimizadas como `Pessoa 001`, sem telefone/hash/session_id. Público e agrupamento semântico são inferidos por nome do flow + copy outbound redigida.
- **UI:** novas abas `Por BDR`, `Linha do tempo`, `Público e pessoas`, `Arquitetura API`; default do período virou 30d para reduzir truncamento e entregar leitura operacional mais completa; cache-buster `bdr-treble.js?v=3`.
- **Validação:** `npm run check` PASS; handler read-only Treble em dev com `LOCAL_DEV_BYPASS=true` retornou 200, `apiMap=3`, sem expor PII ou secrets.

### Menu lateral | BDR Performance vira "pasta" com acordeão (2026-07-14)

> A subpágina **Workload | Intraday** (`/novo-bdr/workload`) existia mas não aparecia no menu. **BDR Performance** agora é um grupo colapsável (setinha ˅) que abre as subpáginas de BDR — mesmo padrão do Forecast › Overall. Escopo restrito ao grupo BDR; nada mais mudou de formato.

- **Subpáginas no grupo `bdr`:** Workload \| Intraday, No-Show, Ataque à Lista, Treble (pai = `/novo-bdr`). Auto-expande na página atual; clicar no chevron expande/recolhe, clicar no rótulo navega.
- **Duas fontes de menu, ambas atualizadas:** (1) array `PANELS` inline nas 10 páginas grandes (`dashboard/board/ae/cs/cotacao/48h/forecast*/bdr`) — acordeão genérico `toggleNavGroup(grp)`/`data-grp`/`.nav-sub`/`.nav-collapsed`, substituindo o antigo `toggleForecastAccordion` de grupo único; (2) `public/premium.js` (`NAV_MODEL`+`buildCanonicalNav`) que monta o menu das subpáginas de BDR, com toggle **local** (não sobrescreve `window.toggleNavGroup` para não colidir com a versão inline). CSS em `premium.css` + inline.
- **Sem quebrar:** validado headless (Playwright) em 8 rotas — grandes e subpáginas — grupo presente, chevron alterna, item ativo correto, 0 erro de JS. `npm run check` OK. `bdr.html` mantém seus 3 bytes NUL originais.
- **Doc:** `docs/nav-bdr-accordion.md` (inclui a regra de manter `PANELS` e `NAV_MODEL` em sincronia).

### Incidente de alias | BDR | Treble retornou 404 após deploy concorrente (2026-07-13)

- **Causa:** o deploy de produção posterior feito por `jpacheco-5103` assumiu os aliases do projeto canônico depois do deploy do BDR | Treble; essa árvore não continha a nova página, então `/novo-bdr/treble` passou a retornar `NOT_FOUND`.
- **Correção:** redeploy da árvore canônica `origin/main` (`0967d03`) no projeto Pro `dashboard-axenya`; página e API voltaram a responder, com API sem sessão em `401`.
- **Regra operacional:** não executar deploys concorrentes no mesmo projeto; o último deploy assume todos os aliases de produção.

### BDR | Treble | subpágina read-only de WhatsApp sincronizado (2026-07-13)

> Nova subpágina isolada em `/novo-bdr/treble`. Deploy concluído em `https://axenya-pipeline-dashboard.vercel.app/novo-bdr/treble`; API sem sessão retorna 401 e as rotas existentes continuam 200.

- **Fonte:** `GET /api/bdr-treble` lê somente HubSpot communications `WHATS_APP` já sincronizadas pelo pipeline Treble | HubSpot; não chama Treble no Vercel/browser, não envia mensagens e mantém `requireAuth`.
- **Privacidade e limites:** payload sanitizado sem emails, telefones, CPF/CNPJ, payload bruto ou HTML bruto; snippets outbound redigidos por heurística e inbound ocultado; BDR = owner atual do contato associado como proxy inicial, não autor histórico por mensagem; entrega/leitura distinguem `Não medido` de zero.
- **UI:** `public/bdr-treble.html/js` com storytelling `O que aconteceu | Onde está o gargalo | O que funciona | O que fazer na próxima vez`, filtros persistentes, abas Estratégico/Diagnóstico/Detalhe, drilldown por KPI/flow/BDR/status e memória de cálculo.
- **Navegação:** rewrites adicionados para `/novo-bdr/treble`, `/dashboard/bdr/treble` e `/novo-bdr-treble`; menu canônico `premium.js` ganhou item `BDR | Treble`.

### BDR | Treble V1 | diagnóstico real por API Treble (2026-07-13)

- **Correção de escopo:** V0 via HubSpot communications não resolvia storytelling, motivo de falha nem labels. V1 usa API oficial Treble como fonte primária: `poll/api/all`, `devapi/poll/{poll_id}/sessions` e `devapi/session/{session_id}/history`.
- **Diagnóstico novo:** funil `Sessões | Enviadas | Entregues | Lidas | Respondidas`, cards de motivos (`Lida, sem resposta`, `Entregue, não lida`, `Sem evidência de entrega`, `Flow com erro na API Treble`), ranking de flows com labels reais e agrupamento por família de copy.
- **Limites explícitos:** motivo é observado por evidência de entrega/leitura/resposta; `failure_reason` bruto exige webhook `deployment.failure` ativo. BDR e família são inferidos do nome do flow.
- **Infra:** `TREBLE_API_KEY` adicionada em Production no Vercel. Sem chamadas Treble no browser; sem telefone, email, documento, `session_id` ou payload bruto no payload.

## Diretrizes do Projeto — leia antes de começar qualquer trabalho

> Esta seção existe para que qualquer IA (ou humano) possa pegar o projeto do zero sem perder contexto. Atualize sempre que houver mudanças estruturais.

### ⭐ Regras primárias (inegociáveis)

1. **Separador de texto é SEMPRE a barra vertical `|`.** Nunca usar travessão `—`, en-dash `–`, hífen `-` nem middot `·` como separador, em nenhum texto exibido ao usuário (títulos, tooltips, labels, subtítulos, ajuda, fórmulas). Ao criar ou editar qualquer string, já escrever com `|`. O travessão só é permitido como placeholder de "sem dado" (`'—'`), nunca como separador.
2. **Menu lateral e dropdown de painéis têm fonte única — agora em `public/nav.js`.** (2026-07-13: o bloco `PANELS` que antes era COPIADO em cada HTML foi extraído para `public/nav.js`, que injeta o CSS, monta `#nav-drawer` e `#panel-dd`, marca a página ativa por URL e roda no load. 2026-07-14: merge do main resolvido a favor do `nav.js` — o bloco inline que o main ainda tinha foi descartado e as novidades dele, grupo BDR com Workload|Intraday e Treble, portadas para o `nav.js`.) Cada página só inclui `<script src="/nav.js?v=N"></script>` + tem os mount points `#nav-drawer` e `.panel-switcher` no corpo. **Para mudar QUALQUER item/ordem/ícone/saúde/acordeão do menu, editar APENAS `public/nav.js`** — nunca recriar bloco `PANELS` inline numa página. Acordeão é por grupo (`acc:'<g>'` no cabeçalho, `sub:'<g>'` nos filhos; hoje `fc`=Forecast, `bdr`=BDR) via `toggleNavGroup`. Depende de globais que cada página define (`closeDrawer`, `doLogout`/`logout`, `toggleTheme`). ⚠ Exceção que ainda é segunda fonte: as SUBPÁGINAS BDR (workload, treble, no-show, list-attack) usam `premium.js`/`NAV_MODEL` + `buildCanonicalNav` — mudança de menu precisa ser espelhada lá até a unificação.
3. **Toda receita vem de duas bases canônicas (fonte única).** Nenhum painel recalcula receita por conta própria; todo gráfico ou KPI de receita, em qualquer tela, consome estas duas séries: (a) **previsão real** = valor mensal do faturamento manual dos deals em Ganho/Implantação que já faturam (`api/faturamento-manual.js`, Upstash KV, fonte única `_fcDealMonthly`, sem cutoff de `createdate`); (b) **previsão probabilizada** = régua de receita por modelo (`revenue-engine.js` → `calcReceitaMes`) ponderada pela probabilidade de etapa puxada ao vivo do funil (C06). Deals duplos (mesmo cliente com fee por vida e corretagem) contam uma vez: menor TCV de 12 meses e prazo de pagamento mais longo. Se dois painéis divergem no número de receita, é bug de fonte, não de arredondamento. **Atualização (2026-07-01):** o gráfico de forecast do CRO Dashboard (N06B | "Forecast Total") foi religado no motor compartilhado `forecast-engine.js` (`ForecastEngine.dealMonthly` + `bdrCohorts`, régua via `calcReceitaMes`, faturamento manual via `faturamento-manual.js`) e bate mês a mês, em Real e Probabilizado, com o painel **Forecast Overall** (o do `forecast-stage.html`). **Atualização (2026-07-01, seguinte):** o **N05** (Cobertura do Pipeline) também foi religado — N06B e N05 agora consomem a MESMA função `_novoForecastSeries()` (série mensal única extraída do N06B), então Receita Real e Probabilizada do N05 batem mês a mês com o N06B por construção (verificado com dados de produção: idênticos nos 24 meses). O N05 ganhou toggle **Cobertura (×) ↔ Receita (R$)**. Com isso a fonte única de receita está completa no dashboard. Código morto restante para limpeza futura: `_novoCoverageTarget` (var órfã) e a família `_novoFc*`/`_novoForecastCalcReceita` antiga ainda usada pelo **modal** do N06B (`_novoOpenN06BForecastModal`), que segue no motor antigo.
4. **GitHub é a fonte da verdade de deploy.** Regra prática: se não está commitado e pushado, não vai para produção. Antes de deploy: `git fetch origin`, `git status --short --branch`, `git log --oneline --decorate -5`, `npm run check`, `npm run predeploy` e checagem do que está no ar. Deploy só de base limpa/rastreável, uma pessoa por vez com LOCK/UNLOCK no Slack. Runbook: `docs/github-source-of-truth.md`.

### Trabalho em sessões paralelas — regras de coordenação

> Vale para qualquer sessão de IA trabalhando neste repo em paralelo com outra. Motivo: os painéis são HTMLs monolíticos, o deploy (`vercel --prod`) sobe o working tree INTEIRO, e o servidor local cacheia os handlers de `api/`.

1. **Declare o território no início.** Cada sessão anuncia em qual(is) arquivo(s) vai mexer. Nunca duas sessões no mesmo HTML; nunca duas mexendo em `api/`/`lib/` ao mesmo tempo.
2. **Front-only é seguro; API não.** Mudança dentro de um único HTML usando campos que JÁ chegam no payload (tooltips, títulos, drawers, escalas, toggles, lógica de gráfico) → paralelizável. Se a tarefa pedir um dado que não está no payload (campo novo do HubSpot → `PROPERTIES` do `forecast-table.js`; agregação server-side → `funnel-stages.js`), a mudança é de API: **pare e coordene antes de tocar**. Teste rápido: o dado já aparece em algum drill/tabela? Então é front-only.
3. **Mudou `api/` ou `lib/` = reiniciar o servidor local (porta 3002)** — o `local-server.js` cacheia `require` dos handlers. O restart derruba a validação da outra sessão: avise antes.
4. **Raio de explosão dos compartilhados.** `forecast-engine.js`, `revenue-engine.js`, `faturamento-manual.js`, `shared-charts.js`, `filter-bar.js`, `settings-modal.js` e o bloco `PANELS` (replicado nos 10 HTMLs) afetam vários painéis de uma vez — tratar como `api/`: coordenar. Contrato do payload (`/api/forecast-table`): ADICIONAR campo é seguro; RENOMEAR/REMOVER quebra todos os painéis.
5. **Só UMA sessão deploya**, e somente quando as outras confirmarem "terminei e validei". O deploy sobe trabalho pela metade de todo mundo. **Autorizações permanentes de deploy ("pode ir deployando") NÃO sobrevivem à existência de sessão paralela: havendo outra sessão ativa, TODO deploy exige confirmação explícita do usuário naquele momento** — "o trabalho da outra sessão parece commitado/validado" NÃO é confirmação (violado em 2026-07-02; sem dano, por sorte). Endpoint NOVO em `api/` → confirmar que o deploy está no projeto canônico Pro `dashboard-axenya`, não no legado/Hobby.
6. **Commitar a cada entrega validada** — é o ponto de restauração se uma sessão corromper algo (já aconteceu: sed em arquivo com bytes NUL).
7. **Não usar `sed -i` nos HTML** — `public/bdr.html` tem 3 bytes NUL herdados e o sed o corrompeu (2026-07-02). Usar a ferramenta de edição da sessão.

### O que é este projeto

Dashboard de pipeline de vendas da **Axenya**, construído para uso interno do CRO e da diretoria (BoD). É uma **cópia visual** do dashboard Electron original, reformulada para rodar como web app hospedado no Vercel. O arquivo principal do CRO Dashboard é `public/dashboard.html` (servido pela rota `/novo`). Não há framework de UI — vanilla HTML/JS, sem bundler.

### Stack técnica

| Camada | Tecnologia |
|---|---|
| Frontend | Vanilla HTML + JS (ES5 compatível), Chart.js 4.4.1, chartjs-plugin-datalabels |
| Backend | Vercel serverless functions (Node 18+, `maxDuration: 60s`) |
| Dados | HubSpot CRM API v3 (`/crm/v3/objects/deals/search`, `batch/read`) |
| Auth | Google OAuth via `lib/auth.js` (bypassado localmente, ver abaixo) |
| Hosting | Vercel Pro no projeto canônico `dashboard-axenya` (team Axenya). Projeto legado/Hobby não deve ser usado. |
| Repositório | https://github.com/pachecojr-axenya/dashboard-pipeline (branch `main`) |

### Setup local

```powershell
# 1. Copie as variáveis de ambiente (já estão no .env.local — nunca commitar)
# 2. Inicie o servidor local (porta 3002)
$env:LOCAL_DEV_BYPASS = 'true'
$env:SESSION_SECRET   = '<SESSION_SECRET_LOCAL_32C_MIN>' # carregar de .env.local/Secret Manager; nunca colar valor real em docs/chat
$env:HUBSPOT_TOKEN    = '<HUBSPOT_TOKEN_LOCAL>'           # carregar de .env.local/Secret Manager; nunca imprimir
$env:ALLOWED_ORIGIN   = 'http://localhost:3002'
node scripts/local-server.js
# Acesse: http://localhost:3002/novo
```

`scripts/local-server.js` é um servidor Node zero-dependências que emula o runtime Vercel (rewrites + roteamento `/api/*`). Alternativa: `vercel dev` com as mesmas env vars.

### Arquivos principais

```
public/
  dashboard.html        ← CRO Dashboard completo (UI + lógica toda inline)
  board.html, ae.html, bdr.html, 48h.html, cs.html, cotacao.html, forecast.html ← demais painéis
  filter-bar.js         ← Barra de filtro de período compartilhada (axf-*)
  login.html            ← Tela de login Google OAuth
api/
  forecast-table.js     ← Deals ativos (busca simples, sem histórico)
  funnel-stages.js      ← Histórico de etapas via propertiesWithHistory
  _helpers.js           ← setCORSHeaders, requireAuth, getHubspotToken, methodCheck
  auth/                 ← google.js, callback.js, me.js, config.js, logout.js
lib/
  hubspot.js            ← hubspotPost(), pullHubSpotData() (cliente HubSpot completo)
  auth.js               ← verifyJwt(), createSession(), requireAuth()
scripts/
  local-server.js       ← Servidor dev local (emula Vercel)
vercel.json             ← Rewrites: rotas (/novo, /novo-board, …) → arquivos (dashboard.html, board.html, …)
```

### HubSpot — IDs críticos

- **Portal ID**: `44715285` (usado em links: `https://app.hubspot.com/contacts/44715285/deal/{id}`)
- **Pipeline Vendas**: `782758156`
- **Pipeline Bid**: `894130090`

**Etapas Vendas**: Reunião Agendada=`1144746905`, Diagnóstico=`1144746906`, Cotação=`1144746908`, Consultoria=`1144746909`, Negociação=`1144746910`, Stand by=`1317543716`, Implantação=`1288611084`, Ganho=`1144844314`, Perdido=`1144746911`

**Etapas Bid**: Cotação=`1363560722`, Proposta Enviada=`1349620555`, Consultoria=`1349620556`, Negociação=`1353387279`, Implantação=`1353457025`, Ganho=`1353387280`, Standby=`1373066362`

### Convenções de código

- **Sem TypeScript, sem bundler** — ES5 puro no front-end (use `var`, `function`, não `const`/`let` em closures críticas)
- **Sem comentários** exceto quando o POR QUÊ é não-óbvio (não descreva o QUÊ o código faz)
- **Separadores de texto**: sempre `|` (ver Regra primária 1). Nunca `-`, `—`, `–` ou `·` (middot). O travessão só vale como placeholder de "sem dado" (`'—'`).
- **Toggles** (qualquer seletor de modo): Apple-style segmented control via `.tab-sub` + `.tab-sub-btn` + `.tab-sub-thumb` (chip deslizante CSS)
- **Ajuda por gráfico**: cada gráfico tem `key` em `NOVO_HELP_CHARTS`; `_infoBtn(tooltip, key)` abre o drawer filtrado
- **Drill de deals**: `_novoOpenFunnelDealsModal(title, deals)` ou `novoOpenDealsModal(title, deals)`
- **Variáveis CSS disponíveis**: `--card`, `--card2`, `--border`, `--teal`, `--text`, `--text2`, `--muted`, `--green`, `--yellow`, `--red`
- **STATUS_LOG.md**: atualizar com uma linha por mudança, a cada iteração, sem exceção

### Regras de segurança — NUNCA violar

| O quê | Por quê |
|---|---|
| `.env.local` — nunca commitar | Contém `HUBSPOT_TOKEN`, `CLAUDE_API_KEY`, `SESSION_SECRET` |
| `lib/credentials.json` — nunca commitar | Hashes de senha legados |
| `.vercel/` — nunca commitar | Tokens de deploy |
| `LOCAL_DEV_BYPASS=true` — remover antes de qualquer deploy | Bypassa toda autenticação |
| Secrets nunca no chat/log | Rotacionar se vazar |

### Estado atual do CRO Dashboard (`dashboard.html`)

Gráficos ativos (todos com drill de deals ao clicar):
1. **Vidas e Deals por AE** (toggle Vidas/Deals)
2. **Pipeline Aberto por Etapa** (toggle Vidas/Deals)
3. **Funil do Pipeline** (alcance cumulativo, deals ativos)
4. **Risco de Concentração Top 10** (toggle Vidas/Receita)
5. **Distribuição por Tamanho (Receita)**
6. **Distribuição por Vidas**
7. **Valor do Pipeline por Etapa** (toggle Raw/Ponderado)
8. **Receita por Segmento**
9. **Funil de Conversão Histórico** (toggle Vendas/Bid + seletor de data — usa `/api/funnel-stages`)
10. **Funil de Conversão — Fluxo Horizontal** (card complementar, SVG com curvas bezier, compartilha os dados do card 9)

Botão `?` (header): alterna a exibição das tags de identificação (C01/N01/…) e dos `i` de info em todos os cards/gráficos (oculto por padrão; clicar mostra, clicar de novo oculta). O `i` de cada gráfico abre o drawer com os campos HubSpot + fórmula + qual campo de data o filtro de período usa. Drawer de configurações: toggle "Implantação = Ganho" (ON por padrão), probabilidades por etapa, plano de receita.

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
- `api/funnel-stages.js` criado — busca histórico de etapas (`propertiesWithHistory: ['dealstage']`) de todos os deals Vendas + Bid e retorna contagens únicas por etapa + taxas de conversão entre etapas adjacentes.
- `novo-dashboard.html`: card "Funil de Conversão Histórico" adicionado ao CRO Dashboard com toggle Vendas/Bid, seletor de data e botão Carregar.
- `novo-dashboard.html`: toggles `.tab-sub` redesenhados no estilo Apple iOS — pílula escura de fundo, chip interno mais claro para o item selecionado, texto esmaecido para o não selecionado (dark + light mode).
- `novo-dashboard.html`: funil centralizado — Chart.js substituído por HTML/CSS; cada barra centrada e com largura proporcional ao volume, contagem no centro, taxa de conversão entre etapas com ícone de seta e cor por limiar (verde ≥ 50% | amarelo ≥ 30% | vermelho < 30%).
- `novo-dashboard.html`: botão "i" do funil abre o drawer com campos HubSpot consultados pela API (entrada `funnel-conv` em `NOVO_HELP_CHARTS`); separadores `&middot;` trocados por ` | ` no rodapé do funil.
- `STATUS_LOG.md`: seção "Diretrizes do Projeto" adicionada ao topo — stack, setup local, HubSpot IDs, convenções, segurança e estado atual do CRO Dashboard, para onboarding de qualquer IA ou colaborador.
- `novo-dashboard.html`: micro-animação deslizante nos toggles Apple-style — `.tab-sub-thumb` injeta-se em cada `.tab-sub` via `_initTabSubs()` (chamado ao fim de `novoRender()`); desliza ao trocar opção via `_moveTabSubThumb(sub, animate)`; `_setActive()`, `novoSwitchAeMode()` e `novoSwitchFunnelPipeline()` atualizados para disparar a animação.
- `novo-dashboard.html`: card "Funil de Conversão — Fluxo Horizontal" adicionado — SVG puro com `path` único, curvas S (cubic bezier `C`) nos limites entre etapas, gradiente linear teal→verde (Ganho), labels abaixo com contagem, nome e taxa de conversão; compartilha `_novoFunnelData` e `_novoFunnelPipeline` com o card vertical; `buildNovoFunnelHorizChart()` chamado ao carregar dados, ao trocar pipeline e em `novoRender()`.
- `novo-dashboard.html`: card de funil vertical (`_novoFunnelCard` + `buildNovoFunnelChart`) removido a pedido do usuário — as barras de mesma altura visual para valores muito diferentes tornavam o gráfico enganoso; o card horizontal (`_novoFunnelHorizCard`) absorveu o toggle Vendas/Bid, o seletor de data e o botão Carregar; `_novoFunnelStagesData` (drill-down) agora é populado em `buildNovoFunnelHorizChart`.
- `novo-dashboard.html`: (1) `.kpi-card` sem borda, padding aumentado para `1.35rem 1.6rem`, hover via box-shadow teal; (2) 8 KPIs secundários adicionados via `_buildKpiSecRow()` — Adj. Win Rate, BDR Conversion, AE Conversion, Meeting Rate (4 com `—` por falta de dados), + Stale Deals (>60d), Data Completeness (%), Prêmio Mensal (ARR/12 pipeline), Momentum (últimos 30d vs 30d ant.); CSS `.kpi-row-sec/.kpi-sec` com fundo `--card2` e tipografia menor; (3) todos os labels/tips/subs de KPIs primários e secundários traduzidos PT/EN via `NOVO_I18N` + 8 novas entradas em `NOVO_HELP_CHARTS` para os secundários.
- `novo-dashboard.html`: emoji 🟡 adicionado antes do label de cada KPI card (sinaliza dado pendente de validação).
- `novo-dashboard.html`: 8 big-number KPI cards adicionados acima dos gráficos via `_buildKpiRow()` + CSS `.kpi-row/.kpi-card/.kpi-value/.kpi-sub` — Receita MTD, Receita Anual YTD, Pipeline Ponderado, Reuniões Agendadas (—, etapa excluída da API), Vidas em Aberto, Vidas Ganhas, Vidas Perdidas (—, deals perdidos excluídos), Vidas Ponderadas; cada card tem botão `i` (tooltip + drawer com campos HubSpot via 8 novas entradas em NOVO_HELP_CHARTS); cards N/A ficam com opacity .55; helper `_fmtBig()` para formatação compacta em R$/M/K.
- `novo-dashboard.html`: header sticky ganhou efeito glassmorphism ao rolar — classe `.scrolled` adicionada via `scroll` listener (`window.scrollY > 8`); CSS: `backdrop-filter:blur(18px) saturate(1.5)` + `background:var(--hdr-glass)` (rgba semi-transparente); variável `--hdr-glass` adicionada ao `:root` (dark: `rgba(13,17,23,.78)`) e `[data-theme="light"]` (light: `rgba(246,248,250,.82)`); transição suave via `transition:background .25s`.
- `novo-dashboard.html`: funil agora carrega automaticamente ao abrir o dashboard — `novoRender()` dispara `novoLoadFunnel()` se `_novoFunnelData === null && !_novoFunnelLoading`; spinner já visível no placeholder inicial do card; corrigido bug onde o spinner era injetado em `#funnel-chart-area` (removido) em vez de `#funnel-horiz-chart-area`; `_novoFunnelPipeline` padrão alterado de `'combined'` para `'vendas'`.
- `novo-dashboard.html`: toggle do funil ganhou terceira opção "Ambos" (padrão) — combina Vendas + Bid somando contagens por etapa onde o nome coincide e mantendo etapas exclusivas de cada pipeline na sequência correta (`combined` adicionado a `_FUNNEL_STAGES`); taxas de conversão recalculadas sobre os totais combinados; rodapé exibe "Pipeline Vendas + Bid" e soma os totais de ambos; `_novoFunnelPipeline` agora inicia como `'combined'`.
- `novo-dashboard.html`: (1) `.novo-card-header .tab-sub { margin-bottom:0 }` — corrige desalinhamento vertical do botão "i" em relação ao toggle Apple-style nos cabeçalhos de card (`.tab-sub` tinha `margin-bottom:1rem` que, em flex + `align-items:center`, deslocava o chip para cima); (2) `buildNovoFunnelHorizChart()` reescrito com layout proporcional: zonas de estágio (`flex=1`) e zonas de conversão (`flex=0.35`) têm a mesma proporção tanto no SVG quanto na linha de labels, garantindo alinhamento pixel-a-pixel — SVG inclui linhas tracejadas verticais em `xCC(j)` (centro de cada zona de conversão); label row alterna entre células de estágio (contagem + nome, clicáveis) e células de conversão (seta + percentual colorido por limiar).
- `novo-dashboard.html`: experimentado converter o menu lateral em barra horizontal no topo, mas **revertido a pedido do usuário** — mantido o drawer lateral esquerdo docado de 280px original (`.nav-drawer` fixed, `body.nav-docked`, `.nav-backdrop`, `_setNavOpen` com backdrop/docked, padrão aberto).
- **i18n completo + DEPLOY de produção.** Auditoria i18n: paridade PT/EN 182/182 chaves (0 faltando). Tornados bilíngues os textos antes hardcoded em PT: cabeçalhos da tabela de deals (Deal/Etapa/Fechamento/Dias/…/Total + contagem), modal de Perdido (label/Todos/sem motivo — sentinela interna fixa p/ matching), sub do P04 ("vidas potenciais") e "dias" do P05 (chaves `tbl_*`, `lost_reason_*`, `unit_days`, `vidas_potenciais`). **Deploy:** `vercel --prod` OK (READY, production). URL pública: **https://project-bsmfu.vercel.app** (root 200 + API 401 = auth do app ativa; `LOCAL_DEV_BYPASS` ausente em prod). A URL imutável do deploy e o alias `dashboard-axenya-axenya-f1a041f6` ficam atrás da Vercel Deployment Protection (401) — usar `project-bsmfu` para usuários finais. A verificar manualmente: `ALLOWED_ORIGIN` e os Authorized Origins/redirect do Google Console batem com o domínio público.
- **Filtro de Motivo de Perdido no modal do P07:** API passa a buscar/mapear `motivo_do_declinio_ou_perdido` → `lost_reason` (833/884 preenchidos). Modal do P07 agora abre via `_novoOpenLostModal` com um `<select>` de motivos (ordenado por frequência, com contagem por motivo + "Todos"); `novoFilterLostReason(val)` re-renderiza a tabela filtrada (sentinela `(sem motivo)` para nulos). Top motivos: Outros (219), Não tivemos retorno (174), No Show (133).
- **Deals perdidos habilitados (P07 + Win Rate):** `api/forecast-table.js` retorna perdidos só com `?includeLost=true` (novo `LOST_STAGE_IDS=['1144746911']`, filtro `hs_is_closed_lost` condicional) — board e demais painéis chamam sem o param e seguem sem perdidos (isolados). CRO passa a chamar `?includeLost=true`. P07 (Vidas Ganhas→Perdidas) habilitado (`na:false`, cor red, clicável, drill com `lostDeals`). Contador "deals ativos" do topo passou a excluir Perdido. S01 (Adj. Win Rate) habilitado **por contagem de deals** (decisão do usuário): ganhos ÷ (ganhos + perdidos) = ~3% (24/908); perdidos = histórico completo (884 deals). Textos/fórmulas/i18n atualizados (vidas→deals; removido "indisponível"). Nota: win-rate por vidas seria ~0% por causa de outliers gigantes nos perdidos (Bradesco 1M vidas etc.), por isso a escolha por contagem. P06 segue com 🟡 removido.
- **P06 (Vidas Ganhas) — modal com 4 big-numbers:** reaproveita `_novoKpiStatsHtml(d.deals)` (mesmo do P02) com os deals do P06 (`wonDeals` = Ganho+Implantação, todos): Won Deals, Total de Vidas, Monthly Revenue, Annual Revenue. Dispatch adicionado no `novoKpiDrill`. Confere com o card: Total de Vidas = 3.787.
- **P05 de-flag + scrollbar horizontal visível:** removido 🟡 do P05 (`kpi-open-vidas`). Tabela de deals dos modais (`_novoDealsTableHtml`) agora com `overflow:auto;max-height:55vh` — a barra de rolagem horizontal fica fixa no rodapé de uma caixa visível (não precisa rolar o modal inteiro até o fim); cabeçalho `thead` já era sticky, então rolagem vertical mantém os títulos. Mantido o substring `overflow-x:auto` no style para a scrollbar temática continuar casando. Tabelas em cards da página (risktable/triage/reassign) não alteradas.
- **P04 e P05 (sessão local):** P04 (`kpi-reunioes`) — título → "Deals em Reunião Agendada" (i18n PT/EN), card agora clicável (drill registrado com `reunioesDeals`) abrindo a lista desses deals, e flag 🟡 removida. P05 (`kpi-open-vidas`) — modal ganhou 3 big-numbers via `_novoP05StatsHtml(deals)`: Negócios Abertos (count), Vidas em Negócios Abertos (Σ vidas), Idade Média (média de `dias_no_pipe`); chaves i18n `p05_*` (PT/EN); dispatch no `novoKpiDrill`. Números conferidos vs API: 134 abertos, 710.555 vidas, 74 dias médios.
- **Avaliação completa pós-mudanças do usuário** (Reunião Agendada habilitada na API → 323 deals). OK: sintaxe limpa em todo o deploy-path, menu compartilhado idêntico nos 8, regra won intacta, auth por lista. Usuário tratou bem a Reunião Agendada: `_novoIsOpen(d)` (exclui Reunião + Perdido) aplicado em `_novoOpen()` e nos 3 `openDeals`; P04 habilitado com `reunioesDeals/Count/Vidas`. Correções desta avaliação: (1) `--blue` adicionado ao tema (`:root` + light) — P04 usava `var(--blue)` inexistente; (2) textos de ajuda do P04 + campo dealstage de kpi2-meeting atualizados (não dizem mais "excluída da API"). Sinalizados (não alterados): `public/novo-dashboard.broken.html` e `novo-dashboard.backup.*.html` em `public/` ficam acessíveis no deploy; scripts soltos na raiz; `dashboard.html` legado com erro de sintaxe mas fora do deploy-path (`/dashboard`→`novo-dashboard.html`).
- **Acesso restrito por lista explícita de e-mails** (antes: qualquer `@axenya.com` entrava). `lib/auth.js`: nova lista `AUTHORIZED_EMAILS` (no arquivo) + env var `ALLOWED_EMAILS`, unidas por `getAllowedEmails()`; novo helper `isEmailAuthorized(email)` é o único ponto de decisão. `verifyGoogleToken` (One Tap) e `api/auth/callback.js` (fallback OAuth) agora liberam SOMENTE quem está na lista; o domínio `axenya.com` só define o papel (staff x guest), não o acesso. Para liberar pessoas: editar `AUTHORIZED_EMAILS` em `lib/auth.js` ou setar `ALLOWED_EMAILS` (Vercel → Settings → Environment Variables). Seed inicial: `jpacheco@axenya.com`.
- **Tooltips de cálculo nos mini big-numbers dos modais** (P02 e P03): cada stat card (`_novoKpiStatsHtml` e `_novoP03StatsHtml`) ganhou um botão `i` com `data-tip` explicando a fórmula, reaproveitando o tooltip custom (`_infoBtn` → `#novo-tip`, z-index acima do modal). Ex.: "Weighted/yr (histórico) = Σ (ARR × probabilidade) dos abertos; prob = custom do AE, senão a da etapa (Configurações)".
- **Tooltips nos pontos de status** (`title` + `aria-label`): verde = "live", amarelo = "wip", vermelho = "not working". Aplicado em `dot()` (menu lateral + dropdown) e `buildTitleDot()` (ao lado do título) no bloco compartilhado dos 8 arquivos.
- **Probabilidade por etapa unificada na fonte de configurações.** Auditoria: `novo-dashboard.html` já lia tudo de `NOVO_STAGE_PROB` (configurável via modal, persistido em `localStorage 'novo_stage_prob'`); demais painéis/forecast não usam prob por etapa — **exceto `novo-board.html`**, que tinha um `NOVO_STAGE_PROB` hardcoded próprio. Corrigido: board agora carrega do mesmo `localStorage 'novo_stage_prob'` (+ defaults idênticos ao CRO) e alinhou o cálculo de prob custom (deal.probabilidade já é 0–1; removido `/100`, fallback `||0`).
- **Bug pré-existente corrigido no `novo-board.html`:** o script principal tinha uma chave `}` faltando no `_novoMkChart` de `buildBdArrBridge` (SyntaxError que quebrava todo o JS do painel Board → charts não renderizavam). Adicionada a chave; script agora parseia limpo. (Descoberto ao auditar a probabilidade.)
- **P03 (Pipeline Ponderado) — modal ganha 4 big-numbers** (como o P02), via `_novoP03StatsHtml()`: Weighted/mo (histórico) = ponderado anual ÷ 12; Weighted/yr (histórico) = Σ(arr × prob) dos deals abertos (= valor do card); Weighted/yr (impl. = ganho) = ponderado dos abertos + ARR cheio dos deals em Implantação (cenário tratando implantação como ganho 100%); Open Deals = nº de abertos. `novoKpiDrill` agora ramifica por key (P02 → `_novoKpiStatsHtml`, P03 → `_novoP03StatsHtml`). Números conferidos vs API: 132 abertos, R$ 44,5M hist/yr, R$ 3,7M hist/mo, R$ 49,1M impl=ganho.
- **KPI primários responsivos no mobile** — `.kpi-row` (os 8 big numbers) mantém `repeat(4,1fr)` no desktop mas passa a `repeat(2,1fr)` em ≤900px e `1fr` em ≤520px (media queries), em vez de 4 colunas fixas que vazavam à direita no celular.
- **P02 validado (limpeza visual):** removido o emoji 🟡 só do título do card P02 (`kpi-won-annual`) — sinaliza que foi revisado; demais KPIs mantêm o 🟡. Removido o prefixo de código (ex. "P02 | ") do título do modal de drill de todos os big numbers (`novoKpiDrill`); o código continua só no tooltip do `i`.
- **Scrollbars temáticas** nas tabelas com rolagem horizontal (`[style*="overflow-x:auto"]`) e nos corpos de modal/drawers (`.modal-body`, `.novo-help-body`, `.novo-prob-body`): `scrollbar-width:thin` + `scrollbar-color` (Firefox) e `::-webkit-scrollbar` (Chromium) com thumb `var(--text2)` arredondado (borda transparente + `background-clip:padding-box`), hover `var(--teal)`, track transparente. CSS adicionado ao bloco compartilhado → aplica em todos os 7 painéis + Forecast.
- **P02 (e KPIs won P01/P06) — textos alinhados ao novo "won":** tooltips PT/EN (`kpi_mtd_tip`, `kpi_won_tip`, `kpi_won_vidas_tip`), descrições e campo `dealstage` do drawer de ajuda atualizados para "Ganho + Implantação" (com IDs de etapa de ambos). Modal do P02 confere: card, 4 mini big-numbers (Negócios Ganhos/Vidas/Monthly/Annual) e lista de deals (com coluna Fechamento) derivam todos de `wonYtdDeals` = `_novoIsWon` filtrado por ano; código P02 no tooltip do `i`.
- **Definição de "won" passa a incluir Ganho + Implantação** (pedido do usuário). Novo helper `_novoIsWon(d)` (`stage==='Ganho' || stage==='Implantação'`); `_novoOpen()` central agora retorna `!_novoIsWon(d)` (Implantação sai do pipeline aberto, evitando dupla contagem); todos os literais `d.stage===/!=='Ganho'` sobre `_novoDeals` trocados pelo helper (15 sites: big numbers, win-rate por tamanho, leaderboards de AE, cycle time, net flow, etc.). `Implantação` removido de `NOVO_STAGE_ORDER` (não é mais etapa de pipeline aberto). Fórmulas/descrições de P01/P02/P06 (won) e P05 (aberto) atualizadas. **Não** alterado o funil histórico de conversão (`/api/funnel-stages`, `isGanho` em `buildNovoFunnelHorizChart`) — é progressão de etapas. Impacto (dados atuais): P02 5→22 deals (R$ 498K→R$ 5,07M); Vidas Ganhas 584→3.787; pipeline aberto 150→133.
- **Coluna "Fechamento" (close_date) na lista de deals** — adicionada entre "Etapa" e "Dias" em `_novoDealsTableHtml` (tabela compartilhada por todos os drills, inclusive P02). Renumerados os índices das colunas (agora 0–17, 18 no total) em três pontos: cabeçalho `th()`, células `_novoDealsRows` (`_nd(d.close_date.slice(0,10))`) e ordenação `_novoSortVal` (col 4 = close_date); `tfoot` "Total" colspan 6→7. Verificação na API: P02 (Receita Ganha Ano Atual) hoje conta só `stage==='Ganho'` (5 deals em 2026, todos com close_date em 2026); nenhum em Implantação no dado atual.
- **Big numbers — refinamento (CRO Dashboard):** (1) código de referência (P/S) removido do badge visível e mantido **só no tooltip** do botão `i` (`data-code` → `.nt-code`); (2) cada big-number card virou **clicável** (classe `.kpi-click` + `onclick="novoKpiDrill(key)"`) abrindo modal com a **lista de deals** que compõe o KPI (mesmas colunas dos gráficos, via `_novoDealsTableHtml` extraído de `novoOpenDealsModal`); `_novoKpiDrill[key]` registra o subconjunto de deals + label por KPI nos builders; (3) **P02 (Receita Ganha | Ano Atual)** abre, além da lista, 4 mini big-numbers no topo (Negócios Ganhos, Total de Vidas, Monthly Revenue, Annual Revenue) via `_novoKpiStatsHtml`; (4) `letter-spacing:0` em `.kpi-label` e `.kpi-sec-label`. Botão `i` agora faz `event.stopPropagation()` para não disparar o drill do card. Cards N/A (sem deals) não são clicáveis.
- **Forecast com menu correto (tarefa pendente resolvida):** `forecast.html` recebeu o mesmo tratamento dos painéis — `<h1>Forecast</h1>` envolto no `.panel-switcher` (chevron + dropdown) e o bloco JS compartilhado injetado antes de `</body>` (cópia byte-a-byte de `novo-board.html`). O `buildNav()` regenera o menu lateral idêntico (8 itens + pontos de saúde, Forecast=verde ativo). Separadores travessão de `forecast.html` também trocados por `|` (9).
- **Regras primárias formalizadas** no topo das Diretrizes: (1) separador de texto é sempre `|` (travessão só como placeholder `'—'`); (2) menu lateral e dropdown têm fonte única (`PANELS` no bloco JS compartilhado). Aplicado: **122 separadores ` — ` trocados por ` | `** nos 7 `novo-*.html` (preservados os 50 placeholders `'—'` de "sem dado").
- **Menu lateral unificado** — a `<ul class="nav-menu">` agora é gerada pelo bloco JS compartilhado a partir de `PANELS` (`buildNav()`), idêntica em todos os 7 painéis: mesmo header/itens/ícones/pontos de saúde, item atual marcado por `location.pathname`, navegação via `data-url`. O HTML estático do nav permanece como fallback mas é sobrescrito no load. Rótulo "Cotação" corrigido (acento).
- **Pontos de saúde (verde/amarelo/vermelho) brilhando** adicionados ao menu lateral, ao lado do título e nos itens do dropdown de painéis (todos os 7 `novo-*`): Forecast=verde, CRO Dashboard=amarelo, demais=vermelho. `.health-dot` com glow pulsante (`@keyframes health-glow`, var `--hg` por cor); injetados via o bloco JS (campo `health` em `PANELS`; `build()` decora título via `.panel-switch-btn`, itens do dropdown e `.nav-item` casando a URL do onclick). Dropdown de painéis (`.panel-dd`) agora **sem borda e fundo transparente com blur** (`background:rgba(...,.62)` + `backdrop-filter:blur(20px) saturate(1.7)`, variante light).
- `novo-dashboard.html`: **códigos de referência (P01–P08, S01–S08) visíveis em cada big-number card** — helper `_codeTag(key)` + classe `.kpi-code` (badge monospace teal) inserido ao lado do botão `i` nos KPIs primários e secundários. **Fórmulas adicionadas a todos os 16 big numbers** — campo `formula` em cada entrada KPI de `NOVO_HELP_CHARTS`, renderizado no drawer de ajuda (`_novoHelpSection`) como bloco "Fórmula" (monospace, borda teal à esquerda) entre a descrição e a tabela de campos HubSpot.
- **Seletor de painel (chevron + dropdown)** adicionado ao título de todos os 7 painéis `novo-*` (`novo-dashboard`, `-board`, `-ae`, `-bdr`, `-48h`, `-cs`, `-cotacao`): `<h1>` agora vive dentro de `<button class="panel-switch-btn">` com um chevron `▾` à direita; ao clicar abre `.panel-dd` (dropdown estilizado, ícone + nome de cada painel, item atual marcado `.active`, inclui Forecast). Bloco `<style>`+`<script>` autocontido idêntico injetado antes de `</body>` em cada arquivo; painel atual detectado por `location.pathname`; fecha com clique-fora e Esc; chevron rotaciona 180° quando aberto. Subtítulo do `novo-48h` preservado dentro do switcher.
- **Integração Forecast** — `api/history.js`, `api/snapshot.js`, `lib/sheets.js` copiados de `dash-forecast`; `public/forecast.html` adicionado (cópia de `dash-forecast/public/index.html`); portal ID corrigido em `snapshot.js` (`44715285` → `44715285`); `vercel.json`: rewrite `/forecast → /forecast.html` + cron `59 2 * * *` + `X-Frame-Options: SAMEORIGIN`; `local-server.js`: rota `/forecast` + log; `novo-dashboard.html`: nav drawer ganha item "Forecast" (ícone waveform) com `switchView('forecast')` que exibe `#view-forecast` (div full-screen com mini-header + `<iframe src="/forecast">` lazy-loaded via `data-loaded`); CRO e Forecast têm nav items com classe `.active` alternada.
- **Ajustes de KPIs e l�gica do Funil (2026-06-10)**: (1) Tradu��o padronizada dos modais PT/EN p/ P02 e P03; (2) Implementa��o de fallback p/ arr_estimado ausente (usa 1� fatura * 12) nos modais e kpis; (3) T�tulo do P03 no CRO Dash e modal unificados ('Pipeline Ponderado/ano (hist�rico)'); (4) P03 tooltip 'Cen�rio (+ Implanta��o 100%)' no lugar de impl. = ganho; (5) Nova etapa 'Reuni�o Agendada' mapeada na API e ativada no P04, isolada do restante do funil ativo via _novoIsOpen; (6) Removido emoji ?? do card P03.

- **Camada visual premium (2026-06-10) | design system "Mission Control" em arquivos próprios + fonte Inter sem serifa no 1.** Três arquivos novos em `public/` (`premium.css`, `premium.js`, `fonts/InterVariable.woff2`) injetados via 2 tags (`?v=4`) antes do `</head>` dos 11 HTMLs — zero mudança no código das views; toda a estética premium vive SÓ nesses 2 arquivos (regra de manutenção: visual premium nunca inline). O que a camada faz: (1) `premium.css` sobrescreve os tokens `:root`/light (paleta mais luminosa, bg `#070b15` com aurora teal/índigo via `body::before`), cards/KPIs **sem borda** com sombras multicamada e hover lift, headers glass, tabelas refinadas, scrollbars finas, entrance stagger `.pm-in`, drawers/modal com blur; KPIs com `font-variant-numeric: normal` e `letter-spacing: 0` nos labels (pedidos do usuário). (2) `premium.js` envolve o construtor do Chart.js e remapeia a paleta legada → premium (theme-aware) com gradientes nas barras, tooltips glass, grid discreto, resolve strings `var(--x)` que canvas não entende; também injeta `NAV_MODEL` no nav (em páginas com o bloco `PANELS`, o `buildNav()` do PANELS roda depois e segue sendo a fonte efetiva do menu — sem conflito visual). (3) Integração visual do Forecast: classe `pm-forecast` no `<html>` (via premium.js) escopa a seção 14 do premium.css que traduz header/seg-ctrl/kpis/tabela-matriz/fbtns do forecast para a mesma linguagem das demais views, sem tocar no layout. (4) **Nav drawer com espaçamento idêntico em todas as páginas**: o drawer não herda mais font/line-height do body de cada view (forecast não definia line-height e os itens encolhiam) — `.nav-drawer` prega `13px/1.5`, `.nav-item` com `min-height:38px`. (5) **Fonte**: Inter variable self-hosted com a feature `cv01` congelada no arquivo via `pyftfeatfreeze` (fontTools) — o "1" sem pé serifado é o glifo padrão em DOM e canvas, inclusive com `tabular-nums` (mantido só nas tabelas); a @font-face local (família `'Inter'`) vence as faces do Google Fonts por vir depois na cascata. Laboratório de iteração: projeto irmão `dashboard-ivan-premium` (localhost:3003); fluxo de sync = copiar os 3 arquivos para cá quando aprovado.
- **Deploy de produção (2026-06-10) | camada premium no ar.** `vercel --prod --yes` (team axenya-f1a041f6, projeto dashboard-axenya) → READY. URL pública: **https://project-bsmfu.vercel.app** (a URL imutável do deploy fica atrás da Deployment Protection, usar a project-bsmfu). Verificado em produção: `/` 200, `/novo` 200, `/premium.css?v=4` 200, `/premium.js?v=4` 200, `/fonts/InterVariable.woff2?v=3` 200 (351.520 bytes = fonte congelada correta), `/api/auth/me` 401 (auth Google ativa, `LOCAL_DEV_BYPASS` ausente em prod). Deploy feito direto do working tree — mudanças ainda não commitadas no git (3 arquivos novos + injeção de 2 tags nos 11 HTMLs + esta entrada).

## Sessão dev local — 2026-06-11 (KPIs secundários, gráficos C03–C06, meta P01)

> Todas as alterações abaixo em `public/novo-dashboard.html` salvo indicação. Vários itens já foram para produção via `vercel --prod` ao longo da sessão; **as alterações de gráficos desta última leva (C03 removido, C04 emoji, C05 donut) ainda NÃO foram deployadas — deploy em bulk depois** (diretriz do usuário).

- **Correção de portal ID do HubSpot (44444289 → 44715285)** nos links de deal em 9 arquivos (`public/*.html` + `api/snapshot.js` + STATUS_LOG). Era a causa dos links quebrados no CRO Dashboard; o correto é o mesmo do Forecast (`HUB_ID`). Todos os links de nome de deal já abrem em nova aba (`target="_blank" rel="noopener"`).
- **P08 (Vidas Ponderadas) | modal:** 4 big numbers (Open Deals, Open Vidas, Idade Média, Vidas Ponderadas) + filtro de etapas em chips (`.stage-chip`), recalculando por etapa selecionada.
- **Toggle global "Implantação = Ganho"** (`_novoImplWon`, persistido em `localStorage 'novo_impl_won'`). Centraliza em `_novoIsWon` → cascateia em todos os KPIs/gráficos. Salvar Configurações agora dá `novoRender()` (probabilidades e meta refletem na hora).
- **S01 (Taxa de Ganho):** clique abre os deals ganhos; removido "Adj./Ajustada"; número nunca vermelho.
- **S02/S03 (Conversão BDR/AE):** `ganhos ÷ (ganhos + perdidos)` por origem. BDR = deal com campo BDR (interno `sdr`) preenchido; AE = sem.
- **S04 (Taxa de Reunião):** deals que entraram em Reunião Agendada e avançaram para Diagnóstico (Vendas), via interseção de IDs do `/api/funnel-stages`. Modal **Tracked | Occurred | No-show | Rate** + lista. KPI sec row (`#novo-kpisec-wrap`) re-renderiza quando o histórico de etapas chega.
- **S05 (Deals Estagnados) | modal:** Negócios Estagnados | Vidas Estagnadas | Média de Vidas por Deal.
- **S06 (Completude):** % dos deals em **Proposta Enviada, Consultoria ou Negociação** com 10 campos preenchidos (colaboradores, vidas, 1ª fatura, ARR, modelo de remuneração, agenciamento, vitalício, probabilidade, quarter, data prevista de receita). Avaliado sobre valores **crus** do HubSpot no servidor (`dados_completos`/`campos_faltantes` em `api/forecast-table.js`). Quarter conta como preenchido se apenas não-vazio.
- **S07 (Prêmio Mensal): card removido por completo** (entrada, drill, `pmTotal`, ficha, código S07).
- **Coluna BDR** na tabela compartilhada de deals (rótulo "BDR", propriedade interna `sdr`); índices/sort/tfoot ajustados.
- **API `forecast-table.js`:** + `sdr` (BDR), + `a_reuniao_ocorreu_` → `reuniao_ocorreu`, + `campos_faltantes`/`dados_completos`.
- **P01 | Meta de Receita MTD** no modal de Configurações (`np-meta`, ao lado das probabilidades), persistida em `localStorage 'novo_meta_mtd'`. Card ganha barra de progresso + `X% da meta | Meta: R$Y`; cor por atingimento (verde ≥100%, amarelo ≥70%).
- **Botão "i" dos tooltips:** 16×16 → 14×14px.
- **`premium.css`:** removida a bolinha decorativa antes do título dos cards (`.novo-card-header h3::before`). Cache-buster `premium.css`/`premium.js` `?v=4` → `?v=5` em todos os HTMLs.
- **C03 (Funil cumulativo) removido** por completo. Não confundir com o Funil de Conversão histórico (C09).
- **C04 (Risco de Concentração):** números do gráfico compactos K/M (`_novoCompactNum`/`_fmtBig`) — modal com número cheio; clique abre o Top 10 completo; título → **"Risco de Concentração Ativo (Top 10)"**; 🟡 removido.
- **C05 + C06 fundidos em um único donut** (`buildNovoSizeDonut`, canvas `chart-novo-sizedonut`, código C05): toggle Receita | Vidas; centro = total de deals abertos no pipeline; 1ª fatia (cinza) = "Sem receita"/"Sem vidas"; clique numa fatia abre os deals dela. Funções/canvases antigos removidos; ficha de ajuda consolidada em `sizedonut`.
- **Disciplina:** separador `|` reforçado (corrigido um `·` na barra de meta do P01). 🟡 preservado exceto onde o usuário pediu remoção (S01–S06, C04).
- **C07 (Valor do Pipeline por Etapa) e C08 (Receita por Segmento):** 🟡 removido. Eixo Y dos dois passou a usar `_revShort` (K para milhar, M para milhão) em vez de `R$ (v/1000)k`. **C08 ganhou toggle Bruto | Ponderado** (`_novoSegMode`; ponderado = receita × probabilidade da etapa).
- **C05 donut — refinamentos:** (1) tooltip por fatia virou **HTML externo** (`#novo-charttip`, `z-index:3000` acima do modal, `backdrop-filter: blur`) resolvendo o conflito com o número central; (2) visual premium na fatia (`borderRadius`, `spacing`, `hoverOffset`, `cutout 68%`); (3) **fatia mostra %**, tooltip mostra **contagem absoluta** (sem título duplicado); (4) **legenda à direita**, donut à esquerda; (5) **centro recalcula** ao ocultar fatias pela legenda (`_visTotal` via `getDataVisibility`); o % das fatias também passou a ser sobre o total visível; (6) lista de **etapas** movida do tooltip de fatia para o **tooltip geral** (botão `i`/`tip_sizedonut`); (7) **🟡 removido**.
- **Modal do C05 — dois filtros separados e rotulados:** "Receita" (Sem receita | < 50k | … | 1M+) e "Vidas" (Sem vidas | 1–50 | … | 5K+), combinando com **E lógico**; contagens com **cross-filter** (consideram a seleção do outro grupo); faixas vazias somem (exceto a selecionada); cada grupo com seu "Todas". `novoOpenDealsFilterModal(title, deals)` monta os dois grupos via `_novoSizeFilterBuckets(true/false)`.
- **Verificação:** `node --check` nas APIs/`local-server` OK; extração + parse dos `<script>` inline do `novo-dashboard.html` = 0 erros. O erro "fetch failed" relatado era do servidor → HubSpot (rede/token), não das mudanças de frontend (o erro ocorre antes de qualquer gráfico renderizar).
- **Deploy de produção (2026-06-11):** `vercel --prod` deste estágio (donut C05 completo, C03 removido, C04, C07, C08, meta P01, S01–S07, coluna BDR, campos da API). Alias público: https://project-bsmfu.vercel.app
- **C07 e C08 → barras horizontais** (`indexAxis:'y'`): nomes de etapas (C07) e tiers (C08) no eixo vertical, valores K/M à direita.
- **C08 — filtro por segmento:** clique abre lista completa com filtro "Segmento" (Pequeno/Médio/Grande/Enterprise) via `novoOpenDealsBucketFilterModal` (genérico de 1 grupo); título limpo ("Receita por Segmento", sem "(Tamanho)" nem 🟡).
- **`font-variant-numeric` zerado** em todas as tabelas (`table.lb`, forecast) — `tabular/lining-nums` selecionava as figuras com serifa; agora `normal` usa o glifo com `cv01` (1 sem serifa). Corrigido em premium.css + novo-dashboard/novo-48h/dashboard.
- **C09 (Funil de Conversão) — reorganização visual:** (1) removido "Ganho", "Implantação" exibida como **"Implantação/Ganho"** (verde); (2) **conversões agora vivem sobre o gráfico** (overlay nas zonas de conversão, centralizadas verticalmente) e os **números absolutos** voltaram para a barra inferior (com o rótulo da etapa em até 2 linhas); (3) barra inferior com `min-height:74px`; (4) conversão principal em destaque (1.15rem) e secundária/acumulada aumentada (.72rem); (5) **sombras removidas** das porcentagens; (6) **tooltips** nas porcentagens: a principal explica "% entre etapas consecutivas", a secundária "% em relação ao topo do funil".
- **C09 — tooltip padronizado + secundária maior:** o tooltip das porcentagens passou do `title` nativo para o **componente custom `#novo-tip`** (mesmo dos botões "i"), com `.nt-text` (descrição) + `.nt-code` (fórmula monospace, ex.: `to ÷ from = X%`). A delegação de eventos foi generalizada de `.novo-info-btn` para `.novo-info-btn,[data-tip]`, então qualquer elemento com `data-tip` usa o tooltip premium. Porcentagem secundária aumentada de `.72rem` → `.9rem` (peso 700).

## Sessão de entrega — 2026-06-12 (revisão de robustez p/ apresentação | `novo-dashboard.html` + `novo-board.html`)

> Objetivo: entregar os dois painéis com o menor risco de erro possível numa apresentação ao vivo. Decisões do usuário nesta sessão: (a) **manter os gráficos 🟡 visíveis** (são a rede de segurança "preliminar", não ocultar/remover); (b) entrega **só dos arquivos locais** (sem deploy); (c) board com o **mesmo peso** do dashboard. Foco do trabalho: não-quebrar + corrigir inconsistências reais, sem mexer no visual.

- **Backup** completo antes de tocar em qualquer coisa: `_local_trash/backup_2026-06-12_pre-entrega/` (novo-dashboard.html, novo-board.html, STATUS_LOG.md).
- **Verificação de sintaxe** (novo `scripts/_check-inline-js.js`): extrai os `<script>` inline e valida via `vm.Script`. Resultado: **0 erros** nos dois arquivos (um SyntaxError derrubaria todo o JS da página). `node --check` em todas as APIs/lib/local-server: OK.
- **Servidor local + APIs** validados na 3002: `/api/forecast-table` (327 deals sem perdidos | 1211 com `?includeLost=true`), `/api/funnel-stages` OK. Campos reais de um deal conferidos (ae, arr_estimado, close_date, createdate, dias_no_pipe, primeira_fatura, probabilidade, sdr, stage, vidas, etc.).
- **Smoke render** (novo `scripts/_smoke-render.js`): carrega os scripts inline num DOM stub (Proxy) com os **dados reais** e chama `novoRender()`; captura qualquer exceção de runtime em qualquer builder. Resultado: **ambos renderizam sem exceção** (board 327, dashboard 1211 deals) — forte evidência de que nenhuma página trava ao carregar.
- **⚠️ Correção crítica | inconsistência board × dashboard.** O `novo-board.html` usava definições antigas, divergindo do dashboard (validado) nos dois números de manchete:
  - "ARR Ganho": board contava **só `Ganho`** (7 deals / R$ 0,59M) vs dashboard **`Ganho + Implantação`** (24 deals / R$ 4,14M).
  - "Pipeline Aberto": board contava **tudo que não é Ganho** — incluindo as **166 deals em Reunião Agendada** e 17 em Implantação (320 deals / R$ 153,4M) vs dashboard que **exclui Reunião Agendada + Perdido + won** (137 deals / R$ 149,85M).
  - **Fix (aprovado pelo usuário):** board agora usa os mesmos helpers do dashboard — `_novoImplWon` (lê `localStorage 'novo_impl_won'`, default ligado), `_novoIsWon(d)` = `Ganho || (impl && Implantação)`, `_novoIsOpen(d)` = `!won && stage!=='Reunião Agendada' && stage!=='Perdido'`. `_novoOpen()` reescrito. Todas as 7 referências de won (`d.stage===NOVO_WON_STAGE`) → `_novoIsWon(d)`. **Exceção proposital:** no gráfico de Conversão (funil por etapa), o balde terminal "Ganho" continua sendo `stage==='Ganho'` literal, porque a etapa Implantação já aparece como barra própria do funil — usar `_novoIsWon` ali causaria dupla contagem. Os 🟡 foram mantidos.
  - **Confirmação end-to-end:** chamando as funções reais do arquivo já corrigido sobre o dado real → board produz **24 deals / R$ 4,14M** (won) e **137 deals / R$ 149,85M** (aberto), batendo com o dashboard.
- **Regra do separador `|`** (primária, inegociável): corrigidos os separadores proibidos visíveis ao usuário — board (` · ` na linha de status → ` | `), dashboard (`&middot;` em "Vendas: x · Bid: y" → ` | `; ` · ` nos títulos EN de C10/C11 → ` | `; travessão em prosa nos tooltips PT/EN do C-sizedist → ` | `). Placeholders `'—'` de "sem dado" preservados. (Comentários de código com `—`/`·` não são exibidos ao usuário e foram deixados.)
- **Paridade i18n PT/EN** (novo `scripts/_i18n-parity.js`): board **24/24**, dashboard **216/216**, nenhuma chave faltando em nenhuma das duas direções.
- **Tooling de verificação** deixado em `scripts/` para reuso: `_check-inline-js.js`, `_smoke-render.js`, `_i18n-parity.js`. (Scripts one-off de medição foram removidos para não confundir.)
- **Estado para apresentação:** os dois arquivos parseiam limpo, renderizam sem exceção com o dado real, mostram números consistentes entre si nas métricas de manchete, e os 🟡 seguem sinalizando os gráficos ainda não validados pelo Ivan. Nenhuma mudança visual/de layout foi feita (nesta leva).

### Auditoria crítica dos gráficos 🟡 + recoloração por veredito (2026-06-12)

> A pedido do usuário: analisar criticamente cada gráfico 🟡 (entende o que deveria mostrar vs o que mostra) e trocar o 🟡 pela cor do veredito. Método: capturar o **dataset real** de cada gráfico com dado de produção, interceptando `_novoMkChart` (`scripts/_capture-charts.js`), e cruzar com o que título/tooltip prometem.

- **Relatório completo** salvo em `AUDITORIA_GRAFICOS.md` (raiz do projeto), com tabela por gráfico, causas-raiz e como reproduzir.
- **Nova semântica do emoji** (substituiu o 🟡 nos títulos dos gráficos): 🟢 estrutura/cálculo corretos (dado de origem ainda a validar) · 🟠 calcula certo mas com ressalva (amostra pequena, escopo, cobertura parcial, outlier, proxy) · 🔴 o que mostra diverge do título. 🟡 mantido só onde NÃO houve análise (KPIs secundários pm/momentum, S01–S04, disclaimer do N20, e as chaves mortas t_funnel/t_sizedist/t_vidasdist).
- **Principais achados 🔴:** (board) Conversão = foto atual por etapa, não funil (não-monotônico, mistura Vendas+Bid, omite Reunião Agendada); ARR Bridge = só a 1ª diferença do ARR ganho mês-a-mês (negativos não são churn); Cenários de Forecast com ordem incoerente (Conservador 50% = R$74,9M > Ponderado = R$44,4M). (dashboard) N01/N03/N08 tratam a foto de abertos como funil (N08 é duplicata exata do N03); N09/N12 chamam `ganhos ÷ (ganhos+abertos)` de "taxa de ganho" ignorando os 884 perdidos; N18 "velocidade de qualificação" é tautológico (idade ~ data de criação).
- **Ressalvas 🟠 recorrentes:** outliers de vidas + carga em massa de Reunião Agendada distorcem agregações por createdate/vidas (N02; board Entrada-vs-Saída); cobertura parcial silenciosa nos gráficos de `data_prevista_para_receita` (N14/N25); ~6 duplicatas de gráficos já validados (N15=C08, N23=C07, N25≈N14, N10≈C05, N26⊃N05).
- **Recoloração aplicada** via `scripts/_recolor-emojis.js` (mapa explícito chave→cor, dry-run conferido antes do `--apply`): dashboard 78 trocas (26 gráficos × [PT+EN+drawer de ajuda]); board 24 trocas (10 títulos PT+EN + 4 KPIs → 🟢). 🟡 do dashboard: 99→21 (restantes fora de escopo); board: 24→0.
- **Efeito colateral corrigido:** os `.replace('🟡 ','')` que limpavam o emoji do título em modais/drawer (4 sites) passaram a `.replace(/^(?:🟡|🟢|🟠|🔴) /,'')` para continuarem limpando independentemente da cor.
- **Re-validação pós-mudança:** sintaxe 0 erros, smoke render OK nos dois (board 327 / dashboard 1211 deals), i18n paridade intacta (24/24 e 216/216), spot-check confirmou cores nos títulos certos (PT+EN). Novos scripts utilitários em `scripts/`: `_capture-charts.js`, `_recolor-emojis.js`.

### API | campos adicionais puxados (2026-06-12)

> A pedido: puxar na requisição os campos que charts precisam e que bastam adicionar como propriedade do HubSpot. Base de referência: o que o `dashboard-ivan` original (`lib/hubspot.js`) puxava. Backup da API em `_local_trash/backup_2026-06-12_pre-entrega/forecast-table.before-fields.js`.

- **`api/forecast-table.js`** | + `premio_mensal` (→ `premio_mensal`, prêmio mensal real, **224/1211** deals) e + `notes_last_updated` (→ `ultima_atividade` + `dias_sem_atividade`, **1144/1211** deals). Confirmados preenchidos via teste da API (200, sem 400).
- **Testados e removidos por virem vazios neste portal/endpoint:** `ls_days_in_stage` (0/1211) e `hs_date_entered_<etapaId>` (0/1211 — o endpoint de `search` não retorna esses; exigiria um `batch/read` com `propertiesWithHistory`, como o original fazia em `pullHubSpotData`). Tempo real na etapa, tempo até 1ª reunião (N18/N19) e tempo em etapa exato (N17) **dependem dessa enriquecimento via batch/read** — não é só "adicionar campo na busca".
- **Importante:** os campos novos agora estão **disponíveis** na resposta da API, mas o front ainda **não os consome** (Prêmio Mensal segue exibindo o proxy ARR/12; N07/N17 seguem nos proxies de idade). Fica como follow-up wirar: KPI Prêmio Mensal → `premio_mensal`; frescor/estagnação → `dias_sem_atividade`.
- Servidor reiniciado (require() cacheia handlers). Smoke render dos dois painéis OK com o novo shape de dados (campos extras são retrocompatíveis).

### N07 + S05 wirados para usar atividade real (2026-06-12)

> A pedido do usuário: **não** wirar `premio_mensal` ainda (ele quer entender a diferença vs ARR÷12 antes); wirar N07 e S05 para usar `dias_sem_atividade` (derivado de `notes_last_updated`). Cobertura: 135/137 deals abertos têm o campo (2 nulos, ignorados).

- **N07 Frescor de Engajamento** | `buildNovoFreshness` agora bucketa por `dias_sem_atividade` (não mais `dias_no_pipe`). Antes [1,8,27,57,11,16,17]; agora [59,26,44,6,0,0,0] (soma 135). Passa a refletir engajamento real, casando com o título. Cores green→red seguem coerentes (recém-tocado=verde, silencioso=vermelho).
- **S05 Deals Estagnados** | filtro mudou de `dias_no_pipe > 60` (44 deals) para `dias_sem_atividade > 30` (**6 deals**). Definição passa de "antigo" para "sem engajamento recente" — 0 deals ficaram 60d sem atividade, por isso o limiar foi para 30d (número útil e defensável). Tooltips/fórmula/ficha de ajuda PT+EN atualizados ("sem atividade há mais de 30 dias", campo `notes_last_updated`). `kpi2_days_stale` → "+30 dias sem atividade".
- **`premio_mensal`**: continua sendo puxado pela API mas o front segue exibindo o proxy ARR÷12 no KPI Prêmio Mensal (a pedido). Pendente: comparar premio_mensal real vs ARR÷12 antes de trocar.
- Validação: sintaxe 0 erros, smoke render OK, i18n 216/216, captura confirmou os novos datasets.

### Deploy de produção (2026-06-12)

> Inclui: alinhamento do board, recoloração dos emojis por veredito (🟢/🟠/🔴), API com `premio_mensal` + `notes_last_updated`, e N07/S05 wirados para `dias_sem_atividade`.

- Pré-voo: Vercel CLI 54.x autenticado (`jpacheco-5103`), projeto `dashboard-axenya` linkado, `.env*.local` (com `LOCAL_DEV_BYPASS`) confirmado no `.vercelignore`. Validação final (sintaxe + smoke) verde.
- `vercel --prod --yes` → **READY**. Deploy `dpl_Bkff5tYFydcyA2hB3V38ii3RrQ8P`; alias público **https://project-bsmfu.vercel.app**.
- Verificação pós-deploy: `/` 200, `/novo` 200, `/novo-board` 200, `/premium.css?v=5` 200, `/premium.js?v=5` 200; **`/api/auth/me` 401 e `/api/forecast-table` 401 → auth ATIVA (LOCAL_DEV_BYPASS ausente em prod)**. Conteúdo publicado de `/novo` contém `dias_sem_atividade` (mudanças live confirmadas).
- `premio_mensal` segue puxado pela API mas não consumido pelo front (KPI Prêmio Mensal no proxy ARR÷12, a pedido).

### Filtro de período em todas as views (2026-06-14)

> A pedido: ter o filtro de data nos 7 painéis (CRO, Board, AE, BDR, Last 48h, CS, Cotação).

- **CRO Dashboard**: redesenhado o seletor de período | presets viraram controle segmentado `.tab-sub` (Tudo/Mês atual/Mês passado/Semana passada/Semana atual/Últimos 3 meses, thumb deslizante), Trimestre virou dropdown custom, intervalo de meses ganhou month-picker custom (stepper de ano + grade jan–dez) no lugar dos `<input type=month>` nativos, agrupados como um bloco único (De | Até | Aplicar). Barra sem fundo/borda. Funil ganhou pills de período + calendário custom (substitui `<input type=date>`). Badge do período ativo ao lado do título no header sticky. Contagem de deals movida para depois da barra.
- **Outras 6 views**: novo módulo compartilhado **`public/filter-bar.js`** (classes `axf-*`, injeta o próprio CSS, singleton, auto-wire em `window.novoRender`). Incluído via `<script src="/filter-bar.js?v=1">`. Cada view guarda `window._novoDealsRaw` no fetch e refiltra `_novoDeals` por `AxFilter.inWin(d.createdate)` no topo do `novoRender`. `inWin` é tolerante (registro sem data → mantém), então CS/Cotação (sem `createdate` no `/api/forecast-table`) mostram a barra sem esvaziar. CRO mantém implementação inline própria.
- Validação headless (CDP): 6 views com barra presente, gráficos renderizam, aplicar filtro funciona, 0 erros JS.

### CRO | toggle de info/tags, modais de filtro, impl=ganho nas configs (2026-06-14)

> A pedido (itens 1–7): tooltips/modais corretos, "?" alterna info, tags de id, impl→configs, STATUS_LOG, deploy.

- **Tooltips** (item 1): auditados via subagente cruzando builder × texto. Todos presentes e coerentes; únicos placeholders honestos: N19 (requer `a_reuniao_ocorreu_`, ausente) e N20 (proxy de performance, histórico de reatribuição ausente). Nenhum tooltip quebrado.
- **Modais de campos** (item 2): cada ficha do drawer (`_novoHelpSection`) ganhou a seção **"Filtro de período usa"** com o campo de data por gráfico (mapa `NOVO_FILT_FIELD` + `NOVO_FILT_LABEL` PT/EN): abertos/estado → `createdate`; ganhos/perdidos → `close_date`; projeções (N14/N16/N25) → `data_prevista_para_receita`; funil/S04 → não usam o filtro global (data "Desde" do funil); N07/S05/N19 → não filtram por período. Fórmulas conferidas (corretas).
- **Botão "?"** (item 3): deixou de abrir o drawer "todos os gráficos" (`novoHelp` removido). Agora chama `novoToggleInfo()` → alterna `body.novo-info-on`, que mostra/oculta os `i` e as tags. `i` por gráfico continua abrindo o drawer da ficha daquele gráfico.
- **Tags de identificação** (item 4): `_infoBtn` passou a renderizar uma tag `.novo-code-tag` com o código (C01/P01/N01…) ao lado do `i` no header do card. Oculta por padrão, alternada pelo "?".
- **Implantação = Ganho** (item 5): saiu do corpo do dashboard e foi para o topo do drawer de Configurações (`np-impl-toggle`), **ON por padrão** (mantém `localStorage novo_impl_won`, default true). `_novoImplToggleHtml` removido; `_syncImplToggle` reflete o estado ao abrir/alternar.

---

## Board View | paridade com CRO + configs globais (2026-06-18)

> A pedido, em três rodadas: tornar o Board consistente com o CRO Dashboard (mesmos modais/quantidades), configurações globais entre painéis, e uma série de ajustes visuais/funcionais no Board.

### Rodada A | modais de KPI e KPIs all-time
- **B01 = P07** e **B02 = P03**: portei a tabela rica do CRO (21 colunas, ordenável, link p/ HubSpot, prob. ajustada) para o Board sob nomes `_cro*` (`_croDealsTableHtml`, `_croDealsRows`, `_croKpiStatsHtml`, `_croActivePipeline`, `_croCalcProbInfo`). B01 abre stats + tabela de ganhos (igual P07); B02 abre a tabela do pipeline ativo (igual P03).
- **CRO P07/P08/S01/S02/S03**: sem filtro temporal, passaram a contar **all-time** (mesma base do B01), em vez de restringir ao ano corrente. `_novoClosedKpiRange` mantido para os gráficos N09/N12/N22. Rótulo do P07 sem filtro virou "Todo período".
- **Drawer de campos do HubSpot ("i")**: replicado no Board idêntico ao CRO (descrição + tabela "Campo HubSpot | Como é usado" + fórmula/filtro), via `BOARD_HELP_CHARTS`.

### Rodada B | configurações globais (CRO, Board, AE, BDR, Last 48h)
- Botão ⚙ + drawer de configurações (`gs-*`) adicionado a Board, AE, BDR e 48h (o CRO já tinha). Duas opções **globais** via `localStorage` compartilhado: **Implantação = Ganho** (`novo_impl_won`) e **Ativos incluem Reunião Agendada** (`novo_active_meetings`), ambas ON por padrão. `_novoIsOpen`/`_novoOpen` dos 4 painéis passaram a respeitar `_novoActiveMeetings`. Esc/backdrop fecham o drawer; re-render imediato ao alternar.

### Rodada C | ajustes do Board
- **B03 = S01**: modal de B03 abre a tabela rica de fechados (ganhos + perdidos), igual ao S01.
- **B04 = P03**: modal de B04 abre a tabela rica do pipeline ativo, igual ao P03.
- **N06 (CRO, piperev12)**: convertido de barra para **linha**.
- **Emoji 🟡** adicionado à frente do título de todos os gráficos do Board (`c`/`cWide`).
- **B06** (Deals Ganhos/Mês): passa a começar em **Out/2025** e remove buckets (meses) vazios.
- **"i" de campos** agora também em **B01, B02, B03, B04** (entradas de KPI em `BOARD_HELP_CHARTS`; `kpi()` usa `_infoBtn`).
- **Contagem de deals** ("N deals") adicionada à frente do título de cada card de gráfico do Board, para comparar quantidades com o CRO.
- **B08** (Conversão Ajustada, gráfico) **removido** (card, builder, código e ficha).
- **B07 = C04**: tornado idêntico ao C04 do CRO | mesmo **toggle Receita/Ponderado** (`_subTabs`/`_novoValMode`/`novoSwitchValMode`), mesma base (`_croActivePipeline`) e mesmo **modal de filtro por etapa** (`novoOpenDealsStageFilterModal` + chips de etapa).
- Validação: `_check-inline-js` 0 erros nos 5 painéis; `_smoke-render` OK (board 1245 deals, dashboard 296).
- **Deploy (item 12)**: alvo correto é `axenya-f1a041f6/dashboard-axenya` (time Axenya, alias **project-bsmfu.vercel.app**), não o projeto pessoal `dashboard-ivan-visual` (Hobby, estoura o limite de 12 funções). Re-linkado o diretório ao projeto certo (`.vercel/project.json` → `prj_WlrmzEWZ9LXoRgeUCzy125UDlYLS`). `vercel --prod --yes --scope axenya-f1a041f6` → **READY** (`dpl_CWsY3gWAs5iYmcbsRTVyEsTLCLji`). Pós-deploy: `/`, `/novo`, `/novo-board` 200; conteúdo novo do Board confirmado live (emoji, B08 removido, toggle B07, ⚙).

---

## N05 | drawer do 'i' 100% PT no modo PT (2026-06-25, rodada 3)

> A pedido: o drawer do 'i' do N05 estava meio inglês/meio português no modo PT.

- Traduzidos os trechos que vazavam inglês no modo PT: título "Pipeline Coverage | Forecast vs Meta" → "Cobertura do Pipeline | Forecast vs Meta" (card `t_coverage` + ficha `NOVO_HELP_CHARTS`); fórmula `winrate` → `taxa_ganho`; camada Diagnóstico ("headcount"/"começando em createdate" → "estimativa por vidas"/"a partir da data de criação"); camada MQL ("win rate" → "taxa de ganho", "sem drill por deal" → "sem detalhamento por deal"); footer do card e nota do modal de drill ("sem drill" → "sem detalhamento").
- Mantidos termos próprios já usados no dash: Forecast, Pipeline, Fee por vida/Corretagem (valores do CRM), MQL, PME, nomes de campos do HubSpot. EN mode inalterado (segue em inglês).
- Verificado por render (inspeção do HTML do drawer em modo PT): sem frase/termo solto em inglês.
- Validação: inline 0 erros, i18n PT=257/EN=257, smoke OK.

---

## N05 | Meta global (default R$ 1,15M) + 'i' visual (2026-06-25, rodada 2)

> A pedido: meta anual pré-definida em R$ 1.150.000, salva globalmente p/ todos os usuários; e a ficha do "i" do N05 mais visual (era texto corrido).

- **Meta global** | `api/meta-receita.js` (novo): GET retorna a meta anual global (default **R$ 1.150.000**); POST salva globalmente. **KV-first** (`lib/kv`, chave `meta:receita_anual`) com fallback `os.tmpdir()/meta-receita.json` (per-instância, cross-plataforma). Requer auth. `dashboard.html`: `NOVO_META_DEFAULT=1150000`; `_novoLoadGlobalMeta()` busca a meta global no load (não-bloqueante); `_novoSaveGlobalMeta()` faz POST ao mudar (no 'i' do N05 e em Configurações). localStorage vira cache; espelhamento entre os dois inputs mantido.
- **Ressalva** | persistência durável/compartilhada de verdade exige Vercel KV ativo (env `KV_REST_API_URL`/`KV_REST_API_TOKEN`), **não configurado hoje**. Sem KV cai no `/tmp` (reseta no redeploy/cold start) — mesma limitação do `bdr-metas`.
- **'i' do N05 visual** | descrição corrida encurtada; novo `_novoCoverageHelpHtml()` injeta um bloco escaneável: 4 camadas com chips de cor batendo com o gráfico (Recorrente/Pontual/Diagnóstico est./MQL agregado), 2 cards "leituras" (cobertura principal × e cobertura de pipe), caixa "como ler" e o editor de meta no fim. `novoHelpChart('coverage')` passou a usar esse bloco como `extra`.
- **Validação** | sintaxe API OK, inline 0 erros, i18n PT=257/EN=257, smoke OK, round-trip do endpoint (GET default 1,15M → POST → GET; inválido → 400), espelhamento da meta 12/12. **25ª função serverless** (deploy ok no time axenya-f1a041f6).

---

## N05 | Pipeline Coverage v1 + Meta anual espelhada (2026-06-25)

> Reconstrução do N05 conforme `docs/coverage-pipeline-v1-spec.md`, executada em fases com decisões a cada trava.

### Meta (Configurações ⇄ 'i' do N05), agora anual
- **Espelhamento:** Meta vira fonte única (`novoSetMeta`/`_novoParseMeta`/`_novoSyncMetaInputs`). Editar no modal de Configurações (`#np-meta`) ou no editor dentro do 'i' do N05 (`#novo-cov-meta`) atualiza estado, localStorage e ambos os inputs + re-render. Editor injetado via o mecanismo `extra` do `novoHelpChart` (mesmo padrão do N06B).
- **Meta anual (não anualizada):** N05 e a tabela N21 usam a meta direto (sem ×12); P01 (MTD) deriva o alvo mensal = meta anual ÷ 12. Labels PT/EN "(MTD)" → "(Anual)".

### Motor de receita compartilhado (Decisão 9)
- **`public/revenue-engine.js`** (novo): `calcReceitaMes(n, deal) → {total, recorrente, pontual}` + `taxaRecorrente`. Lógica de `total` idêntica à `calcReceita` histórica do Forecast; acrescenta decomposição recorrente × pontual (§3.1). Incluído via `<script src>` em `forecast.html` e `dashboard.html`. `calcReceita` (forecast) e `_novoFcWonReceita` (dashboard) passam a **delegar** à fonte única (equivalência provada: 864 comparações, 1158 asserts).

### N05 reconstruído (era cobertura agregada N06B; virou Pipeline Coverage v1)
- **Escopo:** negócio novo (`createdate ≥ 2025-09-01`, Decisão 5), com aviso de escopo visível (decisão do usuário: construir como spec e reconciliar meta com a CFO depois).
- **Cálculo por deal:** receita do mês por `calcReceitaMes`, ponderada pela prob. da etapa (C06/override + ±10% do AE via `_calcProbInfo`; Ganho/Implantação = 100%). Cobertura do mês = forecast ÷ meta mensal. Segunda leitura: **cobertura de pipe** (prêmio aberto bruto, sem ponderar) como KPI de segurança (3–4× saudável).
- **Diagnóstico:** estimado pela regra da Cintia (reusa `_novoFcRuleMonthValue`: vidas × R$/vida [36/24/12] × 6%, início em createdate + 9/14/18m), 100% recorrente, camada laranja marcada "(est.)".
- **Horizonte 18 meses** (jun/26 → nov/27) para alcançar a maturação em 2027 — sem isso, Diagnóstico (+9/14/18m) e topo de funil (+15m) ficavam fora.
- **Topo de funil MQL** (agregado, Decisão do usuário): camada roxa via `_novoFcNewBizRev` (vidas originadas × R$24 × win rate, +15m), onde a Reunião Agendada é absorvida; marcada agregada/estimada, nota no drill (sem auditabilidade por deal).
- **Visual:** barras empilhadas (Recorrente + Diagnóstico est. + MQL est. + Pontual) + linha de meta mensal + rótulo × por mês (cor por faixa); 3 KPIs; drill-down deal a deal (memória de cálculo); indicador de completude honesto.
- **Fix:** `R$` duplicado nos KPIs (`_revShort` já inclui `R$`).

### Ressalvas (p/ CFO / follow-up)
- Meta: confirmar se é de negócio novo ou company-wide (numerador × denominador).
- Topo de funil usa win rate (S01), não os 3% do doc da Cintia (herdado do N06B).
- `_novoForecastCalcReceita` (bloco BID/pipe) ainda é cópia da régua — consolidar na fonte única depois.

### Validação
- `_check-inline-js` 0 erros (dashboard + forecast) · `_i18n-parity` PT=257/EN=257 · `_smoke-render` OK · testes: engine 1158/0, espelhamento da meta 12/12, coverage 12/12.

---

## BDR | aviso movido p/ modal "?" + R11 por colaboradores (2026-06-25, rodada 2)

> A pedido (2 itens).

- **Aviso do topo → modal "?"** | o banner `bdr_note` ("BDR = campo sdr… Originação usa data de entrada em Reunião Agendada…") saiu do topo da página e foi para dentro do modal de **Regras de Probabilização** (`bdrOpenRulesModal`, botão `?` do header), como primeiro parágrafo destacado. `.banner-warn` ficou sem uso (CSS inócuo).
- **R11 Distribuição de Porte por Colaboradores** | novo toggle **Colaboradores | Vidas** (`_bdrSizeMode`, `bdrSwitchSize`), **Colaboradores como padrão**. `buildBdrSizeDist` usa a dimensão ativa nas faixas (<50 / 50-200 / 200-500 / 500+); `_fPorte` (faceta dos modais) respeita o mesmo toggle. Título perdeu o "(Vidas)"; tip/ficha de ajuda atualizados PT/EN.
- **Validação** | `_check-inline-js` 0 erros; `_i18n-parity` PT=21/EN=21; `_smoke-render` OK; `_capture-charts` confirma R11 com as 4 faixas no modo Colaboradores. **Não deployado.**

---

## BDR | originação por data de entrada em Reunião Agendada, não createdate (2026-06-25)

> A pedido: no painel BDR, todos os números de originação vinham por `createdate` (data de criação do deal), quando deveriam vir pela data em que o deal entrou na etapa **Reunião Agendada** (evento real de "BDR marcou a reunião"). `createdate` é distorcido por importações em massa (ex.: 181 deals num mês, na auditoria).

- **api/forecast-table.js** | exposto novo campo `data_reuniao_agendada` = `hs_v2_date_entered_1144746905` (Vendas | Reunião Agendada). Custo zero: a propriedade já era buscada (usada em `stage_days`).
- **public/bdr.html** | nova dimensão de data de originação centralizada: `BDR_ORIG_DATE='data_reuniao_agendada'` + helpers `_origDate()`, `_oym()`, `_origDeals()` (filtra pela janela global E exige a data; deals sem entrada em Reunião Agendada ficam de fora das séries de originação, sem fallback p/ createdate). Todos os gráficos de originação migrados de `createdate` → data de Reunião Agendada: R12 Originação por BDR, R13 Weekly Origination, R14 Novos Leads BDR×AE, R15 Handoff Matrix, R07 Net Flow Deals (só inflow; saídas seguem `close_date`), R08 Net Flow Vidas, R09 Vidas Médias, R10 BDR vs Não BDR, R11 Distribuição de Porte, + KPIs de cabeçalho (createdBdr/newTotal/newBdr/avgVidas) e builders mortos R05/R06. `_fMes` e o donut R10 também.
- **Auditabilidade** | coluna **Reun. Ag.** adicionada às tabelas dos modais (ao lado de Criado/Fechado); banner, tooltips, fichas de ajuda (`BDR_HELP_CHARTS`, +3 fichas: origin/weekly/leads) e subtítulos atualizados PT/EN para citar a data de entrada em Reunião Agendada.
- **Cobertura (dados reais)** | 908/958 deals BDR (94,8%) têm a data; dos 50 sem, 47 são Perdido sem histórico da etapa. 22 deals (2% dos com ambas datas) mudam de mês — exatamente os casos de importação que motivaram o pedido (ex.: criado 2024-03, reunião agendada 2025-1X).
- **Validação** | `node --check api/forecast-table.js` OK; `_check-inline-js` 0 erros; `_i18n-parity` PT=21/EN=21; `_smoke-render` OK; `_capture-charts` confirma séries bucketizadas pela data de Reunião Agendada. **Não deployado** — vale no próximo `vercel --prod`.

---

## Auth | liberar gramos + jdutra (deploy não pegava env var) (2026-06-25)

- **Sintoma:** `gramos@axenya.com` travava na tela de login ("Acesso não autorizado"); `jdutra@axenya.com` passava da tela mas os dados não carregavam (todas as `/api/*` em 401). Ambos já constavam na env var `ALLOWED_EMAILS` do Vercel.
- **Causa:** o Vercel **não aplica mudança de env var sem novo deploy**. O último deploy de produção era anterior à edição da lista, então as funções live ainda rodavam com o `ALLOWED_EMAILS` antigo (sem os dois e-mails). `isEmailAuthorized()` retornava `false` para ambos; a assimetria era só o caminho de acesso (gramos pelo botão Google → rejeição explícita; jdutra pela URL `/dashboard` direta → HTML estático carrega, mas API em 401).
- **Fix:** array `AUTHORIZED_EMAILS` em `lib/auth.js` sincronizado com a env var (`+salencar, +jdutra, +gramos`) para robustez (independe de propagação de env), e novo deploy de produção (`dpl_Fx29S2zr9QAKQi85tf3aA8yRqs8d` → **READY**, alias `project-bsmfu.vercel.app`).
- **Validação:** `node --check lib/auth.js` OK; `isEmailAuthorized` → `true` p/ os dois (case-insensitive). Pós-deploy: `/`, `/novo`, `/novo-board` → 200; `/api/auth/me` e `/api/forecast-table` → 401 (auth ativa, sem bypass em prod).
- **Pendências anotadas (não tratadas):** `ALLOWED_ORIGIN` vazia em prod (cai no fallback `pipeline.axenya.com`, ≠ domínio atual — latente, não quebra same-origin); se `gramos` ainda travar no Google, checar *Test users* na tela de consentimento OAuth do Google Cloud Console.

---

## BDR | R12 metas coloridas + colaboradores + salvar globalmente (2026-06-24)

- **R12 buildBdrOrigin()** | barras coloridas por atingimento de meta: verde ≥100%, amarelo ≥85%, laranja ≥70%, vermelho <70%. Lookup fuzzy por primeiro nome se nome HubSpot não casa com `window.BDR_METAS`. Apenas no modo Deals.
- **R12, R13** | novo toggle **Colaboradores** (soma `d.colaboradores`) em ambos os gráficos; `_bdrOriginMode` e `_bdrWeeklyMode` aceitam `'colaboradores'`; builders atualizados.
- **N09 buildNovoReassign()** | fallback diferencia estado: spinner + "Carregando..." quando `_novoFunnelLoading===true`; texto estático "Carregue o funil" apenas quando nunca iniciado.
- **C06 btn-load-funnel** | removido texto "Carregar" do botão; mantido apenas o ícone SVG (tooltip via `title` attribute).
- **api/bdr-metas.js** (novo) | GET retorna metas globais (`/tmp/bdr-metas.json` ou defaults); POST salva globalmente. Requer auth.
- **settings-modal.js** | botão único substituído por dois: **Salvar Probabilidades** (localStorage, local) e **Salvar Metas** (POST `/api/bdr-metas`, global todos usuários). `novoOpenSettings` busca metas frescas da API (não-bloqueante). `novoSaveSettings` mantido como alias de `novoSaveProbs`.
- i18n: PT=257/EN=257 (inalterado).

---

## Board + CRO | consolidação de gráficos mensais e por etapa (2026-06-18, rodada 2)

> A pedido (itens 1–8). Duas instruções se contradiziam e foram confirmadas com o usuário: **N10** (item 1 pedia corrigir, item 3 remover → confirmado **remover**); **B05/B06/B13** (itens 6 e 7 se sobrepunham no B06 → confirmado **tudo num card só**).

- **N06 (CRO, piperev12)** já estava como linha (rodada anterior). Sem mudança nesta rodada.
- **N11 (CRO, piperevstage)** | ganhou toggle **Bruto/Ponderado** (`_novoPipeRevStageMode` + `novoSwitchPipeRevStage`). Absorve a função do antigo N12.
- **N12 (CRO, weightedrevstage)** | **removido** (card, builder `buildNovoWeightedRevStage`, chamada). Sua visão virou o modo "Ponderado" do N11 (item 3).
- **N10 (CRO, wonmonthly)** | **removido** (card, builder `buildNovoWonMonthly`, chamada) | decisão do usuário (item 1 × item 3).
- **B09 = C03 (Board)** | portado o donut **Distribuição por Tamanho** com toggle **Receita/Vidas** (`buildBdSizeDonut`, `_novoSizeDistMode`, `novoSwitchSizeDist`), o **"i"** atualizado e o **modal de filtro cruzado** Receita×Vidas (`novoOpenDealsFilterModal` + `_novoVf*` + `_novoSizeFilterBuckets`), usando a tabela rica `_croDealsTableHtml`. Base = pipeline ativo (`_croActivePipeline`). Substitui o antigo gráfico de barras de porte (item 4).
- **B11 (Board, entry-exit)** | virou **gráfico de linhas** e a ordem das séries passou a **Entrada, Perdidos, Ganhos** (item 5).
- **B05/B06/B13 → um card só (Board)** | `buildBdRevTrend` virou um card combinado com toggle (`_bdMonthlyMode` + `novoSwitchBdMonthly`): modo **"Receita & Ganhos"** = barras (nº de deals ganhos) + linha (receita ARR), **meses sem receita ocultados**; modo **"Porte Médio"** = linha de vidas médias. Cards **B06 (won-monthly)** e **B13 (won-size)** removidos (builders, fichas e códigos) (itens 6+7).
- Validação: `_check-inline-js` 0 erros (board + dashboard); `_smoke-render` OK (board 1245, dashboard 296); sem referências órfãs aos builders/canvas removidos.
- **Deploy**: não solicitado nesta rodada.
- **Separadores**: novas strings seguem a Regra 1 (só `|`; corrigidos `—`/`·` introduzidos).
- Validação: sintaxe 0 erros; CDP confirmou default oculto → "?" revela tag+`i`, drawer do `i` com a linha do campo de data, e toggle em Configurações ON.

### Auditoria de idiomas PT/EN (2026-06-15)

> A pedido: garantir que PT fique em PT e EN em EN (nada de idioma vazando).

- **Paridade do dicionário**: `NOVO_I18N` do CRO conferido por script — 238/238 chaves PT=EN, 0 chaves faltando, todas as ~212 chamadas `t()` com chave nos dois idiomas. Sub-views board/ae/bdr/48h também limpas (24/24, 24/24, 21/21, 18/18). CS e Cotação **não têm i18n** (PT-only por design, sem toggle de idioma) — o `filter-bar.js` cai no default PT nelas, consistente.
- **Strings hardcoded localizadas** (mostravam PT no modo EN): arrays de mês/dia dos date-pickers do CRO (`_DP_*` → `_dpData()` por `NOVO_LANG`) usados no calendário do funil, month-picker do filtro e badge; o array `MON` do `filter-bar.js` (→ `MON_()` por idioma) usado nas 6 views; o card do Funil (título, tip, "Desde", "Ambos/Vendas/Bid", pills de período, "Personalizar", "Carregar", textos de loading) agora via `t()` (chaves novas `fnl_*` + reúso de `lbl_last30/90`, `lbl_all_time`, `vendas`, `bid`, `kpi2_meeting_loading`); toggle "Implantação = Ganho" e cabeçalho das Configurações ("Configurações"/"Meta Receita Ganha (MTD)") via `t()` (`cfg_*`, `impl_won_label`). Nomes de etapa (Cotação, Negociação…) mantidos em PT por serem nomes próprios do CRM (aparecem PT em todos os gráficos nos dois idiomas).
- Validação CDP em EN: funil = "Historical Conversion Funnel | Since | Both/Sales/Bid | Last 30d/Last 90d/All time | Load", calendário "August 2025" + DOW "SMTWTFS", month-pickers "Jan Feb Mar Apr" (CRO e sub-view AE), Configurações "Settings / Won Revenue Target (MTD) / Implementation = Won". 0 erros JS. Sintaxe 0 erros, paridade 238/238.
- **Pendência conhecida**: o conteúdo do drawer de ajuda (`NOVO_HELP_CHARTS` — desc/fields/formula dos 40+ gráficos) segue só em PT; em EN o "i" mostra as fichas em PT. Tradução não feita (volume alto + risco de erro técnico) — fica como follow-up se desejado.

### Limpeza de nomes de arquivo (2026-06-15)

> A pedido: excluir `dashboard.html` (Electron legado) e `hubspot-watcher.html`; remover o prefixo `novo-` dos demais HTMLs; sem quebrar links.

- **Excluídos:** `public/dashboard.html` (o 1MB legado, não estava nem roteado) e `public/hubspot-watcher.html` (`git rm`).
- **Renomeados (`git mv`):** `novo-dashboard.html`→`dashboard.html`, `novo-board`→`board`, `novo-ae`→`ae`, `novo-bdr`→`bdr`, `novo-48h`→`48h`, `novo-cs`→`cs`, `novo-cotacao`→`cotacao`. `forecast.html`/`login.html` inalterados.
- **Rotas preservadas de propósito** (`/novo`, `/novo-board`, …) para não quebrar links já compartilhados. A navegação (PANELS `url`, `<li>`, premium.js) e o redirect do login usam rotas — nada quebra. Repontados os `destination` do `vercel.json` e o mapa do `scripts/local-server.js` para os novos arquivos; rota `/watcher` removida.
- **`PANELS.file`** atualizado em todas as views (`file:'novo-X.html'`→`file:'X.html'`) p/ o highlight do item ativo por acesso direto a `.html`. Scripts `_recolor-emojis.js`/`_verify-filter.js` repontados.
- **Validação:** `vercel dev` na 3002 — rotas `/novo`, `/dashboard`, `/novo-board…/forecast` e arquivos diretos (`/board.html`, `/ae.html`, `/dashboard.html`) → 200; antigos (`/novo-*.html`, `/hubspot-watcher.html`, `/watcher`) → 404. CDP: `/novo` 25 gráficos (ativo "CRO Dashboard"), `/novo-board` 10 (ativo "Board View"), `/cs.html` ativo "CS Dashboard"; 0 erros JS. Sintaxe 0 erros; `vercel.json` JSON válido. **Ainda não deployado** — vale no próximo `vercel --prod`.

### Sair/Idioma/Tema movidos para a base do menu esquerdo (2026-06-15)

> A pedido: como o menu superior direito é ajustável por painel, mover Sair, Idioma e Tema para o rodapé do menu lateral (compartilhado entre painéis).

- Novo **`.nav-drawer-footer`** (com `.nav-foot-btn`) fixado na base do nav-drawer via `margin-top:auto`; renderizado pelo `buildNav` (após o `</ul>`), em todos os painéis.
- **Removidos do header** (`.hdr-actions`) os botões Sair (`doLogout`), Idioma (`novoToggleLang` + `novo-lang-label`) e Tema (`toggleTheme`) nos 7 painéis padrão; foram para o rodapé. O `novo-lang-label` agora vive só no rodapé (label mostra o idioma-alvo: EN quando atual é PT).
- **Forecast** (estrutura própria, sem i18n): rodapé com **Sair** (`logout()`) + **Tema** apenas (sem Idioma).
- **Bug corrigido:** os setters de `novo-lang-label` nas sub-views (`novoToggleLang` + init IIFE) eram **sem guarda** e quebravam ao rodar antes do `buildNav` criar o rodapé (`Cannot set properties of null`). Envolvidos em `(function(_e){if(_e)…})(…)` nas 6 sub-views. O CRO já era guardado.
- **Validação CDP:** rodapé presente em todas as views (3 botões nos 7 padrão, 2 no forecast); header sem os 3; idioma (EN↔PT) e tema (dark↔light) alternam pelo rodapé; **0 erros JS** em todas. Sintaxe 0 erros. Deployado em 2026-06-15.

### Reset dos emojis de título para 🟡 (2026-06-15)

> A pedido: re-adicionar o 🟡 à frente de TODOS os gráficos (e KPIs), pois o usuário vai re-validar todos. Reverte a recoloração por veredito da auditoria de 2026-06-12.

- **Reversão dos vereditos** (`🟢/🟠/🔴` → `🟡`) nos títulos de `dashboard.html` (63 títulos) e `board.html` (24), trocando só `'<emoji> ` (aspa+emoji+espaço) — preserva as 4 regex de limpeza `/^(?:🟡|🟢|🟠|🔴) /` (que ficam intactas com as 4 cores).
- **Adição de 🟡 onde faltava** (escolha do usuário: gráficos + KPIs): 48 ocorrências (PT+EN) nos cards que nunca tiveram emoji — C-series (`title_vidas_ae`, `t_stage`, `t_conc`, `t_sizedonut`, `t_stageval`, `t_segment`), funil (`fnl_title`), `t_freshness`/`t_waterfall`/`t_risktriage`, e os 14 KPIs (`kpi_*_label`, `kpi2_*_label`). Lista de chaves derivada do render (`t('t_…')`/`label:t('kpi…')`), nunca de labels de filtro/tabela.
- ae/bdr/48h/cs/cotacao já estavam todas 🟡 (nunca recoloridas). Forecast: os 🟢/🔴 são legenda de fluxo ("🟢 Avanço" / "🔴 Saiu do funil"), **não** vereditos de título — mantidos.
- **Não tocado:** títulos das fichas do drawer de ajuda ("i") — superfície de referência separada (deixados como estavam).
- **Validação CDP:** os 46 títulos visíveis do CRO (cards de gráfico + KPI) começam com 🟡; 0 coloridos, 0 sem emoji, 0 erros JS. Sintaxe 0 erros; `🟢🟠🔴` restantes no dashboard = 12 (só as 4 regex). **Não deployado** — vale no próximo `vercel --prod`.

### Removidos os gráficos C04 e N26 (2026-06-15)

> A pedido: remover o C04 (Risco de Concentração Ativo | Top 10, `conc`) e o N26 (Triagem de Risco | Top 20, `risktriage`) do CRO Dashboard.

- Removidos os blocos de render dos dois cards e as chamadas `buildNovoConc()` / `buildNovoRiskTriage()` em `dashboard.html`.
- Funções builder, `novoSwitchConcMode`, e as entradas de `NOVO_HELP_CHARTS`/`NOVO_CARD_CODES`/i18n dos dois ficaram como código morto inócuo (nenhum "i"/render as referencia). Podem ser purgadas depois se quiser.
- **Validação CDP:** `chart-novo-conc` e `novo-risktriage-body` ausentes do DOM; nenhum título Concentração/Triagem; 29 cards; 0 erros JS. Sintaxe 0 erros. **Não deployado.**

### Horários travados em GMT-3 (2026-06-15)

> A pedido: os horários exibidos devem ficar sempre em GMT-3 (Brasília), independente da máquina/servidor.

- Adicionado `timeZone:'America/Sao_Paulo'` ao `toLocaleTimeString('pt-BR', …)` que gera o "Atualizado às" no `dashboard.html` e nas 6 sub-views (board, ae, bdr, 48h, cs, cotacao). O `forecast.html` já usava `timeZone: 'America/Sao_Paulo'`.
- Antes era `new Date().toLocaleTimeString(...)` puro = fuso da máquina de quem abre (ok no Brasil, mas dependente do cliente). Agora é fixo em Brasília.
- Datas (close_date, última atividade, filtros) são date-only (sem hora) — não afetadas.
- **Validação:** prova determinística no Node com `TZ=UTC` → sem timeZone dá hora UTC, com `America/Sao_Paulo` dá 3h atrás (GMT-3). Sintaxe 0 erros nos 7 arquivos. **Não deployado.**

### P01 (Receita Ganha) | data = entrada em Ganho/Implantação (2026-06-15)

> A pedido: P01 deve considerar o mês atual inteiro, e a data do "ganho" deve ser a ENTRADA na etapa "Negócio Ganho" (pipe Vendas); como nem todo deal passa por Ganho (alguns vão direto p/ Implantação), usar a entrada em "Implantação" (Vendas) como fallback.

- **Descoberta:** `hs_date_entered_<stageId>` (v1) vêm **vazias** na busca; as **`hs_v2_date_entered_<stageId>`** vêm **populadas** (testado ao vivo). 
- **`api/forecast-table.js`:** + props `hs_v2_date_entered_1144844314` (Vendas Ganho) e `hs_v2_date_entered_1288611084` (Vendas Implantação); expostas como `data_ganho` e `data_implantacao` por deal.
- **`dashboard.html` (P01):** `wonMtdDeals` agora = deals ganhos (Ganho+Implantação) cuja **won-date** cai no mês atual, onde won-date = `data_ganho || data_implantacao || close_date`. Calculado sobre todos os ganhos (independe do filtro global = sempre mês atual). Tip/fórmula/ficha de ajuda e "Filtro de período usa" (novo rótulo `won`) atualizados (PT+EN).
- **Fallback `closedate`:** deals do pipe **Bid** (sem datas de etapa do Vendas) caem no closedate. Só Vendas usa as datas de entrada de etapa, conforme pedido.
- **Validação (endpoint local):** 24 ganhos (8 com data_ganho, 21 com data_implantacao); P01 do mês atual (2026-06) = 4 deals, todos via entrada em Implantação (ex.: Sipolatti, que fechou em maio mas entrou em Implantação em 01/06 — antes era perdido pelo closedate). Sintaxe 0 erros. **Não deployado.**

### Auditoria de filtros/data do CRO Dashboard (2026-06-15)

> A pedido: passar pente fino em `public/dashboard.html` para aumentar a confiabilidade dos gráficos, distinguindo quais usam filtro global e qual campo de data governa cada um.

- **Camada comum de datasets:** adicionados helpers explícitos em `dashboard.html`: `_novoDealsByDate(field)`, `_novoOpen()` (abertos por `createdate`), `_novoOpenRaw()` (abertos atuais sem filtro), `_novoWon()`/`_novoLost()` (por `close_date`), `_novoForecastOpen()` (por `data_prevista_para_receita`) e `_novoCurrentActivePipeline()` (pipeline ativo sem filtro, exclui Ganho/Perdido/Implantação/Standby). Objetivo: parar de cada gráfico reinventar seu próprio universo de deals.
- **Correções de borda temporal:** N01 (fluxo semanal) e N02/N14/N16/N22/N25 agora conferem a data exata com `_novoInWin(...)` antes de agregar por semana/mês, evitando incluir mês/semana inteira quando o filtro começa ou termina no meio do período. Drill-downs de projeção/visibilidade também passaram a respeitar a janela exata.
- **Estado atual vs período selecionado:** S05 (stale), N07 (freshness), S08 (momentum) e pipeline ativo usam `open_all`/estado atual, não são truncados pelo filtro global. S06 continua por `createdate`. P03 e gráficos de pipeline filtráveis continuam por `createdate`.
- **P01/P02 ajustados:** P01 sem filtro segue MTD e mostra barra de meta; com filtro ativo, vira **Receita Ganha no Período** e usa `data_ganho || data_implantacao || close_date` dentro da janela selecionada. P02 sem filtro segue ano atual; com filtro ativo, vira ARR ganho no período por `close_date`. A barra de meta MTD fica oculta quando há filtro ativo para não comparar trimestre/custom contra meta mensal.
- **N21 ajustado:** sem filtro, mantém MTD/YTD; com filtro ativo, mostra receita ganha e ARR dos deals do período selecionado em vez de zerar/recortar pelo mês/ano corrente.
- **Documentação de ajuda:** `NOVO_FILT_FIELD` atualizado para `kpi2-momentum:none` e `risktriage:none`; tooltip/fórmula do P01 atualizados PT/EN para explicar a semântica dual (MTD sem filtro, período quando filtrado).
- **Validação:** `node scripts/_check-inline-js.js public/dashboard.html` → 0 erros; `node scripts/_i18n-parity.js public/dashboard.html` → PT=248 / EN=248, 0 chaves faltando. `scripts/_verify-filter.js` não validou dados reais porque `localhost:3002/api/forecast-table` retornou texto/erro em vez de JSON (ambiente local/API não disponível/autenticado), então fica pendente uma validação CDP/API com servidor local autenticado.

### Auditoria Board/AE/BDR/48h/CS/Cotação | filtros, ajuda, modais e títulos (2026-06-15)

> A pedido: usar a reunião de validação de 12/06 como critério de acurácia, revisar os painéis secundários e reduzir risco de refação antes da revisão dos números.

- **Contexto extraído da reunião Ivan/Aurilia:** prioridade é filtro/data antes de validar; responder “vou ou não vou bater a meta”; conversão ajustada = `ganhos ÷ (ganhos + perdidos)`; snapshot de pipeline aberto não deve ser confundido com período; métricas de resultado usam data de fechamento/ganho; forecast usa data prevista; implantação conta como ganho por padrão, mas é capital a risco; evitar números “verdes”/definitivos sem validação.
- **Board View (`board.html`):** deixou de filtrar `_novoDeals` globalmente por `createdate`. Carrega `/api/forecast-table?includeLost=true`; adicionados helpers por semântica (`_rawDeals`, `_dealsByDate`, `_novoWon`, `_novoLost`, `_novoForecastOpen`). KPIs e gráficos de receita/ganhos agora usam `close_date`; pipeline aberto/concentração/porte usam snapshot atual sem filtro; forecast usa `data_prevista_para_receita` quando há filtro ativo; entrada vs saída separa entrada por `createdate` e saída por `close_date` em ganhos e perdidos; conversão virou **Conversão Ajustada (Ganhos vs Perdidos)**. Drill-downs ganharam colunas de auditoria: Pipe, Etapa, Vidas, ARR, Prob., Criado, Fechado, Dt. Receita e Motivo perda.
- **AE Performance (`ae.html`):** deixou de filtrar a base inteira por `createdate`. Carrega `includeLost=true`. Pipeline/vidas/ARR aberto/completude/aging viraram snapshot atual; receita e ganhos mensais usam `close_date`; win rate por AE virou taxa ajustada `ganhos/(ganhos+perdidos)` por `close_date`; modais ganharam Pipe, Criado, Fechado e Motivo perda. Help/tooltips corrigidos para não falar mais `ganhos+abertos` ou `stage=Ganho` quando a lógica usa implantação como ganho conforme toggle.
- **BDR Performance (`bdr.html`):** erro crítico corrigido: origem BDR deixou de usar `colaboradores > 0` e passou a usar o campo real `sdr`. Entradas usam `createdate`; saídas usam `close_date`, separando ganhos e perdidos; snapshots abertos usam pipeline atual. Help/tooltips atualizados para `sdr`, e modais agora exibem BDR, AE, Pipe, Etapa, Vidas, ARR, Criado e Fechado.
- **Last 48h (`48h.html`):** painel explicitamente tratado como janela fixa, não como painel filtrável. Removida aplicação do filtro global para não esconder ganhos recentes criados antes do período. Novos deals usam `createdate`; ganhos recentes usam `close_date` e respeitam implantação como ganho quando o toggle global está ON. Tooltips/help atualizados para dizer “etapa atual dos novos deals”, não etapa histórica de entrada. Modais ganharam colunas de auditoria.
- **CS Dashboard (`cs.html`) e Cotação (`cotacao.html`):** mantidos como proxies honestos até APIs próprias existirem. Removida aplicação do filtro global por `createdate`, porque distorcia snapshot de base CS/deals em cotação. Textos dos cards passam a dizer “proxy” e “sem filtro de período”; tooltips deixam claro que CS usa deals em `Ganho` e Cotação usa deals atualmente em etapa `Cotação`. Erros de API agora são exibidos em vez de cair silenciosamente em dashboard vazio.
- **Emojis removidos:** removidos emojis dos títulos dos painéis e títulos/cards visíveis de `board.html`, `ae.html`, `bdr.html`, `48h.html`, `cs.html` e `cotacao.html`; também removidos ícones decorativos de placeholders/alertas nesses arquivos para evitar aparência de validação/temperatura.
- **Idioma:** dicionários PT/EN dos painéis traduzidos (`board`, `ae`, `bdr`, `48h`) mantidos em paridade; textos técnicos principais dos tooltips ajustados nos dois idiomas. CS/Cotação seguem majoritariamente PT-only por serem proxies/placeholder sem i18n completo, mas não alternam semântica de dados.
- **Validação:** rotas locais `/novo-board`, `/novo-ae`, `/novo-bdr`, `/novo-48h`, `/novo-cs`, `/novo-cotacao` → 200. API local `/api/forecast-table?includeLost=true` → 200. Sintaxe inline: 0 erros nos 6 arquivos. Smoke render com dados reais: OK em todos (Board/AE/BDR com 1233 deals incluindo perdidos; 48h/CS/Cotação com 305 deals sem perdidos). Paridade i18n: Board 24/24, AE 24/24, BDR 21/21, 48h 18/18.

### Alinhamento P03/P08/P06/S01-S03 no CRO Dashboard (2026-06-15)

> A pedido: resolver divergências de contagem entre P09, P03, P08, P02, P06 e S01/S02/S03.

- **P03 e P08 alinhados com P09:** P03 (`Pipeline Ponderado`) e P08 (`Vidas Ponderadas`) agora usam exatamente a mesma base de deals do **P09 | Pipeline Ativo**: exclui Ganho, Perdido, Implantação e Standby/Stand by; inclui Reunião Agendada e demais etapas ativas. Antes P03/P08 usavam `_novoOpen()` (excluía Reunião Agendada e incluía Standby), por isso o modal mostrava ~150 negócios enquanto P09 mostrava ~280. Agora o KPI, os pequenos KPIs do modal e a tabela usam a mesma lista.
- **P03 modal:** adicionado resumo por etapa no modal de P03, com chips e contagem por etapa, antes da tabela de deals. O modal de ajuda (`i`) de P03/P08 também foi atualizado para listar etapas incluídas/excluídas e deixar claro que não usa filtro de período.
- **P06 alinhado com P02:** P06 (`Vidas Ganhas`) agora usa a mesma base de deals do P02. Sem filtro global: ganhos com `close_date` no ano atual; com filtro ativo: ganhos com `close_date` na janela selecionada. Antes P06 usava todos os ganhos carregados e podia mostrar 24 enquanto P02 mostrava 22.
- **S01/S02/S03 alinhados:** S01 (`Taxa de Ganho`) agora usa a mesma janela fechada do P02/P06 para ganhos e perdidos (`close_date` no ano atual sem filtro, ou período selecionado com filtro). S02/S03 mostram no subtítulo quantos **ganhos totais** entram na base e seus modais passaram a abrir a base fechada (ganhos + perdidos) daquele recorte, não apenas os ganhos.
- **Emojis removidos:** removido o emoji amarelo de P02 (`Receita Ganha`) e S01 (`Taxa de Ganho`), pois a base de contagem foi normalizada. P03/P08 permanecem com `🟡` por ainda dependerem de probabilidade/qualidade de campos do pipeline.
- **Validação:** `node scripts/_check-inline-js.js public/dashboard.html` → 0 erros; `node scripts/_i18n-parity.js public/dashboard.html` → PT=248 / EN=248. Validação com API real não foi concluída nesta rodada porque o servidor local em `3002` não permaneceu ativo durante a chamada de ferramenta; a lógica foi validada estaticamente e deve ser conferida visualmente no localhost.

### Ajustes finais de KPIs CRO | P03/P01/S02/S03/S05/S06/S08 (2026-06-15)

> A pedido: remover P03 e S06, enriquecer modais e remover emojis de cards já normalizados.

- **P03 removido do render:** o card `Pipeline Ponderado/ano` saiu da linha de KPIs primários. A lógica/helper ficou inócua por enquanto, mas não aparece mais na UI.
- **P01 enriquecido:** a tabela do modal passou a mostrar os campos que explicam o número do card: `Data usada | Origem`, `Data Ganho`, `Data Impl.`, `Fechamento`, `ARR Est.`, `Receita Mensal Calc. (ARR÷12)` e demais campos de auditoria. O total do rodapé agora soma ARR e receita mensal calculada.
- **S02/S03 sem emoji:** removido o `🟡` dos labels de `Conversão BDR` e `Conversão AE`, mantendo o subtítulo com `ganhos totais` para explicitar quantos deals ganhos entram na base.
- **S05 alinhado com P09:** `Deals Estagnados` agora usa a mesma base do P09 (`Pipeline Ativo`) como denominador. O subtítulo mostra `stale / total ativos`; o modal ganhou mini-card de `Abertos considerados` e a tabela compartilhada passou a incluir a coluna `Dias sem atividade` logo após `Últ. Atividade`.
- **S08 enriquecido:** o modal de Momentum ganhou dois mini-KPIs: `Criados últimos 30d` e `Criados 30d anteriores`, além da tabela dos deals recentes.
- **S06 removido:** o card `Completude` saiu do bloco de KPIs secundários; o cálculo pode ser purgado depois se desejado.
- **Validação:** sintaxe inline OK (`0 erros`), i18n OK (`PT=252 / EN=252`), localhost `/novo` respondeu 200, smoke render com dados reais OK (`1234 deals`).

### Ajustes S04/P08 e remoção de emojis P01/P06/S05 (2026-06-15)

> A pedido: S04 deve responder ao filtro global; P08 deve subir para Pipeline Ativo; P01/P06/S05 sem emoji amarelo.

- **S04 impactado pelo filtro:** `_novoMeetingStats()` agora cruza os IDs do funil histórico (`/api/funnel-stages`) com `_novoDeals` e, quando há filtro global ativo, restringe a base de Reunião Agendada/Diagnóstico aos deals cujo `createdate` cai na janela selecionada. Como o endpoint de funil não retorna a data de entrada por etapa no payload, o front usa `createdate` como dimensão disponível para o filtro global; a memória de cálculo passou de `funnel` para `create`.
- **P08 movido para Pipeline Ativo:** `Vidas Ponderadas` saiu da seção “Período Selecionado” e entrou na seção **Pipeline Ativo**, sem filtro de data, usando a mesma base do P09 (exclui Ganho, Perdido, Implantação e Standby; inclui Reunião Agendada). O drill de P08 permanece com chips por etapa e tabela.
- **Emojis removidos:** removido `🟡` dos labels de P01 (`Receita Ganha MTD`), P06 (`Vidas Ganhas`), P08 (`Vidas Ponderadas`) e S05 (`Deals Estagnados`) em PT/EN.
- **Validação:** `node scripts/_check-inline-js.js public/dashboard.html` → 0 erros; `node scripts/_i18n-parity.js public/dashboard.html` → PT=252 / EN=252; localhost `/novo` → 200; smoke render com dados reais OK (`1235 deals`).

### Regra configurável de Reunião Agendada em Ativos + contadores C-cards (2026-06-15)

> A pedido: S04 filtrável, C01/C02/C05/C07/C08 com total considerado, toggle de Reunião Agendada nos ativos, remoção de emojis e ajustes C01/C02/P07.

- **Novo toggle em Configurações:** adicionado `Ativos incluem Reunião Agendada` (`novo_active_meetings`, ON por padrão), ao lado de `Implantação = Ganho`. Quando OFF, Reunião Agendada fica fora dos negócios ativos. A regra foi centralizada em `_novoIsActivePipelineDeal()` e `_novoIsOpen()` também passou a respeitar o toggle.
- **C01/C02/C05/C07/C08 na seção Pipeline Ativo:** criada seção visual `Pipeline Ativo` antes dos cards C01/C02/C05/C07/C08. Todos agora usam `_novoCurrentActivePipeline()`/dataset ativo centralizado e não usam filtro de data. Cada título mostra, em pequeno, o total de deals considerados naquele gráfico (`N deals`).
- **C01 modal com filtro por AE:** ao clicar em uma barra do C01, o modal abre com chips por AE e opção `Todos`, permitindo alternar o recorte dentro do modal sem reabrir o gráfico.
- **C02 vidas em K:** eixo/tooltip da série de Vidas em C02 agora usa `_novoCompactNum()` para evitar números longos com zeros de milhar.
- **S04 segue filtro global:** `_novoMeetingStats()` agora cruza os IDs do funil histórico com `_novoDeals`; quando há filtro global ativo, restringe Reunião Agendada/Diagnóstico a deals com `createdate` na janela. O `NOVO_FILT_FIELD` de S04 mudou para `create`.
- **P07 ajustado:** label de `Vidas Perdidas` sem emoji; valor do card passa a usar `_novoCompactNum()` (ex.: `3,4M`) em vez do número cheio.
- **Emojis removidos:** removidos `🟡` dos títulos/labels P01, P06, S05, C01, C02, C05, C07, C08 e P08 em PT/EN.
- **Validação:** sintaxe inline OK (`0 erros`), i18n OK (`PT=254 / EN=254`), localhost `/novo` → 200, smoke render com dados reais OK (`1235 deals`).

### C09/N06/N09 e remoção de N01/N02/N03/N08 (2026-06-15)

> A pedido: filtro de datas no C09, ajuste semântico do N06, limpar N09 e remover gráficos redundantes.

- **C09 com filtro global real:** `novoLoadFunnel()` agora usa a janela global quando ativa: `since = _novoFilter.start` e `until = _novoFilter.end`. O endpoint `api/funnel-stages.js` passou a aceitar `until` e filtra o histórico de entrada em etapa entre `since` e `until`, não apenas “desde”. Quando o filtro muda, o dashboard invalida `_novoFunnelData` se `since/until` mudou e recarrega o funil. S04 também passa a mudar junto porque usa a mesma base de funil carregada.
- **N06 toggle ajustado:** o toggle `Perdido | Ganho` virou **`Todos | Ganho`**. `Todos` = deals que chegaram a um desfecho (`Ganho/Implantação` ou `Perdido`). O rótulo da série não usa mais `n=...`; agora mostra `X deals` (ou `X vidas` no modo Vidas). Tooltip atualizado para explicar que a coorte só entra se tiver pelo menos 20 deals.
- **N09 limpo:** removido `🟡` do título `Taxa de Ganho por Tamanho do Deal`; buckets vazios agora são ocultados e os índices do drill/tooltip continuam apontando para o bucket correto.
- **Removidos por completo da UI:** N01 (`waterfall`), N02 (`netflow`), N03 (`stageprog`) e N08 (`passthru`) saíram do render e das chamadas de build. As funções ficaram como código morto inócuo por enquanto.
- **Validação:** `node scripts/_check-inline-js.js public/dashboard.html` → 0 erros; `node --check api/funnel-stages.js` → OK; `node scripts/_i18n-parity.js public/dashboard.html` → PT=255 / EN=255; localhost `/novo` → 200; smoke render com dados reais OK (`1235 deals`).

### N09/N10/N11/N12 | taxa de ganho padrão e filtros de modal (2026-06-15)

> A pedido: remover emoji de S04, explicar C01, mostrar totais N09–N12, usar fórmula padrão de taxa de ganho, adicionar filtros nos modais e remover filtros locais.

- **S04 sem emoji:** removido `🟡` de `Taxa de Reunião`/`Meeting Rate`.
- **C01 alinhado aos demais C-cards:** C01 agora usa a mesma base ativa de C02/C05/C07/C08 (`_novoCurrentActivePipeline()`), incluindo deals sem AE agrupados como `(sem AE)/(no AE)`. Antes contava ~62 porque filtrava apenas etapas `Cotação+` e exigia AE preenchido; agora o total considerado bate com os demais gráficos ativos.
- **Totais no título:** N09, N10, N11 e N12 agora mostram, em pequeno ao lado do título, o total de deals considerados.
- **Taxa de ganho padrão aplicada:** N09 e N12 agora usam a fórmula padrão definida para o projeto: `deals ganhos ÷ (deals ganhos + deals perdidos)`, ambos por `close_date`/janela de filtro. N12 deixou de usar `ganhos ÷ (ganhos + abertos)`.
- **Modais com filtro por segmento:** N09 abre modal filtrável por faixa de vidas; N10 por faixa de receita; N11 por faixa de vidas; N12 por AE. Os filtros usam os mesmos buckets das barras.
- **Filtros locais removidos:** C09 não renderiza mais o seletor local de data do funil; usa apenas o filtro global (ou default interno sem UI quando não há filtro). N10/N11 não renderizam mais toggles `Todo período/Últ. 90d/Últ. 30d`; usam a base ativa sem filtro local.
- **Buckets vazios:** N09, N10 e N11 ocultam buckets sem dados. Mantida a regra de remover buckets vazios como padrão para novos gráficos/editados.
- **N06 visibilidade:** reduzido o piso de coorte de 20 para 1 deal e idade mínima de 2 para 1 mês para evitar gráfico em branco. `n=...` já havia sido substituído por `X deals`/`X vidas`.
- **Validação:** sintaxe inline OK (`0 erros`), `api/funnel-stages.js` OK, i18n OK (`PT=255 / EN=255`), localhost `/novo` → 200, smoke render com dados reais OK (`1235 deals`).

### N13/N14 e remoção N10/N11/N15/N16 (2026-06-15)

> A pedido: N13 usa meta global, N14 absorve N16 e ganha toggles, N12 ao lado de N09, remoção de N15/N10/N11 e tratamento de colunas zeradas.

- **N13 usa meta global:** `buildNovoCoverage()` deixou de usar a meta local `novo_cov_target` como referência principal e passou a usar `NOVO_META_MTD * 12` (meta global do modal de Configurações anualizada), já que o pipeline é ARR anual. Se a meta global estiver vazia, o card mostra meta `—/configure no modal`.
- **N14 atualizado:** título removido de “por Etapa” (`Valor do Pipeline (Projeção Mensal)`). O gráfico ganhou dois toggles: `Bruto | Ponderado` e `Receita | Deals`. Receita usa ARR/12 por `data_prevista_para_receita`; Ponderado multiplica pela probabilidade do deal/etapa. Deals mostra a contagem mensal, absorvendo a antiga leitura do N16.
- **N16 removido:** card `Visibilidade de Receita | Timeline` saiu da UI e das chamadas de build, pois agora está unido ao N14 via toggle `Receita | Deals`.
- **N10/N11/N15 removidos:** saíram da UI e das chamadas de build. N12 deixou de ser full-width e agora fica ao lado de N09.
- **Taxa de ganho padrão reforçada:** mantida a regra de cálculo para taxas de ganho como `deals ganhos ÷ (deals ganhos + deals perdidos)`; N09 e N12 seguem essa regra.
- **Colunas zeradas:** adicionado saneamento genérico em `_novoMkChart()` para remover categorias zeradas em gráficos de barra sem drill custom. Para gráficos com `onClick`, a remoção fica no cálculo do próprio gráfico para preservar o mapeamento do modal; N09 e N14 já fazem isso explicitamente.
- **S04 sem emoji:** removido `🟡` do label `Taxa de Reunião`/`Meeting Rate`.
- **Validação:** `node scripts/_check-inline-js.js public/dashboard.html` → 0 erros; `node scripts/_i18n-parity.js public/dashboard.html` → PT=255 / EN=255; localhost `/novo` → 200; smoke render com dados reais OK (`1235 deals`).

### N07/N17 contadores, buckets zerados e N19 API/campo reunião (2026-06-15)

> A pedido: mostrar total considerado em N07/N17, garantir remoção de colunas zeradas e atualizar N19 para o campo de reunião.

- **N07/N17 com contagem no título:** `Frescor de Engajamento` agora mostra o total de deals considerados (abertos com `dias_sem_atividade`); `Tempo em Etapa` mostra o total considerado (abertos com `dias_no_pipe`). Os builders usam os mesmos helpers de contagem para evitar divergência entre título e gráfico.
- **Buckets/colunas zeradas:** `_novoMkChart()` agora aplica `_novoPruneZeroBars()` globalmente em gráficos de barra. Categorias cujo total absoluto em todos os datasets é zero são removidas. Para gráficos com `onClick`, o helper preserva o índice original ao abrir o modal, evitando quebrar drill-downs. Para gráficos com mapeamento crítico, os próprios builders continuam filtrando buckets vazios antes do render.
- **N19 atualizado:** `api/forecast-table.js` já continha `a_reuniao_ocorreu_` em `PROPERTIES` e retornava como `reuniao_ocorreu`; o front estava desatualizado. `buildNovoTimeToMeeting()` deixou de mostrar “Requer o campo…” e agora exibe cobertura do campo: Ocorreu / Não ocorreu / Sem preenchimento. O card esclarece que tempo real até reunião ainda requer uma data de reunião, não apenas o booleano.
- **Help/tooltips N19:** atualizados para documentar que `a_reuniao_ocorreu_` já está disponível na API como `reuniao_ocorreu`.
- **Validação:** sintaxe inline OK (`0 erros`), i18n OK (`PT=255 / EN=255`), localhost `/novo` → 200, smoke render com dados reais OK (`1235 deals`).

### N09/N12 escala, modais de ganhos, N18 histórico e remoção N19 (2026-06-15)

> A pedido: ajustar leitura de taxas baixas, restringir modais a ganhos, adicionar filtros de engajamento e corrigir N18.

- **N09/N12 escala até 50%:** ambos os gráficos agora usam eixo máximo `50` para dar mais leitura visual às taxas baixas.
- **Modais apenas com ganhos:** N09 abre lista apenas de deals ganhos e agora usa filtro por tempo de engajamento (`dias_sem_atividade`) no modal. N12 também lista apenas ganhos, preservando filtro por AE.
- **N07/N09 filtros de engajamento:** criado helper `_novoEngagementBuckets()` e `_novoOpenEngagementFilterModal()` para filtrar listas por faixas de tempo sem atividade. N07 usa esses buckets no gráfico e no modal; N09 usa os mesmos buckets no modal de ganhos.
- **N18 usa histórico de Diagnóstico:** `buildNovoSpeedQualify()` agora usa IDs do funil histórico (`_novoFunnelData.vendas.stages['Diagnóstico']`) para considerar todos os deals que já passaram por Diagnóstico, e só cai no fallback antigo (deals atualmente em Diagnóstico) se o funil ainda não carregou. Após `novoLoadFunnel()`, o N18 é reconstruído.
- **N19 removido:** o card N19 saiu da UI e da chamada de build. A função antiga ficou inócua.
- **Validação:** sintaxe inline OK (`0 erros`), i18n OK (`PT=255 / EN=255`), localhost `/novo` → 200, smoke render com dados reais OK (`1235 deals`).

### P10/P11/N07 e N18 por data de entrada em Diagnóstico (2026-06-15)

> A pedido: remover emojis P10/P11/N07 e corrigir N18 para parar a contagem ao entrar em Diagnóstico.

- **Emojis removidos:** removido `🟡` dos labels P10 (`Vidas | Pipe Ativo`), P11 (`Receita Ponderada | Pipe Ativo`) e N07 (`Frescor de Engajamento`) em PT/EN.
- **N18 corrigido:** `api/funnel-stages.js` agora devolve `entered_date` por deal em cada etapa do histórico. `buildNovoSpeedQualify()` usa os deals que já entraram em `Diagnóstico` no funil histórico e calcula `entered_date(Diagnóstico) - createdate`, parando a contagem no momento da entrada em Diagnóstico. O fallback antigo (deals atualmente em Diagnóstico com `dias_no_pipe`) só roda antes do funil histórico carregar.
- **N18 atualizado pós-funil:** após `novoLoadFunnel()`, o N18 é reconstruído para trocar o fallback pela base histórica real.
- **Validação:** sintaxe inline OK (`0 erros`), `node --check api/funnel-stages.js` OK, i18n OK (`PT=255 / EN=255`), localhost `/novo` → 200, smoke render com dados reais OK (`1235 deals`).

### Modais sticky, reordenação de cards e filtro global sticky (2026-06-15)

> A pedido: padronizar tabelas dos modais, permitir reorganizar cards com persistência e melhorar experiência dos filtros globais.

- **Tabelas/listas dos modais:** headers de `table.lb` agora têm `letter-spacing:0` e não forçam uppercase. O rodapé (`tfoot`) ficou sticky no fundo do container, igual ao cabeçalho no topo, para manter a linha de totais visível durante rolagem.
- **BDR alinhado à esquerda:** os builders de tabela (`_novoDealsTableHtml` e `_novoP01DealsHtml`) agora alinham o header da coluna BDR à esquerda quando detectam `tbl_sdr`.
- **Probabilidade final no rodapé:** rodapés das listas de deals passam a mostrar a média da `P. Ajust.`/probabilidade final considerada (`_calcProbInfo(d).final`) na coluna correspondente. P01 também mostra a média de probabilidade final no rodapé, além dos totais de vidas, ARR e receita mensal calculada.
- **Cards reorganizáveis:** cards dentro de cada seção visual (`.section-hdr`) agora são `draggable`. A ordem é salva em `localStorage` por chave de usuário (`/api/auth/me`, quando disponível; fallback `local` em dev). Ao re-renderizar, a ordem salva é reaplicada dentro de cada seção, preservando os agrupamentos do dashboard.
- **Filtro global sticky:** a barra de filtro global (`.flt-bar`) agora fica sticky abaixo do header (`top:74px`) e não some durante a rolagem.
- **Preservação de scroll:** `_novoApplyFilter()` salva `window.scrollY` antes do `novoRender()` e restaura logo após, evitando que aplicar filtros jogue a página para o topo.
- **Validação:** sintaxe inline OK (`0 erros`), i18n OK (`PT=255 / EN=255`), localhost `/novo` → 200, smoke render com dados reais OK (`1235 deals`).

### Ajustes UX | N14 escala/toggle, tooltips tabela, filtros e códigos (2026-06-15)

> A pedido: N14 sem mudança de escala entre Real/Probabilizado, esconder toggle irrelevante em Deals, tooltips em tabelas, melhorar filtros e reordenar códigos visíveis.

- **N14 escala estável:** em modo Receita, o eixo Y agora usa como `suggestedMax` o maior valor mensal entre Real e Probabilizado, evitando que a escala mude ao alternar o toggle e permitindo enxergar claramente a redução do pipe probabilizado.
- **N14 toggle condicional:** `Real | Probabilizado` agora é ocultado imediatamente quando o modo `Receita | Deals` está em `Deals`, via `_novoSyncPipeRevToggles()`, sem depender de recriar o card inteiro.
- **Tooltips nas tabelas dos modais:** `openModal()` aplica `title` nos headers de todas as tabelas dos modais; as funções de tabela padrão também geram `title` nos `<th>`. Foram mapeadas descrições para colunas comuns (Deal, AE, Pipe, Etapa, Vidas, ARR, Dt. Receita, P. Ajust., Receita Real, Receita Probabilizada etc.).
- **CSS dos filtros:** barra global recebeu visual sticky mais forte (fundo translúcido com blur, borda inferior, pills com hover/foco melhores). Chips de filtros dos modais ganharam peso visual/hover mais consistente.
- **Códigos reordenados:** códigos visíveis dos gráficos foram reordenados para a sequência atual do dashboard. C-series visíveis agora seguem C01-C06; N-series visíveis seguem N01-N12 conforme a nova ordem. Chaves internas permanecem iguais; apenas a tag exibida mudou.
- **Validação:** sintaxe inline OK (`0 erros`), i18n OK (`PT=255 / EN=255`), localhost `/novo` → 200, smoke render com dados reais OK (`1237 deals`).

### Reordenação dos códigos P (2026-06-15)

- Reordenados os códigos visíveis da série **P** conforme a ordem atual dos cards: primeiro `Pipeline Ativo` (`P01-P05`) e depois `Período Selecionado` (`P06-P09`). O P03 antigo (`Pipeline Ponderado/ano`) permanece como `P00` por estar removido da UI.
- Validação: sintaxe inline OK e smoke render OK (`1237 deals`).

### Board View | IDs de cards com toggle (2026-06-15)

- Adicionado no `board.html` o toggle `ID` no menu superior direito para mostrar/ocultar identificadores dos cards, com persistência em `localStorage` (`board_show_info`).
- Criada a série visível **B01-B14** para os cards atuais do Board View: 4 KPIs principais e 10 gráficos, na ordem visual do painel.
- `_infoBtn()` agora renderiza a tag `.novo-code-tag` quando há código associado, e os KPIs também receberam tag de ID.
- As tags ficam ocultas por padrão e aparecem apenas com `body.board-info-on`, mantendo os botões `i`/help sempre disponíveis.
- Validação: sintaxe inline OK, i18n OK (`PT=24 / EN=24`) e smoke render OK (`1237 deals`).

### Spec baseline de hardening CRO Dashboard (2026-06-16)

- Criado `docs/2026-06-16_hardening_cro_dashboard_forecast_spec.md` seguindo o modelo enviado pelo supervisor (`type: spec`, `status: proposed`, workstreams MECE, tasks e acceptance criteria).
- A spec foi escrita como baseline de proposta pré-hardening para comparar com o que foi implementado depois: contratos de data/base, forecast/N14, conversão ajustada, modais/tabelas, IDs, painéis secundários, UX operacional e validação/deploy.
- Observação: não foram alterados metadados/timestamps do filesystem; a data consta apenas no conteúdo do documento.

### Painéis secundários | toggle de auditoria, modais e filtros sticky (2026-06-16)

> A pedido: aplicar nos painéis secundários o padrão do CRO Dashboard para `?`, tags/`i`, modais de deals e filtros globais sticky/scroll-safe.

- **Filtro compartilhado sticky:** `public/filter-bar.js` agora renderiza `.axf-bar` sticky abaixo do header, com fundo translúcido/blur e preserva `window.scrollY` ao aplicar filtros. Isso vale para Board View, AE Performance, BDR Performance, CS Dashboard e Cotação.
- **Toggle `?` de auditoria:** adicionados botões `?` no topo de Board, AE, BDR, CS e Cotação. O toggle usa `body.novo-info-on` para mostrar/ocultar `i` e tags de identificação dos cards, com persistência por painel em `localStorage`.
- **Board View:** IDs `B01-B14` adicionados aos 4 KPIs e 10 gráficos. KPIs principais agora abrem modais com listas de deals coerentes com a métrica: ganhos, pipeline aberto, fechados e forecast.
- **AE Performance:** IDs `A01-A14` adicionados. KPIs principais agora abrem modais: pipeline aberto, ganhos e incompletos/completude.
- **BDR Performance:** IDs `R01-R11` adicionados. KPIs principais agora abrem modais: deals com BDR, pipeline BDR aberto, criados no período e base criada para média de vidas.
- **CS Dashboard:** IDs `CS01-CS08` adicionados. KPIs proxy agora abrem listas de deals ganhos; Produto Líder abre apenas deals daquele produto.
- **Cotação:** IDs `Q01-Q06` adicionados. Foi adicionada estrutura de modal/tabela ao painel; KPI `Em Cotação` e gráficos por AE/vidas agora abrem listas de deals proxy em etapa Cotação.
- **Validação:** sintaxe inline OK nos 5 painéis e `filter-bar.js`; i18n OK em Board/AE/BDR; smoke render OK com dados reais (Board/AE/BDR 1237 deals; CS/Cotação 304 deals).

### N14 tabela Forecast-like e etapas consideradas (2026-06-15)

> A pedido: esclarecer etapas do N14, exibir total considerado e trocar modal para tabela semelhante ao Forecast.

- **Etapas consideradas no N14:** tooltip/help agora explicitam que o N14 considera deals abertos com `data_prevista_para_receita`: Diagnóstico, Cotação, Proposta Enviada, Consultoria, Negociação e Standby; Reunião Agendada entra se o toggle de Ativos estiver ligado; Implantação entra apenas se `Implantação = Ganho` estiver desligado.
- **Contagem no título:** N14 agora mostra ao lado do título o total de deals considerados (`_novoPipeRevDeals().length`).
- **Modal estilo Forecast:** clique no N14 abre uma tabela mensal com colunas fixas de deal/AE/etapa/vidas/ARR/data prevista/probabilidade ajustada e dois grupos de meses: **Receita Real** e **Receita Probabilizada**. Os totais mensais aparecem no rodapé sticky. A receita real mensal usa `ARR ÷ 12`; a probabilizada usa `Receita real mensal × probabilidade final`.
- **Base do gráfico/tabela:** N14 agora usa helper `_novoPipeRevDeals()` para garantir que gráfico, título e modal olhem o mesmo conjunto de deals.
- **Validação:** sintaxe inline OK (`0 erros`), i18n OK (`PT=255 / EN=255`), localhost `/novo` → 200, smoke render com dados reais OK (`1237 deals`).

### Hotfix N14 | Receita recorrente mês a mês (2026-06-15)

- **N14 modal/tabela:** corrigida a lógica de preenchimento mensal para replicar o Forecast: a partir da `data_prevista_para_receita`, todas as colunas mensais posteriores recebem receita real/probabilizada, não apenas o mês de entrada. A fórmula usa `modelo_remuneracao`, `primeira_fatura`, `vidas` e `possui_agenciamento`, com a mesma regra de recorrência do `forecast.html` (`Fee por vida` recorrente; `Corretagem` com regra de agenciamento/porte e mês `n`).
- **N14 gráfico:** os totais mensais em `Receita` agora também somam a receita recorrente de todos os deals ativos a partir da data prevista; `Deals` permanece como contagem de entrada por mês.
- **Probabilizado:** receita probabilizada usa `Receita real × probabilidade final ajustada` (`_calcProbInfo(d).final`).
- **Validação:** sintaxe inline OK (`0 erros`), i18n OK (`PT=255 / EN=255`), localhost `/novo` → 200, smoke render com dados reais OK (`1237 deals`).

### N14 eixo até dez/27 e toggle condicional (2026-06-15)

- **Eixo até dez/27:** N14 agora usa `_novoProjectionMonthsToDec27()` e projeta meses até dezembro de 2027. O eixo remove apenas meses iniciais zerados antes da primeira entrada/projeção, mantendo o horizonte até dez/27.
- **Pipes considerados:** tooltip PT/EN do N14 atualizado para explicitar que considera **Vendas + Bid**.
- **Toggle condicional:** quando `Receita | Deals` está em `Deals`, o toggle `Real | Probabilizado` fica oculto, pois não afeta contagem de deals. Em `Receita`, o toggle reaparece.
- **Validação:** sintaxe inline OK (`0 erros`), i18n OK (`PT=255 / EN=255`), localhost `/novo` → 200, smoke render com dados reais OK (`1237 deals`).

### Remoção N21/N25 e contadores N22-N24 (2026-06-15)

- **Removidos da UI/build:** N21 (`Resultados Financeiros e Estimativas`) e N25 (`Timeline de Recebíveis Estimados`) saíram do render e das chamadas de build.
- **N14 sem emoji:** removido `🟡` do título `Valor do Pipeline (Projeção Mensal)` em PT/EN.
- **Contadores financeiros:** N22, N23 e N24 agora mostram ao lado do título o total de deals considerados. N22 usa a mesma base do builder (`_novoWon().filter(close_date)`); N23 e N24 usam `_novoOpen()`.
- **Nota:** como N21 foi removido, não há contador aplicado a ele.
- **Validação:** sintaxe inline OK (`0 erros`), i18n OK (`PT=255 / EN=255`), localhost `/novo` → 200, smoke render com dados reais OK (`1237 deals`).

### Alinhamento de contagens N14/N22/N23/N24/N17 (2026-06-15)

> A pedido: explicar discrepâncias de contagem entre N22 e S02/S03, N23/N24/N17 e P09, e N14 vs P09.

- **N22 alinhado com P02/S02/S03:** o builder e o título de N22 agora usam `_novoClosedKpiRange(_novoWon())`. Sem filtro, isso significa ganhos com `close_date` no ano atual; com filtro ativo, ganhos com `close_date` na janela. Antes o título/builder usavam `_novoWon()` completo e podiam mostrar 24 em vez de 22.
- **N23/N24 alinhados com P09:** os builders e títulos passaram de `_novoOpen()` para `_novoCurrentActivePipeline()`, a mesma base do P09. Isso remove a diferença causada por etapas como Standby, que `_novoOpen()` ainda considerava.
- **N17 alinhado com P09:** `_novoTimeInStageDeals()` passou a usar `_novoCurrentActivePipeline()` + `dias_no_pipe`, em vez de `_novoOpen()`, para bater com a regra de ativos do P09.
- **N14 esclarecido:** `_novoPipeRevDeals()` passou a usar `_novoCurrentActivePipeline()` e filtrar apenas deals com `data_prevista_para_receita`, porque o gráfico precisa alocar deals por mês previsto. O título agora mostra `X de Y ativos`, deixando claro por que N14 considera menos deals que P09: só entram ativos com data prevista de receita preenchida.
- **Tooltips atualizados:** N14 explicita “ativos com data prevista / total P09”; N22 explicita base fechada igual a P02/S01/S02/S03; N23/N24 explicitam base ativa igual a P09.
- **Validação:** sintaxe inline OK (`0 erros`), i18n OK (`PT=255 / EN=255`), localhost `/novo` → 200, smoke render com dados reais OK (`1237 deals`).

### Remoção de cabeçalho vazio (2026-06-15)

- Removido do render o título de seção **“Análise de Funil e Pipeline”**, que ficou sem cards após a remoção de N01/N02/N03/N08.
- Validação: sintaxe inline OK e smoke render OK (`1237 deals`).

### Correção headers de tabela | uppercase mantido (2026-06-15)

- Ajustado `table.lb th`: mantido `letter-spacing:0`, mas restaurado `text-transform:uppercase`, conforme pedido original era remover apenas o espaçamento entre letras dos títulos das colunas.
- Validação: sintaxe inline OK (`0 erros`).

### Layout N17/N18 lado a lado (2026-06-15)

- **N17** (`Tempo em Etapa`) deixou de ocupar a largura inteira e passou a usar `_card(...)` normal.
- **N18** (`Velocidade de Qualificação`) agora renderiza imediatamente ao lado do N17 na seção `Análise de Tempo`.
- **Validação:** sintaxe inline OK e smoke render OK (`1235 deals`).

### BDR | 🟡 R14/R15 + R15 exclui Aurilia/Gabriele dos AEs (2026-06-19)

- **🟡 removido** dos títulos R14 (Novos Leads BDR vs AE) e R15 (Handoff Matrix).
- **R15:** Aurilia e Gabriele removidas da lista de AE (matriz filtra deals cujo AE tem primeiro nome `aurilia`/`gabriele` via `EXCL_AE`) — não são AEs do time.
- **Validação:** inline 0 erros; smoke render OK (334).

### BDR | R15 Handoff Matrix BDR→AE + 🟡 R11 (2026-06-19)

- **🟡 removido** do título do R11 (Distribuição de Porte).
- **R15 (novo) `BDR→AE Handoff Quality Matrix`:** `buildBdrHandoff()` — tabela heatmap (div `#bdr-handoff-matrix`): linhas = BDR (Top 12), colunas = AE (Top 8), célula = nº de deals passados daquele BDR para aquele AE; cor por volume (intensidade teal); linha/coluna de Total. Base: deals criados (createdate) no período com `sdr` e `ae` preenchidos (850 atuais). Clique numa célula abre os deals do par. Usa `_bdrName` (alias). Code `R15`.
- **Validação:** inline 0 erros; smoke render OK (333).

### BDR | filtros combináveis nos modais + 🟡 R10 (2026-06-19)

- **🟡 removido** do título do R10 (BDR vs Não BDR).
- **Filtros combináveis:** o modal de deals (`bdrOpenFacetModal`) passou de faceta única para **múltiplas facetas em AND** — Origem, BDR, Desfecho, Porte e Mês. Cada dimensão tem chips (Todos + valores, top 12 + contador "+N"); a tabela mostra os deals que satisfazem todas as seleções. Facetas de categoria única são ocultadas. O clique no gráfico pré-seleciona a dimensão correspondente (`bdrOpenFacetModal(title,deals,preKey,preVal)`), e o usuário pode cruzar (ex.: BDR=X **e** Porte=500+ **e** Desfecho=Ganho).
- **Validação:** inline 0 erros; smoke render OK (333).

### BDR | modais com filtros por faceta, R10 donut C03 filtrável, 🟡 R07-R09 (2026-06-19)

- **🟡 removido** dos títulos R07 (net-flow), R08 (net-vidas), R09 (avg-vidas) via `noEmoji`.
- **R10 (BDR vs Não BDR):** agora **filtrável pelo período** da página (`_dealsByDate('createdate')` em vez de `_rawDeals()`) e com **visual de donut igual ao C03** (cutout 68%, legenda à direita, plugin de centro com total + "deals criados", gradiente radial, % nas fatias).
- **Modais com filtros (facetas) em todos os gráficos:** novo `bdrOpenFacetModal(title, deals, label, facetFn, preCat)` + `bdrFacetSel` + `_bdrFacetRender` + chips `.bdr-fchip`. Cada gráfico, ao clicar em barra/fatia/linha, abre a lista geral de deals com chips de filtro no topo baseados na dimensão do gráfico, pré-selecionando o item clicado:
  - R12/R13 → faceta **BDR** (`_fBdr`); R14/R10 → **Origem** (BDR/AE); R07/R08 → **Desfecho** (Ganho/Perdido/Aberto); R09 → **Mês**; R11 → **Porte**.
- **Validação:** inline 0 erros; i18n bdr `21/21`; smoke render OK (333).

### BDR | remove 🟡 de R12/R13 (2026-06-19)

- `c()/cWide()` ganharam param `noEmoji`; R12 (Originação por BDR) e R13 (Weekly Origination) passam `true` — títulos sem o 🟡. Demais gráficos do BDR mantêm o 🟡.
- Nota (contagem): R12/R13 contam `createdBdr` (deals criados com campo `sdr` = origem BDR ≈ 942); R14 conta `created.length` (todos os criados ≈ 1299 = BDR 942 + AE 357). Diferença = deals de origem AE.
- **Validação:** inline 0 erros; smoke render OK.

### BDR | total no topo das colunas em R13 e R14 (2026-06-18)

- R13 (Weekly Origination) e R14 (Leads BDR×AE): datalabel exibe o **total da coluna** no topo de cada barra empilhada (renderizado só no dataset do topo; formatter soma todos os segmentos do índice). Padding superior ajustado para não cortar o rótulo.
- **Validação:** inline 0 erros; smoke render OK (346).

### BDR | emojis 🟡, contagem nos títulos, R14 mês abreviado, remove R05/R06 (2026-06-18)

- **Emoji 🟡** adicionado a todos os títulos de gráfico (via `c()/cWide()`).
- **Contagem de deals** no título de cada gráfico (`_cntSpan`): R12/R13/net-flow/net-vidas = deals BDR criados; R14/avg-vidas/size-dist = deals criados; colabs = base total.
- **R14** rótulos agora em mês abreviado PT (`_mlbl`: jan/25, fev/25 …) via `_MABBR`.
- **Removidos R05 (Novos Deals/Mês) e R06 (Novas Vidas/Mês)** do render e dos build calls (seção "Origination Volume" eliminada). Funções builders ficaram órfãs (inócuas).
- **Validação:** inline 0 erros; i18n bdr `21/21`; smoke render OK (347).

### BDR | R12 toggle+alias, R13 Weekly Origination, R14 Leads BDR×AE (2026-06-18)

- **Infra portada do AE:** CSS `.tab-sub*`, helpers `_subTabs/_setActive/_moveTabSubThumb/_initTabSubs`, `c()/cWide()` ganharam param `tabs`, e helpers de semana `_getWeeks/_weekKey/_wlbl`. `_initTabSubs()` chamado ao fim do render.
- **Alias de BDR:** `BDR_ALIAS` + `_bdrName(d)` resolvem owners de sdr que vinham como id cru — `76060683 → Fernando Henrique`, `83684312 → Beatriz Honorato`. Aplicado no R12/R13.
- **R12:** toggle **Deals | Vidas** (`_bdrOriginMode`); usa `_bdrName`.
- **R13 (novo) `Weekly Origination (por BDR)`:** barras verticais empilhadas por BDR (Top 6 + Outros), últimas 13 semanas por `createdate`, toggle Deals | Vidas (`_bdrWeeklyMode`).
- **R14 (novo) `Novos Leads por Mês | BDR vs AE`:** barras verticais mensais empilhadas em 2 grupos — origem BDR (sdr preenchido) vs AE (sdr vazio). Base atual: BDR 941 / AE 357.
- **Validação:** inline 0 erros; i18n bdr `21/21`; smoke render OK (347); `/novo-bdr` → 200.

### BDR | KPIs P02/P08/P09/P04/P05, health amarelo, Originação por BDR (2026-06-18)

- **KPIs principais reformulados:** a linha de KPIs do BDR passou de R01-R04 para **P02** (Vidas | Pipeline Ativo), **P08** (Vidas Ganhas), **P09** (Vidas Perdidas), **P04** (Reuniões Agendadas | Pipe Ativo) e **P05** (Vidas Ponderadas) — números globais, mesma régua do CRO. Criado `_bdrActivePipeline()` (exclui Ganho/Perdido/Implantação; Standby e Reunião Agendada por toggle); `NOVO_STAGE_PROB` vem do `settings-modal.js` (com guard). KPIs clicáveis (drill). Grid de KPIs → 5 colunas. `BDR_CARD_CODES` atualizado.
- **Health dot amarelo:** BDR Performance `r`→`y` no bloco `PANELS` (propagado nos 8 arquivos).
- **R12 (novo) `Originação por BDR (Top 15)`:** `buildBdrOrigin()` — barras horizontais com deals criados por cada BDR (campo `sdr`), top 15 por volume, por `createdate` no período. Clique abre os deals do BDR. Nota: alguns `sdr` aparecem como ID cru (owner não resolvido no ownerMap da API — qualidade de dado).
- **Validação:** inline 0 erros (5 painéis); i18n bdr `21/21`; smoke render bdr OK (347); `/novo-bdr` → 200.

### C01 | contagem do título sensível ao toggle Vidas/Deals (2026-06-18)

- **Pedido:** no C01 (CRO e AE), com **Vidas** selecionado, mostrar `xxx deals preenchidos de xxx` (só deals com `vidas` preenchida somam vidas); com **Deals**, contar todos os deals.
- **Implementação:** helper `_c01CountText(deals, mode)` nos dois painéis. Vidas → `filled deals preenchidos de total` (filled = `vidas != null && vidas > 0`); Deals → `total deals`. O título usa um `<span>` com id (`novo-c01-count` / `ae-c01-count`) e os builders (`buildNovoVidasAE`/`buildAEC01`) reescrevem o texto a cada toggle (o switch só reconstruía o gráfico, não o título).
- **Verificado (CRO, core/ativo):** Vidas → `159 deals preenchidos de 253`; Deals → `253 deals`.
- **Validação:** inline 0 erros; i18n dashboard `257/257`; smoke render OK (dashboard 1297, ae 346).

### Fix | Perdidos do BID contam (P09 e conversões) (2026-06-18)

- **Sintoma:** P09 (Vidas Perdidas) e as taxas de conversão só consideravam Perdido de Vendas; o Perdido do BID não tinha stage id em `LOST_STAGE_IDS` e nunca era buscado.
- **Correção (`forecast-table.js`):** `fetchDeals` agora usa 2 `filterGroups` (OR): grupo 1 = ativos por stage; grupo 2 (só com `includeLost`) = `hs_is_closed_lost = true` nos dois pipelines — pega todo closed-lost independi­ente do stage id. No mapeamento, `hs_is_closed_lost === 'true'` força `stage = 'Perdido'` (cobre o BID, cujo stage de perdido não está mapeado).
- **Efeito:** Perdido por pipeline passou a `Vendas 950 + Bid 1`; total 1295→1297 (inclui também 1 closed-lost de Vendas fora do stage 1144746911). Vale para P09, S01/S02/S03, B03 e win rates (API compartilhada).
- **Validação:** `node --check` OK; smoke render OK (dashboard 1297, board 346, ae 346).

### Forecast | P. Ajust. efetiva na linha de total (2026-06-18)

- A linha **TOTAL** da tabela do Forecast passou a exibir, na coluna **P. Ajust.** (`prob_ajustada`), a **probabilidade ajustada efetiva** do livro = `Σ Receita Probabilizada ÷ Σ Receita Real` (`sumProb/sumReal`), o haircut médio ponderado usado para gerar ARR/MRR probabilizado. Formatado com `fmtPct` (1 decimal) e com `data-tip` explicando a fórmula. Antes a célula ficava vazia.
- **Validação:** `_check-inline-js.js public/forecast.html` → 0 erros; `/forecast` → 200.

### Fix | S01 (CRO) = B03 (Board): arredondamento da conversão ajustada (2026-06-18)

- **Sintoma:** S01 (CRO | Taxa de Ganho) e B03 (Board | Conversão Ajustada) mostravam números diferentes (ex.: 2% vs 2,5%) apesar de mesma base.
- **Causa:** mesma fórmula e dados (24 ganhos / 950 perdidos = 2,46%), mas o CRO arredondava para inteiro (`Math.round(r*100)` → 2%) enquanto o Board usa 1 decimal (`Math.round(r*1000)/10` → 2,5%).
- **Correção:** `_buildKpiSecRow` no CRO passou a usar 1 decimal em S01 (`winRate`) e, por consistência, S02 (`bdrConv`) e S03 (`aeConv`). Agora batem com o Board e com as taxas do painel AE.
- **Validação:** inline 0 erros; i18n `257/257`; smoke render dashboard OK (1295).

### AE | A19 Deal Velocity by Stage (heatmap) + stage_days na API (2026-06-18)

- **API (`forecast-table.js`):** novo `stage_days` por deal — dias em cada etapa do pipeline Vendas = `(hs_v2_date_exited_<id> || hoje) - hs_v2_date_entered_<id>`, para Reunião Agendada, Diagnóstico, Cotação, Consultoria, Negociação e Implantação. Adicionadas as props entered/exited dessas etapas (dedupe via `[...new Set(PROPERTIES)]`) e helper `computeStageDays`. Verificado: 1102/1295 deals com dados; médias do time Reunião 22d, Diag 34d, Cotação 32d, Consultoria 30d, Negociação 38d, Implantação 40d.
- **A19 (novo) `AE Deal Velocity by Stage (Avg Days)`:** `buildAEVelocityStage()`, seção "Velocidade por Etapa". Tabela heatmap (não-canvas, div `#ae-velocity-table`): linhas = AEs do time, colunas = as 6 etapas, célula = média de `stage_days[etapa]` dos deals do AE; última linha = média do time. Cor da célula escala verde→vermelho por coluna (mais dias = mais vermelho). Code `A19`.
- **Validação:** `node --check` API OK; inline 0 erros; i18n ae `24/24`; smoke render ae OK (345).

### CRO C01 só AEs do time + Standby toggle em todos os painéis (2026-06-18)

- **C01 (CRO) restrito aos 6 AEs:** criado `AE_CORE_FIRSTNAMES` + `_novoIsCoreAE(ae)` e wrapper `_novoC01CoreDeals()` (= `_novoC01Deals()` filtrado por AE core). `buildNovoVidasAE` (gráfico, contagem do título e modal) passou a usar o wrapper — mostra apenas Juliana, Ágatta, Guilherme, André, Rafael e Fausto.
- **Toggle Standby refletido em todos os painéis:** `_novoIsOpen`/`_novoOpen` passaram a honrar `_novoActiveStandby` em **dashboard, board, ae, bdr, 48h** (antes incluíam Standby sempre; só os predicados de pipeline ativo honravam). Cláusula `(_novoActiveStandby || (stage!=='Standby' && stage!=='Stand by'))`, cobrindo os dois nomes (Vendas/BID) sem depender de `_stageNorm`. Com o padrão (toggle off), os 48 Standby ficam fora de open/ativo em todos os painéis; ligando, entram.
- **CS e Cotação:** sem mudança necessária — só exibem deals em **Ganho** (CS) e em etapa **Cotação** (Cotação); Standby nunca aparece nesses conjuntos, então já estão consistentes com o toggle.
- **Validação:** inline 0 erros nos 5 painéis; i18n dashboard `257/257`, ae `24/24`; smoke render OK (dashboard 1295, ae 345, board 345).

### AE | A17 Efficiency (bubble), A18 Meeting by AE, A11 100% horizontal (2026-06-18)

- **A17 (novo) `AE Efficiency | Deals vs Win Rate`:** `buildAEEfficiency()`, seção Conversão. Bubble chart por AE (só time core): X = total de deals (abertos+ganhos+perdidos), Y = win rate ajustado (ganhos ÷ (ganhos+perdidos)), tamanho da bolha = vidas em pipeline aberto. Eixo Y autoescala (win rates reais 0–7%). Clique abre os deals do AE. Code `A17`.
- **A18 (novo) `Meeting Effectiveness by AE`:** `buildAEMeetingByAE()`, seção Reuniões. Barras empilhadas por AE (core) com total de deals criados fatiado por `a_reuniao_ocorreu_` (Sim/Não/sem preenchimento). Clique abre os deals do AE/fatia. Code `A18`.
- **A11 reformatado:** `buildAEPipelineStage` voltou a barras por AE fatiadas por etapa, agora **horizontal e 100% empilhado** (cada AE = barra de mesma largura, fatias = % por etapa). Mantém base de pipeline ativo (toggle-aware) e ordem com Reunião Agendada. Datalabels mostram % (≥8%); tooltip mostra % + contagem.
- **Validação:** inline 0 erros; i18n `PT=24 / EN=24`; smoke render ae OK (345).

### Fix | Standby de Vendas + BID no toggle de Pipeline Ativo (2026-06-18)

- **Causa raiz:** `api/forecast-table.js` não buscava o Standby de Vendas (`1317543716` → nome `'Stand by'`); só o Standby de BID (`1373066362` → `'Standby'`) estava em `ACTIVE_STAGE_IDS`. Resultado: o toggle "Ativos incluem Standby" só conseguia contar o Standby de BID, porque os deals de Standby de Vendas nunca chegavam ao front-end.
- **Correção:** adicionado `1317543716` a `ACTIVE_STAGE_IDS`. Como a API é compartilhada por todos os painéis e o front-end já normaliza ambos via `_stageNorm('Stand by')==='Standby'`, o toggle passa a contar os dois pipelines em **todos os painéis**.
- **Verificado:** API agora retorna `Stand by [Vendas]=47` + `Standby [Bid]=1` (total 1248→1295). Smoke render OK (dashboard 1295, ae 345).

### Modal de Configurações compartilhado + A11 por config + A16 Meeting Rate (2026-06-18)

- **Modal de Configurações unificado (`public/settings-modal.js`, novo):** módulo compartilhado que reproduz o modal do CRO Dashboard (`novo-prob-drawer`: toggles Implantação/Reunião/Standby + Meta Receita + probabilidades por etapa). Injeta CSS + HTML e expõe `novoOpenSettings`/`novoCloseSettings`/`novoSaveSettings`/`_gsSync`. Persiste no mesmo localStorage do CRO (`novo_stage_prob`, `novo_meta_mtd`, etc.) → config realmente global. Incluído em **board, ae, bdr, 48h** (após `filter-bar.js`); o CRO mantém o modal inline (referência). Removidas as funções inline `_gsSync`/`novoOpenSettings`/`novoCloseSettings` desses 4 painéis (agora donas no módulo); os `novoToggle*` foram mantidos. `NOVO_STAGE_PROB`/`NOVO_META_MTD` ganham fallback no módulo (bdr/48h não os tinham). Obs.: o antigo `gs-drawer` ficou no DOM como markup morto (nunca aberto) — limpeza menor pendente. CS/Cotação/Forecast não têm gear de Configurações, fora de escopo.
- **A11 honra os toggles globais:** `buildAEPipelineStage` passou a usar `_aeActivePipeline()` (em vez de `_novoOpen()`) e ordem de etapas `['Reunião Agendada'].concat(NOVO_STAGE_ORDER)`. Assim, Reunião Agendada e Standby entram/saem das colunas conforme a configuração global; Implantação/Ganho/Perdido sempre fora. Título usa contagem do pipeline ativo.
- **A16 (novo) `Meeting Rate Evolution (Monthly)`:** `buildAEMeetingRate()`, seção "Reuniões". Barras empilhadas por mês de criação (`createdate`) com total de deals criados fatiado por `a_reuniao_ocorreu_` (Sim/Não/sem preenchimento); linha (eixo direito) com Occurrence Rate = Sim ÷ (Sim+Não). Classificação tolerante a múltiplos valores (`Sim;Nao`). Clique abre os deals criados no mês. Code `A16`.
- **Emoji 🟡 removido** de **A13** (`age-dist`) e **A15** (`loss-reason`).
- **Validação:** `node --check settings-modal.js` OK; inline 0 erros nos 5 painéis; i18n ae `PT=24 / EN=24`; smoke render ae OK (298); localhost serve `/settings-modal.js` 200 e `/novo-ae|board|bdr|48h` 200.

### AE | A11 invertido, A13 Age Dist, A15 Motivos de Perda, emojis C01/A08 (2026-06-18)

- **A11 invertido (`buildAEPipelineStage`):** antes barras por AE fatiadas por etapa; agora **barras por etapa, fatiadas por AE** (cada dataset = um AE, `labels=stages`). `onClick` abre o modal filtrando por etapa + AE (`datasetIndex`).
- **A13 (novo) `Deal Age Distribution (Open)`:** `buildAEAgeDist()`, ao lado do A12. Contagem de deals abertos por faixa de `dias_no_pipe`: 0-30 / 31-60 / 61-90 / 91-120 / 121-180 / +180. Barras coloridas verde→vermelho; clique abre os deals da faixa. Code `A13`.
- **A15 (novo) `Motivos de Perda por Deals`:** `buildAELossReason()`, seção "Motivos de Perda". Contagem de deals em Perdido por `lost_reason` (campo HubSpot `motivo_do_declinio_ou_perdido`, já exposto pela API como `lost_reason`). Barras horizontais ordenadas desc; vazio → `(sem motivo)`; clique abre os deals do motivo. Base atual: 950 perdidos em ~15 motivos. Code `A15`.
- **Emoji 🟡 removido** dos títulos de **C01** (`vidas-ae`), **A08** (`wonrev`) e **A10** (`monthly-won`): `c()`/`cWide()` ganharam 6º parâmetro `noEmoji`; os três cards passam `true`. (O pedido dizia "A20", esclarecido pelo usuário como **A10**.)
- **Help/IDs:** `AE_CARD_CODES` ganhou `age-dist:A13` e `loss-reason:A15`; `AE_HELP_CHARTS` ganhou as entradas dos dois gráficos.
- **Pendente:** "A20" do pedido não existe no painel AE (códigos atuais vão até A15) — aguardando o usuário indicar qual card é.
- **Validação:** sintaxe inline 0 erros; i18n `PT=24 / EN=24`; smoke render OK (ae 298).

### Toggle global "Ativos incluem Standby" (2026-06-18)

- **Novo toggle global** `Ativos incluem Standby`, espelhando `Ativos incluem Reunião Agendada`. Estado em `localStorage` (`novo_active_standby`), **padrão desligado** (Standby fora do pipeline ativo = comportamento histórico do P09 — zero regressão). Variável `_novoActiveStandby`, função `novoToggleActiveStandby()`.
- **Efeito:** quando ligado, deals em Standby/Stand by passam a contar como Pipeline Ativo. Aplicado nos predicados de pipeline ativo: `_novoIsActivePipelineDeal` (dashboard.html), `_croIsActivePipelineDeal` (board.html) e `_aeIsActivePipelineDeal` (ae.html) — antes a exclusão de Standby era incondicional, agora é `(s==='Standby' && !_novoActiveStandby)`.
- **Propagação:** UI no drawer de Configurações + estado + `_gsSync`/sync nos 5 painéis com o toggle (CRO `dashboard.html`, `board.html`, `ae.html`, `bdr.html`, `48h.html`). Em `bdr`/`48h` não há predicado de pipeline ativo próprio, então o toggle apenas persiste o setting global compartilhado.
- **i18n (CRO):** `active_standby_label`/`active_standby_tip` em PT/EN (PT=257 / EN=257).
- **Validação:** sintaxe inline 0 erros nos 5 painéis; smoke render OK (dashboard 1248, ae 298). Base atual: 1 deal em Standby (impacto pequeno hoje, mecanismo correto).

### C01 contagem no título + A12 restrito aos 6 AEs (2026-06-18)

- **C01 (painel AE):** título `Vidas e Deals por AE (Ativos)` ganhou a contagem de deals considerados via `_aeCntSpan(_aeActivePipeline().length)`. No CRO o título já trazia a contagem (`_titleWithCount(..., _novoC01Deals().length)`).
- **C01 colunas zeradas:** já são ocultadas pelo builder compartilhado `buildSharedVidasDealsAE` (filtro `r.value>0`, linha 130 de `shared-charts.js`) — vale para CRO e AE. Sem alteração necessária.
- **A12 (`buildAEAging`):** restrito aos AEs reais do time. Criado `AE_CORE_FIRSTNAMES` + `_isCoreAE(ae)` (match por primeiro nome) e `aes=_getAEs().filter(_isCoreAE)`. Mostra apenas André, Fausto, Guilherme, Juliana, Rafael e Ágatta; remove owners não-AE (Anderson, Gabriel, Aurilia, Pacheco Jr, etc.).
- **Validação:** `_check-inline-js.js public/ae.html` → 0 erros; i18n `PT=24 / EN=24`.

### Health dots verde (CRO/Board/AE) + A10/A11 sem colunas zeradas (2026-06-18)

- **Health dots:** no bloco compartilhado `PANELS`, `health` de CRO Dashboard (`y`→`g`), Board View (`r`→`g`) e AE Performance (`r`→`g`) passou para verde. Propagado aos 8 arquivos (`ae`, `48h`, `bdr`, `board`, `cotacao`, `cs`, `dashboard`, `forecast`).
- **A10 (`buildAEMonthlyWon`):** meses sem nenhum ganho entre os AEs exibidos são removidos do eixo (filtro `allMonths`→`months`); `onClick` continua alinhado ao array `months` filtrado.
- **A11 (`buildAEPipelineStage`):** AEs cujo total de pipeline aberto nas etapas exibidas é zero são removidos do eixo (poda explícita de `aes` após o cálculo de `stages`).
- **Validação:** `node scripts/_check-inline-js.js public/ae.html` → 0 erros; i18n `PT=24 / EN=24`; localhost `/novo`, `/novo-board`, `/novo-ae` → 200.

### Ajustes Board C03/C04 + correções painel AE (2026-06-18)

- **Board (1a):** C03 (Distribuição por Tamanho) e C04 (Valor por Etapa) unidos na seção "Pipeline & Porte", lado a lado (ambos `c()` meia-largura).
- **AE (2a):** toggle "Ativos incluem Reunião Agendada" agora reflete nos gráficos — os cards de pipeline ativo (P02 KPI, C01, A07) e de abertos (A11/A12/A14) leem `_novoActiveMeetings` e `novoToggleActiveMeetings` re-renderiza. Impacto verificado: 119 deals em Reunião Agendada (ativo 152↔271).
- **AE (2b):** bug visual dos toggles corrigido — faltava a regra CSS `.tab-sub-thumb` (o thumb deslizante era inserido sem estilo, quebrando o layout dos botões). Adicionada; `.tab-sub-btn.active` passou a usar só o thumb como destaque.
- **AE (2c):** A09 com escala de win rate limitada a `max:50`. Contagem de deals adicionada ao título de A08 (ganhos), A09 (fechados), A10 (ganhos), A11 (abertos) e A12 (abertos). 🟡 removido dos KPIs P02 (Vidas | Pipeline Ativo) e P08 (Vidas Ganhas); P07 mantém.
- **Validação:** sintaxe 0 erros, i18n PT=EN, smoke render OK (ae 1245, board 296).

### P03 paridade + Board tables + painel AE reformulado (2026-06-18)

- **P03 (item 10/11):** Diagnóstico da divergência 116,1M (CRO) × 287M (Board): o card do Board rotulado P03 era na verdade o **ARR bruto** do pipeline aberto (287M), não o ponderado. Corrigido: o card "Forecast Ponderado" virou **"Receita Ponderada"** (code P03) calculado por `sharedWeightedPipelineARR(_croActivePipeline())` = **116,15M**, idêntico ao CRO. "Pipeline Aberto Atual (ARR)" voltou ao code B02 (métrica própria, ARR bruto). CRO P03 também passou a usar o helper compartilhado — garantia de paridade verificada numericamente.
- **shared-charts.js:** novos helpers `sharedWeightedPipelineARR` (P03), `buildSharedVidasDealsAE` (C01), e a máquina de projeção do N06 (`sharedForecastCalcReceita`, `sharedProbFinal`, `sharedPipeRevMonthValue`, `sharedProjectionMonths`, `sharedDealProjectedRevenue`).
- **Board | novos cards (itens 1,2):** B15 "Top 5 AEs by Weighted Open Pipeline" (tabela: # | AE | Open Deals | Vidas | ARR Estimado | ARR Ponderado) e B16 "Top 10 Open Deals by Weighted R$/yr | BoD Watchlist" (tabela: Deal | Etapa | Vidas | ARR | Prob. | ARR Ponderado | Dias no Pipe | AE). Seção "Ranking & Watchlist".
- **Board | emojis (item 4):** 🟡 removido de B05 (rev-trend) e B11 (entry-exit) via novo parâmetro `noEmoji` no `cWide`.
- **Painel AE (itens 5-9):** shared-charts.js incluído; 🟡 adicionado a todos os títulos (KPIs + cards); KPIs alinhados ao CRO — A01→P02 (Vidas | Pipeline Ativo), A02→P08 (Vidas Ganhas), A03→P07 (Receita Ganha | Ano Atual); A04 (Completude) removido. A05+A06 mesclados em **um** card C01 compartilhado (toggle Deals/Vidas). **A07** = projeção do N06 por AE (mesmos cálculos/filtros; total bate com N06 = 9,63M; verificado), toggle Real/Probabilizado, contagem de deals no título, clique abre modal de deals filtrável por AE. **A08** = ganhos por AE (mesma base do B05 = `_novoWon`), toggle Receita/Ganhos/Vidas. Colunas zeradas ocultadas em A07/A08/A09/A11/A14. A13 (Completude por AE) removido. Infra de toggles (`_subTabs`/`_setActive`/`_initTabSubs`) e `NOVO_STAGE_PROB` portados para o painel.
- **Validação:** sintaxe inline 0 erros, smoke render OK (ae 1245, board 296, dashboard 296), i18n PT=EN nos 3 painéis. Paridade P03=116,15M e A07=N06 conferidas numericamente.

### B05 redesign + shared-charts + remoção B10 + emojis B07/B09 (2026-06-18)

- **B05 (board.html):** Reescrito `buildBdRevTrend` com 3 séries — barras verdes = nº de deals ganhos (`yCount` direita), linha teal = Receita ARR (`yRev` esquerda), linha lilás = Vidas totais (`yVidas` direita oculta). Todas mostráveis/ocultáveis pela legenda. Removido toggle `_bdMonthlyMode`/`novoSwitchBdMonthly` e o `_subTabs(...)` do render. Meses sem ganhos são ocultados.
- **shared-charts.js (novo):** Criado `public/shared-charts.js` com `buildSharedSizeDonut` e `buildSharedStageVal`. Ambos parametrizados por `(canvasId, dataFn, opts)` para funcionar nos dois painéis. Incluído via `<script src="/shared-charts.js?v=1">` em board.html e dashboard.html.
- **IDs compartilhados:** `BOARD_CARD_CODES` atualizado — B01→P07, B02→P03, B04→P03, B07→C04, B09→C03. `buildBdSizeDonut` e `buildBdPipeStage` em board.html viram thin wrappers chamando `buildSharedSizeDonut`/`buildSharedStageVal`. Idem `buildNovoSizeDonut` e `buildNovoStageVal` em dashboard.html. Alteração em shared-charts.js propaga automaticamente para os dois painéis.
- **B10 removido:** Excluído de `BOARD_CARD_CODES`, `BOARD_HELP_CHARTS`, `BOARD_FILT_FIELD`, render block, call `buildBdConcentration()` e função `buildBdConcentration`. Seção "Porte & Concentração" renomeada para "Porte".
- **Emojis B07/B09:** `c()` ganhou 7º parâmetro `noEmoji`; B07 e B09 passam `true` — títulos renderizam sem 🟡.
- **_smoke-render.js:** Atualizado para carregar `<script src="/local.js">` do `public/` antes dos scripts inline, permitindo testar código que depende de arquivos externos.
- **Validação:** sintaxe inline 0 erros, smoke render OK (board 296 deals, dashboard 296 deals), i18n PT=EN (board 24, dashboard 255).

### Hotfix buckets zerados C01/N14 (2026-06-15)

- **C01:** o gráfico usa `new Chart(...)` diretamente e não passava pelo helper global `_novoMkChart()`, então os AEs com valor `0` continuavam aparecendo. O builder agora filtra `ranked` para manter apenas barras com valor `> 0`.
- **N14:** meses com valor real positivo mas arredondado para `R$0` continuavam visíveis. O filtro de meses agora usa o valor exibido (`Math.round(totals[m])` em Receita, ou contagem em Deals), removendo meses/barras com label `0`.
- **Validação:** sintaxe inline OK e smoke render OK (`1235 deals`).

### N06B | regras de forecasting da Cintia aplicadas (2026-06-23)

- **N06B (`buildNovoPipeRev12B`) reescrito:** a linha verde "Projeção (com o tempo)" deixou de usar a heurística antiga (curva histórica de fechamento p75/p90 + desconto de vencidos + 4% de conversão) e passou a ser o **forecast pelas regras por bloco da Cintia** aplicado à carteira atual + novos negócios. A linha azul "Pipe atual (parado)" segue como visão ingênua (data prevista × prob da etapa) para contraste. Mudança isolada ao N06B — N06/N14 e o modal de clique compartilhado (`_novoOpenPipeRevModal`) intactos.
- **Regras (constantes editáveis no topo da seção N06B):** Diagnóstico → `vidas × R$/vida(36 ≤200 / 24 ≤5.000 / 12 >5.000) × 6%`, reconhecido a partir de `createdate + 9/14/18 meses` por porte; Cotação/Proposta/Consultoria/Negociação/Standby → `1ª fatura × prob da etapa` via a mecânica de 1ª fatura existente (`_novoForecastCalcReceita`), reconhecida em `vigência + 2 meses` (fallback data prevista); Reunião Agendada/Pré-RFP não entram (são topo de funil).
- **Novos negócios (topo de funil):** `vidas originadas/mês × R$24 × Win Rate 2,3% × +15 meses`, recorrente. Cronograma de vidas conforme a **aba MQL** da planilha `Axenya - Forecast (2026.06.22)`: jul/26=162.667, ago/26=216.000, set/26=285.600, platô 367.200. Dentro da janela (até dez/27) a receita aparece em out/nov/dez 2027 (R$ 89.792 / 209.024 / 366.675/mês). Helpers novos: `_novoFcAddMonths`, `_novoFcMqlVidas`, `_novoFcDiagFee/Meses`, `_novoFcRuleStart(Month)`, `_novoFcRuleMonthValue`, `_novoFcNewBizRev`.
- **Modal do "i" (`_novoForecastBMethodologyHtml`) reescrito** para documentar as regras por bloco, o cronograma MQL, as conversões (6%/2,3%), a regra de vigência+2m e a semântica Real × Probabilizado. Removida a documentação da metodologia antiga.
- **Win Rate de novos negócios = taxa do S01** (pedido do usuário: "usar sempre a taxa de S01"). Removida a constante fixa `NOVO_FC_TOPO_CONV`; criada `_novoFcWinRate()` = `_novoWon().length ÷ (_novoWon()+_novoLost())` — mesma fórmula/base do S01 (por contagem, close_date na janela), logo **filtro-aware** (muda com o período). Hoje, all-time = 2,3% (23 ÷ 1.001). Diagnóstico mantém 6%. Modal do "i" exibe a win rate viva com a nota "(= taxa do S01)".
- **Validação:** `_check-inline-js.js` → 0 erros; smoke render OK (330 deals); novos negócios out/27 = 162.667 × 24 × 2,3% = R$ 89.792 confere; 0 refs à constante removida. Servidor local `/novo` 200.

### N06B | alinhado à linha 7 do forecast da Cintia (forecast total) (2026-06-23)

- **N06B virou "Forecast Total (regras da Cintia)"** — a linha verde passou a reproduzir a **linha 7 da planilha** dela (`SUM` dos blocos 8 a 14), com **deals vivos do HubSpot** e os **cálculos dela**. Antes cobria só pipeline aberto + diagnóstico + topo; faltavam os dois maiores blocos. Títulos/tip/help (`t_piperev12b`, entrada `piperev12b`) atualizados PT/EN; linha azul mantida como visão ingênua de contraste.
- **Blocos somados na verde:** (11) **Negócio Ganho/Implantação** = receita recorrente `ARR ÷ 12` a partir da vigência, sem probabilidade (é o bloco que faz acumular) — `_novoFcWonMonthValue`/`_novoFcWonStartMonth`, respeita o toggle Implantação=Ganho via `_novoIsWon`; (8-10/12) pipeline aberto não-Bid pelas regras já existentes; (14) **BID** = 1ª fatura × prob para `pipeline==='Bid'`, com **Pré-RFP zerado** (`_novoFcBidMonthValue`); (13) topo de funil (MQL). Sem dupla contagem: ativo split por `pipeline`, ganhos via `_novoIsWon` (que o ativo exclui).
- **Confirmado na planilha:** o multiplicador de probabilidade dela (`AS3`/`AU4` = `IF(N<=AR-0.3,AR*0.9,IF(N>=AR+0.3,AR*1.1,AR))`) é idêntico ao `_calcProbInfo`/`sharedProbFinal` do dashboard — a probabilização do pipeline já batia. A mecânica de 1ª fatura (T:AQ) também é a mesma.
- **Divergências esperadas (documentadas no modal "i"):** snapshot 22/06 (lista fixa, curada) × HubSpot vivo (329 deals); BID dela é suprimido manualmente a ~0,5% (transcrição), enquanto usamos a prob da etapa/deal — só o Pré-RFP foi zerado; o cenário por porte (célula D3) não é aplicado. Por isso os totais ficam acima da planilha (ex.: verde acumula de ~319k em jun/26 para ~1,6M em dez/27).
- **Modal do "i" reescrito** para os 4 blocos (Ganho/Implantação, pipeline aberto, BID, topo) mapeados às linhas 11/8-10+12/14/13 da Cintia; tooltip com quebra por bloco.
- **Validação:** `_check-inline-js.js` → 0 erros; smoke render OK (329 deals); recomputação por bloco confere (ganho/impl recorrente ~300k/mês, novos negócios out/nov/dez 27). Servidor `/novo` 200.

### R14 (BDR) | toggle Deals/Vidas + vidas geradas no mês (2026-06-24)

- **R14 `buildBdrLeadsOrigin` ("Novos Leads por Mês | BDR vs AE")** ganhou o toggle **Deals/Vidas** (padrão Deals), no mesmo padrão do R12/R13: var `_bdrLeadsMode`, função `bdrSwitchLeads`, `_subTabs('bdr-leads-tabs', ...)` no `cWide`.
- No modo **Vidas**, as séries somam `d.vidas` por mês (em vez de contar deals) via `reduce`; o data-label do topo de cada barra passa a mostrar **quantas vidas foram geradas no mês** (soma BDR+AE). Tooltip alterna unidade "vidas"/"deals". Ajuda do card atualizada.
- **Validação:** `_check-inline-js.js` → 0 erros; smoke render OK (327 deals); 3 bytes nulos do `buildBdrHandoff` (separador de chave `b+\0+a`) preservados na edição.

### CRO Dashboard | modal de Configurações reordenado + override manual sinalizado (2026-06-24)

- **Ordem do modal (⚙) reorganizada:** (a) Implantação=Ganho, (b) Ativos incluem Reunião Agendada, (c) Ativos incluem Standby, (d) Meta Receita Ganha, (e) separador com título **"Probabilidades"**, (f) aviso de probabilidades calculadas pelo funil, (g–m) inputs de probabilidade na ordem do funil: **Reunião Agendada, Diagnóstico, Cotação, Proposta Enviada, Consultoria, Negociação, Implantação/Ganho** — cada um com o rótulo "(calculado pelo funil)".
- **Reunião Agendada** virou probabilidade derivada do funil (adicionada ao `_novoFunnelDerivedProb`); novo input `np-rag`. **Implantação** e **Ganho** unificados em "Implantação/Ganho" (input `np-imp`; Ganho fixo em 100%). Inputs avulsos de **Ganho** (`np-gan`) e **Standby** (`np-stb`) removidos da UI (Standby/Ganho preservados no modelo).
- **Input fica amarelo** quando o valor difere do padrão calculado pelo funil — via `oninput="_npCheckYellow(...)"` e reavaliado ao abrir o modal (classe `.np-edited`). Helper `_npFunnelDefaultPct` compara com o valor do funil (ou default fixo).
- **Bolinha vermelha no ícone ⚙** (`#btn-settings .np-settings-dot`, classe `.has-override`) quando há override manual de probabilidade — `_npUpdateSettingsDot()` chamado no load, no salvar e no restaurar. `novoSaveProbEditor` agora só marca `manual=true` se algum valor de fato difere do funil (senão volta ao automático), então o ponto reflete fielmente "algo diferente do padrão".
- **Validação:** inline JS 0 erros; smoke render OK (327 deals); i18n PT=EN=259; 0 refs aos removidos `np-gan`/`np-stb`; elementos confirmados na página servida.

### CRO Dashboard | probabilidades por usuário, reset por campo, ícones </> e ? (2026-06-24)

- **(1) Override de probabilidade é por usuário:** confirmado que `novo_stage_prob_cfg` vive só em `localStorage` (linhas de leitura/escrita em `_novoStageProbCfg`/`novoSaveProbEditor`) — nenhuma chamada a `/api/settings` ou `user-state` para isso. Já era per-navegador/usuário, não global. Sem mudança de código necessária.
- **(2) Botão de reset por campo:** cada um dos 7 inputs de probabilidade ganhou um botão `↺` (`.np-reset`) que chama `_npResetField(id, etapa)` e restaura o valor calculado pelo funil (pendente de salvar), limpando o amarelo.
- **(3) Ícone de toggle vira `</>`:** `#btn-info-toggle` trocou o SVG de interrogação por um ícone de código (`</>`); segue chamando `novoToggleInfo()` (mostra/oculta tags C01… e os `i` dos gráficos).
- **(4) Novo ícone `?` com modal de regras:** novo `#btn-rules` (`novoOpenRulesModal`) abre um modal "Regras de probabilização" explicando: prob por etapa = chegaram à Implantação ÷ entraram na etapa (funil C06 Vendas+Bid, amostra mín. 20; Ganho 100%, Implantação 58,1%); ajuste por deal (clamp ±30 pts → ×0,9 / ×1,1); uso no pipeline ponderado (Σ ARR × prob) e nas projeções; e a edição manual (por usuário, amarelo, ponto vermelho, reset). Tabela mostra a prob atual e a fonte (funil n=/padrão/manual) de cada etapa — bate com o estado real.
- **Validação:** inline JS 0 erros; smoke render OK (327 deals); i18n PT=EN=259; elementos confirmados na página servida (7 botões reset, btn-rules, ícone </>, modal).

### CRO Dashboard | N07 mediana + modal de regras vira drawer (2026-06-24)

- **N07 (Tempo em Etapa, `buildNovoTimeInStage`)** passou a calcular a **mediana** de `dias_no_pipe` por etapa, em vez da **média** (antes: somava o acumulado e dividia pela contagem). Novo helper `_novoMedian`. Tooltip "X dias (mediana) | N deals"; títulos/ajuda PT/EN trocados de "médios/Avg"→"medianos/Median"; corrigido o código do help de (N17) para (N07), batendo com o `NOVO_CARD_CODES` (`timeinstage:'N07'`).
- **Modal de regras de probabilização virou drawer lateral** (desliza da direita, mesmo estilo das Configurações): novo `#novo-rules-drawer`/`#novo-rules-backdrop` reutilizando as classes `.novo-prob-drawer`/`.novo-prob-backdrop` (largura 460px). `novoOpenRulesModal` agora popula `#novo-rules-body` e abre o drawer (não usa mais `openModal`); adicionado `novoCloseRulesDrawer` + Esc fecha o drawer (prioridade antes do help/config).
- **Validação:** inline JS 0 erros; smoke render OK (327 deals); i18n PT=EN=259; elementos confirmados na página servida.

### N08 modal + R14 colaboradores (2026-06-24)

- **N07 (Tempo em Etapa) — diagnóstico:** Diagnóstico é a única barra laranja porque sua mediana de `dias_no_pipe` cai entre 15–45 dias (faixa laranja). Todas as outras etapas têm medianas >45 dias (vermelho). Comportamento correto — deals recém-criados chegam em Diagnóstico antes de acumular tempo. Sem mudança de código.
- **N08 modal corrigido (`speedqualify`):** (a) título corrigido de "(N18)" para "(N08)" — alinhado ao `NOVO_CARD_CODES`; (b) `tip_speedqualify` PT/EN reescritos para descrever fonte primária (/api/funnel-stages: `entered_date − createdate`) e fallback (`dias_no_pipe`); (c) entrada `NOVO_HELP_CHARTS` completamente reescrita: explica fonte primária (todos os deals que passaram por Diagnóstico, não só os ativos), fallback, janela set/2025, métrica de média, e **instruções de auditoria** — abrir deal no HubSpot → Timeline → evento de mudança para Diagnóstico → data = `hs_date_entered_1144746906`.
- **R14 (BDR | Novos Leads por Mês | BDR vs AE) — toggle Colaboradores:** adicionado `{mode:'colaboradores'}` ao `_subTabs` e lógica em `buildBdrLeadsOrigin`: BDR = contagem de `sdr` únicos por mês; AE = contagem de `ae` únicos por mês entre deals sem BDR. Tooltip exibe "colaboradores"; datalabel continua somando BDR+AE. onClick: continua abrindo `bdrOpenFacetModal` com `origem=BDR/AE`.
- **Validação:** inline JS 0 erros (dashboard + bdr); i18n dashboard PT=EN=259, bdr PT=EN=21; smoke render OK (327 deals, ambos).

### N07 histórico + R12 labels + BDR ícones + settings-modal Metas (2026-06-24)

- **N07 (Tempo em Etapa) — histórico completo:** `_novoTimeInStageDeals()` alterado para incluir TODOS os deals (`_novoDeals`) com `dias_no_pipe != null` e filtro de createdate — não mais só ativos (`_novoCurrentActivePipeline`). `buildNovoTimeInStage` substituiu `NOVO_STAGE_ORDER` por lista completa `['Reunião Agendada','Diagnóstico','Cotação','Proposta Enviada','Consultoria','Negociação','Standby','Implantação','Ganho','Perdido']`. Ganho/Perdido aparecem como barras históricas. Canvas com altura dinâmica (`deals.length * 36 + 48`) + `maintainAspectRatio:false` + `autoSkip:false` nas ticks. Tooltips PT/EN atualizados: "inclui deals ativos, ganhos e perdidos".
- **R12 (Originação por BDR) — labels sempre visíveis:** `buildBdrOrigin` agora define altura dinâmica do canvas (`ranked.length * 36 + 48`), usa `maintainAspectRatio:false` e `autoSkip:false` no eixo Y — todos os nomes dos BDRs sempre visíveis independente do tamanho de tela.
- **BDR Performance — ícone </> e botão ?:** `btn-info-toggle` (mostrar/ocultar IDs e auditoria) mudou de "?" para "</>" (texto, estilo compacto). Adicionado `btn-rules-bdr` com "?" que abre um modal `bdrOpenRulesModal()` — explica as regras de probabilização (fonte funil C06, ajuste ±30 pp, uso em pipeline ponderado e forecast, persistência por usuário/localStorage) + tabela com probs atuais de `NOVO_STAGE_PROB`.
- **settings-modal.js — reescrito com seção Metas:** nova estrutura: (1) toggles (Implantação=Ganho, Reunião Agendada, Standby); (2) separador "Metas" com 13 BDRs individualmente (Anderson/Cintia/Gabriele/Priscilla/Letícia/Allan/Bruna/Emmanuelle/Felipe/Giovana/Marcelli/Thauan/Yokyko) — tag de nível (Antigo/Intermediário/Novo) colorida, input de meta numérica, padrões hard-coded conforme lista; (3) separador "Probabilidades" com aviso + 7 campos com botão ↺ reset (Reunião Agendada, Diagnóstico, Cotação, Proposta Enviada, Consultoria, Negociação, Implantação/Ganho); (4) Meta Receita Ganha (MTD) ao final. Metas BDR persistidas em `localStorage:bdr_metas`; expostas em `window.BDR_METAS` para uso em gráficos futuros.
- **Item 4 (saves por usuário):** confirmado — settings-modal.js e dashboard.html usam apenas `localStorage`. Nenhuma chamada a APIs de servidor. Cada usuário/navegador tem sua própria configuração.
- **Validação:** `_check-inline-js.js` → 0 erros (dashboard + bdr); i18n dashboard PT=EN=257, bdr PT=EN=21; smoke render OK (327 deals, ambos).

### N09 + N11 + R14 colaboradores (2026-06-24)

- **N09 (Impacto de Reatribuição de Deals) — redesenhado:** função `buildNovoReassign` substituída: agora exibe um gráfico dual-axis (barras + linha) com deals agrupados por número de mudanças de proprietário (0 / 1 / 2+). Barras (eixo Y esq.) = contagem de deals; linha dourada (eixo Y dir.) = win rate (ganhos ÷ fechados) por grupo. Clique na barra abre `novoOpenDealsModal` com os deals do grupo. Se `_novoFunnelData.owner_changes` não disponível, exibe mensagem orientando a carregar o funil.
- **N09 — backend (`api/funnel-stages.js`):** adicionado `hubspot_owner_id` ao `propertiesWithHistory` do batch/read. Novo mapa `ownerChangesByDeal` captura `historyLength - 1` por deal. Resposta passa a incluir `owner_changes: {deal_id: n_changes}`. O gráfico se ativa automaticamente quando o funil é carregado (novo `buildNovoReassign()` no callback `.then` do funnel-stages).
- **N09 — metadados:** tooltips PT/EN reescritos; entrada `NOVO_HELP_CHARTS` atualizada com fonte (propertiesWithHistory), campos e instruções; código corrigido de (N20) para (N09) no título do help.
- **N11 (`piperevstage` | "Estimativa de Receita por Etapa") — removido:** 8 locais limpos em `dashboard.html`: (1) i18n PT `t_piperevstage`/`tip_piperevstage`; (2) i18n EN idem; (3) entrada `NOVO_HELP_CHARTS`; (4) `NOVO_CARD_CODES`; (5) `NOVO_FILT_FIELD`; (6) variável `_novoPipeRevStageMode` + funções `novoSwitchPipeRevStage`/`buildNovoPipeRevStage`; (7) seção "Resultados Financeiros" + card N23 no render; (8) chamada `buildNovoPipeRevStage()` no buildAll.
- **R14 (BDR | Novos Leads | toggle Colaboradores) — corrigido:** lógica anterior (contagem de SDRs/AEs únicos) substituída por `reduce` somando `d.colaboradores` (campo HubSpot `quantidade_de_colaboradores`). Coluna **Colabs** adicionada às tabelas de drill-down (`novoOpenDealsModal` + `_bdrFacetRender`) e à função `_novoDealsRows`.
- **Validação:** `_check-inline-js.js` → 0 erros (dashboard + bdr); i18n dashboard PT=EN=257, bdr PT=EN=21; smoke render OK (327 deals, ambos); `/novo` → 200.

### Infra | servidor local + skill `/axenya-dashboard` + DEPLOY_GUIDE (2026-06-24)

- **Servidor local ativo na porta 3002** (`node scripts/local-server.js`, PID registrado em sessão). Carrega `.env.local` automaticamente — `LOCAL_DEV_BYPASS=true`, `HUBSPOT_TOKEN`, `SESSION_SECRET`. `/novo` e `/api/forecast-table` → 200.
- **Skill `/axenya-dashboard` criada** (`.claude/commands/axenya-dashboard.md`): protocolo de 5 passos que toda IA deve seguir ao avaliar ou editar o projeto — ativar localhost 3002, enviar requisições pelo env local, ler arquivos de contexto na ordem correta, verificar rotas-chave antes de reportar.
- **README.md (seção 8):** adicionado callout de protocolo para IAs + documentadas as duas opções de dev (`local-server.js` recomendada vs. `vercel dev`) com trade-offs.
- **DEPLOY_GUIDE.md:** (a) corrigido `novo-dashboard.html` → `dashboard.html` na seção de rotas; (b) adicionado mapa completo de rotas; (c) adicionada seção 5 de verificação pós-deploy com comandos curl; (d) adicionada seção 6 explicando `ALLOWED_EMAILS` (formato vírgula, comportamento aditivo, confirmado no `lib/auth.js` linha 38).

### N07 | média real vs HubSpot + filtro por createdate + Vendas-only (2026-06-24)

- **N07 (`buildNovoTimeInStage`) — fonte primária:** quando `_novoFunnelData.stage_medians` está disponível, o gráfico usa a **média de dias por etapa** calculada pelo backend (não mais a mediana de `dias_no_pipe`). Tooltip mostra "(média) | n=X transições". Mudança alinha com o HubSpot que exibe médias (ex: 14,8d / 24,9d).
- **`api/funnel-stages.js` — seção 2.5 (stage_medians):** três correções: (1) **average** em vez de mediana — `_avgArr` retorna `Math.round(sum/len * 10)/10`; (2) **filtro por `createdate` do deal** (`cd >= since`) em vez de filtrar por data de transição — replica o filtro do HubSpot; (3) retorna **`null`** quando `stageMedsByName` está vazio (era `{}`, truthy, causando N07 mostrar gráfico vazio sem fallback); (4) toda a seção 2.5 isolada em **try-catch próprio** para não bloquear `owner_changes` em caso de erro; (5) `VENDAS_STAGE_MAP['1317543716']` corrigido de `'Stand by'` para `'Standby'` (alinhado com `_histOrder`).
- **N07 — Vendas-only:** `api/funnel-stages.js` seção 2.5 agora filtra `pipe !== VENDAS_ID` antes de calcular durações de etapa — `stage_medians` reflete apenas deals do Pipeline de Vendas, como o HubSpot.

### N09 | Win Rate axis + contagem + emoji removido (2026-06-24)

- **N09 (Impacto de Reatribuição) — eixo Win Rate:** `yRate.max` reduzido de `100` para `20` — escala agora cobre 0–20%, que é o range real dos dados, tornando as variações visíveis.
- **N08/N09 — badge de contagem de deals:** N08 (`buildNovoSpeedQualify`) atualiza `<span id="novo-sq-count">` com `diaEntries.length` deals; N09 (`buildNovoReassign`) atualiza `<span id="novo-reassign-count">` com a soma de `counts`. Spans injetados nos cards via `_card(title + span, ...)` / HTML inline.
- **N09 — título:** emoji 🟡 removido de `t_reassign` PT e EN.

### Infra | lib/hubspot.js — escopo de dados alinhado ao HubSpot (2026-06-24)

- **Diferença de 1311 vs 1135 deals:** o dashboard usava apenas Pipeline de Vendas sem filtro de data (`lib/hubspot.js`), enquanto o HubSpot mostra Vendas + Bid + `createdate >= 01/09/2025`. Resultado: 1311 vs 1135 deals.
- **`lib/hubspot.js` reestruturado:** adicionadas constantes `BID_PIPELINE = '894130090'` e `DEALS_SINCE_MS = '1756684800000'` (01/09/2025 UTC ms). `fetchAllDeals` atualizado com filtro `pipeline IN [VENDAS, BID]` e `createdate GTE DEALS_SINCE_MS`. `VENDAS_STAGE_MAP` e `BID_STAGE_MAP_LIB` separados; `STAGE_MAP = Object.assign(Vendas, Bid)`; `STAGE_IDS` mantém apenas IDs Vendas (para `hs_date_entered_*`). Exports atualizados.

### CRO Dashboard | drawer de regras + settings visual + decimais (2026-06-24)

- **Drawer `?` (regras de probabilização) — bug CSS corrigido:** `#novo-rules-drawer{right:-540px}` (especificidade de ID: 1,0,0) impedia `.novo-prob-drawer.open{right:0}` (classe: 0,2,0) de funcionar. Adicionado `#novo-rules-drawer.open{right:0}` para que o drawer efetivamente deslize para dentro ao clicar no `?`.
- **Settings drawer — probabilidades reorganizadas:** removidos os spans `.np-cf` `"(calculado pelo funil)"` de cada label de probabilidade (redundante — o `#np-prob-status` já informa). Adicionado CSS `.np-hint{display:block;font-size:.68rem;color:var(--teal);opacity:.85;margin-top:.12rem;font-weight:500}` para que o valor do funil (ex: "funil: 6,0% (n=47)") apareça como sub-linha colorida abaixo do nome da etapa.
- **Decimais padronizados:** a função `_hint` em `novoOpenProbEditor` usava `toFixed(0)` (ex: "funil: 6%") enquanto os inputs usam `toFixed(1)` (ex: "6,0"). Corrigido para `toFixed(1).replace('.',',')` — consistência entre hint e input.

### CRO Dashboard + Forecast | implantação 100%, filtros de AE e data (2026-06-24)

- **Implantação = 100% (CRO Dashboard):** `NOVO_STAGE_PROB_DEFAULT['Implantação']` alterado de `0.581` para `1.0` — alinhado com Ganho. Texto do drawer de regras (`novoOpenRulesModal`) atualizado: "Implantação/Ganho = 100% (padrão fixo, não vem do funil)".
- **Forecast — BDRs removidos do filtro Executivo:** `buildAeFilter` agora filtra `d.ae` pela lista `FC_AE_NAMES` (10 AEs), excluindo BDRs/SDRs que aparecem como dono de deal no HubSpot. Lista sincronizada com `AE_NAMES` em `lib/hubspot.js`.
- **Forecast — filtro de createdate:** `allDeals` agora filtrado por `d.createdate >= '2025-09-01'` logo após o carregamento da API — deals criados antes de 01/09/2025 não aparecem na tabela nem nos KPIs do Forecast.

### Forecast | faturamento manual compartilhado + Receita Real no forecast.html (2026-07-01)

> A pedido: aplicar no `forecast.html` a regra de Receita Real que o `forecast-stage.html` já usava (faturamento manual), com a lógica de faturamento manual COMPARTILHADA (Regra primária nº 3 | fonte única de receita).

- **Novo `public/faturamento-manual.js`** (fonte única): estado do store + `load()` (fetch `/api/faturamento-manual`), `config({dealId})`, `monthKey`, `vencido`, `elegivel`, `isManual`, `manualMonths`. Materializa o gate (Ganho/Implantação com `vencimento_primeira_fatura` vencido = manual; override explícito vence o gate). Incluído via `<script src>` em `forecast.html` e `forecast-stage.html`.
- **`forecast-stage.html` religado ao módulo:** removido o `let FC_MANUAL` e as funções inline `_fcVencido/_fcManualElegivel/_fcIsManual/_fcManualMonths/_fcMonthKey`, que agora delegam ao módulo; leituras/escritas do store passam por `FaturamentoManual.data()/setData()`. Comportamento idêntico, sem cópia duplicada.
- **`forecast.html` (alvo):** passou a carregar o store (`FaturamentoManual.load()` no `load()`) e a série mensal ganhou a ramificação de faturamento manual no topo do builder — deals já faturando usam valor real digitado (Real = Probabilizada = valor, prob 1), caindo na régua estimada só onde não há manual. Antes o "Receita Real" do forecast.html era a fórmula não ponderada, o que violava a Regra nº 3.
- **Validação:** `_check-inline-js` 0 erros nos dois HTML; `node --check` no módulo OK; harness de 10 asserts cobrindo gate/override/months/monthKey + a matemática da ramificação, todos passando; servidor local 200 em `/forecast`, `/forecast-overall`, `/forecast-ganho`, `/faturamento-manual.js`, `/api/faturamento-manual`. **Não deployado** — vale no próximo `vercel --prod --yes`.
- **Pendência de drift (registrada):** `_novoForecastCalcReceita` (bloco BID/pipe do dashboard.html) ainda é cópia da régua; consolidar na fonte única depois. Próxima parte: reconsolidar os demais gráficos do CRO Dashboard sobre as bases Real/Probabilizada.
- **Fix contagem de Ganho (2026-07-01):** o `forecast.html` aplicava o corte `createdate >= 2025-09-01` em todos os deals, derrubando 1 Ganho antigo (mostrava 9 Ganho / 24 com Implantação). Alinhado ao `forecast-stage.html`: Ganho/Implantação furam o corte (realizado sem cutoff). Agora bate: 10 Ganho + 15 Implantação = 25 won, igual ao painel `/forecast-ganho`.

### Forecast | motor por deal compartilhado (forecast-engine.js) + paridade total forecast × forecast-stage (2026-07-01)

> A pedido: extrair o motor de receita por deal para módulo compartilhado, adicionar a projeção de cohorts BDR no `forecast.html` e corrigir todas as inconsistências de regra por etapa entre `forecast.html` e `forecast-stage.html`.

- **Novo `public/forecast-engine.js`** (fonte única): `dealMonthly(d, probAdj)` (o antigo `_fcDealMonthly`, todas as etapas) + `bdrCohorts()` + `bdrNewVidasPer(ym)`. Dependências de página (MONTHS, getVpv, parseRevenueDate, addMonths, todayStr, calcReceita, monthLabels) injetadas via `config()`. Incluído nos dois HTML após revenue-engine + faturamento-manual.
- **`forecast-stage.html`:** `_fcDealMonthly`, `_fcBdrCohorts`, `_fcBdrNewVidasPer` agora delegam ao módulo (cópias inline removidas). Comportamento idêntico.
- **`forecast.html`:** builder inline (≈90 linhas) substituído por `ForecastEngine.dealMonthly`; adicionada a soma dos cohorts BDR aos totais mensais (Real += rec, Prob += rec × conversão MQL ao vivo, via `_fcMqlConv`).
- **Inconsistências corrigidas (ficavam divergentes no forecast.html):** (1) Diagnóstico usava só `d.vidas` → agora `d.vidas || d.colaboradores` (igual ao painel); (2) delay do Diagnóstico usava `< 200` → agora `<= 200` (consistente com o getVpv). Item de dedup: já era não-divergente (ambos dedupam sobre a base global — `allDeals`/`allScopedDeals`).
- **Validação:** `node --check` no módulo OK; `_check-inline-js` 0 erros nos dois HTML; harness carregando os 3 módulos + config real rodou `dealMonthly` em 1332 deals sem exceção (278 com receita), confirmou os 2 fixes do Diagnóstico e os cohorts; servidor local 200 em `/forecast`, `/forecast-overall`, `/forecast-mql`, `/forecast-engine.js`. **Não deployado ainda.**
- **A validar visualmente:** os totais do `forecast.html` agora incluem a originação BDR — a soma do rodapé passa a ser maior que a soma das linhas de deals visíveis (a originação não é um deal). Avaliar se quer uma linha visível "Originação BDR (projeção)" para reconciliar o olho, ou gatilho por ausência de filtro.
- **Cohorts BDR com gate por etapa (2026-07-01):** a originação BDR só é somada aos totais do `forecast.html` quando **não há filtro de etapa** OU quando **Reunião Agendada** está entre as etapas filtradas (`stageFilter.size === 0 || stageFilter.has('Reunião Agendada')`). Para tornar a condição alcançável, adicionei o checkbox **Reunião Agendada** ao filtro de etapa (e ao `STAGE_DD_LIST`); deals de Reunião Agendada já apareciam por padrão (sem filtro), agora são filtráveis.
- **Help ('?') do forecast.html reescrito (2026-07-01):** agora explica todas as regras por etapa, fiel ao forecast-engine.js — Real × Probabilizada, probabilidade C06 ao vivo (+ Reunião Agendada na tabela), ajuste ±10% do AE, receita por etapa (MQL/Reunião, Diagnóstico, Cotação/Consultoria/Negociação com início por modelo, Proposta/Standby/demais, Ganho/Implantação com faturamento real sem cutoff), modelos de cobrança, originação BDR (com o gate por etapa) e dedup Fee × Corretagem.

### CRO Dashboard | C07 Probabilidade de Ganho por Etapa (Vendas × Bid) (2026-07-01)

> A pedido: gráfico na área de análise de conversão mostrando a probabilidade de ganho em cada etapa, separada por pipeline de Vendas e de Bid.

- **Novo gráfico C07** (`chart-novo-winprob`, card após o C06): barra agrupada, uma barra por pipeline (Vendas teal, Bid roxo) por etapa. `prob(etapa) = deals que chegaram à Implantação ÷ deals que entraram na etapa`, no funil histórico daquele pipeline (mesma lógica do C06/_novoFunnelDerivedProb, só que por pipeline em vez de combinado). Tooltip mostra o n (amostra) por barra.
- **Builder** `buildNovoWinProb()` + helper `_novoWinProbPipe(pipe)`; usa `_novoFunnelData[pipe].stages` e `_FUNNEL_STAGES[pipe]`. Chamado no render (quando o funil já carregou) e no fim do `novoLoadFunnel`.
- **Registros:** código C07 em NOVO_CARD_CODES, `winprob:'funnel'` em NOVO_FILT_FIELD, ficha do 'i' em NOVO_HELP_CHARTS.
- **Validação:** `_check-inline-js` 0 erros; `_smoke-render` novoRender OK (280 deals); teste da fórmula reproduz as probabilidades esperadas (RA 2,2% · Diag 4,6% · Cot 14,1% · Cons 21% · Neg 42%). Rota /novo 200. **Não deployado.**
- **Pendência menor:** título e tooltip do card em PT literal (não passam por t()/i18n); localizar para EN depois.

### Probabilidade | C07 por ganho absoluto + probabilidade por pipeline como padrão nos forecasts (2026-07-01)

> A pedido: (1) C07 = probabilidade de FECHAMENTO usa ganho absoluto (não "chegou à Implantação"); conversão de etapa (C06) continua sendo avanço. (2) Todos os painéis de forecast + CRO Dashboard passam a usar como padrão a probabilidade de etapa POR PIPELINE do C07; o ajuste ±10% do AE segue igual.

- **C07 (dashboard.html):** numerador trocado de Implantação → **Ganho absoluto** (`_novoWinProbPipe`); textos do card e da ficha atualizados (C06 = avanço, C07 = fechamento).
- **Probabilidade por pipeline como padrão:**
  - forecast.html e forecast-stage.html: `_fcFunnelDerivedProb` agora retorna `{ vendas, bid }` (ganho absoluto ÷ entraram, por pipeline, amostra mín. 20). Novo `_fcStageProbFor(stage, pipeline)` (override manual → funil do pipeline → padrão fixo). `calcProbInfo`, `_fcMqlConv` e o campo `prob_etapa` passam a resolver por pipeline. Cache de sessão renomeado p/ `fc_funnel_prob_pipe`.
  - dashboard.html: novo `_novoFunnelDerivedProbPipe()` + `NOVO_FUNNEL_PROB_PIPE` + `_novoStageProbFor(stage, pipeline)`; os 8 usos por deal de `NOVO_STAGE_PROB[d.stage]` passaram a `_novoStageProbFor(d.stage, d.pipeline)`. `NOVO_STAGE_PROB` e o editor de Configurações ficaram intactos (display/override manual).
  - Fallback de amostra pequena = **padrão fixo** (STAGE_PROB_DEFAULT), conforme decidido. Diagnóstico fixo 6% e ±10% do AE inalterados.
- **Impacto esperado:** como Ganho < "chegou à Implantação", as probabilidades caem e a receita probabilizada de todos os forecasts diminui (mais conservador/correto). Bid fica mais volátil por etapa (amostra menor → mais fallback).
- **Validação:** `_check-inline-js` 0 erros nos 3 arquivos; `_smoke-render` novoRender OK (280 deals); teste da fórmula do C07 reproduz as probabilidades esperadas. **Não deployado.**
- **Pendências menores:** título/tooltip do C07 e do label do painel forecast-stage não passam por i18n (PT literal); editor de Configurações mostra o padrão fixo, não o valor por pipeline (o C07 é a referência por pipeline).

### CRO | S05 %, N05 nº de deals + checkbox de ganhos, verificação N06B/N07 (2026-07-01)

- **#3 S05:** card e modal mostram o % dos deals ativos que os estagnados representam; drawers PT/EN atualizados.
- **#6 N05:** nº de deals considerados ao lado do título (`data.includedN`, prêmio + Diagnóstico; MQL é agregado). Drawer atualizado.
- **#8 N05:** checkbox "Considerar deals ganhos" no corpo do gráfico. Por padrão o N05 passa a **excluir** Ganho/Implantação (`_novoCovInclWon=false`); marcado, inclui. Drawer atualizado.
- **#7 N06B:** verificado — **já considera** deals ganhos (bloco 11 da Cintia: `won = _novoDeals.filter(_novoIsWon)`, sem cutoff; total = Bw+Bp+Bb+Bn). Sem mudança para não duplicar.
- **#2 (live):** a probabilidade dos forecasts já é derivada AO VIVO do funil (C07 por pipeline), refetch a cada load; cache de sessão de 1h serve só o valor inicial até o fetch fresco chegar.
- **Pendentes:** #1 (editor de Configurações por pipeline), #4 (C04 refletir forecast), #5 (dois donuts de receita prevista por bucket).
- **#4 C04:** `buildSharedStageVal` (shared-charts.js) passou a ponderar pela probabilidade POR PIPELINE (C07) via `_novoStageProbFor(d.stage,d.pipeline)`, com guard (`typeof===function`) que mantém o board no mapa flat (paridade). Drawer/tooltip PT/EN atualizados. Pendentes: #1 (editor por pipeline) e #5 (dois donuts).
- **#5 C08 (novo):** "Receita Prevista por Bucket" — dois donuts (Bruta = Σ ARR; Ponderada = Σ ARR × prob. de ganho por pipeline C07), base visual do C03, toggle Receita/Vidas. `buildSharedSizeDonut` estendido (retrocompatível) com `metric`/`valFmt`/`bucketMode`; board segue contando deals. Código C08, filtro 'none', ficha e tooltips PT/EN. Falta só #1 (editor por pipeline).
- **#1 Editor de Configurações por pipeline:** a seção Probabilidades ganhou aba **Vendas | Bid**; cada aba pré-preenche com o C07 daquele pipeline e permite editar. Override agora é POR PIPELINE (`_novoStageProbCfg.values = {vendas:{}, bid:{}}`), com migração do formato flat antigo. Resolver `_novoStageProbFor` lê o override do pipeline do deal. Linhas específicas (Reunião Agendada/Diagnóstico só Vendas; Proposta Enviada só Bid) aparecem/somem conforme a aba. Modal de regras atualizado (C07 por pipeline). Validado: inline-js, smoke-render, harness lógico (migração + resolver + fallback) 8/8, ids conferidos. **Lote de 9 concluído.**

### CRO | C07 loading, C08 (toggle Bruto/Ponderado × donuts Receita/Vidas), verificação filtro/prob (2026-07-01)

- **#1 C07 loading:** card ganhou corpo próprio (`novo-winprob-body`); enquanto `_novoFunnelData` não chega, mostra spinner "Carregando funil…"; ao chegar, renderiza o gráfico.
- **#5 C08 reformulado:** toggle agora é **Bruto | Ponderado** (métrica) e os **dois donuts são Por Receita e Por Vidas** (bucket). Bruto = Σ ARR; Ponderado = Σ ARR × prob. por pipeline (C07). Tooltips/ficha PT-EN atualizados.
- **#2/#3 (verificado):** C06 e C07 já filtram por **createdate** — `/api/funnel-stages` filtra deals por data de criação (>= since), e o filtro global do painel dirige since/until (`_novoFunnelEffectiveSince/Until`); reload reconstrói C06+C07. Sem mudança.
- **#4 (verificado):** C04 (`buildSharedStageVal`) e o forecast (N06B via `_calcProbInfo(d).final`) usam a MESMA probabilidade global por pipeline (`_novoStageProbFor` = override → C07 → padrão), com ±10% do AE e Diagnóstico 6%. Confirmado.

### CRO | C08 receita casada com o forecast + dias no título; diagnóstico contagem Bid (2026-07-01)

- **#1 C08 (bug de receita):** deixou de usar `_annualRev` (= arr_estimado / prêmio×12, que inflava corretagem → bruto 225,6M) e passou a usar a MESMA mecânica por deal do forecast (`_novoFcRuleMonthValue`/`_novoFcBidMonthValue`, regras da Cintia, janela de projeção; `weighted` interno). Agora bate com o forecast para os deals de pipe+bid.
- **#2 C08:** nº de dias considerados (span da janela de projeção) ao lado do título.
- **#3 (diagnóstico, sem mudança):** CRO ativo conta 17 Bid (Neg 2 + Proposta 3 + **Reunião Pré-RFP 11** + Consultoria 1); Forecast conta 7 (Neg 2 + Proposta 3 + Consultoria 1 + Standby 1). Diferença = o CRO inclui **Reunião Pré-RFP** (11) como ativo e exclui Standby; o Forecast exclui Pré-RFP (Cintia zera pré-RFP) e inclui Standby. Aguardando decisão de reconciliação.

### CRO | C08 vira TCV do Pipe por Bucket (2026-07-01)

- **C08 = TCV (12 meses) por deal, pela régua real**, distribuído por bucket de Receita e de Vidas, bruto × ponderado. `_novoDealTcv(d)` = Σ calcReceitaMes(1..12) (Diagnóstico = vidas × R$/vida × 12); inclui a corretagem de entrada (é TCV, não ACV). Período FECHADO por deal (independe de quando cai no calendário), resolvendo a perda de recorrência da régua-no-calendário. Deixou de usar arr_estimado (inflado, 139M/225M).
- Total: ~65,0M bruto (132 deals). Responde a pergunta do CRO: "quanto tenho a receber no pipe e quanto cada bucket representa". Título vira "TCV do Pipe por Bucket"; tooltips/ficha PT-EN atualizados. NOVO_TCV_MESES=12 (regra da Cintia); trocar p/ 24 se quiser 2 anos.
- **C04 espelha o TCV do C08:** `buildSharedStageVal` passou a usar `_novoDealTcv(d)` (TCV 12m pela régua) no lugar de `_annualRev`/arr_estimado, com guard (board mantém arr_estimado por paridade). Ponderado usa `_calcProbInfo(d).final` (C07 por pipeline + AE), igual ao C08. Título/tooltip/ficha PT-EN atualizados. C04 e C08 agora reconciliam (mesma base ~65M bruto).

## CRO | Forecast Total (N06B) religado no motor do /forecast + limpeza de gráficos (2026-07-01)

> Rodada focada em fazer o gráfico de forecast do CRO Dashboard **bater EXATAMENTE**, mês a mês, com o painel **Forecast Overall** (que é o do `forecast-stage.html`, não o `forecast.html`), em Receita Real e Probabilizada. Materializa a Regra primária nº 3 (fonte única de receita) no dashboard. Também: remoções de gráficos redundantes e ajustes de UX. Tudo commitado e deployado (`vercel --prod`).

### Remoções e ajustes rápidos
- **C05 (Receita por Segmento) removido:** redundante com o C08 (TCV por bucket) e usava `arr_estimado` inflado. Card + chamada de render retirados; funções/i18n ficaram órfãs (inofensivas).
- **C07 (Prob. de Ganho por Etapa):** eixo Y capado em **40%** (`max:40`) para leitura melhor.
- **N06 (Valor do Pipeline | Projeção Mensal) removido:** redundante com o Forecast Total (N06B). Card + `buildNovoPipeRev12()` do render retirados.

### N01 (Maturidade por Coorte) validado 🟡→🟢
- O tooltip prometia "coortes com 2+ meses e 20+ deals", mas o código usava `MIN_AGE=1/MIN_N=1` (deixava passar coortes de 1 deal → degraus 0/100%). Ajustado para `MIN_AGE=2/MIN_N=20` (honra o tooltip). Método (curva de coorte por `close_date` ÷ tamanho, meses futuros nulos) já estava correto → marcador para 🟢.

### N06B = Forecast Total: religado no ForecastEngine (SSOT)
- **Motor compartilhado no dashboard:** `dashboard.html` passou a carregar `faturamento-manual.js` + `forecast-engine.js` (antes só `revenue-engine.js`) e a configurar `ForecastEngine.config({...})` e `FaturamentoManual.config({dealId})`. `FaturamentoManual.load()` roda no `novoLoadData` antes do render. Assim o N06B usa o **mesmo `dealMonthly()` + `bdrCohorts()` do `/forecast` e `/forecast-stage`** (régua via `calcReceitaMes`, faturamento manual real para Ganho/Implantação).
- **Duas linhas fixas, sem toggles:** removidos os toggles Real/Probabilizado e Receita/Deals e a linha azul "pipe atual (ingênua)". Agora são sempre **Receita Real** (verde, bruta = `Σ .rec`) e **Receita Probabilizada** (azul = `Σ .val = rec × prob`). Eixo Y **auto-escala** (`beginAtZero + grace:'8%'`) para a linha remanescente não achatar quando a outra é ocultada pela legenda. Datalabels aparecem na **primeira linha visível** (na Probabilizada quando a Real some).
- **Janela Jan/2026 → Dez/2027** em N05, N06(removido) e N06B (`_novoProjectionMonthsToDec27` arranca em Jan/26; `_novoCovMonths` idem; sem trim de meses zerados).

### As divergências que foram caçadas até o match exato (verificado por replicação do pipeline do /forecast com dados reais)
1. **Conjunto de deals:** o forecast conta só negócio novo (`createdate >= 2025-09-01`) OU Ganho/Impl. OU Bid desde `2025-01-01`, **sem recorte por etapa**. O N06B usava `_novoCurrentActivePipeline` (cortava Standby/reuniões pelos toggles) → inflava a partir de nov/26. Corrigido: `_novoFcInForecastSet` sobre **todos** os deals; a prob (`sp` nulo → deal não entra) e a régua cuidam das exclusões.
2. **Probabilidade:** o N06B usava os **defaults do dashboard** (Cotação .33/Consultoria .611/Negociação .42/Impl. 1.0) e forçava `won=1`; o forecast usa os defaults dele (.1858/.285/.493/.8) e não força won. Criados `NOVO_FC_STAGE_PROB_DEFAULT` + `_novoFcStageProbForwd` + `_novoFcProbAdj` (espelham o `calcProbInfo`: Diagnóstico fixo 6%; `sp` nulo → deal não entra). Isso explicava o Probabilizado divergir antes do Real (a receita `rec` é prob-independente).
3. **Dedup Fee×Corretagem:** replicado `_fcRevExcluded` (`_novoFcRevExcluded` + `_novoFcDedupKey` — chave sem o modelo no nome; mantém etapa mais avançada → menor TCV 12m → vigência mais distante) — zera a receita do gêmeo.
4. **Bloco BID:** o Forecast Overall (forecast-stage) conta no bloco BID **apenas** deals de Bid em **Negociação/Proposta Enviada**, com **data imputada** (Negociação→out/26, Proposta→jun/27) e **probabilidade fixa `FC_BID_PROB=0,005`**; Bid em outras etapas **não entra** na receita. O N06B contava todo o pipe de Bid com a prob do funil/default → erro de mar/27 (o deal "Biolab Sanus Farmacêutica", Bid Consultoria, R$ 97.463). Corrigido: `NOVO_BID_IMPUTE` (só Neg/Proposta) + `NOVO_BID_PROB=0.005`.
- **Verificação:** script replicando o pipeline do forecast (filtro+dedup+prob+manual+bid+bdr) sobre os deals de produção → mar/27 Bid Real=255.000 e Prob=1.275 idênticos; Pipe (877.985) e Ganho (143.288) confirmados pelo usuário ao vivo. O bloco de **Ganho (faturamento manual)** não é validável localmente (KV vazio no dev) mas usa o mesmo motor/loja do forecast.

### UX final do card
- **Título:** "Forecast Total" (sem "Regras da Cintia"); marcador 🟡 removido (validado).
- **Contagem:** o rótulo antigo "97 de N ativos" (via `_titleWithPipeRevCoverage`, base da linha ingênua) foi trocado por um span próprio (`novo-piperev12b-count`) que conta os deals que **efetivamente geram receita** (~249 = ganhos + pipe Vendas + Bid Neg/Proposta).
- **Drawer do 'i' reescrito:** descreve a lógica atual (duas linhas, mesmo motor do Forecast Overall; blocos Ganho/manual, pipe Vendas, BID 0,5%, topo BDR). Sem menção à "linha 7 da Cintia"/linha azul.

### Constantes/funções novas no `dashboard.html` (bloco do N06B)
`NOVO_VPV_TIERS`, `_novoGetVpv`, `NOVO_FC_MONTHS`, `_novoParseRevDate`, `_novoAddMonthsYM`, `_novoTodayStr`, `_novoCalcReceita`, `_novoFcDealId`, `_novoFcMonthIdx`, `NOVO_FC_STAGE_PROB_DEFAULT`, `_novoFcStageProbForwd`, `_novoFcProbAdj`, `_novoFcMqlConv`, `_novoFcInForecastSet`, `_novoFcDedupKey`/`_novoFcRevExcluded`/`_novoFcTcv12`, `_novoDealWithDate`, `NOVO_BID_IMPUTE`, `NOVO_BID_PROB`.

### Código morto deixado para uma limpeza futura
`buildNovoSegment`/`novoSwitchSegMode` (C05), `buildNovoPipeRev12`/`novoSwitchPipeRevValue`/`Metric`/`_novoSyncPipeRevToggles` (N06), toggles B (`_novoPipeRevValueModeB`/`MetricB` ainda lidos pelo modal), `_titleWithPipeRevCoverage`, e a família `_novoFc*` antiga da Cintia (`_novoFcRuleMonthValue` etc.) ainda usada pelo **N05** (que segue no motor antigo até ser religado).

### Pendente
- **N05** ainda usa o motor antigo (`calcReceitaMes` + Diagnóstico por headcount + MQL própria) e só é Probabilizado. Próximo passo: religar no `ForecastEngine` **e** adicionar toggle **R$ receita ↔ × coverage** (para validar contra o forecast).

## CRO | N05 (Cobertura) religado no motor do N06B (SSOT) + toggle Cobertura/Receita (2026-07-01)

> Resolve a pendência acima. O N05 deixou de ter motor próprio e passou a consumir a MESMA série do N06B, então Receita Real e Probabilizada batem mês a mês com o Forecast Total por construção. Completa a fonte única de receita (Regra primária nº 3) no CRO Dashboard. **Não deployado.**

### Série única (SSOT) extraída
- Novo `_novoForecastSeries()` — extraído do miolo do `buildNovoPipeRev12B` (N06B). Retorna `{months, real[], prob[], cWon/cPipe/cBid/cNew (breakdown real), byMonth (detalhe por deal p/ o drill), contribN}`. Conjunto e regras idênticos ao `/forecast` e `/forecast-stage`: negócio novo (createdate≥set/25) ∪ Ganho/Impl ∪ Bid(desde jan/25), sem recorte por etapa; dedup Fee×Corretagem; bloco BID só Negociação/Proposta com data imputada e prob fixa 0,5%; topo de funil = `ForecastEngine.bdrCohorts()` × conversão MQL; via `ForecastEngine.dealMonthly` (faturamento manual para Ganho/Impl). Janela jan/2026 → dez/2027.
- **N06B** (`buildNovoPipeRev12B`) refatorado para consumir `_novoForecastSeries()` — sem mudança de números (behavior-preserving).

### N05 reescrito
- `buildNovoCoverage` agora consome `_novoForecastSeries()`. Removido o motor antigo do N05 (`_novoCoverageData`, `_novoCovMonths`, `_novoCovComplete`, `_novoCovProb`, `_novoCovInclWon`, `novoToggleCovWon`, o `_novoOpenCoverageDrill` antigo e o morto `novoSaveCovTarget`). Constantes `NOVO_COV_START`/`NOVO_COV_HORIZON` também saíram.
- **Toggle `Cobertura (×) ↔ Receita (R$)`** (`_novoCovMode`, `novoSwitchCovMode`), padrão Cobertura. Duas linhas sempre: Receita Real (verde) e Probabilizada (azul). Em Cobertura, cada linha = forecast ÷ meta mensal (meta anual ÷ 12), com linha de referência 1×; em Receita, os R$ com a linha de meta. Datalabels na primeira linha visível (padrão do N06B).
- **Ganho/Implantação SEMPRE incluídos** (o checkbox "considerar ganhos" saiu) — é o que garante o match com o N06B.
- **KPIs:** Receita Real (24m), Receita Probabilizada (24m), Cobertura de pipe (segurança) = pipe aberto real (pipe+BID+novos) ÷ meta.
- **Drill por deal** reescrito sobre `series.byMonth`: por mês, lista deals com bloco/etapa/n/prob/receita real/probabilizada; topo de funil entra como linha agregada. Consistente com a série (não usa mais o motor antigo).

### Validação (dados de produção, 279 deals via /api/forecast-table)
- `_check-inline-js` 0 erros; `_smoke-render` novoRender OK.
- Harness dedicado capturando os datasets: **N05.Real == N06B.Real** e **N05.Prob == N06B.Prob**, idênticos nos 24 meses; ambos == `_novoForecastSeries`. Total 24m: Real ~R$ 112,9M · Prob ~R$ 12,6M. 246 deals no forecast.
- Título do N05 → 🟢 (era 🟡). i18n `t_coverage`/`tip_coverage`, ficha `NOVO_HELP_CHARTS['coverage']` e `_novoCoverageHelpHtml` reescritos (duas linhas + toggle; sem as 4 camadas empilhadas antigas).

### Código morto restante (limpeza futura)
- `_novoCoverageTarget` (var órfã, ~linha 3000). A família `_novoFc*`/`_novoForecastCalcReceita` antiga **ainda é usada pelo modal do N06B** (`_novoOpenN06BForecastModal` + `_novoN06BWonDrilldown`), que segue no motor antigo — o modal pode divergir do gráfico quando há faturamento manual (o gráfico usa `ForecastEngine`/manual, o modal usa `calcReceitaMes` sem manual). Religar o modal no SSOT é o próximo passo natural.

## CRO | Tooltips + drawers com pipelines/etapas/cálculo/probabilidade (2026-07-02)

> A pedido: todo tooltip ('i') de todo gráfico/KPI deve declarar **quais pipelines e etapas** entram, e todo drawer deve ter pipes, etapas, cálculo e probabilidades. Rodada focada no **CRO Dashboard** (`dashboard.html`), a partir dos fatos extraídos dos builders vivos (não do que o título prometia). **Não deployado.**

- **Escopo:** os 16 gráficos + KPIs efetivamente renderizados em `novoRender` (P01–P05, KPIs de período, S01–S05, C01–C08, N01/N02/N03/N04/N05/N06B/N07/N08/N09). HELP_CHARTS órfãos (conc, segment, piperev12, N-series removidos) foram deixados de lado. cs/cotação/board/ae/bdr/forecast ficam para rodadas futuras.
- **Tooltips (i18n `tip_*`/`*_tip`, PT+EN com paridade):** cada tip passou a nomear pipeline(s) (Vendas 782758156 / Bid 894130090) e as etapas consideradas. **Correções de tips desatualizados vs. o código** (violavam a regra de não expor info errada): `kpi_active_tip` dizia "inclui ganhos, por data de criação" (a base ativa exclui ganhos e não filtra data); `tip_winratesize`/`tip_winfactor` diziam "vs abertos" (o cálculo é ganhos ÷ (ganhos+perdidos)); `tooltip_vidas_ae` listava etapas erradas (Cotação+); `kpi_pipe_reunioes_tip` implicava os dois pipes (é só Vendas). Também: separadores `—` trocados por `|`.
- **Drawers (`NOVO_HELP_CHARTS`):** alinhadas as entradas stale — `ae` ("a partir de Cotação" → base ativa completa), `stage`, `sizedonut` ("via _novoIsOpen" → base ativa exclui Implantação sempre), `cohort`/`freshness`/`winratesize`/`winfactor` (marcadores e cálculo), `winprob` ("chegaram à Implantação" → Ganho absoluto; Implantação é o alvo; Y 40%), `kpi-pipe-reunioes` (só Vendas), e a entrada **`piperev12b`** que ainda falava "linha 7 da Cintia"/"linha azul ingênua"/toggles removidos → agora descreve as duas linhas + blocos (Ganho manual · Vendas régua · Bid 0,5% só Neg/Proposta · topo BDR) + prob (Diagnóstico 6%, funil C07 por pipeline + ±10% AE) + conjunto e janela.
- **Fatos-base (dos builders):** base ativa `_novoIsActivePipelineDeal` exclui **sempre** Ganho/Perdido/Implantação/Standby (Standby e reuniões via toggle) — distinta de `_novoIsOpen` (usada pelo freshness), que inclui Implantação quando "Implantação=Ganho" está OFF. Prob por deal = `_calcProbInfo` (C07 por pipeline + ±10% AE); C07 é a prob-base por etapa (Ganho absoluto ÷ entraram, amostra ≥20).
- **Validação:** `_check-inline-js` 0 erros; `_smoke-render` novoRender OK (1335 deals); paridade i18n **258 pt / 258 en**, zero divergência; `/novo` 200. Um erro de sintaxe (apóstrofo `''` num tip EN) foi introduzido e corrigido antes de fechar.
- **Pendente:** tips em literal PT do C07 (`winprob`) seguem sem i18n (herdado); estender a mesma passada aos demais painéis (board/ae/bdr/48h/cs/cotação/forecast); sub-KPIs dos modais de drill (p02_*/p03_*/p05_*) não foram revisados nesta rodada.

### CRO | N01 legenda isola coorte, N03/N04 escala 30%, N07/N08 médias verificadas (2026-07-02)

- **N01 (Maturidade por Coorte):** clique na legenda agora ISOLA a linha (mostra só ela); clicar de novo na isolada restaura todas (`legend.onClick` custom via `setDatasetVisibility`). Antes era o padrão Chart.js (ocultar a clicada).
- **N03/N04 (Taxa de Ganho por Tamanho / por AE):** eixo Y capado em **30%** (era 50). Verificado com dados de produção: máximos reais 12,8% (N03, bucket 1–50) e 5,5% (N04, Ágatta) — teto seguro.
- **N07 (Tempo em Etapa):** verificado — o campo `stage_medians` do `/api/funnel-stages` calcula **MÉDIA** (nome é legado; `_avgArr` no servidor) e considera **apenas o pipeline de Vendas**. Fallback do cliente trocado de mediana → **média** de `dias_no_pipe`; `_novoMedian` órfã removida. Tooltips/drawer corrigidos (média; só Vendas no histórico; fallback Vendas+Bid). Dados reais: Reunião 24,9d · Diagnóstico 36,1d · Cotação 30,5d · Consultoria 33,9d · Negociação 28d · Implantação 43d — plausíveis, amostras 29–1101.
- **N08 (Velocidade de Qualificação):** verificado — já mostra MÉDIA de dias (28d set/25 → 6d jun/26, n=31–103/mês; range 0–173d). Adicionada ressalva de **censura à direita** nos tips PT/EN: meses recentes subestimam porque só contam deals que JÁ chegaram a Diagnóstico.
- **Validação:** `_check-inline-js` 0 erros; `_smoke-render` OK (1335 deals); `/novo` 200. **Não deployado.**

### CRO | N01 sem emoji, N05 tooltip nos KPIs, N07 replicado do relatório do HubSpot 🟡→validado (2026-07-02)

- **N01:** emoji 🟢 removido do título (`t_cohort` PT/EN + ficha do drawer).
- **N05:** KPIs "Receita real (24m)" e "Receita probabilizada (24m)" ganharam tooltip nativo (hover, `_covKpi` com param `tip`): soma da receita mensal projetada nos 24 meses de calendário da janela (jan/2026 → dez/2027); cada deal contribui só com os meses da régua dentro da janela; **não é TCV nem ARR**.
- **N07 | cálculo replicado do relatório do HubSpot.** Engenharia reversa dos números do CRO (RA 14,7 · Diag 25,6 · Cot 20 · Cons 21 · Neg 19,4): testadas 3 variantes contra o HubSpot ao vivo — a que bate é **MEDIANA do tempo CUMULATIVO por deal, contando apenas períodos CONCLUÍDOS** (o tempo em curso de quem está na etapa agora NÃO conta), com timestamps completos (dias fracionários), pipeline Vendas, deals criados ≥ 2025-09-01. Resultado da réplica: RA 14,9 · Diag 24,9 · Cot 20,1 · Cons 21 (exato) · Neg 19,4 (exato) — desvios ≈ defasagem de datas entre extrações.
  - **Servidor (`api/funnel-stages.js`):** histórico agora carrega `entered_ts` (timestamp completo; `entered_date` mantido p/ C06). Bloco `stage_medians` reescrito: antes era MÉDIA por transição (nome era legado); agora mediana do cumulativo por deal, piso `createdate ≥ 2025-09-01` (respeita `since` mais apertado), `stage_counts` = nº de deals.
  - **Cliente (`dashboard.html`):** fallback trocado para MEDIANA de `dias_no_pipe`; `_novoTimeInStageDeals` com piso set/2025; tooltip do gráfico "(mediana, cumulativo) | n=X deals"; tips PT/EN e ficha do drawer reescritos com a metodologia e a verificação. **🟡 removido do título** (validado numericamente contra o relatório do CRO).
  - Nota: no modo histórico Proposta Enviada não aparece (etapa do Bid; N07 é só Vendas).
- **Infra local:** havia um node antigo preso na porta 3002 servindo o handler cacheado — morto via `Get-NetTCPConnection` e servidor reiniciado (o `local-server.js` cacheia `require` dos handlers; mudou API = reiniciar).
- **Validação:** `_check-inline-js` 0 erros; `node --check` funnel-stages OK; `_smoke-render` OK (1335 deals); paridade i18n 258/258; `/api/funnel-stages` devolvendo os números do Hub; `/novo` 200. **Deployado** (`vercel --prod --yes`, páginas 200 / APIs 401 confirmados; junto com a rodada de tooltips/drawers).

### CRO | N08 religado na propriedade calculada do HubSpot (2026-07-02)

> A pedido: o N08 passa a usar a propriedade `cumulative_time_negocio_criado_ate_diagnostico_formula` criada pelo CRO no HubSpot — média mês a mês (pelo mês de CRIAÇÃO do negócio), com censura explícita no tooltip. **Deployado** (`vercel --prod --yes`; páginas 200, APIs 401, conteúdo novo confirmado no HTML de produção).

- **Propriedade (inspecionada via API):** fórmula `time_between(hs_v2_date_entered_1144746905, hs_v2_date_entered_1144746906)` = entrada em Reunião Agendada → entrada em Diagnóstico, em **milissegundos**; calculada; só existe para quem JÁ chegou a Diagnóstico (510+ deals de Vendas).
- **`api/forecast-table.js`:** propriedade adicionada a `PROPERTIES`; novo campo `tempo_ate_diag_dias` (ms ÷ 86.400.000, 1 decimal; null = não chegou a Diagnóstico).
- **`buildNovoSpeedQualify` reescrito:** fonte única = `tempo_ate_diag_dias` (não depende mais do funil histórico nem tem fallback por `dias_no_pipe`). Agrupa por mês de createdate (set/2025 → mês atual), média com 1 decimal. Tooltip do gráfico: "X dias até Diagnóstico (média | n deals)" + footer fixo "Criados recentemente que ainda não chegaram a Diagnóstico NÃO aparecem". Drill por mês mantido.
- **Textos:** `tip_speedqualify` PT/EN e ficha do drawer reescritos (fonte = a fórmula do Hub, ms → dias, censura à direita explícita, como auditar). 🟡 removido do título (fonte agora é a própria propriedade do CRO, verificada com dados de produção).
- **Validação (dados de produção):** 524/1335 deals com o campo; médias por mês de criação: set/25 21,5d · out 19,6 · nov 19,6 · dez 23,3 · jan/26 13,3 · fev 11,2 · mar 11,3 · abr 8,1 · mai 10,0 · jun 6,9 (n=30–106/mês) — coerentes com a derivação anterior via funil. `_check-inline-js` 0 erros; `node --check` forecast-table OK; `_smoke-render` OK; paridade i18n 258/258; `/novo` 200 (servidor local reiniciado para recarregar o handler).

### CRO | N07/N08 tooltips e drawers alinhados ao comportamento real (2026-07-02)

> A pedido: garantir tooltips e drawers do N07 e N08 atualizados. Auditoria fina achou 4 desalinhamentos. **Não deployado.**

- **N07 tooltip da barra:** "(mediana, cumulativo)" → autoexplicativo: `Xd | mediana do tempo total na etapa | n deals`, com footer "Metade dos deals ficou menos que isso na etapa, metade ficou mais" (PT/EN).
- **N07 contagem do título:** antes usava a base do FALLBACK (`_novoTimeInStageDeals`, Vendas+Bid) mesmo no modo histórico (só Vendas) — número não relacionado ao gráfico exibido. Agora span próprio (`novo-tis-count`) preenchido pelo builder: histórico → "histórico do funil | n por etapa no tooltip"; fallback → "N deals (fallback)". (Somar os n por etapa supercontaria: o mesmo deal passa por várias etapas.)
- **N08 selo "Filtro de período usa":** `NOVO_FILT_FIELD['speedqualify']` corrigido `create` → `none` (o builder novo tem janela FIXA set/2025 → mês atual e ignora o filtro global); ficha do drawer explicita "o filtro global de período não se aplica a este gráfico".
- **N07 ficha (campo createdate):** esclarecido que o piso set/2025 é fixo e o filtro global pode APERTAR a janela (dirige o Desde/Até do funil), nunca alargá-la.
- **Validação:** `_check-inline-js` 0 erros; `_smoke-render` OK (1335 deals); paridade i18n 258/258.

### Menu | CRO Dashboard 🟢 no menu; P04 mostra colaboradores (2026-07-02)

- **Saúde do CRO no menu/dropdown:** `health:'y'` → `'g'` no bloco `PANELS` compartilhado, propagado aos **10 arquivos** que o carregam (dashboard, board, ae, bdr, 48h, cs, cotacao, forecast, forecast-stage, forecast-panel — o bdr tinha ficado de fora da primeira passada do sed e foi corrigido).
- **P04 (Reuniões Agendadas):** subtítulo do card deixou de somar vidas e passa a somar **colaboradores** (`quantidade_de_colaboradores`). Chave i18n `vidas_potenciais` (usada só ali) substituída por `p04_colaboradores` (PT 'colaboradores' | EN 'employees'). Tooltip PT/EN e ficha do drawer atualizados (campo novo na tabela). Dados de produção: 98 deals em Reunião Agendada, 403.978 colaboradores (98/98 com o campo; antes: 20.250 vidas).
- **Validação:** `_check-inline-js` 0 erros; `_smoke-render` OK; paridade i18n 258/258; nenhuma referência órfã a `vidas_potenciais`.
- **Incidente no deploy (resolvido):** o `sed -i` usado para propagar o health corrompeu o `public/bdr.html` (multiplicou bytes NUL — o arquivo commitado JÁ tinha 3 NULs pré-existentes, o que fazia o grep tratá-lo como binário) e a versão corrompida chegou a ser deployada. Correção: `git checkout -- public/bdr.html` + reaplicação do health via Edit + redeploy. Lição: **não usar sed -i nos HTML deste repo** (o bdr.html tem NULs herdados); usar a ferramenta de Edit. Pendência de limpeza: remover os 3 bytes NUL do bdr.html num commit próprio.
- **Deployado e verificado:** 8 rotas 200 e `health:'g'` do CRO confirmado no HTML de produção em todas (incl. /novo-bdr).

### Todos os painéis | "i" e tags de identificação VISÍVEIS por padrão (2026-07-02)

- Nos 6 painéis com o toggle "?" (dashboard, board, ae, bdr, cs, cotacao), o padrão dos botões "i" (tooltips) e das tags de código (C01/P01/N01…) passou de OCULTO para **VISÍVEL**: o init de `_novoShowInfo`/`_boardShowInfo` mudou de `localStorage === '1'` para `!== '0'` — quem nunca mexeu vê tudo; quem desligar no "?" persiste '0' e continua respeitado. 48h e forecast/forecast-stage/forecast-panel não têm o mecanismo (os "i" já são sempre visíveis).
- bdr.html editado via Edit (não sed | NULs herdados intactos: 3).
- **Validação:** `_check-inline-js` 0 erros nos 6; `_smoke-render` OK; 6 rotas locais 200. **Deployado** junto com a rodada seguinte.

## BDR Performance | KPIs reformulados (R01/R02/R03) + time de BDRs canônico (2026-07-02)

> A pedido do CRO: os 5 KPIs antigos (Vidas Pipe Ativo/Ganhas/Perdidas/Reuniões/Ponderadas) saem; entram 3, todos com tooltip ("i" com data-tip): **R01** Deals Originados no Mês | BDRs · **R02** Colaboradores Originados no Mês | BDRs · **R03** Reunião Agendada há +30 dias. Grid do kpi-row 5→3 colunas.

- **Time de BDRs (regra de negócio):** o time é EXATAMENTE os 13 nomes do drawer de Configurações (`window.BDR_LIST` em `settings-modal.js`): Anderson Souza, Cintia Rodrigues, Gabriele Almeida, Priscilla Feliciello, Leticia Romão, Allan Valença, Bruna Reis, Emanuelle Braga, Felipe Andrade, Giovana Nunes, Marcelli Netto, Thauan Pontes, Yokyko Muramoto. Novos helpers `_teamBdrName`/`_isTeamBdr`: normalização NFD (tolera acentos: Cíntia→Cintia) + `BDR_HS_ALIAS` para grafias do HubSpot que diferem do drawer (verificadas nos dados): 'Gabriele de Almeida Silva'→Gabriele Almeida · 'Bruna Cristina Dos Reis Silva'→Bruna Reis · 'Giovana Rocha'→Giovana Nunes (⚠ suposição: única Giovana nos dados; sobrenome difere do drawer — confirmar com o CRO). 'Cintia Minamoto' e demais owners fora da lista NÃO contam.
- **R01:** deals com entrada em Reunião Agendada (`data_reuniao_agendada` = BDR_ORIG_DATE, não createdate) no mês corrente E sdr do time. Mês fixo | não segue o filtro de período.
- **R02:** Σ `colaboradores` dos mesmos deals do R01.
- **R03:** deals com estágio ATUAL = Reunião Agendada e entrada na etapa há mais de 30 dias; todas as origens (BDR e AE); sem a data de entrada → fora. Amarelo quando > 0.
- Todos com tooltip explicativo no "i" e drill (clique abre o modal com os deals). `bdrKpiOpen` reescrito; `BDR_CARD_CODES` atualizado (kpi-* antigos removidos).
- **Validação (dados de produção, 2026-07-02):** R01 = 5 deals em jul/26 (Cintia 2 · Gabriele 1 · Giovana 1 · Priscilla 1) · R02 = 984 colaboradores · R03 = 46 de 98 em RA (0 sem data). Matching: 672/979 deals com sdr são do time. `_check-inline-js` 0 erros; `_smoke-render` OK (1335 deals); NULs herdados intactos (3); `/novo-bdr` 200.

### BDR Performance | gráficos R11–R15 restritos ao time; handoff invertido (2026-07-02)

> A pedido do CRO, continuação da reformulação: todos os gráficos de originação passam a considerar APENAS o time de BDRs (13 do drawer) e a data de ENTRADA em Reunião Agendada.

- **R03:** agora conta só deals originados pelo time (`_isTeamBdr`); tooltip/sub/drill atualizados.
- **R12 (Originação por BDR):** base `_isTeamBdr`; rótulos = nome canônico do drawer (`_teamBdrName`); "(Top 15)" removido do título (13 BDRs, ninguém é cortado); tooltip reescrito.
- **R13 (Weekly):** base `_isTeamBdr` + rótulos canônicos; a semana já era pela entrada em RA.
- **R14 (Novos Leads por Mês):** série de AE REMOVIDA — só o time de BDRs, uma série; título "Novos Leads por Mês | BDRs"; modo Colaboradores = Σ campo colaboradores (antes contava "originadores distintos"); mês pela entrada em RA (já era); drill por mês.
- **R15 (Handoff):** título "BDR → AE Handoff Matrix" (sem "Quality"); eixos INVERTIDOS: linhas = AEs (Top 8), colunas = BDRs do time (todos os 13, sem slice); executivos excluem Anderson, Gabriel (a pedido) + aurilia/gabriele (já excluídos) + qualquer BDR do time que apareça como owner (Yokyko/Bruna tinham 1 deal próprio); `bdrHandoffCell(ai,bi)` ajustado. Descoberta: os 3 bytes NUL do bdr.html NÃO são corrupção — são o separador da chave da célula do handoff (`b+'\0'+a`), design intencional (documentado no código). O bloco foi reescrito via script Node preservando-os (Edit tool não expressa NUL).
- **R11 (Distribuição de Porte):** base `_isTeamBdr`; verificado que o toggle Colaboradores JÁ usa quantidade_de_colaboradores (e Vidas usa vidas — nunca misturam); tooltip PT/EN reescrito; count do card = deals do time.
- **Item 6 (janela temporal):** verificado — NENHUM gráfico do painel usa createdate como janela: todos os de originação usam `_origDeals()` (AxFilter sobre `data_reuniao_agendada`); ganhos/perdidos por close_date (saídas). Sem mudança necessária.
- **Facet modal:** `_fBdr` agora resolve para o nome canônico do time (fallback no nome cru); helper `_teamBdrByName(string)` extraído para reuso.
- **Incidente evitado:** o script Node da reescrita comeu a `\` do regex (`/s+/`) — pego na revalidação e corrigido via Edit.
- **Validação:** dados de produção: R12 = 665 deals do time (13/13 BDRs com originação); R15 = 607 pares com os 6 AEs core (Rafael 119 · André 117 · Juliana 113 · Guilherme 108 · Fausto 102 · Ágatta 47); R14 mensal abr 85 · mai 266 · jun 98 · jul 5. `_check-inline-js` 0 erros; `_smoke-render` OK; NULs = 3; `/novo-bdr` 200.

### BDR Performance | drawer de fichas por gráfico (padrão CRO) no clique do "i" (2026-07-02)

> A pedido: replicar no painel BDR o comportamento do CRO — hover no "i" = tooltip; CLIQUE no "i" = drawer lateral com a ficha completa (desc + fórmula + campos do HubSpot).

- **`BDR_HELP_CHARTS` reescrito:** 12 fichas com keys = os keys reais dos cards (R01/R02/R03 + origin-bdr/weekly-origin/leads-origin/handoff/net-flow/net-vidas/avg-vidas/colabs/size-dist). O array antigo tinha keys órfãs (`bdr-origin-bdr`, `bdr-stage-entry`, `bdr-new-deals`…) que não batiam com nenhum card e entradas desatualizadas ("BDR vs AE").
- **Conteúdo fiel aos builders:** cada ficha declara escopo (time do drawer × campo sdr cru), a data-dimensão (entrada em Reunião Agendada = `hs_v2_date_entered_1144746905`), fórmula quando aplicável e a tabela campo→uso. Fichas de R07/R08/R10 explicitam com ⚠ que usam o campo `sdr` CRU (qualquer owner, não restrito aos 13) e a do R09 que considera TODAS as origens — documentado o real, não o ideal.
- **Novo aparato:** `_bdrHelpRow`/`_bdrHelpSection`/`_bdrOpenHelp`/`bdrHelpChart` (espelho do CRO), `BDR_HELP_DETAIL` (colunas do modal de deals), `novo-help-title` dinâmico no header do drawer. `_infoBtn` ganhou onclick quando a key tem ficha. Botão "?" do header agora abre TODAS as fichas (antes era uma tabela achatada de 3 colunas).
- **Validação:** 12/12 fichas com code em `BDR_CARD_CODES`; `_check-inline-js` 0 erros; `_smoke-render` OK (1335 deals); NULs = 3; `/novo-bdr` 200.

### BDR Performance | metas MENSAIS por BDR (modal global) + R07–R10/R14 reformulados (2026-07-02)

> Rodada grande a pedido do CRO. **API alterada** (`api/bdr-metas.js`) — servidor local da 3002 reiniciado 2× nesta rodada (⚠ sessões paralelas: revalidar se estavam usando a porta nesse intervalo).

- **Metas mensais (novo):** botão **"Metas"** no card R12 abre modal com tabela mês × BDR (12 colunas do ano, seletor ‹ano›; linhas = 13 BDRs do drawer), edição GLOBAL. `api/bdr-metas.js` migrado de /tmp (efêmero!) para **Upstash KV** (Regra do projeto), chave `bdr:metas` = `{metas (flat legado), monthly: {"YYYY-MM": {nome: meta}}}`; POST faz merge por mês; validação de formato; fallback `os.tmpdir()` no dev (o /tmp hardcoded nem existia no Windows — dava ENOENT). GET/POST/validação testados no local. Grafias dos DEFAULTS corrigidas p/ casar com a BDR_LIST (Letícia→Leticia, Emmanuelle→Emanuelle — divergência herdada que quebraria o fallback flat).
- **Atingimento por janela (R12):** `_bdrGoalFor(nome)` = Σ metas mensais dos meses da janela do filtro (meses sem meta mensal usam a meta flat); sem filtro = Σ das metas mensais cadastradas (sem cor quando não há nenhuma). Lookup antigo por primeiro nome removido (nomes já são canônicos). Drawer de Configurações intacto (settings-modal.js é módulo compartilhado — não tocado); as metas flat dele viram o fallback.
- **R14:** título → **"Monthly Origination (por BDR)"**; empilhado por BDR (Top 6 + Outros, desenho do R13), 12 meses por entrada em RA, só time. Drill por segmento (BDR) ou mês.
- **R07:** restrito ao time (`_isTeamBdr` em entrada e saídas); rótulos (datalabels) visíveis por padrão em cada segmento.
- **R08:** métrica trocada de vidas → **COLABORADORES**; título "Net Flow de Colaboradores"; só time; rótulos visíveis.
- **R09:** métrica trocada de vidas → **colaboradores médios/deal**; só time; números pt-BR (ponto milhar, vírgula decimal, 1 decimal) nos datalabels, tooltip e eixo Y; título "Colaboradores Médios por Deal".
- **R10:** donut refeito — **uma fatia por BDR do time** (era BDR vs não-BDR); centro = total do time; % nas fatias ≥4%; título "Share de Originação por BDR"; drill por fatia.
- **Datas BR nos modais:** `_fmtBR` (dd/mm/aaaa) nas colunas Criado/Reun. Ag./Fechado de todas as tabelas de deals do painel.
- **i18n PT/EN + 6 fichas do drawer** (R07/R08/R09/R10/R12/R14) reescritas para o comportamento novo (avisos ⚠ de sdr-cru removidos onde deixaram de valer; fórmula da meta por janela documentada na ficha do R12).
- **Validação:** `_check-inline-js` 0 erros; `node --check` bdr-metas OK; `_smoke-render` OK (1335 deals); NULs = 3; POST/GET/validação do bdr-metas testados no local; `/novo-bdr` 200.

## AE Performance | Drawer sem metas BDR, probabilidades do funil (SSOT), réguas A09/A17, datas por Reunião Agendada, drill A15 com texto do declínio (2026-07-02)

> A pedido: 6 mudanças no painel AE (`public/ae.html`). Uma mudança de API aditiva (`api/forecast-table.js`: campo novo no payload — contrato preservado). **Não deployado.**

- **Drawer de Configurações sem a seção Metas (só neste painel):** `novoOpenSettings` do `settings-modal.js` (compartilhado, NÃO alterado) é embrulhado no `ae.html` para esconder `.np-bdr-row`, o separador "Metas", o aviso e o botão "Salvar Metas" — lista de metas de BDR não faz sentido no painel AE. Demais painéis intactos.
- **Probabilidades puxadas do funil histórico (mesma fonte do Forecast/CRO):** o `ae.html` agora busca `/api/funnel-stages?since=2025-08-01` (não bloqueia o 1º render; re-renderiza quando chega) e deriva: (a) `NOVO_FUNNEL_PROB_PIPE` = C07 por pipeline (ganho absoluto ÷ entraram, amostra ≥ 20); (b) mapa flat `NOVO_STAGE_PROB` = alcance de Implantação (C06, combinado) — é o que o drawer exibe. Novos `_novoStageProbFor(stage,pipeline)` (manual > funil do pipe > padrão, espelho do CRO) e `_aeProbAdj(d)` (Diagnóstico fixo 6% + ajuste ±10% do AE, espelho do `_novoFcProbAdj`). O `sharedProbFinal` do shared-charts é sobrescrito SÓ neste painel para o A07 ponderar com a prob do funil por pipeline. Override manual: `novo_stage_prob` no localStorage vence o funil (mesma semântica do CRO com a chave legada); "Salvar Probabilidades" no drawer vira override manual na própria sessão. Valores vivos (2026-07-02): flat RA 2,4% · Diag 5% · Cot 14,8% · Cons 22% · Neg 41,9%; C07 Vendas RA 1,3% · Cot 8% · Cons 12% · Neg 23,7% (Bid sem amostra ≥ 20 → padrão).
- **A09 (Taxa de Ganho Ajustada):** eixo Y capado em **20%** (era 50). Máximo real hoje: 5,5% (Ágatta).
- **A17 (AE Efficiency):** eixo X (total de deals) com folga fixa de **±20** em torno dos dados (com os totais atuais 157–179 → eixo 137–199), em vez de começar no zero.
- **Datas por Reunião Agendada (em vez de createdate) em todos os gráficos:** A16 agrupa por mês de `data_reuniao_agendada` (deals sem a data ficam fora; era createdate); A12/A13 medem idade como dias desde a entrada em RA via novo `_aeRaDays()` (era `dias_no_pipe`; cobertura 250/253 abertos = 99%); coluna "Criado" das tabelas de drill virou "Reunião Ag." (`data_reuniao_agendada`). Tooltips, fichas e i18n atualizados; tooltip do A07 reescrito (mencionava o N06, já removido do CRO).
- **A15 (Motivos de Perda) com justificativa em texto:** `api/forecast-table.js` ganhou a propriedade `motivo_de_declinio_perdido___descricao` → campo `lost_reason_desc` no payload (ADITIVO — não quebra consumidores). Drill do A15 usa modal próprio (`_aeLostDealsModal`) com coluna **"Motivo declínio (texto)"** (texto aberto, com wrap). Cobertura: 1004/1056 perdidos com o texto.
- **Infra local:** servidor da 3002 reiniciado 1× para recarregar o handler do forecast-table (havia node antigo preso na porta servindo o handler cacheado — morto antes de subir o novo). ⚠ Sessões paralelas: se estavam validando contra a 3002 nesse intervalo, revalidar.
- **Validação (dados de produção):** `_check-inline-js` 0 erros; i18n PT=24/EN=24; `_smoke-render` OK; `node --check` forecast-table OK; `/novo-ae` 200. Harness dedicado interceptando `_novoMkChart` com deals+funil vivos confirmou: probs do funil aplicadas; A09 y.max=20 (dado máx 5,5); A17 x=137–199; A16 = 1109 deals por mês de RA; A12 médias 49–68d desde RA; A13 soma 249; A07 Probabilizado = 24% do Real; modal A15 com a coluna e os textos presentes.

### AE Performance | KPIs Estagnados (S05) + Reuniões Agendadas (P04), A09 sem 🟡, A10 totais+tooltip por AE, A17 tooltip (2026-07-02, rodada 2)

> A pedido: 4 mudanças no painel AE (`public/ae.html`, front-only). **Não deployado.**

- **Dois KPIs novos (grid 4→5 colunas):** **S05 | Deals Estagnados** = base ativa com `dias_sem_atividade > 30` (via `notes_last_updated`; mesma regra do S05 do CRO), amarelo quando > 0, sub mostra % dos ativos; **P04 | Reuniões Agendadas** = deals com etapa atual Reunião Agendada (snapshot). Clique abre modal próprio com as datas relevantes: estagnados → Última atividade + Dias sem atividade (ordenado do mais estagnado; dias em vermelho quando > 90); reuniões → Entrada em RA (`data_reuniao_agendada`) + Dias na etapa (amarelo quando > 30), com vidas e colaboradores.
- **A09:** 🟡 removido do título (chamada `c()` com noEmoji).
- **A10 (Deals Ganhos por Mês):** datalabel com o TOTAL de ganhos do mês no topo da pilha (soma só datasets visíveis; some com a legenda); tooltip em `mode:'index'` discriminando os ganhos de todos os executivos do mês (zeros filtrados) + rodapé "Total: N ganhos".
- **A17:** tooltip da bolha reordenado para **deals | vidas | win rate**, com vidas em separador de milhares (`_ni`).
- **Validação (dados de produção, harness `_novoMkChart` + captura de `openModal`):** estagnados = 51 de 252 ativos (modal 51 linhas, colunas certas); reuniões = 98 (bate com o P04 do CRO; modal 98 linhas); A09 sem 🟡 no HTML renderizado; A10 totais por mês out/25=1 · dez/25=1 · fev/26=2 · mar/26=4 · abr/26=2 · mai/26=5 · jun/26=9 · jul/26=2 (Σ=26 = ganhos) e tooltip index OK; A17 "157 deals | 123.456 vidas | win rate 0,9%". `_check-inline-js` 0 erros; i18n 24/24; `_smoke-render` OK; `/novo-ae` 200.

### BDR Performance | fix cores R12 (Leticia/Emanuelle), metas fora do drawer, tooltips index R13/R14, base 665 nos R07-R10 (2026-07-02)

- **R12 (bug de cor):** Leticia Romão e Emanuelle Braga sem cor de atingimento — causa: o localStorage/KV antigo guarda metas flat com grafias legadas ('Letícia Romão', 'Emmanuelle Braga') e o lookup novo era por chave exata (e eu havia removido o fallback da BDR_LIST). Fix: `_bdrFlatGoal(name)` com normalização NFD + alias ('emmanuelle'→'emanuelle') + fallback final no goal da BDR_LIST. E o ramo sem-filtro do `_bdrGoalFor` volta a cair na meta flat quando não há NENHUMA meta mensal cadastrada (comportamento legado preservado).
- **Drawer de Configurações (settings-modal.js, compartilhado):** seção "Metas" dos BDRs e o botão "Salvar Metas" REMOVIDOS — edição agora é só pelo modal do card R12. Mantido o fetch de `/api/bdr-metas` no open (popula `window.BDR_METAS`, fallback das mensais). `novoSaveMetas`/`_bdrRowHtml`/CSS np-bdr-* removidos. Vale para todos os painéis que carregam o módulo.
- **R13/R14:** tooltip em `mode:'index'` — hover numa barra mostra TODOS os BDRs do período com seus números de uma vez (zeros filtrados).
- **R07/R08/R09/R10 | base única 665:** todos passam a considerar exatamente os deals ORIGINADOS pelo time (sdr do time + `data_reuniao_agendada` preenchida) — nos R07/R08 as SAÍDAS (ganhos/perdidos) também exigem a data de originação (antes deals do time sem registro de RA vazavam na saída); drills alinhados. Verificado com dados de produção: base = 665 (R07 saídas: 8 ganhos · 465 perdidos dentro da base; R09: 602/665 com colaboradores; R10: 13 fatias somando 665).
- **Validação:** `_check-inline-js` 0 erros; `node --check` settings-modal OK; `_smoke-render` OK (1335 deals); NULs = 3; harness da base 665 OK.

### AE Performance | tabelas dos modais ordenáveis, S05/P04 com Pipe+Etapa, A17 sem 🟡, A11 só executivos, A12 verificado (2026-07-02, rodada 3)

> A pedido: 5 mudanças no painel AE (`public/ae.html`, front-only). **Não deployado.**

- **Todas as tabelas de modais ordenáveis:** sorter genérico por delegação (`#modal-body table.lb th` clicável, asc ↔ desc com seta ▲/▼) — vale para TODOS os modais do painel (deals, perdidos, estagnados, reuniões, filtrados por AE), sem tocar nos builders. Parser `_aeSortParse`: número pt-BR (1.234 | 5,5 | 12%), moeda `_revShort` (R$1.2M | R$500k), datas ISO e dd/mm/aaaa, '—' vai para o fim, texto via localeCompare pt-BR. Ordena só o `tbody` (cabeçalho e rodapé sticky intactos).
- **S05 (Estagnados) e P04 (Reuniões Agendadas):** modais ganharam colunas **Pipe** e **Etapa** (S05 já tinha Etapa; P04 ganhou as duas).
- **A17:** 🟡 removido do título.
- **A11 (Distribuição de Etapas por AE):** considera APENAS os executivos do time (`_isCoreAE`) — barras, contagem do título e tooltips PT/EN atualizados. Antes entravam Aurilia, Gabriele e outros owners não-AE.
- **A12 (Idade Média):** verificado com dados de produção que a base (`_novoOpen`) JÁ exclui fechados — 252 deals na base, 0 Ganho/Perdido/Implantação. Nenhuma mudança de cálculo; tooltips PT/EN agora explicitam "apenas deals abertos | fechados ficam fora".

## Board View | C03→C08, C04 = C04 do CRO (TCV), ponderação global (prob-engine.js), B11 por Reunião Agendada (2026-07-07)

> A pedido: 4 mudanças no Board View (`public/board.html`, front-only) + **novo arquivo compartilhado `public/prob-engine.js`**. **Não commitado, não deployado** (sessão paralela ativa em AE/CRO/48h no momento).
>
> ⚠ **Duplicação temporária (a reconciliar):** a lógica de probabilidade (C07 por pipeline + ±10% do AE + override manual) foi extraída para `prob-engine.js` (cópia **verbatim** da inline do CRO) e ligada SÓ ao board por ora — o `dashboard.html` não foi tocado porque uma sessão paralela estava nele. A migração do CRO para consumir o `prob-engine.js` (eliminando a cópia inline) fica para um momento coordenado. Enquanto isso os números batem (mesma lógica).

- **Novo `public/prob-engine.js` (fonte única de probabilidade):** IIFE→`window.ProbEngine` no mesmo padrão do `revenue-engine.js`. Expõe `DEFAULT`, `MIN_SAMPLE=20`, `loadCfg()` (lê a MESMA chave do CRO, `novo_stage_prob_cfg`, com migração do flat antigo), `funnelDerivedProbPipe(funnelData)` (C07 por pipeline), `stageProbFor(stage,pipeline,ctx)` (override manual > funil do pipe > default) e `calcProbInfo(deal,ctx)` (ajuste ±10% do AE). Puro/stateless: a página injeta `{cfg, funnelProbPipe}` via `ctx`.
- **Board consome os motores compartilhados:** `board.html` passou a carregar `/revenue-engine.js` e `/prob-engine.js`. Definiu no seu escopo `_novoDealTcv` (TCV 12m pela régua + Diagnóstico = vidas×R$/vida×12, cópia do CRO), `_novoStageProbFor` e `_calcProbInfo` (delegam ao `ProbEngine`). Como o `shared-charts.js` já tem os guards `typeof _novoDealTcv`/`_calcProbInfo`, o **C04** (`buildSharedStageVal`) passou a usar TCV + prob global automaticamente. `_croCalcProbInfo` agora delega a `_calcProbInfo` (tabelas de modal consistentes com os gráficos).
- **Item 1 | C03 → C08:** o card "Distribuição por Tamanho" (donut único) foi substituído pelo **"TCV do Pipe por Bucket"** (dois donuts, Por Receita e Por Vidas, toggle Bruto/Ponderado), espelhando o C08 do CRO. Métrica = `_novoDealTcv` (Bruto) e `_novoDealTcv × _calcProbInfo(d).final` (Ponderado). Código do card no `BOARD_CARD_CODES`: `deal-bench` = **C08** (era C03). Novo `_bdRevBucketsCard()`/`buildBdRevBuckets()`; i18n `bd_revbkt`/`bd_revbkt_tip` (PT+EN) e help atualizados.
- **Item 2 | C04 = C04 do CRO:** agora usa **TCV pela régua** (não mais `arr_estimado`) e, no modo Ponderado, a **probabilidade final global** (C07 por pipeline + ±10% do AE). Título/tooltip/help do `pipe-stage` atualizados (ARR→TCV). Mesmas premissas do CRO.
- **Item 3 | B14/B15/B16:** a ponderação trocou a cascata local (`d.probabilidade ?? NOVO_STAGE_PROB[stage]`) por `_calcProbInfo(d).final` — mesma probabilidade global do CRO. Base de receita mantida em `arr_estimado` (decisão do usuário). **B12 (ARR Bridge) ficou fora** (é variação do ARR ganho, não usa ponderação).
- **Item 4 | B11 (Entrada vs Saída):** a série de ENTRADA passou a usar `d.data_reuniao_agendada` (data de entrada na etapa Reunião Agendada, já no payload) em vez de `createdate`; rótulo "Entrada (reunião agendada)". Só Vendas tem RA → deals de Bid ficam fora dessa série (documentado no tooltip/help). `BOARD_FILT_LABEL.both` atualizado.
- **Funil (C07) auto-carregado em silêncio:** `_boardLoadFunnel()` busca `/api/funnel-stages?since=2025-01-01` uma vez no load, seta `_novoFunnelData`/`NOVO_FUNNEL_PROB_PIPE` e re-renderiza. Indicador "⟳ carregando probabilidades…" na linha de status enquanto carrega. Override manual dispensa o funil.
- **KPI P03 (Receita Ponderada) intacto:** segue via `sharedWeightedPipelineARR` (prob flat) — mantém paridade com o P03 do CRO (não editei `shared-charts.js`, que é compartilhado e afetaria o CRO).
- **Validação (dados de produção, harness carregando os 3 motores no sandbox + `novoRender`):** 0 erros em 4 cenários (com/sem funil × bruto/ponderado). C04 cru = TCV [Diag 40,2M · Cot 1,95M · Prop 9,13M · Cons 5,94M · Neg 8,26M]; C04 ponderado reage ao funil (Cot/Cons/Neg mudam, Diag/Prop caem no default); C08 dois donuts com TCV; B11 entrada por RA [.. Mai/26=295 ..]; B14 ponderado 33,1M (sem funil) → 29,6M (com funil, C07). C07 vivo Vendas: RA 1,3% · Cot 8% · Cons 12% · Neg 21,9% (Bid < 20 amostras → default). `node --check prob-engine.js` OK; `/novo-board`, `/prob-engine.js`, `/revenue-engine.js` → 200.
- **Validação (dados de produção, harness):** parser do sorter OK em todos os formatos; S05/P04 com as colunas novas; A17 sem 🟡 no HTML renderizado; A11 = só os 6 AEs core (André, Fausto, Guilherme, Juliana, Rafael, Ágatta); A12 base 252/0 fechados. `_check-inline-js` 0 erros; i18n 24/24; `_smoke-render` OK; `/novo-ae` 200.
- **Nota de coordenação:** a remoção da seção Metas no `settings-modal.js` (rodada BDR acima) torna o wrapper AE de ocultação um no-op inofensivo — mantido como defesa caso a seção volte; `novoOpenSettings`/`novoSaveProbs` seguem existindo e os wrappers do AE continuam válidos.

### Menu | BDR Performance 🟢 (2026-07-02)

- `health:'y'` → `'g'` do BDR Performance no bloco `PANELS`, propagado aos 10 arquivos via Edit (sem sed; NULs do bdr.html intactos = 3). Validado: 10/10 com 'g', 0 restantes com 'y', inline-js 0 erros. **Não commitado e não deployado** (a pedido — sessão paralela ativa).

### AE Performance | rate limit, A07 no ForecastEngine (paridade N06B), fichas no "i", A09, A16/A18 por RA, datas BR, contagens, A13 chips (2026-07-02, rodada 4)

> A pedido: 8 mudanças no painel AE (`public/ae.html`). **NÃO commitado e NÃO deployado (a pedido explícito).**

- **Rate limit do HubSpot (erro reportado no load):** causa = duas chamadas pesadas em paralelo no load. Mitigação: o funil (`/api/funnel-stages`) agora só é buscado DEPOIS que os deals chegam e fica cacheado em sessionStorage por 30 min (`ae_funnel_cache_v1`); o `forecast-table` com erro de rate limit faz retry automático (até 2×) com contagem regressiva de 30s na tela.
- **A07 religado no ForecastEngine (resposta: NÃO estava no motor — agora está):** o A07 usava o motor antigo (régua própria sobre ativos com data prevista, ~100 deals). Agora o `ae.html` carrega `revenue-engine.js` + `faturamento-manual.js` + `forecast-engine.js`, porta o bloco FC do dashboard (`NOVO_FC_MONTHS`, `_novoFcInForecastSet`, dedup Fee×Corretagem, `NOVO_BID_IMPUTE`/`NOVO_BID_PROB`, `_novoFcProbAdj` com defaults do /forecast) e o novo `_aeForecastByAE()` agrega POR AE o mesmo conjunto/motor do N06B. **Paridade verificada com dados de produção: Real R$ 82.688.156 e Prob R$ 6.449.337, diferença ZERO vs `_novoForecastSeries()` do dashboard (menos topo BDR, que não tem AE)**. 245 deals contribuindo (era ~100). Tooltip/ficha/drill declaram: a métrica NÃO é ARR nem TCV — é a soma das receitas mensais projetadas na janela jan/26→dez/27. `FaturamentoManual.load()` roda após os deals (KV local vazio → bloco manual zera no dev, igual ao CRO).
- **Fichas no "i" (padrão CRO):** hover = tooltip; CLIQUE = drawer lateral com desc + fórmula + campos HubSpot. `AE_HELP_CHARTS` reescrito: 14 fichas com keys = keys reais dos cards (C01, A07–A19), conteúdo fiel aos builders; `AE_HELP_DETAIL` (colunas do modal padrão); `_aeHelpRow`/`_aeHelpSection`/`_aeOpenHelp`/`aeHelpChart` (espelho do BDR/CRO); botão "?" abre todas as fichas.
- **A09:** título → "Taxa de Ganho por AE" (sem "Ajustada"), PT/EN; o cálculo segue ganhos ÷ (ganhos+perdidos), dito na ficha.
- **A16/A18 por entrada em RA + tooltip index:** A16 já agrupava por `data_reuniao_agendada` (verificado); A18 passou a considerar SÓ deals com a data preenchida (era todos por owner). Ambos com tooltip `mode:'index'` — hover mostra Sim | Não | Sem preenchimento juntos + total (A16 inclui a Occurrence Rate).
- **Datas BR em todos os modais:** `_novoDealsRows` (Reunião Ag., Fechado) e modal do A15 (Fechado) agora usam `_nd()` → dd/mm/aaaa (S05/P04 já usavam). Sorter já entende o formato.
- **Contagens nos títulos:** A16 (1.109 deals), A17 (1.037), A18 (943) e A07 (245 deals do forecast) via spans preenchidos pelos builders.
- **A13 drill com filtros:** clique numa barra abre a lista INTEIRA dos abertos com data de RA (249) com chips de faixa (0-30…+180) no topo, já pré-selecionados na faixa clicada; chips refiltram no modal.
- **Validação (dados de produção, harness duplo ae.html × dashboard.html):** paridade A07×N06B diffs 0/0; 14 fichas OK (todas com code); A16/A18 mode index e counts corretos (A18 soma barras = 943 = count); datas dd/mm/aaaa nas linhas (sem ISO solto); A13 chips 7, ativo na faixa clicada, 99 linhas em 31-60; A09 sem "Ajustada". `_check-inline-js` 0 erros; i18n 24/24; `_smoke-render` OK; `/novo-ae` 200.

### AE Performance | P01, A07 só time, A16/A18 filtráveis por RA (base comum), A12 dias no drill, A11 fecha 100%, A14 só time + legenda isola (2026-07-02, rodada 5)

> A pedido: 6 mudanças no painel AE (`public/ae.html`, front-only). **NÃO commitado e NÃO deployado (a pedido explícito).**

- **P01 | Deals Ativos** adicionado como primeiro KPI (grid 5→6 colunas), espelho exato do P01 do CRO: contagem da base ativa AGORA (sem filtro de data), sub "Vendas: X | Bid: Y", clique abre a lista. Produção: 252 (Vendas 235 | Bid 17).
- **A07 só executivos do time:** barras de outros owners (e "(sem AE)") ficam fora; buckets zerados ocultos (já eram). Contagem do título passa a somar só os deals do time (225 de 245 do forecast) com sufixo "| só time". Tooltip/ficha atualizados.
- **A16/A18 | filtro de período por entrada em RA + base COMUM:** nova `_aeMeetingBase()` = deals do time de executivos com `data_reuniao_agendada`, janela do AxFilter aplicada SOBRE ESSA DATA. A16 deixou a janela fixa de 12 meses (meses = os presentes na base filtrada); A18 usa a mesma base — as contagens dos dois títulos são idênticas por construção (sem filtro: 943; testado com filtro jan–mar/26: 230 = 230 = esperado, eixo só Jan–Mar/26). Nota: o A16 antes incluía todos os owners (1109); agora, como o A18, considera só o time.
- **A12 | coluna "Dias no pipe" no drill:** modal próprio (`_aeAgingModal`) com Deal | Pipe | Etapa | Vidas | ARR | Reunião Ag. | Dias no pipe (dias desde a entrada em RA; amarelo >30, vermelho >60), ordenado do mais velho; ordenável como as demais.
- **A11 | barras fecham em 100% (bug real confirmado):** as somas por AE davam 89,7–100% porque a lista de etapas era fixa (`stageOrder`) e deals do Bid em etapas fora dela (ex.: Reunião Pré-RFP) contavam no denominador sem ganhar fatia. Fix: etapas presentes na base entram no fim da lista. Também removido o arredondamento dos DADOS (ficava só nos rótulos/tooltips). Verificado: somas = [100,100,100,100,100,100].
- **A14 | só time + legenda isola:** radar restrito aos executivos (`_isCoreAE`); clique num nome da legenda ISOLA o AE (clique de novo restaura todos — mesmo padrão do N01 do CRO). Tooltips PT/EN e ficha atualizados.
- **Validação (dados de produção, harness):** P01 252 com sub correto; A07 6 barras (só time), 225 deals, sem zerados; A16=A18=943 e com filtro 230=230; A12 modal com as colunas novas; A11 somas 100 exatas; A14 6 AEs core + onClick custom na legenda. `_check-inline-js` 0 erros; i18n 24/24; `_smoke-render` OK; `/novo-ae` 200.

### Snapshot | fotografia bruta de junho + causa-raiz do cron parado (2026-07-02)

> Contexto: a planilha de snapshots (`1rKEI…41kA`) parou de receber registros em maio. Pedido do usuário: registrar a fotografia de junho e, daqui em diante, fotos SEMANAIS (toda sexta) 100% brutas — o cron NÃO calcula nada; cálculos ficam no dashboard.

- **Causa-raiz do cron parado:** o projeto Vercel atual (`dashboard-axenya`) NÃO tem `GOOGLE_SERVICE_ACCOUNT_JSON`, `CRON_SECRET` nem `SNAPSHOT_SECRET` — as env vars foram recriadas ~10/06 (migração de projeto) e a credencial do Sheets ficou para trás. Ela existe no projeto antigo (`forecast`), mas como env var **sensitive** = irrecuperável via CLI (`vercel env pull` devolve vazio). O cron diário roda e recebe 401 toda noite. **Correção requer:** nova chave JSON do service account (Google Cloud Console) + `vercel env add` no `dashboard-axenya` + redeploy (coordenar: sessão paralela).
- **Fotografia de junho registrada:** `lib/snapshots/2026-06-foto-raw.json` (commit `1cb7b41`) — 1336 deals (Vendas 1315 + Bid 21), TODAS as etapas (incl. 1054 Perdido, 98 Reunião Agendada), propriedades cruas do HubSpot (schema `foto-pipe-raw-v1`: id + properties + owner_map + stage_map), zero cálculo. ⚠ Capturada em **02/07**, não 30/06 (não há como fotografar o passado). Ainda NÃO escrita como aba "Jun 2026" na planilha (depende da chave nova); o JSON é a fonte para gerar a aba depois. Script de captura reutilizável no scratchpad da sessão (one-off; não versionado).
- **Pendente (decisão de desenho da feature semanal):** cron de sexta gravando foto bruta; destino confiável a definir (KV vs planilha vs git); UI de seleção de semana + comparação. NÃO implementado — em discussão com o usuário.
- **Resolução (mesma data, sequência):** usuário criou service account NOVO (`forecast-snapshot@arctic-depth-499015-m8.iam.gserviceaccount.com`, projeto GCP próprio, planilha compartilhada como Editor; chave JSON guardada localmente fora do repo). Com a chave nova: (1) **aba "Jun 2026" gravada na planilha** — estava criada e VAZIA; agora tem 1336 deals + header, **35 colunas 100% brutas** (sem as 48 colunas calculadas do formato legado da "Mai 2026"; labels de pipeline/etapa/owner são resolução de nome, não cálculo) + coluna "Capturada em" = 2026-07-02; guard no script abortava se a aba não estivesse mais vazia. (2) **Env restaurada na Vercel (Production):** `GOOGLE_SERVICE_ACCOUNT_JSON` (chave nova), `CRON_SECRET` e `SNAPSHOT_SECRET` (gerados; cópia no `.env.local`). ⚠ **Só passam a valer no PRÓXIMO deploy** — não deployado (sessão paralela). ⚠ O snapshot.js atual, quando o deploy sair, volta ao comportamento LEGADO (linha diária calculada no Historico + aba mensal calculada no fim do mês) — a reescrita raw/semanal deve idealmente sair ANTES do próximo fim de mês.

### Deploy | CRON_SECRET com whitespace bloqueava o build (2026-07-02)

- O deploy passou a falhar com "The CRON_SECRET environment variable contains leading or trailing whitespace" — a env (criada ~8min antes, no trabalho do cron de snapshot) entrou com quebra de linha/espaço no valor. Como foi criada SENSITIVE, o valor é irrecuperável (env pull devolve vazio).
- Correção: CRON_SECRET removida e recriada (sensitive) com valor novo de 64 hex sem whitespace, via stdin do CLI. Nesse desenho o valor é autoconsistente (o cron do Vercel envia Bearer $CRON_SECRET da própria env), então trocar o valor não quebra nada — o valor antigo, com whitespace, já era inválido para header HTTP. ⚠ Se algum consumidor EXTERNO tiver anotado o valor antigo do CRON_SECRET, precisa do novo (falar com quem criou). Arquivos temporários com segredos removidos do scratchpad.
- Redeploy OK: rotas 200, API 401.

### Snapshot | fotos semanais: 4 sextas retroativas + cron reescrito 100% bruto (2026-07-02)

> Continuação das entradas de snapshot acima. Decisões do usuário: fotos = dados BRUTOS (cron não calcula nada); semanais toda sexta; retroativas desde 05/06/2026; destino = a planilha de snapshots. **API alterada (`api/snapshot.js`, `lib/sheets.js`).** O servidor da 3002 NÃO foi reiniciado (testes por invocação direta do handler).

- **Fidelidade da reconstrução PROVADA:** reconstrução de 06/06 via `propertiesWithHistory` vs a foto real "Mai 2026" (gerada manualmente em 06/06, 91 deals): 90/91 idênticos em TODOS os campos (etapa, executivo, vidas, fatura, ARR, modelo); o único desvio era o teste usar `createdate` ATUAL — o campo foi editado à mão no CRM em 10/06 (08/05→09/06) e o HISTÓRICO revela o valor original → método corrigido = 100%. Limites: deals DELETADOS são irrecuperáveis; campos calculados/rolantes (Probabilidade HS, Última Atividade) não reconstroem (ficam vazios).
- **4 sextas retroativas gravadas na planilha** via novo `scripts/reconstruct-weekly.js` (reusável: `node scripts/reconstruct-weekly.js YYYY-MM-DD ...`): abas `2026-06-05` (1248 deals), `2026-06-12` (1278), `2026-06-19` (1301), `2026-06-26` (1327). "Capturada em" = "reconstruída em 2026-07-02 via histórico HubSpot | corte <sexta> 23:59 BRT". Existência do deal na data usa createdate HISTÓRICO; guard não sobrescreve aba existente.
- **`lib/snapshot-format.js` (novo):** fonte única do formato de foto — `PROPERTIES` (34 props cruas, espelho do forecast-table), `HEADERS` (35 colunas) e `buildRow` (foto ao vivo). Usado pelo snapshot.js e pelo reconstruct-weekly.
- **`api/snapshot.js` REESCRITO (zero cálculo):** a cada run diário (cron 02:59 UTC = 23:59 BRT): (1) batimento na aba nova **"Historico Diario"** — SÓ contagens por etapa/pipeline (a aba legada "Historico", com ARR calculado, fica congelada); (2) **sexta** → foto semanal bruta na aba `YYYY-MM-DD`; (3) **último dia do mês** → foto mensal bruta na aba `Mmm AAAA`; (4) **autocorreção**: sexta anterior ou mês anterior sem aba → grava agora ("Capturada em" registra o atraso); (5) `?tab=` (usuário) → foto forçada. Abas nunca sobrescritas. Removidos: STAGE_PROB hardcoded, calcARR, calcReceita, colunas Real/Prob.
- **`lib/sheets.js`:** exports aditivos `listTabs()`, `readRange(a1)`, `appendRow(tab, headers, row)`. history.js intacto.
- **Validação:** `node --check` 4 arquivos OK; **dry-run** (sheets stubado, HubSpot real) — 5 cenários corretos (dia comum só batimento; sexta grava semanal; sábado com sexta perdida grava atrasada; 31/07 grava semanal+mensal; aba existente = "já existia"); **e2e REAL** (HubSpot + Sheets reais, auth CRON_SECRET): 200, batimento gravado (1336 deals | RA 98 · Diag 71 · Cot 19 · Prop 3 · Cons 32 · Neg 17 · Standby 1 · Impl 15 · Ganho 11 · Perdido 1055 · outras 14 | Vendas 1315 · Bid 21), autocorreção no-op como esperado.
- **Fix `.env.local`:** linhas CRON_SECRET/SNAPSHOT_SECRET tinham CRLF (Add-Content do PowerShell) — normalizado para LF. Mesma causa-raiz do incidente de deploy da entrada anterior (CRLF no stdin do `vercel env add`: o CLI remove o `\n` final mas deixa o `\r`). ⚠ A cópia local do CRON_SECRET ficou STALE (a outra sessão recriou o valor na Vercel; irrelevante para o cron, que é autoconsistente). ⚠ SNAPSHOT_SECRET na Vercel provavelmente também tem `\r` — a recriar limpo.
- **⚠ Compat do leitor de histórico (fase 2):** o comparador do `/forecast`/`/forecast-overall` espera colunas legadas (`Probabilidade (%)`, `Data Prevista`, `Dias no Pipe`) → ao abrir as abas novas, ARR ponderado zera e algumas colunas ficam vazias; `action=tabs` só lista `Mmm AAAA`. A UI de semanas (fase 2) atualiza o leitor.
- **Deploy:** a outra sessão redeployou durante esta rodada (fix do CRON_SECRET) — verificar qual versão do snapshot.js foi para produção (o deploy sobe o working tree inteiro).

### Snapshot | deploy do cron novo + fix BOM na credencial (2026-07-02, fechamento)

> Deploy autorizado explicitamente pelo usuário (sessão paralela ciente — ela própria já havia deployado às 17:11 para destravar o build).

- **Cronologia confirmada:** o deploy das 17:11 (da outra sessão) levou o snapshot LEGADO (meus arquivos são 17:32+). Deploy do cron novo feito às ~17:4x (commits `ed64c5c` + `fccedbf`).
- **Incidente BOM (resolvido):** a `GOOGLE_SERVICE_ACCOUNT_JSON` criada via pipe do PowerShell chegou em produção com **U+FEFF** no início → `JSON.parse` falhava. Recriada via bash (`cat | vercel env add`, sem re-encoding) e `lib/sheets.js` ganhou defesa (`replace(/^﻿/,'').trim()`). Terceiro incidente de encoding do dia (CRLF no env local, CRLF no CRON_SECRET, BOM aqui): **regra prática — env vars via CLI no Windows, sempre pelo bash com `printf '%s'`/`cat`, nunca por pipe do PowerShell.** `SNAPSHOT_SECRET` também recriado limpo (o meu tinha `\r`; valor sincronizado no `.env.local`).
- **Verificação em produção:** rotas `/`, `/novo`, `/novo-ae`, `/novo-bdr`, `/forecast` → 200; `/api/auth/me` e `/api/forecast-table` → 401 (auth ativa); disparo real do `/api/snapshot?secret=…` → `{"success":true,"deals":1336,"actions":{"batimento":"2026-07-02"}}` — código novo no ar, Google e HubSpot autenticando, autocorreção no-op (fotos em dia). Nota: a aba "Historico Diario" ficou com linhas duplicadas de 02/07 (e2e local + probe de prod + cron da noite) — ruído cosmético de batimento; sem impacto nas fotos.
- **Estado final:** cron diário FUNCIONAL em produção. Primeira foto semanal automática: **sexta 03/07/2026 23:59 BRT** (aba `2026-07-03`). Fase 2 pendente: UI de seleção/comparação de semanas no dashboard + leitor de histórico compatível com o formato bruto.

### Forecast | modo Comparação (fotografia × agora) no /forecast (2026-07-02)

> Fase 2 do sistema de fotografias, desenho aprovado pelo usuário: caixinha "Comparação" na barra de filtros do `/forecast`; comparação sempre foto × AGORA; valores antigos em tooltip + modal; saídas em seção ao fim da tabela. **NÃO deployado (ordem explícita do usuário)**; commitado. Front-only em `public/forecast.html` + extensão ADITIVA em `api/history.js` (contrato preservado).

- **`api/history.js` | `action=fotos` (novo):** lista as fotografias brutas — abas semanais `YYYY-MM-DD` + mensais `Mmm AAAA` a partir de **Jun 2026** (as anteriores são o formato legado calculado e ficam FORA), ordenadas da mais recente. `action=tabs`/`snapshot`/`local` intactos (a visão Histórico legada continua funcionando).
- **Seletor "Comparação"** (padrão fdd dos demais filtros): lista as fotos (semanais como dd/mm/aaaa; mensais "| mensal") + "— Desligado". Foto carregada 1× por sessão (cache em memória); aba em formato antigo → erro amigável, sem quebrar.
- **Princípio (Regra 3 aplicada):** a foto fornece só DADOS BRUTOS; a receita da foto é recalculada AQUI pelo mesmo motor (`ForecastEngine.dealMonthly` + `calcProbInfo` + dedup `_fcRevExcluded` aplicado ao conjunto da foto) com as regras/probabilidades de HOJE — o delta reflete mudança de dado, nunca de regra. Conversão linha→deal (`compRowToDeal`) replica as normalizações do `/api/forecast-table` + régua BID de datas do `load()`; conjunto da foto usa o MESMO corte do vivo (createdate≥set/25 | Ganho/Implantação | Bid≥jan/25) e exclui os já Perdidos na foto.
- **Na tabela (modo ligado):** 2 colunas novas **Δ Real (R$)** e **Δ Prob. (R$)** (variação da receita projetada na janela 2026–2027 vs a foto; verde/vermelho; ordenáveis; tooltip com antes/agora); célula de Etapa vira `antiga → atual` com badge (▲ avançou · ▼ regrediu · "novo"); tooltip da etapa lista as mudanças campo a campo (etapa, vidas, 1ª fatura, prob AE, dt. receita, executivo); linha TOTAL soma os Δs.
- **Banner** acima da tabela: foto (com selo "reconstruída" quando for), nº de deals na foto, Δ Real/Probabilizada (deals visíveis nos filtros atuais), novos, avançaram/regrediram, saíram (com nº de perdidos) e botão desligar.
- **Seção "Saíram do pipe"** ao fim da tabela (ignora filtros | livro todo): deals que estavam na foto e não estão mais no payload vivo, classificados como **Perdido** (via 1 fetch de `?includeLost=true` por sessão, com motivo do declínio) ou "Fora do pipe" (deletado/movido); com etapa na foto, vidas, 1ª fatura e receita probabilizada da foto; link para o HubSpot.
- **Modal do deal:** linha "Comparação | foto X" com o status, Δs de receita do deal e, em cada campo alterado, "na foto: <valor antigo>". Colunas Δ fora da lista de campos.
- **Validação (harness vm com dados reais, foto 2026-06-26 × vivo):** action=fotos lista 5 fotos e EXCLUI "Mai 2026" legada; foto 320 deals no conjunto vs 278 vivos = 10 novos (todos criados após 26/06 ✓) + 15 avançaram + 1 regrediu + 268 pareados + **52 saíram (51 Perdido + 1 fora) — 268+52=320 fecha exato**; ΔReal +47k, ΔProb +164k; badges/colunas/banner/saídas presentes no HTML renderizado; modal com "na foto:"/Δs; desligar limpa colunas, banner e seção. Baseline sem comparação idêntico ao anterior (zero contaminação). `_check-inline-js` 0 erros; `node --check` history OK.
- **Notas:** (1) para testar no navegador local é preciso REINICIAR a 3002 (o `local-server` cacheia o handler do history.js — coordenar antes); (2) tooltip pode acusar "mudança" de Executivo quando só o NOME do owner mudou no HubSpot (ex.: "Fausto Haderspeck" → "Fausto Haderspeck Girotto") — fiel ao dado, cosmético; (3) a visão "Histórico" legada segue no ar; aposentá-la em favor da Comparação é decisão futura.

### Forecast | Comparação testável no local: auth do history + credencial no .env.local + restart 3002 (2026-07-03)

- **`api/history.js` | auth alinhada (`431c4f6`):** era o ÚNICO endpoint usando `verifyRequest` puro (sem `LOCAL_DEV_BYPASS`) — localmente devolvia 401 até para a visão Histórico legada. Trocado pelo `requireAuth` do `_helpers` (mesmo gate dos demais); em produção nada muda (sessão JWT exigida).
- **`.env.local`:** `GOOGLE_SERVICE_ACCOUNT_JSON` adicionada em linha única (minificada) — o history.js local agora lê a planilha. (Parser do local-server divide no 1º `=`, então o JSON com `=` no private_key passa inteiro.)
- **Porta 3002 reiniciada COM AUTORIZAÇÃO do usuário** (PID 4692 → 12528). Verificado: `/novo` `/forecast` `/novo-ae` `/novo-bdr` 200; `action=fotos` 200 (5 fotos, sem a "Mai 2026" legada); `action=snapshot&tab=2026-06-26` 200 (1327 deals, coluna Deal ID presente). ⚠ Sessões paralelas: se estavam validando contra a 3002, revalidar.

### Forecast | Comparação: equivalência de campos PROVADA (18/18) + comparativo Vidas/Colaboradores (2026-07-03)

> O usuário questionou se os deltas comparam campos equivalentes — e a suspeita procedia. Teste de equivalência NO MESMO INSTANTE (foto construída em memória com o `buildRow` do cron × payload vivo do `/api/forecast-table`, deal a deal) achou 4 não-equivalências reais, corrigidas em `compRowToDeal` (`fe0f5f4`, front-only). **NÃO deployado.**

- **Não-equivalências achadas e corrigidas:** (1) **Etapa**: a foto etiqueta pelo STAGE_MAP do `lib/hubspot` que não conhece `1349620551` — id cru agora ganha o rótulo do payload ('Reunião Pré-RFP'); **closed-lost força 'Perdido'** (mesma regra do forecast-table — sem isso, deal perdido do BID na foto virava comparação falsa); etapas fora do universo do payload (ids crus, ex. estágios extras do BID) ficam FORA do conjunto da foto (matou o falso "fora do pipe"). (2) **Quarter**: a foto guarda o valor cru ("Q4" sem ano, "false") onde o vivo normaliza → agora espelho exato (deriva da data prevista; sem data → null). (3) **Numéricos**: parse espelho do forecast-table ('' → null, '0' → 0). (4) **Executivo**: a foto grava nome via `cleanOwnerName` (apelida/trunca em 2 nomes) e o vivo usa nome completo — igualdade tolerante `compAeEq` (normaliza acentos + ignora conectivos de/da/do + prefixo) para não acusar troca falsa de executivo; mudança REAL de dono continua aparecendo.
- **PROVA (harness, mesmo instante):** universos 278=278 sem sobras; **18/18 campos 100% idênticos** (stage, ae, pipeline, vidas, colaboradores, fatura_atual, primeira_fatura, arr_estimado, modelo, agenciamento, vitalício, probabilidade, quarter, data prevista, vigência, prêmio, createdate, dealname); **motor de receita (real+prob na janela) idêntico nos 278 deals** → o Δ mede exclusivamente mudança de dado.
- **Comparativo de Vidas e Colaboradores (pedido do usuário):** células de Vidas e Colab. mostram `antiga → atual` (verde/vermelho) quando mudaram, com tooltip; **Δ Vidas** e **Δ Colaboradores** no banner (novos contam a partir de zero, mesma base dos Δ de receita); Colaboradores no tooltip da etapa e na tabela de saídas; modal já cobria (campo a campo).
- **Clareza dos Δ:** colunas renomeadas **"Δ Receita Real" / "Δ Receita Prob."**; tooltips explícitos: "Δ = agora − foto | soma da receita projetada nos meses da tabela (2026–2027) | regras de HOJE nos dois lados".
- **Validação:** harness da comparação re-rodado (foto 26/06): 267 pareados + 52 saídas = 319 deals da foto (fecha exato); 52/52 saídas classificadas Perdido (falso "fora do pipe" eliminado); Δ Vidas +40.668 · Δ Colab +13.213; banner/células/saídas/modal com os elementos novos; grafia de executivo sem falso positivo; desligar limpa tudo. `_check-inline-js` 0 erros. Nota: "Grupo Pernambucanas" aparece como "novo" — estava Perdido na data da foto e foi REABERTO depois (comportamento correto: não estava no pipe da foto).
- **DEPLOYADO (2026-07-03, autorização explícita do usuário):** modo Comparação em produção — rotas `/` `/novo` `/forecast` `/novo-ae` `/novo-bdr` 200; `/api/auth/me`, `/api/forecast-table` e `/api/history?action=fotos` 401 sem sessão (auth ativa); conteúdo novo confirmado no HTML de produção (`btn-comp`, `comp-banner`, `compRowToDeal`). Inclui os commits `ba4eb6b` + `431c4f6` + `fe0f5f4` (e o working tree corrente, com o ae.html da sessão paralela).

### Forecast (reunião 03/07) | foto 12/05 reconstruída + caderno de observações (2026-07-03)

- **Aba `2026-05-12` gravada na planilha** via `reconstruct-weekly.js` (data do último forecast; 1142 deals existiam) — disponível no seletor de Comparação do `/forecast` para uso ao vivo na reunião.
- **Caderno Word gerado:** `D:\DOWNLOADS!\Forecast_03-07-2026_Observacoes_Pacheco.docx` — análise da janela 12/05→03/07 (histórico de etapas: avanços com data, etapa real anterior dos perdidos, transferências de owner), auditoria do doc da Auris (consistente; CYMZ/Korú/Lenovo eram registros duplos, esclarecidos), observações e perguntas por AE na ordem da agenda, pauta transversal (processo de BID, no-show 55% das perdas, higiene: Riachuelo 30k sem motivo, ARRs fora de escala Vibra/Vicunha/Pernambucanas). Gerador em scratchpad (npm docx, fora do repo). Macro da janela: 267 abertos · 196 novos · 4 ganhos (185 vidas) · 347 perdidos (315 comerciais + 32 limpeza 30/06).

### Forecast | saídas da foto com filtro de Executivo + colunas ordenáveis (2026-07-03)

> A pedido do CRO: no modo Comparação (fotografia de sexta × agora), a tabela "Saíram do pipe desde a foto" (perdidos/fora do pipe) passa a respeitar o filtro de EXECUTIVO da UI, e as colunas ficam ordenáveis.

- **Filtro de Executivo em `compExits()`:** com o filtro ativo, só as saídas daquele(s) executivo(s); match via `compAeEq` (o nome do owner na foto pode ter grafia diferente do vivo — prefixo normalizado). `__NONE__` → lista vazia. Demais filtros continuam ignorados de propósito (etapa/quarter/etc. descrevem o estado vivo, que o deal que saiu não tem). O contador "Saíram" do banner usa a mesma base → reflete o filtro; tooltip do banner e header da tabela atualizados (antes diziam "ignora os filtros").
- **Ordenação:** cabeçalhos clicáveis nas 9 colunas (Deal, Situação, Etapa na foto, Executivo, Vidas, Colab., 1ª Fatura, Receita Prob. na foto, Motivo), asc/desc com seta ▲▼; numéricas iniciam desc, textuais asc; padrão = Receita Prob. desc (comportamento original). Re-render isolado do bloco (`#cmp-exits-box`), estado persiste entre re-renders dos filtros.
- **Validação:** `_check-inline-js` 0 erros; `/forecast` 200 local; harness lógico do filtro (grafia longa×curta casa; Ágatta isola; __NONE__ vazio) e do sort asc/desc OK. **Não commitado/deployado ainda.**

### Forecast | Δs de receita da Comparação DESLIGADOS + causa do "aumento" do Biolab explicada (2026-07-03)

- **Investigação (Biolab Sanus, foto 12-06 × hoje):** pelo motor real (harness com os 3 módulos + prob do funil vivo), o deal CAIU, não subiu: Real −193.647 · Prob −55.234. Causa dominante: etapa **Proposta Enviada → Consultoria** — para Fee por vida, em Cotação/Consultoria/Negociação a régua começa em **data prevista + 2 meses** (mar/2027 em vez de jan/2027), tirando 2 × ~97k da janela 2026–2027. Ruído: 1ª fatura +106,50 (Δ +1.278); prob do AE 0,05→0,10 não muda nada (dentro da margem de ±30pp; prob de etapa Bid cai no default ~28,5% nas duas etapas — funil Bid sem amostra ≥20). Se a UI mostrou AUMENTO, suspeito nº 1 = override local de probabilidade nas Configurações do navegador (FC_STAGE_PROB_SAVED vence o funil; ex.: Consultoria 61% × Proposta 28,5% inverte o sinal do Δ) — deltas variam por navegador.
- **Δs de receita desligados a pedido do CRO:** flag `COMP_SHOW_REV_DELTAS = false` oculta as 3 superfícies — Δ Real/Δ Probabilizada do banner, colunas "Δ Receita Real/Prob." da tabela e as 2 linhas do modal do deal. Δ Vidas/Δ Colaboradores, Novos/Avançaram/Saíram e a tabela de saídas permanecem. Religar = trocar a flag.
- **Validação:** `_check-inline-js` 0 erros; `/forecast` 200 local. **Não commitado/deployado.**

### BDR No-Show | subpágina estática aditiva (2026-07-07)

- Criada rota `/dashboard/bdr/no-show` (alias `/novo-bdr-no-show`) servindo `public/bdr-no-show.html` + lógica separada em `public/bdr-no-show.js`; front consome somente `/api/forecast-table?includeLost=true`, sem HubSpot direto e sem novas dependências.
- Entregues cards executivos, tendência semanal, rankings por BDR, quebras por origem/segmento/persona/porte, tabela de recuperação, tabela de perdidos por no-show, filtros e estados loading/empty/error. Memória de cálculo explicita os proxies atuais (`data_reuniao_agendada`, `a_reuniao_ocorreu_`, progressão de etapa e evidência textual de reagendamento).
- Navegação compartilhada (`premium.js`) ganhou item "No Show BDR" e current path para `/dashboard/bdr/no-show`; rewrites adicionados em `vercel.json` e `scripts/local-server.js`. Validação local: `node --check` em `public/bdr-no-show.js`, `public/premium.js`, `scripts/local-server.js`; `vercel.json` parse OK; rota local `/dashboard/bdr/no-show` respondeu 200.
- Ajuste pós-feedback: rota canônica movida para `/novo-bdr/no-show` para ficar como subpágina de **BDR Performance**; `/dashboard/bdr/no-show` e `/novo-bdr-no-show` ficam como aliases. `public/bdr.html` ganhou botão "No Show" no header. 401 agora redireciona para login preservando `next=/novo-bdr/no-show`.
- Refinamento operacional pós-uso: filtros rápidos `Tudo desde set/25`, `Últimos 30 dias` e `Mês atual`; universo restringido a deals com `data_reuniao_agendada` entre set/25 e hoje; ranking BDR agora ordena por quantidade e desempata por taxa; removida inferência textual de segmento/persona (só mostra campos presentes no payload); status `Em recuperação` virou `No-show aberto`; adicionada legenda simples de cálculo.

### Forecast | modal do deal enriquecido + perdidos da Comparação com busca/filtros/top5 (2026-07-03)

> A pedido do CRO após o forecast quinzenal. Front (`public/forecast.html`) + 2 mudanças de API ADITIVAS (`api/forecast-table.js`, `api/history.js` — contrato preservado). Servidor local reiniciado 2× para recarregar handlers. **Não commitado/deployado.**

- **Modal do deal (clique no nome) | hover e leitura:** hover destacado (leve zoom + sombra, o campo "descola do fundo"; o dado ganha peso); Executivo exibido só pelo **primeiro nome** (subtítulo + campo); corrigido um `·` do subtítulo para `|` (Regra primária nº 1).
- **Modal | nova seção "Rastreamento":** Criação, **Origem** (`origem__originacao_`), BDR, **Dias na etapa atual** (via `stage_entered` da etapa atual → hoje, cobre os 2 pipelines; fallback `stage_days`), Última atividade, Dias sem atividade (amarelo >30, vermelho >90).
- **Modal | "Trilha de etapas":** linha do tempo por data de entrada em TODAS as etapas por onde o deal passou (ordenada por data; revela troca de pipeline Vendas→Bid quando há).
- **Modal | "Histórico de proprietários":** lazy por deal via `GET /api/history?action=owner-history&id=` (não entra no payload compartilhado). Lista dono atual + anteriores com a data de cada troca; nomes resolvidos por mapa de owners (ativos + arquivados). Cache por id em `_ownerHistCache`.
- **API `forecast-table.js` (aditivo, ZERO chamadas extras):** +`origem`; +`stage_entered` (mapa etapa→data de entrada, v2, dos 2 pipelines); **`fetchOwners` agora inclui owners ARQUIVADOS** (`archived=true`) → resolveu os **127 BDRs (13%) que apareciam como id cru → 0**. Também melhora a resolução de nomes em ae/sdr em todos os painéis (estritamente aditivo).
- **API `history.js`:** nova ação `owner-history` (usa `propertiesWithHistory=hubspot_owner_id` + mapa de owners com arquivados); sem função serverless nova (limite Hobby de 12 preservado).
- **Comparação | perdidos (saíram do pipe):** **busca e filtros da UI agora se aplicam** (avaliados sobre os dados da foto; antes só o de Executivo); **ordenados por Vidas por padrão** (segue clicável); **top 5 por vidas destacados** (fundo + borda + "1º…5º"); nova coluna **"Perdido em"** (close_date do deal perdido hoje).
- **Validação (dados de produção):** `_check-inline-js` 0 erros; `node --check` OK nos 2 api; harness dedicado (`_test-forecast-modal`) confirmou `_dealModalExtras` (origem, trilha cronológica, BDR resolvido, dias-na-etapa em Bid, placeholder de owners) e `compExitsHtml` (coluna "Perdido em", top5 com rank, sort default Vidas, filtros); `/api/forecast-table` origem=1123 · trilha≥2=1054 · BDR id-cru=0; `owner-history` resolve arquivados (ex.: Fernando/Eduardo/Andressa); `_smoke-render` do CRO OK (payload aditivo não quebra consumidores); rotas `/novo`,`/novo-ae`,`/novo-bdr`,`/novo-board`,`/forecast` = 200.

### KPIs responsivos em todos os painéis + 5 ajustes no AE Performance (2026-07-07)

> Front-only. **NÃO commitado e NÃO deployado** (a pedido: só local por ora; outras sessões chegam em breve). Preparação para liberar o AE.

- **Big numbers responsivos (7 painéis: dashboard, board, ae, bdr, cs, 48h, cotacao):** `.kpi-row` → `repeat(auto-fit,minmax(150px,1fr))` (os cards quebram sozinhos 6→…→1 col conforme a largura, sem breakpoints fixos — removidas as media queries antigas do dashboard e do bdr); `.kpi-value` → `font-size:clamp(1.35rem,.95rem+1.3vw,2rem)` (igual a 2rem no desktop, encolhe até ~1.35rem no mobile); `.kpi-card` padding com `clamp` (compacto no mobile, idêntico no desktop). NULs do `bdr.html` preservados (3), edições sem sed.
- **P07 (Receita Ganha | modal do KPI):** `novoOpenDealsModal` ganhou `<tfoot>` com **Σ Vidas** e **Σ ARR** (vale para todos os drills que usam esse modal). O sorter genérico ordena só o `tbody`, o rodapé fica fixo.
- **A07 (Receita do Forecast por AE | ficha do "i"):** novo bloco destacado **"Etapas consideradas"** (`stages[]` na entrada `arr` + render em `_aeHelpSection`) — lista Vendas negócio novo, Ganho/Implantação, Bid Neg/Proposta (0,5%) e o que fica fora.
- **A14 (Meeting Effectiveness by AE, `meeting-ae`):** (a) linha **Occurrence Rate** por AE no gráfico (eixo y2 0–100%), igual ao A16; (b) clique agora abre modal reformulado `_aeMeetingByAeModal` com **chips de executivo** + **KPIs** (reuniões que entraram em RA · realizadas=Sim · taxa Sim÷(Sim+Não)) + lista.
- **A14 + A16 (modais de reunião):** lista com nova coluna **"Reunião Ocorreu"** (Sim/Não/—, colorida) via `_aeMeetingRows`/`_aeMeetingListModal`.
- **Validação (dados de produção, harness dedicado):** `_check-inline-js` 0 erros; `_smoke-render` do ae.html OK (1344 deals, sem exceção); harness dos modais confirmou tfoot P07 (Σ Vidas 4.109), coluna "Reunião Ocorreu", KPIs (base 952 · realizadas 527 · taxa 63,6%), occurrence por AE (André 70% … Ágatta 41%) e ficha A07 com "Etapas consideradas" (4 itens). Rota `/novo-ae` = 200; demais painéis inalterados na lógica (só CSS).
- **Pendente do release do AE:** revisão card a card dos 7 títulos ainda com 🟡 (KPI Receita Ganha, A07, A16, A18, A11, A12, A14) — em andamento; menu AE ainda `health:'y'` (virar `'g'` só quando validado); deploy prod + menu verde aguardando conclusão da revisão e confirmação.

### AE Performance | rodada 6: A09 eixo dinâmico, A11/A12 filtros+totais, A13 chips, A14 total+occurrence (2026-07-07)

> Front-only em `public/ae.html`. **NÃO commitado e NÃO deployado** (só local por ora).

- **A09 (Taxa de Ganho por AE):** eixo Y deixou de ser fixo em 20% (barras cortadas quando a taxa passava disso). Agora piso 20% quando as taxas são baixas e, acima disso, o topo acompanha o maior valor (arredonda pra cima em 5, +5 de folga p/ o rótulo) — barra nunca cortada. Eixo Y passou a exibir `%`.
- **A11 (Distribuição de Etapas por AE):** clique na barra abre modal novo (`_aePipeStageModal`) com **filtros superiores de Executivo E Etapa** (cross-filter: a contagem de cada grupo reflete o filtro do outro), lista padrão de deals.
- **A12 (Idade Média por AE):** clique abre modal reformulado (`_aeAgingModal(preAe)`) com **filtros de Executivo E Etapa** + **rodapé de totais**: Σ vidas, Σ ARR e **média de dias no pipe** (colspan sobre Deal/Pipe/Etapa). Ordena por dias desc; sorter genérico mantém o rodapé fixo.
- **A13 (Deal Age Distribution) | correção de visual:** os chips do modal saíam sem estilo porque `.stage-chip`/`.chip-count` **não existiam no `ae.html`** — adicionadas as 4 regras canônicas (idênticas ao dashboard/board). Corrige de uma vez os chips do A13, do A07 (drill por AE) e do modal de reunião do A14.
- **A14 (Meeting Effectiveness by AE):** (a) **linha Occurrence Rate por AE** (eixo y2 0–100%), igual ao A16; (b) **total de deals por AE** no topo de cada barra empilhada (datalabel somando as 3 fatias visíveis); o total geral da base segue no contador do título. **Decisão de desenho (resposta ao "faz sentido tudo em %?"):** as barras seguem em CONTAGEM (volume importa) e só a taxa de ocorrência vai em % (linha) — não converter as barras para 100% empilhado.
- **Validação (dados de produção, harness dedicado):** `_check-inline-js` 0 erros; `_smoke-render` OK (1344 deals); harness confirmou A09 (y.max ≥ maior barra; piso 20; eixo %), A14 (dataset Occurrence Rate linha/y2, eixo y2 0–100, datalabel de total só no topo = 157 no 1º AE), A11 (chips Executivo+Etapa com `.stage-chip`, tabela, AE pré-selecionado), A12 (chips, rodapé com Σ vidas 131.103 e média de dias sobre 42 deals do AE). Rota `/novo-ae` = 200.

### Last 48h | tags de identificação + fichas "i" por card (padrão dos demais painéis) (2026-07-07)

> Front-only em `public/48h.html`. **NÃO commitado e NÃO deployado** (só local por ora). O painel tinha só tooltip no hover do "i" e um help global em tabela plana; faltavam as tags de código e o drawer por card, presentes nos outros painéis.

- **Toggle "?" no header** (`btn-info-toggle` → `novoToggleInfo`, estado em `localStorage['h48_show_info']`, default ON): mostra/oculta as tags de código e os botões "i" via `body.novo-info-on`. CSS `.novo-code-tag` + regras de gating portadas verbatim do `ae.html`.
- **Tags de identificação (H01–H09)** via `H48_CARD_CODES` + `_codeTag(key)`: H01 Novos Deals · H02 Vidas Novas · H03 Deals Ganhos · H04 Deals Abertos Total (KPIs) · H05 Originação por AE · H06 Vidas Novas por AE · H07 Etapa Atual dos Novos Deals · H08 Deals Ganhos Recentemente · H09 Todos os Novos Deals. KPIs ganharam a tag no canto (mesmo layout flex do `ae.html`).
- **Ficha por card no clique do "i"** (`h48HelpChart` → `_h48OpenHelp`/`_h48HelpSection`, padrão CRO/AE): hover no "i" = tooltip (agora com o código no rodapé mono); CLIQUE abre o drawer filtrado só naquele card, com descrição + tabela de campos do HubSpot. `novoHelp()` (botão do topo) reusa o mesmo motor e lista as 9 fichas. `_infoBtn(tip,key)` reescrito para receber a KEY do card (antes recebia a string de campos) e injetar a tag + o handler de clique.
- **Card "Todos os Novos Deals" (H09)** ganhou botão "i" (antes só tinha o contador de deals); contador movido para `margin-left:auto`.
- **Validação:** checagem de sintaxe dos 2 `<script>` inline via `new Function` = 0 erros; rota `/novo-48h` = 200; markup confirmado no HTML servido (`btn-info-toggle`, CSS `.novo-code-tag`, `H48_CARD_CODES`, `h48HelpChart`, keys `h48-*`/`kpi-*` religadas). Sem toque em `api/`/`lib/` (não requer restart do servidor).

### CRO Dashboard | ficha do "i": bloco "Ressalva" no C03 e C08 (fatia "Sem receita") (2026-07-07)

> Front-only em `public/dashboard.html`. **NÃO commitado e NÃO deployado** (só local). Motivado por observação do usuário: C03 e C08 mostram uma fatia "Sem receita" grande e isso confunde. Decisão do usuário: **não alterar o cálculo do gráfico**, só documentar na ficha do "i".

- **Diagnóstico (dados de produção, harness `scratchpad/c03_c08_probe.js`):** pipeline ativo 250 deals. C03 "Sem receita" = 178 (71,2%) → deals sem `arr_estimado` E sem `primeira_fatura`. C08 base (TCV>0) = 130; sua fatia "Sem receita" = 61 (46,9%), **todos de Diagnóstico** — têm TCV pela régua (vidas × R$/vida × 12) mas `_annualRev`=0. Causa raiz: a FAIXA do donut usa `_annualRev` (arr/pf), enquanto a INCLUSÃO e o TAMANHO da fatia usam o TCV da régua (`calcReceitaMes`) — dois medidores distintos.
- **`_novoHelpSection` (aditivo):** passou a renderizar um bloco opcional `note` como callout "Ressalva" (borda `--yellow`), no mesmo padrão dos blocos Fórmula/Filtro. Nenhuma ficha existente muda (só quem tiver `note`).
- **C08 (`revbkt`) + C03 (`sizedonut`):** ganharam `note` explicando os dois medidores de receita e que "Sem receita" = "sem arr_estimado/primeira_fatura preenchidos", não "sem valor"; TCV somado permanece correto. Sem hardcode de % exato na ficha (só magnitude qualitativa) para não envelhecer.
- **Validação:** `new Function` nos 2 scripts inline = 0 erros; rota `/novo` = 200; HTML servido confirma o renderizador `noteHtml` e as duas notas. Cálculo dos gráficos inalterado.

### BDR No-Show | persona/indústria via Contact/Company + higiene do campo reunião (2026-07-07)

> Mudança de API aditiva em `api/forecast-table.js` ativada apenas por `?includeContext=true` + front em `public/bdr-no-show.*`. Demais painéis seguem chamando o endpoint sem associações.

- **Persona corrigida:** a quebra de persona agora vem do **cargo do contato associado** (`contact.jobtitle`), classificado em **senioridade** e **área** (DP, RH, Benefícios, SST, Financeiro, Compras, Jurídico, Saúde). Sem cargo, mostra explicitamente `Contato sem cargo no payload`; não usa texto do deal para inferir.
- **Indústria corrigida:** a quebra de indústria agora vem da **company associada** (`company.industry`). Sem `industry`, mostra `Company sem segmento no payload`; não usa proxy textual.
- **API `forecast-table.js`:** novo parâmetro `includeContext=true` busca associações deal→contact e deal→company via HubSpot v4 batch/read, depois batch/read de Contact (`jobtitle`) e Company (`industry`, name, domain, employees). Contrato é aditivo: `contact_jobtitle`, `persona_source`, `company_name`, `company_industry`, `company_segment`, etc.
- **Classificação de no-show refinada:** propriedades e atividades primeiro; texto só como suporte final. `a_reuniao_ocorreu_ = Não` é no-show confirmado; reunião passada com campo vazio vira bucket separado **Campo pendente | reunião passou**, não no-show confirmado automático.
- **Storytelling visual:** cards com `i` e memória de cálculo por métrica, linha temporal semanal (agendadas × no-show confirmado × campo pendente), cards de leitura executiva e tabela específica de higiene do campo reunião.
- **Escopo preservado:** universo continua sendo deals com `data_reuniao_agendada` entre set/25 e hoje; rota continua `/novo-bdr/no-show`; API sem login continua 401 em produção.
- **Validação e deploy:** `node --check` em `public/bdr-no-show.js` e `api/forecast-table.js`, `_check-inline-js` em `public/bdr-no-show.html`, smoke local 200 em `/novo-bdr/no-show` e `/bdr-no-show.js?v=3`, reviewer code PASS. Commit `37438b0`. Deploy Vercel `dpl_GynwV5Ve8GoZTuYGKNvU7FxzVPUA` READY. Produção validada: `/novo-bdr/no-show` 200, JS v3 200, JS contém `includeContext=true`, API sem login 401.

### BDR No-Show | padrão hover + clique + drilldown aplicado (2026-07-07)

> Evolução pedida: “igual às outras páginas” — hover com rótulos e clique abrindo janelas explicativas/drilldowns. Front-only em `public/bdr-no-show.html/js`.

- **Padrão aprendido de BDR/AE/Last48h:** hover em `i` mostra tooltip; clique em `i` abre drawer de memória de cálculo; clique em KPI/gráfico/linha de ranking abre modal de detalhe. Replicado no No Show.
- **Header:** novo botão de memória de cálculo abre todas as fichas da página.
- **Hover labels:** cards, ranking, quebras, gráfico temporal e botões `i` agora exibem rótulo contextual em tooltip flutuante.
- **Drilldowns:** clique em KPI abre os deals que compõem o número; clique na linha temporal abre breakdown semanal; clique em ranking de BDR abre os deals daquele BDR; clique em quebras por origem/indústria/persona/porte abre os deals daquele bucket.
- **Modal padrão:** mostra KPIs do recorte (deals, no-show confirmado, campo pendente, pipeline) + tabela com Deal, BDR, AE, reunião, campo, status, etapa, persona, indústria e pipeline.
- **Cache bust:** JS atualizado para `/bdr-no-show.js?v=4`.
- **Validação e deploy:** `node --check public/bdr-no-show.js`, `_check-inline-js` OK, reviewer code PASS. Commit `62e4781`. Deploy Vercel `dpl_8GSWoQsvqrfdkhALt4EgrgGvbKhU` READY. Produção validada: `/novo-bdr/no-show` 200, HTML contém JS v4 + modal + hover, JS v4 contém `openDrill`, `hover-tip` e handler `noShowRate`; API sem sessão 401.

### BDR No-Show | luzinha + `i` em rankings/quebras/tabelas (2026-07-07)

> Correção de acabamento após feedback: ao abrir No Show, a luzinha/status sumia e nem todos os blocos tinham ícone de informação.

- **Luzinha/status:** adicionada `health-dot g` no título/header e no item do menu lateral de No Show. `premium.js` também passou a preservar health do item canônico `/novo-bdr/no-show` e o HTML usa `premium.js?v=6` para evitar cache antigo sem dot.
- **Ícones `i` adicionais:** rankings, quebras por origem/indústria/persona/porte, tabela de campo pendente, tabela operacional, perdidos por no-show e cards de storytelling ganharam `i` com drawer explicativo.
- **Explicações:** adicionadas fichas específicas para ranking por volume, ranking fora do prazo, cada quebra, cada tabela e leitura executiva. Mantém o padrão das outras páginas: hover = rótulo; clique = explicação completa.
- **Fonte do menu nesta subpágina:** No Show é página estática isolada e depende do menu canônico reconstruído por `premium.js` no `DOMContentLoaded`. Para esta rota, a saúde do item `/novo-bdr/no-show` é fonte única no `NAV_MODEL` de `premium.js` + `health-dot g` local no header. Não há bloco `PANELS` inline nesta página.
- **Validações locais:** repo vanilla sem build/bundler. Gates usados: `node --check public/bdr-no-show.js`, `node --check public/premium.js`, `node scripts/_check-inline-js.js public/bdr-no-show.html`, parse de `vercel.json`, smoke local 200 em `/novo-bdr/no-show`, `/premium.js?v=6` e `/bdr-no-show.js?v=4`.
- **Reviewer + deploy:** reviewer code PASS após documentação da fonte do menu. Commit `bfe8e89`. Deploy Vercel `dpl_GR6juAYK3CtRLz3RCCGfBeGMkjmF` READY. Produção validada: `/novo-bdr/no-show` 200; HTML contém `premium.js?v=6`, `health-dot g title-health` e `bdr-no-show.js?v=4`; JS v4 contém infos de ranking/quebras/tabelas; `premium.js?v=6` contém `health:'g'` + `health-dot`; API sem sessão 401.

### BDR | Ataque à Lista | subpágina de consumo de lista ABM (2026-07-07)

> Nova subpágina aditiva dentro de BDR Performance. Nome final da visão: **BDR | Ataque à Lista**. Rota canônica `/novo-bdr/list-attack`; aliases `/dashboard/bdr/list-attack` e `/novo-bdr-list-attack`.

- **Front:** `public/bdr-list-attack.html` + `public/bdr-list-attack.js` no mesmo padrão do No Show: header com luzinha `health-dot g`, menu canônico via `premium.js`, cards clicáveis, hover contextual, drawer de memória de cálculo, modal de drilldown, filtros e estados loading/empty/error.
- **Backend:** novo endpoint `GET /api/bdr-list-attack` lê Google Sheets server-side (default: ABM Distribuition `1dkjxOiNx1sM_YMhUk9VfO4-HxaOId94RCm9cSpp7cK0`, abas BDR `01 - ...`) + HubSpot server-side. A UI não chama HubSpot/SHEETS diretamente. `lib/sheets.js` ganhou `readSpreadsheetRange` e `listSpreadsheetTabs` genéricos, preservando os snapshots existentes.
- **Matching:** ID/HubSpot link da lista → domínio → nome normalizado. Cada empresa recebe `matchedInHubSpot`, `matchConfidence`, `matchMethod`, `attackStatus`, `visibilityStatus`, `riskLevel` e ação sugerida. Match médio/baixo aparece em tabela de inconsistências para não inflar métricas principais sem sinalização.
- **Métricas entregues:** cards de presença no HubSpot, fora do HubSpot, contatos associados, atividade, deals, pipeline criado/ativo/perdido/ganho, alto risco e match fraco; progresso de consumo; rankings por BDR; evolução semanal de criação; penetração de contatos; funil lista → HubSpot → contatos → atividade → deal; quebras por segmento/porte/origem; tabela operacional por empresa; tabela de inconsistências.
- **Navegação:** `premium.js` ganhou item `BDR | Ataque à Lista`; `bdr.html` ganhou botão `Ataque à Lista`; rewrites adicionados em `vercel.json` e `scripts/local-server.js`.
- **Validação local:** `node --check api/bdr-list-attack.js`, `node --check public/bdr-list-attack.js`, `node --check public/premium.js`, `node --check scripts/local-server.js`, `_check-inline-js public/bdr-list-attack.html`, `_check-inline-js public/bdr.html`, parse de `vercel.json` e smoke local 200 em `/novo-bdr/list-attack`, `/dashboard/bdr/list-attack`, `/novo-bdr`, `/bdr-list-attack.js?v=1`, `/premium.js?v=7`.
- **Reviewer + deploy:** reviewer code PASS após remover detalhe de erro do response e bloquear `sheetId`/`tabs` por query em produção. Commit `761968d`. Push via `salencar-lang`. Deploy Vercel `dpl_FurrT1xw8HDjq13A1pqx6zqnbX91` READY. Produção validada: `/novo-bdr/list-attack`, `/dashboard/bdr/list-attack`, `/novo-bdr-list-attack`, `/bdr-list-attack.js?v=1`, `/premium.js?v=7` e `/novo-bdr` 200 com marcador `Ataque à Lista`; `/api/bdr-list-attack` sem sessão retorna 401.
- **Hotfix HTTP 500 pós-go-live:** produção não tinha `GOOGLE_SERVICE_ACCOUNT_JSON`, então a UI autenticada recebia 500 ao chamar `/api/bdr-list-attack`. Adicionada env var sensitive no Vercel a partir do secret GCP `axenya-opencode-gsc-service-account-json-shared` (SA já tinha acesso à planilha `1dkjxOiNx1sM_YMhUk9VfO4-HxaOId94RCm9cSpp7cK0`) e redeploy `dpl_G1FMeNYHZBbu6Yfh6RJ8JNFruVST` READY. Validação local com secrets reais e auth bypass: endpoint retornou 200, `success=true`, 4.343 registros e 2.501 matches. Produção sem sessão segue 401 esperado.

### BDR | Cadência de Leads (R16–R22) + dimensão Origem/Porte na originação (2026-07-10)

> Evolução aditiva do `/novo-bdr`: nova seção **Cadência de Leads | Contatos do Time** com o funil de lead status dos CONTATOS (novo → tentativa → conectado → desqualificado), taxas de contato por coorte, desqualificações por dia, ritmo diário, penetração por empresa e tabela da semana. Nada da página anterior foi alterado em cálculo; só o Weekly/Monthly ganhou toggle de dimensão.

- **Decisão de arquitetura (sem job externo):** o histórico de `hs_lead_status` vem do próprio HubSpot via `propertiesWithHistory` (batch/read, máx. 50 inputs/batch) — reconstrução exata do funil em qualquer data, sem snapshot no GCP/Sheets. Volumes medidos em 2026-07-10: 9.921 contatos do time, 2.411 com lead status, média 1,7 versões de status por contato; carga fria ~14s, cache em memória 10 min (`?refresh=1` força). Se o volume passar de ~9k contatos com status (teto do search da API é 10k), revisitar com snapshot diário.
- **Backend:** novo endpoint `GET /api/bdr-leads` (auth padrão `_helpers`): contatos com `hubspot_owner_id` de um dos 13 BDRs + `hs_lead_status` preenchido; owners resolvidos ao vivo por nome completo normalizado + alias (o `fetchOwners`/`cleanOwnerName` da lib encurta nomes e colidiria com homônimos — ex.: Cintia Minamoto; por isso o endpoint usa fetch cru de owners, ativos + arquivados, cobrindo as DUAS grafias de Cíntia Rodrigues). Payload: contato compacto + `hist` cronológico + empresa associada (batch companies p/ nome e porte fallback) + `semStatus` (contagem do time fora do funil). Campo custom `bdr` de contato NÃO usado: está vazio no portal (5 registros).
- **Frontend (R16–R22, tudo com ficha, `i`, drilldown e filtro de período AxFilter):** R16 funil snapshot no fim da janela (reconstruído do histórico); R17 taxa de contato/conexão por COORTE semanal (primeiro evento de status = entrada na cadência; por coorte, não por toque); R18 tabela por dimensão BDR | Porte | Origem com barras de taxa; R19 desqualificações por dia (UNQUALIFIED × BAD_TIMING; portal NÃO tem campo de motivo de desqualificação de contato — documentado na ficha, recomendação de criar propriedade); R20 contatos distintos trabalhados por dia empilhado por BDR; R21 penetração média contatos/empresa por BDR; R22 tabela "trabalhados na semana" (últimos 7 dias) com "Explorar com filtros". Novo modal de facetas de CONTATOS (BDR × Status × Porte × Origem, AND, cap 400 linhas) com link HubSpot por contato.
- **Originação:** R13 Weekly e R14 Monthly ganharam segundo toggle de DIMENSÃO do empilhamento: Por BDR (padrão) | Por Origem (`origem__originacao_`, já vinha no payload) | Por Porte; drilldown pré-seleciona a dimensão ativa. Modal de deals ganhou faceta "Fonte" (`origem`). Fichas R13/R14 atualizadas.
- **Validação local (porta 3002, token real via GCP `axenya-hubspot-pat-shared`):** `node --check api/bdr-leads.js`, `_check-inline-js public/bdr.html` (2 blocos, 0 erros), página renderizada full-page sem erro de console (Playwright), funil bateu 1:1 com contagens independentes da API (NEW 1.879 · ATTEMPTED 155 · CONNECTED 168 · OPEN_DEAL 17 · UNQUALIFIED 107 · BAD_TIMING 3), toggles Por Origem/Porte trocando datasets, drilldowns reais clicados (funil → "Novo (1879)"; tabela → "Cadência | Priscilla Feliciello (585)").
- **Deploy e domínio (2026-07-10):** commit `4194768`. Deploy Vercel `dpl_Gtb8uuFDHQafa8s55vnXoKdaE6Kh` READY no projeto canônico `dashboard-axenya` (team `axenya-f1a041f6`), aliased em `project-bsmfu.vercel.app`; produção validada (200 nas páginas; `/api/bdr-leads` e `/api/forecast-table` sem sessão = 401). DESCOBERTA DE INFRA: o domínio `axenya-pipeline-dashboard.vercel.app` (o que o time usa) era servido por um projeto Vercel LEGADO e desconectado na conta pessoal "Samuel Alencar's projects" (Hobby | deploys ficam BLOCKED por exceder o limite de funções), buildado do repo espelho `salencar-lang/axenya-pipeline-dashboard` (histórico divergente, sem as features desde ~jun/26). Correção: projeto legado renomeado para `axenya-pipeline-dashboard-legacy` (reversível, nada deletado) e o domínio `axenya-pipeline-dashboard.vercel.app` adicionado ao projeto canônico + alias explícito no deployment. Ambas as URLs agora servem o MESMO deployment. Tokens usados via GCP Secret Manager: `vercel_personal_token` (team Axenya) e `Vercel_Growth` (conta pessoal). ATENÇÃO validação via curl: `public/bdr.html` tem 3 bytes NUL históricos — grep sem `-a` trata a página como binária e silencia; usar `grep -a` ou python.
- **Hotfix OAuth pós-migração de domínio (2026-07-10):** ao mover `axenya-pipeline-dashboard.vercel.app` para o projeto canônico, o login Google passou a usar o client do canônico, que não autorizava esse domínio → `Error 400: redirect_uri_mismatch`. Correção sem Console: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` do `dashboard-axenya` trocados para o client do GCP da Axenya (`596382399844-fabidm…`, JSON no secret GCP `oauth-client-pipeline-dashboard`, que já autoriza exatamente esse domínio) + redeploy `dpl_CBDq6fJ7Ae2CTSBKpZkng8KxDdWm` + alias. Validado: `/api/auth/config` devolve o client certo e o endpoint de auth do Google renderiza o sign-in (sem mismatch). PENDÊNCIA: login via `project-bsmfu.vercel.app` agora exige adicionar no Google Console (projeto `gen-lang-client-0423905839` → Credentials → client `…fabidm…`) a origem `https://project-bsmfu.vercel.app` e o redirect `https://project-bsmfu.vercel.app/api/auth/callback` (client clássico não tem API de edição).
- **Hotfix HUBSPOT_TOKEN do canônico (2026-07-10):** com o domínio migrado, o backend passou a ser o do canônico, cujo `HUBSPOT_TOKEN` estava expirado → "HubSpot: autenticação falhou" no `/api/bdr-leads` e HTTP 500 no `/api/bdr-list-attack`. Corrigido com o PAT do secret GCP `axenya-hubspot-pat-shared` (validado 200 contra `api.hubapi.com` antes de gravar), redeploy `deploy4` + alias. DEPLOY_GUIDE ganhou a seção "7. Mapa real da infra Vercel" com projetos/tokens/OAuth/gotchas para próximas sessões.
- **Hotfix rate limit HubSpot (2026-07-10, 3º):** com todos os endpoints na cota do PAT compartilhado, o load da página (forecast-table + bdr-leads + list-attack simultâneos) estourava 429 → painel exibia "rate limit exceeded" e list-attack HTTP 500. Correções: (1) `_hsFetchRetry` com backoff exponencial + Retry-After (429/5xx, até 3 retries) em `lib/hubspot.js` (cobre bdr-leads, list-attack, history, snapshot) e no helper próprio do `api/forecast-table.js`; (2) `api/bdr-leads` com concorrência 4→2 e fallback STALE (serve o último cache bom com aviso em vez de 500); (3) `bdr.html` carrega os leads DEPOIS do forecast-table (burst escalonado) com banner de dados em cache quando stale. Ideal futuro: private app dedicado ao dashboard (o token dedicado do projeto legado é sensitive/irrecuperável no Vercel).
- **Reordenação de storytelling (2026-07-10):** a pedido do usuário, a seção Cadência de Leads (R16–R22) foi movida do TOPO para o FIM da página — narrativa do estratégico/geral (KPIs, Originação, Handoff, Fluxo, Qualidade) para o operacional/afunilado (cadência de contatos). Mudança só de posição no `novoRender`; cálculos intactos.

### Deploy canônico | merge limpo do deploy local do Pacheco + proteção anti-regressão (2026-07-10)

> Incidente: um deploy CLI local de tarde (`dpl_3Phyy86...`, creator `jpacheco-5103`, commit metadata `029cc416...`) reatribuiu os aliases `project-bsmfu.vercel.app` e `axenya-pipeline-dashboard.vercel.app`, mas o pacote não continha arquivos recentes (`api/bdr-leads.js`, `api/bdr-list-attack.js`, `public/bdr-no-show.*`, `public/bdr-list-attack.*`). Resultado: rotas recentes voltaram a 404. O fix abaixo preserva as mudanças recentes do Pacheco sem derrubar No Show/List Attack/Cadência.

- **Merge seletivo sem rollback:** extraídas do deployment do Pacheco apenas as mudanças válidas de produto: Forecast com `Período` do contrato, coluna `TCV`, KPI `TCV (12m)`, tooltip de receita com mês/ano, filtro `Reunião Pré-RFP`, `revenue-engine.js` com `contratoMeses()`/`calcTCV()`, e payload aditivo `periodo_contrato`/datas de reunião do executivo em `api/forecast-table.js`. **Não** foram aplicadas as regressões do pacote local que removiam `includeContext`, retries/backoff, endpoints BDR e rewrites das subpáginas.
- **Canônico protegido:** criado `scripts/preflight-deploy.js` e ligado ao `npm run deploy`. O preflight exige: `origin` = `pachecojr-axenya/dashboard-pipeline`, branch `main`, working tree limpa, `HEAD == origin/main`, arquivos críticos presentes, rewrites No Show/List Attack presentes, zero dependências runtime, arquivos sensíveis não trackeados e `.vercel/project.json` apontando para o projeto canônico `dashboard-axenya` (`prj_Wlrmz...`, `team_kMp...`). Deploy local sujo/desatualizado agora falha antes de subir.
- **Host canônico de login:** `project-bsmfu.vercel.app` virou domínio técnico. `premium.js` redireciona esse host para `axenya-pipeline-dashboard.vercel.app` antes do login, evitando `redirect_uri_mismatch` sem manter dois OAuth clients/domínios de usuário.
- **Segurança de pacote:** `lib/credentials.json`, `.claude/settings.local.json`, `.env*`, `.vercel` e `_local_trash` seguem proibidos/ignorados; o preflight também falha se algum desses caminhos sensíveis estiver trackeado.
- **Validação local com evidência:** syntax/inline gates PASS (`node --check` em APIs/JS, `_check-inline-js` em forecast/bdr/no-show/list-attack, parse `vercel.json`) — evidence hash `0a1872845062d14b952691ee75680ccc2e90843802cbc1f9062880ac2ce57b46`. Smoke local PASS em `/novo`, `/forecast`, `/novo-bdr`, `/novo-bdr/no-show`, `/novo-bdr/list-attack`, assets e `/api/auth/me` com bypass local — evidence hash `130394829b77c8762dcc21844c1c5a64a7bff4e4ad42e5c4a5d263e376186924`.
### Painel AE | card "Alerta | Higiene de Reuniões" (A20) (2026-07-07)

> Mudança de **API** (`api/forecast-table.js`) + front (`public/ae.html`). Servidor local reiniciado (porta 3002). **NÃO commitado e NÃO deployado** (só local). Motivação: transformar o relatório de higiene de reuniões (feito antes no HubSpot/Slack) em alerta acionável dentro do AE Performance.

- **API (`forecast-table.js`):** adicionados 2 campos ao `PROPERTIES` e ao retorno — `data_reuniao_exec` (`data_da_reuniao_com_executivo`) e `data_reagendamento_exec` (`data_do_reagendamento_com_o_executivo`). Contrato só CRESCEU (aditivo, seguro para os demais painéis). Distinto de `data_reuniao_agendada` (= entrada na ETAPA). Payload confirmado: 271 deals com `data_reuniao_exec`, 22 com `data_reagendamento_exec`.
- **Front (`ae.html`):** novo card wide na seção Reuniões (antes do A16), código A20 em `AE_CARD_CODES`, ficha de memória de cálculo em `AE_HELP_CHARTS`, builder `buildAEMeetingAlert` + drill `aeMtgAlertDrill` (reusa `_aeMeetingListModal`). Triagem por executivo (todos os owners, sem proprietário por último) em 4 situações: ⚪ sem status (reunião passou & `a_reuniao_ocorreu_` vazio) · ❌ não ocorreu sem reagendamento · 🔴 não ocorreu & reagendamento vencido · ✅ ocorreu mas parado na etapa. **Snapshot atual, NÃO segue o filtro de período** (é alerta de estado); deals de teste (nome com "teste") filtrados. Título com 🟡 até validação dos números contra o HubSpot.
- **Validação:** buckets replicados sobre o payload real (30/30/5/2 na data); `scripts/_smoke-render.js public/ae.html` = "novoRender() rodou sem exceção"; `/novo-ae` = 200; marcadores confirmados no HTML servido.
- **Drill do A20 → modal com cross-filter (2026-07-07, mesma sessão):** clicar num número agora abre um modal com a base INTEIRA de Reunião Agendada (nas 4 situações), pré-filtrado no executivo + situação clicados. Filtro de situação = 4 KPIs clicáveis no TOPO do modal (Sem status · Não ocorreu · Reagend. vencido · Ocorreu parado; clicar na ativa volta para todas); filtro de executivo = fileira de chips. Contadores cruzados (padrão A12). Novas colunas: Situação, Data reunião, Data reagendamento, Dias desde reunião, Dias desde reagendamento, Dias sem atividade (`dias_sem_atividade`) — com destaque em vermelho acima de 60/30/30d. Título "Higiene de Reuniões Agendadas". Front-only. Validado com harness dedicado (stub de DOM + externos): drill nas 4 situações + toggles de chip + render de linhas sem exceção.

### Board | remoção do B14 (Cenários de Forecast) + Board/AE "live" (verde) sobre origin (2026-07-10)

> Reaplicação, sobre o `origin` já sincronizado, de duas mudanças que estavam só no meu local (não tinham entrado no merge seletivo do Samuel). Front-only. **NÃO deployado.** O cherry-pick dos commits originais era inseguro (o `2a05cb2` era um bundle de 625 linhas que reverteria bdr/48h/ae/forecast do Samuel), então o B14 foi removido cirurgicamente direto no `board.html` do origin.

- **B14 removido do `board.html`:** card `c(t('bd_forecast')...)` do render, chamada `buildBdForecast()`, função `buildBdForecast`, entrada em `BOARD_HELP_CHARTS`, `BOARD_CARD_CODES['forecast']='B14'`, `BOARD_FILT_FIELD['forecast']` e chaves i18n `bd_forecast`/`bd_forecast_tip` (pt/en). **Mantidos** o KPI **Receita Ponderada (P03, `kind==='forecast'`)** e o helper `_novoForecastOpen` (usado por outros). AE A20 restaurado à parte (cherry-pick `48ffddd`, `ae.html` preservando o trabalho do Samuel).
- **Board View + AE Performance → health `g` (verde/live):** flip `health:'y'→'g'` no bloco `PANELS` dos 9 HTMLs que tinham amarelo (48h, ae, bdr, board, cotacao, cs, dashboard, forecast-panel, forecast-stage); `forecast.html` já estava verde. Zero amarelo restante.
- **Validação:** `_check-inline-js` = 0 erros nos 10 HTMLs; `_smoke-render` board+ae OK (225 deals); rotas `/novo-board`, `/novo-ae`, `/forecast` e as do Samuel `/novo-bdr/no-show` + `/novo-bdr/list-attack` = 200 (trabalho dele intacto). Backup do estado anterior em `backup-local-pre-merge-029cc41`.

### Forecast | export identifica os blocos de Receita Real e Probabilizada (2026-07-13)

> Front-only em `public/forecast.html` (função `exportData`), usando dados já presentes no DOM/payload. **Commitado (`ce241d5`) e deployado em produção** (`dpl_8s9jznpDZ…`, projeto `dashboard-axenya`, preflight OK; pós-deploy: `/`, `/novo`, `/forecast` = 200 e `/api/*` = 401 nos hosts `axenya-pipeline-dashboard` e `project-bsmfu`). Motivo: ao exportar (CSV/XLSX), as 48 colunas mensais saíam com rótulos duplicados (`JAN 2026 … DEZ 2027` duas vezes) porque o **header de grupo** ("Receita Real"/"Receita Probabilizada") não é exportado — o arquivo não deixava claro qual bloco era Real e qual era Probabilizada.

- **Cabeçalho auto-identificável:** cada coluna de mês agora recebe sufixo pelo tipo detectado (`colTypes`): `… | Receita Real (R$)` e `… | Receita Probabilizada (R$)` (separador `|`, conforme Regra primária nº 1). Vale para CSV e XLSX.
- **Valor robusto a render:** os meses de receita agora caem no valor do `data-calc` (`rec` para Real, `val` para Probabilizada) quando o `innerText` vier vazio (coluna oculta por `display:none`), então a exportação não perde o cálculo por causa do estado de renderização/viewport. Fallback só dispara quando havia célula com dado e texto vazio — zero mudança no caminho feliz.
- **XLSX mantém as fórmulas:** a lógica de fórmulas (Real via `buildRealFormula` referenciando 1ª Fatura/Vidas; Probabilizada = Real × P. Ajustada; totais `SUM`) ficou intacta.
- **Toda coluna numérica agora sai como NÚMERO no XLSX (não texto).** Antes só Vidas/1ª Fatura e os meses (via fórmula) eram numéricos; o resto ia como string ("557.975", "45,0%"). Generalizado via `numOverrides`: `NUM_Z` (moeda/inteiro, formato `#,##0`) cobre `dias_no_pipe`, `colaboradores`, `vidas`, `fatura_atual`, `primeira_fatura`, `arr_estimado`, `tcv`, `comp_dreal`, `comp_dprob`; `PCT_KEYS` (formato `0.0%` sobre a fração armazenada) cobre `probabilidade`, `prob_etapa`, `prob_ajustada`. Meses também recebem número base (rec/val do `data-calc`); a fórmula, quando existe, sobrescreve. Totais somáveis viram `SUM(...)` com formato. Célula numérica sem dado é **esvaziada** (não fica "-"). Texto e datas ficam como estão. O **CSV não muda** (segue legível, com "—"/percentuais formatados).
- **Validação (browser real, Playwright + Chrome, dados de produção via 3002):** CSV com cabeçalhos rotulados e valores presentes (ex.: CommShop Real `559.828 / 29.465…`, Prob `43.785 / 2.304…`); XLSX com **2770 células de fórmula** (ex.: `AN3=J3*0.95`, `BL3=AN3*0.0782…`) e, nas **58 colunas numéricas × 225 linhas**, 2228 células numéricas e **0 vazamento de texto** (varredura de tipos de célula: int/moeda `t:"n"` `#,##0`, % `t:"n"` `0.0%`, totais `SUM` com formato). `_check-inline-js public/forecast.html` = 0 erros.

## BDR Workload | nova subpágina /novo-bdr/workload + /api/bdr-workload (2026-07-13)

> A pedido: primeira versão da visão de carga de trabalho intraday/weekly/monthly dos BDRs — "como foi o dia de hoje". Spec completa em `docs/2026-07-13_bdr-workload-intraday-spec.md` (decisões travadas com o usuário + smoke tests na API HubSpot). Sessão única no repo; API nova, sem tocar em endpoints existentes.

- **Novo `api/bdr-workload.js` (`GET ?since&until`, datas em America/Sao_Paulo):** 3 buscas — empresas criadas na janela com owner do time, contatos criados na janela (COM ou SEM `hs_lead_status`; o `/api/bdr-leads` só cobre quem tem status), e contatos do time com `lastmodifieddate >= since` para extrair transições de `hs_lead_status` via `propertiesWithHistory` dentro da janela. Fonte de criação via `hs_object_source_detail_1`: Apollo/Lusha = push do próprio BDR via extensão (validado 13/07: 866 das 880 empresas desde 01/06 são INTEGRATION; owner preenchido em 90% e setado no ato do push) | `hubspot-development-growth` = chave de API interna (automações, NÃO conta como inserção de BDR) | CRM_UI = manual (raro: 14 desde 01/06). Time/alias duplicado do `bdr-leads.js` de propósito (não tocar em produção); consolidar em `lib/bdr-team.js` quando houver 3º consumidor. Cache 5 min por janela + fallback stale.
- **Nova `public/bdr-workload.html` + `public/bdr-workload.js` (padrão bdr-no-show):** filtros de período (Hoje | Ontem | Últimos 7 dias | Semana | Mês | custom) + BDR + porte + fonte; 6 KPIs clicáveis (empresas inseridas, contatos inseridos, movimentações, contato efetivo, qualificado, desqualificado|timing) com drill nominal — todo KPI abre a lista exata que ele conta (reconciliação por construção); gráfico de ritmo (por hora no intraday, por dia em janelas maiores; inserções turquesa + movimentações amarelo); quebras por BDR e por fonte; 3 tabelas nominais (movimentações de→para com links HubSpot, empresas inseridas com nº de contatos, contatos inseridos com status atual). Motivo de desqualificação declarado como pendente (propriedade não existe no portal; Gate 0 da spec outbound-hubspot-first).
- **Rotas:** `/novo-bdr/workload` + `/dashboard/bdr/workload` em `vercel.json` e `scripts/local-server.js`. Não entrou no bloco `PANELS` ainda (mesmo padrão do no-show: nav próprio da subpágina).
- **Validação local (porta 3003, dados de produção):** endpoint 200 em ~2s; dia 13/07 = 95 empresas inseridas (Allan 39 Lusha, Thauan 26 Apollo), 177 contatos, 16 transições (7 ATTEMPTED→CONNECTED, 2 desqualificações) batendo com contagem independente via payload do `/api/bdr-leads`; screenshot full-page ok.

## BDR Workload | camada de Atividades (engagements) validada e no ar (2026-07-13)

> A pedido: "o Anderson não inseriu nada, mas como foi no contexto de atividade?" — validado na API e incorporado. Runbook consolidado no vault: `20_Company/Sales/Pipeline_Dashboard/BDR_Workload_Subpage_Runbook.md`.

- **`api/bdr-workload.js`:** novo bloco de atividades — busca paginada de calls, emails, communications, notes, tasks e meetings por `hubspot_owner_id` do time + `hs_timestamp` na janela (paralelo aos demais fetches; `searchAll` ganhou `sortProp` porque engagement não tem `createdate`). Calls levam duração e disposition (mapa `/calls/v1/dispositions` tolerante a falha — hoje retorna vazio, exibimos só duração); communications levam canal (WHATS_APP | LINKEDIN_MESSAGE). Teto de 9.800 por tipo declarado na ajuda.
- **`public/bdr-workload.js`:** nova tabela "Atividades | o trabalho além da inserção" — por BDR: ligações, com conversa (≥1 min, % sobre o total), e-mails, WhatsApp, LinkedIn, outras, notas, tarefas, reuniões, total, e as colunas de inserções/movimentações lado a lado para contrastar (o caso Anderson: 0 inserções | 72 ligações | 4 com conversa | 20 notas fica visível de imediato). Filtro de BDR aplica; porte/fonte não (atividade não tem empresa/fonte).
- **Validação (13/07, produção via local):** 1.125 atividades no dia | 384 calls (Anderson 72), 266 tasks, 233 emails, 206 communications (132 WhatsApp + 74 LinkedIn), 31 notes, 5 meetings; payload em ~4,5s; screenshot ok.

## Merge origin/main → branch nav | resolvido a favor do nav.js (2026-07-14)

> Contexto: produção estava no tip do main (`35b30eb`, verificado por hash de `forecast-overall-core.js` + probes de rota), com 17 commits (Treble, BDR Workload|Intraday, fix probabilidades do forecast, GitHub source-of-truth) que a branch `pacheco/nav-single-source-2026-07-13` não tinha — e o main não tinha os 14 da branch (nav.js, Forecast POC/TCV, AE A21). Merge commit: `bdaf66e`.

- **Conflitos (11):** STATUS_LOG.md + 10 HTMLs. O main ainda carregava o bloco `PANELS` inline (o commit `4e5b170` adicionou o grupo BDR colapsável NELE); resolvido mantendo o include do `nav.js` (Regra primária nº 2) e portando as novidades: **Workload | Intraday** (`/novo-bdr/workload`, 🟡) e **Treble** (`/novo-bdr/treble`, 🟡) como `sub:'bdr'`; labels das subs BDR alinhados aos de produção (sem prefixo "BDR |"). Resolução dos HTMLs por script Node byte-preserving (bytes NUL do bdr.html preservados = 3; sem sed).
- **Regressões da extração do nav.js corrigidas** (o bloco inline do merge-base tinha coisas que o nav.js perdeu): footer chama `(doLogout||logout)` — 8 das 10 páginas só definem `doLogout`, o botão Sair dava ReferenceError; botão de idioma PT/EN de volta (condicional a `novoToggleLang`; forecast/forecast-stage não têm); ícone de tema sun/moon; **Escape em cascata** (settings → ajuda → modal → dropdown) restaurado — 8 páginas tinham perdido o Esc-fecha.
- **Regra primária nº 2 atualizada** com a ressalva do main: subpáginas BDR (workload, treble, no-show, list-attack) ainda usam `premium.js`/`NAV_MODEL` como segunda fonte de menu — espelhar mudanças lá até a unificação.
- **Validação:** `node --check nav.js` OK; `npm run check` OK; `_check-inline-js` 10/10 OK; fix `35b30eb` presente nos forecast*; servidor local reiniciado (api/lib mudaram); 17 rotas 200 (incl. `/novo-bdr/workload`, `/novo-bdr/treble`, `/nav.js`); `_smoke-render` OK nos 8 painéis novo*; menu montado em mini-DOM com os 4 sub-itens BDR + footer completo. ⚠ `/api/bdr-workload` local dá 500 "autenticação falhou" — token do `.env.local` sem os escopos de engagements/owners que o endpoint usa (funciona em produção; não é defeito do merge).
