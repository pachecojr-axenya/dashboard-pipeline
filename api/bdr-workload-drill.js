'use strict';

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const bq = require('../lib/bigquery');
const { BDR_TEAM, canonicalizeBdrName, bdrOwnerIds, bdrOwnerIdClause, exitedCutClause } = require('../lib/bdr-team');

const PROJECT = 'gen-lang-client-0423905839';
const GOLD = 'axenya_sales_hubspot_bdr_prd_sae1_gold';
const VIEWS = {
  activity: `${PROJECT}.${GOLD}.bdr_workload_touch_detail_v2`,
  reactivity: `${PROJECT}.${GOLD}.bdr_workload_reactivity_v2`,
  penetration: `${PROJECT}.${GOLD}.bdr_workload_company_contact_v2`,
  crm: `${PROJECT}.${GOLD}.bdr_workload_crm_events_v2`,
  sql: `${PROJECT}.${GOLD}.bdr_workload_sql_events_v2`,
};
const KINDS = Object.keys(VIEWS);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CHANNEL_DB = { calls: 'call', emails: 'email', whatsapp: 'whatsapp', linkedin: 'linkedin', meetings: 'meeting' };

function bad(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
function parseDate(value, name) {
  if (!ISO.test(String(value || ''))) throw bad(`${name} obrigatório (YYYY-MM-DD)`);
  return value;
}
function parseContext(raw) {
  if (!raw) return null;
  const parts = String(raw).split(':');
  if (parts.length !== 2) throw bad('context inválido');
  const type = parts[0], value = parts[1];
  const allowed = {
    channel: Object.keys(CHANNEL_DB),
    // outcome: desfecho de ligação (activity + channel=call). Chave canônica é
    // a MESMA usada em bdr-workload-semantic.js (GUID/label -> outcome), então
    // o card, o modelo e o drill falam a mesma língua.
    outcome: ['connected', 'voicemail', 'dial', 'no_answer', 'busy', 'wrong_number', 'no_outcome', 'talk_time'],
    bucket: ['0', '1', '2', '3', '4', '5', '6+', '2–3', '4–5', 'lt_1h', '1_4h', '4_24h', '24_72h', '72h_plus', 'sem_toque'],
    event: ['attempted', 'connected', 'qualified', 'disqualified'],
    domain: ['ritmo', 'insercao', 'crm', 'contato_efetivo', 'sql'],
  };
  if (!allowed[type] || !allowed[type].includes(value)) throw bad('context inválido');
  return { type, value };
}
// Filtro global de canal (multi). Só faz sentido para kind=activity. Cada valor
// tem de estar em CHANNEL_DB (nome público -> nome no BQ). Quando o clique já
// carrega um context channel/outcome específico, a precedência é do context e
// este filtro é IGNORADO (evita interseção vazia).
function parseChannels(raw) {
  if (raw == null || raw === '') return null;
  const parts = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const bad_ = parts.filter((c) => !Object.prototype.hasOwnProperty.call(CHANNEL_DB, c));
  if (bad_.length) throw bad('canal inválido');
  // dedup preservando ordem (payload menor, SQL determinístico)
  const seen = {}, out = [];
  parts.forEach((c) => { if (!seen[c]) { seen[c] = 1; out.push(c); } });
  return out;
}
function parse(req) {
  const q = new URL(`http://x${req.url}`).searchParams;
  const kind = q.get('kind') || 'activity';
  if (!KINDS.includes(kind)) throw bad('kind inválido');
  const bdr = q.get('bdr') ? canonicalizeBdrName(q.get('bdr')) : null;
  if (bdr && !BDR_TEAM.includes(bdr)) throw bad('BDR inválido');
  const since = parseDate(q.get('since'), 'since');
  const until = parseDate(q.get('until'), 'until');
  if (since > until) throw bad('since > until');
  const limit = Math.min(50, Math.max(1, Number(q.get('limit') || 25)));
  const page = Math.max(1, Number(q.get('page') || 1));
  return {
    kind, since, until, bdr, bdrIds: bdrOwnerIds(bdr),
    porte: q.get('porte') || null,
    segmento: q.get('segmento') || null,
    persona: q.get('persona') || null,
    context: parseContext(q.get('context')),
    channels: parseChannels(q.get('channels')),
    page, limit, offset: (page - 1) * limit,
  };
}
function hubspotUrl(type, id) {
  if (!id) return null;
  if (type === 'company') return `https://app.hubspot.com/contacts/44715285/record/0-2/${encodeURIComponent(id)}`;
  if (type === 'deal') return `https://app.hubspot.com/contacts/44715285/record/0-3/${encodeURIComponent(id)}`;
  return null;
}
function addFilters(alias, requested, dateField, params, options = {}) {
  const where = [`${alias}.${dateField} BETWEEN @since AND @until`];
  if (requested.bdrIds && requested.bdrIds.length) {
    const oc = bdrOwnerIdClause(alias, requested.bdrIds, requested.bdr);
    if (oc) where.push(oc);
  }
  // Mesmo corte de saída do gráfico. Sem ele o drill listaria a linha que o
  // agregado já não conta, e a tabela viraria a prova de que o gráfico "perdeu"
  // registro.
  const ex = exitedCutClause(alias, dateField);
  if (ex) where.push(ex);
  if (requested.porte) {
    where.push(`COALESCE(NULLIF(${alias}.porte,''),'desconhecido') = @porte`);
    params.push({ name: 'porte', type: 'STRING', value: requested.porte });
  }
  if (requested.segmento) {
    where.push(`COALESCE(NULLIF(${alias}.segmento,''),'desconhecido') = @segmento`);
    params.push({ name: 'segmento', type: 'STRING', value: requested.segmento });
  }
  if (requested.persona && options.persona !== false) {
    where.push(`COALESCE(NULLIF(${alias}.persona,''),'nao_classificada') = @persona`);
    params.push({ name: 'persona', type: 'STRING', value: requested.persona });
  }
  return where;
}
// Canais de ritmo (domain:ritmo). O domínio "ritmo" é a soma destes canais no
// modelo semântico; aqui filtramos exatamente esse conjunto para reconciliar.
const RITMO_CHANNELS = ['calls', 'email', 'whatsapp', 'linkedin', 'meeting'];
// Desfecho de ligação -> cláusula SQL sobre bdr_workload_touch_detail_v2.
// Todas restringem a channel='call'. `dial` = sem conexão (nem connected nem
// voicemail); `no_outcome` = sem call_outcome; `talk_time` = conectadas com
// duração > 0 (é o conjunto que soma o "tempo em linha"). MECE:
// connected + voicemail + dial = calls.
const OUTCOME_CLAUSE = {
  connected: (a) => `${a}.channel='call' AND ${a}.call_outcome='connected'`,
  voicemail: (a) => `${a}.channel='call' AND ${a}.call_outcome='voicemail'`,
  dial: (a) => `${a}.channel='call' AND COALESCE(${a}.call_outcome,'') NOT IN ('connected','voicemail')`,
  no_answer: (a) => `${a}.channel='call' AND ${a}.call_outcome='no_answer'`,
  busy: (a) => `${a}.channel='call' AND ${a}.call_outcome='busy'`,
  wrong_number: (a) => `${a}.channel='call' AND ${a}.call_outcome='wrong_number'`,
  no_outcome: (a) => `${a}.channel='call' AND COALESCE(${a}.call_outcome,'')=''`,
  talk_time: (a) => `${a}.channel='call' AND ${a}.call_outcome='connected' AND ${a}.call_duration_s>0`,
};
// Filtro global multi-canal (kind=activity). Só aplicado quando NÃO há context
// channel/outcome (esses são mais específicos e prevalecem). Params nomeados
// individuais (@channel0..@channelN) porque o cliente BQ REST não aceita ARRAY.
function addChannelsFilter(where, params, requested, alias) {
  if (!requested.channels || !requested.channels.length) return;
  if (requested.kind !== 'activity') throw bad('channels incompatível com kind');
  const context = requested.context;
  if (context && (context.type === 'channel' || context.type === 'outcome')) return; // context prevalece
  const names = requested.channels.map((channel, index) => {
    const name = `channel${index}`;
    params.push({ name, type: 'STRING', value: CHANNEL_DB[channel] });
    return `@${name}`;
  });
  where.push(`${alias}.channel IN (${names.join(',')})`);
}
function addContext(where, params, requested, alias) {
  const context = requested.context;
  if (!context) return;
  if (context.type === 'channel') {
    if (requested.kind !== 'activity') throw bad('context channel incompatível com kind');
    where.push(`${alias}.channel = @contextValue`);
    params.push({ name: 'contextValue', type: 'STRING', value: CHANNEL_DB[context.value] });
  } else if (context.type === 'outcome') {
    if (requested.kind !== 'activity') throw bad('context outcome incompatível com kind');
    where.push(OUTCOME_CLAUSE[context.value](alias));
  } else if (context.type === 'event') {
    if (requested.kind !== 'crm') throw bad('context event incompatível com kind');
    where.push(`${alias}.event_type = @contextValue`);
    params.push({ name: 'contextValue', type: 'STRING', value: context.value });
  } else if (context.type === 'bucket' && requested.kind === 'reactivity') {
    const clauses = {
      lt_1h: `${alias}.has_touch AND ${alias}.hours_to_first_touch < 1`,
      '1_4h': `${alias}.has_touch AND ${alias}.hours_to_first_touch >= 1 AND ${alias}.hours_to_first_touch < 4`,
      '4_24h': `${alias}.has_touch AND ${alias}.hours_to_first_touch >= 4 AND ${alias}.hours_to_first_touch < 24`,
      '24_72h': `${alias}.has_touch AND ${alias}.hours_to_first_touch >= 24 AND ${alias}.hours_to_first_touch < 72`,
      '72h_plus': `${alias}.has_touch AND ${alias}.hours_to_first_touch >= 72`,
      sem_toque: `NOT ${alias}.has_touch`,
    };
    if (!clauses[context.value]) throw bad('bucket incompatível com reactivity');
    where.push(clauses[context.value]);
  } else if (context.type === 'domain') {
    const expected = { activity: 'ritmo', crm: 'crm', sql: 'sql' }[requested.kind];
    if (expected && context.value !== expected && !(requested.kind === 'crm' && context.value === 'contato_efetivo')) {
      throw bad('context domain incompatível com kind');
    }
    // domain:ritmo (activity) corresponde ao conjunto de canais de ritmo — filtra
    // de fato (antes: cláusula morta -> drill devolvia o total do domínio).
    if (requested.kind === 'activity' && context.value === 'ritmo') {
      const names = RITMO_CHANNELS.map((db, index) => {
        const name = `ritmoChannel${index}`;
        params.push({ name, type: 'STRING', value: db });
        return `@${name}`;
      });
      where.push(`${alias}.channel IN (${names.join(',')})`);
    }
    // Nos demais domínios (crm/sql/insercao/contato_efetivo) a semântica já vem
    // do `kind` (a própria view isola o conjunto) — sem cláusula adicional.
  } else if (context.type === 'bucket' && requested.kind !== 'penetration') {
    throw bad('context bucket incompatível com kind');
  }
}
function standardQuery(requested, countOnly) {
  const specs = {
    activity: {
      date: 'metric_date', order: 'occurred_at DESC',
      fields: 'interaction_id, metric_date, occurred_at, owner_id, owner_name, company_id, company_name, channel, direction_effective, atividade_tipo, call_outcome, call_natureza_final, call_duration_s, porte, segmento, persona, outcome_real, deal_id',
    },
    reactivity: {
      date: 'eligible_date', order: 'eligible_date DESC, owner_name',
      fields: 'eligible_date, owner_id, owner_name, company_id, company_name, porte, segmento, persona, hours_to_first_touch, has_touch, first_touch_at, entry_source, attribution_quality',
    },
    crm: {
      date: 'event_date', order: 'event_at DESC',
      fields: 'event_at, event_date, event_type, owner_id, owner_name, company_id, company_name, porte, segmento, persona',
    },
    sql: {
      date: 'sql_date', order: 'sql_entered_at DESC',
      fields: 'deal_id, owner_id, owner_name, sql_date, sql_entered_at, company_id, company_name, porte, segmento, persona',
    },
  };
  const spec = specs[requested.kind];
  const params = [
    { name: 'since', type: 'DATE', value: requested.since },
    { name: 'until', type: 'DATE', value: requested.until },
  ];
  const where = addFilters('x', requested, spec.date, params);
  addContext(where, params, requested, 'x');
  addChannelsFilter(where, params, requested, 'x');
  if (!countOnly) params.push({ name: 'limit', type: 'INT64', value: requested.limit }, { name: 'offset', type: 'INT64', value: requested.offset });
  const sql = countOnly
    ? `SELECT COUNT(1) AS total FROM \`${VIEWS[requested.kind]}\` x WHERE ${where.join(' AND ')}`
    : `SELECT ${spec.fields} FROM \`${VIEWS[requested.kind]}\` x WHERE ${where.join(' AND ')} ORDER BY ${spec.order} LIMIT @limit OFFSET @offset`;
  return { sql, params, view: VIEWS[requested.kind] };
}
function penetrationQuery(requested, countOnly) {
  const params = [
    { name: 'since', type: 'DATE', value: requested.since },
    { name: 'until', type: 'DATE', value: requested.until },
  ];
  const where = addFilters('cc', requested, 'eligible_date', params);
  let bucketWhere = '';
  if (requested.context && requested.context.type === 'bucket') {
    const bucket = requested.context.value;
    if (bucket === '2–3') {
      params.push({ name: 'bucketMin', type: 'INT64', value: 2 }, { name: 'bucketMax', type: 'INT64', value: 3 });
      bucketWhere = 'WHERE CAST(contacts_touched AS INT64) BETWEEN @bucketMin AND @bucketMax';
    } else if (bucket === '4–5') {
      params.push({ name: 'bucketMin', type: 'INT64', value: 4 }, { name: 'bucketMax', type: 'INT64', value: 5 });
      bucketWhere = 'WHERE CAST(contacts_touched AS INT64) BETWEEN @bucketMin AND @bucketMax';
    } else {
      const bucketValue = bucket === '6+' ? 6 : Number(bucket);
      params.push({ name: 'bucketValue', type: 'INT64', value: bucketValue });
      bucketWhere = 'WHERE LEAST(CAST(contacts_touched AS INT64), 6) = @bucketValue';
    }
  } else if (requested.context && requested.context.type !== 'domain') {
    throw bad('context incompatível com penetration');
  }
  const scope = `WITH company_scope AS (
    SELECT
      company_id, ANY_VALUE(company_name) AS company_name,
      owner_id, ANY_VALUE(owner_name) AS owner_name,
      MIN(eligible_date) AS eligible_date,
      ANY_VALUE(porte) AS porte, ANY_VALUE(segmento) AS segmento,
      COUNT(DISTINCT contact_id) AS contacts_eligible,
      COUNT(DISTINCT IF(has_touch, contact_id, NULL)) AS contacts_touched,
      SUM(touches_real) AS touches_real,
      MIN(first_touch_at) AS first_touch_at,
      MAX(last_touch_at) AS last_touch_at,
      MAX(converted_30d) AS converted_30d
    FROM \`${VIEWS.penetration}\` cc
    WHERE ${where.join(' AND ')}
    GROUP BY company_id, owner_id
  )`;
  if (!countOnly) params.push({ name: 'limit', type: 'INT64', value: requested.limit }, { name: 'offset', type: 'INT64', value: requested.offset });
  const fields = 'eligible_date, owner_id, owner_name, company_id, company_name, porte, segmento, contacts_eligible, contacts_touched, touches_real, first_touch_at, last_touch_at, converted_30d';
  const sql = countOnly
    ? `${scope} SELECT COUNT(1) AS total FROM company_scope ${bucketWhere}`
    : `${scope} SELECT ${fields} FROM company_scope ${bucketWhere} ORDER BY eligible_date DESC, owner_name LIMIT @limit OFFSET @offset`;
  return { sql, params, view: VIEWS.penetration };
}
function queryFor(requested, countOnly) {
  return requested.kind === 'penetration' ? penetrationQuery(requested, countOnly) : standardQuery(requested, countOnly);
}
function sanitizeRow(row) {
  const output = {};
  Object.keys(row || {}).forEach((key) => {
    if (/email|phone|telefone|mobile|firstname|lastname|name_raw|contact_name/i.test(key)) return;
    if (key === 'contact_id') return;
    output[key] = row[key];
  });
  if (output.company_id) output.companyUrl = hubspotUrl('company', output.company_id);
  if (output.deal_id) output.dealUrl = hubspotUrl('deal', output.deal_id);
  if (output.owner_name) output.owner_name = canonicalizeBdrName(output.owner_name);
  return output;
}
async function build(requested) {
  if (!bq.isConfigured()) throw Object.assign(new Error('BigQuery não configurado'), { statusCode: 503 });
  const countQuery = queryFor(requested, true);
  const dataQuery = queryFor(requested, false);
  const [countResult, dataResult] = await Promise.all([
    bq.query(countQuery.sql, countQuery.params),
    bq.query(dataQuery.sql, dataQuery.params),
  ]);
  const total = Number((countResult.rows[0] && countResult.rows[0].total) || 0);
  return {
    success: true,
    contractVersion: '2.3',
    kind: requested.kind,
    requestedRange: { since: requested.since, until: requested.until },
    filtersApplied: {
      bdr: requested.bdr, porte: requested.porte, segmento: requested.segmento,
      persona: requested.persona, context: requested.context, channels: requested.channels,
    },
    source: { kind: 'bq-operational', view: dataQuery.view },
    total,
    pagination: {
      page: requested.page, limit: requested.limit,
      totalPages: Math.ceil(total / requested.limit),
      hasNext: requested.page * requested.limit < total,
    },
    rows: dataResult.rows.map(sanitizeRow),
    reconciliation: {
      returned: dataResult.rows.length,
      limitCappedAt: 50,
      piiPolicy: 'sem e-mail, telefone ou nome de contato; company e deal auditáveis',
    },
  };
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  const user = requireAuth(req, res);
  if (!user) return;
  try { return res.status(200).json(await build(parse(req))); }
  catch (error) { return res.status(error.statusCode || 500).json({ success: false, error: error.message }); }
};

module.exports._test = { parse, parseContext, parseChannels, sanitizeRow, hubspotUrl, queryFor, build, VIEWS, CHANNEL_DB };
