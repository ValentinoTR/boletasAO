// Inventario real dentro de la app y su iframe, sin conexiones a producción.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{execSync}=require('node:child_process');
function loadPlaywright(){
  try{return require('playwright');}catch{}
  try{return require(path.join(execSync('npm root -g',{encoding:'utf8'}).trim(),'playwright'));}catch{return null;}
}
const playwright=loadPlaywright(),ROOT=path.join(__dirname,'..','dist');
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.svg':'image/svg+xml'};
let server,browser,base;
test.before(async()=>{
  if(!playwright)return;
  server=http.createServer((req,res)=>{
    const file=path.resolve(ROOT,'.'+decodeURIComponent(req.url.split('?')[0]));
    if(!file.startsWith(ROOT+path.sep)){res.writeHead(403);res.end();return;}
    fs.readFile(file,(error,body)=>{if(error){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':TYPES[path.extname(file)]||'application/octet-stream'});res.end(body);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
  const executablePath=process.env.PLAYWRIGHT_CHROMIUM||(fs.existsSync('/opt/pw-browsers/chromium')?'/opt/pw-browsers/chromium':undefined);
  browser=await playwright.chromium.launch(executablePath?{executablePath}:{});
});
test.after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
const skip=!playwright&&'Playwright no está instalado';
const ASUS='ASUS TUF B550-PLUS WIFI II',SSD='SSD KINGSTON NV2 1TB';
const component=(id,name,sale=null,extra={})=>({id:String(id),name,sale,costo:300,saleCost:null,inStock:true,productId:null,sugerido:700,fechaVenta:null,compradorNombre:'',compradorDocumento:'',...extra});

test('Inventario sigue el stock público, conserva ASUS en 1 y descarta cantidades antiguas cuando falla la consulta',{skip},async t=>{
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  t.after(()=>context.close());
  // Solo se permite el servidor local; Supabase y cualquier otro destino quedan bloqueados.
  await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/index.html');
  await page.evaluate(({asus,ssd})=>{
    const products=[
      {id:1,data:{name:asus,brand:'ASUS',category:'placa-am4',image:''},web_price:700,published:true,managed:false,reference_stock:9},
      {id:2,data:{name:ssd,brand:'KINGSTON',category:'almacenamiento',image:''},web_price:300,published:true,managed:false,reference_stock:8}
    ];
    const units=[
      {id:70,compra_id:7,nombre:asus,product_id:null,costo:300,precio_venta:700,in_stock:true},
      {id:71,compra_id:7,nombre:asus,product_id:null,costo:300,precio_venta:null,in_stock:true},
      {id:72,compra_id:7,nombre:asus,product_id:null,costo:300,precio_venta:null,in_stock:true},
      {id:73,compra_id:7,nombre:ssd,product_id:2,costo:100,precio_venta:null,in_stock:true},
      {id:74,compra_id:7,nombre:ssd,product_id:2,costo:100,precio_venta:null,in_stock:true},
      {id:75,compra_id:7,nombre:ssd,product_id:2,costo:100,precio_venta:null,in_stock:true},
      {id:76,compra_id:7,nombre:'Compra sin ficha pública',product_id:null,costo:50,precio_venta:null,in_stock:true}
    ];
    const db=window.__db={ao_products:products,COMPRAS:[{id:7,nombre:'Compra histórica',costo:1250,moneda:'PEN',tipo_cambio:0}],COMPONENTES:units,ao_clients:[],ao_sales:[],ao_receipts:[],ao_suite_state:[]};
    // El snapshot se mantiene independiente de las compras y reference_stock.
    window.__snapshot={productos:products.map((p,i)=>({...p.data,id:p.id,price:p.web_price,stock:i===0?1:2}))};
    window.__snapshotError=false;window.__calls=[];
    const client={from:table=>({select:()=>({order:()=>({range:async start=>({data:start===0?structuredClone(db[table]||[]):[],error:null})})})}),rpc:async name=>{
      window.__calls.push(name);
      if(name!=='ao_catalog_snapshot')throw Error('La prueba solo permite leer el stock público');
      return window.__snapshotError?{data:null,error:{message:'No se pudo consultar el catálogo público'}}:{data:structuredClone(window.__snapshot),error:null};
    }};
    document.getElementById('loginView').hidden=true;document.getElementById('appView').hidden=false;document.getElementById('accountingView').hidden=false;
    window.__ready=window.AOSuite.initialize(client,{role:'owner'});
  },{asus:ASUS,ssd:SSD});
  await page.evaluate(()=>window.__ready);
  await page.waitForFunction(()=>document.getElementById('accountingFrame').contentWindow?.renderAll);
  const frame=page.frames().find(frame=>new URL(frame.url()).pathname==='/accounting.html');
  assert.ok(frame,'se carga el iframe real de accounting.html');
  // Espera la inicialización de auth antes de inyectar compras locales para que no las borre.
  await frame.waitForFunction(()=>document.getElementById('sync-status-text').textContent==='Inicia sesión para ver y guardar los datos.');
  await frame.evaluate(async()=>{await db.auth.getSession();await new Promise(resolve=>setTimeout(resolve,0));});
  await frame.evaluate(components=>{
    combos=[{id:'7',name:'Compra histórica',cost:1250,currency:'PEN',rate:0,tax:0,createdAt:'2026-10-01',proveedor:'Proveedor local',fechaCompra:'2026-10-01',numeroPedido:'',courier:'',pesoKg:0,envioKg:0,taxUsa:0,impPeru:0,otros:0,categoria:'',components}];
    setAppVisible(true);setView('inventario');renderAll();
  },[
    component(70,ASUS,700),component(71,ASUS),component(72,ASUS),
    component(73,SSD,null,{productId:2,costo:100}),component(74,SSD,null,{productId:2,costo:100}),component(75,SSD,null,{productId:2,costo:100}),
    component(76,'Compra sin ficha pública',null,{costo:50})
  ]);
  const rows=()=>frame.$$eval('#tabla-inventario tbody tr',rows=>rows.map(row=>({name:row.querySelector('td .strong')?.textContent,stock:row.querySelectorAll('td')[1]?.textContent.trim()})));
  assert.equal(await frame.textContent('#inv-productos'),'2');
  assert.equal(await frame.textContent('#inv-unidades'),'3');
  assert.deepEqual(await rows(),[{name:ASUS,stock:'1'},{name:SSD,stock:'2'}],'una venta histórica, compras sobrantes y fichas sin publicar no inflan el stock');
  assert.match(await frame.textContent('#inventory-status'),/Stock sincronizado con tu web principal.*2 productos.*3 unidades disponibles/);
  assert.deepEqual(errors,[]);

  await page.evaluate(async()=>{window.__snapshotError=true;await window.AOSuite.refresh().catch(()=>{});});
  for(const id of ['inv-productos','inv-unidades','inv-valor','inv-proyectada'])assert.equal(await frame.textContent('#'+id),'—','no presenta el conteo anterior como verificado');
  assert.match(await frame.textContent('#tabla-inventario tbody'),/Stock sin verificar/);
  assert.match(await frame.textContent('#inventory-status'),/No se pudo actualizar el stock de tu web/);
  assert.doesNotMatch(await frame.textContent('#tabla-inventario tbody'),/ASUS|KINGSTON/);

  await page.evaluate(async()=>{window.__snapshotError=false;window.__snapshot.productos[0].stock=0;await window.AOSuite.refresh();});
  assert.equal(await frame.textContent('#inv-productos'),'1');
  assert.equal(await frame.textContent('#inv-unidades'),'2');
  assert.deepEqual(await rows(),[{name:SSD,stock:'2'}],'ASUS agotado no reaparece por compras antiguas');
  assert.match(await frame.textContent('#inventory-status'),/1 producto.*2 unidades disponibles/);
  assert.deepEqual(await page.evaluate(()=>window.__calls),['ao_catalog_snapshot','ao_catalog_snapshot','ao_catalog_snapshot'],'la prueba no modifica datos ni stock');
  assert.deepEqual(errors,[]);
});
