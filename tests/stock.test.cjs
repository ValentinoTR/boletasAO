const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../dist/assets/suite-core.js');
test('En stock excluye unidades vendidas y retiradas; Para reponer conserva el producto',()=>{
  const products=[{id:1,managed:true},{id:2,managed:true},{id:3,managed:false,reference_stock:4}];
  const units=[{product_id:1,precio_venta:700,in_stock:true},{product_id:1,precio_venta:null,in_stock:false},{product_id:2,precio_venta:null,in_stock:true}];
  assert.deepEqual(core.filterStock(products,units,'available').map(p=>p.id),[2,3]);
  assert.deepEqual(core.filterStock(products,units,'replenish').map(p=>p.id),[1]);
  units.push({product_id:1,precio_venta:null,in_stock:true});
  assert.deepEqual(core.filterStock(products,units,'replenish'),[]);
});
test('Una corrección de cantidad conserva el reparto original de costos',()=>{
  const units=[{id:1,costo:null,precio_venta:700,in_stock:true},{id:2,costo:null,precio_venta:null,in_stock:false},{id:3,costo:null,precio_venta:null,in_stock:true}];
  const allocated=core.allocate({costo:1800,moneda:'PEN'},units);
  assert.deepEqual(allocated.map(u=>u.calculatedCost),[600,600,600]);
  assert.equal(allocated.filter(core.available).length,1);
});
test('Las cantidades son enteras y permiten registrar un producto para futura reposición',()=>{
  assert.equal(core.quantity('0'),0);assert.equal(core.quantity('3'),3);
  for(const value of ['','-1','1.5','abc','100001'])assert.throws(()=>core.quantity(value));
});
test('El costo de compra al sumar stock es opcional y vacío equivale a S/ 0.00',()=>{
  for(const value of ['',' ',null,undefined])assert.equal(core.optionalCents(value),0);
  assert.equal(core.optionalCents('350'),35000);assert.equal(core.optionalCents('12,5'),1250);
  for(const value of ['-1','abc','1.234'])assert.throws(()=>core.optionalCents(value));
});


test('La consulta de stock público rechaza cantidades inválidas y productos duplicados',()=>{
  assert.throws(()=>core.catalogRows(null));assert.throws(()=>core.catalogRows({}));
  const p={id:18,name:'ASUS TUF B550-PLUS WIFI II',stock:1};
  assert.equal(core.catalogRows({productos:[p]})[0].stock,1);
  for(const stock of [-1,1.5,null,undefined,'1'])assert.throws(()=>core.catalogRows({productos:[{...p,stock}]}));
  assert.throws(()=>core.catalogRows({productos:[p,{...p,id:'18'}]}));
});
