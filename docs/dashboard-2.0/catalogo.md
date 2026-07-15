# Catálogo | camada semântica (visualização gerada)

> **GERADO por `scripts/semantic-view.js` — NÃO EDITAR AQUI.** A fonte são os
> 3 arquivos em `semantic/`. Edite lá, rode `npm run check` e regere esta visão.
> Gerado a partir das versões: referencia v1 | dados v1 | regras v1.

## Referência (`semantic/referencia.json`)

Portal HubSpot: `44715285`

### Etapas por pipeline

**Vendas** (`782758156`)

| Ordem | Etapa | ID | Ativa (default) | Final | Notas |
|---|---|---|---|---|---|
| 1 | Reunião Agendada | `1144746905` | sim | não |  |
| 2 | Diagnóstico | `1144746906` | sim | não |  |
| 3 | Cotação | `1144746908` | sim | não |  |
| 4 | Consultoria | `1144746909` | sim | não |  |
| 5 | Negociação | `1144746910` | sim | não |  |
| 6 | Stand by (aliases: Standby) | `1317543716` | não | não | ⚰ ETAPA EXTINTA DO PORTAL (informada pelo dono e verificada via API em 2026-07-15: pipeline Vendas tem 8 etapas, sem Stand by; zero deals vivos nela). Mantida no catálogo porque as fotos históricas (mai–jul/26) e o histórico de dealstage ainda referenciam o id. O código segue consultando o id inofensivamente (filtro IN sem matches) até limpeza consciente. Histórico: nome divergia entre consumidores ('Stand by' × 'Standby'), e a linha Stand by do C06 Vendas contava sempre 0 (mismatch de buckets) — ambos agora irrelevantes na prática. |
| 7 | Implantação | `1288611084` | sim | não |  |
| 8 | Ganho | `1144844314` | sim | sim |  |
| 9 | Perdido | `1144746911` | não | sim | Só entra nos payloads com ?includeLost=true (CRO Dashboard e conversões). |

**Bid** (`894130090`)

| Ordem | Etapa | ID | Ativa (default) | Final | Notas |
|---|---|---|---|---|---|
| 1 | Reunião Pré-RFP (aliases: Reunião) | `1349620551` | sim | não | Premissas chamam de 'Reunião'; o código (forecast-table.js) mapeia 'Reunião Pré-RFP'. |
| 2 | Convite Enviado | `1349620552` | não | não | Etapa existe no portal mas NÃO está no STAGE_MAP nem no ACTIVE_STAGE_IDS do 1.0 — deals aqui não aparecem em nenhum painel. Decidir inclusão na Fase 2. |
| 3 | Documentação | `1349620553` | não | não | Idem Convite Enviado: fora do STAGE_MAP e do filtro de ativos do 1.0. |
| 4 | RFP Enviada | `1349620554` | não | não | Idem Convite Enviado: fora do STAGE_MAP e do filtro de ativos do 1.0. |
| 5 | Cotação | `1363560722` | sim | não |  |
| 6 | Proposta Enviada | `1349620555` | sim | não |  |
| 7 | Consultoria | `1349620556` | sim | não |  |
| 8 | Negociação | `1353387279` | sim | não |  |
| 9 | Implantação | `1353457025` | sim | não |  |
| 10 | Ganho | `1353387280` | sim | sim |  |
| 11 | Standby | `1373066362` | sim | não |  |
| 12 | Perdido | `1349620557` | não | sim | Sem stage id no LOST_STAGE_IDS do 1.0; perdidos do Bid são capturados via hs_is_closed_lost=true (segundo filterGroup do forecast-table.js). |

### Réguas de probabilidade

**forecast_flat** | RÉGUA ÚNICA (D4/D4b, decisão do dono 2026-07-15) \| premissa validada do Forecast E fallback do C07 nos painéis — valores confirmados pelo dono na revisão | tipo: forcada

| Etapa | Probabilidade |
|---|---|
| Reunião Agendada | 6,0% |
| Diagnóstico | 6,0% |
| Cotação | 18,6% |
| Proposta Enviada | 28,5% |
| Consultoria | 28,5% |
| Negociação | 49,3% |
| Implantação | 80,0% |
| Ganho | 100,0% |
| Standby | 12,0% |
| Stand by | 12,0% |

Usada em: public/forecast.html (STAGE_PROB_DEFAULT ← SEMANTIC_REF) · public/forecast-stage.html (STAGE_PROB_DEFAULT ← SEMANTIC_REF) · public/dashboard.html (NOVO_FC_STAGE_PROB_DEFAULT ← SEMANTIC_REF; fallback inline espelhado) · public/ae.html (NOVO_FC_STAGE_PROB_DEFAULT e NOVO_STAGE_PROB_DEFAULT ← SEMANTIC_REF) · public/board.html (NOVO_STAGE_PROB_DEFAULT ← SEMANTIC_REF) · public/prob-engine.js (DEFAULT ← SEMANTIC_REF, fallback espelhado) · public/settings-modal.js (SP_DEFAULT ← SEMANTIC_REF, fallback espelhado — bdr/48h não carregam semantic-ref)

**painel_default_APOSENTADA** (nota histórica) | Removida em 2026-07-15 por decisão do dono (D4/D4b): 'as duas probabilidades fixas e o fallback têm que ser idênticas'. Todos os antigos consumidores (prob-engine DEFAULT, board/ae NOVO_STAGE_PROB_DEFAULT, fallback do dashboard, settings-modal SP_DEFAULT) passam a usar a régua única forecast_flat — incluindo Implantação=0.8 (D4b: 'para implantação pode usar o valor que está em Forecast Flat'), que SUPERSEDE a decisão de 14/07 (Implantação=1.0 nos painéis). Valores antigos para história: Cotação 0.33, Proposta 0.285, Consultoria 0.611, Negociação 0.42, Implantação 0.581→1.0. Os STAGE_PROB_LEGACY de forecast/forecast-stage mantêm valores antigos de propósito (detectores de override legado, não régua).

**calculada_funil** | Probabilidade calculada em tempo real pelo funil (C07) \| ganhos ÷ entraram na etapa, por pipeline | tipo: calculada

Calculada pela regra `prob_etapa_calculada` (amostra mínima 20).

### Valor por vida (VPV) | Porte

| Faixa de vidas | R$/vida/mês |
|---|---|
| até 200 | 36 |
| até 4999 | 24 |
| acima | 12 |

Corte PME: 200 vidas. Fuso canônico: America/Sao_Paulo.

### Times | Executivos (AEs) e BDRs

| AE | owner_id |
|---|---|
| André Pontes | `83684286` |
| Guilherme Gabiatti | `83026278` |
| Rafael Leite | `83126793` |
| Fausto Haderspeck | `83375300` |
| Juliana Dalberto | `83126792` |
| Ágatta Marinho | `720522117` |

| BDR | owner_id |
|---|---|
| Anderson Souza | `85310335` |
| Cintia Rodrigues | `87213208` |
| Gabriele Almeida | `83025540` |
| Priscilla Feliciello | `83375302` |
| Leticia Romão | `89781254` |
| Allan Valença | `90688054` |
| Bruna Reis | `91925085` |
| Emanuelle Braga | `90688051` |
| Felipe Andrade | `90540673` |
| Giovana Rocha | `90141426` |
| Marcelli Netto | `90540672` |
| Thauan Pontes | `90540671` |
| Yokyko Muramoto | `90540670` |

## Dados (`semantic/dados.json`)

| Dado | Label PT | Origem | Objeto | Propriedade HubSpot | Unidade | Dono | Notas |
|---|---|---|---|---|---|---|---|
| `dealname` | Nome do deal | fonte | deal | `dealname` | texto | revops | Payload remove sufixos ' - Novo(a) Deal' / ' - New Deal'. |
| `pipeline` | Pipeline | fonte | deal | `pipeline` | id | revops |  |
| `dealstage` | Etapa | fonte | deal | `dealstage` | id | revops |  |
| `hs_object_id` | ID do deal | fonte | deal | `hs_object_id` | id | revops |  |
| `hubspot_owner_id` | Executivo (AE) | fonte | deal | `hubspot_owner_id` | id | revops | Resolvido para nome via /crm/v3/owners (inclui arquivados). |
| `sdr` | BDR | fonte | deal | `sdr` | id | revops |  |
| `origem_originacao` | Origem \| Originação | fonte | deal | `origem__originacao_` | enum | revops | Preenchimento ~17% (registrado na auditoria R18) — bucket '(sem origem)' domina qualquer corte por origem. |
| `produto` | Produto | fonte | deal | `produto` | enum | revops |  |
| `colaboradores` | Colaboradores | fonte | deal | `quantidade_de_colaboradores` | pessoas | revops | Fallback de vidas nas projeções (vidas \|\| colaboradores). |
| `vidas` | Vidas | fonte | deal | `vidas` | vidas | revops |  |
| `fatura_atual` | Fatura atual do plano | fonte | deal | `valor_da_fatura_do_plano_de_saude_atual` | BRL/mês | revops |  |
| `primeira_fatura` | 1ª Fatura (pf) | fonte | deal | `primeira_fatura` | BRL/mês | revops | Base de TODA a régua de receita. Fee por vida: pf JÁ é a receita Axenya. Corretagem: pf é o PRÊMIO pago à operadora (receita = % sobre pf). |
| `arr_estimado` | ARR Estimado | fonte | deal | `arr_estimado` | BRL | revops | Payload aplica fallback pf×12 quando vazio (regra arr_estimado_fallback). |
| `modelo_remuneracao` | Modelo de Remuneração | fonte | deal | `modelo_de_remuneracao` | enum | revops | Valores: 'Fee por vida' \| 'Corretagem'. Sem modelo → deal fora da régua (contador de completude). |
| `periodo_contrato` | Período do contrato | fonte | deal | `periodo_do_contrato___vg` | enum | revops | MIGRADO em 2026-07-15 (decisão do dono): fonte primária = periodo_do_contrato___vg ('Período do Contrato'); fallback = campo legado 'Contrato atual é de 12, 24 ou 36 meses?'. Motivo do fallback: preenchimento no pente-fino era 4 deals (novo) × 43 (legado) — migração seca perderia dado; quando o novo campo for adotado no CRM, o fallback aposenta. Valores: '12 Meses'/'24 Meses'/'36 meses'/'Não Possui'. Sem período → 12 (anualiza), regra contrato_meses. |
| `possui_agenciamento` | Possui Agenciamento | fonte | deal | `possui_agenciamento` | booleano | revops | Só adiciona o pico pontual de entrada; não muda a cauda recorrente. |
| `possui_vitalicio` | Possui Vitalício | fonte | deal | `possui_vitalicio` | booleano | revops |  |
| `is_poc` | É POC? | fonte | deal | `e_poc` | booleano | revops | POC não gera receita: zera Real e Probabilizada em todos os painéis (regra receita_mensal_deal). |
| `probabilidade_ae` | Probabilidade (AE) | fonte | deal | `probabilidade_de_fechamento_` | fracao_0_1 | vendas | Digitada pelo AE no HubSpot (dado de fonte para o dash, manual para o AE). Normalizada: >1 divide por 100. |
| `probabilidade_etapa_hs` | Probabilidade da etapa (HubSpot) | fonte | deal | `hs_deal_stage_probability` | fracao_0_1 | revops |  |
| `quarter_fechamento` | Quarter de fechamento | fonte | deal | `qual_quarter_de_fechamento` | enum | vendas | Fallback: derivado de data_prevista_para_receita quando vazio/inválido (regra quarter_fallback). |
| `data_prevista_para_receita` | Data prevista para receita | fonte | deal | `data_prevista_para_receita` | data | vendas |  |
| `is_closed_won` | Fechado ganho | fonte | deal | `hs_is_closed_won` | booleano | revops |  |
| `is_closed_lost` | Fechado perdido | fonte | deal | `hs_is_closed_lost` | booleano | revops | É o que captura os perdidos do Bid (sem stage id de Perdido mapeado no 1.0). |
| `createdate` | Data de criação | fonte | deal | `createdate` | data | revops | Distorcida por importações em massa (mai/26 = 181 deals); painéis BDR preferem data_reuniao_agendada. |
| `closedate` | Data de fechamento | fonte | deal | `closedate` | data | revops |  |
| `ultima_atividade` | Última atividade | fonte | deal | `notes_last_updated` | data_hora | revops | Base de dias_sem_atividade. |
| `vigencia` | Vigência | fonte | deal | `vigencia` | data | vendas | Início de receita de Corretagem em Cotação/Consultoria/Negociação = vigência+2m quando futura. |
| `vencimento_primeira_fatura` | Vencimento da 1ª fatura | fonte | deal | `vencimento_da_1o_fatura` | data | financeiro | Gate do faturamento manual: Ganho/Implantação com vencimento vencido usa valor real digitado. |
| `premio_mensal` | Prêmio mensal | fonte | deal | `premio_mensal` | BRL/mês | revops |  |
| `motivo_perda` | Motivo do declínio/perda | fonte | deal | `motivo_do_declinio_ou_perdido` | enum | vendas | Roster precisa limpeza na origem (princípio 5 do README): 'outros'/'escolheu outra corretora' sem submotivo. |
| `motivo_perda_descricao` | Motivo da perda \| descrição | fonte | deal | `motivo_de_declinio_perdido___descricao` | texto | vendas |  |
| `reuniao_ocorreu` | A reunião ocorreu? | fonte | deal | `a_reuniao_ocorreu_` | enum | vendas |  |
| `data_reuniao_exec` | Data da reunião com executivo | fonte | deal | `data_da_reuniao_com_executivo` | data | vendas |  |
| `data_reagendamento_exec` | Data do reagendamento | fonte | deal | `data_do_reagendamento_com_o_executivo` | data | vendas |  |
| `tempo_ate_diagnostico` | Tempo até Diagnóstico | fonte | deal | `cumulative_time_negocio_criado_ate_diagnostico_formula` | ms | revops | Fórmula calculada NO HubSpot (Reunião Agendada → Diagnóstico). Payload converte para dias (1 decimal). |
| `stage_entered` | Data de entrada por etapa | fonte | deal | `hs_v2_date_entered_{stage_id}` | data | revops | Família de propriedades (uma por etapa, dois pipelines). A variante v1 hs_date_entered_* vem VAZIA neste portal — usar sempre v2. Etapa presente nos dois pipes: vale a entrada mais antiga. |
| `stage_exited` | Data de saída por etapa | fonte | deal | `hs_v2_date_exited_{stage_id}` | data | revops | Usada com stage_entered para dias por etapa (tabela A19 do painel AE). |
| `contato_jobtitle` | Cargo do contato | fonte | contact | `jobtitle` | texto | revops |  |
| `empresa_nome` | Nome da empresa | fonte | company | `name` | texto | revops |  |
| `empresa_setor` | Setor da empresa | fonte | company | `industry` | enum | revops |  |
| `empresa_funcionarios` | Funcionários da empresa | fonte | company | `numberofemployees` | pessoas | revops |  |
| `faturamento_manual` | Faturamento manual | ✏️ manual | deal | — | BRL/mês | financeiro | Valores mensais reais digitados para Ganho/Implantação já faturando. UI: selo ✏️ nas linhas manuais do painel Ganho, com autor/data no tooltip; ⚠ após validade_dias sem revisão; entradas anteriores à Fase 4 aparecem como 'sem registro de autor'. Caveat conhecido do Delta: NÃO é ponto-no-tempo (recompute de foto antiga aplica valores de hoje). |
| `meta_receita` | Meta de receita | ✏️ manual | config | — | BRL/mês | cro | Usada por Revenue vs Plan (MTD) e Cobertura (N05). |
| `vpv_tiers` | R$/vida por faixa (VPV) | ✏️ manual | config | — | BRL/vida/mês | cro | Premissa de projeção para Diagnóstico. |
| `prob_override_etapa` | Override manual de probabilidade por etapa | ✏️ manual | config | — | fracao_0_1 | cro | localStorage novo_stage_prob_cfg (por pipeline) — por navegador. Fase 4: KV + toggle global ADR-008. |
| `premissas_bdr_originacao` | Premissas de originação BDR | ✏️ manual | config | — | vidas | cro | É premissa de negócio disfarçada de código — o caso exato que o ADR-004 proíbe. |

## Regras (`semantic/regras.json`)

### `receita_regua_mensal` | Régua de receita mensal (mês n do contrato)

> Define quanto cada deal rende por mês a partir da primeira fatura (pf). Fee por vida: a pf JÁ é a receita da Axenya. Corretagem: a pf é o prêmio pago à operadora — a receita é o percentual de comissão.

- **Tipo:** calculado · **Grain:** deal × mês do contrato · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** revops
- **Usa dados:** `primeira_fatura`, `modelo_remuneracao`, `vidas`, `possui_agenciamento`
- **Usa referência:** `porte`
- **Fórmula:** Fee por vida: total = pf todo mês. Corretagem +agenc: vidas<200 → meses 1-3 = pf, mês 4+ = pf×0,02 \| vidas>=200 → mês 1 = pf×0,95, mês 2+ = pf×0,05. Corretagem -agenc: vidas<200 → pf×0,02 \| vidas>=200 → pf×0,05, todo mês. Decompõe total = recorrente + pontual (pontual = max(0, total - recorrente)).

| Modelo | Vidas | Mês | Receita mensal |
|---|---|---|---|
| Fee por vida | todas | todos | 100% da pf |
| Corretagem −agenc | < 200 | todos | 2% da pf |
| Corretagem −agenc | >= 200 | todos | 5% da pf |
| Corretagem +agenc | < 200 | 1º ao 3º | 100% da pf |
| Corretagem +agenc | < 200 | 4º em diante | 2% da pf |
| Corretagem +agenc | >= 200 | 1º | 95% da pf |
| Corretagem +agenc | >= 200 | 2º em diante | 5% da pf |

- **Faltantes:** Sem pf ou sem modelo → null (deal fora da régua; contador 'X de Y completos')
- **Código (1.0):** public/revenue-engine.js:37 (calcReceitaMes) · public/revenue-engine.js:23 (taxaRecorrente)

### `contrato_meses` | Meses de fatura do contrato

- **Tipo:** calculado · **Grain:** deal · **Status:** em_revisao · **Vigente desde:** 2026-07-15 · **Dono:** revops
- **Usa dados:** `periodo_contrato`
- **Fórmula:** Extrai o número do enum ('12 Meses'/'24 Meses'/'36 meses'). Fonte do dado (2026-07-15, decisão do dono): periodo_do_contrato___vg com fallback no campo legado (ver dados.periodo_contrato). Sem período definido → 12 (anualiza).
- **Código (1.0):** public/revenue-engine.js:63 (contratoMeses) · api/forecast-table.js (cadeia periodo_do_contrato___vg → legado)

### `tcv_bruto` | TCV bruto (valor total do contrato)

- **Tipo:** calculado · **Grain:** deal · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** revops
- **Usa dados:** `primeira_fatura`, `modelo_remuneracao`, `vidas`, `possui_agenciamento`, `periodo_contrato`
- **Depende de:** `receita_regua_mensal`, `contrato_meses`
- **Fórmula:** Σ receita_regua_mensal(n) para n = 1..contrato_meses. Bruto, NÃO ponderado por probabilidade.
- **Código (1.0):** public/revenue-engine.js:73 (calcTCV)

### `receita_mensal_deal` | Receita por etapa \| quando e quanto (séries Real e Probabilizada)

> Receita Real = o que se espera faturar de fato (manual quando já fatura, régua estimada nas demais etapas). Receita Probabilizada = Real × probabilidade da etapa. Todas as telas de Forecast consomem estas duas séries como fonte única.

- **Tipo:** hibrido · **Grain:** deal × mês calendário · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** revops
- **Usa dados:** `is_poc`, `faturamento_manual`, `vidas`, `colaboradores`, `createdate`, `modelo_remuneracao`, `vigencia`, `data_prevista_para_receita`, `primeira_fatura`, `possui_agenciamento`, `vencimento_primeira_fatura`
- **Usa referência:** `valor_por_vida`, `etapas`
- **Precedência:** 1º É POC? → série zerada. 2º Faturamento manual existe → substitui INTEGRALMENTE a régua (probAdj=1). 3º Senão → régua por etapa abaixo.
- **Fórmula:** Por etapa: Diagnóstico → (vidas\|\|colaboradores) × VPV(faixa); início = createdate + delay (vidas<=200: 9m \| <=4999: 14m \| senão 18m), com piso na referenceDate. Reunião Agendada → (vidas\|\|colaboradores) × R$24; início = createdate + 15m, sem piso. Cotação/Consultoria/Negociação → início por modelo (corretagem: vigência futura+2m senão prevista+2m \| fee: prevista+2m \| sem modelo: prevista) e valor = receita_regua_mensal(n), cap 24 meses. Demais etapas → início na data prevista, receita_regua_mensal(n), cap 24 meses. Probabilizada = valor × probAdj (regra prob_final_deal ou régua da página).
- **Ponto no tempo:** referenceDate injetável via ForecastEngine.config() (Delta 1A); sem ela, ancora em hoje
- **Código (1.0):** public/forecast-engine.js:44 (dealMonthly) · public/forecast-engine.js:32 (_refNow)
- **Notas:** É a Regra primária nº 3 do STATUS_LOG em forma de catálogo: toda receita de qualquer painel vem desta série (Real e Probabilizada).

### `cohorts_bdr` | Originação BDR (projeção de topo de funil)

> Projeção agregada do que os BDRs vão originar, somada ao forecast dos deals. Entra nos totais apenas quando não há filtro de etapa ou quando Reunião Agendada está entre as etapas filtradas.

- **Tipo:** hibrido · **Grain:** mês de originação · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** cro
- **Usa dados:** `premissas_bdr_originacao`
- **Fórmula:** Por mês jul/26..jan/28: vidas = 4×34.000 (antigos) + 8×rampa(mês). Receita da coorte = vidas × R$24, iniciando originação+15m, probabilizada pela conversão MQL.
- **Código (1.0):** public/forecast-engine.js:117 (bdrCohorts) · public/forecast-engine.js:110 (bdrNewVidasPer)
- **Notas:** Premissas manuais hardcoded (ver dados.premissas_bdr_originacao) — regularizar na Fase 4.

### `prob_etapa_calculada` | Probabilidade de ganho por etapa, calculada do funil (C07)

- **Tipo:** calculado · **Grain:** etapa × pipeline · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** revops
- **Usa dados:** `dealstage`, `is_closed_won`
- **Usa referência:** `etapas`, `reguas_probabilidade.calculada_funil`
- **Fórmula:** Por pipeline: prob(etapa) = ganhos_absolutos ÷ deals_que_entraram_na_etapa (payload /api/funnel-stages via propertiesWithHistory). Etapa com amostra < 20 não gera probabilidade (cai na régua default). Clamp [0,1].
- **Código (1.0):** public/prob-engine.js:47 (funnelDerivedProbPipe)

### `prob_final_deal` | Probabilidade final do deal (com ajuste do AE)

- **Tipo:** calculado · **Grain:** deal · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** revops
- **Usa dados:** `dealstage`, `pipeline`, `probabilidade_ae`, `prob_override_etapa`
- **Usa referência:** `reguas_probabilidade.forecast_flat`, `reguas_probabilidade.calculada_funil`
- **Precedência:** prob de etapa = override manual (por pipeline) > calculada do funil (C07, por pipeline) > RÉGUA ÚNICA forecast_flat (D4/D4b, 2026-07-15 — antes era a painel_default, aposentada)
- **Fórmula:** final = prob_etapa, ajustada pela prob do AE só quando diverge >= 30pp: AE <= etapa-0,3 → etapa×0,9 \| AE >= etapa+0,3 → etapa×1,1 \| senão = etapa.
- **Código (1.0):** public/prob-engine.js:62 (stageProbFor) · public/prob-engine.js:77 (calcProbInfo)
- **Notas:** ADR-008 (toggle global forçada × calculada) muda a precedência para uma escolha explícita do usuário na Fase 4. Histórico da divergência de Implantação: referencia.reguas_probabilidade.painel_default_APOSENTADA.

### `filtro_deals_ativos` | Filtro de deals ativos (payload principal)

- **Tipo:** calculado · **Grain:** consulta · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** revops
- **Usa dados:** `pipeline`, `dealstage`, `is_closed_lost`
- **Usa referência:** `pipelines.vendas`, `pipelines.bid`, `etapas`
- **Filtro:** COMPORTAMENTO ATUAL (1.0): pipeline IN (Vendas, Bid) AND dealstage IN (todas as etapas com mapeada_no_1_0 != false, exceto Perdido) — Stand by INCLUÍDO. Perdidos só com ?includeLost=true (2º filterGroup: hs_is_closed_lost=true nos dois pipes — é o que pega o Perdido do Bid). Closed-lost sem stage mapeado → nome 'Perdido'.
- **Código (1.0):** api/forecast-table.js:40 (ACTIVE_STAGE_IDS) · api/forecast-table.js:280 (fetchDeals)
- **Notas:** ADR-007 (etapas ativas configuráveis pelo usuário, especialmente Reunião e Standby) transforma este filtro fixo em config global na Fase 4.

### `dedup_fee_corretagem` | Deals duplicados (Fee × Corretagem)

> Quando o mesmo cliente tem dois negócios simultâneos (um Fee por vida e um Corretagem), só UM conta no forecast, para não dobrar a receita.

- **Tipo:** calculado · **Grain:** cliente · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** revops
- **Usa dados:** `dealname`, `modelo_remuneracao`, `vigencia`
- **Fórmula:** Critério de escolha do deal que fica: 1º etapa mais avançada; empate → menor TCV de 12 meses; novo empate → vigência mais distante (cenário conservador). O deal 'perdedor' continua aparecendo na lista, mas com receita ZERADA (não soma no total).
- **Código (1.0):** public/forecast.html (dedup do painel Forecast; texto validado na ajuda da aba)
- **Notas:** As Premissas (doc) diziam 'menor TCV + prazo mais longo'; o comportamento real do código antepõe a ETAPA MAIS AVANÇADA como 1º critério — catálogo segue o código (extração), divergência do doc anotada.

### `prob_final_forecast` | Probabilidade final no Forecast (régua flat + ajuste do AE)

> A coluna P. Etapa segue a régua flat validada do Forecast; a probabilidade informada pelo AE só ajusta ±10% quando diverge muito da etapa.

- **Tipo:** calculado · **Grain:** deal · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** revops
- **Usa dados:** `dealstage`, `probabilidade_ae`, `prob_override_etapa`
- **Usa referência:** `reguas_probabilidade.forecast_flat`
- **Precedência:** override manual em Configurações > régua flat do Forecast. Overrides legados iguais aos defaults antigos são limpos automaticamente (fix 2026-07-14).
- **Fórmula:** P.Etapa = régua flat. Ajuste pelo AE: sem prob. do AE → P.Etapa; dentro de ±30 pp → P.Etapa; AE >= P.Etapa+30pp → P.Etapa × 1,10; AE <= P.Etapa−30pp → P.Etapa × 0,90.

| Situação | Probabilidade final |
|---|---|
| AE não informou | P.Etapa (sem ajuste) |
| Prob. AE dentro de ±30 pp da P.Etapa | P.Etapa (sem ajuste) |
| Prob. AE >= P.Etapa + 30 pp | P.Etapa × 1,10 (+10%) |
| Prob. AE <= P.Etapa − 30 pp | P.Etapa × 0,90 (−10%) |

- **Código (1.0):** public/forecast.html (P. Etapa \| fix 2026-07-14) · public/forecast-stage.html

### `arr_estimado_fallback` | ARR com fallback

- **Tipo:** calculado · **Grain:** deal · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** revops
- **Usa dados:** `arr_estimado`, `primeira_fatura`
- **Fórmula:** arr_estimado se > 0; senão primeira_fatura × 12; senão null.
- **Código (1.0):** api/forecast-table.js:426
- **Notas:** ⚠ Para Corretagem o fallback pf×12 superestima (pf é o prêmio, não a receita Axenya). Herdado do 1.0; avaliar na validação.

### `probabilidade_deal_fallback` | Probabilidade do deal com fallback

- **Tipo:** calculado · **Grain:** deal · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** revops
- **Usa dados:** `probabilidade_ae`, `probabilidade_etapa_hs`
- **Fórmula:** probabilidade_ae normalizada (>1 → ÷100) se existir; senão hs_deal_stage_probability normalizada.
- **Código (1.0):** api/forecast-table.js:420

### `quarter_fallback` | Quarter com fallback pela data prevista

- **Tipo:** calculado · **Grain:** deal · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** revops
- **Usa dados:** `quarter_fechamento`, `data_prevista_para_receita`
- **Fórmula:** quarter_fechamento quando válido (contém ano); senão derivado de data_prevista_para_receita (Q = mês÷3 + 1).
- **Código (1.0):** api/forecast-table.js:202 (quarterEmpty) · api/forecast-table.js:209 (getQuarterFromDate)

### `conversao_ajustada` | Taxa de conversão ajustada

- **Tipo:** calculado · **Grain:** período × etapa · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** cro
- **Usa dados:** `is_closed_won`, `is_closed_lost`
- **Fórmula:** ganhos ÷ (ganhos + perdidos) — só deals FINALIZADOS. Remove o pipe em aberto e não depende do ciclo de vendas. Premissa: ~1/3 dos deals históricos ainda ativos converterão na mesma proporção dos finalizados (projeta fechamentos futuros do pipe aberto).
- **Código (1.0):** conceito do CRO (README §3); implementações no C06/C07 e cards de conversão
- **Notas:** Cards que calculam 'win rate' como ganhos ÷ (ganhos + abertos) — N09/N12 da auditoria — VIOLAM esta regra (ignoram perdidos) e estão 🔴.

### `idades_em_dias` | Idades em dias (no pipe, sem atividade, por etapa)

- **Tipo:** calculado · **Grain:** deal · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** revops
- **Usa dados:** `createdate`, `ultima_atividade`, `stage_entered`, `stage_exited`
- **Fórmula:** dias_no_pipe = hoje - createdate. dias_sem_atividade = hoje - ultima_atividade. stage_days[etapa] = (saída \|\| hoje) - entrada, piso 0.
- **Código (1.0):** api/forecast-table.js:487 · api/forecast-table.js:135 (computeStageDays)
- **Notas:** ⚠ 'hoje' via Date.now() no fuso do servidor — caso do ADR-011 (fuso) a convergir.

### `comparacao_fotos_delta` | Delta do Forecast \| comparação entre duas fotos

> Cada barra do waterfall é a variação líquida do cash forecast de uma etapa entre a Foto A e a Foto B. Fonte única: o mesmo motor do /forecast-overall, recomputado sobre cada foto com a data dela como referência temporal.

- **Tipo:** calculado · **Grain:** etapa × par de fotos · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** revops
- **Usa dados:** `dealstage`, `vencimento_primeira_fatura`, `faturamento_manual`
- **Usa referência:** `etapas`
- **Depende de:** `receita_mensal_deal`
- **Fórmula:** CashForecast(etapa, foto) = Σ da série mensal (Real ou Probabilizada) dos deals abertos que estavam NAQUELA etapa na foto, no horizonte TCV(12M) rolante a partir da data da foto (toggle secundário: Pipeline total = todos os meses projetados). Δ(etapa) = CashForecast(etapa, B) − CashForecast(etapa, A). A receita de cada deal é atribuída à etapa em que ele estava em CADA foto — novos/avançados/regredidos/saídos ficam embutidos no Δ líquido. Invariante (teste automatizado): Σ Δ(etapa) == Total(B) − Total(A).
- **Faltantes:** Caveat Fase 1 do Delta: probabilidades por etapa e faturamento manual usam o estado ATUAL (não são snapshotados). Ganho/Implantação só entra quando o vencimento da 1ª fatura <= data da foto — em datas anteriores ao início do faturamento a etapa aparece subestimada (fidelidade ponto-no-tempo, não erro). Foto deal-level mais antiga: 2026-05-12; resolução semanal.
- **Ponto no tempo:** referenceDate = data de cada foto (engine determinística, Delta 1A). Data escolhida resolve para a foto mais próxima ANTERIOR ou igual, com rótulo honesto; B > A obrigatório; A e B na mesma foto → mensagem, não waterfall zerado.
- **Código (1.0):** api/history.js:144 (action=compare) · public/forecast-delta.html · scripts/test-delta-invariant.js

### `capital_a_risco` | Capital a risco (Implantação = Ganho)

- **Tipo:** calculado · **Grain:** período · **Status:** em_revisao · **Vigente desde:** 2026-07-14 · **Dono:** cro
- **Usa dados:** `dealstage`
- **Usa referência:** `etapas`
- **Fórmula:** Toggle global 'Implantação = Ganho' (ON por default): na régua geral implantação JÁ é ganho (não se perde conta implantada). A distinção OFF existe só para enxergar capital a risco até a assinatura.
- **Código (1.0):** public/dashboard.html (drawer de configurações) · public/settings-modal.js

