'use strict';
const assert = require('assert');
const bq = require('../lib/bigquery');
const sem = require('../api/bdr-workload-semantic')._test;
const pen = require('../api/bdr-workload-penetration')._test;
const cmp = require('../api/bdr-workload-compare')._test;
const drill = require('../api/bdr-workload-drill')._test;
const workload = require('../api/bdr-workload')._test;

function req(q) { return { url: '/?' + q }; }
async function withBqStub(rows, fn) {
  const oldConfigured = bq.isConfigured;
  const oldQuery = bq.query;
  const calls = [];
  bq.isConfigured = () => true;
  bq.query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: typeof rows === 'function' ? rows(sql, params, calls.length) : rows };
  };
  try { return await fn(calls); }
  finally { bq.isConfigured = oldConfigured; bq.query = oldQuery; }
}

(async function main() {
  assert.deepStrictEqual(bq.decodeCell([{ v: 'grande' }, { v: 'pme' }], { mode: 'REPEATED', type: 'STRING' }), ['grande', 'pme']);
  assert.deepStrictEqual(sem.CHANNELS, ['calls', 'emails', 'whatsapp', 'linkedin', 'meetings']);
  const parsedSem = sem.parse(req('v=2&since=2026-07-01&until=2026-07-02&porte=grande&segmento=Tech&persona=RH'));
  assert.equal(parsedSem.porte, 'grande');
  assert.equal(parsedSem.segmento, 'Tech');
  assert.equal(parsedSem.persona, 'RH');
  assert.equal(sem.isBusiness('2026-07-20'), true);
  assert.equal(sem.isBusiness('2026-07-19'), false);
  const associatedActivities = [{ id: '10', tipo: 'calls' }, { id: '20', tipo: 'calls' }];
  const associationDiagnostics = await workload.fetchActivityAssociations('stub', associatedActivities, async (_token, url, body) => ({ results: body.inputs.map(({ id }) => ({ from: { id }, to: [{ toObjectId: url.includes('/contacts/') ? String(Number(id) + 100) : String(Number(id) + 200) }] })) }));
  assert.deepStrictEqual(associationDiagnostics, { attempted: 2, succeeded: 2, errors: 0, available: true });
  assert.equal(associatedActivities[0].contact_id, '110');
  assert.equal(associatedActivities[0].company_id, '210');
  assert.equal(workload.smallestAssociationId({ to: [{ toObjectId: '200' }, { toObjectId: '9' }, { toObjectId: '10' }] }), '9');
  assert.equal(sem.normalizeTimestamp('1784567311.617586'), '2026-07-20T17:08:31.618Z');
  const r = sem.reactivityFromRows([{ has_touch: true, hours_to_first_touch: 0 }, { has_touch: true, hours_to_first_touch: 2 }, { has_touch: false }]);
  assert.equal(r.p50Hours, 1);
  assert.equal(r.p75Hours, 1.5);
  assert.equal(r.buckets.lt_1h, 1);
  assert.equal(r.buckets.sem_toque, 1);
  const liveAggregate = sem.aggregateLivePayload({ team: ['Thauan Pontes'], activities: [{ tipo: 'emails', direction: 'OUTGOING_EMAIL', bdr: 'Thauan Pontes', contato_id: '123' }, { tipo: 'calls', bdr: 'Thauan Pontes', telefone: 'proibido' }], contactsCreated: [{ bdr: 'Thauan Pontes', nome: 'não deve vazar', id: '456' }] }, '2026-07-20', { bdr: 'Thauan Pontes', channels: sem.CHANNELS });
  assert.equal(liveAggregate[0].emails, 1);
  assert.equal(liveAggregate[0].calls, 1);
  assert.equal(liveAggregate[0].contactsInserted, 1);
  assert.equal(liveAggregate[0].leadsCreated, undefined);
  assert(!/não deve vazar|telefone|contato_id|123|456/.test(JSON.stringify(liveAggregate)), 'agregado live não contém PII/IDs nominais');
  const liveRich = sem.aggregateLivePayload({ team: ['Thauan Pontes'], diagnostics: { activityAssociations: { attempted: 6, succeeded: 6, errors: 0, available: true } }, companiesCreated: [{ bdr: 'Thauan Pontes', id: 'c-new' }], contactsCreated: [{ bdr: 'Thauan Pontes', id: 'ct-new', empresa_id: 'c1' }], activities: [{ tipo: 'calls', duracao_ms: 61000, bdr: 'Thauan Pontes', contact_id: 'ct1', company_id: 'c1' }, { tipo: 'calls', duracao_ms: 10000, bdr: 'Thauan Pontes', contact_id: 'ct2', company_id: 'c1' }, { tipo: 'communications', canal: 'WHATS_APP', bdr: 'Thauan Pontes', contact_id: 'ct2', company_id: 'c1' }], transitions: [{ bdr: 'Thauan Pontes', para: 'CONNECTED', contact_id: 'ct1', company_id: 'c1' }, { bdr: 'Thauan Pontes', para: 'OPEN_DEAL', contact_id: 'ct1', company_id: 'c1' }, { bdr: 'Thauan Pontes', para: 'BAD_TIMING', contact_id: 'ct2', company_id: 'c1' }, { bdr: 'Thauan Pontes', para: 'NEW', contact_id: 'ct3', company_id: 'c2' }, { bdr: 'Thauan Pontes', para: 'ATTEMPTED_TO_CONTACT', contact_id: 'ct3', company_id: 'c2' }] }, '2026-07-21', { bdr: 'Thauan Pontes', channels: sem.CHANNELS });
  assert.equal(liveRich[0].callsConversation, 1);
  assert.equal(liveRich[0].callsDial, 1);
  assert.equal(liveRich[0].activities, 3);
  assert.equal(liveRich[0].total, 3);
  assert.equal(liveRich[0].companiesInserted, 1);
  assert.equal(liveRich[0].contactsInserted, 1);
  assert.equal(liveRich[0].companiesTouched, 1);
  assert.equal(liveRich[0].contactsTouched, 2);
  assert.equal(liveRich[0].crmMovements, 4);
  assert.equal(liveRich[0].attempted, 1);
  assert.equal(liveRich[0].connected, 1);
  assert.equal(liveRich[0].qualified, 1);
  assert.equal(liveRich[0].disqualified, 1);
  // Treble WhatsApp (owner nulo, atribuído pelo dono do contato): soma no canal whatsapp
  // e segrega em whatsappTreble; manual (CRM_UI) fica em whatsappManual. Sem dupla contagem.
  const trebleAgg = sem.aggregateLivePayload({ team: ['Thauan Pontes'], activities: [
    { tipo: 'communications', canal: 'WHATS_APP', bdr: 'Thauan Pontes', contact_id: 'ct1', company_id: 'c1' },
    { tipo: 'communications', canal: 'WHATS_APP', treble: true, bdr: 'Thauan Pontes', contact_id: 'ct2', company_id: 'c1' },
    { tipo: 'communications', canal: 'WHATS_APP', treble: true, bdr: 'Thauan Pontes', contact_id: 'ct3', company_id: 'c1' },
  ] }, '2026-07-21', { bdr: 'Thauan Pontes', channels: sem.CHANNELS });
  assert.equal(trebleAgg[0].whatsapp, 3, 'whatsapp = manual + treble');
  assert.equal(trebleAgg[0].whatsappManual, 1);
  assert.equal(trebleAgg[0].whatsappTreble, 2);
  assert.equal(trebleAgg[0].activities, 3, 'activities não conta treble em dobro');
  assert.equal(trebleAgg[0].total, 3);
  assert.equal(typeof workload.fetchTrebleWhatsapp, 'function', 'fetchTrebleWhatsapp exportado');
  const mergedToday = sem.rowsToAggregates([{ metric_date: sem.todayIso(), owner_name: 'Thauan Pontes', calls: '9', calls_conversation: '4', calls_dial: '5', emails: '0', whatsapp: '0', linkedin: '0', meetings: '0', activities_total: '12', companies_touched: '7', contacts_touched: '8', companies_inserted: '0', contacts_inserted: '0', attempted: '12', crm_movements: '12', connected: '5', qualified: '0', disqualified: '0', sql_deals: '2' }], { bdr: 'Thauan Pontes', channels: sem.CHANNELS }, { used: true, rows: liveRich });
  assert.equal(mergedToday.byBdr['Thauan Pontes'].sqlDeals, 2);
  assert.equal(mergedToday.byBdr['Thauan Pontes'].total, 9);
  assert.equal(mergedToday.byBdr['Thauan Pontes'].crmMovements, 12);
  assert.equal(mergedToday.byBdr['Thauan Pontes'].companiesTouched, 7);
  assert.equal(mergedToday.byBdr['Thauan Pontes'].contactsTouched, 8);
  assert.equal(mergedToday.byBdr['Thauan Pontes'].companiesInserted, 0);
  assert.equal(mergedToday.byBdr['Thauan Pontes'].contactsInserted, 0);
  const lineage = sem.liveLineage({ used: true, rows: liveRich });
  assert.equal(lineage.total, 'bq_or_live_cumulative');
  assert.equal(lineage.crmMovements, 'bq_or_live_cumulative');
  assert.equal(lineage.companiesTouched, 'bq_or_live_cumulative');
  assert.equal(lineage.companiesInserted, 'bq_daily_dimension_v2');
  assert.equal(lineage.contactsInserted, 'bq_daily_dimension_v2');
  const liveCrmLow = [{ date: sem.todayIso(), bdr: 'Thauan Pontes', calls: 294, callsConversation: 0, callsDial: 294, emails: 0, whatsapp: 0, linkedin: 0, meetings: 0, activities: 294, total: 294, attempted: 0, crmMovements: 2, connected: 0, qualified: 2, disqualified: 0, companiesTouched: 47, contactsTouched: 87 }];
  const preservedCrmBq = sem.rowsToAggregates([{ metric_date: sem.todayIso(), owner_name: 'Thauan Pontes', calls: '199', calls_conversation: '0', calls_dial: '199', emails: '0', whatsapp: '0', linkedin: '0', meetings: '0', activities_total: '199', companies_touched: '31', contacts_touched: '44', companies_inserted: '0', contacts_inserted: '0', attempted: '8', crm_movements: '24', connected: '10', qualified: '4', disqualified: '2', sql_deals: '3' }], { bdr: 'Thauan Pontes', channels: sem.CHANNELS }, { used: true, rows: liveCrmLow });
  assert.equal(preservedCrmBq.byBdr['Thauan Pontes'].total, 294);
  assert.equal(preservedCrmBq.byBdr['Thauan Pontes'].companiesTouched, 47);
  assert.equal(preservedCrmBq.byBdr['Thauan Pontes'].contactsTouched, 87);
  assert.equal(preservedCrmBq.byBdr['Thauan Pontes'].crmMovements, 24);
  assert.equal(preservedCrmBq.byBdr['Thauan Pontes'].connected, 10);
  const liveCrmHigh = [{ date: sem.todayIso(), bdr: 'Thauan Pontes', calls: 294, callsConversation: 0, callsDial: 294, emails: 0, whatsapp: 0, linkedin: 0, meetings: 0, activities: 294, total: 294, attempted: 12, crmMovements: 30, connected: 14, qualified: 10, disqualified: 6, companiesTouched: 47, contactsTouched: 87 }];
  const usedLiveCrm = sem.rowsToAggregates([{ metric_date: sem.todayIso(), owner_name: 'Thauan Pontes', calls: '199', calls_conversation: '0', calls_dial: '199', emails: '0', whatsapp: '0', linkedin: '0', meetings: '0', activities_total: '199', companies_touched: '31', contacts_touched: '44', companies_inserted: '0', contacts_inserted: '0', attempted: '8', crm_movements: '24', connected: '10', qualified: '4', disqualified: '2', sql_deals: '3' }], { bdr: 'Thauan Pontes', channels: sem.CHANNELS }, { used: true, rows: liveCrmHigh });
  assert.equal(usedLiveCrm.byBdr['Thauan Pontes'].crmMovements, 30);
  assert.equal(usedLiveCrm.byBdr['Thauan Pontes'].connected, 14);
  assert.equal(usedLiveCrm.byBdr['Thauan Pontes'].attempted, 12);
  const liveNoAssoc = sem.aggregateLivePayload({ team: ['Thauan Pontes'], diagnostics: { activityAssociations: { attempted: 2, succeeded: 0, errors: 2, available: false } }, contactsCreated: [{ bdr: 'Thauan Pontes', empresa_id: 'created-company' }], activities: [{ tipo: 'calls', duracao_ms: 61000, bdr: 'Thauan Pontes' }], transitions: [{ bdr: 'Thauan Pontes', para: 'CONNECTED', contact_id: 'crm-contact', company_id: 'crm-company' }] }, sem.todayIso(), { bdr: 'Thauan Pontes', channels: sem.CHANNELS });
  assert.equal(Object.prototype.hasOwnProperty.call(liveNoAssoc[0], 'companiesTouched'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(liveNoAssoc[0], 'contactsTouched'), false);
  const preservedTouched = sem.rowsToAggregates([{ metric_date: sem.todayIso(), owner_name: 'Thauan Pontes', calls: '0', calls_conversation: '0', calls_dial: '0', emails: '0', whatsapp: '0', linkedin: '0', meetings: '0', activities_total: '0', companies_touched: '7', contacts_touched: '8', companies_inserted: '0', contacts_inserted: '0', attempted: '0', crm_movements: '0', connected: '0', qualified: '0', disqualified: '0', sql_deals: '2' }], { bdr: 'Thauan Pontes', channels: sem.CHANNELS }, { used: true, rows: liveNoAssoc });
  assert.equal(preservedTouched.byBdr['Thauan Pontes'].companiesTouched, 7);
  assert.equal(preservedTouched.byBdr['Thauan Pontes'].contactsTouched, 8);
  await withBqStub((sql, params, n) => {
    if (sql.includes('bdr_workload_reactivity_v2')) return [{ owner_name: 'Thauan Pontes', has_touch: true, hours_to_first_touch: 0 }, { owner_name: 'Thauan Pontes', has_touch: false }];
    if (sql.includes('ARRAY_AGG')) return [{ portes: ['grande'], segmentos: ['Tech'], personas: ['RH'] }];
    if (sql.includes('silver') && sql.includes('leads')) return [{ latest_snapshot_date: '2026-07-17', latest_ingested_at: '2026-07-17 12:00:00', latest_created_date: '2026-07-17' }];
    if (n === 1) return [{ metric_date: '2026-07-17', owner_name: 'Thauan Pontes', calls: '2', calls_conversation: '1', calls_dial: '1', emails: '3', whatsapp: '1', linkedin: '0', meetings: '1', activities_total: '7', companies_touched: '2', contacts_touched: '5', companies_inserted: '1', contacts_inserted: '4', attempted: '6', crm_movements: '10', connected: '3', qualified: '2', disqualified: '1', sql_deals: '1', refreshed_at: '2026-07-17T10:00:00Z' }];
    return [];
  }, async (calls) => {
    const out = await sem.build(sem.parse(req('v=2&since=2026-07-17&until=2026-07-17&channels=calls,emails&porte=grande&segmento=Tech&persona=RH')));
    assert.equal(out.data.rhythm.totals.total, 5);
    assert.equal(out.data.rhythm.totals.companiesInserted, 1);
    assert.equal(out.data.rhythm.totals.contactsInserted, 4);
    assert.equal(out.data.rhythm.totals.attempted, 6);
    assert.equal(out.data.rhythm.totals.crmMovements, 10);
    assert.equal(out.data.rhythm.totals.connected, 3);
    assert.equal(out.data.reactivity.buckets.lt_1h, 1);
    assert(calls[0].sql.includes('bdr_workload_daily_dimension_v2'));
    assert(calls[0].sql.includes('persona'));
    assert(!calls[0].sql.includes('leads_created'));
    assert(!calls[0].sql.includes('companies_created'));
  });

  assert.equal(pen.bucketExact(0), '0');
  assert.equal(pen.bucketExact(6), '6+');
  assert.equal(pen.grouped('2'), '2–3');
  const buckets = pen.buildBuckets([{ contacts_real: 0, companies: 2, converted: 0 }, { contacts_real: 1, companies: 3, converted: 1 }, { contacts_real: 6, companies: 5, converted: 2 }]);
  assert.equal(buckets.denominatorEligible, 10);
  assert.equal(buckets.exact.find((x) => x.label === '0').companies, 2);
  assert.equal(pen.wilson(2, 10).rate, 0.2);
  assert.deepStrictEqual(pen.bdrIds('Cintia Rodrigues').sort(), ['86900152', '87213208']);
  await withBqStub((sql) => {
    if (sql.includes('company_scope')) return [{ porte: 'grande', segmento: 'Tech', contacts_touched: '0', companies: '2', converted: '0', contacts_eligible: '3', contacts_touched_sum: '0', touches_real: '0', refreshed_at: '2026-07-17T10:00:00Z' }];
    if (sql.includes('silver') && sql.includes('leads')) return [{ latest_snapshot_date: '2026-07-31', latest_ingested_at: '2026-07-31 12:00:00', latest_created_date: '2026-07-31' }];
    if (sql.includes('MAX(eligible_date)')) return [{ latest_eligible_date: '2026-07-31', refreshed_at: '2026-07-31 12:00:00' }];
    return [{ personas: ['RH'], portes: ['grande'], segmentos: ['Tech'] }];
  }, async (calls) => {
    const out = await pen.build(pen.parse(req('v=2&since=2026-07-01&until=2026-07-31&persona=RH&porte=grande&segmento=Tech')));
    assert.equal(out.coverage.denominatorEligible, 2);
    assert.equal(out.source.latestDataDate, '2026-07-31');
    assert.equal(out.source.refreshedAt, '2026-07-31T12:00:00.000Z');
    assert.equal(out.source.latestEligibleDate, '2026-07-31');
    assert.equal(out.data.bucketsExact.find((x) => x.label === '0').companies, 2);
    assert(calls[0].sql.includes('bdr_workload_company_contact_v2'));
    assert(calls[0].sql.includes('company_scope'));
    assert(calls[0].sql.includes('COALESCE(NULLIF(cohort_key'));
    assert(calls[0].sql.includes('GROUP BY denominator_key, owner_id, company_id'));
    assert(calls[0].sql.includes('COUNT(DISTINCT denominator_key) companies'));
    assert(!calls[0].sql.includes('bdr_workload_company_v2'));
    assert(!JSON.stringify(calls[0].params).includes('ARRAY'));
  });
  await withBqStub((sql) => {
    if (sql.includes('company_scope')) return [{ porte: 'grande', segmento: 'Tech', contacts_touched: '1', companies: '86', converted: '8', contacts_eligible: '120', contacts_touched_sum: '86', touches_real: '100', refreshed_at: '2026-07-20T10:00:00Z' }];
    if (sql.includes('silver') && sql.includes('leads')) return [{ latest_snapshot_date: '2026-07-20', latest_ingested_at: '2026-07-20 12:00:00', latest_created_date: '2026-07-20' }];
    if (sql.includes('MAX(eligible_date)')) return [{ latest_eligible_date: '2026-07-20', refreshed_at: '2026-07-20 12:00:00' }];
    return [{ personas: ['RH'], portes: ['grande'], segmentos: ['Tech'] }];
  }, async (calls) => {
    const out = await pen.build(pen.parse(req('v=2&since=2026-07-20&until=2026-07-20&porte=grande&segmento=Tech')));
    assert.equal(out.coverage.denominatorEligible, 86);
    assert(calls[0].sql.includes('FROM `gen-lang-client-0423905839.axenya_sales_hubspot_bdr_prd_sae1_gold.bdr_workload_company_contact_v2` cc'));
    assert(calls[0].sql.includes('cc.eligible_date BETWEEN @since AND @until'));
    assert(!calls[0].sql.includes('bdr_workload_company_v2'));
    assert(calls.some((call) => call.sql.includes('MAX(eligible_date)') && call.sql.includes('bdr_workload_company_contact_v2') && !call.sql.includes('bdr_workload_company_v2')));
  });
  await withBqStub((sql) => {
    if (sql.includes('silver') && sql.includes('leads')) return [{ latest_snapshot_date: '2026-07-31', latest_ingested_at: '2026-07-31 12:00:00', latest_created_date: '2026-07-31' }];
    if (sql.includes('MAX(eligible_date)')) return [{ latest_eligible_date: '2026-07-31', refreshed_at: '2026-07-31 12:00:00' }];
    if (sql.includes('ARRAY_AGG')) return [{ personas: ['RH'], portes: ['grande'], segmentos: ['Tech'] }];
    return [];
  }, async () => {
    const out = await pen.build(pen.parse(req('v=2&since=2026-07-01&until=2026-07-31')));
    assert.equal(out.coverage.denominatorEligible, 0);
    assert.equal(out.emptyState.message, 'Nenhum lead elegível criado no período');
    assert.equal(out.data.bucketsExact.length, 0);
    assert.equal(out.data.association.length, 0);
    assert.equal(out.quality.status, 'pass');
  });
  await withBqStub((sql) => {
    if (sql.includes('silver') && sql.includes('leads')) return [{}];
    if (sql.includes('MAX(eligible_date)')) return [{}];
    if (sql.includes('ARRAY_AGG')) return [{}];
    return [];
  }, async () => {
    const out = await pen.build(pen.parse(req('v=2&since=2026-07-01&until=2026-07-31')));
    assert.equal(out.quality.status, 'warn');
    assert.equal(out.emptyState.kind, 'warehouse-unavailable');
  });

  assert.equal(cmp.businessDays('2026-07-20', '2026-07-24'), 5);
  const liveService = { liveRowsForToday: async () => ({ used: true, rows: [{ date: cmp.todayBrt(), bdr: 'Thauan Pontes', calls: 4, emails: 3, whatsapp: 2, linkedin: 1, meetings: 0 }], generatedAt: '2026-07-21T12:00:00Z' }) };
  const fallbackRows = await cmp.applyLiveFallback([{ period_key: 'A', metric_date: '2026-07-20', owner_name: 'Thauan Pontes', calls_total: 5, emails_sent_total: 0, whatsapp_total: 0, linkedin_total: 0, meetings_total: 0, metric: 5 }], { domain: 'ritmo', aSince: '2026-07-20', aUntil: '2026-07-20', bSince: cmp.todayBrt(), bUntil: cmp.todayBrt(), bdr: null, channels: ['calls', 'emails'], businessDays: true, porte: null, segmento: null, persona: null }, liveService);
  assert.equal(fallbackRows.quality.liveFallbackUsed, cmp.isBusiness(cmp.todayBrt()));
  assert.equal(fallbackRows.rows.filter((r) => r.period_key === 'A').reduce((m, r) => m + Number(r.metric || 0), 0), 5);
  if (cmp.isBusiness(cmp.todayBrt())) assert.equal(fallbackRows.rows.filter((r) => r.period_key === 'B').reduce((m, r) => m + Number(r.metric || 0), 0), 7);
  assert(!/phone|telefone|contact_id|email@|@/.test(JSON.stringify(fallbackRows.rows)), 'fallback live agregado não contém PII');
  const multiDay = await cmp.applyLiveFallback([{ period_key: 'B', metric_date: '2026-07-20', owner_name: 'Thauan Pontes', calls_total: 9, emails_sent_total: 0, whatsapp_total: 0, linkedin_total: 0, meetings_total: 0, metric: 9 }, { period_key: 'B', metric_date: cmp.todayBrt(), owner_name: 'Thauan Pontes', calls_total: 0, emails_sent_total: 0, whatsapp_total: 0, linkedin_total: 0, meetings_total: 0, metric: 0 }], { domain: 'ritmo', aSince: '2026-07-13', aUntil: '2026-07-19', bSince: '2026-07-20', bUntil: cmp.todayBrt(), bdr: null, channels: ['calls', 'emails'], businessDays: true, porte: null, segmento: null, persona: null }, liveService);
  if (cmp.isBusiness(cmp.todayBrt())) {
    assert.equal(multiDay.rows.filter((r) => r.period_key === 'B' && String(r.metric_date).slice(0, 10) === '2026-07-20').reduce((m, r) => m + Number(r.metric || 0), 0), 9);
    assert.equal(multiDay.rows.filter((r) => r.period_key === 'B' && String(r.metric_date).slice(0, 10) === cmp.todayBrt()).reduce((m, r) => m + Number(r.metric || 0), 0), 7);
  }
  const blockedFallback = await cmp.applyLiveFallback([], { domain: 'ritmo', aSince: '2026-07-20', aUntil: '2026-07-20', bSince: cmp.todayBrt(), bUntil: cmp.todayBrt(), bdr: null, channels: ['calls'], businessDays: true, porte: 'grande', segmento: null, persona: null }, liveService);
  assert.equal(blockedFallback.quality.liveFallbackUsed, false);
  assert.equal(blockedFallback.quality.blockedByFilters, true);
  const crmNoFallback = await cmp.applyLiveFallback([], { domain: 'crm', aSince: '2026-07-20', aUntil: '2026-07-20', bSince: cmp.todayBrt(), bUntil: cmp.todayBrt(), bdr: null, channels: ['calls'], businessDays: true, porte: null, segmento: null, persona: null }, liveService);
  assert.equal(crmNoFallback.quality.liveFallbackUsed, false);
  assert.equal(cmp.metricExpression('crm', []), 'SUM(crm_movements)');
  assert.equal(cmp.metricExpression('insercao', []), 'SUM(companies_inserted) + SUM(contacts_inserted)');
  ['ritmo', 'insercao', 'crm', 'contato_efetivo', 'sql'].forEach((domain) => assert(cmp.SUPPORTED_DOMAINS.includes(domain)));
  const crmComps = cmp.makeComponents([{ period_key: 'A', owner_name: 'Thauan Pontes', crm_movements: 10, attempted_total: 7, connected_total: 2, qualified_total: 1, disqualified_total: 1, metric: 10 }, { period_key: 'B', owner_name: 'Thauan Pontes', crm_movements: 12, attempted_total: 8, connected_total: 3, qualified_total: 2, disqualified_total: 1, metric: 12 }], { domain: 'crm', breakdown: 'none', channels: [] });
  assert.equal(crmComps.length, 1);
  assert.equal(crmComps[0].key, 'crmMovements');
  assert.equal(crmComps[0].delta, 2);
  await withBqStub([{ period_key: 'A', metric_date: '2026-07-20', owner_name: 'Thauan Pontes', crm_movements: '10', attempted_total: '7', connected_total: '2', qualified_total: '1', disqualified_total: '1', metric: '10', refreshed_at: '2026-07-20T09:00:00Z' }, { period_key: 'B', metric_date: '2026-07-21', owner_name: 'Thauan Pontes', crm_movements: '12', attempted_total: '8', connected_total: '3', qualified_total: '2', disqualified_total: '1', metric: '12', refreshed_at: '2026-07-21T09:00:00Z' }], async (calls) => {
    const out = await cmp.build(cmp.parse(req('v=2&aSince=2026-07-20&aUntil=2026-07-20&bSince=2026-07-21&bUntil=2026-07-21&domain=crm&breakdown=none')));
    assert.equal(out.data.totalA, 10);
    assert.equal(out.data.totalB, 12);
    assert.equal(out.invariant.matches, true);
    assert.equal(out.data.waterfall.find((x) => x.key === 'attempted').b, 8);
    assert(calls[0].sql.includes('bdr_workload_daily_dimension_v2'));
    assert(calls[0].sql.includes('crm_movements'));
  });

  assert.deepStrictEqual(drill.parseContext('channel:calls'), { type: 'channel', value: 'calls' });
  assert.deepStrictEqual(drill.parseContext('bucket:2–3'), { type: 'bucket', value: '2–3' });
  assert.throws(() => drill.parse(req('kind=activity&since=2026-07-01&until=2026-07-02&context=foo:bar')), /context inválido/);
  const dq = drill.queryFor(drill.parse(req('kind=activity&since=2026-07-01&until=2026-07-02&context=channel:calls&limit=500')), false);
  assert(dq.sql.includes('bdr_workload_touch_detail_v2'));
  assert(dq.sql.includes('x.channel = @contextValue'));
  assert.equal(dq.params.find((p) => p.name === 'limit').value, 50);
  const groupedBucketQ = drill.queryFor(drill.parse(req('kind=penetration&since=2026-07-01&until=2026-07-02&context=bucket:2–3')), false);
  assert(groupedBucketQ.sql.includes('BETWEEN @bucketMin AND @bucketMax'));
  assert.equal(groupedBucketQ.params.find((p) => p.name === 'bucketMin').value, 2);
  assert.equal(groupedBucketQ.params.find((p) => p.name === 'bucketMax').value, 3);
  const crmQ = drill.queryFor(drill.parse(req('kind=crm&since=2026-07-01&until=2026-07-02&context=event:connected')), false);
  assert(crmQ.sql.includes('bdr_workload_crm_events_v2'));
  assert(crmQ.sql.includes('x.event_type = @contextValue'));
  const clean = drill.sanitizeRow({ company_id: '1', contact_id: '2', deal_id: '3', email: 'x@y.com', phone: '123', contact_name: 'Pessoa', company_name: 'Empresa', owner_name: 'Thauan Pontes' });
  assert.equal(clean.companyUrl, 'https://app.hubspot.com/contacts/44715285/record/0-2/1');
  assert.equal(clean.dealUrl, 'https://app.hubspot.com/contacts/44715285/record/0-3/3');
  assert.equal(clean.contactUrl, undefined);
  assert.equal(clean.contact_id, undefined);
  assert.equal(clean.company_name, 'Empresa');
  assert(!/x@y.com|123|Pessoa/.test(JSON.stringify(clean)));

  console.log('PASS bdr-workload-v2 API contract tests');
})().catch((error) => { console.error(error); process.exit(1); });
