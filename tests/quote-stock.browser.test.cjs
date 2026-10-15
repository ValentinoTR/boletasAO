// Prueba de navegador de las cotizaciones en el stock: el buscador en modo cotización (no escribe en la base),
// la conversión en boleta (prepareQuoteSale elige unidades reales) y el borrador de boleta (loadQuoteSale).
// Usa la app real de dist/ con un cliente de Supabase simulado en memoria. Se omite si Playwright no está instalado.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{execSync}=require('node:child_process');
function loadPlaywright(){
  try{return require('playwright');}catch{}
  try{return require(path.join(execSync('npm root -g',{encoding:'utf8'}).trim(),'playwright'));}catch{return null;}
}
const playwright=loadPlaywright();
const ROOT=path.join(__dirname,'..','dist');
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.svg':'image/svg+xml'};
let server,browser,base;
test.before(async()=>{
  if(!playwright)return;
  server=http.createServer((req,res)=>{const file=path.join(ROOT,decodeURIComponent(req.url.split('?')[0]));fs.readFile(file,(error,body)=>{if(error){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':TYPES[path.extname(file)]||'application/octet-stream'});res.end(body);});});
  await new Promise(resolve=>server.listen(0,resolve));base=`http://localhost:${server.address().port}`;
  const executablePath=process.env.PLAYWRIGHT_CHROMIUM||(fs.existsSync('/opt/pw-browsers/chromium')?'/opt/pw-browsers/chromium':undefined);
  browser=await playwright.chromium.launch(executablePath?{executablePath}:{});
});
test.after(async()=>{await browser?.close();server?.close();});
const product=(id,name,reference,managed=false,price=500,brand='')=>({id,data:{name,brand,category:'amd',image:''},web_price:price,published:true,managed,reference_stock:reference});
const unit=(id,compra,name,productId=null,extra={})=>({id,compra_id:compra,product_id:productId,nombre:name,costo:null,precio_venta:null,in_stock:true,...extra});
const purchase=(id,name,extra={})=>({id,nombre:name,costo:0,moneda:'PEN',tipo_cambio:0,...extra});
// Base de datos en memoria con el comportamiento de las funciones de stock que usa la app (igual que picker.browser.test.cjs).
async function open({products,purchases=[],units=[],clients=[],latency=0}){
  const page=await (await browser.newContext({viewport:{width:1100,height:1000},acceptDownloads:true})).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*supabase.co/**',r=>r.abort());
  await page.route('**/accounting.html',r=>r.fulfill({status:200,contentType:'text/html',body:'<html></html>'}));
  await page.goto(base+'/index.html');
  await page.evaluate(({products,purchases,units,clients,latency})=>{
    const db=window.__db={ao_products:products,COMPRAS:purchases,COMPONENTES:units,ao_clients:clients,ao_sales:[],ao_receipts:[],ao_suite_state:[]};
    window.__rpc=[];let next=1000;const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const free=id=>db.COMPONENTES.filter(c=>c.product_id===id&&c.precio_venta===null&&c.in_stock!==false).length;
    const handlers={
      ao_suite_set_stock(a){const p=db.ao_products.find(p=>p.id===a.product_key);if(free(p.id)!==a.expected_quantity)throw Error('El stock cambió mientras editabas.');
        const delta=a.target_quantity-free(p.id);if(delta>0){const cid=next++;db.COMPRAS.push({id:cid,nombre:p.data.name,costo:delta*a.cost_per_unit,proveedor:a.supplier,moneda:'PEN',tipo_cambio:0});for(let i=0;i<delta;i++)db.COMPONENTES.push({id:next++,compra_id:cid,product_id:p.id,nombre:p.data.name,costo:null,precio_venta:null,in_stock:true});}
        p.managed=true;p.reference_stock=0;return {quantity:a.target_quantity};},
      ao_suite_link_stock(a){for(const id of a.unit_keys)db.COMPONENTES.find(c=>c.id===id).product_id=a.product_key;if(free(a.product_key)!==a.expected_stock)throw Error('El stock cambió durante la vinculación.');db.ao_products.find(p=>p.id===a.product_key).managed=true;return a.expected_stock;}};
    const client={from:t=>({select:()=>({order:()=>({range:async start=>({data:start===0?structuredClone(db[t]||[]):[],error:null})})})}),
      rpc:async(name,args)=>{
        if(name==='ao_catalog_snapshot'&&window.__snapshotFail)return {data:null,error:{message:'No se pudo consultar la web'}};
        if(name==='ao_catalog_snapshot')return {data:{productos:db.ao_products.filter(p=>p.published).map(p=>({...p.data,id:p.id,price:p.web_price,stock:p.managed?free(p.id):Number(p.reference_stock||0)}))},error:null};
        window.__rpc.push({name,args});await wait(latency);try{return {data:handlers[name](args),error:null};}catch(e){return {data:null,error:{message:e.message}};}}};
    document.getElementById('loginView').hidden=true;document.getElementById('appView').hidden=false;
    window.__ready=window.AOSuite.initialize(client,{role:'owner'});
  },{products,purchases,units,clients,latency});
  await page.evaluate(()=>window.__ready);
  const pick=async(inventory=[],blocked=[])=>{await page.evaluate(({inventory,blocked})=>{document.getElementById('receiptFrame').contentWindow.getInventoryIdsExcept=()=>blocked;window.__pick=window.AOSuite.pickInventory({inventory},0);},{inventory,blocked});await page.locator('#inventoryDialog[open]').waitFor();};
  // Modo cotización: la selección inicial son las referencias de la línea (item.parts).
  const quote=async(parts=[])=>{await page.evaluate(parts=>{document.getElementById('receiptFrame').contentWindow.getInventoryIdsExcept=()=>{throw Error('La cotización no debe leer las líneas de la boleta');};window.__pick=window.AOSuite.pickInventory({parts},0,{mode:'quote'});},parts);await page.locator('#inventoryDialog[open]').waitFor();};
  const search=async text=>{await page.fill('#inventorySearch',text);await page.waitForTimeout(250);};
  const added=n=>page.waitForFunction(n=>document.querySelectorAll('#inventorySelected .selected-part').length===n,n);
  return {page,errors,pick,quote,search,added,message:()=>page.textContent('#inventoryMessage'),
    rows:()=>page.$$eval('#inventoryUnits .catalogue-row',rows=>rows.map(r=>r.querySelector('strong').textContent+' | '+r.querySelector('small').textContent)),
    origins:()=>page.$$eval('#inventorySelected .selected-part small',e=>e.map(x=>x.textContent)),
    parts:()=>page.evaluate(()=>Promise.race([window.__pick,new Promise((_,reject)=>setTimeout(()=>reject(new Error('El buscador no se cerró al confirmar')),5000))])),
    prepare:items=>page.evaluate(items=>window.AOSuite.prepareQuoteSale(items),items),
    rpc:()=>page.evaluate(()=>window.__rpc.map(c=>c.name+':'+c.args.product_key+':'+(c.args.target_quantity??c.args.expected_stock)))};
}
const skip=!playwright&&'Playwright no está instalado';
const ref=(id,name,price)=>({source:'product',productId:String(id),name,price});
// Línea de cotización como la guarda el editor: unidades iguales → cantidad = número de referencias.
const line=(parts,extra={})=>({description:parts[0]?.name||'Armado y configuración',code:'',unit:'NIU',quantity:String(parts.length||1),price:parts[0]?.price||'100.00',parts,mode:'units',...extra});
const cents=price=>Math.round(Number(price)*100);
const TEXT_IDS=['inventoryEyebrow','inventoryTitle','inventoryHint','externalSummary','externalHint','externalPriceLabel','inventorySelectedTitle','addExternal','inventoryConfirm'];
const QUOTE_TEXTS={inventoryEyebrow:'PRODUCTOS DE LA COTIZACIÓN',inventoryTitle:'Productos que cotizas',inventoryHint:'Elige de tu stock lo que cotizas. La cotización no aparta ni descuenta stock: tu stock baja recién al emitir la boleta.',externalSummary:'¿No está en tu stock? Cotizar un producto a pedido',externalHint:'Solo necesitas el nombre y el precio. No cambia tu stock.',externalPriceLabel:'Precio cotizado (S/)',inventorySelectedTitle:'Productos de esta cotización',addExternal:'Agregar a esta cotización',inventoryConfirm:'Usar en la cotización'};
const texts=page=>page.evaluate(ids=>Object.fromEntries(ids.map(id=>[id,document.getElementById(id)?.textContent.trim()??null])),TEXT_IDS);

test('Cotización: «Agregar» solo anota referencias, no escribe en la base y los textos vuelven a los de la boleta',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650),product(2,'RYZEN 5 5500',1,false,340),product(3,'RYZEN 9 9950X3D',0,false,2600)],
    purchases:[purchase(7,'RYZEN 7 7800X3D'),purchase(8,'Cable HDMI')],units:[unit(70,7,'RYZEN 7 7800X3D',1),unit(71,7,'RYZEN 7 7800X3D',1),unit(80,8,'Cable HDMI',null,{precio_sugerido:30})]});
  const boleta=await texts(s.page);
  assert.equal(boleta.inventoryConfirm,'Usar estos productos en la boleta');assert.equal(boleta.addExternal,'Agregar a esta venta');assert.equal(boleta.externalPriceLabel,'Precio de venta (S/)');
  await s.quote();
  assert.deepEqual(await texts(s.page),QUOTE_TEXTS,'textos de la cotización (eyebrow, título, ayuda, apartado a pedido y botones)');
  assert.deepEqual(await s.rows(),['Cable HDMI | 1 en stock','RYZEN 5 5500 | 1 en stock','RYZEN 7 7800X3D | 2 en stock']);
  await s.page.click('[data-sell-product="1"]');await s.added(1);
  assert.match(await s.message(),/«RYZEN 7 7800X3D» agregado a la cotización · tienes 2 en stock/);
  await s.page.click('[data-sell-product="1"]');await s.page.click('[data-sell-product="1"]');await s.added(3);
  assert.match(await s.message(),/Cotizas 3 y tienes 2 en stock: al convertirla en boleta te avisaremos/);
  assert.equal(await s.page.$eval('#inventoryMessage',e=>e.classList.contains('success')),false,'cotizar más de lo que tienes se muestra como aviso');
  assert.ok((await s.rows()).includes('RYZEN 7 7800X3D | 2 en stock · 3 en esta cotización'),'el stock real sigue a la vista: cotizar no aparta unidades');
  await s.page.click('[data-sell-product="2"]');await s.added(4);
  await s.page.click('[data-sell-loose]');await s.added(5);
  await s.search('9950');
  assert.equal(await s.page.textContent('#inventoryCatalogue [data-sell-product="3"]'),'Cotizarlo igual');
  await s.page.click('#inventoryCatalogue [data-sell-product="3"]');await s.added(6);
  await s.page.click('#externalBox summary');await s.page.fill('#externalName','Armado premium');await s.page.fill('#externalPrice','150,5');await s.page.click('#addExternal');await s.added(7);
  const origins=await s.origins();
  assert.deepEqual(origins,['De tu stock','De tu stock','De tu stock','De tu stock','De tu stock','Producto de tu web sin stock','No está en tu stock (a pedido)']);
  await s.page.fill('[data-part-price="0"]','1600');
  await s.page.click('#inventoryConfirm');
  assert.deepEqual(await s.parts(),[
    ref(1,'RYZEN 7 7800X3D','1600.00'),ref(1,'RYZEN 7 7800X3D','1650.00'),ref(1,'RYZEN 7 7800X3D','1650.00'),ref(2,'RYZEN 5 5500','340.00'),
    // «Cotizarlo igual» guarda cuál producto de tu web es, para tomarlo de tu stock si lo repones antes de convertirla.
    {source:'loose',key:'cable hdmi',name:'Cable HDMI',price:'30.00'},{source:'external',productId:'3',name:'RYZEN 9 9950X3D',price:'2600.00'},{source:'external',name:'Armado premium',price:'150.50'}]);
  assert.deepEqual(await s.page.evaluate(()=>window.__rpc),[],'cotizar no registra ni vincula stock');
  const db=await s.page.evaluate(()=>window.__db);
  assert.equal(db.ao_products[1].managed,false);assert.equal(db.ao_products[1].reference_stock,1);assert.equal(db.COMPONENTES.length,3);
  // La siguiente boleta vuelve a sus textos y no hereda nada de la cotización.
  await s.pick();
  assert.deepEqual(await texts(s.page),boleta);
  assert.deepEqual(await s.rows(),['Cable HDMI | 1 en stock','RYZEN 5 5500 | 1 en stock','RYZEN 7 7800X3D | 2 en stock']);
  assert.equal(await s.page.$$eval('#inventorySelected .selected-part',e=>e.length),0);
  await s.search('9950');assert.equal(await s.page.textContent('#inventoryCatalogue [data-sell-product="3"]'),'Venderlo igual');
  await s.page.click('#inventoryDialog [data-close="inventoryDialog"]');
  assert.equal(await s.parts(),null);
  assert.deepEqual(s.errors,[]);
});

test('Cotización: parte de las referencias de la línea, pide el precio que falta y cancelar devuelve null',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650)],purchases:[purchase(7,'x'),purchase(8,'Mouse gamer')],units:[unit(70,7,'RYZEN 7 7800X3D',1),unit(80,8,'Mouse gamer')]});
  await s.quote([ref(1,'RYZEN 7 7800X3D','1500.00')]);
  assert.equal(await s.page.inputValue('[data-part-price="0"]'),'1500.00');
  assert.ok((await s.rows()).includes('RYZEN 7 7800X3D | 1 en stock · 1 en esta cotización'));
  await s.page.click('[data-sell-loose]');await s.added(2);
  assert.match(await s.message(),/Escribe su precio en «Precio \(S\/\)»/);
  await s.page.click('#inventoryConfirm');
  assert.match(await s.message(),/«Mouse gamer» no tiene precio/);assert.equal(await s.page.$eval('#inventoryDialog',d=>d.open),true);
  await s.page.fill('[data-part-price="1"]','45');await s.page.click('#inventoryConfirm');
  assert.deepEqual((await s.parts()).map(p=>p.source+':'+p.price),['product:1500.00','loose:45.00']);
  await s.quote();await s.page.click('#inventoryConfirm');
  assert.match(await s.message(),/Elige al menos un producto/);
  await s.page.keyboard.press('Escape');
  assert.equal(await s.parts(),null,'cerrar sin confirmar no cambia la línea');
  assert.deepEqual(await s.page.evaluate(()=>window.__rpc),[]);
  assert.deepEqual(s.errors,[]);
});

test('Convertir: 2 unidades cotizadas de un producto con 2 libres toman 2 unidades distintas y el stock pasa de 2 a 0',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650)],purchases:[purchase(7,'x')],units:[unit(69,7,'RYZEN 7 7800X3D',1,{precio_venta:1650}),unit(70,7,'RYZEN 7 7800X3D',1,{serial:'SN-70'}),unit(71,7,'RYZEN 7 7800X3D',1)]});
  const r=await s.prepare([line([ref(1,'RYZEN 7 7800X3D','1650.00'),ref(1,'RYZEN 7 7800X3D','1650.00')],{description:'Procesador AMD Ryzen 7 7800X3D',code:'CPU-01'})]);
  assert.equal(r.ready,true);assert.deepEqual(r.notices,[]);
  assert.deepEqual(r.changes,[{name:'RYZEN 7 7800X3D',before:2,after:0}]);
  const [item]=r.items;
  assert.deepEqual({...item,inventory:undefined},{description:'Procesador AMD Ryzen 7 7800X3D',serial:'',code:'CPU-01',unit:'NIU',quantity:'2',price:'1650.00',inventory:undefined,inventoryMode:'units'});
  assert.deepEqual(item.inventory.map(p=>p.id).sort(),[70,71],'dos unidades distintas y disponibles (la 69 ya se vendió)');
  assert.deepEqual(item.inventory.map(p=>p.source+':'+p.name+':'+p.price),['stock:RYZEN 7 7800X3D:1650.00','stock:RYZEN 7 7800X3D:1650.00']);
  assert.equal(item.inventory.find(p=>p.id===70).serial,'SN-70');
  assert.deepEqual(await s.page.evaluate(()=>window.__rpc),[],'un producto con stock compartido no necesita registrar nada');
  assert.deepEqual(s.errors,[]);
});

test('Convertir: si solo queda 1 de las 2 cotizadas avisa «missing» y conserva cantidad y precio',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650)],purchases:[purchase(7,'x')],units:[unit(70,7,'RYZEN 7 7800X3D',1,{precio_venta:1650}),unit(71,7,'RYZEN 7 7800X3D',1)]});
  const r=await s.prepare([line([ref(1,'RYZEN 7 7800X3D','1650.00'),ref(1,'RYZEN 7 7800X3D','1650.00')])]);
  assert.equal(r.ready,false);
  assert.equal(r.notices.length,1);
  const [n]=r.notices;
  assert.deepEqual({kind:n.kind,line:n.line,name:n.name,quoted:n.quoted,linked:n.linked},{kind:'missing',line:1,name:'RYZEN 7 7800X3D',quoted:2,linked:1});
  // El aviso describe lo que de verdad se puede hacer en la boleta (no hay un «Venderlo igual» para lo que sí tienes).
  assert.equal(n.text,'RYZEN 7 7800X3D: cotizaste 2 y tienes 1 en stock. En la boleta, producto 1: baja la cantidad a 1 o agrega la que falta en «¿No está en tu stock?» (se venden sin descontar stock).');
  assert.equal(r.items[0].quantity,'2');assert.equal(r.items[0].price,'1650.00');assert.deepEqual(r.items[0].inventory.map(p=>p.id),[71]);
  assert.deepEqual(r.changes,[{name:'RYZEN 7 7800X3D',before:1,after:0}]);
});

test('Convertir: un producto del catálogo anterior se registra en el stock (como «Agregar» en la boleta) y se vinculan sus unidades',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 5 5500',2,false,340),product(2,'RYZEN 7 5700X',1,false,600)],purchases:[purchase(7,'importado',{costo:250})],units:[unit(70,7,'Ryzen 5  5500')]});
  const r=await s.prepare([line([ref(1,'RYZEN 5 5500','340.00'),ref(1,'RYZEN 5 5500','340.00')]),line([ref(2,'RYZEN 7 5700X','600.00')])]);
  assert.deepEqual(await s.rpc(),['ao_suite_link_stock:1:1','ao_suite_set_stock:1:2','ao_suite_set_stock:2:1'],'vincula lo de Compras y completa la cantidad de la web');
  assert.equal(r.ready,true);
  const ids=r.items.flatMap(i=>i.inventory.map(p=>p.id));
  assert.equal(new Set(ids).size,3);assert.ok(ids.includes(70),'usa la unidad importada (conserva su costo)');
  const db=await s.page.evaluate(()=>window.__db);
  const owner=id=>db.COMPONENTES.find(c=>c.id===id).product_id;
  assert.deepEqual(r.items.map(i=>i.inventory.map(p=>owner(p.id))),[[1,1],[2]],'cada línea usa unidades de su producto');
  assert.ok(db.ao_products.every(p=>p.managed),'quedan con descuento automático');
  assert.deepEqual(r.changes,[{name:'RYZEN 5 5500',before:2,after:0},{name:'RYZEN 7 5700X',before:1,after:0}]);
  // Volver a revisar no registra de nuevo.
  await s.page.evaluate(()=>{window.__rpc=[];});
  const again=await s.prepare([line([ref(1,'RYZEN 5 5500','340.00')])]);
  assert.equal(again.ready,true);assert.deepEqual(await s.page.evaluate(()=>window.__rpc),[]);
});

test('Convertir: lo de Compras sin ficha usa sus unidades libres, sin tomar las vendidas sin stock ni las de otro producto',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 9800X3D',0,true,1800)],
    purchases:[purchase(8,'Cable HDMI'),purchase(9,'Cable HDMI',{proveedor:'Venta sin stock'})],
    units:[unit(80,8,'Cable HDMI',null,{precio_sugerido:30}),unit(81,8,'cable  hdmi'),unit(82,8,'Cable HDMI',null,{precio_venta:30}),unit(90,9,'Cable HDMI',null,{costo:0}),unit(91,8,'Cable HDMI',1)]});
  await s.quote();
  await s.page.click('[data-sell-loose]');await s.page.click('[data-sell-loose]');await s.page.click('[data-sell-loose]');await s.added(3);
  assert.match(await s.message(),/Cotizas 3 y tienes 2 en stock/);
  await s.page.click('#inventoryConfirm');
  const parts=await s.parts();
  assert.deepEqual(parts[0],{source:'loose',key:'cable hdmi',name:'Cable HDMI',price:'30.00'});
  const r=await s.prepare([line(parts)]);
  assert.deepEqual(r.items[0].inventory.map(p=>p.id).sort(),[80,81]);
  assert.deepEqual(r.notices.map(n=>n.kind+':'+n.quoted+':'+n.linked),['missing:3:2']);
  assert.deepEqual(r.changes,[{name:'Cable HDMI',before:2,after:0}]);
  assert.deepEqual(await s.page.evaluate(()=>window.__rpc),[]);
});

test('Convertir: lo cotizado a pedido se vende sin stock; lo escrito a mano que no se parece a nada (un servicio) también, y lo que se parece se elige en la boleta',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650),product(2,'Monitor LG UltraGear 27GR75Q',0,true,1200)],purchases:[purchase(7,'x')],units:[unit(70,7,'RYZEN 7 7800X3D',1)]});
  const r=await s.prepare([line([{source:'external',name:'Monitor 27 pulgadas',price:'1200.00'}]),
    line([],{description:'Armado y configuración',quantity:'2',price:'80.00'}),
    line([],{description:'Procesador AMD Ryzen 7 7800X3D',price:'1650.00'}),
    line([],{description:'Monitor LG UltraGear',price:'1200.00'})]);
  assert.deepEqual(r.items[0].inventory,[{source:'external',name:'Monitor 27 pulgadas',supplier:'Venta sin stock',cost:'0.00',price:'1200.00'}]);
  assert.equal(r.items[0].inventoryMode,'units');assert.equal(r.items[0].quantity,'1');
  // Servicio: una unidad «Venta sin stock» por cantidad, como «Venderlo igual», y la suma coincide con el importe.
  assert.deepEqual(r.items[1].inventory,Array.from({length:2},()=>({source:'external',name:'Armado y configuración',supplier:'Venta sin stock',cost:'0.00',price:'80.00'})));
  assert.deepEqual([r.items[1].quantity,r.items[1].price,r.items[1].inventoryMode],['2','80.00','units']);
  // Lo que se parece a un producto (con stock o de tu web) no se vende sin stock: se elige en la boleta.
  assert.deepEqual(r.items[2].inventory,[]);assert.deepEqual(r.items[3].inventory,[]);
  assert.deepEqual(r.notices,[
    {kind:'service',line:2,name:'Armado y configuración',quoted:2,linked:0,text:'Producto 2 («Armado y configuración») se venderá sin stock: no cambia tu stock.'},
    {kind:'manual',line:3,name:'Procesador AMD Ryzen 7 7800X3D',quoted:1,linked:0,text:'Producto 3 («Procesador AMD Ryzen 7 7800X3D») se escribió a mano y se parece a «RYZEN 7 7800X3D»: en la boleta pulsa «Seleccionar productos para esta venta» y elígelo. Si es otro producto, agrégalo ahí en «¿No está en tu stock?».'},
    {kind:'manual',line:4,name:'Monitor LG UltraGear',quoted:1,linked:0,text:'Producto 4 («Monitor LG UltraGear») se escribió a mano y se parece a «Monitor LG UltraGear 27GR75Q»: en la boleta pulsa «Seleccionar productos para esta venta» y elígelo. Si es otro producto, agrégalo ahí en «¿No está en tu stock?».'}]);
  assert.equal(r.ready,false,'lo que se parece a tu stock se completa antes de emitir');
  assert.deepEqual(r.changes,[]);
  assert.deepEqual(await s.page.evaluate(()=>window.__rpc),[]);
});

test('Convertir: una cotización solo con servicios queda lista; el aviso «service» es informativo',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650)],purchases:[purchase(7,'x')],units:[unit(70,7,'RYZEN 7 7800X3D',1)]});
  const r=await s.prepare([line([],{description:'Instalación de Windows y drivers',price:'60.00'}),line([ref(1,'RYZEN 7 7800X3D','1650.00')])]);
  assert.equal(r.ready,true);assert.deepEqual(r.notices.map(n=>n.kind+':'+n.line),['service:1']);
  assert.deepEqual(r.items[0].inventory.map(p=>p.source+':'+p.supplier+':'+p.price),['external:Venta sin stock:60.00']);
  assert.deepEqual(r.changes,[{name:'RYZEN 7 7800X3D',before:1,after:0}]);
  // Si se parece a algo que tienes en Compras (sin ficha en tu web), tampoco se vende sin stock.
  await s.page.evaluate(()=>{window.__db.COMPRAS.push({id:8,nombre:'Cable HDMI 2m',costo:0,moneda:'PEN',tipo_cambio:0});window.__db.COMPONENTES.push({id:80,compra_id:8,product_id:null,nombre:'Cable HDMI 2m',costo:null,precio_venta:null,in_stock:true});});
  const loose=await s.prepare([line([],{description:'Cable HDMI',price:'30.00'})]);
  assert.deepEqual(loose.notices.map(n=>n.kind),['manual']);assert.match(loose.notices[0].text,/se parece a «Cable HDMI 2m»/);assert.equal(loose.ready,false);
});

test('Convertir: una computadora (productos distintos) queda en una línea «bundle» cuyos precios suman el total',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650),product(2,'SSD 1TB',0,true,300)],purchases:[purchase(7,'x')],units:[unit(70,7,'RYZEN 7 7800X3D',1),unit(71,7,'SSD 1TB',2)]});
  const parts=[ref(1,'RYZEN 7 7800X3D','1650.00'),ref(2,'SSD 1TB','300.00'),{source:'external',name:'Case ATX',price:'150.00'}];
  // El dueño bajó el precio de la computadora en la cotización: 2100.00 → 1999.90.
  const r=await s.prepare([{description:'Computadora completa: RYZEN 7 7800X3D, SSD 1TB, Case ATX',code:'',unit:'NIU',quantity:'1',price:'1999.90',parts,mode:'bundle'}]);
  const [item]=r.items;
  assert.equal(r.ready,true);assert.equal(item.inventoryMode,'bundle');assert.equal(item.quantity,'1');assert.equal(item.price,'1999.90');
  assert.deepEqual(item.inventory.map(p=>p.source+':'+(p.id??p.name)),['stock:70','stock:71','external:Case ATX']);
  assert.equal(item.inventory.reduce((n,p)=>n+cents(p.price),0),199990,'la suma de los componentes coincide con el importe de la línea');
  assert.deepEqual(r.changes,[{name:'RYZEN 7 7800X3D',before:1,after:0},{name:'SSD 1TB',before:1,after:0}]);
});

test('Convertir: la misma unidad nunca se usa dos veces en la venta',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650),product(2,'SSD 1TB',0,true,300)],purchases:[purchase(7,'x')],
    units:[unit(70,7,'RYZEN 7 7800X3D',1),unit(71,7,'RYZEN 7 7800X3D',1),unit(72,7,'SSD 1TB',2)]});
  const cpu=ref(1,'RYZEN 7 7800X3D','1650.00');
  const r=await s.prepare([line([cpu]),{...line([cpu,ref(2,'SSD 1TB','300.00')]),mode:'bundle',quantity:'1',price:'1950.00'},line([cpu])]);
  const ids=r.items.flatMap(i=>i.inventory.filter(p=>p.source==='stock').map(p=>p.id));
  assert.equal(ids.length,new Set(ids).size,'sin unidades repetidas: '+ids.join(','));
  assert.deepEqual(ids,[70,71,72]);
  assert.deepEqual(r.notices.map(n=>n.kind+':'+n.line+':'+n.quoted+':'+n.linked),['missing:3:1:0'],'la tercera línea se queda sin unidad');
  assert.deepEqual(r.changes,[{name:'RYZEN 7 7800X3D',before:2,after:0},{name:'SSD 1TB',before:1,after:0}]);
});

test('Convertir no depende de una selección de boleta cancelada antes',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650)],purchases:[purchase(7,'x')],units:[unit(70,7,'RYZEN 7 7800X3D',1),unit(71,7,'RYZEN 7 7800X3D',1)]});
  // Boleta: la otra línea tiene la 71 y aquí se agrega la 70; luego se cancela.
  await s.pick([],[71]);await s.page.click('[data-sell-product="1"]');await s.added(1);
  await s.page.click('#inventoryDialog [data-close="inventoryDialog"]');assert.equal(await s.parts(),null);
  const r=await s.prepare([line([ref(1,'RYZEN 7 7800X3D','1650.00'),ref(1,'RYZEN 7 7800X3D','1650.00')])]);
  assert.equal(r.ready,true);assert.deepEqual(r.items[0].inventory.map(p=>p.id).sort(),[70,71]);
  assert.deepEqual(r.changes,[{name:'RYZEN 7 7800X3D',before:2,after:0}]);
});

test('Convertir se detiene con la selección abierta o sin el stock de la web verificado',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 5 5500',1,false,340)]});
  await s.pick();
  await assert.rejects(s.prepare([line([ref(1,'RYZEN 5 5500','340.00')])]),/Cierra la selección de productos/);
  await s.page.keyboard.press('Escape');assert.equal(await s.parts(),null);
  await s.page.evaluate(()=>{window.__snapshotFail=true;});
  await assert.rejects(s.prepare([line([ref(1,'RYZEN 5 5500','340.00')])]),/Actualiza el stock de tu web e inténtalo otra vez/);
  assert.deepEqual(await s.page.evaluate(()=>window.__rpc),[],'sin stock verificado no se registra nada');
  await s.page.evaluate(()=>{window.__snapshotFail=false;});
  const removed=await s.prepare([line([ref(9,'RYZEN 9 9900X','1700.00')])]);
  assert.deepEqual(removed.notices.map(n=>n.kind+':'+n.name),['removed:RYZEN 9 9900X']);assert.match(removed.notices[0].text,/ya no está en tu web/);assert.doesNotMatch(removed.notices[0].text,/Venderlo igual/,'no manda a un botón que no aparece');assert.equal(removed.ready,false);
});

test('quoteStock agrupa lo cotizado con su stock y clientsList entrega los clientes',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650),product(2,'RYZEN 5 5500',3,false,340)],purchases:[purchase(7,'x'),purchase(8,'Cable HDMI')],
    units:[unit(70,7,'RYZEN 7 7800X3D',1),unit(80,8,'Cable HDMI'),unit(81,8,'Cable HDMI')],
    clients:[{id:'c1',name:'Juan Pérez',doc_type:'DNI',document:'12345678',email:'juan@correo.pe',address:'Av. Lima 123'},{id:'c2',name:'Empresa SAC',doc_type:'RUC',document:'20123456789',email:null,address:null},{id:'c3',name:'Cliente mostrador',doc_type:'NONE',document:'',email:null,address:null},{id:'c4',name:'Cliente  mostrador',doc_type:'NONE',document:'',email:null,address:null}]});
  const groups=await s.page.evaluate(parts=>window.AOSuite.quoteStock(parts),[ref(1,'RYZEN 7 7800X3D','1650.00'),ref(1,'RYZEN 7 7800X3D','1650.00'),ref(2,'RYZEN 5 5500','340.00'),
    {source:'loose',key:'cable hdmi',name:'Cable HDMI',price:'30.00'},{source:'external',name:'Monitor',price:'900.00'},{source:'external',name:'monitor',price:'900.00'}]);
  assert.deepEqual(groups,[{name:'RYZEN 7 7800X3D',source:'product',quoted:2,inStock:1},{name:'RYZEN 5 5500',source:'product',quoted:1,inStock:3},
    {name:'Cable HDMI',source:'loose',quoted:1,inStock:2},{name:'Monitor',source:'external',quoted:2,inStock:null}]);
  assert.deepEqual(await s.page.evaluate(()=>window.AOSuite.clientsList()),[{name:'Cliente mostrador',docType:'NONE',document:'',email:'',address:''},{name:'Empresa SAC',docType:'RUC',document:'20123456789',email:'',address:''},{name:'Juan Pérez',docType:'DNI',document:'12345678',email:'juan@correo.pe',address:'Av. Lima 123'}],'ordenados por nombre y sin repetir');
  assert.deepEqual(await s.page.evaluate(()=>window.__rpc),[]);
});

// ---------- Boleta: window.loadQuoteSale y el flujo completo cotización → boleta → stock ----------
async function openEditor(s){
  await s.page.evaluate(()=>{
    window.__issued=[];window.__next=120;
    window.AOCloud={userId:'u1',api:async a=>a==='email-config'?{configured:false}:{},inventorySelection:(item,index)=>window.AOSuite.pickInventory(item,index),
      // Como ao_suite_issue_receipt: las unidades elegidas quedan vendidas y lo de otra tienda se registra como compra vendida.
      issue:async(id,receipt)=>{const db=window.__db,C=v=>{const t=String(v).replace(',','.');if(!/^\d{1,9}(\.\d{1,2})?$/.test(t))throw Error('Precio inválido: '+v);const [a,b='']=t.split('.');return Number(a)*100+Number(b.padEnd(2,'0'));};
        // Mismas reglas que el servidor: una unidad por cantidad, una computadora por línea y la suma de las partes = importe de la línea.
        for(const item of receipt.items){const inv=item.inventory||[],q=Number(item.quantity);if(!inv.length)throw Error('Selecciona el stock o registra la compra externa de cada producto.');
          if(item.inventoryMode==='bundle'&&q!==1)throw Error('Cada grupo de componentes corresponde a una computadora.');if(item.inventoryMode!=='bundle'&&inv.length!==q)throw Error('Selecciona una unidad de stock por cada unidad vendida.');
          if(inv.reduce((n,p)=>n+C(p.price),0)!==C(item.price)*q)throw Error('La suma de los componentes debe coincidir con el importe de su línea en la boleta.');}
        window.__issued.push({id,receipt:structuredClone(receipt)});
        for(const item of receipt.items)for(const part of item.inventory){if(part.source==='stock'){const u=db.COMPONENTES.find(c=>c.id===part.id);if(!u||u.precio_venta!==null)throw Error('Una unidad seleccionada ya se vendió o no existe.');u.precio_venta=Number(part.price);}
          else{const cid=5000+db.COMPRAS.length;db.COMPRAS.push({id:cid,nombre:part.name,costo:0,proveedor:part.supplier,moneda:'PEN',tipo_cambio:0});db.COMPONENTES.push({id:cid*10,compra_id:cid,product_id:null,nombre:part.name,costo:0,precio_venta:Number(part.price),in_stock:true});}}
        return {id,payload:{...receipt,number:String(window.__next++)},total_cents:0};},
      ensureReceiptAvailable:async()=>{},upload:async()=>{},saved(){window.AOSuite.refreshAfterMutation().catch(()=>{});},nextNumber:async()=>window.__next};
    document.getElementById('receiptFrame').src='boletas.html';
  });
  await s.page.waitForFunction(()=>{const d=document.getElementById('receiptFrame').contentDocument;return d?.getElementById('exportBtn')&&!d.getElementById('exportBtn').disabled&&d.getElementById('number').value==='120';});
  return s.page.frameLocator('#receiptFrame');
}
const draft=page=>page.evaluate(()=>JSON.parse(document.getElementById('receiptFrame').contentWindow.localStorage.getItem('ao-nexus-boleta-v1-u1')));
const load=(page,receipt,id,label,notices)=>page.evaluate(({receipt,id,label,notices})=>document.getElementById('receiptFrame').contentWindow.loadQuoteSale(receipt,id,label,notices),{receipt,id,label,notices});

test('loadQuoteSale abre la venta de la cotización en la boleta y respeta el borrador si no se acepta reemplazarlo',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650)],purchases:[purchase(7,'x')],units:[unit(70,7,'RYZEN 7 7800X3D',1),unit(71,7,'RYZEN 7 7800X3D',1)]});
  const f=await openEditor(s);
  const r=await s.prepare([line([ref(1,'RYZEN 7 7800X3D','1650.00'),ref(1,'RYZEN 7 7800X3D','1650.00')],{description:'Procesador Ryzen 7 7800X3D'}),line([],{description:'Armado y configuración',price:'80.00'})]);
  const receipt={customer:'María López',docType:'DNI',document:'45678912',address:'Jr. Huallaga 450',email:'maria@correo.pe',items:r.items};
  const id='3f0c2b1a-9d8e-4c7b-a6f5-1e2d3c4b5a69',dialogs=[];
  s.page.on('dialog',d=>{dialogs.push(d.message());d.dismiss();});
  assert.equal(await load(s.page,receipt,id,'COT-00001'),true,'sin borrador no pregunta');
  assert.deepEqual(dialogs,[]);
  assert.equal(await f.locator('#customer').inputValue(),'María López');assert.equal(await f.locator('#document').inputValue(),'45678912');
  assert.equal(await f.locator('#address').inputValue(),'Jr. Huallaga 450');assert.equal(await f.locator('#email').inputValue(),'maria@correo.pe');
  assert.equal(await f.locator('#description-0').inputValue(),'Procesador Ryzen 7 7800X3D');assert.equal(await f.locator('#quantity-0').inputValue(),'2');assert.equal(await f.locator('#price-0').inputValue(),'1650.00');
  assert.match(await f.locator('[data-inventory="0"]').textContent(),/Productos seleccionados · 2 unidad/);
  // «Armado y configuración» no se parece a nada de tu stock: llega listo como venta sin stock.
  assert.match(await f.locator('[data-inventory="1"]').textContent(),/Productos seleccionados · 1 unidad/);
  assert.equal(await f.locator('#quoteNotice').isHidden(),true,'sin pendientes no hay avisos');
  assert.equal(await f.locator('[aria-invalid="true"]').count(),0);
  assert.equal(await f.locator('#number').inputValue(),'120');
  assert.match(await f.locator('#toast').textContent(),/Venta de la cotización COT-00001 lista\. Revisa los datos y pulsa «Emitir y descargar»\./);
  let saved=await draft(s.page);
  assert.equal(saved.id,id,'se emitirá con el identificador guardado en la cotización');assert.equal(saved.issued,false);
  assert.deepEqual(saved.receipt.items[0].inventory.map(p=>p.id).sort(),[70,71]);assert.equal(saved.receipt.items[0].inventoryMode,'units');
  assert.deepEqual(saved.receipt.items[1].inventory,[{source:'external',name:'Armado y configuración',supplier:'Venta sin stock',cost:'0.00',price:'80.00'}]);
  assert.equal(saved.receipt.series,'B001');
  // Con contenido: si no acepta, conserva el borrador y devuelve false.
  const other={...receipt,customer:'Otro cliente'};
  assert.equal(await load(s.page,other,'9a9a9a9a-1b1b-4c4c-8d8d-2e2e2e2e2e2e','COT-00002'),false);
  assert.deepEqual(dialogs,['¿Reemplazar el borrador actual por la venta de la cotización COT-00002?']);
  assert.equal(await f.locator('#customer').inputValue(),'María López');
  saved=await draft(s.page);assert.equal(saved.id,id);assert.equal(saved.receipt.customer,'María López');
  // Un identificador inválido no se usa.
  await assert.rejects(load(s.page,receipt,'no-es-un-uuid','COT-00003'),/no es válida/);
  assert.equal((await draft(s.page)).id,id);
  assert.deepEqual(s.errors,[]);
});

test('Cotización → convertir → emitir: la boleta descuenta el stock (2 Ryzen 7 7800X3D → 1)',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650)],purchases:[purchase(7,'x')],units:[unit(70,7,'RYZEN 7 7800X3D',1),unit(71,7,'RYZEN 7 7800X3D',1)]});
  const f=await openEditor(s);
  // La cotización se arma en el buscador en modo cotización.
  await s.quote();await s.page.click('[data-sell-product="1"]');await s.added(1);await s.page.click('#inventoryConfirm');
  const parts=await s.parts();
  assert.deepEqual(await s.page.evaluate(()=>window.AOSuite.stockProducts().find(p=>p.id===1).stock),2,'cotizar no descuenta');
  const r=await s.prepare([line(parts,{description:'Procesador AMD Ryzen 7 7800X3D'})]);
  assert.equal(r.ready,true);assert.deepEqual(r.changes,[{name:'RYZEN 7 7800X3D',before:2,after:1}]);
  const id='0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
  assert.equal(await load(s.page,{customer:'Cliente de la cotización',docType:'NONE',document:'',address:'',email:'',items:r.items},id,'COT-00007'),true);
  const download=s.page.waitForEvent('download');await f.locator('#exportBtn').click();await download;
  const issued=await s.page.evaluate(()=>window.__issued);
  assert.equal(issued.length,1);assert.equal(issued[0].id,id,'el request_id de la boleta es el guardado en la cotización');
  assert.deepEqual(issued[0].receipt.items[0].inventory.map(p=>p.source+':'+p.id+':'+p.price),['stock:'+r.items[0].inventory[0].id+':1650.00']);
  await s.page.evaluate(()=>window.AOSuite.refreshAfterMutation());
  assert.equal(await s.page.evaluate(()=>window.AOSuite.stockProducts().find(p=>p.id===1).stock),1,'al emitir la boleta el stock baja');
  assert.deepEqual(s.errors,[]);
});

// ---------- Casos de la revisión: a pedido repuesto, computadoras incompletas, líneas con menos stock y precios en el buscador ----------
const ID='0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d',noDoc={customer:'Cliente',docType:'NONE',document:'',address:'',email:''};
// Abre el buscador de la boleta con una línea completa (descripción, cantidad y precio), como lo hace receipt.js.
const pickItem=async(s,item)=>{await s.page.evaluate(item=>{document.getElementById('receiptFrame').contentWindow.getInventoryIdsExcept=()=>[];window.__pick=window.AOSuite.pickInventory(item,0);},item);await s.page.locator('#inventoryDialog[open]').waitFor();};
const closed=page=>page.waitForFunction(()=>!document.getElementById('inventoryDialog').open);

test('Cotizado «a pedido» y repuesto antes de convertirla: la boleta lo toma de tu stock y al emitirla el stock baja',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 9 9950X3D',0,true,2600)]});
  await s.quote();await s.search('9950');
  await s.page.click('#inventoryCatalogue [data-sell-product="1"]');await s.added(1);await s.page.click('#inventoryConfirm');
  const parts=await s.parts(),stockOf=parts=>s.page.evaluate(p=>window.AOSuite.quoteStock(p),parts);
  assert.deepEqual(parts,[{source:'external',productId:'1',name:'RYZEN 9 9950X3D',price:'2600.00'}]);
  assert.deepEqual(await stockOf(parts),[{name:'RYZEN 9 9950X3D',source:'external',quoted:1,inStock:null}],'sin stock: a pedido');
  // El dueño lo compra para este cliente y lo registra en su stock.
  await s.page.evaluate(()=>{const db=window.__db;db.COMPRAS.push({id:50,nombre:'RYZEN 9 9950X3D',costo:2200,moneda:'PEN',tipo_cambio:0});db.COMPONENTES.push({id:500,compra_id:50,product_id:1,nombre:'RYZEN 9 9950X3D',costo:null,precio_venta:null,in_stock:true});});
  await s.page.evaluate(()=>window.AOSuite.refreshAfterMutation());
  assert.deepEqual(await stockOf(parts),[{name:'RYZEN 9 9950X3D',source:'external',quoted:1,inStock:1}],'la etiqueta del editor deja de decir «A pedido»');
  await s.quote(parts);assert.deepEqual(await s.origins(),['A pedido · ahora tienes 1 en stock (al convertirla se toma de tu stock)']);
  await s.page.keyboard.press('Escape');assert.equal(await s.parts(),null);
  const r=await s.prepare([line(parts)]);
  assert.equal(r.ready,true);assert.deepEqual(r.notices,[]);
  assert.deepEqual(r.items[0].inventory.map(p=>p.source+':'+p.id+':'+p.price),['stock:500:2600.00']);
  assert.deepEqual(r.changes,[{name:'RYZEN 9 9950X3D',before:1,after:0}]);
  // Una cotización guardada antes, sin el producto de la web, se reconoce por su nombre completo.
  const old=await s.prepare([line([{source:'external',name:'Ryzen 9  9950X3D',price:'2600.00'}])]);
  assert.deepEqual(old.items[0].inventory.map(p=>p.source+':'+p.id),['stock:500']);
  const f=await openEditor(s);
  assert.equal(await load(s.page,{...noDoc,items:r.items},ID,'COT-00001',r.notices),true);
  const download=s.page.waitForEvent('download');await f.locator('#exportBtn').click();await download;
  assert.deepEqual((await s.page.evaluate(()=>window.__issued))[0].receipt.items[0].inventory.map(p=>p.source+':'+p.id),['stock:500']);
  await s.page.evaluate(()=>window.AOSuite.refreshAfterMutation());
  assert.equal(await s.page.evaluate(()=>window.AOSuite.stockProducts().find(p=>p.id===1).stock),0,'emitir la boleta baja el stock: 1 → 0 (no se vende como «Venta sin stock»)');
  assert.deepEqual(s.errors,[]);
});

test('Convertir: lo «a pedido» que se parece a algo que tienes avisa antes de emitir; si esas unidades ya están en otra línea se vende sin stock',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650)],purchases:[purchase(7,'x')],units:[unit(70,7,'RYZEN 7 7800X3D',1)]});
  const r=await s.prepare([line([{source:'external',name:'AMD 7800X3D',price:'1600.00'}])]);
  assert.deepEqual(r.items[0].inventory.map(p=>p.source),['external']);
  assert.deepEqual(r.notices.map(n=>n.kind+':'+n.line+':'+n.name),['instock:1:AMD 7800X3D']);assert.equal(r.ready,false);
  assert.equal(r.notices[0].text,'Producto 1: «AMD 7800X3D» se cotizó a pedido y tienes «RYZEN 7 7800X3D» en stock. Si es el mismo, en la boleta pulsa «Seleccionar productos para esta venta» y elígelo en «Mi stock» para que tu stock baje; si es otro, emítela así (se vende sin descontar stock).');
  const taken=await s.prepare([line([ref(1,'RYZEN 7 7800X3D','1650.00')]),line([{source:'external',productId:'1',name:'RYZEN 7 7800X3D',price:'1650.00'}])]);
  assert.deepEqual(taken.items.map(i=>i.inventory.map(p=>p.source)),[['stock'],['external']]);
  assert.deepEqual(taken.notices,[]);assert.equal(taken.ready,true);
  assert.deepEqual(taken.changes,[{name:'RYZEN 7 7800X3D',before:1,after:0}]);
});

test('Convertir: una computadora incompleta no aparta sus componentes y otra línea puede usarlos',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650),product(2,'RTX 4070',0,true,2800)],purchases:[purchase(7,'x')],units:[unit(70,7,'RYZEN 7 7800X3D',1)]});
  const r=await s.prepare([{description:'Computadora completa: RYZEN 7 7800X3D, RTX 4070',code:'',unit:'NIU',quantity:'1',price:'4450.00',parts:[ref(1,'RYZEN 7 7800X3D','1650.00'),ref(2,'RTX 4070','2800.00')],mode:'bundle'},line([ref(1,'RYZEN 7 7800X3D','1650.00')])]);
  assert.deepEqual(r.items.map(i=>[i.inventoryMode,i.quantity,i.price,i.inventory.map(p=>p.id)]),[['bundle','1','4450.00',[]],['units','1','1650.00',[70]]]);
  assert.deepEqual(r.notices.map(n=>({kind:n.kind,line:n.line,name:n.name,quoted:n.quoted,linked:n.linked})),[{kind:'missing',line:1,name:'RTX 4070',quoted:2,linked:1}],'la segunda línea no recibe un falso «tienes 0»');
  assert.equal(r.notices[0].text,'Producto 1 (computadora): falta «RTX 4070» en tu stock. En la boleta pulsa «Seleccionar productos para esta venta» en el producto 1 y vuelve a armarla: ninguno de sus componentes quedó apartado. Lo que no tengas, agrégalo en «¿No está en tu stock?» (se vende sin descontar stock).');
  assert.deepEqual(r.changes,[{name:'RYZEN 7 7800X3D',before:1,after:0}],'solo se anuncia lo que de verdad queda en la boleta');
  assert.equal(r.ready,false);
});

test('Boleta de una cotización con menos stock: completar la línea en el buscador cobra el importe correcto (mismo precio o distinto)',{skip},async()=>{
  for(const [retype,price,want] of [[false,'1650.00',['2','1650.00','units',330000]],[true,'1650.00',['2','1650.00','units',330000]],[false,'1700',['1','3350.00','bundle',335000]]]){
    const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650)],purchases:[purchase(7,'x')],units:[unit(71,7,'RYZEN 7 7800X3D',1)]});
    const r=await s.prepare([line([ref(1,'RYZEN 7 7800X3D','1650.00'),ref(1,'RYZEN 7 7800X3D','1650.00')],{description:'Procesador AMD Ryzen 7 7800X3D'})]);
    const f=await openEditor(s);
    await load(s.page,{...noDoc,items:r.items},ID,'COT-00001',r.notices);
    assert.equal(await f.locator('#amount-0').textContent(),'S/ 3,300.00');assert.equal(await f.locator('#quoteNotice').isVisible(),true);
    // Escribir otra vez el precio no reparte el total de 2 unidades en la única que hay.
    if(retype){await f.locator('#price-0').fill('');await f.locator('#price-0').fill('1650.00');}
    await f.locator('[data-inventory="0"]').click();await s.page.locator('#inventoryDialog[open]').waitFor();
    assert.equal(await s.page.inputValue('[data-part-price="0"]'),'1650.00','la unidad que sí tienes conserva el precio por unidad');
    // Sin más unidades en tu stock, «¿No está en tu stock?» abre listo con el nombre y el precio por unidad.
    assert.equal(await s.page.$eval('#externalBox',d=>d.open),true);
    assert.deepEqual([await s.page.inputValue('#externalName'),await s.page.inputValue('#externalPrice')],['RYZEN 7 7800X3D','1650.00']);
    assert.match(await s.message(),/No te quedan más «RYZEN 7 7800X3D» en tu stock\. Para vender la que falta, pulsa «Agregar a esta venta» abajo/);
    assert.equal(await s.page.textContent('#inventoryUnits'),'Todas tus unidades de «RYZEN 7 7800X3D» ya están en esta venta o en otra línea de la boleta.');
    await s.page.fill('#externalPrice',price);await s.page.click('#addExternal');await s.added(2);
    assert.doesNotMatch(await s.message(),/Tienes «RYZEN 7 7800X3D» en tu stock/,'no avisa de un stock que ya está en esta venta');
    await s.page.click('#inventoryConfirm');await closed(s.page);
    await f.locator('#quantity-0').waitFor();
    assert.deepEqual([await f.locator('#quantity-0').inputValue(),await f.locator('#price-0').inputValue()],want.slice(0,2));
    assert.equal(await f.locator('#amount-0').textContent(),want[3]===330000?'S/ 3,300.00':'S/ 3,350.00','el importe es lo que mostró la selección');
    const download=s.page.waitForEvent('download');await f.locator('#exportBtn').click();await download;
    const item=(await s.page.evaluate(()=>window.__issued))[0].receipt.items[0];
    assert.deepEqual([item.quantity,item.price,item.inventoryMode],want.slice(0,3));
    assert.equal(item.inventory.reduce((n,p)=>n+cents(p.price),0),want[3],'la suma de lo vendido es el importe de la línea');
    assert.equal(await f.locator('#quoteNotice').isHidden(),true,'al emitir se quitan los avisos de la cotización');
    assert.deepEqual(s.errors,[]);
  }
});

test('Boleta de una cotización con pendientes: avisos a la vista, productos a completar en rojo y un aviso que no dice «lista»',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650)],purchases:[purchase(7,'x')],units:[unit(71,7,'RYZEN 7 7800X3D',1)]});
  const r=await s.prepare([line([ref(1,'RYZEN 7 7800X3D','1650.00'),ref(1,'RYZEN 7 7800X3D','1650.00')]),line([],{description:'Procesador AMD Ryzen 7 7800X3D',price:'1650.00'}),line([],{description:'Armado y configuración',price:'80.00'})]);
  assert.deepEqual(r.notices.map(n=>n.kind),['missing','manual','service']);
  const f=await openEditor(s);
  await load(s.page,{...noDoc,items:r.items},ID,'COT-00017',r.notices);
  const notice=await f.locator('#quoteNotice').innerText();
  assert.match(notice,/Desde la cotización COT-00017: completa esto antes de emitir/);
  assert.match(notice,/RYZEN 7 7800X3D: cotizaste 2 y tienes 1 en stock/);assert.match(notice,/Producto 2 \(«Procesador AMD Ryzen 7 7800X3D»\) se escribió a mano/);
  assert.doesNotMatch(notice,/Armado y configuración/,'lo que se vende sin stock no es un pendiente');
  assert.deepEqual(await f.locator('[aria-invalid="true"]').evaluateAll(e=>e.map(x=>x.id)),['quantity-0','description-1']);
  assert.equal(await f.locator('#errorBox').isVisible(),true);
  assert.equal(await f.locator('#toast').textContent(),'Venta de la cotización COT-00017 abierta: completa 2 productos antes de emitir.');
  // El buscador de la línea escrita a mano abre buscando su descripción, con el producto parecido a la vista.
  await f.locator('[data-inventory="1"]').click();await s.page.locator('#inventoryDialog[open]').waitFor();
  assert.equal(await s.page.inputValue('#inventorySearch'),'Procesador AMD Ryzen 7 7800X3D');
  await s.page.keyboard.press('Escape');await closed(s.page);
  // «Ocultar» y «Nueva boleta» los quitan.
  s.page.on('dialog',d=>d.accept());
  await f.locator('[data-hide-notice]').click();assert.equal(await f.locator('#quoteNotice').isHidden(),true);
  await load(s.page,{...noDoc,items:r.items},ID,'COT-00017',r.notices);assert.equal(await f.locator('#quoteNotice').isVisible(),true);
  await f.locator('#newBtn').click();
  await f.locator('#quoteNotice').waitFor({state:'hidden'});assert.equal(await f.locator('[aria-invalid="true"]').count(),0);
  // Solo avisos para revisar (nada que completar): la boleta queda lista y lo dice.
  const advisory=[{kind:'instock',line:1,name:'AMD 7800X3D',quoted:1,linked:0,text:'Producto 1: «AMD 7800X3D» se cotizó a pedido y tienes «RYZEN 7 7800X3D» en stock.'}];
  await load(s.page,{...noDoc,items:[{description:'AMD 7800X3D',code:'',unit:'NIU',quantity:'1',price:'1600.00',inventory:[{source:'external',name:'AMD 7800X3D',supplier:'Venta sin stock',cost:'0.00',price:'1600.00'}],inventoryMode:'units'}]},ID,'COT-00018',advisory);
  assert.match(await f.locator('#quoteNotice').innerText(),/Desde la cotización COT-00018: revisa esto antes de emitir/);
  assert.equal(await f.locator('#toast').textContent(),'Venta de la cotización COT-00018 lista. Revisa los avisos y pulsa «Emitir y descargar».');
  assert.deepEqual(s.errors,[]);
});

test('Boleta: si cambias el precio de la primera unidad, la siguiente del mismo producto lo conserva y la línea queda en unidades',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650)],purchases:[purchase(7,'x')],units:[unit(70,7,'RYZEN 7 7800X3D',1),unit(71,7,'RYZEN 7 7800X3D',1)]});
  const f=await openEditor(s);
  await f.locator('#customer').fill('Cliente');await f.locator('#docType').selectOption('NONE');
  await f.locator('[data-inventory="0"]').click();await s.page.locator('#inventoryDialog[open]').waitFor();
  await s.page.click('[data-sell-product="1"]');await s.added(1);
  await s.page.fill('[data-part-price="0"]','1600');
  await s.page.click('[data-sell-product="1"]');await s.added(2);
  assert.deepEqual(await s.page.$$eval('#inventorySelected input',e=>e.map(x=>x.value)),['1600','1600.00']);
  await s.page.click('#inventoryConfirm');await closed(s.page);
  await f.locator('#quantity-0').waitFor();
  // «1600» y «1600.00» son el mismo precio: unidades, no «Computadora completa».
  assert.deepEqual([await f.locator('#quantity-0').inputValue(),await f.locator('#price-0').inputValue(),await f.locator('#description-0').inputValue()],['2','1600.00','RYZEN 7 7800X3D']);
  await s.page.waitForFunction(()=>JSON.parse(document.getElementById('receiptFrame').contentWindow.localStorage.getItem('ao-nexus-boleta-v1-u1')).receipt.items[0].inventory.length===2);
  const saved=await draft(s.page);
  assert.equal(saved.receipt.items[0].inventoryMode,'units');assert.deepEqual(saved.receipt.items[0].inventory.map(p=>p.price),['1600.00','1600.00']);
  const download=s.page.waitForEvent('download');await f.locator('#exportBtn').click();await download;
  const item=(await s.page.evaluate(()=>window.__issued))[0].receipt.items[0];
  assert.deepEqual([item.quantity,item.price,item.inventoryMode],['2','1600.00','units']);
  assert.deepEqual(s.errors,[]);
});

test('Buscador de la boleta: un precio inválido o vacío no se copia a la unidad siguiente',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650),product(3,'RTX 5090',0,true,9000)],purchases:[purchase(7,'x')],units:[unit(70,7,'RYZEN 7 7800X3D',1),unit(71,7,'RYZEN 7 7800X3D',1)]});
  await s.pick();
  await s.page.click('[data-sell-product="1"]');await s.added(1);await s.page.fill('[data-part-price="0"]','1650.555');
  await s.page.click('[data-sell-product="1"]');await s.added(2);
  await s.search('5090');await s.page.click('#inventoryCatalogue [data-sell-product="3"]');await s.added(3);
  await s.page.fill('[data-part-price="2"]','');
  await s.page.click('#inventoryCatalogue [data-sell-product="3"]');await s.added(4);
  assert.equal(await s.message(),'«RTX 5090» no está en tu stock: se agregó a S/ 9,000.00 (no cambia tu stock).');
  assert.deepEqual(await s.page.$$eval('#inventorySelected input',e=>e.map(x=>x.value)),['1650.555','1650.00','','9000.00']);
  assert.deepEqual(s.errors,[]);
});

test('Buscador de la boleta: con la descripción escrita busca lo parecido; si no se parece a nada muestra todo tu stock',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',0,true,1650),product(2,'SSD Kingston NV2 1TB',0,true,260)],purchases:[purchase(7,'x')],units:[unit(70,7,'RYZEN 7 7800X3D',1),unit(72,7,'SSD Kingston NV2 1TB',2),unit(73,7,'SSD Kingston NV2 1TB',2)]});
  await pickItem(s,{description:'Procesador AMD Ryzen 7 7800X3D',quantity:'1',price:'1650.00',inventory:[]});
  assert.equal(await s.page.inputValue('#inventorySearch'),'Procesador AMD Ryzen 7 7800X3D');
  assert.deepEqual(await s.rows(),['RYZEN 7 7800X3D | 1 en stock']);assert.equal(await s.page.$eval('#externalBox',d=>d.open),false);
  await s.page.keyboard.press('Escape');assert.equal(await s.parts(),null);
  await pickItem(s,{description:'PC Gamer para oficina',quantity:'1',price:'3500.00',inventory:[]});
  assert.equal(await s.page.inputValue('#inventorySearch'),'','como siempre: se ve todo tu stock para armar la venta');
  assert.deepEqual(await s.rows(),['RYZEN 7 7800X3D | 1 en stock','SSD Kingston NV2 1TB | 2 en stock']);
  await s.page.keyboard.press('Escape');assert.equal(await s.parts(),null);
  // Una línea con menos unidades que su cantidad y stock libre: busca el producto para agregar las que faltan.
  await pickItem(s,{description:'RYZEN 7 7800X3D',quantity:'2',price:'1650.00',inventory:[],inventoryMode:'units'});
  assert.equal(await s.page.inputValue('#inventorySearch'),'RYZEN 7 7800X3D');
  await s.page.keyboard.press('Escape');assert.equal(await s.parts(),null);
  await s.page.evaluate(()=>{document.getElementById('receiptFrame').contentWindow.getInventoryIdsExcept=()=>[];window.__pick=window.AOSuite.pickInventory({description:'SSD',quantity:'2',price:'260.00',inventory:[{source:'stock',id:72,name:'SSD Kingston NV2 1TB',serial:'',price:'260.00'}],inventoryMode:'units'},0);});
  await s.page.locator('#inventoryDialog[open]').waitFor();
  assert.equal(await s.page.inputValue('#inventorySearch'),'SSD Kingston NV2 1TB');assert.equal(await s.page.$eval('#externalBox',d=>d.open),false);
  assert.equal(await s.message(),'Falta 1 de «SSD Kingston NV2 1TB» para la cantidad de esta línea (2): pulsa «Agregar» en «Mi stock».');
  assert.deepEqual(await s.rows(),['SSD Kingston NV2 1TB | 1 en stock']);
  assert.deepEqual(s.errors,[]);
});
