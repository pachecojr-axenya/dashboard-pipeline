// Compara as chaves PT vs EN do NOVO_I18N de um HTML. Uso: node _i18n-parity.js <arquivo.html>
const fs = require('fs'); const vm = require('vm');
const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, scripts = [];
while ((m = re.exec(html)) !== null) { if (/\bsrc\s*=/.test(m[1] || '')) continue; scripts.push(m[2]); }
function stub(n){ const f=function(){return stub(n);}; return new Proxy(f,{get(_t,p){if(p==='length')return 0;if(p==='matches')return false;if(p==='classList')return{add(){},remove(){},toggle(){},contains(){return false;}};return stub(n+'.'+String(p));},set(){return true;},apply(){return stub(n);}}); }
const sb={document:stub('d'),console,localStorage:{getItem(){return null;},setItem(){}},navigator:{},location:{pathname:''},Chart:stub('C'),ChartDataLabels:{},fetch(){return Promise.resolve({json(){return Promise.resolve({});}});},setTimeout,setInterval,addEventListener(){},removeEventListener(){},matchMedia(){return{matches:false,addListener(){},addEventListener(){}};},JSON,Math,Date,parseInt,parseFloat,isNaN,Object,Array,String,Number,Boolean,RegExp,Intl};
sb.window=sb; const ctx=vm.createContext(sb);
scripts.forEach(s=>{try{vm.runInContext(s,ctx);}catch(e){}});
const I=ctx.NOVO_I18N; if(!I||!I.pt||!I.en){console.log('NOVO_I18N não encontrado');process.exit(1);}
const pt=Object.keys(I.pt), en=Object.keys(I.en);
const onlyPt=pt.filter(k=>!(k in I.en)), onlyEn=en.filter(k=>!(k in I.pt));
console.log(file.split(/[\\/]/).pop()+': PT='+pt.length+' EN='+en.length);
console.log('  só em PT (faltam no EN): '+(onlyPt.length?onlyPt.join(', '):'nenhuma'));
console.log('  só em EN (faltam no PT): '+(onlyEn.length?onlyEn.join(', '):'nenhuma'));
