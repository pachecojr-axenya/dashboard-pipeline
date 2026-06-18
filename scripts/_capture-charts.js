// Captura os datasets REAIS gerados por cada gráfico (intercepta _novoMkChart)
// rodando os scripts inline com dados reais. Uso: node _capture-charts.js <html> [includeLost]
const fs=require('fs'),http=require('http'),vm=require('vm'),path=require('path');
const file=process.argv[2], includeLost=process.argv[3]==='includeLost';
function get(p){return new Promise((res,rej)=>{http.get('http://localhost:3002'+p,r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}})}).on('error',rej)})}
function stub(n){const f=function(){return stub(n)};return new Proxy(f,{get(_t,p){if(p==='length')return 0;if(p==='matches')return false;if(p==='classList')return{add(){},remove(){},toggle(){},contains(){return false}};if(p==='style')return new Proxy({},{get(){return''},set(){return true}});if(p==='getBoundingClientRect')return()=>({width:0,height:0});if(p==='getContext')return()=>stub('ctx');return stub(n+'.'+String(p))},set(){return true},apply(){return stub(n)}})}
(async()=>{
 const data=await get('/api/forecast-table'+(includeLost?'?includeLost=true':''));
 const deals=data.deals||data;
 let funnel=null; try{funnel=await get('/api/funnel-stages');}catch(e){}
 const html=fs.readFileSync(file,'utf8');
 const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,scripts=[];
 while((m=re.exec(html))){if(/\bsrc\s*=/.test(m[1]||''))continue;if(/type\s*=\s*["']?(application\/json|text\/template)/i.test(m[1]||''))continue;scripts.push(m[2])}
 const sb={document:stub('d'),console,localStorage:{getItem(){return null},setItem(){},removeItem(){}},navigator:{language:'pt-BR'},location:{pathname:'/novo',search:'',href:''},Chart:stub('Chart'),ChartDataLabels:{},
   fetch:function(u){ if(String(u).indexOf('funnel-stages')>=0&&funnel)return Promise.resolve({json(){return Promise.resolve(funnel)}}); return Promise.resolve({json(){return Promise.resolve(data)}}); },
   setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame(){return 0},addEventListener(){},removeEventListener(){},dispatchEvent(){return true},getComputedStyle(){return stub('cs')},CustomEvent:function(){},Event:function(){},MutationObserver:function(){return{observe(){},disconnect(){}}},ResizeObserver:function(){return{observe(){},disconnect(){}}},
   JSON,Math,Date,parseInt,parseFloat,isNaN,isFinite,Object,Array,String,Number,Boolean,RegExp,Intl,encodeURIComponent,decodeURIComponent};
 sb.window=sb;sb.globalThis=sb;const ctx=vm.createContext(sb);
 scripts.forEach(s=>{try{vm.runInContext(s,ctx)}catch(e){}});
 const cap={};
 const wrap=function(id,cfg){ try{ cap[id]={type:cfg&&cfg.type,labels:(cfg&&cfg.data&&cfg.data.labels)||null,datasets:((cfg&&cfg.data&&cfg.data.datasets)||[]).map(function(ds){return{label:ds.label,data:ds.data};})}; }catch(e){ cap[id]={err:String(e)}; } };
 ctx._novoMkChart=wrap;
 ctx._novoDeals=deals;
 // injeta dados de funil se houver globais conhecidos
 if(funnel){ try{ctx._novoFunnelData=funnel;}catch(e){} }
 try{ ctx.novoRender(); }catch(e){ console.log('novoRender ERRO: '+e.message); }
 // tenta carregar funil (dashboard) p/ charts dependentes
 if(typeof ctx.novoLoadFunnel==='function'){ try{ctx.novoLoadFunnel();}catch(e){} }
 console.log(JSON.stringify(cap,null,1));
})().catch(e=>{console.error('harness ERRO: '+e.stack);process.exit(1)});
