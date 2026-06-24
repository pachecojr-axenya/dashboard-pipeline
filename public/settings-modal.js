// ── Modal de Configurações globais (compartilhado) ──────────────────────────────
// Fonte única do modal de Configurações para os painéis secundários (Board, AE, BDR,
// Last 48h). Reproduz o modal do CRO Dashboard: toggles globais, seção Metas (BDR),
// probabilidades por etapa e meta de receita ganha. Persiste tudo no localStorage.
//
// O CRO Dashboard NÃO inclui este arquivo: ele mantém o modal inline (a referência).
// Os painéis que incluem este módulo devem ter: _novoImplWon, _novoActiveMeetings,
// _novoActiveStandby, novoToggleImplWon/ActiveMeetings/ActiveStandby, novoRender e
// setContentBlur. NOVO_STAGE_PROB / NOVO_META_MTD têm fallback aqui se ausentes.
(function(){
  var SP_DEFAULT = {
    'Reunião Agendada':0.06,'Diagnóstico':0.06,
    'Cotação':0.33,'Proposta Enviada':0.285,'Consultoria':0.611,
    'Negociação':0.42,'Implantação':0.581,'Ganho':1.0,
    'Standby':0.12,'Stand by':0.12,
  };

  // BDR goals: stored in localStorage as bdr_metas = {name: goal}
  var BDR_LIST = [
    {name:'Anderson Souza',       level:'Antigo',       goal:23},
    {name:'Cintia Rodrigues',     level:'Antigo',       goal:25},
    {name:'Gabriele Almeida',     level:'Antigo',       goal:23},
    {name:'Priscilla Feliciello', level:'Antigo',       goal:23},
    {name:'Letícia Romão',        level:'Interm.',goal:15},
    {name:'Allan Valença',        level:'Novo',         goal:10},
    {name:'Bruna Reis',           level:'Novo',         goal:7},
    {name:'Emmanuelle Braga',     level:'Novo',         goal:10},
    {name:'Felipe Andrade',       level:'Novo',         goal:10},
    {name:'Giovana Nunes',        level:'Novo',         goal:10},
    {name:'Marcelli Netto',       level:'Novo',         goal:10},
    {name:'Thauan Pontes',        level:'Novo',         goal:10},
    {name:'Yokyko Muramoto',      level:'Novo',         goal:10},
  ];

  function loadProb(){
    try { var raw=localStorage.getItem('novo_stage_prob'); if(raw){ var p=JSON.parse(raw), m={};
      Object.keys(SP_DEFAULT).forEach(function(k){m[k]=SP_DEFAULT[k];});
      Object.keys(p).forEach(function(k){m[k]=p[k];}); return m; } } catch(e){}
    var c={}; Object.keys(SP_DEFAULT).forEach(function(k){c[k]=SP_DEFAULT[k];}); return c;
  }
  function loadMeta(){ try { var v=parseFloat(localStorage.getItem('novo_meta_mtd')); return isNaN(v)?0:v; } catch(e){ return 0; } }
  function loadBdrMetas(){
    try { var raw=localStorage.getItem('bdr_metas'); if(raw) return JSON.parse(raw); } catch(e){}
    var m={}; BDR_LIST.forEach(function(b){m[b.name]=b.goal;}); return m;
  }

  // Expose BDR data globally so charts can use them
  if (typeof window.NOVO_STAGE_PROB === 'undefined' || !window.NOVO_STAGE_PROB) window.NOVO_STAGE_PROB = loadProb();
  if (typeof window.NOVO_META_MTD === 'undefined') window.NOVO_META_MTD = loadMeta();
  if (typeof window.BDR_METAS === 'undefined') window.BDR_METAS = loadBdrMetas();
  window.BDR_LIST = BDR_LIST;

  var LEVEL_COLORS = {
    'Antigo':       'rgba(58,184,183,.25)',
    'Interm.':'rgba(147,112,219,.25)',
    'Novo':         'rgba(88,166,255,.2)',
  };
  var LEVEL_TEXT = {
    'Antigo':       'var(--teal)',
    'Interm.':'rgba(147,112,219,1)',
    'Novo':         'rgba(88,166,255,1)',
  };

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
    + '.novo-prob-field input{width:64px;text-align:right;background:var(--card2);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:.35rem .5rem;font-size:.9rem;font-family:inherit}'
    + '.novo-prob-field input:focus{outline:none;border-color:var(--teal)}'
    + '.novo-prob-pct{font-size:.85rem;color:var(--text2);width:14px}'
    + '.novo-prob-drawer-ftr{display:flex;justify-content:center;gap:1rem;padding:1.25rem 1.5rem;border-top:1px solid var(--border);flex-shrink:0}'
    + '.novo-prob-cancel{width:44px;height:44px;border-radius:50%;border:1px solid var(--border);background:var(--card2);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0}'
    + '.novo-prob-cancel:hover{border-color:var(--text2);color:var(--text)}'
    + '.novo-prob-save-local{flex:1;padding:.5rem .3rem;border-radius:8px;border:1px solid var(--teal);background:transparent;color:var(--teal);cursor:pointer;font-size:.73rem;font-weight:600;font-family:inherit;line-height:1.25;transition:all .15s}'
    + '.novo-prob-save-local:hover{background:rgba(58,184,183,.12)}'
    + '.novo-prob-save-global{flex:1;padding:.5rem .3rem;border-radius:8px;border:none;background:var(--teal);color:#fff;cursor:pointer;font-size:.73rem;font-weight:600;font-family:inherit;line-height:1.25;transition:background .15s}'
    + '.novo-prob-save-global:hover{background:#2ea5a4}'
    + '.np-section-sep{font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text2);padding:.9rem 0 .4rem;border-bottom:1px solid var(--border);margin-bottom:.25rem}'
    + '.np-bdr-row{display:flex;align-items:center;gap:.6rem;padding:.55rem 0;border-bottom:1px solid rgba(255,255,255,.05)}'
    + '.np-bdr-name{flex:1;font-size:.82rem;color:var(--text)}'
    + '.np-bdr-level{font-size:.68rem;font-weight:700;border-radius:99px;padding:.18rem .55rem;flex-shrink:0}'
    + '.np-bdr-input{width:52px;text-align:right;background:var(--card2);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:.28rem .4rem;font-size:.84rem;font-family:inherit}'
    + '.np-bdr-input:focus{outline:none;border-color:var(--teal)}'
    + '.np-reset{background:none;border:none;color:var(--text2);cursor:pointer;font-size:.85rem;padding:0 .25rem;line-height:1;transition:color .12s;flex-shrink:0}'
    + '.np-reset:hover{color:var(--teal)}';

  function _bdrRowHtml(b, idx, goals){
    var bg = LEVEL_COLORS[b.level]||'rgba(255,255,255,.05)';
    var tc = LEVEL_TEXT[b.level]||'var(--text2)';
    var val = goals[b.name]!=null ? goals[b.name] : b.goal;
    return '<div class="np-bdr-row">'
      + '<span class="np-bdr-name">'+b.name+'</span>'
      + '<span class="np-bdr-level" style="background:'+bg+';color:'+tc+'">'+b.level+'</span>'
      + '<input type="number" class="np-bdr-input" id="np-bdr-'+idx+'" value="'+val+'" min="0" step="1">'
      + '</div>';
  }

  function _buildHTML(goals){
    var bdrRows = BDR_LIST.map(function(b,i){return _bdrRowHtml(b,i,goals);}).join('');
    return ''
      + '<div class="novo-prob-backdrop" id="novo-prob-backdrop" onclick="novoCloseSettings()"></div>'
      + '<div class="novo-prob-drawer" id="novo-prob-drawer">'
      + '  <div class="novo-prob-drawer-hdr"><h3>Configurações</h3>'
      + '    <button class="hdr-btn" onclick="novoCloseSettings()" aria-label="Fechar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
      + '  </div>'
      + '  <div class="novo-prob-body">'
      // a-c: toggles
      + '    <div class="novo-prob-field" style="border-bottom:none;align-items:center"><label>Implantação = Ganho</label><button class="impl-toggle" id="np-impl-toggle" onclick="novoToggleImplWon()" style="margin-left:auto"><span class="sw"></span></button></div>'
      + '    <div class="novo-prob-field" style="border-bottom:none;align-items:center"><label>Ativos incluem Reunião Agendada</label><button class="impl-toggle" id="np-ra-toggle" onclick="novoToggleActiveMeetings()" style="margin-left:auto"><span class="sw"></span></button></div>'
      + '    <div class="novo-prob-field" style="border-bottom:none;align-items:center"><label>Ativos incluem Standby</label><button class="impl-toggle" id="np-sb-toggle" onclick="novoToggleActiveStandby()" style="margin-left:auto"><span class="sw"></span></button></div>'
      // e: Metas separator + global notice
      + '    <div class="np-section-sep">Metas</div>'
      + '    <p style="font-size:.72rem;color:var(--text2);margin:.3rem 0 .5rem;line-height:1.4">Alterações salvas globalmente — visíveis para todos os usuários.</p>'
      // f-r: BDR goals
      + bdrRows
      // s: Probabilidades separator
      + '    <div class="np-section-sep" style="margin-top:.75rem">Probabilidades</div>'
      // t: notice
      + '    <p style="font-size:.75rem;color:var(--text2);margin:.35rem 0 .55rem;line-height:1.4">Calculadas pelo funil histórico (C06). Edite para ajuste manual; clique ↺ para redefinir ao padrão.</p>'
      // u-aa: probability fields with reset
      + '    <div class="novo-prob-field"><label>Reunião Agendada</label><button class="np-reset" onclick="_gsResetProb(\'np-rag\',\'Reunião Agendada\')" title="Redefinir">↺</button><input type="text" id="np-rag"><span class="novo-prob-pct">%</span></div>'
      + '    <div class="novo-prob-field"><label>Diagnóstico</label><button class="np-reset" onclick="_gsResetProb(\'np-dia\',\'Diagnóstico\')" title="Redefinir">↺</button><input type="text" id="np-dia"><span class="novo-prob-pct">%</span></div>'
      + '    <div class="novo-prob-field"><label>Cotação</label><button class="np-reset" onclick="_gsResetProb(\'np-cot\',\'Cotação\')" title="Redefinir">↺</button><input type="text" id="np-cot"><span class="novo-prob-pct">%</span></div>'
      + '    <div class="novo-prob-field"><label>Proposta Enviada <span style="opacity:.5;font-size:.8em">(BID)</span></label><button class="np-reset" onclick="_gsResetProb(\'np-pro\',\'Proposta Enviada\')" title="Redefinir">↺</button><input type="text" id="np-pro"><span class="novo-prob-pct">%</span></div>'
      + '    <div class="novo-prob-field"><label>Consultoria</label><button class="np-reset" onclick="_gsResetProb(\'np-con\',\'Consultoria\')" title="Redefinir">↺</button><input type="text" id="np-con"><span class="novo-prob-pct">%</span></div>'
      + '    <div class="novo-prob-field"><label>Negociação</label><button class="np-reset" onclick="_gsResetProb(\'np-neg\',\'Negociação\')" title="Redefinir">↺</button><input type="text" id="np-neg"><span class="novo-prob-pct">%</span></div>'
      + '    <div class="novo-prob-field" style="border-bottom:none"><label>Implantação / Ganho</label><button class="np-reset" onclick="_gsResetProb(\'np-imp\',\'Implantação\')" title="Redefinir">↺</button><input type="text" id="np-imp"><span class="novo-prob-pct">%</span></div>'
      + '    <div style="height:1px;background:var(--border);margin:.5rem 0 .25rem"></div>'
      // ab: meta de receita at end
      + '    <div class="novo-prob-field" style="border-bottom:none"><label>Meta Receita Ganha (MTD)</label><input type="text" id="np-meta" placeholder="ex: 500.000"><span class="novo-prob-pct">R$</span></div>'
      + '    <div style="height:1.5rem"></div>'
      + '  </div>'
      + '  <div class="novo-prob-drawer-ftr">'
      + '    <button class="novo-prob-cancel" onclick="novoCloseSettings()" title="Cancelar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
      + '    <button class="novo-prob-save-local" onclick="novoSaveProbs()" title="Salva probabilidades no seu navegador (local)">Salvar<br>Probabilidades</button>'
      + '    <button class="novo-prob-save-global" onclick="novoSaveMetas()" title="Salva metas globalmente para todos os usuários">Salvar<br>Metas</button>'
      + '  </div>'
      + '</div>';
  }

  function inject(){
    if (document.getElementById('novo-prob-drawer')) return;
    var st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);
    var goals = loadBdrMetas();
    var wrap=document.createElement('div'); wrap.innerHTML=_buildHTML(goals);
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', inject); else inject();

  function fmtPct(v){ return ((v||0)*100).toFixed(1).replace('.', ','); }

  window._gsResetProb = function(inputId, stage){
    var el = document.getElementById(inputId);
    if (el) el.value = fmtPct(SP_DEFAULT[stage]||0);
  };

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
    v('np-rag', fmtPct(sp['Reunião Agendada']||SP_DEFAULT['Reunião Agendada']));
    v('np-dia', fmtPct(sp['Diagnóstico']||SP_DEFAULT['Diagnóstico']));
    v('np-cot', fmtPct(sp['Cotação']||SP_DEFAULT['Cotação']));
    v('np-pro', fmtPct(sp['Proposta Enviada']||SP_DEFAULT['Proposta Enviada']));
    v('np-con', fmtPct(sp['Consultoria']||SP_DEFAULT['Consultoria']));
    v('np-neg', fmtPct(sp['Negociação']||SP_DEFAULT['Negociação']));
    v('np-imp', fmtPct(sp['Implantação']||SP_DEFAULT['Implantação']));
    // BDR goals — seed from localStorage, then refresh from API
    var goals = loadBdrMetas();
    BDR_LIST.forEach(function(b,i){
      var el=document.getElementById('np-bdr-'+i); if(el) el.value=(goals[b.name]!=null?goals[b.name]:b.goal);
    });
    window._gsSync();
    if (typeof setContentBlur==='function') setContentBlur(true);
    document.getElementById('novo-prob-backdrop').classList.add('open');
    document.getElementById('novo-prob-drawer').classList.add('open');
    // Fetch latest global metas from API (non-blocking)
    fetch('/api/bdr-metas', {credentials:'include'}).then(function(r){ return r.json(); }).then(function(data){
      if (data && data.success && data.metas) {
        var g=data.metas;
        window.BDR_METAS=g;
        try { localStorage.setItem('bdr_metas', JSON.stringify(g)); } catch(e){}
        BDR_LIST.forEach(function(b,i){
          var el=document.getElementById('np-bdr-'+i);
          if(el && g[b.name]!=null) el.value=g[b.name];
        });
      }
    }).catch(function(){});
  };

  window.novoCloseSettings = function(){
    var bd=document.getElementById('novo-prob-backdrop'); if(bd) bd.classList.remove('open');
    var dr=document.getElementById('novo-prob-drawer'); if(dr) dr.classList.remove('open');
    if (typeof setContentBlur==='function') setContentBlur(false);
  };

  // Salva apenas probabilidades (local) + meta de receita
  window.novoSaveProbs = function(){
    var parse=function(id){ var el=document.getElementById(id); return el?parseFloat(el.value.replace(',', '.')):NaN; };
    var v={ rag:parse('np-rag'), dia:parse('np-dia'), cot:parse('np-cot'), pro:parse('np-pro'),
            con:parse('np-con'), neg:parse('np-neg'), imp:parse('np-imp') };
    var list=[v.rag,v.dia,v.cot,v.pro,v.con,v.neg,v.imp];
    if (list.some(isNaN)) { alert('Preencha todos os campos de probabilidade com valores numéricos.'); return; }
    if (list.some(function(n){ return n<0||n>100; })) { alert('Probabilidades devem estar entre 0 e 100.'); return; }
    var sp=window.NOVO_STAGE_PROB;
    sp['Reunião Agendada']=v.rag/100; sp['Diagnóstico']=v.dia/100;
    sp['Cotação']=v.cot/100; sp['Proposta Enviada']=v.pro/100; sp['Consultoria']=v.con/100;
    sp['Negociação']=v.neg/100; sp['Implantação']=v.imp/100;
    sp['Ganho']=1.0; sp['Standby']=SP_DEFAULT['Standby']; sp['Stand by']=SP_DEFAULT['Standby'];
    try { localStorage.setItem('novo_stage_prob', JSON.stringify(sp)); } catch(e){}
    // Meta de receita
    var metaRaw=document.getElementById('np-meta').value.replace(/[^\d.,]/g,'').replace(/\./g,'').replace(',', '.');
    if (metaRaw==='') { window.NOVO_META_MTD=0; }
    else { var mv=parseFloat(metaRaw); if (isNaN(mv)||mv<0){ alert('Meta inválida. Use um valor numérico (ex: 500.000).'); return; } window.NOVO_META_MTD=mv; }
    try { localStorage.setItem('novo_meta_mtd', String(window.NOVO_META_MTD)); } catch(e){}
    window.novoCloseSettings();
    if (typeof novoRender==='function') novoRender();
  };

  // Salva metas dos BDRs globalmente via API (todos os usuários)
  window.novoSaveMetas = function(){
    var goals={};
    for (var i=0; i<BDR_LIST.length; i++){
      var b=BDR_LIST[i];
      var el=document.getElementById('np-bdr-'+i);
      var val=el?parseInt(el.value):b.goal;
      if(isNaN(val)||val<0){ alert('Meta inválida para '+b.name+'. Use um número inteiro ≥ 0.'); return; }
      goals[b.name]=val;
    }
    // Atualiza local imediatamente
    window.BDR_METAS=goals;
    try { localStorage.setItem('bdr_metas', JSON.stringify(goals)); } catch(e){}
    // POST para API (global)
    fetch('/api/bdr-metas', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({metas:goals}),
      credentials:'include',
    }).then(function(r){ return r.json(); }).then(function(data){
      if(data && data.success && data.metas){
        window.BDR_METAS=data.metas;
        try { localStorage.setItem('bdr_metas', JSON.stringify(data.metas)); } catch(e){}
      } else {
        console.warn('[bdr-metas] save warning:', data && data.error);
      }
      window.novoCloseSettings();
      if(typeof novoRender==='function') novoRender();
    }).catch(function(){
      // API indisponível — mantém salvo localmente
      window.novoCloseSettings();
      if(typeof novoRender==='function') novoRender();
    });
  };

  // Alias para compatibilidade (salva tudo localmente)
  window.novoSaveSettings = window.novoSaveProbs;
})();
