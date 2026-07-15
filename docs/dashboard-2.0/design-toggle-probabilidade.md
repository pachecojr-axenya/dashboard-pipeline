# Proposta de design | Toggle global de probabilidade (ADR-008)

> **Status: 🟠 PROPOSTA — aguarda decisão do dono.** Nada aqui está implementado.
> Escrito em 2026-07-14 para a revisão do dia seguinte. Implementação = Fase 4,
> só após o "vai" explícito.

## O problema

O requisito (seu, no doc de planejamento): *"um toggle nas configurações globais
para selecionar se a probabilidade considerada deve ser a forçada ou a calculada
em tempo real"*. Só que hoje **cada família de painel usa uma fonte diferente**, e
um toggle ingênuo que trocasse tudo de uma vez mudaria números que hoje batem:

| Família | Fonte de probabilidade HOJE | Régua no catálogo |
|---|---|---|
| Forecast (`/forecast`, `/forecast-overall` + etapas, `/forecast-delta`) | **Forçada** (régua flat validada; RA/Diag 6%, Cotação 18,6%…) | `forecast_flat` |
| CRO (`/novo`) e Board | **Calculada** (C07 do funil, por pipeline, amostra mínima 20) com fallback na régua default | `calculada_funil` → `painel_default` |
| AE | Régua default fixa | `painel_default` |

Em todas: override manual do usuário (Configurações) vence qualquer fonte, e o
ajuste ±10% pela probabilidade do AE se aplica depois.

## Proposta: o toggle escolhe a PREFERÊNCIA, cada painel declara o que respeita

**Config global** (Configurações, persistida — na Fase 4 vai a KV):

```
Probabilidade de etapa:  ( ) Premissas (régua forçada)   (•) Calculada ao vivo (funil)
```

**Semântica por família:**

1. **CRO/Board/AE** — passam a respeitar o toggle de verdade:
   - `Calculada` (default — comportamento atual do CRO/Board): C07 do funil por
     pipeline; sem amostra → régua `painel_default`.
   - `Premissas`: régua `painel_default` direto, sem C07.
   - Efeito colateral bom: o AE (hoje fixo na régua) fica consistente com CRO/Board.
2. **Forecast** — a régua flat É uma premissa validada com o CRO e o número vai a
   board. Proposta: o Forecast **declara que ignora o toggle** (drawer mostra:
   "fonte: régua flat validada | este painel não responde ao toggle global") até
   validarmos com o Ivan que a calculada faz sentido lá. Alternativa mais
   agressiva (não recomendada agora): posição `Calculada` também troca o Forecast
   → mudaria o forecast oficial da empresa com um clique.
3. **Defaults reproduzem o comportamento atual** (gate da Fase 4): toggle nasce em
   `Calculada`, Forecast fora do toggle → nenhum número muda no dia do deploy.

## O que a decisão muda na prática

- **Você decide 1:** Forecast dentro ou fora do toggle? (recomendo FORA na v1)
- **Você decide 2:** o AE deve mesmo passar a seguir o toggle (ganha C07) ou manter
  régua fixa? (recomendo seguir o toggle — elimina a 3ª fonte)
- **Você decide 3:** onde persiste — KV global (todos veem igual — recomendo) ou
  por navegador como hoje (`localStorage`, cada um vê um número ≠, que é o
  anti-padrão que o 2.0 mata)?
- **D4 — DECIDIDA pelo dono (2026-07-15):** régua forçada ÚNICA. Nas palavras
  dele: *"se precisarmos de um fallback, a gente usa a probabilidade hardcoded,
  que vai ter que ser a mesma"*. Ou seja: a `painel_default` é aposentada; a régua
  única (a flat validada do Forecast) vale como premissa E como fallback do C07.
  Efeito nos números: fallbacks de CRO/Board/AE mudam onde o C07 não tem amostra
  (etapas com amostra >= 20 não mudam, pois o C07 vence).

- **D4b — desdobramento em aberto (a única pendência da D4): Implantação = 80% ou 100%?**
  A régua única precisa de UM valor, e hoje existem dois legítimos:
  | Opção | O que acontece |
  |---|---|
  | **80%** (valor do Forecast validado) | O Forecast não muda; REVERTE a decisão de 14/07 nos painéis (Implantação volta a não ser "já ganho" na ponderação) |
  | **100%** (decisão de 14/07, "implantação já é ganho") | Painéis não mudam; o FORECAST OFICIAL passa a ponderar Implantação a 100% → a Receita Probabilizada de deals em Implantação sobe ~25% |
  | **Exceção declarada** | Régua única para tudo, MENOS Implantação (um valor por contexto, declarado no catálogo e visível no drawer) — menos limpo, zero surpresa nos números |
  Sem D4b decidida, a implementação da régua única não começa.

## Implementação (quando aprovado)

- A escolha vive em `referencia.json` (default) + KV (valor corrente, com meta
  ADR-004); consumidores leem via `prob-engine`/`SEMANTIC_REF`.
- Drawer de cada gráfico afetado passa a declarar a fonte EM USO (campo
  "ponderação" do contrato ADR-006) — o número nunca fica sem explicação.
- Gate: capture-charts nas DUAS posições do toggle + paridade na posição default.
- Limpeza dos overrides legados (`novo_stage_prob`/`forecast_stage_prob`) na
  migração, como o fix de 2026-07-14 já faz no /forecast.
