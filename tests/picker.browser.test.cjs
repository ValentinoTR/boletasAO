// Prueba de navegador del buscador de la venta, la activación del stock y el avance de numeración.
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
const product=(id,name,reference,managed=false,price=500,brand='')=>({id,data:{name,brand,category:'x',image:''},web_price:price,published:true,managed,reference_stock:reference});
const unit=(id,compra,name,productId=null,extra={})=>({id,compra_id:compra,product_id:productId,nombre:name,costo:null,precio_venta:null,in_stock:true,...extra});
const purchase=(id,name,extra={})=>({id,nombre:name,costo:0,moneda:'PEN',tipo_cambio:0,...extra});
// Base de datos en memoria con el comportamiento de las funciones de stock que usa la app.
async function open({products,purchases=[],units=[],latency=0}){
  const page=await (await browser.newContext({viewport:{width:1000,height:1000},acceptDownloads:true})).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*supabase.co/**',r=>r.abort());
  await page.route('**/accounting.html',r=>r.fulfill({status:200,contentType:'text/html',body:'<html></html>'}));
  await page.goto(base+'/index.html');
  await page.evaluate(({products,purchases,units,latency})=>{
    const db=window.__db={ao_products:products,COMPRAS:purchases,COMPONENTES:units,ao_clients:[],ao_sales:[],ao_receipts:[],ao_suite_state:[]};
    window.__rpc=[];let next=1000;const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const free=id=>db.COMPONENTES.filter(c=>c.product_id===id&&c.precio_venta===null&&c.in_stock!==false).length;
    const handlers={
      ao_suite_set_stock(a){const p=db.ao_products.find(p=>p.id===a.product_key);if(free(p.id)!==a.expected_quantity)throw Error('El stock cambió mientras editabas.');
        const delta=a.target_quantity-free(p.id);if(delta>0){const cid=next++;db.COMPRAS.push({id:cid,nombre:p.data.name,costo:delta*a.cost_per_unit,proveedor:a.supplier,moneda:'PEN',tipo_cambio:0});for(let i=0;i<delta;i++)db.COMPONENTES.push({id:next++,compra_id:cid,product_id:p.id,nombre:p.data.name,costo:null,precio_venta:null,in_stock:true});}
        p.managed=true;p.reference_stock=0;return {quantity:a.target_quantity};},
      ao_suite_link_stock(a){for(const id of a.unit_keys)db.COMPONENTES.find(c=>c.id===id).product_id=a.product_key;if(free(a.product_key)!==a.expected_stock)throw Error('El stock cambió durante la vinculación.');db.ao_products.find(p=>p.id===a.product_key).managed=true;return a.expected_stock;}};
    const client={from:t=>({select:()=>({order:()=>({range:async start=>({data:start===0?structuredClone(db[t]||[]):[],error:null})})})}),
      rpc:async(name,args)=>{window.__rpc.push({name,args});await wait(latency);try{return {data:handlers[name](args),error:null};}catch(e){return {data:null,error:{message:e.message}};}}};
    document.getElementById('loginView').hidden=true;document.getElementById('appView').hidden=false;
    window.__ready=window.AOSuite.initialize(client,{role:'owner'});
  },{products,purchases,units,latency});
  await page.evaluate(()=>window.__ready);
  // blocked: unidades ya elegidas en otra línea de la boleta.
  const pick=async(inventory=[],blocked=[])=>{await page.evaluate(({inventory,blocked})=>{document.getElementById('receiptFrame').contentWindow.getInventoryIdsExcept=()=>blocked;window.__pick=window.AOSuite.pickInventory({inventory},0);},{inventory,blocked});await page.locator('#inventoryDialog[open]').waitFor();};
  const search=async text=>{await page.fill('#inventorySearch',text);await page.waitForTimeout(250);};
  const added=n=>page.waitForFunction(n=>document.querySelectorAll('#inventorySelected .selected-part').length===n,n);
  return {page,errors,pick,search,added,selected:()=>page.$$eval('#inventorySelected .selected-part',e=>e.length),message:()=>page.textContent('#inventoryMessage'),
    rows:()=>page.$$eval('#inventoryUnits .catalogue-row',rows=>rows.map(r=>r.querySelector('strong').textContent+' | '+r.querySelector('small').textContent)),
    // Si el buscador no se cierra, la prueba falla en 5 s en lugar de quedarse esperando.
    parts:()=>page.evaluate(()=>Promise.race([window.__pick,new Promise((_,reject)=>setTimeout(()=>reject(new Error('El buscador no se cerró al confirmar')),5000))]))};
}
const skip=!playwright&&'Playwright no está instalado';

test('«Mi stock» muestra solo lo que hay en stock, un renglón por producto y sin costos',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7700X',0,true,850),product(2,'RYZEN 7 9800X3D',1,false,1800),product(3,'RYZEN 9 9950X3D',0,false,2600),product(4,'SSD NVMe 1 TB',0,true,300)],
    purchases:[purchase(7,'RYZEN 7 7700X'),purchase(8,'Cable HDMI')],units:[unit(70,7,'RYZEN 7 7700X',1),unit(71,7,'RYZEN 7 7700X',1),unit(80,8,'Cable HDMI')]});
  await s.pick();
  assert.deepEqual(await s.rows(),['Cable HDMI | 1 en stock','RYZEN 7 7700X | 2 en stock','RYZEN 7 9800X3D | 1 en stock']);
  assert.doesNotMatch(await s.page.textContent('#inventoryDialog'),/costo|costó/i,'no hay costos en el buscador');
  assert.equal(await s.page.$$eval('#externalSupplier,#externalCost',e=>e.length),0,'sin campos de tienda ni de costo');
  assert.equal(await s.page.$eval('#externalBox',d=>d.open),false,'el formulario de otra tienda empieza plegado');
  await s.search('9950');
  assert.deepEqual(await s.rows(),[]);assert.match(await s.page.textContent('#inventoryUnits'),/No tienes «9950» en stock/);
  assert.match(await s.page.textContent('#inventoryCatalogue'),/RYZEN 9 9950X3D.*Sin stock/s,'lo que no tienes solo aparece al buscarlo');
  assert.doesNotMatch(await s.page.textContent('#inventoryCatalogue'),/«9950»/,'no ofrece lo escrito si ya coincide con un producto de tu web');
});

test('La búsqueda encuentra el producto con otras palabras, en otro orden o con la marca',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 9 9900X',1,false,1700,'AMD'),product(2,'SSD KINGSTON NV2 1TB',2,false,300),product(3,'CORE ULTRA 9 285K',1,false,2900)]});
  await s.pick();
  for(const [term,name] of [['AMD Ryzen 9 9900X','RYZEN 9 9900X'],['9900x ryzen','RYZEN 9 9900X'],['ssd 1 tb','SSD KINGSTON NV2 1TB'],['Intel Core Ultra 285K','CORE ULTRA 9 285K']]){
    await s.search(term);
    assert.deepEqual((await s.rows()).map(r=>r.split(' | ')[0]),[name],'«'+term+'»');
    assert.doesNotMatch(await s.page.textContent('#inventoryCatalogue'),/producto de otra tienda/,'«'+term+'» no se ofrece como de otra tienda');
  }
});

test('Agregar un producto con stock no pide formulario y avisa cuánto quedará',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7700X',0,true,850)],purchases:[purchase(7,'RYZEN 7 7700X')],units:[unit(70,7,'RYZEN 7 7700X',1),unit(71,7,'RYZEN 7 7700X',1)]});
  await s.pick();await s.page.click('[data-sell-product="1"]');await s.added(1);
  assert.match(await s.message(),/te quedará 1/);assert.deepEqual(await s.rows(),['RYZEN 7 7700X | 1 en stock']);
  assert.equal(await s.page.evaluate(()=>document.activeElement.id),'inventorySearch','se puede seguir buscando');
  await s.page.click('[data-sell-product="1"]');await s.added(2);
  assert.match(await s.message(),/te quedará 0/);assert.deepEqual(await s.rows(),[]);
  await s.search('7700');
  assert.equal(await s.page.textContent('#inventoryCatalogue'),'','lo que ya está en esta venta no aparece como «sin stock»');
  await s.page.click('#inventoryConfirm');
  assert.deepEqual((await s.parts()).map(p=>p.source+':'+p.name+':'+p.price),['stock:RYZEN 7 7700X:850.00','stock:RYZEN 7 7700X:850.00']);
  assert.deepEqual(s.errors,[]);
});

test('Agregar toma la unidad del producto elegido y respeta las de otra línea de la boleta',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7700X',0,true,850),product(2,'RYZEN 7 9800X3D',0,true,1800)],purchases:[purchase(7,'mix')],
    units:[unit(70,7,'RYZEN 7 7700X',1),unit(71,7,'RYZEN 7 9800X3D',2),unit(72,7,'RYZEN 7 9800X3D',2)]});
  await s.pick([],[71]);
  assert.deepEqual(await s.rows(),['RYZEN 7 7700X | 1 en stock','RYZEN 7 9800X3D | 1 en stock'],'la unidad de otra línea no cuenta');
  await s.page.click('[data-sell-product="2"]');await s.added(1);await s.page.click('#inventoryConfirm');
  assert.deepEqual((await s.parts()).map(p=>p.id),[72]);
});

test('El mismo producto con unidades de nombres o precios distintos queda en una sola línea',{skip},async()=>{
  const s=await open({products:[product(1,'SSD KINGSTON NV2 1TB M.2 NVMe',0,true,300)],purchases:[purchase(7,'ssd')],
    units:[unit(70,7,'SSD KINGSTON NV2 1TB',1,{precio_sugerido:280}),unit(71,7,'SSD KINGSTON NV2 1TB M.2 NVMe',1)]});
  await s.pick();await s.page.click('[data-sell-product="1"]');await s.added(1);await s.page.click('[data-sell-product="1"]');await s.added(2);
  await s.page.click('#inventoryConfirm');
  const parts=await s.parts();
  assert.equal(new Set(parts.map(p=>p.name+'|'+p.price)).size,1,'mismo nombre y precio: la boleta lo imprime como una línea con cantidad 2');
  assert.equal(parts[0].price,'300.00','usa el precio que se muestra (el de tu web)');
});

test('Un producto del catálogo anterior se registra en el stock y la venta usa una de sus unidades',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 5 5500',1,false,340)]});
  await s.pick();
  assert.deepEqual(await s.rows(),['RYZEN 5 5500 | 1 en stock']);
  await s.page.dblclick('[data-sell-product="1"]');await s.added(1);
  const calls=await s.page.evaluate(()=>window.__rpc.filter(c=>c.name==='ao_suite_set_stock').map(c=>c.args));
  assert.equal(calls.length,1,'un doble clic envía una sola activación');
  assert.equal(calls[0].target_quantity,1);assert.equal(calls[0].expected_quantity,0);
  assert.match(await s.message(),/te quedará 0/);
  await s.page.click('#inventoryConfirm');
  const parts=await s.parts();
  assert.equal(parts.length,1);assert.equal(parts[0].source,'stock');assert.equal(parts[0].price,'340.00');
  assert.equal(await s.page.evaluate(id=>window.__db.COMPONENTES.find(c=>c.id===id).product_id,parts[0].id),1);
});

test('Unidades de Compras con el mismo nombre se vinculan; si la web indica más, se completa la diferencia',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 5 5500',1,false,340),product(2,'RYZEN 7 7800X3D',2,false,1799)],purchases:[purchase(7,'importado',{costo:250})],
    units:[unit(70,7,'Ryzen 5  5500'),unit(71,7,'RYZEN 7 7800X3D')]});
  await s.pick();
  assert.deepEqual(await s.rows(),['RYZEN 5 5500 | 1 en stock','RYZEN 7 7800X3D | 2 en stock'],'un renglón por producto, sin duplicar lo importado');
  await s.page.click('[data-sell-product="1"]');await s.added(1);
  await s.page.click('[data-sell-product="2"]');await s.added(2);
  assert.deepEqual(await s.page.evaluate(()=>window.__rpc.map(c=>c.name+':'+c.args.product_key+':'+(c.args.target_quantity??c.args.expected_stock))),
    ['ao_suite_link_stock:1:1','ao_suite_link_stock:2:1','ao_suite_set_stock:2:2'],'vincula lo importado y completa la cantidad de la web');
  assert.match(await s.message(),/te quedará 1/);
  await s.page.click('#inventoryConfirm');
  assert.equal((await s.parts())[0].id,70,'el 5500 usa la unidad importada (conserva su costo)');
});

test('Lo de Compras sin producto en la web se vende por nombre, sin tocar unidades vinculadas a otro producto',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 9800X3D',0,true,1800)],purchases:[purchase(9,'Procesador AMD Ryzen 7 9800X3D')],
    units:[unit(90,9,'Procesador AMD Ryzen 7 9800X3D',1),unit(91,9,'Procesador AMD Ryzen 7 9800X3D'),unit(92,9,'Procesador AMD Ryzen 7 9800X3D')]});
  await s.pick();
  assert.deepEqual(await s.rows(),['Procesador AMD Ryzen 7 9800X3D | 2 en stock','RYZEN 7 9800X3D | 1 en stock']);
  await s.page.click('[data-sell-loose]');await s.added(1);
  assert.match(await s.message(),/Escribe su precio/);
  await s.page.click('#inventoryConfirm');
  assert.match(await s.message(),/no tiene precio de venta/,'no se vende a S/ 0.00');
  await s.page.fill('[data-part-price="0"]','1500');await s.page.click('#inventoryConfirm');
  assert.notEqual((await s.parts())[0].id,90,'no toma la unidad vinculada al producto de la web');
});

test('Lo que volvió al eliminar una venta sin stock no se cuenta como stock',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 9 9950X3D',0,false,2600)],purchases:[purchase(9,'RYZEN 9 9950X3D',{proveedor:'Venta sin stock'})],units:[unit(90,9,'RYZEN 9 9950X3D',null,{costo:0})]});
  await s.pick();
  assert.deepEqual(await s.rows(),[]);
  await s.search('9950');
  assert.match(await s.page.textContent('#inventoryCatalogue'),/RYZEN 9 9950X3D.*Sin stock/s);
  await s.page.click('#inventoryCatalogue [data-sell-product="1"]');await s.added(1);
  await s.page.click('#inventoryConfirm');
  assert.deepEqual(await s.parts(),[{source:'external',name:'RYZEN 9 9950X3D',supplier:'Venta sin stock',cost:'0.00',price:'2600.00'}]);
  assert.deepEqual(await s.page.evaluate(()=>window.__rpc),[],'no se vinculó ni publicó nada');
});

test('Escribir a mano algo que tienes en stock avisa antes de venderlo como de otra tienda',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 9 9900X',1,false,1700,'AMD')]});
  await s.pick();await s.page.click('#externalBox summary');
  await s.page.fill('#externalName','AMD Ryzen 9900X');await s.page.fill('#externalPrice','1700');
  await s.page.click('#inventoryConfirm');
  assert.match(await s.message(),/Tienes «RYZEN 9 9900X» en tu stock/);assert.equal(await s.selected(),0);
  await s.page.click('#inventoryConfirm');
  assert.equal((await s.parts())[0].source,'external','al insistir se vende como de otra tienda');
});

test('Otra tienda: solo nombre y precio; coma decimal; Enter; lo escrito con el apartado cerrado no se agrega',{skip},async()=>{
  const s=await open({products:[]});
  await s.pick();await s.search('Monitor 24');await s.page.click('[data-use-other]');
  assert.equal(await s.page.$eval('#externalBox',d=>d.open),true);assert.equal(await s.page.inputValue('#externalName'),'Monitor 24');
  await s.page.fill('#externalPrice','1800,50');await s.page.press('#externalPrice','Enter');
  assert.equal(await s.selected(),1);assert.equal(await s.page.inputValue('[data-part-price="0"]'),'1800.50');
  await s.page.fill('#externalName','Cable');await s.page.click('#externalBox summary');
  await s.page.click('#inventoryConfirm');
  assert.deepEqual((await s.parts()).map(p=>p.name+':'+p.supplier),['Monitor 24:Venta sin stock']);
});

test('Varios productos distintos avisan que se imprimen en una sola línea',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 5 5500',0,true,340),product(2,'SSD',0,true,300)],purchases:[purchase(7,'x')],units:[unit(70,7,'RYZEN 5 5500',1),unit(71,7,'SSD',2)]});
  await s.pick();await s.page.click('[data-sell-product="1"]');await s.added(1);
  assert.doesNotMatch(await s.page.textContent('#inventorySelected'),/una sola línea/);
  await s.page.click('[data-sell-product="2"]');await s.added(2);
  assert.match(await s.page.textContent('#inventorySelected'),/una sola línea/);
});

test('Confirmar sin elegir nada explica qué hacer',{skip},async()=>{
  const s=await open({products:[]});await s.pick();await s.page.click('#inventoryConfirm');
  assert.match(await s.message(),/Elige al menos un producto de «Mi stock»/);assert.doesNotMatch(await s.message(),/unidad/);
});

test('Una unidad que ya no está disponible no se puede usar en la venta',{skip},async()=>{
  const s=await open({products:[product(1,'SSD',0,true,300)],purchases:[purchase(7,'SSD')],units:[unit(70,7,'SSD',1)]});
  await s.pick([{source:'stock',id:70,name:'SSD',price:'300.00'}]);
  await s.page.evaluate(()=>{window.__db.COMPONENTES[0].precio_venta=300;});await s.page.evaluate(()=>window.AOSuite.refresh());
  await s.search('x');await s.search('');
  assert.match(await s.page.textContent('#inventorySelected'),/ya no está disponible/);
  await s.page.click('#inventoryConfirm');
  assert.match(await s.message(),/ya no está disponible/);assert.equal(await s.page.$eval('#inventoryDialog',d=>d.open),true);
});

test('Mientras se agrega un producto, otro «Agregar» espera su turno',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 5 5500',1),product(2,'RYZEN 7 7700X',1)],latency:1500});
  await s.pick();
  // Los dos clics en el mismo instante, sin depender de la velocidad de la máquina.
  await s.page.evaluate(()=>{document.querySelector('[data-sell-product="1"]').click();document.querySelector('[data-sell-product="2"]').click();});
  assert.match(await s.message(),/Hay otro producto agregándose/);
  await s.added(1);
  assert.equal(await s.page.evaluate(()=>window.__rpc.length),1);
});

test('La activación masiva vincula las unidades importadas con el mismo nombre en vez de duplicarlas',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 5700X',1),product(2,'RYZEN 5 5600',2)],purchases:[{id:7,nombre:'RYZEN 7 5700X',costo:300,moneda:'PEN',tipo_cambio:0}],units:[{id:70,compra_id:7,product_id:null,nombre:'RYZEN 7 5700X',costo:null,precio_venta:null,in_stock:true}]});
  await s.page.evaluate(()=>{document.getElementById('catalogView').hidden=false;});
  await s.page.click('#activateAutoStock');
  assert.match(await s.page.textContent('#autoStockSummary'),/1 se vinculará con unidades que ya tienes en Compras/);
  await s.page.click('#autoStockConfirm');await s.page.waitForFunction(()=>!document.getElementById('autoStockDialog').open);
  const calls=await s.page.evaluate(()=>window.__rpc.map(c=>c.name+':'+c.args.product_key));
  assert.deepEqual(calls.sort(),['ao_suite_link_stock:1','ao_suite_set_stock:2']);
  assert.equal(await s.page.evaluate(()=>window.__db.COMPONENTES.filter(c=>c.product_id===1).length),1);
});

test('Cancelar detiene la activación masiva del catálogo anterior',{skip},async()=>{
  const s=await open({products:[1,2,3,4,5].map(i=>product(i,'Producto '+i,2)),latency:150});
  await s.page.evaluate(()=>{document.getElementById('catalogView').hidden=false;});
  await s.page.click('#activateAutoStock');await s.page.click('#autoStockConfirm');
  await s.page.waitForFunction(()=>window.__rpc.length===1);
  await s.page.click('#autoStockDialog .secondary');
  const atCancel=await s.page.evaluate(()=>window.__rpc.length);
  // Espera el resultado real en lugar de un tiempo fijo.
  await s.page.waitForFunction(()=>/Activación detenida/.test(document.getElementById('suiteToast').textContent),null,{timeout:15000});
  const sent=await s.page.evaluate(()=>window.__rpc.length);
  assert.ok(sent<=atCancel+1&&sent<5,'se detiene tras el producto en curso ('+sent+' de 5)');
});

test('Tras emitir se abre la boleta siguiente sin esperar a la base y un error del servidor queda a la vista',{skip},async()=>{
  const page=await (await browser.newContext({viewport:{width:1100,height:900},acceptDownloads:true})).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*supabase.co/**',r=>r.abort());
  await page.goto(base+'/index.html');
  await page.evaluate(()=>{
    window.__next=110;window.__slow=null;window.__fail=null;
    window.AOCloud={api:async a=>a==='email-config'?{configured:false}:{},inventorySelection:async()=>[{source:'external',name:'Producto',supplier:'',cost:'0.00',price:'100.00'}],
      issue:async(id,receipt)=>{if(window.__fail)throw Error(window.__fail);return {id,payload:{...receipt,number:String(window.__next++)},total_cents:10000};},
      ensureReceiptAvailable:async()=>{},upload:async()=>{},saved(){},
      nextNumber:()=>window.__slow?new Promise(r=>{window.__release=()=>r(window.__next);}):Promise.resolve(window.__next)};
    document.getElementById('loginView').hidden=true;document.getElementById('appView').hidden=false;
    for(const id of ['catalogView','historyView'])document.getElementById(id).hidden=true;
    document.getElementById('receiptFrame').src='boletas.html';
  });
  const f=page.frameLocator('#receiptFrame');
  await page.waitForFunction(()=>{const d=document.getElementById('receiptFrame').contentDocument;return d?.getElementById('exportBtn')&&!d.getElementById('exportBtn').disabled;});
  const fill=async()=>{await f.locator('#customer').fill('CLIENTE');await f.locator('#docType').selectOption('NONE');await f.locator('[data-inventory="0"]').click();await f.locator('#price-0').waitFor();};
  await fill();await page.evaluate(()=>{window.__slow=true;});
  const download=page.waitForEvent('download');await f.locator('#exportBtn').click();await download;
  await page.waitForFunction(()=>document.getElementById('receiptFrame').contentDocument.getElementById('customer').value==='');
  assert.equal(await f.locator('#number').inputValue(),'111','muestra el número siguiente mientras responde la base');
  assert.equal(await f.locator('#exportBtn').isDisabled(),false,'los botones no esperan a la consulta del número');
  await page.evaluate(()=>window.__release());
  await fill();await page.evaluate(()=>{window.__fail='Una unidad seleccionada ya se vendió o no existe.';});
  await f.locator('#exportBtn').click();
  await page.waitForFunction(()=>!document.getElementById('receiptFrame').contentDocument.getElementById('errorBox').hidden);
  assert.match(await f.locator('#toast').textContent(),/ya se vendió/,'el error del servidor también aparece como aviso');
  assert.deepEqual(errors,[]);
});
