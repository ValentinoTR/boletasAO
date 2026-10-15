// Cotizaciones: funciones del editor (teléfono para WhatsApp, número COT, validez, importe en letras, validación,
// reglas de las líneas) y el PDF de 1 y de varias páginas. Carga quote.js en un contexto aislado, como tests/pdf.test.cjs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const ROOT=path.join(__dirname,'..');
const context=vm.createContext({window:{parent:{AOQuoteHost:{userId:'test'}}},location:{replace(){}},document:{getElementById(){return null;}},crypto:webcrypto,Uint8Array,Intl,structuredClone,console,setTimeout,clearTimeout,localStorage:{getItem(){return null;},setItem(){}},fetch:async name=>({ok:true,arrayBuffer:async()=>{const b=fs.readFileSync(path.join(ROOT,'dist',name));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}})});
for(const asset of ['pdf-lib.min.js','fontkit.min.js'])vm.runInContext(fs.readFileSync(path.join(ROOT,'dist/assets',asset),'utf8'),context);
const source=fs.readFileSync(path.join(ROOT,'dist/assets/quote.js'),'utf8');
// Las funciones puras y el PDF van antes de «function download(»; lo que toca la pantalla, después.
assert.ok(source.indexOf('function download(')>0);
vm.runInContext(source.slice(0,source.indexOf('function download(')),context);
const run=code=>vm.runInContext(code,context);
const call=(name,...args)=>run(name)(...args);
const plain=value=>JSON.parse(JSON.stringify(value));
const quote=(over={})=>({version:1,date:'2026-10-14',validDays:7,validUntil:'2026-10-21',customer:'Inversiones Lima SAC',docType:'RUC',document:'20123456789',phone:'987 654 321',email:'compras@invlima.pe',address:'Av. Arequipa 123, Lima',notes:'Precios en soles. Sujeto a disponibilidad de stock.\n1 AÑO DE GARANTÍA.',
  items:[{description:'Ryzen 7 7800X3D',code:'',unit:'NIU',quantity:'2',price:'1650.00',mode:'units',parts:[{source:'product',productId:'101',name:'Ryzen 7 7800X3D',price:'1650.00'},{source:'product',productId:'101',name:'Ryzen 7 7800X3D',price:'1650.00'}]}],...over});
const errorIds=q=>plain(call('validate',q)).map(e=>e.id);
let PDFLib;
test.before(async()=>{PDFLib=context.PDFLib;await run('(async()=>{const scratch=await PDFLib.PDFDocument.create();fonts=await embedQuoteFonts(scratch);})()');});

test('Teléfono para WhatsApp: celular peruano con 51, números internacionales tal cual y los cortos se descartan',()=>{
  const n=p=>call('normalizePhone',p);
  assert.equal(n('987 654 321'),'51987654321');assert.equal(n('987-654-321'),'51987654321');
  assert.equal(n('+51 987 654 321'),'51987654321');assert.equal(n('51987654321'),'51987654321');
  assert.equal(n('+1 (305) 555-0100'),'13055550100');assert.equal(n('01 4567890'),'014567890');
  assert.equal(n('4567890'),'');assert.equal(n(''),'');assert.equal(n('1234567890123456'),'');assert.equal(n(null),'');
});
test('Enlace de WhatsApp con el mensaje de la cotización (con y sin teléfono)',()=>{
  const text=call('shareText',quote(),'COT-00012');
  assert.equal(text,'Hola Inversiones Lima SAC, te comparto la cotización COT-00012 de AO Nexus por S/ 3,300.00, válida hasta el 21/10/2026. Cualquier consulta, estoy atento.');
  assert.equal(call('whatsappURL','987654321',text),'https://wa.me/51987654321?text='+encodeURIComponent(text));
  assert.equal(call('whatsappURL','',text),'https://wa.me/?text='+encodeURIComponent(text));
  assert.match(call('shareText',quote({customer:''}),'COT-00012'),/^Hola, te comparto/);
});
test('Número de cotización COT con 5 dígitos',()=>{
  assert.equal(call('quoteLabel',12),'COT-00012');assert.equal(call('quoteLabel',1),'COT-00001');assert.equal(call('quoteLabel',123456),'COT-123456');
});
test('Validez: fecha + días (cambio de mes, de año y bisiesto), formato dd/mm/aaaa y estado',()=>{
  assert.equal(call('addDays','2026-10-14',7),'2026-10-21');assert.equal(call('addDays','2026-12-28',7),'2027-01-04');assert.equal(call('addDays','2028-02-25',7),'2028-03-03');assert.equal(call('addDays','2026-10-14',30),'2026-11-13');
  assert.equal(call('formatDate','2026-10-21'),'21/10/2026');assert.equal(call('daysBetween','2026-10-14','2026-10-21'),7);
  const s=(until,now)=>plain(call('quoteStatus',until,now));
  assert.deepEqual(s('2026-10-13','2026-10-14'),{key:'expired',text:'Vencida'});
  assert.deepEqual(s('2026-10-14','2026-10-14'),{key:'expiring',text:'Vence hoy'});
  assert.deepEqual(s('2026-10-15','2026-10-14'),{key:'expiring',text:'Vence mañana'});
  assert.deepEqual(s('2026-10-16','2026-10-14'),{key:'expiring',text:'Vence en 2 días'});
  assert.deepEqual(s('2026-10-17','2026-10-14'),{key:'pending',text:'Pendiente'});
  assert.deepEqual(plain(call('quoteStatus','2026-10-01','2026-10-14',true,'B001-123')),{key:'converted',text:'Convertida · B001-123'});
  // Una cotización guardada conserva su fecha; la validez se recalcula y solo admite 3, 7, 15 o 30 días.
  const q=plain(call('normalizeQuote',quote({validDays:15,validUntil:'2099-01-01'})));assert.equal(q.date,'2026-10-14');assert.equal(q.validUntil,'2026-10-29');
  assert.equal(plain(call('normalizeQuote',quote({validDays:10}))).validDays,7);
  const copy=plain(call('duplicateQuote',quote({validDays:15})));assert.equal(copy.date,run('today()'));assert.equal(copy.validDays,15);assert.equal(copy.validUntil,call('addDays',copy.date,15));
});
test('Importe en letras',()=>{
  assert.equal(call('amountInWords',330000),'TRES MIL TRESCIENTOS SOLES');assert.equal(call('amountInWords',100),'UN SOL');
  assert.equal(call('amountInWords',2100000),'VEINTIÚN MIL SOLES');assert.equal(call('amountInWords',448050),'CUATRO MIL CUATROCIENTOS OCHENTA SOLES CON CINCUENTA CÉNTIMOS');
  assert.equal(call('amountInWords',100000000),'UN MILLÓN DE SOLES');assert.equal(call('amountInWords',0),'CERO SOLES');
});
test('Validación: lo obligatorio y lo opcional de una cotización',()=>{
  assert.deepEqual(errorIds(quote()),[]);
  assert.deepEqual(errorIds(run('emptyQuote()')).sort(),['customer','description-0','price-0']);
  // Documento, teléfono y correo son opcionales, pero si se escriben deben ser válidos.
  assert.deepEqual(errorIds(quote({docType:'DNI',document:'',phone:'',email:''})),[]);
  assert.deepEqual(errorIds(quote({docType:'DNI',document:'1234567'})),['document']);assert.deepEqual(errorIds(quote({docType:'DNI',document:'12345678'})),[]);
  assert.deepEqual(errorIds(quote({docType:'RUC',document:'2012345678'})),['document']);assert.deepEqual(errorIds(quote({docType:'CE',document:'X-123'})),[]);
  assert.deepEqual(errorIds(quote({phone:'12345'})),['phone']);assert.deepEqual(errorIds(quote({phone:'98a654321'})),['phone']);assert.deepEqual(errorIds(quote({phone:'+51 (1) 456-7890'})),[]);
  assert.deepEqual(errorIds(quote({email:'cliente@'})),['email']);
  const item=over=>quote({items:[{...quote().items[0],...over}]});
  assert.deepEqual(errorIds(item({quantity:'0'})),['quantity-0']);assert.deepEqual(errorIds(item({quantity:'10000'})),['quantity-0']);
  assert.deepEqual(errorIds(item({price:'1,650.00'})),['price-0']);assert.deepEqual(errorIds(item({price:'1650,5'})),[]);
  assert.deepEqual(errorIds(item({unit:' '})),['unit-0']);assert.deepEqual(errorIds(item({description:''})),['description-0']);
  // Una línea escrita a mano (sin productos de tu stock) es válida en una cotización.
  assert.deepEqual(errorIds(item({parts:[],description:'Armado y configuración',quantity:'1',price:'80'})),[]);
  assert.deepEqual(errorIds(item({mode:'bundle',quantity:'2'})),['quantity-0']);
  assert.deepEqual(errorIds(item({quantity:'9999',price:'999999999.99'})),['total']);
  assert.deepEqual(errorIds(quote({notes:Array.from({length:13},(_,i)=>'Condición '+(i+1)).join('\n')})),['notes']);
  assert.deepEqual(errorIds(quote({notes:Array.from({length:12},(_,i)=>'Condición '+(i+1)).join('\n')})),[]);
  assert.deepEqual(errorIds(quote({customer:'Cliente 😀'})),['customer']);assert.deepEqual(errorIds(item({description:'Ryzen 7 · 8 núcleos, año 2024 «nuevo»'})),[]);
});
test('Reglas de la línea: productos iguales → unidades; distintos → una computadora; las partes siguen a cantidad y precio',()=>{
  const ryzen={source:'product',productId:'101',name:'Ryzen 7 7800X3D',price:'1650'};
  let item=plain(call('applyPick',run('newItem()'),[ryzen,ryzen]));
  assert.equal(item.mode,'units');assert.equal(item.quantity,'2');assert.equal(item.price,'1650.00');assert.equal(item.description,'Ryzen 7 7800X3D');assert.equal(item.parts.length,2);
  item=plain(call('syncParts',{...item,quantity:'3',price:'1600'}));assert.equal(item.parts.length,3);assert.ok(item.parts.every(p=>p.price==='1600.00'&&p.productId==='101'));
  item=plain(call('syncParts',{...item,quantity:'1'}));assert.equal(item.parts.length,1);
  const pc=plain(call('applyPick',{...run('newItem()'),description:''},[{source:'product',productId:'102',name:'RAM 32 GB',price:'420'},{source:'external',name:'Placa B650M',price:'690.00'},{source:'loose',key:'cooler',name:'Cooler 212',price:'150'}]));
  assert.equal(pc.mode,'bundle');assert.equal(pc.quantity,'1');assert.equal(pc.price,'1260.00');assert.equal(pc.description,'Computadora completa: RAM 32 GB, Placa B650M, Cooler 212');
  const repriced=plain(call('syncParts',{...pc,price:'1200'}));assert.equal(repriced.parts.reduce((n,p)=>n+Math.round(Number(p.price)*100),0),120000);
  // Una descripción escrita a mano no se reemplaza al volver a elegir.
  assert.equal(plain(call('applyPick',{...run('newItem()'),description:'Procesador para gaming'},[ryzen])).description,'Procesador para gaming');
  // Partes inválidas (sin nombre, precio o referencia) se descartan; nunca se guardan ids de unidades.
  const clean=plain(call('normalizeQuote',quote({items:[{...quote().items[0],parts:[ryzen,{source:'stock',id:5,name:'Unidad',price:'10'},{source:'product',name:'Sin id',price:'10'},{source:'external',name:'',price:'5'},{source:'external',name:'Fuente 750W',price:'abc'}]}]})));
  assert.deepEqual(clean.items[0].parts,[{source:'product',name:'Ryzen 7 7800X3D',price:'1650.00',productId:'101'}]);
  assert.equal(plain(call('normalizeQuote',quote({docType:'NONE',document:'123'}))).document,'');
});
test('PDF de la cotización: plantilla, fuentes, 1 página y varias páginas',async()=>{
  context.testQuote=quote({items:[...quote().items,{description:'Computadora completa: Kingston Fury 32 GB DDR5, Placa ASUS B650M, Cooler Master Hyper 212',code:'PC-01',unit:'NIU',quantity:'1',price:'1260.00',mode:'bundle',parts:[]},{description:'Armado y configuración',code:'',unit:'NIU',quantity:'1',price:'80',mode:'units',parts:[]}]});
  const bytes=await run("generatePDF(testQuote,'COT-00012')");
  const pdf=await PDFLib.PDFDocument.load(bytes,{updateMetadata:false});assert.equal(pdf.getPageCount(),1);assert.equal(pdf.getTitle(),'Cotización COT-00012 · AO Nexus');assert.ok(bytes.length>10000);
  fs.mkdirSync(path.join(ROOT,'.qa'),{recursive:true});fs.writeFileSync(path.join(ROOT,'.qa/quote-test.pdf'),bytes);
  const scene=plain(run("buildScenes(testQuote,'COT-00012')"))[0].filter(o=>o.type==='text').map(o=>o.value);
  for(const text of ['COTIZACIÓN','COT-00012','CLIENTE:','DIRECCIÓN:','TELÉFONO:','MONEDA:','RUC:','FECHA:','VÁLIDA HASTA:','21/10/2026','CONDICIONES:','IMPORTE TOTAL','S/ 4,640.00','CUATRO MIL SEISCIENTOS CUARENTA SOLES','Documento informativo: no es un comprobante de pago.','Gracias por tu preferencia.'])assert.ok(scene.includes(text),text);
  assert.ok(scene.some(t=>t.startsWith('Cotización válida hasta el 21/10/2026.')));
  // Sin dirección ni teléfono esas líneas se omiten; sin guardar, el recuadro dice BORRADOR.
  const bare=plain(run("buildScenes({...testQuote,address:'',phone:'',docType:'NONE',document:''})"))[0].filter(o=>o.type==='text').map(o=>o.value);
  assert.ok(bare.includes('BORRADOR')&&!bare.includes('DIRECCIÓN:')&&!bare.includes('TELÉFONO:')&&!bare.includes('RUC:'));
  context.testQuote=quote({items:Array.from({length:15},(_,i)=>({description:'COMPONENTE '+(i+1)+' · descripción del producto',code:'',unit:'NIU',quantity:'1',price:'100.00',mode:'units',parts:[]}))});
  const multiple=await PDFLib.PDFDocument.load(await run("generatePDF(testQuote,'COT-00013')"));assert.ok(multiple.getPageCount()>1);
  const pages=plain(run("buildScenes(testQuote,'COT-00013')"));assert.equal(pages.length,multiple.getPageCount());
  const texts=pages.map(p=>p.filter(o=>o.type==='text').map(o=>o.value));
  assert.ok(texts[0].includes('SUBTOTAL PÁGINA')&&texts.at(-1).includes('IMPORTE TOTAL')&&texts.at(-1).includes('S/ 1,500.00'));
  assert.ok(texts.at(-1).includes(`Página ${pages.length} de ${pages.length}`));
});
test('Nombre del archivo PDF sin tildes ni símbolos',()=>{
  assert.equal(call('pdfFilename',quote({customer:'José Muñoz & Cía. S.A.C.'}),'COT-00012'),'Cotizacion-COT-00012-Jose-Munoz-Cia-SAC.pdf');
  assert.equal(call('pdfFilename',quote({customer:''}),'COT-00001'),'Cotizacion-COT-00001-cliente.pdf');
});
