# Workload | trocar o medallion pelo armazém canônico

Estado em 13/08/2026. Complementa `docs/fonte-unica-hubspot.md`, que cobre a
migração dos outros 9 endpoints.

## Onde a tela está hoje

`/novo-bdr/workload` lê o **medallion** (`axenya_sales_hubspot_bdr_prd_sae1_gold`,
Cloud Run Job `bdr-etl-job`, 20:00 em dia útil) em quatro endpoints |
`bdr-workload-semantic`, `-drill`, `-penetration` e `-compare` | mais um overlay
ao vivo do HubSpot para hoje.

O **armazém** (`axenya_hubspot_prd_*`, reconcile 06:30 + botão Atualizar, 83
checks) já serve o mesmo bloco de ritmo por outro caminho, com
`gold.mart_bdr_touch` no grão de toque e `gold.mart_bdr_workload_dimension_daily`
como o `GROUP BY` dele.

## O que está provado

Medido em 13/08/2026, janela de 14/07 a 12/08, dias úteis, roster de 13 BDRs.
Reproduza com `node scripts/compare-workload-sources.js --adc`.

| Métrica | medallion | armazém | veredito |
|---|---:|---:|---|
| Ligações | 7.378 | 7.378 | bate |
| E-mails | 5.801 | 5.801 | bate |
| LinkedIn | 871 | 871 | bate |
| Reuniões | 164 | 164 | bate |
| Conectadas / sem resposta / ocupado / número errado / sem desfecho | 567 / 3.765 / 2.577 / 58 / 128 | idem | bate nos cinco |
| **WhatsApp manual** | **2.755** | **2.755** | **bate** |
| WhatsApp total | 3.706 | 2.755 | delta 951 = Treble do medallion |
| Atividades | 17.920 | 16.969 | mesmo delta de 951 |
| WhatsApp automação | 951 | 454 | **discordam em 52%** |
| Empresas tocadas | 5.183 | 4.952 | 4,5% em aberto |
| Contatos tocados | 7.501 | 7.381 | 1,6% em aberto |

A linha que autoriza a troca é o **WhatsApp manual**: nenhuma mensagem digitada
por gente se perde. O que sai do total é automação, pela régua de 10/08/2026 |
automação não é esforço do BDR, ninguém digitou.

**Quebra de série a declarar antes de virar:** WhatsApp cai de 3.706 para 2.755 e
atividades de 17.920 para 16.969. Sem a premissa escrita, quem abrir a tela vai
achar que o time produziu menos.

**Automação por BDR não é comparável entre as fontes.** O medallion credita 951
disparos ao roster e o armazém 454. O Treble grava `communications` sem
`hubspot_owner_id`, então nenhum dos dois sabe quem enviou: o armazém infere pelo
dono no INSTANTE do toque, o medallion pelo dono ATUAL. Não muda esforço em
nenhuma das réguas | mas invalida ler "automação por BDR" como se fosse um número
só. Foi o terceiro caminho do `compare-workload-sources.js` que achou isso: a
primeira versão da asserção dizia que o delta seria a automação do armazém, e
reprovou.

**O armazém enxerga hoje e o medallion não.** Em 13/08 às 15h: 298 atividades do
roster no armazém contra 8 no medallion, que só roda às 20:00.

## O que ainda NÃO migra

Sem mart no armazém, e por isso o endpoint é híbrido em vez de trocar de tabela:

| Bloco | Precisa de | Já existe no armazém? |
|---|---|---|
| Inserção (empresas/contatos criados) | mart novo, grão dia × dono × dimensão | `dim_company`/`dim_contact` têm `hs_created_at` + dono |
| CRM (tentativa, conectado, qualificado, desqualificado) | mart novo | `fact_stage_entry` de lead já tem tudo |
| SQL | projetar no grão dimensional | `mart_bdr_performance_parity_daily.sql_deals` |
| Penetração / Reatividade | reapontar o endpoint | **`gold.mart_account_cohort` já existe** e reproduz `bdr_workload_reactivity_v2` |

Penetração é o próximo degrau mais barato: o mart está pronto e sem consumidor.

## Como virar

O payload declara a camada por bloco em `source.camadas` e as premissas em
`source.premissas`. `?fonte=armazem` é opt-in; o default segue medallion, então
nada muda em produção até alguém decidir.

Ordem obrigatória, porque o SQL é assado na imagem do Cloud Run:

1. **ETL primeiro.** As 5 colunas de desfecho de ligação
   (`calls_no_answer_total`, `busy`, `wrong_number`, `no_outcome`,
   `connected_missing_duration`) foram adicionadas ao mart dimensional no vault
   (`hubspot-platform/sql/20_gold.sql`) e ainda não estão no BigQuery. Exige
   `gcloud builds submit` + `gcloud run jobs update` nos **dois** Jobs
   (`hubspot-platform-reconcile` e `hubspot-platform-close`). Mexer no BQ à mão é
   revertido no próximo run.
2. Rodar `node scripts/compare-workload-sources.js --adc` e conferir que passa.
3. Só então trocar o default de `fonte` (ou pôr o parâmetro no front).

Enquanto o passo 1 não acontecer, `?fonte=armazem` **cai de volta no medallion** e
diz o motivo em `source.fallbackErro` e no check `fonte_ritmo` | preferível a
devolver zero calado nos cards de desfecho, que é o modo de falha do `/calls/v1`
que matou o card inteiro em produção sem nunca dar erro.
