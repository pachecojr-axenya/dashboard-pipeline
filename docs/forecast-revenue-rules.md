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
1. **POC** (`É POC? = Sim`) → **zero** em Real e Probabilizada, em todos os painéis.
2. **Faturamento manual** → substitui **integralmente** a projeção pelos valores digitados.

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
    etapas. Observação: a **coluna "ARR Est."** continua vinda do campo
    (`arr_estimado ‖ 1ª Fatura×12`) e permanece "—" — o fallback afeta a **projeção de
    caixa**, não a coluna de ARR.

- **Demais etapas** (Proposta Enviada, Standby, Implantação, Ganho, …)
  - início = `data_prevista`; valor = `calcReceitaMes(n)`; **cap 24 meses**.

- **Probabilizada** = `valor × probAdj`.
  - `probAdj` = `prob_final_deal` (régua `forecast_flat` / `ProbEngine`, com ajuste ±10% do AE)
    **exceto Diagnóstico**, que é **fixo em 6% sem ajuste do AE**; BID usa `bidProb` (0,5%).

## 3. Onde se aplica (auditoria 2026-07-20)

**✅ Usam o motor canônico:** `/forecast` (`forecast.html`), `/forecast-stage`
(Overall + etapas), `forecast-overall-core.js`, **`/forecast-delta` + `lib/forecast-compute.js`**
(comparativo), CRO Dashboard — *headline* de coverage N05/N06B (`_novoForecastSeries` →
`dealMonthly`), AE Performance (`ae.html`), Board (TCV via `calcTCV`). `api/forecast-table.js`
não projeta receita (só entrega campos crus + fallback de ARR).

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
