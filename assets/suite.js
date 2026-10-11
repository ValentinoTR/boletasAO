"use strict";
(() => {
  const $ = id => document.getElementById(id), core = window.AOSuiteCore;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money = value => "S/ " + Number(value || 0).toLocaleString("es-PE", {minimumFractionDigits:2,maximumFractionDigits:2});
  const plural = (n, one, many) => n === 1 ? one : many;
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
    ++generation;db=null;member=null;loading=null;activatingAll=false;activatingProduct=false;products=[];purchases=[];units=[];clients=[];sales=[];receipts=[];
    for(const id of ["productDialog","linkDialog","inventoryDialog","stockDialog","autoStockDialog"])if($(id).open)$(id).close();
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
    const pending=core.legacyProducts(products).length;$("activateAutoStock").hidden=!pending;
    $("catalogSummary").innerHTML=[['Productos',products.length],['Publicados',products.filter(p=>p.published).length],['Unidades disponibles',products.filter(p=>p.published).reduce((n,p)=>n+stock(p),0)]].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('');
    $("catalogConnection").textContent=pending?`${pending} ${plural(pending,"producto conserva","productos conservan")} la cantidad de tu catálogo anterior y ${plural(pending,"su venta todavía no descuenta","sus ventas todavía no descuentan")} el stock de la web. Pulsa «Activar descuento automático» para que cada venta, en una boleta o en Compras, baje su cantidad sola; o vincula unidades reales con «Compartir stock».`:"El stock publicado corresponde a las unidades disponibles de tu inventario. Las fotos y los precios se guardan al editar cada producto.";
    $("catalogGrid").innerHTML=filtered.length?filtered.map(p=>{
      const image=p.data.image?safeURL(p.data.image):"";
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
  // Registra la cantidad del catálogo anterior como unidades reales sin costo para que las ventas descuenten stock.
  const activateStock=product=>rpc('ao_suite_set_stock',core.legacyStockArgs(product,crypto.randomUUID(),today()));
  let activatingAll=false,activationCancelled=false;
  // Por producto del catálogo anterior: vincular las unidades que ya están en Compras con su nombre (conservan su costo)
  // o, si no hay, registrar su cantidad como unidades sin costo. Si las cantidades no coinciden, se deja para «Compartir stock».
  function activationPlan(p){
    const loose=looseUnitsFor(p);
    if(!loose.length)return {kind:"create"};
    return loose.length===Number(p.reference_stock)?{kind:"link",units:loose}:{kind:"review",loose:loose.length};
  }
  async function activateLegacy(p){
    const plan=activationPlan(p);
    if(plan.kind==="review")throw Error(`tiene ${plan.loose} unidad(es) en Compras y tu web indica ${stock(p)}; vincúlalas con «Compartir stock».`);
    if(plan.kind==="link")return rpc("ao_suite_link_stock",{product_key:p.id,unit_keys:plan.units.map(u=>Number(u.id)),expected_stock:units.filter(u=>available(u)&&String(u.product_id)===String(p.id)).length+plan.units.length});
    return activateStock(p);
  }
  function autoStockSummary(){
    const all=core.legacyProducts(products),activatable=core.activatableProducts(products),large=all.length-activatable.length;
    const plans=activatable.map(p=>({p,plan:activationPlan(p)})),legacy=plans.filter(x=>x.plan.kind!=="review").map(x=>x.p),review=plans.filter(x=>x.plan.kind==="review").map(x=>x.p);
    const linking=plans.filter(x=>x.plan.kind==="link").length,total=legacy.reduce((n,p)=>n+Number(p.reference_stock||0),0);
    const unmatched=units.filter(u=>available(u)&&!u.product_id&&!webProductNamed(u.nombre)).length;
    let text=`Se activarán ${legacy.length} ${plural(legacy.length,"producto","productos")} con ${total} ${plural(total,"unidad","unidades")} en total.`;
    if(linking)text+=` ${linking} ${plural(linking,"se vinculará","se vincularán")} con unidades que ya tienes en Compras con el mismo nombre, conservando su costo.`;
    if(review.length)text+=` ${review.length} ${plural(review.length,"producto tiene","productos tienen")} unidades en Compras con una cantidad distinta a la de tu web (${review.slice(0,3).map(p=>p.data.name).join(", ")}${review.length>3?"…":""}): vincúlalas con «Compartir stock».`;
    if(large)text+=` ${large} ${plural(large,"producto supera","productos superan")} las 1000 unidades y no se ${plural(large,"activa","activan")} aquí: usa «Modificar stock» con 1000 y luego «Reponer» el resto.`;
    if(unmatched)text+=` Además tienes ${unmatched} ${plural(unmatched,"unidad","unidades")} en Compras sin vincular con otros nombres; si alguna corresponde a estos productos, cancela y vincúlala con «Compartir stock» para conservar su costo real.`;
    return {legacy,text};
  }
  $("activateAutoStock").addEventListener("click",()=>{
    const s=autoStockSummary();if(!s.legacy.length&&!activatingAll)return;
    $("autoStockSummary").textContent=activatingAll?"Hay una activación en curso. Cancelar la detiene.":s.text;$("autoStockMessage").textContent="";$("autoStockConfirm").disabled=activatingAll;$("autoStockDialog").showModal();
  });
  // Cerrar la ventana mientras se activa (Cancelar, ✕ o Esc) detiene el proceso después del producto en curso.
  $("autoStockDialog").addEventListener("close",()=>{if(activatingAll)activationCancelled=true;});
  $("autoStockForm").addEventListener("submit",async e=>{
    e.preventDefault();if(!db||activatingAll)return;activatingAll=true;activationCancelled=false;const button=$("autoStockConfirm"),client=db;button.disabled=true;
    const failed=[];let done=0,legacy=[];
    try{
      try{await refresh();}catch{}
      if(client!==db)return;
      legacy=autoStockSummary().legacy;
      if(!legacy.length){$("autoStockDialog").close();toast("Todos tus productos ya tienen el descuento automático activado.");return;}
      for(const p of legacy){
        if(client!==db)return;
        if(activationCancelled)break;
        $("autoStockMessage").textContent=`Activando ${done+failed.length+1} de ${legacy.length}: ${p.data.name}… (Cancelar detiene el proceso)`;
        try{await activateLegacy(p);done++;}
        catch(error){
          // Si otro dispositivo ya lo activó, el servidor avisa que el stock cambió: se revisa antes de darlo por fallido.
          let already=false;
          if(/cambió/.test(error?.message||"")){try{await refresh();already=products.some(x=>String(x.id)===String(p.id)&&x.managed);}catch{}}
          if(already)done++;else failed.push(`${p.data.name}: ${error?.message||error}`);
        }
      }
      let refreshed=true;
      try{await refreshAfterMutation();}catch{refreshed=false;}
      if(client!==db)return;
      $("accountingFrame").contentWindow?.refreshFromSuite?.();
      if(activationCancelled){toast(`Activación detenida: se activaron ${done} de ${legacy.length} productos.${failed.length?` ${failed.length} no se pudieron activar.`:""} Puedes continuar cuando quieras.`);}
      else if(failed.length||!refreshed){
        $("autoStockMessage").textContent=`Se activaron ${done} de ${legacy.length}.`+(failed.length?`\nNo se pudo activar:\n${failed.join("\n")}\nPuedes volver a pulsar «Activar ahora» para reintentar solo los pendientes.`:"")+(refreshed?"":"\nNo se pudo actualizar la lista: pulsa «Actualizar» para ver el resultado.");
        if(refreshed)$("autoStockSummary").textContent=autoStockSummary().text;
      }
      else{$("autoStockDialog").close();toast(`Descuento automático activado en ${done} ${plural(done,"producto","productos")}. Cada venta bajará el stock de tu web.`);}
    }catch(error){report("autoStockMessage",error);}
    finally{if(client===db){activatingAll=false;button.disabled=false;}}
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
    picking=structuredClone(item.inventory||[]);$("inventorySearch").value="";$("inventoryMessage").textContent="";externalConfirmedName="";
    for(const id of ["externalName","externalSupplier","externalCost","externalPrice"])$(id).value="";$("externalBox").open=false;
    renderPicker();$("inventoryDialog").showModal();return new Promise(resolve=>{pickResolve=resolve;});
  }
  // Compara nombres sin mayúsculas, tildes ni espacios repetidos.
  const nameKey=value=>String(value||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLocaleLowerCase("es").replace(/\s+/g," ").trim();
  const webProductNamed=name=>products.find(p=>nameKey(p.data.name)===nameKey(name));
  // Unidades disponibles con el mismo nombre que un producto de la web pero sin vincular a él (por ejemplo, importadas):
  // venderlas no descuenta su stock web hasta vincularlas.
  const looseUnitsFor=p=>units.filter(u=>available(u)&&!u.product_id&&nameKey(u.nombre)===nameKey(p.data.name));
  const unitFor=part=>part.source==="stock"?units.find(u=>String(u.id)===String(part.id)):null;
  const partGone=part=>part.source==="stock"&&!(unitFor(part)&&available(unitFor(part)));
  // Unidades que aún se pueden elegir en esta venta (no vendidas, ni en otra línea de la boleta, ni ya elegidas aquí).
  const freeUnit=u=>available(u)&&!blockedIds.has(String(u.id))&&!picking.some(x=>x.source==="stock"&&String(x.id)===String(u.id));
  // Cantidad que tienes de un producto de tu web: unidades vinculadas y las de Compras con su mismo nombre, o la cantidad del catálogo anterior.
  function stockOf(p){
    const loose=looseUnitsFor(p).filter(freeUnit).length,linked=units.filter(u=>freeUnit(u)&&String(u.product_id)===String(p.id)).length;
    if(p.managed)return linked+loose;
    return loose&&(loose===stock(p)||!stock(p))?loose:stock(p);
  }
  // «Mi stock»: solo lo que tienes, un renglón por producto.
  function stockRows(term){
    const wanted=text=>nameKey(text).includes(nameKey(term)),rows=[];
    for(const p of products){const n=stockOf(p);if(n>0&&wanted(p.data.name+" "+(p.data.brand||"")))rows.push({kind:"product",id:p.id,name:p.data.name,n,price:p.web_price});}
    const groups=new Map();
    for(const u of units){
      if(!freeUnit(u)||(u.product_id&&products.some(p=>String(p.id)===String(u.product_id)))||webProductNamed(u.nombre)||!wanted(u.nombre))continue;
      const key=nameKey(u.nombre);if(!groups.has(key))groups.set(key,{kind:"loose",key,name:u.nombre.trim(),n:0,price:Number(u.precio_sugerido)||0});groups.get(key).n++;
    }
    return rows.concat([...groups.values()]).sort((x,y)=>x.name.localeCompare(y.name,"es"));
  }
  function renderPicker() {
    const term=$("inventorySearch").value.trim(),rows=stockRows(term);
    $("inventoryUnits").innerHTML=rows.map(r=>`<div class="unit-row catalogue-row"><span><strong>${esc(r.name)}</strong><small>${r.n} en stock</small></span><strong>${Number(r.price)>0?money(r.price):""}</strong><button type="button" class="secondary" ${r.kind==="product"?`data-sell-product="${esc(r.id)}"`:`data-sell-loose="${esc(r.key)}"`} aria-label="Agregar ${esc(r.name)} a esta venta">Agregar</button></div>`).join("")||`<p class="empty">${term?`No tienes «${esc(term)}» en stock.`:"No tienes productos en stock."}</p>`;
    renderMissing(term,rows.length>0);
    $("inventorySelected").innerHTML=picking.map((p,i)=>`<div class="selected-part"><div><strong>${esc(p.name)}</strong><small>${partGone(p)?"ya no está disponible (se vendió o se retiró): quítalo":p.source==="stock"?"De tu stock":"No está en tu stock"}</small></div><label>Venta (S/)<input type="number" min="0" step="0.01" value="${esc(p.price)}" data-part-price="${i}" aria-label="Precio de venta de ${esc(p.name)}"></label><button type="button" class="quiet" data-remove-part="${i}" aria-label="Quitar ${esc(p.name)}">✕</button></div>`).join("")||'<p class="empty">Elige arriba lo que entregas al cliente.</p>';
    updatePickerTotal();
  }
  // Al buscar algo que no tienes: productos de tu web sin stock y lo escrito, para venderlo igual (no cambia tu stock).
  // «Sin stock» es no tener ninguna unidad: lo que ya está en esta venta o en otra línea de la boleta no cuenta como faltante.
  const hasAnyStock=p=>units.some(u=>available(u)&&String(u.product_id)===String(p.id))||looseUnitsFor(p).length>0||(!p.managed&&stock(p)>0);
  function renderMissing(term,inStock) {
    if(!term){$("inventoryCatalogue").innerHTML="";return;}
    const matching=products.filter(p=>nameKey(p.data.name+" "+(p.data.brand||"")).includes(nameKey(term)));
    const out=matching.filter(p=>!hasAnyStock(p)).slice(0,5);
    inStock=inStock||matching.some(hasAnyStock);
    const rows=out.map(p=>`<div class="unit-row catalogue-row"><span><strong>${esc(p.data.name)}</strong><small>Sin stock · venderlo igual no cambia tu stock</small></span><strong>${Number(p.web_price)>0?money(p.web_price):""}</strong><button type="button" class="secondary" data-sell-product="${esc(p.id)}" aria-label="Vender ${esc(p.data.name)} aunque no esté en tu stock">Venderlo igual</button></div>`);
    // Lo escrito solo se ofrece si no coincide con nada de tu stock (para no venderlo sin descontar el stock).
    if(!inStock&&!out.some(p=>nameKey(p.data.name)===nameKey(term)))rows.push(`<div class="unit-row catalogue-row"><span><strong>«${esc(term)}»</strong><small>No está en tu stock · producto de otra tienda</small></span><button type="button" class="secondary" data-use-other aria-label="Agregar ${esc(term)} como producto de otra tienda">Venderlo igual</button></div>`);
    $("inventoryCatalogue").innerHTML=rows.length?`<h3 class="stock-title">No está en tu stock</h3><div class="unit-list">${rows.join("")}</div>`:"";
  }
  function pickedOk(text) {
    const message=$("inventoryMessage");message.classList.add("success");message.textContent=text;
    $("inventorySelected").scrollIntoView({block:"nearest"});$("inventoryConfirm").focus({preventScroll:true});
  }
  const remainingText=p=>{const n=stockOf(p);return n?`te quedarán ${n}`:"te quedará 0 (pasa a «Para reponer»)";};
  function openExternal(name,message) {
    $("externalBox").open=true;$("externalName").value=name.slice(0,350);$("externalPrice").value="";$("externalSupplier").value="";$("externalCost").value="";
    $("inventoryMessage").classList.remove("success");$("inventoryMessage").textContent=message;
    $("externalPrice").scrollIntoView({block:"center"});$("externalPrice").focus();
  }
  // «Agregar» en un producto de tu web: decide con los datos actuales para que la venta descuente su stock al emitir.
  let activatingProduct=false;
  async function sellCatalogueProduct(button,productId) {
    if(activatingProduct){report("inventoryMessage",Error("Hay otro producto agregándose. Espera un momento."));return;}
    const mine=pickResolve,client=db,message=$("inventoryMessage");
    activatingProduct=true;button.disabled=true;message.classList.remove("success");message.textContent="Agregando…";
    try{
      await refresh();
      if(client!==db)return;
      let p=products.find(x=>String(x.id)===String(productId));
      if(!p)throw Error("El producto ya no existe.");
      const name=p.data.name,loose=looseUnitsFor(p),linked=units.filter(u=>available(u)&&String(u.product_id)===String(p.id)).length;
      if(loose.length){
        // Unidades de Compras con el mismo nombre sin vincular: se vinculan al producto y conservan su costo.
        if(!p.managed&&stock(p)>0&&loose.length!==stock(p))throw Error(`Tienes ${loose.length} unidad(es) de «${name}» en Compras y tu web indica ${stock(p)}. Revisa la cantidad en Mi web con «Compartir stock» y vuelve a agregarlo.`);
        await rpc("ao_suite_link_stock",{product_key:p.id,unit_keys:loose.map(u=>Number(u.id)),expected_stock:linked+loose.length});
      }else if(!p.managed&&stock(p)>0){
        // Catálogo anterior: su cantidad se registra como unidades para que la venta la descuente.
        if(stock(p)>1000)throw Error(`«${name}» tiene más de 1000 unidades: actívalo en Mi web con «Modificar stock» (1000) y luego «Reponer» el resto.`);
        await activateStock(p);
      }else if(!linked){
        // Sin stock: se vende igual, sin cambiar ningún stock.
        if(pickResolve!==mine)return;
        if(Number(p.web_price)>0){
          picking.push({source:"external",name:name.slice(0,350),supplier:"",cost:"0.00",price:Number(p.web_price).toFixed(2)});
          renderPicker();pickedOk(`«${name}» no está en tu stock: se agregó a esta venta a ${money(p.web_price)} (no cambia tu stock).`);
        }else openExternal(name,`«${name}» no tiene precio en tu web: escribe el precio de venta y pulsa «Agregar a esta venta».`);
        return;
      }
      if(loose.length||!p.managed){await refreshAfterMutation();$("accountingFrame").contentWindow?.refreshFromSuite?.();}
      if(client!==db)return;
      p=products.find(x=>String(x.id)===String(productId))||p;
      if(pickResolve!==mine){toast(`«${name}» quedó listo en tu stock; vuelve a agregarlo a la venta.`);return;}
      const unit=units.find(u=>freeUnit(u)&&String(u.product_id)===String(p.id));
      if(!unit)throw Error(`«${name}» ya no tiene unidades libres para esta venta (puede que se haya vendido en otro dispositivo o ya esté en otra línea).`);
      picking.push({source:"stock",id:unit.id,name:unit.nombre,serial:unit.serial||"",price:Number(unit.precio_sugerido??p.web_price??0).toFixed(2)});
      renderPicker();pickedOk(`«${name}» agregado. Al emitir la boleta se descuenta de tu stock: ${remainingText(p)}.`);
    }catch(error){report("inventoryMessage",error);}
    finally{if(client===db){activatingProduct=false;button.disabled=false;}}
  }
  // Unidades de Compras que no son de un producto de tu web: se elige una del grupo.
  function sellLoose(key) {
    const unit=units.find(u=>freeUnit(u)&&nameKey(u.nombre)===key&&!webProductNamed(u.nombre));
    if(!unit){report("inventoryMessage",Error("Ya no hay unidades libres de ese producto."));return;}
    picking.push({source:"stock",id:unit.id,name:unit.nombre,serial:unit.serial||"",price:Number(unit.precio_sugerido||0).toFixed(2)});
    const left=units.filter(u=>freeUnit(u)&&nameKey(u.nombre)===key).length;
    renderPicker();pickedOk(`«${unit.nombre}» agregado. Al emitir la boleta se descuenta de tu stock: te quedarán ${left}.${Number(unit.precio_sugerido)?"":" Escribe su precio de venta abajo."}`);
  }
  for(const id of ["inventoryUnits","inventoryCatalogue"])$(id).addEventListener("click",e=>{
    const product=e.target.closest("[data-sell-product]");if(product){sellCatalogueProduct(product,product.dataset.sellProduct);return;}
    const loose=e.target.closest("[data-sell-loose]");if(loose){sellLoose(loose.dataset.sellLoose);return;}
    if(e.target.closest("[data-use-other]")){const name=$("inventorySearch").value.trim();openExternal(name,`«${name}» está listo abajo: escribe el precio de venta y pulsa «Agregar a esta venta».`);}
  });
  function updatePickerTotal() {let n=0,valid=true;for(const p of picking){try{n+=core.cents(p.price);}catch{valid=false;}}$("inventoryTotal").textContent=valid?money(n/100):"Revisa los precios";}
  $("inventorySearch").addEventListener("input",()=>renderPicker());
  $("inventorySelected").addEventListener("input",e=>{if(e.target.dataset.partPrice===undefined)return;picking[Number(e.target.dataset.partPrice)].price=e.target.value;updatePickerTotal();});
  $("inventorySelected").addEventListener("click",e=>{const b=e.target.closest("[data-remove-part]");if(!b)return;picking.splice(Number(b.dataset.removePart),1);renderPicker();});
  // Un producto de la web escrito a mano se vendería como compra de otra tienda y su stock no bajaría: se avisa una vez.
  let externalConfirmedName="";
  function addExternalPart() {
    try{
      const name=$("externalName").value.trim();
      if(!name)throw Error("Indica el nombre del producto.");if(!$("externalPrice").value.trim())throw Error("Indica el precio al que lo vendes.");
      const p={source:"external",name,supplier:$("externalSupplier").value.trim(),cost:(core.optionalCents($("externalCost").value)/100).toFixed(2),price:(core.cents($("externalPrice").value)/100).toFixed(2)};core.validateParts([p]);
      const web=webProductNamed(name);
      if(web&&stockOf(web)>0&&externalConfirmedName!==nameKey(name)){
        externalConfirmedName=nameKey(name);$("inventorySearch").value=web.data.name;renderPicker();
        throw Error(`Tienes ${stockOf(web)} de «${web.data.name}» en tu stock. Para que la venta lo descuente, pulsa su botón «Agregar» en «Mi stock» (arriba). Si de verdad es de otra tienda, pulsa «Agregar a esta venta» otra vez.`);
      }
      externalConfirmedName="";picking.push(p);for(const id of ["externalName","externalSupplier","externalCost","externalPrice"])$(id).value="";$("inventoryMessage").textContent="";renderPicker();return true;
    }catch(error){report("inventoryMessage",error);return false;}
  }
  $("addExternal").addEventListener("click",addExternalPart);
  for(const id of ["externalName","externalSupplier","externalCost","externalPrice"])$(id).addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addExternalPart();}});
  $("inventoryConfirm").addEventListener("click",()=>{
    // Si dejaste escrito un producto de otra tienda sin pulsar «Agregar a esta venta», se agrega ahora.
    if(["externalName","externalPrice"].some(id=>$(id).value.trim())&&!addExternalPart())return;
    const gone=picking.filter(partGone);
    if(gone.length){report("inventoryMessage",Error(`«${gone[0].name}» ya no está disponible (se vendió o se retiró). Quítala de la lista y elige otra unidad.`));return;}
    try{core.validateParts(picking);if(picking.length>500)throw Error("Selecciona hasta 500 componentes.");const selected=structuredClone(picking).map(p=>p.source==="external"?{...p,cost:(core.optionalCents(p.cost)/100).toFixed(2)}:p),resolve=pickResolve;pickResolve=null;$("inventoryDialog").close();resolve(selected);}catch(error){report("inventoryMessage",error);}
  });
  $("inventoryDialog").addEventListener("close",()=>{if(pickResolve){const resolve=pickResolve;pickResolve=null;resolve(null);}});
  document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>$(b.dataset.close).close()));
  window.AOSuite={initialize,refresh,refreshAfterMutation,navigate,logout,pickInventory,openStockGroup,stockProducts:()=>products.map(p=>({id:p.id,name:p.data.name,managed:p.managed}))};
})();
