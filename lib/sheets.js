'use strict';
/**
 * sheets.js — Cliente Google Sheets API (zero dependências externas)
 *
 * Autenticação via Service Account (JWT RS256 → access token OAuth2).
 * Credenciais lidas de GOOGLE_SERVICE_ACCOUNT_JSON (env var).
 *
 * Exports:
 *   appendDailyRow(row)                  — adiciona linha de big numbers à aba "Historico"
 *   writeMonthlySnapshot(tabName, rows)  — cria aba do mês e escreve foto completa dos deals
 */

const crypto = require('crypto');

const SPREADSHEET_ID = '1rKEIAAMYhuMH1Elt9F1TsVRw4wTgGjRXsh-J7rn41kA';
const HISTORICO_TAB  = 'Historico';

const HISTORICO_HEADERS = [
  'Data', 'Total Deals',
  'ARR Total (R$)', 'ARR Ponderado (R$)', 'MRR Ponderado (R$)',
  'Cotação', 'Proposta Enviada', 'Consultoria', 'Negociação', 'Implantação', 'Ganho', 'Standby',
  'Pipeline Vendas', 'Pipeline Bid',
];

const SNAPSHOT_HEADERS = [
  'Deal', 'URL HubSpot', 'Pipeline', 'Etapa', 'Executivo',
  'Produto', 'Vidas', 'Colaboradores',
  '1ª Fatura (R$)', 'ARR Estimado (R$)',
  'Modelo', 'Agenciamento', 'Vitalício',
  'Probabilidade (%)', 'Quarter', 'Data Prevista', 'Dias no Pipe',
  'Receita Real Mês 1 (R$)', 'Receita Probabilizada Mês 1 (R$)',
];

// ── JWT RS256 ────────────────────────────────────────────────────────────────

function b64url(input) {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getAccessToken() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurado');
  }
  const sa  = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header  = b64url({ alg: 'RS256', typ: 'JWT' });
  const payload = b64url({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  });

  const unsigned = `${header}.${payload}`;
  const signer   = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const sig = signer.sign(sa.private_key, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  `${unsigned}.${sig}`,
    }),
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`Google auth falhou: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── Sheets API ───────────────────────────────────────────────────────────────

async function apiReq(token, method, path, body) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${path}`,
    {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    body ? JSON.stringify(body) : undefined,
      signal:  AbortSignal.timeout(20000),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function getSheetTitles(token) {
  const data = await apiReq(token, 'GET', '?fields=sheets.properties.title');
  return (data.sheets || []).map(s => s.properties.title);
}

async function createSheet(token, title) {
  await apiReq(token, 'POST', ':batchUpdate', {
    requests: [{ addSheet: { properties: { title } } }],
  });
}

// Garante que a aba existe e tem cabeçalho atualizado em A1.
// Reescreve o cabeçalho se estiver vazio ou com número de colunas diferente do esperado.
async function ensureTabHeaders(token, tabName, headers) {
  const titles = await getSheetTitles(token);
  if (!titles.includes(tabName)) {
    await createSheet(token, tabName);
  }
  const check = await apiReq(
    token, 'GET',
    `/values/${encodeURIComponent(tabName + '!A1')}`
  );
  const existingCols = check.values?.[0]?.length ?? 0;
  if (existingCols !== headers.length) {
    await apiReq(
      token, 'PUT',
      `/values/${encodeURIComponent(tabName + '!A1')}?valueInputOption=USER_ENTERED`,
      { values: [headers] }
    );
  }
}

async function appendRows(token, tabName, rows) {
  await apiReq(
    token, 'POST',
    `/values/${encodeURIComponent(tabName + '!A:A')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { values: rows }
  );
}

// ── API pública ──────────────────────────────────────────────────────────────

async function appendDailyRow(row) {
  const token = await getAccessToken();
  await ensureTabHeaders(token, HISTORICO_TAB, HISTORICO_HEADERS);
  await appendRows(token, HISTORICO_TAB, [row]);
}

// headers é passado pelo chamador para suportar colunas dinâmicas de meses
async function writeMonthlySnapshot(tabName, headers, dealRows) {
  const token = await getAccessToken();
  await ensureTabHeaders(token, tabName, headers);
  if (dealRows.length > 0) {
    await appendRows(token, tabName, dealRows);
  }
}

// Retorna nomes das abas mensais (padrão "Mmm AAAA", ex: "Jun 2026")
async function listMonthlyTabs() {
  const token  = await getAccessToken();
  const titles = await getSheetTitles(token);
  return titles.filter(t => /^[A-Za-zÀ-ÿ]{3} \d{4}$/.test(t));
}

// Lê todos os valores de uma aba; retorna array de arrays (primeira linha = cabeçalho)
async function readSnapshot(tabName) {
  const token = await getAccessToken();
  const data  = await apiReq(token, 'GET', `/values/${encodeURIComponent(tabName)}`);
  return data.values || [];
}

// Todos os títulos de aba da planilha (sem filtro de padrão)
async function listTabs() {
  const token = await getAccessToken();
  return getSheetTitles(token);
}

// Lê um range A1 qualquer (ex.: "'2026-06-05'!A2:A2"); retorna array de arrays
async function readRange(rangeA1) {
  const token = await getAccessToken();
  const data  = await apiReq(token, 'GET', `/values/${encodeURIComponent(rangeA1)}`);
  return data.values || [];
}

// Adiciona uma linha a uma aba qualquer, garantindo o cabeçalho
async function appendRow(tabName, headers, row) {
  const token = await getAccessToken();
  await ensureTabHeaders(token, tabName, headers);
  await appendRows(token, tabName, [row]);
}

module.exports = { appendDailyRow, writeMonthlySnapshot, listMonthlyTabs, readSnapshot, listTabs, readRange, appendRow };
