// Prueba de navegador de «Ingresar mercadería»: el código de la caja (cámara o lector USB) abre la compra de lo que llegó
// (unidades, costo en soles o dólares, tipo de cambio, proveedor) y la registra como «Nueva compra» en Compras.
// Usa la app real de dist/ con un cliente de Supabase simulado en memoria. Se omite si Playwright no está instalado.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execSync}=require('node:child_process');
function loadPlaywright(){
  try{return require('playwright');}catch{}
  try{return require(path.join(execSync('npm root -g',{encoding:'utf8'}).trim(),'playwright'));}catch{return null;}
}
const playwright=loadPlaywright();
const ROOT=path.join(__dirname,'..','dist');
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.svg':'image/svg+xml'};
const executablePath=process.env.PLAYWRIGHT_CHROMIUM||(fs.existsSync('/opt/pw-browsers/chromium')?'/opt/pw-browsers/chromium':undefined);
let server,browser,base;
test.before(async()=>{
  if(!playwright)return;
  server=http.createServer((req,res)=>{const file=path.join(ROOT,decodeURIComponent(req.url.split('?')[0]));fs.readFile(file,(error,body)=>{if(error){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':TYPES[path.extname(file)]||'application/octet-stream'});res.end(body);});});
  await new Promise(resolve=>server.listen(0,resolve));base=`http://localhost:${server.address().port}`;
  browser=await playwright.chromium.launch(executablePath?{executablePath}:{});
});
test.after(async()=>{await browser?.close();server?.close();});
const skip=!playwright&&'Playwright no está instalado';
const product=(id,name,extra={},row={})=>({id,data:{name,brand:'',category:'amd',image:'',...extra},web_price:500,published:true,managed:true,reference_stock:0,...row});
const unit=(id,productId,name)=>({id,compra_id:900,product_id:productId,nombre:name,costo:null,precio_venta:null,in_stock:true});
const PURCHASES=[{id:900,nombre:'Compra inicial',costo:0,moneda:'USD',tipo_cambio:3.72,proveedor:'Deltron'}];
const TODAY=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima'}).format(new Date());

async function open({products,units=[],chromium=browser,width=1100,theme}){
  const page=await (await chromium.newContext({viewport:{width,height:1000}})).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*supabase.co/**',r=>r.abort());
  await page.route('**/accounting.html',r=>r.fulfill({status:200,contentType:'text/html',body:'<html></html>'}));
  await page.goto(base+'/index.html');
  await page.evaluate(({products,units,purchases,theme})=>{
    if(theme)document.documentElement.dataset.theme=theme;
    const db=window.__db={ao_products:products,COMPRAS:purchases,COMPONENTES:units,ao_clients:[],ao_sales:[],ao_receipts:[],ao_suite_state:[]};
    window.__rpc=[];window.__updates=[];let next=1000;
    const free=id=>db.COMPONENTES.filter(c=>c.product_id===id&&c.precio_venta===null&&c.in_stock!==false).length;
    const addUnits=(p,cid,n)=>{for(let i=0;i<n;i++)db.COMPONENTES.push({id:next++,compra_id:cid,product_id:p.id,nombre:p.data.name,costo:null,precio_venta:null,in_stock:true});};
    const handlers={
      ao_suite_set_stock(a){const p=db.ao_products.find(p=>p.id===a.product_key);if(free(p.id)!==a.expected_quantity)throw Error('El stock cambió mientras editabas.');
        const delta=a.target_quantity-free(p.id);if(delta>0){const cid=next++;db.COMPRAS.push({id:cid,nombre:p.data.name,costo:delta*(a.cost_per_unit||0),proveedor:a.supplier,moneda:'PEN',tipo_cambio:0});addUnits(p,cid,delta);}
        p.managed=true;p.reference_stock=0;return {quantity:a.target_quantity};},
      ao_suite_create_purchase(a){const d=a.purchase_data;if(d.moneda==='USD'&&!(d.tipo_cambio>0))throw Error('Indica el tipo de cambio para la compra en dólares.');
        const cid=next++;db.COMPRAS.push({id:cid,...d});const p=db.ao_products.find(p=>p.id===a.product_key);addUnits(p,cid,a.quantity);p.managed=true;p.reference_stock=0;return {purchase_id:cid,quantity:a.quantity,product_id:a.product_key};},
      ao_suite_create_product(a){const id=next++;db.ao_products.push({id,...a.product_data,managed:true,reference_stock:0});return {product_id:id,quantity:a.quantity,purchase_id:null};}};
    const client={
      from:t=>({select:()=>({order:()=>({range:async start=>({data:start===0?structuredClone(db[t]||[]):[],error:null})})}),
        update:payload=>({eq:async(col,value)=>{window.__updates.push({table:t,payload:structuredClone(payload),value});const row=db[t].find(r=>String(r[col])===String(value));Object.assign(row,structuredClone(payload));return {error:null};}})}),
      rpc:async(name,args)=>{
        if(name==='ao_catalog_snapshot')return {data:{productos:db.ao_products.filter(p=>p.published).map(p=>({...p.data,id:p.id,price:p.web_price,stock:p.managed?free(p.id):Number(p.reference_stock||0)}))},error:null};
        window.__rpc.push({name,args:structuredClone(args)});try{return {data:handlers[name](args),error:null};}catch(e){return {data:null,error:{message:e.message}};}}};
    document.getElementById('loginView').hidden=true;document.getElementById('appView').hidden=false;
    for(const view of ['editorView','accountingView'])document.getElementById(view).hidden=true;
    for(const page of document.querySelectorAll('#appView>.page'))page.hidden=page.id!=='stockView';
    window.__ready=window.AOSuite.initialize(client,{role:'owner'}).then(()=>window.AOSuite.navigate('stock'));
  },{products,units,purchases:PURCHASES,theme});
  await page.evaluate(()=>window.__ready);
  return {page,errors,
    rows:()=>page.$$eval('#scanList .stock-row',rows=>rows.map(r=>r.querySelector('strong').textContent+' | '+r.querySelector('.stock-count').textContent)),
    type:async code=>{await page.fill('#scanCode',code);await page.press('#scanCode','Enter');},
    ticket:()=>page.locator('#receiveForm:not([hidden])').waitFor(),
    calls:name=>page.evaluate(name=>window.__rpc.filter(c=>c.name===name).map(c=>c.args),name)};
}
const register=async page=>{await page.click('#receiveSave');await page.waitForFunction(()=>document.getElementById('receiveForm').hidden);};

test('Un código conocido (lector USB + Enter) abre la etiqueta y registra la compra en dólares como en Compras',{skip},async()=>{
  const s=await open({products:[product(1,'B850-E ASUS TUF WIFI',{brand:'ASUS',category:'placa-am5',barcodes:['4711387912345']}),product(2,'RYZEN 7 7800X3D')],units:[unit(1,1,'B850-E ASUS TUF WIFI'),unit(2,2,'RYZEN 7 7800X3D'),unit(3,2,'RYZEN 7 7800X3D')]});
  assert.deepEqual(await s.rows(),['RYZEN 7 7800X3D | 2 unidades','B850-E ASUS TUF WIFI | 1 unidad'],'tu stock, de más a menos');
  assert.equal(await s.page.textContent('#scanSummary'),'2 productos con 3 unidades');
  await s.type(' 4711 3879 12345 ');await s.ticket();
  assert.equal(await s.page.textContent('#receiveName'),'B850-E ASUS TUF WIFI');
  assert.equal(await s.page.textContent('#receiveCode span'),'4 711387 912345','el código se muestra como en la caja');
  assert.equal(await s.page.locator('#receiveCode svg rect').count()>20,true,'con sus barras');
  assert.match(await s.page.textContent('#receiveStock'),/Tienes 1 unidad en stock\s*Quedarán 2 unidades/);
  assert.equal(await s.page.inputValue('#receiveCategory'),'Placa madre','la categoría de Compras sale de la del producto');
  assert.equal(await s.page.inputValue('#receiveDate'),TODAY);
  assert.equal(await s.page.inputValue('#receiveRate'),'3.72','el tipo de cambio parte del último usado en Compras');
  await s.page.click('[data-step="1"]');
  await s.page.check('input[name="receiveCurrency"][value="USD"]',{force:true});
  assert.equal(await s.page.isVisible('#receiveRateField'),true);
  await s.page.fill('#receiveCost','300');await s.page.fill('#receiveRate','3.5');await s.page.fill('#receiveSupplier','Memory Kings');
  assert.equal(await s.page.textContent('#receiveTotal'),'Costo en soles: S/ 1,050.00, S/ 525.00 por unidad.');
  assert.match(await s.page.textContent('#receiveStock'),/Quedarán 3 unidades/);
  await register(s.page);
  assert.deepEqual(await s.calls('ao_suite_create_purchase'),[{request_key:(await s.calls('ao_suite_create_purchase'))[0].request_key,product_key:1,quantity:2,purchase_data:{nombre:'B850-E ASUS TUF WIFI',costo:300,moneda:'USD',tipo_cambio:3.5,impuesto:0,proveedor:'Memory Kings',fecha_compra:TODAY,categoria:'Placa madre'}}]);
  assert.match(await s.page.textContent('#scanResult'),/B850-E ASUS TUF WIFI ahora tiene 3 unidades en stock\. La compra quedó registrada en Compras\./);
  assert.match(await s.page.textContent('#receiveLog'),/B850-E ASUS TUF WIFI\s*2 unidades, S\/ 1,050\.00\s*US\$ 300\.00 con tipo de cambio 3\.5/);
  assert.deepEqual(await s.rows(),['B850-E ASUS TUF WIFI | 3 unidades','RYZEN 7 7800X3D | 2 unidades'],'tu stock se actualiza solo');
  // La siguiente caja recuerda la moneda, el tipo de cambio y el proveedor.
  await s.page.click('[data-scan-add="2"]');await s.ticket();
  assert.equal(await s.page.isChecked('input[name="receiveCurrency"][value="USD"]'),true);
  assert.equal(await s.page.inputValue('#receiveRate'),'3.5');assert.equal(await s.page.inputValue('#receiveSupplier'),'Memory Kings');
  assert.equal(await s.page.textContent('#receiveCode'),'Sin código vinculado');
  assert.deepEqual(s.errors,[]);
});

test('En dólares sin tipo de cambio no se registra y se dice qué falta; sin costo se registra en S/ 0.00',{skip},async()=>{
  const s=await open({products:[product(1,'KINGSTON FURY 32GB',{barcodes:['0740617312345']})]});
  await s.type('740617312345');await s.ticket();
  assert.equal(await s.page.textContent('#receiveName'),'KINGSTON FURY 32GB','un UPC de 12 dígitos encuentra su EAN-13');
  await s.page.check('input[name="receiveCurrency"][value="USD"]',{force:true});await s.page.fill('#receiveRate','');await s.page.fill('#receiveCost','120');
  assert.match(await s.page.textContent('#receiveTotal'),/US\$ 120\.00\. Falta el tipo de cambio/);
  await s.page.click('#receiveSave');
  assert.match(await s.page.textContent('#receiveMessage'),/Indica el tipo de cambio/);
  assert.equal(await s.page.evaluate(()=>document.activeElement.id),'receiveRate');
  assert.deepEqual(await s.calls('ao_suite_create_purchase'),[]);
  await s.page.check('input[name="receiveCurrency"][value="PEN"]',{force:true});await s.page.fill('#receiveCost','');
  assert.match(await s.page.textContent('#receiveTotal'),/Sin costo por ahora: quedará en S\/ 0\.00/);
  await register(s.page);
  const [call]=await s.calls('ao_suite_create_purchase');assert.equal(call.purchase_data.costo,0);assert.equal(call.purchase_data.moneda,'PEN');assert.equal(call.purchase_data.tipo_cambio,0);
});

test('Un producto con cantidad del catálogo anterior la conserva: se activa antes de registrar la compra',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 5 5600',{barcodes:['0730143312345']},{managed:false,reference_stock:2})]});
  assert.deepEqual(await s.rows(),['RYZEN 5 5600 | 2 unidades']);
  await s.type('0730143312345');await s.ticket();
  assert.match(await s.page.textContent('#receiveStock'),/Tienes 2 unidades en stock\s*Quedarán 3 unidades/);
  await s.page.fill('#receiveCost','450');await register(s.page);
  assert.deepEqual(await s.page.evaluate(()=>window.__rpc.map(c=>c.name)),['ao_suite_set_stock','ao_suite_create_purchase'],'primero activa las 2 del catálogo anterior');
  assert.deepEqual(await s.rows(),['RYZEN 5 5600 | 3 unidades']);
});

test('Un código nuevo se vincula una vez al producto elegido y abre la etiqueta; la próxima vez se reconoce solo',{skip},async()=>{
  const s=await open({products:[product(1,'PLACA ASUS TUF B850M-E',{brand:'ASUS',specs:{Socket:'AM5'}}),product(2,'RYZEN 7 7800X3D',{brand:'AMD'})]});
  await s.type('4711387999999');
  await s.page.locator('#scanPick').waitFor();
  assert.match(await s.page.textContent('#scanResult'),/El código 4 711387 999999 todavía no está en tu web/);
  await s.page.fill('#scanPick','b850');
  assert.deepEqual(await s.page.$$eval('#scanMatches li',l=>l.map(x=>x.querySelector('span').firstChild.textContent)),['PLACA ASUS TUF B850M-E']);
  await s.page.click('[data-scan-link="1"]');await s.ticket();
  const updates=await s.page.evaluate(()=>window.__updates);
  assert.deepEqual(updates[0].payload.data,{name:'PLACA ASUS TUF B850M-E',brand:'ASUS',category:'amd',image:'',specs:{Socket:'AM5'},barcodes:['4711387999999']},'solo se agrega el código');
  assert.equal(await s.page.textContent('#receiveCode span'),'4 711387 999999');
  await register(s.page);
  await s.type('4711387999999');await s.ticket();
  assert.equal((await s.page.evaluate(()=>window.__updates)).length,1,'la segunda vez no vuelve a preguntar');
  assert.deepEqual(s.errors,[]);
});

test('«Es un producto nuevo» crea la ficha sin unidades y vuelve a la etiqueta para registrar la compra',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',{barcodes:['0730143314123']})]});
  await s.type('8806094912345');await s.page.click('[data-scan-new]');
  await s.page.locator('#productDialog[open]').waitFor();
  assert.equal(await s.page.inputValue('#productBarcodes'),'8806094912345');
  assert.equal(await s.page.isVisible('#productIncoming'),false,'las unidades se registran después, con su moneda');
  assert.equal(await s.page.textContent('#productTitle'),'Producto nuevo para tu web');
  await s.page.fill('#productName','SAMSUNG 990 EVO 1TB');await s.page.fill('#productPrice','420');
  await s.page.click('#productForm [type="submit"]');
  await s.ticket();
  assert.equal(await s.page.textContent('#receiveName'),'SAMSUNG 990 EVO 1TB');
  assert.match(await s.page.textContent('#receiveStock'),/Tienes 0 unidades en stock\s*Quedarán 1 unidad/);
  const [created]=await s.calls('ao_suite_create_product');assert.equal(created.quantity,0);assert.deepEqual(created.product_data.data.barcodes,['8806094912345']);
  await register(s.page);
  assert.deepEqual(await s.rows(),['SAMSUNG 990 EVO 1TB | 1 unidad'],'el producto nuevo ya está en tu stock');
  // Un código de otro producto no se puede repetir.
  await s.page.evaluate(()=>window.AOSuite.scan.newProduct('730143314123'));
  await s.page.fill('#productName','OTRO');await s.page.fill('#productPrice','10');
  await s.page.click('#productForm [type="submit"]');
  await s.page.waitForFunction(()=>/ya es de «RYZEN 7 7800X3D»/.test(document.getElementById('productMessage').textContent));
  assert.deepEqual(s.errors,[]);
});

test('En el celular nada se sale de la pantalla, e «Ingresar» en la lista abre la etiqueta sin escanear',{skip},async()=>{
  const s=await open({width:340,products:[product(1,'SERVICIO DE ARMADO Y CONFIGURACIÓN DE COMPUTADORA GAMER COMPLETA',{barcodes:['4711387912345']})],units:[unit(1,1,'X')]});
  assert.ok(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'sin desplazamiento horizontal');
  await s.page.click('[data-scan-add="1"]');await s.ticket();
  assert.ok(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'la etiqueta tampoco se sale');
  await register(s.page);
  assert.equal((await s.calls('ao_suite_create_purchase')).length,1);
});

test('Cámara: con el lector del navegador (BarcodeDetector) el código se lee solo y la cámara se apaga',{skip},async()=>{
  const s=await open({products:[product(1,'PLACA ASUS TUF B850M-E',{barcodes:['4711387912345']})]});
  await s.page.evaluate(()=>{
    navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');c.width=64;c.height=48;const g=c.getContext('2d');setInterval(()=>{g.fillStyle='#'+Math.floor(Math.random()*4095).toString(16).padStart(3,'0');g.fillRect(0,0,64,48);},50);const stream=c.captureStream(10);window.__stream=stream;return stream;};
    let calls=0;window.BarcodeDetector=class{static async getSupportedFormats(){return ['ean_13','qr_code'];}async detect(){return ++calls<3?[]:[{rawValue:'4711387912345'}];}};
  });
  await s.page.click('#scanStart');await s.ticket();
  assert.equal(await s.page.textContent('#receiveName'),'PLACA ASUS TUF B850M-E');
  assert.equal(await s.page.isVisible('#scanPanel'),false,'el panel de la cámara se cierra');
  assert.ok(await s.page.evaluate(()=>window.__stream.getTracks().every(t=>t.readyState==='ended')),'la cámara queda apagada');
});

test('Cámara: sin permiso se explica qué hacer y se puede escribir el código',{skip},async()=>{
  const s=await open({products:[product(1,'X')]});
  await s.page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denegado','NotAllowedError');};window.BarcodeDetector=class{static async getSupportedFormats(){return ['ean_13'];}};});
  await s.page.click('#scanStart');
  await s.page.waitForFunction(()=>/No se dio permiso para usar la cámara/.test(document.getElementById('scanStatus').textContent));
  assert.equal(await s.page.isVisible('#scanVideo'),false);
  assert.equal(await s.page.isDisabled('#scanStart'),false,'se puede volver a intentar');
});

// EAN-13 dibujado como video de la cámara: sin BarcodeDetector (Chromium en Linux) se usa ZXing, como en Chrome de Windows o Safari.
function ean13Video(code){
  const L=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const G=L.map(p=>[...p].reverse().map(b=>b==='1'?'0':'1').join('')),R=L.map(p=>[...p].map(b=>b==='1'?'0':'1').join(''));
  const PARITY=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
  const d=[...code].map(Number),bits='101'+d.slice(1,7).map((n,i)=>(PARITY[d[0]][i]==='L'?L:G)[n]).join('')+'01010'+d.slice(7).map(n=>R[n]).join('')+'101';
  const W=640,H=480,M=5,x0=Math.floor((W-bits.length*M)/2),Y=Buffer.alloc(W*H,235);
  for(let y=90;y<390;y++)for(let i=0;i<bits.length;i++)if(bits[i]==='1')Y.fill(16,y*W+x0+i*M,y*W+x0+(i+1)*M);
  const chroma=Buffer.alloc(W*H/4,128),frame=Buffer.concat([Buffer.from('FRAME\n'),Y,chroma,chroma]);
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'scan-')),'ean13.y4m');
  fs.writeFileSync(file,Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F5:1 Ip A1:1 C420jpeg\n`),frame,frame]));return file;
}
test('Cámara: el lector incluido (ZXing) lee un EAN-13 real de la cámara',{skip},async()=>{
  const digits='471138791234',sum=[...digits].reduce((t,n,i)=>t+Number(n)*(i%2?3:1),0),code=digits+String((10-sum%10)%10);
  const chromium=await playwright.chromium.launch({...(executablePath?{executablePath}:{}),args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-video-capture='+ean13Video(code)]});
  try{
    const s=await open({chromium,products:[product(1,'PLACA ASUS TUF B850M-E',{barcodes:[code]})]});
    assert.equal(await s.page.evaluate(()=>'BarcodeDetector' in window),false,'esta prueba usa el lector incluido');
    await s.page.click('#scanStart');
    await s.page.locator('#receiveForm:not([hidden])').waitFor({timeout:20000});
    assert.equal(await s.page.textContent('#receiveCode span'),code.slice(0,1)+' '+code.slice(1,7)+' '+code.slice(7));
    assert.equal(await s.page.isVisible('#scanPanel'),false);
    assert.deepEqual(s.errors,[]);
  }finally{await chromium.close();}
});

test('El menú abre «Ingresar mercadería» y al ir a otra sección la cámara se apaga',{skip},async()=>{
  const s=await open({products:[product(1,'X',{barcodes:['4711387912345']})]});
  await s.page.click('[data-view="catalog"]');
  assert.equal(await s.page.isVisible('#stockView'),false);
  await s.page.click('[data-view="stock"]');
  await s.page.waitForFunction(()=>!document.getElementById('stockView').hidden);
  assert.equal(await s.page.textContent('#suiteHeading'),'Ingresar mercadería');
  assert.equal(await s.page.getAttribute('[data-view="stock"]','aria-current'),'page');
  await s.page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');const g=c.getContext('2d');setInterval(()=>g.fillRect(0,0,9,9),50);window.__stream=c.captureStream(10);return window.__stream;};window.BarcodeDetector=class{static async getSupportedFormats(){return ['ean_13'];}async detect(){return [];}};});
  await s.page.click('#scanStart');await s.page.waitForFunction(()=>window.__stream);
  await s.page.click('[data-view="catalog"]');
  assert.ok(await s.page.evaluate(()=>window.__stream.getTracks().every(t=>t.readyState==='ended')),'la cámara queda apagada al salir');
  assert.deepEqual(s.errors,[]);
});

// Foto real de una caja (Ryzen 5 9600X con la etiqueta de Amazon X004LZKL9B, al revés y con texto alrededor).
const PHOTO=path.join(__dirname,'fixtures','ryzen-9600x-amazon.jpg');
test('«Usa una foto» lee la etiqueta de Amazon de una foto real y, la primera vez, explica que hay que elegir el producto',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 5 9600X',{brand:'AMD'}),product(2,'RYZEN 7 7800X3D',{brand:'AMD'})]});
  assert.equal(await s.page.evaluate(()=>'BarcodeDetector' in window),false,'usa el lector incluido, como Safari en el iPhone');
  await s.page.setInputFiles('#scanPhotoFile',PHOTO);
  await s.page.locator('#scanPick').waitFor({timeout:20000});
  assert.match(await s.page.textContent('#scanResult'),/El código X004LZKL9B es la etiqueta de Amazon de esta caja\. No dice qué producto es: elígelo una vez/);
  await s.page.fill('#scanPick','9600');await s.page.click('[data-scan-link="1"]');await s.ticket();
  assert.equal(await s.page.textContent('#receiveName'),'RYZEN 5 9600X');
  assert.equal(await s.page.textContent('#receiveCode span'),'X004LZKL9B');
  await register(s.page);
  // La siguiente caja igual se reconoce sola.
  await s.page.setInputFiles('#scanPhotoFile',PHOTO);await s.ticket();
  assert.equal(await s.page.textContent('#receiveName'),'RYZEN 5 9600X');
  assert.deepEqual(s.errors,[]);
});
test('Cámara: la misma caja se lee en vivo aunque el código no esté al centro del cuadro',{skip},async()=>{
  const W=640,H=480,{execFileSync}=require('node:child_process');
  // La foto como video de la cámara (YUV 4:2:0), sin dependencias: se convierte con el propio Chromium.
  const helper=await browser.newPage();await helper.goto(base+'/index.html');
  const yuv=await helper.evaluate(async({src,W,H})=>{const img=new Image();img.src=src;await img.decode();const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');g.drawImage(img,0,0,W,H);const d=g.getImageData(0,0,W,H).data;
    const Y=new Array(W*H),U=new Array(W*H/4).fill(128);for(let i=0;i<W*H;i++)Y[i]=Math.round(.299*d[i*4]+.587*d[i*4+1]+.114*d[i*4+2]);return Y;},{src:'data:image/jpeg;base64,'+fs.readFileSync(PHOTO).toString('base64'),W,H});
  await helper.close();
  const frame=Buffer.concat([Buffer.from('FRAME\n'),Buffer.from(yuv),Buffer.alloc(W*H/2,128)]);
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'scan-')),'box.y4m');fs.writeFileSync(file,Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F5:1 Ip A1:1 C420jpeg\n`),frame,frame]));
  const chromium=await playwright.chromium.launch({...(executablePath?{executablePath}:{}),args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-video-capture='+file]});
  try{
    const s=await open({chromium,products:[product(1,'RYZEN 5 9600X',{barcodes:['X004LZKL9B']})]});
    await s.page.click('#scanStart');
    await s.page.locator('#receiveForm:not([hidden])').waitFor({timeout:20000});
    assert.equal(await s.page.textContent('#receiveName'),'RYZEN 5 9600X');
  }finally{await chromium.close();}
});
