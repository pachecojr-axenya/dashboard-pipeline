'use strict';
/**
 * GET /api/bdr-lead-funnel?since=2026-08-01&until=2026-08-11&funil=todos|principal|diagnostico
 *
 * O funil de PRÉ-REUNIÃO no objeto certo: o **objeto Leads nativo** (`0-136`).
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE ENDPOINT EXISTE (auditoria de 11/08/2026)
 * ────────────────────────────────────────────────────────────────────────────────
 * O "Funil de Lead Status" de `/novo-bdr` era desenhado a partir de `hs_lead_status`
 * no CONTATO. Medido em jul/2026: **234 contatos criados com status contra 2.302
 * leads criados**; **530 transições de status de contato contra 6.588 movimentações
 * de etapa de lead**. A tela media ~10% do funil.
 *
 * E `hs_lead_status` está abandonado: 11.344 de 12.523 contatos (90,6%) presos em
 * `NEW`. Um funil em que 9 de cada 10 objetos não andam não descreve trabalho —
 * descreve uma propriedade que ninguém usa. A spec `outbound-hubspot-first` já
 * havia fixado em 10/07/2026, depois de pushback do dono, que o topo é o objeto
 * Leads; a tela foi construída no palpite descartado.
 *
 * Doc: 20_Company/Sales/Pipeline_Dashboard/2026-08-11_Auditoria_Funil_Lead_Fonte_Unica.md
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * DE ONDE CADA BLOCO LÊ, e por que não é tudo de gold
 * ────────────────────────────────────────────────────────────────────────────────
 * Régua do dono (11/08): "trocar a fonte sem perder a qualidade do dado já
 * validado". O que está validado é o **silver** (paridade medida endpoint por
 * endpoint contra a API). O gold nunca foi consumido por tela nenhuma, logo nunca
 * foi validado COMO FONTE DE TELA — só como número provado por `checks`. São
 * garantias diferentes.
 *
 * Então cada bloco declara sua `camada` no payload, e o waterfall nasce em SILVER
 * DE PROPÓSITO: a consulta silver é a contraprova do mart que vem na F2. Nascer
 * direto em mart deixaria o futuro `mece_lead_waterfall` sem segundo caminho para
 * comparar, e check que confere o mart contra si mesmo é espelho, não prova.
 *
 * `tier_colaboradores` e `numero_de_vidas` são lidos do **bronze** (`raw_contact`,
 * via JSON_VALUE) porque NÃO estão projetados em `dim_contact` — medido: 10.946 e
 * 10.591 preenchidos no portal, 0 alcançáveis pelo silver. Isso é MEDIDA
 * TEMPORÁRIA declarada: a correção certa é projetá-los no `10_silver.sql` (F0), e
 * ler bronze de dentro de um endpoint é dívida, não padrão. Está aqui para não
 * atrasar a tela por causa de um deploy de ETL que reinicia o relógio dos 7 dias
 * verdes.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * AS DECISÕES QUE MUDAM NÚMERO, todas no payload em `premissas`
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * 1. PIPELINE DO EVENTO, nunca o atual. 1.456 leads TROCARAM de pipeline (1.496
 *    trocas em `fact_crm_change.hs_pipeline`). Bucketizar pelo `dim_lead.pipeline_id`
 *    atual apagaria retroativamente o New e a Tentativa REAIS de quem trabalhou no
 *    funil principal e depois foi despejado no Backup — medido em 3 leads, todos
 *    desqualificados em 03/06/2026, cheiro de movimentação em lote. É a mesma
 *    armadilha A3 que custou 28% das entradas no funil de deals (commit 38aab43).
 *    `fact_stage_entry` já guarda o pipeline do evento; aqui só não se joga fora.
 *
 * 2. BACKUP (807886369) FORA. Decisão do dono: os funis válidos são o principal
 *    (`lead-pipeline-id`) e o Diagnóstico Site (`860642209`). O Backup parou de
 *    receber lead em 09/04/2026. A exclusão é pelo pipeline DO EVENTO, então uma
 *    etapa que aconteceu no funil principal continua contando ali mesmo que o lead
 *    hoje esteja no Backup.
 *
 * 3. `stage_canon` EXPLÍCITO, nunca `stage_order`. O principal vai 0–4, o
 *    Diagnóstico Site vai 1–5, e os rótulos divergem (New/Novo, Contato
 *    efetivo/Conectado, Qualified/Qualificado). Somar por `stage_order` desloca um
 *    funil inteiro em uma etapa. Etapa desconhecida cai em `(nao_mapeada)` e é
 *    CONTADA no payload — cair fora em silêncio é como as 2.200 entradas de deal
 *    desapareciam.
 *
 * 4. DUAS RÉGUAS DE TAXA DE CONTATO, lado a lado, com o gap nomeado. Medido na
 *    coorte de jul/26 (2.302 leads): por ETAPA 2.057 (89,4%), por ATIVIDADE REAL
 *    1.076 (46,7%). **1.009 leads foram movidos para "Tentativa de Contato" sem um
 *    único toque no CRM.** A premissa do dono ("teve que passar, senão não tem
 *    como") NÃO se sustenta no dado. Escolher uma régua calado transforma
 *    indisciplina de CRM em número bonito.
 *
 * 5. AUTOMAÇÃO NÃO É ESFORÇO DO BDR. 1.812 de 7.568 movimentações (24%) não têm
 *    autor humano (`AUTOMATION_PLATFORM` 1.450, `INTEGRATION` 306, bulk 56).
 *    Atribuir tudo ao dono atual credita a BDR o que um workflow fez — mesmo
 *    defeito que o `whatsapp_total` tinha, mesma solução: bucket próprio.
 *
 * 6. DONO NO INSTANTE, não o atual (`fact_owner_assignment`, que cobre lead com
 *    17.073 posses). Em 184/184 casos rastreáveis a troca de dono veio DEPOIS do
 *    toque: régua de "dono atual" é retroativa — reatribuir hoje reescreve ontem.
 *
 * 7. MOTIVO DE DESQUALIFICAÇÃO EXISTE no lead (17 valores). A ficha do card antigo
 *    dizia que o portal não tem o campo, e isso era verdade só para o CONTATO. Mas
 *    o preenchimento é desigual e num funil é ZERO: principal 99,2%, Backup 34,4%,
 *    **Diagnóstico Site 0,0% (1.056 desqualificados, nenhum motivo)**. O drill vai
 *    mostrar "(sem motivo) 100%" ali, e isso é achado operacional, não bug.
 *
 * `?fonte=api` NÃO é suportado aqui de propósito: reconstruir este funil pela API
 * exigiria paginar 18k leads + histórico em lote por request, que é exatamente o
 * custo que a fonte única existe para eliminar. A contraprova deste endpoint é a
 * Search API por etapa (barata, `total` sem paginar), exposta em
 * `diagnostics.snapshot_vs_portal` quando `?portal=1`.
 */

const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');
const { hubspotPost } = require('../lib/hubspot');
const { BDR_TEAM, resolveTeamIds } = require('../lib/bdr-team');
const wh = require('../lib/hubspot-warehouse');

// ── Pipelines de lead ────────────────────────────────────────────────────────────
const PIPE_PRINCIPAL  = 'lead-pipeline-id';
const PIPE_DIAGNOSTICO = '860642209';
const PIPE_BACKUP      = '807886369';

const FUNIS = {
  principal:   [PIPE_PRINCIPAL],
  diagnostico: [PIPE_DIAGNOSTICO],
  todos:       [PIPE_PRINCIPAL, PIPE_DIAGNOSTICO],
};

// ── Mapa canônico de etapa ───────────────────────────────────────────────────────
// Chave = stage_id (único por pipeline no HubSpot). Confirmado ao vivo em 11/08/2026
// via GET /crm/v3/pipelines/0-136. NÃO derivar de stage_order: o Diagnóstico Site
// começa em 1 e o principal em 0.
const STAGE_CANON = {
  // principal (lead-pipeline-id)
  'new-stage-id':        'novo',
  'attempting-stage-id': 'tentativa',
  'connected-stage-id':  'conectado',
  'qualified-stage-id':  'qualificado',
  'unqualified-stage-id':'desqualificado',
  // Diagnóstico Site (860642209)
  '1287976462': 'novo',
  '1287976463': 'tentativa',
  '1287976464': 'conectado',
  '1287976465': 'qualificado',
  '1287976466': 'desqualificado',
  // Backup (807886369) — mapeado para o waterfall não perder o DESFECHO de quem
  // trabalhou no funil válido e terminou aqui. O pipeline segue excluído do recorte.
  '1188963708': 'novo',
  '1188963709': 'tentativa',
  '1188963710': 'conectado',
  '1188963711': 'qualificado',
  '1188963712': 'desqualificado',
};

// Ordem do funil. `desqualificado` é TERMINAL e fica fora do rank de progressão —
// desqualificar não é avançar.
const FUNNEL_ORDER = ['novo', 'tentativa', 'conectado', 'qualificado'];
// Ordem COMPLETA, com o terminal. FUNNEL_ORDER e o rank de progressao (desqualificar
// nao e avancar); CAN_ALL e a ordem de EXIBICAO, onde o terminal precisa aparecer.
const CAN_ALL = ['novo', 'tentativa', 'conectado', 'qualificado', 'desqualificado'];
/**
 * OS RÓTULOS SÃO NUMERADOS, e o número não é enfeite: é o que faz a ORDENAÇÃO
 * funcionar.
 *
 * Pedido do dono (12/08/2026): "eu quero que sejam enumeradas, então o novo é etapa 1.
 * Se eu tento ordenar, não consigo, porque N está no meio da ordem alfabética." De
 * fato: por rótulo, a ordem alfabética é Conectado, Desqualificado, Novo, Qualificado,
 * Tentativa — que não é ordem nenhuma do funil. Ordenar coluna de texto é comparação
 * de string (localeCompare), então a ordem do funil precisa estar DENTRO do texto.
 *
 * O separador é "·" e não "." para o número não ser lido como numeração de lista por
 * leitor de tela nem virar "1." colado no nome em coluna estreita.
 */
const CANON_PT = {
  novo: '1 · Novo',
  tentativa: '2 · Tentativa de contato',
  conectado: '3 · Conectado',
  qualificado: '4 · Qualificado',
  desqualificado: '5 · Desqualificado',
  '(nao_mapeada)': '9 · (etapa não mapeada)',
};
/** Sem o número — para frase corrida, onde "2 · Tentativa" atrapalha a leitura. */
const CANON_PT_LIMPO = {
  novo: 'Novo',
  tentativa: 'Tentativa de contato',
  conectado: 'Conectado',
  qualificado: 'Qualificado',
  desqualificado: 'Desqualificado',
  '(nao_mapeada)': '(etapa não mapeada)',
};
const RANK = { novo: 0, tentativa: 1, conectado: 2, qualificado: 3 };

function canon(stageId) {
  return STAGE_CANON[String(stageId || '')] || '(nao_mapeada)';
}

/**
 * A RÉGUA DE ATIVIDADE REAL, em UM lugar só.
 *
 * Duplicar esta condição em duas consultas é como a régua drifta: um lado ganha um
 * canal, o outro não, e os dois números passam a discordar sem ninguém saber por quê.
 *
 * CORRIGIDA em 11/08/2026 depois de auditoria de caso apontada pelo dono. O lead
 * "Rui Medeiros 2026-08" (Boston Scientific, BDR Felipe Andrade) aparecia como
 * "✖ sem toque" tendo **WhatsApp manual enviado em 07/08**. A régua anterior cobria
 * ligação conectada, e-mail enviado e LinkedIn — e **omitia WhatsApp**, que é o canal
 * mais usado do time depois do e-mail (7.297 mensagens manuais em 90 dias).
 *
 * Efeito medido na coorte de jul/26 (2.302 leads): atividade real vai de **1.076
 * (46,7%) para 1.601 (69,5%)** — **525 leads** que a tela chamava de "sem toque"
 * tinham WhatsApp digitado à mão. O gap "movido de etapa sem toque" cai de 1.009 para
 * ~490. O número publicado antes desta correção estava inflado, e isso está declarado
 * em `premissas.regua_atividade_corrigida`.
 *
 * O QUE CONTA (alguém digitou ou falou):
 *   · ligação CONECTADA — discagem sem conexão não é contato (decisão do dono: "conectada")
 *   · e-mail ENVIADO
 *   · LinkedIn enviado
 *   · WhatsApp enviado MANUALMENTE (fora de `source_label = 'INTEGRATION'`)
 *   · reunião REALIZADA
 *
 * O QUE NÃO CONTA, e por quê:
 *   · TAREFA — é intenção, não ação. O caso do Rui tinha duas tarefas de sequência
 *     ("Contato WhatsApp", "Ligação"); contá-las creditaria a fila, não o contato.
 *   · NOTA — decisão de 10/08: "nota não é ação, e-mail é".
 *   · E-MAIL DE ENTRADA, inclusive auto-reply. O caso do Rui tinha um
 *     "Automatic reply:" — ele PROVA que houve envio, mas o envio não está na fato
 *     para este contato, e transformar resposta automática em toque do BDR inverte
 *     quem agiu.
 *   · WHATSAPP DE INTEGRAÇÃO (Treble) — vai em bucket próprio. Mesma decisão de
 *     10/08: automação não é esforço do BDR. Fica VISÍVEL como `so_automacao`, porque
 *     "o lead foi tocado por robô e por mais ninguém" é informação, não ruído.
 */
const ATIV_MANUAL = `(
     f.is_connected
  OR (f.kind = 'emails' AND f.is_outbound_message)
  OR (f.channel_type = 'LINKEDIN_MESSAGE' AND f.is_outbound_message)
  OR (f.channel_type = 'WHATS_APP' AND f.is_outbound_message AND IFNULL(f.source_label,'') != 'INTEGRATION')
  OR f.is_meeting_held
)`;
const ATIV_AUTOMACAO = `(f.is_outbound_message AND f.source_label = 'INTEGRATION')`;

/**
 * A TERCEIRA RÉGUA: ESFORÇO. Discagem que não conectou É tentativa de contato.
 *
 * Decisão do head de BDRs, trazida pelo dono em 12/08/2026: *"mesmo que a tentativa de
 * ligação tenha falhado, isso conta como uma tentativa de contato"*. A régua anterior
 * só contava a ligação CONECTADA, então a tela dizia "não tocou" para quem discou vinte
 * vezes — que é o oposto do que aconteceu.
 *
 * As duas réguas NÃO se substituem, elas se empilham, e é a distância entre elas que é
 * o achado. Medido em jul–ago/2026 (01/07 a 11/08): **9.365 ligações registradas contra
 * 704 conectadas — 7,5%**. Os desfechos: Sem resposta 4.659, Ocupado 3.404, Deixou
 * mensagem de voz 338, Número errado 69. Ler só "conectou" apaga 8.661 discagens de
 * esforço real; ler só "discou" transforma uma lista de telefone ruim em produtividade.
 *
 * TRÊS NÍVEIS, e cada um responde uma pergunta diferente:
 *   · ESFORÇO      — discou ou mandou mensagem. "A pessoa trabalhou este lead?"
 *   · ATIVIDADE    — mensagem entregue ou voz conectada. "Alguma coisa chegou do outro lado?"
 *   · CONVERSA     — ligação conectada, com duração. "Alguém FALOU com o lead?"
 *
 * A hipótese que a distância entre eles testa é do próprio dono: *"às vezes a pessoa
 * tentou 100 ligações e só falou com três — a hipótese é enriquecimento"*. Por isso
 * `numero_errado` viaja como campo próprio: telefone errado é problema de DADO, não de
 * cadência, e as duas coisas pedem ações opostas.
 *
 * `is_attempt` do armazém NÃO serve aqui e a diferença é material: ele marca 5.196
 * e-mails de ENTRADA como tentativa (e-mail que o lead mandou não é esforço do BDR) e
 * deixa de fora 1.908 discagens "Sem resposta"/"Ocupado" que são exatamente o esforço
 * que o dono quer contar. A régua é escrita aqui, explícita, canal por canal.
 */
const ESFORCO_LIGACAO = `(f.kind = 'calls' AND IFNULL(f.direction,'') != 'INBOUND')`;
const ESFORCO_MENSAGEM = `(
     (f.kind = 'emails' AND f.is_outbound_message)
  OR (f.channel_type = 'LINKEDIN_MESSAGE' AND f.is_outbound_message)
  OR (f.channel_type = 'WHATS_APP' AND f.is_outbound_message AND IFNULL(f.source_label,'') != 'INTEGRATION')
)`;
const ATIV_ESFORCO = `(${ESFORCO_LIGACAO} OR ${ESFORCO_MENSAGEM})`;

/**
 * O TOQUE TEM DE SER POSTERIOR À CRIAÇÃO DO LEAD — correção de 11/08/2026.
 *
 * A régua liga toque→lead pelo CONTATO (`fact_engagement` não tem `lead_id`), e o
 * contato tem vida própria: ele pode ter sido trabalhado meses ou ANOS antes de
 * alguém criar este lead. Sem limite temporal, "falou com" contava esse histórico
 * como se fosse trabalho no lead da coorte.
 *
 * Escala medida na coorte de ago/26 (258 leads, 01–11/08): "falou com" cai de **210
 * para 191** — **19 leads (9%)** cuja ÚNICA prova de contato é um toque anterior à
 * própria existência do lead, um deles de **18/07/2024**. Por BDR o efeito é
 * desigual e muda leitura de pessoa: **Raina Cândido aparecia com 2 de 11 e o número
 * real é 0** (os dois toques são pré-criação); Allan Valença cai 31→25; Gabriele
 * Almeida 5→4. Nos leads movimentados na janela o mesmo corte é 535→510 (25 leads),
 * e ali ele também limpa o `contradiz_motivo` — desqualificar como "não houve
 * tentativa de contato" deixa de ser contradição quando o toque é de outro ciclo.
 *
 * O toque anterior NÃO é descartado em silêncio: vira o bucket `toque_herdado`, que
 * é informação real ("o contato já tinha sido trabalhado antes deste lead", muitas
 * vezes por outra pessoa) — só não é esforço no lead que se está medindo.
 */
const APOS_CRIACAO = `f.occurred_at >= b2.criado_em`;

/**
 * Atividade por lead, para os leads que a janela toca (criados OU movimentados).
 * Uma consulta, uma régua — servindo tanto a coorte quanto o drill de desqualificação.
 */
async function atividade(pipes, since, until) {
  const { rows } = await wh.query(`
    WITH alvo AS (
      SELECT lead_id FROM ${wh.t('silver', 'dim_lead')}
      WHERE is_current AND pipeline_id IN (${sqlList(pipes)})
        AND DATE(hs_created_at, 'America/Sao_Paulo') BETWEEN DATE(@since) AND DATE(@until)
      UNION DISTINCT
      SELECT DISTINCT ch.object_id FROM ${wh.t('silver', 'fact_crm_change')} ch
      WHERE ch.object_type = 'lead' AND ch.property = 'hs_pipeline_stage'
        AND DATE(ch.changed_at, 'America/Sao_Paulo') BETWEEN DATE(@since) AND DATE(@until)
    ),
    -- A criação do lead entra aqui porque a régua de toque é limitada a ela (ver
    -- APOS_CRIACAO): o contato tem vida anterior ao lead e ela não é esforço no lead.
    alvo_c AS (
      SELECT a.lead_id, l.hs_created_at AS criado_em
      FROM alvo a
      JOIN ${wh.t('silver', 'dim_lead')} l ON l.lead_id = a.lead_id AND l.is_current
    ),
    l2c AS (
      SELECT b.from_id AS lead_id, ANY_VALUE(b.to_id) AS contact_id, COUNT(DISTINCT b.to_id) AS n_contatos
      FROM ${wh.t('silver', 'bridge_association')} b
      JOIN alvo_c a ON a.lead_id = b.from_id
      WHERE b.from_object = 'lead' AND b.to_object = 'contact' AND b.is_active
      GROUP BY 1
    )
    SELECT c.lead_id, c.n_contatos,
           COUNTIF(${APOS_CRIACAO} AND f.is_connected) AS ligacoes_conectadas,
           COUNTIF(${APOS_CRIACAO} AND f.kind = 'emails' AND f.is_outbound_message) AS emails_enviados,
           COUNTIF(${APOS_CRIACAO} AND f.channel_type = 'LINKEDIN_MESSAGE' AND f.is_outbound_message) AS linkedin_enviados,
           COUNTIF(${APOS_CRIACAO} AND f.channel_type = 'WHATS_APP' AND f.is_outbound_message AND IFNULL(f.source_label,'') != 'INTEGRATION') AS whatsapp_manual,
           COUNTIF(${APOS_CRIACAO} AND f.is_meeting_held) AS reunioes,
           COUNTIF(${APOS_CRIACAO} AND ${ESFORCO_LIGACAO}) AS discagens,
           COUNTIF(${APOS_CRIACAO} AND f.kind = 'calls' AND f.disposition_label = 'Número errado') AS numero_errado,
           COUNTIF(${APOS_CRIACAO} AND ${ATIV_MANUAL}) AS toques_manuais,
           COUNTIF(${APOS_CRIACAO} AND ${ATIV_AUTOMACAO}) AS toques_automacao,
           -- Herdado do contato: existe, é informação, e NÃO conta como toque no lead.
           COUNTIF(NOT ${APOS_CRIACAO} AND ${ATIV_MANUAL}) AS toques_manuais_antes,
           FORMAT_TIMESTAMP('%F', MIN(IF(${APOS_CRIACAO} AND ${ATIV_MANUAL}, f.occurred_at, NULL)), 'America/Sao_Paulo') AS primeiro_toque
    FROM l2c c
    JOIN alvo_c b2 ON b2.lead_id = c.lead_id
    LEFT JOIN ${wh.t('silver', 'fact_engagement')} f ON f.contact_id = c.contact_id
    GROUP BY 1, 2
  `, [
    { name: 'since', type: 'DATE', value: since },
    { name: 'until', type: 'DATE', value: until },
  ]);
  const mapa = {};
  let multiContato = 0;
  rows.forEach(r => {
    if (wh.num(r.n_contatos) > 1) multiContato++;
    mapa[wh.str(r.lead_id)] = {
      ligacoes_conectadas: wh.num(r.ligacoes_conectadas),
      emails_enviados: wh.num(r.emails_enviados),
      linkedin_enviados: wh.num(r.linkedin_enviados),
      whatsapp_manual: wh.num(r.whatsapp_manual),
      reunioes: wh.num(r.reunioes),
      toques_manuais: wh.num(r.toques_manuais),
      toques_automacao: wh.num(r.toques_automacao),
      toques_manuais_antes: wh.num(r.toques_manuais_antes),
      discagens: wh.num(r.discagens),
      numero_errado: wh.num(r.numero_errado),
      primeiro_toque: wh.str(r.primeiro_toque),
    };
  });
  return { mapa, multiContato };
}

let _cache = {};
const CACHE_TTL = 5 * 60 * 1000;

function sqlList(ids) {
  return ids.filter(id => /^[A-Za-z0-9_-]+$/.test(String(id))).map(id => `'${id}'`).join(',');
}

/**
 * Snapshot: leads por etapa canônica AGORA. Sai de `dim_lead` (silver) porque
 * snapshot é ESTADO, não série — mart aqui só adicionaria defasagem sem ganho.
 */
async function snapshot(pipes, recorte) {
  // O snapshot é ESTADO DE AGORA, então aqui o recorte por BDR usa o dono ATUAL — e é
  // a régua certa justamente por ser o oposto da do fluxo: "de quem é este funil hoje"
  // não é a mesma pergunta que "quem trabalhou este movimento na época".
  const porBdr = !!(recorte && recorte.dim === 'bdr' && (recorte.ownerIds || []).length);
  const { rows } = await wh.query(`
    WITH ${recorteFluxoCTE(pipes, recorte)}
    base AS (
      SELECT dl.pipeline_id, dl.stage_id
      FROM ${wh.t('silver', 'dim_lead')} dl
      WHERE dl.is_current AND dl.pipeline_id IN (${sqlList(pipes)})
        ${recorteFluxoWhere(recorte, 'dl.lead_id', null)}
        ${porBdr ? `AND dl.owner_id IN (${sqlList(recorte.ownerIds)})` : ''}
    )
    SELECT pipeline_id, stage_id, COUNT(*) AS n FROM base GROUP BY 1, 2
  `, recorteParams(recorte));
  const porEtapa = {};
  let naoMapeadas = 0;
  rows.forEach(r => {
    const c = canon(r.stage_id);
    if (c === '(nao_mapeada)') naoMapeadas += wh.num(r.n);
    porEtapa[c] = (porEtapa[c] || 0) + wh.num(r.n);
  });
  return { porEtapa, naoMapeadas };
}

/**
 * Waterfall: uma linha por MOVIMENTAÇÃO na janela, com o pipeline DO EVENTO.
 *
 * O pipeline do evento não vem de `fact_crm_change` (que só tem old/new da
 * propriedade `hs_pipeline_stage`), então é derivado do stage_id: id de etapa é
 * único por pipeline no HubSpot, logo o stage_id JÁ identifica o pipeline. É por
 * isso que `STAGE_CANON` é indexado por stage_id e não por (pipeline, ordem).
 *
 * `criacao` = movimentação sem `old_value`, ou seja a entrada inaugural no funil.
 * É a caixa "começou em Novo" que o waterfall precisa para fechar.
 */
async function waterfall(pipes, since, until, recorte) {
  const pipeSet = new Set(pipes);
  const { rows } = await wh.query(`
    WITH ${recorteFluxoCTE(pipes, recorte)}
    mov AS (
      SELECT ch.object_id AS lead_id, ch.old_value, ch.new_value, ch.changed_at,
             ch.source_type, ch.updated_by_user_id
      FROM ${wh.t('silver', 'fact_crm_change')} ch
      WHERE ch.object_type = 'lead' AND ch.property = 'hs_pipeline_stage'
        AND DATE(ch.changed_at, 'America/Sao_Paulo') BETWEEN DATE(@since) AND DATE(@until)
        ${recorteFluxoWhere(recorte, 'ch.object_id', null)}
    ),
    -- ordem do movimento DENTRO da janela, por lead. É o que permite o drill mostrar
    -- a trilha ("criado → avançou para X → está em Y") em vez de só o total.
    ord AS (
      SELECT lead_id, changed_at,
             ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY changed_at) AS passo
      FROM mov
    ),
    -- Dono NO INSTANTE do movimento. fact_owner_assignment cobre lead (17.073
    -- posses); o dono ATUAL de dim_lead é régua retroativa e não serve.
    com_dono AS (
      SELECT m.*, oa.owner_id AS owner_no_instante
      FROM mov m
      LEFT JOIN ${wh.t('silver', 'fact_owner_assignment')} oa
        ON oa.object_type = 'lead' AND oa.object_id = m.lead_id
       AND m.changed_at >= oa.owned_from
       AND (oa.owned_to IS NULL OR m.changed_at < oa.owned_to)
    )
    SELECT d.lead_id, d.old_value, d.new_value,
           FORMAT_TIMESTAMP('%F', d.changed_at, 'America/Sao_Paulo') AS dia,
           FORMAT_TIMESTAMP('%H:%M', d.changed_at, 'America/Sao_Paulo') AS hora,
           o.passo,
           d.source_type, d.updated_by_user_id, d.owner_no_instante,
           l.motivo_desqualificacao, l.origem_canonica, l.origem_fonte, l.lead_name,
           l.stage_id AS stage_atual,
           FORMAT_TIMESTAMP('%F', l.hs_created_at, 'America/Sao_Paulo') AS criado,
           cp.company_id, cp.company_name, cp.employees, cp.porte, cp.vidas AS vidas_empresa
    FROM com_dono d
    JOIN ord o ON o.lead_id = d.lead_id AND o.changed_at = d.changed_at
    LEFT JOIN ${wh.t('silver', 'dim_lead')} l ON l.lead_id = d.lead_id AND l.is_current
    LEFT JOIN (
      SELECT from_id AS lead_id, ANY_VALUE(to_id) AS company_id
      FROM ${wh.t('silver', 'bridge_association')}
      WHERE from_object = 'lead' AND to_object = 'company' AND is_active
      GROUP BY 1
    ) lc ON lc.lead_id = d.lead_id
    LEFT JOIN ${wh.t('silver', 'dim_company')} cp
      ON cp.company_id = lc.company_id AND cp.is_current
    WHERE TRUE ${recorteFluxoWhere(recorte, 'd.lead_id', 'd.owner_no_instante')}
  `, [
    { name: 'since', type: 'DATE', value: since },
    { name: 'until', type: 'DATE', value: until },
    ...recorteParams(recorte),
  ]);

  const setas = {};
  const porDia = {};
  const desq = [];
  // Por STATUS: entradas e saídas de cada etapa canônica na janela. É o corte que
  // faltava — a tabela de setas responde "que movimento aconteceu", não "como cada
  // etapa ganhou e perdeu".
  const porStatus = {};
  const st = c => (porStatus[c] = porStatus[c] || { entradas: 0, saidas: 0 });
  // Trilha por lead: o que o drill precisa para ser auditável.
  const trilha = {};
  let descartadasBackup = 0;
  let naoMapeadas = 0;

  rows.forEach(r => {
    const de   = r.old_value == null || r.old_value === '' ? '(criacao)' : canon(r.old_value);
    const para = canon(r.new_value);
    if (para === '(nao_mapeada)' || de === '(nao_mapeada)') naoMapeadas++;

    // Recorte pelo pipeline DO EVENTO: o stage_id de destino é que decide.
    const pipeDoEvento = PIPE_OF_STAGE[String(r.new_value)] || null;
    if (pipeDoEvento && !pipeSet.has(pipeDoEvento)) { descartadasBackup++; return; }

    const key = de + '>' + para;
    setas[key] = (setas[key] || 0) + 1;

    const dia = wh.str(r.dia);
    porDia[dia] = porDia[dia] || {};
    porDia[dia][para] = (porDia[dia][para] || 0) + 1;

    // entrada sempre; saída só quando havia etapa anterior (criação não é saída de nada)
    st(para).entradas++;
    if (de !== '(criacao)') st(de).saidas++;

    const lid = wh.str(r.lead_id);
    if (!trilha[lid]) {
      trilha[lid] = {
        lead_id: lid,
        lead: wh.str(r.lead_name),
        criado: wh.str(r.criado),
        status_atual: canon(r.stage_atual),
        owner_id: wh.str(r.owner_no_instante),
        empresa_id: wh.str(r.company_id),
        empresa: wh.str(r.company_name),
        colaboradores: r.employees == null ? null : Number(r.employees),
        porte: wh.str(r.porte),
        vidas: r.vidas_empresa == null ? null : Number(r.vidas_empresa),
        origem: wh.str(r.origem_canonica) || wh.str(r.origem_fonte) || '(sem origem)',
        motivo: wh.str(r.motivo_desqualificacao),
        passos: [],
      };
    }
    trilha[lid].passos.push({ de: de, para: para, dia: dia, hora: wh.str(r.hora), passo: wh.num(r.passo) });

    if (para === 'desqualificado') {
      desq.push({
        lead_id: wh.str(r.lead_id),
        lead: wh.str(r.lead_name),
        dia,
        motivo: wh.str(r.motivo_desqualificacao) || '(sem motivo)',
        de,
        owner_id: wh.str(r.owner_no_instante),
        autor_user_id: wh.str(r.updated_by_user_id),
        source_type: wh.str(r.source_type),
        empresa_id: wh.str(r.company_id),
        empresa: wh.str(r.company_name),
        colaboradores: r.employees == null ? null : Number(r.employees),
        porte: wh.str(r.porte),
        vidas: r.vidas_empresa == null ? null : Number(r.vidas_empresa),
        origem: wh.str(r.origem_canonica) || wh.str(r.origem_fonte) || '(sem origem)',
      });
    }
  });

  // Teto declarado, nunca silencioso: truncagem calada faz "cobri tudo" parecer verdade.
  //
  // 1.500 e nao 5.000 porque o payload da janela "Tudo" (936 dias) media 5,99 MB, acima
  // do teto de resposta da Vercel (~4,5 MB) — a tela simplesmente nao respondia. Medido
  // por bloco: waterfall.leads 2,40 MB, coorte.leads 1,90, desqualificacoes 1,66, e a
  // AGREGACAO 0,01. Ou seja o peso e todo lista de drill, e o drill exibe 300 linhas de
  // cada vez. A CONTA vem da agregacao no BigQuery e cobre 100% da coorte com qualquer
  // teto — e por isso que cortar aqui nao mente, e nao cortar mentia por omissao (a
  // resposta nem chegava).
  const TETO = 1500;
  const todos = Object.values(trilha).sort((a, b) => (b.passos.length - a.passos.length));
  const movimentados = todos.slice(0, TETO).map(l => ({
    ...l,
    passos: l.passos.sort((a, b) => a.passo - b.passo),
    n_movimentos: l.passos.length,
  }));

  return {
    setas, porDia, desq, porStatus, movimentados,
    movimentados_total: todos.length,
    movimentados_truncado: Math.max(0, todos.length - TETO),
    descartadasBackup, naoMapeadas, movimentos: rows.length,
  };
}

/**
 * Waterfall MACRO: o funil como saldo que abre, recebe, perde e fecha.
 *
 * A ARITMÉTICA TEM DE FECHAR, e é isso que separa um waterfall de um gráfico de
 * barras bonito:
 *
 *   aberto@início + criados + reativados − qualificados − desqualificados
 *     = aberto@fim  (± resíduo)
 *
 * Medido em ago/2026 (01→11): 4.477 + 324 + 6 − 44 − 469 = 4.294 contra 4.297 de
 * fecho — resíduo **+3 em ~4.300 (0,07%)**. O resíduo é EXPOSTO como barra própria,
 * não distribuído nas outras nem escondido: ele é a troca de pipeline entrando no
 * recorte, mais os 2 leads em que a etapa derivada discorda de `dim_lead`. Waterfall
 * cujas setas não fecham no saldo é ficção — e ficção que ninguém confere porque
 * parece plausível.
 *
 * ETAPA NUM INSTANTE, e por que não é `dim_lead`: `dim_lead` só sabe o AGORA. O
 * saldo de abertura precisa da etapa em T0, que sai de `fact_stage_entry` pegando a
 * última entrada com `entered_at <= T0` por lead. Método validado contra o snapshot:
 * reproduz `dim_lead` em **18.294 de 18.296** leads (0 sem entrada de etapa, 2
 * divergentes), e os 2 estão declarados em `divergencias_conhecidas`.
 *
 * ABERTO = novo + tentativa + conectado. Qualificado e desqualificado são saídas do
 * funil de prospecção: qualificado vira deal, desqualificado morre. Contá-los no
 * saldo aberto faria o funil só crescer, o que é a mesma cegueira de medir estoque
 * como se fosse fluxo.
 */
async function macro(pipes, since, until, recorte) {
  const canonPairs = Object.keys(STAGE_CANON)
    .map(sid => `STRUCT('${sid}' AS sid, '${STAGE_CANON[sid]}' AS c, '${PIPE_OF_STAGE[sid]}' AS p)`)
    .join(',');
  // RECORTE NO MACRO: por atributo é lista de leads; por BDR é o DONO NO INSTANTE — e
  // "o instante" é diferente em cada peça da conta. No saldo é T0 e T1 (de quem era o
  // lead quando o período abriu e quando fechou); no movimento é a hora do movimento.
  // Usar o dono de HOJE nos três lugares faria o waterfall de uma BDR incluir o saldo
  // de leads que na época eram de outra pessoa — e ele fecharia mesmo assim, contando a
  // história errada com aritmética certa.
  const porBdr = !!(recorte && recorte.dim === 'bdr' && (recorte.ownerIds || []).length);
  const idsBdr = porBdr ? sqlList(recorte.ownerIds) : '';
  const OA = wh.t('silver', 'fact_owner_assignment');
  const donoEm = q => porBdr ? `
        AND EXISTS (SELECT 1 FROM ${OA} oa
                    WHERE oa.object_type='lead' AND oa.object_id = se.object_id
                      AND oa.owner_id IN (${idsBdr})
                      AND oa.owned_from <= ${q} AND (oa.owned_to IS NULL OR ${q} < oa.owned_to))` : '';
  const donoNoMov = `${porBdr ? `
        AND EXISTS (SELECT 1 FROM ${OA} oa
                    WHERE oa.object_type='lead' AND oa.object_id = ch.object_id
                      AND oa.owner_id IN (${idsBdr})
                      AND ch.changed_at >= oa.owned_from AND (oa.owned_to IS NULL OR ch.changed_at < oa.owned_to))` : ''}`;
  const { rows } = await wh.query(`
    DECLARE T0 TIMESTAMP DEFAULT TIMESTAMP(DATETIME(DATE_SUB(DATE(@since), INTERVAL 1 DAY), TIME '23:59:59'), 'America/Sao_Paulo');
    DECLARE T1 TIMESTAMP DEFAULT TIMESTAMP(DATETIME(DATE(@until), TIME '23:59:59'), 'America/Sao_Paulo');
    WITH ${recorteFluxoCTE(pipes, recorte)}
    canon AS (SELECT * FROM UNNEST([${canonPairs}])),
    em AS (
      SELECT 'T0' AS q, lead_id, stage_id FROM (
        SELECT se.object_id AS lead_id, se.stage_id,
               ROW_NUMBER() OVER (PARTITION BY se.object_id ORDER BY se.entered_at DESC) rn
        FROM ${wh.t('silver', 'fact_stage_entry')} se
        WHERE se.object_type = 'lead' AND se.entered_at <= T0
          ${recorteFluxoWhere(recorte, 'se.object_id', null)}${donoEm('T0')}) WHERE rn = 1
      UNION ALL
      SELECT 'T1', lead_id, stage_id FROM (
        SELECT se.object_id AS lead_id, se.stage_id,
               ROW_NUMBER() OVER (PARTITION BY se.object_id ORDER BY se.entered_at DESC) rn
        FROM ${wh.t('silver', 'fact_stage_entry')} se
        WHERE se.object_type = 'lead' AND se.entered_at <= T1
          ${recorteFluxoWhere(recorte, 'se.object_id', null)}${donoEm('T1')}) WHERE rn = 1
    ),
    saldo AS (
      SELECT e.q, c.c AS etapa, COUNT(*) AS n
      FROM em e JOIN canon c ON c.sid = e.stage_id
      WHERE c.p IN (${sqlList(pipes)})
      GROUP BY 1, 2
    ),
    prim AS (
      SELECT lead_id, entered_at, etapa, pipe FROM (
        SELECT se.object_id AS lead_id, se.entered_at, c.c AS etapa, c.p AS pipe,
               ROW_NUMBER() OVER (PARTITION BY se.object_id ORDER BY se.entered_at) rn
        FROM ${wh.t('silver', 'fact_stage_entry')} se
        JOIN canon c ON c.sid = se.stage_id
        WHERE se.object_type = 'lead'
          ${recorteFluxoWhere(recorte, 'se.object_id', null)}
      ) WHERE rn = 1
    ),
    movc AS (
      SELECT ch.object_id AS lead_id, IFNULL(co.c, '(criacao)') AS de, cn.c AS para
      FROM ${wh.t('silver', 'fact_crm_change')} ch
      JOIN canon cn ON cn.sid = ch.new_value
      LEFT JOIN canon co ON co.sid = ch.old_value
      WHERE ch.object_type = 'lead' AND ch.property = 'hs_pipeline_stage'
        AND ch.changed_at > T0 AND ch.changed_at <= T1
        AND cn.p IN (${sqlList(pipes)})
        ${recorteFluxoWhere(recorte, 'ch.object_id', null)}${donoNoMov}
    ),
    -- SAIDA DO RECORTE: lead que estava em etapa ABERTA de um pipeline do recorte e
    -- foi para um pipeline FORA dele (na pratica, despejado no Backup).
    --
    -- Sem esta barra o waterfall NAO FECHA em janela longa, e nao fecha por erro de
    -- contabilidade, nao de dado: a entrada dele foi contada (a criacao caiu num
    -- pipeline do recorte) e a saida nao, porque movc so guarda movimento cujo DESTINO
    -- esta no recorte. Medido na janela completa (936 dias): o residuo era -1.285 em
    -- 4.297 (30%), e cai para a ordem de dezenas com esta barra. Em janela curta o
    -- efeito e ~0, e foi por isso que passou despercebido -- bug que so aparece na
    -- escala e bug que espera a escala para aparecer.
    -- (Sem backticks aqui de proposito: este comentario vive dentro de um template
    --  literal de JS, e um backtick solto fecha a string.)
    /*
     * ENTRADA SEM REGISTRO DE MUDANCA — a barra que faltava, e ela nao e do recorte:
     * e do metodo.
     *
     * O saldo sai de fact_stage_entry e a entrada saia SO de fact_crm_change. Sao duas
     * fontes com cobertura diferente: fact_stage_entry vem das propriedades
     * hs_v2_date_entered_* (que o HubSpot sempre preenche) e fact_crm_change vem do
     * historico de propriedade, que as vezes NAO registra a criacao. O lead que cai
     * nesse buraco aparece no saldo do fim sem ter entrado por lugar nenhum.
     *
     * No agregado isso vale +1 em 4.206 (0,02%) e passou dois meses invisivel. Com o
     * recorte por pessoa a mesma falha vale +8 em 68 (12%), porque o denominador
     * encolheu 60x — o defeito nao mudou de tamanho, mudou de visibilidade. Achado por
     * reconciliacao lead a lead: os 8 leads tinham fact_stage_entry na janela e nenhum
     * movimento de criacao.
     */
    -- Anti-join, e nao NOT EXISTS: subquery correlacionada contra uma CTE e recusada
    -- pelo BigQuery ("Correlated subqueries that reference other tables").
    criacao_registrada AS (SELECT DISTINCT lead_id FROM movc WHERE de = '(criacao)'),
    entrada_sem_registro AS (
      SELECT COUNT(*) AS n
      FROM prim
      LEFT JOIN criacao_registrada cr ON cr.lead_id = prim.lead_id
      WHERE cr.lead_id IS NULL
        AND prim.entered_at > T0 AND prim.entered_at <= T1
        AND prim.etapa IN ('novo','tentativa','conectado')
        AND prim.pipe IN (${sqlList(pipes)})
        ${porBdr ? `AND EXISTS (SELECT 1 FROM ${OA} oa WHERE oa.object_type='lead' AND oa.object_id = prim.lead_id
                      AND oa.owner_id IN (${idsBdr})
                      AND prim.entered_at >= oa.owned_from AND (oa.owned_to IS NULL OR prim.entered_at < oa.owned_to))` : ''}
    ),
    saiu_recorte AS (
      SELECT COUNT(*) AS n
      FROM ${wh.t('silver', 'fact_crm_change')} ch
      JOIN canon co ON co.sid = ch.old_value
      LEFT JOIN canon cn ON cn.sid = ch.new_value
      WHERE ch.object_type = 'lead' AND ch.property = 'hs_pipeline_stage'
        AND ch.changed_at > T0 AND ch.changed_at <= T1
        AND co.p IN (${sqlList(pipes)}) AND co.c IN ('novo','tentativa','conectado')
        AND (cn.p IS NULL OR cn.p NOT IN (${sqlList(pipes)}))
        ${recorteFluxoWhere(recorte, 'ch.object_id', null)}${donoNoMov}
    )${porBdr ? `,
    /*
     * TRANSFERÊNCIA DE CARTEIRA — a barra que faz o waterfall de UMA PESSOA fechar.
     *
     * Com o recorte em um BDR, a população do saldo muda por um motivo que não é
     * movimento de etapa: o lead trocou de dono. Ele estava aberto na carteira dela em
     * T0 e no fim da janela é de outra pessoa, sem ter sido qualificado nem
     * desqualificado. Medido no primeiro teste com recorte: resíduo +10 num saldo de 68
     * (15%), que é grande demais para ser arredondamento e pequeno demais para alguém
     * desconfiar olhando.
     *
     * É a mesma família do "Saiu do recorte" por troca de pipeline: a saída existe, só
     * não estava sendo contada. E ela não é ruído — "recebeu 12 leads de outro BDR" é
     * informação de gestão, não erro a esconder.
     *
     * A PRIMEIRA POSSE NÃO CONTA: lead que nasce já com dono entra pela criação, e
     * contá-lo aqui também o contaria duas vezes.
     */
    posse AS (
      SELECT oa.object_id AS lead_id, oa.owner_id, oa.owned_from, oa.owned_to,
             ROW_NUMBER() OVER (PARTITION BY oa.object_id ORDER BY oa.owned_from) AS ordem
      FROM ${OA} oa WHERE oa.object_type = 'lead'
    ),
    posse_bdr AS (
      SELECT * FROM posse
      WHERE owner_id IN (${idsBdr})
        AND ((owned_from > T0 AND owned_from <= T1) OR (owned_to > T0 AND owned_to <= T1))
    ),
    -- A etapa vigente no instante da transferencia sai de um JOIN com janela, e nao de
    -- subquery correlacionada: o BigQuery recusa subquery correlacionada com ORDER BY +
    -- LIMIT ("Correlated subqueries that reference other tables are not supported").
    -- DUAS FORMAS DE UM LEAD ENTRAR NA CARTEIRA sem ser criado nela, e a segunda so
    -- apareceu porque o waterfall nao fechava:
    --   1. veio de OUTRA PESSOA (a posse anterior existe: ordem > 1);
    --   2. era ORFAO e ganhou o primeiro dono agora (ordem = 1, mas o lead ja existia
    --      antes da janela). Sem este caso o residuo ficou em +9 de 68 (13%).
    -- O que continua FORA e o lead que nasce com dono dentro da janela: esse entra pela
    -- criacao, e conta-lo aqui tambem seria conta-lo duas vezes.
    recebidos AS (
      SELECT lead_id FROM (
        SELECT po.lead_id, cx.c AS etapa,
               ROW_NUMBER() OVER (PARTITION BY po.lead_id, po.ordem ORDER BY se.entered_at DESC) rn
        FROM posse_bdr po
        JOIN prim pr ON pr.lead_id = po.lead_id
        JOIN ${wh.t('silver', 'fact_stage_entry')} se
          ON se.object_type='lead' AND se.object_id = po.lead_id AND se.entered_at <= po.owned_from
        JOIN canon cx ON cx.sid = se.stage_id
        WHERE po.owned_from > T0 AND po.owned_from <= T1
          -- A REGUA E "ASSUMIU DEPOIS DE O LEAD ENTRAR NO FUNIL", nao "nao e a primeira
          -- posse". A versao anterior (ordem > 1 OU criado antes de T0) deixava de fora
          -- o caso que mais aparece: lead criado DENTRO da janela SEM DONO e atribuido
          -- ao BDR depois. A criacao dele nao conta em entrada_no_funil (no instante da
          -- criacao ele nao era dono) e a atribuicao nao contava aqui — o lead entrava
          -- no saldo do fim por porta nenhuma. Eram 7 dos 8 leads do residuo.
          AND po.owned_from > pr.entered_at
      ) WHERE rn = 1 AND etapa IN ('novo','tentativa','conectado')
    ),
    passados AS (
      SELECT lead_id FROM (
        SELECT po.lead_id, cx.c AS etapa,
               ROW_NUMBER() OVER (PARTITION BY po.lead_id, po.ordem ORDER BY se.entered_at DESC) rn
        FROM posse_bdr po
        JOIN ${wh.t('silver', 'fact_stage_entry')} se
          ON se.object_type='lead' AND se.object_id = po.lead_id AND se.entered_at <= po.owned_to
        JOIN canon cx ON cx.sid = se.stage_id
        WHERE po.owned_to > T0 AND po.owned_to <= T1
      ) WHERE rn = 1 AND etapa IN ('novo','tentativa','conectado')
    ),
    transf AS (
      SELECT (SELECT COUNT(*) FROM recebidos) AS recebeu,
             (SELECT COUNT(*) FROM passados)  AS passou
    )` : ''}
    SELECT
      (SELECT IFNULL(SUM(n),0) FROM saldo WHERE q='T0' AND etapa IN ('novo','tentativa','conectado')) AS aberto_inicio,
      (SELECT IFNULL(SUM(n),0) FROM saldo WHERE q='T1' AND etapa IN ('novo','tentativa','conectado')) AS aberto_fim,
      -- ENTRADA NO POOL = movimento de criação que aterrissa em etapa ABERTA.
      -- NÃO é a contagem de dim_lead: lead criado sem movimento de etapa registrado
      -- entra no dim_lead e NÃO entra no saldo (que sai de fact_stage_entry), e essa
      -- conflação é resíduo puro. As duas contagens viajam separadas de propósito —
      -- "criados por dia" é dim_lead; "entrou no funil" é fluxo.
      (SELECT COUNT(*) FROM movc WHERE de = '(criacao)' AND para IN ('novo','tentativa','conectado')) AS entrada_no_funil,
      (SELECT COUNT(*) FROM ${wh.t('silver', 'dim_lead')} dl
        WHERE dl.is_current AND dl.pipeline_id IN (${sqlList(pipes)})
          AND dl.hs_created_at > T0 AND dl.hs_created_at <= T1
          ${recorteFluxoWhere(recorte, 'dl.lead_id', null)}
          ${porBdr ? `AND EXISTS (SELECT 1 FROM ${OA} oa WHERE oa.object_type='lead' AND oa.object_id = dl.lead_id
                        AND oa.owner_id IN (${idsBdr})
                        AND dl.hs_created_at >= oa.owned_from AND (oa.owned_to IS NULL OR dl.hs_created_at < oa.owned_to))` : ''}) AS criados,
      (SELECT COUNT(*) FROM movc WHERE de IN ('qualificado','desqualificado') AND para IN ('novo','tentativa','conectado')) AS reativados,
      -- SAÍDA DO POOL: só conta quem SAIU DE ETAPA ABERTA. Contar "para=qualificado"
      -- vindo de qualquer etapa incluía desqualificado→qualificado, que é reativação
      -- e não saída do pool aberto — era a causa medida do resíduo de +5.
      (SELECT COUNT(*) FROM movc WHERE para='qualificado'    AND de IN ('novo','tentativa','conectado')) AS qualificados,
      (SELECT COUNT(*) FROM movc WHERE para='desqualificado' AND de IN ('novo','tentativa','conectado')) AS desqualificados,
      (SELECT n FROM saiu_recorte) AS saiu_do_recorte,
      (SELECT n FROM entrada_sem_registro) AS entrada_sem_registro,
      ${porBdr ? '(SELECT recebeu FROM transf)' : '0'} AS recebeu_transferencia,
      ${porBdr ? '(SELECT passou FROM transf)' : '0'} AS passou_transferencia,
      ARRAY(SELECT AS STRUCT q, etapa, n FROM saldo) AS saldos
  `, [
    { name: 'since', type: 'DATE', value: since },
    { name: 'until', type: 'DATE', value: until },
    ...recorteParams(recorte),
  ]);
  const r = rows[0] || {};
  const ai = wh.num(r.aberto_inicio), af = wh.num(r.aberto_fim);
  const cr = wh.num(r.criados), re = wh.num(r.reativados);
  const en = wh.num(r.entrada_no_funil);
  const qu = wh.num(r.qualificados), dq = wh.num(r.desqualificados);
  const sr = wh.num(r.saiu_do_recorte);
  const rt = wh.num(r.recebeu_transferencia), pt = wh.num(r.passou_transferencia);
  const esr = wh.num(r.entrada_sem_registro);
  const saldoInicio = {}, saldoFim = {};
  (r.saldos || []).forEach(s => {
    (wh.str(s.q) === 'T0' ? saldoInicio : saldoFim)[wh.str(s.etapa)] = wh.num(s.n);
  });
  return {
    aberto_inicio: ai, entrada_no_funil: en, criados: cr, reativados: re,
    qualificados: qu, desqualificados: dq, saiu_do_recorte: sr, aberto_fim: af,
    recebeu_transferencia: rt, passou_transferencia: pt,
    entrada_sem_registro: esr,
    // resíduo = o que a aritmética não explica. Exposto como barra própria, nunca
    // diluído nas outras: troca de pipeline entrando no recorte, mais os 2 leads em
    // que a etapa derivada discorda de dim_lead.
    residuo: af - (ai + en + esr + re - qu - dq - sr + rt - pt),
    // Lead criado na janela que NÃO gerou movimento de etapa. É a diferença entre as
    // duas contagens, e ela existe: ficaria escondida se o waterfall usasse dim_lead.
    criados_sem_movimento: cr - en,
    saldo_inicio: saldoInicio, saldo_fim: saldoFim,
  };
}

// stage_id -> pipeline_id. Derivado de STAGE_CANON + a lista por pipeline, para o
// recorte não depender de uma segunda consulta.
const PIPE_OF_STAGE = {
  'new-stage-id': PIPE_PRINCIPAL, 'attempting-stage-id': PIPE_PRINCIPAL,
  'connected-stage-id': PIPE_PRINCIPAL, 'qualified-stage-id': PIPE_PRINCIPAL,
  'unqualified-stage-id': PIPE_PRINCIPAL,
  '1287976462': PIPE_DIAGNOSTICO, '1287976463': PIPE_DIAGNOSTICO,
  '1287976464': PIPE_DIAGNOSTICO, '1287976465': PIPE_DIAGNOSTICO,
  '1287976466': PIPE_DIAGNOSTICO,
  '1188963708': PIPE_BACKUP, '1188963709': PIPE_BACKUP, '1188963710': PIPE_BACKUP,
  '1188963711': PIPE_BACKUP, '1188963712': PIPE_BACKUP,
};

/**
 * Coorte: leads CRIADOS na janela, com as DUAS réguas de contato e as dimensões.
 *
 * `tier_colaboradores` e `numero_de_vidas` vêm do BRONZE via JSON_VALUE — não
 * estão em `dim_contact`. Medida temporária declarada; ver cabeçalho.
 *
 * A régua de ATIVIDADE liga toque→lead via `bridge_association` lead→contato,
 * porque `fact_engagement` NÃO tem `lead_id`. O join é seguro: a relação é 1:1
 * (18.209 leads com exatamente 1 contato, 1 com 2 — a exceção está reportada em
 * `diagnostics`).
 */
/**
 * FAIXAS DE DIMENSÃO, definidas em UM lugar: aqui, em SQL.
 *
 * Elas precisam nascer no SQL porque a agregação da tabela de taxa é um GROUP BY no
 * BigQuery (ver `coorteAgregada`) — e se o rótulo da faixa fosse recalculado no
 * JavaScript para o drill, as duas definições passariam a derivar. O drill LÊ o
 * rótulo que veio do SQL; ele nunca refaz a conta.
 *
 * "(não preenchido)" é FAIXA, não ausência de faixa: esconder o vazio é o que faz um
 * corte de 6,9% de cobertura parecer análise.
 */
/**
 * CANAL — a dimensão que a "Origem" deveria ser e não é.
 *
 * A dimensão `origem` sai de `axenya_origem_canonica`/`origem_do_lead__fonte_` no lead e
 * está contaminada NA FONTE: **10.985 de 16.922 leads (64%) trazem o BOOLEANO "true"
 * (9.930) ou "false" (1.055)**. "true" não é uma origem, e um corte em que a maior
 * fatia é `true` parece análise sem ser. Isso já estava declarado como divergência
 * conhecida; o que faltava era uma dimensão utilizável no lugar.
 *
 * `canal` é uma CASCATA de evidências, do sinal mais forte para o mais fraco, e ela é
 * medida, não suposta. Cobertura em 12/08/2026 sobre os 16.922 leads dos dois funis:
 *
 *   Outbound (lista/enriquecimento)  10.150   ← contato veio de Lusha/Apollo/planilha
 *   (não identificado)                2.595   ← 15%, e ele APARECE em vez de virar "outro"
 *   Outbound                          1.553   ← origem declarada: prospecção/conector/carteira
 *   Evento                            1.424   ← Eventos Axenya, feiras, congressos, Summit
 *   Inbound - Site (Diagnóstico)        869   ← pipeline do Diagnóstico é entrada de site
 *   Mídia paga                          148
 *   Indicação/Network                    97
 *   Inbound - Digital                    81
 *
 * ou seja **85% classificado** contra 36% de origem legível hoje. O "não identificado"
 * é FAIXA, não ausência de faixa: escondê-lo faria a cobertura parecer 100%.
 *
 * A ORDEM DA CASCATA É A DECISÃO. Origem declarada no lead vence, porque é a única que
 * alguém digitou de propósito. O pipeline vem antes dos sinais do contato porque um lead
 * do funil Diagnóstico entrou pelo site, mesmo que o contato já existisse de uma lista
 * comprada — o que importa é como ESTE lead nasceu. E os sinais do contato entram por
 * último porque descrevem de onde a PESSOA veio um dia, não como o lead entrou agora.
 */
const CANAL_SQL = `CASE
  WHEN REGEXP_CONTAINS(IFNULL(origem,''), r'(?i)prospec|conector|carteira') THEN 'Outbound'
  WHEN REGEXP_CONTAINS(IFNULL(origem,''), r'(?i)evento|feira|congresso|summit') THEN 'Evento'
  WHEN REGEXP_CONTAINS(IFNULL(origem,''), r'(?i)indica|network') THEN 'Indicação/Network'
  WHEN REGEXP_CONTAINS(IFNULL(origem,''), r'(?i)inbound') THEN 'Inbound - Digital'
  WHEN pipeline_id = '${PIPE_DIAGNOSTICO}' THEN 'Inbound - Site (Diagnóstico)'
  WHEN REGEXP_CONTAINS(IFNULL(contato_origem,''), r'(?i)outbound') THEN 'Outbound'
  WHEN REGEXP_CONTAINS(IFNULL(contato_origem,''), r'(?i)evento') THEN 'Evento'
  WHEN REGEXP_CONTAINS(IFNULL(contato_source_detail,''), r'(?i)lusha|apollo|\\.csv|\\.xlsx') THEN 'Outbound (lista/enriquecimento)'
  WHEN contato_analytics IN ('PAID_SEARCH','PAID_SOCIAL') THEN 'Mídia paga'
  WHEN contato_analytics IN ('ORGANIC_SEARCH','DIRECT_TRAFFIC','SOCIAL_MEDIA','REFERRALS','EMAIL_MARKETING') THEN 'Inbound - Digital'
  ELSE '(não identificado)' END`;

/**
 * O AGRUPAMENTO MACRO do canal — é ele que responde "quero ver só outbound".
 *
 * Cinco fatias em vez de nove: pedir "só outbound" e ter de marcar duas caixas
 * ("Outbound" e "Outbound (lista/enriquecimento)") é a forma mais fácil de alguém
 * medir metade do outbound sem perceber.
 */
const CANAL_MACRO_SQL = `CASE
  WHEN REGEXP_CONTAINS(${CANAL_SQL}, r'^Outbound') THEN 'Outbound'
  WHEN REGEXP_CONTAINS(${CANAL_SQL}, r'^Inbound|Mídia') THEN 'Inbound'
  WHEN ${CANAL_SQL} = 'Evento' THEN 'Evento'
  WHEN ${CANAL_SQL} = 'Indicação/Network' THEN 'Indicação'
  ELSE '(não identificado)' END`;

const DIM_SQL = {
  porte: `CASE WHEN colaboradores IS NULL THEN '(não preenchido)'
               WHEN colaboradores < 50 THEN '< 50'
               WHEN colaboradores < 200 THEN '50–200'
               WHEN colaboradores < 500 THEN '200–500'
               ELSE '500+' END`,
  tier: `IFNULL(NULLIF(tier_colaboradores, ''), '(não preenchido)')`,
  // VIDAS PASSOU A SAIR DO `dim_lead_context`, e isso dobra a cobertura do corte.
  // A régua anterior era COALESCE(numero_de_vidas do contato no bronze, dim_company.vidas)
  // e alcançava 8.673 de 18.331 leads (47%); `vidas_efetivas` alcança **16.172 (88%)** e
  // já traz o bucket canônico do armazém (`company_lives_bucket`), que é o mesmo que o
  // resto da plataforma usa — inventar faixa aqui criaria uma segunda definição de
  // "empresa grande" na casa. Onde as duas fontes existem e discordam são 522 leads
  // (declarado em divergencias_conhecidas.vidas_fonte).
  // "Fora ICP" é o rótulo do armazém para < 200 vidas; ele viaja como veio, porque
  // renomear aqui faria a tela e o mart dizerem coisas diferentes do mesmo lead.
  vidas: `IFNULL(NULLIF(lives_bucket, ''), '(não preenchido)')`,
  canal: CANAL_SQL,
  canal_macro: CANAL_MACRO_SQL,
  origem: `IFNULL(NULLIF(origem, ''), '(sem origem)')`,
};

/**
 * Coorte de leads criados na janela: o CTE comum da agregação e do detalhe.
 *
 * Devolve SQL, não dados. Existe para a agregação (GROUP BY no BigQuery) e o detalhe
 * (lista para o drill) saírem da MESMA definição de coorte, régua e faixa. Duas
 * consultas com a mesma intenção escrita duas vezes é como os totais da tabela param
 * de bater com a soma dos drills.
 */
function coorteCTE(pipes, bdrIds, recorte) {
  const canonPairs = Object.keys(STAGE_CANON)
    .map(sid => `STRUCT('${sid}' AS sid, '${STAGE_CANON[sid]}' AS c)`)
    .join(',');
  return `
    WITH canon AS (SELECT * FROM UNNEST([${canonPairs}])),
    base AS (
      SELECT l.lead_id, l.lead_name, l.owner_id, l.pipeline_id, l.stage_id,
             l.motivo_desqualificacao,
             IFNULL(NULLIF(l.origem_canonica,''), l.origem_fonte) AS origem,
             DATE(l.hs_created_at, 'America/Sao_Paulo') AS criado,
             -- timestamp, não data: a régua de toque é limitada à criação do lead
             -- (APOS_CRIACAO), e no dia da criação a hora decide.
             l.hs_created_at AS criado_em
      FROM ${wh.t('silver', 'dim_lead')} l
      WHERE l.is_current AND l.pipeline_id IN (${sqlList(pipes)})
        AND DATE(l.hs_created_at, 'America/Sao_Paulo') BETWEEN DATE(@since) AND DATE(@until)
    ),
    l2c AS (
      SELECT b.from_id AS lead_id, ANY_VALUE(b.to_id) AS contact_id
      FROM ${wh.t('silver', 'bridge_association')} b JOIN base ON base.lead_id = b.from_id
      WHERE b.from_object='lead' AND b.to_object='contact' AND b.is_active GROUP BY 1
    ),
    l2co AS (
      SELECT b.from_id AS lead_id, ANY_VALUE(b.to_id) AS company_id
      FROM ${wh.t('silver', 'bridge_association')} b JOIN base ON base.lead_id = b.from_id
      WHERE b.from_object='lead' AND b.to_object='company' AND b.is_active GROUP BY 1
    ),
    l2d AS (
      SELECT b.from_id AS lead_id, ANY_VALUE(b.to_id) AS deal_id
      FROM ${wh.t('silver', 'bridge_association')} b JOIN base ON base.lead_id = b.from_id
      WHERE b.from_object='lead' AND b.to_object='deal' GROUP BY 1
    ),
    -- Maior etapa canônica já visitada. Desqualificado é TERMINAL e fica fora do rank:
    -- desqualificar não é avançar.
    rank_etapa AS (
      SELECT se.object_id AS lead_id,
             MAX(CASE c.c WHEN 'novo' THEN 0 WHEN 'tentativa' THEN 1
                          WHEN 'conectado' THEN 2 WHEN 'qualificado' THEN 3 ELSE -1 END) AS max_rank,
             LOGICAL_OR(c.c = 'qualificado')    AS foi_qualificado,
             LOGICAL_OR(c.c = 'desqualificado') AS foi_desqualificado
      FROM ${wh.t('silver', 'fact_stage_entry')} se
      JOIN base ON base.lead_id = se.object_id
      LEFT JOIN canon c ON c.sid = se.stage_id
      WHERE se.object_type = 'lead'
      GROUP BY 1
    ),
    -- Por CANAL, não só o total. O drill precisa dizer QUAL canal tocou: "sem toque"
    -- sem declarar o que foi procurado foi o defeito de 11/08 (caso Rui Medeiros), e
    -- devolver só o total reintroduz ele pela porta de trás — o front cairia em
    -- "nenhum toque" por ausência de campo, não por ausência de toque.
    -- Toque só conta APÓS a criação do lead. O contato tem vida anterior ao lead e ela
    -- não é esforço neste lead — ver APOS_CRIACAO. O que ficou de fora não desaparece:
    -- vira toques_manuais_antes e o bucket toque_herdado.
    ativ AS (
      SELECT c.lead_id,
             COUNTIF(${APOS_CRIACAO} AND f.is_connected) AS ligacoes_conectadas,
             COUNTIF(${APOS_CRIACAO} AND f.kind = 'emails' AND f.is_outbound_message) AS emails_enviados,
             COUNTIF(${APOS_CRIACAO} AND f.channel_type = 'LINKEDIN_MESSAGE' AND f.is_outbound_message) AS linkedin_enviados,
             COUNTIF(${APOS_CRIACAO} AND f.channel_type = 'WHATS_APP' AND f.is_outbound_message AND IFNULL(f.source_label,'') != 'INTEGRATION') AS whatsapp_manual,
             COUNTIF(${APOS_CRIACAO} AND f.is_meeting_held) AS reunioes,
             COUNTIF(${APOS_CRIACAO} AND ${ATIV_MANUAL})    AS toques_manuais,
             COUNTIF(${APOS_CRIACAO} AND ${ATIV_AUTOMACAO}) AS toques_automacao,
             COUNTIF(NOT ${APOS_CRIACAO} AND ${ATIV_MANUAL})    AS toques_manuais_antes,
             COUNTIF(NOT ${APOS_CRIACAO} AND ${ATIV_AUTOMACAO}) AS toques_automacao_antes,
             -- ESFORÇO: a discagem que não conectou. Ver ATIV_ESFORCO.
             COUNTIF(${APOS_CRIACAO} AND ${ESFORCO_LIGACAO})  AS discagens,
             COUNTIF(${APOS_CRIACAO} AND ${ATIV_ESFORCO})     AS tentativas,
             COUNTIF(${APOS_CRIACAO} AND f.kind = 'calls' AND f.disposition_label = 'Número errado') AS numero_errado,
             -- Duração SÓ da ligação conectada: somar a discagem sem conexão (que tem
             -- duração de toca-e-desliga) faria "tempo ao telefone" incluir tempo em que
             -- ninguém atendeu.
             SUM(IF(${APOS_CRIACAO} AND f.is_connected, IFNULL(f.duration_ms, 0), 0)) AS duracao_conectada_ms
      FROM l2c c
      JOIN base b2 ON b2.lead_id = c.lead_id
      LEFT JOIN ${wh.t('silver', 'fact_engagement')} f ON f.contact_id = c.contact_id
      GROUP BY 1
    ),
    -- tier_colaboradores continua vindo do BRONZE porque NAO existe no silver, e nao e
    -- o mesmo campo que dim_contact.outbound_tier: medido em 12/08/2026, o bronze traz
    -- tier-1/2/3/pme em 10.914 contatos e o silver traz T1/T2/T3/PME/A/B/C/D em 2.434,
    -- com apenas ~20 contatos em ambos. Sao DUAS taxonomias diferentes, e trocar uma
    -- pela outra aqui mudaria o significado da coluna calada.
    -- (Sem crase neste comentario: ele vive dentro de um template literal de JS.)
    tier AS (
      SELECT c.lead_id,
             JSON_VALUE(r.payload, '$.tier_colaboradores') AS tier_colaboradores,
             SAFE_CAST(JSON_VALUE(r.payload, '$.numero_de_vidas') AS FLOAT64) AS vidas_contato
      FROM l2c c JOIN ${wh.t('bronze', 'raw_contact')} r ON r.object_id = c.contact_id
    ),
    flat AS (
      SELECT b.*, l2d.deal_id, cp.company_id, cp.company_name,
             cp.employees AS colaboradores, cp.porte AS porte_declarado,
             COALESCE(tr.vidas_contato, cp.vidas) AS vidas,
             -- Vidas do armazém (88% de cobertura) e o bucket canônico dele.
             lc.vidas_efetivas, lc.company_lives_bucket AS lives_bucket,
             -- A empresa é NOVA se ela mesma nasceu dentro da janela. É o que separa
             -- "abriu conta nova" de "aprofundou conta que já existia".
             DATE(cp.hs_created_at, 'America/Sao_Paulo') BETWEEN DATE(@since) AND DATE(@until) AS empresa_nova,
             tr.tier_colaboradores,
             -- Sinais de canal vindos do CONTATO — último degrau da cascata CANAL_SQL.
             ct.origem_canonica AS contato_origem,
             ct.source_detail   AS contato_source_detail,
             ct.analytics_source AS contato_analytics,
             IFNULL(re.max_rank, 0) AS max_rank,
             IFNULL(re.foi_qualificado, false) AS qualificado,
             (IFNULL(re.foi_desqualificado, false)
              OR (SELECT c.c FROM canon c WHERE c.sid = b.stage_id) = 'desqualificado') AS desqualificado,
             IFNULL(a.toques_manuais, 0)      AS toques_manuais,
             IFNULL(a.toques_automacao, 0)    AS toques_automacao,
             IFNULL(a.toques_manuais_antes, 0)   AS toques_manuais_antes,
             IFNULL(a.toques_automacao_antes, 0) AS toques_automacao_antes,
             IFNULL(a.ligacoes_conectadas, 0) AS ligacoes_conectadas,
             IFNULL(a.emails_enviados, 0)     AS emails_enviados,
             IFNULL(a.linkedin_enviados, 0)   AS linkedin_enviados,
             IFNULL(a.whatsapp_manual, 0)     AS whatsapp_manual,
             IFNULL(a.reunioes, 0)            AS reunioes,
             IFNULL(a.discagens, 0)           AS discagens,
             IFNULL(a.tentativas, 0)          AS tentativas,
             IFNULL(a.numero_errado, 0)       AS numero_errado,
             IFNULL(a.duracao_conectada_ms, 0) AS duracao_conectada_ms
      FROM base b
      LEFT JOIN l2c   ON l2c.lead_id  = b.lead_id
      LEFT JOIN l2co  ON l2co.lead_id = b.lead_id
      LEFT JOIN l2d   ON l2d.lead_id  = b.lead_id
      LEFT JOIN ${wh.t('silver', 'dim_company')} cp ON cp.company_id = l2co.company_id AND cp.is_current
      LEFT JOIN ${wh.t('silver', 'dim_contact')} ct ON ct.contact_id = l2c.contact_id AND ct.is_current
      LEFT JOIN ${wh.t('silver', 'dim_lead_context')} lc ON lc.lead_id = b.lead_id
      LEFT JOIN rank_etapa re ON re.lead_id = b.lead_id
      LEFT JOIN ativ a  ON a.lead_id  = b.lead_id
      LEFT JOIN tier tr ON tr.lead_id = b.lead_id
    ),
    -- As faixas nascem AQUI e viajam como rótulo, para o drill não recalcular.
    dim_calc AS (
      SELECT f.*,
             ${DIM_SQL.porte}  AS dim_porte,
             ${DIM_SQL.tier}   AS dim_tier,
             ${DIM_SQL.vidas}  AS dim_vidas,
             ${DIM_SQL.canal}  AS dim_canal,
             ${DIM_SQL.canal_macro} AS dim_canal_macro,
             ${DIM_SQL.origem} AS dim_origem,
             -- OS TRES NIVEIS DE CONTATO, empilhados. atividade_real e a regua antiga
             -- (chegou alguma coisa do outro lado); com_tentativa inclui a discagem que
             -- nao conectou, que e esforco e nao era contado.
             tentativas > 0 AS com_tentativa,
             ligacoes_conectadas > 0 AS teve_conversa,
             -- PARTIÇÃO MECE de 4 buckets, em ORDEM DE PRIORIDADE — a soma dos quatro
             -- é criados, e isso está afirmado em teste. O que sabemos DEPOIS da
             -- criação manda; o herdado só entra quando não há nada depois.
             toques_manuais > 0 AS atividade_real,
             toques_manuais = 0 AND toques_automacao > 0 AS so_automacao,
             toques_manuais = 0 AND toques_automacao = 0
               AND (toques_manuais_antes > 0 OR toques_automacao_antes > 0) AS toque_herdado,
             toques_manuais = 0 AND toques_automacao = 0
               AND toques_manuais_antes = 0 AND toques_automacao_antes = 0 AS nunca_tocado,
             max_rank >= 1 AS atingiu_tentativa_etapa,
             max_rank >= 2 AS atingiu_conectado_etapa,
             -- QUEM É BDR VIAJA COM A LINHA, em TODAS as dimensões — não só no corte
             -- por pessoa. Sem isto, ligar "só BDRs" filtraria a tabela de gente e
             -- deixaria o corte por porte/origem contando lead de executivo: os dois
             -- números na mesma tela, com a mesma cara, medindo universos diferentes.
             -- A lista vem interpolada, não por @param, porque o cliente BQ deste
             -- projeto recusa ARRAY em parâmetro (lib/bigquery.js:250). sqlList() só
             -- deixa passar [A-Za-z0-9_-], e os ids vêm de dim_owner, não do request.
             owner_id IN (${sqlList(bdrIds || [])}${(bdrIds || []).length ? '' : "''"}) AS owner_bdr
      FROM flat f
    ),
    -- O RECORTE VIRA COLUNA em vez de virar WHERE, e essa escolha é o que faz o filtro
    -- valer para a tela inteira sem cegar as combos.
    --
    -- Com WHERE, filtrar "tier-1" apagaria as OUTRAS faixas da resposta — e a combo de
    -- valores, que é montada do próprio payload, ficaria com uma opção só: seria
    -- impossível trocar de faixa sem limpar o filtro. Como coluna, cada bloco escolhe:
    -- as facetas somam tudo, a conta soma so no_recorte. E tambem o que da o CRUZAMENTO
    -- de graca: com o recorte em "BDR = Priscilla", o bloco da dimensao tier filtrado
    -- por no_recorte E a distribuicao de tier daquela BDR, sem produto cartesiano e sem
    -- uma segunda varredura.
    dim AS (SELECT d.*, ${recorteExpr(recorte)} AS no_recorte FROM dim_calc d)`;
}

/**
 * O RECORTE, traduzido para SQL. Uma dimensão, um valor.
 *
 * BDR entra por owner_id (a lista vem do handler, que é quem conhece o roster e sabe
 * que um BDR pode ter dois ids) e o resto entra pela COLUNA DE FAIXA já calculada —
 * nunca pelo valor cru. Comparar contra a faixa é o que garante que o filtro "200–500
 * vidas" recorte exatamente o mesmo conjunto que a linha "200–500" da tabela mostra;
 * recalcular a faixa aqui seria a segunda definição que a leva 4 já pagou para não ter.
 */
const RECORTE_COL = {
  porte: 'dim_porte', tier: 'dim_tier', vidas: 'dim_vidas',
  canal: 'dim_canal', canal_macro: 'dim_canal_macro', origem: 'dim_origem',
};
function recorteExpr(rec) {
  if (!rec || !rec.dim || rec.val == null || rec.val === '') return 'TRUE';
  if (rec.dim === 'bdr') {
    const ids = rec.ownerIds || [];
    return `d.owner_id IN (${sqlList(ids)}${ids.length ? '' : "''"})`;
  }
  const col = RECORTE_COL[rec.dim];
  return col ? `d.${col} = @rec_val` : 'TRUE';
}
/** Parâmetro do recorte, só quando ele existe (parâmetro órfão é ruído no job). */
function recorteParams(rec) {
  return (rec && rec.dim && rec.dim !== 'bdr' && rec.val != null && RECORTE_COL[rec.dim])
    ? [{ name: 'rec_val', type: 'STRING', value: String(rec.val) }]
    : [];
}

/**
 * O MESMO RECORTE, agora para os blocos de FLUXO (waterfall, macro, desqualificação).
 *
 * A coorte pergunta "de quem NASCEU na janela"; o fluxo pergunta "o que SE MEXEU na
 * janela", e ele alcança lead criado há um ano. Então o recorte de atributo não pode
 * sair da CTE da coorte (que é filtrada por data de criação) — precisa de uma lista de
 * leads própria, montada sobre o universo inteiro dos pipelines.
 *
 * Ela é DELIBERADAMENTE mais barata que a coorte: nada de `fact_engagement` aqui. Tier,
 * vidas, canal e porte são atributos de cadastro, e juntar 200 mil engajamentos para
 * responder "quais leads são tier-1" seria pagar caro por uma resposta que o cadastro já
 * dá.
 *
 * DUAS PREMISSAS QUE MUDAM NÚMERO, e as duas estão em `premissas.recorte`:
 *
 * 1. ATRIBUTO É O DE HOJE. Se a empresa mudou de faixa de vidas depois do movimento, o
 *    movimento é reclassificado retroativamente. É a mesma família da armadilha do
 *    pipeline do evento — só que aqui não existe histórico de atributo no armazém para
 *    fazer diferente, e fingir que existe seria pior do que declarar.
 * 2. BDR NO FLUXO É O DONO NO INSTANTE, não o dono de hoje. O bloco já atribui assim
 *    (fact_owner_assignment), e filtrar pelo dono atual sobre um movimento atribuído ao
 *    dono da época faria a barra e a tabela do MESMO card discordarem.
 */
function recorteFluxoCTE(pipes, rec) {
  if (!rec || !rec.dim || rec.val == null || rec.val === '' || rec.dim === 'bdr') return '';
  const col = RECORTE_COL[rec.dim];
  if (!col) return '';
  const faixa = {
    dim_porte: DIM_SQL.porte, dim_tier: DIM_SQL.tier, dim_vidas: DIM_SQL.vidas,
    dim_canal: DIM_SQL.canal, dim_canal_macro: DIM_SQL.canal_macro, dim_origem: DIM_SQL.origem,
  }[col];
  return `
    rec_base AS (
      SELECT l.lead_id, l.pipeline_id,
             IFNULL(NULLIF(l.origem_canonica,''), l.origem_fonte) AS origem,
             cp.employees AS colaboradores,
             lc.company_lives_bucket AS lives_bucket,
             ct.origem_canonica  AS contato_origem,
             ct.source_detail    AS contato_source_detail,
             ct.analytics_source AS contato_analytics,
             JSON_VALUE(r.payload, '$.tier_colaboradores') AS tier_colaboradores
      FROM ${wh.t('silver', 'dim_lead')} l
      LEFT JOIN (SELECT from_id AS lead_id, ANY_VALUE(to_id) AS contact_id
                 FROM ${wh.t('silver', 'bridge_association')}
                 WHERE from_object='lead' AND to_object='contact' AND is_active GROUP BY 1) bc
        ON bc.lead_id = l.lead_id
      LEFT JOIN (SELECT from_id AS lead_id, ANY_VALUE(to_id) AS company_id
                 FROM ${wh.t('silver', 'bridge_association')}
                 WHERE from_object='lead' AND to_object='company' AND is_active GROUP BY 1) bo
        ON bo.lead_id = l.lead_id
      LEFT JOIN ${wh.t('silver', 'dim_contact')} ct ON ct.contact_id = bc.contact_id AND ct.is_current
      LEFT JOIN ${wh.t('silver', 'dim_company')} cp ON cp.company_id = bo.company_id AND cp.is_current
      LEFT JOIN ${wh.t('silver', 'dim_lead_context')} lc ON lc.lead_id = l.lead_id
      LEFT JOIN ${wh.t('bronze', 'raw_contact')} r ON r.object_id = bc.contact_id
      WHERE l.is_current AND l.pipeline_id IN (${sqlList(pipes)})
    ),
    rec_leads AS (SELECT lead_id FROM rec_base WHERE ${faixa} = @rec_val),`;
}

/** A condição que amarra o movimento ao recorte. `col` é a coluna de lead_id da query. */
function recorteFluxoWhere(rec, col, ownerCol) {
  if (!rec || !rec.dim || rec.val == null || rec.val === '') return '';
  if (rec.dim === 'bdr') {
    const ids = rec.ownerIds || [];
    return ownerCol ? ` AND ${ownerCol} IN (${sqlList(ids)}${ids.length ? '' : "''"})` : '';
  }
  return (col && RECORTE_COL[rec.dim]) ? ` AND ${col} IN (SELECT lead_id FROM rec_leads)` : '';
}

/**
 * A TABELA DE TAXA, agregada no BIGQUERY.
 *
 * Antes a tela recebia TODOS os leads da coorte e agregava no browser. Funcionava em
 * 11 dias (258 leads, 0,65 MB) e **estourava em 936 dias: 15.558 leads, 15,79 MB** —
 * acima do teto de resposta da Vercel, ou seja a janela "Tudo" simplesmente não
 * respondia. Agregação é trabalho de banco: o GROUP BY desce para o BigQuery e a tela
 * recebe ~100 linhas em vez de 15 mil.
 *
 * O detalhe por lead continua vindo, mas CAPADO e com a truncagem declarada — é para
 * o drill, não para a conta. A conta é a agregação, e ela cobre 100% da coorte
 * independente do cap.
 */
/**
 * A SÉRIE TEMPORAL SAI DA MESMA VARREDURA, e é por isso que ela cabe.
 *
 * A coorte é cara: a CTE junta lead → contato → engajamento → empresa → bronze. Rodar
 * uma SEGUNDA consulta só para a linha do tempo dobraria o custo e o tempo de resposta
 * para desenhar o mesmo dado com outro GROUP BY. Aqui o bucket entra como coluna: as
 * linhas do agregado saem com `bucket='total'`, as da série com o período de verdade,
 * tudo num UNION ALL sobre a MESMA CTE.
 *
 * GRANULARIDADE ADAPTATIVA: mês em janela longa, semana ISO em janela curta. Semana em
 * 936 dias daria 134 pontos ilegíveis; mês em 11 dias daria UM ponto, que não é série.
 * O corte é declarado no payload, porque mudar de régua sem avisar é como duas telas
 * "iguais" passam a discordar.
 */
const GRAN_LIMITE_DIAS = 120;
/**
 * GRANULARIDADE É ESCOLHA DO LEITOR, com um default que pensa.
 *
 * Era só automática (semana até 120 dias, mês acima), e isso travava a pergunta que o
 * dono fez em 12/08/2026: *"se eu pego os últimos três meses, só mostra por semana; não
 * consigo um filtro para olhar por mês"*. Automático acerta o primeiro olhar e erra
 * todos os seguintes, porque a granularidade certa não depende do tamanho da janela e
 * sim da pergunta — dia para diagnosticar uma semana ruim, trimestre para ver tendência.
 *
 * O default continua adaptativo (é o que abre a tela num estado legível) e as quatro
 * opções ficam expostas. A que o usuário escolheu viaja no payload junto com a que o
 * default teria escolhido, porque "por que este gráfico está por semana" tem de ser
 * respondível sem ler código.
 *
 * TRIMESTRE usa `%Y-Q` porque FORMAT_DATE não tem token de trimestre: é ano + o número
 * do trimestre calculado da data, e o rótulo curto ("T3/26") nasce no front.
 */
const GRANS = ['dia', 'semana', 'mes', 'trimestre'];
function granPadrao(dias) {
  if (dias <= 31) return 'dia';
  if (dias <= GRAN_LIMITE_DIAS) return 'semana';
  if (dias <= 550) return 'mes';
  return 'trimestre';
}
function bucketSql(gran, col) {
  const c = col || 'criado';
  if (gran === 'dia') return `FORMAT_DATE('%F', ${c})`;
  if (gran === 'semana') return `FORMAT_DATE('%G-W%V', ${c})`;  // ISO: sem virada quebrada
  if (gran === 'trimestre') return `CONCAT(FORMAT_DATE('%Y', ${c}), '-Q', CAST(EXTRACT(QUARTER FROM ${c}) AS STRING))`;
  return `FORMAT_DATE('%Y-%m', ${c})`;
}

async function coorteAgregada(pipes, since, until, bdrIds, gran, recorte) {
  // `canal` entra e `origem` FICA, em vez de ser substituída: a origem contaminada é
  // o insumo do canal, e quem quiser auditar a cascata precisa poder ver as duas.
  const dims = [
    ['bdr', 'owner_id'], ['porte', 'dim_porte'], ['tier', 'dim_tier'],
    ['vidas', 'dim_vidas'], ['canal', 'dim_canal'], ['canal_macro', 'dim_canal_macro'],
    ['origem', 'dim_origem'],
  ];
  // A SÉRIE CARREGA MENOS COLUNAS QUE O AGREGADO, de propósito: ela multiplica cada
  // corte pelo número de períodos, e os campos de régua de toque (atividade, herdado,
  // automação) não são desenhados no eixo do tempo. Na janela completa isso é ~800
  // linhas — mandar 13 campos onde 7 bastam engordaria a resposta perto do teto da
  // Vercel para nada.
  //
  // A ORDEM DAS COLUNAS É O CONTRATO: UNION ALL no BigQuery casa por POSIÇÃO, não por
  // nome. Um campo fora de lugar aqui não dá erro — dá número errado com rótulo certo,
  // que é o defeito mais caro que existe. Por isso as ausentes entram como
  // CAST(NULL AS INT64) na MESMA posição do bloco agregado.
  const METRICAS_SERIE = `
           COUNT(*) AS criados,
           COUNTIF(atividade_real) AS com_atividade,
           COUNTIF(atingiu_tentativa_etapa) AS por_etapa,
           COUNTIF(atingiu_conectado_etapa) AS conectados,
           CAST(NULL AS INT64) AS ambos,
           CAST(NULL AS INT64) AS so_automacao,
           CAST(NULL AS INT64) AS toque_herdado,
           CAST(NULL AS INT64) AS nunca_tocados,
           COUNTIF(qualificado) AS qualificados,
           COUNTIF(deal_id IS NOT NULL) AS com_deal,
           COUNTIF(qualificado AND deal_id IS NOT NULL) AS qual_com_deal,
           CAST(NULL AS INT64) AS deal_sem_qualificar,
           COUNTIF(desqualificado) AS desqualificados,
           -- A série carrega as réguas de ESFORÇO porque a pergunta "tentou mais e
           -- converteu menos?" só existe no eixo do tempo.
           COUNTIF(com_tentativa) AS com_tentativa,
           COUNTIF(teve_conversa) AS com_conversa,
           SUM(discagens) AS discagens,
           CAST(NULL AS INT64) AS conectadas,
           CAST(NULL AS INT64) AS numero_errado,
           CAST(NULL AS INT64) AS duracao_conectada_s,
           COUNT(DISTINCT company_id) AS empresas,
           CAST(NULL AS INT64) AS empresas_novas`;
  // `owner_bdr` entra no GROUP BY de TODA dimensão: é o que permite ao front somar
  // "só BDRs" em qualquer corte sem uma segunda ida ao banco, e é 2x linhas, não 2x
  // varredura — a CTE é a mesma. `no_recorte` entra pela mesma razão: com ele, o
  // cruzamento (BDR × tier) é uma soma no front, não uma segunda consulta.
  const blocos = dims.map(([nome, col]) => `
    SELECT '${nome}' AS dimensao, CAST(${col} AS STRING) AS valor, owner_bdr, no_recorte, 'total' AS bucket,
           COUNT(*) AS criados,
           COUNTIF(atividade_real) AS com_atividade,
           COUNTIF(atingiu_tentativa_etapa) AS por_etapa,
           COUNTIF(atingiu_conectado_etapa) AS conectados,
           COUNTIF(atingiu_tentativa_etapa AND atividade_real) AS ambos,
           COUNTIF(so_automacao) AS so_automacao,
           COUNTIF(toque_herdado) AS toque_herdado,
           COUNTIF(nunca_tocado) AS nunca_tocados,
           COUNTIF(qualificado) AS qualificados,
           COUNTIF(deal_id IS NOT NULL) AS com_deal,
           -- O DEAL NÃO É SUBCONJUNTO DO QUALIFICADO, e isso apareceu como taxa de
           -- 110% na primeira medição (ago/26: 11 deals para 10 qualificados). Há
           -- lead que ganha deal sem NUNCA ter passado por Qualificado no histórico
           -- de etapa. O passo do funil precisa do cruzamento, senão a conversão
           -- estoura 100% e a tela vira piada; e o caso avulso não some — vira
           -- deal_sem_qualificar, que é achado de processo, não erro de conta.
           COUNTIF(qualificado AND deal_id IS NOT NULL) AS qual_com_deal,
           COUNTIF(NOT qualificado AND deal_id IS NOT NULL) AS deal_sem_qualificar,
           COUNTIF(desqualificado) AS desqualificados,
           -- AS TRÊS RÉGUAS DE CONTATO, lado a lado no mesmo GROUP BY.
           COUNTIF(com_tentativa) AS com_tentativa,
           COUNTIF(teve_conversa) AS com_conversa,
           SUM(discagens) AS discagens,
           SUM(ligacoes_conectadas) AS conectadas,
           SUM(numero_errado) AS numero_errado,
           CAST(ROUND(SUM(duracao_conectada_ms) / 1000) AS INT64) AS duracao_conectada_s,
           -- PENETRAÇÃO: empresas distintas tocadas pela coorte e quantas delas
           -- NASCERAM na janela. criados dividido por empresas e o "leads por empresa"
           -- que o dono pediu, e ele só significa alguma coisa com o denominador ao
           -- lado — 3 leads em 1 empresa e 3 em 3 são operações opostas.
           COUNT(DISTINCT company_id) AS empresas,
           COUNT(DISTINCT IF(empresa_nova, company_id, NULL)) AS empresas_novas
    FROM dim GROUP BY 1, 2, 3, 4`).join('\n    UNION ALL');

  // Os mesmos cortes, agora por período de CRIAÇÃO do lead — a coorte é seguida até
  // hoje, então o eixo do tempo é quando o lead nasceu, não quando ele converteu.
  const blocosSerie = dims.map(([nome, col]) => `
    SELECT '${nome}' AS dimensao, CAST(${col} AS STRING) AS valor, owner_bdr, no_recorte, ${bucketSql(gran)} AS bucket,
    ${METRICAS_SERIE}
    FROM dim GROUP BY 1, 2, 3, 4, 5`).join('\n    UNION ALL');

  /**
   * CRIADOS POR DIA, SEMPRE POR DIA — e isso conserta um número errado, não é firula.
   *
   * O gráfico "Criados e movimentados por dia" contava os criados a partir de
   * `coorte.leads`, que é a lista do DRILL e vem capada em 1.500. Em janela longa o
   * gráfico desenhava as barras dos 1.500 leads mais recentes e chamava aquilo de
   * "criados por dia" — na janela completa (15.558 leads) sobrava menos de 10% da
   * coorte, com a forma toda errada e sem nenhum aviso.
   *
   * A série do bloco acima não resolve sozinha: ela segue a granularidade escolhida, e
   * quem escolher "trimestre" deixaria o gráfico diário sem dado. Este bloco é o grão
   * bruto, independente da escolha — o front agrega para cima quando precisa, o que
   * sempre é possível; para baixo, nunca.
   */
  const blocoDia = `
    SELECT '__dia' AS dimensao, 'todos' AS valor, owner_bdr, no_recorte, FORMAT_DATE('%F', criado) AS bucket,
    ${METRICAS_SERIE}
    FROM dim GROUP BY 1, 2, 3, 4, 5`;

  const P = [
    { name: 'since', type: 'DATE', value: since },
    { name: 'until', type: 'DATE', value: until },
    ...recorteParams(recorte),
  ];
  const { rows } = await wh.query(
    coorteCTE(pipes, bdrIds, recorte) + blocos + '\n    UNION ALL' + blocosSerie + '\n    UNION ALL' + blocoDia, P);
  const por = {}, serie = {};
  rows.forEach(r => {
    const d = wh.str(r.dimensao);
    const bucket = wh.str(r.bucket);
    const base = {
      valor: wh.str(r.valor) || '(sem valor)',
      bdr: wh.bool(r.owner_bdr),
      rec: wh.bool(r.no_recorte),
      criados: wh.num(r.criados),
      com_atividade: wh.num(r.com_atividade),
      por_etapa: wh.num(r.por_etapa),
      conectados: wh.num(r.conectados),
      qualificados: wh.num(r.qualificados),
      com_deal: wh.num(r.com_deal),
      qual_com_deal: wh.num(r.qual_com_deal),
      desqualificados: wh.num(r.desqualificados),
      com_tentativa: wh.num(r.com_tentativa),
      com_conversa: wh.num(r.com_conversa),
      discagens: wh.num(r.discagens),
      empresas: wh.num(r.empresas),
    };
    if (bucket === 'total') {
      (por[d] = por[d] || []).push({
        ...base,
        ambos: wh.num(r.ambos),
        so_automacao: wh.num(r.so_automacao),
        toque_herdado: wh.num(r.toque_herdado),
        nunca_tocados: wh.num(r.nunca_tocados),
        deal_sem_qualificar: wh.num(r.deal_sem_qualificar),
        conectadas: wh.num(r.conectadas),
        numero_errado: wh.num(r.numero_errado),
        duracao_conectada_s: wh.num(r.duracao_conectada_s),
        empresas_novas: wh.num(r.empresas_novas),
      });
    } else {
      (serie[d] = serie[d] || []).push({ ...base, bucket });
    }
  });
  return { por, serie };
}

/**
 * QUEM É BDR E QUEM É EXECUTIVO — a classificação, em um lugar só.
 *
 * O corte por pessoa desta tela listava TODO dono de lead, e dono de lead não é
 * sinônimo de BDR: em ago/26 apareciam Aurilia Rodrigues (613 leads, SuperAdmin),
 * Beatriz Honorato, Rafael Leite Ferreira, André Pontes e mais uma dúzia de closers e
 * ex-BDRs arquivados, misturados com o time. Numa tabela chamada "BDR", isso não é
 * informação a mais: é gente que não é BDR ocupando o rank de BDR.
 *
 * A régua tem três degraus, do mais forte para o mais fraco:
 *   1. ROSTER canônico (`lib/bdr-team.js`) — 13 nomes, a mesma fonte que o resto de
 *      /novo-bdr já usa. Quem está aqui é BDR, ponto.
 *   2. BDR ATIVO DO PORTAL fora do roster — `owner_role='BDR'`, não arquivado e SEM
 *      time de closer. É o caso da Raina Cândido (137 leads em jun–ago/26): BDR de
 *      verdade que ninguém cadastrou no roster. Excluí-la apagaria trabalho real.
 *   3. O RESTO é não-BDR, com o motivo nomeado — executivo, closer que também está no
 *      time de BDR do portal (Rafael, Juliana, Guilherme, Fausto), Placement, ou BDR
 *      arquivado. Não some da tela: fica atrás do filtro, e o filtro diz quantos são.
 *
 * `owner_role` sozinho não resolve o degrau 3: o portal marca como BDR quem está no
 * time "BDR (Prospecção / Pré-vendas)" mesmo estando TAMBÉM em "Executivos de Vendas
 * (Closer)" — quatro pessoas hoje. Time de closer vence.
 */
const TIME_CLOSER = /executivos de vendas/i;
async function ownersInfo() {
  const { rows } = await wh.query(`
    SELECT owner_id, full_name, email, teams, owner_role, archived
    FROM ${wh.t('silver', 'dim_owner')}
    WHERE is_current
  `);
  const info = {};
  rows.forEach(r => {
    const id = wh.str(r.owner_id);
    if (!id) return;
    info[id] = {
      nome: wh.str(r.full_name) || wh.str(r.email) || id,
      teams: wh.str(r.teams) || '',
      role: wh.str(r.owner_role) || '',
      archived: wh.bool(r.archived),
    };
  });
  return info;
}

/** Classifica UM owner_id. `roster` = está no BDR_TEAM canônico. */
function classificaOwner(info, roster) {
  if (roster) return { bdr: true, papel: 'BDR do roster' };
  if (!info) return { bdr: false, papel: 'dono desconhecido' };
  const closer = TIME_CLOSER.test(info.teams);
  if (info.role === 'BDR' && !info.archived && !closer) return { bdr: true, papel: 'BDR do portal, fora do roster' };
  if (info.role === 'BDR' && info.archived) return { bdr: false, papel: 'BDR arquivado' };
  if (closer) return { bdr: false, papel: 'Executivo de vendas (closer)' };
  return { bdr: false, papel: info.role ? `${info.role} (não é BDR)` : 'sem papel no portal' };
}

/**
 * AS TAXAS DE CONVERSÃO, calculadas em um lugar só, a partir da agregação.
 *
 * Cada passo declara NUMERADOR e DENOMINADOR além do percentual. Taxa sem os dois
 * absolutos é irrefutável do jeito errado: 50% de 4 e 50% de 400 pedem decisões
 * diferentes, e quem lê só o percentual não tem como saber em qual dos dois está.
 *
 * A régua é de COORTE e ela é acumulada: "chegou a Conectado" quer dizer que o lead
 * VISITOU a etapa em algum momento, não que ele esteja lá agora. Por isso os passos
 * encaixam (todo Conectado+ é Tentativa+) e a conversão do processo é o produto dos
 * passos, não uma sexta conta independente.
 */
function conversao(linhas) {
  const s = f => linhas.reduce((a, r) => a + (r[f] || 0), 0);
  const criados = s('criados'), tentativa = s('por_etapa'), conectado = s('conectados');
  const qualificado = s('qualificados'), deal = s('com_deal'), desq = s('desqualificados');
  const qualComDeal = s('qual_com_deal'), dealSemQual = s('deal_sem_qualificar');
  const passo = (rot, de, num, den) => ({
    passo: rot, de, n: num, base: den,
    pct: den ? +(num / den * 100).toFixed(1) : null,
    perda: den - num,
  });
  return {
    criados,
    etapas: { tentativa, conectado, qualificado, deal, desqualificados: desq },
    // Deal que nunca passou por Qualificado. Não entra no passo (estouraria 100%) e
    // não é escondido: é lead que virou negócio sem a etapa registrada.
    deal_sem_qualificar: dealSemQual,
    passos: [
      passo('Novo → Tentativa+', 'criados', tentativa, criados),
      passo('Tentativa+ → Conectado+', 'tentativa', conectado, tentativa),
      passo('Conectado+ → Qualificado', 'conectado', qualificado, conectado),
      passo('Qualificado → Deal', 'qualificado', qualComDeal, qualificado),
    ],
    processo: {
      criado_para_qualificado: passo('Criado → Qualificado', 'criados', qualificado, criados),
      criado_para_deal: passo('Criado → Deal', 'criados', deal, criados),
      descarte: passo('Criado → Desqualificado', 'criados', desq, criados),
    },
  };
}

/** Detalhe por lead, para o DRILL. Capado, com a truncagem declarada. */
const COORTE_TETO = 1500;
const DESQ_TETO = 1500;
async function coorteDetalhe(pipes, since, until, bdrIds, recorte) {
  const P = [
    { name: 'since', type: 'DATE', value: since },
    { name: 'until', type: 'DATE', value: until },
    ...recorteParams(recorte),
  ];
  // O DETALHE é o único bloco que aplica o recorte como WHERE: ele alimenta o drill, e
  // drill que mostra lead de fora do recorte contradiz o card que o abriu.
  const { rows } = await wh.query(coorteCTE(pipes, bdrIds, recorte) + `
    SELECT lead_id, lead_name, owner_id, pipeline_id, stage_id, criado,
           motivo_desqualificacao, deal_id, company_id, company_name,
           colaboradores, vidas, vidas_efetivas, tier_colaboradores,
           dim_porte, dim_tier, dim_vidas, dim_canal, dim_canal_macro, dim_origem, owner_bdr,
           atividade_real, so_automacao, toque_herdado, nunca_tocado,
           com_tentativa, teve_conversa,
           atingiu_tentativa_etapa, atingiu_conectado_etapa,
           qualificado, desqualificado, toques_manuais, toques_automacao,
           toques_manuais_antes, toques_automacao_antes,
           ligacoes_conectadas, emails_enviados, linkedin_enviados, whatsapp_manual, reunioes,
           discagens, numero_errado,
           CAST(ROUND(duracao_conectada_ms / 1000) AS INT64) AS duracao_conectada_s
    FROM dim
    WHERE no_recorte
    ORDER BY criado DESC
    LIMIT ${COORTE_TETO + 1}`, P);
  const truncado = rows.length > COORTE_TETO;
  return {
    truncado,
    leads: rows.slice(0, COORTE_TETO).map(r => ({
      lead_id: wh.str(r.lead_id),
      lead: wh.str(r.lead_name),
      criado: wh.str(r.criado),
      pipeline: wh.str(r.pipeline_id),
      etapa: canon(r.stage_id),
      owner_id: wh.str(r.owner_id),
      atingiu_tentativa_etapa: wh.bool(r.atingiu_tentativa_etapa),
      atingiu_conectado_etapa: wh.bool(r.atingiu_conectado_etapa),
      qualificado: wh.bool(r.qualificado),
      desqualificado: wh.bool(r.desqualificado),
      atividade_real: wh.bool(r.atividade_real),
      so_automacao: wh.bool(r.so_automacao),
      toque_herdado: wh.bool(r.toque_herdado),
      nunca_tocado: wh.bool(r.nunca_tocado),
      toques_manuais: wh.num(r.toques_manuais),
      toques_automacao: wh.num(r.toques_automacao),
      // Toque no CONTATO anterior ao lead. Os DOIS viajam: se só o manual viajasse, o
      // lead cujo único histórico é automação pré-lead cairia em "✖ nenhum toque" no
      // drill — afirmação de ausência falsa, por ausência de CAMPO e não de toque.
      toques_manuais_antes: wh.num(r.toques_manuais_antes),
      toques_automacao_antes: wh.num(r.toques_automacao_antes),
      // Por canal — o drill nomeia o canal em vez de afirmar ausência sem universo.
      ligacoes_conectadas: wh.num(r.ligacoes_conectadas),
      emails_enviados: wh.num(r.emails_enviados),
      linkedin_enviados: wh.num(r.linkedin_enviados),
      whatsapp_manual: wh.num(r.whatsapp_manual),
      reunioes: wh.num(r.reunioes),
      // ESFORÇO no drill: sem `discagens`, o lead com 12 ligações não atendidas
      // continuaria aparecendo como "nunca tocado" na ficha, que é o defeito que a
      // régua nova existe para consertar.
      discagens: wh.num(r.discagens),
      numero_errado: wh.num(r.numero_errado),
      duracao_conectada_s: wh.num(r.duracao_conectada_s),
      com_tentativa: wh.bool(r.com_tentativa),
      teve_conversa: wh.bool(r.teve_conversa),
      owner_bdr: wh.bool(r.owner_bdr),
      deal_id: wh.str(r.deal_id),
      empresa_id: wh.str(r.company_id),
      empresa: wh.str(r.company_name),
      colaboradores: r.colaboradores == null ? null : Number(r.colaboradores),
      vidas: r.vidas == null ? null : Number(r.vidas),
      tier_colaboradores: wh.str(r.tier_colaboradores),
      motivo: wh.str(r.motivo_desqualificacao),
      origem: wh.str(r.dim_origem),
      // As faixas vêm do SQL. O front LÊ, não recalcula.
      dim_porte: wh.str(r.dim_porte), dim_tier: wh.str(r.dim_tier),
      dim_vidas: wh.str(r.dim_vidas), dim_origem: wh.str(r.dim_origem),
    })),
  };
}

/**
 * TRABALHO NA JANELA — o que a pessoa fez no período, fora da coorte.
 *
 * Existe porque a coorte responde outra pergunta e o corte por BDR fazia a tela
 * mentir por omissão. A coorte é "dos leads CRIADOS na janela, em quantos se falou" —
 * régua certa para atributo de lead (porte, tier, vidas, origem), porque o atributo
 * nasce com o lead. Para PESSOA ela é enganosa: BDR que trabalha carteira antiga
 * aparece com denominador minúsculo, e BDR que não criou nada **desaparece da tabela**.
 *
 * Auditoria de caso do dono (11/08, ago/26): Gabriele Almeida aparecia com "criou 5,
 * falou com 5" — e no mesmo período tocou **41 leads com 64 toques**. Pior, o
 * `GROUP BY` da coorte simplesmente não emitia linha para quem criou zero: **Cíntia
 * Rodrigues (35 leads / 66 toques), Anderson Souza (12/27), Thauan Pontes (6/10) e
 * Yokyko Muramoto (6/9) estavam ausentes da tabela** com trabalho medido no armazém.
 * Ausência lida como "não fez nada" é o mesmo defeito do "✖ sem toque" do Rui
 * Medeiros, na dimensão de gente.
 *
 * ATRIBUIÇÃO POR QUEM TOCOU (`fact_engagement.owner_id`), não pelo dono do lead — a
 * coluna responde "o que ESTA pessoa fez". A diferença é material e não teórica: dos
 * 1.585 toques de ago/26 no recorte, **378 (24%) foram feitos por alguém diferente do
 * dono atual do lead**. Creditar pelo dono daria a uma BDR o toque que outra fez.
 * A coluna `criados` continua sendo por dono do lead — são réguas diferentes de
 * propósito, e ambas estão declaradas em `premissas.trabalho_na_janela`.
 */
async function trabalhoNaJanela(pipes, since, until, recorte) {
  // Recorte por BDR aqui filtra QUEM TOCOU, não o dono do lead — é a régua da própria
  // coluna. Recorte por atributo filtra os leads tocados.
  const porBdr = !!(recorte && recorte.dim === 'bdr' && (recorte.ownerIds || []).length);
  const { rows } = await wh.query(`
    WITH ${recorteFluxoCTE(pipes, recorte)}
    l AS (
      SELECT dl.lead_id FROM ${wh.t('silver', 'dim_lead')} dl
      WHERE dl.is_current AND dl.pipeline_id IN (${sqlList(pipes)})
        ${recorteFluxoWhere(recorte, 'dl.lead_id', null)}
    ),
    l2c AS (
      SELECT b.from_id AS lead_id, ANY_VALUE(b.to_id) AS contact_id
      FROM ${wh.t('silver', 'bridge_association')} b JOIN l ON l.lead_id = b.from_id
      WHERE b.from_object='lead' AND b.to_object='contact' AND b.is_active GROUP BY 1
    ),
    -- engagement_id viaja porque UM CONTATO PODE TER VÁRIOS LEADS: o join
    -- toque→contato→lead multiplica o mesmo toque por quantos leads o contato tem.
    -- Sem o DISTINCT, Gabriele Almeida aparecia com 173 toques tendo feito 168 —
    -- inflação de 3% que cresce com o reuso de contato, e infla justamente quem
    -- trabalha a mesma base mais de uma vez.
    tq AS (
      SELECT DISTINCT f.owner_id, c.lead_id, f.engagement_id
      FROM l2c c
      JOIN ${wh.t('silver', 'fact_engagement')} f ON f.contact_id = c.contact_id
      WHERE DATE(f.occurred_at, 'America/Sao_Paulo') BETWEEN DATE(@since) AND DATE(@until)
        AND ${ATIV_MANUAL}
        ${porBdr ? `AND f.owner_id IN (${sqlList(recorte.ownerIds)})` : ''}
    )
    SELECT 'owner' AS escopo, owner_id,
           COUNT(DISTINCT lead_id) AS leads, COUNT(DISTINCT engagement_id) AS toques
    FROM tq GROUP BY 1, 2
    UNION ALL
    -- O total do time NÃO é a soma das linhas: lead tocado por dois BDRs entraria duas
    -- vezes. Sai daqui, com DISTINCT sobre o time inteiro.
    SELECT 'time' AS escopo, NULL,
           COUNT(DISTINCT lead_id), COUNT(DISTINCT engagement_id) FROM tq
  `, [
    { name: 'since', type: 'DATE', value: since },
    { name: 'until', type: 'DATE', value: until },
    ...recorteParams(recorte),
  ]);
  const porOwner = {};
  let semDono = { leads: 0, toques: 0 };
  let time = { leads: 0, toques: 0 };
  rows.forEach(r => {
    const v = { leads: wh.num(r.leads), toques: wh.num(r.toques) };
    if (wh.str(r.escopo) === 'time') { time = v; return; }
    const id = wh.str(r.owner_id);
    if (!id) semDono = v; else porOwner[id] = v;
  });
  return { porOwner, semDono, time };
}

/** Contraprova ao vivo: Search API por etapa (barata, `total` sem paginar). */
async function snapshotPortal(token, pipes) {
  const stages = Object.keys(PIPE_OF_STAGE).filter(s => pipes.includes(PIPE_OF_STAGE[s]));
  const out = {};
  for (const st of stages) {
    try {
      const resp = await hubspotPost(token, '/crm/v3/objects/leads/search', {
        filterGroups: [{ filters: [{ propertyName: 'hs_pipeline_stage', operator: 'EQ', value: st }] }],
        limit: 1,
      });
      const c = canon(st);
      out[c] = (out[c] || 0) + (resp.total || 0);
    } catch (_) { /* contraprova é opcional; não derruba o endpoint */ }
  }
  return out;
}

module.exports = async (req, res) => {
  setCORSHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!methodCheck(req, res, ['GET'])) return;
  if (!requireAuth(req, res)) return;

  const funilKey = ['principal', 'diagnostico', 'todos'].includes(String(req.query.funil))
    ? String(req.query.funil) : 'todos';
  const pipes = FUNIS[funilKey];

  const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // America/Sao_Paulo
  const until = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.until)) ? String(req.query.until) : hoje;

  // JANELA UNIVERSAL. `tudo=1` é o filtro "Tudo" da barra, que devolve start/end nulos.
  // Antes o default caía no mês corrente, então "Tudo" mostrava só agosto — a tela
  // ficava presa no mês sem dizer que estava. O piso do "tudo" sai do PRÓPRIO DADO
  // (`MIN(hs_created_at)` dos pipelines do recorte), não de uma data chumbada: data
  // chumbada envelhece em silêncio e passa a cortar histórico sem ninguém notar.
  let since, cacheKey, dias;
  try {
    // resolvido aqui dentro para falha de BQ virar 500 com mensagem, nao rejeicao solta
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.since))) {
      since = String(req.query.since);
    } else if (String(req.query.tudo) === '1') {
      const { rows: piso } = await wh.query(`
        SELECT FORMAT_DATE('%F', MIN(DATE(hs_created_at, 'America/Sao_Paulo'))) AS de
        FROM ${wh.t('silver', 'dim_lead')}
        WHERE is_current AND pipeline_id IN (${sqlList(pipes)}) AND hs_created_at IS NOT NULL
      `);
      since = (piso[0] && wh.str(piso[0].de)) || '2024-01-01';
    } else {
      since = until.slice(0, 8) + '01';
    }

    dias = Math.round((Date.parse(until) - Date.parse(since)) / 86400000) + 1;

    // GRANULARIDADE: escolha do leitor, com default que pensa (ver GRANS/granPadrao).
    const granPedida = GRANS.includes(String(req.query.gran)) ? String(req.query.gran) : null;
    const granDefault = granPadrao(dias);
    const gran = granPedida || granDefault;

    // RECORTE: uma dimensão, um valor. Vem do request e vale para a SEÇÃO INTEIRA.
    const dimPedida = ['bdr', 'porte', 'tier', 'vidas', 'canal', 'canal_macro', 'origem']
      .includes(String(req.query.dim)) ? String(req.query.dim) : null;
    const valPedido = req.query.val == null || req.query.val === '' ? null : String(req.query.val).slice(0, 200);
    const recorte = dimPedida && valPedido ? { dim: dimPedida, val: valPedido } : null;

    cacheKey = `${funilKey}|${since}|${until}|${gran}|${recorte ? recorte.dim + '=' + recorte.val : '-'}`;
    if (_cache[cacheKey] && Date.now() - _cache[cacheKey].at < CACHE_TTL && req.query.refresh !== '1') {
      return res.status(200).json({ ..._cache[cacheKey].data, cache: true });
    }

    // O QUEM VEM ANTES DO QUANTO: a lista de owner_ids de BDR entra nas consultas de
    // coorte como parâmetro, então ela não pode ser resolvida depois. A consulta é a
    // dim_owner inteira (dezenas de linhas) — serializar isto custa milissegundos.
    const info = await ownersInfo();
    const owners = {};
    Object.keys(info).forEach(id => { owners[id] = info[id].nome; });

    const idToBdr = resolveTeamIds(owners);
    // Papel por owner_id, e a lista de ids que a tabela "BDR" aceita como BDR.
    const papelDe = {};
    Object.keys(info).forEach(id => { papelDe[id] = classificaOwner(info[id], !!idToBdr[id]); });
    const bdrIds = Object.keys(papelDe).filter(id => papelDe[id].bdr);

    // O NOME DO BDR VIRA LISTA DE owner_ids AQUI, e só aqui.
    //
    // A tela filtra por NOME canônico ("Cíntia Rodrigues") porque é o que ela mostra; o
    // banco só conhece owner_id, e um BDR pode ter mais de um id (Cíntia tem o legado
    // 86900152 e o ativo 87213208). Resolver isso no SQL exigiria o roster dentro da
    // consulta; resolver no front exigiria mandar o mapa de ids para o browser. Aqui é
    // o único lugar que já tem os dois lados.
    //
    // Sem nenhum id casado, o recorte devolve VAZIO em vez de devolver tudo: filtro que
    // não encontra ninguém e mostra o time inteiro é a falha silenciosa clássica.
    if (recorte && recorte.dim === 'bdr') {
      recorte.ownerIds = Object.keys(owners).filter(id => (idToBdr[id] || owners[id]) === recorte.val);
      recorte.sem_correspondencia = recorte.ownerIds.length === 0;
    }

    const [snap, wf, mac, ativ, aggTudo, det, trab] = await Promise.all([
      snapshot(pipes, recorte),
      waterfall(pipes, since, until, recorte),
      macro(pipes, since, until, recorte),
      atividade(pipes, since, until),        // a régua é única, e a coorte depende dela
      coorteAgregada(pipes, since, until, bdrIds, gran, recorte), // GROUP BY + série, uma varredura
      coorteDetalhe(pipes, since, until, bdrIds, recorte),    // detalhe capado, para o drill
      trabalhoNaJanela(pipes, since, until, recorte), // o que a PESSOA fez, fora da coorte
    ]);
    const agg = aggTudo.por;

    // Nome do dono e do autor. Autor: `updated_by_user_id` casa com
    // `dim_owner.owner_id` em 17/17 hoje — coincidência medida, não contrato, e por
    // isso o id cru também viaja no payload.
    const nome = id => (id && owners[id]) || null;

    // A RAZÃO da desqualificação, além do motivo declarado. O portal tem UM campo de
    // motivo (`motivos_de_desqualificacao`, 17 valores) e nenhum campo de razão livre
    // — então "razão" aqui é o contexto que permite AUDITAR o motivo: de que etapa
    // saiu, quem fez, e se houve toque antes de desqualificar.
    //
    // O cruzamento que isso destrava: lead desqualificado como "Não houve tentativa de
    // contato" que TINHA toque, e lead desqualificado por qualquer outro motivo que não
    // tinha nenhum. Os dois são erro de processo, e nenhum aparece olhando só o motivo.
    /**
     * SUBMOTIVO POR EVIDÊNCIA — a resposta possível para "quais são os submotivos".
     *
     * O pedido do dono (12/08/2026) era condicional: *"ver se tem alguma outra
     * propriedade que tenha explicação do motivo; se tiver, quero um machine learning
     * dos submotivos"*. A condição foi MEDIDA e não se cumpre:
     *
     *   · LEAD    — só `motivos_de_desqualificacao` (17 valores fechados). Nenhum campo
     *               de texto livre; conferido varrendo as chaves do bronze.
     *   · CONTATO — nenhum campo de motivo.
     *   · DEAL    — existe `motivo_do_declinio_ou_perdido` (1.561 preenchidos), mas
     *               também é ENUM de 16 valores, não texto.
     *
     * O único texto livre são as NOTAS, e elas não sustentam clusterização: dos 3.565
     * desqualificados de 01/06–11/08, apenas 296 (8,3%) têm nota perto da
     * desqualificação, e destes 76 são template automático (webinar, ficha do
     * Prospector) e 139 não têm sinal reconhecível — sobram 81 leads, 2,3% do total.
     * Um gráfico de "submotivos" cujo maior balde fosse "(sem sinal)" seria análise
     * falsa com cara de análise.
     *
     * O que EXISTE e cobre 100%: decompor o motivo declarado pela EVIDÊNCIA que o CRM
     * registra. "Não houve tentativa de contato" com 12 discagens não atendidas e "não
     * houve tentativa" sem nenhuma discagem são o mesmo motivo e problemas opostos —
     * um é lista ruim, o outro é cadência que não aconteceu.
     */
    const submotivoEvidencia = (A, automacao) => {
      const tm = A.toques_manuais || 0, ta = A.toques_automacao || 0;
      const disc = A.discagens || 0, con = A.ligacoes_conectadas || 0;
      if (automacao) return 'Automação desqualificou';
      if (A.numero_errado) return 'Telefone errado (dado, não cadência)';
      if (con > 0) return 'Falou por voz e não avançou';
      if (tm > 0) return 'Mensagem entregue, sem conversa';
      if (disc > 0) return `Discou ${disc}x, ninguém atendeu`.replace(/^Discou 1x/, 'Discou 1x');
      if (ta > 0) return 'Só automação tocou';
      if ((A.toques_manuais_antes || 0) > 0) return 'Só toque anterior ao lead';
      return 'Nenhum esforço registrado';
    };

    const desq = wf.desq.map(d => {
      const A = ativ.mapa[d.lead_id] || {};
      const tm = A.toques_manuais || 0, ta = A.toques_automacao || 0;
      const motivo = d.motivo || '(sem motivo)';
      const semTentativa = /n[aã]o houve tentativa/i.test(motivo);
      return {
        ...d,
        motivo,
        bdr: idToBdr[d.owner_id] || nome(d.owner_id) || '(sem dono)',
        autor: d.source_type === 'AUTOMATION_PLATFORM' ? 'Automação'
             : d.source_type === 'INTEGRATION' ? 'Integração'
             : (idToBdr[d.autor_user_id] || nome(d.autor_user_id) || '(autor desconhecido)'),
        automacao: d.source_type === 'AUTOMATION_PLATFORM' || d.source_type === 'INTEGRATION',
        // razão auditável
        etapa_de_origem: d.de,
        toques_manuais: tm,
        toques_automacao: ta,
        discagens: A.discagens || 0,
        ligacoes_conectadas: A.ligacoes_conectadas || 0,
        numero_errado: A.numero_errado || 0,
        // O submotivo agrupa a discagem por FAIXA, não pelo número exato: "discou 12x"
        // e "discou 13x" são o mesmo caso, e uma categoria por contagem viraria uma
        // categoria por lead.
        submotivo: (function () {
          const s = submotivoEvidencia(A, d.source_type === 'AUTOMATION_PLATFORM' || d.source_type === 'INTEGRATION');
          const m = s.match(/^Discou (\d+)x/);
          if (!m) return s;
          const n = +m[1];
          return n === 1 ? 'Discou 1x, ninguém atendeu'
            : n <= 3 ? 'Discou 2–3x, ninguém atendeu'
            : n <= 9 ? 'Discou 4–9x, ninguém atendeu'
            : 'Discou 10x ou mais, ninguém atendeu';
        })(),
        teve_toque: tm > 0,
        primeiro_toque: A.primeiro_toque || null,
        // as duas contradições, marcadas para virarem filtro na tela
        contradiz_motivo: semTentativa && tm > 0,
        desqualificado_sem_toque: !semTentativa && tm === 0,
      };
    });

    const bdrDe = id => idToBdr[id] || nome(id) || '(sem dono)';
    const leads = det.leads.map(l => ({ ...l, bdr: bdrDe(l.owner_id), dim_bdr: bdrDe(l.owner_id) }));

    // A dimensão BDR vem do BQ por owner_id; colapsar em nome canônico é aqui, porque
    // é o JS que conhece o roster (dois owner_ids podem ser o mesmo BDR por alias).
    const ZERO_COORTE = () => ({ criados: 0, com_atividade: 0, por_etapa: 0, conectados: 0,
      ambos: 0, so_automacao: 0, toque_herdado: 0, nunca_tocados: 0, qualificados: 0,
      com_deal: 0, qual_com_deal: 0, deal_sem_qualificar: 0, desqualificados: 0,
      // esforço + penetração
      com_tentativa: 0, com_conversa: 0, discagens: 0, conectadas: 0, numero_errado: 0,
      duracao_conectada_s: 0, empresas: 0, empresas_novas: 0 });
    const CAMPOS_COORTE = Object.keys(ZERO_COORTE());

    const porDimensao = { ...agg };
    if (agg.bdr) {
      const m = {};
      // A chave carrega o `rec` junto com o nome: colapsar os dois owner_ids de um BDR
      // é certo, colapsar dentro e fora do recorte é apagar o recorte.
      const linha = (k, rec) => {
        const kk = k + ' ' + (rec ? '1' : '0');
        return (m[kk] = m[kk] || { valor: k, rec: !!rec, ...ZERO_COORTE(), trab_leads: 0, trab_toques: 0 });
      };
      // O papel viaja por NOME canônico, porque é por nome que as linhas colapsam.
      // Um nome só tem um papel: se qualquer owner_id dele é BDR, o nome é BDR.
      const papelPorNome = {};
      const marcaPapel = id => {
        const nomeCanon = bdrDe(id), p = papelDe[id] || classificaOwner(info[id], !!idToBdr[id]);
        const atual = papelPorNome[nomeCanon];
        if (!atual || (p.bdr && !atual.bdr)) papelPorNome[nomeCanon] = p;
      };
      agg.bdr.forEach(r => {
        marcaPapel(r.valor);
        const a = linha(bdrDe(r.valor), r.rec);
        CAMPOS_COORTE.forEach(f => { a[f] += r[f] || 0; });
      });

      // TRABALHO NA JANELA colado na mesma linha. É o que impede a tabela de dizer
      // "criou 5, falou com 5" para quem tocou 41 leads no mesmo período.
      //
      // Colapsar por nome soma `leads` de owner_ids distintos: BDR com 2 ids (Cíntia,
      // 86900152 legado + 87213208 ativo) pode contar duas vezes um lead tocado pelos
      // dois. Declarado em `divergencias_conhecidas.trabalho_multi_owner_id` — o id
      // legado não tem linhas no BQ, então hoje o efeito medido é zero.
      // O trabalho na janela JÁ vem recortado pela consulta (é ela que sabe filtrar por
      // quem tocou), então ele entra na linha DE DENTRO do recorte.
      Object.keys(trab.porOwner).forEach(id => {
        marcaPapel(id);
        const a = linha(bdrDe(id), true);
        a.trab_leads  += trab.porOwner[id].leads;
        a.trab_toques += trab.porOwner[id].toques;
      });

      // O ROSTER INTEIRO GANHA LINHA, mesmo zerado. Linha ausente lê como "não fez
      // nada" e é indistinguível de "não foi medido"; linha em zero é uma afirmação.
      BDR_TEAM.forEach(n => linha(n, true));

      // Duas marcas, e elas respondem coisas diferentes: `roster` diz se a pessoa está
      // no BDR_TEAM canônico; `bdr` diz se ela é BDR de verdade — o que inclui o BDR
      // ativo do portal fora do roster e EXCLUI closer, Placement, admin e ex-BDR
      // arquivado. É `bdr` que o filtro "só BDRs" usa; sem ela a tabela chamada "BDR"
      // rankeava executivo junto com o time.
      porDimensao.bdr = Object.values(m).map(r => {
        const roster = BDR_TEAM.indexOf(r.valor) >= 0;
        const p = papelPorNome[r.valor] || (roster ? { bdr: true, papel: 'BDR do roster' } : { bdr: false, papel: 'dono desconhecido' });
        return { ...r, roster, bdr: roster || p.bdr, papel: p.papel };
      });

      // A SÉRIE PASSA PELO MESMO COLAPSO. Se o eixo do tempo continuasse por owner_id
      // enquanto a tabela mostra nome canônico, filtrar "Cíntia Rodrigues" no gráfico
      // não acharia nada — o filtro casa por rótulo, e os dois rótulos têm de ser o
      // MESMO. Aqui o colapso é por (nome, bucket).
      if (aggTudo.serie.bdr) {
        const ZERO_SERIE = { criados: 0, com_atividade: 0, por_etapa: 0, conectados: 0, qualificados: 0,
          com_deal: 0, qual_com_deal: 0, desqualificados: 0,
          com_tentativa: 0, com_conversa: 0, discagens: 0, empresas: 0 };
        const CAMPOS_SERIE = Object.keys(ZERO_SERIE);
        const s = {};
        aggTudo.serie.bdr.forEach(r => {
          const nomeCanon = bdrDe(r.valor), k = nomeCanon + '|' + r.bucket + '|' + (r.rec ? 1 : 0);
          const a = s[k] = s[k] || { valor: nomeCanon, bucket: r.bucket, rec: !!r.rec, ...ZERO_SERIE };
          CAMPOS_SERIE.forEach(f => { a[f] += r[f] || 0; });
        });
        const papelDeNome = {};
        (porDimensao.bdr || []).forEach(r => { papelDeNome[r.valor] = r; });
        aggTudo.serie.bdr = Object.values(s).map(r => {
          const ref = papelDeNome[r.valor] || {};
          return { ...r, roster: !!ref.roster, bdr: ref.bdr !== false, papel: ref.papel || null };
        });
      }
    }

    // Os totais saem da AGREGAÇÃO, nunca da lista capada — é isso que faz a tabela
    // continuar certa quando o detalhe é truncado. Só campos NUMÉRICOS entram: somar
    // `roster` daria contagem de gente disfarçada de métrica.
    // Só as linhas DENTRO do recorte entram no total: `por_dimensao` carrega as duas
    // metades (é o que mantém as combos com todos os valores), e somar as duas daria o
    // total do time inteiro embaixo de um card que diz "Tier = tier-1".
    const tot = (porDimensao.bdr || []).filter(r => r.rec !== false).reduce((a, r) => {
      Object.keys(r).forEach(f => {
        if (typeof r[f] === 'number') a[f] = (a[f] || 0) + r[f];
      });
      return a;
    }, {});
    const n = tot.criados || 0;
    const porEtapa = tot.por_etapa || 0;
    const porAtividade = tot.com_atividade || 0;

    const payload = {
      success: true,
      janela: {
        since, until, dias, funil: funilKey, pipelines: pipes,
        origem: /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.since)) ? 'filtro'
              : String(req.query.tudo) === '1' ? 'tudo (piso vindo do dado)' : 'mês corrente (default)',
      },
      // O RECORTE ATIVO, declarado. Sem isto, um print da tela filtrada é
      // indistinguível de um print da tela inteira — e é assim que um número de uma BDR
      // vira "o número do time" numa apresentação.
      recorte: recorte ? {
        dimensao: recorte.dim, valor: recorte.val,
        aplicado_em: 'coorte, série, waterfall macro e detalhado, snapshot, por dia e desqualificações',
        regua_bdr: recorte.dim === 'bdr'
          ? 'dono NO INSTANTE no fluxo (waterfall/macro), dono do lead na coorte, dono ATUAL no snapshot, quem TOCOU no trabalho na janela'
          : null,
        owner_ids: recorte.ownerIds || null,
        sem_correspondencia: !!recorte.sem_correspondencia,
      } : null,
      granularidade: {
        escolhida: gran,
        pedida: granPedida,
        padrao: granDefault,
        opcoes: GRANS,
        regra: `padrão adaptativo: dia até 31 dias, semana ISO até ${GRAN_LIMITE_DIAS}, mês até 550, trimestre acima. A escolha manual vence e viaja aqui.`,
      },
      snapshot: { camada: 'silver', tabela: 'dim_lead', por_etapa: snap.porEtapa, etapas_nao_mapeadas: snap.naoMapeadas },
      // Waterfall MACRO: o saldo que abre, recebe, perde e fecha. A soma FECHA, e o
      // que não fecha vira a barra `residuo` em vez de sumir nas outras.
      macro: {
        camada: 'silver', tabela: 'fact_stage_entry + fact_crm_change + dim_lead',
        ...mac,
        fecha: mac.residuo === 0,
        conferencia: `${mac.aberto_inicio} + ${mac.entrada_no_funil}`
          + (mac.entrada_sem_registro ? ` + ${mac.entrada_sem_registro}` : '')
          + ` + ${mac.reativados}`
          + (mac.recebeu_transferencia ? ` + ${mac.recebeu_transferencia}` : '')
          + ` − ${mac.qualificados} − ${mac.desqualificados} − ${mac.saiu_do_recorte}`
          + (mac.passou_transferencia ? ` − ${mac.passou_transferencia}` : '')
          + ` = ${mac.aberto_inicio + mac.entrada_no_funil + mac.entrada_sem_registro + mac.reativados + mac.recebeu_transferencia - mac.qualificados - mac.desqualificados - mac.saiu_do_recorte - mac.passou_transferencia}`
          + ` (fecho medido: ${mac.aberto_fim}, resíduo ${mac.residuo >= 0 ? '+' : ''}${mac.residuo})`,
      },
      waterfall: {
        camada: 'silver', tabela: 'fact_crm_change + fact_owner_assignment',
        setas: wf.setas, por_dia: wf.porDia, movimentos: wf.movimentos,
        // Por STATUS: como cada etapa ganhou e perdeu na janela, com o saldo dos
        // dois instantes. saldo_inicio + entradas − saidas == saldo_fim por etapa.
        por_status: CAN_ALL.map(c => {
          const s = wf.porStatus[c] || { entradas: 0, saidas: 0 };
          const si = mac.saldo_inicio[c] || 0, sf = mac.saldo_fim[c] || 0;
          return {
            etapa: c, rotulo: CANON_PT[c],
            saldo_inicio: si, entradas: s.entradas, saidas: s.saidas, saldo_fim: sf,
            liquido: s.entradas - s.saidas,
            residuo: sf - (si + s.entradas - s.saidas),
          };
        }),
        leads: wf.movimentados,
        leads_total: wf.movimentados_total,
        leads_truncado: wf.movimentados_truncado,
      },
      coorte: {
        camada: 'silver', tabela: 'dim_lead + fact_stage_entry + fact_engagement + bronze.raw_contact',
        agregacao: 'GROUP BY no BigQuery (a tabela de taxa nao depende do cap do detalhe)',
        leads,
        leads_truncado: det.truncado,
        // Agregação COMPLETA da coorte, feita no BigQuery. Cobre 100% dos leads
        // independente do cap do detalhe acima.
        por_dimensao: porDimensao,
        criados: n,
        // "Criaram X e falaram com quantos Y?" — o Y viaja como NÚMERO ABSOLUTO, não
        // só como taxa. Taxa sem o absoluto esconde a escala: 50% de 4 e 50% de 400
        // pedem decisões diferentes.
        taxa_contato: {
          criados: n,
          por_etapa:     { n: porEtapa,     pct: n ? +(porEtapa / n * 100).toFixed(1) : null },
          por_atividade: { n: porAtividade, pct: n ? +(porAtividade / n * 100).toFixed(1) : null },
          etapa_sem_atividade: (tot.por_etapa || 0) - (tot.ambos || 0),
          atividade_sem_etapa: (tot.com_atividade || 0) - (tot.ambos || 0),
          so_automacao: tot.so_automacao || 0,
          toque_herdado: tot.toque_herdado || 0,
          nunca_tocados: tot.nunca_tocados || 0,
          // A TERCEIRA RÉGUA, e a distância entre as três é o achado (ver ATIV_ESFORCO).
          // `esforco` conta a discagem que não conectou; `conversa` só a voz atendida.
          por_esforco: { n: tot.com_tentativa || 0, pct: n ? +((tot.com_tentativa || 0) / n * 100).toFixed(1) : null },
          por_conversa: { n: tot.com_conversa || 0, pct: n ? +((tot.com_conversa || 0) / n * 100).toFixed(1) : null },
          discagens: tot.discagens || 0,
          ligacoes_conectadas: tot.conectadas || 0,
          // "Quantas discagens para uma conversa" — a leitura que separa cadência ruim
          // de lista ruim. Sem denominador ela não significa nada, então os dois viajam.
          discagens_por_conversa: tot.conectadas ? +((tot.discagens || 0) / tot.conectadas).toFixed(1) : null,
          numero_errado: tot.numero_errado || 0,
          minutos_ao_telefone: Math.round((tot.duracao_conectada_s || 0) / 60),
        },
        // PENETRAÇÃO: empresas alcançadas e quantos leads por empresa.
        penetracao: {
          empresas: tot.empresas || 0,
          empresas_novas: tot.empresas_novas || 0,
          leads_por_empresa: tot.empresas ? +(n / tot.empresas).toFixed(2) : null,
          nota: 'Empresas DISTINTAS entre os leads criados na janela. No corte por pessoa, o número por linha é somado por nome canônico: BDR com dois owner_ids pode contar a mesma empresa duas vezes (efeito medido hoje: zero, o id legado não tem linhas).',
        },
        qualificados: tot.qualificados || 0,
        com_deal: tot.com_deal || 0,
        // AS TAXAS DE CONVERSÃO, nas duas populações, sem a tela ter de escolher uma
        // calada. `bdr` é o funil do time; `todos` inclui executivo, Placement e ex-BDR
        // arquivado que também são donos de lead. A diferença entre os dois é o tamanho
        // do que o filtro tira — e ela fica no payload para poder ser conferida.
        // A LINHA DO TEMPO da mesma coorte, pelo período de CRIAÇÃO do lead. Vem por
        // dimensão × valor, para o filtro de campo funcionar no gráfico sem uma segunda
        // ida ao banco. O último bucket é declarado PARCIAL: a coorte recente ainda
        // está viva e sempre converte menos — ler a queda do fim como piora é o erro
        // clássico de gráfico de coorte.
        serie: {
          granularidade: gran,
          regra_granularidade: `semana ISO em janela de até ${GRAN_LIMITE_DIAS} dias, mês acima disso (janela atual: ${dias} dias)`,
          bucket_parcial: (() => {
            const bs = new Set();
            Object.keys(aggTudo.serie).forEach(d => aggTudo.serie[d].forEach(r => bs.add(r.bucket)));
            return Array.from(bs).sort().pop() || null;
          })(),
          por_dimensao: aggTudo.serie,
        },
        conversao: {
          regua: 'COORTE acumulada: leads CRIADOS na janela, seguidos até hoje. "Chegou a Conectado" = visitou a etapa em algum momento, não "está lá agora" — por isso os passos encaixam e a conversão do processo é o produto deles.',
          bdr: conversao((porDimensao.bdr || []).filter(r => r.bdr && r.rec !== false)),
          todos: conversao((porDimensao.bdr || []).filter(r => r.rec !== false)),
          fora_do_time: (porDimensao.bdr || []).filter(r => !r.bdr && r.rec !== false && (r.criados || r.trab_toques))
            .map(r => ({ dono: r.valor, papel: r.papel, criados: r.criados, toques_na_janela: r.trab_toques })),
        },
      },
      // O QUE O TIME FEZ NA JANELA, independente da coorte. Vive fora de `coorte` de
      // propósito: misturar as duas no mesmo objeto é como alguém soma um com o outro.
      trabalho_na_janela: {
        camada: 'silver', tabela: 'fact_engagement + bridge_association + dim_lead',
        atribuicao: 'quem TOCOU (fact_engagement.owner_id), não o dono do lead',
        // DISTINCT sobre o time, não soma das linhas: lead tocado por dois BDRs conta
        // uma vez aqui e uma vez em cada linha, e as duas coisas estão certas.
        leads_tocados: trab.time.leads,
        toques: trab.time.toques,
        soma_das_linhas: { leads: tot.trab_leads || 0, toques: tot.trab_toques || 0 },
        sem_dono_no_toque: trab.semDono,
      },
      desqualificacoes: desq.slice(0, DESQ_TETO),
      desqualificacoes_total: desq.length,
      desqualificacoes_truncado: Math.max(0, desq.length - DESQ_TETO),
      ordem_funil: FUNNEL_ORDER,
      rotulos: CANON_PT,
      premissas: {
        objeto: 'Objeto Leads nativo (0-136). NÃO é hs_lead_status no contato — em jul/26 o contato via 234 criados contra 2.302 leads, ~10% do funil. hs_lead_status está abandonado (90,6% preso em NEW).',
        quebra_de_serie: 'O funil sai de ~234 contatos para ~2.302 leads no mês. NÃO é ganho de produtividade de 10x: é outro objeto. Comparação com qualquer print anterior a 11/08/2026 é inválida.',
        pipeline_do_evento: 'Etapa contada no pipeline REGISTRADO NO EVENTO (derivado do stage_id, único por pipeline), nunca no pipeline atual do lead. 1.456 leads trocaram de pipeline; pelo atual, o New/Tentativa reais deles desapareceriam do funil principal.',
        backup_excluido: `Pipeline Backup (${PIPE_BACKUP}) fora do recorte por decisão do dono; parou de receber lead em 09/04/2026. Movimentos descartados nesta janela: ${wf.descartadasBackup}.`,
        stage_canon: 'Etapa canônica por mapa EXPLÍCITO de stage_id. stage_order NÃO é comparável entre pipelines (principal 0–4, Diagnóstico Site 1–5).',
        regua_atividade_corrigida: 'CORREÇÃO de 11/08/2026: a régua de atividade real OMITIA WhatsApp, que é o canal mais usado do time depois do e-mail (7.297 mensagens manuais em 90d). Achado por auditoria de caso do dono — o lead "Rui Medeiros 2026-08" aparecia como sem toque tendo WhatsApp manual em 07/08. Efeito na coorte de jul/26: atividade real vai de 1.076 (46,7%) para 1.601 (69,5%), +525 leads; o gap "movido sem toque" cai de 1.009 para ~490. O número publicado ANTES desta correção estava inflado. A régua agora conta: ligação CONECTADA, e-mail enviado, LinkedIn enviado, WhatsApp enviado MANUALMENTE e reunião REALIZADA. NÃO conta: tarefa (intenção, não ação), nota, e-mail de ENTRADA inclusive auto-reply, ligação discada sem conexão, e WhatsApp de integração (Treble) — este último em bucket próprio e visível como so_automacao.',
        submotivo_por_evidencia: 'PEDIDO CONDICIONAL DO DONO (12/08/2026): "ver se tem alguma outra propriedade com explicação do motivo; se tiver, quero um machine learning dos submotivos". A condição foi medida e NÃO se cumpre. No LEAD só existe motivos_de_desqualificacao (17 valores fechados); no CONTATO não existe campo de motivo; no DEAL existe motivo_do_declinio_ou_perdido, mas também é ENUM (16 valores, 1.561 preenchidos), não texto livre. O único texto livre são as NOTAS, e elas não sustentam clusterização: dos 3.565 desqualificados de 01/06 a 11/08, apenas 296 (8,3%) têm nota perto da desqualificação — 76 delas são template automático (inscrição em webinar, ficha do Sales Prospector, solicitação pelo site) e 139 não têm sinal reconhecível, sobrando 81 leads, 2,3% do total. Rodar clusterização nisso produziria clusters de template com nome de insight. O que entra no lugar cobre 100% e é auditável: o SUBMOTIVO POR EVIDÊNCIA, que decompõe cada motivo declarado pelo que o CRM registrou — "Nenhum esforço registrado", "Discou Nx, ninguém atendeu" (em faixas), "Telefone errado (dado, não cadência)", "Mensagem entregue, sem conversa", "Falou por voz e não avançou", "Só automação tocou", "Só toque anterior ao lead" e "Automação desqualificou". A leitura que isso destrava: "Não houve tentativa de contato" com 12 discagens não atendidas e o mesmo motivo sem nenhuma discagem são problemas OPOSTOS — um é lista ruim, o outro é cadência que não aconteceu.',
        razao_da_desqualificacao: 'O portal tem UM campo de motivo (motivos_de_desqualificacao, 17 valores) e NENHUM campo de razão livre. A "razão" na tela é o contexto que audita o motivo: de que etapa o lead saiu, quem fez o movimento, e se houve toque antes. Isso destrava dois cruzamentos que o motivo sozinho esconde: lead desqualificado como "Não houve tentativa de contato" que TINHA toque (contradiz_motivo), e lead desqualificado por outro motivo sem nenhum toque (desqualificado_sem_toque).',
        duas_reguas_de_contato: 'A tela mostra as DUAS e não escolhe. Régua de ETAPA = chegou a Tentativa+. Régua de ATIVIDADE REAL = ligação conectada OU e-mail enviado OU LinkedIn enviado (nota não conta). Medido em jul/26: 89,4% contra 46,7%, com 1.009 leads movidos para Tentativa sem UM toque no CRM. A premissa "teve que passar, senão não tem como" não se sustenta.',
        automacao_nao_e_esforco: 'Automação não é esforço do BDR: movimentação com source_type AUTOMATION_PLATFORM/INTEGRATION aparece como "Automação"/"Integração" no autor, nunca creditada a um BDR. Escala medida: 24% de TODAS as movimentações de etapa não têm autor humano (1.812 de 7.568 desde 01/07) — mas isso NÃO se distribui igual: em jul/26 as desqualificações foram 1.499 por CRM_UI e 1 por integração, ou seja a automação move lead ADIANTE (inscrição em sequência), quase nunca desqualifica. Ler os 24% como "um quarto das desqualificações é robô" seria errado.',
        dono_no_instante: 'Atribuição pelo dono NO INSTANTE do movimento (fact_owner_assignment), não pelo dono atual — em 184/184 casos rastreáveis a troca de dono veio DEPOIS do toque, então "dono atual" reescreve o passado.',
        toque_apos_criacao: 'CORREÇÃO de 11/08/2026: o toque só conta se for POSTERIOR à criação do lead. A régua liga toque→lead pelo CONTATO (fact_engagement não tem lead_id) e o contato tem vida anterior ao lead — sem o limite, "falou com" contava trabalho de outro ciclo, às vezes de outra pessoa. Efeito na coorte de ago/26 (258 leads): 210 → 191, ou seja 19 leads (9%) cuja única prova de contato era um toque anterior à existência do lead, o mais antigo de 18/07/2024. Por pessoa o efeito muda a leitura: Raina Cândido saía com 2 de 11 e o número real é 0; Allan Valença 31 → 25; Gabriele Almeida 5 → 4. Nos leads movimentados na janela o corte é 535 → 510. O toque anterior NÃO é jogado fora: vira o bucket toque_herdado e o campo toques_manuais_antes no drill.',
        trabalho_na_janela: 'A tabela tem DUAS réguas lado a lado e elas respondem perguntas diferentes. "Criaram/Falaram com" é COORTE — dos leads criados na janela, em quantos se falou — e é atribuída ao DONO do lead. "Trabalhou na janela" é o que a pessoa fez no período em leads de qualquer safra, atribuída a QUEM TOCOU (fact_engagement.owner_id). A segunda existe porque a primeira, no corte por pessoa, fazia a tela mentir por omissão: em ago/26 Gabriele Almeida aparecia com "criou 5, falou com 5" tendo tocado 41 leads com 64 toques, e Cíntia Rodrigues (35 leads/66 toques), Anderson Souza (12/27), Thauan Pontes (6/10) e Yokyko Muramoto (6/9) NÃO TINHAM LINHA na tabela, porque criaram zero e o GROUP BY não emite linha para zero. Atribuir por quem tocou não é detalhe: dos 1.585 toques de ago/26, 378 (24%) foram feitos por alguém diferente do dono atual do lead. Coorte é a régua certa para atributo de LEAD (porte, tier, vidas, origem); para PESSOA ela precisa da coluna de trabalho ao lado.',
        so_bdr_no_corte_de_gente: `A tabela chamada "BDR" listava TODO dono de lead, e dono de lead não é sinônimo de BDR: apareciam SuperAdmin (Aurilia Rodrigues, 613 leads), closers (Rafael Leite Ferreira, André Pontes, Beatriz Honorato), Placement e ex-BDR arquivado, rankeados junto com o time. O filtro "só BDRs" (ligado por padrão) usa três degraus: (1) roster canônico de lib/bdr-team.js; (2) BDR ATIVO do portal fora do roster — owner_role='BDR', não arquivado e SEM time de closer, hoje o caso da Raina Cândido com 137 leads, que excluir apagaria trabalho real; (3) o resto é não-BDR, com o papel NOMEADO (closer, Placement, BDR arquivado). owner_role sozinho não basta: o portal marca como BDR quem está no time "BDR (Prospecção / Pré-vendas)" mesmo estando TAMBÉM em "Executivos de Vendas (Closer)" — 4 pessoas hoje, e time de closer vence. Ninguém some: desligar o filtro devolve todo mundo, e a lista do que foi tirado está em coorte.conversao.fora_do_time.`,
        serie_por_coorte_de_criacao: `A linha do tempo indexa a coorte pelo período de CRIAÇÃO do lead, não pelo período em que a conversão aconteceu — é a mesma régua dos cards, com o eixo aberto. Duas consequências que MUDAM A LEITURA: (1) o ÚLTIMO bucket é sempre PARCIAL (declarado em serie.bucket_parcial e tracejado na tela): a coorte recente ainda está viva e ainda vai converter, então a queda no fim do gráfico é maturidade, não piora — ler como piora é o erro clássico de gráfico de coorte; (2) a taxa de um mês antigo é FINAL e não muda mais, então comparar mês fechado com mês fechado é legítimo, mas comparar qualquer um deles com o mês corrente não é. Granularidade adaptativa: semana ISO em janela de até ${GRAN_LIMITE_DIAS} dias, mês acima — semana em 936 dias daria 134 pontos ilegíveis e mês em 11 dias daria um ponto só, que não é série.`,
        filtro_de_campo_e_de_um_campo_so: 'O filtro por campo (BDR, colaboradores, tier, vidas, origem) recorta os cards, o funil e a linha do tempo somando a fatia daquela dimensão. Ele aceita UM campo por vez: o cruzamento entre dois campos (BDR X **e** porte 500+) NÃO existe nesta agregação, porque o GROUP BY sai por dimensão isolada — cruzar exigiria uma consulta por par e o custo não se paga. Quando o filtro está ativo numa dimensão e a tabela mostra outra, a tela AVISA em vez de fingir que a tabela seguiu o filtro.',
        conversao_por_coorte: `As taxas de conversão são de COORTE (leads criados na janela, seguidos até hoje) e ACUMULADAS: "chegou a Conectado+" significa que o lead visitou a etapa, não que esteja nela agora. Consequências que mudam leitura: (a) os passos encaixam por construção — todo Conectado+ é Tentativa+ — e a conversão do processo é o PRODUTO dos passos, não uma conta independente; (b) a coorte recente ainda está viva, então o fim da janela sempre converte menos que o começo, e comparar mês fechado com mês corrente subestima o corrente; (c) a régua NÃO é "movimentações no período" — essa infla ~4x porque conta o mesmo lead a cada toque. Denominador e numerador viajam em absoluto ao lado de cada taxa: 50% de 4 e 50% de 400 pedem decisões diferentes.`,
        roster_sempre_visivel: `Todos os ${BDR_TEAM.length} BDRs do roster canônico ganham linha, mesmo zerada, e a coluna roster marca quem é do time. Linha ausente é indistinguível de "não foi medido" e lê como "não fez nada"; linha em zero é uma afirmação verificável. Dono de lead fora do roster (hoje Placement com 7 criados, e BDR do portal fora do BDR_TEAM como Raina Cândido) aparece com roster=false em vez de ser creditado como BDR.`,
        motivo_desqualificacao: 'Existe no objeto Leads (17 valores). Preenchimento desigual: principal 99,2%, Backup 34,4%, DIAGNÓSTICO SITE 0,0% (1.056 desqualificados sem nenhum motivo). "(sem motivo)" no drill do Diagnóstico Site é o dado, não falha da tela.',
        tier_do_bronze: 'tier_colaboradores e numero_de_vidas são lidos de bronze.raw_contact porque NÃO estão projetados em dim_contact (10.946 e 10.591 no portal, 0 alcançáveis pelo silver). MEDIDA TEMPORÁRIA: a correção é a projeção no 10_silver.sql (F0).',
        tier_vidas_nao_existe: 'Não existe propriedade tier_vidas em nenhum objeto do portal. Qualquer faixa de vidas é DERIVAÇÃO, e as faixas não foram decididas.',
        waterfall_macro: 'O macro fecha por aritmetica: aberto@inicio + criados + reativados - qualificados - desqualificados = aberto@fim. ABERTO = novo+tentativa+conectado; qualificado e desqualificado sao SAIDAS do funil de prospeccao (qualificado vira deal, desqualificado morre) e contá-los no saldo aberto faria o funil so crescer. O que a aritmetica nao explica vira a barra `residuo`, exposta, nunca diluida nas outras.',
        etapa_num_instante: 'O saldo de abertura usa a etapa do lead em T0, derivada da ultima entrada de fact_stage_entry com entered_at <= T0 — dim_lead so sabe o AGORA. Metodo validado contra o snapshot: reproduz dim_lead em 18.294 de 18.296 leads.',
        janela_universal: 'O filtro de periodo vale para TODA a secao, e "Tudo" usa como piso a data do PRIMEIRO lead do recorte (MIN(hs_created_at)), nao uma data chumbada -- data chumbada envelhece em silencio e passa a cortar historico. `janela.origem` no payload diz de onde a janela veio: filtro, tudo, ou default do mes corrente.',
        agregacao_no_banco: 'A tabela de taxa e agregada por GROUP BY no BigQuery, nao no browser. A lista por lead vem CAPADA (3.000) e serve ao drill, nao a conta: os totais saem da agregacao e cobrem 100% da coorte mesmo com o detalhe truncado. Antes a tela recebia todos os leads e agregava no JS -- 15.558 leads e 15,79 MB na janela de 936 dias, acima do teto de resposta da Vercel, ou seja "Tudo" nao respondia.',
        tres_reguas_de_contato: 'MUDANÇA DE 12/08/2026, decisão do head de BDRs trazida pelo dono: discagem que NÃO conectou passa a contar como TENTATIVA DE CONTATO. Agora são três réguas empilhadas, e a distância entre elas é o achado. ESFORÇO = discou ou mandou mensagem ("a pessoa trabalhou este lead?"). ATIVIDADE REAL = mensagem enviada, ligação conectada ou reunião realizada ("chegou alguma coisa do outro lado?"). CONVERSA = ligação conectada, com duração ("alguém FALOU com o lead?"). Escala medida em 01/07–11/08: 9.365 ligações registradas contra 704 conectadas, ou seja 7,5% — os desfechos são Sem resposta 4.659, Ocupado 3.404, Deixou mensagem de voz 338, Número errado 69. Ler só "conectou" apaga 8.661 discagens de esforço real; ler só "discou" transforma lista de telefone ruim em produtividade. Por isso `numero_errado` viaja em campo próprio: telefone errado é problema de DADO (enriquecimento) e não de cadência, e as duas coisas pedem ações opostas. NOTA TÉCNICA: a flag `is_attempt` do armazém não é usada aqui — ela marca 5.196 e-mails de ENTRADA como tentativa e deixa de fora 1.908 discagens Sem resposta/Ocupado; a régua é escrita canal por canal no endpoint.',
        canal_em_vez_de_origem: 'A dimensão "Origem" sai de axenya_origem_canonica/origem_do_lead__fonte_ e está contaminada NA FONTE: 64% dos leads trazem o booleano "true" (9.930) ou "false" (1.055). Em vez de esconder, entrou a dimensão CANAL, que é uma cascata de evidências: origem declarada no lead → pipeline (Diagnóstico Site é entrada de site) → origem canônica do contato → source_detail do contato (Lusha/Apollo/planilha = outbound de lista) → analytics_source. Cobertura medida em 12/08/2026: 85% classificado contra 36% de origem legível. O bucket "(não identificado)" (15%) APARECE em vez de virar "outros". A dimensão "canal (macro)" agrupa em Outbound/Inbound/Evento/Indicação, porque pedir "só outbound" e ter de marcar duas caixas é como se mede metade do outbound sem perceber. A origem crua continua no payload para auditar a cascata.',
        vidas_do_armazem: 'A faixa de VIDAS passou a sair de dim_lead_context.company_lives_bucket (vidas_efetivas), que cobre 16.172 de 18.331 leads (88%). A régua anterior era numero_de_vidas do contato no bronze com fallback em dim_company.vidas e cobria 8.673 (47%) — quase metade. Os rótulos são os do armazém ("Fora ICP" para menos de 200 vidas, "200-1000", "1000-5000", "5000+"), não faixas inventadas aqui: renomear faria a tela e o mart dizerem coisas diferentes do mesmo lead. Onde as duas fontes existem e discordam são 522 leads, declarado em divergencias_conhecidas.vidas_fonte.',
        recorte: 'O filtro por campo vale para a SEÇÃO INTEIRA — cards, funil, linha do tempo, os dois waterfalls, snapshot, criados por dia e desqualificações — e é aplicado NO BANCO, não no browser. Ele é UM campo por vez, mas o CRUZAMENTO existe: com o recorte em "BDR = X", a tabela por tier mostra a distribuição de tier DAQUELE BDR, porque cada bloco sai marcado com dentro/fora do recorte no mesmo GROUP BY. Duas premissas que mudam número: (1) ATRIBUTO É O DE HOJE — se a empresa mudou de faixa de vidas depois do movimento, o movimento é reclassificado retroativamente; não existe histórico de atributo no armazém e fingir que existe seria pior que declarar; (2) BDR MUDA DE RÉGUA POR BLOCO, de propósito: no fluxo (waterfall e macro) é o dono NO INSTANTE do movimento, na coorte é o dono do lead criado, no snapshot é o dono ATUAL (é estado de agora) e em "trabalhou na janela" é QUEM TOCOU. Usar a mesma régua nos quatro faria pelo menos um deles responder a pergunta errada.',
        granularidade_escolhida: `A linha do tempo e o gráfico por período aceitam dia, semana ISO, mês e trimestre. O padrão é adaptativo (dia até 31 dias, semana até ${GRAN_LIMITE_DIAS}, mês até 550, trimestre acima) e a escolha manual vence — antes era só automático, e "últimos três meses" ficava preso em semana sem opção de ver por mês. A granularidade efetiva e a que o padrão teria escolhido viajam em granularidade.{escolhida,padrao}.`,
        criados_por_dia_sem_cap: 'CORREÇÃO de 12/08/2026: o gráfico "Criados e movimentados por dia" contava os criados a partir da lista do drill (capada em 1.500), então em janela longa ele desenhava menos de 10% da coorte com a forma errada e sem avisar. Agora os criados por dia saem de um GROUP BY próprio no BigQuery (serie.por_dimensao.__dia), que cobre 100% da coorte em qualquer janela.',
        defasagem: 'O armazém extrai às 06:30 e o close das 20:30 TAMBÉM extrai desde a correção da leva anterior — verificado em 12/08/2026: o run de 11/08 23:33 UTC capturou movimentações de lead até 20:03 BRT do mesmo dia, contra o comportamento antigo em que o dia inteiro ficava invisível. O que continua valendo: entre a extração das 06:30 e o horário em que a tela é aberta, o dia corrente está parcialmente vazio (medido às 08:48 de 12/08: 0 leads criados e 0 movimentações de etapa do próprio dia no armazém). Use o botão Atualizar para o dado de agora.',
      },
      divergencias_conhecidas: {
        preenchimento_dimensoes: 'vidas na empresa 6,9%, porte 11,4%, segmento 0,06%, employees 65,1%. Cortes por vidas/porte são majoritariamente "(sem valor)" e a tela mostra essa categoria em vez de esconder.',
        origem_contaminada: 'ACHADO EM 11/08/2026, NÃO CORRIGIDO AQUI: a dimensão "Origem" tem 10.876 de 16.887 leads (64%) com valor BOOLEANO — "true" 9.836 e "false" 1.040 — vindos de axenya_origem_canonica no objeto Leads. Não são categorias de origem; são lixo de mapeamento de propriedade no portal/ETL. O corte por Origem é, hoje, majoritariamente ILEGÍVEL, e "true" NÃO deve ser lido como uma origem. Consertar exige mexer na projeção do silver (fora do escopo desta tela) ou trocar a fonte por hs_object_source_detail_1 + detalhes_fonte. Declarado em vez de escondido: esconder faria o corte parecer análise.',
        lead_multi_contato: `Leads com mais de 1 contato ativo nesta janela: ${ativ.multiContato}. A régua de atividade usa ANY_VALUE do contato; com 1:1 (18.209 de 18.210) o efeito é nulo, mas não é zero por contrato.`,
        autor_join: 'updated_by_user_id casa com dim_owner.owner_id em 17/17 usuários medidos. É coincidência medida, não contrato do HubSpot — o id cru viaja no payload para auditoria.',
        trabalho_multi_owner_id: 'Em "Trabalhou na janela" os leads distintos são contados por owner_id e depois somados por nome canônico. BDR com dois owner_ids (Cíntia: 86900152 legado + 87213208 ativo) contaria duas vezes um lead tocado pelos dois ids. O id legado não tem linhas no BQ, então o efeito medido hoje é ZERO — mas não é zero por contrato.',
        trabalho_dono_diferente: `Em ago/26, ${trab.semDono.toques || 0} toques na janela vieram de engajamento sem owner_id (${trab.semDono.leads || 0} leads) e não são atribuíveis a ninguém. Eles entram no total do time e em nenhuma linha de pessoa — por isso a soma das linhas pode ficar abaixo do total.`,
        etapa_derivada_vs_dim: 'A etapa derivada de fact_stage_entry discorda de dim_lead em 2 de 18.296 leads (0,01%). Afeta o saldo do macro nessa ordem de grandeza e e parte do residuo declarado.',
        etapas_nao_mapeadas: `Movimentos com etapa fora do mapa canônico: ${wf.naoMapeadas}. Etapa nova no portal aparece como "(etapa não mapeada)" em vez de cair fora em silêncio.`,
        vidas_fonte: 'Vidas tem duas fontes no armazém e elas discordam em 522 leads: vidas_efetivas do dim_lead_context (16.172 leads) e numero_de_vidas do contato no bronze (8.673). A faixa usa a primeira, por cobertura e por ser a régua canônica do armazém; o valor da segunda continua no drill, para o caso divergente ser auditável em vez de sumir.',
        delecao_nao_propagada: 'O total do armazém e o total do portal batiam NA UNHA em 11/08/2026 (16.887 = 16.887) e em 12/08 abriram 2 (armazém 16.922, portal 16.920). A causa está medida e é do ETL, não da tela: o check deleted_objects_detected reporta 184 leads arquivados no portal, 6 deles ainda VIGENTES na dim_lead — a flag archived não propagou para o armazém. O sentido da diferença importa: armazém MAIOR que portal é deleção não propagada (tolerável e declarada); armazém MENOR seria perda de cobertura, e isso não é tolerável. O teste do endpoint trava esse sentido e um teto de 0,1%.',
        tier_duas_taxonomias: 'tier_colaboradores (bronze, valores tier-1/2/3/pme, 10.914 contatos) e dim_contact.outbound_tier (silver, valores T1/T2/T3/PME/A/B/C/D, 2.434) são propriedades DIFERENTES, não a mesma coisa em lugares diferentes: apenas ~20 contatos têm as duas preenchidas. A tela usa o bronze, que é o que o time preenche; trocar pela do silver mudaria o significado da coluna sem mudar o nome dela.',
      },
      diagnostics: {
        camadas: { snapshot: 'silver', waterfall: 'silver', coorte: 'silver+bronze', atividade: 'silver' },
        contradicoes_desqualificacao: {
          nota: 'Contagens que auditam o motivo declarado contra a atividade registrada.',
          motivo_diz_sem_tentativa_mas_teve_toque: desq.filter(d => d.contradiz_motivo).length,
          outro_motivo_e_nenhum_toque: desq.filter(d => d.desqualificado_sem_toque).length,
        },
      },
      extraido_em: new Date().toISOString(),
    };

    if (req.query.portal === '1') {
      try {
        const portal = await snapshotPortal(getHubspotToken(), pipes);
        const delta = {};
        Object.keys(portal).forEach(c => { delta[c] = { portal: portal[c], armazem: snap.porEtapa[c] || 0, delta: portal[c] - (snap.porEtapa[c] || 0) }; });
        payload.diagnostics.snapshot_vs_portal = {
          nota: 'Delta esperado > 0 é a defasagem da extração das 06:30, não defeito. O TOTAL deve bater.',
          por_etapa: delta,
          total_portal: Object.values(portal).reduce((a, b) => a + b, 0),
          total_armazem: Object.values(snap.porEtapa).reduce((a, b) => a + b, 0),
        };
      } catch (e) { payload.diagnostics.snapshot_vs_portal = { erro: String(e.message || e) }; }
    }

    _cache[cacheKey] = { at: Date.now(), data: payload };
    return res.status(200).json(payload);
  } catch (e) {
    console.error('[bdr-lead-funnel]', e);
    return res.status(500).json({ success: false, error: String(e.message || e) });
  }
};
