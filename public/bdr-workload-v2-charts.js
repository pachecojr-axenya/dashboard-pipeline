'use strict';
window.BDR_WORKLOAD_V2_CHARTS_LOADED = true;
window.WorkloadBDRV2Charts = (function () {
  var C = window.WorkloadBDRV2Core;
  if (!C) throw new Error('WorkloadBDRV2Core ausente');
  var E = C.E, n = C.n;
  // Paleta do brandbook: turquesa/azul + variações; nunca cores complementares em web.
  var PALETTE = ['#3896B4', '#3AB8B7', 'rgba(56,150,180,.62)', 'rgba(58,184,183,.62)', 'rgba(255,255,255,.36)'];
  function fmt(v) { return n(v).toLocaleString('pt-BR'); }
  function metricTable(rows, cols, cls) { return '<table class="' + (cls || 'sr-table') + '"><thead><tr>' + cols.map(function (c) { return '<th>' + E(c[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' + (rows || []).map(function (r) { return '<tr>' + cols.map(function (c) { return '<td>' + E(r[c[0]]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>'; }
  function empty(title, msg) { return '<div class="state data-state empty"><strong>' + E(title) + '</strong>' + E(msg || '') + '</div>'; }
  function legend(items) { return '<div class="v2-legend">' + items.map(function (it) { return '<span><i style="background:' + it.c + '"></i>' + E(it.l) + '</span>'; }).join('') + '</div>'; }

  // Série temporal: linha + área, rótulo no maior e no último ponto, legenda e eixos.
  function lineArea(rows, metrics, title, kind) {
    rows = rows || [];
    var by = {}, dates = [];
    rows.forEach(function (r) { if (!by[r.date]) { by[r.date] = { date: r.date }; dates.push(r.date); } metrics.forEach(function (m) { by[r.date][m.key] = n(by[r.date][m.key]) + n(r[m.key]); }); });
    var data = dates.sort().map(function (d) { return by[d]; });
    if (!data.length) return empty('Sem dados no período', 'Nenhum registro para os filtros atuais.');
    var w = 760, h = 280, p = 46, max = 1, COLORS = ['#3AB8B7', '#3896B4'];
    data.forEach(function (r) { metrics.forEach(function (m) { max = Math.max(max, n(r[m.key])); }); });
    var y = function (v) { return h - p - (v / max) * (h - p * 2); }, x = function (i) { return p + (data.length === 1 ? (w - p * 2) / 2 : i * (w - p * 2) / (data.length - 1)); };
    var grid = '';
    for (var g = 0; g < 5; g += 1) { var gy = p + g * (h - p * 2) / 4; grid += '<line x1="' + p + '" y1="' + gy + '" x2="' + (w - p) + '" y2="' + gy + '"></line><text x="8" y="' + (gy + 4) + '">' + fmt(Math.round(max - g * max / 4)) + '</text>'; }
    var paths = metrics.map(function (m, mi) {
      var maxIdx = 0; data.forEach(function (r, i) { if (n(r[m.key]) > n(data[maxIdx][m.key])) maxIdx = i; });
      var d = data.map(function (r, i) { return (i ? 'L' : 'M') + x(i) + ' ' + y(r[m.key]); }).join(' ');
      var area = 'M' + x(0) + ' ' + (h - p) + ' ' + data.map(function (r, i) { return 'L' + x(i) + ' ' + y(r[m.key]); }).join(' ') + ' L' + x(data.length - 1) + ' ' + (h - p) + ' Z';
      var pts = data.map(function (r, i) {
        var lbl = (i === maxIdx || i === data.length - 1) ? '<text class="v2-pt-label" x="' + x(i) + '" y="' + (y(r[m.key]) - 9) + '" text-anchor="middle">' + fmt(r[m.key]) + '</text>' : '';
        return '<circle role="button" tabindex="0" aria-label="Abrir lista de ' + E(title) + ' em ' + E(r.date) + '" cx="' + x(i) + '" cy="' + y(r[m.key]) + '" r="4.5" onclick="WorkloadBDRV2.openDrill(\'' + kind + '\',\'\',\'' + r.date + '\')"></circle>' + lbl;
      }).join('');
      return '<path class="v2-area a' + mi + '" d="' + area + '"></path><path class="ln scheduled" style="stroke:' + COLORS[mi % 2] + '" d="' + d + '"></path>' + pts;
    }).join('');
    var step = Math.max(1, Math.ceil(data.length / 7));
    var xl = data.map(function (r, i) { return i % step === 0 ? '<text x="' + x(i) + '" y="' + (h - 12) + '" text-anchor="middle">' + E(r.date.slice(5)) + '</text>' : ''; }).join('');
    return '<svg class="line-svg v2-line-area" role="img" viewBox="0 0 ' + w + ' ' + h + '"><title>' + E(title) + '</title><desc>Série temporal clicável com eixos e rótulos.</desc>' + grid + '<line x1="' + p + '" y1="' + (h - p) + '" x2="' + (w - p) + '" y2="' + (h - p) + '"></line><line x1="' + p + '" y1="' + p + '" x2="' + p + '" y2="' + (h - p) + '"></line>' + paths + xl + '</svg>' + legend(metrics.map(function (m, i) { return { c: COLORS[i % 2], l: m.label }; })) + metricTable(data, [['date', 'Data']].concat(metrics.map(function (m) { return [m.key, m.label]; })));
  }

  // Barras agrupadas A×B com rótulo de valor em cada barra e legenda.
  function grouped(rows, a, b, labelKey, kind, opts) {
    rows = rows || []; opts = opts || {};
    if (!rows.length) return empty('Sem dados para comparar', '');
    var w = 760, h = 280, p = 46, max = 1;
    rows.forEach(function (r) { max = Math.max(max, n(r[a]), n(r[b])); });
    var bw = (w - p * 2) / Math.max(1, rows.length);
    var out = '<svg class="v2-grouped" role="img" viewBox="0 0 ' + w + ' ' + h + '"><title>Comparação A×B</title><desc>Barras agrupadas clicáveis com rótulos.</desc>';
    for (var i = 0; i < 5; i += 1) { var gy = p + i * (h - p * 2) / 4; out += '<line x1="' + p + '" y1="' + gy + '" x2="' + (w - p) + '" y2="' + gy + '"></line><text x="8" y="' + (gy + 4) + '">' + fmt(Math.round(max - i * max / 4)) + '</text>'; }
    rows.forEach(function (r, i) {
      var x0 = p + i * bw + bw * .16, ya = h - p - n(r[a]) / max * (h - p * 2), yb = h - p - n(r[b]) / max * (h - p * 2);
      out += '<rect tabindex="0" role="button" class="bar-a" x="' + x0 + '" y="' + ya + '" width="' + bw * .26 + '" height="' + (h - p - ya) + '" onclick="WorkloadBDRV2.openDrill(\'' + kind + '\',\'\')"></rect>'
        + '<text class="v2-bar-label" x="' + (x0 + bw * .13) + '" y="' + (ya - 4) + '" text-anchor="middle">' + fmt(r[a]) + '</text>'
        + '<rect tabindex="0" role="button" class="bar-b" x="' + (x0 + bw * .30) + '" y="' + yb + '" width="' + bw * .26 + '" height="' + (h - p - yb) + '" onclick="WorkloadBDRV2.openDrill(\'' + kind + '\',\'\')"></rect>'
        + '<text class="v2-bar-label" x="' + (x0 + bw * .43) + '" y="' + (yb - 4) + '" text-anchor="middle">' + fmt(r[b]) + '</text>'
        + '<text x="' + (x0 + bw * .28) + '" y="' + (h - 12) + '" text-anchor="middle">' + E(String(r[labelKey] || i + 1).slice(0, 10)) + '</text>';
    });
    out += '</svg>';
    return out + legend([{ c: '#3896B4', l: opts.aLabel || 'A (antes)' }, { c: '#3AB8B7', l: opts.bLabel || 'B (atual)' }]) + metricTable(rows, [[labelKey, 'Índice'], [a, opts.aLabel || 'A'], [b, opts.bLabel || 'B']]);
  }

  // Waterfall assinado: quanto cada componente somou/subtraiu da variação, com rótulo.
  function waterfall(rows, kind, contextFn, opts) {
    rows = rows || []; opts = opts || {};
    if (!rows.length) return empty('Sem componentes', '');
    var w = 760, h = 290, p = 48, total = rows.reduce(function (m, r) { return m + Math.abs(n(r.delta)); }, 0) || 1, base = h / 2, x = p, bw = (w - p * 2) / Math.max(1, rows.length);
    var out = '<svg class="v2-waterfall" role="img" viewBox="0 0 ' + w + ' ' + h + '"><title>Variação por componente</title><desc>Contribuição assinada de cada componente clicável.</desc><line class="baseline" x1="' + p + '" y1="' + base + '" x2="' + (w - p) + '" y2="' + base + '"></line>';
    rows.forEach(function (r) {
      var val = n(r.delta), hh = Math.max(3, Math.abs(val) / total * (h - p * 2)), y = val >= 0 ? base - hh : base, cls = val >= 0 ? 'pos' : 'neg', ly = val >= 0 ? y - 5 : y + hh + 13;
      out += '<rect tabindex="0" role="button" class="' + cls + '" x="' + (x + 6) + '" y="' + y + '" width="' + (bw - 12) + '" height="' + hh + '" onclick="WorkloadBDRV2.openDrill(\'' + (kind || 'activity') + '\',\'' + (contextFn ? contextFn(r) : '') + '\')"></rect>'
        + '<text class="v2-bar-label" x="' + (x + bw / 2) + '" y="' + ly + '" text-anchor="middle">' + (val > 0 ? '+' : '') + fmt(val) + '</text>'
        + '<text x="' + (x + bw / 2) + '" y="' + (h - 8) + '" text-anchor="middle">' + E(String(r.label || r.key).slice(0, 10)) + '</text>';
      x += bw;
    });
    out += '</svg>';
    return out + legend([{ c: '#3AB8B7', l: 'Subiu (+)' }, { c: '#3896B4', l: 'Caiu (−)' }]) + metricTable(rows, [['label', 'Componente'], ['a', 'A'], ['b', 'B'], ['delta', 'Δ']]);
  }

  // Ranking horizontal: barra preenchida + rótulo de valor. Layout próprio (não reusa break-row).
  function ranking(rows, key, kind, opts) {
    opts = opts || {};
    rows = (rows || []).slice().sort(function (a, b) { return n(b[key]) - n(a[key]); }).slice(0, 12);
    if (!rows.length) return empty('Sem dados', opts.emptyMsg || 'Nenhum registro para os filtros atuais.');
    var max = Math.max(1, rows.reduce(function (m, r) { return Math.max(m, n(r[key])); }, 0));
    var body = rows.map(function (r) {
      var label = r.bdr || r.label || r.bucket, click;
      if (r.bdr) click = "WorkloadBDRV2.freeze(decodeURIComponent('" + encodeURIComponent(r.bdr) + "'))";
      else click = "WorkloadBDRV2.openDrill('" + kind + "','" + (((kind === 'reactivity' || kind === 'penetration') && C.isBucketLabel(label)) ? 'bucket:' + label : '') + "')";
      var pctw = Math.round(n(r[key]) / max * 100);
      return '<button class="v2-rank" onclick="' + click + '" aria-label="' + E(label) + ': ' + fmt(r[key]) + (opts.unit || '') + '"><span class="v2-rank-name" title="' + E(label) + '">' + E(label) + '</span><span class="v2-rank-bar"><span class="v2-rank-fill" style="width:' + pctw + '%"></span></span><span class="v2-rank-val">' + fmt(r[key]) + (opts.unit || '') + '</span></button>';
    }).join('');
    return '<div class="v2-ranking">' + body + '</div>' + metricTable(rows, [[rows[0] && rows[0].bdr != null ? 'bdr' : 'label', 'Nome'], [key, opts.valLabel || 'Valor']]);
  }

  // Barras empilhadas por dia: comprimento = volume do dia; segmentos = mix de canais. Com legenda.
  function stacked(rows, keys, kind) {
    rows = rows || [];
    var dates = {};
    rows.forEach(function (r) { if (!dates[r.date]) dates[r.date] = { date: r.date }; keys.forEach(function (k) { dates[r.date][k] = n(dates[r.date][k]) + n(r[k]); }); });
    var data = Object.keys(dates).sort().map(function (d) { return dates[d]; });
    if (!data.length) return empty('Sem dados no período', '');
    var max = Math.max(1, data.reduce(function (m, r) { return Math.max(m, keys.reduce(function (s, k) { return s + n(r[k]); }, 0)); }, 0));
    var body = data.map(function (r) {
      var tot = keys.reduce(function (s, k) { return s + n(r[k]); }, 0);
      return '<button class="v2-stack-row" onclick="WorkloadBDRV2.openDrill(\'' + kind + '\',\'\',\'' + r.date + '\')" aria-label="' + E(r.date) + ': ' + fmt(tot) + '"><span>' + E(r.date.slice(5)) + '</span><span class="v2-stackbar" style="width:' + Math.max(4, Math.round(tot / max * 100)) + '%">' + keys.map(function (k, i) { return n(r[k]) ? '<i class="s' + i + '" style="width:' + Math.round(n(r[k]) / tot * 100) + '%" title="' + E(C.CHANNEL_LABELS[k] || k) + ': ' + fmt(r[k]) + '"></i>' : ''; }).join('') + '</span><b>' + fmt(tot) + '</b></button>';
    }).join('');
    return '<div class="v2-stacked">' + body + '</div>' + legend(keys.map(function (k, i) { return { c: PALETTE[i % PALETTE.length], l: C.CHANNEL_LABELS[k] || k }; })) + metricTable(data, [['date', 'Data']].concat(keys.map(function (k) { return [k, C.CHANNEL_LABELS[k] || k]; })));
  }

  // Série temporal multi-BDR: uma linha por BDR (cor/legenda própria), rótulo no último ponto,
  // opção de média móvel (linha tracejada) e linhas de referência mediana/média do conjunto.
  // series = [{bdr, values:[...]}], dates = [ISO...]. opts: {title, unit, movingAvg (0=off), refs:['median'|'mean'], kind, pct}
  function multiLine(series, dates, opts) {
    opts = opts || {};
    series = (series || []).filter(function (s) { return s && s.values && s.values.length; });
    if (!series.length || !dates.length) return empty('Sem dados no período', 'Selecione ao menos um BDR com atividade na janela.');
    var w = 820, h = 300, p = 52, max = 1, unit = opts.unit || '', kind = opts.kind || 'activity';
    var mavg = Number(opts.movingAvg || 0);
    var lines = series.map(function (s, i) {
      var raw = s.values.map(n);
      var plotted = mavg > 1 ? C.movingAverage(raw, mavg) : raw;
      return { bdr: s.bdr, color: C.seriesColor(i), raw: raw, plotted: plotted };
    });
    lines.forEach(function (ln) { ln.plotted.forEach(function (v) { if (v != null) max = Math.max(max, v); }); });
    // Referências (mediana/média) calculadas sobre o pool de todos os pontos plotados.
    var pool = []; lines.forEach(function (ln) { ln.plotted.forEach(function (v) { if (v != null) pool.push(v); }); });
    var refs = (opts.refs || []).map(function (kindRef) {
      var val = kindRef === 'mean' ? C.mean(pool) : C.median(pool);
      return { label: kindRef === 'mean' ? 'Média' : 'Mediana', val: val };
    }).filter(function (r) { return r.val != null; });
    refs.forEach(function (r) { max = Math.max(max, r.val); });
    var y = function (v) { return h - p - (v / max) * (h - p * 2); };
    var x = function (i) { return p + (dates.length === 1 ? (w - p * 2) / 2 : i * (w - p * 2) / (dates.length - 1)); };
    var grid = '';
    for (var g = 0; g < 5; g += 1) { var gy = p + g * (h - p * 2) / 4; var gv = max - g * max / 4; grid += '<line x1="' + p + '" y1="' + gy + '" x2="' + (w - p) + '" y2="' + gy + '"></line><text x="8" y="' + (gy + 4) + '">' + fmt(Math.round(gv)) + (opts.pct ? '%' : '') + '</text>'; }
    var refSvg = refs.map(function (r) { var ry = y(r.val); return '<line class="v2-ref-line" x1="' + p + '" y1="' + ry + '" x2="' + (w - p) + '" y2="' + ry + '"></line><text class="v2-ref-label" x="' + (w - p) + '" y="' + (ry - 4) + '" text-anchor="end">' + E(r.label) + ' ' + fmt(Math.round(r.val)) + (opts.pct ? '%' : unit) + '</text>'; }).join('');
    var paths = lines.map(function (ln) {
      var pts = [], lastIdx = -1;
      ln.plotted.forEach(function (v, i) { if (v != null) { pts.push((lastIdx < 0 ? 'M' : 'L') + x(i) + ' ' + y(v)); lastIdx = i; } });
      var dots = ln.plotted.map(function (v, i) {
        if (v == null) return '';
        var last = i === lastIdx;
        var lbl = last ? '<text class="v2-pt-label" x="' + (x(i) + 6) + '" y="' + (y(v) - 6) + '" text-anchor="start" style="fill:' + ln.color + '">' + fmt(Math.round(v)) + (opts.pct ? '%' : unit) + '</text>' : '';
        return '<circle role="button" tabindex="0" aria-label="' + E(ln.bdr) + ' em ' + E(dates[i]) + ': ' + fmt(ln.raw[i]) + '" cx="' + x(i) + '" cy="' + y(v) + '" r="' + (last ? 4.5 : 3) + '" style="fill:' + ln.color + '" onclick="WorkloadBDRV2.openDrill(\'' + kind + '\',\'\',\'' + dates[i] + '\',1,decodeURIComponent(\'' + encodeURIComponent(ln.bdr) + '\'))"></circle>' + lbl;
      }).join('');
      return '<path class="v2-mline" style="stroke:' + ln.color + '" d="' + pts.join(' ') + '"></path>' + dots;
    }).join('');
    var step = Math.max(1, Math.ceil(dates.length / 8));
    var xl = dates.map(function (d, i) { return i % step === 0 || i === dates.length - 1 ? '<text x="' + x(i) + '" y="' + (h - 14) + '" text-anchor="middle">' + E(d.slice(5)) + '</text>' : ''; }).join('');
    var svg = '<svg class="line-svg v2-multiline" role="img" viewBox="0 0 ' + w + ' ' + h + '"><title>' + E(opts.title || 'Comparação por BDR') + '</title><desc>Série temporal por BDR com eixos, legenda e rótulos.</desc>' + grid + refSvg + '<line x1="' + p + '" y1="' + (h - p) + '" x2="' + (w - p) + '" y2="' + (h - p) + '"></line><line x1="' + p + '" y1="' + p + '" x2="' + p + '" y2="' + (h - p) + '"></line>' + paths + xl + '</svg>';
    var leg = legend(lines.map(function (ln) { return { c: ln.color, l: ln.bdr }; }));
    // tabela a11y: data + coluna por BDR (valores brutos)
    var tblRows = dates.map(function (d, i) { var row = { date: d }; lines.forEach(function (ln) { row[ln.bdr] = ln.raw[i]; }); return row; });
    var tbl = metricTable(tblRows, [['date', 'Data']].concat(lines.map(function (ln) { return [ln.bdr, ln.bdr]; })));
    return svg + leg + tbl;
  }

  return { metricTable: metricTable, lineArea: lineArea, grouped: grouped, waterfall: waterfall, ranking: ranking, stacked: stacked, multiLine: multiLine };
})();
