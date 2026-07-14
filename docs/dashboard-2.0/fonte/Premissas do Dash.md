## Códigos do HubSpot

- Pipe Vendas (Principal): 782758156
		- Reunião: 1144746905
		- Diagnóstico 1144746906
		- Cotação 1144746908
		- Consultoria 1144746909
		- Negociação 1144746910
		- Implantação 1288611084
		- Ganho 1144844314
		- Perdido 1144746911
- Pipe de BID: 894130090
		- Reunião 1349620551
		- Convite enviado 1349620552
		- Documentação 1349620553
		- RFP Enviada 1349620554
		- Cotação 1363560722
		- Proposta enviada 1349620555
		- Standby 1373066362
		- Consultoria 1349620556
		- Negociação 1353387279
		- Ganho 1353387280
		- Implantação 1353457025
		- Perdido 1349620557


Equipe de Executivos (AEs)
- André Pontes: 83684286
- Guilherme Gabiatti: 83026278
- Rafael Leite: 83126793
- Fausto Haderspeck: 83375300
- Juliana Dalberto: 83126792
- Ágatta Marinho: 720522117

Equipe de BDRs
- Anderson Souza: 85310335
- Cintia Rodrigues: 87213208
- Gabriele Almeida: 83025540
- Priscilla Feliciello: 83375302
- Leticia Romão: 89781254
- Allan Valença: 90688054
- Bruna Reis: 91925085
- Emanuelle Braga: 90688051
- Felipe Andrade: 90540673
- Giovana Rocha: 90141426
- Marcelli Netto: 90540672
- Thauan Pontes: 90540671
- Yokyko Muramoto: 90540670



## Premissas de Remuneração

Base de tudo = `primeira_fatura` (`pf`). Corte de porte = **200 vidas** (PME <200 | não-PME ≥200).
Campos HubSpot usados: `primeira_fatura`, `modelo_remuneracao`, `vidas`,  `possui_agenciamento`, `e_poc`.

### Modelo 1 | Fee por vida
- A `primeira_fatura` JÁ é a receita da Axenya (R$/vida × vidas). Não aplicar percentual.
- Receita = `pf` todo mês (recorrente integral, sem pico de entrada).

### Modelo 2 | Corretagem
- A `primeira_fatura` é o PRÊMIO (o que o cliente paga à operadora). A receita da Axenya é o
  percentual de comissionamento: 
	- **2% para PME (<200 vidas)**
	- **5% para não-PME (≥200 vidas)**.
- O flag `possui_agenciamento` só adiciona o pico PONTUAL de entrada; não muda a cauda recorrente.

| Modelo                   | Porte | Mês n | Receita total do mês |
| ------------------------ | ----- | ----- | -------------------- |
| Corretagem +agenciamento | ≥200  | 1     | `pf × 0,95`          |
| Corretagem +agenciamento | ≥200  | 2+    | `pf × 0,05`          |
| Corretagem +agenciamento | <200  | 1–3   | `pf`                 |
| Corretagem +agenciamento | <200  | 4+    | `pf × 0,02`          |
| Corretagem −agenciamento | ≥200  | todos | `pf × 0,05`          |
| Corretagem −agenciamento | <200  | todos | `pf × 0,02`          |

### Recorrente × Pontual
- Recorrente (cauda que repete no ano seguinte): Fee por vida → `pf` | Corretagem ≥200 → `pf × 0,05` | Corretagem <200 → `pf × 0,02`
- Pontual (pico de corretagem de entrada, não repete): `pontual[n] = max(0, total[n] − recorrente)`
- Exemplo (corretagem ≥200, com agenciamento, prêmio R$ 100.000):
	- Mês 1 → total 95.000 = recorrente 5.000 + pontual 90.000
	- Mês 2+ → total 5.000 = recorrente 5.000 + pontual 0
- O campo `periodo_do_contrato___vg` traz o período do contrato, se a fatura permanece por 12, 24 ou 36 meses.

### Premissas de borda
- `n = 1` é o mês de INÍCIO de receita do deal (não o `createdate`).
- Deal sem `pf` ou sem `modelo_remuneracao` → não entra no cálculo (contador "X de Y completos").
- Realizado (Ganho/Implantação já faturando, `vencimento_primeira_fatura` vencido) usa o VALOR REAL digitado no faturamento manual (Upstash KV), não a régua. A régua vale só para o projetado/probabilizado.
- Deals duplicados (mesmo cliente com fee por vida + corretagem) contam UMA vez: menor TCV de 12 meses
  e prazo de pagamento mais longo (worst case). 


## Campos puxados do HubSpot

**Identificação & atribuição**
- `dealname` | `dealstage` | `pipeline` | `hs_object_id`
- `hubspot_owner_id` (→ AE) | `sdr` (→ BDR)
- `origem__originacao_` (origem/originação)

**Produto & porte**
- `produto` | `quantidade_de_colaboradores` | `vidas`

**Receita & remuneração**
- `primeira_fatura` (1ª fatura, a `pf`) | `valor_da_fatura_do_plano_de_saude_atual`
- `arr_estimado` | `premio_mensal` |  `contrato_atual_e_de_12__24_ou_36_meses_`
- `modelo_de_remuneracao` | `possui_agenciamento` | `possui_vitalicio` | `e_poc`

**Probabilidade & timing do forecast**
- `probabilidade_de_fechamento_` (prob. do AE) | `hs_deal_stage_probability` (prob. da etapa, HubSpot)
- `qual_quarter_de_fechamento` | `data_prevista_para_receita`
- `vigencia` | `vencimento_da_1o_fatura` (gate do faturamento manual)

**Status & datas do ciclo**
- `hs_is_closed_won` | `hs_is_closed_lost`
- `createdate` | `closedate` | `notes_last_updated` (última atividade → dias parado)

**Perda & reuniões**
- `motivo_do_declinio_ou_perdido` | `motivo_de_declinio_perdido___descricao`
- `a_reuniao_ocorreu_` | `data_da_reuniao_com_executivo` | `data_do_reagendamento_com_o_executivo`

**Datas de etapa (variante v2 | a v1 vem vazia neste portal)**
- `hs_v2_date_entered_1144844314` (Ganho/Vendas) | `hs_v2_date_entered_1288611084` (Implantação/Vendas)
- `hs_v2_date_entered_*` + `hs_v2_date_exited_*` das 6 etapas de Vendas (tempo por etapa) e
  `hs_v2_date_entered_*` de TODAS as etapas dos dois pipelines (trilha do deal)

**Calculado no HubSpot (fórmula)**
- `cumulative_time_negocio_criado_ate_diagnostico_formula` (ms entre Reunião Agendada → Diagnóstico)

- Busca de deals: `dealname` | `pipeline` | `hs_object_id` | `createdate`
- Histórico (`propertiesWithHistory`): `dealstage` e `hubspot_owner_id` (reconstrói a passagem por
  etapa e conta reatribuições)

- Fluxos secundários/legados usam outras propriedades:
- `receita_vitalicio_estimada`,
  `vitalicio_ou_comissionamento`, `tipo_de_negociacao`…; `api/watcher-deals.js`: `modelo_de_pagamento`,
  `cashback`…), mas NÃO alimentam os painéis principais (pull/snapshot/watcher).


## Nomenclaturas dos elementos do dashboard
- Menu principal: drawer da esquerda com as páginas que o dashboard tem
- Menu secundário / menu superior: menu com as configurações globais e locais de cada dash
- Tooltip de info
- Hover de info
- Drawer de ifno