// shared-charts.js v1
// Builders compartilhados entre dashboard.html (C03, C04) e board.html (C03/B09, C04/B07).
// Alterar aqui propaga automaticamente para os dois painéis.
//
// Requer no momento da chamada (globais de cada painel):
//   _novoTheme, _novoMkChart, _annualRev, _revShort, _stageNorm, _fmtBig
//   ChartDataLabels, NOVO_FONT, _novoSizeDistMode, _novoValMode
//   NOVO_STAGE_ORDER, NOVO_STAGE_PROB
//   novoOpenDealsFilterModal, novoOpenDealsStageFilterModal

// ── C03 | Distribuição por Tamanho (donut Receita | Vidas) ──────────────────────
// canvasId   : id do <canvas> destino
// dataFn     : function() → array de deals do pipeline ativo
// opts.modalTitle : título do modal de detalhes
// opts.noRevenue  : label da fatia "sem receita" (default 'Sem receita')
// opts.noLives    : label da fatia "sem vidas"   (default 'Sem vidas')
// opts.openDeals  : texto central do donut       (default 'deals ativos')
// opts.extTip     : função de tooltip externo (opcional; dashboard usa _novoChartExtTip)
function buildSharedSizeDonut(canvasId, dataFn, opts) {
  var o = opts || {};
  var modalTitle  = o.modalTitle || 'Distribuição por Tamanho';
  var noRevLabel  = o.noRevenue  || 'Sem receita';
  var noLifeLabel = o.noLives    || 'Sem vidas';
  var openDealLbl = o.openDeals  || 'deals ativos';
  var extTip      = o.extTip     || null;

  var th = _novoTheme(), open = dataFn();
  var isRev = _novoSizeDistMode === 'revenue';
  var labels, by;
  if (isRev) {
    var rdefs = [['< 50k',0,50000],['50–100k',50000,100000],['100–250k',100000,250000],
                 ['250–500k',250000,500000],['500k–1M',500000,1000000],['1M+',1000000,Infinity]];
    var semInfo = [], rby = rdefs.map(function(){return [];});
    open.forEach(function(d){ var v=_annualRev(d); if(v<=0){semInfo.push(d);return;} for(var i=0;i<rdefs.length;i++){ if(v>=rdefs[i][1]&&v<rdefs[i][2]){rby[i].push(d);break;} } });
    labels = [noRevLabel].concat(rdefs.map(function(x){return x[0];}));
    by = [semInfo].concat(rby);
  } else {
    var vdefs = [['1–50',function(v){return v>=1&&v<=50;}],['51–200',function(v){return v>50&&v<=200;}],
                 ['201–500',function(v){return v>200&&v<=500;}],['501–1K',function(v){return v>500&&v<=1000;}],
                 ['1K–5K',function(v){return v>1000&&v<=5000;}],['5K+',function(v){return v>5000;}]];
    var semVidas = [], vby = vdefs.map(function(){return [];});
    open.forEach(function(d){ var v=d.vidas||0; if(v<=0){semVidas.push(d);return;} for(var i=0;i<vdefs.length;i++){ if(vdefs[i][1](v)){vby[i].push(d);break;} } });
    labels = [noLifeLabel].concat(vdefs.map(function(x){return x[0];}));
    by = [semVidas].concat(vby);
  }
  var counts = by.map(function(a){ return a.length; });
  var DONUT_PALETTE = [[96,165,250],[45,212,191],[52,211,153],[251,191,36],[167,139,250],[251,113,133]];
  var bgBase = counts.map(function(_,i){ return i===0 ? [140,150,168] : DONUT_PALETTE[(i-1) % DONUT_PALETTE.length]; });
  function _donutBg(ctx){
    var rgb = bgBase[ctx.dataIndex] || [136,136,136];
    var solid = 'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',.92)';
    var area = ctx.chart.chartArea; if(!area) return solid;
    var cx=(area.left+area.right)/2, cy=(area.top+area.bottom)/2;
    var r=Math.min(area.right-area.left, area.bottom-area.top)/2; if(!(r>0)) return solid;
    var g=ctx.chart.ctx.createRadialGradient(cx,cy,r*0.6,cx,cy,r);
    function tint(f){ return 'rgba('+Math.round(rgb[0]+(255-rgb[0])*f)+','+Math.round(rgb[1]+(255-rgb[1])*f)+','+Math.round(rgb[2]+(255-rgb[2])*f)+',.96)'; }
    g.addColorStop(0, tint(0.22)); g.addColorStop(1, solid); return g;
  }
  var allDeals = by.reduce(function(acc, arr){ return acc.concat(arr); }, []);
  function _visTotal(chart){ var d=chart.data.datasets[0].data, s=0; for(var i=0;i<d.length;i++){ if(chart.getDataVisibility(i)) s+=(d[i]||0); } return s; }
  var centerPlugin = { id:'sharedDonutCenter_'+canvasId, afterDraw:function(chart){
    var area = chart.chartArea; if(!area) return;
    var ctx = chart.ctx, cx=(area.left+area.right)/2, cy=(area.top+area.bottom)/2;
    ctx.save(); ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle=th.cText;  ctx.font='700 27px '+NOVO_FONT; ctx.fillText(_visTotal(chart).toLocaleString('pt-BR'), cx, cy-7);
    ctx.fillStyle=th.cText2; ctx.font='600 10px '+NOVO_FONT; ctx.fillText(openDealLbl, cx, cy+15);
    ctx.restore();
  } };
  var tooltipCfg = extTip
    ? { enabled:false, external:extTip, callbacks:{ title:function(it){return it.length?it[0].label:'';}, label:function(c){return c.parsed+' deals';}, footer:function(){return 'Clique para ver os deals';} } }
    : { callbacks:{ title:function(it){return it.length?it[0].label:'';}, label:function(c){return c.parsed+' deals';}, footer:function(){return 'Clique para ver os deals';} } };
  _novoMkChart(canvasId, { type:'doughnut', plugins:[ChartDataLabels, centerPlugin],
    data:{ labels:labels, datasets:[{ data:counts, backgroundColor:_donutBg, borderColor:'var(--card)', borderWidth:3, borderRadius:6, spacing:2, hoverOffset:10 }] },
    options:{ responsive:true, cutout:'68%', layout:{padding:6}, plugins:{
      legend:{display:true, position:'right', labels:{color:th.cText2, font:{family:NOVO_FONT,size:11}, padding:10, usePointStyle:true, boxWidth:8, boxHeight:8}},
      datalabels:{ color:'#fff', font:{family:NOVO_FONT,size:10,weight:'bold'}, formatter:function(v,ctx){ var tot=_visTotal(ctx.chart); return v>0&&tot>0 ? Math.round(v/tot*100)+'%' : ''; } },
      tooltip: tooltipCfg },
      onClick:function(e,el){ if(!el.length)return; var kind=isRev?'rev':'vidas'; novoOpenDealsFilterModal(modalTitle, allDeals, kind, el[0].index); } } });
}

// ── C04 | Valor do Pipeline por Etapa (barras horizontais, Receita | Ponderado) ──
// canvasId   : id do <canvas> destino
// dataFn     : function() → array de deals do pipeline ativo
// modalTitle : título do modal de filtro por etapa
function buildSharedStageVal(canvasId, dataFn, modalTitle) {
  var th = _novoTheme(), open = dataFn();
  var agg = {}, by = {};
  NOVO_STAGE_ORDER.forEach(function(s){ agg[s]=0; by[s]=[]; });
  open.forEach(function(d){ var s=_stageNorm(d.stage); if(!(s in agg)){agg[s]=0;by[s]=[];} var v=_annualRev(d);
    if(_novoValMode==='weighted'){ var p=NOVO_STAGE_PROB[d.stage]; if(p==null)p=NOVO_STAGE_PROB[s]; v=v*(p||0); }
    agg[s]+=v; by[s].push(d); });
  var labels = NOVO_STAGE_ORDER.filter(function(s){ return agg[s] > 0; });
  var data = labels.map(function(s){ return Math.round(agg[s]); });
  _novoMkChart(canvasId, { type:'bar', plugins:[ChartDataLabels],
    data:{ labels:labels, datasets:[{ data:data, backgroundColor:'rgba(58,184,183,.75)', borderRadius:4 }] },
    options:{ indexAxis:'y', responsive:true, layout:{padding:{right:62}}, plugins:{ legend:{display:false},
      datalabels:{ anchor:'end', align:'right', color:th.cText, font:{family:NOVO_FONT,size:10,weight:'bold'}, formatter:_revShort },
      tooltip:{ callbacks:{ label:function(c){return 'R$ '+Math.round(c.parsed.x).toLocaleString('pt-BR')+' /ano';}, footer:function(){return 'Clique para ver os deals';} } } },
      scales:{ x:{grid:{color:th.cGrid}, ticks:{color:th.cText2, font:{family:NOVO_FONT}, callback:function(v){return _revShort(v);}}}, y:{grid:{display:false}, ticks:{color:th.cText, font:{family:NOVO_FONT}}} },
      onClick:function(e,el){ if(!el.length)return; novoOpenDealsStageFilterModal(modalTitle, open, labels[el[0].index]); } } });
}

// ── P03 | Receita Ponderada do pipeline ativo ───────────────────────────────────
// Mesma fórmula do CRO Dashboard: Σ ARR × probabilidade (custom do deal, ou prob.
// padrão da etapa). Usado pelo card P03 nos dois painéis para garantir paridade.
function sharedWeightedPipelineARR(deals){
  return (deals||[]).reduce(function(s,d){
    var p = d.probabilidade!=null ? d.probabilidade : (NOVO_STAGE_PROB[d.stage]||0);
    return s + _annualRev(d)*p;
  }, 0);
}

// ── C01 | Vidas e Deals por AE (pipeline ativo) ─────────────────────────────────
// Barras horizontais por AE. mode='lives' soma vidas | mode='deals' conta deals.
// opts.unitLives / opts.unitDeals: rótulo da unidade. opts.onClick(ae, dealsDoAe).
function buildSharedVidasDealsAE(canvasId, dataFn, mode, opts){
  var o = opts||{};
  var th = _novoTheme(), deals = dataFn();
  var lang = (typeof NOVO_LANG!=='undefined') ? NOVO_LANG : 'pt';
  var noAe = o.noAeLabel || (lang==='en'?'(no AE)':'(sem AE)');
  var agg = {}, byAe = {};
  deals.forEach(function(d){
    var ae = (!d.ae||d.ae==='-') ? noAe : d.ae;
    var inc = mode==='deals' ? 1 : (d.vidas||0);
    agg[ae] = (agg[ae]||0)+inc;
    if(!byAe[ae]) byAe[ae]=[];
    byAe[ae].push(d);
  });
  var ranked = Object.keys(agg).map(function(ae){ return {ae:ae,value:agg[ae]}; })
    .filter(function(r){ return r.value>0; }).sort(function(a,b){ return b.value-a.value; });
  var total = ranked.reduce(function(s,r){ return s+r.value; }, 0);
  var unit = mode==='deals' ? (o.unitDeals||'deals') : (o.unitLives||'vidas');
  _novoMkChart(canvasId, { type:'bar', plugins:[ChartDataLabels],
    data:{ labels:ranked.map(function(r){return r.ae;}), datasets:[{ data:ranked.map(function(r){return r.value;}), backgroundColor:'rgba(58,184,183,.75)', hoverBackgroundColor:'rgba(58,184,183,1)', borderRadius:4 }] },
    options:{ indexAxis:'y', responsive:true, layout:{padding:{right:120}}, plugins:{ legend:{display:false},
      datalabels:{ display:true, anchor:'end', align:'right', color:th.cText, font:{family:NOVO_FONT,size:11,weight:'bold'}, formatter:function(v){ var pct=total>0?' ('+(v/total*100).toFixed(1)+'%)':''; return v.toLocaleString('pt-BR')+pct; } },
      tooltip:{ displayColors:false, padding:12, callbacks:{ label:function(c){ return c.parsed.x.toLocaleString('pt-BR')+' '+unit; }, afterLabel:function(c){ var pct=total>0?(ranked[c.dataIndex].value/total*100).toFixed(1):'0'; return pct+'% do total ('+total.toLocaleString('pt-BR')+' '+unit+')'; }, footer:function(){ return 'Clique para ver os deals'; } } } },
      scales:{ x:{grid:{color:th.cGrid},ticks:{color:th.cText2,font:{family:NOVO_FONT}}}, y:{grid:{display:false},ticks:{color:th.cText,font:{family:NOVO_FONT}}} },
      onClick:function(e,el){ if(!el.length)return; var item=ranked[el[0].index]; if(o.onClick) o.onClick(item.ae, byAe[item.ae]); } } });
}

// ── N06 | Projeção de receita do pipeline (helpers compartilhados) ───────────────
// Cópia fiel da lógica do CRO Dashboard para que A07 (painel AE) bata exatamente
// com o total do N06. Requer NOVO_STAGE_PROB. São funções puras de campos do deal.
function sharedForecastCalcReceita(n, deal){
  var pf = deal.primeira_fatura;
  var vidas = deal.vidas || 0;
  var mod = deal.modelo_remuneracao;
  var agenc = deal.possui_agenciamento;
  if (!pf || !mod) return null;
  if (mod === 'Fee por vida') return pf;
  if (mod === 'Corretagem') {
    if (agenc === true) {
      return vidas < 200 ? (n <= 3 ? pf : pf * 0.02) : (n === 1 ? pf * 0.95 : pf * 0.05);
    }
    return vidas < 200 ? pf * 0.02 : pf * 0.05;
  }
  return null;
}
function sharedProbFinal(d){
  var sp = NOVO_STAGE_PROB[d.stage];
  if (sp == null) return null;
  var cp = d.probabilidade;
  if (cp == null) return sp;
  if (cp <= sp - 0.3) return sp * 0.9;
  if (cp >= sp + 0.3) return sp * 1.1;
  return sp;
}
function sharedPipeRevMonthValue(d, month, weighted){
  if (!d.data_prevista_para_receita) return 0;
  var sp = d.data_prevista_para_receita.substring(0,7).split('-');
  var mp = String(month).split('-');
  if (sp.length < 2 || mp.length < 2) return 0;
  var diff = (parseInt(mp[0],10) - parseInt(sp[0],10)) * 12 + (parseInt(mp[1],10) - parseInt(sp[1],10));
  if (diff < 0 || diff > 23) return 0;
  var real = sharedForecastCalcReceita(diff + 1, d);
  if (real == null) return 0;
  if (!weighted) return real;
  var p = sharedProbFinal(d);
  if (p == null) p = 0;
  return real * p;
}
function sharedProjectionMonths(refYear, refMonth){
  // refYear/refMonth: ano/mês (1-12) do "agora". Date.now() não é permitido em alguns
  // contextos, então o caller passa a referência; default usa new Date().
  var y, m;
  if (refYear != null && refMonth != null) { y = refYear; m = refMonth - 1; }
  else { var now = new Date(); y = now.getFullYear(); m = now.getMonth(); }
  var out = [], endY = 2027, endM = 11;
  while (y < endY || (y === endY && m <= endM)) {
    out.push(y + '-' + String(m + 1).padStart(2,'0'));
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}
function sharedDealProjectedRevenue(d, weighted, months){
  var ms = months || sharedProjectionMonths();
  var s = 0;
  for (var i=0;i<ms.length;i++) s += sharedPipeRevMonthValue(d, ms[i], weighted);
  return s;
}
