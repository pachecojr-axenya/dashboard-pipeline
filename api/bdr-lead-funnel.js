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
const whq = require('../lib/hubspot-wh-queries');
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
const CANON_PT = {
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

let _cache = {};
const CACHE_TTL = 5 * 60 * 1000;

function sqlList(ids) {
  return ids.filter(id => /^[A-Za-z0-9_-]+$/.test(String(id))).map(id => `'${id}'`).join(',');
}

/**
 * Snapshot: leads por etapa canônica AGORA. Sai de `dim_lead` (silver) porque
 * snapshot é ESTADO, não série — mart aqui só adicionaria defasagem sem ganho.
 */
async function snapshot(pipes) {
  const { rows } = await wh.query(`
    SELECT pipeline_id, stage_id, COUNT(*) AS n
    FROM ${wh.t('silver', 'dim_lead')}
    WHERE is_current AND pipeline_id IN (${sqlList(pipes)})
    GROUP BY 1, 2
  `);
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
async function waterfall(pipes, since, until) {
  const pipeSet = new Set(pipes);
  const { rows } = await wh.query(`
    WITH mov AS (
      SELECT ch.object_id AS lead_id, ch.old_value, ch.new_value, ch.changed_at,
             ch.source_type, ch.updated_by_user_id
      FROM ${wh.t('silver', 'fact_crm_change')} ch
      WHERE ch.object_type = 'lead' AND ch.property = 'hs_pipeline_stage'
        AND DATE(ch.changed_at, 'America/Sao_Paulo') BETWEEN DATE(@since) AND DATE(@until)
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
           d.source_type, d.updated_by_user_id, d.owner_no_instante,
           l.motivo_desqualificacao, l.origem_canonica, l.origem_fonte, l.lead_name,
           cp.company_id, cp.company_name, cp.employees, cp.porte, cp.vidas AS vidas_empresa
    FROM com_dono d
    LEFT JOIN ${wh.t('silver', 'dim_lead')} l ON l.lead_id = d.lead_id AND l.is_current
    LEFT JOIN (
      SELECT from_id AS lead_id, ANY_VALUE(to_id) AS company_id
      FROM ${wh.t('silver', 'bridge_association')}
      WHERE from_object = 'lead' AND to_object = 'company' AND is_active
      GROUP BY 1
    ) lc ON lc.lead_id = d.lead_id
    LEFT JOIN ${wh.t('silver', 'dim_company')} cp
      ON cp.company_id = lc.company_id AND cp.is_current
  `, [
    { name: 'since', type: 'DATE', value: since },
    { name: 'until', type: 'DATE', value: until },
  ]);

  const setas = {};
  const porDia = {};
  const desq = [];
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

  return { setas, porDia, desq, descartadasBackup, naoMapeadas, movimentos: rows.length };
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
async function coorte(pipes, since, until) {
  const { rows } = await wh.query(`
    WITH base AS (
      SELECT l.lead_id, l.lead_name, l.owner_id, l.pipeline_id, l.stage_id,
             l.motivo_desqualificacao, l.origem_canonica, l.origem_fonte,
             DATE(l.hs_created_at, 'America/Sao_Paulo') AS criado
      FROM ${wh.t('silver', 'dim_lead')} l
      WHERE l.is_current AND l.pipeline_id IN (${sqlList(pipes)})
        AND DATE(l.hs_created_at, 'America/Sao_Paulo') BETWEEN DATE(@since) AND DATE(@until)
    ),
    -- lead -> contato (1:1) e lead -> empresa
    l2c AS (
      SELECT from_id AS lead_id, ANY_VALUE(to_id) AS contact_id, COUNT(DISTINCT to_id) AS n_contatos
      FROM ${wh.t('silver', 'bridge_association')}
      WHERE from_object = 'lead' AND to_object = 'contact' AND is_active GROUP BY 1
    ),
    l2co AS (
      SELECT from_id AS lead_id, ANY_VALUE(to_id) AS company_id
      FROM ${wh.t('silver', 'bridge_association')}
      WHERE from_object = 'lead' AND to_object = 'company' AND is_active GROUP BY 1
    ),
    l2d AS (
      SELECT from_id AS lead_id, ANY_VALUE(to_id) AS deal_id, MIN(first_seen_at) AS assoc_em
      FROM ${wh.t('silver', 'bridge_association')}
      WHERE from_object = 'lead' AND to_object = 'deal' GROUP BY 1
    ),
    -- RÉGUA A: passagem de ETAPA. Maior etapa canônica já visitada.
    etapas AS (
      SELECT se.object_id AS lead_id,
             ARRAY_AGG(DISTINCT se.stage_id IGNORE NULLS) AS visitadas
      FROM ${wh.t('silver', 'fact_stage_entry')} se
      WHERE se.object_type = 'lead'
      GROUP BY 1
    ),
    -- RÉGUA B: ATIVIDADE REAL. Ligação conectada, e-mail enviado ou LinkedIn enviado.
    -- Nota NÃO conta (decisão de 10/08: "nota não é ação, e-mail é").
    ativ AS (
      SELECT c.lead_id,
             COUNTIF(e.is_connected) AS ligacoes_conectadas,
             COUNTIF(e.kind = 'emails' AND e.is_outbound_message) AS emails_enviados,
             COUNTIF(e.channel_type = 'LINKEDIN_MESSAGE') AS linkedin_enviados,
             MIN(e.occurred_at) AS primeiro_toque
      FROM l2c c
      JOIN ${wh.t('silver', 'fact_engagement')} e ON e.contact_id = c.contact_id
      WHERE e.is_connected
         OR (e.kind = 'emails' AND e.is_outbound_message)
         OR e.channel_type = 'LINKEDIN_MESSAGE'
      GROUP BY 1
    ),
    -- Tier vem do BRONZE: não está projetado em dim_contact (F0 conserta).
    tier AS (
      SELECT object_id AS contact_id,
             JSON_VALUE(payload, '$.tier_colaboradores') AS tier_colaboradores,
             SAFE_CAST(JSON_VALUE(payload, '$.numero_de_vidas') AS FLOAT64) AS vidas_contato
      FROM ${wh.t('bronze', 'raw_contact')}
    )
    SELECT b.*, l2c.n_contatos, l2d.deal_id,
           cp.company_id, cp.company_name, cp.employees, cp.porte, cp.vidas AS vidas_empresa,
           e.visitadas,
           IFNULL(a.ligacoes_conectadas, 0) AS ligacoes_conectadas,
           IFNULL(a.emails_enviados, 0)     AS emails_enviados,
           IFNULL(a.linkedin_enviados, 0)   AS linkedin_enviados,
           tr.tier_colaboradores, tr.vidas_contato,
           d.stage_label AS deal_stage, d.pipeline_id AS deal_pipeline
    FROM base b
    LEFT JOIN l2c   ON l2c.lead_id = b.lead_id
    LEFT JOIN l2co  ON l2co.lead_id = b.lead_id
    LEFT JOIN l2d   ON l2d.lead_id = b.lead_id
    LEFT JOIN ${wh.t('silver', 'dim_company')} cp ON cp.company_id = l2co.company_id AND cp.is_current
    LEFT JOIN etapas e ON e.lead_id = b.lead_id
    LEFT JOIN ativ   a ON a.lead_id = b.lead_id
    LEFT JOIN tier  tr ON tr.contact_id = l2c.contact_id
    LEFT JOIN ${wh.t('silver', 'dim_deal')} d ON d.deal_id = l2d.deal_id AND d.is_current
  `, [
    { name: 'since', type: 'DATE', value: since },
    { name: 'until', type: 'DATE', value: until },
  ]);

  let multiContato = 0;
  const leads = rows.map(r => {
    const visitadas = (r.visitadas || []).map(canon);
    const maxRank = visitadas.reduce((m, c) => (RANK[c] != null && RANK[c] > m ? RANK[c] : m), 0);
    const lig = wh.num(r.ligacoes_conectadas);
    const eml = wh.num(r.emails_enviados);
    const li  = wh.num(r.linkedin_enviados);
    if (wh.num(r.n_contatos) > 1) multiContato++;
    return {
      lead_id: wh.str(r.lead_id),
      lead: wh.str(r.lead_name),
      criado: wh.str(r.criado),
      pipeline: wh.str(r.pipeline_id),
      etapa: canon(r.stage_id),
      owner_id: wh.str(r.owner_id),
      // RÉGUA A — passou de etapa
      atingiu_tentativa_etapa: maxRank >= RANK.tentativa,
      atingiu_conectado_etapa: maxRank >= RANK.conectado,
      qualificado: visitadas.includes('qualificado'),
      desqualificado: visitadas.includes('desqualificado') || canon(r.stage_id) === 'desqualificado',
      // RÉGUA B — atividade real
      atividade_real: lig + eml + li > 0,
      ligacoes_conectadas: lig, emails_enviados: eml, linkedin_enviados: li,
      // conversão
      deal_id: wh.str(r.deal_id),
      deal_stage: wh.str(r.deal_stage),
      // dimensões
      empresa_id: wh.str(r.company_id),
      empresa: wh.str(r.company_name),
      colaboradores: r.employees == null ? null : Number(r.employees),
      porte: wh.str(r.porte),
      vidas: r.vidas_contato != null ? Number(r.vidas_contato)
           : (r.vidas_empresa != null ? Number(r.vidas_empresa) : null),
      tier_colaboradores: wh.str(r.tier_colaboradores),
      motivo: wh.str(r.motivo_desqualificacao),
      origem: wh.str(r.origem_canonica) || wh.str(r.origem_fonte) || '(sem origem)',
    };
  });
  return { leads, multiContato };
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
  const since = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.since))
    ? String(req.query.since) : until.slice(0, 8) + '01';

  const cacheKey = `${funilKey}|${since}|${until}`;
  if (_cache[cacheKey] && Date.now() - _cache[cacheKey].at < CACHE_TTL && req.query.refresh !== '1') {
    return res.status(200).json({ ..._cache[cacheKey].data, cache: true });
  }

  try {
    const [snap, wf, co, owners] = await Promise.all([
      snapshot(pipes),
      waterfall(pipes, since, until),
      coorte(pipes, since, until),
      whq.ownerMap(),
    ]);

    const idToBdr = resolveTeamIds(owners);

    // Nome do dono e do autor. Autor: `updated_by_user_id` casa com
    // `dim_owner.owner_id` em 17/17 hoje — coincidência medida, não contrato, e por
    // isso o id cru também viaja no payload.
    const nome = id => (id && owners[id]) || null;

    const desq = wf.desq.map(d => ({
      ...d,
      bdr: idToBdr[d.owner_id] || nome(d.owner_id) || '(sem dono)',
      autor: d.source_type === 'AUTOMATION_PLATFORM' ? 'Automação'
           : d.source_type === 'INTEGRATION' ? 'Integração'
           : (idToBdr[d.autor_user_id] || nome(d.autor_user_id) || '(autor desconhecido)'),
      automacao: d.source_type === 'AUTOMATION_PLATFORM' || d.source_type === 'INTEGRATION',
    }));

    const leads = co.leads.map(l => ({ ...l, bdr: idToBdr[l.owner_id] || nome(l.owner_id) || '(sem dono)' }));

    // As duas réguas, agregadas — o gap é publicado, não escondido.
    const n = leads.length;
    const porEtapa = leads.filter(l => l.atingiu_tentativa_etapa).length;
    const porAtividade = leads.filter(l => l.atividade_real).length;

    const payload = {
      success: true,
      janela: { since, until, funil: funilKey, pipelines: pipes },
      snapshot: { camada: 'silver', tabela: 'dim_lead', por_etapa: snap.porEtapa, etapas_nao_mapeadas: snap.naoMapeadas },
      waterfall: {
        camada: 'silver', tabela: 'fact_crm_change + fact_owner_assignment',
        setas: wf.setas, por_dia: wf.porDia, movimentos: wf.movimentos,
      },
      coorte: {
        camada: 'silver', tabela: 'dim_lead + fact_stage_entry + fact_engagement + bronze.raw_contact',
        leads,
        criados: n,
        taxa_contato: {
          por_etapa:      { n: porEtapa,      pct: n ? +(porEtapa / n * 100).toFixed(1) : null },
          por_atividade:  { n: porAtividade,  pct: n ? +(porAtividade / n * 100).toFixed(1) : null },
          etapa_sem_atividade: leads.filter(l => l.atingiu_tentativa_etapa && !l.atividade_real).length,
          atividade_sem_etapa: leads.filter(l => !l.atingiu_tentativa_etapa && l.atividade_real).length,
        },
        qualificados: leads.filter(l => l.qualificado).length,
        com_deal: leads.filter(l => l.deal_id).length,
      },
      desqualificacoes: desq,
      ordem_funil: FUNNEL_ORDER,
      rotulos: CANON_PT,
      premissas: {
        objeto: 'Objeto Leads nativo (0-136). NÃO é hs_lead_status no contato — em jul/26 o contato via 234 criados contra 2.302 leads, ~10% do funil. hs_lead_status está abandonado (90,6% preso em NEW).',
        quebra_de_serie: 'O funil sai de ~234 contatos para ~2.302 leads no mês. NÃO é ganho de produtividade de 10x: é outro objeto. Comparação com qualquer print anterior a 11/08/2026 é inválida.',
        pipeline_do_evento: 'Etapa contada no pipeline REGISTRADO NO EVENTO (derivado do stage_id, único por pipeline), nunca no pipeline atual do lead. 1.456 leads trocaram de pipeline; pelo atual, o New/Tentativa reais deles desapareceriam do funil principal.',
        backup_excluido: `Pipeline Backup (${PIPE_BACKUP}) fora do recorte por decisão do dono; parou de receber lead em 09/04/2026. Movimentos descartados nesta janela: ${wf.descartadasBackup}.`,
        stage_canon: 'Etapa canônica por mapa EXPLÍCITO de stage_id. stage_order NÃO é comparável entre pipelines (principal 0–4, Diagnóstico Site 1–5).',
        duas_reguas_de_contato: 'A tela mostra as DUAS e não escolhe. Régua de ETAPA = chegou a Tentativa+. Régua de ATIVIDADE REAL = ligação conectada OU e-mail enviado OU LinkedIn enviado (nota não conta). Medido em jul/26: 89,4% contra 46,7%, com 1.009 leads movidos para Tentativa sem UM toque no CRM. A premissa "teve que passar, senão não tem como" não se sustenta.',
        automacao_nao_e_esforco: 'Automação não é esforço do BDR: movimentação com source_type AUTOMATION_PLATFORM/INTEGRATION aparece como "Automação"/"Integração" no autor, nunca creditada a um BDR. Escala medida: 24% de TODAS as movimentações de etapa não têm autor humano (1.812 de 7.568 desde 01/07) — mas isso NÃO se distribui igual: em jul/26 as desqualificações foram 1.499 por CRM_UI e 1 por integração, ou seja a automação move lead ADIANTE (inscrição em sequência), quase nunca desqualifica. Ler os 24% como "um quarto das desqualificações é robô" seria errado.',
        dono_no_instante: 'Atribuição pelo dono NO INSTANTE do movimento (fact_owner_assignment), não pelo dono atual — em 184/184 casos rastreáveis a troca de dono veio DEPOIS do toque, então "dono atual" reescreve o passado.',
        motivo_desqualificacao: 'Existe no objeto Leads (17 valores). Preenchimento desigual: principal 99,2%, Backup 34,4%, DIAGNÓSTICO SITE 0,0% (1.056 desqualificados sem nenhum motivo). "(sem motivo)" no drill do Diagnóstico Site é o dado, não falha da tela.',
        tier_do_bronze: 'tier_colaboradores e numero_de_vidas são lidos de bronze.raw_contact porque NÃO estão projetados em dim_contact (10.946 e 10.591 no portal, 0 alcançáveis pelo silver). MEDIDA TEMPORÁRIA: a correção é a projeção no 10_silver.sql (F0).',
        tier_vidas_nao_existe: 'Não existe propriedade tier_vidas em nenhum objeto do portal. Qualquer faixa de vidas é DERIVAÇÃO, e as faixas não foram decididas.',
        defasagem: 'O armazém extrai às 06:30. O close das 20:30 NÃO extrai, então movimentações do dia corrente podem faltar — medido em 11/08: ~96 desqualificações de uma manhã ausentes. Use o botão Atualizar para o dado de agora.',
      },
      divergencias_conhecidas: {
        preenchimento_dimensoes: 'vidas na empresa 6,9%, porte 11,4%, segmento 0,06%, employees 65,1%. Cortes por vidas/porte são majoritariamente "(sem valor)" e a tela mostra essa categoria em vez de esconder.',
        lead_multi_contato: `Leads com mais de 1 contato ativo nesta janela: ${co.multiContato}. A régua de atividade usa ANY_VALUE do contato; com 1:1 (18.209 de 18.210) o efeito é nulo, mas não é zero por contrato.`,
        autor_join: 'updated_by_user_id casa com dim_owner.owner_id em 17/17 usuários medidos. É coincidência medida, não contrato do HubSpot — o id cru viaja no payload para auditoria.',
        etapas_nao_mapeadas: `Movimentos com etapa fora do mapa canônico: ${wf.naoMapeadas}. Etapa nova no portal aparece como "(etapa não mapeada)" em vez de cair fora em silêncio.`,
      },
      diagnostics: { camadas: { snapshot: 'silver', waterfall: 'silver', coorte: 'silver+bronze' } },
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
