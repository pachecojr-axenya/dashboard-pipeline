'use strict';
/**
 * GET /api/growth-performance?from=YYYY-MM-DD&to=YYYY-MM-DD[&refresh=1]
 *
 * Cruza SPEND de mídia paga (Meta Ads + LinkedIn Ads, ao vivo nas APIs das
 * plataformas) com LEADS GERADOS (HubSpot, coorte por data de criação do
 * contato) para entregar CPL, custo por empresa e cortes por campanha, cargo,
 * porte e setor.
 *
 * A granularidade atômica é DIA × CANAL × CAMPANHA. Dia, semana e mês são
 * recortes do mesmo dado no front — nunca se busca "o mês" como número fechado,
 * senão o corte por dia/semana e por campanha fica impossível.
 *
 * Regras de atribuição (e por que elas são assim): `lib/growth-attribution.js`.
 * Resumo do que mais importa:
 *  - canal vem de `utm_source` (o `hs_analytics_source` do portal é 100%
 *    OFFLINE/INTEGRATION porque todo contato nasce por API);
 *  - CPL usa SÓ lead com `utm_medium` pago — lead orgânico do mesmo canal
 *    aparece separado e não entra na conta;
 *  - cobertura de UTM é devolvida explicitamente: o painel precisa dizer quantos
 *    leads do período não têm atribuição nenhuma, em vez de fingir que o
 *    universo é só o atribuído.
 *
 * Custo medido (julho/2026): ~2s. 1 search HubSpot (~108 contatos com UTM),
 * 1 search de contagem, 1 batch de companies, 1 chamada Meta e 2 LinkedIn.
 */

const { fetchSpend } = require('../lib/ads');
const { hubspotPost } = require('../lib/hubspot');
const kv = require('../lib/kv');
const env = require('../lib/env');
const {
  channelOf, mediumTypeOf, classifyJobTitle, porteOf, classifyInitiative,
} = require('../lib/growth-attribution');
const { setCORSHeaders, requireAuth, getHubspotToken, methodCheck } = require('./_helpers');

const PORTAL_ID = '44715285';
const TZ = 'America/Sao_Paulo';
const CACHE_TTL_MS = 15 * 60 * 1000;

const CONTACT_PROPS = [
  'firstname', 'lastname', 'email', 'jobtitle', 'createdate',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'associatedcompanyid', 'hubspot_owner_id', 'lifecyclestage', 'hs_lead_status',
];
const COMPANY_PROPS = [
  'name', 'porte', 'numberofemployees', 'vidas', 'quantidade_de_vidas', 'industry',
];

// ── Datas ---------------------------------------------------------------
// Tudo em BRT: o portal HubSpot e as contas de anúncio estão em America/Sao_Paulo,
// então bucketizar por UTC jogaria lead da noite para o dia seguinte.

function brtToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

function brtDateOf(isoTimestamp) {
  const d = new Date(isoTimestamp);
  if (isNaN(d)) return null;
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthStart(iso) { return `${iso.slice(0, 7)}-01`; }

/** Limites UTC de um intervalo de dias BRT (Brasil sem horário de verão: -03:00). */
function utcBounds(from, to) {
  return {
    gte: `${from}T03:00:00.000Z`,
    lte: `${addDays(to, 1)}T02:59:59.999Z`,
  };
}

// ── HubSpot -------------------------------------------------------------

async function searchLeadsWithUtm(token, from, to) {
  const { gte, lte } = utcBounds(from, to);
  const all = [];
  let after;
  let guard = 0;
  while (guard++ < 120) {
    const body = {
      filterGroups: [{
        filters: [
          { propertyName: 'createdate', operator: 'GTE', value: gte },
          { propertyName: 'createdate', operator: 'LTE', value: lte },
          { propertyName: 'utm_source', operator: 'HAS_PROPERTY' },
        ],
      }],
      properties: CONTACT_PROPS,
      limit: 100,
      sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }],
    };
    if (after) body.after = after;
    const resp = await hubspotPost(token, '/crm/v3/objects/contacts/search', body);
    all.push(...(resp.results || []));
    after = resp.paging && resp.paging.next && resp.paging.next.after;
    if (!after) break;
  }
  return all;
}

/** Total de contatos criados no período (denominador da cobertura de UTM). */
async function countAllLeads(token, from, to) {
  const { gte, lte } = utcBounds(from, to);
  const resp = await hubspotPost(token, '/crm/v3/objects/contacts/search', {
    filterGroups: [{
      filters: [
        { propertyName: 'createdate', operator: 'GTE', value: gte },
        { propertyName: 'createdate', operator: 'LTE', value: lte },
      ],
    }],
    properties: ['createdate'],
    limit: 1,
  });
  return Number(resp.total || 0);
}

async function readCompanies(token, ids) {
  const map = {};
  for (let i = 0; i < ids.length; i += 100) {
    const resp = await hubspotPost(token, '/crm/v3/objects/companies/batch/read', {
      inputs: ids.slice(i, i + 100).map(id => ({ id: String(id) })),
      properties: COMPANY_PROPS,
    });
    for (const c of resp.results || []) map[String(c.id)] = c.properties || {};
  }
  return map;
}

// ── Agregação -----------------------------------------------------------

function bump(obj, key, inc) { obj[key] = (obj[key] || 0) + inc; }

function topList(counter, limit) {
  return Object.entries(counter)
    .map(([label, leads]) => ({ label, leads }))
    .sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label))
    .slice(0, limit || 50);
}

function build({ from, to, spend, leadContacts, companies, totalLeads }) {
  // ---- spend por dia/canal/campanha
  const spendByChannel = {};
  const spendByDay = {};
  const spendCampaignMap = {};
  const totals = { spend: 0, impressions: 0, clicks: 0 };

  for (const r of spend.rows) {
    bump(spendByChannel, r.channel, r.spend);
    const day = (spendByDay[r.date] = spendByDay[r.date] || {});
    bump(day, r.channel, r.spend);
    const key = `${r.channel}||${r.campaignId || r.campaignName}`;
    const c = spendCampaignMap[key] = spendCampaignMap[key] || {
      channel: r.channel, campaignId: r.campaignId, campaignName: r.campaignName,
      iniciativa: classifyInitiative(r.campaignName),
      spend: 0, impressions: 0, clicks: 0,
    };
    c.spend += r.spend; c.impressions += r.impressions; c.clicks += r.clicks;
    totals.spend += r.spend; totals.impressions += r.impressions; totals.clicks += r.clicks;
  }
  const spendCampaigns = Object.values(spendCampaignMap).sort((a, b) => b.spend - a.spend);

  // ---- leads
  const leadRows = [];
  const byChannel = {};
  const leadsByDay = {};
  const leadCampaignMap = {};
  const iniciativaLeads = {};
  const empresasPorCanal = {};
  const cargoCounter = {}, personaCounter = {}, areaCounter = {}, senioridadeCounter = {};
  const porteCounter = {}, setorCounter = {};
  let comCargo = 0, comEmpresa = 0, comPorte = 0;

  for (const c of leadContacts) {
    const p = c.properties || {};
    const canal = channelOf(p);
    const tipo = mediumTypeOf(p);
    const date = brtDateOf(p.createdate);
    const company = p.associatedcompanyid ? companies[String(p.associatedcompanyid)] : null;
    const job = classifyJobTitle(p.jobtitle);
    const porte = porteOf(company);
    const setor = (company && company.industry) || '(sem setor)';

    const row = {
      id: c.id,
      nome: `${p.firstname || ''} ${p.lastname || ''}`.trim() || (p.email || `Contato ${c.id}`),
      email: p.email || '',
      cargo: job.cargo,
      senioridade: job.senioridade,
      area: job.area,
      persona: job.persona,
      empresa: (company && company.name) || '',
      companyId: p.associatedcompanyid || '',
      porte,
      setor,
      canal,
      tipo,
      utmSource: p.utm_source || '',
      utmMedium: p.utm_medium || '',
      utmCampaign: p.utm_campaign || '',
      iniciativa: classifyInitiative(p.utm_campaign),
      data: date,
      criadoEm: p.createdate,
      lifecycle: p.lifecyclestage || '',
      leadStatus: p.hs_lead_status || '',
      hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/contact/${c.id}`,
    };
    leadRows.push(row);

    const ch = byChannel[canal] = byChannel[canal] || { total: 0, pago: 0, organico: 0, outro: 0 };
    ch.total++; ch[tipo]++;

    if (date) {
      const d = leadsByDay[date] = leadsByDay[date] || {};
      const dc = d[canal] = d[canal] || { total: 0, pago: 0, organico: 0, outro: 0 };
      dc.total++; dc[tipo]++;
    }

    const camKey = `${canal}||${p.utm_campaign || '(sem campanha)'}`;
    const cam = leadCampaignMap[camKey] = leadCampaignMap[camKey] || {
      channel: canal, utmCampaign: p.utm_campaign || '(sem campanha)',
      iniciativa: row.iniciativa,
      leads: 0, pagos: 0, organicos: 0,
    };
    cam.leads++;
    if (tipo === 'pago') cam.pagos++;
    if (tipo === 'organico') cam.organicos++;

    const iniKey = `${canal}||${row.iniciativa}`;
    const ini = iniciativaLeads[iniKey] = iniciativaLeads[iniKey] || {
      leads: 0, pagos: 0, organicos: 0, outros: 0, empresas: new Set(), utms: new Set(),
    };
    ini.leads++; ini[tipo === 'pago' ? 'pagos' : tipo === 'organico' ? 'organicos' : 'outros']++;
    if (p.associatedcompanyid) ini.empresas.add(String(p.associatedcompanyid));
    if (p.utm_campaign) ini.utms.add(p.utm_campaign);

    if (p.associatedcompanyid) {
      comEmpresa++;
      (empresasPorCanal[canal] = empresasPorCanal[canal] || new Set()).add(String(p.associatedcompanyid));
    }
    if (p.jobtitle) comCargo++;
    if (company && company.porte) comPorte++;

    // Cortes são calculados sobre o lead PAGO — é o universo que o spend paga.
    if (tipo === 'pago') {
      bump(cargoCounter, job.cargo || '(sem cargo)', 1);
      bump(personaCounter, job.persona, 1);
      bump(areaCounter, job.area, 1);
      bump(senioridadeCounter, job.senioridade, 1);
      bump(porteCounter, porte, 1);
      bump(setorCounter, setor, 1);
    }
  }

  const leadCampaigns = Object.values(leadCampaignMap).sort((a, b) => b.leads - a.leads);

  // ---- join canal × iniciativa (spend da plataforma × leads do HubSpot)
  // As duas pontas passam pelo MESMO classificador de iniciativa, então o join é
  // por chave e não por semelhança de nome. Ver lib/growth-attribution.js.
  const iniciativaSpend = {};
  for (const s of spendCampaigns) {
    const k = `${s.channel}||${s.iniciativa}`;
    const e = iniciativaSpend[k] = iniciativaSpend[k] || {
      spend: 0, impressions: 0, clicks: 0, ads: new Set(),
    };
    e.spend += s.spend; e.impressions += s.impressions; e.clicks += s.clicks;
    e.ads.add(s.campaignName);
  }

  const iniciativas = [...new Set([...Object.keys(iniciativaSpend), ...Object.keys(iniciativaLeads)])]
    .map(k => {
      const [canal, iniciativa] = k.split('||');
      const s = iniciativaSpend[k] || null;
      const l = iniciativaLeads[k] || null;
      const spendV = s ? s.spend : null;
      const pagos = l ? l.pagos : 0;
      const leadsCanal = l ? l.leads : 0;
      const empresas = l ? l.empresas.size : 0;
      return {
        canal, iniciativa,
        spend: spendV,
        impressions: s ? s.impressions : null,
        clicks: s ? s.clicks : null,
        leadsCanal, pagos,
        organicos: l ? l.organicos : 0,
        outros: l ? l.outros : 0,
        empresas,
        cpl: (spendV != null && pagos > 0) ? spendV / pagos : null,
        cplCanal: (spendV != null && leadsCanal > 0) ? spendV / leadsCanal : null,
        custoPorEmpresa: (spendV != null && empresas > 0) ? spendV / empresas : null,
        adCampaigns: s ? [...s.ads].sort() : [],
        utmCampaigns: l ? [...l.utms].sort() : [],
      };
    })
    .sort((a, b) => (b.spend || 0) - (a.spend || 0) || b.leadsCanal - a.leadsCanal);

  // ---- higiene: onde o número não fecha e POR QUÊ
  const higiene = [];
  for (const i of iniciativas) {
    if (i.spend > 0 && i.leadsCanal === 0) {
      higiene.push({
        nivel: 'alto', canal: i.canal, iniciativa: i.iniciativa,
        problema: 'Spend sem nenhum lead atribuído no período',
        detalhe: 'A campanha gastou e nenhum contato criado no período chegou com utm_source deste canal. Verificar se a URL do anúncio carrega os parâmetros UTM.',
      });
    } else if (i.spend > 0 && i.leadsCanal > 0 && i.pagos / i.leadsCanal < 0.5) {
      // O caso que mais distorce CPL: a campanha é paga, mas o utm_medium do
      // anúncio veio como `social` (orgânico). Em julho/2026 isso fez o CPL pago
      // do LinkedIn | Pesquisa aparecer como R$ 1.300 (1 lead pago) quando o
      // canal trouxe 28 leads. Sem o alerta, o número parece só "caro".
      higiene.push({
        nivel: 'alto', canal: i.canal, iniciativa: i.iniciativa,
        problema: `${i.leadsCanal - i.pagos} de ${i.leadsCanal} leads do canal não estão marcados como pagos`,
        detalhe: 'O utm_medium não veio como paid_social/cpc, então esses leads ficam fora do CPL pago e ele fica artificialmente alto. Corrigir o utm_medium na URL do anúncio.',
      });
    }
    if (i.spend == null && i.leadsCanal > 0 && ['Meta', 'LinkedIn'].includes(i.canal)) {
      higiene.push({
        nivel: 'medio', canal: i.canal, iniciativa: i.iniciativa,
        problema: `${i.leadsCanal} lead(s) sem spend correspondente`,
        detalhe: 'Não há campanha de anúncio classificada nesta iniciativa no período. Pode ser lead orgânico do canal ou utm_campaign de campanha encerrada.',
      });
    }
  }

  // ---- KPIs
  const canaisComSpend = Object.keys(spendByChannel);
  const kpiByChannel = {};
  let pagosTotal = 0;
  for (const canal of new Set([...canaisComSpend, ...Object.keys(byChannel)])) {
    const conectado = canaisComSpend.includes(canal);
    // Canal sem spend conectado devolve null, nunca 0: "R$ 0,00 por empresa" leria
    // como eficiência infinita quando o correto é "não medido".
    const s = conectado ? spendByChannel[canal] : null;
    const l = byChannel[canal] || { total: 0, pago: 0, organico: 0, outro: 0 };
    const empresas = empresasPorCanal[canal] ? empresasPorCanal[canal].size : 0;
    kpiByChannel[canal] = {
      spend: s,
      leadsCanal: l.total,
      leadsPagos: l.pago,
      leadsOrganicos: l.organico,
      leadsOutros: l.outro,
      empresas,
      cpl: (s != null && l.pago > 0) ? s / l.pago : null,
      cplCanal: (s != null && l.total > 0) ? s / l.total : null,
      custoPorEmpresa: (s != null && empresas > 0) ? s / empresas : null,
      conectado,
    };
    if (conectado) pagosTotal += l.pago;
  }

  const empresasPagas = new Set(
    leadRows.filter(r => r.tipo === 'pago' && r.companyId).map(r => String(r.companyId))
  );

  const semUtm = Math.max(0, totalLeads - leadRows.length);

  return {
    range: { from, to, dias: Math.round((new Date(to) - new Date(from)) / 86400000) + 1 },
    spend: {
      total: totals.spend,
      byChannel: spendByChannel,
      byDay: Object.entries(spendByDay).sort((a, b) => a[0] < b[0] ? -1 : 1)
        .map(([date, ch]) => ({ date, ...ch })),
      byCampaign: spendCampaigns,
      impressions: totals.impressions,
      clicks: totals.clicks,
      ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : null,
      cpm: totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : null,
      cpc: totals.clicks > 0 ? totals.spend / totals.clicks : null,
      canaisConectados: canaisComSpend,
      erros: spend.errors,
    },
    leads: {
      comUtm: leadRows.length,
      semUtm,
      totalPeriodo: totalLeads,
      byChannel,
      byDay: Object.entries(leadsByDay).sort((a, b) => a[0] < b[0] ? -1 : 1)
        .map(([date, ch]) => ({ date, canais: ch })),
      rows: leadRows,
    },
    iniciativas,
    campanhasAnuncio: spendCampaigns,
    campanhasUtm: leadCampaigns,
    higiene,
    kpis: {
      spendTotal: totals.spend,
      leadsPagos: pagosTotal,
      cplPago: pagosTotal > 0 ? totals.spend / pagosTotal : null,
      empresasPagas: empresasPagas.size,
      custoPorEmpresa: empresasPagas.size > 0 ? totals.spend / empresasPagas.size : null,
      byChannel: kpiByChannel,
    },
    cortes: {
      cargo: topList(cargoCounter, 30),
      persona: topList(personaCounter, 30),
      area: topList(areaCounter, 20),
      senioridade: topList(senioridadeCounter, 20),
      porte: topList(porteCounter, 20),
      setor: topList(setorCounter, 20),
    },
    coverage: {
      leadsPeriodo: totalLeads,
      comUtmSource: leadRows.length,
      semUtmSource: semUtm,
      pctComUtm: totalLeads > 0 ? leadRows.length / totalLeads : null,
      comCargo, comEmpresa, comPorte,
      pctComCargo: leadRows.length ? comCargo / leadRows.length : null,
      pctComEmpresa: leadRows.length ? comEmpresa / leadRows.length : null,
      pctComPorte: leadRows.length ? comPorte / leadRows.length : null,
      canaisSemSpendConectado: ['Google'],
    },
  };
}

// ── Handler -------------------------------------------------------------

let _mem = { key: null, at: 0, data: null };

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);
  if (!methodCheck(req, res, ['GET'])) return;
  if (!requireAuth(req, res)) return;

  const today = brtToday();
  const from = isValidDate(req.query && req.query.from) ? req.query.from : monthStart(today);
  const to = isValidDate(req.query && req.query.to) ? req.query.to : today;
  if (from > to) {
    return res.status(400).json({ success: false, error: 'from não pode ser depois de to.' });
  }

  const cacheKey = `growth-perf:${from}:${to}`;
  const refresh = req.query && (req.query.refresh === '1' || req.query.refresh === 'true');

  if (!refresh && _mem.key === cacheKey && Date.now() - _mem.at < CACHE_TTL_MS) {
    return res.status(200).json({ ..._mem.data, cached: 'memory' });
  }
  if (!refresh && kv.isConfigured()) {
    try {
      const c = await kv.getJSON(env.kvKey(cacheKey));
      if (c && c.at && Date.now() - new Date(c.at).getTime() < CACHE_TTL_MS) {
        return res.status(200).json({ ...c.data, cached: 'kv' });
      }
    } catch { /* cache é conveniência, não requisito */ }
  }

  let token;
  try { token = getHubspotToken(); }
  catch (e) { return res.status(503).json({ success: false, error: e.message }); }

  try {
    const [spend, leadContacts, totalLeads] = await Promise.all([
      fetchSpend({ from, to }),
      searchLeadsWithUtm(token, from, to),
      countAllLeads(token, from, to),
    ]);

    const companyIds = [...new Set(
      leadContacts.map(c => c.properties && c.properties.associatedcompanyid).filter(Boolean)
    )];
    const companies = companyIds.length ? await readCompanies(token, companyIds) : {};

    const data = {
      success: true,
      generatedAt: new Date().toISOString(),
      ...build({ from, to, spend, leadContacts, companies, totalLeads }),
    };

    _mem = { key: cacheKey, at: Date.now(), data };
    if (kv.isConfigured()) {
      try { await kv.setJSON(env.kvKey(cacheKey), { at: new Date().toISOString(), data }); }
      catch { /* segue sem cache compartilhado */ }
    }
    return res.status(200).json(data);
  } catch (e) {
    if (_mem.key === cacheKey && _mem.data) {
      return res.status(200).json({ ..._mem.data, cached: 'memory', stale: true, staleError: e.message });
    }
    return res.status(500).json({ success: false, error: e.message });
  }
};
