// Prueba de navegador de «Cotizaciones» (panel): lista, KPIs, estados, búsqueda, eliminar, activación pendiente,
// puente con el editor (AOQuoteHost) y «Convertir en boleta» hasta emitirla (el stock baja).
// Usa la app real de dist/ con un Supabase simulado en memoria que reemplaza assets/supabase.js, así app.js hace su
// ingreso normal. Se omite si Playwright no está instalado. Con QUOTES_SHOTS=<carpeta> guarda capturas de pantalla.
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

// ---------- Datos: fechas relativas a hoy en Lima, para que los estados no dependan del día ----------
function limaToday(){const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),g=t=>p.find(x=>x.type===t).value;return `${g('year')}-${g('month')}-${g('day')}`;}
function addDays(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
const T=limaToday(),D=n=>addDays(T,n);
const R1='00000000-0000-4000-8000-000000000001',R2='00000000-0000-4000-8000-000000000002';
const qid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const product=(id,name,price,category='amd')=>({id,data:{name,brand:'',category,image:''},web_price:price,published:true,managed:true,reference_stock:0});
const unit=(id,productId,name)=>({id,compra_id:7,product_id:productId,nombre:name,costo:null,precio_venta:null,in_stock:true});
const ref=(id,name,price)=>({source:'product',productId:String(id),name,price});
const line=(description,quantity,price,parts=[],mode='units')=>({description,code:'',unit:'NIU',quantity:String(quantity),price,parts,mode});
function quote(number,customer,docType,document,phone,date,validDays,items,extra={}){
  const total=items.reduce((n,i)=>n+Math.round(Number(i.price)*100)*Number(i.quantity),0),validUntil=addDays(date,validDays);
  return {id:qid(number),number,customer,document,phone,total_cents:total,quote_date:date,valid_until:validUntil,receipt_id:null,created_at:date+'T15:00:00.000Z',updated_at:date+'T15:00:00.000Z',
    quote:{version:1,date,validDays,validUntil,customer,docType,document,phone,email:'',address:'',notes:'Precios en soles. Sujeto a disponibilidad de stock.\n1 AÑO DE GARANTÍA.',items},...extra};
}
const RYZEN='RYZEN 7 7800X3D',RTX='GeForce RTX 4060 8GB',SSD='SSD Kingston NV2 1TB';
function seed(){
  return {
    ao_products:[product(1,RYZEN,1650),product(2,RTX,1290,'gpu'),product(3,SSD,260,'almacenamiento')],
    COMPRAS:[{id:7,nombre:'Lote octubre',costo:0,moneda:'PEN',tipo_cambio:0}],
    COMPONENTES:[unit(70,1,RYZEN),unit(71,1,RYZEN),unit(72,2,RTX),unit(73,3,SSD),unit(74,3,SSD),unit(75,3,SSD)],
    ao_clients:[{id:'c-1',name:'Carla Mendoza',doc_type:'DNI',document:'71234567',email:'carla@example.com'}],
    ao_receipts:[{id:R1,series:'B001',number:'123',date:T,customer:'Carla Mendoza',total_cents:52000,deleted_at:null,payload:{version:1,series:'B001',number:'123',date:T,customer:'Carla Mendoza',docType:'DNI',document:'71234567',items:[{description:SSD,quantity:'2',price:'260.00'}]}},
      {id:R2,series:'B001',number:'101',date:D(-20),customer:'Marcelo Tambini',total_cents:165000,deleted_at:D(-15)+'T10:00:00Z',payload:{}}],
    ao_quotes:[
      quote(18,'Comercial Andina S.A.C.','RUC','20601234567','987 654 321',T,15,[line(RYZEN,1,'1650.00',[ref(1,RYZEN,'1650.00')]),line('Monitor LG UltraGear 27" 180 Hz',1,'899.00',[{source:'external',name:'Monitor LG UltraGear 27" 180 Hz',price:'899.00'}])]),
      quote(17,'Lucía Fernández','DNI','45879632','936 177 329',D(-6),7,[line(RYZEN,3,'1650.00',[ref(1,RYZEN,'1650.00'),ref(1,RYZEN,'1650.00'),ref(1,RYZEN,'1650.00')]),line('Armado y configuración',1,'80.00')]),
      quote(16,'Jorge Ramírez Ortiz','DNI','','',D(-1),3,[line(RTX,1,'1290.00',[ref(2,RTX,'1290.00')])]),
      quote(15,'Inversiones Rímac E.I.R.L.','RUC','20512345678','01 456 7890',D(-12),7,[line(SSD,2,'260.00',[ref(3,SSD,'260.00'),ref(3,SSD,'260.00')])]),
      quote(14,'Carla Mendoza','DNI','71234567','999 888 777',D(-3),7,[line(SSD,2,'260.00',[ref(3,SSD,'260.00'),ref(3,SSD,'260.00')])],{receipt_id:R1}),
      quote(13,'Marcelo Tambini','DNI','40123456','',D(-25),7,[line(RYZEN,1,'1650.00',[ref(1,RYZEN,'1650.00')])],{receipt_id:R2}),
      quote(12,'Andrea Salazar','NONE','','912 345 678',D(-2),15,[line(SSD,1,'260.00',[ref(3,SSD,'260.00')]),line('Armado y configuración',1,'80.00')])]
  };
}

// ---------- Supabase simulado (se sirve en lugar de assets/supabase.js) ----------
// Implementa lo que usan app.js, suite.js y quotes.js: from(t).select/order/range/eq/is/in/or/upsert/update/delete/single/maybeSingle, rpc, auth, storage.
function mockSupabase(){
  const seed=window.__seed||{},wait=ms=>new Promise(r=>setTimeout(r,ms));
  const db=window.__db=Object.assign({ao_members:[{user_id:'u-1',display_name:'Marcelo',role:seed.role||'owner',active:true}],ao_products:[],COMPRAS:[],COMPONENTES:[],ao_clients:[],ao_sales:[],ao_receipts:[],ao_suite_state:[],ao_quotes:[]},seed.db||{});
  if(seed.missing)delete db.ao_quotes;
  window.__calls=[];window.__fail=seed.fail||{};window.__latency=seed.latency||0;
  let nextQuote=Math.max(0,...(db.ao_quotes||[]).map(q=>q.number))+1,nextReceipt=seed.nextReceipt||124,nextId=5000;
  const user={id:'u-1',email:'aonexuspe@gmail.com'},now=()=>new Date().toISOString();
  const free=id=>db.COMPONENTES.filter(c=>String(c.product_id)===String(id)&&c.precio_venta===null&&c.in_stock!==false).length;
  function builder(table){
    const q={table,op:'select',filters:[],single:false,maybe:false,returning:false,payload:null,range:null,count:false};
    const b={
      select(cols,opts){if(q.op==='select')q.count=!!opts?.count;else q.returning=true;return b;},order:()=>b,limit:()=>b,or:()=>b,range(a,z){q.range=[a,z];return b;},
      eq(c,v){q.filters.push(r=>String(r[c])===String(v));return b;},is(c,v){q.filters.push(r=>(r[c]??null)===v);return b;},
      in(c,values){const set=new Set(values.map(String));q.filters.push(r=>set.has(String(r[c])));return b;},
      upsert(p){q.op='upsert';q.payload=p;return b;},update(p){q.op='update';q.payload=p;return b;},insert(p){q.op='insert';q.payload=p;return b;},delete(){q.op='delete';return b;},
      single(){q.single=true;return b;},maybeSingle(){q.maybe=true;return b;},
      then(ok,ko){return run(q).then(ok,ko);}};
    return b;
  }
  async function run(q){
    await wait(window.__latency);
    window.__calls.push({table:q.table,op:q.op,payload:q.payload===null?null:JSON.parse(JSON.stringify(q.payload))});
    const fail=window.__fail[q.table+':'+q.op]||window.__fail[q.table];
    if(fail)return {data:null,error:fail,count:null};
    if(!db[q.table])return {data:null,error:{code:'PGRST205',message:`Could not find the table 'public.${q.table}' in the schema cache`},count:null};
    const rows=db[q.table],match=r=>q.filters.every(f=>f(r));let out;
    // Como el disparador de database/quotes.sql: la cotización de una boleta emitida (no eliminada) no cambia.
    if(q.table==='ao_quotes'&&(q.op==='update'||q.op==='upsert')){
      const targets=q.op==='update'?rows.filter(match):rows.filter(r=>r.id===q.payload.id);
      if(targets.some(r=>r.receipt_id&&db.ao_receipts.some(x=>x.id===r.receipt_id&&!x.deleted_at)))return {data:null,error:{code:'P0001',message:'Esta cotización ya se convirtió en una boleta emitida y no se puede modificar. Para cambiar precios, duplícala.'},count:null};
    }
    if(q.op==='select'){out=rows.filter(match);if(q.range)out=out.slice(q.range[0],q.range[1]+1);}
    else if(q.op==='upsert'){const p=q.payload,i=rows.findIndex(r=>r.id===p.id);
      if(i>=0){rows[i]={...rows[i],...p,updated_at:now()};out=[rows[i]];}
      else{const row={number:nextQuote++,receipt_id:null,created_by:user.id,created_at:now(),updated_at:now(),...p};rows.unshift(row);out=[row];}}
    // Como el disparador: enlazar la boleta (solo receipt_id) no cambia la versión (updated_at) con la que guarda el editor.
    else if(q.op==='update'){out=rows.filter(match);const link=Object.keys(q.payload).every(k=>k==='receipt_id');out.forEach(r=>Object.assign(r,q.payload,link?{}:{updated_at:now()}));}
    else if(q.op==='delete'){out=rows.filter(match);db[q.table]=rows.filter(r=>!out.includes(r));}
    else return {data:null,error:{message:'Operación no simulada: '+q.op},count:null};
    let data=JSON.parse(JSON.stringify(out));
    if(q.single){if(data.length!==1)return {data:null,error:{code:'PGRST116',message:'JSON object requested, multiple (or no) rows returned'},count:null};data=data[0];}
    else if(q.maybe)data=data[0]??null;
    else if(q.op!=='select'&&!q.returning)data=null;
    return {data,error:null,count:q.count?out.length:null};
  }
  // Emisión: mismas reglas básicas que ao_private.suite_issue (unidades disponibles, suma de partes = importe).
  function issue({request_id,receipt}){
    if(db.ao_receipts.some(r=>r.id===request_id))throw Error('Ese identificador pertenece a otra boleta.');
    let total=0;
    for(const item of receipt.items){
      const inv=item.inventory||[];if(!inv.length)throw Error('Selecciona el stock o registra la compra externa de cada producto.');
      if(item.inventoryMode!=='bundle'&&inv.length!==Number(item.quantity))throw Error('Selecciona una unidad de stock por cada unidad vendida.');
      const line=Math.round(Number(item.price)*100)*Number(item.quantity);total+=line;
      if(inv.reduce((n,p)=>n+Math.round(Number(p.price)*100),0)!==line)throw Error('La suma de los componentes no coincide con el importe.');
      for(const p of inv)if(p.source==='stock'){const u=db.COMPONENTES.find(c=>String(c.id)===String(p.id));if(!u||u.precio_venta!==null)throw Error('Una unidad ya se vendió.');}
    }
    for(const item of receipt.items)for(const p of item.inventory)if(p.source==='stock')db.COMPONENTES.find(c=>String(c.id)===String(p.id)).precio_venta=Number(p.price);
    const row={id:request_id,series:receipt.series,number:String(receipt.number),date:receipt.date,customer:receipt.customer,total_cents:total,payload:receipt,deleted_at:null,pdf_path:null,created_at:now()};
    db.ao_receipts.unshift(row);window.__issued=(window.__issued||[]).concat(request_id);
    return {id:row.id,payload:row.payload,total_cents:total};
  }
  const handlers={
    ao_catalog_snapshot:()=>({productos:db.ao_products.filter(p=>p.published).map(p=>({...p.data,id:p.id,price:p.web_price,stock:p.managed?free(p.id):Number(p.reference_stock||0)}))}),
    ao_next_number:()=>nextReceipt,ao_suite_issue_receipt:a=>{const saved=issue(a);nextReceipt++;return saved;},
    ao_suite_set_stock(a){const p=db.ao_products.find(p=>p.id===a.product_key);const delta=a.target_quantity-free(p.id);for(let i=0;i<delta;i++)db.COMPONENTES.push({id:nextId++,compra_id:7,product_id:p.id,nombre:p.data.name,costo:null,precio_venta:null,in_stock:true});p.managed=true;return {quantity:a.target_quantity};},
    ao_suite_link_stock(a){for(const id of a.unit_keys)db.COMPONENTES.find(c=>c.id===id).product_id=a.product_key;db.ao_products.find(p=>p.id===a.product_key).managed=true;return a.expected_stock;}};
  const client={
    from:builder,
    rpc:async(name,args)=>{await wait(window.__latency);if(name!=='ao_catalog_snapshot')window.__calls.push({rpc:name,args});try{if(!handlers[name])throw Error('RPC no simulada: '+name);return {data:handlers[name](args||{}),error:null};}catch(e){return {data:null,error:{message:e.message}};}},
    auth:{getUser:async()=>window.__signedOut?{data:{user:null},error:null}:{data:{user},error:null},getSession:async()=>({data:{session:{access_token:'token'}}}),
      signOut:async()=>{window.__signedOut=true;setTimeout(()=>window.__authListener?.('SIGNED_OUT'),0);return {error:null};},signInWithPassword:async()=>({error:null}),updateUser:async()=>({error:null}),
      onAuthStateChange:cb=>{window.__authListener=cb;return {data:{subscription:{unsubscribe(){}}}};}},
    storage:{from:()=>({upload:async()=>({error:null}),download:async()=>({data:new Blob(['%PDF']),error:null})})}};
  window.supabase={createClient:()=>client};
}

// opciones: width/height, theme ('dark'), db (datos), role, missing (sin tabla ao_quotes), fail ({'ao_quotes:update':{message}}),
// editor ('stub' = editor simulado que avisa frameReady tarde; por defecto el real cotizacion.html), view (vista inicial).
async function open(options={}){
  const {width=1440,height=900,theme='light',db=seed(),role='owner',missing=false,fail={},latency=0,editor='stub',view='quotes',nextReceipt=124}=options;
  const context=await browser.newContext({viewport:{width,height},acceptDownloads:true,deviceScaleFactor:1});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>page.__onDialog?page.__onDialog(d):d.accept());
  await page.addInitScript(({seed,theme})=>{window.__seed=seed;try{localStorage.setItem('ao-suite-theme',theme);}catch{}},{seed:{db,role,missing,fail,latency,nextReceipt},theme});
  await page.route('**/assets/supabase.js*',r=>r.fulfill({status:200,contentType:'text/javascript',body:'('+mockSupabase.toString()+')();'}));
  await page.route('**/*supabase.co/**',r=>r.abort());
  await page.route('**/accounting.html*',r=>r.fulfill({status:200,contentType:'text/html',body:'<html></html>'}));
  if(editor==='stub')await page.route('**/cotizacion.html*',r=>r.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html><body><p id="state">Editor simulado</p><script>
    window.opened=[];window.openQuote=(row,opts)=>{window.opened.push({row,opts});document.getElementById('state').textContent=row?row.label:'nueva';return true;};
    setTimeout(()=>window.parent.AOQuoteHost.frameReady(),400);</script></body></html>`}));
  await page.goto(base+'/index.html'+(view?'?vista='+view:''));
  await page.waitForFunction(()=>!document.getElementById('appView').hidden&&window.AOQuoteHost);
  if(view==='quotes')await page.waitForFunction(()=>document.querySelectorAll('#quotesRows tr').length||!document.getElementById('quotesSetup').hidden||!document.getElementById('quotesEmpty').hidden&&!document.querySelector('#quotesEmpty .quotes-loading'));
  const s={page,errors,context,
    rows:()=>page.$$eval('#quotesRows tr',rows=>rows.map(r=>[...r.querySelectorAll('td')].slice(0,6).map(td=>td.innerText.replace(/\s+/g,' ').trim()).join(' | '))),
    labels:()=>page.$$eval('#quotesRows .quote-number .quote-link',e=>e.map(x=>x.textContent)),
    kpis:()=>page.$$eval('#quotesSummary>div',e=>e.map(x=>x.innerText.replace(/\s+/g,' ').trim())),
    counts:()=>page.$$eval('[data-quote-filter]',e=>Object.fromEntries(e.map(b=>[b.dataset.quoteFilter,Number(b.querySelector('.tab-count').textContent)]))),
    calls:filter=>page.evaluate(()=>window.__calls).then(c=>filter?c.filter(filter):c),
    db:table=>page.evaluate(t=>window.__db[t],table),
    action:async(number,action)=>{await page.click(`#quotesRows tr[data-id="${qid(number)}"] [data-quote-action="${action}"]`);},
    // El iframe de la boleta puede tardar en navegar con la máquina cargada: se espera hasta tenerlo.
    receiptFrame:async()=>{for(let i=0;i<150;i++){const frame=page.frame({url:/boletas\.html/});if(frame)return frame;await page.waitForTimeout(100);}throw Error('No se cargó boletas.html');},
    shot:async name=>{if(!process.env.QUOTES_SHOTS)return;fs.mkdirSync(process.env.QUOTES_SHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.QUOTES_SHOTS,name+'.png'),fullPage:false});},
    close:()=>context.close()};
  return s;
}
// Espera la revisión de stock del diálogo de conversión.
const checked=page=>page.waitForFunction(()=>document.getElementById('convertQuoteDialog').open&&document.getElementById('convertQuoteProgress').hidden);

test('La lista muestra estados, KPIs, conteos y busca por cliente, número, documento o teléfono',{skip},async()=>{
  const s=await open();
  assert.deepEqual(await s.labels(),['COT-00018','COT-00017','COT-00016','COT-00015','COT-00014','COT-00013','COT-00012']);
  const rows=await s.rows();
  assert.match(rows[0],/^COT-00018 \| \d\d\/\d\d\/\d{4} \| Comercial Andina S\.A\.C\. RUC 20601234567 · 987 654 321 \| .+ \| S\/ 2,549\.00 2 productos \| Pendiente$/);
  assert.match(rows[1],/Vence mañana$/);assert.match(rows[2],/Vence en 2 días$/);assert.match(rows[3],/Vencida$/);
  assert.match(rows[4],/Boleta B001-123$/,'convertida: su boleta existe');
  assert.match(rows[5],/Vencida$/,'su boleta fue eliminada: vuelve a su estado por fecha');
  assert.equal(await s.page.getAttribute('#quotesRows tr[data-id="'+qid(14)+'"] .quote-pill','title'),'Convertida · B001-123');
  assert.equal(await s.page.textContent('#quotesRows tr[data-id="'+qid(14)+'"] [data-quote-action="receipt"]'),'Ver boleta');
  assert.equal(await s.page.$$eval('#quotesRows tr[data-id="'+qid(14)+'"] [data-quote-action="convert"]',e=>e.length),0,'una convertida no se vuelve a convertir');
  assert.deepEqual(await s.counts(),{all:7,pending:4,expiring:2,converted:1,expired:2});
  const kpis=await s.kpis();
  assert.match(kpis[0],/^Pendientes 4 S\/ 9,209\.00 por cerrar$/);
  assert.match(kpis[1],/^Por vencer 2 S\/ 6,320\.00 · vencen en 2 días o menos$/);
  assert.match(kpis[2],/^Convertidas este mes 1 S\/ 520\.00 en boletas$/);
  assert.match(kpis[3],/^Tasa de cierre 14% 1 de 7 cotizaciones · últimos 90 días$/);
  assert.equal(await s.page.textContent('#suiteHeading'),'Cotizaciones');
  assert.equal(await s.page.getAttribute('[data-view="quotes"]','class'),'nav-button active');
  // Filtros
  await s.page.click('[data-quote-filter="expiring"]');assert.deepEqual(await s.labels(),['COT-00017','COT-00016']);
  assert.equal(await s.page.getAttribute('[data-quote-filter="expiring"]','aria-pressed'),'true');
  await s.page.click('[data-quote-filter="converted"]');assert.deepEqual(await s.labels(),['COT-00014']);
  await s.page.click('[data-quote-filter="expired"]');assert.deepEqual(await s.labels(),['COT-00015','COT-00013']);
  await s.page.click('[data-quote-filter="pending"]');assert.deepEqual(await s.labels(),['COT-00018','COT-00017','COT-00016','COT-00012']);
  assert.match(await s.page.textContent('#quotesCount'),/Mostrando 4 de 7 cotizaciones/);
  await s.page.click('[data-quote-filter="all"]');
  // Búsqueda
  for(const [term,expected] of [['lucia',['COT-00017']],['COT-00015',['COT-00015']],['cot 12',['COT-00012']],['20601234567',['COT-00018']],['936177329',['COT-00017']],['rimac',['COT-00015']]]){
    await s.page.fill('#quotesSearch',term);assert.deepEqual(await s.labels(),expected,'«'+term+'»');
  }
  await s.page.fill('#quotesSearch','zzz');
  assert.equal(await s.page.isHidden('#quotesRows'),true);
  assert.match(await s.page.textContent('#quotesEmpty'),/Ninguna cotización coincide con «zzz»/);
  await s.page.click('[data-quote-clear]');assert.equal((await s.labels()).length,7);assert.equal(await s.page.inputValue('#quotesSearch'),'');
  assert.deepEqual(s.errors,[]);await s.close();
});

test('Sin cotizaciones: estado vacío con «Crear mi primera cotización»',{skip},async()=>{
  const db=seed();db.ao_quotes=[];const s=await open({db});
  assert.match(await s.page.textContent('#quotesEmpty'),/Aún no tienes cotizaciones/);
  assert.match((await s.kpis())[3],/Tasa de cierre — Sin cotizaciones en 90 días/);
  await s.page.click('[data-quote-new]');
  await s.page.waitForFunction(()=>document.querySelector('#quoteFrame')?.contentWindow?.opened?.length===1);
  assert.equal(await s.page.isVisible('#quoteEditorView'),true);
  assert.deepEqual(s.errors,[]);await s.close();
});

test('Si falta la tabla se muestra cómo activarla y «Nueva cotización» queda desactivada',{skip},async()=>{
  for(const role of ['owner','seller']){
    const s=await open({missing:true,role});
    assert.equal(await s.page.isVisible('#quotesSetup'),true);assert.equal(await s.page.isHidden('#quotesContent'),true);
    assert.equal(await s.page.isDisabled('#newQuote'),true);
    assert.match(await s.page.textContent('#quotesSetup'),role==='owner'?/Activa las cotizaciones \(paso único\): abre Supabase → SQL Editor, pega el contenido de database\/quotes\.sql y pulsa Run\./:/Pídele al administrador que active las cotizaciones\./);
    assert.equal(await s.page.isHidden('#globalMessage'),true,'no es un error');
    await s.shot('missing-'+role);
    // Al activarla y pulsar Actualizar aparece la lista.
    await s.page.evaluate(()=>{window.__db.ao_quotes=[];});await s.page.click('#refreshQuotes');
    // Primero se ve «Cargando…»; se espera a que termine la consulta.
    await s.page.waitForFunction(()=>document.getElementById('quotesSetup').hidden&&!document.querySelector('#quotesEmpty .quotes-loading'));
    assert.equal(await s.page.isEnabled('#newQuote'),true);assert.match(await s.page.textContent('#quotesEmpty'),/Aún no tienes cotizaciones/);
    assert.deepEqual(s.errors,[]);await s.close();
  }
  // También con el código 42P01 de PostgreSQL.
  const s=await open({fail:{ao_quotes:{code:'42P01',message:'relation "public.ao_quotes" does not exist'}}});
  assert.equal(await s.page.isVisible('#quotesSetup'),true);await s.close();
});

test('Eliminar pide confirmación y no toca stock ni boletas',{skip},async()=>{
  const s=await open();
  await s.action(15,'delete');
  assert.equal(await s.page.$eval('#deleteQuoteDialog',d=>d.open),true);
  assert.equal(await s.page.textContent('#deleteQuoteSummary'),'COT-00015 · Inversiones Rímac E.I.R.L.');
  assert.match(await s.page.textContent('#deleteQuoteDetails'),/La cotización se quitará de la lista\. No cambia tu stock ni tus boletas\./);
  await s.shot('delete-dialog');
  await s.page.click('#deleteQuoteCancel');
  assert.equal(await s.page.$eval('#deleteQuoteDialog',d=>d.open),false);
  assert.equal((await s.calls(c=>c.op==='delete')).length,0,'Cancelar no elimina');
  await s.action(15,'delete');await s.page.click('#deleteQuoteConfirm');
  await s.page.waitForFunction(()=>!document.getElementById('deleteQuoteDialog').open);
  assert.deepEqual((await s.db('ao_quotes')).map(q=>q.number),[18,17,16,14,13,12]);
  assert.equal((await s.labels()).includes('COT-00015'),false);
  assert.match(await s.page.textContent('#suiteToast'),/Cotización COT-00015 eliminada\./);
  assert.deepEqual((await s.calls(c=>c.op&&c.op!=='select')).map(c=>c.table+':'+c.op),['ao_quotes:delete'],'solo borra la cotización');
  // Un error se muestra en el diálogo y se puede reintentar.
  await s.page.evaluate(()=>{window.__fail['ao_quotes:delete']={message:'Sin conexión'};});
  await s.action(12,'delete');await s.page.click('#deleteQuoteConfirm');
  await s.page.waitForFunction(()=>document.getElementById('deleteQuoteMessage').textContent==='Sin conexión');
  assert.equal(await s.page.isEnabled('#deleteQuoteConfirm'),true);
  await s.page.keyboard.press('Escape');assert.equal(await s.page.$eval('#deleteQuoteDialog',d=>d.open),false);
  assert.deepEqual(s.errors,[]);await s.close();
});

test('Convertir: todo en stock → abre la boleta vinculada y, al emitirla, el stock baja y la cotización queda convertida',{skip},async()=>{
  const s=await open({editor:'real'});
  await s.action(18,'convert');await checked(s.page);
  assert.equal(await s.page.textContent('#convertQuoteSummary'),'COT-00018 · Comercial Andina S.A.C. · S/ 2,549.00');
  const result=await s.page.innerText('#convertQuoteResult');
  // Lo a pedido no está en tu stock: el título no lo dice y se nombra en la misma lista.
  assert.match(result,/Listo para emitir\. Al emitir la boleta tu stock bajará:/);assert.doesNotMatch(result,/Todo está en tu stock/);
  assert.match(result,/RYZEN 7 7800X3D\s+2 → 1/);assert.match(result,/Monitor LG UltraGear 27" 180 Hz\s+a pedido · no descuenta stock/);
  assert.doesNotMatch(result,/venció/);
  assert.equal(await s.page.textContent('#convertQuoteConfirm'),'Abrir la boleta');
  assert.deepEqual(await s.calls(c=>c.op&&c.op!=='select'||c.rpc&&c.rpc!=='ao_next_number'),[],'revisar no escribe nada');
  await s.shot('convert-ready');
  await s.page.click('#convertQuoteConfirm');
  await s.page.waitForFunction(()=>!document.getElementById('editorView').hidden&&!document.getElementById('convertQuoteDialog').open);
  const quoteRow=(await s.db('ao_quotes')).find(q=>q.number===18);
  assert.match(quoteRow.receipt_id,/^[0-9a-f-]{36}$/,'la cotización guarda el id con el que se emitirá la boleta');
  const frame=await s.receiptFrame();
  await frame.waitForFunction(()=>document.getElementById('customer').value==='Comercial Andina S.A.C.');
  assert.equal(await frame.inputValue('#docType'),'RUC');assert.equal(await frame.inputValue('#document'),'20601234567');
  assert.deepEqual(await frame.evaluate(()=>window.getInventoryIdsExcept(-1)),['70'],'el Ryzen ya está vinculado a una unidad real');
  const draft=await frame.evaluate(()=>JSON.parse(localStorage.getItem('ao-nexus-boleta-v1-u-1')));
  assert.equal(draft.id,quoteRow.receipt_id);assert.equal(draft.issued,false);
  assert.deepEqual(draft.receipt.items.map(i=>[i.description,i.quantity,i.price,i.inventory.map(p=>p.source+':'+(p.id??p.supplier)).join(',')]),
    [[RYZEN,'1','1650.00','stock:70'],['Monitor LG UltraGear 27" 180 Hz','1','899.00','external:Venta sin stock']]);
  // Emitir la boleta (el flujo de siempre): el stock baja de 2 a 1 y la cotización pasa a «Convertida».
  await frame.waitForFunction(()=>!document.getElementById("exportBtn").disabled);
  const download=s.page.waitForEvent('download');
  await frame.click("#exportBtn");await download;
  await s.page.waitForFunction(()=>(window.__issued||[]).length===1);
  assert.equal(await s.page.evaluate(()=>window.__issued[0]),quoteRow.receipt_id);
  assert.equal((await s.db('COMPONENTES')).filter(c=>c.product_id===1&&c.precio_venta===null).length,1,'RYZEN 7 7800X3D: 2 → 1');
  await s.page.click('[data-view="quotes"]');
  await s.page.waitForFunction(id=>document.querySelector(`#quotesRows tr[data-id="${id}"]`)?.dataset.status==='converted',qid(18));
  assert.match((await s.rows())[0],/Boleta B001-124$/);
  assert.match((await s.kpis())[2],/^Convertidas este mes 2 /);
  assert.deepEqual(s.errors,[]);await s.close();
});

test('Convertir con faltantes avisa antes de emitir; si está vencida lo dice',{skip},async()=>{
  const db=seed();db.ao_quotes.find(q=>q.number===17).valid_until=D(-1);
  const s=await open({db});
  await s.action(17,'convert');await checked(s.page);
  const result=await s.page.innerText('#convertQuoteResult');
  assert.match(result,new RegExp('Esta cotización venció el '+D(-1).split('-').reverse().join('/')+': revisa los precios antes de emitir\\.'));
  assert.match(result,/Antes de emitir, completa esto en la boleta:/);
  assert.match(result,/RYZEN 7 7800X3D: cotizaste 3 y tienes 2 en stock/);
  // El servicio escrito a mano no es un pendiente: se informa aparte, sin el recuadro de «completa esto».
  assert.equal(await s.page.innerText('#convertQuoteResult .convert-box.info'),'Producto 2 («Armado y configuración») se venderá sin stock: no cambia tu stock.');
  assert.doesNotMatch(await s.page.innerText('#convertQuoteResult .convert-box.warn:not(.expired)'),/Armado/);
  assert.match(result,/Lo que sí está en tu stock bajará al emitir la boleta:\s+RYZEN 7 7800X3D\s+2 → 0/);
  assert.equal(await s.page.isEnabled('#convertQuoteConfirm'),true,'se puede abrir la boleta para completarla');
  await s.shot('convert-notices');
  // Cancelar no escribe nada.
  await s.page.click('#convertQuoteCancel');
  assert.equal(await s.page.$eval('#convertQuoteDialog',d=>d.open),false);
  assert.equal((await s.calls(c=>c.op==='update')).length,0);
  assert.deepEqual(s.errors,[]);await s.close();
});

test('«Abrir la boleta»: si falla el vínculo no abre nada; si se conserva el borrador, la cotización vuelve a su vínculo anterior',{skip},async()=>{
  const s=await open();
  await s.page.evaluate(()=>{window.__fail['ao_quotes:update']={message:'Sin conexión con el servidor'};});
  await s.action(12,'convert');await checked(s.page);await s.page.click('#convertQuoteConfirm');
  await s.page.waitForFunction(()=>document.getElementById('convertQuoteMessage').textContent==='Sin conexión con el servidor');
  assert.equal(await s.page.isVisible('#quotesView'),true,'se queda en la lista');
  assert.equal(await s.page.isEnabled('#convertQuoteConfirm'),true);assert.equal(await s.page.isEnabled('#convertQuoteCancel'),true);
  await s.page.evaluate(()=>{delete window.__fail['ao_quotes:update'];});
  // El borrador actual de la boleta se conserva (loadQuoteSale devuelve false).
  const frame=await s.receiptFrame();await frame.waitForFunction(()=>typeof window.loadQuoteSale==='function');
  await frame.evaluate(()=>{window.__received=[];window.loadQuoteSale=(receipt,id,label)=>{window.__received.push({receipt,id,label});return false;};});
  await s.page.click('#convertQuoteConfirm');
  await frame.waitForFunction(()=>window.__received.length===1);
  const received=await frame.evaluate(()=>window.__received[0]);
  assert.equal(received.label,'COT-00012');assert.equal(received.receipt.customer,'Andrea Salazar');assert.equal(received.receipt.docType,'NONE');
  assert.equal(received.receipt.items.length,2);
  await s.page.waitForFunction(id=>window.__db.ao_quotes.find(q=>q.id===id).receipt_id===null,qid(12));
  assert.deepEqual((await s.calls(c=>c.op==='update')).map(c=>c.payload.receipt_id===null?'null':'uuid'),['uuid','uuid','null']);
  // Si la boleta no puede recibir la venta (por ejemplo, se está emitiendo otra), se avisa y también se desvincula.
  await frame.evaluate(()=>{window.loadQuoteSale=()=>{throw Error('Espera a que termine de emitirse la boleta actual e inténtalo otra vez.');};});
  await s.page.click('[data-view="quotes"]');await s.action(12,'convert');await checked(s.page);await s.page.click('#convertQuoteConfirm');
  await s.page.waitForFunction(()=>document.getElementById('globalMessage').textContent==='Espera a que termine de emitirse la boleta actual e inténtalo otra vez.');
  await s.page.waitForFunction(()=>window.__calls.filter(c=>c.op==='update').length===5);
  assert.equal((await s.db('ao_quotes')).find(q=>q.number===12).receipt_id,null);
  assert.deepEqual(s.errors,[]);await s.close();
});

test('Si la revisión del stock falla se puede volver a revisar; una cotización ya emitida no se convierte dos veces',{skip},async()=>{
  const s=await open();
  // prepareQuoteSale lanza un error (p. ej. el stock de la web no cargó): se muestra en el diálogo y se puede reintentar.
  await s.page.evaluate(()=>{window.__realPrepare=window.AOSuite.prepareQuoteSale;window.AOSuite.prepareQuoteSale=async()=>{throw Error('Actualiza el stock de tu web e inténtalo otra vez.');};});
  await s.action(16,'convert');await checked(s.page);
  assert.equal(await s.page.textContent('#convertQuoteMessage'),'Actualiza el stock de tu web e inténtalo otra vez.');
  assert.equal(await s.page.textContent('#convertQuoteConfirm'),'Volver a revisar');assert.equal(await s.page.innerText('#convertQuoteResult'),'');
  await s.page.evaluate(()=>{window.AOSuite.prepareQuoteSale=window.__realPrepare;});
  await s.page.click('#convertQuoteConfirm');
  await s.page.waitForFunction(()=>/Todo está en tu stock/.test(document.getElementById('convertQuoteResult').innerText));
  assert.equal(await s.page.textContent('#convertQuoteMessage'),'');assert.equal(await s.page.textContent('#convertQuoteConfirm'),'Abrir la boleta');
  assert.equal((await s.calls(c=>c.op==='update')).length,0,'revisar no escribe nada');
  // Mientras tanto otra persona emitió la boleta de esta cotización: la base rechaza el vínculo y la lista se actualiza.
  await s.page.evaluate(({id,receipt})=>{const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima'}).format(new Date());window.__db.ao_quotes.find(q=>q.id===id).receipt_id=receipt;
    window.__db.ao_receipts.unshift({id:receipt,series:'B001',number:'130',date:today,customer:'Jorge Ramírez Ortiz',total_cents:129000,deleted_at:null,payload:{}});},{id:qid(16),receipt:'00000000-0000-4000-8000-000000000003'});
  await s.page.click('#convertQuoteConfirm');
  // El vínculo solo se guarda si la cotización sigue como se revisó: no se pisa y se explica qué pasó.
  await s.page.waitForFunction(()=>/Esta cotización ya se convirtió en la boleta B001-130\./.test(document.getElementById('convertQuoteMessage').textContent));
  assert.equal(await s.page.textContent('#convertQuoteConfirm'),'Ver boleta');
  assert.equal(await s.page.isVisible('#quotesView'),true,'no abre otra boleta');
  assert.equal(await s.page.isEnabled('#convertQuoteCancel'),true);
  await s.page.waitForFunction(id=>document.querySelector(`#quotesRows tr[data-id="${id}"]`)?.dataset.status==='converted',qid(16));
  assert.equal((await s.db('ao_quotes')).find(q=>q.number===16).receipt_id,'00000000-0000-4000-8000-000000000003','conserva su boleta');
  await s.page.click('#convertQuoteCancel');
  assert.match((await s.rows()).find(r=>r.startsWith('COT-00016')),/Boleta B001-130$/);
  // Guardarla encima tampoco: el editor recibe el mensaje de la base.
  await assert.rejects(s.page.evaluate(id=>window.AOQuoteHost.save({version:1,date:'2026-10-14',validDays:7,validUntil:'2026-10-21',customer:'X',items:[{description:'a',quantity:'1',price:'1'}]},id),qid(16)),/ya se convirtió en boleta/);
  assert.equal(await s.page.isHidden('#globalMessage'),true);
  assert.deepEqual(s.errors,[]);await s.close();
});

test('«Ver boleta» abre la boleta emitida de una cotización convertida',{skip},async()=>{
  const s=await open();
  const frame=await s.receiptFrame();await frame.waitForFunction(()=>typeof window.loadCloudReceipt==='function');
  await frame.evaluate(()=>{window.__loaded=[];window.loadCloudReceipt=(payload,id)=>window.__loaded.push({payload,id});});
  await s.action(14,'receipt');
  await frame.waitForFunction(()=>window.__loaded.length===1);
  assert.equal(await frame.evaluate(()=>window.__loaded[0].id),R1);
  assert.equal(await s.page.isVisible('#editorView'),true);
  assert.deepEqual(s.errors,[]);await s.close();
});

test('Editor: AOQuoteHost espera frameReady, guarda con upsert y vuelve a la lista',{skip},async()=>{
  const s=await open();
  await s.action(17,'open');
  assert.equal(await s.page.isVisible('#quoteEditorView'),true);
  assert.equal(await s.page.getAttribute('[data-view="quotes"]','class'),'nav-button active','el editor sigue marcando «Cotizaciones»');
  assert.equal(await s.page.textContent('#suiteHeading'),'Cotización');
  assert.equal(await s.page.getAttribute('#quoteFrame','src'),'cotizacion.html');
  const editor=()=>s.page.frame({url:/cotizacion\.html/});
  await s.page.waitForFunction(()=>document.getElementById('quoteFrame').contentWindow.opened?.length===1);
  const first=await editor().evaluate(()=>window.opened[0]);
  assert.equal(first.row.label,'COT-00017');assert.equal(first.row.status,'expiring');assert.equal(first.row.statusText,'Vence mañana');assert.equal(first.row.quote.items.length,2);
  assert.deepEqual(first.opts,{duplicate:false});
  // Ya cargado: se abre al instante, sin recargar el iframe.
  await s.page.click('[data-view="quotes"]');await s.action(14,'duplicate');
  await s.page.waitForFunction(()=>document.getElementById('quoteFrame').contentWindow.opened.length===2);
  const copy=await editor().evaluate(()=>window.opened[1]);
  assert.equal(copy.row.status,'converted');assert.equal(copy.row.receiptLabel,'B001-123');assert.deepEqual(copy.opts,{duplicate:true});
  // Guardar una nueva: número asignado por la base, sin enviar number ni receipt_id.
  const id='20000000-0000-4000-8000-000000000001';
  const saved=await editor().evaluate(id=>window.parent.AOQuoteHost.save({version:1,date:'2026-10-14',validDays:7,validUntil:'2026-10-21',customer:'  Nuevo   Cliente ',docType:'DNI',document:'',phone:'+51 936 177 329',email:'',address:'',notes:'',items:[{description:'Fuente 750W',code:'',unit:'NIU',quantity:'2',price:'350.5',parts:[],mode:'units'}]},id),id);
  assert.equal(saved.label,'COT-00019');assert.equal(saved.number,19);assert.equal(saved.status,'pending');assert.equal(saved.id,id);
  const upsert=(await s.calls(c=>c.op==='upsert'))[0].payload;
  assert.deepEqual(Object.keys(upsert).sort(),['customer','document','id','phone','quote','quote_date','total_cents','valid_until']);
  assert.equal(upsert.total_cents,70100);assert.equal(upsert.customer,'Nuevo Cliente');assert.equal(upsert.phone,'+51 936 177 329');
  // Una cotización convertida no se guarda encima.
  await assert.rejects(editor().evaluate(id=>window.parent.AOQuoteHost.save({version:1,date:'2026-10-14',validDays:7,validUntil:'2026-10-21',customer:'X',items:[{description:'a',quantity:'1',price:'1'}]},id),qid(14)),/ya se convirtió en boleta/);
  assert.equal(await editor().evaluate(()=>window.parent.AOQuoteHost.label(12)),'COT-00012');
  assert.deepEqual(await editor().evaluate(()=>window.parent.AOQuoteHost.clients()),[{name:'Carla Mendoza',docType:'DNI',document:'71234567',email:'carla@example.com',address:''}]);
  assert.deepEqual(await editor().evaluate(id=>window.parent.AOQuoteHost.quoteStock([{source:'product',productId:'1',name:'RYZEN 7 7800X3D',price:'1650.00'},{source:'external',name:'Monitor',price:'1.00'}])),
    [{name:'RYZEN 7 7800X3D',source:'product',quoted:1,inStock:2},{name:'Monitor',source:'external',quoted:1,inStock:null}]);
  // convert() desde el editor abre el diálogo en el panel.
  await editor().evaluate(id=>window.parent.AOQuoteHost.convert(id),id);
  await checked(s.page);assert.match(await s.page.textContent('#convertQuoteSummary'),/COT-00019 · Nuevo Cliente · S\/ 701\.00/);
  assert.match(await s.page.innerText('#convertQuoteResult'),/Producto 1 \(«Fuente 750W»\) se venderá sin stock: no cambia tu stock\./);
  await s.page.click('#convertQuoteClose');
  // back() muestra la lista actualizada.
  await editor().evaluate(()=>window.parent.AOQuoteHost.back());
  await s.page.waitForFunction(()=>!document.getElementById('quotesView').hidden);
  assert.equal((await s.labels())[0],'COT-00019');
  assert.deepEqual(s.errors,[]);await s.close();
});

test('El editor real se carga en el iframe y avisa que está listo',{skip},async()=>{
  const s=await open({editor:'real'});
  await s.page.click('#newQuote');
  const editor=await (async()=>{for(let i=0;i<50;i++){const f=s.page.frame({url:/cotizacion\.html/});if(f)return f;await s.page.waitForTimeout(100);}throw Error('No se cargó cotizacion.html');})();
  await editor.waitForFunction(()=>typeof window.openQuote==='function');
  await s.page.waitForFunction(()=>document.getElementById('quoteFrame').contentDocument?.getElementById('quoteTitle')?.textContent==='Nueva cotización');
  assert.equal(await editor.evaluate(()=>document.documentElement.dataset.theme),'light');
  assert.deepEqual(s.errors,[]);await s.close();
});

test('Salir limpia el editor de cotizaciones y AOQuoteHost',{skip},async()=>{
  const s=await open();
  await s.page.click('#newQuote');
  await s.page.waitForFunction(()=>document.getElementById('quoteFrame').contentWindow.opened?.length===1);
  await s.page.click('#logoutButton');
  await s.page.waitForFunction(()=>!document.getElementById('loginView').hidden);
  assert.equal(await s.page.evaluate(()=>!!window.AOQuoteHost),false);
  assert.equal(await s.page.getAttribute('#quoteFrame','src'),null);
  assert.equal(await s.page.evaluate(()=>document.getElementById('quoteFrame').contentWindow.location.href),'about:blank');
  assert.equal(await s.page.$$eval('#quotesRows tr',e=>e.length),0);
  assert.deepEqual(s.errors,[]);await s.close();
});

test('La tabla se adapta sin desplazamiento horizontal desde 320 px hasta pantallas anchas',{skip},async()=>{
  const s=await open({width:1600});
  for(const width of [1920,1600,1440,1366,1280,1201,1200,1024,900,768,601,600,390,320]){
    await s.page.setViewportSize({width,height:900});
    const m=await s.page.evaluate(()=>{const wrap=document.querySelector('.quotes-table');return {doc:document.documentElement.scrollWidth,wrap:wrap.scrollWidth-wrap.clientWidth,cards:getComputedStyle(document.querySelector('#quotesRows tr')).display==='grid',
      date:getComputedStyle(document.querySelector('.quotes-table th.col-date')).display!=='none'};});
    assert.equal(m.doc,width,width+' px: la página no se desplaza a los lados');assert.ok(m.wrap<=0,width+' px: la tabla no se desplaza a los lados');
    assert.equal(m.cards,width<=1200,width+' px: tarjetas solo en pantallas medianas y teléfonos');
    if(!m.cards)assert.equal(m.date,width>1400,width+' px: columna Fecha');
  }
  assert.deepEqual(s.errors,[]);await s.close();
});

test('En el teléfono las filas se apilan como tarjetas, sin desplazamiento horizontal, también en modo oscuro',{skip},async()=>{
  for(const theme of ['light','dark']){
    const s=await open({width:390,height:844,theme});
    assert.equal(await s.page.evaluate(()=>document.documentElement.scrollWidth),390,'sin desplazamiento horizontal');
    assert.equal(await s.page.$eval('#quotesRows tr',tr=>getComputedStyle(tr).display),'grid');
    assert.equal(await s.page.$eval('.quotes-table thead',e=>e.getBoundingClientRect().height<=1),true,'encabezados solo para lectores de pantalla');
    const card=await s.page.$eval('#quotesRows tr',tr=>{const r=tr.getBoundingClientRect();return {left:r.left,right:r.right,bg:getComputedStyle(tr).backgroundColor};});
    assert.ok(card.left>=14&&card.right<=376,'la tarjeta respeta los márgenes');
    assert.equal(card.bg,theme==='dark'?'rgb(34, 28, 43)':'rgb(255, 255, 255)');
    assert.equal(await s.page.evaluate(()=>document.documentElement.dataset.theme),theme);
    await s.close();
  }
});

// ---------- Revisión: conversión con datos de otro dispositivo, guardado sobre la versión editada, accesibilidad ----------
test('Convertir relee la cotización: usa los precios guardados en otro dispositivo y avisa si ya se abrió una boleta sin emitir',{skip},async()=>{
  const s=await open();
  // En otro dispositivo bajaron el precio del SSD y abrieron una boleta de COT-00015 que aún no se emite.
  const pending='00000000-0000-4000-8000-0000000000aa';
  await s.page.evaluate(({id,pending})=>{const q=window.__db.ao_quotes.find(q=>q.id===id);q.quote.items[0].price='250.00';q.quote.items[0].parts.forEach(p=>p.price='250.00');q.total_cents=50000;q.receipt_id=pending;},{id:qid(15),pending});
  await s.action(15,'convert');await checked(s.page);
  assert.equal(await s.page.textContent('#convertQuoteSummary'),'COT-00015 · Inversiones Rímac E.I.R.L. · S/ 500.00','el resumen usa la versión guardada');
  assert.match(await s.page.innerText('#convertQuoteResult'),/Ya se preparó una boleta de esta cotización que no está emitida: puede estar abierta en otro dispositivo \(o se eliminó\)\. Si abres otra, emite solo una de las dos/);
  assert.equal(await s.page.textContent('#convertQuoteConfirm'),'Abrir otra boleta igual');
  await s.page.click('#convertQuoteConfirm');
  const frame=await s.receiptFrame();await frame.waitForFunction(()=>document.getElementById('customer').value==='Inversiones Rímac E.I.R.L.');
  assert.equal(await frame.inputValue('#price-0'),'250.00','la boleta usa el precio guardado en el otro dispositivo');
  const linked=(await s.db('ao_quotes')).find(q=>q.number===15).receipt_id;
  assert.notEqual(linked,pending);assert.equal(await frame.evaluate(()=>window.draftReceiptId()),linked);
  // En este dispositivo: el borrador abierto es de esta cotización y se reemplaza al volver a convertirla.
  await s.page.click('[data-view="quotes"]');await s.action(15,'convert');await checked(s.page);
  assert.match(await s.page.innerText('#convertQuoteResult'),/Ya abriste una boleta de esta cotización en «Nueva boleta» y aún no la emites\. Si continúas, se vuelve a preparar con tu stock actual y reemplaza ese borrador\./);
  assert.equal(await s.page.textContent('#convertQuoteConfirm'),'Abrir la boleta');
  assert.deepEqual(s.errors,[]);await s.close();
});

test('«Abrir la boleta» no pisa el vínculo que otro dispositivo guardó mientras se revisaba',{skip},async()=>{
  const s=await open();
  await s.action(16,'convert');await checked(s.page);
  const other='00000000-0000-4000-8000-0000000000bb';
  await s.page.evaluate(({id,other})=>{window.__db.ao_quotes.find(q=>q.id===id).receipt_id=other;},{id:qid(16),other});
  await s.page.click('#convertQuoteConfirm');
  await s.page.waitForFunction(()=>document.getElementById('convertQuoteMessage').textContent==='Mientras revisabas se abrió una boleta de esta cotización en otro dispositivo. Pulsa «Volver a revisar» antes de abrir otra.');
  assert.equal((await s.db('ao_quotes')).find(q=>q.number===16).receipt_id,other,'el vínculo del otro dispositivo se conserva');
  assert.equal(await s.page.isVisible('#quotesView'),true,'no abre otra boleta');
  assert.equal(await s.page.textContent('#convertQuoteConfirm'),'Volver a revisar');
  await s.page.click('#convertQuoteConfirm');await checked(s.page);
  assert.match(await s.page.innerText('#convertQuoteResult'),/Ya se preparó una boleta de esta cotización que no está emitida/);assert.equal(await s.page.textContent('#convertQuoteConfirm'),'Abrir otra boleta igual');
  // Mientras tanto la eliminaron en otro dispositivo.
  await s.page.evaluate(id=>{window.__db.ao_quotes=window.__db.ao_quotes.filter(q=>q.id!==id);},qid(16));
  await s.page.click('#convertQuoteConfirm');
  await s.page.waitForFunction(()=>document.getElementById('convertQuoteMessage').textContent==='Esta cotización ya no existe: se eliminó en este u otro dispositivo.');
  await s.page.waitForFunction(()=>!document.querySelector('#quotesRows tr[data-id="10000000-0000-4000-8000-000000000016"]'));
  assert.equal(await s.page.isVisible('#quotesView'),true);
  assert.deepEqual(s.errors,[]);await s.close();
});

test('Guardar una cotización ya guardada no pisa los cambios de otra persona ni revive una eliminada',{skip},async()=>{
  const s=await open();
  const save=(quote,id,base)=>s.page.evaluate(({quote,id,base})=>window.AOQuoteHost.save(quote,id,base),{quote,id,base});
  const first=(await s.db('ao_quotes')).find(q=>q.number===18);
  const saved=await save({...first.quote,notes:'Precios incluyen IGV.'},qid(18),first.updated_at);
  assert.equal(saved.label,'COT-00018');assert.notEqual(saved.updatedAt,first.updated_at,'cada guardado es una versión nueva');
  const write=(await s.calls(c=>c.table==='ao_quotes'&&['update','upsert'].includes(c.op))).at(-1);
  assert.equal(write.op,'update','se guarda sobre la versión que se editaba');assert.equal('id' in write.payload,false);assert.equal('receipt_id' in write.payload,false);
  // Otra persona ya guardó una versión más nueva: guardar desde la anterior se rechaza sin pisarla.
  await assert.rejects(save({...first.quote,notes:'Versión vieja'},qid(18),first.updated_at),/Otra persona guardó cambios en esta cotización mientras la editabas\. Para no perder los tuyos, pulsa «Duplicar»/);
  assert.equal((await s.db('ao_quotes')).find(q=>q.number===18).quote.notes,'Precios incluyen IGV.');
  // Eliminada en otro dispositivo: no vuelve a aparecer con otro número.
  const gone=(await s.db('ao_quotes')).find(q=>q.number===17);
  await s.page.evaluate(id=>{window.__db.ao_quotes=window.__db.ao_quotes.filter(q=>q.id!==id);},qid(17));
  await assert.rejects(save(gone.quote,qid(17),gone.updated_at),/Esta cotización fue eliminada \(en este u otro dispositivo\)\. Para conservarla, pulsa «Duplicar»/);
  const after=await s.db('ao_quotes');
  assert.equal(after.some(q=>q.id===qid(17)),false);assert.equal(Math.max(...after.map(q=>q.number)),18,'no se asignó un número nuevo');
  await s.page.waitForFunction(()=>!document.querySelector('#quotesRows tr[data-id="10000000-0000-4000-8000-000000000017"]'));
  // Una cotización nueva (sin versión) se guarda con upsert: reintentar no la duplica.
  const fresh={...first.quote,customer:'Cliente nuevo'},id='20000000-0000-4000-8000-000000000009';
  const a=await save(fresh,id,null),b=await save(fresh,id,null);
  assert.equal(a.number,b.number);assert.equal((await s.calls(c=>c.op==='upsert')).length,2);
  // Convertirla (enlazar su boleta) no cambia su versión: el editor puede seguir guardando.
  const before=(await s.db('ao_quotes')).find(q=>q.id===id).updated_at;
  await s.page.click(`#quotesRows tr[data-id="${id}"] [data-quote-action="convert"]`);await checked(s.page);await s.page.click('#convertQuoteCancel');
  assert.equal((await s.db('ao_quotes')).find(q=>q.id===id).updated_at,before);
  assert.deepEqual(s.errors,[]);await s.close();
});

test('Una cotización sin documento abre la boleta «Sin documento» y una con pendientes los mantiene a la vista',{skip},async()=>{
  const s=await open();
  await s.action(16,'convert');await checked(s.page);await s.page.click('#convertQuoteConfirm');
  const frame=await s.receiptFrame();await frame.waitForFunction(()=>document.getElementById('customer').value==='Jorge Ramírez Ortiz');
  assert.equal(await frame.inputValue('#docType'),'NONE');assert.equal(await frame.inputValue('#document'),'');assert.equal(await frame.isDisabled('#document'),true);
  assert.equal(await frame.isHidden('#errorBox'),true,'no pide un DNI que la cotización no tiene');assert.equal(await frame.isHidden('#quoteNotice'),true);
  assert.equal(await frame.textContent('#toast'),'Venta de la cotización COT-00016 lista. Revisa los datos y pulsa «Emitir y descargar».');
  // COT-00017: 3 Ryzen con 2 en stock y un servicio. El servicio llega listo; el Ryzen queda marcado y su aviso, a la vista.
  await s.page.click('[data-view="quotes"]');await s.action(17,'convert');await checked(s.page);await s.page.click('#convertQuoteConfirm');
  await frame.waitForFunction(()=>document.getElementById('customer').value==='Lucía Fernández');
  const notice=await frame.innerText('#quoteNotice');
  assert.match(notice,/^Desde la cotización COT-00017: completa esto antes de emitir/);assert.match(notice,/RYZEN 7 7800X3D: cotizaste 3 y tienes 2 en stock\. En la boleta, producto 1: baja la cantidad a 2/);
  assert.equal(await frame.getAttribute('#quantity-0','aria-invalid'),'true');
  assert.match(await frame.textContent('[data-inventory="1"]'),/Productos seleccionados · 1 unidad/);
  assert.equal(await frame.textContent('#toast'),'Venta de la cotización COT-00017 abierta: completa 1 producto antes de emitir.');
  assert.deepEqual(s.errors,[]);await s.close();
});

test('Lista accesible: filtros con su cantidad, conteo anunciado, KPIs sin anuncios y una parada de teclado por acción',{skip},async()=>{
  const s=await open();
  for(const name of ['Todas (7)','Pendientes (4)','Por vencer (2)','Convertidas (1)','Vencidas (2)'])assert.equal(await s.page.getByRole('button',{name,exact:true}).count(),1,name);
  assert.equal(await s.page.getAttribute('#quotesSummary','aria-live'),null,'los KPI no se vuelven a leer en cada tecla');
  assert.deepEqual([await s.page.getAttribute('#quotesCount','role'),await s.page.getAttribute('#quotesCount','aria-live')],['status','polite']);
  const stops=await s.page.$eval(`#quotesRows tr[data-id="${qid(18)}"]`,tr=>[...tr.querySelectorAll('button')].filter(b=>b.tabIndex>=0).map(b=>b.getAttribute('aria-label')));
  assert.deepEqual(stops,['Abrir COT-00018','Convertir COT-00018 en boleta','Duplicar COT-00018','Eliminar la cotización COT-00018']);
  // El número y el cliente siguen abriendo con el mouse.
  await s.page.click(`#quotesRows tr[data-id="${qid(18)}"] .quote-client .quote-link`);
  await s.page.waitForFunction(()=>document.getElementById('quoteFrame').contentWindow.opened?.length===1);
  assert.deepEqual(s.errors,[]);await s.close();
});

test('En tarjetas (≤1200 px) las acciones de las tarjetas de una misma fila quedan alineadas',{skip},async()=>{
  for(const width of [1024,768]){
    const s=await open({width,height:900});
    const cards=await s.page.$$eval('#quotesRows tr',trs=>trs.map(tr=>({top:Math.round(tr.getBoundingClientRect().top),actions:Math.round(tr.querySelector('.quote-actions').getBoundingClientRect().bottom),bottom:Math.round(tr.getBoundingClientRect().bottom)})));
    const rows=new Map();for(const c of cards){if(!rows.has(c.top))rows.set(c.top,[]);rows.get(c.top).push(c);}
    const shared=[...rows.values()].filter(list=>list.length>1);
    assert.ok(shared.length>0,width+' px: hay tarjetas lado a lado');
    for(const list of shared){assert.equal(new Set(list.map(c=>c.actions)).size,1,width+' px: acciones a la misma altura '+JSON.stringify(list));assert.ok(list.every(c=>c.bottom-c.actions<=12),width+' px: las acciones van al pie de la tarjeta');}
    await s.close();
  }
});

// ---------- Editor real (cotizacion.html) dentro del panel ----------
async function editorOf(s,title){
  await s.page.waitForFunction(t=>new RegExp(t).test(document.getElementById('quoteFrame').contentDocument?.getElementById('quoteTitle')?.textContent||''),title);
  const frame=s.page.frame({url:/cotizacion\.html/});
  await frame.waitForFunction(()=>!document.getElementById('downloadBtn').disabled);
  return frame;
}
test('Editor: salir de una cotización con cambios sin guardar los conserva sin preguntar («Cancelar» nunca descarta)',{skip},async()=>{
  const s=await open({editor:'real'}),dialogs=[];s.page.__onDialog=d=>{dialogs.push(d.message());d.dismiss();};
  await s.action(18,'open');let editor=await editorOf(s,'COT-00018');
  await editor.fill('#customer','Comercial Andina S.A.C. (sede Lima)');
  await editor.click('#backBtn');
  await s.page.waitForFunction(()=>!document.getElementById('quotesView').hidden);
  assert.deepEqual(dialogs,[],'no hay un confirm cuyo «Cancelar» descarte');
  assert.equal(await s.page.textContent('#suiteToast'),'Tus cambios sin guardar de COT-00018 quedaron en este dispositivo: ábrela para guardarlos.');
  // Abrir otra y volver: los cambios se recuperan.
  await s.action(16,'open');editor=await editorOf(s,'COT-00016');await editor.click('#backBtn');
  await s.page.waitForFunction(()=>!document.getElementById('quotesView').hidden);
  await s.action(18,'open');editor=await editorOf(s,'COT-00018');
  await editor.waitForFunction(()=>document.getElementById('customer').value==='Comercial Andina S.A.C. (sede Lima)');
  assert.equal(await editor.textContent('#toast'),'Recuperamos tus cambios sin guardar de COT-00018.');
  // «Nueva» tampoco pregunta ni descarta.
  await editor.click('#newBtn');await editorOf(s,'Nueva cotización');
  assert.deepEqual(dialogs,[]);
  assert.equal(await editor.textContent('#toast'),'Nueva cotización lista. Tus cambios sin guardar de COT-00018 quedaron en este dispositivo: ábrela para guardarlos.');
  assert.equal((await s.db('ao_quotes')).find(q=>q.number===18).customer,'Comercial Andina S.A.C.','nada se guardó sin pedirlo');
  assert.deepEqual(s.errors,[]);await s.close();
});

test('Editor: una cotización vencida avisa antes de descargar o compartir un PDF con la fecha pasada',{skip},async()=>{
  const s=await open({editor:'real'}),dialogs=[];let answer=false;s.page.__onDialog=d=>{dialogs.push(d.message());answer?d.accept():d.dismiss();};
  await s.action(15,'open');const editor=await editorOf(s,'COT-00015');
  const expired=D(-5).split('-').reverse().join('/');
  let downloads=0;s.page.on('download',()=>downloads++);
  await editor.click('#downloadBtn');
  assert.deepEqual(dialogs,[`Esta cotización venció el ${expired} y el PDF mostrará esa fecha. ¿Descargarla igual? Para enviarla vigente, pulsa «Duplicar»: la copia tiene la fecha de hoy.`]);
  await s.page.waitForTimeout(300);assert.equal(downloads,0,'«Cancelar» no descarga');
  await editor.click('#shareBtn');assert.match(dialogs[1],/¿Compartirla igual\?/);
  answer=true;const download=s.page.waitForEvent('download');await editor.click('#downloadBtn');await download;
  // Una vigente no pregunta.
  await s.page.click('[data-view="quotes"]');await s.action(18,'open');const current=await editorOf(s,'COT-00018');
  const second=s.page.waitForEvent('download');await current.click('#downloadBtn');await second;assert.equal(dialogs.length,3);
  assert.deepEqual(s.errors,[]);await s.close();
});

test('Editor: una cotización convertida se ve de solo lectura, en modo claro y oscuro',{skip},async()=>{
  for(const [theme,field] of [['light','rgb(246, 243, 249)'],['dark','rgb(22, 16, 28)']]){
    const s=await open({editor:'real',theme});
    await s.action(14,'open');const editor=await editorOf(s,'COT-00014');
    const look=await editor.evaluate(()=>{const css=(id,pseudo)=>getComputedStyle(document.getElementById(id),pseudo);const box=id=>document.getElementById(id).getBoundingClientRect();
      return {customer:css('customer').backgroundColor,description:css('description-0').backgroundColor,placeholder:css('email','::placeholder').color,disabled:document.getElementById('customer').disabled,
        hints:['itemsHint','notesHint'].map(id=>document.getElementById(id).hidden),subtitle:document.getElementById('subtitle').textContent,
        convert:Math.round(box('convertBtn').width),row:Math.round(document.querySelector('.finish-actions').getBoundingClientRect().width),label:document.getElementById('convertBtn').textContent};});
    assert.deepEqual({...look,convert:undefined,row:undefined},{customer:field,description:field,placeholder:'rgba(0, 0, 0, 0)',disabled:true,hints:[true,true],subtitle:'Cotización convertida: solo lectura.',label:'Ver boleta',convert:undefined,row:undefined},theme);
    assert.equal(look.convert,look.row,theme+': «Ver boleta» ocupa toda la fila');
    // Al abrir una pendiente vuelve a ser editable.
    await s.page.click('[data-view="quotes"]');await s.action(18,'open');const open18=await editorOf(s,'COT-00018');
    assert.deepEqual(await open18.evaluate(()=>[document.getElementById('customer').disabled,document.getElementById('itemsHint').hidden,document.getElementById('subtitle').textContent]),[false,false,'Arma la propuesta para tu cliente. No aparta ni descuenta stock.']);
    assert.deepEqual(s.errors,[]);await s.close();
  }
});

test('Editor: los errores se ven en ambos temas, el aviso no pasa a la siguiente cotización y el botón del celular dice «Descargar PDF»',{skip},async()=>{
  for(const [theme,invalid] of [['light','rgb(255, 250, 251)'],['dark','rgb(69, 34, 47)']]){
    const s=await open({editor:'real',theme});
    await s.page.click('#newQuote');const editor=await editorOf(s,'Nueva cotización');
    assert.equal(await editor.textContent('#downloadMobileBtn'),'Descargar PDF','sin «Guardar y PDF» junto a «Guardar»');
    await editor.click('#saveBtn');
    assert.equal(await editor.textContent('#toast'),'Revisa los datos señalados antes de guardar.');
    assert.equal(await editor.getAttribute('#description-0','aria-invalid'),'true');
    assert.equal(await editor.$eval('#description-0',e=>getComputedStyle(e).backgroundColor),invalid,theme+': la descripción se ve marcada');
    await editor.click('#backBtn');await s.page.waitForFunction(()=>!document.getElementById('quotesView').hidden);
    await s.action(18,'open');const open18=await editorOf(s,'COT-00018');
    assert.equal(await open18.isHidden('#toast'),true,'el aviso de la otra cotización no se arrastra');
    assert.equal(await open18.textContent('#downloadMobileBtn'),'Descargar PDF');
    assert.deepEqual(s.errors,[]);await s.close();
  }
});

test('Capturas de pantalla (QUOTES_SHOTS)',{skip:skip||(!process.env.QUOTES_SHOTS&&'Define QUOTES_SHOTS=<carpeta> para guardar capturas')},async()=>{
  for(const theme of ['light','dark'])for(const [name,width,height] of [['desktop',1440,900],['laptop',1280,800],['tablet',1024,768],['mobile',390,844]]){
    const s=await open({theme,width,height});const tag=name+'-'+theme;
    await s.page.evaluate(()=>document.fonts.ready);
    await s.shot('list-'+tag);
    await s.page.screenshot({path:path.join(process.env.QUOTES_SHOTS,'list-full-'+tag+'.png'),fullPage:true});
    await s.action(18,'convert');await checked(s.page);await s.shot('convert-ready-'+tag);await s.page.click('#convertQuoteCancel');
    await s.action(17,'convert');await checked(s.page);await s.shot('convert-notices-'+tag);await s.page.click('#convertQuoteCancel');
    await s.action(15,'convert');await checked(s.page);await s.shot('convert-expired-'+tag);await s.page.click('#convertQuoteCancel');
    await s.action(15,'delete');await s.shot('delete-'+tag);await s.page.click('#deleteQuoteCancel');
    await s.page.fill('#quotesSearch','zzz');await s.shot('search-empty-'+tag);
    await s.close();
    const db=seed();db.ao_quotes=[];const e=await open({theme,width,height,db});await e.shot('empty-'+tag);await e.close();
    const m=await open({theme,width,height,missing:true});await m.shot('missing-'+tag);await m.close();
    // El editor real dentro del panel (iframe #quoteFrame), con una cotización guardada.
    const r=await open({theme,width,height,editor:'real'});await r.action(18,'open');
    await r.page.waitForFunction(()=>/COT-00018/.test(document.getElementById('quoteFrame').contentDocument?.getElementById('quoteTitle')?.textContent||''));
    await r.page.waitForTimeout(600);await r.shot('editor-'+tag);await r.close();
  }
});
