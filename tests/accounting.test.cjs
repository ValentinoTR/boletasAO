const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../dist/accounting.html','utf8');
function runtime(products=[]){
  const c=vm.createContext({window:{parent:{AOSuite:{stockProducts:()=>products}}}});
  vm.runInContext('let combos=[];'+html.slice(html.indexOf('function realCostSoles('),html.indexOf('function getAllComponentsFlat('))+html.slice(html.indexOf('function stockProducts('),html.indexOf('function renderInventario(')),c);
  return c;
}
const component=(id,sale=null,extras={})=>({id,name:'Placa',sale,costo:null,saleCost:null,inStock:true,productId:null,sugerido:null,...extras});
const purchase=components=>({id:'1',cost:1000,currency:'PEN',components,proveedor:''});
test('Compras no cierra ganancia mientras quede una pieza, incluso si ya se recuperó el costo',()=>{
  const c=runtime();c.combo=purchase([component(1,1200),component(2)]);
  const d=vm.runInContext('comboDerived(combo)',c);
  assert.equal(d.recuperado,1200);assert.equal(d.finalizado,false);assert.equal(d.ganancia,null);
  c.combo.components[1].inStock=false;
  assert.equal(vm.runInContext('comboDerived(combo).ganancia',c),null,'Retirar una pieza no equivale a venderla');
  c.combo.components=[];
  assert.equal(vm.runInContext('comboDerived(combo).ganancia',c),null);
});
test('La ganancia final usa el costo completo con gastos, aunque los costos manuales no sumen ese costo',()=>{
  const c=runtime();c.combo={...purchase([component(1,700,{costo:100}),component(2,500,{costo:100})]),otros:50};
  assert.equal(vm.runInContext('comboDerived(combo).ganancia',c),150);
  c.combo.components[1].sale=100;
  assert.equal(vm.runInContext('comboDerived(combo).ganancia',c),-250);
  c.combo.components[1].sale=null;
  assert.equal(vm.runInContext('comboDerived(combo).ganancia',c),null,'Anular una venta vuelve a dejar pendiente el resultado');
});
test('Inventario incluye cantidades del catálogo anterior sin duplicar las unidades compradas del mismo producto',()=>{
  const c=runtime([{id:10,name:'Placa',managed:false,unregisteredStock:3},{id:11,name:'SSD',managed:false,unregisteredStock:4}]);
  c.input=[purchase([component(1),component(2,500),component(3,null,{inStock:false})])];
  vm.runInContext('combos=input',c);
  const groups=vm.runInContext('getInventoryGroups()',c);
  assert.equal(groups.length,2);assert.equal(groups[0].name,'Placa');assert.equal(groups[0].stock,4);assert.equal(groups[0].items.length,1);assert.equal(groups[0].costoProm,null,'No inventar costo para el catálogo sin compras');assert.equal(groups[1].stock,4);
});
test('Inventario conserva productos agotados y excluye compras de venta sin stock',()=>{
  const c=runtime([{id:10,name:'Placa',managed:true,unregisteredStock:0}]);
  c.input=[purchase([component(1,null,{productId:10}),component(2,600,{productId:10}),component(3,null,{productId:10,inStock:false})]),{...purchase([component(4,null,{name:'SSD'})]),id:'2',proveedor:'Venta sin stock'}];
  vm.runInContext('combos=input',c);
  assert.equal(vm.runInContext('getInventoryGroups().find(g=>g.productId===10).stock',c),1);
  assert.equal(vm.runInContext('getInventoryGroups().find(g=>g.name==="SSD").stock',c),0);
  c.input[0].components[0].sale=0;
  assert.equal(vm.runInContext('getInventoryGroups().find(g=>g.productId===10).stock',c),0,'Una venta por cero también es una venta');
});
