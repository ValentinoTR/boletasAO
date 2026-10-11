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
const product=(id,name,reference,managed=false,price=500)=>({id,data:{name,brand:'',category:'x',image:''},web_price:price,published:true,managed,reference_stock:reference});
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
  const pick=async()=>{await page.evaluate(()=>{window.__pick=window.AOSuite.pickInventory({inventory:[]},0);});await page.locator('#inventoryDialog[open]').waitFor();};
  return {page,errors,pick,selected:()=>page.$$eval('#inventorySelected .selected-part',e=>e.length),message:()=>page.textContent('#inventoryMessage')};
}
const skip=!playwright&&'Playwright no está instalado';

test('Un producto de la web sin unidades se agrega de un clic, sin formulario',{skip},async()=>{
  const s=await open({products:[product(1,'SSD NVMe 1 TB',0,true,300)]});
  await s.pick();await s.page.fill('#inventorySearch','ssd');await s.page.click('[data-use-catalogue="1"]');
  await s.page.waitForFunction(()=>document.querySelectorAll('#inventorySelected .selected-part').length===1);
  assert.equal(await s.page.inputValue('[data-part-price="0"]'),'300.00');assert.equal(await s.page.inputValue('#externalName'),'');
  await s.page.click('#inventoryConfirm');
  assert.deepEqual(await s.page.evaluate(()=>window.__pick),[{source:'external',name:'SSD NVMe 1 TB',supplier:'',cost:'0.00',price:'300.00'}]);
  assert.deepEqual(s.errors,[]);
});

test('Un producto del catálogo anterior se registra en el stock y la venta usa una de sus unidades',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 5 5500',1,false,340)]});
  await s.pick();await s.page.fill('#inventorySearch','ryzen');
  assert.match(await s.page.textContent('#inventoryCatalogue'),/se registrarán en tu stock y esta venta descontará una/);
  await s.page.dblclick('[data-activate-stock="1"]');
  await s.page.waitForFunction(()=>document.querySelectorAll('#inventorySelected .selected-part').length===1);
  const calls=await s.page.evaluate(()=>window.__rpc.filter(c=>c.name==='ao_suite_set_stock').map(c=>c.args));
  assert.equal(calls.length,1,'un doble clic envía una sola activación');
  assert.equal(calls[0].target_quantity,1);assert.equal(calls[0].expected_quantity,0);assert.equal(calls[0].cost_per_unit,0);
  await s.page.click('#inventoryConfirm');
  const parts=await s.page.evaluate(()=>window.__pick);
  assert.equal(parts.length,1);assert.equal(parts[0].source,'stock');assert.equal(parts[0].price,'340.00');
  // La unidad vendida es la del producto: al emitir, su stock publicado baja.
  assert.equal(await s.page.evaluate(id=>window.__db.COMPONENTES.find(c=>c.id===id).product_id,parts[0].id),1);
});

test('Unidades importadas sin vincular se vinculan al agregar el producto, conservando su costo',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 5 5500',1,false,340)],purchases:[{id:7,nombre:'RYZEN 5 5500',costo:250,moneda:'PEN',tipo_cambio:0}],units:[{id:70,compra_id:7,product_id:null,nombre:'Ryzen 5  5500',costo:null,precio_venta:null,in_stock:true}]});
  await s.pick();await s.page.fill('#inventorySearch','ryzen');
  assert.match(await s.page.textContent('#inventoryUnits'),/sin vincular a tu web: no descuenta su stock/);
  assert.match(await s.page.textContent('#inventoryCatalogue'),/1 unidad\(es\) en Compras sin vincular/);
  await s.page.click('[data-activate-stock="1"]');
  await s.page.waitForFunction(()=>document.querySelectorAll('#inventorySelected .selected-part').length===1);
  const names=await s.page.evaluate(()=>window.__rpc.map(c=>c.name));
  assert.deepEqual(names,['ao_suite_link_stock'],'vincula en lugar de crear unidades nuevas sin costo');
  await s.page.click('#inventoryConfirm');
  assert.equal((await s.page.evaluate(()=>window.__pick))[0].id,70);
});

test('Escribir a mano un producto de la web con stock avisa antes de venderlo como compra de otra tienda',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 5 5500',1,false,340)]});
  await s.pick();await s.page.fill('#inventorySearch','ryzen');
  const rows=await s.page.$$eval('#inventoryCatalogue .catalogue-row strong:first-child',e=>e.map(x=>x.textContent));
  assert.deepEqual(rows,['RYZEN 5 5500','«ryzen»'],'la compra de otra tienda va después del producto de la web');
  await s.page.fill('#externalName','ryzen 5 5500');await s.page.fill('#externalPrice','340');
  await s.page.click('#inventoryConfirm');
  assert.match(await s.message(),/está en tu web con 1 unidad/);assert.equal(await s.selected(),0);
  assert.equal(await s.page.$eval('#inventoryDialog',d=>d.open),true);
  await s.page.click('#inventoryConfirm');
  assert.equal((await s.page.evaluate(()=>window.__pick))[0].source,'external','al insistir se vende como compra de otra tienda');
});

test('Sin costo: solo hace falta el precio; coma decimal; costo inválido se rechaza',{skip},async()=>{
  const s=await open({products:[]});
  await s.pick();
  await s.page.fill('#externalName','Monitor');await s.page.fill('#externalPrice','1800,50');await s.page.press('#externalPrice','Enter');
  assert.equal(await s.selected(),1);assert.equal(await s.page.inputValue('[data-part-price="0"]'),'1800.50');
  assert.match(await s.page.textContent('#inventorySelected'),/sin costo indicado/);
  await s.page.fill('#externalName','Cable');await s.page.fill('#externalPrice','10');await s.page.fill('#externalCost','S/ 8');await s.page.click('#addExternal');
  assert.match(await s.message(),/importe válido/);assert.equal(await s.selected(),1);
});

test('Una unidad que ya no está disponible no se puede usar en la venta',{skip},async()=>{
  const s=await open({products:[product(1,'SSD',0,true,300)],purchases:[{id:7,nombre:'SSD',costo:200,moneda:'PEN',tipo_cambio:0}],units:[{id:70,compra_id:7,product_id:1,nombre:'SSD',costo:null,precio_venta:null,in_stock:true}]});
  await s.page.evaluate(()=>{window.__pick=window.AOSuite.pickInventory({inventory:[{source:'stock',id:70,name:'SSD',price:'300.00'}]},0);});
  await s.page.locator('#inventoryDialog[open]').waitFor();
  await s.page.evaluate(()=>{window.__db.COMPONENTES[0].precio_venta=300;});await s.page.evaluate(()=>window.AOSuite.refresh());
  await s.page.fill('#inventorySearch','x');await s.page.fill('#inventorySearch','');
  assert.match(await s.page.textContent('#inventorySelected'),/ya no está disponible/);
  await s.page.click('#inventoryConfirm');
  assert.match(await s.message(),/ya no está disponible/);assert.equal(await s.page.$eval('#inventoryDialog',d=>d.open),true);
});

test('Mientras se agrega un producto, otro «Agregar» espera su turno',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 5 5500',1),product(2,'RYZEN 7 7700X',1)],latency:300});
  await s.pick();await s.page.fill('#inventorySearch','ryzen');
  await s.page.click('[data-activate-stock="1"]');await s.page.click('[data-activate-stock="2"]');
  assert.match(await s.message(),/Hay otro producto agregándose/);
  await s.page.waitForFunction(()=>document.querySelectorAll('#inventorySelected .selected-part').length===1);
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
  await s.page.click('#autoStockDialog .secondary');await new Promise(r=>setTimeout(r,800));
  const sent=await s.page.evaluate(()=>window.__rpc.length);
  assert.ok(sent<=2,'se detiene tras el producto en curso ('+sent+' de 5)');
  assert.match(await s.page.textContent('#suiteToast'),/Activación detenida/);
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
