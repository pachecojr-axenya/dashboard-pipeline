'use strict';
/**
 * GET /api/freshness — idade e sanidade da fonte única.
 *
 * Existe porque migrar para o BigQuery, sem isto, PIORA a experiência: hoje a
 * tela bate na API do HubSpot e o número é de agora; com batch passa a ser de
 * horas atrás sem que ninguém saiba. Dado batch sem carimbo de idade é como o
 * usuário passa a desconfiar de tudo — inclusive do que está certo.
 *
 * Responde ao contrato do handoff F5:
 *   { extraido_em, idade_minutos, ultimo_run, checks, proxima_execucao_agendada }
 *
 * Uma nota sobre `extraido_em`. O handoff especifica MAX(extracted_at) do
 * bronze. Aqui ele sai do `finished_at` do último run OK de
 * `bronze.raw_extract_run`: é o MESMO instante (o ETL grava `extracted_at = agora`
 * durante a execução), mas lido de uma tabela de 12 linhas particionada por dia
 * em vez de varrer a coluna das 6 tabelas de fato. A diferença importa porque
 * este endpoint é POLLED por toda aba aberta — a versão literal custaria ~60 MB
 * por poll, e o selo de frescor não pode ser a linha mais cara do painel.
 *
 * Cache de 30s em KV para colapsar pollers concorrentes. Nunca mais que isso: o
 * selo tem de envelhecer à vista.
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const wh = require('../lib/hubspot-warehouse');
const jobs = require('../lib/hubspot-jobs');
const kv = require('../lib/kv');
const env = require('../lib/env');

const CACHE_TTL_S = 30;

const SQL = `
WITH ultimo_run AS (
  SELECT run_id, mode, lookback_days, started_at, finished_at, status,
         objects_scanned, history_rows, association_rows, api_requests, error
  FROM ${wh.t('bronze', 'raw_extract_run')}
  ORDER BY started_at DESC
  LIMIT 1
),
ultimo_ok AS (
  SELECT finished_at, mode
  FROM ${wh.t('bronze', 'raw_extract_run')}
  WHERE status = 'OK' AND finished_at IS NOT NULL
  ORDER BY started_at DESC
  LIMIT 1
),
ultimo_dq AS (
  SELECT run_id, started_at, finished_at, checks_total, checks_failed, blocked
  FROM ${wh.t('gold', 'dq_run')}
  ORDER BY started_at DESC
  LIMIT 1
),
falhas AS (
  SELECT ARRAY_AGG(
           STRUCT(check_name, severity, subject,
                  SUBSTR(IFNULL(detail, ''), 1, 300) AS detail)
           ORDER BY IF(severity = 'BLOCK', 0, 1), check_name
           LIMIT 20
         ) AS itens
  FROM ${wh.t('gold', 'dq_finding')}
  WHERE run_id = (SELECT run_id FROM ultimo_dq) AND NOT passed
)
SELECT
  (SELECT finished_at FROM ultimo_ok)              AS extraido_em,
  (SELECT mode        FROM ultimo_ok)              AS extraido_modo,
  r.run_id, r.mode, r.lookback_days, r.started_at, r.finished_at, r.status,
  r.objects_scanned, r.history_rows, r.association_rows, r.api_requests, r.error,
  d.run_id AS dq_run_id, d.started_at AS dq_started_at, d.finished_at AS dq_finished_at,
  d.checks_total, d.checks_failed, d.blocked,
  f.itens AS dq_falhas
FROM ultimo_run r
CROSS JOIN ultimo_dq d
LEFT JOIN falhas f ON TRUE
`;

function minutosDesde(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return ms < 0 ? 0 : Math.round(ms / 60000);
}

async function build() {
  const { rows } = await wh.query(SQL);
  const r = rows[0] || {};

  const extraidoEm = wh.timestamp(r.extraido_em);
  const falhas = (r.dq_falhas || []).map((f) => ({
    check: wh.str(f.check_name),
    severidade: wh.str(f.severity),
    assunto: wh.str(f.subject),
    detalhe: wh.str(f.detail),
  }));
  const bloqueado = r.blocked === true || String(r.blocked) === 'true';

  // Execução viva do Cloud Run: sem isto o selo diz "atualizado há 40 min"
  // enquanto um refresh já está rodando, e o usuário clica de novo.
  let emAndamento = null;
  let proxima = null;
  try {
    const token = await jobs.getAccessToken();
    const [execs, sched] = await Promise.all([
      jobs.listReconcileExecutions(token, 5),
      jobs.nextScheduled(token),
    ]);
    const viva = execs.find((e) => e.em_andamento && e.idade_ms != null && e.idade_ms < jobs.STALE_MS);
    emAndamento = viva || null;
    proxima = sched;
  } catch (e) {
    proxima = { erro: e.message.slice(0, 200) };
  }

  return {
    extraido_em: extraidoEm,
    idade_minutos: minutosDesde(extraidoEm),
    ultimo_run: {
      run_id: wh.str(r.run_id),
      modo: wh.str(r.mode),
      lookback_days: r.lookback_days == null ? null : Number(r.lookback_days),
      iniciado_em: wh.timestamp(r.started_at),
      finalizado_em: wh.timestamp(r.finished_at),
      status: wh.str(r.status),
      objetos: wh.num(r.objects_scanned),
      historico: wh.num(r.history_rows),
      associacoes: wh.num(r.association_rows),
      api_requests: wh.num(r.api_requests),
      erro: wh.str(r.error),
      duracao_s: r.started_at && r.finished_at
        ? Math.round((new Date(wh.timestamp(r.finished_at)) - new Date(wh.timestamp(r.started_at))) / 1000)
        : null,
    },
    checks: {
      run_id: wh.str(r.dq_run_id),
      rodado_em: wh.timestamp(r.dq_finished_at || r.dq_started_at),
      total: wh.num(r.checks_total),
      falharam: wh.num(r.checks_failed),
      bloqueado: bloqueado,
      // Regra 4: estado de falha visível — o selo tem de dizer QUAL check caiu.
      // Falhar em silêncio e mostrar número velho é pior que não mostrar.
      falhas: falhas,
      block: falhas.filter((f) => f.severidade === 'BLOCK').map((f) => f.check),
    },
    em_andamento: emAndamento,
    proxima_execucao_agendada: proxima,
    // O front decide a cor do selo por aqui, não reimplementando a regra.
    estado: bloqueado ? 'alerta'
      : (wh.str(r.status) === 'ERROR' ? 'alerta'
        : (minutosDesde(extraidoEm) != null && minutosDesde(extraidoEm) > 24 * 60 ? 'velho' : 'ok')),
  };
}

module.exports = async (req, res) => {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  if (!requireAuth(req, res)) return;

  const cacheKey = env.kvKey('hubspot:freshness');
  try {
    if (kv.isConfigured() && req.query && req.query.nocache !== '1') {
      const cached = await kv.getJSON(cacheKey).catch(() => null);
      if (cached && cached.gerado_em && Date.now() - new Date(cached.gerado_em).getTime() < CACHE_TTL_S * 1000) {
        // idade_minutos é recalculada: cache de 30s não pode congelar o relógio.
        cached.idade_minutos = minutosDesde(cached.extraido_em);
        cached.cache = true;
        res.status(200).json(cached);
        return;
      }
    }

    const payload = await build();
    payload.gerado_em = new Date().toISOString();
    payload.cache = false;
    if (kv.isConfigured()) {
      await kv.setJSON(cacheKey, payload).catch(() => {});
    }
    res.status(200).json(payload);
  } catch (e) {
    // Selo que derruba a tela é pior que selo ausente — mas ele NÃO pode
    // silenciar: devolve 200 com estado 'indisponivel' para o front mostrar
    // "frescor indisponível" em vez de fingir que o dado é de agora.
    res.status(200).json({
      estado: 'indisponivel',
      erro: String(e.message || e).slice(0, 300),
      extraido_em: null,
      idade_minutos: null,
    });
  }
};
