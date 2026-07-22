'use strict';
window.BDR_WORKLOAD_V2_CORE_LOADED = true;
window.WorkloadBDRV2Core = (function () {
  var ALL_CHANNELS = ['calls', 'emails', 'whatsapp', 'linkedin', 'meetings'];
  var CHANNEL_LABELS = { calls: 'Ligações', emails: 'E-mails', whatsapp: 'WhatsApp', linkedin: 'LinkedIn', meetings: 'Reuniões' };
  var PORTE = [['', 'Todos'], ['enterprise', 'Enterprise'], ['grande', 'Grande'], ['media', 'Média'], ['pme', 'PME'], ['desconhecido', 'Desconhecido']];
  var TABS = [['pulse', 'Pulso'], ['channels', 'Canais'], ['management', 'Gestão'], ['penetration', 'Penetração'], ['evolution', 'Evolução']];
  function E(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function id(x) { return document.getElementById(x); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function add(x, n) { var d = new Date(x + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function rangeDays(since, until) { return Math.floor((new Date(until + 'T00:00:00') - new Date(since + 'T00:00:00')) / 86400000) + 1; }
  function previousEquivalent(since, until) { var days = Math.max(1, rangeDays(since, until)); return { aSince: add(since, -days), aUntil: add(since, -1), bSince: since, bUntil: until }; }
  function rng(p) { var n = new Date(), s = new Date(n), u = new Date(n); if (p === 'ontem') { s.setDate(s.getDate() - 1); u = new Date(s); } else if (p === '7d') s.setDate(s.getDate() - 6); else if (p === '30d') s.setDate(s.getDate() - 29); else if (p === '90d') s.setDate(s.getDate() - 89); return { since: iso(s), until: iso(u) }; }
  function n(v) { return Number(v || 0); }
  function pct(a, b) { return b ? Math.round(a / b * 100) + '%' : '—'; }
  function sum(rows, k) { return (rows || []).reduce(function (m, r) { return m + n(r[k]); }, 0); }
  function validContext(c) { return /^(channel:(calls|emails|whatsapp|linkedin|meetings)|bucket:(0|1|2|3|4|5|6\+|lt_1h|1_4h|4_24h|24_72h|72h_plus|sem_toque|2–3|4–5)|event:(attempted|connected|qualified|disqualified)|domain:(ritmo|insercao|crm|contato_efetivo|sql))$/.test(String(c || '')); }
  function isBucketLabel(v) { return /^(0|1|2|3|4|5|6\+|2–3|4–5)$/.test(String(v || '')); }
  function api(path, p) { return fetch(path + '?' + new URLSearchParams(p).toString(), { credentials: 'same-origin' }).then(function (r) { if (r.status === 401) { location.href = '/'; throw Error('login'); } return r.json().then(function (d) { if (!r.ok || d.success === false) throw Error(d.error || 'Falha ao carregar'); return d; }); }); }
  // Paleta por série (BDR): tons de marca (turquesa/azul) + neutros derivados; 12 séries distinguíveis.
  var SERIES_PALETTE = ['#3AB8B7', '#3896B4', '#7FD1CE', '#5C6FA8', '#C9A227', '#B45C8E', '#6FB06B', '#D08A54', '#8E7CC3', '#4FA3C7', '#C77D7D', '#9AA0A6'];
  function seriesColor(i) { return SERIES_PALETTE[i % SERIES_PALETTE.length]; }
  // Média móvel simples de janela w sobre um array numérico (null onde não há janela completa).
  function movingAverage(values, w) { var out = []; for (var i = 0; i < values.length; i += 1) { if (i + 1 < w) { out.push(null); continue; } var s = 0; for (var j = i - w + 1; j <= i; j += 1) s += n(values[j]); out.push(s / w); } return out; }
  function mean(values) { var xs = values.map(Number).filter(function (x) { return Number.isFinite(x); }); if (!xs.length) return null; return xs.reduce(function (a, b) { return a + b; }, 0) / xs.length; }
  function median(values) { var xs = values.map(Number).filter(function (x) { return Number.isFinite(x); }).sort(function (a, b) { return a - b; }); if (!xs.length) return null; var m = Math.floor(xs.length / 2); return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2; }
  // Une lista de BDRs do estado (array ou legado string) em array canônico único e ordenado.
  function bdrList(v) { var arr = Array.isArray(v) ? v : String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); return arr.filter(function (x, i) { return arr.indexOf(x) === i; }); }
  // Ordena datas ISO ascendente e devolve array único.
  function uniqueDates(rows) { var set = {}; (rows || []).forEach(function (r) { if (r && r.date) set[r.date] = 1; }); return Object.keys(set).sort(); }
  // Reorganiza series [{date,bdr,...}] em séries por BDR: { bdr -> { date -> row } } + eixo de datas.
  function seriesByBdr(rows, metricKey, dates) {
    var by = {};
    (rows || []).forEach(function (r) { if (!r || !r.bdr) return; if (!by[r.bdr]) by[r.bdr] = {}; by[r.bdr][r.date] = n(by[r.bdr][r.date]) + n(r[metricKey]); });
    var out = Object.keys(by).sort().map(function (bdr) { return { bdr: bdr, values: dates.map(function (d) { return n(by[bdr][d]); }) }; });
    return out;
  }
  return { ALL_CHANNELS: ALL_CHANNELS, CHANNEL_LABELS: CHANNEL_LABELS, PORTE: PORTE, TABS: TABS, E: E, id: id, iso: iso, add: add, rangeDays: rangeDays, previousEquivalent: previousEquivalent, rng: rng, n: n, pct: pct, sum: sum, validContext: validContext, isBucketLabel: isBucketLabel, api: api, SERIES_PALETTE: SERIES_PALETTE, seriesColor: seriesColor, movingAverage: movingAverage, mean: mean, median: median, bdrList: bdrList, uniqueDates: uniqueDates, seriesByBdr: seriesByBdr };
})();
