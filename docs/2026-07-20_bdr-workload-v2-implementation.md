# BDR Workload v2 — implementação

Data: 2026-07-20
Branch: `feat/bdr-workload-v2-2026-07-20`

## O que foi implementado

- Shell v2 em `public/bdr-workload-v2.js`, carregado por padrão em `public/bdr-workload.html`.
- Fallback v1 preservado via `?workload=v1`.
- Feature flag autenticada e fail-closed via `/api/bdr-workload-config`: somente `BDR_FLAG_WORKLOAD_V2=true|1|on|yes` habilita a v2; ausente mantém o fallback v1.
- Cinco abas: Pulso & Reatividade; Atividades & Canais; Gestão por BDR; Penetração & ICP; Evolução A×B.
- Filtros sticky/persistidos na URL: período, datas, BDR, dias úteis, canal, porte, segmento, persona e aba. BDR, porte, segmento e persona são selects preenchidos por `filterOptions` reais das APIs.
- Experiência v2 sem visual de meta, `% meta`, gap ou semáforo de meta. Compatibilidade v1 mantida no arquivo legado.
- APIs v2 autenticadas, fail-closed e testáveis:
  - `/api/bdr-workload-semantic?v=2`
  - `/api/bdr-workload-penetration?v=2`
  - `/api/bdr-workload-compare?v=2`
- Testes unitários/contrato sem rede em `scripts/test-bdr-workload-v2.js` e teste estático de UI em `scripts/test-bdr-workload-v2-ui.js`.
- Hoje é agregado do HubSpot live no servidor e substitui a linha Gold do dia; períodos fechados usam BigQuery. O payload nominal live nunca chega à resposta v2.
- Gestão usa baseline do período anterior equivalente e ordenação por delta assinado.
- Ligações por BDR carregam breakdown lazy de total, conversas ≥1 min, discagens, taxa, desfecho e duração.
- `/api/bdr-workload-calls` retorna somente agregados por padrão; detalhe nominal exige `detail=1`, paginação e `limit<=50`.

## Limitações reais documentadas

1. Reatividade é lida da semantic layer e exibida como p50, p75, cobertura e buckets, sem expor dados pessoais.
2. Penetração usa denominador elegível, contatos elegíveis, contatos tocados, toques reais, buckets exatos/agrupados, breakdown por porte/segmento/persona e associação com n e IC95%.
3. Segmento e persona são filtros reais vindos de `filterOptions` e permanecem selecionados ao atualizar as respostas.
4. A comparação A×B lê o endpoint compare v2 e preserva filtros globais suportados.
5. A semantic layer expõe cinco canais, inserções, CRM, contato efetivo, qualificação, desqualificação e SQL; a UI nunca recalcula dado nominal no cliente.
6. Os domínios A×B suportados na UI são `ritmo`, `insercao`, `sql`, `crm` e `contato_efetivo`.
7. `source.refreshedAt` vem de `MAX(refreshed_at)` em Gold ou `MAX(last_touch_date)` na view de penetração; não usa horário atual como freshness.
8. Associação penetração→SQL é observacional; correlação não implica causalidade. Confundidores declarados: porte, qualidade da carteira e maturação/timing.
9. E-mails incoming são excluídos do ritmo live quando `hs_email_direction` está disponível.
10. A comparação normaliza por dia útil quando as janelas diferem em mais de dois dias e preserva deltas assinados.
11. Hoje×ontem na aba Evolução permanece baseado no último snapshot Gold e é rotulado como comparação parcial não equivalente; o Pulso é a visão live.
12. Penetração apresenta zero real dentro do denominador elegível retornado pela API e mantém filtros ativos no drill por bucket.

## Segurança

- Todas as APIs v2 usam `requireAuth` e retornam 401 sem sessão.
- Payloads agregados não retornam nomes/cargos/IDs de contatos, e-mails ou telefones.
- Queries usam parâmetros nomeados para datas e filtros dinâmicos suportados.
- Drills usam `/api/bdr-workload-drill` com allowlist de `kind` e `context`; a tabela do modal renderiza apenas linhas sanitizadas retornadas pela API.

## Rollback

- Rollback imediato sem deploy de código: abrir a rota com `?workload=v1`.
- Rollback de release: remover o script `/bdr-workload-v2.js?v=1` do HTML e restaurar o bootstrap automático do v1.
- Endpoints v2 são aditivos; remover os três arquivos novos não afeta v1.

## Verificação local

Comandos esperados:

```bash
npm run check
node scripts/test-bdr-workload-v2.js
node scripts/test-bdr-workload-v2-ui.js
```

## Convergência da sessão | release 2.2

Entregue nesta rodada:

- semantic layer GCP com ritmo, inserção, CRM, SQL, reatividade e dimensões;
- bucket zero sobre empresas elegíveis;
- filtros reais de porte, segmento e persona;
- APIs de compare e drill paginado/sanitizado;
- cinco abas com componentes temporal, stacked, ranking, grouped e waterfall;
- cards, pontos, barras e células com drill;
- testes de contrato e UI incluídos no `npm run check`.

### Fallback live A×B e visual KPI | 2026-07-21

- Causa raiz dos gráficos zerados: Evolução A×B usa `/api/bdr-workload-compare`, que lia só BigQuery; quando a janela contém hoje e ainda não existe snapshot, o período ficava zero apesar do Pulso live.
- Fallback implementado somente para `domain=ritmo` via `_service.liveRowsForToday`: se A ou B contém hoje e a linha BQ de hoje está ausente/zerada, o endpoint injeta linhas agregadas por BDR vindas do live sem PII. Linhas históricas anteriores do mesmo período são preservadas; linhas BQ zeradas de hoje são removidas antes do live. Em fim de semana com `businessDays=true`, o fallback não aplica.
- O fallback não é aplicado para CRM, SQL ou inserção, nem quando `porte`/`segmento`/`persona` estão ativos, porque o live agregado não carrega essas dimensões com qualidade suficiente.
- `source` e `quality` retornam `liveFallbackUsed` e mensagens explícitas de uso/bloqueio.
- `.v2-kpi-main` corrigido para botão transparente, sem bloco branco, com foco acessível.

### Backlog residual | implementação local parcial (2026-07-21)

- Aba Canais agora calcula o período anterior equivalente pela duração completa da janela atual e exibe A/B no subtítulo do card; a memória de cálculo explicita a regra.
- Drill de penetração aceita buckets agrupados `2–3` e `4–5` ponta a ponta, mantendo buckets exatos `0`, `1`, `2`, `3`, `4`, `5`, `6+`. A API usa allowlist estrita e parâmetros nomeados `@bucketMin`/`@bucketMax`.
- O release gate browser persistente é `scripts/smoke-bdr-workload-v2-browser.js`: Chrome headless via CDP e zero dependências, por restrição de supply chain. Não usa nem declara Playwright. Default: `http://localhost:3002`; override: `--base-url=http://localhost:3002`.
- O gate cobre cinco abas, filtros/estado de aba, drawers de memória, drill/modal e ausência de exceções/console errors.
- Modularização real e limitada aplicada: `bdr-workload-v2-core.js` expõe constantes/utilitários/contexto em `window.WorkloadBDRV2Core`; `bdr-workload-v2-charts.js` expõe renderers SVG/tabela em `window.WorkloadBDRV2Charts`; `bdr-workload-v2.js` preserva `window.WorkloadBDRV2` como API pública e bootstrap/feature flag/fallback v1.

### Backlog residual documentado

1. Executar release gate Playwright completo e persistente nas cinco abas após deploy;
   o último smoke longo da sessão foi interrompido.
2. Refinar o comparativo de Canais para tornar o período anterior equivalente visível
   também no subtítulo e na memória de cálculo.
3. Adicionar drill agregado específico para buckets agrupados `2–3` e `4–5`; hoje o
   drill exato 0/1/2/3/4/5/6+ é o contrato canônico.
4. Aumentar cobertura dimensional dos toques recentes. O fallback Medallion mantém
   atividade auditável, mas usa `desconhecido` quando a CI ainda não tem associação.
5. Refatorar o frontend v2 em módulos legíveis; o arquivo permanece autocontido para
   compatibilidade com a arquitetura estática atual.
