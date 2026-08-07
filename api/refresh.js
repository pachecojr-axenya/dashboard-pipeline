'use strict';
/**
 * POST /api/refresh — o botão Atualizar.
 *
 *   entrada  { escopo: "workload" | "leads" | "tudo" }
 *   202      { run_id, iniciado_em, eta_segundos }
 *   429      { em_andamento: true, run_id, iniciado_em }        (concorrência)
 *   429      { teto: true, run_id, iniciado_em, espere_s }      (1 a cada 5 min)
 *
 * Não é enfeite. Sem ele a migração para o BigQuery piora a experiência, porque
 * troca "dado de agora" por "dado de horas atrás sem aviso". Com ele, batch fica
 * aceitável: o usuário vê a idade e tem como encurtá-la.
 *
 * As cinco regras do handoff F5, e onde cada uma vive:
 *   1. Trava de concorrência ....... lib/hubspot-jobs.gate(), motivo 'concorrencia'
 *   2. Janela curta (2 dias) ....... LOOKBACK_DAYS=2 abaixo; backfill segue manual
 *   3. Selo sempre visível ......... GET /api/freshness + o selo no front
 *   4. Estado de falha visível ..... checks.block em /api/freshness
 *   5. Teto de 1 a cada 5 min ...... gate(), motivo 'teto'
 *
 * Por que a trava mora nas execuções do Cloud Run e não no BigQuery: o job leva
 * ~15s entre ser disparado e escrever `RUNNING` em raw_extract_run, e nessa
 * janela dois cliques viravam duas execuções. O MERGE é idempotente; o orçamento
 * de request da API do HubSpot não é.
 */

const { setCORSHeaders, requireAuth, methodCheck } = require('./_helpers');
const jobs = require('../lib/hubspot-jobs');
const kv = require('../lib/kv');
const env = require('../lib/env');

// Janela curta, por regra. O botão reconcilia os últimos 2 dias — não faz
// backfill. Backfill continua sendo operação manual e consciente.
const LOOKBACK_DAYS = 2;

// ETA medido no smoke de 07/08/2026 (janela de 1 dia, escopo workload: ~2 min
// até o gold). `tudo` inclui os 5 objetos e a suíte de checks com amostragem
// viva, que é o que domina o tempo.
const ETA_S = { workload: 150, leads: 150, tudo: 600 };

function readBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') { try { return JSON.parse(b); } catch { return {}; } }
  return b;
}

module.exports = async (req, res) => {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['POST'])) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const body = readBody(req);
  const escopo = String(body.escopo || (req.query && req.query.escopo) || 'tudo').toLowerCase();
  if (!jobs.SCOPES.has(escopo)) {
    res.status(400).json({ erro: `escopo inválido: ${escopo}`, aceitos: [...jobs.SCOPES] });
    return;
  }

  if (!jobs.isConfigured()) {
    res.status(503).json({ erro: 'GOOGLE_SERVICE_ACCOUNT_JSON ausente — refresh indisponível' });
    return;
  }

  try {
    const token = await jobs.getAccessToken();
    const execucoes = await jobs.listReconcileExecutions(token, 10);
    const veredito = jobs.gate(execucoes, escopo);

    if (!veredito.ok) {
      const e = veredito.execucao;
      const espere_s = veredito.motivo === 'teto'
        ? Math.max(1, Math.ceil((jobs.COOLDOWN_MS - e.idade_ms) / 1000))
        : null;
      res.status(429).json({
        motivo: veredito.motivo,
        em_andamento: veredito.motivo === 'concorrencia',
        teto: veredito.motivo === 'teto',
        run_id: e.run_id,
        execucao: e.nome,
        escopo: e.escopo,
        iniciado_em: e.iniciado_em,
        espere_s,
        mensagem: veredito.motivo === 'concorrencia'
          ? 'Já existe uma atualização rodando. Ela cobre esta tela também.'
          : `Última atualização de "${escopo}" foi há menos de 5 min. Reaproveitando ela.`,
      });
      return;
    }

    const { run_id } = await jobs.triggerReconcile(token, { escopo, lookbackDays: LOOKBACK_DAYS });
    const iniciado_em = new Date().toISOString();

    // Invalida o cache do selo: sem isso o front acabaria de disparar um refresh
    // e o selo continuaria mostrando a idade antiga por até 30s.
    if (kv.isConfigured()) {
      await kv.delKey(env.kvKey('hubspot:freshness')).catch(() => {});
    }

    res.status(202).json({
      run_id,
      iniciado_em,
      escopo,
      lookback_days: LOOKBACK_DAYS,
      eta_segundos: ETA_S[escopo] || 300,
      solicitado_por: user.email || null,
    });
  } catch (e) {
    const status = e.status === 403 || e.status === 404 ? 502 : 500;
    res.status(status).json({
      erro: String(e.message || e).slice(0, 400),
      dica: e.status === 403
        ? 'A service account do dashboard precisa de roles/run.developer no job hubspot-platform-reconcile.'
        : undefined,
    });
  }
};
