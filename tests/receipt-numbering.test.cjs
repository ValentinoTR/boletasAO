const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const receipt=fs.readFileSync(require.resolve('../dist/assets/receipt.js'),'utf8');
const start=receipt.indexOf('async function startNextReceipt'),end=receipt.indexOf('\n}',start)+2;
assert.ok(start>0&&end>start);
const source=receipt.slice(start,end);
// La función se ejecuta aislada con el estado mínimo que usa la pantalla de boletas.
function screen({issued=true,advanceId='A',currentId='A',nextNumber=111}={}){
  const calls=[],toasts=[];
  const context=vm.createContext({calls,toasts,crypto:{randomUUID:()=>'NEW'},
    autoAdvanceId:advanceId,cloudReceiptId:currentId,viewingIssued:issued,pendingDelivery:{to:'a@b.pe'},
    data:{series:'b001',number:'110',observations:'1 AÑO DE GARANTÍA.'},
    emptyReceipt:(number,series,observations)=>({number,series,observations}),
    resetErrors(){calls.push('reset');},hydrate(){calls.push('hydrate');},saveDraft(){calls.push('save');},
    async refreshCloudNumber(){if(nextNumber===null)return false;context.data.number=String(nextNumber);return true;},
    toast(text){toasts.push(text);}});
  vm.runInContext(source,context);
  return context;
}
test('Tras emitir se abre una boleta nueva con el número siguiente',async()=>{
  const s=screen();await vm.runInContext("startNextReceipt('emitida y enviada')",s);
  assert.equal(s.viewingIssued,false);assert.equal(s.cloudReceiptId,'NEW');assert.equal(s.autoAdvanceId,null);assert.equal(s.pendingDelivery,null);
  assert.equal(s.data.number,'111');assert.equal(s.data.series,'B001');assert.equal(s.data.observations,'1 AÑO DE GARANTÍA.');
  assert.match(s.toasts.at(-1),/Boleta B001-110 emitida y enviada\. Nueva boleta lista: B001-111\./);
});
test('Si no se pudo consultar el siguiente número lo indica sin inventar uno',async()=>{
  const s=screen({nextNumber:null});await vm.runInContext("startNextReceipt('emitida y guardada')",s);
  assert.equal(s.viewingIssued,false);assert.match(s.toasts.at(-1),/se asignará al emitir/);assert.doesNotMatch(s.toasts.at(-1),/B001-111/);
});
test('Una boleta antigua abierta desde el historial no avanza',async()=>{
  const s=screen({advanceId:null});await vm.runInContext("startNextReceipt('emitida y guardada')",s);
  assert.equal(s.viewingIssued,true);assert.equal(s.cloudReceiptId,'A');assert.equal(s.data.number,'110');assert.deepEqual(s.toasts,[]);
});
test('No avanza si la boleta mostrada cambió mientras se enviaba',async()=>{
  const s=screen({currentId:'OTHER'});await vm.runInContext("startNextReceipt('emitida y enviada')",s);
  assert.equal(s.cloudReceiptId,'OTHER');assert.equal(s.viewingIssued,true);assert.deepEqual(s.toasts,[]);
});
