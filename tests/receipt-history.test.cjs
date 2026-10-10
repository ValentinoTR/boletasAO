const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const app=fs.readFileSync(require.resolve('../dist/assets/app.js'),'utf8');
const start=app.indexOf('let deleteReceiptState=null'),end=app.indexOf('  async function loadHistory()',start);
assert.ok(start>0&&end>start);
const source=app.slice(start,end)+'\nglobalThis.actions={open:openReceiptDeletion,remove:deleteReceipt,reset:resetReceiptDeletion};';
function screen({rpcError=false,refreshError=false,deferred=false}={}){
  const nodes=new Map(),calls=[],messages=[],row={id:'68eff93a-fe02-4da1-a25e-a8601aee4966',series:'F001',number:1,customer:'Cliente'},tr={removed:false,remove(){this.removed=true;}};
  function node(id){if(!nodes.has(id))nodes.set(id,{open:false,disabled:false,textContent:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},showModal(){this.open=true;},close(){this.open=false;},focus(){},contentWindow:{resetDeletedReceipt(){calls.push('editor-reset');},refreshFromSuite(){calls.push('accounting-refresh');}}});return nodes.get(id);}
  const button={disabled:false,closest(){return tr;}};
  let resolve,attempts=0;
  const context=vm.createContext({$:node,authGeneration:1,historyPage:0,historyTotal:1,
    globalMessage(text){messages.push(text);},errorText(error){return error.message;},
    async rpc(name,args){calls.push({name,args});attempts++;if(rpcError&&attempts===1)throw Error('No se pudo conectar. Inténtalo otra vez.');if(deferred)return new Promise(done=>{resolve=done;});return {deleted:true,id:row.id,restored_units:0};},
    async loadHistory(){calls.push('history-refresh');if(refreshError)throw Error('No se pudo recargar.');},
    window:{AOSuite:{async refreshAfterMutation(){calls.push('suite-refresh');}}}});
  vm.runInContext(source,context);
  return {context,nodes,node,calls,messages,row,tr,button,resolve(value){resolve(value);},submit(){return node('deleteReceiptForm').listeners.submit({preventDefault(){}});}};
}
test('La confirmación se abre en la página y Cancelar no solicita eliminar',()=>{
  const s=screen();s.context.actions.open(s.row,s.button);
  assert.equal(s.node('deleteReceiptDialog').open,true);
  assert.match(s.node('deleteReceiptSummary').textContent,/F001-1/);
  s.node('deleteReceiptCancel').listeners.click();
  assert.equal(s.node('deleteReceiptDialog').open,false);
  assert.deepEqual(s.calls,[]);assert.equal(s.tr.removed,false);
});
test('Confirmar elimina la boleta anterior y recarga historial, stock y ventas',async()=>{
  const s=screen();s.context.actions.open(s.row,s.button);await s.submit();
  const request=s.calls.find(x=>typeof x==='object');
  assert.equal(request.name,'ao_suite_delete_receipt');assert.equal(request.args.receipt_key,s.row.id);
  assert.equal(s.tr.removed,true);assert.equal(s.node('deleteReceiptDialog').open,false);
  for(const operation of ['editor-reset','history-refresh','suite-refresh','accounting-refresh'])assert.ok(s.calls.includes(operation));
  assert.match(s.messages.at(-1),/Boleta F001-1 eliminada/);
});
test('Un fallo conserva la boleta, muestra el error y permite reintentar',async()=>{
  const s=screen({rpcError:true});s.context.actions.open(s.row,s.button);await s.submit();
  assert.equal(s.tr.removed,false);assert.equal(s.node('deleteReceiptDialog').open,true);
  assert.match(s.node('deleteReceiptMessage').textContent,/No se pudo conectar/);
  assert.equal(s.node('deleteReceiptConfirm').disabled,false);
  await s.submit();assert.equal(s.tr.removed,true);
});
test('Una segunda pulsación no duplica la solicitud y un fallo de recarga no revierte la eliminación',async()=>{
  const s=screen({deferred:true,refreshError:true});s.context.actions.open(s.row,s.button);
  const first=s.submit();await s.submit();
  assert.equal(s.calls.filter(x=>typeof x==='object').length,1);
  let prevented=false;s.node('deleteReceiptDialog').listeners.cancel({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(s.node('deleteReceiptDialog').open,true);
  s.resolve({deleted:true,id:s.row.id,restored_units:0});await first;
  assert.equal(s.tr.removed,true);assert.match(s.messages.at(-1),/eliminada.*Pulsa Actualizar/);
});
test('Cerrar sesión durante la petición no muestra resultados de la cuenta anterior',async()=>{
  const s=screen({deferred:true});s.context.actions.open(s.row,s.button);const pending=s.submit();
  s.context.authGeneration++;s.context.actions.reset();
  s.resolve({deleted:true,id:s.row.id,restored_units:0});await pending;
  assert.equal(s.node('deleteReceiptDialog').open,false);
  assert.equal(s.calls.includes('suite-refresh'),false);assert.equal(s.messages.at(-1),'');
});
