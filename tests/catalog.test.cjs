const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
function runtime(fetch){
  const context=vm.createContext({fetch,AbortSignal,console,window:{},document:{hidden:false,addEventListener(){}},setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(__dirname+'/../original/catalogo/categorias.js','utf8'),context);
  vm.runInContext(fs.readFileSync(__dirname+'/../integrations/catalogo/app.js','utf8'),context);
  return context;
}
test('La tienda consulta la disponibilidad compartida y ajusta el carrito cuando se vende stock',async()=>{
  let response,request;
  const context=runtime(async(url,options)=>{request={url,options};return {ok:true,json:async()=>response};});
  const category=vm.runInContext('Object.keys(CATEGORIAS)[0]',context);
  response={productos:[{id:1,name:'Placa B850',category,price:700,stock:3},{id:2,name:'SSD 1 TB',category,price:480,stock:0}]};
  await vm.runInContext('loadCatalog()',context);
  assert.equal(request.options.method,'POST');
  assert.equal(request.options.cache,'no-store');
  assert.ok(request.url.endsWith('/rpc/ao_catalog_snapshot'));
  assert.deepEqual(Array.from(vm.runInContext('products.map(p=>p.id)',context)),[1]);
  vm.runInContext('cart.set(1,3)',context);
  response.productos[0].stock=1;
  await vm.runInContext('loadCatalog()',context);
  assert.equal(vm.runInContext('cart.get(1)',context),1);
  response.productos[0].stock=0;
  await vm.runInContext('loadCatalog()',context);
  assert.equal(vm.runInContext('cart.size',context),0);
});
test('Un error del servicio no se sustituye por cantidades antiguas del JSON',async()=>{
  let calls=0;
  const context=runtime(async()=>{calls++;return {ok:false};});
  await assert.rejects(vm.runInContext('loadCatalog()',context));
  assert.equal(calls,1);
});
