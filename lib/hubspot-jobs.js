'use strict';
/**
 * lib/hubspot-jobs.js — controle dos Cloud Run Jobs do armazém canônico.
 *
 * Dois Jobs, uma imagem (`hubspot-platform:v1`):
 *   · hubspot-platform-reconcile  06:30 diário  — extrai janela curta e remodela
 *   · hubspot-platform-close      20:30 seg-sex — fecha D-1 e roda a suíte inteira
 *
 * O botão Atualizar dispara o `reconcile` com LOOKBACK_DAYS=2 (janela curta, NÃO
 * backfill — backfill continua manual).
 *
 * A TRAVA DE CONCORRÊNCIA lê as execuções do Cloud Run, não o BigQuery.
 * Motivo medido, não estético: o job leva ~15s entre ser disparado e escrever a
 * linha `RUNNING` em `raw_extract_run`. Uma trava que consultasse só o BQ
 * deixaria essa janela aberta e dois cliques rápidos viravam duas execuções —
 * exatamente o que a regra existe para impedir. O MERGE é idempotente, mas o
 * orçamento de request da API do HubSpot não é.
 *
 * Autenticação: mesma SA de lib/bigquery.js (GOOGLE_SERVICE_ACCOUNT_JSON), com
 * escopo cloud-platform.
 */

const crypto = require('crypto');

const PROJECT = 'gen-lang-client-0423905839';
const REGION = 'southamerica-east1';
const JOB_RECONCILE = 'hubspot-platform-reconcile';
const JOB_CLOSE = 'hubspot-platform-close';
const SCHEDULER_RECONCILE = 'hubspot-reconcile-0630';

// Teto de uso: 1 refresh a cada 5 min por escopo (regra 5 do handoff).
const COOLDOWN_MS = 5 * 60 * 1000;
// Execução sem completionTime há mais de 30 min é considerada morta, não presa:
// o task-timeout do Job é 60 min, mas travar o botão por uma hora por causa de
// um job zumbi é pior que arriscar uma execução concorrente rara.
const STALE_MS = 30 * 60 * 1000;

const SCOPES = new Set(['workload', 'leads', 'tudo']);

function b64url(input) {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function isConfigured() { return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON; }

async function getAccessToken() {
  if (!isConfigured()) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurado');
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON.replace(/^﻿/, '').trim());
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'RS256', typ: 'JWT' });
  const payload = b64url({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  });
  const unsigned = header + '.' + payload;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const sig = signer.sign(sa.private_key, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: unsigned + '.' + sig,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Google auth (cloud-platform) falhou: ' + JSON.stringify(data));
  return data.access_token;
}

async function gapi(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || JSON.stringify(data).slice(0, 300);
    const err = new Error(`${method} ${url.replace(/https:\/\/[^/]+/, '')} -> ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const RUN_BASE = `https://${REGION}-run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}`;

/** Lê `env` do template da execução — é de lá que sai o run_id e o escopo. */
function envOf(execution) {
  const out = {};
  const containers = (execution.template && execution.template.containers) || [];
  containers.forEach((c) => (c.env || []).forEach((e) => {
    if (e && e.name && typeof e.value === 'string') out[e.name] = e.value;
  }));
  return out;
}

function summarizeExecution(execution) {
  const env = envOf(execution);
  const created = execution.createTime ? new Date(execution.createTime) : null;
  const completed = execution.completionTime ? new Date(execution.completionTime) : null;
  const failed = Number(execution.failedCount || 0);
  const succeeded = Number(execution.succeededCount || 0);
  return {
    nome: String(execution.name || '').split('/').pop(),
    run_id: env.RUN_ID || null,
    escopo: env.SCOPE || 'tudo',
    lookback_days: env.LOOKBACK_DAYS ? Number(env.LOOKBACK_DAYS) : null,
    iniciado_em: created ? created.toISOString() : null,
    concluido_em: completed ? completed.toISOString() : null,
    em_andamento: !completed,
    status: !completed ? 'RUNNING' : (failed > 0 ? 'FAILED' : (succeeded > 0 ? 'OK' : 'CANCELLED')),
    idade_ms: created ? Date.now() - created.getTime() : null,
  };
}

/** Execuções do job reconcile, mais recentes primeiro. */
async function listReconcileExecutions(token, pageSize = 10) {
  const url = `${RUN_BASE}/jobs/${JOB_RECONCILE}/executions?pageSize=${pageSize}`;
  const data = await gapi(token, 'GET', url);
  return (data.executions || []).map(summarizeExecution)
    .sort((a, b) => String(b.iniciado_em || '').localeCompare(String(a.iniciado_em || '')));
}

/**
 * Decide se pode disparar. Devolve `{ ok }` ou `{ ok:false, motivo, execucao }`.
 *   motivo 'concorrencia' -> já existe execução viva (qualquer escopo)
 *   motivo 'teto'         -> houve refresh do MESMO escopo há menos de 5 min
 */
function gate(execucoes, escopo) {
  const viva = execucoes.find((e) => e.em_andamento && e.idade_ms != null && e.idade_ms < STALE_MS);
  if (viva) return { ok: false, motivo: 'concorrencia', execucao: viva };

  const recente = execucoes.find((e) => e.escopo === escopo
    && e.idade_ms != null && e.idade_ms < COOLDOWN_MS);
  if (recente) return { ok: false, motivo: 'teto', execucao: recente };

  return { ok: true };
}

/**
 * Dispara o reconcile com janela curta. `run_id` é gerado aqui e viaja como env
 * override para o container — é assim que o 202 devolve um id que depois aparece
 * de verdade em `bronze.raw_extract_run`.
 */
async function triggerReconcile(token, { escopo = 'tudo', lookbackDays = 2, runId } = {}) {
  if (!SCOPES.has(escopo)) throw new Error(`escopo inválido: ${escopo}`);
  const run_id = runId || ('ui_' + crypto.randomBytes(6).toString('hex'));
  const url = `${RUN_BASE}/jobs/${JOB_RECONCILE}:run`;
  const data = await gapi(token, 'POST', url, {
    overrides: {
      containerOverrides: [{
        env: [
          { name: 'MODE', value: 'reconcile' },
          { name: 'LOOKBACK_DAYS', value: String(lookbackDays) },
          { name: 'SCOPE', value: escopo },
          { name: 'RUN_ID', value: run_id },
        ],
      }],
    },
  });
  return { run_id, operacao: data.name || null };
}

/**
 * Próxima execução agendada, lida do Cloud Scheduler. Vem da API de propósito:
 * repetir o cron em constante no código é como o selo passa a anunciar um
 * horário que o agendamento já não tem.
 */
async function nextScheduled(token) {
  const url = `https://cloudscheduler.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/jobs/${SCHEDULER_RECONCILE}`;
  try {
    const j = await gapi(token, 'GET', url);
    return {
      job: SCHEDULER_RECONCILE,
      cron: j.schedule || null,
      timezone: j.timeZone || null,
      proxima: j.scheduleTime || null,
      estado: j.state || null,
    };
  } catch (e) {
    // Selo sem "próxima execução" ainda é útil; selo que derruba a tela não é.
    return { job: SCHEDULER_RECONCILE, erro: e.message.slice(0, 200) };
  }
}

module.exports = {
  PROJECT, REGION, JOB_RECONCILE, JOB_CLOSE, SCHEDULER_RECONCILE,
  COOLDOWN_MS, STALE_MS, SCOPES,
  isConfigured, getAccessToken, listReconcileExecutions, gate,
  triggerReconcile, nextScheduled, summarizeExecution,
};
