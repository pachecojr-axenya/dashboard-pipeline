# Auditoria crítica dos gráficos 🟡 | 2026-06-12

## Adendo | Meta vs Ach (2026-07-22)

> **Estado: 🟡 não validado contra o HubSpot.** Bloco novo (`public/meta-ach.js`), primeira
> montagem na aba "Meta vs Ach" do `/forecast`. Mostra atingimento da meta do trimestre por
> AE. **"Fechado" = Σ (`arr_estimado` × prob. de etapa pela régua GLOBAL) das contas cuja entrada
> em Implantação (`data_implantacao`, fallback `data_ganho`) cai no tri corrente.** Régua =
> `SEMANTIC_REF.forecast_flat` (Implantação 0,8 · Ganho 1,0). Meta 300k/AE, time = 5 AEs
> (Ágatta fora) = 1,5MM.
> Ressalvas conhecidas a validar: (1) é métrica de **bookings ponderados** (arr_estimado × régua), NÃO a receita
> canônica da Regra primária nº 3 (Real/Probabilizada) — números podem divergir do resto do
> forecast por construção, é esperado; (2) `arr_estimado` como fonte de origem ainda não foi
> conferido campo a campo no HubSpot; (3) contas do pipeline **Bid** não entram (o payload só
> expõe entrada em Implantação/Ganho de Vendas) — extensão futura se o dono quiser Bid; (4)
> status "no ritmo/atrás" usa % de dias decorridos do tri como ritmo esperado (proxy linear).

## Adendo | BDR No Show (2026-07-20)

> **Estado: 🟠 até validação pós-deploy.** Auditoria encontrou mistura de AEs no gráfico por BDR, semanas sem amostra plotadas como 0%, eixo chegando a 130%, gráfico limitado às últimas 16 semanas e ranking fora SLA incluindo perdidos/reagendados. A correção usa roster canônico, denominador de desfechos conhecidos + cobertura, lacunas sem amostra, eixo 0–100%, média móvel ponderada de 4 semanas e reconciliação `ranking fora SLA = tabela operacional`. Recorte real de 30 dias: 74 reuniões canônicas, 41 com desfecho (55,4% de cobertura), 10 no-shows históricos, 8 abertos/fora SLA. Ver `docs/2026-07-20_no-show-validation-incident.md`.

Análise dos gráficos que estavam marcados com 🟡 (não validados) em `public/novo-dashboard.html` e `public/novo-board.html`. Para cada um, capturei o **dataset real** que o gráfico gera com os dados de produção (interceptando `_novoMkChart` via `scripts/_capture-charts.js`) e comparei com o que o título/tooltip promete.

## Legenda de cores (substituiu o 🟡 nos títulos dos gráficos)

| Cor | Significado |
|---|---|
| 🟢 | **Estrutura e cálculo corretos** | o gráfico mostra o que o título diz. *Atenção:* isto NÃO confirma que o dado de origem (ex.: `arr_estimado`, `vidas`) está certo — isso ainda depende da sua validação contra a fonte. |
| 🟠 | **Calcula certo, mas com ressalva relevante** | amostra pequena, escopo inconsistente, cobertura parcial, dominado por outlier, ou rótulo impreciso. Use com contexto. |
| 🔴 | **O que mostra diverge do que o título promete** | risco real de interpretação errada ao vivo, mesmo com o aviso. |

> O 🟡 foi mantido apenas onde **não** houve análise nesta auditoria (KPIs secundários, disclaimers internos). Gráficos C01–C09, que você já havia validado, continuam **sem emoji**.

---

## Adendo | mudanças pós-auditoria (2026-07-01)

> A tabela `novo-dashboard.html` abaixo usa a numeração **N01–N26 de 12/06**, que **não bate mais** com os códigos exibidos no dashboard atual (o card map do código foi reorganizado; ex.: hoje "Maturidade por Coorte" aparece como N01 no dashboard, "Cobertura" como N05, "Forecast Total" como N06B). Trate a tabela como histórico; o estado corrente é este adendo.

- **Forecast Total (N06B) → 🟢 validado.** Religado no motor compartilhado (`forecast-engine.js`: `dealMonthly` + `bdrCohorts`, régua `calcReceitaMes`, faturamento manual). Bate **mês a mês**, em Receita Real e Probabilizada, com o painel **Forecast Overall** (`forecast-stage.html`) — filtro de deals (createdate≥set/25 · Ganho · Bid desde jan/25), dedup Fee×Corretagem, prob por etapa do funil (Diagnóstico 6%), bloco BID só Negociação/Proposta com prob fixa 0,5%. Marcador 🟡 removido do título.
- **Maturidade por Coorte (N01 no código atual) → 🟢 validado.** Pisos alinhados ao tooltip (coortes com 2+ meses e 20+ deals); curva de desfecho por `close_date` ÷ tamanho, meses futuros nulos.
- **C07 (Prob. de Ganho por Etapa):** eixo Y capado em 40%.
- **Removidos:** **C05** (Receita por Segmento — redundante com o C08/TCV e usava `arr_estimado`) e **N06/N14** (Valor do Pipeline | Projeção Mensal — redundante com o Forecast Total).
- **Cobertura do Pipeline (N05) → 🟢 validado.** Religado no mesmo motor do N06B: consome a série única `_novoForecastSeries()` (extraída do N06B), então Receita Real e Probabilizada batem **mês a mês** com o Forecast Total por construção (verificado com dados de produção: idênticos nos 24 meses). Ganho/Implantação sempre incluídos; toggle **Cobertura (×) ↔ Receita (R$)** (× = forecast ÷ meta mensal, 1× = no alvo). KPI de pipe-segurança = pipe aberto real ÷ meta. Marcador 🟡 removido do título.
- **Pendente:** o **modal** do N06B (`_novoOpenN06BForecastModal`) ainda usa o motor antigo (`calcReceitaMes` sem faturamento manual) e pode divergir do gráfico quando há faturamento manual — a religar no `ForecastEngine`.
- **Tempo em Etapa (N07 no código atual) → validado (2026-07-02).** Cálculo replicado do relatório do HubSpot por engenharia reversa: mediana do tempo CUMULATIVO por deal, só períodos concluídos, timestamps completos, Vendas, criados ≥ set/2025. Réplica vs relatório do CRO: RA 14,9≈14,7 · Diag 24,9≈25,6 · Cot 20,1≈20 · Cons 21=21 · Neg 19,4=19,4. Marcador 🟡 removido do título.

---

## `novo-board.html`

> **Adendo (2026-07-07):** alinhamento às premissas globais do CRO. **C03** (Distribuição por Tamanho) foi **substituído pelo C08** (TCV do Pipe por Bucket, dois donuts Bruto×Ponderado). **C04** (Valor do Pipeline por Etapa) agora usa **TCV pela régua** + probabilidade final global (C07 por pipeline + ±10% do AE), idêntico ao C04 do CRO. **B14/B15/B16** ponderam com a mesma probabilidade global (`_calcProbInfo`), mantendo `arr_estimado` como base de receita. **B11** (Entrada vs Saída) passou a contar a entrada pela **data de entrada em Reunião Agendada** (`data_reuniao_agendada`), não `createdate` — some o pico artificial de importação de Mai/26 no `createdate`. A probabilidade agora vem do arquivo compartilhado `prob-engine.js` (o CRO ainda mantém a cópia inline; reconciliar). **B12** (ARR Bridge) inalterado.

Os 4 KPIs do topo (após o alinhamento de definições de 2026-06-12) estão corretos: **ARR Ganho R$ 4,14M / 24 deals · Pipeline Aberto R$ 149,85M / 137 · Forecast Ponderado R$ 44,4M** → 🟢.

| Gráfico | Cor | Diagnóstico |
|---|---|---|
| Tendência de Receita (ARR Ganho) | 🟢 | ARR de ganhos por mês de fechamento. Correto. |
| Concentração de Receita | 🟢 | % do ARR nos top 5/10/20/50. Top 5 = 76% (concentração real e alta). Correto. |
| Deals Ganhos por Mês | 🟠 | Mostra 21 dos 24 ganhos — 3 têm `close_date` nulo ou fora da janela de 18 meses e somem sem aviso. |
| Valor do Pipeline por Etapa | 🟠 | Correto, mas R$ 122,9M de R$ 149,8M (**82%**) estão em "Diagnóstico" — pipeline dominado por pouquíssimos deals gigantes em etapa inicial. |
| Benchmark de Porte | 🟠 | Calcula sobre **todos os 327 deals** (inclui 166 de Reunião Agendada + ganhos); escopo diferente do resto do board. |
| Porte Médio dos Ganhos | 🟠 | n = 1 a 10 por mês → oscila de 3 a 782 vidas. Trend não confiável com amostra tão pequena. |
| Conversão Etapa-a-Etapa | 🔴 | Diz "conversão/funil" mas mostra a **contagem atual por etapa** (70→29→4→21→12→1→17→7). Não é funil (sobe e desce), mistura etapas de **Vendas e Bid**, e **omite Reunião Agendada (166)**, o topo real. |
| Entrada vs Saída por Mês | 🔴 | Mai/26 = **181 deals criados** num só mês (de 327 totais): carga/importação em massa, não inflow orgânico. A saída (≤10) fica invisível na escala. |
| ARR Bridge (Variação Mensal) | 🔴 | **Não é um ARR Bridge.** É a *diferença* do ARR ganho entre meses consecutivos. As barras negativas NÃO são churn — só "ganhei menos que no mês passado". |
| Cenários de Forecast | 🔴 | Ordenação incoerente: "Conservador (50%)" = R$ 74,9M é **maior** que "Ponderado (prob)" = R$ 44,4M. Aplicar 80%/50% liso sobre R$ 150M brutos não é cenário. Só o Ponderado tem significado. |

---

## `novo-dashboard.html` (bloco N01–N26)

| #   | Gráfico                               | Cor | Diagnóstico                                                                                                                                                                  |
| --- | ------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N01 | Pipeline Funnel Waterfall             | 🔴  | Usa a contagem atual de abertos [70,29,4,21,12,1] como funil. "Queda" esconde aumentos (Proposta→Consultoria sobe, mostra 0). Mesma base do C02.                             |
| N02 | Fluxo Líquido de Vidas                | 🟠  | Entradas de **1,2 milhão de vidas em Fev/26** (deals outlier tipo Bradesco). Saldo dominado por outliers; saídas somem na escala.                                            |
| N03 | Progressão por Etapa                  | 🔴  | "Reach cumulativo" da **foto atual** de abertos, não conversão histórica. Mistura etapas de Vendas + Bid numa linha só.                                                      |
| N04 | Pipeline Aberto (Valor e Volume)      | 🟢  | Deals + ARR por etapa, eixo duplo. Correto.                                                                                                                                  |
| N05 | Concentração de Risco Top 10 (tabela) | 🟢  | Top 10 abertos por score de risco. Correto.                                                                                                                                  |
| N06 | Maturidade por Coorte                 | 🟠  | Dias-até-fechar por trimestre de criação está certo, mas o eixo X sai **fora de ordem** (Q1/26, Q2/26, Q3/25, Q4/25 — `sort()` de string) e tem trimestres com n=1–2.        |
| N07 | Frescor de Engajamento                | 🟢  | Abertos por faixa de idade (`dias_no_pipe`); soma = 137. Correto.                                                                                                            |
| N08 | Taxa de Passagem por Etapa            | 🔴  | **Duplicata exata do N03** (números idênticos: 48,9/56,7/89,5/38,2/7,7%). Mesmo problema de foto-como-funil.                                                                 |
| N09 | Taxa de Ganho por Tamanho             | 🔴  | "Taxa de Ganho" = `ganhos ÷ (ganhos + abertos)`. **Ignora os 884 perdidos** e trata aberto como "não ganho". 1K+ aparece com 1,8% porque ainda não fechou, não porque perde. |
| N10 | Distribuição por Tamanho (Janela)     | 🟠  | Quase duplicata do donut C05 (mesmos buckets sem a fatia "Sem receita"); a "janela" de criação não está exposta como controle.                                               |
| N11 | Distribuição de Vidas (Janela)        | 🟠  | Abertos por faixa de vidas; redundante com o modo "Vidas" do donut C05.                                                                                                      |
| N12 | Análise de Fatores de Ganho / AE      | 🔴  | Mesmo `ganhos ÷ (ganhos + abertos)` por AE, rotulado como "win rate". Ignora perdidos.                                                                                       |
| N13 | Cobertura do Pipeline                 | 🟠  | `ponderado ÷ meta`. A meta padrão (R$ 5M) é placeholder — se não for a meta real, o múltiplo (~8,8×) não significa nada.                                                     |
| N14 | Valor do Pipeline (Projeção Mensal)   | 🟠  | ARR÷12 por `data_prevista_para_receita`. Só inclui deals com data prevista (soma ~R$ 1,8M vs R$ 150M de pipeline) → faz o pipeline parecer minúsculo.                        |
| N15 | Receita por Segmento (Donut)          | 🟢  | Correto, mas **duplicata do C08** (idêntico). Enterprise = 94% do ARR.                                                                                                       |
| N16 | Visibilidade de Receita               | 🟢  | Contagem de deals com data prevista por mês. Correto (eixo pula meses vazios).                                                                                               |
| N17 | Tempo em Etapa (Gargalo)              | 🟠  | Usa `dias_no_pipe` (idade **total**), não tempo na etapa atual. O tooltip admite o proxy, mas o título diz "em Etapa".                                                       |
| N18 | Velocidade de Qualificação            | 🔴  | Mostra a **idade atual** dos deals em Diagnóstico por mês de criação — tautológico (criado há mais tempo = idade maior). NÃO mede dias até chegar em Diagnóstico.            |
| N19 | Tempo até 1ª Reunião                  | 🟠  | Card de placeholder honesto ("dados não disponíveis"); não engana, mas fica vazio. Requer `a_reuniao_ocorreu_` na API.                                                       |
| N20 | Impacto de Reatribuição               | 🟠  | Proxy de performance por AE, com disclaimer ("histórico de reatribuição não disponível").                                                                                    |
| N21 | Resultados Financeiros (tabela)       | 🟢  | Espelha corretamente os KPIs validados (won MTD/YTD, pipeline bruto/ponderado, cobertura).                                                                                   |
| N22 | Deals Ganhos / Receita Mensal         | 🟢  | ARR÷12 de ganhos por mês de fechamento. Correto.                                                                                                                             |
| N23 | Estimativa de Receita por Etapa       | 🟢  | Correto, mas **duplicata do C07** (idêntico: 122,9M / 3,57M / 10,3M / 3,92M / 9,13M).                                                                                        |
| N24 | Receita Ponderada por Etapa           | 🟢  | ARR × probabilidade por etapa, consistente com o Forecast Ponderado. Correto.                                                                                                |
| N25 | Timeline de Recebíveis                | 🟠  | Mesma conta do N14 (ARR÷12 por data prevista) → near-duplicata + mesma cobertura parcial.                                                                                    |
| N26 | Triagem de Risco Top 20 (tabela)      | 🟢  | Top 20 por score composto. Correto (sobrepõe o N05 Top 10).                                                                                                                  |

**Chaves i18n mortas** (não renderizam, mantidas no código sem efeito): `t_funnel`, `t_sizedist`, `t_vidasdist` — restos do funil vertical e dos gráficos de tamanho/vidas substituídos pelo donut C05.

---

## `bdr.html` | painel BDR (adendo 2026-07-10)

> Seção nova **Cadência de Leads | Contatos do Time** (R16–R22), baseada em CONTATOS (`/api/bdr-leads`: owner do contato = BDR do time + histórico completo de `hs_lead_status`). Validação estrutural com dados de produção no local (funil conferido 1:1 contra contagens independentes do search da API).

| # | Gráfico | Cor | Diagnóstico |
|---|---|---|---|
| R16 | Funil de Lead Status | 🟢 | Snapshot no fim da janela reconstruído do histórico; conferido 1:1 com o search da API (NEW 1.879 · ATTEMPTED 155 · CONNECTED 168 · OPEN_DEAL 17 · UNQUALIFIED 107 · BAD_TIMING 3 em 2026-07-10). |
| R17 | Taxa de Contato por Coorte Semanal | 🟢 | Coorte = primeiro evento de status na semana; taxas = atingiu ATTEMPTED+/CONNECTED+ até hoje. Por coorte de propósito (por toque infla). Semanas recentes têm taxa em maturação — ler com o tempo. |
| R18 | Taxa de Contato por Dimensão | 🟢 | Mesma coorte do R17 agregada por BDR/Porte/Origem. Porte usa colaboradores do contato com fallback na empresa associada (74% de cobertura); Origem tem só ~17% de preenchimento — bucket "(sem origem)" domina e está explícito. |
| R19 | Desqualificações por Dia | 🟠 | Eventos UNQUALIFIED/BAD_TIMING por timestamp do histórico — correto, MAS o portal não tem campo de motivo de desqualificação de contato: o "por quê" granular não existe na fonte. Recomendação registrada: criar propriedade (ex.: `motivo_desqualificacao`) e preencher na cadência. |
| R20 | Contatos Trabalhados por Dia | 🟠 | Contato distinto com mudança de status no dia. Proxy de ritmo: toques que NÃO mudam status (2ª ligação no mesmo status) não contam — subconta atividade repetida; a ficha avisa. |
| R21 | Penetração por Empresa | 🟢 | Contatos da coorte ÷ empresas distintas, por BDR; só contatos com empresa associada (95%). |
| R22 | Trabalhados na Semana | 🟢 | Últimos 7 dias por último evento do histórico, independe do filtro; cap de 60 linhas na tabela com "Explorar com filtros" para o resto. |

Também em 2026-07-10: **R13/R14** ganharam dimensão de empilhamento Por BDR | Por Origem (`origem__originacao_`) | Por Porte — cálculo por deal inalterado, só o agrupamento; drilldown pré-seleciona a dimensão ativa.

## Causas-raiz (consertam vários de uma vez)

1. **Foto ≠ funil.** N01, N03, N08 (e Conversão do board) tratam a contagem atual por etapa como conversão. Conversão real só no **C09** (histórico, via `/api/funnel-stages`). Os outros deveriam se chamar "distribuição atual".
2. **`NOVO_STAGE_ORDER` mistura Vendas + Bid** numa sequência linear — qualquer "progressão" entre etapas de pipelines diferentes é inválida.
3. **Win rate sem os perdidos** (N09, N12) — há 884 perdidos disponíveis na API; dá para calcular `ganhos ÷ (ganhos + perdidos)` de verdade.
4. **Outliers de vidas + carga de Reunião Agendada** distorcem tudo que agrega por `createdate` ou `vidas` (N02; board Entrada vs Saída).
5. **~6 duplicatas** de gráficos já validados (N08=N03, N15=C08, N23=C07, N25≈N14, N10≈C05, N26⊃N05) inflam a página e multiplicam o risco de divergência aparente.

## Como reproduzir esta auditoria

```powershell
node scripts/_capture-charts.js public/novo-board.html
node scripts/_capture-charts.js public/novo-dashboard.html includeLost
```
(Servidor local na 3002 precisa estar no ar.)

## Adendo | BDR Workload (2026-07-13)

- **`bdr-workload.html` (subpágina nova) → 🟡 em auditoria.** KPIs e tabelas reconciliam por construção (todo KPI clicável abre a lista nominal que ele conta). Validação inicial 13/07 com dados de produção: empresas/contatos/transições do dia batem com contagem independente. Pendências declaradas na própria página: motivo de desqualificação (propriedade inexistente no portal), fonte não se aplica a movimentações, primeiro retorno usa proxy CONNECTED.
- **Patch GCP source (2026-07-20) → ainda 🟡 até smoke pós-deploy.** SQL principal passa a vir de deals reais no BigQuery silver (`sql_deals`), e atividades históricas do gold (`bdr_daily_ops`); hoje continua HubSpot live para evitar snapshot parcial das 08:00 BRT. `OPEN_DEAL` foi rebaixado para proxy de status. Zero registrado em dia útil não é mais tratado como provável erro de API quando histórico está disponível.
- **Evidência pós-deploy (2026-07-20):** build Vercel PASS; assets atualizados nos dois aliases; API protegida retorna 401 sem sessão. Smokes locais autenticados contra as mesmas fontes reconciliaram 12 SQLs em 7D e mais de 1.200 atividades hoje. Mantém 🟡 somente porque o smoke visual autenticado de produção depende da sessão do usuário.
- **Reabertura por filtro BDR (2026-07-20):** Thauan zerava porque o ETL GCP não continha seu owner ID. Roster corrigido para 13 BDRs, backfill refeito e teste nominal adicionado. Ritmo histórico agora é MECE estrito (calls + outgoing emails + WhatsApp communications + LinkedIn communications + meetings), sem tarefas/notas. Correlação fonte→resultado removida por denominador heterogêneo. Quality gate permanece 🟡 até confirmação visual pós-deploy do filtro Thauan.
- **Workload v2 (2026-07-20) → 🟠 com limitações explícitas.** Cinco abas substituem
  o scroll único; metas saem da experiência; hoje usa live server-side e histórico
  usa Gold. Gestão ordena por delta do período anterior, canais, leads e SQL. Ligações
  separam conversa/discagem/desfecho/duração. Penetração é experimental porque o
  denominador é o snapshot observado, não toda a carteira elegível. Reatividade,
  CRM, segmento e persona permanecem bloqueados onde falta semantic layer. A×B com
  hoje mostra aviso de comparação parcial não equivalente. Build, smoke local real,
  reviewer e skeptic passaram; produção validada publicamente com HTML 200 e APIs 401.

## Adendo | Renomeação: código único por card em CRO/Board/AE (2026-07-16)

> Decisão do dono: código de card repetido entre painéis não existe mais. A convenção
> nova: **cada painel tem códigos próprios** (CRO = C/P/S/N, Board = B, AE = A) e, onde
> o gráfico é **genuinamente compartilhado** (mesmo builder do `shared-charts.js` — não
> pode driftar), a tag carrega a origem: ex. `B07 | =C04`. Código **sem** `=` é fórmula
> própria do painel: paridade com o CRO não é garantida por construção. Os códigos do
> CRO (vocabulário estabelecido: C07, N06B, N05...) não mudaram.

**CRO (`dashboard.html`) — fim dos `N00` repetidos.** Ex-N00 ganharam N30–N41;
**N13–N29 ficam reservados** (não usar) para nunca colidir com a numeração da tabela
histórica N01–N26 de 12/06, que segue outra ordem. De-para (com a linha correspondente
da tabela histórica, quando existe):

| Key | Código antes | Código agora | Nome atual | Linha da tabela de 12/06 |
|---|---|---|---|---|
| waterfall | N00 | **N30** | Fluxo Semanal \| Criados · Ganhos · Perdidos | — (card reformulado pós-12/06; segue na fila 🟡) |
| netflow | N00 | **N31** | Fluxo Líquido de Vidas | N02 🟠 |
| stageprog | N00 | **N32** | Progressão por Etapa | N03 🔴 |
| passthru | N00 | **N33** | Taxa de Passagem por Etapa | N08 🔴 |
| sizewindow | N00 | **N34** | Distribuição por Tamanho \| Janela | N10 🟠 |
| vidaswindow | N00 | **N35** | Distribuição de Vidas \| Janela | N11 🟠 |
| segdoughnut | N00 | **N36** | Receita por Segmento \| Donut | N15 🟢 (duplicata do C08) |
| visibility | N00 | **N37** | Visibilidade de Receita | N16 🟢 |
| timetomeeting | N00 | **N38** | Reunião Ocorreu \| Cobertura do Campo | ≈ N19 🟠 (reformulado) |
| financial | N00 | **N39** | Resultados Financeiros | N21 🟢 |
| receivables | N00 | **N40** | Timeline de Recebíveis | N25 🟠 |
| risktriage | N00 | **N41** | Triagem de Risco Top 20 | N26 🟢 |

Também sincronizados os títulos do drawer de ajuda que ainda embutiam a numeração de
12/06 divergindo do mapa: piperev12 `(N14)`→`(N06)`, wonmonthly `(N22)`→`(N10)`,
weightedrevstage `(N24)`→`(N12)` — e os ex-N00 acima ganharam o código novo no título.
Antes desta correção a UI exibia `(N01)`/`(N02)`/`(N03)`/`(N08)` DUPLICADOS em cards
diferentes (waterfall×cohort, netflow×freshness, stageprog×winratesize,
passthru×speedqualify).

**⚠ Constatação da validação no DOM real (Edge headless, 16/07):** NENHUM dos 12
ex-N00 está renderizado hoje no `/novo`. Vários constam como "removidos a pedido" nos
comentários do render (N06, N10/N11, N15/N16 na numeração antiga); os demais
(waterfall, financial, receivables, risktriage...) têm builder/i18n/ajuda órfãos no
código — ex.: `buildNovoWeeklyFlow` existe mas nunca é chamado. Os códigos N30–N41
valem como reserva se os cards forem reativados; a limpeza do código morto é decisão
separada (não feita aqui). Cards do CRO efetivamente renderizados e verificados com
tag única no DOM: P01–P09, S01–S05, C01–C04, C06–C08, N01–N09, N06B (+P00/S06/C00
condicionais).

**Board (`board.html`):**

| Key | Antes | Agora | Observação |
|---|---|---|---|
| kpi-won-arr | P07 | **B01** | Fórmula própria (era o mesmo código do P07 do CRO); reusa o modal do P07 |
| kpi-forecast | P03 | **B04 \| =P03** | Número vem de `sharedWeightedPipelineARR` (shared-charts.js) — paridade por construção |
| pipe-stage | C04 | **B07 \| =C04** | `buildSharedStageVal`; B07 era o código histórico citado no cabeçalho do shared-charts.js |
| deal-bench | C08 | **B09 \| =C08** | `buildSharedSizeDonut`; B09 idem (ex-C03 do board) |

B02, B03, B05, B11, B12, B15, B16 inalterados.

**AE (`ae.html`):**

| Key | Antes | Agora | Observação |
|---|---|---|---|
| kpi-active-deals | P01 | **A22** | Fórmula própria |
| kpi-open-lives | P02 | **A23** | Fórmula própria |
| kpi-won-lives | P08 | **A24** | Fórmula própria |
| kpi-won-arr | P07 | **A25** | Fórmula própria |
| kpi-stale | S05 | **A26** | Fórmula própria |
| kpi-meetings | P04 | **A27** | Fórmula própria |
| vidas-ae | C01 | **A28 \| =C01** | `buildSharedVidasDealsAE` (shared-charts.js) — paridade por construção |

A07–A21 inalterados. **A01–A06 não foram reutilizados** (códigos históricos do painel;
A05/A06 foram mesclados no card compartilhado C01).

Fora do escopo: `bdr.html` (códigos R — território do Samuel, coordenar antes) e os
painéis Forecast (não usam este sistema de tags). Vereditos de validação (emojis) não
foram alterados — renomeação pura.

## Adendo | AE Performance: leva 2 + achado A07 × forecast (2026-07-16)

> Segunda leva no `/novo-ae`. A07, A12, A14, A16 revistos; A13 diagnosticado. Emojis 🟡
> removidos de A12/A14/A16 (cálculo confirmado); **A07 permanece 🟡** por não bater.

- **A07 (Receita do Forecast por AE) → 🟡 REMOVIDO (decisão do dono: régua flat).** O achado
  original: A07/N06B probabilizavam com o **funil C07 por pipeline** enquanto os painéis de
  forecast usam a **régua flat** — Real reconciliava (≈95,8M), Probabilizada não (5,5M funil ×
  ~20,8M). **Decisão do dono (16/07): usar a régua flat.** `_novoFcStageProbForwd()` do
  `ae.html` (A07) e do `dashboard.html` (N06B + N05) foi religado à régua flat (sem funil);
  o funil C07 segue só nos gráficos de conversão. A07 Probabilizada FULL passou a **8,66M**
  (harness ao vivo) e reconcilia por construção com o Forecast Overall (flat + BID 0,5% +
  mesmo motor/conjunto). **Residual conhecido:** a tela `/forecast` dá ao BID a régua cheia
  (28,5%/49,3%) em vez de 0,5% — ~11M só nela, a alinhar pela sessão do forecast (`FC_BID_PROB`).
- **A13 (Deal Age Distribution) | "184 e não 173" RESOLVIDO:** era o único card de idade que
  não filtrava pelo time — os deals extras são os mesmos owners fora do time do A11 (Peterson,
  Aurilia, Yokyko, Anderson, Pacheco, sem-owner). Religado à MESMA base do A12 (`_aeAgingBase`:
  time + sem Implantação + com data de RA) → A13 == A12 (172 ao vivo).
- **A16:** base cortada em set/2025 (`AE_MTG_FLOOR`); 🟡 removido. **A12:** 🟡 removido.
  **A14:** coluna Completude removida; 🟡 removido.

## Adendo | AE Performance: leva de correções do dono (2026-07-16)

> Cinco mudanças pedidas pelo dono no `/novo-ae`, todas front-only (o payload já tinha os
> campos). Nenhum veredito foi promovido — os cards seguem 🟡 na fila abaixo.

- **A11 (Distribuição de Etapas por AE) | mistério "180 de 189" RESOLVIDO:** a diferença
  para o KPI Deals Ativos (A22) NÃO é o toggle RA/Standby (vale igualmente para os dois
  números) — são os deals ativos de owners FORA do time de executivos (medição de 16/07:
  9 deals — Peterson Venancio 4, Aurilia 1, Yokyko 1, Anderson 1, Pacheco 1, sem owner 1).
  O subtítulo do card agora explicita: "X de Y ativos | fora do time: N".
- **A12 (Idade Média por AE) | Implantação SEMPRE fora:** base própria (`_aeAgingBase`) —
  antes, deals em Implantação entravam na média quando o toggle "Implantação = Ganho"
  estava desligado. Contagem do subtítulo corrigida para a base real do gráfico (antes
  mostrava todos os abertos, incluindo owners fora do time e deals sem data de RA).
- **A16+A18 FUNDIDOS | base nova pela DATA DA REUNIÃO:** card único "Reuniões com o
  Executivo | Occurrence Rate" com toggle Mensal | Executivo. A base conta pela data da
  reunião com o executivo (`data_do_reagendamento_com_o_executivo` tem precedência sobre
  `data_da_reuniao_com_executivo`) e SÓ reuniões já vencidas (≤ hoje) — antes contava pela
  entrada na etapa Reunião Agendada e misturava reuniões futuras como falso "sem
  preenchimento". Medição de 16/07: 965 reuniões vencidas = 548 Sim | 321 Não | 96 sem
  preenchimento (Occurrence Rate 63%). Código A18 aposentado (tag do card: A16+A18).
  Ressalva herdada: valores mistos "Nao;Sim" (checkbox múltiplo) contam como Sim —
  pendência de higiene do CRM já registrada no STATUS_LOG (15/07).
- **A14 | radar aposentado → Scorecard multidimensional:** o radar normalizava tudo em
  0-100 e misturava contagens com porcentagens numa escala só. Virou tabela com cada
  métrica na SUA unidade (Deals abertos, Vidas abertas, ARR aberto, Win Rate do período,
  Completude), cor comparando os AEs POR COLUNA, linha "Time" com somas/taxas agregadas
  (não média das médias) e clique no nome do AE abrindo os deals.

Validação (16/07): DOM real em Edge headless (contagens, toggle ativo, tabela do
scorecard renderizada), sintaxe inline OK, `npm run check` PASS. Validação contra o
HubSpot segue pendente — fila 🟡 abaixo atualizada com os nomes novos.

## Adendo | TCV unificado com o Forecast em C04/C08 (CRO) e B07/B09 (Board) (2026-07-16)

> Pedido do dono: os TCVs por etapa do C04/B07 divergiam da coluna TCV dos painéis
> Forecast. Causa raiz (medida com dados reais): o `_novoDealTcv` usava **12 meses
> fixos** + **proxy de Diagnóstico** (vidas × R$/vida × 12 — 44 deals sem régua
> somavam 72,5MM contra 9,5MM da régua real) e **não aplicava a dedup Fee×Corretagem**.
> Unificado: TCV = `calcTCV` (régua × período do contrato, 12/24/36; sem período → 12)
> com dedup do Forecast Overall (`OverallCore.revExcluded`; gêmeo excluído = 0).
> **Paridade provada com dados de produção** (harness interceptando `_novoMkChart`):
> C04 = B07 = coluna TCV do Forecast em todas as etapas — Diagnóstico 9,49MM ·
> Cotação 1,95MM · Proposta 57,13MM · Consultoria 5,61MM (dedup ativa) ·
> Negociação 7,93MM.

- **B09 | 🟡 removido do título** (decisão do dono, com a unificação acima como lastro).
  C04/C08 do CRO seguem sem emoji (família validada de 12/06); a semântica de todos os
  quatro mudou CONSCIENTEMENTE — quem comparar com números antigos verá o Diagnóstico
  cair de ~72MM para ~9,5MM (o proxy foi aposentado, não é regressão).
- **Coluna TCV (R$)** adicionada à tabela rica dos modais de CRO e Board (drills das
  fatias/etapas): valor por deal = a métrica do gráfico (gêmeo dedup mostra 0), com
  total no tfoot — a lista soma exatamente o que a fatia/barra mostra.
- **Forecast (`/forecast` + painéis de etapa): coluna 🟡 ARR Pond. (R$)** — ARR
  estimado (fallback 1ª fatura × 12) × P. Ajust., a mesma leitura de ARR ponderado de
  B15/B16/P03/B04, para auditoria de paridade entre painéis. Nasce 🟡 (régua desta
  auditoria): falta validar contra amostra manual e contra o Board no mesmo instante;
  diferença residual esperada = fonte da probabilidade (flat × C07), documentada na
  regra `arr_ponderado_forecast` do catálogo.
- **B15**: nome do AE agora clicável (modal com chips por etapa + tabela rica) — só
  interação, zero mudança de cálculo; veredito do card inalterado.

## Adendo | Colunas configuráveis no Forecast + B12 removido + B15/B16 sem 🟡 (2026-07-16)

> Leva do dono. Núcleo: **mostrar/ocultar colunas** nas Configurações de TODOS os painéis
> Forecast, com **catálogo idêntico** entre eles.

- **Forecast (`/forecast` + todos os painéis de etapa `forecast-stage.html`): seletor de
  colunas.** Nova seção "Colunas visíveis" no modal de Configurações (fonte única
  `forecast-columns.js`): checkbox por coluna, visibilidade POR PAINEL (localStorage
  `fc_cols_hidden_v1::<painel>`), default tudo visível. Os dois arquivos foram
  **reconciliados para o MESMO catálogo de 29 colunas alternáveis** (provado por harness:
  keys idênticas e na mesma ordem) — `createdate`, `periodo_contrato` e
  `vencimento_primeira_fatura` viraram colunas base em ambos (antes eram splice condicional
  só no stage / só no forecast). A âncora Deal e as colunas de comparação (comp_*) não são
  alternáveis. O modal de detalhe do deal SEMPRE mostra todos os campos (esconder é só da
  tabela). `/forecast-overall` não tem lista → a seção fica oculta. **Hide provado
  end-to-end** (harness ao vivo no painel Negociação: 30 → 28 th ao ocultar tcv+vidas,
  resto intacto, 0 erro). Não altera veredito/emoji de nenhuma coluna.
- **B12 (ARR Bridge | Variação Mensal) REMOVIDO** a pedido do dono — resolve o veredito
  **🔴** desta auditoria (não era bridge; barra negativa ≠ churn). Card, builder, i18n e
  entradas de mapa removidos; comentário-âncora deixado no código.
- **B15 e B16: 🟡 removido do título** (decisão do dono). B15 (Top 5 AEs) ganhou também
  **chips de filtro por EXECUTIVO no topo do modal** (todos os AEs do pipeline ativo,
  ranqueados; troca o AE sem fechar) + o sub-filtro por etapa + tabela rica já existentes
  — provado no harness (12 chips de executivo, 8 de etapa, coluna TCV na tabela).

## Adendo | Sincronização de títulos 🟡 com os vereditos desta auditoria (2026-07-14)

> Revisão dos títulos com 🟡: vários gráficos do CRO/Board seguiam com 🟡 no título
> apesar de JÁ terem veredito nesta auditoria (título mentindo por dessincronização).
> Títulos sincronizados aos vereditos existentes — nada foi "promovido" sem lastro.

**Sincronizados no `dashboard.html` (14 chaves i18n, PT+EN), por NOME da tabela N01–N26:**
🔴 Progressão por Etapa (N03) · 🔴 Taxa de Passagem (N08) · 🟠 Fluxo Líquido de Vidas (N02) ·
🟠 Distribuição por Tamanho (N10) · 🟠 Distribuição de Vidas (N11) · 🟠 Valor do Pipeline
Projeção Mensal (N14) · 🟠 Reunião Ocorreu/Cobertura (N19) · 🟠 Timeline de Recebíveis (N25) ·
🟢 Receita por Segmento (N15, duplicata do C08) · 🟢 Visibilidade de Receita (N16) ·
🟢 Resultados Financeiros (N21) · 🟢 Deals Ganhos Mensal (N22) · 🟢 Receita Ponderada por
Etapa (N24) · 🟢 Triagem de Risco Top 20 (N26). No `board.html`: 🔴 ARR Bridge (veredito
desta auditoria; tooltip agora carrega o aviso "não é churn").

**Fila honesta do que CONTINUA 🟡 (nunca analisado — validação real pendente):**

| Onde | O quê | O que a validação exige |
|---|---|---|
| `/novo-ae` | Distribuição de Etapas por AE (A11) · KPI Receita Ganha/Ano (A25) | Painel AE nunca entrou nesta auditoria; validar cada card contra contagens independentes do HubSpot. **A07, A12, A14, A16 tiveram o 🟡 removido em 16/07** (A07: régua flat por decisão do dono, reconcilia com o Forecast Overall; A12/A14/A16: cálculo aceito). |
| `/novo-board` | TCV do Pipe por Bucket (C08) · Top 5 AEs Weighted · Top 10 BoD Watchlist | Conferir TCV pela régua e ponderação global contra amostra manual |
| `/forecast-delta` | Painel inteiro (pill 🟡) | Invariante Σ Δ = Total B − A PASSA para todos os pares de fotos (reteste 2026-07-14) e drawer gerado do catálogo ✓, MAS falta a prova externa: com a PRÓXIMA foto de sexta, comparar B=foto do dia com o Forecast Overall ao vivo no MESMO momento — se bater, sobe para 🟠/🟢. Não forçar foto fora do cron só para isso (escreve na planilha de produção). |
| `/novo-bdr/workload` | Página (🟡 em auditoria) | Pendências declaradas acima (adendo 2026-07-13) |
| `/novo` | Fluxo Semanal · KPIs Pipeline Ponderado/Completude/Prêmio Mensal/Momentum · S01–S04 | Sem veredito na tabela N (cards novos pós-12/06); validar contra HubSpot |

**Método usado nesta revisão:** títulos extraídos do DOM real (Edge headless) — não de grep
de código, porque o dashboard tem chaves i18n mortas que nunca renderizam (t_funnel,
t_sizedist, t_vidasdist, listadas acima) e essas ficaram intocadas.
