'use strict';

/**
 * GET /api/bdr-treble-dw
 *
 * Contrato V2 do dashboard /novo-bdr/treble.
 * - Fonte primária: client_analytics.fact_deployment_status (ClickHouse Treble DW).
 * - Granularidade: uma linha sanitizada por tentativa real de envio.
 * - Privacidade: não retorna telefone, email, conteúdo, deployment_id, batch_id,
 *   treble_id, origin_id nem payload bruto.
 * - Atribuição: direta via origin_id -> dim_agents.id quando disponível; senão,
 *   inferência conservadora pelo nome do flow.
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');

const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PRESET = 'today';
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const ROW_LIMIT = 10000;
const QUERY_LIMIT = ROW_LIMIT + 1;
const TZ = 'America/Sao_Paulo';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SENTINEL_SQL = "toDateTime64('2000-01-01 00:00:00', 6, 'America/Sao_Paulo')";

const PII_KEYS = {
  cellphone: true,
  country_code: true,
  deployment_id: true,
  batch_id: true,
  treble_id: true,
  origin_id: true,
  originid: true,
  phone: true,
  email: true,
  document: true,
  content: true,
  message: true,
  text: true,
  body: true,
  copy: true,
  session_id: true
};

// Regras de atribuição por CONSTRUTOR do flow (declaradas pelo negócio, não inferência).
// Quem construiu o flow é o responsável, independentemente de o nome aparecer no flow.
// Precedência: match direto em dim_agents > regra de flow > inferência por nome no flow.
// normalizeText remove acentos e caixa; os matchers usam substring normalizada.
const FLOW_AGENT_RULES = [
  { agent: 'Samuel Alencar', match: function (s) { return /pesquisa\s*rh/.test(s) || /\bexp\b.*outbound|outbound.*\bexp\b|experimento.*outbound|exp[\s._-]*outbound/.test(s); } },
  { agent: 'Gabriel Milan', match: function (s) { return /deal\s*4\s*b/.test(s); } }
];

const AGENT_ALIASES = {
  gabi: 'Gabriele Almeida',
  gabriele: 'Gabriele Almeida',
  leticia: 'Leticia Romão',
  giovana: 'Giovana Nunes',
  thauan: 'Thauan Pontes',
  felipe: 'Felipe Andrade',
  cintia: 'Cíntia Rodrigues',
  cynthia: 'Cíntia Rodrigues',
  marcelli: 'Marcelli Netto',
  yoky: 'Yokyko Muramoto',
  yokyko: 'Yokyko Muramoto',
  bruna: 'Bruna Cristina Dos Reis Silva',
  bru: 'Bruna Cristina Dos Reis Silva',
  anderson: 'Anderson Souza',
  manu: 'Emanuelle Braga',
  emanuelle: 'Emanuelle Braga',
  pri: 'Priscilla Feliciello',
  priscilla: 'Priscilla Feliciello',
  samuel: 'Samuel Alencar',
  allan: 'Allan Valença'
};

const CANONICAL_AGENT_BY_FIRST_NAME = {
  gabriele: 'Gabriele Almeida',
  leticia: 'Leticia Romão',
  giovana: 'Giovana Nunes',
  thauan: 'Thauan Pontes',
  felipe: 'Felipe Andrade',
  cintia: 'Cíntia Rodrigues',
  marcelli: 'Marcelli Netto',
  yokyko: 'Yokyko Muramoto',
  bruna: 'Bruna Cristina Dos Reis Silva',
  anderson: 'Anderson Souza',
  emanuelle: 'Emanuelle Braga',
  priscilla: 'Priscilla Feliciello',
  samuel: 'Samuel Alencar',
  allan: 'Allan Valença'
};

const STATUS_META = {
  DELIVERED: {
    label: 'Entregue',
    group: 'delivered',
    severity: 'good',
    action: 'Monitorar resposta e replicar abordagem'
  },
  SUCCESS: {
    label: 'Processado sem confirmação',
    group: 'processed_unconfirmed',
    severity: 'warn',
    action: 'Não contar como entregue; validar evento posterior'
  },
  FAILURE_BY_UNABLE_TO_CONTACT: {
    label: 'Não conseguiu contato',
    group: 'not_delivered',
    severity: 'bad',
    action: 'Validar telefone, opt-in e qualidade da base'
  },
  MISSING_PARAMETER: {
    label: 'Parâmetro ausente',
    group: 'not_delivered',
    severity: 'bad',
    action: 'Corrigir variáveis obrigatórias do template/flow'
  },
  FAILURE_BY_META_CHOSE_NOT_DELIVER: {
    label: 'Meta não entregou',
    group: 'not_delivered',
    severity: 'bad',
    action: 'Revisar reputação, template, janela e política Meta'
  },
  FAILURE_BY_HUMAN_HANDOVER: {
    label: 'Handover humano',
    group: 'not_delivered',
    severity: 'warn',
    action: 'Checar regra de handover antes de novo disparo'
  },
  FAILURE_BY_EXPERIMENT_NUMBER: {
    label: 'Número de experimento',
    group: 'not_delivered',
    severity: 'bad',
    action: 'Remover número de teste da régua produtiva'
  },
  FAILURE_BY_DISABLED_HSM: {
    label: 'HSM desativado',
    group: 'not_delivered',
    severity: 'bad',
    action: 'Reativar/aprovar HSM antes de enviar'
  },
  INVALID_PHONE: {
    label: 'Telefone inválido',
    group: 'not_delivered',
    severity: 'bad',
    action: 'Higienizar telefone e DDI antes da cadência'
  },
  FAILURE: {
    label: 'Falha genérica',
    group: 'not_delivered',
    severity: 'bad',
    action: 'Auditar log Treble e configuração do flow'
  }
};

let cacheByKey = {};

function getClickHouseCredentials() {
  const host = process.env.TREBLE_WAREHOUSE_HOST;
  const port = process.env.TREBLE_WAREHOUSE_PORT || '8443';
  const user = process.env.TREBLE_WAREHOUSE_USER;
  const password = process.env.TREBLE_WAREHOUSE_PASSWORD;
  const database = process.env.TREBLE_WAREHOUSE_DATABASE || 'client_analytics';

  if (!host || !user || !password) throw new Error('clickhouse_config_missing');
  return { host, port, user, password, database };
}

function basicAuth(user, password) {
  return 'Basic ' + Buffer.from(String(user) + ':' + String(password), 'utf8').toString('base64');
}

async function clickhouseQuery(creds, sql) {
  const base = 'https://' + creds.host + ':' + creds.port + '/?database=' + encodeURIComponent(creds.database);
  const res = await fetch(base, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'text/plain; charset=utf-8',
      Authorization: basicAuth(creds.user, creds.password)
    },
    body: sql,
    signal: AbortSignal.timeout(25000)
  });

  if (!res.ok) throw new Error('clickhouse_http_' + res.status);

  const json = await res.json();
  return {
    rows: json.data || [],
    meta: json.meta || [],
    statistics: json.statistics || {},
    rowsRead: json.rows || 0
  };
}

function normalizeText(v) {
  return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function pct(num, den) {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

function quoteSql(v) {
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function addDays(d, n) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function todayBrtDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const m = {};
  parts.forEach(function (p) { m[p.type] = p.value; });
  return parseDate(m.year + '-' + m.month + '-' + m.day);
}

function parseDate(s) {
  if (!DATE_RE.test(String(s || ''))) return null;

  const d = new Date(String(s) + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return d;
}

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

function rangeDays(from, to) {
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}

function formatDatePt(s) {
  const p = String(s).split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

function resolveDateRange(query) {
  const today = todayBrtDate();
  let preset = String(query.preset || '').toLowerCase();
  let from;
  let to;
  let label;

  if (!preset && query.days != null) {
    const n = Math.max(1, Math.min(MAX_DAYS, parseInt(query.days, 10) || DEFAULT_DAYS));
    preset = n + 'd';
    to = today;
    from = addDays(today, -(n - 1));
    label = 'Últimos ' + n + ' dias';
  } else {
    if (!preset) preset = DEFAULT_PRESET;

    if (preset === 'today') {
      from = today;
      to = today;
      label = 'Hoje';
    } else if (preset === 'yesterday') {
      from = addDays(today, -1);
      to = from;
      label = 'Ontem';
    } else if (preset === '7d' || preset === '30d' || preset === '90d') {
      const days = parseInt(preset, 10);
      to = today;
      from = addDays(today, -(days - 1));
      label = 'Últimos ' + days + ' dias';
    } else if (preset === 'custom') {
      from = parseDate(query.from);
      to = parseDate(query.to);
      if (!from || !to) throw new Error('invalid_custom_date');
      if (from > to) throw new Error('invalid_custom_order');
      label = formatDatePt(dateStr(from)) + ' a ' + formatDatePt(dateStr(to));
    } else {
      throw new Error('invalid_preset');
    }
  }

  const days = rangeDays(from, to);
  if (days > MAX_DAYS) throw new Error('date_range_too_large');

  return {
    preset,
    from: dateStr(from),
    to: dateStr(to),
    label,
    days
  };
}

function canonicalAgentName(name) {
  const raw = String(name || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';

  const first = normalizeText(raw).split(/\s+/)[0];
  return CANONICAL_AGENT_BY_FIRST_NAME[first] || raw;
}

function agentFromFlowRule(flow) {
  const s = normalizeText(flow);
  if (!s) return '';
  for (let i = 0; i < FLOW_AGENT_RULES.length; i += 1) {
    if (FLOW_AGENT_RULES[i].match(s)) return FLOW_AGENT_RULES[i].agent;
  }
  return '';
}

function inferAgentFromFlow(flow) {
  const s = normalizeText(flow);
  const keys = Object.keys(AGENT_ALIASES);

  for (let i = 0; i < keys.length; i += 1) {
    const re = new RegExp('(^|[^a-z])' + keys[i] + '([^a-z]|$)');
    if (re.test(s)) return AGENT_ALIASES[keys[i]];
  }

  return '';
}

function fullName(r) {
  return [r.agent_first_name, r.agent_last_name].filter(Boolean).join(' ').trim();
}

function agentForRow(r) {
  const direct = canonicalAgentName(fullName(r));
  if (direct) {
    return { agent: direct, agentSource: 'direct', agentConfidence: 1 };
  }

  // Regra de negócio por construtor do flow (alta confiança, não é palpite).
  const byRule = agentFromFlowRule(r.flow);
  if (byRule) {
    return { agent: byRule, agentSource: 'flow_rule', agentConfidence: 0.95 };
  }

  const inferred = inferAgentFromFlow(r.flow);
  if (inferred) {
    return { agent: inferred, agentSource: 'flow_inference', agentConfidence: 0.65 };
  }

  return { agent: 'Não identificado', agentSource: 'unknown', agentConfidence: 0 };
}

function copyFamily(name) {
  const s = normalizeText(name);
  if (/mensagem\s*1|msg\s*1|abertura|inicial|oi\b/.test(s)) return 'Abertura | primeira mensagem';
  if (/mensagem\s*2|msg\s*2|follow|retomada|mais cedo|liguei/.test(s)) return 'Follow-up | retomada';
  if (/conectado|conexao/.test(s)) return 'Conexão pendente';
  if (/workflow|automacao|automatizado/.test(s)) return 'Workflow automatizado';
  return 'Outros';
}

function inferAudience(flowName) {
  const s = normalizeText(flowName);
  if (/rh|people|gente|dp|folha|pessoas/.test(s)) return 'RH | People | DP';
  if (/beneficio|saude|plano|medico|odonto/.test(s)) return 'Benefícios | Saúde corporativa';
  if (/sst|seguranca|ocupacional|epp|epi/.test(s)) return 'SST | Saúde ocupacional';
  if (/financeiro|compras|suprimento|payments/.test(s)) return 'Financeiro | Compras';
  if (/juri|compliance|legal|regula/.test(s)) return 'Jurídico | Compliance';
  return 'Público geral';
}

function statusMeta(status) {
  const raw = String(status || '').toUpperCase();
  return STATUS_META[raw] || {
    label: raw || 'Status desconhecido',
    group: 'unknown',
    severity: 'teal',
    action: 'Validar status na Treble'
  };
}

function sanitizeMessage(r) {
  const flow = String(r.flow || 'Flow sem nome');
  const rawStatus = String(r.status || 'UNKNOWN').toUpperCase();
  const meta = statusMeta(rawStatus);
  const replied = Number(r.replied_real || 0) > 0;
  const delivered = Number(r.delivered_real || 0) > 0 || rawStatus === 'DELIVERED' || replied;
  const agent = agentForRow(Object.assign({}, r, { flow }));
  const family = copyFamily(flow);
  const audience = inferAudience(flow);

  return {
    flow,
    pollId: r.poll_id == null ? '' : String(r.poll_id),
    createdAt: r.created_at || '',
    createdDay: r.created_day || '',
    agent: agent.agent,
    agentSource: agent.agentSource,
    agentConfidence: agent.agentConfidence,
    bdr: agent.agent,
    bdrSource: agent.agentSource === 'direct'
      ? 'Match direto em dim_agents por origin_id'
      : (agent.agentSource === 'flow_rule'
        ? 'Regra de negócio pelo construtor do flow'
        : (agent.agentSource === 'flow_inference' ? 'Inferido do nome do flow' : 'Não identificado')),
    family,
    audience,
    semanticGroup: family + ' | ' + audience + ' | ' + meta.label,
    sent: true,
    delivered,
    replied,
    read: false,
    readAvailable: false,
    status: rawStatus,
    statusLabel: meta.label,
    statusGroup: meta.group,
    reason: delivered ? (replied ? 'responded' : 'delivered_no_reply') : meta.group,
    reasonLabel: delivered ? (replied ? 'Respondeu' : 'Entregue, sem resposta') : meta.label,
    severity: meta.severity,
    action: replied && meta.group !== 'delivered'
      ? meta.action + ' | resposta existe, mas status bruto segue como falha/processamento'
      : meta.action,
    nonDeliveryReason: meta.group === 'delivered' ? '' : rawStatus,
    diagnostic: false
  };
}

function assertNoPii(obj) {
  const bad = [];

  function walk(x) {
    if (!x || typeof x !== 'object') return;
    Object.keys(x).forEach(function (k) {
      if (PII_KEYS[k.toLowerCase()]) bad.push(k);
      walk(x[k]);
    });
  }

  walk(obj);
  if (bad.length) throw new Error('pii_key_in_payload');
}

function sourceLabelForAgent(a) {
  const counts = [
    { key: 'direct', value: a.direct },
    { key: 'flow_rule', value: a.rule },
    { key: 'flow_inference', value: a.inferred },
    { key: 'unknown', value: a.unknown }
  ].sort(function (x, y) { return y.value - x.value; });

  return counts[0].key;
}

function aggregateMessages(messages) {
  const summary = {
    sessions: messages.length,
    enviadas: messages.length,
    sent: messages.length,
    entregues: 0,
    delivered: 0,
    lidas: 0,
    read: 0,
    respondidas: 0,
    replied: 0,
    falhas: 0,
    failures: 0,
    deploymentFailures: 0,
    flowsCount: 0,
    bdrsCount: 0
  };

  const status = {};
  const agents = {};
  const days = {};
  const flows = {};
  const reasons = {};

  messages.forEach(function (m) {
    if (m.delivered) {
      summary.entregues += 1;
      summary.delivered += 1;
    } else {
      summary.falhas += 1;
      summary.failures += 1;
      summary.deploymentFailures += 1;
    }

    if (m.replied) {
      summary.respondidas += 1;
      summary.replied += 1;
    }

    flows[m.flow] = flows[m.flow] || {
      flow: m.flow,
      bdr: m.bdr,
      family: m.family,
      audience: m.audience,
      enviadas: 0,
      entregues: 0,
      respondidas: 0,
      falhas: 0,
      deploymentFailures: 0
    };
    flows[m.flow].enviadas += 1;
    if (m.delivered) flows[m.flow].entregues += 1;
    else {
      flows[m.flow].falhas += 1;
      flows[m.flow].deploymentFailures += 1;
    }
    if (m.replied) flows[m.flow].respondidas += 1;

    status[m.status] = status[m.status] || {
      status: m.status,
      statusLabel: m.statusLabel,
      statusGroup: m.statusGroup,
      action: m.action,
      count: 0,
      delivered: 0,
      replied: 0
    };
    status[m.status].count += 1;
    if (m.delivered) status[m.status].delivered += 1;
    if (m.replied) status[m.status].replied += 1;

    agents[m.agent] = agents[m.agent] || {
      agent: m.agent,
      bdr: m.agent,
      attempts: 0,
      delivered: 0,
      replied: 0,
      notDelivered: 0,
      flows: {},
      direct: 0,
      inferred: 0,
      unknown: 0,
      rule: 0
    };
    agents[m.agent].attempts += 1;
    if (m.delivered) agents[m.agent].delivered += 1;
    else agents[m.agent].notDelivered += 1;
    if (m.replied) agents[m.agent].replied += 1;
    agents[m.agent].flows[m.flow] = true;
    if (m.agentSource === 'direct') agents[m.agent].direct += 1;
    else if (m.agentSource === 'flow_rule') agents[m.agent].rule += 1;
    else if (m.agentSource === 'flow_inference') agents[m.agent].inferred += 1;
    else agents[m.agent].unknown += 1;

    days[m.createdDay] = days[m.createdDay] || {
      dia: m.createdDay,
      day: m.createdDay,
      createdDay: m.createdDay,
      enviadas: 0,
      sent: 0,
      entregues: 0,
      delivered: 0,
      lidas: 0,
      read: 0,
      respondidas: 0,
      replied: 0,
      deploymentFailures: 0
    };
    days[m.createdDay].enviadas += 1;
    days[m.createdDay].sent += 1;
    if (m.delivered) {
      days[m.createdDay].entregues += 1;
      days[m.createdDay].delivered += 1;
    } else {
      days[m.createdDay].deploymentFailures += 1;
    }
    if (m.replied) {
      days[m.createdDay].respondidas += 1;
      days[m.createdDay].replied += 1;
    }

    reasons[m.reasonLabel] = reasons[m.reasonLabel] || {
      reason: m.reason,
      label: m.reasonLabel,
      count: 0,
      severity: m.severity,
      action: m.action
    };
    reasons[m.reasonLabel].count += 1;
  });

  const total = messages.length;
  const byStatus = Object.keys(status).map(function (k) {
    const a = status[k];
    a.pct = pct(a.count, total);
    return a;
  }).sort(function (a, b) { return b.count - a.count; });

  const byAgent = Object.keys(agents).map(function (k) {
    const a = agents[k];
    a.flowsCount = Object.keys(a.flows).length;
    delete a.flows;
    a.deliveryRate = pct(a.delivered, a.attempts);
    a.responseRate = pct(a.replied, a.attempts);
    a.sourceLabel = sourceLabelForAgent(a);
    return a;
  }).sort(function (a, b) { return b.attempts - a.attempts; });

  const byFlow = Object.keys(flows).map(function (k) {
    const a = flows[k];
    a.taxaEntrega = pct(a.entregues, a.enviadas);
    a.taxaResposta = pct(a.respondidas, a.enviadas);
    return a;
  }).sort(function (a, b) { return b.enviadas - a.enviadas; });

  const timeline = Object.keys(days).map(function (k) { return days[k]; })
    .sort(function (a, b) { return String(a.dia).localeCompare(String(b.dia)); });

  const byReason = Object.keys(reasons).map(function (k) { return reasons[k]; })
    .sort(function (a, b) { return b.count - a.count; });

  const direct = messages.filter(function (m) { return m.agentSource === 'direct'; }).length;
  const rule = messages.filter(function (m) { return m.agentSource === 'flow_rule'; }).length;
  const inferred = messages.filter(function (m) { return m.agentSource === 'flow_inference'; }).length;
  const unknown = total - direct - rule - inferred;

  summary.flowsCount = byFlow.length;
  summary.bdrsCount = byAgent.length;
  summary.taxaEntrega = pct(summary.entregues, summary.enviadas);
  summary.taxaResposta = pct(summary.respondidas, summary.enviadas);
  summary.taxaLeitura = null;
  summary.readMetricAvailable = false;
  summary.deliveryAnalyticsAvailable = true;
  summary.deliveryAnalyticsStatus = 'clickhouse_fact_deployment_status';
  summary.realObservedAttempts = summary.enviadas;
  summary.realObservedDeliveryRate = summary.enviadas ? summary.entregues / summary.enviadas : null;

  return {
    summary,
    timeline,
    byFlow,
    byBdr: byAgent.map(function (a) {
      return {
        bdr: a.agent,
        enviadas: a.attempts,
        entregues: a.delivered,
        respondidas: a.replied,
        falhas: a.notDelivered,
        deploymentFailures: a.notDelivered,
        flowsCount: a.flowsCount,
        taxaEntrega: a.deliveryRate,
        taxaResposta: a.responseRate
      };
    }),
    byReason,
    byStatus,
    byAgent,
    attributionCoverage: {
      total,
      direct,
      rule,
      inferred,
      unknown,
      directPct: pct(direct, total),
      rulePct: pct(rule, total),
      inferredPct: pct(inferred, total),
      unknownPct: pct(unknown, total),
      attributedPct: pct(direct + rule + inferred, total)
    }
  };
}

function buildSql(range) {
  const from = quoteSql(range.from);
  const to = quoteSql(range.to);

  return [
    'SELECT',
    "  formatDateTime(toTimeZone(f.timestamps_eta, 'America/Sao_Paulo'), '%Y-%m-%dT%H:%i:%S-03:00') AS created_at,",
    "  toString(toDate(toTimeZone(f.timestamps_eta, 'America/Sao_Paulo'))) AS created_day,",
    '  toString(f.status) AS status,',
    '  toString(f.poll_id) AS poll_id,',
    '  toString(f.poll_name) AS flow,',
    '  toString(a.first_name) AS agent_first_name,',
    '  toString(a.last_name) AS agent_last_name,',
    '  if(f.timestamp_delivered > ' + SENTINEL_SQL + " OR f.status = 'DELIVERED', 1, 0) AS delivered_real,",
    '  if(f.timestamp_responded > ' + SENTINEL_SQL + ', 1, 0) AS replied_real',
    'FROM client_analytics.fact_deployment_status f',
    'LEFT ANY JOIN client_analytics.dim_agents a ON f.origin_id = a.id',
    "WHERE toDate(toTimeZone(f.timestamps_eta, 'America/Sao_Paulo')) >= toDate(" + from + ')',
    "  AND toDate(toTimeZone(f.timestamps_eta, 'America/Sao_Paulo')) <= toDate(" + to + ')',
    'ORDER BY f.timestamps_eta DESC',
    'LIMIT ' + QUERY_LIMIT,
    'FORMAT JSON'
  ].join('\n');
}

function buildApiMap() {
  return [
    {
      step: 1,
      method: 'GET',
      endpoint: 'Browser /novo-bdr/treble',
      purpose: 'Usuário seleciona preset ou intervalo customizado',
      returns: 'preset/from/to sem PII',
      usedFor: 'Filtro narrativo da UI'
    },
    {
      step: 2,
      method: 'Auth',
      endpoint: '/api/auth/me + requireAuth',
      purpose: 'Proteger dashboard interno',
      returns: 'Sessão autorizada',
      usedFor: 'Fail-closed antes de dados'
    },
    {
      step: 3,
      method: 'GET',
      endpoint: '/api/bdr-treble-dw',
      purpose: 'Validar datas BRT e montar SQL seguro',
      returns: 'Contrato sanitizado',
      usedFor: 'KPIs, status, agentes e arquitetura'
    },
    {
      step: 4,
      method: 'POST',
      endpoint: 'ClickHouse HTTP | fact_deployment_status LEFT ANY JOIN dim_agents',
      purpose: 'Tentativas reais + nome/sobrenome do agente quando origin_id casa',
      returns: 'Linhas sem email/telefone/conteúdo/origin_id',
      usedFor: 'Entregas, falhas, respostas e atribuição'
    },
    {
      step: 5,
      method: 'Sanitização',
      endpoint: 'API server-side',
      purpose: 'Mapear status bruto, inferir agente por flow e remover PII',
      returns: 'messages/byStatus/byAgent/coverage',
      usedFor: 'Storytelling with Data na UI'
    }
  ];
}

async function buildPayloadFromDW(range) {
  const creds = getClickHouseCredentials();
  const result = await clickhouseQuery(creds, buildSql(range));
  const rawRows = result.rows || [];
  const truncated = rawRows.length > ROW_LIMIT;
  const messages = rawRows.slice(0, ROW_LIMIT).map(sanitizeMessage);
  const agg = aggregateMessages(messages);

  const payload = {
    success: true,
    source: 'treble_data_warehouse',
    generatedAt: new Date().toISOString(),
    cached: false,
    days: range.days,
    dateRange: range,
    messages,
    summary: agg.summary,
    timeline: agg.timeline,
    byFlow: agg.byFlow,
    byBdr: agg.byBdr,
    byStatus: agg.byStatus,
    byAgent: agg.byAgent,
    attributionCoverage: agg.attributionCoverage,
    byReason: agg.byReason,
    sessions: [],
    deploymentReport: {
      available: true,
      source: 'client_analytics.fact_deployment_status',
      byDay: agg.timeline,
      byConversationDay: []
    },
    meta: {
      source: 'Treble Data Warehouse (ClickHouse)',
      sourceLabel: 'Treble Data Warehouse (ClickHouse)',
      timezone: TZ,
      freshness: 'Consulta live com cache de 10 minutos no servidor',
      dateRange: range,
      periodDays: range.days,
      rowsReturned: messages.length,
      rowLimit: ROW_LIMIT,
      rowsTruncated: truncated,
      readMetricAvailable: false,
      readMetricLabel: 'Indisponível nesta fato',
      metricContract: 'Tentativas = linhas de fact_deployment_status; Entregues = timestamp_delivered válido ou status DELIVERED; resposta válida também entra no funil como entregue; statusLabel/statusGroup preservam sempre o status bruto; SUCCESS isolado = processado sem confirmação; Leitura indisponível.',
      privacy: 'Sem telefone, email, documento, origin_id, deployment_id, batch_id, treble_id, conteúdo ou payload bruto; dim_agents retorna somente nome e sobrenome.',
      limitations: [
        'Retenção e filtros limitados a no máximo 90 dias',
        'Leitura continua indisponível em fact_deployment_status',
        'Atribuição direta só quando origin_id faz match com dim_agents.id',
        'Flows de regra de negócio (pesquisa RH / experimento outbound = Samuel Alencar; deal4b = Gabriel Milan) são atribuídos pelo construtor do flow, com precedência sobre a inferência por nome',
        'Demais responsáveis são inferidos pelo nome do flow; origin_id sem match, como 59580, não vira pessoa'
      ]
    },
    apiMap: buildApiMap()
  };

  assertNoPii(payload);
  return payload;
}

function cacheKey(range) {
  return 'dw-' + range.preset + '-' + range.from + '-' + range.to;
}

function getFromCache(key) {
  const entry = cacheByKey[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    delete cacheByKey[key];
    return null;
  }
  return entry.payload;
}

function setCache(key, payload) {
  cacheByKey[key] = { payload, ts: Date.now() };
}

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!methodCheck(req, res, 'GET')) return;

  let range;
  try {
    range = resolveDateRange(req.query || {});
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }

  const key = cacheKey(range);
  const refresh = String(req.query.refresh || '') === 'true' || String(req.query.refresh || '') === '1';
  const cached = refresh ? null : getFromCache(key);
  if (cached) return res.json(Object.assign({}, cached, { cached: true }));

  try {
    const payload = await buildPayloadFromDW(range);
    setCache(key, payload);
    res.json(payload);
  } catch (e) {
    console.error('[bdr-treble-dw] Error:', e && e.message ? e.message : 'unknown');
    res.status(500).json({
      success: false,
      error: 'data_warehouse_error',
      message: 'Falha ao consultar Treble Data Warehouse. Fallback REST disponível no frontend.',
      hint: 'Verificar configuração do Data Warehouse sem expor credenciais.'
    });
  }
};

module.exports._test = {
  buildSql,
  clickhouseQuery,
  buildPayloadFromDW,
  resolveDateRange,
  sanitizeMessage,
  aggregateMessages,
  assertNoPii,
  agentFromFlowRule,
  inferAgentFromFlow,
  ROW_LIMIT
};
