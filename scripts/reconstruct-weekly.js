'use strict';
/**
 * scripts/reconstruct-weekly.js — reconstrói fotografias semanais PASSADAS do pipe
 * via histórico de propriedades do HubSpot (propertiesWithHistory) e grava cada uma
 * como aba "YYYY-MM-DD" na planilha de snapshots, no formato bruto de 35 colunas
 * (mesmo da aba "Jun 2026"). Método validado em 2026-07-02 contra a foto real de
 * 06/06 ("Mai 2026"): 91/91 deals exatos usando createdate HISTÓRICO (o campo pode
 * ser editado à mão no CRM; a existência do deal na data usa o valor da época).
 *
 * Limitações conhecidas (por desenho):
 *  - deals DELETADOS do HubSpot depois da data não aparecem (irrecuperáveis);
 *  - campos calculados/rolantes (Probabilidade HS, Última Atividade) ficam vazios;
 *  - a coluna "Capturada em" marca a aba como reconstruída (nunca se confunde com foto ao vivo).
 *
 * Uso:  node scripts/reconstruct-weekly.js 2026-06-05 2026-06-12 ...
 * Requer: HUBSPOT_TOKEN no .env.local e GOOGLE_SERVICE_ACCOUNT_JSON no env
 * (ou caminho da chave em GOOGLE_SA_KEY_FILE).
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_SA_KEY_FILE) {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = fs.readFileSync(process.env.GOOGLE_SA_KEY_FILE, 'utf8');
}
if (!process.env.HUBSPOT_TOKEN) {
  const envTxt = fs.readFileSync(path.join(REPO, '.env.local'), 'utf8');
  const line = envTxt.split('\n').find(l => l.startsWith('HUBSPOT_TOKEN='));
  if (line) process.env.HUBSPOT_TOKEN = line.slice('HUBSPOT_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
}

const sheets = require(path.join(REPO, 'lib', 'sheets.js'));
const { hubspotPost, fetchOwners, STAGE_MAP } = require(path.join(REPO, 'lib', 'hubspot.js'));
const { PIPELINE_VENDAS, PIPELINE_BID, PIPELINE_LABELS, HEADERS } = require(path.join(REPO, 'lib', 'snapshot-format.js'));

// Propriedades reconstruíveis via histórico (as calculadas/rolantes ficam de fora e vazias)
const HIST_PROPS = [
  'dealname', 'dealstage', 'pipeline', 'hubspot_owner_id', 'sdr',
  'produto', 'quantidade_de_colaboradores', 'vidas',
  'valor_da_fatura_do_plano_de_saude_atual', 'primeira_fatura',
  'arr_estimado', 'premio_mensal', 'modelo_de_remuneracao',
  'possui_agenciamento', 'possui_vitalicio',
  'probabilidade_de_fechamento_', 'qual_quarter_de_fechamento',
  'data_prevista_para_receita', 'vigencia', 'vencimento_da_1o_fatura',
  'createdate', 'closedate',
  'hs_v2_date_entered_1144746905', 'hs_v2_date_entered_1288611084', 'hs_v2_date_entered_1144844314',
  'hs_is_closed_won', 'hs_is_closed_lost',
  'motivo_do_declinio_ou_perdido', 'motivo_de_declinio_perdido___descricao', 'a_reuniao_ocorreu_',
];

// Última versão da propriedade com timestamp <= cutoff (null = ainda não existia)
function valueAt(versions, cutoff) {
  if (!versions || !versions.length) return null;
  const sorted = versions.slice().sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  for (const v of sorted) if (v.timestamp <= cutoff) return v.value;
  return null;
}

async function fetchAllDealIds() {
  let all = [], after = 0, hasMore = true;
  while (hasMore) {
    const resp = await hubspotPost(process.env.HUBSPOT_TOKEN, '/crm/v3/objects/deals/search', {
      filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'IN', values: [PIPELINE_VENDAS, PIPELINE_BID] }] }],
      properties: ['hs_object_id'],
      limit: 200,
      after,
    });
    all = all.concat((resp.results || []).map(r => r.id));
    hasMore = resp.paging && resp.paging.next && resp.paging.next.after != null;
    after = hasMore ? resp.paging.next.after : 0;
  }
  return all;
}

async function fetchHistories(ids) {
  const hist = {};
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const resp = await hubspotPost(process.env.HUBSPOT_TOKEN, '/crm/v3/objects/deals/batch/read', {
      properties: ['dealstage'],
      propertiesWithHistory: HIST_PROPS,
      inputs: batch.map(id => ({ id: String(id) })),
    });
    (resp.results || []).forEach(r => { hist[r.id] = r.propertiesWithHistory || {}; });
    process.stdout.write('.');
  }
  console.log('');
  return hist;
}

function buildRows(ids, hist, ownerMap, cutoff, capturedLabel) {
  const v = x => (x == null ? '' : String(x));
  const rows = [];
  for (const id of ids) {
    const h = hist[id] || {};
    const at = prop => valueAt(h[prop], cutoff);
    const created = at('createdate');
    if (!created || created > cutoff) continue; // não existia na data (usa createdate HISTÓRICO)
    const stageId = at('dealstage');
    if (!stageId) continue;
    const pipeId = at('pipeline');
    rows.push([
      id,
      v(at('dealname')),
      'https://app.hubspot.com/contacts/44715285/deal/' + id,
      PIPELINE_LABELS[pipeId] || v(pipeId),
      v(STAGE_MAP[stageId] || stageId),
      v(ownerMap[at('hubspot_owner_id')] || at('hubspot_owner_id')),
      v(ownerMap[at('sdr')] || at('sdr')),
      v(at('produto')),
      v(at('vidas')),
      v(at('quantidade_de_colaboradores')),
      v(at('valor_da_fatura_do_plano_de_saude_atual')),
      v(at('primeira_fatura')),
      v(at('arr_estimado')),
      v(at('premio_mensal')),
      v(at('modelo_de_remuneracao')),
      v(at('possui_agenciamento')),
      v(at('possui_vitalicio')),
      v(at('probabilidade_de_fechamento_')),
      '', // Probabilidade HS | calculada, não reconstruível
      v(at('qual_quarter_de_fechamento')),
      v(at('data_prevista_para_receita')),
      v(at('vigencia')),
      v(at('vencimento_da_1o_fatura')),
      v(created),
      v(at('closedate')),
      v(at('hs_v2_date_entered_1144746905')),
      v(at('hs_v2_date_entered_1288611084')),
      v(at('hs_v2_date_entered_1144844314')),
      v(at('hs_is_closed_won')),
      v(at('hs_is_closed_lost')),
      v(at('motivo_do_declinio_ou_perdido')),
      v(at('motivo_de_declinio_perdido___descricao')),
      v(at('a_reuniao_ocorreu_')),
      '', // Última Atividade | rolante, não reconstruível
      capturedLabel,
    ]);
  }
  return rows;
}

(async () => {
  const fridays = process.argv.slice(2);
  if (!fridays.length || fridays.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
    console.error('Uso: node scripts/reconstruct-weekly.js YYYY-MM-DD [YYYY-MM-DD ...]');
    process.exit(1);
  }

  console.log('Buscando deals atuais (Vendas + Bid)...');
  const ids = await fetchAllDealIds();
  console.log('Deals na base atual: ' + ids.length);
  console.log('Carregando histórico de ' + HIST_PROPS.length + ' propriedades (lotes de 25)...');
  const hist = await fetchHistories(ids);
  const ownerMap = await fetchOwners(process.env.HUBSPOT_TOKEN);

  const today = new Date().toISOString().substring(0, 10);
  for (const day of fridays) {
    // fim do dia BRT = dia seguinte 02:59:59.999Z (mesma régua do cron 23:59 BRT)
    const next = new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().substring(0, 10);
    const cutoff = next + 'T02:59:59.999Z';
    const label = 'reconstruída em ' + today + ' via histórico HubSpot | corte ' + day + ' 23:59 BRT';

    const existing = await sheets.readSnapshot(day).catch(() => []);
    if (existing.length > 0) {
      console.log('[' + day + '] PULADA: aba já existe com ' + existing.length + ' linhas.');
      continue;
    }

    const rows = buildRows(ids, hist, ownerMap, cutoff, label);
    console.log('[' + day + '] deals existentes na data: ' + rows.length + ' | gravando...');
    for (let i = 0; i < rows.length; i += 400) {
      await sheets.writeMonthlySnapshot(day, HEADERS, rows.slice(i, i + 400));
    }
    const check = await sheets.readSnapshot(day);
    console.log('[' + day + '] verificado: ' + check.length + ' linhas (esperado ' + (rows.length + 1) + ')');
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
