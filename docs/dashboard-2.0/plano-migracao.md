# Plano de migração 1.0 → 2.0 | fases auditáveis

> Estratégia: *strangler fig* ([ADR-001](decisoes-adr.md)). A camada semântica nasce
> dentro do repo por extração do que existe; painéis passam a consumi-la só quando a
> paridade for provada. Nenhuma fase reescreve painel funcionando. Cada fase é
> **terminal**: parar em qualquer uma deixa o projeto melhor que antes, não pela
> metade.

## O que já É 2.0 (inventário — não construir de novo)

| Conceito do 2.0 | Já existe no 1.0 | Lacuna |
|---|---|---|
| Fonte única incluída do menu (§4.6) | `public/nav.js` | subpáginas BDR ainda em `premium.js`/`NAV_MODEL` (segunda fonte) |
| Camada de regras de receita | `forecast-engine.js` + `revenue-engine.js` + `faturamento-manual.js` | definições em prosa/código, não em catálogo |
| Snapshot + recompute determinístico | `api/snapshot` + fotos + `referenceDate` (Delta 1A) | faturamento manual não é ponto-no-tempo |
| Bilíngue via `t()` | dicionários PT/EN nos painéis | duplicados por HTML |
| Persistência fora do código | Upstash KV | sem metadados (quem/quando/anterior) |
| Drawer de proveniência | botão "i" + `NOVO_HELP_CHARTS` | escrito à mão (oposto do contrato §4.7) |
| Harness de validação | porta 3002 + `npm run check` + `_capture-charts.js` + `test-delta-invariant.js` | — (é o instrumento dos gates) |

## O harness de paridade (instrumento de todos os gates)

Religação de consumo (fase 2+) só fecha quando, **antes/depois da mudança**:

1. `scripts/_capture-charts.js` produz datasets idênticos nos painéis afetados;
2. `scripts/test-delta-invariant.js` passa para todos os pares de fotos;
3. `GET /api/history?action=compare` retorna payload idêntico para um par fixo de fotos;
4. `npm run check` passa;
5. inspeção visual no 3002 das rotas afetadas.

Divergência achada no "antes" é bug pré-existente: registrar em
`AUDITORIA_GRAFICOS.md`, não mascarar na migração.

## Regras vigentes que amarram a execução

ES5 puro sem bundler/npm no front · separador `|` · todo gráfico/KPI novo nasce 🟡 ·
uma linha no `STATUS_LOG.md` por iteração · coordenação de sessões paralelas
(compartilhados = território exclusivo + restart do 3002) · commit por entrega
validada · deploy só via `/axenya-deploy`.

---

## Fase 0 | Charter + decisões

- **Objetivo:** fundação documental; saber o que o dash responde e o que já foi decidido.
- **Entregável:** esta pasta (`docs/dashboard-2.0/`): README, charter (20 perguntas),
  ADRs 001–011, este plano, cópias congeladas dos docs-fonte.
- **Gate:** dono aprova o charter e os ADRs propostos (003, 009).
- **Risco:** charter genérico que não filtra nada. Mitigação: cada pergunta aponta
  cobertura real (✅/🟠/⬜) e painel de origem.
- **Rollback:** deletar a pasta.

## Fase 1 | Os 3 arquivos base, por extração

- **Objetivo:** cada dado, regra e referência definido **uma vez**, máquina-legível.
- **Entregável:** `semantic/referencia.json` (pipes com **as 12 etapas do BID**,
  etapas Vendas, times AE/BDR com IDs, réguas de probabilidade forçada),
  `semantic/dados.json` (campos HubSpot com label PT/EN, unidade, origem, dono),
  `semantic/regras.json` (régua de remuneração completa das Premissas, receita
  real/probabilizada, dedup fee×corretagem, conversão ajustada — com `tipo`,
  `vigente_desde`, `status: em_revisao`). Fontes de extração: `fonte/Premissas do
  Dash.md`, os engines, os textos de drawer atuais. Mais `scripts/check-semantic.js`
  (consistência interna + drift contra IDs hardcoded no código) plugado no
  `npm run check`.
- **Gate:** check passa; dono revisa o catálogo pela visualização legível
  (ADR-003); **nenhum byte de painel/engine muda** (diff restrito a `semantic/`,
  `scripts/`, docs).
- **Risco:** catálogo especulativo. Mitigação: só entra o que o 1.0 já usa.
- **Rollback:** deletar `semantic/`.

## Fase 2 | Primeiro consumidor real: referência

- **Objetivo:** IDs de pipe/etapa/probabilidade-premissa param de ser hardcoded.
- **Entregável:** engines e APIs lendo `referencia.json` (no front, injetado como
  JS ES5 gerado a partir do JSON — sem fetch novo, sem bundler). Um consumidor por
  vez, commit por consumidor.
- **Gate:** harness de paridade completo (acima), antes/depois idênticos.
- **Risco:** raio de explosão dos compartilhados. Mitigação: território exclusivo,
  restart do 3002, sessão única nos arquivos tocados.
- **Rollback:** revert do commit do consumidor divergente (os demais ficam).

## Fase 3 | Drawer gerado do catálogo (golden template: `/forecast`)

- **Objetivo:** provar o contrato ADR-006 ponta a ponta em UM painel.
- **Entregável:** gerador de drawer (11 campos + condicionais) alimentado pelos 3
  arquivos; métricas do `/forecast` catalogadas; drawers à mão do painel aposentados.
- **Gate:** cada "i" do Forecast mostra os 11 campos, filtro temporal nomeando a
  propriedade-alvo; auditoria manual do dono gráfico a gráfico confirma que o
  drawer descreve o comportamento real.
- **Risco:** catálogo dizer uma coisa e o código fazer outra. Mitigação: a auditoria
  do gate compara com comportamento observado, não com intenção.
- **Rollback:** flag que volta o painel ao drawer antigo (mantido até o gate).

## Fase 4 | Dado manual de primeira classe + configs globais declaradas

- **Objetivo:** nada manual se disfarça de dado duro; as duas configs pendentes
  viram fonte única.
- **Entregável:** (a) metadados no KV + selo ✏️ + badge de envelhecimento + log
  (ADR-004) para faturamento manual e metas; (b) **etapas ativas configuráveis**
  (ADR-007); (c) **toggle global probabilidade forçada × calculada** (ADR-008),
  com limpeza dos overrides legados.
- **Gate:** editar meta deixa rastro consultável; alternar o toggle de
  probabilidade muda TODOS os consumidores de forma consistente (verificado por
  capture-charts nas duas posições); paridade na posição default.
- **Risco:** o toggle expor divergências latentes entre painéis. Isso é objetivo,
  não efeito colateral — divergência achada = bug documentado.
- **Rollback:** defaults reproduzem o comportamento atual; revert por item.

## Fase 5 | Componente de gráfico parametrizado (só para o novo)

- **Objetivo:** gráfico = `renderChart(metric_id, opts)` consumindo catálogo +
  tokens + `t()` + drawer automático.
- **Entregável:** o componente ES5 + primeiro uso real (um gráfico novo ou um
  existente já em reforma). **Regra de corte:** todo gráfico novo nasce nele;
  existentes só migram oportunisticamente, cada um com gate próprio.
- **Gate:** o mesmo gráfico renderiza em dois painéis sem copiar código; drawer sai
  de graça do catálogo.
- **Rollback:** componente é aditivo; gráfico migrado reverte individualmente.

## Fase 6 | Manifestos + novos domínios

- **Objetivo:** painel novo = config, não engenharia.
- **Entregável:** formato de manifesto declarativo + primeiro painel novo
  (Marketing ou executive snapshot — pergunta 20 do charter) construído só de
  manifesto + catálogo + componente.
- **Gate:** o painel novo não exigiu nenhuma decisão de arquitetura nova; números
  validados contra HubSpot (nasce 🟡 → 🟢 pela régua da AUDITORIA).
- **Rollback:** painel novo é aditivo (rota + manifesto).

## Fase 7 | Operacional (paralela, não sequencial)

| Item | Entregável | Gate |
|---|---|---|
| 7a Deploy GitHub↔Vercel + previews (ADR-009) | integração ativa, `main` protegido, guias atualizados | um ciclo completo push→preview→merge→prod sem `vercel --prod` manual |
| 7b Alerta de falha silenciosa | cron de snapshot reporta sucesso/falha em canal humano | falha simulada gera alerta em < 24h |
| 7c Fuso fixado (ADR-011) | auditoria dos cortes de mês + convergência na ingestão | caso 30/06 22h SP cai em junho em todos os painéis |
| 7d Telemetria de uso | contagem mínima de views por painel/gráfico | relatório de uso de 30 dias para guiar poda |

## Sequenciamento

```
Fase 0 ─▶ Fase 1 ─▶ Fase 2 ─▶ Fase 3 ─▶ Fase 4 ─▶ Fase 5 ─▶ Fase 6
                └─▶ 7a (após Fase 1, default ADR-009)
                    7b · 7c · 7d (paralelas, qualquer momento)
```

Ordem 3×4 é trocável sem custo se o selo ✏️ ficar urgente para o board.
