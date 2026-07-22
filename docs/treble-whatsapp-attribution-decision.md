# Treble WhatsApp — decisão de contagem no BDR Workload

Data: 2026-07-21 · Área: Marketing/Growth ↔ Sales Ops · Origem: feedback do usuário no `/novo-bdr/workload`

## Contexto (como o WhatsApp é contado hoje)

No BDR Workload v2, o canal **WhatsApp** é a contagem de objetos `communications` do HubSpot
com `hs_communication_channel_type = 'WHATS_APP'`, **agrupados por `hubspot_owner_id`**
(camada live em `api/bdr-workload.js`; janelas fechadas via gold `bdr_workload_daily_dimension_v2`).

## Descoberta (verificada na API HubSpot, portal 44715285 — 2026-07-21)

As 13.340 communications de WhatsApp do portal se dividem em:

| Origem (`hs_object_source`) | Qtde | `hubspot_owner_id` | Conta hoje? |
|---|--:|---|---|
| `CRM_UI` (BDR loga manualmente) | 11.647 | preenchido (BDR) | **Sim** |
| `INTEGRATION` — **Treble** (source_id `26063081`) | 1.689 | **null** | **Não** |
| `API` | 0 | — | — |

Como a agregação é por owner e **as 1.689 comms do Treble têm owner nulo**
(leak check: `INTEGRATION + HAS owner = 0`), **os disparos automáticos do Treble hoje
NÃO são atribuídos a nenhum BDR** — logo, não aparecem no WhatsApp por BDR.

## Decisão

**Treble passa a SER considerada** como atividade de WhatsApp do BDR.
Racional: o disparo Treble é acionado em nome do BDR dono do contato e faz parte da
cadência de outbound; ignorá-lo subconta o esforço real de contato via WhatsApp.

### Regra de atribuição (por não ter owner próprio)

Atribuir cada comm Treble ao **BDR dono do contato associado** à communication
(`communication → contact → hubspot_owner_id`), restrito ao roster de BDRs (`lib/bdr-team.js`).
Comms sem contato associado a um BDR do roster ficam de fora (sem atribuição confiável).

### Segregação recomendada (manual × automático)

Contar Treble dentro de **WhatsApp**, mas manter distinção auditável:
`whatsapp_total = whatsapp_manual (CRM_UI) + whatsapp_treble (INTEGRATION 26063081)`.
Assim o total sobe, mas dá para separar esforço manual de automático em drill/tooltip.

## Impacto esperado

- WhatsApp por BDR sobe (redistribui ~1.689 comms históricas pelo dono do contato).
- KPIs de "Volume", "Canal dominante" e o ranking de Gestão mudam.
- Necessário refazer o gold (ETL) para as janelas fechadas ficarem consistentes com o live.

## Status: IMPLEMENTADO (2026-07-21)

- **Live** (`api/bdr-workload.js` → `fetchTrebleWhatsapp`): busca WHATS_APP owner-nulo, resolve pelo dono do contato, soma em WhatsApp com `treble=true`. Semantic segrega `whatsappManual`/`whatsappTreble`.
- **Gold/ETL** (`hubspot-bdr-medallion`): `extract_treble_whatsapp` + ramo `treble` em `bdr_workload_touch_base_v2` + colunas `whatsapp_treble_total`/`whatsapp_manual_total`. Reprocessado 365d (imagem `20260721-treble-whatsapp`): MECE ok, Treble 365d=1.202.
- Ver `STATUS_LOG.md` (entrada 2026-07-21 "Treble passa a contar como WhatsApp do BDR").

Ver: [[treble-hubspot-realtime-pipeline]] · `STATUS_LOG.md` (entrada 2026-07-21 lineage WhatsApp/Treble).
