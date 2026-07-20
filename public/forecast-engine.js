'use strict';
/**
 * forecast-engine.js | Motor de receita mensal por deal + cohorts BDR | FONTE ÚNICA.
 *
 * Consumido por public/forecast.html e public/forecast-stage.html. Elimina as duas
 * cópias do antigo `_fcDealMonthly`, garantindo que TODAS as etapas sigam as mesmas
 * regras nos dois (Regra primária nº 3 | fonte única de receita).
 *
 * Depende de: revenue-engine.js (calcReceitaMes, via `calcReceita` injetado) e
 * faturamento-manual.js (window.FaturamentoManual). As dependências de página
 * (MONTHS, getVpv, parseRevenueDate, addMonths, todayStr, calcReceita, monthLabels)
 * são injetadas via config(), porque cada página as define/edita no seu escopo.
 *
 * Regras por etapa (idênticas às do painel /forecast-stage):
 *  - Ganho/Implantação já faturando → faturamento manual (Receita Real digitada).
 *  - Diagnóstico → (vidas || colaboradores) × R$/vida; início createdate + delay
 *    (<=200: 9m · <=4999: 14m · senão 18m); se no passado, começa no mês atual.
 *  - Reunião Agendada → (vidas || colaboradores) × R$24; início createdate + 15m.
 *  - Cotação/Consultoria/Negociação → início por modelo (corretagem: vigência+2 ou
 *    prevista+2; fee: prevista+2; sem modelo: prevista) e régua via calcReceita.
 *    Fallback (2026-07-20): sem base de 1ª Fatura (régua vazia) → vidas×VPV com o
 *    delay/piso do Diagnóstico, probabilizado pela prob da própria etapa.
 *  - Demais etapas → data prevista de receita + régua via calcReceita (cap 24m).
 */
(function (root) {
  var _cfg = null;
  function config(deps) { _cfg = deps || {}; }

  // Piso temporal "agora" da projeção. Ponto-no-tempo: se _cfg.referenceDate for
  // fornecido (Date, 'YYYY-MM-DD' ou {y,mo}), ancora nele em vez do mês corrente da
  // máquina — é o que permite recomputar uma foto histórica como estava naquela data.
  // Sem referenceDate, cai no new Date() de antes, então os painéis ao vivo (que não
  // passam o campo) ficam byte-a-byte inalterados.
  function _refNow() {
    var r = _cfg && _cfg.referenceDate;
    if (r) {
      if (r instanceof Date) return { y: r.getFullYear(), mo: r.getMonth() };
      if (typeof r === 'string') { var d = new Date(r.length <= 10 ? r + 'T00:00:00' : r); return { y: d.getFullYear(), mo: d.getMonth() }; }
      if (typeof r === 'object' && r.y != null) return { y: r.y, mo: r.mo };
    }
    var now = new Date();
    return { y: now.getFullYear(), mo: now.getMonth() };
  }

  // Receita mensal (real + ponderada) de UM deal, por MONTHS. Pura: não acumula.
  function dealMonthly(d, probAdj) {
    var MONTHS = _cfg.MONTHS, getVpv = _cfg.getVpv, parseRevenueDate = _cfg.parseRevenueDate,
        addMonths = _cfg.addMonths, todayStr = _cfg.todayStr, calcReceita = _cfg.calcReceita;
    var FM = root.FaturamentoManual;
    var NIL = MONTHS.map(function () { return null; });

    // POC (É POC? = Sim): deal de prova de conceito NÃO gera receita — não infere no
    // forecast (regra do projeto). Zera Real e Probabilizada em todos os painéis.
    if (d.is_poc === true) return NIL;

    // Faturamento manual: substitui integralmente o forecast pelos valores digitados.
    var _man = FM.manualMonths(d, todayStr());
    if (_man) {
      return MONTHS.map(function (m) {
        var v = _man[FM.monthKey(m)];
        if (v == null || isNaN(v)) return null;
        var val = Number(v);
        return { val: val, rec: val, probAdj: 1, n: null, manual: true };
      });
    }

    if (d.stage === 'Diagnóstico') {
      var vidas = d.vidas || d.colaboradores || 0;
      if (!vidas) return NIL;
      var delay = vidas <= 200 ? 9 : vidas <= 4999 ? 14 : 18;
      var revStart = null;
      if (d.createdate) { var cd = new Date(d.createdate + 'T00:00:00'); var totalMo = cd.getMonth() + delay; revStart = { y: cd.getFullYear() + Math.floor(totalMo / 12), mo: totalMo % 12 }; }
      var nowRef = _refNow();
      if (!revStart || revStart.y < nowRef.y || (revStart.y === nowRef.y && revStart.mo < nowRef.mo)) revStart = nowRef;
      var recD = vidas * getVpv(vidas);
      return MONTHS.map(function (m) { if (probAdj == null) return null; var diff = (m.y - revStart.y) * 12 + (m.mo - revStart.mo); if (diff < 0) return null; return { val: recD * probAdj, rec: recD, probAdj: probAdj, n: diff + 1 }; });
    }

    if (d.stage === 'Reunião Agendada') {
      var vidasR = d.vidas || d.colaboradores || 0;
      if (!vidasR) return NIL;
      var rsR = null;
      if (d.createdate) { var cdR = new Date(d.createdate + 'T00:00:00'); var tR = cdR.getMonth() + 15; rsR = { y: cdR.getFullYear() + Math.floor(tR / 12), mo: ((tR % 12) + 12) % 12 }; }
      if (!rsR) return NIL;
      var recR = vidasR * 24;
      return MONTHS.map(function (m) { if (probAdj == null) return null; var diff = (m.y - rsR.y) * 12 + (m.mo - rsR.mo); if (diff < 0) return null; return { val: recR * probAdj, rec: recR, probAdj: probAdj, n: diff + 1 }; });
    }

    // Cotação / Consultoria / Negociação: início por modelo + régua da 1ª Fatura.
    // FALLBACK (2026-07-20): se a régua não produz receita (tipicamente sem 1ª
    // Fatura), o deal cai no vidas×VPV (mesmo delay/piso do Diagnóstico), mas
    // probabilizado pela prob da PRÓPRIA etapa — pra deal aberto não ficar invisível.
    if (['Cotação', 'Consultoria', 'Negociação'].indexOf(d.stage) !== -1) {
      var modelo = (d.modelo_remuneracao || '').toLowerCase();
      var revStartCN;
      if (modelo.indexOf('corretagem') !== -1) revStartCN = (d.vigencia && d.vigencia >= todayStr()) ? addMonths(parseRevenueDate(d.vigencia), 2) : addMonths(parseRevenueDate(d.data_prevista_para_receita), 2);
      else if (modelo.indexOf('fee') !== -1) revStartCN = addMonths(parseRevenueDate(d.data_prevista_para_receita), 2);
      else revStartCN = parseRevenueDate(d.data_prevista_para_receita);
      var reguaCN = MONTHS.map(function (m) {
        if (!revStartCN || probAdj == null) return null;
        var diff = (m.y - revStartCN.y) * 12 + (m.mo - revStartCN.mo);
        if (diff < 0 || diff > 23) return null;
        var n = diff + 1; var rec = calcReceita(n, d);
        if (rec == null) return null;
        return { val: rec * probAdj, rec: rec, probAdj: probAdj, n: n };
      });
      if (reguaCN.some(function (x) { return x != null; })) return reguaCN;
      // Sem base de 1ª Fatura → fallback vidas×VPV (delay/piso do Diagnóstico).
      var vidasCN = d.vidas || d.colaboradores || 0;
      if (!vidasCN) return NIL;
      var delayCN = vidasCN <= 200 ? 9 : vidasCN <= 4999 ? 14 : 18;
      var rsCN = null;
      if (d.createdate) { var cdCN = new Date(d.createdate + 'T00:00:00'); var tCN = cdCN.getMonth() + delayCN; rsCN = { y: cdCN.getFullYear() + Math.floor(tCN / 12), mo: tCN % 12 }; }
      var nowRefCN = _refNow();
      if (!rsCN || rsCN.y < nowRefCN.y || (rsCN.y === nowRefCN.y && rsCN.mo < nowRefCN.mo)) rsCN = nowRefCN;
      var recCN = vidasCN * getVpv(vidasCN);
      return MONTHS.map(function (m) { if (probAdj == null) return null; var diff = (m.y - rsCN.y) * 12 + (m.mo - rsCN.mo); if (diff < 0) return null; return { val: recCN * probAdj, rec: recCN, probAdj: probAdj, n: diff + 1, vpvFallback: true }; });
    }

    // Demais etapas: início na data prevista + régua (cap 24m).
    var revStart2 = parseRevenueDate(d.data_prevista_para_receita);
    return MONTHS.map(function (m) {
      if (!revStart2 || probAdj == null) return null;
      var diff = (m.y - revStart2.y) * 12 + (m.mo - revStart2.mo);
      if (diff < 0 || diff > 23) return null;
      var n = diff + 1; var rec = calcReceita(n, d);
      if (rec == null) return null;
      return { val: rec * probAdj, rec: rec, probAdj: probAdj, n: n };
    });
  }

  // ── Projeção de originação BDR (topo de funil, agregado) ────────────────────
  // 4 BDRs antigos × 34k vidas/mês + 8 novos em rampa (jul/26→jan/28). Cada coorte
  // vira receita +15m da originação (vidas × R$24), probabilizada pela conversão MQL.
  function bdrNewVidasPer(ym) {
    if (ym < '2026-07' || ym > '2028-01') return 0;
    if (ym === '2026-07') return 3333;
    if (ym === '2026-08') return 10000;
    if (ym === '2026-09') return 22667;
    return 34000;
  }
  function bdrCohorts() {
    var ML = _cfg.monthLabels, OLD = 4, NEW = 8, VIDA_OLD = 34000, out = [];
    var y = 2026, mo = 6;
    while (y < 2028 || (y === 2028 && mo <= 0)) {
      var ym = y + '-' + String(mo + 1).padStart(2, '0');
      var vNew = NEW * bdrNewVidasPer(ym);
      var vOld = OLD * VIDA_OLD;
      var vidas = vOld + vNew;
      var t = mo + 15;
      var rs = { y: y + Math.floor(t / 12), mo: ((t % 12) + 12) % 12 };
      out.push({ ymLabel: ML[mo] + '/' + String(y).slice(2), vidasOld: vOld, vidasNew: vNew, vidas: vidas, rec: vidas * 24, revStart: rs, revLabel: ML[rs.mo] + '/' + String(rs.y).slice(2) });
      mo++; if (mo > 11) { mo = 0; y++; }
    }
    return out;
  }

  root.ForecastEngine = { config: config, dealMonthly: dealMonthly, bdrCohorts: bdrCohorts, bdrNewVidasPer: bdrNewVidasPer };
})(typeof window !== 'undefined' ? window : this);
