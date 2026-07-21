# Prompt — Fazer o Treble ser contado como WhatsApp no BDR Workload

> Cole este prompt numa sessão de Claude Code aberta em
> `15_Workspaces/Pipeline_Dashboard/dashboard-pipeline`. Contexto e regras estão em
> `docs/treble-whatsapp-attribution-decision.md`.

## Objetivo

Passar a contar os disparos de WhatsApp do **Treble** (communications
`hs_object_source = INTEGRATION`, app id `26063081`, `hubspot_owner_id = null`) como
atividade de WhatsApp do BDR, atribuindo pelo **dono do contato associado**.

## Estado atual

- WhatsApp = communications `hs_communication_channel_type='WHATS_APP'` agrupadas por
  `hubspot_owner_id`. Treble tem owner nulo → hoje é ignorado.
- Camada live: `api/bdr-workload.js` (`buildPayload` → agrega `communications` por owner;
  props buscadas incluem `hs_communication_channel_type`, `hubspot_owner_id`).
- Janelas fechadas: gold `bdr_workload_daily_dimension_v2.whatsapp_total`, populado pelo
  Cloud Run Job de ETL (imagem `*-workload-v2-schema-fix*`).
- Semantic: `api/bdr-workload-semantic.js` só soma `whatsapp_total` do gold + overlay live.

## Mudança pedida

1. **Atribuição por contato associado.** Para comms WHATS_APP sem owner (ou com
   `hs_object_source=INTEGRATION` e source_id `26063081`), resolver
   `communication → association contacts → contato.hubspot_owner_id` e atribuir ao BDR
   dono, restrito ao roster (`lib/bdr-team.js`). Sem contato de BDR do roster → não conta.
2. **Segregar manual × automático.** Introduzir `whatsapp_manual` (CRM_UI) e
   `whatsapp_treble` (INTEGRATION 26063081); manter `whatsapp = manual + treble` para não
   quebrar consumidores. Expor os dois no drill/tooltip.
3. **Live (`api/bdr-workload.js`):** ao buscar communications, incluir as sem owner e
   resolver owner via contato associado (batch de associações, como já é feito para
   `activity_associations`). Não estourar rate limit — reusar o helper de associação.
4. **Gold/ETL (Cloud Run Job):** replicar a mesma atribuição na origem do
   `whatsapp_total` (bridge activity→contact→owner). Adicionar colunas
   `whatsapp_manual_total` e `whatsapp_treble_total`. Reprocessar histórico.
5. **Semantic/UI:** sem mudança de contrato além dos novos campos; o card/coluna WhatsApp
   passa a incluir Treble automaticamente. Atualizar a memória de cálculo (INFO da aba
   Canais e Pulso) explicando "WhatsApp = manual (CRM_UI) + Treble (automático)".

## Casos de borda

- Comm Treble associada a contato **sem owner** ou owner fora do roster → não conta
  (registrar em `desconhecido`, não somar ao BDR).
- Comm com múltiplos contatos → usar o contato primário; se ambíguo, o de owner no roster.
- Não recontar: garantir que a comm não seja contada duas vezes (manual vs treble são
  mutuamente exclusivos por `hs_object_source`).
- Direção: manter só saída (excluir inbound, como e-mail), se houver campo de direção.

## Testes / gates

- `scripts/test-bdr-workload-v2.js`: adicionar fixture de comm Treble (owner null +
  contato de BDR) e assertar que soma em `whatsapp` e `whatsapp_treble` do BDR dono do contato.
- `npm run check` PASS.
- Reconciliação: total WhatsApp por BDR (live) ≈ CRM_UI(owner) + INTEGRATION(via contato).
- Validar com screenshot as abas Pulso/Canais/Gestão.

## Deploy

- Branch main, `npm run predeploy` PASS, `npx vercel deploy --prod --yes --scope axenya-f1a041f6`.
- Registrar no `STATUS_LOG.md` (deploy id + antes/depois do WhatsApp por BDR).
- Reprocessar o gold ANTES/junto para 7/30d baterem com o live.
