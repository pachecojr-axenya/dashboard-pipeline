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
 *  - Demais etapas → data prevista de receita + régua via calcReceita (cap 24m).
 */
(function (root) {
  var _cfg = null;
  function config(deps) { _cfg = deps || {}; }

  // Receita mensal (real + ponderada) de UM deal, por MONTHS. Pura: não acumula.
  function dealMonthly(d, probAdj) {
    var MONTHS = _cfg.MONTHS, getVpv = _cfg.getVpv, parseRevenueDate = _cfg.parseRevenueDate,
        addMonths = _cfg.addMonths, todayStr = _cfg.todayStr, calcReceita = _cfg.calcReceita;
    var FM = root.FaturamentoManual;
    var NIL = MONTHS.map(function () { return null; });

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
      var now = new Date(); var nowRef = { y: now.getFullYear(), mo: now.getMonth() };
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

    // Cotação / Consultoria / Negociação: início da receita depende do modelo.
    var revStart2;
    if (['Cotação', 'Consultoria', 'Negociação'].indexOf(d.stage) !== -1) {
      var modelo = (d.modelo_remuneracao || '').toLowerCase();
      if (modelo.indexOf('corretagem') !== -1) revStart2 = (d.vigencia && d.vigencia >= todayStr()) ? addMonths(parseRevenueDate(d.vigencia), 2) : addMonths(parseRevenueDate(d.data_prevista_para_receita), 2);
      else if (modelo.indexOf('fee') !== -1) revStart2 = addMonths(parseRevenueDate(d.data_prevista_para_receita), 2);
      else revStart2 = parseRevenueDate(d.data_prevista_para_receita);
    } else {
      revStart2 = parseRevenueDate(d.data_prevista_para_receita);
    }
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
