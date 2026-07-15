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
- **Você decide 4 (adicionada na sua revisão de 2026-07-15):** unificar as duas
  réguas forçadas numa só. Hoje `forecast_flat` (premissa validada do Forecast) e
  `painel_default` (fallback do C07 em CRO/Board/AE) têm VALORES diferentes
  (Cotação 18,6%×33%, Consultoria 28,5%×61,1%, Negociação 49,3%×42%). Proposta:
  a posição "Premissas" do toggle usa a **flat validada** como régua única e a
  `painel_default` é aposentada. Efeito: os fallbacks de CRO/Board/AE mudam de
  número quando o C07 não tem amostra (etapas com amostra >= 20 não mudam nada,
  pois o C07 vence). Recomendo aprovar junto com o toggle — é a mesma cirurgia.

## Implementação (quando aprovado)

- A escolha vive em `referencia.json` (default) + KV (valor corrente, com meta
  ADR-004); consumidores leem via `prob-engine`/`SEMANTIC_REF`.
- Drawer de cada gráfico afetado passa a declarar a fonte EM USO (campo
  "ponderação" do contrato ADR-006) — o número nunca fica sem explicação.
- Gate: capture-charts nas DUAS posições do toggle + paridade na posição default.
- Limpeza dos overrides legados (`novo_stage_prob`/`forecast_stage_prob`) na
  migração, como o fix de 2026-07-14 já faz no /forecast.
