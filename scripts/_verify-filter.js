// Verifica o filtro global híbrido: carrega o inline JS do novo-dashboard num
// stub de DOM, injeta dados reais e compara contagens em All vs janelas.
// Uso: node scripts/_verify-filter.js
const fs = require('fs');
const http = require('http');
const vm = require('vm');
const file = 'public/dashboard.html';

function get(path){ return new Promise((res,rej)=>{ http.get('http://localhost:3002'+path, r=>{ let b=''; r.on('data',c=>b+=c); r.on('end',()=>{ try{res(JSON.parse(b));}catch(e){rej(e);} }); }).on('error',rej); }); }
function makeStub(name){ const fn=function(){return makeStub(name+'()');}; return new Proxy(fn,{ get(_t,p){ if(p==='length')return 0; if(p==='classList')return {add(){},remove(){},toggle(){},contains(){return false;}}; if(p==='style')return new Proxy({},{get(){return '';},set(){return true;}}); if(p==='getContext')return ()=>makeStub('ctx'); if(p==='textContent'||p==='innerHTML'||p==='value')return ''; if(p===Symbol.toPrimitive||p==='toString')return ()=>''; if(p==='dataset')return {}; return makeStub(name+'.'+String(p)); }, set(){return true;}, apply(){return makeStub(name+'()');} }); }

(async()=>{
  const data = await get('/api/forecast-table?includeLost=true');
  const deals = data.deals||[];
  const html = fs.readFileSync(file,'utf8');
  const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi; let m, scripts=[];
  while((m=re.exec(html))!==null){ const a=m[1]||''; if(/\bsrc\s*=/.test(a))continue; if(/type\s*=\s*["']?(application\/json|text\/template)/i.test(a))continue; scripts.push(m[2]); }
  const sandbox={ document:makeStub('document'), console, localStorage:{getItem(){return null;},setItem(){},removeItem(){}}, navigator:{language:'pt-BR'}, location:{pathname:'/novo',href:'',search:''}, Chart:makeStub('Chart'), ChartDataLabels:{}, fetch:()=>Promise.resolve({json(){return Promise.resolve({success:true});}}), setTimeout,clearTimeout,setInterval,clearInterval, requestAnimationFrame:cb=>0, matchMedia:()=>({matches:false,addListener(){},addEventListener(){}}), addEventListener(){}, removeEventListener(){}, getComputedStyle(){return makeStub('cs');}, CustomEvent:function(){}, Event:function(){}, MutationObserver:function(){return{observe(){},disconnect(){}};}, ResizeObserver:function(){return{observe(){},disconnect(){}};}, JSON,Math,Date,parseInt,parseFloat,isNaN,isFinite,Object,Array,String,Number,Boolean,RegExp,Intl,encodeURIComponent,decodeURIComponent };
  sandbox.window=sandbox; sandbox.globalThis=sandbox;
  const ctx=vm.createContext(sandbox);
  scripts.forEach((s,i)=>{ try{ vm.runInContext(s,ctx,{filename:'s'+i}); }catch(e){ console.log('load err',e.message); } });
  ctx._novoDeals=deals;

  function counts(){ return { open:ctx._novoOpen().length, won:ctx._novoWon().length, lost:ctx._novoLost().length, openRaw:ctx._novoOpenRaw().length }; }
  ctx._novoFilter={mode:'all',start:null,end:null};
  console.log('ALL                :', JSON.stringify(counts()));
  ctx._novoFilter={mode:'q',start:'2026-01-01',end:'2026-03-31'};
  console.log("Q1'26 (jan-mar/26) :", JSON.stringify(counts()), '<- open por createdate, won/lost por close_date');
  ctx._novoFilter={mode:'q',start:'2025-07-01',end:'2025-09-30'};
  console.log("Q3'25 (jul-set/25) :", JSON.stringify(counts()));
  // eixos
  ctx._novoFilter={mode:'all',start:null,end:null};
  console.log('monthAxis ALL back :', ctx._novoMonthAxis().length, 'meses |', ctx._novoMonthAxis()[0], '→', ctx._novoMonthAxis()[11]);
  console.log('weekAxis  ALL      :', ctx._novoWeekAxis().length, 'semanas');
  ctx._novoFilter={mode:'q',start:'2026-01-01',end:'2026-03-31'};
  console.log("monthAxis Q1'26    :", JSON.stringify(ctx._novoMonthAxis()));
  console.log("weekAxis  Q1'26    :", ctx._novoWeekAxis().length, 'semanas');
})().catch(e=>{ console.error('harness err', e.message); process.exit(1); });
