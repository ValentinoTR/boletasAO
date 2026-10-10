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
