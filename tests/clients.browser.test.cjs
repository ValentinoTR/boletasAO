// Prueba de navegador de «Clientes → Eliminar» con la app real de dist/ y un Supabase simulado en memoria.
// Se omite si Playwright no está instalado.
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
const skip=!playwright&&'Playwright no está instalado';
const CLIENTS=[{id:'c-sin',name:'marcelo tambini',doc_type:'DNI',document:'22222222',email:'marcelo@example.com'},{id:'c-con',name:'Cliente Frecuente',doc_type:'DNI',document:'11111111',email:''}];
const RECEIPT={id:'r-1',series:'B001',number:'110',date:'2026-10-11',total_cents:34000,payload:{items:[{description:'RYZEN 5 5500'}]}};
async function open({missingFunction=false,latency=0}={}){
  const page=await (await browser.newContext({viewport:{width:1000,height:900}})).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*supabase.co/**',r=>r.abort());
  await page.route('**/accounting.html',r=>r.fulfill({status:200,contentType:'text/html',body:'<html></html>'}));
  await page.goto(base+'/index.html');
  await page.evaluate(({clients,receipt,missingFunction,latency})=>{
    const db=window.__db={ao_products:[],COMPRAS:[],COMPONENTES:[],ao_clients:clients,ao_sales:[{receipt_id:receipt.id,client_id:'c-con'}],ao_receipts:[receipt],ao_suite_state:[]};
    window.__rpc=[];const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const client={from:t=>({select:()=>({order:()=>({range:async start=>({data:start===0?structuredClone(db[t]||[]):[],error:null})})})}),
      rpc:async(name,args)=>{window.__rpc.push({name,args});await wait(latency);
        if(missingFunction)return {data:null,error:{code:'PGRST202',message:'Could not find the function public.ao_suite_delete_client(client_key) in the schema cache'}};
        if(db.ao_sales.some(s=>s.client_id===args.client_key))return {data:null,error:{code:'23503',message:'Este cliente tiene 1 boleta(s) emitida(s). Para eliminarlo, primero elimina sus boletas en «Boletas emitidas».'}};
        db.ao_clients=db.ao_clients.filter(c=>c.id!==args.client_key);return {data:{deleted:true,already_deleted:false,id:args.client_key},error:null};}};
    document.getElementById('loginView').hidden=true;document.getElementById('appView').hidden=false;document.getElementById('clientsView').hidden=false;
    window.__ready=window.AOSuite.initialize(client,{role:'owner'});
  },{clients:CLIENTS,receipt:RECEIPT,missingFunction,latency});
  await page.evaluate(()=>window.__ready);
  return {page,errors,names:()=>page.$$eval('#clientList .card h2',e=>e.map(x=>x.textContent))};
}

test('Un cliente sin boletas se elimina tras confirmar',{skip},async()=>{
  const s=await open();
  assert.deepEqual(await s.names(),['marcelo tambini','Cliente Frecuente']);
  await s.page.click('[data-delete-client="c-sin"]');
  assert.equal(await s.page.$eval('#deleteClientDialog',d=>d.open),true);
  assert.match(await s.page.textContent('#deleteClientSummary'),/marcelo tambini · DNI 22222222/);
  assert.match(await s.page.textContent('#deleteClientDetails'),/No afecta tus boletas, ventas ni stock/);
  await s.page.click('#deleteClientCancel');
  assert.equal(await s.page.$eval('#deleteClientDialog',d=>d.open),false);assert.deepEqual(await s.page.evaluate(()=>window.__rpc),[],'Cancelar no elimina');
  await s.page.click('[data-delete-client="c-sin"]');await s.page.click('#deleteClientConfirm');
  await s.page.waitForFunction(()=>!document.getElementById('deleteClientDialog').open);
  assert.deepEqual(await s.page.evaluate(()=>window.__rpc),[{name:'ao_suite_delete_client',args:{client_key:'c-sin'}}]);
  assert.deepEqual(await s.names(),['Cliente Frecuente']);
  assert.match(await s.page.textContent('#suiteToast'),/Cliente «marcelo tambini» eliminado/);
  assert.deepEqual(s.errors,[]);
});

test('Un cliente con boletas no se puede eliminar y se explica por qué',{skip},async()=>{
  const s=await open();
  await s.page.click('[data-delete-client="c-con"]');
  assert.match(await s.page.textContent('#deleteClientDetails'),/1 boleta emitida \(B001-110\).*elimínala primero en «Boletas emitidas»/);
  assert.equal(await s.page.isVisible('#deleteClientConfirm'),false,'no se ofrece eliminar');
  await s.page.keyboard.press('Escape');
  assert.equal(await s.page.$eval('#deleteClientDialog',d=>d.open),false);
  assert.deepEqual(await s.page.evaluate(()=>window.__rpc),[]);
  await s.page.click('[data-delete-client="c-sin"]');
  assert.equal(await s.page.isVisible('#deleteClientConfirm'),true,'el botón vuelve para un cliente sin boletas');
});

test('Si la base de datos aún no tiene la función, el mensaje dice qué ejecutar',{skip},async()=>{
  const s=await open({missingFunction:true});
  await s.page.click('[data-delete-client="c-sin"]');await s.page.click('#deleteClientConfirm');
  await s.page.waitForFunction(()=>document.getElementById('deleteClientMessage').textContent.includes('delete_clients.sql'));
  assert.equal(await s.page.$eval('#deleteClientDialog',d=>d.open),true);assert.deepEqual(await s.names(),['marcelo tambini','Cliente Frecuente']);
});

test('Mientras se elimina, la ventana no se cierra con Esc',{skip},async()=>{
  const s=await open({latency:3000});
  await s.page.click('[data-delete-client="c-sin"]');await s.page.click('#deleteClientConfirm');
  await s.page.keyboard.press('Escape');
  assert.equal(await s.page.$eval('#deleteClientDialog',d=>d.open),true);
  await s.page.waitForFunction(()=>!document.getElementById('deleteClientDialog').open);
  assert.deepEqual(await s.names(),['Cliente Frecuente']);
});
