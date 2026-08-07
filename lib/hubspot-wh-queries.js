'use strict';
/**
 * lib/hubspot-wh-queries.js — as leituras que saíram da API do HubSpot.
 *
 * Cada função aqui substitui uma chamada de lib/hubspot.js e devolve o MESMO
 * shape que o endpoint já devolvia. O contrato do front é intocado de propósito:
 * migração que muda o payload não é migração, é reescrita — e aí não há como
 * comparar com a versão antiga.
 *
 * Ver o princípio e a ressalva dos tickets em lib/hubspot-warehouse.js.
 */

const wh = require('./hubspot-warehouse');

// Tipos de toque que o feed de atividades mostra hoje, com o rótulo que o front
// espera. `communications` (WhatsApp/LinkedIn) e `tasks` EXISTEM no armazém e
// são contato real, mas entram só sob pedido explícito: incluí-los por padrão
// mudaria o que o modal mostra, e isso é decisão de produto, não de migração.
const FEED_KINDS = [
  ['notes', 'Note'],
  ['emails', 'Email'],
  ['calls', 'Call'],
  ['meetings', 'Meeting'],
];
const FEED_KINDS_EXTRA = [
  ['communications', 'Message'],
  ['tasks', 'Task'],
];

const FEED_LIMIT = 20; // mesmo teto do _fetchEngagements da API

function labelMap(incluirExtras) {
  const pares = incluirExtras ? [...FEED_KINDS, ...FEED_KINDS_EXTRA] : FEED_KINDS;
  return new Map(pares);
}

// Corpo do toque. Vive em `props` porque só o feed lê — ver ENGAGEMENT_BODY_PROP
// em hubspot_platform/config.py. JSON_VALUE exige caminho literal, então é um
// COALESCE explícito: cada tipo preenche exatamente um destes.
const BODY_SQL = `COALESCE(
    JSON_VALUE(props, '$.hs_note_body'),
    JSON_VALUE(props, '$.hs_email_text'),
    JSON_VALUE(props, '$.hs_call_body'),
    JSON_VALUE(props, '$.hs_meeting_body'),
    JSON_VALUE(props, '$.hs_task_body')
  )`;

/** Mesma limpeza que a versão da API fazia no browser: HTML fora, 300 chars. */
function limpaCorpo(raw) {
  if (!raw) return '';
  let body = String(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (body.length > 300) body = body.substring(0, 300) + '…';
  return body;
}

/**
 * Atividades de uma empresa ou de um deal.
 * Substitui fetchCompanyActivities / fetchDealActivities.
 * @param {'company'|'deal'} escopo
 */
async function activities(escopo, hsId, { extras = false } = {}) {
  const coluna = escopo === 'company' ? 'company_id' : 'deal_id';
  const rotulos = labelMap(extras);
  const kinds = [...rotulos.keys()].map((k) => `'${k}'`).join(', ');

  const sql = `
    SELECT kind, occurred_at, owner_name, subject, ${BODY_SQL} AS body
    FROM ${wh.t('silver', 'fact_engagement')}
    WHERE ${coluna} = @hsId
      AND kind IN (${kinds})
      AND occurred_at IS NOT NULL
    ORDER BY occurred_at DESC
    LIMIT ${FEED_LIMIT}
  `;
  const { rows } = await wh.query(sql, [{ name: 'hsId', type: 'STRING', value: String(hsId) }]);

  return rows.map((r) => {
    const ts = wh.timestamp(r.occurred_at);
    return {
      type: rotulos.get(String(r.kind)) || String(r.kind),
      timestamp: ts,
      date: ts ? ts.substring(0, 10) : null,
      owner: wh.str(r.owner_name),
      title: wh.str(r.subject) || '',
      body: limpaCorpo(r.body),
    };
  });
}

/**
 * Deals de uma empresa. Substitui fetchCompanyDeals.
 *
 * A ponte é `bridge_association`, e é simétrica: a API antiga só via a direção
 * companies→deals que ela pedia, e associação registrada na direção oposta ficava
 * invisível. Aqui vale qualquer uma das duas.
 *
 * Três campos da versão antiga NÃO existem no armazém (`vigencia`,
 * `data_de_renovacao`, `notes_last_updated`): não estão no `curated` do deal.
 * Vêm como null e o chamador é avisado por `campos_ausentes` — devolver null
 * calado é como uma coluna de renovação passa a mostrar vazio para todo mundo.
 */
const COMPANY_DEALS_MISSING = ['vigencia', 'data_de_renovacao', 'notes_last_updated'];

async function companyDeals(companyId) {
  const sql = `
    WITH ids AS (
      SELECT DISTINCT
        IF(from_object = 'deal', from_id, to_id) AS deal_id
      FROM ${wh.t('silver', 'bridge_association')}
      WHERE is_active
        AND (
          (from_object = 'company' AND from_id = @cid AND to_object = 'deal')
          OR (to_object = 'company' AND to_id = @cid AND from_object = 'deal')
        )
    )
    SELECT
      d.deal_id, d.deal_name, d.stage_id, d.pipeline_id, d.amount, d.vidas,
      d.premio_mensal, d.owner_id, d.close_date, d.hs_created_at, d.hs_updated_at,
      d.is_won_cur, d.is_lost_cur, d.sdr, d.stage_label, d.pipeline_label,
      o.full_name AS owner_name
    FROM ${wh.t('silver', 'dim_deal')} d
    JOIN ids USING (deal_id)
    LEFT JOIN ${wh.t('silver', 'dim_owner')} o
      ON o.owner_id = d.owner_id AND o.is_current
    WHERE d.is_current
    ORDER BY d.hs_created_at DESC
  `;
  const { rows } = await wh.query(sql, [{ name: 'cid', type: 'STRING', value: String(companyId) }]);

  return rows.map((r) => ({
    hs_object_id: wh.str(r.deal_id),
    dealname: wh.str(r.deal_name),
    dealstage: wh.str(r.stage_id),
    pipeline: wh.str(r.pipeline_id),
    amount: r.amount == null ? null : String(r.amount),
    vidas: r.vidas == null ? null : String(r.vidas),
    premio_mensal: r.premio_mensal == null ? null : String(r.premio_mensal),
    hubspot_owner_id: wh.str(r.owner_id),
    closedate: wh.timestamp(r.close_date),
    createdate: wh.timestamp(r.hs_created_at),
    hs_lastmodifieddate: wh.timestamp(r.hs_updated_at),
    hs_is_closed_won: String(r.is_won_cur === true || String(r.is_won_cur) === 'true'),
    hs_is_closed_lost: String(r.is_lost_cur === true || String(r.is_lost_cur) === 'true'),
    sdr: wh.str(r.sdr),
    // Ausentes no armazém — ver COMPANY_DEALS_MISSING.
    vigencia: null,
    data_de_renovacao: null,
    notes_last_updated: null,
    // Extras que a versão da API não tinha e o armazém dá de graça.
    stage_label: wh.str(r.stage_label),
    pipeline_label: wh.str(r.pipeline_label),
    ownerName: wh.str(r.owner_name) || wh.str(r.owner_id) || '-',
  }));
}

/**
 * Histórico da probabilidade informada pelo AE. Substitui a chamada
 * propertiesWithHistory por deal.
 *
 * `probabilidade_de_fechamento_` passou a ser rastreada em 07/08/2026 e o
 * histórico é RETROATIVO desde 03/2025 (2.401 mudanças) — `propertiesWithHistory`
 * devolve a série completa desde a criação do objeto, então rastrear hoje
 * recupera o passado. `hs_deal_stage_probability` continua de fora: chega com
 * sourceType=CALCULATED e não é decisão de ninguém.
 *
 * Vem de brinde o campo em que o AE escreve O MOTIVO da mudança, casado por data
 * — é literalmente o "contar a história da conta" que o endpoint existe para
 * fazer, e a versão da API não trazia.
 */
async function dealProbHistory(dealId) {
  const sql = `
    WITH prob AS (
      SELECT new_value, changed_at, source_type
      FROM ${wh.t('silver', 'fact_crm_change')}
      WHERE object_type = 'deal' AND object_id = @id
        AND property = 'probabilidade_de_fechamento_'
    ),
    motivo AS (
      SELECT new_value AS texto, changed_at
      FROM ${wh.t('silver', 'fact_crm_change')}
      WHERE object_type = 'deal' AND object_id = @id
        AND property = 'descreva_o_que_gerou_a_mudanca_de_probabilidade'
    ),
    -- LEFT JOIN + ROW_NUMBER em vez de subconsulta correlacionada: o BigQuery
    -- recusa correlação que referencia outra tabela e não dá para de-correlacionar.
    casado AS (
      SELECT p.new_value, p.changed_at, p.source_type, m.texto AS motivo,
             ROW_NUMBER() OVER (
               PARTITION BY p.changed_at, p.new_value
               ORDER BY ABS(TIMESTAMP_DIFF(m.changed_at, p.changed_at, SECOND))
             ) AS rn
      FROM prob p
      LEFT JOIN motivo m
        ON ABS(TIMESTAMP_DIFF(m.changed_at, p.changed_at, MINUTE)) <= 5
    )
    SELECT new_value, changed_at, source_type, motivo
    FROM casado
    WHERE rn = 1
    ORDER BY changed_at DESC
  `;
  const { rows } = await wh.query(sql, [{ name: 'id', type: 'STRING', value: String(dealId) }]);

  const timeline = rows.map((r) => ({
    value: normalizeProb(r.new_value),
    date: (wh.timestamp(r.changed_at) || '').substring(0, 10) || null,
    source: wh.str(r.source_type),
    motivo: wh.str(r.motivo),
  }));
  // Mesmo colapso da versão antiga: re-save sem mudança real de valor é ruído.
  return timeline.filter((e, i) => i === 0 || e.value !== timeline[i - 1].value);
}

// Mesma normalização do forecast-table.js: a propriedade vem ora 0-1, ora 0-100.
function normalizeProb(val) {
  const n = parseFloat(val);
  if (Number.isNaN(n) || n < 0) return null;
  return n > 1 ? n / 100 : n;
}


/**
 * Tickets do Pipeline de Cotação. Substitui fetchCotacaoTickets.
 *
 * RESSALVA QUE NÃO SE ESCONDE: só este pipeline (847948895, 187 tickets) está no
 * armazém. Os outros 18 pipelines — 109.013 tickets — NÃO estão. Este endpoint
 * sempre foi só de Cotação, então a migração é completa PARA ELE; qualquer tela
 * que precise dos demais pipelines tem de continuar na API.
 *
 * As propriedades por etapa (`hs_date_entered_<id>` / `hs_date_exited_<id>`) são
 * remontadas de `fact_stage_entry`. Elas não são desmontáveis em SQL — JSON_VALUE
 * exige caminho literal e o id da etapa entra no NOME da propriedade (armadilha
 * A8) — então quem normaliza é a extração, e quem re-monta o formato antigo é
 * este código, para o front não mudar.
 */
async function cotacaoTickets() {
  const sql = `
    WITH t AS (
      SELECT d.ticket_id, d.subject, d.category, d.source_type, d.source_detail,
             d.vidas, d.time_to_close_ms, d.closed_at, d.owner_id, d.priority,
             d.pipeline_id, d.stage_id, d.stage_label, d.hs_created_at, d.hs_updated_at,
             JSON_VALUE(r.payload, '$.content') AS content
      FROM ${wh.t('silver', 'dim_ticket')} d
      LEFT JOIN ${wh.t('bronze', 'raw_ticket')} r ON r.object_id = d.ticket_id
      WHERE d.is_current AND d.pipeline_id = @pipe
    ),
    etapas AS (
      SELECT object_id AS ticket_id,
             ARRAY_AGG(STRUCT(stage_id, entered_at, exited_at) ORDER BY entered_at) AS marcos
      FROM ${wh.t('silver', 'fact_stage_entry')}
      WHERE object_type = 'ticket' AND pipeline_id = @pipe
      GROUP BY object_id
    ),
    empresas AS (
      -- ORDER BY explícito: ARRAY_AGG sem ordem é NÃO-DETERMINÍSTICO, e como
      -- _companyName é o elemento [0], a "empresa principal" do ticket mudava de
      -- execução para execução. Pego numa comparação de 187 tickets: 1 ticket
      -- com 3 empresas associadas trocava de nome sozinho.
      SELECT ticket_id,
             ARRAY_AGG(company_id ORDER BY visto_em, company_id) AS company_ids
      FROM (
        SELECT
          IF(from_object = 'ticket', from_id, to_id) AS ticket_id,
          IF(from_object = 'company', from_id, to_id) AS company_id,
          MIN(first_seen_at) AS visto_em
        FROM ${wh.t('silver', 'bridge_association')}
        WHERE is_active
          AND ((from_object = 'ticket' AND to_object = 'company')
            OR (from_object = 'company' AND to_object = 'ticket'))
        GROUP BY 1, 2
      )
      GROUP BY ticket_id
    )
    SELECT t.*, e.marcos, c.company_ids, o.full_name AS owner_name
    FROM t
    LEFT JOIN etapas e USING (ticket_id)
    LEFT JOIN empresas c USING (ticket_id)
    LEFT JOIN ${wh.t('silver', 'dim_owner')} o ON o.owner_id = t.owner_id AND o.is_current
    ORDER BY t.hs_created_at DESC
  `;
  const { rows } = await wh.query(sql, [
    { name: 'pipe', type: 'STRING', value: wh.COTACAO_PIPELINE_ID },
  ]);

  // Nomes de empresa: uma consulta só, para todos os ids vistos.
  const todosIds = [...new Set(rows.flatMap((r) => r.company_ids || []).filter(Boolean).map(String))];
  const companyNames = {};
  if (todosIds.length) {
    const lista = todosIds.filter((id) => /^\d+$/.test(id)).map((id) => `'${id}'`).join(',');
    if (lista) {
      const { rows: cn } = await wh.query(`
        SELECT company_id, company_name
        FROM ${wh.t('silver', 'dim_company')}
        WHERE is_current AND company_id IN (${lista})
      `);
      cn.forEach((c) => { companyNames[String(c.company_id)] = wh.str(c.company_name) || 'Unknown'; });
    }
  }
  todosIds.forEach((id) => { if (!companyNames[id]) companyNames[id] = 'Unknown'; });

  const companyAssoc = {};
  const tickets = rows.map((r) => {
    const tid = wh.str(r.ticket_id);
    const compIds = (r.company_ids || []).filter(Boolean).map(String);
    if (compIds.length) companyAssoc[tid] = compIds;

    const t = {
      hs_object_id: tid,
      subject: wh.str(r.subject),
      content: wh.str(r.content),
      hs_pipeline: wh.str(r.pipeline_id),
      hs_pipeline_stage: wh.str(r.stage_id),
      hs_ticket_priority: wh.str(r.priority),
      hs_ticket_category: wh.str(r.category),
      hubspot_owner_id: wh.str(r.owner_id),
      createdate: wh.timestamp(r.hs_created_at),
      closed_date: wh.timestamp(r.closed_at),
      hs_lastmodifieddate: wh.timestamp(r.hs_updated_at),
      source_type: wh.str(r.source_type),
      hs_num_associated_companies: String(compIds.length),
      comercial_vidas: r.vidas == null ? null : String(r.vidas),
      _id: tid,
      _companyIds: compIds,
      _companyNames: compIds.map((id) => companyNames[id] || 'Unknown'),
      // Primeira empresa COM NOME, não simplesmente a primeira: ticket com 3
      // associações em que só uma está no armazém mostrava "Unknown" tendo o nome
      // real ao lado. A ordem da API é a de criação da associação, que o armazém
      // não guarda — então este campo pode escolher outra empresa que a versão
      // antiga em ticket multi-empresa. Medido: 1 de 187.
      _companyName: compIds.length
        ? (compIds.map((id) => companyNames[id]).find((n) => n && n !== 'Unknown')
           || companyNames[compIds[0]] || 'Unknown')
        : null,
      stage_label: wh.str(r.stage_label),
      ownerName: wh.str(r.owner_name) || wh.str(r.owner_id) || '-',
    };
    // Remonta as props por etapa no formato que o front já lê.
    (r.marcos || []).forEach((m) => {
      const sid = wh.str(m.stage_id);
      if (!sid) return;
      const ent = wh.timestamp(m.entered_at);
      const sai = wh.timestamp(m.exited_at);
      // Re-entrada: fica a PRIMEIRA entrada e a ÚLTIMA saída, que é o que a
      // propriedade nativa do HubSpot guarda.
      if (ent && !t['hs_date_entered_' + sid]) t['hs_date_entered_' + sid] = ent;
      if (sai) t['hs_date_exited_' + sid] = sai;
    });
    return t;
  });

  return { tickets, companyAssoc, companyNames };
}


/**
 * Mapa `owner_id -> nome` de TODOS os donos, arquivados incluídos.
 * Substitui a paginação dupla de /crm/v3/owners (archived=false e =true).
 * `dim_owner` tem 187 donos onde `fetchOwners` devolvia 54.
 */
async function ownerMap() {
  const { rows } = await wh.query(`
    SELECT owner_id, full_name, email
    FROM ${wh.t('silver', 'dim_owner')}
    WHERE is_current
  `);
  const map = {};
  rows.forEach((r) => {
    const id = wh.str(r.owner_id);
    if (id) map[id] = wh.str(r.full_name) || wh.str(r.email) || id;
  });
  return map;
}

/**
 * Ligações de um BDR na janela, cru o suficiente para o endpoint agregar do
 * mesmo jeito que agregava. Substitui a busca paginada de `calls` + 3 rodadas de
 * batch de associação (call→contact→company).
 *
 * O rótulo do desfecho vem de `disposition_label`, que o ETL lê de
 * `/calling/v1/dispositions` — ARMADILHA A16: quatro desfechos deste portal estão
 * SEMANTICAMENTE TROCADOS em relação ao padrão HubSpot (o GUID que a doc chama
 * "Connected" aqui se chama "Ocupado"). Fixar o mapa documentado reportaria 10.447
 * ligações como conectadas quando o portal as chama de ocupadas. Aqui usa-se o
 * rótulo do PORTAL, que é o que o BDR viu ao clicar.
 *
 * `contact_id`/`company_id` já vêm na própria fato — o "para quem" não custa mais
 * três rodadas de batch por página.
 */
async function bdrCalls(ownerIds, sinceMs, untilMs) {
  if (!ownerIds.length) return [];
  const lista = ownerIds.filter((id) => /^\d+$/.test(String(id))).map((id) => `'${id}'`).join(',');
  if (!lista) return [];
  const sql = `
    SELECT e.engagement_id, e.occurred_at, e.duration_ms, e.disposition_id,
           e.disposition_label, e.subject, e.contact_id, e.company_id,
           TRIM(CONCAT(IFNULL(c.first_name, ''), ' ', IFNULL(c.last_name, ''))) AS contato,
           cp.company_name AS empresa
    FROM ${wh.t('silver', 'fact_engagement')} e
    LEFT JOIN ${wh.t('silver', 'dim_contact')} c
      ON c.contact_id = e.contact_id AND c.is_current
    LEFT JOIN ${wh.t('silver', 'dim_company')} cp
      ON cp.company_id = e.company_id AND cp.is_current
    WHERE e.kind = 'calls'
      AND e.owner_id IN (${lista})
      AND e.occurred_at BETWEEN TIMESTAMP_MILLIS(@since) AND TIMESTAMP_MILLIS(@until)
    ORDER BY e.occurred_at DESC
    LIMIT 5000
  `;
  const { rows } = await wh.query(sql, [
    { name: 'since', type: 'INT64', value: String(sinceMs) },
    { name: 'until', type: 'INT64', value: String(untilMs) },
  ]);
  // Devolve no shape do /search do HubSpot (`{id, properties}`) para o endpoint
  // reaproveitar summarizeRows() sem ramificar a agregação por fonte. Duas
  // agregações para a mesma métrica é como as duas passam a discordar.
  return rows.map((r) => ({
    id: wh.str(r.engagement_id),
    properties: {
      hs_timestamp: wh.timestamp(r.occurred_at),
      hs_call_duration: r.duration_ms == null ? '' : String(r.duration_ms),
      hs_call_disposition: wh.str(r.disposition_id),
      hs_call_title: wh.str(r.subject),
    },
    _label: wh.str(r.disposition_label),
    _contato: wh.str(r.contato) || null,
    _empresa: wh.str(r.empresa) || null,
  }));
}


/**
 * Contatos trabalhados pelo time de BDRs, com o histórico COMPLETO de
 * `hs_lead_status`. Substitui a busca paginada + ~49 batches de
 * propertiesWithHistory do /api/bdr-leads.
 *
 * O histórico vem de `fact_crm_change`, e a equivalência foi medida, não
 * presumida: em 5 contatos com mais mudanças, valor E timestamp idênticos ao que
 * `propertiesWithHistory` devolve (8/8, 6/6, 6/6, 6/6, 6/6 em 07/08/2026).
 *
 * `origem`, `email` e `numero_de_colaboradores` passaram a ser projetados em
 * `dim_contact` para esta migração — sem eles o payload perderia o fallback de
 * nome, a origem em texto livre e o porte declarado no contato. `origem` NÃO é
 * `origem_canonica`: a canônica foi contaminada por backfill e não serve para
 * origem de evento.
 *
 * `teamIds` é resolvido pelo chamador com a MESMA régua de sempre
 * (`resolveTeamIds` sobre o roster canônico); aqui só se filtra por owner_id.
 */
async function bdrLeadContacts(teamIds) {
  if (!teamIds.length) return { contacts: [], semStatus: 0 };
  const lista = teamIds.filter((id) => /^\d+$/.test(String(id))).map((id) => `'${id}'`).join(',');
  if (!lista) return { contacts: [], semStatus: 0 };

  const sql = `
    WITH team AS (
      SELECT contact_id, first_name, last_name, email, job_title, owner_id,
             lead_status, hs_created_at, notes_last_contacted_at, origem,
             origem_canonica, numero_de_colaboradores, company_id_prop
      FROM ${wh.t('silver', 'dim_contact')}
      WHERE is_current AND owner_id IN (${lista})
    ),
    com_status AS (SELECT * FROM team WHERE lead_status IS NOT NULL AND lead_status != ''),
    hist AS (
      SELECT object_id AS contact_id,
             ARRAY_AGG(STRUCT(new_value AS valor, changed_at AS ts)
                       ORDER BY changed_at) AS pontos
      FROM ${wh.t('silver', 'fact_crm_change')}
      WHERE object_type = 'contact'
        AND property = 'hs_lead_status'
        AND new_value IS NOT NULL AND new_value != ''
        AND object_id IN (SELECT contact_id FROM com_status)
      GROUP BY object_id
    )
    SELECT c.*, h.pontos,
           cp.company_name, cp.employees
    FROM com_status c
    LEFT JOIN hist h USING (contact_id)
    LEFT JOIN ${wh.t('silver', 'dim_company')} cp
      ON cp.company_id = c.company_id_prop AND cp.is_current
    ORDER BY c.hs_created_at DESC
  `;
  const { rows } = await wh.query(sql);

  // Contatos do time SEM lead status. A regra de vigência (BDRs que saíram do
  // time) é aplicada pelo CHAMADOR, que é quem conhece o roster — aqui vem a
  // contagem crua por dono e data de criação, para o filtro ser o mesmo dos dois
  // lados da comparação.
  const { rows: sem } = await wh.query(`
    SELECT owner_id, FORMAT_TIMESTAMP('%Y-%m', hs_created_at) AS criado_ym, COUNT(*) AS n
    FROM ${wh.t('silver', 'dim_contact')}
    WHERE is_current AND owner_id IN (${lista})
      AND (lead_status IS NULL OR lead_status = '')
    GROUP BY 1, 2
  `);

  return {
    contacts: rows.map((r) => ({
      id: wh.str(r.contact_id),
      firstname: wh.str(r.first_name),
      lastname: wh.str(r.last_name),
      email: wh.str(r.email),
      jobtitle: wh.str(r.job_title),
      owner_id: wh.str(r.owner_id),
      lead_status: wh.str(r.lead_status),
      createdate: wh.timestamp(r.hs_created_at),
      notes_last_contacted: wh.timestamp(r.notes_last_contacted_at),
      origem: wh.str(r.origem),
      origem_canonica: wh.str(r.origem_canonica),
      numero_de_colaboradores: r.numero_de_colaboradores == null ? null : Number(r.numero_de_colaboradores),
      company_id: wh.str(r.company_id_prop),
      company_name: wh.str(r.company_name),
      company_employees: r.employees == null ? null : Number(r.employees),
      // Mesmo shape do payload antigo: [[valor, timestamp], ...] cronológico.
      hist: (r.pontos || []).map((x) => [wh.str(x.valor), wh.timestamp(x.ts)]),
    })),
    semStatusPorDono: sem.map((r) => ({
      owner_id: wh.str(r.owner_id),
      criado_ym: wh.str(r.criado_ym),
      n: wh.num(r.n),
    })),
  };
}


/**
 * Jornada de etapa dos pipelines Vendas e Bid. Substitui, no /api/funnel-stages,
 * a busca paginada de TODOS os deals + um batch de propertiesWithHistory a cada 50
 * deals — por request.
 *
 * `fact_stage_entry` é a jornada nativa: uma linha por (deal, etapa, entrada), com
 * `entered_at`, `exited_at`, `days_in_stage`, `re_entered` e `is_open` já
 * calculados. É a mesma informação que o endpoint remontava do histórico no
 * JavaScript.
 *
 * A etapa é atribuída ao pipeline REGISTRADO NA ENTRADA (`fact_stage_entry.
 * pipeline_id`), não ao pipeline atual do deal. Deal migra de pipeline — armadilha
 * A3, com o caminho 783509571 → 782758156 → 803749153 observado num deal real — e
 * a versão antiga bucketizava tudo pelo pipeline atual. Medido em 07/08/2026:
 * **2.200 de 7.796 entradas (28%), em 1.612 deals, têm pipeline diferente do
 * atual.** Pela regra antiga essas entradas eram testadas contra o mapa de etapas
 * do pipeline errado e caíam fora em silêncio, porque id de etapa é único por
 * pipeline. O funil é sempre `(pipeline, stage)`.
 *
 * `owner_changes` é `COUNT(*) - 1`, e o -1 não é chute: a contagem de
 * `fact_crm_change` é IGUAL ao length do histórico da API (que inclui a
 * atribuição inicial). Medido em 4 deals — 18/18, 15/15, 12/12, 12/12.
 *
 * PREMISSA que NÃO muda: o universo de deals continua sendo "deals cujo pipeline
 * ATUAL é Vendas ou Bid", igual à versão antiga. Deal que migrou para um terceiro
 * pipeline fica fora dos dois funis, mesmo tendo passado por eles. Corrigir isso
 * é outra mudança, com outro efeito, e precisa ser decidida à parte.
 */
async function funnelStages(pipelineIds, since, until) {
  const pipes = pipelineIds.filter((p) => /^[0-9]+$/.test(String(p))).map((p) => `'${p}'`).join(',');
  if (!pipes) return { deals: [], entradas: [], duracoes: [], trocas: [] };

  const sql = `
    WITH deals AS (
      SELECT deal_id, deal_name, pipeline_id, hs_created_at
      FROM ${wh.t('silver', 'dim_deal')}
      WHERE is_current AND pipeline_id IN (${pipes})
    ),
    entradas AS (
      -- MIN(entered_at): re-entrada na mesma etapa conta UMA vez, com a primeira
      -- data — igual ao antigo, que guardava a menor entered_date por etapa.
      SELECT e.object_id AS deal_id, e.stage_id, e.pipeline_id,
             FORMAT_DATE('%F', MIN(DATE(e.entered_at))) AS entered_date
      FROM ${wh.t('silver', 'fact_stage_entry')} e
      JOIN deals d ON d.deal_id = e.object_id
      WHERE e.object_type = 'deal' AND e.entered_at IS NOT NULL
        AND DATE(e.entered_at) >= DATE(@since)
        AND (@until IS NULL OR DATE(e.entered_at) <= DATE(@until))
      GROUP BY 1, 2, 3
    ),
    -- N07: tempo CUMULATIVO por etapa, só períodos CONCLUÍDOS. O tempo de quem
    -- está na etapa agora não conta (is_open), senão a mediana cai junto com a
    -- entrada de deal novo.
    duracoes AS (
      SELECT e.object_id AS deal_id, e.stage_id, e.pipeline_id,
             SUM(e.days_in_stage) AS dias
      FROM ${wh.t('silver', 'fact_stage_entry')} e
      JOIN deals d ON d.deal_id = e.object_id
      WHERE e.object_type = 'deal' AND NOT e.is_open AND e.days_in_stage IS NOT NULL
      GROUP BY 1, 2, 3
    ),
    trocas AS (
      SELECT c.object_id AS deal_id, GREATEST(COUNT(*) - 1, 0) AS n
      FROM ${wh.t('silver', 'fact_crm_change')} c
      JOIN deals d ON d.deal_id = c.object_id
      WHERE c.object_type = 'deal' AND c.property = 'hubspot_owner_id'
      GROUP BY 1
    ),
    -- Deal com QUALQUER entrada de etapa, sem recorte de data: é o
    -- total_with_history que o payload declara.
    com_historico AS (
      SELECT COUNT(DISTINCT e.object_id) AS n
      FROM ${wh.t('silver', 'fact_stage_entry')} e
      JOIN deals d ON d.deal_id = e.object_id
      WHERE e.object_type = 'deal'
    )
    SELECT
      (SELECT n FROM com_historico) AS total_com_historico,
      ARRAY(SELECT AS STRUCT deal_id, deal_name, pipeline_id,
                   FORMAT_DATE('%F', DATE(hs_created_at)) AS criado
            FROM deals) AS deals,
      ARRAY(SELECT AS STRUCT deal_id, stage_id, pipeline_id, entered_date FROM entradas) AS entradas,
      ARRAY(SELECT AS STRUCT deal_id, stage_id, pipeline_id, dias FROM duracoes) AS duracoes,
      ARRAY(SELECT AS STRUCT deal_id, n FROM trocas) AS trocas
  `;
  const { rows } = await wh.query(sql, [
    { name: 'since', type: 'DATE', value: since },
    { name: 'until', type: 'DATE', value: until || null },
  ]);
  const r = rows[0] || {};
  return {
    totalComHistorico: wh.num(r.total_com_historico),
    deals: (r.deals || []).map((d) => ({
      id: wh.str(d.deal_id), nome: (wh.str(d.deal_name) || '').trim(),
      pipeline: wh.str(d.pipeline_id), criado: wh.str(d.criado),
    })),
    entradas: (r.entradas || []).map((e) => ({
      deal: wh.str(e.deal_id), stage: wh.str(e.stage_id),
      pipeline: wh.str(e.pipeline_id), data: wh.str(e.entered_date),
    })),
    duracoes: (r.duracoes || []).map((d) => ({
      deal: wh.str(d.deal_id), stage: wh.str(d.stage_id),
      pipeline: wh.str(d.pipeline_id), dias: Number(d.dias),
    })),
    trocas: (r.trocas || []).map((t) => ({ deal: wh.str(t.deal_id), n: wh.num(t.n) })),
  };
}

module.exports = {
  FEED_KINDS, FEED_KINDS_EXTRA, FEED_LIMIT, COMPANY_DEALS_MISSING,
  limpaCorpo, normalizeProb,
  activities, companyDeals, dealProbHistory, cotacaoTickets, ownerMap, bdrCalls, bdrLeadContacts, funnelStages,
};
