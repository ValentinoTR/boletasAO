from pathlib import Path
import shutil, json, re, hashlib

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
ORIG = ROOT / 'original'
DIST.mkdir(exist_ok=True)
shutil.copytree(ORIG / 'boletas/assets', DIST / 'assets', dirs_exist_ok=True)
shutil.copy(ORIG / 'boletas/boletas.html', DIST / 'boletas.html')
shutil.copy(ORIG / 'catalogo/categorias.js', DIST / 'assets/categorias.js')

def replace_once(text, old, new):
    assert text.count(old) == 1, old[:100]
    return text.replace(old, new, 1)

index = (ORIG / 'boletas/index.html').read_text()
index = index.replace('AO Nexus · Boletas', 'AO Nexus · Central')
index = index.replace('AO NEXUS<small>BOLETAS</small>', 'AO NEXUS<small>CENTRAL</small>')
index = index.replace('Una venta.<br>Todo en orden.', 'Tu negocio.<br>En un solo lugar.')
index = index.replace('Crea tus boletas, descarga el PDF y consulta el historial de tu equipo desde cualquier dispositivo.', 'Compras, inventario, catálogo y boletas conectados. Registra una venta y consulta sus productos, cliente y ganancia desde un mismo panel.')
index = index.replace('Datos compartidos y guardados en la nube', 'Un inventario para tus ventas y tu web')
index = index.replace('PDF listo para compartir por WhatsApp', 'Fotos y precio público de tus productos')
index = index.replace('Envío por correo cuando lo necesites', 'Boletas en PDF y envío por correo')
index = index.replace('AO Nexus · Herramienta de ventas', 'AO Nexus · Administración del negocio')
index = index.replace('<script defer src="assets/app.js"></script>', '<script defer src="assets/categorias.js"></script>\n  <script defer src="assets/suite-core.js"></script>\n  <script defer src="assets/suite.js"></script>\n  <script defer src="assets/app.js"></script>')
index = index.replace('</head>', '<link rel="stylesheet" href="assets/suite.css">\n</head>')
index = index.replace('<nav aria-label="Menú principal">', '<nav aria-label="Menú principal"><button data-view="dashboard" class="nav-button">Resumen</button><button data-view="compras" class="nav-button">Compras</button><button data-view="inventario" class="nav-button">Inventario</button><button data-view="ventas" class="nav-button">Ventas</button><button data-view="catalog" class="nav-button">Mi web</button><button data-view="clients" class="nav-button">Clientes</button>')
index = index.replace('>Mi cuenta</button>', '>Mi cuenta</button><button data-view="connection" class="nav-button" id="connectionNav">Conexión inicial</button>')
extra = '''
    <section id="accountingView" hidden><iframe id="accountingFrame" title="Compras, inventario y resultados de AO Nexus" loading="lazy"></iframe></section>
    <section id="catalogView" class="page" hidden>
      <div class="page-title"><div><span class="eyebrow">CATÁLOGO PÚBLICO</span><h1>Los productos de tu web</h1><p class="muted">Fotos y precio publicado. El precio de cada venta se decide en su boleta.</p></div><div class="suite-actions"><a class="secondary" href="https://aonexuspe.github.io/" target="_blank" rel="noopener">Ver mi web</a><button id="newProduct" class="primary">Agregar producto</button></div></div>
      <div id="catalogConnection" class="suite-notice"></div>
      <div class="history-controls"><input id="catalogSearch" type="search" placeholder="Buscar producto o marca" aria-label="Buscar productos"><button id="refreshCatalogue" class="secondary">Actualizar</button></div>
      <div id="catalogGrid" class="catalog-grid"></div>
    </section>
    <section id="clientsView" class="page" hidden>
      <div class="page-title"><div><span class="eyebrow">CLIENTES Y VENTAS</span><h1>Quién compró cada producto</h1><p class="muted">El cliente se registra junto con su boleta.</p></div></div>
      <input id="clientSearch" type="search" placeholder="Buscar nombre o documento" aria-label="Buscar clientes"><div id="clientList" class="client-list"></div>
    </section>
    <section id="connectionView" class="page narrow" hidden>
      <div class="page-title"><div><span class="eyebrow">UNIFICAR TUS DATOS</span><h1>Traer mis compras anteriores</h1><p class="muted">El catálogo y tus boletas ya están disponibles. Para incorporar las compras del contabilizador, entra aquí con su cuenta anterior.</p></div></div>
      <div id="importStatus" class="suite-notice"></div>
      <section class="card"><form id="importForm"><label for="oldEmail">Correo del contabilizador anterior</label><input id="oldEmail" type="email" autocomplete="username" required><label for="oldPassword">Contraseña del contabilizador anterior</label><input id="oldPassword" type="password" autocomplete="current-password" required><p class="hint">Se consultarán tus compras, unidades vendidas y compradores, y se incorporarán al panel de AO Nexus. La contraseña no se guarda.</p><button class="primary" type="submit">Traer mis compras e inventario</button><p id="importMessage" class="message" role="status"></p></form></section>
      <section class="card"><h2>Vincular las unidades con tu catálogo</h2><p class="muted">Después de importar, abre Mi web y selecciona las unidades que corresponden a cada producto. Revisa la cantidad antes de activar el stock compartido.</p><button data-view="catalog" class="secondary">Abrir Mi web</button></section>
    </section>
    <dialog id="productDialog" class="suite-dialog"><form id="productForm"><div class="dialog-heading"><h2 id="productTitle">Producto de mi web</h2><button type="button" data-close="productDialog" class="quiet" aria-label="Cerrar">✕</button></div>
      <input id="productId" type="hidden"><label for="productName">Nombre del producto</label><input id="productName" maxlength="350" required><div class="field-grid"><div><label for="productBrand">Marca</label><input id="productBrand" maxlength="80"></div><div><label for="productCategory">Categoría</label><select id="productCategory"></select></div></div>
      <div class="field-grid"><div><label for="productPrice">Precio publicado (S/)</label><input id="productPrice" type="number" min="0" step="0.01" required></div><div><label for="productOldPrice">Precio anterior · opcional</label><input id="productOldPrice" type="number" min="0" step="0.01"></div></div>
      <label for="productSub">Descripción corta</label><input id="productSub" maxlength="500"><label for="productSpecs">Especificaciones · una por línea, Dato: valor</label><textarea id="productSpecs" rows="5" maxlength="5000"></textarea>
      <label for="productPhoto">Foto del producto · PNG, JPG o WebP</label><input id="productPhoto" type="file" accept="image/png,image/jpeg,image/webp"><img id="productPhotoPreview" alt="Foto actual del producto" hidden class="photo-preview">
      <div class="suite-checks"><label><input id="productPublished" type="checkbox" checked> Publicar en mi web</label><label><input id="productFeatured" type="checkbox"> Destacado</label><label><input id="productBest" type="checkbox"> Recomendado</label></div>
      <p class="hint">Las unidades se registran en Compras y se vinculan a este producto. Publicarlo no agrega stock por segunda vez.</p><p id="productMessage" class="message" role="status"></p><button class="primary" type="submit">Guardar producto</button>
    </form></dialog>
    <dialog id="linkDialog" class="suite-dialog"><div class="dialog-heading"><h2 id="linkTitle">Vincular stock</h2><button type="button" data-close="linkDialog" class="quiet" aria-label="Cerrar">✕</button></div><p id="linkReference" class="suite-notice"></p><input id="linkSearch" type="search" placeholder="Buscar unidades disponibles"><div id="linkUnits" class="unit-list"></div><p id="linkCount" class="hint"></p><p id="linkMessage" class="message" role="status"></p><button id="linkConfirm" class="primary">Confirmar estas unidades y activar stock compartido</button></dialog>
    <dialog id="inventoryDialog" class="suite-dialog wide"><div class="dialog-heading"><div><span class="eyebrow">DETALLE INTERNO DE LA VENTA</span><h2>Productos que entregas al cliente</h2></div><button type="button" data-close="inventoryDialog" class="quiet" aria-label="Cerrar">✕</button></div><p class="hint">Selecciona unidades de tu stock o agrega lo que compraste para esta venta. Este detalle conserva sus costos y no se imprime en el PDF.</p>
      <input id="inventorySearch" type="search" placeholder="Buscar en mi stock"><div id="inventoryUnits" class="unit-list"></div>
      <section class="external-box"><h3>Agregar una compra para esta venta</h3><div class="field-grid"><div><label for="externalName">Producto</label><input id="externalName" maxlength="350"></div><div><label for="externalSupplier">Tienda o proveedor</label><input id="externalSupplier" maxlength="150"></div><div><label for="externalCost">Costo real (S/)</label><input id="externalCost" type="number" min="0" step="0.01"></div><div><label for="externalPrice">Precio de venta (S/)</label><input id="externalPrice" type="number" min="0" step="0.01"></div></div><button type="button" id="addExternal" class="secondary">Agregar a esta venta</button></section>
      <h3>Componentes seleccionados</h3><div id="inventorySelected"></div><div class="sale-summary"><span>Total de los componentes</span><strong id="inventoryTotal">S/ 0.00</strong></div><p id="inventoryMessage" class="message" role="status"></p><button id="inventoryConfirm" class="primary">Usar estos productos en la boleta</button>
    </dialog>
    <dialog id="deleteReceiptDialog" class="suite-dialog" aria-labelledby="deleteReceiptTitle" aria-describedby="deleteReceiptSummary deleteReceiptDetails"><form id="deleteReceiptForm"><div class="dialog-heading"><h2 id="deleteReceiptTitle">Eliminar boleta</h2><button type="button" id="deleteReceiptClose" class="quiet" aria-label="Cerrar">✕</button></div><p id="deleteReceiptSummary"></p><div id="deleteReceiptDetails" class="muted"><p>La boleta se quitará del historial y de las ventas. Sus unidades vinculadas volverán al inventario y se actualizará la ganancia.</p><p>El número quedará reservado. Los PDF descargados y los correos ya enviados seguirán en poder de sus destinatarios.</p></div><p id="deleteReceiptMessage" class="message" role="status" aria-live="polite"></p><div class="suite-actions"><button type="button" id="deleteReceiptCancel" class="secondary" autofocus>Cancelar</button><button type="submit" id="deleteReceiptConfirm" class="primary receipt-delete-danger">Sí, eliminar boleta</button></div></form></dialog>
    <div id="suiteToast" class="suite-toast" role="status" hidden></div>
'''
index = index.replace('    <section id="historyView"', extra + '\n    <section id="historyView"', 1)
icons = {
 'dashboard':'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 'compras':'<path d="M3 4h2l3 12h10l3-9H6M9 21h.01M18 21h.01"/>',
 'inventario':'<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8M7 5.8l10 5.5"/>',
 'ventas':'<path d="m3 17 6-6 4 4 8-10M15 5h6v6"/>',
 'editor':'<path d="M13 3H5v18h14V9zM13 3v6h6M8 14h8M8 17h5"/>',
 'history':'<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 7v5l3 2"/>',
 'catalog':'<path d="M3 9h18M4 9v12h16V9M2 9l3-6h14l3 6M9 21v-7h6v7"/>',
 'clients':'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a4 4 0 0 1 3 4v2"/>',
 'team':'<circle cx="12" cy="8" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M4 6a3 3 0 0 0 0 6M20 6a3 3 0 0 1 0 6"/>',
 'connection':'<path d="M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
 'account':'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'
}
def nav_button(view, label, extra=''):
    svg='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+icons[view]+'</svg>'
    return f'<button type="button" data-view="{view}" class="nav-button" {extra}>{svg}<span>{label}</span></button>'
navigation=''.join(nav_button(v,l) for v,l in [('dashboard','Resumen'),('compras','Compras'),('inventario','Inventario'),('ventas','Ventas')])
navigation+='<span class="nav-group">VENDER Y PUBLICAR</span>'
navigation+=''.join(nav_button(v,l) for v,l in [('editor','Nueva boleta'),('history','Boletas emitidas'),('catalog','Mi web'),('clients','Clientes')])
navigation+='<span class="nav-group">ADMINISTRACIÓN</span>'+nav_button('team','Equipo','id="teamNav" hidden')+nav_button('connection','Conexión inicial','id="connectionNav"')+nav_button('account','Mi cuenta')
sidebar='<header class="app-header"><a class="brand compact" href="./"><span class="mark">AO</span><span>AO NEXUS<small>CENTRAL</small></span></a><p class="sidebar-caption">Tu negocio, conectado.</p><nav aria-label="Menú principal">'+navigation+'</nav><a class="sidebar-store" href="https://aonexuspe.github.io/" target="_blank" rel="noopener">Ver tienda pública <span aria-hidden="true">↗</span></a><div class="user-menu"><span id="userName"></span><button id="logoutButton" class="quiet">Salir</button></div></header><div class="workspace-topbar"><div><span class="topbar-kicker">AO NEXUS / ADMINISTRACIÓN</span><strong id="suiteHeading">Resumen</strong></div><span class="cloud-badge"><span></span> Datos en la nube</span></div>'
index=re.sub(r'<header class="app-header">.*?</header>',lambda _:sidebar,index,count=1,flags=re.S)
index=index.replace('Usa tu cuenta de esta aplicación.','Ingresa con tu cuenta de Boletas AO.')
index=index.replace('Aún no hay boletas guardadas. Exporta tu primera venta para verla aquí.','Aún no hay boletas guardadas. Emite tu primera venta para verla aquí.')
index=index.replace('El número se asigna al exportar.','El número se asigna al emitir la boleta.')
index=index.replace('<div id="catalogGrid"', '<div class="catalog-summary" id="catalogSummary" aria-live="polite"></div><div id="catalogGrid"')
index=index.replace('<input id="inventorySearch"', '<p class="suite-notice">El precio final que escribas en la boleta se reparte entre sus componentes. Los costos de compra se conservan para calcular tu ganancia.</p><input id="inventorySearch"')
(DIST / 'index.html').write_text(index)

app = (ORIG / 'boletas/assets/app.js').read_text()
app = replace_once(app, 'rpc("ao_issue_receipt", { request_id: id, receipt })', 'rpc("ao_suite_issue_receipt", { request_id: id, receipt })')
app = replace_once(app, 'window.AOCloud = { userId: user.id, api,', 'window.AOCloud = { userId: user.id, api, inventorySelection: (item,index) => window.AOSuite.pickInventory(item,index),')
app = replace_once(app, 'nextNumber: series => rpc', '''ensureReceiptAvailable: async id => {
        const { data, error } = await client.from("ao_receipts").select("id").eq("id", id).is("deleted_at", null).maybeSingle();
        if (error) throw error;
        if (!data) throw Error("Esta boleta fue eliminada. Actualiza el historial y crea una nueva con los datos correctos.");
      }, nextNumber: series => rpc''')
app = replace_once(app, 'saved: () => { historyPage = 0; }', 'saved: () => { historyPage = 0; window.AOSuite.refreshAfterMutation().catch(()=>{}); $("accountingFrame").contentWindow?.refreshFromSuite?.(); }')
app = replace_once(app, 'await showView("editor");\n    } catch', 'await window.AOSuite.initialize(client,member); const initialView=new URLSearchParams(location.search).get("vista"); await showView(["catalog","compras","inventario","editor","clients","ventas"].includes(initialView)?initialView:"dashboard");\n    } catch')
app = replace_once(app, 'for (const view of ["editor", "history", "team", "account"]) $(view + "View").hidden = view !== name;', 'const accounting = ["dashboard","compras","inventario","ventas"].includes(name); for (const view of ["editor", "history", "team", "account", "catalog", "clients", "connection", "accounting"]) $(view + "View").hidden = view === "accounting" ? !accounting : view !== name; window.AOSuite.navigate(name);')
app = replace_once(app, '$("receiptFrame").removeAttribute("src"); document.querySelectorAll', '$("receiptFrame").removeAttribute("src"); $("accountingFrame").removeAttribute("src"); window.AOSuite?.logout(); document.querySelectorAll')
app = replace_once(app, 'delete window.AOCloud; $("appView").hidden = true;', 'delete window.AOCloud; resetReceiptDeletion(); $("appView").hidden = true;')
app = replace_once(app, 'async function loadHistory() {', '''let deleteReceiptState=null, deleteInFlight=false;
  function resetReceiptDeletion(){
    if(deleteReceiptState)deleteReceiptState.button.disabled=false;
    deleteReceiptState=null;deleteInFlight=false;
    if($("deleteReceiptDialog").open)$("deleteReceiptDialog").close();
    for(const id of ["deleteReceiptConfirm","deleteReceiptCancel","deleteReceiptClose"])$(id).disabled=false;
    $("deleteReceiptMessage").textContent="";$("deleteReceiptConfirm").textContent="Sí, eliminar boleta";
  }
  function closeReceiptDeletion(){if(!deleteInFlight)resetReceiptDeletion();}
  function openReceiptDeletion(row,button){
    if(button.disabled||deleteReceiptState)return;
    try{
      deleteReceiptState={row,button,generation:authGeneration};globalMessage("");
      $("deleteReceiptSummary").textContent="Boleta "+row.series+"-"+row.number+" · "+row.customer;
      $("deleteReceiptMessage").textContent="";$("deleteReceiptDialog").showModal();$("deleteReceiptCancel").focus();
    }catch(error){resetReceiptDeletion();globalMessage(errorText(error));}
  }
  async function deleteReceipt() {
    if(deleteInFlight||!deleteReceiptState)return;
    const target=deleteReceiptState,{row,button}=target,current=()=>deleteReceiptState===target&&authGeneration===target.generation;
    deleteInFlight=true;button.disabled=true;
    for(const id of ["deleteReceiptConfirm","deleteReceiptCancel","deleteReceiptClose"])$(id).disabled=true;
    $("deleteReceiptConfirm").textContent="Eliminando…";$("deleteReceiptMessage").textContent="Eliminando la boleta…";
    try {
      const result = await rpc("ao_suite_delete_receipt", { receipt_key: row.id });
      if(!current())return;
      if(!result?.deleted||result.id!==row.id)throw Error("El servidor no confirmó la eliminación. Inténtalo de nuevo.");
      button.closest("tr")?.remove();historyTotal=Math.max(0,historyTotal-1);
      historyPage = Math.min(historyPage, Math.max(0, Math.ceil(historyTotal / 50) - 1));
      const updates = await Promise.allSettled([
        Promise.resolve().then(()=>$("receiptFrame").contentWindow?.resetDeletedReceipt?.(row.id)),
        Promise.resolve().then(()=>loadHistory()),
        Promise.resolve().then(()=>window.AOSuite.refreshAfterMutation()),
        Promise.resolve().then(()=>$("accountingFrame").contentWindow?.refreshFromSuite?.())
      ]);
      if(!current())return;
      const restored = Number(result.restored_units || 0);
      globalMessage("Boleta " + row.series + "-" + row.number + " eliminada." + (restored ? " " + restored + (restored === 1 ? " unidad volvió" : " unidades volvieron") + " al inventario." : "") + (updates.some(r => r.status === "rejected") ? " Pulsa Actualizar para recargar los datos." : ""));
      resetReceiptDeletion();
    } catch (error) { if(current())$("deleteReceiptMessage").textContent=errorText(error); }
    finally { if(current()){
      deleteInFlight=false;button.disabled=false;
      for(const id of ["deleteReceiptConfirm","deleteReceiptCancel","deleteReceiptClose"])$(id).disabled=false;
      $("deleteReceiptConfirm").textContent="Sí, eliminar boleta";
    }}
  }
  $("deleteReceiptForm").addEventListener("submit",event=>{event.preventDefault();return deleteReceipt();});
  for(const id of ["deleteReceiptCancel","deleteReceiptClose"])$(id).addEventListener("click",closeReceiptDeletion);
  $("deleteReceiptDialog").addEventListener("cancel",event=>{event.preventDefault();closeReceiptDeletion();});
  async function loadHistory() {''')
app = replace_once(app, '.order("created_at", { ascending: false }).range(historyPage', '.is("deleted_at", null).order("created_at", { ascending: false }).range(historyPage')
app = replace_once(app, 'tr.append(actions); $("historyRows").append(tr);', '''const remove = document.createElement("button"); remove.type = "button"; remove.className = "quiet danger"; remove.textContent = "Eliminar";
      remove.setAttribute("aria-label", "Eliminar boleta " + row.series + "-" + row.number);
      remove.addEventListener("click", () => openReceiptDeletion(row, remove)); actions.append(remove);
      tr.append(actions); $("historyRows").append(tr);''')
(DIST / 'assets/app.js').write_text(app)

receipt = (ORIG / 'boletas/assets/receipt.js').read_text()
receipt = replace_once(receipt, "return {description:'',serial:'',code:'',unit:'NIU',quantity:'1',price:''};", "return {description:'',serial:'',code:'',unit:'NIU',quantity:'1',price:'',inventory:[]};")
receipt = replace_once(receipt, 'return it;});return base;', 'it.inventory=Array.isArray(item.inventory)?structuredClone(item.inventory):[];it.inventoryMode=item.inventoryMode==="bundle"?"bundle":"units";return it;});return base;')
receipt = replace_once(receipt, '<div class="item-body"><div class="field">', '<div class="item-body"><button type="button" class="btn btn-outline" data-inventory="${index}">${item.inventory?.length?`Stock vinculado · ${item.inventory.length} unidad(es)`:"Elegir stock o compra externa"}</button><div class="field">')
receipt = replace_once(receipt, "document.querySelectorAll('[data-field],[data-item],[data-remove]')", "document.querySelectorAll('[data-field],[data-item],[data-remove],[data-inventory]')")
receipt = replace_once(receipt, 'data.items[index][el.dataset.item]=cleanText(el.value);', 'data.items[index][el.dataset.item]=cleanText(el.value);if(["price","quantity"].includes(el.dataset.item))syncInventoryPrice(data.items[index]);')
receipt = replace_once(receipt, "const label=$('sendEmail').checked?'Exportar y enviar':'Exportar PDF';", "const label=viewingIssued?($('sendEmail').checked?'Descargar y enviar':'Descargar PDF'):($('sendEmail').checked?'Emitir y enviar':'Emitir y descargar');")
receipt = receipt.replace('se guarda en la nube al exportar','la venta se registra al emitir la boleta')
receipt = receipt.replace('Elegir stock o compra externa','Seleccionar productos para esta venta')
receipt = receipt.replace('Stock vinculado · ${item.inventory.length} unidad(es)', 'Productos seleccionados · ${item.inventory.length} unidad(es)')
receipt = replace_once(receipt, '  const bytes=await generatePDF(snapshot);download(bytes,', '''  const issuedId=cloudReceiptId;
  await cloud.ensureReceiptAvailable(issuedId);
  const bytes=await generatePDF(snapshot);
  if(cloudReceiptId!==issuedId||!viewingIssued)throw Error('La boleta fue eliminada o cambió durante la descarga. Actualiza el historial.');
  download(bytes,''')
receipt = replace_once(receipt, 'cloud.upload(cloudReceiptId,bytes)', 'cloud.upload(issuedId,bytes)')
receipt = replace_once(receipt, '  if(sendRequested){pendingDelivery=', '''  if(cloudReceiptId!==issuedId||!viewingIssued)throw Error('La boleta fue eliminada. Crea una nueva con los datos correctos.');
  if(sendRequested){pendingDelivery=''')
receipt = replace_once(receipt, "if(centsFromInput(item.price)===null)fail", "if(!viewingIssued){if(!item.inventory?.length)fail(`description-${i}`,`Producto ${i+1}: elige su stock o compra externa.`);else if(item.inventoryMode!==\"bundle\"&&quantityFromInput(item.quantity)!==item.inventory.length)fail(`quantity-${i}`,`Producto ${i+1}: selecciona una unidad de stock por cada unidad vendida.`);else if(item.inventoryMode===\"bundle\"&&item.quantity!==\"1\")fail(`quantity-${i}`,`Producto ${i+1}: cada grupo de componentes corresponde a una computadora.`);}if(centsFromInput(item.price)===null)fail")
addon = '''
function syncInventoryPrice(item){const price=centsFromInput(item.price),qty=quantityFromInput(item.quantity);if(item.inventory?.length&&price!==null&&qty!==null)item.inventory=window.parent.AOSuiteCore.repriceParts(item.inventory,price*qty);}
$('items').addEventListener('click',async e=>{
 const button=e.target.closest('[data-inventory]');if(!button||viewingIssued)return;
 const index=Number(button.dataset.inventory);button.disabled=true;
 try{const selected=await cloud.inventorySelection(structuredClone(data.items[index]),index);if(!selected)return;
   const item=data.items[index];item.inventory=selected;const entered=centsFromInput(item.price);
   const same=selected.every(p=>p.name===selected[0].name&&p.price===selected[0].price);
   item.quantity=same?String(selected.length):'1';
   item.inventoryMode=same?'units':'bundle';
   if(entered===null)item.price=same?selected[0].price:((selected.reduce((n,p)=>n+centsFromInput(p.price),0))/100).toFixed(2);
   syncInventoryPrice(item);
   if(!item.description.trim())item.description=(same?selected[0].name:'Computadora completa: '+selected.map(p=>p.name).join(', ')).slice(0,350);
   renderItems();update();queueSave();
 }catch(error){toast(error.message);}finally{button.disabled=false;}
});
window.getInventoryIdsExcept=index=>data.items.flatMap((item,i)=>i===index?[]:(item.inventory||[]).filter(p=>p.source==='stock').map(p=>String(p.id)));
window.resetDeletedReceipt=id=>{
 if(cloudReceiptId!==id)return;
 pendingDelivery=null;viewingIssued=false;cloudReceiptId=crypto.randomUUID();
 data=emptyReceipt('110',data.series.toUpperCase(),data.observations);
 resetErrors();hydrate();saveDraft();$('emailDeliveryStatus').hidden=true;
 refreshCloudNumber();toast('La boleta fue eliminada. Puedes crear una nueva con los datos correctos.');
};
'''
receipt += '\n' + addon
(DIST / 'assets/receipt.js').write_text(receipt)

accounting = (ORIG / 'contabilizador/index.html').read_text()
legacy_url = re.search(r"const SUPABASE_URL = '([^']+)';", accounting).group(1)
legacy_key = re.search(r"const SUPABASE_PUBLISHABLE_KEY = '([^']+)';", accounting).group(1)
accounting = re.sub(r"const SUPABASE_URL = '[^']+';", 'const SUPABASE_URL = window.AO_CONFIG.supabaseUrl;', accounting)
accounting = re.sub(r"const SUPABASE_PUBLISHABLE_KEY = '[^']+';", 'const SUPABASE_PUBLISHABLE_KEY = window.AO_CONFIG.publishableKey;', accounting)
accounting = accounting.replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>', '<script src="assets/supabase.js"></script><script src="assets/config.js"></script>')
accounting=accounting.replace('<html lang="es" data-theme="dark">','<html lang="es" data-theme="light">')
accounting=accounting.replace("t === 'light' ? 'light' : 'dark'", "t === 'dark' ? 'dark' : 'light'")
accounting=accounting.replace("localStorage.getItem('ao-theme')", "localStorage.getItem('ao-suite-theme')")
accounting=accounting.replace("localStorage.setItem('ao-theme', theme)", "localStorage.setItem('ao-suite-theme', theme)")
accounting = replace_once(accounting, 'const db = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);', 'const db = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,{auth:{storageKey:"ao-nexus-auth-v1",detectSessionInUrl:false}});')
accounting = replace_once(accounting, "    const { data: compras, error: comprasError } = await db\n      .from('COMPRAS')\n      .select('*')\n      .order('created_at', { ascending: true });\n    if(comprasError) throw comprasError;\n\n    const { data: componentes, error: componentesError } = await db\n      .from('COMPONENTES')\n      .select('*');\n    if(componentesError) throw componentesError;", "    const readAll=async table=>{const rows=[];for(let start=0;;start+=1000){const {data,error}=await db.from(table).select('*').order('id').range(start,start+999);if(error)throw error;rows.push(...data);if(data.length<1000)return rows;if(start>=100000)throw Error('Hay demasiados registros para cargar.');}};\n    const [compras,componentes]=await Promise.all([readAll('COMPRAS'),readAll('COMPONENTES')]);\n    compras.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));")
accounting = accounting.replace("costo: comp.costo === null || comp.costo === undefined ? null : Number(comp.costo),", "costo: comp.costo === null || comp.costo === undefined ? null : Number(comp.costo),\n          saleCost: comp.sale_cost === null || comp.sale_cost === undefined ? null : Number(comp.sale_cost),")
accounting = replace_once(accounting, 'const costoFinal = asignado[i].costoAsignado;', 'const costoFinal = c.sale !== null && c.saleCost !== null ? c.saleCost : asignado[i].costoAsignado;')
accounting = replace_once(accounting, '    renderAll();\n  }catch(e)', '    renderAll();\n    if(window.parent!==window) window.parent.AOSuite?.refreshAfterMutation().catch(()=>{});\n  }catch(e)')
embed_style = '<style>.sidebar,.mobile-nav,.nav-mobile{display:none!important}.app{grid-template-columns:1fr!important}.main{margin-left:0!important}.main-header .header-actions #logout-btn{display:none!important}body{background:var(--bg)}.main-content{max-width:1450px;margin:auto}</style>'
accounting = accounting.replace('</head>', embed_style + '</head>')
accounting = accounting.replace('</body>', '<script>window.refreshFromSuite=()=>loadFromSupabase({silent:true});window.navigateFromSuite=view=>setView(view);</script></body>')
(DIST / 'accounting.html').write_text(accounting)

config = (DIST / 'assets/config.js').read_text()
config += '\nwindow.AO_LEGACY_CONFIG = Object.freeze('+json.dumps({'url':legacy_url,'key':legacy_key},ensure_ascii=False)+');\n'
(DIST / 'assets/categorias.js').write_text((DIST / 'assets/categorias.js').read_text()+'\nwindow.AO_CATEGORIES = CATEGORIAS;\n')
(DIST / 'assets/config.js').write_text(config)

manifest = ROOT / '.openai/hosting.json'
hosting = json.loads(manifest.read_text())
hosting['static']={'directory':'dist'}
manifest.write_text(json.dumps(hosting,indent=2)+'\n')
(ROOT / '.gitignore').write_text('__pycache__/\n*.tar.gz\n.qa/\n')
from build_stock import apply as apply_stock
apply_stock(ROOT)
for page in DIST.glob('*.html'):
    def fingerprint(match):
        asset=DIST/match.group(2)
        assert asset.is_file(), 'Falta asset: '+str(asset)
        version=hashlib.sha256(asset.read_bytes()).hexdigest()[:12]
        return match.group(1)+match.group(2)+'?v='+version+match.group(3)
    page.write_text(re.sub(r'''((?:src|href)=["'])(assets/[^"'?]+)(?:\?[^"']*)?(["'])''',fingerprint,page.read_text()))
print('Panel generado: boletas, compras, inventario, catálogo y clientes')
