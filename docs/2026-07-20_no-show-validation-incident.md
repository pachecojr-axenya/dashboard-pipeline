# Incidente de validação | BDR No Show | 2026-07-20

## Resumo

Três iterações chegaram à produção sem um smoke funcional autenticado do gráfico. O HTML respondia `200`, mas isso não provava que a API carregava dados nem que o clique alterava o SVG. Depois, um fallback `sdr || ae` misturou Executivos de Conta no recorte de BDR. Por fim, ranking histórico, ranking operacional e tabela usavam universos diferentes sem explicitar isso.

## Sequência observada

1. `018802e` adicionou os botões `Todos | Por BDR | Por canal | Por porte`, mas o handler atualizava apenas a legenda. Não havia regeneração do gráfico.
2. O ambiente local retornava `503` porque foi usado o secret errado. O check feito foi apenas da rota HTML, não da API autenticada.
3. `9cc4d27` levou a implementação real de múltiplas linhas. A mensagem do commit atribuiu o problema ao fechamento da variável local `rows`, mas closures JavaScript preservam essa variável; o diagnóstico estava errado.
4. `fc73256` adicionou média e texto de debug antes da reconciliação dos universos métricos.
5. `5d748a8` introduziu `deal.sdr || deal.ae`, fazendo AEs aparecerem como BDRs.
6. O ranking fora do SLA contava perdidos e reagendados, enquanto a tabela operacional excluía parte desses estados. Por isso apareciam vários `100% fora do SLA` sem reconciliação com a tabela.

## Auditoria de dados reais

Recorte 2026-03-01 a 2026-07-20, payload local autenticado:

- 676 reuniões com data no payload.
- 558 reuniões atribuídas aos 13 BDRs do roster canônico.
- 118 reuniões com SDR fora do roster; excluídas das métricas por BDR e expostas como alerta de qualidade.
- 456 reuniões canônicas com desfecho conhecido | cobertura 81,7%.
- 201 no-shows históricos | incidência 44,1% sobre desfechos conhecidos.
- 18 no-shows ainda abertos | 18 fora do SLA.
- Após a correção, `ranking fora SLA = linhas fora SLA da tabela operacional`.

Últimos 30 dias (2026-06-20 a 2026-07-20):

- 74 reuniões canônicas.
- 41 com desfecho conhecido | cobertura 55,4%.
- 10 no-shows históricos | incidência observada 24,4%.
- 8 no-shows abertos | 8 fora do SLA.
- Os 13 BDRs têm reuniões, mas somente 5 têm no-show confirmado no recorte; a baixa cobertura impede interpretar os demais `0%` como melhora real.

## Causas-raiz

1. **200 não é smoke funcional.** A rota estática podia abrir enquanto `/api/forecast-table` retornava `503`.
2. **Sem teste de interação.** Não havia assertion de que clicar em `Por BDR` alterava o SVG e produzia 13 itens de legenda.
3. **Sem universos canônicos.** Histórico de no-show, backlog aberto e fora do SLA eram filtrados em lugares diferentes.
4. **Sem roster canônico no front.** O campo `sdr` foi tratado como nome livre, e depois o AE foi usado como fallback.
5. **Sem reconciliação numérica.** Ranking e tabela não tinham uma invariante automatizada.
6. **Telemetria insuficiente.** Em 1 dia, o probe registrou 32 eventos (31 success, 1 error), mas `session_id`, modelo, duração, tokens, task e tools ficaram 100% nulos. Portanto, `status=success` não prova qualidade nem execução dos gates.

## Gate obrigatório novo

Executar nesta ordem antes de qualquer deploy da página:

1. **Git/source of truth** | branch própria, working tree inspecionada, mudanças concorrentes isoladas.
2. **API local real** | iniciar `local-server.js` com o secret canônico `axenya-hubspot-pat-shared`; exigir `200` em `/api/forecast-table?...`.
3. **Domínio** | `node scripts/test-bdr-no-show.js`.
4. **Auditoria real** | `node scripts/audit-bdr-no-show.js --api-file <arquivo temporário> --from <data> --to <data>`; validar cobertura e invariantes.
5. **Browser funcional** | `npm run smoke:no-show`; o Chrome headless clica em `Por BDR` e exige:
   - 13 BDRs na legenda;
   - nenhum AE;
   - eixo `0% a 100%`;
   - ranking fora SLA igual à tabela operacional;
   - ausência de `130%`.
6. **Regressão do repo** | `npm run check` e `npm run predeploy`.
7. **Evidence ledger** | rodar os checks via `verify_evidence.py` e guardar os hashes.
8. **Reviewer code** | gate read-only após todos os checks.
9. **PR** | nunca deployar direto de uma sequência experimental na `main`.
10. **Deploy + smoke autenticado** | só após aprovação explícita; se o browser smoke falhar, rollback imediato.

O comando integrado `npm run gate:no-show` executa API local, `npm run check`, auditorias desde mar/26 e 30 dias, smoke Chrome e grava um evento sem PII em `80_System/Telemetry/no_show_release_gate.jsonl` com commit, branch, duração, status, hashes e métricas agregadas.

## Mudanças implementadas na correção

- Roster vem de `semantic/referencia.json` via `semantic-ref.js`.
- AEs nunca substituem BDRs.
- Reuniões fora do roster ficam fora das métricas por BDR e aparecem em alerta.
- Incidência histórica usa `no-shows ÷ desfechos conhecidos`; cobertura é mostrada.
- Semanas sem desfecho viram lacuna, não `0%`.
- Eixo percentual começa em `0%` e é limitado a `100%`.
- Visão geral ganhou média móvel ponderada de 4 semanas.
- A visão por BDR mantém os 13 nomes do roster, inclusive quando um recorte não tem dados.
- Série com zero no-show não desenha linha colorida no baseline; permanece na legenda como `0%` ou `sem desfecho`.
- Fora SLA inclui apenas no-show aberto; exclui perdido, recuperado e reagendado.
- Ranking fora SLA e tabela operacional reconciliam por construção e por smoke no DOM.

## Estado

Correção preparada em branch e ainda não deployada. A página fica 🟠 até revisão do dono dos números e validação pós-deploy.
