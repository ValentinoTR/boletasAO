from pathlib import Path

def apply(root):
    dist=root/'dist'
    def replace(text,old,new):
        assert text.count(old)==1,old[:120]
        return text.replace(old,new,1)
    index=(dist/'index.html').read_text()
    index=replace(index,'<div id="catalogGrid"','<div class="stock-tabs" aria-label="Disponibilidad de productos"><button type="button" data-stock-filter="available" class="active" aria-pressed="true">En stock</button><button type="button" data-stock-filter="replenish" aria-pressed="false">Para reponer</button></div><div id="catalogGrid"')
    incoming='''<section id="productIncoming" class="product-incoming"><h3>Unidades que estás trayendo</h3><label for="productQuantity">¿Cuántas unidades estás trayendo?</label><input id="productQuantity" type="number" min="0" max="1000" step="1" value="1" required><p class="hint">Si aún no tienes unidades, indica 0 y el producto quedará en Para reponer.</p><div id="productPurchaseFields"><label for="productUnitCost">Costo de compra por unidad (S/)</label><input id="productUnitCost" type="number" min="0" step="0.01"><div class="field-grid"><div><label for="productSupplier">Proveedor · opcional</label><input id="productSupplier" maxlength="150"></div><div><label for="productPurchaseDate">Fecha de compra</label><input id="productPurchaseDate" type="date"></div></div></div></section>'''
    index=replace(index,'      <label for="productPhoto">',incoming+'\n      <label for="productPhoto">')
    stock='''<dialog id="stockDialog" class="suite-dialog" aria-labelledby="stockTitle"><form id="stockForm"><div class="dialog-heading"><h2 id="stockTitle">Modificar stock</h2><button type="button" data-close="stockDialog" class="quiet" aria-label="Cerrar">✕</button></div><p id="stockSummary" class="suite-notice stock-dialog-summary"></p><label id="stockQuantityLabel" for="stockQuantity">Cantidad disponible correcta</label><input id="stockQuantity" type="number" min="0" max="100000" step="1" required><p id="stockHint" class="hint"></p><div id="stockPurchaseFields" class="stock-cost-fields"><label for="stockCost">Costo de compra por unidad nueva (S/)</label><input id="stockCost" type="number" min="0" step="0.01"><div class="field-grid"><div><label for="stockSupplier">Proveedor · opcional</label><input id="stockSupplier" maxlength="150"></div><div><label for="stockDate">Fecha de compra</label><input id="stockDate" type="date"></div></div></div><p id="stockMessage" class="message" role="status"></p><button id="stockSave" type="submit" class="primary">Guardar stock</button></form></dialog>'''
    index=replace(index,'    <div id="suiteToast"',stock+'\n    <div id="suiteToast"')
    index=replace(index,'<span class="cloud-badge">','<div class="theme-control"><button type="button" class="secondary theme-toggle" data-theme-toggle>Modo oscuro</button><span class="cloud-badge">')
    index=replace(index,' Datos en la nube</span></div>',' Datos en la nube</span></div></div>')
    index=replace(index,'<body>','<body><button type="button" data-theme-toggle class="secondary theme-toggle entry-theme-toggle" id="loginThemeToggle">Modo oscuro</button>')
    index=index.replace('href="https://aonexuspe.github.io/"','data-theme-link href="https://aonexuspe.github.io/"')
    app=(dist/'assets/app.js').read_text()
    app=replace(app,'$("appView").hidden = true;','$("appView").hidden = true; $("loginThemeToggle").hidden = false;')
    app=replace(app,'$("loginView").hidden = true; $("appView").hidden = false;','$("loginView").hidden = true; $("loginThemeToggle").hidden = true; $("appView").hidden = false;')
    (dist/'assets/app.js').write_text(app)
    (dist/'index.html').write_text(index)
    accounting=(dist/'accounting.html').read_text()
    accounting=replace(accounting,'          saleCost: comp.sale_cost', '          inStock: comp.in_stock !== false,\n          productId: comp.product_id,\n          saleCost: comp.sale_cost')
    accounting=accounting.replace("c.sale === null ? c.costoFinal : 0", "c.sale === null && c.inStock ? c.costoFinal : 0")
    accounting=accounting.replace("estado: comp.sale !== null ? 'vendido' : 'pendiente'", "estado: comp.sale !== null ? 'vendido' : comp.inStock ? 'pendiente' : 'retirado'")
    accounting=replace(accounting,"    }else{\n      invertidoStock += row.costo;", "    }else if(row.estado === 'pendiente'){\n      invertidoStock += row.costo;")
    accounting=replace(accounting,"    if(row.estado === 'pendiente'){ pendientesTotal++; return; }", "    if(row.estado === 'pendiente'){ pendientesTotal++; return; }\n    if(row.estado === 'retirado')return;")
    accounting=accounting.replace("der.comps.some(x => x.sale === null)", "der.comps.some(x => x.sale === null && x.inStock)")
    accounting=accounting.replace("${comp.sale !== null ? 'Vendido' : 'Pendiente'}", "${comp.sale !== null ? 'Vendido' : comp.inStock ? 'En stock' : 'Retirado del stock'}")
    accounting=replace(accounting,'                <input type="number" class="comp-input comp-sale-input"','                <input type="number" ${!comp.inStock ? \'disabled\' : \'\'} class="comp-input comp-sale-input"')
    start=accounting.index('function getInventoryGroups(){')
    end=accounting.index('function findGroupItems(',start)
    accounting=accounting[:start]+INVENTORY+accounting[end:]
    accounting=replace(accounting,'function findGroupItems(name){','function findGroupItems(name,productId){')
    accounting=replace(accounting,'  const g = groups.find(x => x.name.trim().toLowerCase() === key);','  const g = groups.find(x => productId?String(x.productId)===String(productId):!x.productId&&x.name.trim().toLowerCase() === key);')
    for function in ['inventarioEditar','inventarioRegistrarVenta']:
        accounting=replace(accounting,'async function '+function+'(name){\n  const items = findGroupItems(name);','async function '+function+'(name,productId){\n  const items = findGroupItems(name,productId);')
    controls='''<div id="purchase-stock-fields" class="form-grid"><div class="field"><label for="c-quantity">¿Cuántas unidades estás trayendo?</label><input id="c-quantity" type="number" min="0" max="1000" step="1" value="1" required><div class="help">Unidades iguales. Para un combo con piezas distintas, indica 0 y agrega sus componentes.</div></div><div class="field"><label for="c-product">Producto de mi web · opcional</label><select id="c-product"><option value="">Sin vincular al catálogo</option></select><div class="help">Las nuevas unidades actualizarán el stock de este producto.</div></div></div>'''
    marker='                <div class="form-grid">\n                  <div class="field span-2">\n                    <label for="c-name">'
    accounting=replace(accounting,marker,controls+'\n'+marker)
    accounting=accounting.replace('Costo del producto</label>','Costo total de la compra</label>')
    accounting=replace(accounting,'function resetPurchaseForm(){','let purchaseRequest=crypto.randomUUID();\nfunction resetPurchaseForm(){\n  purchaseRequest=crypto.randomUUID();document.getElementById("c-quantity").value="1";document.getElementById("c-product").value="";')
    accounting=replace(accounting,'function setEditModeUI(editing){','function setEditModeUI(editing){\n  document.getElementById("purchase-stock-fields").hidden=editing;')
    accounting=replace(accounting,"    : await db.from('COMPRAS').insert(payload);",'''    : await db.rpc('ao_suite_create_purchase',{request_key:purchaseRequest,purchase_data:payload,quantity:Number(document.getElementById('c-quantity').value),product_key:Number(document.getElementById('c-product').value)||null});''')
    accounting=replace(accounting,"  const nameBad = !name;", "  const countText=document.getElementById('c-quantity').value.trim(),count=Number(countText);\n  if(!editingId&&(!/^\\d+$/.test(countText)||!Number.isInteger(count)||count<0||count>1000)){toast('Indica una cantidad entera entre 0 y 1000.','error');return;}\n  const nameBad = !name;")
    accounting=replace(accounting,"  const costoRaw = costoInput.value.trim();", "  const countRaw=prompt('¿Cuántas unidades de '+name+' estás trayendo?','1');if(countRaw===null)return;\n  const componentQuantity=Number(countRaw);if(!/^\\d+$/.test(countRaw.trim())||!Number.isInteger(componentQuantity)||componentQuantity<1||componentQuantity>1000){toast('Indica una cantidad entera entre 1 y 1000.','error');return;}\n  const costoRaw = costoInput.value.trim();")
    accounting=replace(accounting,"  const { error } = await db.from('COMPONENTES').insert(payload);", "  const { error } = await db.from('COMPONENTES').insert(Array.from({length:componentQuantity},()=>({...payload})));" )
    accounting=replace(accounting,"  toast('Compra \"' + name + '\" registrada. Ahora agrega sus componentes.');", "  toast('Compra \"' + name + '\" registrada'+(count?' con '+count+' unidad(es) en stock.':'. Ahora agrega sus componentes.'));")
    accounting=replace(accounting,'function renderCompras(){', '''function renderCompras(){
  const select=document.getElementById('c-product'),selected=select.value;
  select.innerHTML='<option value="">Sin vincular al catálogo</option>'+stockProducts().map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');select.value=selected;
''')
    accounting=replace(accounting,'let purchaseRequest=crypto.randomUUID();', '''document.getElementById('c-product').addEventListener('change',event=>{
  const product=stockProducts().find(p=>String(p.id)===event.target.value);
  if(product)document.getElementById('c-name').value=product.name;
});
let purchaseRequest=crypto.randomUUID();''')
    accounting=replace(accounting,'function applyTheme(theme){','function paintAccountingTheme(theme){')
    accounting=replace(accounting,"  try{ localStorage.setItem('ao-suite-theme', theme); }catch(e){}",'')
    accounting=replace(accounting,"document.getElementById('theme-btn').addEventListener",'''function applyTheme(theme){window.AOTheme.set(theme);}
document.addEventListener('ao-theme-change',event=>paintAccountingTheme(event.detail));
document.getElementById('theme-btn').addEventListener''')
    accounting=replace(accounting,'applyTheme(currentTheme());','paintAccountingTheme(window.AOTheme.get());')
    accounting=accounting.replace('Stock pendiente de venta</h2>','Disponibilidad de productos</h2>')
    accounting=replace(accounting,'      <section class="view-section" data-view="inventario">','      <section class="view-section" data-view="inventario"><div class="inventory-tabs"><button class="btn btn-secondary active" type="button" data-inventory-mode="available">En stock</button><button class="btn btn-secondary" type="button" data-inventory-mode="replenish">Para reponer</button></div>')
    accounting=accounting.replace("  const eraPendiente = !comp || comp.sale === null;","  if(comp&&!comp.inStock){toast('Esta unidad está retirada del stock. Registra nuevas unidades para vender.','error');return;}\n  const eraPendiente = !comp || comp.sale === null;")
    (dist/'accounting.html').write_text(accounting)
    for name in ['index.html','boletas.html','accounting.html']:
        p=dist/name;text=p.read_text()
        text=replace(text,'<head>','<head>\n<script src="assets/theme.js"></script>')
        css='receipt-theme.css' if name=='boletas.html' else 'theme.css' if name=='index.html' else None
        if css:text=replace(text,'</head>','<link rel="stylesheet" href="assets/'+css+'">\n</head>')
        if name=='accounting.html':text=replace(text,'</head>','<style>.inventory-tabs{display:flex;gap:10px;margin-bottom:20px}.inventory-tabs .active{border-color:var(--accent);color:var(--accent)}#purchase-stock-fields{margin-bottom:18px}[hidden]{display:none!important}</style></head>')
        p.write_text(text)

INVENTORY='''let inventoryMode='available';
function stockProducts(){return window.parent.AOSuite?.stockProducts?.()||[];}
function getInventoryGroups(){
  const map=new Map(),products=stockProducts();
  products.forEach(p=>map.set('p:'+p.id,{name:p.name,productId:p.id,items:[]}));
  combos.forEach(combo=>comboDerived(combo).comps.forEach(comp=>{
    const key=comp.productId?'p:'+comp.productId:'n:'+comp.name.trim().toLowerCase();
    if(!map.has(key))map.set(key,{name:products.find(p=>String(p.id)===String(comp.productId))?.name||comp.name.trim(),productId:comp.productId||null,items:[]});
    if(comp.sale===null&&comp.inStock)map.get(key).items.push({comboId:combo.id,compId:comp.id,costo:comp.costoFinal,estimado:comp.estimado,sugerido:comp.sugerido});
  }));
  return Array.from(map.values()).map(g=>{
    const stock=g.items.length,costoTotal=g.items.reduce((s,i)=>s+i.costo,0),costoProm=stock?costoTotal/stock:null;
    const prices=g.items.map(i=>i.sugerido).filter(v=>v!==null),ventaProm=prices.length?prices.reduce((s,v)=>s+v,0)/prices.length:null;
    return {...g,stock,costoTotal,costoProm,ventaProm,ganancia:ventaProm!==null?(ventaProm-costoProm)*stock:null,algunoEstimado:g.items.some(i=>i.estimado)};
  }).sort((a,b)=>a.name.localeCompare(b.name));
}
function renderInventario(){
  const all=getInventoryGroups(),available=all.filter(g=>g.stock>0),groups=all.filter(g=>inventoryMode==='replenish'?g.stock===0:g.stock>0);
  lastInventoryGroups=groups;
  document.querySelectorAll('[data-inventory-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.inventoryMode===inventoryMode);b.setAttribute('aria-pressed',String(b.dataset.inventoryMode===inventoryMode));});
  document.getElementById('inv-productos').textContent=available.length;
  document.getElementById('inv-unidades').textContent=available.reduce((n,g)=>n+g.stock,0);
  document.getElementById('inv-valor').textContent=fmt(available.reduce((n,g)=>n+g.costoTotal,0));
  document.getElementById('inv-proyectada').textContent=fmtSigned(available.reduce((n,g)=>n+(g.ganancia||0),0));
  const body=document.querySelector('#tabla-inventario tbody');
  body.innerHTML=groups.length?groups.map((g,i)=>`<tr><td><div class="strong">${escapeHtml(g.name)}</div></td><td class="num"><span class="badge ${g.stock?'neutral':'pendiente'}">${g.stock||'Para reponer'}</span></td><td class="num">${g.costoProm!==null?fmt(g.costoProm):'—'}</td><td class="num">${g.ventaProm!==null?fmt(g.ventaProm):'—'}</td><td class="num ${moneyClass(g.ganancia)}">${g.ganancia!==null?fmtSigned(g.ganancia):'—'}</td><td><div class="row-actions"><button class="btn btn-secondary btn-sm inv-stock" data-idx="${i}">Modificar stock</button><button class="btn btn-soft btn-sm inv-restock" data-idx="${i}">Reponer</button>${g.stock?`<button class="btn btn-secondary btn-sm inv-edit" data-idx="${i}">Precio sugerido</button><button class="btn btn-soft btn-sm inv-vender" data-idx="${i}">Vender</button>`:''}</div></td></tr>`).join(''):emptyRow(6,'package',inventoryMode==='replenish'?'No hay productos para reponer':'No hay unidades disponibles','Registra una compra o repón un producto existente.');
  body.querySelectorAll('.inv-stock,.inv-restock').forEach(b=>b.addEventListener('click',()=>window.parent.AOSuite?.openStockGroup(lastInventoryGroups[Number(b.dataset.idx)],b.classList.contains('inv-restock'))));
  body.querySelectorAll('.inv-edit,.inv-vender').forEach(b=>b.addEventListener('click',()=>{const g=lastInventoryGroups[Number(b.dataset.idx)];b.classList.contains('inv-edit')?inventarioEditar(g.name,g.productId):inventarioRegistrarVenta(g.name,g.productId);}));
}
document.querySelectorAll('[data-inventory-mode]').forEach(b=>b.addEventListener('click',()=>{inventoryMode=b.dataset.inventoryMode;renderInventario();}));
'''
