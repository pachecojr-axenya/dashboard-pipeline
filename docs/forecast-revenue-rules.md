# Regras de receita do Forecast — fonte única (por etapa)

> **Status:** canônico. Toda projeção de **receita de caixa mensal** do Forecast
> DEVE sair deste motor único, em **todos os painéis**. Complementa a **Regra
> primária nº 3** do `STATUS_LOG.md` (fonte única de receita).
> Documentado em 2026-07-20 a partir de `public/forecast-engine.js` (comportamento
> vigente) + auditoria de uso.

## 1. Motor único (onde a regra vive)

| Arquivo | Papel |
|---|---|
| `public/revenue-engine.js` | `calcReceitaMes(n, deal)` — régua da 1ª fatura por modelo; `calcTCV`. |
| `public/forecast-engine.js` | `ForecastEngine.dealMonthly(d, probAdj)` — **início + valor POR ETAPA** (este documento). |
| `public/forecast-overall-core.js` | orquestra escopo / dedup / probabilização; chama `dealMonthly`. |
| `lib/forecast-compute.js` | reusa as MESMAS engines no server (comparativo `/forecast-delta`), ancorado em `referenceDate`. |
| `public/prob-engine.js` + `semantic/referencia.json → forecast_flat` | régua única de probabilidade (`probAdj`). |

Nenhum painel deve reimplementar cálculo de receita mensal. Quem precisar de receita
projetada chama `dealMonthly` (ou, no server, `forecast-compute`).

## 2. A régua por etapa (`dealMonthly`)

Precedência (antes de olhar a etapa):
1. **Faturamento manual** → substitui **integralmente** a projeção pelos valores digitados.

> **POC não zera mais (2026-08-02):** até 2026-07-13/2026-08-02 o motor tratava POC
> (`É POC? = Sim`) como precedência 0, zerando Real e Probabilizada antes de olhar a etapa.
> Revertido por decisão da reunião de forecast de 31/07 ("POC não pode valer zero no
> forecast" — ver seção 2b). Hoje um deal POC flui pela MESMA régua por etapa de qualquer
> outro deal, sem guard especial; a probabilidade baixa vem do ajuste manual do AE/comitê
> (item "Probabilidade" abaixo), não de uma fórmula nova.

Por etapa (`valor` = receita real do mês; `início` = 1º mês com receita):

- **Diagnóstico**
  - valor = `(vidas || colaboradores) × VPV`, onde **VPV por faixa de vidas**: ≤200 → **36**, ≤4999 → **24**, senão → **12**.
  - início = `createdate + delay`, **delay** por faixa: ≤200 → **9m**, ≤4999 → **14m**, senão → **18m**.
  - **piso na `referenceDate`**: se o início cair no passado, começa no mês de referência.
  - recorrente ao longo do horizonte (sem cap de 24m por deal).

- **Reunião Agendada**
  - valor = `(vidas || colaboradores) × R$24`/vida.
  - início = `createdate + 15m`, **sem piso**.
  - recorrente ao longo do horizonte (sem cap de 24m por deal).

- **Cotação / Consultoria / Negociação** — início **por modelo de remuneração**:
  - **corretagem**: se `vigência ≥ hoje` → `vigência + 2m`; senão → `data_prevista + 2m`.
  - **fee**: `data_prevista + 2m`.
  - **sem modelo**: `data_prevista` (puro).
  - valor = `calcReceitaMes(n)` (régua da 1ª fatura); **cap 24 meses**.
  - **Fallback (2026-07-20):** se a régua **não produz receita** (tipicamente **sem 1ª
    Fatura** lançada), o deal cai no **`(vidas || colaboradores) × VPV`** com o mesmo
    **delay/piso do Diagnóstico** (9/14/18m + piso na referência), recorrente, mas
    **probabilizado pela prob da própria etapa** (Cotação 18,6% etc., não os 6% do
    Diagnóstico). Objetivo: deal aberto de Cot/Cons/Neg **não fica invisível** no
    forecast só porque a 1ª Fatura não foi preenchida. **Não** se aplica a outras
    etapas.
    - **Exceção POC (2026-08-11):** se o deal é POC (`É POC? = Sim`) **e** a régua não
      produziu receita (sem 1ª Fatura), **não** cai no fallback `vidas × VPV` — fica
      sem receita projetada nesse trecho (`NIL`), em vez de estimar só a partir de
      `vidas`. Motivo: caso real (BRF/Marfrig POC, 4.500 vidas, nenhum dado de
      faturamento) gerava R$ 1,3M de projeção inteiramente derivada de `vidas`, sem
      nenhum número real por trás. Restringe a decisão de 31/07 (abaixo) só a este
      cenário — POC com 1ª Fatura preenchida continua gerando receita normalmente pela
      régua (`calcReceitaMes`), sem guard. Diagnóstico e Reunião Agendada **não** têm
      essa exceção: para esses dois, `vidas × VPV`/`vidas × R$24` é a própria régua da
      etapa (não um fallback por falta de dado), então POC segue igual a qualquer deal.

## 2b. ARR estimado — fallback por VPV (coluna "ARR Est." e KPIs de ARR)

O **ARR de cada deal** (coluna "ARR Est." do `/forecast` e KPIs ARR Total/Ponderado do
`/forecast-delta`) é derivado assim (`api/forecast-table.js` + `lib/forecast-compute.js`
`mapFotoDeal`, iguais por espelho):

1. `arr_estimado` (campo do HubSpot), se > 0; senão
2. `1ª Fatura × 12`, se > 0; senão
3. **Fallback VPV (2026-07-20):** nas etapas **Diagnóstico/Cotação/Consultoria/Negociação**,
   `(vidas || colaboradores) × VPV × 12` (VPV por faixa 36/24/12); senão
4. `—` (sem ARR).

**POC entra na cascata normal nos passos 1 e 2 (arr_estimado / 1ª Fatura × 12), sem guard
especial (2026-08-02):** o guard "POC → sem ARR" introduzido em 2026-07-28 foi
**revertido** por decisão da reunião de forecast de 31/07 — "POC não pode valer zero no
forecast: se a probabilidade real fosse zero, a conta deveria morrer (se não acreditamos
que vai dar receita, liberamos o tempo do Rafa); POC entra com valor e probabilidade
baixa, o conservadorismo de caixa é problema do CFO, o forecast reflete crença." A
probabilidade baixa de um POC não vem de uma fórmula nova — é o valor que o AE/comitê já
ajusta manualmente por deal em `Probabilidade (campo)` / HubSpot, igual a qualquer deal.
A coluna "Fatura Atual" (plano vigente do cliente) continua **não** entrando no ARR.

**Exceção no passo 3 — fallback VPV (2026-08-11):** achado real (deal "BRF/Marfrig - POC",
4.500 vidas, `arr_estimado`/`primeira_fatura`/`premio_mensal` todos vazios) mostrou que a
reversão de 2026-08-02 fazia um POC **sem nenhum dado real de faturamento** projetar
`4.500 × 24 × 12 = R$ 1.296.000` de ARR só a partir de `vidas` — número 100% estimado,
sem nada por trás. Decisão (2026-08-11): quando o deal é POC **e** chega ao passo 3 (ou
seja, `arr_estimado` e `1ª Fatura` ambos vazios/zero), o ARR fica **vazio (`—`)** em vez
de estimar via `vidas × VPV`. Um POC com `arr_estimado` ou `1ª Fatura` preenchidos
continua com ARR normal (passos 1/2, sem mudança). Mesmo guard aplicado ao fallback
equivalente do forecast de caixa mensal (`dealMonthly` em `forecast-engine.js`, seção 2
acima) — só no trecho de Cotação/Consultoria/Negociação que já é um fallback por falta de
1ª Fatura; Diagnóstico e Reunião Agendada não mudam (não são fallback, são a própria régua
da etapa). Código: `api/forecast-table.js` (`arr`), `lib/forecast-compute.js`
(`mapFotoDeal.arr_estimado`), `public/forecast-engine.js` (`dealMonthly`, bloco Cot/Cons/Neg).

> Nota (resolvida em 2026-08-02): o **forecast de caixa mensal** (`dealMonthly` em
> `forecast-engine.js`) também zerava Real e Probabilizada para POC desde 2026-07-13 — regra
> mais antiga e mais ampla que a de ARR (zerava a série mensal inteira). Revertida na mesma
> decisão da reunião de 31/07: POC agora flui pela mesma régua por etapa em TODOS os
> painéis que consomem `dealMonthly` (Forecast Overall, `/forecast-delta`, N05/N06B do CRO
> Dashboard) — sem divergência remanescente entre o campo ARR e o forecast de caixa.

- **Demais etapas** (Proposta Enviada, Standby, Implantação, Ganho, …)
  - início = `data_prevista`; valor = `calcReceitaMes(n)`; **cap 24 meses**.

- **Probabilizada** = `valor × probAdj`.
  - `probAdj` = `prob_final_deal` (régua `forecast_flat` / `ProbEngine.calcProbInfo`)
    **exceto Diagnóstico**, que é **fixo em 6% sem ajuste do AE**; BID usa `bidProb` (0,5%).
  - **Regra do mínimo (2026-08-02):** o ajuste automático da prob. do AE deixou de ser
    ±10% por divergência ≥30pp e passou a ser a **MENOR entre a prob. de etapa (régua) e a
    prob. que o AE colocou manualmente no deal** — decisão da reunião de forecast de 31/07,
    validada com a CFO ("um AE que baixa a própria probabilidade tem motivo real; a régua
    de etapa carrega o otimismo natural de quem não mexeu em nada"). Sem prob. do AE, usa a
    de etapa. Um override manual **por deal** ("P. Ajust." explícito do comitê, decisão
    2026-07-27) continua valendo **por cima** dessa regra — o mínimo é só o cálculo
    DEFAULT/automático, não substitui um ajuste explícito já feito em reunião. Detalhe em
    `public/prob-engine.js` (`_autoProbInfo`/`calcProbInfo`).

## 3. Onde se aplica (auditoria 2026-07-20)

**✅ Usam o motor canônico:** `/forecast` (`forecast.html`), `/forecast-stage`
(Overall + etapas), `forecast-overall-core.js`, **`/forecast-delta` + `lib/forecast-compute.js`**
(comparativo), CRO Dashboard — *headline* de coverage N05/N06B (`_novoForecastSeries` →
`dealMonthly`), AE Performance (`ae.html`), Board (TCV via `calcTCV`). `api/forecast-table.js`
não projeta receita (só entrega campos crus + fallback de ARR).

> **Nota (2026-08-02 → corrigido 2026-08-05):** até 2026-08-05, a probabilidade que N05/N06B
> (`dashboard.html`, `_novoFcProbAdj`) e A07 (`ae.html`, `_novoFcProbAdj`) injetavam em
> `dealMonthly` era um MIRROR local do cálculo de `prob-engine.js` (reimplementado à mão, não
> uma chamada direta) — motivo pelo qual a regra do mínimo (seção 2 acima) teve que ser
> replicada manualmente nesses dois arquivos além do `prob-engine.js` quando ela mudou em
> 02/08. **Fix (2026-08-05, Fase 1 da unificação de motor — ver seção 6):** os dois
> `_novoFcProbAdj` agora chamam `ProbEngine.calcProbInfo(d, { funnelProbPipe: null, defaults:
> NOVO_FC_STAGE_PROB_DEFAULT, cfg: { manual: false, values: { vendas: {}, bid: {} } } }).final`
> direto — zero cópia. `funnelProbPipe: null` é o que força a régua flat (em vez do funil C07),
> o mesmo padrão de `_fcProbCtx` em `forecast-stage.html` e de `OverallCore.config(...,
> funnelProb: null)` em `lib/forecast-compute.js`. Ganho colateral: agora também respeita um
> override manual por deal ("P. Ajust.", `/api/prob-manual`) — a cópia antiga não checava isso.
> Demais consumidores de probabilidade (C04 do CRO/Board, Forecast, Overall, Delta) já chamavam
> `ProbEngine.calcProbInfo` diretamente desde antes e herdaram a mudança sem edição própria.

## 4. Divergências conhecidas (a corrigir — motores paralelos)

1. **CRO Dashboard — modal drill do N06B ("Forecast como planilha")** (`public/dashboard.html`).
   O *gráfico* headline usa `dealMonthly` (canônico), mas o **drill que o explica** usa
   funções legadas (`_novoFcRuleStart`/`_novoFcRuleMonthValue`/`_novoFcWonMonthValue`) que
   divergem: início `vigência+2m` para **qualquer** modelo; Diagnóstico só `vidas` (sem
   `colaboradores`), corte `≤5000` e **sem piso**; Reunião Agendada = 0 por deal; ignora
   faturamento manual. → o drill pode não bater com o headline. **Prioridade.**
2. **`scripts/reconstruct-snapshot.js`** — motor legado histórico: `calcReceita`/`STAGE_PROB`
   próprios, sem Diagnóstico/Reunião/início-por-modelo. Afeta só os CSV/JSON standalone; o
   `/forecast-delta` ao vivo recomputa da foto crua pelo motor canônico. Caveat: fotos
   reconstruídas antigas não gravam `Criado`/`Vigência`/`É POC?`/`Deal ID`, então o recompute
   canônico dessas fotos degrada (Diagnóstico e corretagem perdem a data-base).

## 5. Não confundir: forecast de caixa ≠ ARR ponderado

Os KPIs **"Pipeline Ponderado" / "MRR" / "Receita"** do CRO Dashboard e do Board usam
`arr_estimado × prob` (peso anualizado do ARR) — **não** passam por `dealMonthly` e **não**
são o forecast de caixa por etapa (não aplicam delay de Diagnóstico, ×R$24 de Reunião,
início-por-modelo nem cap 24m). É métrica diferente, por design.

## 6. Duas famílias de probabilidade — por que dois números "ponderado" podem divergir e estar os dois certos

Auditoria de 2026-08-05 (revisão de confiabilidade das "Regras de probabilização" do CRO,
ícone "?" do topo) mapeou que `ProbEngine.calcProbInfo`/`stageProbFor` (`public/prob-engine.js`)
é o motor único de probabilidade, mas ele aceita um parâmetro (`ctx.funnelProbPipe`) que muda
DE PROPÓSITO qual baseline de etapa é usado. Isso cria **duas famílias intencionais**, não um
bug — mas o dashboard não explicava isso em lugar nenhum (plano de correção da UI em
andamento, ver STATUS_LOG.md):

- **Família "caixa"** (`funnelProbPipe: null` → força a régua flat `forecast_flat`, decisão do
  dono de 2026-07-16): `/forecast`, `/forecast-stage` (Overall + etapas), `/forecast-delta` +
  `lib/forecast-compute.js`, N05/N06B (CRO), A07 (AE). Existe porque o forecast de caixa
  precisa ser **estável** — não pode oscilar toda semana só porque a taxa de conversão
  observada do funil mudou (amostra pequena, mês ruim, importação em massa). Responde à
  pergunta-norte do projeto ("vou bater a meta?").
- **Família "pipeline ponderado"** (`funnelProbPipe` real, com fallback pra régua flat quando
  a amostra da etapa é <20): C04, C07, C08 (CRO), os equivalentes do Board (B07/B09/B15/B16), e
  **desde 2026-08-06** também P03 (CRO), B04 (Board, `=P03`), "Vidas Ponderadas", Receita por
  Segmento (modo ponderado), N21 e o KPI 🟡 "Pipeline Ponderado/ano" — via `_calcProbInfo`
  (CRO/Board) ou `_novoProbWeight` (dashboard.html, um wrapper de uma linha em cima do mesmo
  `_calcProbInfo`, sem cópia). Existe porque essas métricas são diagnóstico de conversão real
  do funil, não compromisso de caixa — aqui a oscilação é o ponto.
- **As duas famílias já aplicam a regra do mínimo** (seção 2) sobre a baseline escolhida — a
  diferença entre elas é SÓ a origem da probabilidade de etapa (flat vs. funil), nunca o ajuste
  pela prob. do AE.
- **Migração do outlier concluída em 2026-08-06** (decisão do dono, de uma vez, sem
  gradualismo, após dual-run medido em conversa): P03 caiu de R$121,7M pra R$35,6M no pipeline
  ativo do dia (-70,8%) — Diagnóstico sempre 6% (regra separada) explica -R$35,7M, a regra do
  mínimo nas demais etapas explica -R$50,4M. Detalhamento completo (deals que mais pesaram,
  como o número foi reconferido rodando o código de verdade numa VM) no STATUS_LOG.md. **Não
  há mais outlier** neste documento — todo consumidor de probabilidade ponderada está numa das
  duas famílias.
- **Achado colateral da migração — gap na régua, corrigido:** `semantic/referencia.json`
  (`forecast_flat.valores`) nunca teve entrada para `"Reunião Pré-RFP"` (etapa Bid, equivalente
  de "Reunião Agendada") — qualquer card ponderado com deals do Bid nessa etapa contava ZERO em
  silêncio, bug pré-existente só exposto pela migração do P03. Adicionado `0.06` por simetria
  (nota própria no JSON, `nota_reuniao_pre_rfp`, explicando que não é uma régua revisada pelo
  dono como o resto da tabela — é o preenchimento de um buraco que nunca devia estar vazio).
- **Override manual por deal ("P. Ajust.", `/api/prob-manual`) é ABSOLUTO em TODAS as métricas
  ponderadas, nas duas famílias E no outlier acima (2026-08-06, pedido explícito do dono).**
  `ProbEngine.manualFor(deal)` (exposto em `public/prob-engine.js`) é a fonte única do parse do
  override — qualquer consumidor de probabilidade, mesmo o outlier que ainda não usa
  `calcProbInfo`, deve checá-lo primeiro e usar o valor sem mais nenhum ajuste por cima. Não
  reimplementar esse parse em cada card; sempre chamar `ProbEngine.manualFor`.
- **Não editar `ProbEngine.calcProbInfo`/`stageProbFor` para "resolver" a divergência entre as
  duas famílias por igualar as baselines** — isso desfaria a decisão do dono de 16/07. A
  unificação correta é: todo consumidor chama o motor único (nunca reimplementa a régua/ajuste
  à mão), passando o `ctx` certo para a família que faz sentido pra aquela métrica — e sempre
  respeitando o override manual absoluto acima.
