'use strict';
/**
 * revenue-engine.js | Motor de receita Axenya | FONTE ÚNICA.
 *
 * Consumido por public/forecast.html e public/dashboard.html (Decisão 9 do
 * docs/coverage-pipeline-v1-spec.md). A lógica de `total` é idêntica à
 * calcReceita() histórica do Forecast (mesmos modelos, mesmas faixas);
 * acrescenta a decomposição recorrente × pontual (spec §3.1).
 *
 * Modelo (base = primeira_fatura `pf`; n = mês do contrato, 1 = início de receita):
 *  - Fee por vida ............... pf todo mês (mensalidade inteira recorre)
 *  - Corretagem +agenc, ≥200 .... mês 1 = pf×0,95 | mês 2+ = pf×0,05
 *  - Corretagem +agenc, <200 .... meses 1–3 = pf | mês 4+ = pf×0,02
 *  - Corretagem −agenc, ≥200 .... pf×0,05 todo mês
 *  - Corretagem −agenc, <200 .... pf×0,02 todo mês
 *
 * Recorrente = a cauda que se repete no ano seguinte (fee inteiro, ou agenciamento
 * 2%/5%); pontual = o pico de corretagem de entrada (total − recorrente).
 */
(function (root) {
  // Parte recorrente da receita (independe de possui_agenciamento: agenciamento
  // só adiciona o pico pontual de entrada, não muda a cauda recorrente).
  function taxaRecorrente(deal) {
    var pf = deal.primeira_fatura;
    var mod = deal.modelo_remuneracao;
    if (!pf || !mod) return 0;
    if (mod === 'Fee por vida') return pf;
    if (mod === 'Corretagem') {
      var vidas = deal.vidas || 0;
      return vidas < 200 ? pf * 0.02 : pf * 0.05;
    }
    return 0;
  }

  // Receita Axenya do mês `n` do contrato, decomposta. Retorna null se faltar
  // base (pf) ou modelo — o chamador trata como deal incompleto.
  function calcReceitaMes(n, deal) {
    var pf = deal.primeira_fatura;
    var vidas = deal.vidas || 0;
    var mod = deal.modelo_remuneracao;
    var agenc = deal.possui_agenciamento;
    if (!pf || !mod) return null;

    var total;
    if (mod === 'Fee por vida') {
      total = pf;
    } else if (mod === 'Corretagem') {
      if (agenc === true) {
        total = vidas < 200 ? (n <= 3 ? pf : pf * 0.02) : (n === 1 ? pf * 0.95 : pf * 0.05);
      } else {
        total = vidas < 200 ? pf * 0.02 : pf * 0.05;
      }
    } else {
      return null;
    }

    var recorrente = taxaRecorrente(deal);
    return { total: total, recorrente: recorrente, pontual: Math.max(0, total - recorrente) };
  }

  root.taxaRecorrente = taxaRecorrente;
  root.calcReceitaMes = calcReceitaMes;
})(typeof window !== 'undefined' ? window : this);
