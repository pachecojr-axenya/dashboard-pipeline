# Auditoria crítica dos gráficos 🟡 | 2026-06-12

## Adendo | Delta D02 ganha 5 fatias (Novo/Avançou/Permaneceu/Perdido/Probabilidade) + zoom + filtro (2026-08-17)

> **Estado: D02 continua 🟢 validado no que já existia (invariante Σ Δ = Δtotal intacto,
> testado); a fatia NOVA "Probabilidade" fica 🟡 não validada contra o HubSpot** — pill
> própria no card avisa isso até o dono confirmar os números ao vivo.
>
> Pedido do dono: fatiar as barras de Δ do waterfall entre o que permaneceu, avançou e
> foi perdido — e, discutindo a implementação, surgiu uma 5ª fatia: **Probabilidade**,
> isolando quanto do ganho ponderado de um deal que avançou de etapa é reclassificação
> pela régua (o mesmo ARR, só que pesado por uma probabilidade maior) vs. substância real
> (ARR que de fato mudou). Fórmula e decisões de design documentadas na ficha "i" do D02.
>
> **Problema de escala resolvido com 2 recursos, não 1**: as barras de Total A/B são
> ordens de grandeza maiores que os Δ por etapa, então 5 fatias dentro de um Δ pequeno
> ficavam ilegíveis. (1) Toggle **Zoom** (oculta as barras de Total, eixo reescala pro
> range das barras de Δ ± R$500K) — descartei eixo duplo/escala log de propósito (nunca
> usados neste dashboard, e log quebra com Δ negativo). (2) Legenda **clicável** — liga/
> desliga fatia, recalcula a altura de verdade (não só esconde a cor).
>
> **Bug encontrado e corrigido durante a prototipagem** (achado do dono testando o
> protótipo): empilhar as fatias por POSIÇÃO real de valor (clampando cada corte contra
> o range da barra) causava sobreposição — uma fatia isolada maior em módulo que o Δ
> líquido "engolia" a barra inteira e a próxima repintava por cima. Fix: empilhamento
> **proporcional** (fração = |fatia| ÷ Σ|fatias ativas|), sempre contíguo, nunca sobrepõe.
>
> Também ganhou: animação de morph entre toggles (`chart.update()` em vez de
> `destroy()+new Chart()`) e tooltip HTML customizado com uma cor por fatia (o tooltip
> nativo do Chart.js só dá 1 color-box por item de dataset).
>
> **Protótipo isolado** testado antes de integrar: `public/_sandbox-d02-slices.html`
> (dado 100% sintético, fora do menu, não é painel oficial).
>
> Backend novo: `FC.movementSlices` (`lib/forecast-compute.js`) — sucessora do
> `FC.healthByRow` (2 baldes), que continua no payload como cross-check interno até o
> novo ser validado, ainda sem uso no front. Testes: `scripts/test-delta-invariant.js`
> (unit, Parte 1f) + checagem de integração estendida; `npm run check` completo — 0 FAIL.
>
> Paleta das 5 fatias reaproveita o design system (premium.css) — só tem 5 tons não-teal,
> e alguns pares ficam abaixo do ΔE ideal pro CVD-check do skill dataviz (verde↔vermelho,
> amarelo↔laranja). Mitigado com textura hachurada na fatia Probabilidade + ordem de
> empilhamento que afasta os 2 piores pares + legenda/tooltip sempre visíveis (nunca só
> cor). Ver nota completa em `STATUS_LOG.md`.

## Adendo | Cotação: 10 cards construídos, 2 removidos, dado de ticket/empresa estendido (2026-08-11)

> **Estado inalterado: 🟡 não validado contra o HubSpot** (painel segue oculto/🔴 no menu até
> validação do dono, ver adendo de 2026-07-29 abaixo) — esta rodada troca placeholder por
> gráfico real e corrige dica, não altera a régua de nenhum card já existente nem pede validação
> ainda.
>
> Dos 8 cards em placeholder ("Card a construir" / "Requer campo que não existe"), **8 foram
> resolvidos**: Volume de Tickets por Mês (Q11), Tickets por Etapa (Q12), Ranking por
> Responsável (Q13, bucket `'(sem responsável)'` em destaque), Tempo por Etapa (Q14),
> Distribuição de Tempo no Funil (Q15, novo — não estava na lista original de placeholders),
> Por Porte (Q16), Tempo Médio de Resposta (Q17) e Desfecho da Cotação (Q18, era "Taxa de
> Aprovação"). **2 foram removidos** do painel por decisão do dono (Valor Médio por Ticket,
> Prioridade dos Tickets) — testados contra o HubSpot real (via MCP), confirmados sem dado
> aproveitável (`valor_da_fatura` 1,6%; `prioridade` 0%).
>
> **Dado novo no ticket** (`api/pull-tickets.js` → `lib/hubspot.js`/`lib/hubspot-wh-queries.js`):
> `comercial_vidas`, `time_to_first_agent_reply`, `cotacao_status_final` — nenhum estava na
> allowlist antes desta rodada, apesar de existirem no portal. **Dado novo da empresa
> associada** (mesmo par de arquivos): `segmento`, `beneficio_axenya`, `operadora_atual` — só
> `beneficio_axenya` teve alguma cobertura (10,6%, e é booleano, não categórico); os outros
> dois vieram 0% (são campos de cliente ativo, a base de Cotação é majoritariamente prospect).
> Ficam capturados mas não alimentam gráfico nenhum hoje.
>
> **Ressalvas de cobertura a levar em conta antes de validar** (percentuais calculados ao vivo
> em `novoRender()`, não congelados — ver Fix de auditoria dos drawers, mesma data no
> `STATUS_LOG.md`): comercial_vidas ~19%, time_to_first_agent_reply ~20%,
> cotacao_status_final ~39%, hubspot_owner_id ~69% (31% sem responsável). Nenhum desses campos
> é majoritariamente preenchido — os gráficos que dependem deles são legítimos, mas o dono
> precisa saber que está vendo um recorte, não o universo.
>
> Detalhe completo (achados de dado, decisões do dono, técnica de subagente `Explore` sem
> Edit/Write + integração manual) nas 5 entradas do `STATUS_LOG.md` desta mesma data (2026-08-11),
> a partir de "Fix | Cotação: auditoria dos drawers..." até "Feat | Cotação: 4 cards viáveis...".

## Adendo | BDR: conversão entre etapas (novo) e Cadência de Leads REMOVIDA (2026-08-11)

> **R16–R22 (Cadência de Leads | Contatos do Time) saíram da tela** a pedido do dono.
> Eram os cards que liam `hs_lead_status` no CONTATO e viam ~10% do funil (jul/26: 234
> contatos contra 2.302 leads) — a auditoria de 11/08 já os havia declarado a régua
> errada, e a seção Funil de Leads (objeto 0-136) os substitui. `/api/bdr-leads`
> continua no ar; a tela só parou de consumi-lo.
>
> **Novos: Conversão do funil e Conversão por dimensão** (dentro de Funil de Leads),
> estado **🟢 validado contra o BigQuery** por `scripts/test-bdr-lead-funnel.js`
> (partição BDR + fora do time == total; nenhum passo acima de 100%; etapas encaixam
> pela régua acumulada; mesmo total nas 5 dimensões). Régua: **coorte acumulada**, não
> movimentações. Armadilha registrada: `com_deal` **não é subconjunto** de
> `qualificados` — o passo Qualificado → Deal usa a interseção, senão dá 110%.
> Detalhe em `STATUS_LOG.md`, entrada de 2026-08-11.

## Adendo | Meta vs Ach: fonte Inter explícita, menos negrito, André por último (2026-08-05)

> **Estado inalterado: 🟡 não validado contra o HubSpot** — ajuste puramente visual/de
> ordenação em `public/meta-ach.js`, nenhuma fórmula de cálculo tocada. Fonte Inter agora
> declarada explicitamente em `.ma-root`; os 6 `font-weight:800` do módulo baixados para
> `700` (teto do resto do design system); André (meta zerada desde o adendo anterior) agora
> sempre aparece por último na lista de AEs, independente do quanto fechou no tri. Detalhe em
> `STATUS_LOG.md`, entrada de 2026-08-05.

## Adendo | Meta vs Ach: Fausto fora, meta de André zerada, 500k/AE nos 3 restantes (2026-08-05)

> **Estado inalterado: 🟡 não validado contra o HubSpot** — pedido do dono sobre o ROSTER/META
> do time, sem tocar a fórmula de cálculo por conta. Fausto saiu do time (removido do painel).
> André saiu da empresa, mas fica LISTADO porque fechou uma venda no trimestre — meta zerada,
> não conta mais para a meta do time. Os R$ 1,5MM do time seguem inteiros, agora divididos só
> entre Guilherme, Juliana e Rafael: **R$ 500k/AE** cada (antes: 300k/AE × 5 AEs). Detalhe em
> `STATUS_LOG.md`, entrada de 2026-08-05.

## Adendo | Delta religado ao design system (premium.css/premium.js) (2026-08-02)

> **Estado inalterado: 🟢 validado** (D01–D08) / 🟡 D09 (ver adendo seguinte) — esta
> rodada é **só CSS/nomes de classe**, sem tocar em lógica de cálculo. Tier 1, item 1
> de `docs/design-system-proposal.md`: `forecast-delta.html` era o único painel
> "principal" sem `premium.css`/`premium.js`, renderizando com paleta antiga
> (`:root` local vivo, sem nada que o sobrescrevesse) e um toggle sem thumb
> deslizante.
>
> - Adicionado `<link rel="stylesheet" href="/premium.css?v=5">` +
>   `<script src="/premium.js?v=5"></script>` no `<head>`, logo após o `<style>`
>   inline — mesma posição relativa usada por `dashboard.html`/`board.html`.
> - Renomeadas as classes locais para os equivalentes canônicos (mantendo toda a
>   lógica JS que lê/escreve essas classes): `.card` → `.novo-card` (9 usos no HTML +
>   regra da media query); `.kpi`/`.k`/`.v` → `.kpi-card`/`.kpi-label`/`.kpi-value`
>   (CSS + todas as strings HTML geradas em JS: KPIs do D01/D03/D09).
> - `.tab-sub` reconstruído com o padrão real (só existia 1 instância: o botão
>   "📸 Capturar agora" da faixa de captura manual, sempre "ativo"): elemento
>   `.tab-sub-thumb` deslizante (via `left`/`width`) + classe de estado `.active`
>   (era `.on`), copiando a implementação de `dashboard.html`
>   (`_moveTabSubThumb`/`_initTabSubs`, replicadas aqui porque cada página implementa
>   o próprio toggle — `STATUS_LOG.md`, Regra de código). `_initTabSubs()` é
>   re-chamada quando a faixa de captura (inicialmente `display:none`) fica visível,
>   para o thumb medir a largura real.
> - `.ibtn` (botão de info 24px próprio) mantido como está — fora do escopo desta
>   rodada (drawer de info é extração separada).
> - Removido o `:root` local morto (paleta antiga `--bg:#0d1117` etc.) — todas as
>   vars usadas (`--font`, `--hover` inclusive) já são cobertas por `premium.css`.
> - Gate de paridade: grep no arquivo inteiro por classes órfãs (`class="card"`,
>   `class="kpi"`, `class="k"`/`class="v"` soltas, `tab-sub-btn.on`, `:root`
>   remanescente) — zero ocorrências após o rename. A barra **Fechado** e o card
>   **D09** (mesclados nesta branch antes desta rodada) foram só reembalados em
>   `.novo-card`/`.kpi-card`; nenhuma linha de cálculo tocada.
> - Validação: `node scripts/_check-inline-js.js public/forecast-delta.html` = 0
>   erros; `npm run check` (exceto a falha conhecida de
>   `test-bdr-workload-v2.js`, não relacionada); `scripts/test-forecast-delta-e2e.js`,
>   `scripts/test-forecast-delta-leva2.js` e `scripts/test-delta-invariant.js` = PASS
>   (invariante Σ Δ = Δtotal intacto).

## Adendo | Cotação | fix do CSS órfão (regressão) + settings-modal.js + limpeza de `:root` morto (2026-08-02)

> Trabalho de `docs/design-system-proposal.md` (seção 2.2, itens Tier 1.2/1.5/2.7), sem
> mudança de estado de validação do painel (continua 🟡 não validado contra o portal, ver
> adendo de 2026-07-29 abaixo — nenhum dado/cálculo de ticket foi tocado).
>
> 1. **Regressão corrigida**: o CSS de `.modal`/`.modal-header`/`.modal-close`/
>    `.modal-body`/`.btn-export`/`table.lb` estava de novo fisicamente depois de
>    `</html>` (fora de qualquer `<style>`, ignorado pelo navegador) — o MESMO tipo de
>    bug que o adendo de 2026-07-29 (linha abaixo) já registrava como corrigido uma vez.
>    Movido de volta para dentro do `<style>` do `<head>`.
> 2. `:root`/`.novo-card`/`.kpi-card` locais (paleta pré-`premium.css`) removidos —
>    código morto, já sobrescrito pelo `premium.css` em runtime; zero mudança visual.
> 3. `settings-modal.js` ligado: o painel agora respeita o toggle global "Implantação =
>    Ganho" (via `_novoIsWon(d)`) em vez do `NOVO_WON_STAGE='Ganho'` hardcoded — mesma
>    correção de comportamento pendente para `cs.html` (não feita nesta tarefa).
>
> Detalhe completo de cada um dos três pontos: `STATUS_LOG.md`, entradas de 2026-08-02
> ("Cotação | fix: CSS do modal órfão...", "Cotação | limpeza: `:root`/`.novo-card`/
> `.kpi-card`...", "Cotação | liga `settings-modal.js`...").

## Adendo | Delta ganha o D09, ARR do quarter corrente vs Meta (2026-08-02)

> **Estado: 🟡 não validado contra o HubSpot** (card novo; painel Delta segue 🟢
> validado nos D01–D08 já auditados). Pedido do CRO (Ivan) na reunião de forecast de
> 31/07/2026: uma visão de como o ARR probabilizado do quarter CORRENTE evoluiu
> semana a semana, comparado com a meta.
>
> | # | Card | Nota |
> |---|---|---|
> | D09 | ARR do quarter corrente vs Meta \| evolução semanal | linha (ARR Total/Ponderado, toggle) por foto semanal, com marcador tracejado da meta trimestral |
>
> **Front-only por construção (sem mudar `api/history.js`)**: looping do front sobre
> os dois endpoints que já existiam — `action=fotos` (cadência semanal oficial, sem
> `cadence=`) para a lista de fotos, e `action=compare` (mesmo `quarters[]` que já
> alimenta o D06) para o ARR do quarter corrente EM CADA foto — lê o lado `b` (ou `a`
> para o primeiro ponto) de cada chamada, todas com a mesma foto mais antiga da janela
> como base A (até 16 fotos semanais mais recentes, paralelizadas via `Promise.all`).
> Nenhuma agregação nova no backend.
>
> Escopo sempre "Tudo" (Ganho/Implantação incluídos, sem Bid/Standby) e SEM os filtros
> de Executivo/Quarter/Escopo do cabeçalho — visão executiva do total da empresa,
> deliberadamente independente do resto da página (documentado no drawer "i" do D09).
> Meta trimestral = meta anual configurada em Configurações (⚙, mesma fonte do CRO
> Dashboard, `NOVO_META_MTD`) ÷ 4, lida diretamente do `localStorage` do navegador
> (`novo_meta_mtd`) — o painel Delta não inclui `settings-modal.js`, então não há UI
> própria para editar a meta aqui; se nunca foi configurada neste navegador, o card
> mostra "sem meta em Configurações" em vez de uma meta zerada silenciosa.
> Ressalva a validar: a série pode incluir fotos de ANTES do início do quarter
> corrente (contexto de tendência) quando ainda há poucas fotos dentro do quarter.

## Adendo | Cotação religado nos tickets reais (2026-07-29)

> **Estado: 🟡 não validado contra o portal** (painel segue oculto/🔴 no menu até
> validação do dono). O `/novo-cotacao` deixou de ser placeholder: consome
> `POST /api/pull-tickets` (endpoint que JÁ EXISTIA do fluxo Electron —
> `fetchCotacaoTickets`, pipeline de tickets **847948895** confirmado pelo dono).
> O banner "API indisponível" era nota desatualizada: o stub esperava um `GET
> /api/tickets` hipotético e nunca foi ligado ao endpoint real.
>
> | # | Card | Nota |
> |---|---|---|
> | Q01 | Tickets no pipeline | contagem total (177 na religação) |
> | Q02 | Em aberto | etapas Novas Cotações/Triagem/Pendente/Mapeamento/Criação |
> | Q03 | Entregues + Concluídos | etapas finais (Projeto Entregue + Concluído) |
> | Q04 | Ciclo médio (dias) | createdate → 1ª entrada em etapa final; `hs_date_entered_*` de tickets vem em EPOCH MS (parser próprio) |
> | Q05–Q08 | Por etapa / responsável / mês / aging | snapshot, sem filtro de período; drill com link p/ ticket |
> | Q09–Q11 | Proxy de deals na etapa Cotação (Vendas) | seção separada; OUTRA base (deals, não tickets) |
>
> Ressalvas a validar: (1) etapas espelhadas de `semantic/referencia.json →
> tickets_cotacao` (o semantic-ref.js gerado não expõe tickets); (2) 54 tickets sem
> responsável; (3) "aberto/fechado" assume Projeto Entregue+Concluído como finais —
> confirmar com o time de cotação; (4) fix estrutural: CSS do modal estava ÓRFÃO
> depois do `</html>` (renderizava como texto) — movido para o `<style>`.

## Adendo | CS Dashboard religado na base real (2026-07-27)

> **Estado: 🟡 não validado contra o HubSpot** (painel segue oculto/🔴 no menu até validação).
> O `/novo-cs` deixou de ser só proxy de Vendas: agora consome `GET /api/cs-accounts`
> (empresas com `kam_responsavel` + owners), novo nesta data.
>
> | # | Card | Nota |
> |---|---|---|
> | CS09 | Clientes Ativos (KPI) | `ativo_ou_inativo_ = Ativo` (~99% preenchido) — 180 na 1ª leitura |
> | CS10 | Clientes Inativos (KPI) | idem, valor Inativo — 40 |
> | CS11 | Prêmio Mensal da Base (KPI) | Σ `premio_mensal` das ativas; **fill ~22%** — subtítulo expõe o denominador |
> | CS12 | Renovações \| 90 dias (KPI) | `vigencia_do_contrato_atual` (fim do contrato, data futura) nos próx. 90d; **fill ~27%** |
> | CS13 | Carteira por KAM | owners resolvidos; ressalva: owner desativado aparece como ID bruto |
> | CS14 | Fim de Vigência por Mês | Vencida + 12 meses + Além; 10 ativas com vigência vencida (dado de origem) |
> | CS15 | Qualidade de Dados da Base | fill % por campo nas ativas; é o card que mede a confiança dos demais |
>
> CS05–CS08 (proxy Vendas, deals Ganho) continuam como estavam, em seção própria.
> CS01–CS04 (KPIs proxy) foram **removidos** — diziam "Clientes Ativos: 14" onde a base
> real tem 180. Semânticas a validar contra o HubSpot: flag `ativo_ou_inativo_` como
> definição oficial de cliente ativo; `vigencia_do_contrato_atual` = data de renovação;
> `premio_mensal` da company vs o do deal.

## Adendo | D02 ganha a barra "Fechado" + fix do bug do Perdido no drill (2026-08-02)

> Duas correções pedidas na reunião de forecast de 2026-07-31 (caso concreto: deal
> Cappta, −R$345k de fatura+vigência que na verdade era vitória).
>
> **Atualização (2026-08-02, mesmo dia):** "deals que foram para Ganho no período"
> abaixo passou a incluir também **Implantação** — pedido direto do dono ("Nós
> consideramos a etapa de Implantação como Ganho. Ajuste no Delta."). Ver entrada
> própria no topo do `STATUS_LOG.md`.
>
> **1. Waterfall ganha "Fechado" (`api/history.js` compare + `lib/forecast-compute.js`
> `closedWonAgg`).** Hoje um deal que vira Ganho entre a Foto A e a Foto B "derruba"
> o Total @ B do waterfall como se fosse perda de valor — na verdade é uma vitória, o
> valor só migrou de pipe aberto ponderado para fechado/contratado. O card D02 ganhou
> duas barras novas após Total @ B: **Fechado** (Σ ARR/ARR Ponderado, na foto A, dos
> deals que foram para Ganho no período — clicável, abre a mesma lista do D05 filtrada
> por "Foi para Ganho") e **Total B + Fechado** (a soma, comunicando "o que já foi
> executado + o que ainda está por vir"). **Design deliberado: exposição
> ADITIVA/informativa** — não entra no Σ Δ(etapa) nem no invariante Σ Δ = Δtotal já
> testado (`scripts/test-delta-invariant.js`, `scripts/test-forecast-delta-e2e.js`),
> porque Ganho não tem linha própria no waterfall em escopo Ativos (some do conjunto
> por definição); somar ali mudaria a semântica do invariante existente em vez de só
> anotá-lo ao lado. Payload novo: `fechado: { deals, arr, arrPond, real12, prob12,
> realTotal, probTotal }`.
>
> **2. Bug corrigido: deal Perdido aparecendo como "movimentação" (avanço) no drill.**
> Causa raiz em `lib/snapshot-history.js` (`valueAt`, usada pelo backfill histórico
> HubSpot→BQ, `scripts/backfill-hubspot-bq.js`): o comparador de ordenação do
> histórico de propriedade (`a.timestamp < b.timestamp ? 1 : -1`) devolvia -1 também
> quando os timestamps eram IGUAIS — viola o contrato de ordem total do
> `Array.prototype.sort`. Quando o HubSpot registra duas mudanças de `dealstage` no
> mesmo instante (workflow em cadeia, ex.: Negociação → Perdido no mesmo request), o
> sort podia reordenar errado um array que o HubSpot já entrega correto
> (mais-recente-primeiro) e `valueAt()` devolvia a etapa INTERMEDIÁRIA em vez do
> estado FINAL — daí o deal Perdido "vazando" como avanço de etapa no drill do
> waterfall. Fix: comparador numérico próprio (0 em empate) → sort estável, preserva
> a ordem que o HubSpot entrega. Reproduzido e coberto por
> `scripts/test-snapshot-history.js` (novo, no `npm run check`). A classificação em
> si (`_classifySaiu` no `lib/forecast-compute.js`, e o equivalente em
> `stageUnified`) já priorizava Perdido/Ganho antes do rank de avanço desde 2026-07-24
> — o bug estava na ETAPA reconstruída chegando errada, não na regra de classificação.

## Adendo | Delta (ex-Comparativo), códigos D01–D07 (2026-07-24)

> **Estado: 🟢 validado (2026-07-27, decisão do dono)** — o pill do header passou de
> "🟡 não validado" para "🟢 validado" e a saúde do item Delta no `nav.js` foi para verde,
> por instrução explícita do dono em 2026-07-27.
> O painel `/forecast-delta` foi renomeado para **Delta** e os cards ganharam códigos:
>
> | # | Card | Nota |
> |---|---|---|
> | D01 | Fotografia do forecast (foto B) | KPIs da foto isolada |
> | D02 | Waterfall do forecast por etapa | motor canônico (Regra nº 3), invariante Σ Δ = Δtotal. **Medida ÚNICA point-in-time (2026-07-30, decisão do dono — toggle composição×convicção removido)**: cada foto avaliada com a config vigente NELA (sidecar `snapshot_config` ao vivo ou backfill reconstruído embutido); pill indica a origem da config; foto sem config → fallback atual com flag amarela. TODO o painel (KPIs, tabelas, drill) usa a mesma avaliação — o Σ do drill fecha com a barra. A medida "composição" (config atual nas 2 fotos) foi aposentada. **2026-08-02: ganhou as barras informativas "Fechado" e "Total B + Fechado"** (deals que foram para Ganho no período não "derrubam" mais o Total B; ver adendo abaixo) e o bug do deal Perdido aparecendo como avanço no drill foi corrigido. |
> | D03 | KPIs comparativos A → B | TCV e MRR removidos a pedido do dono (2026-07-24). ARR Ponderado point-in-time (mesma medida única do D02). |
> | D04 | Funil / deals por etapa | contagem A × B |
> | D05 | Deals que saíram do pipe | lista direta no card; destino distingue Caiu / Ganho / Avançou |
> | D06 | ARR por Quarter previsto | ARR Total / Ponderado |
> | D07 | Visão unificada por etapa | colunas de receita (12M) trocadas por **ARR Total / ARR Ponderado** (2026-07-24); só Vendas (Bid no D08) |
> | D08 | Pipe de Bid por etapa | visão DEDICADA do pipeline Bid (2026-07-24): prob fixa 0,5%, receita só Proposta/Negociação; não mistura com as visões de Vendas |
>
> Movimentação nos drills agora separa **Avançou** (etapa posterior) de **Caiu (Perdido)**
> e **Foi para Ganho** — sair do conjunto por avanço não é churn. Cada card tem botão
> **i** com memória de cálculo (drawer + seções do catálogo semântico).
> 2026-07-24: os **🟡 por card foram removidos a pedido do dono** — a sinalização de
> não-validado fica no pill do PAINEL (header); o estado desta tabela segue valendo.
> Ressalva a validar: destino de deal **Bid** pode aparecer como ID bruto de etapa na
> lista do D05 (mapeamento de etapa Bid do snapshot — pré-existente).

## Adendo | Meta vs Ach (2026-07-22)

> **Estado: 🟡 não validado contra o HubSpot.** Bloco novo (`public/meta-ach.js`), primeira
> montagem na aba "Meta vs Ach" do `/forecast`. Mostra atingimento da meta do trimestre por
> AE. **"Fechado" = Σ (`arr_estimado` × prob. de etapa pela régua GLOBAL) das contas cuja entrada
> em Implantação (`data_implantacao`, fallback `data_ganho`) cai no tri corrente.** Régua =
> `SEMANTIC_REF.forecast_flat` (Implantação 0,8 · Ganho 1,0). Meta 300k/AE, time = 5 AEs
> (Ágatta fora) = 1,5MM.
> Ressalvas conhecidas a validar: (1) é métrica de **bookings ponderados** (arr_estimado × régua), NÃO a receita
> canônica da Regra primária nº 3 (Real/Probabilizada) — números podem divergir do resto do
> forecast por construção, é esperado; (2) `arr_estimado` como fonte de origem ainda não foi
> conferido campo a campo no HubSpot; (3) contas do pipeline **Bid** não entram (o payload só
> expõe entrada em Implantação/Ganho de Vendas) — extensão futura se o dono quiser Bid; (4)
> status "no ritmo/atrás" usa % de dias decorridos do tri como ritmo esperado (proxy linear).

## Adendo | BDR No Show (2026-07-20)

> **Estado: 🟠 até validação pós-deploy.** Auditoria encontrou mistura de AEs no gráfico por BDR, semanas sem amostra plotadas como 0%, eixo chegando a 130%, gráfico limitado às últimas 16 semanas e ranking fora SLA incluindo perdidos/reagendados. A correção usa roster canônico, denominador de desfechos conhecidos + cobertura, lacunas sem amostra, eixo 0–100%, média móvel ponderada de 4 semanas e reconciliação `ranking fora SLA = tabela operacional`. Recorte real de 30 dias: 74 reuniões canônicas, 41 com desfecho (55,4% de cobertura), 10 no-shows históricos, 8 abertos/fora SLA. Ver `docs/2026-07-20_no-show-validation-incident.md`.

Análise dos gráficos que estavam marcados com 🟡 (não validados) em `public/novo-dashboard.html` e `public/novo-board.html`. Para cada um, capturei o **dataset real** que o gráfico gera com os dados de produção (interceptando `_novoMkChart` via `scripts/_capture-charts.js`) e comparei com o que o título/tooltip promete.

## Legenda de cores (substituiu o 🟡 nos títulos dos gráficos)

| Cor | Significado |
|---|---|
| 🟢 | **Estrutura e cálculo corretos** | o gráfico mostra o que o título diz. *Atenção:* isto NÃO confirma que o dado de origem (ex.: `arr_estimado`, `vidas`) está certo — isso ainda depende da sua validação contra a fonte. |
| 🟠 | **Calcula certo, mas com ressalva relevante** | amostra pequena, escopo inconsistente, cobertura parcial, dominado por outlier, ou rótulo impreciso. Use com contexto. |
| 🔴 | **O que mostra diverge do que o título promete** | risco real de interpretação errada ao vivo, mesmo com o aviso. |

> O 🟡 foi mantido apenas onde **não** houve análise nesta auditoria (KPIs secundários, disclaimers internos). Gráficos C01–C09, que você já havia validado, continuam **sem emoji**.

---

## Adendo | mudanças pós-auditoria (2026-07-01)

> A tabela `novo-dashboard.html` abaixo usa a numeração **N01–N26 de 12/06**, que **não bate mais** com os códigos exibidos no dashboard atual (o card map do código foi reorganizado; ex.: hoje "Maturidade por Coorte" aparece como N01 no dashboard, "Cobertura" como N05, "Forecast Total" como N06B). Trate a tabela como histórico; o estado corrente é este adendo.

- **Forecast Total (N06B) → 🟢 validado.** Religado no motor compartilhado (`forecast-engine.js`: `dealMonthly` + `bdrCohorts`, régua `calcReceitaMes`, faturamento manual). Bate **mês a mês**, em Receita Real e Probabilizada, com o painel **Forecast Overall** (`forecast-stage.html`) — filtro de deals (createdate≥set/25 · Ganho · Bid desde jan/25), dedup Fee×Corretagem, prob por etapa do funil (Diagnóstico 6%), bloco BID só Negociação/Proposta com prob fixa 0,5%. Marcador 🟡 removido do título.
- **Maturidade por Coorte (N01 no código atual) → 🟢 validado.** Pisos alinhados ao tooltip (coortes com 2+ meses e 20+ deals); curva de desfecho por `close_date` ÷ tamanho, meses futuros nulos.
- **C07 (Prob. de Ganho por Etapa):** eixo Y capado em 40%. **Fix (2026-08-12):** `_novoWinProbPipe` tinha reimplementação própria da conta (divergia do motor único — sem gate de amostra mínima e excluindo Diagnóstico); passou a delegar em `_novoFunnelDerivedProbPipe`/`ProbEngine.funnelDerivedProbPipe`, mesma fonte do 🟡 "P. Realtime" do painel Ganho. Diagnóstico agora também entra na conta (informativo — a probabilidade real do deal continua fixa em 6%, protegida por `_autoProbInfo`). Detalhe: `docs/forecast-revenue-rules.md` §7.
- **Removidos:** **C05** (Receita por Segmento — redundante com o C08/TCV e usava `arr_estimado`) e **N06/N14** (Valor do Pipeline | Projeção Mensal — redundante com o Forecast Total).
- **Cobertura do Pipeline (N05) → 🟢 validado.** Religado no mesmo motor do N06B: consome a série única `_novoForecastSeries()` (extraída do N06B), então Receita Real e Probabilizada batem **mês a mês** com o Forecast Total por construção (verificado com dados de produção: idênticos nos 24 meses). Ganho/Implantação sempre incluídos; toggle **Cobertura (×) ↔ Receita (R$)** (× = forecast ÷ meta mensal, 1× = no alvo). KPI de pipe-segurança = pipe aberto real ÷ meta. Marcador 🟡 removido do título.
- **Pendente:** o **modal** do N06B (`_novoOpenN06BForecastModal`) ainda usa o motor antigo (`calcReceitaMes` sem faturamento manual) e pode divergir do gráfico quando há faturamento manual — a religar no `ForecastEngine`.
- **Tempo em Etapa (N07 no código atual) → validado (2026-07-02).** Cálculo replicado do relatório do HubSpot por engenharia reversa: mediana do tempo CUMULATIVO por deal, só períodos concluídos, timestamps completos, Vendas, criados ≥ set/2025. Réplica vs relatório do CRO: RA 14,9≈14,7 · Diag 24,9≈25,6 · Cot 20,1≈20 · Cons 21=21 · Neg 19,4=19,4. Marcador 🟡 removido do título.

---

## `novo-board.html`

> **Adendo (2026-07-07):** alinhamento às premissas globais do CRO. **C03** (Distribuição por Tamanho) foi **substituído pelo C08** (TCV do Pipe por Bucket, dois donuts Bruto×Ponderado). **C04** (Valor do Pipeline por Etapa) agora usa **TCV pela régua** + probabilidade final global (C07 por pipeline + ±10% do AE), idêntico ao C04 do CRO. **B14/B15/B16** ponderam com a mesma probabilidade global (`_calcProbInfo`), mantendo `arr_estimado` como base de receita. **B11** (Entrada vs Saída) passou a contar a entrada pela **data de entrada em Reunião Agendada** (`data_reuniao_agendada`), não `createdate` — some o pico artificial de importação de Mai/26 no `createdate`. A probabilidade agora vem do arquivo compartilhado `prob-engine.js` (2026-07-24: reconciliação COMPLETA — CRO, Board, forecast.html e forecast-overall-core.js/Delta delegam todos ao ProbEngine; não há mais cópia do cálculo). **B12** (ARR Bridge) inalterado.

Os 4 KPIs do topo (após o alinhamento de definições de 2026-06-12) estão corretos: **ARR Ganho R$ 4,14M / 24 deals · Pipeline Aberto R$ 149,85M / 137 · Forecast Ponderado R$ 44,4M** → 🟢.

| Gráfico | Cor | Diagnóstico |
|---|---|---|
| Tendência de Receita (ARR Ganho) | 🟢 | ARR de ganhos por mês de fechamento. Correto. |
| Concentração de Receita | 🟢 | % do ARR nos top 5/10/20/50. Top 5 = 76% (concentração real e alta). Correto. |
| Deals Ganhos por Mês | 🟠 | Mostra 21 dos 24 ganhos — 3 têm `close_date` nulo ou fora da janela de 18 meses e somem sem aviso. |
| Valor do Pipeline por Etapa | 🟠 | Correto, mas R$ 122,9M de R$ 149,8M (**82%**) estão em "Diagnóstico" — pipeline dominado por pouquíssimos deals gigantes em etapa inicial. |
| Benchmark de Porte | 🟠 | Calcula sobre **todos os 327 deals** (inclui 166 de Reunião Agendada + ganhos); escopo diferente do resto do board. |
| Porte Médio dos Ganhos | 🟠 | n = 1 a 10 por mês → oscila de 3 a 782 vidas. Trend não confiável com amostra tão pequena. |
| Conversão Etapa-a-Etapa | 🔴 | Diz "conversão/funil" mas mostra a **contagem atual por etapa** (70→29→4→21→12→1→17→7). Não é funil (sobe e desce), mistura etapas de **Vendas e Bid**, e **omite Reunião Agendada (166)**, o topo real. |
| Entrada vs Saída por Mês | 🔴 | Mai/26 = **181 deals criados** num só mês (de 327 totais): carga/importação em massa, não inflow orgânico. A saída (≤10) fica invisível na escala. |
| ARR Bridge (Variação Mensal) | 🔴 | **Não é um ARR Bridge.** É a *diferença* do ARR ganho entre meses consecutivos. As barras negativas NÃO são churn — só "ganhei menos que no mês passado". |
| Cenários de Forecast | 🔴 | Ordenação incoerente: "Conservador (50%)" = R$ 74,9M é **maior** que "Ponderado (prob)" = R$ 44,4M. Aplicar 80%/50% liso sobre R$ 150M brutos não é cenário. Só o Ponderado tem significado. |

---

## `novo-dashboard.html` (bloco N01–N26)

| #   | Gráfico                               | Cor | Diagnóstico                                                                                                                                                                  |
| --- | ------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N01 | Pipeline Funnel Waterfall             | 🔴  | Usa a contagem atual de abertos [70,29,4,21,12,1] como funil. "Queda" esconde aumentos (Proposta→Consultoria sobe, mostra 0). Mesma base do C02.                             |
| N02 | Fluxo Líquido de Vidas                | 🟠  | Entradas de **1,2 milhão de vidas em Fev/26** (deals outlier tipo Bradesco). Saldo dominado por outliers; saídas somem na escala.                                            |
| N03 | Progressão por Etapa                  | 🔴  | "Reach cumulativo" da **foto atual** de abertos, não conversão histórica. Mistura etapas de Vendas + Bid numa linha só.                                                      |
| N04 | Pipeline Aberto (Valor e Volume)      | 🟢  | Deals + ARR por etapa, eixo duplo. Correto.                                                                                                                                  |
| N05 | Concentração de Risco Top 10 (tabela) | 🟢  | Top 10 abertos por score de risco. Correto.                                                                                                                                  |
| N06 | Maturidade por Coorte                 | 🟠  | Dias-até-fechar por trimestre de criação está certo, mas o eixo X sai **fora de ordem** (Q1/26, Q2/26, Q3/25, Q4/25 — `sort()` de string) e tem trimestres com n=1–2.        |
| N07 | Frescor de Engajamento                | 🟢  | Abertos por faixa de idade (`dias_no_pipe`); soma = 137. Correto.                                                                                                            |
| N08 | Taxa de Passagem por Etapa            | 🔴  | **Duplicata exata do N03** (números idênticos: 48,9/56,7/89,5/38,2/7,7%). Mesmo problema de foto-como-funil.                                                                 |
| N09 | Taxa de Ganho por Tamanho             | 🔴  | "Taxa de Ganho" = `ganhos ÷ (ganhos + abertos)`. **Ignora os 884 perdidos** e trata aberto como "não ganho". 1K+ aparece com 1,8% porque ainda não fechou, não porque perde. |
| N10 | Distribuição por Tamanho (Janela)     | 🟠  | Quase duplicata do donut C05 (mesmos buckets sem a fatia "Sem receita"); a "janela" de criação não está exposta como controle.                                               |
| N11 | Distribuição de Vidas (Janela)        | 🟠  | Abertos por faixa de vidas; redundante com o modo "Vidas" do donut C05.                                                                                                      |
| N12 | Análise de Fatores de Ganho / AE      | 🔴  | Mesmo `ganhos ÷ (ganhos + abertos)` por AE, rotulado como "win rate". Ignora perdidos.                                                                                       |
| N13 | Cobertura do Pipeline                 | 🟠  | `ponderado ÷ meta`. A meta padrão (R$ 5M) é placeholder — se não for a meta real, o múltiplo (~8,8×) não significa nada.                                                     |
| N14 | Valor do Pipeline (Projeção Mensal)   | 🟠  | ARR÷12 por `data_prevista_para_receita`. Só inclui deals com data prevista (soma ~R$ 1,8M vs R$ 150M de pipeline) → faz o pipeline parecer minúsculo.                        |
| N15 | Receita por Segmento (Donut)          | 🟢  | Correto, mas **duplicata do C08** (idêntico). Enterprise = 94% do ARR.                                                                                                       |
| N16 | Visibilidade de Receita               | 🟢  | Contagem de deals com data prevista por mês. Correto (eixo pula meses vazios).                                                                                               |
| N17 | Tempo em Etapa (Gargalo)              | 🟠  | Usa `dias_no_pipe` (idade **total**), não tempo na etapa atual. O tooltip admite o proxy, mas o título diz "em Etapa".                                                       |
| N18 | Velocidade de Qualificação            | 🔴  | Mostra a **idade atual** dos deals em Diagnóstico por mês de criação — tautológico (criado há mais tempo = idade maior). NÃO mede dias até chegar em Diagnóstico.            |
| N19 | Tempo até 1ª Reunião                  | 🟠  | Card de placeholder honesto ("dados não disponíveis"); não engana, mas fica vazio. Requer `a_reuniao_ocorreu_` na API.                                                       |
| N20 | Impacto de Reatribuição               | 🟠  | Proxy de performance por AE, com disclaimer ("histórico de reatribuição não disponível").                                                                                    |
| N21 | Resultados Financeiros (tabela)       | 🟢  | Espelha corretamente os KPIs validados (won MTD/YTD, pipeline bruto/ponderado, cobertura).                                                                                   |
| N22 | Deals Ganhos / Receita Mensal         | 🟢  | ARR÷12 de ganhos por mês de fechamento. Correto.                                                                                                                             |
| N23 | Estimativa de Receita por Etapa       | 🟢  | Correto, mas **duplicata do C07** (idêntico: 122,9M / 3,57M / 10,3M / 3,92M / 9,13M).                                                                                        |
| N24 | Receita Ponderada por Etapa           | 🟢  | ARR × probabilidade por etapa, consistente com o Forecast Ponderado. Correto.                                                                                                |
| N25 | Timeline de Recebíveis                | 🟠  | Mesma conta do N14 (ARR÷12 por data prevista) → near-duplicata + mesma cobertura parcial.                                                                                    |
| N26 | Triagem de Risco Top 20 (tabela)      | 🟢  | Top 20 por score composto. Correto (sobrepõe o N05 Top 10).                                                                                                                  |

**Chaves i18n mortas** (não renderizam, mantidas no código sem efeito): `t_funnel`, `t_sizedist`, `t_vidasdist` — restos do funil vertical e dos gráficos de tamanho/vidas substituídos pelo donut C05.

---

## `bdr.html` | painel BDR (adendo 2026-07-10)

> Seção nova **Cadência de Leads | Contatos do Time** (R16–R22), baseada em CONTATOS (`/api/bdr-leads`: owner do contato = BDR do time + histórico completo de `hs_lead_status`). Validação estrutural com dados de produção no local (funil conferido 1:1 contra contagens independentes do search da API).

| # | Gráfico | Cor | Diagnóstico |
|---|---|---|---|
| R16 | Funil de Lead Status | 🟢 | Snapshot no fim da janela reconstruído do histórico; conferido 1:1 com o search da API (NEW 1.879 · ATTEMPTED 155 · CONNECTED 168 · OPEN_DEAL 17 · UNQUALIFIED 107 · BAD_TIMING 3 em 2026-07-10). |
| R17 | Taxa de Contato por Coorte Semanal | 🟢 | Coorte = primeiro evento de status na semana; taxas = atingiu ATTEMPTED+/CONNECTED+ até hoje. Por coorte de propósito (por toque infla). Semanas recentes têm taxa em maturação — ler com o tempo. |
| R18 | Taxa de Contato por Dimensão | 🟢 | Mesma coorte do R17 agregada por BDR/Porte/Origem. Porte usa colaboradores do contato com fallback na empresa associada (74% de cobertura); Origem tem só ~17% de preenchimento — bucket "(sem origem)" domina e está explícito. |
| R19 | Desqualificações por Dia | 🟠 | Eventos UNQUALIFIED/BAD_TIMING por timestamp do histórico — correto, MAS o portal não tem campo de motivo de desqualificação de contato: o "por quê" granular não existe na fonte. Recomendação registrada: criar propriedade (ex.: `motivo_desqualificacao`) e preencher na cadência. |
| R20 | Contatos Trabalhados por Dia | 🟠 | Contato distinto com mudança de status no dia. Proxy de ritmo: toques que NÃO mudam status (2ª ligação no mesmo status) não contam — subconta atividade repetida; a ficha avisa. |
| R21 | Penetração por Empresa | 🟢 | Contatos da coorte ÷ empresas distintas, por BDR; só contatos com empresa associada (95%). |
| R22 | Trabalhados na Semana | 🟢 | Últimos 7 dias por último evento do histórico, independe do filtro; cap de 60 linhas na tabela com "Explorar com filtros" para o resto. |

Também em 2026-07-10: **R13/R14** ganharam dimensão de empilhamento Por BDR | Por Origem (`origem__originacao_`) | Por Porte — cálculo por deal inalterado, só o agrupamento; drilldown pré-seleciona a dimensão ativa.

## Causas-raiz (consertam vários de uma vez)

1. **Foto ≠ funil.** N01, N03, N08 (e Conversão do board) tratam a contagem atual por etapa como conversão. Conversão real só no **C09** (histórico, via `/api/funnel-stages`). Os outros deveriam se chamar "distribuição atual".
2. **`NOVO_STAGE_ORDER` mistura Vendas + Bid** numa sequência linear — qualquer "progressão" entre etapas de pipelines diferentes é inválida.
3. **Win rate sem os perdidos** (N09, N12) — há 884 perdidos disponíveis na API; dá para calcular `ganhos ÷ (ganhos + perdidos)` de verdade.
4. **Outliers de vidas + carga de Reunião Agendada** distorcem tudo que agrega por `createdate` ou `vidas` (N02; board Entrada vs Saída).
5. **~6 duplicatas** de gráficos já validados (N08=N03, N15=C08, N23=C07, N25≈N14, N10≈C05, N26⊃N05) inflam a página e multiplicam o risco de divergência aparente.

## Como reproduzir esta auditoria

```powershell
node scripts/_capture-charts.js public/novo-board.html
node scripts/_capture-charts.js public/novo-dashboard.html includeLost
```
(Servidor local na 3002 precisa estar no ar.)

## Adendo | BDR Workload (2026-07-13)

- **Leitura sem contexto (2026-07-24):** os ícones agora começam por um glossário operacional e evitam depender de siglas ou nomes de tabelas. Contato elegível = contato que virou Lead no HubSpot, está associado a uma empresa, pertence a um BDR ativo e cuja criação do Lead caiu no período selecionado. O menu interno (`premium.js`) foi reconciliado com o externo (`nav.js`): Treble 🟢 | Ataque à Lista 🔴 | Workload 🟡.
- **Clareza operacional (2026-07-24):** todos os KPIs e gráficos recebem memória de cálculo própria por título, com pergunta, leitura, fórmula/denominador e fonte. “Cobertura” no Pulso significa **contatos elegíveis tocados ÷ contatos elegíveis**; “Cobertura porte/segmento/persona” significa **preenchimento do atributo ÷ universo elegível**. As duas medidas não são intercambiáveis. Semáforo canônico: Treble 🟢 | Ataque à Lista 🔴 | Workload 🟡.
- **`bdr-workload.html` (subpágina nova) → 🟡 em auditoria.** KPIs e tabelas reconciliam por construção (todo KPI clicável abre a lista nominal que ele conta). Validação inicial 13/07 com dados de produção: empresas/contatos/transições do dia batem com contagem independente. Pendências declaradas na própria página: motivo de desqualificação (propriedade inexistente no portal), fonte não se aplica a movimentações, primeiro retorno usa proxy CONNECTED.
- **Patch GCP source (2026-07-20) → ainda 🟡 até smoke pós-deploy.** SQL principal passa a vir de deals reais no BigQuery silver (`sql_deals`), e atividades históricas do gold (`bdr_daily_ops`); hoje continua HubSpot live para evitar snapshot parcial das 08:00 BRT. `OPEN_DEAL` foi rebaixado para proxy de status. Zero registrado em dia útil não é mais tratado como provável erro de API quando histórico está disponível.
- **Evidência pós-deploy (2026-07-20):** build Vercel PASS; assets atualizados nos dois aliases; API protegida retorna 401 sem sessão. Smokes locais autenticados contra as mesmas fontes reconciliaram 12 SQLs em 7D e mais de 1.200 atividades hoje. Mantém 🟡 somente porque o smoke visual autenticado de produção depende da sessão do usuário.
- **Reabertura por filtro BDR (2026-07-20):** Thauan zerava porque o ETL GCP não continha seu owner ID. Roster corrigido para 13 BDRs, backfill refeito e teste nominal adicionado. Ritmo histórico agora é MECE estrito (calls + outgoing emails + WhatsApp communications + LinkedIn communications + meetings), sem tarefas/notas. Correlação fonte→resultado removida por denominador heterogêneo. Quality gate permanece 🟡 até confirmação visual pós-deploy do filtro Thauan.
- **Workload v2 (2026-07-20) → 🟠 com limitações explícitas.** Cinco abas substituem
  o scroll único; metas saem da experiência; hoje usa live server-side e histórico
  usa Gold. Gestão ordena por delta do período anterior, canais, leads e SQL. Ligações
  separam conversa/discagem/desfecho/duração. Penetração é experimental porque o
  denominador é o snapshot observado, não toda a carteira elegível. Reatividade,
  CRM, segmento e persona permanecem bloqueados onde falta semantic layer. A×B com
  hoje mostra aviso de comparação parcial não equivalente. Build, smoke local real,
  reviewer e skeptic passaram; produção validada publicamente com HTML 200 e APIs 401.

## Adendo | Renomeação: código único por card em CRO/Board/AE (2026-07-16)

> Decisão do dono: código de card repetido entre painéis não existe mais. A convenção
> nova: **cada painel tem códigos próprios** (CRO = C/P/S/N, Board = B, AE = A) e, onde
> o gráfico é **genuinamente compartilhado** (mesmo builder do `shared-charts.js` — não
> pode driftar), a tag carrega a origem: ex. `B07 | =C04`. Código **sem** `=` é fórmula
> própria do painel: paridade com o CRO não é garantida por construção. Os códigos do
> CRO (vocabulário estabelecido: C07, N06B, N05...) não mudaram.

**CRO (`dashboard.html`) — fim dos `N00` repetidos.** Ex-N00 ganharam N30–N41;
**N13–N29 ficam reservados** (não usar) para nunca colidir com a numeração da tabela
histórica N01–N26 de 12/06, que segue outra ordem. De-para (com a linha correspondente
da tabela histórica, quando existe):

| Key | Código antes | Código agora | Nome atual | Linha da tabela de 12/06 |
|---|---|---|---|---|
| waterfall | N00 | **N30** | Fluxo Semanal \| Criados · Ganhos · Perdidos | — (card reformulado pós-12/06; segue na fila 🟡) |
| netflow | N00 | **N31** | Fluxo Líquido de Vidas | N02 🟠 |
| stageprog | N00 | **N32** | Progressão por Etapa | N03 🔴 |
| passthru | N00 | **N33** | Taxa de Passagem por Etapa | N08 🔴 |
| sizewindow | N00 | **N34** | Distribuição por Tamanho \| Janela | N10 🟠 |
| vidaswindow | N00 | **N35** | Distribuição de Vidas \| Janela | N11 🟠 |
| segdoughnut | N00 | **N36** | Receita por Segmento \| Donut | N15 🟢 (duplicata do C08) |
| visibility | N00 | **N37** | Visibilidade de Receita | N16 🟢 |
| timetomeeting | N00 | **N38** | Reunião Ocorreu \| Cobertura do Campo | ≈ N19 🟠 (reformulado) |
| financial | N00 | **N39** | Resultados Financeiros | N21 🟢 |
| receivables | N00 | **N40** | Timeline de Recebíveis | N25 🟠 |
| risktriage | N00 | **N41** | Triagem de Risco Top 20 | N26 🟢 |

Também sincronizados os títulos do drawer de ajuda que ainda embutiam a numeração de
12/06 divergindo do mapa: piperev12 `(N14)`→`(N06)`, wonmonthly `(N22)`→`(N10)`,
weightedrevstage `(N24)`→`(N12)` — e os ex-N00 acima ganharam o código novo no título.
Antes desta correção a UI exibia `(N01)`/`(N02)`/`(N03)`/`(N08)` DUPLICADOS em cards
diferentes (waterfall×cohort, netflow×freshness, stageprog×winratesize,
passthru×speedqualify).

**⚠ Constatação da validação no DOM real (Edge headless, 16/07):** NENHUM dos 12
ex-N00 está renderizado hoje no `/novo`. Vários constam como "removidos a pedido" nos
comentários do render (N06, N10/N11, N15/N16 na numeração antiga); os demais
(waterfall, financial, receivables, risktriage...) têm builder/i18n/ajuda órfãos no
código — ex.: `buildNovoWeeklyFlow` existe mas nunca é chamado. Os códigos N30–N41
valem como reserva se os cards forem reativados; a limpeza do código morto é decisão
separada (não feita aqui). Cards do CRO efetivamente renderizados e verificados com
tag única no DOM: P01–P09, S01–S05, C01–C04, C06–C08, N01–N09, N06B (+P00/S06/C00
condicionais).

**Board (`board.html`):**

| Key | Antes | Agora | Observação |
|---|---|---|---|
| kpi-won-arr | P07 | **B01** | Fórmula própria (era o mesmo código do P07 do CRO); reusa o modal do P07 |
| kpi-forecast | P03 | **B04 \| =P03** | Número vem de `sharedWeightedPipelineARR` (shared-charts.js) — paridade por construção |
| pipe-stage | C04 | **B07 \| =C04** | `buildSharedStageVal`; B07 era o código histórico citado no cabeçalho do shared-charts.js |
| deal-bench | C08 | **B09 \| =C08** | `buildSharedSizeDonut`; B09 idem (ex-C03 do board) |

B02, B03, B05, B11, B12, B15, B16 inalterados.

**AE (`ae.html`):**

| Key | Antes | Agora | Observação |
|---|---|---|---|
| kpi-active-deals | P01 | **A22** | Fórmula própria |
| kpi-open-lives | P02 | **A23** | Fórmula própria |
| kpi-won-lives | P08 | **A24** | Fórmula própria |
| kpi-won-arr | P07 | **A25** | Fórmula própria |
| kpi-stale | S05 | **A26** | Fórmula própria |
| kpi-meetings | P04 | **A27** | Fórmula própria |
| vidas-ae | C01 | **A28 \| =C01** | `buildSharedVidasDealsAE` (shared-charts.js) — paridade por construção |

A07–A21 inalterados. **A01–A06 não foram reutilizados** (códigos históricos do painel;
A05/A06 foram mesclados no card compartilhado C01).

Fora do escopo: `bdr.html` (códigos R — território do Samuel, coordenar antes) e os
painéis Forecast (não usam este sistema de tags). Vereditos de validação (emojis) não
foram alterados — renomeação pura.

## Adendo | AE Performance: leva 2 + achado A07 × forecast (2026-07-16)

> Segunda leva no `/novo-ae`. A07, A12, A14, A16 revistos; A13 diagnosticado. Emojis 🟡
> removidos de A12/A14/A16 (cálculo confirmado); **A07 permanece 🟡** por não bater.

- **A07 (Receita do Forecast por AE) → 🟡 REMOVIDO (decisão do dono: régua flat).** O achado
  original: A07/N06B probabilizavam com o **funil C07 por pipeline** enquanto os painéis de
  forecast usam a **régua flat** — Real reconciliava (≈95,8M), Probabilizada não (5,5M funil ×
  ~20,8M). **Decisão do dono (16/07): usar a régua flat.** `_novoFcStageProbForwd()` do
  `ae.html` (A07) e do `dashboard.html` (N06B + N05) foi religado à régua flat (sem funil);
  o funil C07 segue só nos gráficos de conversão. A07 Probabilizada FULL passou a **8,66M**
  (harness ao vivo) e reconcilia por construção com o Forecast Overall (flat + BID 0,5% +
  mesmo motor/conjunto). **Residual conhecido:** a tela `/forecast` dá ao BID a régua cheia
  (28,5%/49,3%) em vez de 0,5% — ~11M só nela, a alinhar pela sessão do forecast (`FC_BID_PROB`).
- **A13 (Deal Age Distribution) | "184 e não 173" RESOLVIDO:** era o único card de idade que
  não filtrava pelo time — os deals extras são os mesmos owners fora do time do A11 (Peterson,
  Aurilia, Yokyko, Anderson, Pacheco, sem-owner). Religado à MESMA base do A12 (`_aeAgingBase`:
  time + sem Implantação + com data de RA) → A13 == A12 (172 ao vivo).
- **A16:** base cortada em set/2025 (`AE_MTG_FLOOR`); 🟡 removido. **A12:** 🟡 removido.
  **A14:** coluna Completude removida; 🟡 removido.

## Adendo | AE Performance: leva de correções do dono (2026-07-16)

> Cinco mudanças pedidas pelo dono no `/novo-ae`, todas front-only (o payload já tinha os
> campos). Nenhum veredito foi promovido — os cards seguem 🟡 na fila abaixo.

- **A11 (Distribuição de Etapas por AE) | mistério "180 de 189" RESOLVIDO:** a diferença
  para o KPI Deals Ativos (A22) NÃO é o toggle RA/Standby (vale igualmente para os dois
  números) — são os deals ativos de owners FORA do time de executivos (medição de 16/07:
  9 deals — Peterson Venancio 4, Aurilia 1, Yokyko 1, Anderson 1, Pacheco 1, sem owner 1).
  O subtítulo do card agora explicita: "X de Y ativos | fora do time: N".
- **A12 (Idade Média por AE) | Implantação SEMPRE fora:** base própria (`_aeAgingBase`) —
  antes, deals em Implantação entravam na média quando o toggle "Implantação = Ganho"
  estava desligado. Contagem do subtítulo corrigida para a base real do gráfico (antes
  mostrava todos os abertos, incluindo owners fora do time e deals sem data de RA).
- **A16+A18 FUNDIDOS | base nova pela DATA DA REUNIÃO:** card único "Reuniões com o
  Executivo | Occurrence Rate" com toggle Mensal | Executivo. A base conta pela data da
  reunião com o executivo (`data_do_reagendamento_com_o_executivo` tem precedência sobre
  `data_da_reuniao_com_executivo`) e SÓ reuniões já vencidas (≤ hoje) — antes contava pela
  entrada na etapa Reunião Agendada e misturava reuniões futuras como falso "sem
  preenchimento". Medição de 16/07: 965 reuniões vencidas = 548 Sim | 321 Não | 96 sem
  preenchimento (Occurrence Rate 63%). Código A18 aposentado (tag do card: A16+A18).
  Ressalva herdada: valores mistos "Nao;Sim" (checkbox múltiplo) contam como Sim —
  pendência de higiene do CRM já registrada no STATUS_LOG (15/07).
- **A14 | radar aposentado → Scorecard multidimensional:** o radar normalizava tudo em
  0-100 e misturava contagens com porcentagens numa escala só. Virou tabela com cada
  métrica na SUA unidade (Deals abertos, Vidas abertas, ARR aberto, Win Rate do período,
  Completude), cor comparando os AEs POR COLUNA, linha "Time" com somas/taxas agregadas
  (não média das médias) e clique no nome do AE abrindo os deals.

Validação (16/07): DOM real em Edge headless (contagens, toggle ativo, tabela do
scorecard renderizada), sintaxe inline OK, `npm run check` PASS. Validação contra o
HubSpot segue pendente — fila 🟡 abaixo atualizada com os nomes novos.

## Adendo | TCV unificado com o Forecast em C04/C08 (CRO) e B07/B09 (Board) (2026-07-16)

> Pedido do dono: os TCVs por etapa do C04/B07 divergiam da coluna TCV dos painéis
> Forecast. Causa raiz (medida com dados reais): o `_novoDealTcv` usava **12 meses
> fixos** + **proxy de Diagnóstico** (vidas × R$/vida × 12 — 44 deals sem régua
> somavam 72,5MM contra 9,5MM da régua real) e **não aplicava a dedup Fee×Corretagem**.
> Unificado: TCV = `calcTCV` (régua × período do contrato, 12/24/36; sem período → 12)
> com dedup do Forecast Overall (`OverallCore.revExcluded`; gêmeo excluído = 0).
> **Paridade provada com dados de produção** (harness interceptando `_novoMkChart`):
> C04 = B07 = coluna TCV do Forecast em todas as etapas — Diagnóstico 9,49MM ·
> Cotação 1,95MM · Proposta 57,13MM · Consultoria 5,61MM (dedup ativa) ·
> Negociação 7,93MM.

- **B09 | 🟡 removido do título** (decisão do dono, com a unificação acima como lastro).
  C04/C08 do CRO seguem sem emoji (família validada de 12/06); a semântica de todos os
  quatro mudou CONSCIENTEMENTE — quem comparar com números antigos verá o Diagnóstico
  cair de ~72MM para ~9,5MM (o proxy foi aposentado, não é regressão).
- **Coluna TCV (R$)** adicionada à tabela rica dos modais de CRO e Board (drills das
  fatias/etapas): valor por deal = a métrica do gráfico (gêmeo dedup mostra 0), com
  total no tfoot — a lista soma exatamente o que a fatia/barra mostra.
- **Forecast (`/forecast` + painéis de etapa): coluna 🟡 ARR Pond. (R$)** — ARR
  estimado (fallback 1ª fatura × 12) × P. Ajust., a mesma leitura de ARR ponderado de
  B15/B16/P03/B04, para auditoria de paridade entre painéis. Nasce 🟡 (régua desta
  auditoria): falta validar contra amostra manual e contra o Board no mesmo instante;
  diferença residual esperada = fonte da probabilidade (flat × C07), documentada na
  regra `arr_ponderado_forecast` do catálogo.
- **B15**: nome do AE agora clicável (modal com chips por etapa + tabela rica) — só
  interação, zero mudança de cálculo; veredito do card inalterado.

## Adendo | Colunas configuráveis no Forecast + B12 removido + B15/B16 sem 🟡 (2026-07-16)

> Leva do dono. Núcleo: **mostrar/ocultar colunas** nas Configurações de TODOS os painéis
> Forecast, com **catálogo idêntico** entre eles.

- **Forecast (`/forecast` + todos os painéis de etapa `forecast-stage.html`): seletor de
  colunas.** Nova seção "Colunas visíveis" no modal de Configurações (fonte única
  `forecast-columns.js`): checkbox por coluna, visibilidade POR PAINEL (localStorage
  `fc_cols_hidden_v1::<painel>`), default tudo visível. Os dois arquivos foram
  **reconciliados para o MESMO catálogo de 29 colunas alternáveis** (provado por harness:
  keys idênticas e na mesma ordem) — `createdate`, `periodo_contrato` e
  `vencimento_primeira_fatura` viraram colunas base em ambos (antes eram splice condicional
  só no stage / só no forecast). A âncora Deal e as colunas de comparação (comp_*) não são
  alternáveis. O modal de detalhe do deal SEMPRE mostra todos os campos (esconder é só da
  tabela). `/forecast-overall` não tem lista → a seção fica oculta. **Hide provado
  end-to-end** (harness ao vivo no painel Negociação: 30 → 28 th ao ocultar tcv+vidas,
  resto intacto, 0 erro). Não altera veredito/emoji de nenhuma coluna.
- **B12 (ARR Bridge | Variação Mensal) REMOVIDO** a pedido do dono — resolve o veredito
  **🔴** desta auditoria (não era bridge; barra negativa ≠ churn). Card, builder, i18n e
  entradas de mapa removidos; comentário-âncora deixado no código.
- **B15 e B16: 🟡 removido do título** (decisão do dono). B15 (Top 5 AEs) ganhou também
  **chips de filtro por EXECUTIVO no topo do modal** (todos os AEs do pipeline ativo,
  ranqueados; troca o AE sem fechar) + o sub-filtro por etapa + tabela rica já existentes
  — provado no harness (12 chips de executivo, 8 de etapa, coluna TCV na tabela).

## Adendo | Sincronização de títulos 🟡 com os vereditos desta auditoria (2026-07-14)

> Revisão dos títulos com 🟡: vários gráficos do CRO/Board seguiam com 🟡 no título
> apesar de JÁ terem veredito nesta auditoria (título mentindo por dessincronização).
> Títulos sincronizados aos vereditos existentes — nada foi "promovido" sem lastro.

**Sincronizados no `dashboard.html` (14 chaves i18n, PT+EN), por NOME da tabela N01–N26:**
🔴 Progressão por Etapa (N03) · 🔴 Taxa de Passagem (N08) · 🟠 Fluxo Líquido de Vidas (N02) ·
🟠 Distribuição por Tamanho (N10) · 🟠 Distribuição de Vidas (N11) · 🟠 Valor do Pipeline
Projeção Mensal (N14) · 🟠 Reunião Ocorreu/Cobertura (N19) · 🟠 Timeline de Recebíveis (N25) ·
🟢 Receita por Segmento (N15, duplicata do C08) · 🟢 Visibilidade de Receita (N16) ·
🟢 Resultados Financeiros (N21) · 🟢 Deals Ganhos Mensal (N22) · 🟢 Receita Ponderada por
Etapa (N24) · 🟢 Triagem de Risco Top 20 (N26). No `board.html`: 🔴 ARR Bridge (veredito
desta auditoria; tooltip agora carrega o aviso "não é churn").

**Fila honesta do que CONTINUA 🟡 (nunca analisado — validação real pendente):**

| Onde | O quê | O que a validação exige |
|---|---|---|
| `/novo-ae` | Distribuição de Etapas por AE (A11) · KPI Receita Ganha/Ano (A25) | Painel AE nunca entrou nesta auditoria; validar cada card contra contagens independentes do HubSpot. **A07, A12, A14, A16 tiveram o 🟡 removido em 16/07** (A07: régua flat por decisão do dono, reconcilia com o Forecast Overall; A12/A14/A16: cálculo aceito). |
| `/novo-board` | TCV do Pipe por Bucket (C08) · Top 5 AEs Weighted · Top 10 BoD Watchlist | Conferir TCV pela régua e ponderação global contra amostra manual |
| `/forecast-delta` | Painel inteiro (pill 🟡) | Invariante Σ Δ = Total B − A PASSA para todos os pares de fotos (reteste 2026-07-14) e drawer gerado do catálogo ✓, MAS falta a prova externa: com a PRÓXIMA foto de sexta, comparar B=foto do dia com o Forecast Overall ao vivo no MESMO momento — se bater, sobe para 🟠/🟢. Não forçar foto fora do cron só para isso (escreve na planilha de produção). |
| `/novo-bdr/workload` | Página (🟡 em auditoria) | Pendências declaradas acima (adendo 2026-07-13) |
| `/novo` | Fluxo Semanal · KPIs Pipeline Ponderado/Completude/Prêmio Mensal/Momentum · S01–S04 | Sem veredito na tabela N (cards novos pós-12/06); validar contra HubSpot |

**Método usado nesta revisão:** títulos extraídos do DOM real (Edge headless) — não de grep
de código, porque o dashboard tem chaves i18n mortas que nunca renderizam (t_funnel,
t_sizedist, t_vidasdist, listadas acima) e essas ficaram intocadas.
