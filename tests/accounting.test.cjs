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
  const c=runtime([{id:10,name:'Placa',managed:false,stock:4},{id:11,name:'SSD',managed:false,stock:4}]);
  c.input=[purchase([component(1),component(2,500),component(3,null,{inStock:false})])];
  vm.runInContext('combos=input',c);
  const groups=vm.runInContext('getInventoryGroups()',c);
  assert.equal(groups.length,2);assert.equal(groups[0].name,'Placa');assert.equal(groups[0].stock,4);assert.equal(groups[0].items.length,1);assert.equal(Math.round(groups[0].costoProm*100)/100,333.33,'El costo de Compras se usa como referencia para todo el stock');assert.equal(groups[0].missing,0);assert.equal(groups[1].stock,4);assert.equal(groups[1].costoProm,null,'Sin compras no se inventa un costo');
});
test('Inventario conserva productos agotados y excluye compras de venta sin stock',()=>{
  const c=runtime([{id:10,name:'Placa',managed:true,stock:1}]);
  c.input=[purchase([component(1,null,{productId:10}),component(2,600,{productId:10}),component(3,null,{productId:10,inStock:false})]),{...purchase([component(4,null,{name:'SSD'})]),id:'2',proveedor:'Venta sin stock'}];
  vm.runInContext('combos=input',c);
  assert.equal(vm.runInContext('getInventoryGroups().find(g=>g.productId===10).stock',c),1);
  assert.equal(vm.runInContext('getInventoryGroups().some(g=>g.name==="SSD")',c),false,'Las compras ajenas a la web no incrementan el stock público');
  c.input[0].components[0].sale=0;
  vm.runInContext('window.parent.AOSuite.stockProducts=()=>[{id:10,name:"Placa",managed:true,stock:0}]',c);
  assert.equal(vm.runInContext('getInventoryGroups().find(g=>g.productId===10).stock',c),0,'Una venta por cero también es una venta');
});


test('ASUS B550: el inventario conserva una unidad publicada pese a ventas históricas y compras sobrantes',()=>{
  const c=runtime([{id:18,name:'B550-PLUS ASUS TUF GAMING WIFI II',managed:false,stock:1,webPrice:500}]);
  c.input=[purchase([component(1,500,{name:'ASUS TUF B550-PLUS WIFI II'}),component(2,null,{name:'B550-PLUS ASUS TUF GAMING WIFI II'}),component(3,null,{name:'B550-PLUS ASUS TUF GAMING WIFI II'})])];
  vm.runInContext('combos=input',c);
  const groups=vm.runInContext('getInventoryGroups()',c);
  assert.equal(groups.length,1);assert.equal(groups[0].stock,1);assert.equal(groups[0].items.length,1);
});

test('El inventario usa la web para el conteo y no confunde revisiones o fichas con nombres ambiguos',()=>{
  const c=runtime([{id:1,name:'ASUS TUF B550 PLUS WIFI II',managed:false,stock:1},{id:2,name:'ASUS TUF B550 PLUS WIFI',managed:false,stock:2},{id:3,name:'SSD 1TB',managed:false,stock:1},{id:4,name:'SSD 1TB',managed:false,stock:1}]);
  c.input=[purchase([component(1,null,{name:'B550-PLUS ASUS TUF WIFI II'}),component(2,null,{name:'SSD 1TB'}),component(3,null,{name:'Otro producto'})])];
  vm.runInContext('combos=input',c);
  const groups=vm.runInContext('getInventoryGroups()',c);
  assert.equal(groups.length,4);assert.equal(groups.reduce((n,g)=>n+g.stock,0),5);
  assert.equal(groups.find(g=>g.productId===1).items.length,1,'Nombre con mismo modelo y revisión en distinto orden');
  assert.equal(groups.find(g=>g.productId===2).items.length,0,'No mezclar WIFI II y WIFI');
  assert.equal(groups.filter(g=>g.name==='SSD 1TB').reduce((n,g)=>n+g.items.length,0),0,'No asignar compras a una ficha ambigua');
});
test('Inventario: costo de Compras (también para unidades registradas sin costo) y precio de la web',()=>{
  const c=runtime([{id:10,name:'Placa',managed:true,stock:2,webPrice:900}]);
  // Compra antigua con costo real ya vendida y unidades actuales registradas sin costo (S/ 0.00).
  c.input=[{...purchase([component(1,850,{productId:10,saleCost:600})]),fechaCompra:'2026-01-01'},{...purchase([component(2,null,{productId:10,costo:0}),component(3,null,{productId:10,costo:0})]),id:'2',cost:0,proveedor:'Stock inicial (catálogo anterior)',fechaCompra:'2026-02-01'}];
  vm.runInContext('combos=input',c);
  const g=vm.runInContext('getInventoryGroups()[0]',c);
  assert.equal(g.costoProm,600);assert.equal(g.ventaProm,900);assert.equal(g.ganancia,600);assert.equal(g.missing,0);
});
