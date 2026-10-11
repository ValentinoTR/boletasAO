"use strict";
(() => {
  const $ = id => document.getElementById(id), core = window.AOSuiteCore;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money = value => "S/ " + Number(value || 0).toLocaleString("es-PE", {minimumFractionDigits:2,maximumFractionDigits:2});
  const safeURL = value => { try { const u = new URL(value, "https://aonexuspe.github.io/"); return u.protocol === "https:" ? u.href : ""; } catch { return ""; } };
  let db, member, generation = 0, loading, desiredView = "dashboard", toastTimer;
  let products = [], purchases = [], units = [], clients = [], sales = [], receipts = [], importState = {};
  let linking, linked = new Set(), picking = [], pickResolve, blockedIds = new Set(), editingProduct;
  let temporaryPhotoURL;
  const available = core.available;
  const productFor = u => products.find(p => String(p.id) === String(u.product_id));
  const stock = p => core.productStock(p,units);
  let catalogueMode="available", productRequest, stockRequest, stockEditing, stockRestocking, stockExpected;
  function toast(message) { $("suiteToast").textContent = message; $("suiteToast").hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $("suiteToast").hidden = true, 6500); }
  function report(id,error) { $(id).textContent = error?.message || String(error); $(id).classList.remove("success"); }
  async function rows(client, table) {
    const output = []; let start = 0;
    for (;;) { const {data,error} = await client.from(table).select("*").order(table === "ao_suite_state" ? "key" : table === "ao_sales" || table === "ao_sale_items" ? "receipt_id" : "id").range(start,start+999); if(error)throw error; output.push(...data); if(data.length<1000)return output; start+=1000; if(start>100000)throw Error("Hay demasiados registros para esta consulta."); }
  }
  async function rpc(name,args) { const {data,error}=await db.rpc(name,args); if(error)throw error; return data; }
  async function refresh() {
    if(!db)return; if(loading)return loading;
    const current=generation, client=db;
    loading=(async()=>{
      const result=await Promise.all(["ao_products","COMPRAS","COMPONENTES","ao_clients","ao_sales","ao_receipts","ao_suite_state"].map(t=>rows(client,t)));
      if(current!==generation)return;
      [products,purchases,units,clients,sales,receipts]=result;
      importState=result[6].find(s=>s.key==="legacy_import")?.value||{};
      const byPurchase=new Map(); for(const u of units){const key=String(u.compra_id);if(!byPurchase.has(key))byPurchase.set(key,[]);byPurchase.get(key).push(u);}
      units=purchases.flatMap(p=>core.allocate(p,byPurchase.get(String(p.id))||[]));
      renderCatalog(); renderClients(); renderImportStatus();
    })().catch(error=>{if(current===generation)toast(error.message||"No se pudieron cargar los datos.");throw error;}).finally(()=>{if(current===generation)loading=null;});
    return loading;
  }
  async function initialize(client,person) {
    ++generation; db=client; member=person; loading=null;
    $("connectionNav").hidden=member.role!=="owner"; $("importForm").hidden=member.role!=="owner";
    await refresh();
    if(!$("accountingFrame").getAttribute("src"))$("accountingFrame").src="accounting.html";
  }
  async function refreshAfterMutation() {
    // An earlier read may have started before the write. Finish it, then read
    // again so restored units and removed sales are reflected immediately.
    if (loading) { try { await loading; } catch {} }
    return refresh();
  }
  function logout() {
    ++generation;db=null;member=null;loading=null;products=[];purchases=[];units=[];clients=[];sales=[];receipts=[];
    for(const id of ["productDialog","linkDialog","inventoryDialog","stockDialog"])if($(id).open)$(id).close();
    $("catalogGrid").replaceChildren();$("clientList").replaceChildren();$("oldPassword").value="";
  }
  function navigate(name) {
    const titles={dashboard:"Resumen del negocio",compras:"Compras y costos",inventario:"Inventario disponible",ventas:"Ventas y ganancias",catalog:"Productos de mi web",clients:"Clientes",editor:"Nueva boleta",history:"Boletas emitidas",team:"Mi equipo",account:"Mi cuenta",connection:"Conexión inicial"};
    $("suiteHeading").textContent=titles[name]||"AO Nexus Central";
    if(["dashboard","compras","inventario","ventas"].includes(name)){desiredView=name==="ventas"?"historial":name;$("accountingFrame").contentWindow?.navigateFromSuite?.(desiredView);}
    if(["catalog","clients","connection"].includes(name))refresh().catch(()=>{});
  }
  $("accountingFrame").addEventListener("load",()=>$("accountingFrame").contentWindow?.navigateFromSuite?.(desiredView));
  function renderCatalog() {
    const term=$("catalogSearch").value.trim().toLocaleLowerCase("es");
    const filtered=core.filterStock(products,units,catalogueMode).filter(p=>(p.data.name+" "+p.data.brand).toLocaleLowerCase("es").includes(term));
    document.querySelectorAll('[data-stock-filter]').forEach(b=>{b.classList.toggle('active',b.dataset.stockFilter===catalogueMode);b.setAttribute('aria-pressed',String(b.dataset.stockFilter===catalogueMode));});
    const pending=products.filter(p=>!p.managed).length;
    $("catalogSummary").innerHTML=[['Productos',products.length],['Publicados',products.filter(p=>p.published).length],['Unidades disponibles',products.filter(p=>p.published).reduce((n,p)=>n+stock(p),0)]].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('');
    $("catalogConnection").textContent=pending?`${pending} productos conservan la cantidad de tu catálogo anterior. Vincula sus unidades en «Compartir stock» para que las ventas actualicen su disponibilidad.`:"El stock publicado corresponde a las unidades disponibles de tu inventario. Las fotos y los precios se guardan al editar cada producto.";
    $("catalogGrid").innerHTML=filtered.length?filtered.map(p=>{
      const image=safeURL(p.data.image);
      return `<article class="product-card">${image?`<img src="${esc(image)}" alt="${esc(p.data.name)}" loading="lazy">`:'<div class="product-no-photo">AO</div>'}<div class="product-copy"><span class="eyebrow">${esc(p.data.brand||"AO NEXUS")}</span><h2>${esc(p.data.name)}</h2><strong class="public-price">${money(p.web_price)}</strong><div class="product-status"><span class="pill ${stock(p)?(p.published?"sent":""):"replenish-pill"}">${stock(p)?(p.published?"Publicado":"Oculto"):"Para reponer"}</span><span>${stock(p)} unidad(es)</span></div><p class="hint">${p.managed?"Stock compartido con tus ventas":"Cantidad del catálogo · pendiente de vincular"}</p><div class="suite-actions"><button class="secondary" data-edit-product="${p.id}">Editar y subir foto</button><button class="secondary" data-restock-product="${p.id}">Reponer</button><button class="quiet" data-stock-product="${p.id}">Modificar stock</button>${!p.managed?`<button class="quiet" data-link-product="${p.id}">Compartir stock</button>`:""}</div></div></article>`;
    }).join(""):`<p class="empty">${catalogueMode==='replenish'?'No hay productos pendientes de reposición.':'No hay productos disponibles para esta búsqueda. Revisa «Para reponer» para registrar nuevas unidades.'}</p>`;
  }
  document.querySelectorAll('[data-stock-filter]').forEach(b=>b.addEventListener('click',()=>{catalogueMode=b.dataset.stockFilter;renderCatalog();}));
  $("catalogSearch").addEventListener("input",renderCatalog);
  $("refreshCatalogue").addEventListener("click",()=>refresh().catch(()=>{}));
  $("catalogGrid").addEventListener("click",e=>{
    const edit=e.target.closest("[data-edit-product]"), link=e.target.closest("[data-link-product]");
    if(edit)openProduct(products.find(p=>String(p.id)===edit.dataset.editProduct));
    if(link)openLink(products.find(p=>String(p.id)===link.dataset.linkProduct));
    const adjust=e.target.closest('[data-stock-product]'),restock=e.target.closest('[data-restock-product]');
    if(adjust)openStock(products.find(p=>String(p.id)===adjust.dataset.stockProduct));
    if(restock)openStock(products.find(p=>String(p.id)===restock.dataset.restockProduct),true);
  });
  function openProduct(product) {
    editingProduct=product;$("productForm").reset();$("productMessage").textContent="";
    productRequest=crypto.randomUUID();$("productIncoming").hidden=!!product;$("productQuantity").value="1";$("productPurchaseDate").value=today();syncProductQuantity();
    $("productTitle").textContent=product?"Editar producto de mi web":"Agregar producto a mi web";
    $("productId").value=product?.id||"";
    for(const [id,key]of [["productName","name"],["productBrand","brand"],["productSub","sub"]])$(id).value=product?.data[key]||"";
    $("productPrice").value=product?.web_price??"";$("productOldPrice").value=product?.data.oldPrice??"";
    $("productCategory").innerHTML=Object.entries(window.AO_CATEGORIES||{}).map(([key,c])=>`<option value="${esc(key)}">${esc(c.label)}</option>`).join("");
    if(product)$("productCategory").value=product.data.category;
    $("productSpecs").value=Object.entries(product?.data.specs||{}).map(([k,v])=>`${k}: ${v}`).join("\n");
    $("productPublished").checked=product?.published??true;$("productFeatured").checked=!!product?.data.featured;$("productBest").checked=!!product?.data.best;
    const photo=safeURL(product?.data.image||"");$("productPhotoPreview").hidden=!photo;$("productPhotoPreview").src=photo;
    $("productDialog").showModal();
  }
  $("newProduct").addEventListener("click",()=>openProduct(null));
  $("productPhoto").addEventListener("change",()=>{
    if(temporaryPhotoURL)URL.revokeObjectURL(temporaryPhotoURL);const f=$("productPhoto").files[0];if(!f)return;
    temporaryPhotoURL=URL.createObjectURL(f);$("productPhotoPreview").src=temporaryPhotoURL;$("productPhotoPreview").hidden=false;
  });
  $("productForm").addEventListener("submit",async e=>{
    e.preventDefault();if(!db)return;const button=e.currentTarget.querySelector('[type="submit"]');button.disabled=true;$("productMessage").textContent="Guardando…";
    try {
      const specs={};for(const line of $("productSpecs").value.split("\n").filter(s=>s.trim())){const at=line.indexOf(":");if(at<1)throw Error("Escribe cada especificación como Dato: valor.");specs[line.slice(0,at).trim()]=line.slice(at+1).trim();}
      let image=editingProduct?.data.image||"";const f=$("productPhoto").files[0];
      if(f){if(!["image/png","image/jpeg","image/webp"].includes(f.type)||f.size>10*1024*1024)throw Error("Usa una imagen PNG, JPG o WebP de hasta 10 MB.");const extension={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"}[f.type],path="products/"+crypto.randomUUID()+"."+extension;const {error}=await db.storage.from("ao-product-images").upload(path,f,{contentType:f.type});if(error)throw error;image=db.storage.from("ao-product-images").getPublicUrl(path).data.publicUrl;}
      const data={name:$("productName").value.trim(),brand:$("productBrand").value.trim(),category:$("productCategory").value,sub:$("productSub").value.trim(),specs,image,featured:$("productFeatured").checked,best:$("productBest").checked};
      if(!data.name||!window.AO_CATEGORIES[data.category])throw Error("Indica el nombre y la categoría del producto.");
      if($("productOldPrice").value!="")data.oldPrice=core.cents($("productOldPrice").value)/100;
      const payload={data,web_price:core.cents($("productPrice").value)/100,published:$("productPublished").checked,updated_at:new Date().toISOString()};
      if(editingProduct){const {error}=await db.from("ao_products").update(payload).eq("id",editingProduct.id);if(error)throw error;}
      else {const count=core.quantity($("productQuantity").value);if(count>1000)throw Error('Registra hasta 1000 unidades por compra.');await rpc('ao_suite_create_product',{request_key:productRequest,product_data:payload,quantity:count,cost_per_unit:count?core.optionalCents($("productUnitCost").value)/100:null,supplier:$("productSupplier").value.trim()||null,purchased_on:$("productPurchaseDate").value||today()});}
      await refreshAfterMutation();$("productDialog").close();toast(editingProduct?"Producto actualizado.":Number($("productQuantity").value)?"Producto y unidades guardados en stock.":"Producto guardado en Para reponer.");$("accountingFrame").contentWindow?.refreshFromSuite?.();
    } catch(error){report("productMessage",error);} finally{button.disabled=false;}
  });
  function today(){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=type=>parts.find(p=>p.type===type).value;return get('year')+'-'+get('month')+'-'+get('day');}
  function syncProductQuantity(){$("productPurchaseFields").hidden=!!editingProduct||!(Number($("productQuantity").value)>0);}
  $("productQuantity").addEventListener('input',syncProductQuantity);
  function groupUnits(product){return units.filter(u=>available(u)&&(product.id?String(u.product_id)===String(product.id):!u.product_id&&u.nombre.trim().toLocaleLowerCase('es')===product.data.name.trim().toLocaleLowerCase('es')));}
  function openStock(product,restocking=false){
    if(!product)return;stockEditing=product;stockRestocking=restocking;stockRequest=crypto.randomUUID();stockExpected=groupUnits(product).length;
    $("stockForm").reset();$("stockTitle").textContent=(restocking?'Reponer · ':'Modificar stock · ')+product.data.name;
    $("stockSummary").textContent=stockExpected+' unidad(es) disponibles'+(!product.managed&&product.id?' · '+stock(product)+' unidad(es) del catálogo anterior pendientes de vincular':'');
    $("stockQuantityLabel").textContent=restocking?'¿Cuántas unidades estás trayendo?':'Cantidad disponible correcta';
    $("stockQuantity").value=restocking?'1':String(product.managed===false?stock(product):stockExpected);$("stockDate").value=today();$("stockMessage").textContent='';updateStockFields();$("stockDialog").showModal();
  }
  function openStockGroup(group,restocking=false){openStock(products.find(p=>String(p.id)===String(group.productId))||{id:null,data:{name:group.name},managed:true},restocking);}
  function updateStockFields(){const count=Number($("stockQuantity").value),delta=stockRestocking?count:count-stockExpected;$("stockPurchaseFields").hidden=delta<=0;$("stockQuantity").min=stockRestocking?'1':'0';$("stockHint").textContent=delta>0?`Se sumarán ${delta} unidad(es) al stock. El costo es opcional: si lo indicas se usará para calcular la ganancia; si no, quedará en S/ 0.00 y podrás completarlo después en Compras.`:delta<0?`Se retirarán ${-delta} unidad(es) del stock disponible. Se conservarán las compras y las ventas ya realizadas.`:'La cantidad disponible permanecerá igual.';}
  $("stockQuantity").addEventListener('input',updateStockFields);
  $("stockForm").addEventListener('submit',async e=>{
    e.preventDefault();const button=$("stockSave");button.disabled=true;
    try{const count=core.quantity($("stockQuantity").value),target=stockRestocking?stockExpected+count:count;const result=await rpc('ao_suite_set_stock',{request_key:stockRequest,product_key:stockEditing.id||null,product_name:stockEditing.data.name,target_quantity:target,expected_quantity:stockExpected,cost_per_unit:target>stockExpected?core.optionalCents($("stockCost").value)/100:null,supplier:$("stockSupplier").value.trim()||null,purchased_on:$("stockDate").value||today()});await refreshAfterMutation();$("accountingFrame").contentWindow?.refreshFromSuite?.();$("stockDialog").close();toast('Stock actualizado: '+result.quantity+' unidad(es) disponibles.');}
    catch(error){report('stockMessage',error);}finally{button.disabled=false;}
  });
  function openLink(product) {
    linking=product;linked=new Set(units.filter(u=>available(u)&&String(u.product_id)===String(product.id)).map(u=>String(u.id)));
    $("linkTitle").textContent="Stock de "+product.data.name;$("linkSearch").value="";$("linkMessage").textContent="";
    $("linkReference").textContent=product.managed?"Las unidades ya vinculadas permanecen seleccionadas. Agrega aquí las nuevas unidades de este producto.":`Tu catálogo anterior indica ${product.reference_stock} unidad(es). Selecciona las unidades reales de este producto y revisa la cantidad que publicarás.`;
    renderLink();$("linkDialog").showModal();
  }
  function renderLink() {
    if(!linking)return;const term=$("linkSearch").value.toLocaleLowerCase("es");
    const eligible=units.filter(u=>available(u)&&(!u.product_id||String(u.product_id)===String(linking.id))&&u.nombre.toLocaleLowerCase("es").includes(term));
    $("linkUnits").innerHTML=eligible.map(u=>`<label class="unit-row"><input type="checkbox" data-link-unit="${u.id}" ${linked.has(String(u.id))?"checked":""} ${u.product_id?"disabled":""}><span><strong>${esc(u.nombre)}</strong><small>${esc(purchases.find(p=>String(p.id)===String(u.compra_id))?.nombre||"")} · unidad #${u.id}</small></span><strong>${money(u.calculatedCost)}</strong></label>`).join("")||'<p class="empty">No hay unidades disponibles. Regístralas en Compras o importa tu inventario anterior.</p>';
    $("linkCount").textContent=`Se publicarán ${linked.size} unidad(es) disponibles. Esta acción utiliza las unidades existentes.`;
  }
  $("linkSearch").addEventListener("input",renderLink);
  $("linkUnits").addEventListener("change",e=>{const id=e.target.dataset.linkUnit;if(!id)return;e.target.checked?linked.add(id):linked.delete(id);renderLink();});
  $("linkConfirm").addEventListener("click",async()=>{
    const button=$("linkConfirm");button.disabled=true;
    try{await rpc("ao_suite_link_stock",{product_key:linking.id,unit_keys:[...linked].map(Number),expected_stock:linked.size});await refresh();$("linkDialog").close();toast("Stock compartido activado. La web usará las unidades disponibles de este producto.");}catch(error){report("linkMessage",error);}finally{button.disabled=false;}
  });
  function renderClients() {
    const term=$("clientSearch").value.toLocaleLowerCase("es");
    const filtered=clients.filter(c=>(c.name+" "+c.document).toLocaleLowerCase("es").includes(term));
    $("clientList").innerHTML=filtered.map(c=>{
      const list=sales.filter(s=>s.client_id===c.id).map(s=>receipts.find(r=>r.id===s.receipt_id)).filter(Boolean);
      return `<article class="card"><h2>${esc(c.name)}</h2><p class="muted">${esc(c.document?c.doc_type+" "+c.document:"Sin documento")}${c.email?" · "+esc(c.email):""}</p>${list.map(r=>`<div class="client-sale"><div><strong>${esc(r.series+"-"+r.number)}</strong><small>${esc(r.date)} · ${esc((r.payload.items||[]).map(i=>i.description).join(", "))}</small></div><strong>${money(r.total_cents/100)}</strong><button class="quiet" data-client-receipt="${r.id}">Ver boleta</button></div>`).join("")}</article>`;
    }).join("")||'<p class="empty">Los clientes aparecerán aquí cuando confirmes una boleta. Los compradores de ventas anteriores se consultan en el historial del inventario.</p>';
  }
  $("clientSearch").addEventListener("input",renderClients);
  $("clientList").addEventListener("click",e=>{const b=e.target.closest("[data-client-receipt]");if(!b)return;const r=receipts.find(r=>r.id===b.dataset.clientReceipt);document.querySelector('[data-view="editor"]').click();const renderer=$("receiptFrame").contentWindow;if(renderer?.loadCloudReceipt)renderer.loadCloudReceipt(r.payload,r.id);else toast("La boleta se está cargando. Inténtalo en un momento.");});
  function renderImportStatus() {
    $("importStatus").textContent=importState.imported?"Tus compras anteriores ya fueron importadas. Volver a importar incorpora solo registros nuevos del contabilizador anterior.":"Las compras anteriores aún no se han importado. Puedes registrar nuevas compras ahora o traer tu inventario con el siguiente formulario.";
  }
  $("importForm").addEventListener("submit",async e=>{
    e.preventDefault();if(!db||member?.role!=="owner")return;const button=e.currentTarget.querySelector('[type="submit"]');button.disabled=true;$("importMessage").textContent="Consultando tu contabilizador anterior…";
    const old=window.supabase.createClient(window.AO_LEGACY_CONFIG.url,window.AO_LEGACY_CONFIG.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:"ao-import-temporary"}});
    let password=$("oldPassword").value;$("oldPassword").value="";
    try{
      const {error}=await old.auth.signInWithPassword({email:$("oldEmail").value.trim(),password});if(error)throw error;
      password="";
      const [compras,componentes]=await Promise.all([rows(old,"COMPRAS"),rows(old,"COMPONENTES")]);
      if(!compras.length&&!componentes.length)throw Error("Esta cuenta no tiene compras visibles. Revisa que sea la cuenta de tu contabilizador.");
      $("importMessage").textContent="Incorporando compras, componentes y compradores…";
      const imported=await rpc("ao_suite_import_accounting",{bundle:{source:"rqoxzaszzvwxpvomfvay",compras,componentes}});
      await refresh();$("accountingFrame").contentWindow?.refreshFromSuite?.();$("importMessage").textContent=`Se incorporaron ${imported.compras} compras y ${imported.componentes} unidades. Abre Mi web para vincular el stock de cada producto.`;$("importMessage").classList.add("success");
    }catch(error){report("importMessage",error);}finally{password="";await old.auth.signOut().catch(()=>{});button.disabled=false;}
  });
  async function pickInventory(item,index) {
    await refresh();if(pickResolve)throw Error("Ya hay una selección de stock abierta.");
    blockedIds=new Set(($("receiptFrame").contentWindow?.getInventoryIdsExcept?.(index)||[]).map(String));
    picking=structuredClone(item.inventory||[]);$("inventorySearch").value="";$("inventoryMessage").textContent="";
    for(const id of ["externalName","externalSupplier","externalCost","externalPrice"])$(id).value="";
    renderPicker(item);$("inventoryDialog").showModal();return new Promise(resolve=>{pickResolve=resolve;});
  }
  function renderPicker(item) {
    const term=$("inventorySearch").value.trim().toLocaleLowerCase("es");
    const eligible=units.filter(u=>available(u)&&!blockedIds.has(String(u.id))&&u.nombre.toLocaleLowerCase("es").includes(term));
    renderCatalogueOptions(term);
    $("inventoryUnits").innerHTML=eligible.map(u=>`<label class="unit-row"><input type="checkbox" data-pick-unit="${u.id}" ${picking.some(p=>p.source==="stock"&&String(p.id)===String(u.id))?"checked":""}><span><strong>${esc(u.nombre)}</strong><small>Unidad #${u.id}${u.serial?" · "+esc(u.serial):""}${u.estimated?" · costo repartido":""}</small></span><strong>${money(u.calculatedCost)}</strong></label>`).join("")||'<p class="empty">No hay unidades registradas en tu stock para esta búsqueda. Abajo puedes elegir un producto de tu web o agregar uno de otra tienda.</p>';
    $("inventorySelected").innerHTML=picking.map((p,i)=>`<div class="selected-part"><div><strong>${esc(p.name)}</strong><small>${p.source==="stock"?"Mi stock · unidad #"+esc(p.id):"Compra para esta venta"} · ${p.source==="external"&&!Number(p.cost)?"sin costo indicado":"costo "+money(p.source==="stock"?units.find(u=>String(u.id)===String(p.id))?.calculatedCost:p.cost)}</small></div><label>Venta (S/)<input type="number" min="0" step="0.01" value="${esc(p.price)}" data-part-price="${i}" aria-label="Precio de venta de ${esc(p.name)}"></label><button type="button" class="quiet" data-remove-part="${i}" aria-label="Quitar ${esc(p.name)}">✕</button></div>`).join("")||'<p class="empty">Selecciona lo que entregas al cliente.</p>';
    updatePickerTotal();
  }
  // Productos de «Mi web» que aún no tienen unidades registradas (catálogo anterior o por reponer) y productos de otras tiendas.
  function renderCatalogueOptions(term) {
    const matches=products.filter(p=>(p.managed?stock(p)===0:true)&&(p.data.name+" "+(p.data.brand||"")).toLocaleLowerCase("es").includes(term));
    const typed=$("inventorySearch").value.trim();
    const rows=matches.slice(0,30).map(p=>`<div class="unit-row catalogue-row"><span><strong>${esc(p.data.name)}</strong><small>${p.managed?"Para reponer · sin unidades en stock":"Catálogo anterior · "+stock(p)+" unidad(es) sin vincular"}</small></span><strong>${money(p.web_price)}</strong><button type="button" class="secondary" data-use-catalogue="${esc(p.id)}">Agregar</button></div>`);
    if(typed)rows.push(`<div class="unit-row catalogue-row"><span><strong>«${esc(typed)}»</strong><small>No está en mi stock · agregar como compra de otra tienda</small></span><button type="button" class="secondary" data-use-other>Agregar</button></div>`);
    $("inventoryCatalogue").innerHTML=rows.length?`<h3>Productos de mi web y otras tiendas</h3><p class="hint">Estos productos no tienen unidades en tu stock. Al agregarlos solo necesitas el precio de venta; si indicas su costo real, tu ganancia será exacta.${matches.length>30?" Escribe en el buscador para ver el resto.":""}</p><div class="unit-list">${rows.join("")}</div>`:"";
  }
  $("inventoryCatalogue").addEventListener("click",e=>{
    const use=e.target.closest("[data-use-catalogue]"),other=e.target.closest("[data-use-other]");
    if(!use&&!other)return;
    let name=$("inventorySearch").value.trim();
    if(use){const p=products.find(p=>String(p.id)===use.dataset.useCatalogue);if(!p)return;name=p.data.name;$("externalPrice").value=Number(p.web_price||0).toFixed(2);}
    $("externalName").value=name.slice(0,350);$("externalCost").value="";
    $("inventoryMessage").classList.remove("success");$("inventoryMessage").textContent=`«${name}» está listo abajo: confirma el precio de venta (el costo es opcional) y pulsa «Agregar a esta venta».`;
    $("externalPrice").scrollIntoView({block:"center"});$("externalPrice").focus();$("externalPrice").select();
  });
  function updatePickerTotal() {let n=0,valid=true;for(const p of picking){try{n+=core.cents(p.price);}catch{valid=false;}}$("inventoryTotal").textContent=valid?money(n/100):"Revisa los precios";}
  $("inventorySearch").addEventListener("input",()=>renderPicker());
  $("inventoryUnits").addEventListener("change",e=>{
    const id=e.target.dataset.pickUnit;if(!id)return;
    if(e.target.checked){const u=units.find(u=>String(u.id)===id),p=productFor(u);picking.push({source:"stock",id:u.id,name:u.nombre,serial:u.serial||"",price:Number(u.precio_sugerido??p?.web_price??0).toFixed(2)});}
    else picking=picking.filter(p=>!(p.source==="stock"&&String(p.id)===id));renderPicker();
  });
  $("inventorySelected").addEventListener("input",e=>{if(e.target.dataset.partPrice===undefined)return;picking[Number(e.target.dataset.partPrice)].price=e.target.value;updatePickerTotal();});
  $("inventorySelected").addEventListener("click",e=>{const b=e.target.closest("[data-remove-part]");if(!b)return;picking.splice(Number(b.dataset.removePart),1);renderPicker();});
  $("addExternal").addEventListener("click",()=>{
    try{if(!$("externalName").value.trim())throw Error("Indica el nombre del producto.");if(!$("externalPrice").value.trim())throw Error("Indica el precio al que lo vendes.");const p={source:"external",name:$("externalName").value.trim(),supplier:$("externalSupplier").value.trim(),cost:(core.optionalCents($("externalCost").value)/100).toFixed(2),price:(core.cents($("externalPrice").value)/100).toFixed(2)};core.validateParts([p]);picking.push(p);for(const id of ["externalName","externalSupplier","externalCost","externalPrice"])$(id).value="";$("inventoryMessage").textContent="";renderPicker();}catch(error){report("inventoryMessage",error);}
  });
  $("inventoryConfirm").addEventListener("click",()=>{
    try{core.validateParts(picking);if(picking.length>500)throw Error("Selecciona hasta 500 componentes.");const selected=structuredClone(picking),resolve=pickResolve;pickResolve=null;$("inventoryDialog").close();resolve(selected);}catch(error){report("inventoryMessage",error);}
  });
  $("inventoryDialog").addEventListener("close",()=>{if(pickResolve){const resolve=pickResolve;pickResolve=null;resolve(null);}});
  document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>$(b.dataset.close).close()));
  window.AOSuite={initialize,refresh,refreshAfterMutation,navigate,logout,pickInventory,openStockGroup,stockProducts:()=>products.map(p=>({id:p.id,name:p.data.name,managed:p.managed}))};
})();
