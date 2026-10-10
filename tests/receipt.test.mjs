import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
let now=Date.parse('2026-10-10T01:58:00Z');
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
const sample={version:1,series:'B001',number:'110',date:'2026-10-07',customer:'CLIENTE DE PRUEBA',docType:'DNI',document:'12345678',address:'Lima',email:'',observations:'1 AÑO DE GARANTÍA.',items:[{description:'SSD NVMe 1 TB',serial:'ABC123',code:'SSD-01',unit:'NIU',quantity:'1',price:'480.00'}]};
function setup(){
 const els=new Map(),events={},storage=new Map([['ao-nexus-boleta-v1-qa',JSON.stringify(sample)]]),calls=[],downloads=[],issues=[];
 let apiFailure=null,issueFailure=false;
 function el(id){if(!els.has(id))els.set(id,{id,value:'',checked:false,hidden:false,disabled:false,readOnly:false,dataset:{field:id},listeners:{},classList:{remove(){},add(){},toggle(){}},addEventListener(n,f){this.listeners[n]=f},setAttribute(){},removeAttribute(){},focus(){},scrollIntoView(){},showModal(){},close(){}});return els.get(id)}
 const buttons=[el('exportBtn'),el('exportMobileBtn')];
 const cloud={userId:'qa',saved(){},nextNumber:async()=>110,upload:async(id,bytes)=>calls.push({action:'upload',id,bytes}),issue:async(id,receipt)=>{issues.push(id);if(issueFailure)throw Error('Sin conexión');return {id,payload:{...receipt,number:'110'}}},api:async(action,payload)=>{calls.push({action,payload});if(action==='email-config')return {configured:true,sender:'aonexuspe@gmail.com',admin:false,token:'supabase'};if(apiFailure){const e=Error('No se confirmó el envío');e.code=apiFailure;throw e;}return {sent:true}}};
 const win={parent:{AOCloud:cloud},addEventListener:(n,f)=>events[n]=f};
 const ctx=vm.createContext({Date:Clock,console,structuredClone,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,TextEncoder,TextDecoder,crypto:webcrypto,btoa:v=>Buffer.from(v,'binary').toString('base64'),atob:v=>Buffer.from(v,'base64').toString('binary'),location:{protocol:'https:',replace(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{getElementById:el,querySelectorAll:s=>s==='.export-btn'?buttons:[],visibilityState:'visible',addEventListener:(n,f)=>events[n]=f,fonts:{add(){}}},FontFace:class{async load(){return this}},window:win,setTimeout:(f,t)=>{const timer=setTimeout(f,t);timer.unref();return timer},clearTimeout,setInterval:()=>1,confirm:()=>true,fetch:async url=>({ok:true,arrayBuffer:async()=>{const b=fs.readFileSync(path.join(root,url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}})});
 ctx.self=ctx;
 for(const filename of ['pdf-lib.min.js','fontkit.min.js','receipt.js'])vm.runInContext(fs.readFileSync(path.join(root,'assets',filename),'utf8'),ctx,{filename});
 ctx.testDownloads=downloads;vm.runInContext('download=(bytes,name,mime)=>testDownloads.push({bytes,name,mime});',ctx);
 return {ctx,el,issues,calls,downloads,storage,run:c=>vm.runInContext(c,ctx),failApi:v=>apiFailure=v,failIssue:v=>issueFailure=v};
}
test('PDF real, guardado único, correo opcional y fecha histórica',async()=>{
 const app=setup();await app.run('init()');await app.run('initEmailService()');assert.equal(app.run('data.date'),'2026-10-09');assert.equal(app.el('sendEmail').checked,false);
 await app.run('exportPDF()');assert.equal(app.issues.length,1);assert.equal(app.downloads.length,1);assert.equal(Buffer.from(app.downloads[0].bytes).subarray(0,5).toString(),'%PDF-');assert.equal(app.calls.filter(c=>c.action==='send').length,0);
 fs.mkdirSync(path.join(root,'test-output'),{recursive:true});fs.writeFileSync(path.join(root,'test-output','boleta-qa.pdf'),Buffer.from(app.downloads[0].bytes));
 await app.run('exportPDF()');assert.equal(app.issues.length,1);assert.equal(app.downloads.length,2);
 now=Date.parse('2026-11-01T05:00:01Z');app.run('syncReceiptDate()');assert.equal(app.run('data.date'),'2026-10-09');
 await app.el('newBtn').listeners.click();assert.equal(app.run('data.date'),'2026-11-01');assert.equal(app.el('sendEmail').checked,false);
 app.run('data.customer="CLIENTE DE PRUEBA";data.docType="NONE";data.email="cliente@example.test";data.items=[{description:"SSD NVMe 1 TB",serial:"",code:"",unit:"NIU",quantity:"1",price:"480.00"}]');app.el('sendEmail').checked=true;
 app.failApi('rejected');await app.run('exportPDF()');assert.equal(app.el('retryEmailBtn').hidden,false);const sent=app.calls.filter(c=>c.action==='send').at(-1);assert.equal(sent.payload.job.total,'S/ 480.00');assert.equal(sent.payload.receiptId,app.run('cloudReceiptId'));const id=sent.payload.job.requestId;
 app.failApi(null);await app.el('retryEmailBtn').listeners.click();assert.equal(app.calls.filter(c=>c.action==='send').at(-1).payload.job.requestId,id);
 app.failApi('delivery_unknown');await app.run('exportPDF()');assert.equal(app.el('retryEmailBtn').hidden,true);
}, {timeout:55000});
test('un fallo de guardado conserva el borrador y evita numerar fuera de línea',async()=>{now=Date.parse('2026-10-10T01:58:00Z');const app=setup();await app.run('init()');app.failIssue(true);await app.run('exportPDF()');assert.equal(app.downloads.length,0);assert.equal(app.run('viewingIssued'),false);assert.match(app.el('errorBox').textContent,/Sin conexión/);assert.equal(app.run('data.customer'),'CLIENTE DE PRUEBA');});
