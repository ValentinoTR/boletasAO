const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/assets/suite-core.js');

test('El precio de una boleta usa céntimos exactos y admite coma decimal', () => {
  assert.equal(core.cents('700,25'), 70025);
  assert.equal(core.cents('0.01'), 1);
  for (const value of ['-1', '700.001', '1e3', '1,000.00', '']) assert.throws(() => core.cents(value));
});
test('Una placa se registra al precio final escrito, sin modificar su costo', () => {
  const original = [{source:'stock',id:1,name:'Placa B850',price:'750.00'}];
  const repriced = core.repriceParts(original,core.cents('700'));
  assert.equal(repriced[0].price,'700.00');
  assert.equal(original[0].price,'750.00');
  assert.equal(core.allocate({costo:600,moneda:'PEN'},[{id:1,costo:600}])[0].calculatedCost,600);
});
test('Un descuento en una PC conserva el total y los costos de cada origen', () => {
  const parts=[{source:'stock',id:1,name:'Placa',price:'700.00'}, {source:'external',name:'GPU',cost:'800.00',price:'900.00'}];
  const repriced=core.repriceParts(parts,145000);
  assert.deepEqual(repriced.map(p=>p.price),['634.38','815.62']);
  assert.equal(core.validateParts(repriced),145000);
  assert.equal(repriced[1].cost,'800.00');
});
test('Varias unidades de la misma referencia respetan el precio unitario de la boleta', () => {
  const parts=[1,2,3].map(id=>({source:'stock',id,name:'SSD 1 TB',price:'480.00'}));
  assert.deepEqual(core.repriceParts(parts,3*42550).map(p=>p.price),['425.50','425.50','425.50']);
});
test('Los céntimos que no se dividen exactamente se conservan', () => {
  const parts=[1,2,3].map(id=>({source:'stock',id,name:'Componente',price:'1.00'}));
  assert.deepEqual(core.repriceParts(parts,100).map(p=>p.price),['0.34','0.33','0.33']);
  assert.equal(core.validateParts(core.repriceParts(parts,101)),101);
});
test('Con precios iniciales cero se reparte todo el importe sin perder céntimos', () => {
  const parts=[1,2].map(id=>({source:'stock',id,name:'Componente',price:'0.00'}));
  assert.deepEqual(core.repriceParts(parts,70101).map(p=>p.price),['350.51','350.50']);
});
test('Se rechazan unidades repetidas y compras externas incompletas', () => {
  assert.throws(()=>core.validateParts([{source:'stock',id:1,price:'100'}, {source:'stock',id:'1',price:'100'}]));
  assert.throws(()=>core.validateParts([{source:'external',name:'',cost:'80',price:'100'}]));
  assert.throws(()=>core.validateParts([{source:'external',name:'SSD',cost:'-80',price:'100'}]));
});
test('El costo incluye cambio de moneda, impuesto y transporte', () => {
  const purchase={costo:100,moneda:'USD',tipo_cambio:3.8,impuesto:10,peso_kg:2,costo_envio_kg:10,tax_usa:15,impuesto_peru:2,otros_gastos:8};
  assert.equal(Number(core.realCost(purchase).toFixed(2)),463);
  const allocated=core.allocate(purchase,[{id:1,costo:163},{id:2,costo:null},{id:3,costo:null}]);
  assert.deepEqual(allocated.map(p=>p.calculatedCost),[163,150,150]);
  assert.deepEqual(allocated.map(p=>p.estimated),[false,true,true]);
});
test('Una compra externa puede venderse sin indicar su costo',()=>{
  assert.equal(core.validateParts([{source:'external',name:'Ryzen 7 9800X3D',cost:'',price:'1800.00'}]),180000);
  assert.equal(core.validateParts([{source:'external',name:'Ryzen 7 9800X3D',cost:'0.00',price:'1800.00'}]),180000);
  assert.throws(()=>core.validateParts([{source:'external',name:'Ryzen 7 9800X3D',cost:'abc',price:'1800.00'}]));
  assert.throws(()=>core.validateParts([{source:'external',name:'Ryzen 7 9800X3D',cost:'',price:''}]));
});
test('Los productos del catálogo anterior se activan como unidades reales sin costo',()=>{
  const products=[{id:1,managed:false,reference_stock:2,data:{name:'Ryzen 7 7700X'}},{id:2,managed:true,reference_stock:0,data:{name:'SSD'}},{id:3,managed:false,reference_stock:0,data:{name:'Ryzen 5 5600'}}];
  // Solo cuentan los productos con cantidad: los de cantidad 0 siguen como «Para reponer» sin necesitar activación.
  assert.deepEqual(core.legacyProducts(products).map(p=>p.id),[1]);
  assert.deepEqual(core.legacyStockArgs(products[0],'key','2026-10-11'),{request_key:'key',product_key:1,product_name:'Ryzen 7 7700X',target_quantity:2,expected_quantity:0,cost_per_unit:0,supplier:'Stock inicial (catálogo anterior)',purchased_on:'2026-10-11'});
  // La función de stock registra hasta 1000 unidades por compra: los productos mayores no se activan en bloque.
  const big=[{id:7,managed:false,reference_stock:1000,data:{name:'A'}},{id:8,managed:false,reference_stock:1001,data:{name:'B'}}];
  assert.deepEqual(core.legacyProducts(big).map(p=>p.id),[7,8]);assert.deepEqual(core.activatableProducts(big).map(p=>p.id),[7]);
});
