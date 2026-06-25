# Pipeline Coverage — Especificação de Build (v1)

Documento de implementação para construir o **Pipeline Coverage** dentro do
`public/dashboard.html`. Escrito para ser executado por uma IA que já está na
sessão do projeto, sem depender do histórico da conversa que o originou.

> **Como usar este documento.** Ele trava as decisões e descreve o comportamento
> esperado. Os números de linha citados são âncoras de orientação, não verdade
> absoluta: confirme no código antes de editar, porque os arquivos mudam. Não
> implemente nada marcado como **v2** nesta entrega.

---

## 1. Objetivo de negócio

Pipeline coverage responde uma pergunta: **dada a nossa projeção de receita, qual
o múltiplo da meta que o pipe cobre, e onde está o risco?** Se a projeção de um
mês é R$ 100.000 e a meta é R$ 100.000, o coverage é 1,0x. Abaixo de 1x é furo de
meta projetado; o colchão saudável fica um pouco acima de 1x na visão
probabilizada.

O gráfico cruza o **forecast de receita** (motor que já existe em
`public/forecast.html`) com a **meta** (campo que já existe em
`public/dashboard.html`), mês a mês, separando receita recorrente de receita
pontual para que o número não engane.

---

## 2. Decisões travadas (não relitigar)

| # | Decisão | Detalhe |
|---|---------|---------|
| 1 | **Dois números** | Coverage principal = projeção probabilizada ÷ meta (≈1x = no alvo). Coverage de segurança = pipe aberto **bruto** ÷ meta (saudável 3–4x). |
| 2 | **Recorrente x pontual separados** | Visualmente em camadas. Coverage e meta são de **receita total**; a recorrência é destacada como camada dentro, não como meta própria. |
| 3 | **Fee por vida é recorrente** | Mensalidade recorrente. Receita anual = 12 × primeira fatura. (O `dashboard.html` antigo, em `01 Projetos/Dashboard Ivan/public/dashboard.html`, tratava como one-time e subcontava em 12x. **Não copiar esse comportamento.**) |
| 4 | **Meta vive no dash, flat ÷12** | Usar o campo existente "Meta Receita Ganha (Anual)". Mês = anual ÷ 12. Faseamento por curva é v2. |
| 5 | **Só carteira de set/2025 em diante** | Usar o feed atual (`/api/forecast-table`, filtrado `createdate >= 2025-09-01`). É coverage de **negócio novo**; a base instalada antiga é v2. |
| 6 | **Horizonte = 6 meses** | Coverage exibido apenas para o mês atual + 5 meses à frente. |
| 7 | **Realizado estimado por fórmula** | Sinalizar no gráfico que o realizado é estimado (não vem do extrato de comissionamento). Reconciliação real é v2. |
| 8 | **Probabilidade = funil dinâmico C06** | Usar a probabilidade calculada pelo funil (C06) que já existe no `dashboard.html`, não a tabela estática do `forecast.html`. |
| 9 | **Host = dashboard.html** | O coverage mora no `dashboard.html`. O motor de régua de receita do `forecast.html` é **portado para uma função compartilhada** consumida pelos dois. |

Defaults herdados (objetar só se houver motivo): coverage convive no
`dashboard.html`; deals incompletos ficam fora do cálculo e aparecem num
indicador de completude; meta única da empresa (não por AE/segmento); churn e
originação futura fora da v1.

---

## 3. Modelo de receita por modelo de cobrança

`primeira_fatura` (campo `premio` em alguns pontos do código) é a base. O motor
atual está em `calcReceita(n, deal)` no `public/forecast.html` (~linha 2220) e em
`calcDealAnnualRevenue(d)` no dashboard antigo (~linha 1696). As fórmulas batem
entre si, com o PNG de modelos de remuneração e com a CFO. Semântica confirmada:

- **Fee por vida:** `primeira_fatura` **já é a receita da Axenya** (R$/vida ×
  vidas). Não aplicar percentual.
- **Corretagem:** `primeira_fatura` é o **prêmio** (o que o cliente paga à
  operadora). A receita da Axenya é o percentual de comissionamento sobre o
  prêmio: **2% para PME (<200 vidas), 5% para não-PME (≥200 vidas)**.

Receita **total** por mês `n` (n = 1 no mês de início de receita):

| Modelo | Mês `n` | Receita total do mês |
|--------|---------|----------------------|
| Fee por vida | todos | `pf` |
| Corretagem +agenciamento, ≥200 | 1 | `pf × 0,95` |
| Corretagem +agenciamento, ≥200 | 2+ | `pf × 0,05` |
| Corretagem +agenciamento, <200 | 1–3 | `pf` |
| Corretagem +agenciamento, <200 | 4+ | `pf × 0,02` |
| Corretagem −agenciamento, ≥200 | todos | `pf × 0,05` |
| Corretagem −agenciamento, <200 | todos | `pf × 0,02` |

### 3.1. Decomposição recorrente x pontual (regra geral)

A corretagem de entrada (o pico dos primeiros meses) é **pontual**: não se repete
no ano seguinte. O agenciamento (a cauda de 2%/5%) e o fee por vida são
**recorrentes**. Regra única que vale para todos os modelos:

```
taxaRecorrente(deal):
  Fee por vida        -> pf                  // a mensalidade inteira recorre
  Corretagem, ≥200    -> pf × 0,05
  Corretagem, <200    -> pf × 0,02
  // independe de possui_agenciamento: agenciamento só adiciona o pontual de entrada

recorrente[n] = taxaRecorrente(deal)
pontual[n]    = max(0, total[n] − recorrente[n])
```

Conferência (corretagem ≥200, com agenciamento, prêmio R$ 100.000):

```
Mês 1: total 95.000 → recorrente 5.000 + pontual 90.000
Mês 2+: total 5.000 → recorrente 5.000 + pontual 0
```

Para Fee por vida e corretagem sem agenciamento, `pontual` é sempre 0.

---

## 4. Função compartilhada (Decisão 9)

Extrair o motor de receita para uma função única consumida por `forecast.html` e
`dashboard.html`. Assinatura mínima:

```js
// n = índice do mês (1 = mês de início de receita do deal)
// retorna a receita Axenya daquele mês decomposta
function calcReceitaMes(n, deal) {
  const total = /* lógica atual de calcReceita(n, deal) */;
  if (total == null) return null;
  const recorrente = taxaRecorrente(deal);
  return { total, recorrente, pontual: Math.max(0, total - recorrente) };
}
```

Manter a lógica de `total` idêntica à `calcReceita` atual (mesmos modelos, mesmas
faixas). Só acrescentar a decomposição. Se preferir um módulo JS compartilhado,
extrair para um arquivo único e importar nos dois HTML; se os arquivos forem
standalone, replicar a função garantindo que **a fonte da verdade seja uma só**
(idealmente um `<script src>` comum).

---

## 5. Probabilidade (C06)

Usar a probabilidade por etapa **calculada dinamicamente pelo funil (C06)** que já
existe no `dashboard.html`. Definição (do próprio modal de regras, ~linha 750):

> taxa da etapa = deals que chegaram à Implantação ÷ deals que entraram na etapa,
> no funil histórico combinado **Vendas + Bid**. Etapas com menos de **20** deals
> na amostra usam o padrão fixo. **Ganho** e **Implantação** = 100%.

Regras a respeitar:

- O coverage usa a probabilidade C06 como base, **não** a tabela estática do
  `forecast.html`.
- O override manual (drawer de configurações, `novoOpenProbEditor`) deve afetar o
  coverage: se o usuário edita uma probabilidade, o coverage recalcula; "Restaurar
  padrão do funil" volta ao C06.
- O ajuste de ±10% conforme a probabilidade informada pelo AE (lógica
  `calcProbInfo` / `prob_ajustada` no `forecast.html`) entra como **refinamento
  opcional**, ligado por default e marcado como configurável. Documentar no
  tooltip.

---

## 6. Meta

- Ler do campo existente **"Meta Receita Ganha (Anual)"** no `dashboard.html`
  (~linha 353, input `np-meta`).
- `metaMensal = metaAnual / 12` (flat na v1).
- A meta representa **receita total** (recorrente + pontual), com a recorrência
  destacada visualmente. **A confirmar com a CFO** (ver §11): se esse campo hoje
  significa só receita recorrente, ajustar a leitura.

---

## 7. Cálculo do coverage

Horizonte: mês atual + 5 (6 meses). Para cada mês do horizonte:

```
Para cada deal do feed:
  revStart = data_prevista_para_receita
  n = (mês - revStart) em meses + 1
  se n < 1: deal ainda não gera receita nesse mês → ignora
  r = calcReceitaMes(n, deal)              // {total, recorrente, pontual}
  p = probabilidadeC06(deal.stage)         // com override/ajuste conforme §5

  projTotalProb[mes]   += r.total      × p
  projRecorrenteProb[mes] += r.recorrente × p
  projPontualProb[mes]    += r.pontual    × p
  pipeBrutoAberto[mes] += (deal aberto ? r.total : 0)   // SEM ponderar
```

Os dois números, por mês:

```
Coverage principal (×)   = projTotalProb[mes] / metaMensal      // ≈1x = no alvo
Coverage de pipe (×)     = pipeBrutoAberto[mes] / metaMensal    // saudável 3–4x
```

- "Aberto" = deal não-Ganho/não-perdido (mesma noção de `openDeals` no
  `dashboard.html`).
- O coverage principal inclui os deals em Ganho (probabilidade 100%) + pipe
  ponderado. O coverage de pipe isola só o aberto bruto, para medir segurança.
- Recorrência **não** tem meta própria na v1: é exibida como camada dentro da
  projeção total.

---

## 8. Especificação visual

1. **Dois KPIs no topo do bloco:** "Recorrente projetada" e "Pontual projetada"
   (somatórios do horizonte), números distintos.
2. **Gráfico principal — barras empilhadas por mês (6 meses):**
   - Camada de baixo = recorrente (cor sólida, ex.: teal).
   - Camada de cima = pontual (mesma família de cor, mais clara ou hachurada).
   - Linha da **meta mensal** atravessando as barras.
   - Rótulo do **coverage principal (×)** em cima de cada barra. Cor com
     significado: ≥1,0x ok, 0,8–1,0x atenção, <0,8x risco.
3. **Coverage de pipe (segurança):** segundo indicador (linha secundária ou
   badge), com semáforo 3–4x saudável / 2–3x atenção / <2x abaixo.
4. **Realizado sinalizado:** onde aparecer receita realizada, marcar "estimado"
   (Decisão 7), com tooltip explicando que não vem do extrato de comissionamento.
5. **Drill-down (memória de cálculo):** clicar num mês abre a lista dos deals que
   compõem aquele mês, com prêmio, modelo, vidas, probabilidade, e a receita
   recorrente/pontual do mês por deal. É o que torna o número auditável.

---

## 9. Auditabilidade e dados

- **Memória de cálculo por deal:** o drill-down (§8.5) deve reproduzir a régua
  mês a mês com a fórmula do modelo visível, de modo que um deal possa ser
  conferido na mão contra a tabela do §3.
- **Indicador de completude:** deals com `premio`/`primeira_fatura`,
  `modelo_remuneracao`, `possui_agenciamento`, `vidas` ou
  `data_prevista_para_receita` ausentes **não entram** no cálculo e aparecem num
  contador "X de Y deals com dados completos". O número precisa ser honesto sobre
  o que ele ignora.
- **Campos por deal necessários** (confirmar que o feed que o `dashboard.html`
  consome os traz; o `forecast.html` já usa todos): `primeira_fatura`/`premio`,
  `modelo_remuneracao`, `possui_agenciamento`, `vidas`, `stage`,
  `data_prevista_para_receita`, `createdate`.

---

## 10. Diagnóstico (regra própria — a definir)

Deals em etapa **Diagnóstico** não têm prêmio definido. O `forecast.html` estima
a receita por `vidas × R$/vida` (faixas: <200 → R$36; ≤4999 → R$24; 5000+ → R$12)
com delay de início (9/14/18 meses do cadastro). Para a v1:

- **Incluir** Diagnóstico no coverage, usando essa lógica de headcount.
- Tratar a receita estimada como **100% recorrente** (não há corretagem de
  entrada).
- **Marcar visualmente como "estimado"** (faixa/hachura distinta), porque a base
  é vidas, não prêmio real.
- **TODO (decisão pendente):** a regra específica de Diagnóstico será refinada
  depois. Deixar o ponto isolado e fácil de ajustar, não embutido no caminho
  principal.

---

## 11. Pontos a confirmar antes/durante o build

1. **Meta = total ou recorrente?** Confirmar com a CFO se "Meta Receita Ganha
   (Anual)" inclui a receita pontual de corretagem. A v1 assume que sim.
2. **Feed do dashboard.html** traz todos os campos do §9? Se não, alinhar o
   endpoint com o que `/api/forecast-table` já entrega.
3. **±10% do AE** no coverage: confirmar se entra ligado por default.

---

## 12. Critérios de aceite (verificáveis)

- [ ] Deal corretagem ≥200 com agenciamento, prêmio 100k: memória mostra mês 1 =
      95k (90k pontual + 5k recorrente); meses 2+ = 5k recorrente, 0 pontual.
- [ ] Fee por vida aparece como 100% recorrente, anual = 12 × primeira fatura.
- [ ] Coverage principal de um mês = projeção probabilizada ÷ meta mensal, e o
      drill-down lista os deals que compõem o mês.
- [ ] Recorrente e pontual aparecem como camadas distintas no gráfico.
- [ ] A probabilidade vem do funil C06; editar override muda o coverage;
      "Restaurar padrão do funil" volta ao C06.
- [ ] Deals incompletos não entram no cálculo e aparecem no indicador de
      completude.
- [ ] O horizonte exibido é de 6 meses (mês atual + 5).
- [ ] O motor de receita é uma função compartilhada, fonte única, consumida por
      `forecast.html` e `dashboard.html`.

---

## 13. Ordem de implementação sugerida

1. Extrair `calcReceitaMes(n, deal) → {total, recorrente, pontual}` como função
   compartilhada (portar `calcReceita` do `forecast.html` + `taxaRecorrente`).
2. No `dashboard.html`, montar a série mensal de 6 meses, ponderando por C06.
3. Conectar a meta do campo existente, `÷12`.
4. Calcular os dois coverages por mês.
5. Renderizar KPIs + barras empilhadas (recorrente sólido, pontual hachurado) +
   linha de meta + rótulo de coverage.
6. Implementar o drill-down (memória de cálculo) e o indicador de completude.
7. Incluir Diagnóstico marcado como estimado, com a regra própria isolada (§10).

---

## 14. Fora de escopo (v2 — não implementar agora)

- Base instalada anterior a set/2025 (coverage de receita total da empresa).
- Originação futura (net-new run-rate) para estender o horizonte além de 6 meses.
- Faseamento da meta por curva de sazonalidade.
- Churn de 2% ao ano (concentrado em renovação/vigência).
- Reconciliação do realizado com o extrato de comissionamento.
- Coverage de recorrência com meta própria de recorrência.
