const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../dist/assets/theme.js'),'utf8');
function page({saved,defaultTheme='light',parent,blocked=false,url='https://example.com/',linkHref}={}){
  const attrs={},events={},windowEvents={},frames=[],button={setAttribute(){},textContent:''},links=linkHref?[{href:linkHref}]:[];
  const storage=new Map(saved?[['ao-suite-theme',saved]]:[]);
  const doc={documentElement:{dataset:{defaultTheme},style:{},setAttribute(k,v){attrs[k]=v;}},querySelector(){return null;},querySelectorAll(selector){return selector==='iframe'?frames:selector==='[data-theme-toggle]'?[button]:selector==='[data-theme-link]'?links:[];},addEventListener(name,fn){events[name]=fn;},dispatchEvent(){}};
  const win={location:{href:url},addEventListener(name,fn){windowEvents[name]=fn;}};win.parent=parent||win;
  vm.runInNewContext(source,{URL,window:win,document:doc,localStorage:{getItem(k){if(blocked)throw Error('blocked');return storage.get(k)||null;},setItem(k,v){if(blocked)throw Error('blocked');storage.set(k,v);}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}});
  return {win,doc,attrs,events,windowEvents,frames,button,storage,links};
}
test('El tema cambia el panel y todos sus marcos y recuerda la elección',()=>{
  const root=page(),receipt=page({parent:root.win}),accountant=page({parent:root.win});
  root.frames.push({contentWindow:receipt.win},{contentWindow:accountant.win});
  root.win.AOTheme.set('dark');
  for(const p of [root,receipt,accountant])assert.equal(p.attrs['data-theme'],'dark');
  assert.equal(root.storage.get('ao-suite-theme'),'dark');
  accountant.win.AOTheme.set('light');
  for(const p of [root,receipt,accountant])assert.equal(p.attrs['data-theme'],'light');
  assert.match(root.button.textContent,/Modo oscuro/);
});
test('Marcos nuevos heredan la elección y las otras pestañas se sincronizan',()=>{
  const root=page({saved:'dark'}),child=page({saved:'light',parent:root.win});root.frames.push({contentWindow:child.win});
  assert.equal(child.attrs['data-theme'],'dark');
  root.windowEvents.storage({key:'ao-suite-theme',newValue:'light'});
  assert.equal(child.attrs['data-theme'],'light');
});
test('La tienda arranca oscura y el tema funciona aunque el almacenamiento esté bloqueado',()=>{
  const store=page({defaultTheme:'dark',blocked:true});assert.equal(store.attrs['data-theme'],'dark');
  store.win.AOTheme.set('light');assert.equal(store.attrs['data-theme'],'light');
});
test('Abrir la tienda desde el panel conserva el tema elegido sin perder sus parámetros',()=>{
  const root=page({saved:'light',linkHref:'https://aonexuspe.github.io/?categoria=ssd'});
  root.win.AOTheme.set('dark');
  const href=root.links[0].href;
  assert.equal(new URL(href).searchParams.get('categoria'),'ssd');
  const shop=page({saved:'light',defaultTheme:'dark',url:href});
  assert.equal(shop.attrs['data-theme'],'dark');
  assert.equal(shop.storage.get('ao-suite-theme'),'dark');
});
