// ── Modal de Configurações globais (compartilhado) ──────────────────────────────
// Fonte única do modal de Configurações para os painéis secundários (Board, AE, BDR,
// Last 48h). Reproduz o modal do CRO Dashboard (novo-prob-drawer): toggles globais
// (Implantação = Ganho, Ativos incluem Reunião Agendada, Ativos incluem Standby),
// Meta de Receita Ganha (MTD) e probabilidades por etapa. Persiste tudo no mesmo
// localStorage do CRO (novo_stage_prob / novo_meta_mtd / novo_impl_won / ...), então
// a configuração é realmente global entre todas as páginas.
//
// O CRO Dashboard NÃO inclui este arquivo: ele mantém o modal inline (a referência).
// Os painéis que incluem este módulo devem ter: _novoImplWon, _novoActiveMeetings,
// _novoActiveStandby, novoToggleImplWon/ActiveMeetings/ActiveStandby, novoRender e
// setContentBlur. NOVO_STAGE_PROB / NOVO_META_MTD têm fallback aqui se ausentes.
(function(){
  var SP_DEFAULT = {
    'Cotação':0.33,'Proposta Enviada':0.285,'Consultoria':0.611,'Negociação':0.42,
    'Implantação':0.581,'Ganho':1.0,'Standby':0.12,'Stand by':0.12,'Diagnóstico':0.06
  };
  function loadProb(){
    try { var raw=localStorage.getItem('novo_stage_prob'); if(raw){ var p=JSON.parse(raw), m={};
      Object.keys(SP_DEFAULT).forEach(function(k){m[k]=SP_DEFAULT[k];});
      Object.keys(p).forEach(function(k){m[k]=p[k];}); return m; } } catch(e){}
    var c={}; Object.keys(SP_DEFAULT).forEach(function(k){c[k]=SP_DEFAULT[k];}); return c;
  }
  function loadMeta(){ try { var v=parseFloat(localStorage.getItem('novo_meta_mtd')); return isNaN(v)?0:v; } catch(e){ return 0; } }
  // Garante os globais (preserva os do painel se já existirem para manter a mesma referência).
  if (typeof window.NOVO_STAGE_PROB === 'undefined' || !window.NOVO_STAGE_PROB) window.NOVO_STAGE_PROB = loadProb();
  if (typeof window.NOVO_META_MTD === 'undefined') window.NOVO_META_MTD = loadMeta();

  var CSS = ''
    + '.impl-toggle{display:inline-flex;align-items:center;gap:.55rem;cursor:pointer;user-select:none;background:var(--card2);border:1px solid var(--border);border-radius:99px;padding:.4rem .8rem;font-size:.76rem;font-weight:600;color:var(--text2);font-family:inherit;transition:border-color .15s,color .15s}'
    + '.impl-toggle:hover{border-color:var(--teal);color:var(--text)}'
    + '.impl-toggle.on{color:var(--text)}'
    + '.impl-toggle .sw{width:34px;height:19px;border-radius:99px;background:var(--border);position:relative;transition:background .18s;flex:none}'
    + '.impl-toggle.on .sw{background:var(--teal)}'
    + '.impl-toggle .sw::after{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#fff;transition:transform .18s}'
    + '.impl-toggle.on .sw::after{transform:translateX(15px)}'
    + '.novo-prob-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;opacity:0;pointer-events:none;transition:opacity .25s ease}'
    + '.novo-prob-backdrop.open{opacity:1;pointer-events:auto}'
    + '.novo-prob-drawer{position:fixed;top:0;right:-380px;width:360px;max-width:100vw;height:100vh;background:var(--card);border-left:1px solid var(--border);z-index:3001;display:flex;flex-direction:column;transition:right .28s cubic-bezier(0.4,0,0.2,1);box-shadow:-8px 0 32px rgba(0,0,0,.25)}'
    + '.novo-prob-drawer.open{right:0}'
    + '.novo-prob-drawer-hdr{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid var(--border);flex-shrink:0}'
    + '.novo-prob-drawer-hdr h3{margin:0;font-size:1.35rem;font-weight:600;color:var(--text)}'
    + '.novo-prob-body{flex:1;overflow-y:auto;padding:0 1.5rem}'
    + '.novo-prob-field{display:flex;align-items:center;gap:.75rem;padding:.75rem 0;border-bottom:1px solid var(--border)}'
    + '.novo-prob-field label{flex:1;font-size:.9rem;color:var(--text)}'
    + '.novo-prob-field input{width:72px;text-align:right;background:var(--card2);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:.35rem .5rem;font-size:.9rem;font-family:inherit}'
    + '.novo-prob-field input:focus{outline:none;border-color:var(--teal)}'
    + '.novo-prob-pct{font-size:.85rem;color:var(--text2);width:14px}'
    + '.novo-prob-drawer-ftr{display:flex;justify-content:center;gap:1rem;padding:1.25rem 1.5rem;border-top:1px solid var(--border);flex-shrink:0}'
    + '.novo-prob-cancel{width:48px;height:48px;border-radius:50%;border:1px solid var(--border);background:var(--card2);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s}'
    + '.novo-prob-cancel:hover{border-color:var(--text2);color:var(--text)}'
    + '.novo-prob-save{width:48px;height:48px;border-radius:50%;border:none;background:var(--teal);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s}'
    + '.novo-prob-save:hover{background:#2ea5a4}';

  var HTML = ''
    + '<div class="novo-prob-backdrop" id="novo-prob-backdrop" onclick="novoCloseSettings()"></div>'
    + '<div class="novo-prob-drawer" id="novo-prob-drawer">'
    + '  <div class="novo-prob-drawer-hdr"><h3>Configurações</h3>'
    + '    <button class="hdr-btn" onclick="novoCloseSettings()" aria-label="Fechar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
    + '  </div>'
    + '  <div class="novo-prob-body">'
    + '    <div class="novo-prob-field" style="border-bottom:none;align-items:center"><label>Implantação = Ganho</label><button class="impl-toggle" id="np-impl-toggle" onclick="novoToggleImplWon()" title="" style="margin-left:auto"><span class="sw"></span></button></div>'
    + '    <div class="novo-prob-field" style="border-bottom:none;align-items:center"><label>Ativos incluem Reunião Agendada</label><button class="impl-toggle" id="np-ra-toggle" onclick="novoToggleActiveMeetings()" title="" style="margin-left:auto"><span class="sw"></span></button></div>'
    + '    <div class="novo-prob-field" style="border-bottom:none;align-items:center"><label>Ativos incluem Standby</label><button class="impl-toggle" id="np-sb-toggle" onclick="novoToggleActiveStandby()" title="" style="margin-left:auto"><span class="sw"></span></button></div>'
    + '    <div style="height:1px;background:var(--border);margin:.25rem 0 .55rem"></div>'
    + '    <div class="novo-prob-field" style="border-bottom:none"><label>Meta Receita Ganha (MTD)</label><input type="text" id="np-meta" placeholder="ex: 500.000"><span class="novo-prob-pct">R$</span></div>'
    + '    <div style="height:1px;background:var(--border);margin:.25rem 0 .55rem"></div>'
    + '    <div class="novo-prob-field"><label>Cotação</label><input type="text" id="np-cot"><span class="novo-prob-pct">%</span></div>'
    + '    <div class="novo-prob-field"><label>Proposta Enviada <span style="opacity:.5;font-size:.8em">(BID)</span></label><input type="text" id="np-pro"><span class="novo-prob-pct">%</span></div>'
    + '    <div class="novo-prob-field"><label>Consultoria</label><input type="text" id="np-con"><span class="novo-prob-pct">%</span></div>'
    + '    <div class="novo-prob-field"><label>Negociação</label><input type="text" id="np-neg"><span class="novo-prob-pct">%</span></div>'
    + '    <div class="novo-prob-field"><label>Implantação</label><input type="text" id="np-imp"><span class="novo-prob-pct">%</span></div>'
    + '    <div class="novo-prob-field"><label>Ganho</label><input type="text" id="np-gan"><span class="novo-prob-pct">%</span></div>'
    + '    <div class="novo-prob-field" style="border-bottom:none"><label>Standby</label><input type="text" id="np-stb"><span class="novo-prob-pct">%</span></div>'
    + '    <div style="height:1px;background:var(--border);margin:.25rem 0"></div>'
    + '    <div class="novo-prob-field" style="border-bottom:none"><label>Diagnóstico <span style="opacity:.5;font-size:.8em">(conversão)</span></label><input type="text" id="np-dia"><span class="novo-prob-pct">%</span></div>'
    + '  </div>'
    + '  <div class="novo-prob-drawer-ftr">'
    + '    <button class="novo-prob-cancel" onclick="novoCloseSettings()" title="Cancelar"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
    + '    <button class="novo-prob-save" onclick="novoSaveSettings()" title="Salvar"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>'
    + '  </div>'
    + '</div>';

  function inject(){
    if (document.getElementById('novo-prob-drawer')) return;
    var st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);
    var wrap=document.createElement('div'); wrap.innerHTML=HTML;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', inject); else inject();

  function fmtPct(v){ return ((v||0)*100).toFixed(1).replace('.', ','); }

  // Sincroniza os botões de toggle com o estado atual (chamado pelos novoToggle* do painel).
  window._gsSync = function(){
    var set=function(id,on){ var b=document.getElementById(id); if(b) b.classList.toggle('on',!!on); };
    set('np-impl-toggle', window._novoImplWon);
    set('np-ra-toggle',   window._novoActiveMeetings);
    set('np-sb-toggle',   window._novoActiveStandby);
  };

  window.novoOpenSettings = function(){
    inject();
    var sp=window.NOVO_STAGE_PROB||{};
    var v=function(id,val){ var el=document.getElementById(id); if(el) el.value=val; };
    v('np-meta', window.NOVO_META_MTD ? window.NOVO_META_MTD.toLocaleString('pt-BR') : '');
    v('np-cot', fmtPct(sp['Cotação'])); v('np-pro', fmtPct(sp['Proposta Enviada']));
    v('np-con', fmtPct(sp['Consultoria'])); v('np-neg', fmtPct(sp['Negociação']));
    v('np-imp', fmtPct(sp['Implantação'])); v('np-gan', fmtPct(sp['Ganho']));
    v('np-stb', fmtPct(sp['Standby'])); v('np-dia', fmtPct(sp['Diagnóstico']));
    window._gsSync();
    if (typeof setContentBlur==='function') setContentBlur(true);
    document.getElementById('novo-prob-backdrop').classList.add('open');
    document.getElementById('novo-prob-drawer').classList.add('open');
  };
  window.novoCloseSettings = function(){
    var bd=document.getElementById('novo-prob-backdrop'); if(bd) bd.classList.remove('open');
    var dr=document.getElementById('novo-prob-drawer'); if(dr) dr.classList.remove('open');
    if (typeof setContentBlur==='function') setContentBlur(false);
  };
  window.novoSaveSettings = function(){
    var parse=function(id){ var el=document.getElementById(id); return el?parseFloat(el.value.replace(',', '.')):NaN; };
    var v={ cot:parse('np-cot'), pro:parse('np-pro'), con:parse('np-con'), neg:parse('np-neg'),
            imp:parse('np-imp'), gan:parse('np-gan'), stb:parse('np-stb'), dia:parse('np-dia') };
    var list=[v.cot,v.pro,v.con,v.neg,v.imp,v.gan,v.stb,v.dia];
    if (list.some(isNaN)) { alert('Preencha todos os campos com valores numéricos.'); return; }
    if (list.some(function(n){ return n<0||n>100; })) { alert('Probabilidades devem estar entre 0 e 100.'); return; }
    var sp=window.NOVO_STAGE_PROB;
    sp['Cotação']=v.cot/100; sp['Proposta Enviada']=v.pro/100; sp['Consultoria']=v.con/100;
    sp['Negociação']=v.neg/100; sp['Implantação']=v.imp/100; sp['Ganho']=v.gan/100;
    sp['Standby']=v.stb/100; sp['Stand by']=v.stb/100; sp['Diagnóstico']=v.dia/100;
    try { localStorage.setItem('novo_stage_prob', JSON.stringify(sp)); } catch(e){}
    var metaRaw=document.getElementById('np-meta').value.replace(/[^\d.,]/g,'').replace(/\./g,'').replace(',', '.');
    if (metaRaw==='') { window.NOVO_META_MTD=0; }
    else { var mv=parseFloat(metaRaw); if (isNaN(mv)||mv<0){ alert('Meta inválida. Use um valor numérico (ex: 500.000).'); return; } window.NOVO_META_MTD=mv; }
    try { localStorage.setItem('novo_meta_mtd', String(window.NOVO_META_MTD)); } catch(e){}
    window.novoCloseSettings();
    if (typeof novoRender==='function') novoRender();
  };
})();
