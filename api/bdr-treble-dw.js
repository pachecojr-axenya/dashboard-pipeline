'use strict';

/**
 * GET /api/bdr-treble-dw
 *
 * Contrato V10 do dashboard /novo-bdr/treble.
 * - Fonte primária: client_analytics.fact_deployment_status (ClickHouse Treble DW).
 * - Granularidade: uma linha sanitizada por tentativa real de envio.
 * - Privacidade: não retorna telefone, email, conteúdo, deployment_id, batch_id,
 *   treble_id, origin_id nem payload bruto.
 * - Atribuição: direta via origin_id -> dim_agents.id quando disponível; senão,
 *   inferência conservadora pelo nome do flow.
 *
 * V10 acrescenta, do macro ao granular, o que a Treble entrega e a tela não lia:
 * 1. `origin` | separa HSM disparado do inbox Sales.ai do disparo por API/CSV.
 * 2. Grão de tentativa POR LEAD (`leadKey` pseudônimo + `attemptSeq` + intervalo
 *    desde a tentativa anterior), que é o que faltava para "cada envio/tentativa".
 * 3. Tempo real de cada etapa: latência até entrega, até resposta, e o instante
 *    da falha (`timestamp_failure`), que nunca era selecionado.
 * 4. HSM como dimensão, por join em dim_hsm com a cobertura declarada na tela.
 * 5. Leitura por `fact_agent_messages` (read_at), com ressalva de cobertura.
 * 6. Desfechos que a fato de status não expressa (`to_agents`, `in_process`,
 *    `optout`, `revoked`, `failure_rate_limit`) via fact_deployment_daily.
 * 7. Reconciliação com fact_deployment_daily, o pré-agregado da própria Treble.
 *
 * ATENÇÃO à régua de dia: `fact_deployment_daily.day` é UTC e a tela é BRT
 * (medido 11/08/2026 | 23/07: daily 618, UTC 618, BRT 611). A reconciliação
 * roda em UTC nas DUAS pontas de propósito: comparar régua diferente produziria
 * divergência permanente por fuso, que é o mesmo mal do check que reprova por
 * design. A contagem BRT viaja no mesmo bloco, rotulada.
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

// Sal fixo do pseudônimo de lead. NÃO é segredo e não pretende ser: existe para
// que a mesma pessoa some as tentativas dela na tela sem o telefone sair do
// servidor. O espaço de telefones brasileiros é pequeno, então isto é
// PSEUDONIMIZAÇÃO (reversível por força bruta por quem tem o sal), não
// anonimização — e é assim que o payload declara.
const LEAD_SALT = 'axenya-treble-lead-v10';
const LEAD_KEY_CHARS = 12;

// Origem do disparo. É o corte mais macro que faltava: a mesma tela somava HSM
// enviado à mão no inbox da Sales.ai com blast por API e carga de CSV.
const ORIGIN_META = {
  HELPDESK_INTEGRATION: {
    label: 'Inbox Sales.ai',
    description: 'HSM disparado de dentro do atendimento, um lead por vez',
    manual: true
  },
  API: {
    label: 'API de deployment',
    description: 'Disparo por comando/automação nossa via deployment API',
    manual: false
  },
  CSV: {
    label: 'Carga CSV',
    description: 'Lote subido na Treble por planilha',
    manual: false
  },
  SIMPLE: {
    label: 'Envio simples',
    description: 'Disparo simples pela UI da Treble',
    manual: true
  }
};

// Faixas de tentativa por lead. A 4ª+ vira uma faixa só porque abaixo disso o
// volume por número já é rarefeito e ler linha a linha não decide nada.
const ATTEMPT_BUCKETS = [
  { key: '1', label: '1ª tentativa', min: 1, max: 1 },
  { key: '2', label: '2ª tentativa', min: 2, max: 2 },
  { key: '3', label: '3ª tentativa', min: 3, max: 3 },
  { key: '4+', label: '4ª ou mais', min: 4, max: Infinity }
];

// Acima disto, um mesmo número recebendo tentativas deixa de ser cadência e
// passa a ser número de teste/robô poluindo o denominador. Medido em 11/08/2026:
// um único número com 120 tentativas em 67 flows distintos.
const LEAD_OUTLIER_ATTEMPTS = 12;

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
// normalizeText remove acentos e caixa; separadores (espaço, _, -, .) são tratados como
// um único delimitador (SEP) para casar nomes de flow como PESQUISA_RH_CONARH_... .
const SEP = '[\\s._-]*';
const FLOW_AGENT_RULES = [
  {
    agent: 'Samuel Alencar',
    match: function (s) {
      return new RegExp('pesquisa' + SEP + 'rh').test(s) ||
        new RegExp('exp' + SEP + 'outbound').test(s) ||
        new RegExp('outbound' + SEP + 'exp').test(s) ||
        new RegExp('experimento' + SEP + 'outbound').test(s);
    }
  },
  { agent: 'Gabriel Milan', match: function (s) { return new RegExp('deal' + SEP + '4' + SEP + 'b').test(s); } }
];

// Apelidos/primeiros nomes que aparecem no poll_name -> nome canônico do roster
// (lib/bdr-team.js). Alinhado ao roster para não duplicar o mesmo BDR com nomes
// diferentes entre painéis. Samuel/Gabriel Milan não são BDRs do roster, mas
// constroem flows (mesma lógica de autoria).
const AGENT_ALIASES = {
  gabi: 'Gabriele Almeida',
  gabriele: 'Gabriele Almeida',
  leticia: 'Leticia Romão',
  giovana: 'Giovana Nunes',
  thauan: 'Thauan Pontes',
  felipe: 'Felipe Andrade',
  cintia: 'Cintia Rodrigues',
  cynthia: 'Cintia Rodrigues',
  marcelli: 'Marcelli Netto',
  yoky: 'Yokyko Muramoto',
  yokyko: 'Yokyko Muramoto',
  bruna: 'Bruna Reis',
  bru: 'Bruna Reis',
  anderson: 'Anderson Souza',
  andy: 'Anderson Souza',
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
  cintia: 'Cintia Rodrigues',
  marcelli: 'Marcelli Netto',
  yokyko: 'Yokyko Muramoto',
  bruna: 'Bruna Reis',
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

const STALE_THRESHOLD_MINUTES = 180;
const STALE_HARD_THRESHOLD_MINUTES = 1440;

// Período (BRT) inclui o dia de hoje? Usado só para política de cache: recorte que
// inclui hoje e voltou vazio não vai para o cache, porque a próxima linha pode
// chegar a qualquer momento.
function periodIncludesToday(range) {
  const today = dateStr(todayBrtDate());
  return range.from <= today && range.to >= today;
}

// Maior timestamps_eta já retornado/selecionado (via created_at, já derivado de
// timestamps_eta na SQL). Sem PII: usa só o campo de data já sanitizado.
function latestEventFromMessages(messages) {
  let latestMs = null;
  let latestIso = null;

  for (let i = 0; i < messages.length; i += 1) {
    const iso = messages[i] && messages[i].createdAt;
    if (!iso) continue;

    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) continue;

    if (latestMs === null || ms > latestMs) {
      latestMs = ms;
      latestIso = iso;
    }
  }

  return latestIso;
}

// Dia (YYYY-MM-DD) do evento mais recente, sempre em America/Sao_Paulo.
function brtDayFromIso(iso) {
  if (!iso) return null;

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);

  const m = {};
  parts.forEach(function (p) { m[p.type] = p.value; });
  return m.year + '-' + m.month + '-' + m.day;
}

// Minutos inteiros não-negativos entre agora e o último evento, ou null se
// não houver evento.
function freshnessAgeMinutes(latestIso, nowMs) {
  if (!latestIso) return null;

  const ms = Date.parse(latestIso);
  if (Number.isNaN(ms)) return null;

  const minutes = Math.round((nowMs - ms) / 60000);
  return minutes < 0 ? 0 : minutes;
}

// Frescor é propriedade do WAREHOUSE, não do recorte. Recorte sem linhas é
// resposta legítima ("ninguém disparou nesse período") e NÃO pode ser lido como
// dado velho — foi exatamente essa confusão que fazia o filtro "Hoje" trocar de
// fonte e exibir 30 dias de REST. Aqui a idade vem sempre do último evento
// existente na fato inteira.
function computeWarehouseStale(ageMinutes) {
  if (ageMinutes === null) return true;
  return ageMinutes > STALE_THRESHOLD_MINUTES;
}

function computeWarehouseHardStale(ageMinutes) {
  if (ageMinutes === null) return true;
  return ageMinutes > STALE_HARD_THRESHOLD_MINUTES;
}

function buildWarehouseState(latestIso, nowMs) {
  const ageMinutes = freshnessAgeMinutes(latestIso, nowMs);
  return {
    latestEventAt: latestIso || null,
    latestEventDay: brtDayFromIso(latestIso) || null,
    ageMinutes,
    stale: computeWarehouseStale(ageMinutes),
    hardStale: computeWarehouseHardStale(ageMinutes),
    staleThresholdMinutes: STALE_THRESHOLD_MINUTES,
    hardStaleThresholdMinutes: STALE_HARD_THRESHOLD_MINUTES
  };
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

function originMeta(origin) {
  const raw = String(origin || '').toUpperCase();
  return ORIGIN_META[raw] || {
    label: raw || 'Origem desconhecida',
    description: 'Origem não catalogada na Treble',
    manual: false
  };
}

// -1 é o "não medido" que vem da SQL (não houve entrega/resposta/tentativa
// anterior). Virar 0 aqui contaminaria mediana e média com falso zero.
function lagOrNull(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function attemptBucket(seq) {
  const n = Number(seq) || 0;
  for (let i = 0; i < ATTEMPT_BUCKETS.length; i += 1) {
    const b = ATTEMPT_BUCKETS[i];
    if (n >= b.min && n <= b.max) return b;
  }
  return ATTEMPT_BUCKETS[0];
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
  const origin = String(r.origin || '').toUpperCase();
  const oMeta = originMeta(origin);
  const attemptSeq = Number(r.attempt_seq) || 1;
  const leadAttemptsTotal = Number(r.lead_attempts_total) || 1;
  const bucket = attemptBucket(attemptSeq);
  const hsmName = String(r.hsm_name || '');

  return {
    flow,
    origin,
    originLabel: oMeta.label,
    originDescription: oMeta.description,
    originManual: oMeta.manual,
    leadKey: String(r.lead_key || ''),
    attemptSeq,
    leadAttemptsTotal,
    attemptBucket: bucket.key,
    attemptBucketLabel: bucket.label,
    firstAttempt: attemptSeq === 1,
    leadOutlier: leadAttemptsTotal >= LEAD_OUTLIER_ATTEMPTS,
    gapPrevHours: lagOrNull(r.gap_prev_hours),
    deliveryLagSec: lagOrNull(r.delivery_lag_sec),
    responseLagSec: lagOrNull(r.response_lag_sec),
    failedAt: String(r.failed_at || ''),
    hsm: hsmName,
    hsmMatched: !!hsmName,
    hsmStatus: String(r.hsm_status || ''),
    hsmCategory: String(r.hsm_category || ''),
    hsmType: String(r.hsm_type || ''),
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

// Percentil EXATO por ordenação. Cabe porque o teto de linhas é 10k: não há
// motivo para aproximar, e aproximado erra em RANK, não em valor, o que
// atrapalharia justamente a leitura de cauda (p90) que interessa aqui.
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function describeLag(values) {
  const sorted = values.filter(function (v) { return v != null; }).sort(function (a, b) { return a - b; });
  return {
    n: sorted.length,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    min: sorted.length ? sorted[0] : null,
    max: sorted.length ? sorted[sorted.length - 1] : null
  };
}

function emptyBucketCounters(extra) {
  return Object.assign({
    attempts: 0,
    delivered: 0,
    notDelivered: 0,
    replied: 0
  }, extra || {});
}

function countInto(target, m) {
  target.attempts += 1;
  if (m.delivered) target.delivered += 1;
  else target.notDelivered += 1;
  if (m.replied) target.replied += 1;
}

function withRates(o) {
  o.deliveryRate = pct(o.delivered, o.attempts);
  o.responseRate = pct(o.replied, o.attempts);
  return o;
}

function aggregateOrigin(messages) {
  const map = {};
  messages.forEach(function (m) {
    const k = m.origin || 'DESCONHECIDA';
    map[k] = map[k] || emptyBucketCounters({
      origin: k,
      label: m.originLabel,
      description: m.originDescription,
      manual: m.originManual,
      flows: {}
    });
    countInto(map[k], m);
    map[k].flows[m.flow] = true;
  });
  return Object.keys(map).map(function (k) {
    const o = map[k];
    o.flowsCount = Object.keys(o.flows).length;
    delete o.flows;
    return withRates(o);
  }).sort(function (a, b) { return b.attempts - a.attempts; });
}

function aggregateAttempts(messages) {
  const map = {};
  ATTEMPT_BUCKETS.forEach(function (b) {
    map[b.key] = emptyBucketCounters({ bucket: b.key, label: b.label });
  });
  messages.forEach(function (m) {
    countInto(map[m.attemptBucket] || map['1'], m);
  });
  return ATTEMPT_BUCKETS.map(function (b) { return withRates(map[b.key]); });
}

// Aqui vive a resposta de "cada envio e cada tentativa": quantas PESSOAS
// distintas estão por trás das tentativas do recorte, quantas levaram mais de
// uma, e quais números têm cara de teste e por isso inflam o denominador.
function aggregateLeads(messages) {
  const byLead = {};
  messages.forEach(function (m) {
    const k = m.leadKey || 'sem-chave';
    byLead[k] = byLead[k] || {
      leadKey: k,
      attemptsInPeriod: 0,
      attemptsAllTime: m.leadAttemptsTotal,
      delivered: 0,
      replied: 0,
      flows: {},
      firstAt: m.createdAt,
      lastAt: m.createdAt
    };
    const l = byLead[k];
    l.attemptsInPeriod += 1;
    l.attemptsAllTime = Math.max(l.attemptsAllTime, m.leadAttemptsTotal);
    if (m.delivered) l.delivered += 1;
    if (m.replied) l.replied += 1;
    l.flows[m.flow] = true;
    if (m.createdAt && m.createdAt < l.firstAt) l.firstAt = m.createdAt;
    if (m.createdAt && m.createdAt > l.lastAt) l.lastAt = m.createdAt;
  });

  const leads = Object.keys(byLead).map(function (k) {
    const l = byLead[k];
    l.flowsCount = Object.keys(l.flows).length;
    delete l.flows;
    return l;
  });

  const reattemptedInPeriod = leads.filter(function (l) { return l.attemptsInPeriod > 1; }).length;
  const outliers = leads.filter(function (l) { return l.attemptsAllTime >= LEAD_OUTLIER_ATTEMPTS; })
    .sort(function (a, b) { return b.attemptsAllTime - a.attemptsAllTime; });
  const outlierAttempts = outliers.reduce(function (sum, l) { return sum + l.attemptsInPeriod; }, 0);

  return {
    uniqueLeads: leads.length,
    attempts: messages.length,
    attemptsPerLead: leads.length ? Math.round((messages.length / leads.length) * 100) / 100 : null,
    reattemptedInPeriod,
    reattemptedPct: pct(reattemptedInPeriod, leads.length),
    firstAttempts: messages.filter(function (m) { return m.firstAttempt; }).length,
    outlierThreshold: LEAD_OUTLIER_ATTEMPTS,
    outlierLeads: outliers.length,
    outlierAttempts,
    outlierAttemptsPct: pct(outlierAttempts, messages.length),
    topLeads: leads.sort(function (a, b) {
      return b.attemptsInPeriod - a.attemptsInPeriod || b.attemptsAllTime - a.attemptsAllTime;
    }).slice(0, 20)
  };
}

function aggregateLatency(messages) {
  return {
    deliverySec: describeLag(messages.map(function (m) { return m.deliveryLagSec; })),
    responseSec: describeLag(messages.map(function (m) { return m.responseLagSec; })),
    gapPrevHours: describeLag(messages.map(function (m) { return m.gapPrevHours; }))
  };
}

// HSM é a dimensão mais granular que a Treble entrega — e o join é por NOME,
// porque fact_deployment_status não tem hsm_id. Logo a cobertura é parcial por
// construção e viaja no bloco: sem ela, uma tabela de 11% dos disparos passaria
// por leitura completa de template.
function aggregateHsm(messages) {
  const map = {};
  let matched = 0;
  messages.forEach(function (m) {
    if (!m.hsmMatched) return;
    matched += 1;
    const k = m.hsm;
    map[k] = map[k] || emptyBucketCounters({
      hsm: k,
      hsmStatus: m.hsmStatus,
      hsmCategory: m.hsmCategory,
      hsmType: m.hsmType,
      flows: {}
    });
    countInto(map[k], m);
    map[k].flows[m.flow] = true;
  });

  const rows = Object.keys(map).map(function (k) {
    const o = map[k];
    o.flowsCount = Object.keys(o.flows).length;
    delete o.flows;
    return withRates(o);
  }).sort(function (a, b) { return b.attempts - a.attempts; });

  return {
    coverage: {
      matched,
      total: messages.length,
      matchedPct: pct(matched, messages.length),
      rule: 'join dim_hsm.name = fact_deployment_status.poll_name',
      caveat: 'A fato de deployment não tem hsm_id. O template só é nomeado quando o flow foi batizado igual ao HSM; o resto fica sem template, não em branco por falta de envio.'
    },
    rows
  };
}

// Erro deixa de ser total agregado e passa a ter ONDE e QUANDO: concentração por
// flow (é o que separa variável mal configurada de reputação de template) e a
// hora do dia da falha, que só existe porque timestamp_failure entrou na SQL.
function aggregateErrors(messages) {
  const fails = messages.filter(function (m) { return m.statusGroup !== 'delivered'; });
  const map = {};

  fails.forEach(function (m) {
    const k = m.status;
    map[k] = map[k] || {
      status: k,
      statusLabel: m.statusLabel,
      statusGroup: m.statusGroup,
      severity: m.severity,
      action: m.action,
      count: 0,
      withFailureTimestamp: 0,
      flows: {},
      hsmStatuses: {}
    };
    map[k].count += 1;
    if (m.failedAt) map[k].withFailureTimestamp += 1;
    map[k].flows[m.flow] = (map[k].flows[m.flow] || 0) + 1;
    if (m.hsmStatus) map[k].hsmStatuses[m.hsmStatus] = (map[k].hsmStatuses[m.hsmStatus] || 0) + 1;
  });

  const rows = Object.keys(map).map(function (k) {
    const e = map[k];
    const flows = Object.keys(e.flows).map(function (f) {
      return { flow: f, count: e.flows[f], pct: pct(e.flows[f], e.count) };
    }).sort(function (a, b) { return b.count - a.count; });
    e.flowsCount = flows.length;
    e.topFlows = flows.slice(0, 8);
    e.concentrationPct = flows.length ? pct(flows[0].count, e.count) : null;
    e.hsmStatusList = Object.keys(e.hsmStatuses).map(function (s) {
      return { status: s, count: e.hsmStatuses[s] };
    }).sort(function (a, b) { return b.count - a.count; });
    delete e.flows;
    delete e.hsmStatuses;
    e.pct = pct(e.count, fails.length);
    return e;
  }).sort(function (a, b) { return b.count - a.count; });

  return {
    totalNotDelivered: fails.length,
    notDeliveredPct: pct(fails.length, messages.length),
    withFailureTimestamp: fails.filter(function (m) { return !!m.failedAt; }).length,
    rows
  };
}

// Divergência aceitável entre a fato e o pré-agregado da Treble. Não é
// tolerância de arredondamento: é o desacordo residual medido em 11/08/2026 na
// fato inteira (sent 4.732 vs 4.734, delivered 2.856 vs 2.857, responded
// 381 = 381), que vem de linha ingerida entre a materialização do daily e a
// leitura da fato. Acima disso, a tela precisa DIZER que discordou.
const PARITY_ABS_TOLERANCE = 5;
const PARITY_PCT_TOLERANCE = 0.5;

function parityVerdict(diffAbs, base) {
  const relative = base ? Math.abs(diffAbs) / base * 100 : 0;
  if (Math.abs(diffAbs) <= PARITY_ABS_TOLERANCE) return 'ok';
  if (relative <= PARITY_PCT_TOLERANCE) return 'ok';
  return 'divergente';
}

function buildParityBlock(row, brtAttempts) {
  if (!row) {
    return {
      available: false,
      reason: 'fact_deployment_daily não respondeu',
      note: 'Sem segundo caminho, os números desta tela não têm prova independente nesta carga.'
    };
  }

  const n = function (v) { return Number(v || 0); };
  const pairs = [
    { metric: 'Tentativas', daily: n(row.daily_sent), fact: n(row.fact_sent_utc) },
    { metric: 'Entregues', daily: n(row.daily_delivered), fact: n(row.fact_delivered_utc) },
    { metric: 'Respondidas', daily: n(row.daily_responded), fact: n(row.fact_responded_utc) }
  ].map(function (p) {
    p.diff = p.fact - p.daily;
    p.diffPct = p.daily ? Math.round((p.diff / p.daily) * 1000) / 10 : null;
    p.verdict = parityVerdict(p.diff, p.daily);
    return p;
  });

  const worst = pairs.filter(function (p) { return p.verdict !== 'ok'; })
    .sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); })[0] || null;

  return {
    available: true,
    ruler: 'utc',
    rulerNote: 'fact_deployment_daily.day é UTC. As duas pontas desta tabela contam em UTC; a tela conta em BRT, então o total daqui não bate com o KPI de cima por fuso, não por defeito.',
    brtAttempts,
    utcAttempts: n(row.fact_sent_utc),
    timezoneDelta: n(row.fact_sent_utc) - n(brtAttempts || 0),
    pairs,
    verdict: worst ? 'divergente' : 'ok',
    worstMetric: worst ? worst.metric : null,
    toleranceAbs: PARITY_ABS_TOLERANCE,
    tolerancePct: PARITY_PCT_TOLERANCE,
    outcomes: {
      inProcess: n(row.daily_in_process),
      toAgents: n(row.daily_to_agents),
      optout: n(row.daily_optout),
      revoked: n(row.daily_revoked),
      rateLimit: n(row.daily_rate_limit),
      invalidPhone: n(row.daily_invalid_phone),
      failure: n(row.daily_failure)
    },
    outcomesNote: 'in_process, to_agents, optout, revoked e failure_rate_limit só existem no pré-agregado; a fato de status não tem coluna para eles. optout e revoked são risco de reputação no WhatsApp e por isso aparecem mesmo em zero.'
  };
}

// Leitura de HSM/mensagem. O bloco existe para corrigir uma afirmação da tela
// antiga: "leitura indisponível" é verdade em fact_deployment_status, não no
// armazém. A cobertura é parcial e declarada.
function buildReadBlock(rows) {
  const list = (rows || []).map(function (r) {
    const total = Number(r.total || 0);
    const entregues = Number(r.entregues || 0);
    const lidas = Number(r.lidas || 0);
    return {
      sender: String(r.sender || ''),
      category: String(r.category || ''),
      total,
      entregues,
      lidas,
      readRate: pct(lidas, entregues || total)
    };
  });

  const hsmRows = list.filter(function (r) { return r.category === 'hsm'; });
  const hsm = hsmRows.reduce(function (acc, r) {
    acc.total += r.total;
    acc.entregues += r.entregues;
    acc.lidas += r.lidas;
    return acc;
  }, { total: 0, entregues: 0, lidas: 0 });
  hsm.readRate = pct(hsm.lidas, hsm.entregues || hsm.total);

  return {
    available: list.length > 0,
    source: 'client_analytics.fact_agent_messages',
    rows: list,
    hsm,
    caveat: 'Cobertura parcial: esta fato só tem mensagem de conversa que passou por agente na Sales.ai, então o denominador NÃO é o total de tentativas do funil acima. Serve para ler taxa de leitura, não para dimensionar volume.',
    privacy: 'Somente agregado. O conteúdo da mensagem existe nessa fato e nunca sai do servidor.'
  };
}

// A CTE `base` roda SEM recorte de data de propósito: `attempt_seq` é a posição
// da tentativa na história do lead, não dentro do período escolhido. Numerar
// dentro do recorte diria "1ª tentativa" para quem já levou cinco em julho.
// Custo: a fato inteira tem ~4,7k linhas.
function buildSql(range) {
  const from = quoteSql(range.from);
  const to = quoteSql(range.to);
  const leadPartition = 'concat(country_code, cellphone)';

  return [
    'WITH base AS (',
    '  SELECT',
    '    timestamps_eta, status, poll_id, poll_name, origin, origin_id,',
    '    timestamp_delivered, timestamp_responded, timestamp_failure,',
    "    lower(hex(cityHash64(concat('" + LEAD_SALT + "|', country_code, cellphone)))) AS lead_hash,",
    '    row_number() OVER (PARTITION BY ' + leadPartition + ' ORDER BY timestamps_eta) AS attempt_seq,',
    '    count() OVER (PARTITION BY ' + leadPartition + ') AS lead_attempts_total,',
    '    any(timestamps_eta) OVER (PARTITION BY ' + leadPartition +
      ' ORDER BY timestamps_eta ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) AS prev_attempt_at',
    '  FROM client_analytics.fact_deployment_status',
    ')',
    'SELECT',
    "  formatDateTime(toTimeZone(f.timestamps_eta, 'America/Sao_Paulo'), '%Y-%m-%dT%H:%i:%S-03:00') AS created_at,",
    "  toString(toDate(toTimeZone(f.timestamps_eta, 'America/Sao_Paulo'))) AS created_day,",
    '  toString(f.status) AS status,',
    '  toString(f.poll_id) AS poll_id,',
    '  toString(f.poll_name) AS flow,',
    '  toString(f.origin) AS origin,',
    '  toString(a.first_name) AS agent_first_name,',
    '  toString(a.last_name) AS agent_last_name,',
    '  if(f.timestamp_delivered > ' + SENTINEL_SQL + " OR f.status = 'DELIVERED', 1, 0) AS delivered_real,",
    '  if(f.timestamp_responded > ' + SENTINEL_SQL + ', 1, 0) AS replied_real,',
    '  if(f.timestamp_failure > ' + SENTINEL_SQL +
      ", formatDateTime(toTimeZone(f.timestamp_failure, 'America/Sao_Paulo'), '%Y-%m-%dT%H:%i:%S-03:00'), '') AS failed_at,",
    '  if(f.timestamp_delivered > ' + SENTINEL_SQL +
      ", dateDiff('second', f.timestamps_eta, f.timestamp_delivered), -1) AS delivery_lag_sec,",
    '  if(f.timestamp_responded > ' + SENTINEL_SQL + ' AND f.timestamp_delivered > ' + SENTINEL_SQL +
      ", dateDiff('second', f.timestamp_delivered, f.timestamp_responded), -1) AS response_lag_sec,",
    '  substring(f.lead_hash, 1, ' + LEAD_KEY_CHARS + ') AS lead_key,',
    '  toUInt32(f.attempt_seq) AS attempt_seq,',
    '  toUInt32(f.lead_attempts_total) AS lead_attempts_total,',
    "  if(f.attempt_seq > 1, dateDiff('hour', f.prev_attempt_at, f.timestamps_eta), -1) AS gap_prev_hours,",
    '  toString(h.name) AS hsm_name,',
    '  toString(h.hsm_status) AS hsm_status,',
    '  toString(h.category) AS hsm_category,',
    '  toString(h.template_type) AS hsm_type',
    'FROM base f',
    'LEFT ANY JOIN client_analytics.dim_agents a ON f.origin_id = a.id',
    'LEFT ANY JOIN (',
    '  SELECT name, argMax(status, id) AS hsm_status, argMax(category, id) AS category,',
    '         argMax(template_type, id) AS template_type',
    '  FROM client_analytics.dim_hsm GROUP BY name',
    ') h ON f.poll_name = h.name',
    "WHERE toDate(toTimeZone(f.timestamps_eta, 'America/Sao_Paulo')) >= toDate(" + from + ')',
    "  AND toDate(toTimeZone(f.timestamps_eta, 'America/Sao_Paulo')) <= toDate(" + to + ')',
    'ORDER BY f.timestamps_eta DESC',
    'LIMIT ' + QUERY_LIMIT,
    'FORMAT JSON'
  ].join('\n');
}

// Reconciliação contra o pré-agregado da própria Treble. As DUAS pontas contam
// em UTC porque `fact_deployment_daily.day` é UTC (medido 11/08/2026); a
// contagem BRT que a tela usa vem junto, rotulada, para ninguém ler a diferença
// de fuso como defeito de ingestão. O daily também é a única fonte de desfechos
// que a fato de status não expressa: to_agents, in_process, optout, revoked e
// failure_rate_limit.
function buildDailyParitySql(range) {
  const from = quoteSql(range.from);
  const to = quoteSql(range.to);
  const dailyWindow = 'day >= toDate(' + from + ') AND day <= toDate(' + to + ')';
  const factUtcWindow = 'toDate(f.timestamps_eta) >= toDate(' + from + ')' +
    ' AND toDate(f.timestamps_eta) <= toDate(' + to + ')';

  return [
    'SELECT',
    '  (SELECT sum(sent) FROM client_analytics.fact_deployment_daily WHERE ' + dailyWindow + ') AS daily_sent,',
    '  (SELECT sum(delivered) FROM client_analytics.fact_deployment_daily WHERE ' + dailyWindow + ') AS daily_delivered,',
    '  (SELECT sum(responded) FROM client_analytics.fact_deployment_daily WHERE ' + dailyWindow + ') AS daily_responded,',
    '  (SELECT sum(failure) FROM client_analytics.fact_deployment_daily WHERE ' + dailyWindow + ') AS daily_failure,',
    '  (SELECT sum(in_process) FROM client_analytics.fact_deployment_daily WHERE ' + dailyWindow + ') AS daily_in_process,',
    '  (SELECT sum(to_agents) FROM client_analytics.fact_deployment_daily WHERE ' + dailyWindow + ') AS daily_to_agents,',
    '  (SELECT sum(optout) FROM client_analytics.fact_deployment_daily WHERE ' + dailyWindow + ') AS daily_optout,',
    '  (SELECT sum(revoked) FROM client_analytics.fact_deployment_daily WHERE ' + dailyWindow + ') AS daily_revoked,',
    '  (SELECT sum(failure_rate_limit) FROM client_analytics.fact_deployment_daily WHERE ' + dailyWindow +
      ') AS daily_rate_limit,',
    '  (SELECT sum(invalid_phone) FROM client_analytics.fact_deployment_daily WHERE ' + dailyWindow +
      ') AS daily_invalid_phone,',
    '  (SELECT count() FROM client_analytics.fact_deployment_status f WHERE ' + factUtcWindow + ') AS fact_sent_utc,',
    '  (SELECT countIf(f.timestamp_delivered > ' + SENTINEL_SQL + " OR f.status = 'DELIVERED')" +
      ' FROM client_analytics.fact_deployment_status f WHERE ' + factUtcWindow + ') AS fact_delivered_utc,',
    '  (SELECT countIf(f.timestamp_responded > ' + SENTINEL_SQL + ')' +
      ' FROM client_analytics.fact_deployment_status f WHERE ' + factUtcWindow + ') AS fact_responded_utc',
    'FORMAT JSON'
  ].join('\n');
}

// Leitura (read receipt) existe no armazém, só não nesta fato: mora em
// fact_agent_messages, junto do conteúdo. Aqui só o AGREGADO sai do servidor —
// nunca `content`, nunca id de conversa. Cobertura é parcial por construção (só
// conversa que passou por agente), e é isso que a tela declara.
function buildReadSql(range) {
  const from = quoteSql(range.from);
  const to = quoteSql(range.to);

  return [
    'SELECT',
    '  toString(sender) AS sender,',
    '  toString(category) AS category,',
    '  count() AS total,',
    '  countIf(delivered_at IS NOT NULL) AS entregues,',
    '  countIf(read_at IS NOT NULL) AS lidas',
    'FROM client_analytics.fact_agent_messages',
    "WHERE toDate(toTimeZone(created_at, 'America/Sao_Paulo')) >= toDate(" + from + ')',
    "  AND toDate(toTimeZone(created_at, 'America/Sao_Paulo')) <= toDate(" + to + ')',
    'GROUP BY sender, category',
    'ORDER BY total DESC',
    'FORMAT JSON'
  ].join('\n');
}

// Último evento da fato INTEIRA (sem recorte). É o que responde "o warehouse
// ainda está sendo alimentado?" independentemente do período que a tela pede.
function buildFreshnessSql() {
  return [
    'SELECT',
    "  formatDateTime(toTimeZone(max(f.timestamps_eta), 'America/Sao_Paulo'), '%Y-%m-%dT%H:%i:%S-03:00') AS warehouse_latest_at",
    'FROM client_analytics.fact_deployment_status f',
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
      method: 'POST',
      endpoint: 'ClickHouse HTTP | max(timestamps_eta) da fato inteira',
      purpose: 'Medir frescor do warehouse sem depender do recorte selecionado',
      returns: 'Último evento em BRT',
      usedFor: 'Selo de frescor e aviso de ingestão parada'
    },
    {
      step: 6,
      method: 'POST',
      endpoint: 'ClickHouse HTTP | fact_deployment_daily',
      purpose: 'Reconciliar tentativa/entrega/resposta contra o pré-agregado da própria Treble e ler os desfechos que a fato de status não tem',
      returns: 'Totais em UTC + in_process, to_agents, optout, revoked, rate_limit',
      usedFor: 'Bloco de paridade e desfechos operacionais'
    },
    {
      step: 7,
      method: 'POST',
      endpoint: 'ClickHouse HTTP | fact_agent_messages',
      purpose: 'Medir leitura (read_at) de HSM e mensagem de agente, só em agregado',
      returns: 'sender/category com total, entregues e lidas',
      usedFor: 'Bloco de leitura, com cobertura declarada'
    },
    {
      step: 8,
      method: 'POST',
      endpoint: 'ClickHouse HTTP | dim_hsm e window por lead na fato',
      purpose: 'Nomear o template por join de nome e numerar a tentativa na história do lead',
      returns: 'hsm_name/status/category + attemptSeq/leadKey/gapPrevHours',
      usedFor: 'Abas HSM e Tentativas por lead'
    },
    {
      step: 9,
      method: 'Sanitização',
      endpoint: 'API server-side',
      purpose: 'Mapear status bruto, inferir agente por flow, pseudonimizar lead e remover PII',
      returns: 'messages/byOrigin/byAttempt/leads/latency/hsm/errors/parity/read',
      usedFor: 'Storytelling with Data na UI'
    }
  ];
}

// Paridade e leitura vêm de OUTRAS fatos e não podem derrubar a tela: se uma
// delas falhar, o bloco vira "indisponível" com o motivo, e o resto do painel
// segue. Deixar a query secundária propagar erro transformaria um extra em
// ponto único de falha do que já funcionava.
async function queryOrNull(creds, sql, tag) {
  try {
    return await clickhouseQuery(creds, sql);
  } catch (e) {
    console.error('[bdr-treble-dw] ' + tag + ' falhou:', e && e.message ? e.message : 'unknown');
    return null;
  }
}

async function buildPayloadFromDW(range) {
  const creds = getClickHouseCredentials();
  const [result, freshnessResult, parityResult, readResult] = await Promise.all([
    clickhouseQuery(creds, buildSql(range)),
    clickhouseQuery(creds, buildFreshnessSql()),
    queryOrNull(creds, buildDailyParitySql(range), 'paridade'),
    queryOrNull(creds, buildReadSql(range), 'leitura')
  ]);
  const rawRows = result.rows || [];
  const truncated = rawRows.length > ROW_LIMIT;
  const messages = rawRows.slice(0, ROW_LIMIT).map(sanitizeMessage);
  const agg = aggregateMessages(messages);
  const byOrigin = aggregateOrigin(messages);
  const byAttempt = aggregateAttempts(messages);
  const leads = aggregateLeads(messages);
  const latency = aggregateLatency(messages);
  const hsm = aggregateHsm(messages);
  const errors = aggregateErrors(messages);
  const parity = buildParityBlock(
    parityResult && parityResult.rows && parityResult.rows[0] ? parityResult.rows[0] : null,
    messages.length
  );
  const read = buildReadBlock(readResult && readResult.rows ? readResult.rows : []);

  const latestEventAt = latestEventFromMessages(messages);
  const latestEventDay = brtDayFromIso(latestEventAt);
  const ageMinutes = freshnessAgeMinutes(latestEventAt, Date.now());
  const warehouseLatestAt = (freshnessResult.rows && freshnessResult.rows[0])
    ? freshnessResult.rows[0].warehouse_latest_at || null
    : null;
  const warehouse = buildWarehouseState(warehouseLatestAt, Date.now());

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
    byOrigin,
    byAttempt,
    leads,
    latency,
    hsm,
    errors,
    parity,
    read,
    sessions: [],
    deploymentReport: {
      available: true,
      source: 'client_analytics.fact_deployment_status',
      byDay: agg.timeline,
      byConversationDay: []
    },
    latestEventAt: latestEventAt || null,
    latestEventDay: latestEventDay || null,
    freshnessAgeMinutes: ageMinutes,
    warehouse,
    periodEmpty: messages.length === 0,
    rowsReturned: messages.length,
    rowsTruncated: truncated,
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
      contractVersion: 'V10',
      readMetricAvailable: false,
      readMetricLabel: 'Indisponível nesta fato | medida à parte em fact_agent_messages',
      metricContract: 'Tentativas = linhas de fact_deployment_status; Entregues = timestamp_delivered válido ou status DELIVERED; resposta válida também entra no funil como entregue; statusLabel/statusGroup preservam sempre o status bruto; SUCCESS isolado = em processamento na Treble (in_process no pré-agregado); attemptSeq é a posição da tentativa na história do lead, não no recorte; latência de entrega e de resposta em segundos, com null para não medido; leitura vem de outra fato e tem cobertura parcial.',
      privacy: 'Sem telefone, email, documento, origin_id, deployment_id, batch_id, treble_id, conteúdo ou payload bruto; dim_agents retorna somente nome e sobrenome. leadKey é PSEUDÔNIMO (hash salgado do telefone, 12 hex) para somar tentativas da mesma pessoa sem expor o número: não é anonimização, porque o espaço de telefones é pequeno e o sal vive no código.',
      limitations: [
        'Retenção e filtros limitados a no máximo 90 dias',
        'Leitura não existe em fact_deployment_status; o bloco de leitura vem de fact_agent_messages e cobre só conversa que passou por agente, então o denominador dele não é o do funil',
        'HSM só é nomeado por join de NOME (a fato não tem hsm_id); a cobertura do template vai declarada no bloco hsm',
        'A reconciliação com fact_deployment_daily conta em UTC nas duas pontas porque a coluna day do pré-agregado é UTC; a tela conta em BRT',
        'Atribuição direta só quando origin_id faz match com dim_agents.id',
        'Flows de regra de negócio (pesquisa RH / experimento outbound = Samuel Alencar; deal4b = Gabriel Milan) são atribuídos pelo construtor do flow, com precedência sobre a inferência por nome',
        'Demais responsáveis são inferidos pelo nome do flow; origin_id sem match, como 59580, não vira pessoa',
        'Período sem linhas significa "nenhum disparo nesse período", não dado desatualizado; frescor é medido pelo último evento da fato inteira (bloco warehouse), nunca pelo recorte'
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

// Range histórico: cacheável sempre. Recorte que inclui hoje e voltou vazio não
// vai para o cache — a próxima linha pode chegar a qualquer momento e servir
// "sem dados" por 10 min esconderia disparo recém-ingerido.
function shouldCachePayload(payload, range) {
  if (!payload) return false;
  if (!periodIncludesToday(range)) return true;
  if (payload.rowsReturned === 0) return false;
  return true;
}

// Recalcula as idades a partir de "agora" (não do momento em que o payload foi
// gerado/cacheado). Dentro do TTL de 10 min o warehouse pode cruzar o limiar de
// staleness; sem recomputar, o cache serviria um bloco warehouse otimista.
// nowMs é injetável só para teste determinístico; em produção usa Date.now().
function recomputeFreshness(payload, range, nowMs) {
  if (!payload) return payload;
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const ageMinutes = freshnessAgeMinutes(payload.latestEventAt, now);
  const warehouse = buildWarehouseState((payload.warehouse || {}).latestEventAt || null, now);
  return Object.assign({}, payload, { freshnessAgeMinutes: ageMinutes, warehouse });
}

function getFromCache(key, range, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const entry = cacheByKey[key];
  if (!entry) return null;
  if (now - entry.ts > CACHE_TTL_MS) {
    delete cacheByKey[key];
    return null;
  }
  // Recalcula freshness com o relógio atual antes de decidir servir. Cache
  // legado (ou payload que envelheceu dentro do próprio TTL) pode ter cruzado
  // 180min ou ficado stale entre a escrita e esta leitura — invalida em vez de
  // servir dado desatualizado.
  const recomputed = range ? recomputeFreshness(entry.payload, range, now) : entry.payload;
  if (range && !shouldCachePayload(recomputed, range)) {
    delete cacheByKey[key];
    return null;
  }
  return recomputed;
}

function setCache(key, payload, tsOverride) {
  cacheByKey[key] = { payload, ts: typeof tsOverride === 'number' ? tsOverride : Date.now() };
}

function resetCache() {
  cacheByKey = {};
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
  const cached = refresh ? null : getFromCache(key, range);
  if (cached) return res.json(Object.assign({}, cached, { cached: true }));

  try {
    const payload = await buildPayloadFromDW(range);
    if (shouldCachePayload(payload, range)) setCache(key, payload);
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
  buildFreshnessSql,
  buildDailyParitySql,
  buildReadSql,
  originMeta,
  attemptBucket,
  lagOrNull,
  percentile,
  describeLag,
  aggregateOrigin,
  aggregateAttempts,
  aggregateLeads,
  aggregateLatency,
  aggregateHsm,
  aggregateErrors,
  buildParityBlock,
  buildReadBlock,
  parityVerdict,
  LEAD_OUTLIER_ATTEMPTS,
  ATTEMPT_BUCKETS,
  PARITY_ABS_TOLERANCE,
  PARITY_PCT_TOLERANCE,
  clickhouseQuery,
  buildPayloadFromDW,
  resolveDateRange,
  sanitizeMessage,
  aggregateMessages,
  assertNoPii,
  agentFromFlowRule,
  inferAgentFromFlow,
  periodIncludesToday,
  latestEventFromMessages,
  brtDayFromIso,
  freshnessAgeMinutes,
  computeWarehouseStale,
  computeWarehouseHardStale,
  buildWarehouseState,
  shouldCachePayload,
  recomputeFreshness,
  getFromCache,
  setCache,
  resetCache,
  cacheKey,
  STALE_THRESHOLD_MINUTES,
  STALE_HARD_THRESHOLD_MINUTES,
  CACHE_TTL_MS,
  ROW_LIMIT
};
