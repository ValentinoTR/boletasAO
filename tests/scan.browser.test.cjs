// Prueba de navegador de «Escanear stock»: el código de la caja (cámara o lector USB) abre «Reponer» y suma unidades.
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
const product=(id,name,extra={})=>({id,data:{name,brand:'',category:'amd',image:'',...extra},web_price:500,published:true,managed:true,reference_stock:0});
const unit=(id,productId,name)=>({id,compra_id:900,product_id:productId,nombre:name,costo:null,precio_venta:null,in_stock:true});
const PURCHASES=[{id:900,nombre:'Compra inicial',costo:0,moneda:'PEN',tipo_cambio:0}];

async function open({products,units=[],chromium=browser,width=1100}){
  const page=await (await chromium.newContext({viewport:{width,height:1000}})).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*supabase.co/**',r=>r.abort());
  await page.route('**/accounting.html',r=>r.fulfill({status:200,contentType:'text/html',body:'<html></html>'}));
  await page.goto(base+'/index.html');
  await page.evaluate(({products,units,purchases})=>{
    const db=window.__db={ao_products:products,COMPRAS:purchases,COMPONENTES:units,ao_clients:[],ao_sales:[],ao_receipts:[],ao_suite_state:[]};
    window.__rpc=[];window.__updates=[];let next=1000;
    const free=id=>db.COMPONENTES.filter(c=>c.product_id===id&&c.precio_venta===null&&c.in_stock!==false).length;
    const handlers={ao_suite_set_stock(a){const p=db.ao_products.find(p=>p.id===a.product_key);if(free(p.id)!==a.expected_quantity)throw Error('El stock cambió mientras editabas.');
      const delta=a.target_quantity-free(p.id);if(delta>0){const cid=next++;db.COMPRAS.push({id:cid,nombre:p.data.name,costo:delta*(a.cost_per_unit||0),proveedor:a.supplier,moneda:'PEN',tipo_cambio:0});for(let i=0;i<delta;i++)db.COMPONENTES.push({id:next++,compra_id:cid,product_id:p.id,nombre:p.data.name,costo:null,precio_venta:null,in_stock:true});}
      return {quantity:a.target_quantity};}};
    const client={
      from:t=>({select:()=>({order:()=>({range:async start=>({data:start===0?structuredClone(db[t]||[]):[],error:null})})}),
        update:payload=>({eq:async(col,value)=>{window.__updates.push({table:t,payload:structuredClone(payload),value});const row=db[t].find(r=>String(r[col])===String(value));Object.assign(row,structuredClone(payload));return {error:null};}})}),
      rpc:async(name,args)=>{
        if(name==='ao_catalog_snapshot')return {data:{productos:db.ao_products.filter(p=>p.published).map(p=>({...p.data,id:p.id,price:p.web_price,stock:free(p.id)}))},error:null};
        window.__rpc.push({name,args});try{return {data:handlers[name](args),error:null};}catch(e){return {data:null,error:{message:e.message}};}}};
    document.getElementById('loginView').hidden=true;document.getElementById('appView').hidden=false;
    for(const page of document.querySelectorAll('#appView>.page'))page.hidden=page.id!=='stockView';
    window.__ready=window.AOSuite.initialize(client,{role:'owner'}).then(()=>window.AOSuite.navigate('stock'));
  },{products,units,purchases:PURCHASES});
  await page.evaluate(()=>window.__ready);
  return {page,errors,
    rows:()=>page.$$eval('#scanList .scan-row',rows=>rows.map(r=>r.querySelector('strong').textContent+' | '+r.querySelector('.pill').textContent)),
    type:async code=>{await page.fill('#scanCode',code);await page.press('#scanCode','Enter');},
    stockCalls:()=>page.evaluate(()=>window.__rpc.filter(c=>c.name==='ao_suite_set_stock').map(c=>c.args.product_key+':'+c.args.expected_quantity+'→'+c.args.target_quantity))};
}
const save=async page=>{await page.locator('#stockDialog[open]').waitFor();await page.click('#stockSave');await page.waitForFunction(()=>!document.getElementById('stockDialog').open);};

test('Un código ya vinculado (lector USB + Enter) abre «Reponer» con 1 unidad y suma al guardar',{skip},async()=>{
  const s=await open({products:[product(1,'PLACA ASUS TUF B850M-E',{barcodes:['4711387912345']}),product(2,'RYZEN 7 7800X3D')],units:[unit(1,1,'PLACA ASUS TUF B850M-E'),unit(2,2,'RYZEN 7 7800X3D'),unit(3,2,'RYZEN 7 7800X3D')]});
  assert.deepEqual(await s.rows(),['RYZEN 7 7800X3D | 2 unidades','PLACA ASUS TUF B850M-E | 1 unidad'],'lista de lo que hay en stock, de más a menos');
  assert.match(await s.page.textContent('#scanSummary'),/Productos con stock2.*Unidades disponibles3.*Con código vinculado1/);
  await s.type(' 4711 3879 12345 ');
  await s.page.locator('#stockDialog[open]').waitFor();
  assert.match(await s.page.textContent('#stockTitle'),/Reponer · PLACA ASUS TUF B850M-E/);
  assert.equal(await s.page.inputValue('#stockQuantity'),'1');
  assert.match(await s.page.textContent('#scanResult'),/PLACA ASUS TUF B850M-E · código 4711387912345.*Tienes 1 unidad/);
  await s.page.fill('#stockQuantity','2');await save(s.page);
  assert.deepEqual(await s.stockCalls(),['1:1→3']);
  await s.page.waitForFunction(()=>/ahora tiene 3 unidades/.test(document.getElementById('scanResult').textContent));
  assert.deepEqual(await s.rows(),['PLACA ASUS TUF B850M-E | 3 unidades','RYZEN 7 7800X3D | 2 unidades'],'la lista se actualiza sola');
  assert.equal(await s.page.inputValue('#scanCode'),'','la casilla queda lista para el siguiente código');
  assert.deepEqual(s.errors,[]);
});

test('Un UPC de 12 dígitos encuentra el producto guardado con su EAN-13 (0 delante)',{skip},async()=>{
  const s=await open({products:[product(1,'KINGSTON FURY 32GB',{barcodes:['0740617312345']})]});
  await s.type('740617312345');
  await s.page.locator('#stockDialog[open]').waitFor();
  assert.match(await s.page.textContent('#stockTitle'),/KINGSTON FURY 32GB/);
});

test('Un código nuevo se vincula una sola vez al producto elegido y abre «Reponer»; la próxima vez se reconoce solo',{skip},async()=>{
  const s=await open({products:[product(1,'PLACA ASUS TUF B850M-E',{brand:'ASUS',specs:{Socket:'AM5'}}),product(2,'RYZEN 7 7800X3D',{brand:'AMD'})]});
  await s.type('4711387999999');
  await s.page.locator('#scanPick').waitFor();
  assert.match(await s.page.textContent('#scanResult'),/El código 4711387999999 todavía no está vinculado/);
  assert.equal(await s.page.locator('#stockDialog').evaluate(d=>d.open),false,'no se abre nada hasta elegir');
  await s.page.fill('#scanPick','b850');
  assert.deepEqual(await s.page.$$eval('#scanMatches li',l=>l.map(x=>x.querySelector('span').firstChild.textContent)),['PLACA ASUS TUF B850M-E']);
  await s.page.click('[data-scan-link="1"]');
  await s.page.locator('#stockDialog[open]').waitFor();
  const updates=await s.page.evaluate(()=>window.__updates);
  assert.equal(updates.length,1);assert.deepEqual(updates[0].payload.data,{name:'PLACA ASUS TUF B850M-E',brand:'ASUS',category:'amd',image:'',specs:{Socket:'AM5'},barcodes:['4711387999999']},'solo se agrega el código: el resto de los datos se conserva');
  await save(s.page);
  assert.deepEqual(await s.stockCalls(),['1:0→1']);
  await s.type('4711387999999');
  await s.page.locator('#stockDialog[open]').waitFor();
  assert.equal((await s.page.evaluate(()=>window.__updates)).length,1,'la segunda vez no vuelve a preguntar ni a guardar el código');
  assert.deepEqual(s.errors,[]);
});

test('«Es un producto nuevo» abre el formulario con el código ya escrito, y editar un producto conserva sus códigos',{skip},async()=>{
  const s=await open({products:[product(1,'RYZEN 7 7800X3D',{barcodes:['0730143314123']})]});
  await s.type('8806094912345');await s.page.click('[data-scan-new]');
  await s.page.locator('#productDialog[open]').waitFor();
  assert.equal(await s.page.inputValue('#productBarcodes'),'8806094912345');
  assert.equal(await s.page.inputValue('#productName'),'');
  await s.page.click('[data-close="productDialog"]');
  // Un código de otro producto no se puede repetir.
  await s.page.evaluate(()=>window.AOSuite.scan.newProduct('730143314123'));
  await s.page.fill('#productName','OTRO');await s.page.fill('#productPrice','10');await s.page.fill('#productQuantity','0');
  await s.page.click('#productForm [type="submit"]');
  await s.page.waitForFunction(()=>/ya es de «RYZEN 7 7800X3D»/.test(document.getElementById('productMessage').textContent));
  assert.deepEqual(s.errors,[]);
});

test('«Sumar» en la lista abre «Reponer» sin escanear, y en el celular la lista no se sale de la pantalla',{skip},async()=>{
  const s=await open({width:340,products:[product(1,'SERVICIO DE ARMADO Y CONFIGURACIÓN DE COMPUTADORA GAMER COMPLETA')],units:[unit(1,1,'X')]});
  assert.ok(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'sin desplazamiento horizontal');
  await s.page.click('[data-scan-add="1"]');await save(s.page);
  assert.deepEqual(await s.stockCalls(),['1:1→2']);
});

test('Cámara: con el lector del navegador (BarcodeDetector) el código se lee solo y la cámara se apaga',{skip},async()=>{
  const s=await open({products:[product(1,'PLACA ASUS TUF B850M-E',{barcodes:['4711387912345']})]});
  await s.page.evaluate(()=>{
    window.__tracks=0;
    navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');c.width=64;c.height=48;const g=c.getContext('2d');setInterval(()=>{g.fillStyle='#'+Math.floor(Math.random()*4095).toString(16).padStart(3,'0');g.fillRect(0,0,64,48);},50);const stream=c.captureStream(10);window.__stream=stream;return stream;};
    let calls=0;window.BarcodeDetector=class{static async getSupportedFormats(){return ['ean_13','qr_code'];}async detect(){return ++calls<3?[]:[{rawValue:'4711387912345'}];}};
  });
  await s.page.click('#scanStart');
  await s.page.locator('#stockDialog[open]').waitFor();
  assert.match(await s.page.textContent('#stockTitle'),/PLACA ASUS TUF B850M-E/);
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
    await s.page.locator('#stockDialog[open]').waitFor({timeout:20000});
    assert.match(await s.page.textContent('#scanResult'),new RegExp('código '+code));
    assert.equal(await s.page.isVisible('#scanPanel'),false);
    assert.deepEqual(s.errors,[]);
  }finally{await chromium.close();}
});

test('El menú abre «Escanear stock» y al ir a otra sección la cámara se apaga',{skip},async()=>{
  const s=await open({products:[product(1,'X',{barcodes:['4711387912345']})]});
  await s.page.click('[data-view="catalog"]');
  assert.equal(await s.page.isVisible('#stockView'),false);
  await s.page.click('[data-view="stock"]');
  await s.page.waitForFunction(()=>!document.getElementById('stockView').hidden);
  assert.equal(await s.page.textContent('#suiteHeading'),'Escanear stock');
  assert.equal(await s.page.getAttribute('[data-view="stock"]','aria-current'),'page');
  await s.page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');const g=c.getContext('2d');setInterval(()=>g.fillRect(0,0,9,9),50);window.__stream=c.captureStream(10);return window.__stream;};window.BarcodeDetector=class{static async getSupportedFormats(){return ['ean_13'];}async detect(){return [];}};});
  await s.page.click('#scanStart');await s.page.waitForFunction(()=>window.__stream);
  await s.page.click('[data-view="catalog"]');
  assert.ok(await s.page.evaluate(()=>window.__stream.getTracks().every(t=>t.readyState==='ended')),'la cámara queda apagada al salir');
  assert.deepEqual(s.errors,[]);
});
