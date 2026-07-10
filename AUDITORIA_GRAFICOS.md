# Auditoria crítica dos gráficos 🟡 | 2026-06-12

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
