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
  // multi-seleção: porte/segmento/persona aceitam lista (retrocompatível: escalar = 1º item)
  const parsedMulti = sem.parse(req('v=2&since=2026-07-01&until=2026-07-02&porte=grande,media&segmento=Tech,Saude&persona=RH,DP'));
  assert.deepStrictEqual(parsedMulti.portes, ['grande', 'media']);
  assert.deepStrictEqual(parsedMulti.segmentos, ['Tech', 'Saude']);
  assert.deepStrictEqual(parsedMulti.personas, ['RH', 'DP']);
  assert.equal(parsedMulti.porte, 'grande');
  assert.throws(() => sem.parse(req('v=2&since=2026-07-01&until=2026-07-02&porte=grande,xxx')), /porte inválido/, 'porte inválido em lista deve ser rejeitado');
  // compare: porte/segmento/persona também aceitam lista
  const parsedCmp = cmp.parse(req('v=2&aSince=2026-07-20&aUntil=2026-07-20&bSince=2026-07-21&bUntil=2026-07-21&domain=ritmo&breakdown=canal&porte=grande,media&segmento=Tech,Saude&persona=RH,DP'));
  assert.deepStrictEqual(parsedCmp.portes, ['grande', 'media']);
  assert.deepStrictEqual(parsedCmp.segmentos, ['Tech', 'Saude']);
  assert.deepStrictEqual(parsedCmp.personas, ['RH', 'DP']);
  // penetration: idem
  const parsedPen = pen.parse(req('v=2&since=2026-07-20&until=2026-07-21&porte=grande,media&segmento=Tech&persona=RH,DP'));
  assert.deepStrictEqual(parsedPen.portes, ['grande', 'media']);
  assert.deepStrictEqual(parsedPen.personas, ['RH', 'DP']);
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
  const liveAggregate = sem.aggregateLivePayload({ team: ['Marcelli Netto'], activities: [{ tipo: 'emails', direction: 'OUTGOING_EMAIL', bdr: 'Marcelli Netto', contato_id: '123' }, { tipo: 'calls', bdr: 'Marcelli Netto', telefone: 'proibido' }], contactsCreated: [{ bdr: 'Marcelli Netto', nome: 'não deve vazar', id: '456' }] }, '2026-07-20', { bdr: 'Marcelli Netto', channels: sem.CHANNELS });
  assert.equal(liveAggregate[0].emails, 1);
  assert.equal(liveAggregate[0].calls, 1);
  assert.equal(liveAggregate[0].contactsInserted, 1);
  assert.equal(liveAggregate[0].leadsCreated, undefined);
  assert(!/não deve vazar|telefone|contato_id|123|456/.test(JSON.stringify(liveAggregate)), 'agregado live não contém PII/IDs nominais');
  const liveRich = sem.aggregateLivePayload({ team: ['Marcelli Netto'], diagnostics: { activityAssociations: { attempted: 6, succeeded: 6, errors: 0, available: true } }, companiesCreated: [{ bdr: 'Marcelli Netto', id: 'c-new' }], contactsCreated: [{ bdr: 'Marcelli Netto', id: 'ct-new', empresa_id: 'c1' }], activities: [{ tipo: 'calls', desfecho: 'Conectado', duracao_ms: 61000, bdr: 'Marcelli Netto', contact_id: 'ct1', company_id: 'c1' }, { tipo: 'calls', desfecho: 'Sem resposta', duracao_ms: 10000, bdr: 'Marcelli Netto', contact_id: 'ct2', company_id: 'c1' }, { tipo: 'communications', canal: 'WHATS_APP', bdr: 'Marcelli Netto', contact_id: 'ct2', company_id: 'c1' }], transitions: [{ bdr: 'Marcelli Netto', para: 'CONNECTED', contact_id: 'ct1', company_id: 'c1' }, { bdr: 'Marcelli Netto', para: 'OPEN_DEAL', contact_id: 'ct1', company_id: 'c1' }, { bdr: 'Marcelli Netto', para: 'BAD_TIMING', contact_id: 'ct2', company_id: 'c1' }, { bdr: 'Marcelli Netto', para: 'NEW', contact_id: 'ct3', company_id: 'c2' }, { bdr: 'Marcelli Netto', para: 'ATTEMPTED_TO_CONTACT', contact_id: 'ct3', company_id: 'c2' }] }, sem.todayIso(), { bdr: 'Marcelli Netto', channels: sem.CHANNELS });
  // Classificador e o DESFECHO declarado, nao a duracao (mudou em 2026-07-27).
  assert.equal(liveRich[0].callsConversation, 1);
  assert.equal(liveRich[0].callsDial, 1);
  assert.equal(liveRich[0].callsTalkTimeS, 61);
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
  const trebleAgg = sem.aggregateLivePayload({ team: ['Marcelli Netto'], activities: [
    { tipo: 'communications', canal: 'WHATS_APP', bdr: 'Marcelli Netto', contact_id: 'ct1', company_id: 'c1' },
    { tipo: 'communications', canal: 'WHATS_APP', treble: true, bdr: 'Marcelli Netto', contact_id: 'ct2', company_id: 'c1' },
    { tipo: 'communications', canal: 'WHATS_APP', treble: true, bdr: 'Marcelli Netto', contact_id: 'ct3', company_id: 'c1' },
  ] }, '2026-07-21', { bdr: 'Marcelli Netto', channels: sem.CHANNELS });
  assert.equal(trebleAgg[0].whatsapp, 3, 'whatsapp = manual + treble');
  assert.equal(trebleAgg[0].whatsappManual, 1);
  assert.equal(trebleAgg[0].whatsappTreble, 2);
  assert.equal(trebleAgg[0].activities, 3, 'activities não conta treble em dobro');
  assert.equal(trebleAgg[0].total, 3);
  assert.equal(typeof workload.fetchTrebleWhatsapp, 'function', 'fetchTrebleWhatsapp exportado');
  const mergedToday = sem.rowsToAggregates([{ metric_date: sem.todayIso(), owner_name: 'Marcelli Netto', calls: '9', calls_conversation: '4', calls_dial: '5', emails: '0', whatsapp: '0', linkedin: '0', meetings: '0', activities_total: '12', companies_touched: '7', contacts_touched: '8', companies_inserted: '0', contacts_inserted: '0', attempted: '12', crm_movements: '12', connected: '5', qualified: '0', disqualified: '0', sql_deals: '2' }], { bdr: 'Marcelli Netto', channels: sem.CHANNELS }, { used: true, rows: liveRich });
  assert.equal(mergedToday.byBdr['Marcelli Netto'].sqlDeals, 2);
  assert.equal(mergedToday.byBdr['Marcelli Netto'].total, 9);
  assert.equal(mergedToday.byBdr['Marcelli Netto'].crmMovements, 12);
  assert.equal(mergedToday.byBdr['Marcelli Netto'].companiesTouched, 7);
  assert.equal(mergedToday.byBdr['Marcelli Netto'].contactsTouched, 8);
  assert.equal(mergedToday.byBdr['Marcelli Netto'].companiesInserted, 0);
  assert.equal(mergedToday.byBdr['Marcelli Netto'].contactsInserted, 0);
  const lineage = sem.liveLineage({ used: true, rows: liveRich });
  assert.equal(lineage.total, 'bq_or_live_cumulative');
  assert.equal(lineage.crmMovements, 'bq_or_live_cumulative');
  assert.equal(lineage.companiesTouched, 'bq_or_live_cumulative');
  assert.equal(lineage.companiesInserted, 'bq_daily_dimension_v2');
  assert.equal(lineage.contactsInserted, 'bq_daily_dimension_v2');
  const liveCrmLow = [{ date: sem.todayIso(), bdr: 'Marcelli Netto', calls: 294, callsConversation: 0, callsDial: 294, emails: 0, whatsapp: 0, linkedin: 0, meetings: 0, activities: 294, total: 294, attempted: 0, crmMovements: 2, connected: 0, qualified: 2, disqualified: 0, companiesTouched: 47, contactsTouched: 87 }];
  const preservedCrmBq = sem.rowsToAggregates([{ metric_date: sem.todayIso(), owner_name: 'Marcelli Netto', calls: '199', calls_conversation: '0', calls_dial: '199', emails: '0', whatsapp: '0', linkedin: '0', meetings: '0', activities_total: '199', companies_touched: '31', contacts_touched: '44', companies_inserted: '0', contacts_inserted: '0', attempted: '8', crm_movements: '24', connected: '10', qualified: '4', disqualified: '2', sql_deals: '3' }], { bdr: 'Marcelli Netto', channels: sem.CHANNELS }, { used: true, rows: liveCrmLow });
  assert.equal(preservedCrmBq.byBdr['Marcelli Netto'].total, 294);
  assert.equal(preservedCrmBq.byBdr['Marcelli Netto'].companiesTouched, 47);
  assert.equal(preservedCrmBq.byBdr['Marcelli Netto'].contactsTouched, 87);
  assert.equal(preservedCrmBq.byBdr['Marcelli Netto'].crmMovements, 24);
  assert.equal(preservedCrmBq.byBdr['Marcelli Netto'].connected, 10);
  const liveCrmHigh = [{ date: sem.todayIso(), bdr: 'Marcelli Netto', calls: 294, callsConversation: 0, callsDial: 294, emails: 0, whatsapp: 0, linkedin: 0, meetings: 0, activities: 294, total: 294, attempted: 12, crmMovements: 30, connected: 14, qualified: 10, disqualified: 6, companiesTouched: 47, contactsTouched: 87 }];
  const usedLiveCrm = sem.rowsToAggregates([{ metric_date: sem.todayIso(), owner_name: 'Marcelli Netto', calls: '199', calls_conversation: '0', calls_dial: '199', emails: '0', whatsapp: '0', linkedin: '0', meetings: '0', activities_total: '199', companies_touched: '31', contacts_touched: '44', companies_inserted: '0', contacts_inserted: '0', attempted: '8', crm_movements: '24', connected: '10', qualified: '4', disqualified: '2', sql_deals: '3' }], { bdr: 'Marcelli Netto', channels: sem.CHANNELS }, { used: true, rows: liveCrmHigh });
  assert.equal(usedLiveCrm.byBdr['Marcelli Netto'].crmMovements, 30);
  assert.equal(usedLiveCrm.byBdr['Marcelli Netto'].connected, 14);
  assert.equal(usedLiveCrm.byBdr['Marcelli Netto'].attempted, 12);
  const liveNoAssoc = sem.aggregateLivePayload({ team: ['Marcelli Netto'], diagnostics: { activityAssociations: { attempted: 2, succeeded: 0, errors: 2, available: false } }, contactsCreated: [{ bdr: 'Marcelli Netto', empresa_id: 'created-company' }], activities: [{ tipo: 'calls', duracao_ms: 61000, bdr: 'Marcelli Netto' }], transitions: [{ bdr: 'Marcelli Netto', para: 'CONNECTED', contact_id: 'crm-contact', company_id: 'crm-company' }] }, sem.todayIso(), { bdr: 'Marcelli Netto', channels: sem.CHANNELS });
  assert.equal(Object.prototype.hasOwnProperty.call(liveNoAssoc[0], 'companiesTouched'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(liveNoAssoc[0], 'contactsTouched'), false);
  const preservedTouched = sem.rowsToAggregates([{ metric_date: sem.todayIso(), owner_name: 'Marcelli Netto', calls: '0', calls_conversation: '0', calls_dial: '0', emails: '0', whatsapp: '0', linkedin: '0', meetings: '0', activities_total: '0', companies_touched: '7', contacts_touched: '8', companies_inserted: '0', contacts_inserted: '0', attempted: '0', crm_movements: '0', connected: '0', qualified: '0', disqualified: '0', sql_deals: '2' }], { bdr: 'Marcelli Netto', channels: sem.CHANNELS }, { used: true, rows: liveNoAssoc });
  assert.equal(preservedTouched.byBdr['Marcelli Netto'].companiesTouched, 7);
  assert.equal(preservedTouched.byBdr['Marcelli Netto'].contactsTouched, 8);
  await withBqStub((sql, params, n) => {
    if (sql.includes('bdr_workload_reactivity_v2')) return [{ owner_name: 'Marcelli Netto', has_touch: true, hours_to_first_touch: 0 }, { owner_name: 'Marcelli Netto', has_touch: false }];
    if (sql.includes('ARRAY_AGG')) return [{ portes: ['grande'], segmentos: ['Tech'], personas: ['RH'] }];
    if (sql.includes('silver') && sql.includes('leads')) return [{ latest_snapshot_date: '2026-07-17', latest_ingested_at: '2026-07-17 12:00:00', latest_created_date: '2026-07-17' }];
    if (n === 1) return [{ metric_date: '2026-07-17', owner_name: 'Marcelli Netto', calls: '2', calls_conversation: '1', calls_dial: '1', emails: '3', whatsapp: '1', linkedin: '0', meetings: '1', activities_total: '7', companies_touched: '2', contacts_touched: '5', companies_inserted: '1', contacts_inserted: '4', attempted: '6', crm_movements: '10', connected: '3', qualified: '2', disqualified: '1', sql_deals: '1', refreshed_at: '2026-07-17T10:00:00Z' }];
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
  const liveService = { liveRowsForToday: async () => ({ used: true, rows: [{ date: cmp.todayBrt(), bdr: 'Marcelli Netto', calls: 4, emails: 3, whatsapp: 2, linkedin: 1, meetings: 0 }], generatedAt: '2026-07-21T12:00:00Z' }) };
  const fallbackRows = await cmp.applyLiveFallback([{ period_key: 'A', metric_date: '2026-07-20', owner_name: 'Marcelli Netto', calls_total: 5, emails_sent_total: 0, whatsapp_total: 0, linkedin_total: 0, meetings_total: 0, metric: 5 }], { domain: 'ritmo', aSince: '2026-07-20', aUntil: '2026-07-20', bSince: cmp.todayBrt(), bUntil: cmp.todayBrt(), bdr: null, channels: ['calls', 'emails'], businessDays: true, porte: null, segmento: null, persona: null }, liveService);
  assert.equal(fallbackRows.quality.liveFallbackUsed, cmp.isBusiness(cmp.todayBrt()));
  assert.equal(fallbackRows.rows.filter((r) => r.period_key === 'A').reduce((m, r) => m + Number(r.metric || 0), 0), 5);
  if (cmp.isBusiness(cmp.todayBrt())) assert.equal(fallbackRows.rows.filter((r) => r.period_key === 'B').reduce((m, r) => m + Number(r.metric || 0), 0), 7);
  assert(!/phone|telefone|contact_id|email@|@/.test(JSON.stringify(fallbackRows.rows)), 'fallback live agregado não contém PII');
  const multiDay = await cmp.applyLiveFallback([{ period_key: 'B', metric_date: '2026-07-20', owner_name: 'Marcelli Netto', calls_total: 9, emails_sent_total: 0, whatsapp_total: 0, linkedin_total: 0, meetings_total: 0, metric: 9 }, { period_key: 'B', metric_date: cmp.todayBrt(), owner_name: 'Marcelli Netto', calls_total: 0, emails_sent_total: 0, whatsapp_total: 0, linkedin_total: 0, meetings_total: 0, metric: 0 }], { domain: 'ritmo', aSince: '2026-07-13', aUntil: '2026-07-19', bSince: '2026-07-20', bUntil: cmp.todayBrt(), bdr: null, channels: ['calls', 'emails'], businessDays: true, porte: null, segmento: null, persona: null }, liveService);
  if (cmp.isBusiness(cmp.todayBrt())) {
    assert.equal(multiDay.rows.filter((r) => r.period_key === 'B' && String(r.metric_date).slice(0, 10) === '2026-07-20').reduce((m, r) => m + Number(r.metric || 0), 0), 9);
    assert.equal(multiDay.rows.filter((r) => r.period_key === 'B' && String(r.metric_date).slice(0, 10) === cmp.todayBrt()).reduce((m, r) => m + Number(r.metric || 0), 0), 7);
  }
  const blockedFallback = await cmp.applyLiveFallback([], { domain: 'ritmo', aSince: '2026-07-20', aUntil: '2026-07-20', bSince: cmp.todayBrt(), bUntil: cmp.todayBrt(), bdr: null, channels: ['calls'], businessDays: true, porte: 'grande', segmento: null, persona: null }, liveService);
  assert.equal(blockedFallback.quality.liveFallbackUsed, false);
  if (cmp.isBusiness(cmp.todayBrt())) assert.equal(blockedFallback.quality.blockedByFilters, true);
  const crmNoFallback = await cmp.applyLiveFallback([], { domain: 'crm', aSince: '2026-07-20', aUntil: '2026-07-20', bSince: cmp.todayBrt(), bUntil: cmp.todayBrt(), bdr: null, channels: ['calls'], businessDays: true, porte: null, segmento: null, persona: null }, liveService);
  assert.equal(crmNoFallback.quality.liveFallbackUsed, false);
  assert.equal(cmp.metricExpression('crm', []), 'SUM(crm_movements)');
  assert.equal(cmp.metricExpression('insercao', []), 'SUM(companies_inserted) + SUM(contacts_inserted)');
  ['ritmo', 'insercao', 'crm', 'contato_efetivo', 'sql'].forEach((domain) => assert(cmp.SUPPORTED_DOMAINS.includes(domain)));
  const crmComps = cmp.makeComponents([{ period_key: 'A', owner_name: 'Marcelli Netto', crm_movements: 10, attempted_total: 7, connected_total: 2, qualified_total: 1, disqualified_total: 1, metric: 10 }, { period_key: 'B', owner_name: 'Marcelli Netto', crm_movements: 12, attempted_total: 8, connected_total: 3, qualified_total: 2, disqualified_total: 1, metric: 12 }], { domain: 'crm', breakdown: 'none', channels: [] });
  assert.equal(crmComps.length, 1);
  assert.equal(crmComps[0].key, 'crmMovements');
  assert.equal(crmComps[0].delta, 2);
  await withBqStub([{ period_key: 'A', metric_date: '2026-07-20', owner_name: 'Marcelli Netto', crm_movements: '10', attempted_total: '7', connected_total: '2', qualified_total: '1', disqualified_total: '1', metric: '10', refreshed_at: '2026-07-20T09:00:00Z' }, { period_key: 'B', metric_date: '2026-07-21', owner_name: 'Marcelli Netto', crm_movements: '12', attempted_total: '8', connected_total: '3', qualified_total: '2', disqualified_total: '1', metric: '12', refreshed_at: '2026-07-21T09:00:00Z' }], async (calls) => {
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
  const clean = drill.sanitizeRow({ company_id: '1', contact_id: '2', deal_id: '3', email: 'x@y.com', phone: '123', contact_name: 'Pessoa', company_name: 'Empresa', owner_name: 'Marcelli Netto' });
  assert.equal(clean.companyUrl, 'https://app.hubspot.com/contacts/44715285/record/0-2/1');
  assert.equal(clean.dealUrl, 'https://app.hubspot.com/contacts/44715285/record/0-3/3');
  // MUDOU EM 14/08/2026: o drill passou a emitir contactUrl. A regra de
  // privacidade continua sendo "nada nominal" (nome, e-mail, telefone e o
  // contact_id cru seguem fora), mas 1.395 de 4.656 linhas do drill de atividade
  // em 01-14/08 NAO tinham empresa associada e ficavam SEM NENHUM link -- drill
  // que nao abre nada nao audita, e link do objeto Lead (0-136) quebra neste
  // portal. Contato existe em 99,5% das linhas.
  assert.equal(clean.contactUrl, 'https://app.hubspot.com/contacts/44715285/record/0-1/2');
  assert.equal(clean.contact_id, undefined, 'o id cru do contato continua FORA do payload');
  assert.equal(clean.contact_name, undefined);
  assert.equal(clean.email, undefined);
  assert.equal(clean.phone, undefined);
  // Lead NUNCA vira link: a URL de registro de Lead abre em branco neste portal,
  // e link quebrado faz quem clica concluir que o DADO esta errado.
  assert.equal(drill.hubspotUrl('lead', '999'), null, 'lead nao pode virar URL');
  assert(!/0-136/.test(JSON.stringify(clean) + drill.hubspotUrl('contact', '1') + drill.hubspotUrl('company', '1')), 'nenhuma URL do drill pode apontar para o objeto Lead');
  // Sem empresa, o contato tem de ser a porta -- e esse era o caso sem link.
  const semEmpresa = drill.sanitizeRow({ contact_id: '77', metric_date: '2026-08-11', owner_name: 'Marcelli Netto' });
  assert.equal(semEmpresa.contactUrl, 'https://app.hubspot.com/contacts/44715285/record/0-1/77');
  assert.equal(semEmpresa.companyUrl, undefined);
  // O contact_id tem de estar no SELECT de todo kind, senao contactUrl nunca sai.
  const drillSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'bdr-workload-drill.js'), 'utf8');
  ['activity', 'reactivity', 'crm', 'sql'].forEach((kind) => {
    const bloco = drillSrc.split(`${kind}: {`)[1] || '';
    assert(/contact_id/.test(bloco.slice(0, 400)), `kind ${kind} precisa selecionar contact_id`);
  });
  assert.equal(clean.company_name, 'Empresa');
  assert(!/x@y.com|123|Pessoa/.test(JSON.stringify(clean)));

  // --- Contrato do filtro de BDR por owner_id (incidente 2026-07-27) ---
  // As tabelas gold guardam owner_name CRU do HubSpot ("Gabriele de Almeida
  // Silva", "Cíntia Rodrigues"); a UI filtra pelo canônico. Filtrar por nome
  // zerava 3 dos 13 BDRs com dado existente no BQ. O filtro é por owner_id.
  const team = require('../lib/bdr-team');

  // 1) Todo BDR do roster resolve para pelo menos um owner_id. Se este teste
  //    falhar, alguém adicionou BDR em BDR_TEAM sem atualizar BDR_OWNER_MAP e o
  //    filtro daquele BDR quebraria (hoje fail-closed, antes: time inteiro).
  const semOwnerId = team.BDR_TEAM.filter((bdr) => !team.bdrOwnerIds(bdr).length);
  assert.deepStrictEqual(semOwnerId, [], `BDR sem owner_id em BDR_OWNER_MAP: ${semOwnerId.join(', ')}`);

  // 2) Todo owner_id do mapa é só dígito (são interpolados no SQL).
  Object.keys(team.BDR_OWNER_MAP).forEach((id) => assert(/^\d+$/.test(id), `owner_id não numérico: ${id}`));

  // 3) Alias e acento resolvem para o MESMO owner_id do nome canônico.
  assert.deepStrictEqual(team.bdrOwnerIds('Gabriele de Almeida Silva'), team.bdrOwnerIds('Gabriele Almeida'));
  assert.deepStrictEqual(team.bdrOwnerIds('Cíntia Rodrigues'), team.bdrOwnerIds('Cintia Rodrigues'));
  assert.deepStrictEqual(team.bdrOwnerIds('Bruna Cristina Dos Reis Silva'), team.bdrOwnerIds('Bruna Reis'));

  // 4) Cíntia consolida os dois owner_ids históricos dela.
  assert.deepStrictEqual(team.bdrOwnerIds('Cintia Rodrigues').sort(), ['86900152', '87213208']);

  // 5) Fail-closed: BDR pedido que não resolve para owner_id LANÇA, em vez de
  //    devolver cláusula vazia (que traria o time inteiro rotulado como o BDR).
  assert.throws(() => team.bdrOwnerIdClause('d', [], 'BDR Fantasma'), /não tem owner_id mapeado/);
  //    Sem BDR pedido, ausência de ids é legítima (visão do time): retorna ''.
  assert.equal(team.bdrOwnerIdClause('d', []), '');
  assert.equal(team.bdrOwnerIdClause('d', team.bdrOwnerIds('Gabriele Almeida')), "d.owner_id IN ('83025540')");

  // 6) O SQL gerado filtra por owner_id e NÃO por owner_name.
  await withBqStub([], async (calls) => {
    await sem.build(sem.parse(req('v=2&since=2026-07-01&until=2026-07-02&bdr=Gabriele%20Almeida')));
    const withBdr = calls.filter((c) => /owner_id IN/.test(c.sql));
    assert(withBdr.length >= 2, 'semantic deve filtrar rhythm e reactivity por owner_id');
    calls.forEach((c) => assert(!/owner_name\s*=\s*@bdr/.test(c.sql), 'não deve sobrar filtro por owner_name'));
  });

  // 7) BDR inválido continua barrado no parse (400), nunca chega ao SQL.
  assert.throws(() => sem.parse(req('v=2&since=2026-07-01&until=2026-07-02&bdr=Fulano%20Inexistente')), /BDR inválido/);
  assert.throws(() => drill.parse(req('kind=activity&since=2026-07-01&until=2026-07-02&bdr=Fulano%20Inexistente')), /BDR inválido/);

  // --- Contrato de qualidade de ligacao (incidente 2026-07-27) ---
  // Antes: conversa era classificada por `hs_call_duration >= 60s`, mas o ETL
  // nunca pedia essa propriedade ao HubSpot -> campo sempre NULL -> 100% das
  // ligacoes viravam "tentativa" (5.767/5.767). Agora a fonte e o desfecho
  // declarado (hs_call_disposition). Politica: sucesso = 'Conectado' apenas;
  // voicemail tem output mas nao e conversa e vive em bucket proprio.
  const liveCall = (desfecho, durMs) => ({ bdr: 'Gabriele Almeida', tipo: 'calls', ts: '1', desfecho, duracao_ms: durMs });
  const callPayload = {
    team: ['Gabriele Almeida'],
    activities: [
      liveCall('Conectado', 120000),      // conectada, 120s em linha
      liveCall('Conectado', 20000),       // conectada curta: CONTA (antes era descartada por <60s)
      liveCall('Sem resposta', 0),
      liveCall('Ocupado', 90000),         // duracao alta SEM conexao: nao conta como conversa
      liveCall('Número errado', 0),
      liveCall('Deixou mensagem de voz', 30000),
      liveCall('Deixou mensagem ativa', 10000),
      liveCall(null, 0),                  // sem desfecho registrado
    ],
  };
  const callUnknown = new Set();
  const callRows = sem.aggregateLivePayload(callPayload, '2026-07-27', { bdr: 'Gabriele Almeida', channels: ['calls'] }, callUnknown);
  assert.equal(callRows.length, 1);
  const cr = callRows[0];
  assert.equal(cr.calls, 8, 'todas as ligacoes contam no volume');
  assert.equal(cr.callsConversation, 2, 'só desfecho Conectado é conversa');
  assert.equal(cr.callsVoicemail, 2, 'voicemail e recado ativo em bucket proprio');
  assert.equal(cr.callsNoAnswer, 1);
  assert.equal(cr.callsBusy, 1);
  assert.equal(cr.callsWrongNumber, 1);
  assert.equal(cr.callsNoOutcome, 1);
  // MECE: volume = conectadas + voicemail + sem conexao, sem sobreposicao.
  assert.equal(cr.callsConversation + cr.callsVoicemail + cr.callsDial, cr.calls, 'buckets de ligacao devem ser MECE');
  assert.equal(cr.callsDial, 4, 'sem conexao = no_answer + busy + wrong_number + sem desfecho');
  // Tempo em linha soma SO as conectadas: 120s + 20s. O Ocupado de 90s nao entra.
  assert.equal(cr.callsTalkTimeS, 140, 'tempo em linha considera apenas conectadas');
  // Voicemail nao pode inflar a taxa de conexao (decisao do dono, 2026-07-27).
  assert.ok(cr.callsConversation < cr.callsConversation + cr.callsVoicemail);

  // GUID e a chave canonica: precisa concordar com o BQ mesmo se o label mudar
  // de idioma ou vier customizado no portal (achado do review, 2026-07-27).
  const byGuid = sem.aggregateLivePayload({ team: ['Gabriele Almeida'], activities: [
    { bdr: 'Gabriele Almeida', tipo: 'calls', ts: '1', desfechoId: 'f240bbac-87c9-4f6e-bf70-924b57d47db7', desfecho: 'Connected', duracao_ms: 60000 },
    { bdr: 'Gabriele Almeida', tipo: 'calls', ts: '1', desfechoId: 'b2cf5968-551e-4856-9783-52b3da59a7d0', desfecho: 'qualquer coisa', duracao_ms: 0 },
  ] }, '2026-07-27', { bdr: 'Gabriele Almeida', channels: ['calls'] });
  assert.equal(byGuid[0].callsConversation, 1, 'GUID deve classificar conectada mesmo com label em outro idioma');
  assert.equal(byGuid[0].callsVoicemail, 1, 'GUID tem precedencia sobre label divergente');
  // Label com acento/caixa/espaco extra ainda resolve (fallback defensivo).
  const byLabel = sem.aggregateLivePayload({ team: ['Gabriele Almeida'], activities: [
    { bdr: 'Gabriele Almeida', tipo: 'calls', ts: '1', desfecho: '  CONECTADO  ', duracao_ms: 30000 },
    { bdr: 'Gabriele Almeida', tipo: 'calls', ts: '1', desfecho: 'Número errado' },
  ] }, '2026-07-27', { bdr: 'Gabriele Almeida', channels: ['calls'] });
  assert.equal(byLabel[0].callsConversation, 1, 'label deve normalizar caixa/espaco');
  assert.equal(byLabel[0].callsWrongNumber, 1, 'label deve normalizar acento');
  // Desfecho desconhecido precisa ser DIAGNOSTICADO, nao virar silenciosamente
  // "sem conexao" -- e o modo de falha que zeraria a taxa do dia sem aviso.
  const unknownSet = new Set();
  const unknownRows = sem.aggregateLivePayload({ team: ['Gabriele Almeida'], activities: [
    { bdr: 'Gabriele Almeida', tipo: 'calls', ts: '1', desfechoId: 'guid-que-nao-existe', desfecho: 'Label Novo Do HubSpot' },
  ] }, '2026-07-27', { bdr: 'Gabriele Almeida', channels: ['calls'] }, unknownSet);
  assert.equal(unknownRows[0].callsNoOutcome, 1, 'desconhecido conta como sem desfecho');
  assert.equal(unknownSet.size, 1, 'desfecho desconhecido deve ser coletado para diagnostico');

  // O SQL do BQ tem de trazer as colunas novas e a lineage deve declarar todas.
  await withBqStub([], async (calls) => {
    await sem.build(sem.parse(req('v=2&since=2026-07-01&until=2026-07-02')));
    const sql = calls[0].sql;
    ['calls_voicemail_total', 'calls_no_answer_total', 'calls_busy_total', 'calls_wrong_number_total', 'calls_no_outcome_total', 'calls_talk_time_s']
      .forEach((col) => assert(sql.includes(col), `SELECT deve trazer ${col}`));
  });
  const callLineage = sem.liveLineage({ used: false, rows: [] });
  ['callsConversation', 'callsVoicemail', 'callsTalkTimeS'].forEach((k) => assert(callLineage[k], `lineage deve declarar ${k}`));

  // --- Unicidade do drill por desfecho de ligacao (incidente 2026-07-27) ---
  // Antes: os cards Ligacoes/Conectadas/Sem conexao/Voicemail passavam TODOS
  // context=channel:calls -> mesma query -> 5.781 linhas em todos. Agora cada
  // desfecho tem context outcome:* proprio e uma clausula SQL distinta.
  const outQ = (ctx) => drill.queryFor(drill.parse(req('kind=activity&since=2026-07-01&until=2026-07-02&context=' + encodeURIComponent(ctx))), false);
  assert.deepStrictEqual(drill.parseContext('outcome:connected'), { type: 'outcome', value: 'connected' });
  assert.throws(() => drill.parse(req('kind=activity&since=2026-07-01&until=2026-07-02&context=outcome:foo')), /context inválido/);
  const sqlConnected = outQ('outcome:connected').sql;
  const sqlDial = outQ('outcome:dial').sql;
  const sqlVoicemail = outQ('outcome:voicemail').sql;
  const sqlTalk = outQ('outcome:talk_time').sql;
  const sqlChannelCalls = outQ('channel:calls').sql;
  assert(sqlConnected.includes('call_outcome') && sqlConnected.includes("'connected'"), 'outcome:connected deve filtrar call_outcome connected');
  assert(sqlDial.includes('NOT IN') && sqlDial.includes("'connected','voicemail'"), 'outcome:dial deve ser o complemento (NOT IN connected,voicemail)');
  assert(sqlTalk.includes('call_duration_s') && sqlTalk.includes("'connected'"), 'outcome:talk_time deve exigir connected + duracao');
  // Prova de UNICIDADE: os quatro SQLs de ligacao sao distintos entre si.
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const variants = [norm(sqlChannelCalls), norm(sqlConnected), norm(sqlDial), norm(sqlVoicemail), norm(sqlTalk)];
  assert.equal(new Set(variants).size, variants.length, 'cada clique de ligacao deve gerar SQL unico (era o bug: 5.781 em todos)');
  // outcome:* so vale para kind=activity (checado ao montar a query).
  assert.throws(() => drill.queryFor(drill.parse(req('kind=crm&since=2026-07-01&until=2026-07-02&context=outcome:connected')), false), /incompatível/);

  // --- Filtro global de canal chega ao drill (Bug 4) ---
  assert.deepStrictEqual(drill.parseChannels('emails,calls'), ['emails', 'calls']);
  assert.deepStrictEqual(drill.parseChannels('emails,emails,calls'), ['emails', 'calls']);
  assert.throws(() => drill.parseChannels('foo'), /canal inválido/);
  const chQ = drill.queryFor(drill.parse(req('kind=activity&since=2026-07-01&until=2026-07-02&channels=emails,calls')), false);
  assert(/x\.channel IN \(@channel0,@channel1\)/.test(chQ.sql), 'channels deve virar filtro IN por canal');
  // Precedencia: context de canal/outcome vence o filtro global (evita intersecao vazia).
  const chCtxQ = drill.queryFor(drill.parse(req('kind=activity&since=2026-07-01&until=2026-07-02&channels=emails&context=channel:calls')), false);
  assert(!/@channel0/.test(chCtxQ.sql), 'context channel deve prevalecer sobre filtro global channels');

  // --- domain:ritmo agora filtra de fato (antes: clausula morta) ---
  const ritmoQ = drill.queryFor(drill.parse(req('kind=activity&since=2026-07-01&until=2026-07-02&context=domain:ritmo')), false);
  assert(/channel IN \(/.test(ritmoQ.sql), 'domain:ritmo deve filtrar o conjunto de canais de ritmo');

  // --- fonte=armazem | o ritmo migra, o resto fica, e a fronteira e testada ---
  assert.equal(sem.parse(req('v=2&since=2026-07-01&until=2026-07-02')).fonte, 'armazem', 'default virou armazem em 13/08/2026, depois da paridade medida');
  assert.equal(sem.parse(req('v=2&since=2026-07-01&until=2026-07-02&fonte=medallion')).fonte, 'medallion', 'a rota antiga tem de continuar viva: e com ela que se compara');
  assert.throws(() => sem.parse(req('v=2&since=2026-07-01&until=2026-07-02&fonte=csv')), /fonte inválida/);
  // A fonte TEM de entrar na chave do cache. Sem isso um pedido de uma fonte
  // recebe o payload da outra dentro da janela de 45s, e a comparacao entre as
  // duas compara uma fonte com ela mesma.
  const kArm = sem.payloadKey(sem.parse(req('v=2&since=2026-07-01&until=2026-07-02&fonte=armazem')));
  const kMed = sem.payloadKey(sem.parse(req('v=2&since=2026-07-01&until=2026-07-02&fonte=medallion')));
  assert.notEqual(kArm, kMed, 'fonte tem de fazer parte da chave do cache de payload');

  // A assercao que importa: depois da mescla, o RITMO e do armazem e o CRM e do
  // medallion. Se alguem trocar a lista de campos e o CRM passar a vir do
  // armazem, esses numeros viram ZERO na tela sem erro nenhum | e o modo de
  // falha que este teste existe para pegar.
  const linhaMed = { metric_date: '2026-08-12', owner_id: '85310335', owner_name: 'Anderson Souza', calls: 10, emails: 5, whatsapp: 30, whatsapp_manual: 20, whatsapp_treble: 10, linkedin: 1, meetings: 2, activities_total: 48, contacts_touched: 9, companies_touched: 7, calls_no_answer: 3, companies_inserted: 4, contacts_inserted: 6, attempted: 8, crm_movements: 11, connected: 2, qualified: 1, disqualified: 3, sql_deals: 1, refreshed_at: '2026-08-12T23:00:00Z' };
  const linhaArm = { metric_date: '2026-08-12', owner_id: '85310335', owner_name: 'Anderson Souza', calls: 10, emails: 5, whatsapp: 20, whatsapp_manual: 20, whatsapp_treble: 10, linkedin: 1, meetings: 2, activities_total: 38, contacts_touched: 8, companies_touched: 7, calls_no_answer: 3 };
  const soArmazem = { metric_date: '2026-08-13', owner_id: '90141426', owner_name: 'Giovana Nunes', calls: 66, emails: 0, whatsapp: 0, whatsapp_manual: 0, whatsapp_treble: 0, linkedin: 0, meetings: 0, activities_total: 66, contacts_touched: 40, companies_touched: 30, calls_no_answer: 20 };
  const soMedallion = { metric_date: '2026-08-07', owner_id: '87213208', owner_name: 'Cintia Rodrigues', calls: 0, emails: 0, whatsapp: 0, activities_total: 0, companies_inserted: 2, contacts_inserted: 0, attempted: 0, crm_movements: 2, connected: 0, qualified: 0, disqualified: 0, sql_deals: 0 };
  const mescla = sem.mergeRitmoDoArmazem([linhaMed, soMedallion], [linhaArm, soArmazem]);
  const fundida = mescla.rows.find((r) => r.metric_date === '2026-08-12');
  assert.equal(fundida.whatsapp, 20, 'WhatsApp tem de vir do armazem (manual), nao os 30 inflados do medallion');
  assert.equal(fundida.activities_total, 38, 'atividades tem de vir do armazem (sem automacao)');
  assert.equal(fundida.contacts_touched, 8, 'contatos tocados tem de vir do armazem');
  assert.equal(fundida.crm_movements, 11, 'movimento de CRM NAO tem mart no armazem: tem de continuar vindo do medallion');
  assert.equal(fundida.companies_inserted, 4, 'insercao NAO tem mart no armazem: tem de continuar vindo do medallion');
  assert.equal(fundida.sql_deals, 1, 'SQL NAO tem mart no armazem: tem de continuar vindo do medallion');
  assert.equal(fundida.refreshed_at, '2026-08-12T23:00:00Z', 'refreshed_at so existe no medallion');
  // Uniao das chaves: hoje so existe no armazem (o ETL do medallion roda 20:00) e
  // linha vazia do medallion nao pode sumir.
  const hoje = mescla.rows.find((r) => r.metric_date === '2026-08-13');
  assert.equal(hoje.calls, 66, 'dia que so o armazem tem precisa aparecer');
  assert.equal(hoje.crm_movements, 0, 'linha so do armazem tem de nascer com CRM zerado EXPLICITO, nao ausente');
  assert(mescla.rows.some((r) => r.metric_date === '2026-08-07'), 'linha so do medallion nao pode sumir na mescla');
  assert.deepStrictEqual({ s: mescla.substituidas, n: mescla.novas, m: mescla.somenteMedallion }, { s: 1, n: 1, m: 1 });
  // Todo campo de ritmo declarado tem de existir na linha do armazem do teste,
  // senao a lista e a query saem de sincronia sem ninguem perceber.
  sem.CAMPOS_RITMO_ARMAZEM.forEach((campo) => { assert(Object.prototype.hasOwnProperty.call(fundida, campo), `campo de ritmo ausente apos a mescla: ${campo}`); });

  // Queda para o medallion quando o mart do armazem nao responde. E o caso real:
  // as 5 colunas de desfecho dependem de rebuild da imagem do ETL, e sem elas o
  // BigQuery devolve "Unrecognized name".
  await withBqStub((sql) => {
    if (sql.includes('mart_bdr_workload_dimension_daily')) throw new Error('Unrecognized name: calls_no_answer_total');
    return [linhaMed];
  }, async () => {
    const caiu = await sem.carregarRows('2026-08-12', '2026-08-12', sem.parse(req('v=2&since=2026-08-12&until=2026-08-12&fonte=armazem')));
    assert(/Unrecognized name/.test(caiu.erro), 'o erro do armazem tem de viajar no payload, nao virar 500 nem zero calado');
    assert.equal(caiu.rows[0].whatsapp, 30, 'na queda, o ritmo volta a ser o do medallion');
  });
  await withBqStub([linhaMed], async () => {
    // `fonte=medallion` tem de sair INTOCADO pelo caminho novo: e a rota de
    // comparacao, e uma mescla escondida ali faria o compare comparar o armazem
    // com ele mesmo.
    const soMed = await sem.carregarRows('2026-08-12', '2026-08-12', sem.parse(req('v=2&since=2026-08-12&until=2026-08-12&fonte=medallion')));
    assert.equal(soMed.erro, null);
    assert.equal(soMed.mescla, null, 'fonte=medallion nao pode mesclar nada');
    assert.equal(soMed.rows[0].whatsapp, 30, 'fonte=medallion devolve o numero do medallion, com automacao somada');
    // E o default (armazem) TEM de mesclar.
    const padrao = await sem.carregarRows('2026-08-12', '2026-08-12', sem.parse(req('v=2&since=2026-08-12&until=2026-08-12')));
    assert(padrao.mescla, 'o default virou armazem: tem de mesclar');
  });

  // ── SAIDA DO TIME (14/08/2026) ──────────────────────────────────────────────
  // Anderson, Cintia, Thauan e Yokyko sairam em 08/2026. A regra e POR DATA DA
  // LINHA, nao remocao do roster: julho continua contando e agosto nao. Cada
  // caso abaixo e um jeito diferente de a linha voltar por outra porta.
  const time = require('../lib/bdr-team');
  assert.equal(time.isActiveBdrOn('Thauan Pontes', '2026-07-31'), true, 'julho conta');
  assert.equal(time.isActiveBdrOn('Thauan Pontes', '2026-08-01'), false, 'agosto nao conta');
  // Grafia crua do HubSpot e owner_id tambem tem de resolver, senao a linha
  // volta pelo nome com acento (foi assim que Gabriele/Cintia zeraram em 27/07).
  assert.equal(time.isActiveBdrOn('Cíntia Rodrigues', '2026-08-05'), false, 'grafia do HubSpot resolve');
  assert.equal(time.isActiveBdrOn('87213208', '2026-08-05'), false, 'owner_id resolve');
  assert.equal(time.isActiveBdrOn('86900152', '2026-08-05'), false, 'o SEGUNDO owner_id da Cintia tambem');
  assert.equal(time.activeTeam('2026-08-01', '2026-08-31').length, 9, 'agosto: 9 BDRs');
  assert.equal(time.activeTeam('2026-07-01', '2026-07-31').length, 13, 'julho: 13 BDRs');
  assert.equal(time.activeTeam('2026-07-16', '2026-08-14').length, 13, 'janela que CRUZA a saida mantem os 13 (o trabalho de julho e real)');
  // A clausula SQL nao pode derrubar linha com owner_id NULL: `NOT (NULL)` e
  // NULL, e o WHERE descarta. Por isso ela sai com COALESCE(..., FALSE).
  const clausula = time.exitedCutClause('d', 'metric_date');
  assert(/COALESCE\(/.test(clausula), 'o corte tem de ser NULL-safe');
  assert(/85310335|90540671/.test(clausula), 'o corte cita os owner_ids que sairam');
  assert.equal(time.exitedCutClause('', 'eligible_date').includes('owner_id'), true, 'funciona sem alias');
  assert.throws(() => time.exitedCutClause('d', 'metric_date; DROP'), /coluna de data/, 'coluna de data e validada');
  // O agregado live nao pode semear linha de quem ja saiu: era assim que os 4
  // nomes apareciam ZERADOS na tela de hoje, dividindo a media do time.
  const hojeAgg = sem.aggregateLivePayload({ team: time.BDR_TEAM, activities: [{ tipo: 'calls', bdr: 'Thauan Pontes' }, { tipo: 'calls', bdr: 'Marcelli Netto' }] }, '2026-08-14', { channels: sem.CHANNELS });
  assert.equal(hojeAgg.filter((r) => r.bdr === 'Thauan Pontes').length, 0, 'quem saiu nao aparece nem zerado em agosto');
  assert.equal(hojeAgg.find((r) => r.bdr === 'Marcelli Netto').calls, 1, 'quem ficou continua contando');
  assert.equal(hojeAgg.length, 9, 'a tela de hoje mostra 9 BDRs');
  // ...e a MESMA chamada em julho tem de trazer os 13 e a ligacao do Thauan.
  const julhoAgg = sem.aggregateLivePayload({ team: time.BDR_TEAM, activities: [{ tipo: 'calls', bdr: 'Thauan Pontes' }] }, '2026-07-20', { channels: sem.CHANNELS });
  assert.equal(julhoAgg.length, 13, 'julho mostra 13');
  assert.equal(julhoAgg.find((r) => r.bdr === 'Thauan Pontes').calls, 1, 'a ligacao de julho do Thauan conta');
  // Linha do BQ com data de agosto nao entra no agregado (defesa em profundidade:
  // o SQL ja cortou, mas o drill e o merge live passam por aqui).
  const bqAgosto = sem.rowsToAggregates([{ metric_date: '2026-08-05', owner_name: 'Yokyko Muramoto', calls: '4', activities_total: '4' }, { metric_date: '2026-08-05', owner_name: 'Marcelli Netto', calls: '2', activities_total: '2' }], { channels: sem.CHANNELS }, null);
  assert.equal(bqAgosto.byBdr['Yokyko Muramoto'], undefined, 'linha de agosto de quem saiu nao vira agregado');
  assert.equal(bqAgosto.byBdr['Marcelli Netto'].calls, 2);
  const bqJulho = sem.rowsToAggregates([{ metric_date: '2026-07-05', owner_name: 'Yokyko Muramoto', calls: '4', activities_total: '4' }], { channels: sem.CHANNELS }, null);
  assert.equal(bqJulho.byBdr['Yokyko Muramoto'].calls, 4, 'linha de julho continua valendo');
  // E a regua tem de ser a MESMA da cadencia (api/bdr-leads.js) e da pagina de
  // BDR Performance (public/bdr.html) -- tres copias da vigencia foi o defeito.
  const leadsSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'bdr-leads.js'), 'utf8');
  assert(/BDR_TEAM_EXITED = Object\.keys\(BDR_EXITS\)/.test(leadsSrc), 'bdr-leads le a vigencia da lib, nao de uma copia');
  const bdrHtml = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'bdr.html'), 'utf8');
  const corteHtml = (bdrHtml.match(/BDR_TEAM_EFFECTIVE_FROM\s*=\s*'([\d-]+)'/) || [])[1];
  assert.equal(corteHtml, '2026-08', 'BDR Performance corta no mesmo mes que o Workload');

  // ── CARIMBO DE DESFECHO (14/08/2026) ────────────────────────────────────────
  // "Conectadas" e o que o BDR carimbou, nao quem atendeu. Auditado em Allan
  // Valenca, 10-13/08: 124 ligacoes (bate na virgula com o HubSpot), 2
  // conectadas, 11 ligacoes de 60s+ NAO carimbadas como conectada e 1 com
  // desfecho "Reuniao agendada", que nenhuma camada mapeia.
  assert.doesNotThrow(() => drill.parseContext('outcome:longa_sem_conexao'), 'o balde de auditoria tem de ser um context valido');
  const drillSrc2 = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'bdr-workload-drill.js'), 'utf8');
  assert(/longa_sem_conexao: \(a\) =>/.test(drillSrc2), 'a clausula do balde longa_sem_conexao tem de existir');
  assert(/call_duration_s >= 60/.test(drillSrc2), 'o piso de conversa e 60s, o mesmo de bdr-workload-calls');
  assert(/!= 'connected'/.test(drillSrc2), 'o balde tem de EXCLUIR o que ja foi carimbado como conectado (senao conta duas vezes)');
  const semSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'bdr-workload-semantic.js'), 'utf8');
  assert(/2e7360c1-6b71-40e9-ab2b-30ae98a4678c/.test(semSrc), 'o GUID de "Reuniao agendada" tem de estar declarado');
  assert(/carimbo_desfecho/.test(semSrc), 'o check carimbo_desfecho tem de existir');
  // E o mais importante: nada foi RECLASSIFICADO. "connected" continua sendo so
  // o GUID f240bbac -- se alguem somar "Reuniao agendada" em conectadas, a serie
  // historica muda de valor sem ninguem ter ligado mais.
  assert(!/CALL_DISPOSITION_GUID[^}]*2e7360c1/.test(semSrc.replace(/\n/g, ' ')), '"Reuniao agendada" NAO pode entrar no mapa de desfecho sem decisao de regua');
  const infoSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'bdr-workload-info.js'), 'utf8');
  assert(/'Conectadas':/.test(infoSrc), 'o icone de informacao precisa de ficha propria para Conectadas');
  assert(/carimbo do BDR/.test(infoSrc), 'a ficha tem de dizer que conectada e CARIMBO, nao deteccao');
  assert(/'Longas sem conexão':/.test(infoSrc), 'o card de auditoria precisa de ficha');
  assert(/Reunião agendada/.test(infoSrc), 'a ficha tem de nomear o desfecho que nenhuma camada mapeia');

  console.log('PASS bdr-workload-v2 API contract tests');
})().catch((error) => { console.error(error); process.exit(1); });
