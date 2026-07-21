# BDR Workload v2 — implementação

Data: 2026-07-20
Branch: `feat/bdr-workload-v2-2026-07-20`

## O que foi implementado

- Shell v2 em `public/bdr-workload-v2.js`, carregado por padrão em `public/bdr-workload.html`.
- Fallback v1 preservado via `?workload=v1`.
- Feature flag autenticada e fail-closed via `/api/bdr-workload-config`: somente `BDR_FLAG_WORKLOAD_V2=true|1|on|yes` habilita a v2; ausente mantém o fallback v1.
- Cinco abas: Pulso & Reatividade; Atividades & Canais; Gestão por BDR; Penetração & ICP; Evolução A×B.
- Filtros sticky/persistidos na URL: período, datas, BDR, dias úteis, canal, porte e aba. Segmento/persona aparecem desabilitados com motivo.
- Experiência v2 sem visual de meta, `% meta`, gap ou semáforo de meta. Compatibilidade v1 mantida no arquivo legado.
- APIs v2 autenticadas, fail-closed e testáveis:
  - `/api/bdr-workload-semantic?v=2`
  - `/api/bdr-workload-penetration?v=2`
  - `/api/bdr-workload-compare?v=2`
- Testes unitários/contrato sem rede em `scripts/test-bdr-workload-v2.js`.
- Hoje é agregado do HubSpot live no servidor e substitui a linha Gold do dia; períodos fechados usam BigQuery. O payload nominal live nunca chega à resposta v2.
- Gestão usa baseline do período anterior equivalente e ordenação por delta assinado.
- Ligações por BDR carregam breakdown lazy de total, conversas ≥1 min, discagens, taxa, desfecho e duração.
- `/api/bdr-workload-calls` retorna somente agregados por padrão; detalhe nominal exige `detail=1`, paginação e `limit<=50`.

## Limitações reais documentadas

1. Reatividade está bloqueada/degradada. O modelo atual não possui associação auditável `entry -> first real touch` no grão `contact_id × owner_assignment_spell`; Silver activities não tem contact/company. A UI e a API declaram cobertura 0 e não inventam proxy.
2. Penetração usa `axenya_commercial_intel_prd.vw_dash_bdr_penetration_v1` e denomina explicitamente o snapshot observado. Não há população elegível completa fora da view atual.
3. Segmento e persona estão desabilitados porque o schema confirmado da view de penetração não possui esses atributos.
4. A comparação A×B lê Gold `bdr_daily_ops`; porte/segmento/persona retornam 400 no compare atual para evitar filtro ignorado silenciosamente.
5. `gold.bdr_daily_ops` possui somente cinco canais, `leads_created` e `sql_deals` entre as métricas usadas nesta v2. Ela não possui `companies_created`, `contacts_created`, `status_transitions` nem `connected_transitions`; por isso empresas, CRM e contato efetivo aparecem como indisponíveis/unsupported, nunca como zero.
6. Os domínios A×B suportados são `ritmo`, `insercao` (via `leads_created`) e `sql`. `crm` e `contato_efetivo` retornam 400 até existir semantic layer confiável.
7. `source.refreshedAt` vem de `MAX(refreshed_at)` em Gold ou `MAX(last_touch_date)` na view de penetração; não usa horário atual como freshness.
8. Associação penetração→SQL é observacional; correlação não implica causalidade. Confundidores declarados: porte, qualidade da carteira e maturação/timing.
9. E-mails incoming são excluídos do ritmo live quando `hs_email_direction` está disponível.
10. A comparação normaliza por dia útil quando as janelas diferem em mais de dois dias e preserva deltas assinados.
11. Hoje×ontem na aba Evolução permanece baseado no último snapshot Gold e é rotulado como comparação parcial não equivalente; o Pulso é a visão live.
12. Penetração é experimental e usa snapshot observado; bucket 0 não representa toda a carteira elegível.

## Segurança

- Todas as APIs v2 usam `requireAuth` e retornam 401 sem sessão.
- Payloads agregados não retornam nomes/cargos/IDs de contatos, e-mails ou telefones.
- Queries usam parâmetros nomeados para datas e filtros dinâmicos suportados.
- Drills nominais permanecem no endpoint legado de ligações e não foram ampliados.

## Rollback

- Rollback imediato sem deploy de código: abrir a rota com `?workload=v1`.
- Rollback de release: remover o script `/bdr-workload-v2.js?v=1` do HTML e restaurar o bootstrap automático do v1.
- Endpoints v2 são aditivos; remover os três arquivos novos não afeta v1.

## Verificação local

Comandos esperados:

```bash
npm run check
node scripts/test-bdr-workload-v2.js
```
