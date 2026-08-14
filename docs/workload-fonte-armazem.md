# Workload | trocar o medallion pelo armazém canônico

Estado em 13/08/2026. Complementa `docs/fonte-unica-hubspot.md`, que cobre a
migração dos outros 9 endpoints.

## Onde a tela está

**Ritmo e desfecho de ligação vêm do armazém** (`axenya_hubspot_prd_*`, reconcile
06:30 + botão Atualizar, 83 checks), via `gold.mart_bdr_touch` no grão de toque e
`gold.mart_bdr_workload_dimension_daily` como o `GROUP BY` dele.

**Inserção, movimento de CRM, SQL e Penetração seguem no medallion**
(`axenya_sales_hubspot_bdr_prd_sae1_gold`, Job `bdr-etl-job`, 20:00 em dia útil),
nos endpoints `-drill`, `-penetration` e `-compare`. Mais o overlay ao vivo do
HubSpot para hoje.

O `bdr-workload-semantic` é híbrido e declara a camada bloco a bloco em
`source.camadas`.

## O que está provado

Medido em 13/08/2026, janela de 14/07 a 12/08, dias úteis, roster de 13 BDRs.
Reproduza com `node scripts/compare-workload-sources.js --adc`.

| Métrica | medallion | armazém | veredito |
|---|---:|---:|---|
| Ligações | 7.378 | 7.378 | bate |
| E-mails | 5.801 | 5.801 | bate |
| LinkedIn | 871 | 871 | bate |
| Reuniões | 163 | 163 | bate |
| Conectadas / sem resposta / ocupado / número errado / sem desfecho | 567 / 3.765 / 2.577 / 58 / 128 | idem | bate nos cinco |
| **WhatsApp manual** | **2.755** | **2.755** | **bate** |
| WhatsApp total | 3.706 | 2.755 | delta 951 = Treble do medallion |
| Atividades | 17.919 | 16.968 | mesmo delta de 951 |
| WhatsApp automação | 951 | 454 | **discordam em 52%** |
| Empresas tocadas | 5.183 | 4.952 | 4,5% em aberto |
| Contatos tocados | 7.500 | 7.380 | 1,6% em aberto |

A linha que autoriza a troca é o **WhatsApp manual**: nenhuma mensagem digitada
por gente se perde. O que sai do total é automação, pela régua de 10/08/2026 |
automação não é esforço do BDR, ninguém digitou.

**Quebra de série a declarar antes de virar:** WhatsApp cai de 3.706 para 2.755 e
atividades de 17.919 para 16.968. Sem a premissa escrita, quem abrir a tela vai
achar que o time produziu menos.

**Automação por BDR não é comparável entre as fontes.** O medallion credita 951
disparos ao roster e o armazém 454. O Treble grava `communications` sem
`hubspot_owner_id`, então nenhum dos dois sabe quem enviou: o armazém infere pelo
dono no INSTANTE do toque, o medallion pelo dono ATUAL. Não muda esforço em
nenhuma das réguas | mas invalida ler "automação por BDR" como se fosse um número
só. Foi o terceiro caminho do `compare-workload-sources.js` que achou isso: a
primeira versão da asserção dizia que o delta seria a automação do armazém, e
reprovou.

**O armazém enxerga hoje e o medallion não.** Em 13/08 às 15h: 273 atividades do
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

**FEITO em 13/08/2026.** O default é `armazem`; `?fonte=medallion` continua vivo
e é com ele que se compara. O payload declara a camada por bloco em
`source.camadas` e as premissas em `source.premissas`.

Ordem executada, e é a que vale para qualquer troca futura, porque o SQL é
assado na imagem do Cloud Run:

1. **ETL primeiro.** As 5 colunas de desfecho (`calls_no_answer_total`, `busy`,
   `wrong_number`, `no_outcome`, `connected_missing_duration`) entraram no mart
   dimensional. Imagem `hubspot-platform:v11` nos **dois** Jobs. Mexer no BQ à
   mão é revertido no próximo run.
2. `node scripts/compare-workload-sources.js --adc` passou contra o mart real.
3. Só então o default virou.

**Correção de diagnóstico:** o relato inicial ligava os BLOCK do fechamento de
11 e 12/08 ao `close` não extrair o dia. Objeto por objeto, não era: no close de
11/08 os grandes tinham drift real do dia não lido (company 18, contact 53, lead
35, deal 2) e **todos abaixo do limite** | quem reprovava era **1 ticket**, porque
o recorte de Cotação tem ~192 tickets e 1/192 = 0,52% estoura sozinho um limite
de 0,50%. As duas correções seguem certas; a causa que as ligava, não. Corrigido
no check com um piso absoluto de 2 objetos ao lado do limite relativo.

**Efeito colateral do passo 1, que vale registrar:** a mesma imagem levou a leva
de 12/08 do objeto deal (34 propriedades novas), e isso derrubou o
`qa_field_fidelity [deal]` com 44 campos `armazém='' vivo='<valor>'`. Não era
defeito da leva | é a assinatura de propriedade nova com payload antigo, porque a
extração é incremental por watermark e só os 348 deals da janela tinham sido
relidos. Conserto: `MODE=backfill SCOPE=deal LOOKBACK_DAYS=1200` (6min27s, 1.364
MB). Voltou a 0 divergentes e a suíte fechou 83 checks, 0 BLOCK. O ramo
`backfill` do `entrypoint.sh` não honrava o SCOPE e passou a honrar.

## Frescor do dia corrente

O armazém só tinha DOIS refreshes automáticos: reconcile 06:30 e close 20:30.
Entre eles, o "hoje" do armazém ficava congelado às 06:30 — **14 horas**. A tela
de Workload escondia isso com o overlay ao vivo do HubSpot, mas o overlay é
desligado quando há filtro de porte/segmento/persona (`disabledByFilters`), e
qualquer outro consumidor do armazém via o dia pela metade.

Desde 13/08/2026 há refresh intraday às **10h, 13h, 16h e 19h** em dia útil, o
que leva a defasagem máxima de 14h para ~3h. Cada ciclo custa ~140s de extração,
289 requests na API do HubSpot e ~4,3 GB no BigQuery (≈US$ 0,03).

Dois detalhes de implementação que não são arbitrários:

- **Rodam no job `reconcile`, não no `close`**, porque é o `reconcile` que a
  trava de concorrência do botão Atualizar enxerga. Os dois jobs fazem
  `CREATE OR REPLACE TABLE` no mesmo gold, e duas execuções simultâneas
  reescrevem as mesmas tabelas. (A trava também foi corrigida para enxergar o
  `close` — ver `lib/hubspot-jobs.js`.)
- **Sem overrides de ambiente.** Passar `containerOverrides` no corpo exige a
  permissão `run.jobs.runWithOverrides`, que a service account não tem
  (`roles/run.invoker` não a inclui) — o primeiro desenho tomou `PERMISSION_DENIED`.
  Usam o env padrão do job (reconcile, 3 dias, escopo tudo), que é a MESMA
  chamada do `hubspot-reconcile-0630` já provado, e uma janela de 3 dias é
  estritamente mais segura que a de 1.

Reconciliação do dia corrente, medida em 13/08 às 21:52 contra o HubSpot ao vivo,
BDR a BDR: **13 de 13 com delta zero** nos cinco canais (314 ligações, 185
e-mails, 141 WhatsApp manual, 24 LinkedIn, 7 reuniões).

Se o mart não responder, `fonte=armazem` **cai de volta no medallion** e diz o
motivo em `source.fallbackErro` e no check `fonte_ritmo` | preferível a devolver
zero calado nos cards de desfecho, que é o modo de falha do `/calls/v1` que matou
o card inteiro em produção sem nunca dar erro.
