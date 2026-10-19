const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const win={parent:{AOCloud:{userId:'test'}}};
const context=vm.createContext({window:win,location:{replace(){}},document:{getElementById(){return null;}},crypto:webcrypto,Uint8Array,Intl,structuredClone,console,setTimeout,clearTimeout,localStorage:{getItem(){return null;}},fetch:async name=>({ok:true,arrayBuffer:async()=>{const b=fs.readFileSync(path.join(__dirname,'../dist',name));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}})});
for(const asset of ['pdf-lib.min.js','fontkit.min.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/assets',asset),'utf8'),context);
const PDFLib=context.PDFLib;
const source=fs.readFileSync(path.join(__dirname,'../dist/assets/receipt.js'),'utf8');
vm.runInContext(source.slice(0,source.indexOf('function download(')),context);
const input={version:1,series:'QATEST',number:'1',date:'2026-10-10',customer:'CLIENTE DE PRUEBA · Muñoz',docType:'NONE',document:'',email:'',address:'Lima',observations:'1 AÑO DE GARANTÍA.',items:[{description:'Computadora completa: placa B850 y procesador Ryzen 9',serial:'SN-PRUEBA',code:'PC-01',unit:'NIU',quantity:'1',price:'2100.50'}]};
context.testReceipt=input;
(async()=>{
 await vm.runInContext('(async()=>{const scratch=await PDFLib.PDFDocument.create();fonts=await embedReceiptFonts(scratch);})()',context);
 assert.equal(vm.runInContext('amountInWords(210050)',context),'DOS MIL CIEN SOLES CON CINCUENTA CÉNTIMOS');
 const bytes=await vm.runInContext('generatePDF(testReceipt)',context);
 const pdf=await PDFLib.PDFDocument.load(bytes);assert.equal(pdf.getPageCount(),1);
 assert.ok(bytes.length>10000);fs.mkdirSync(path.join(__dirname,'../.qa'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../.qa/receipt-test.pdf'),bytes);
 context.testReceipt={...input,items:Array.from({length:15},(_,i)=>({...input.items[0],description:'COMPONENTE '+(i+1)+' · descripción del producto',price:'100.00'}))};
 const single=await vm.runInContext('generatePDF(testReceipt)',context);assert.equal((await PDFLib.PDFDocument.load(single)).getPageCount(),1,'15 productos caben en una sola hoja');
 // Una PC completa con descripciones largas, números de serie y observaciones sigue en una hoja y con letra legible.
 for(const count of [7,10,13]){
  context.testReceipt={...input,observations:'1 AÑO DE GARANTÍA.\nNo cubre daños por mal uso.',items:Array.from({length:count},(_,i)=>({...input.items[0],code:'PC-'+(i+1),description:'COMPONENTE '+(i+1)+' · Procesador AMD Ryzen 7 9700X 8 núcleos 16 hilos 5.5 GHz AM5 caja original',price:'350.00'}))};
  const pages=vm.runInContext('buildScenes(testReceipt)',context);assert.equal(pages.length,1,count+' productos en una sola hoja');
  const texts=pages[0].filter(o=>o.type==='text');for(const o of texts)assert.ok(o.size>=5.2,'letra legible: '+o.value+' '+o.size);
  for(let i=1;i<=count;i++)assert.ok(texts.some(o=>o.value.startsWith('COMPONENTE '+i+' ')),'se ve el producto '+i);
  const bottom=Math.max(...pages[0].filter(o=>o.type==='text'||o.fill!=='#ffffff'||o.stroke).map(o=>o.type==='rect'?o.y+o.h:o.y));assert.ok(bottom<=825,'nada se sale de la hoja: '+bottom);
 }
 context.testReceipt={...input,items:Array.from({length:60},(_,i)=>({...input.items[0],description:'COMPONENTE '+(i+1),price:'1.00'}))};
 assert.ok(vm.runInContext('buildScenes(testReceipt)',context).length>1,'solo una boleta enorme se reparte en varias hojas');
 // Sin seleccionar productos la boleta se puede emitir: cada unidad se registra como «Venta sin stock».
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/assets/suite-core.js'),'utf8'),context);win.parent.AOSuiteCore=win.AOSuiteCore;
 context.manual={...input,items:[{description:'ARMADO DE PC',serial:'',code:'',unit:'NIU',quantity:'2',price:'100',inventory:[]}]};
 vm.runInContext('data=manual',context);assert.equal(vm.runInContext('validate()',context).filter(e=>/Seleccionar/.test(e.msg)).length,0,'ya no exige seleccionar productos');
 const filled=vm.runInContext('withManualInventory(structuredClone(manual))',context).items[0];
 assert.equal(filled.inventory.length,2);assert.ok(filled.inventory.every(p=>p.source==='external'&&p.supplier==='Venta sin stock'&&p.name==='ARMADO DE PC'));
 assert.equal(filled.inventory.reduce((t,p)=>t+Math.round(Number(p.price)*100),0),20000,'las unidades suman el importe de la línea');
 console.log('PDF con plantilla, fuentes, tildes, importe en letras y muchos productos en una sola hoja: correcto');
})().catch(e=>{console.error(e);process.exit(1);});
