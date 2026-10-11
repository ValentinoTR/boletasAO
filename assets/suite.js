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
    for(const id of ["productDialog","linkDialog","inventoryDialog","stockDialog","autoStockDialog"])if($(id).open)$(id).close();resetClientDeletion();
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
  // ---------- Stock para vender: reglas compartidas por el buscador de la boleta y la activación del catálogo anterior ----------
  // Compras creadas al vender algo que no estaba en tu stock. Si se elimina esa boleta vuelven como unidades, pero no son stock real.
  const NO_STOCK_SUPPLIER="Venta sin stock";
  const keyCache=new Map();
  // Compara nombres sin mayúsculas, tildes ni espacios repetidos.
  const nameKey=value=>{const text=String(value||"");let key=keyCache.get(text);if(key===undefined){key=text.normalize("NFD").replace(/[̀-ͯ]/g,"").toLocaleLowerCase("es").replace(/\s+/g," ").trim();keyCache.set(text,key);}return key;};
  const compactKey=value=>nameKey(value).replace(/[^a-z0-9ñ]/g,"");
  // La búsqueda acepta las palabras en cualquier orden y sin importar espacios o guiones («AMD Ryzen 9 9900X», «1 TB», «B850-F»).
  const searchTokens=term=>nameKey(term).split(" ").map(word=>word.replace(/[^a-z0-9ñ]/g,"")).filter(Boolean);
  const matchesTokens=(text,tokens)=>{const c=compactKey(text);return tokens.every(word=>c.includes(word));};
  const modelTokens=tokens=>tokens.filter(word=>/\d/.test(word)&&word.length>=3);
  const productText=p=>p.data.name+" "+(p.data.brand||"");
  // Productos que coinciden con lo buscado; si ninguno tiene todas las palabras, los que comparten el modelo (por ejemplo «9900x»).
  function searchProducts(list,term,text=productText){
    const tokens=searchTokens(term);if(!tokens.length)return list;
    const all=list.filter(x=>matchesTokens(text(x),tokens));if(all.length)return all;
    const models=modelTokens(tokens);return models.length?list.filter(x=>matchesTokens(text(x),models)):[];
  }
  // Índice del stock disponible: unidades por producto, una ficha por nombre y unidades de Compras sin vincular agrupadas por nombre.
  function stockIndex(){
    const byProduct=new Map(),ownerByKey=new Map(),looseByKey=new Map(),productIds=new Set(products.map(p=>String(p.id)));
    const noStock=new Set(purchases.filter(c=>c.proveedor===NO_STOCK_SUPPLIER).map(c=>String(c.id)));
    for(const p of [...products].sort((x,y)=>Number(!!y.managed)-Number(!!x.managed))){const key=nameKey(p.data.name);if(!ownerByKey.has(key))ownerByKey.set(key,p);}
    for(const u of units){
      if(!available(u))continue;
      if(u.product_id&&productIds.has(String(u.product_id))){const id=String(u.product_id);if(!byProduct.has(id))byProduct.set(id,[]);byProduct.get(id).push(u);continue;}
      if(noStock.has(String(u.compra_id)))continue;
      const key=nameKey(u.nombre);if(!looseByKey.has(key))looseByKey.set(key,[]);looseByKey.get(key).push(u);
    }
    return {byProduct,ownerByKey,looseByKey};
  }
  // Lo que tienes de un producto: sus unidades, las de Compras con su mismo nombre y, en el catálogo anterior, la cantidad que falta registrar.
  function productStock(p,ix){
    const key=nameKey(p.data.name),linked=ix.byProduct.get(String(p.id))||[],loose=ix.ownerByKey.get(key)===p?(ix.looseByKey.get(key)||[]):[];
    const extra=p.managed?0:Math.max(0,Number(p.reference_stock||0)-linked.length-loose.length);
    return {linked,loose,extra,total:linked.length+loose.length+extra,free:linked.filter(freeUnit).length+loose.filter(freeUnit).length+extra};
  }
  // Para que la venta descuente el stock: vincula las unidades de Compras con su nombre (conservan su costo)
  // y registra como unidades sin costo la cantidad del catálogo anterior que falte.
  async function registerStock(p,info){
    let changed=false;
    if(info.loose.length){await rpc("ao_suite_link_stock",{product_key:p.id,unit_keys:info.loose.map(u=>Number(u.id)),expected_stock:info.linked.length+info.loose.length});changed=true;}
    if(info.extra>0){
      if(info.extra>1000)throw Error(`«${p.data.name}» tiene más de 1000 unidades: actívalo en Mi web con «Modificar stock» (1000) y luego «Reponer» el resto.`);
      const current=info.linked.length+info.loose.length;
      await rpc("ao_suite_set_stock",{...core.legacyStockArgs(p,crypto.randomUUID(),today()),target_quantity:current+info.extra,expected_quantity:current});changed=true;
    }
    return changed;
  }
  let activatingAll=false,activationCancelled=false;
  async function activateLegacy(p){
    const info=productStock(p,stockIndex());
    if(!await registerStock(p,info))await rpc("ao_suite_set_stock",{...core.legacyStockArgs(p,crypto.randomUUID(),today()),target_quantity:0,expected_quantity:0});
  }
  function autoStockSummary(){
    const ix=stockIndex(),all=core.legacyProducts(products),legacy=core.activatableProducts(products),large=all.length-legacy.length;
    const linking=legacy.filter(p=>productStock(p,ix).loose.length).length,total=legacy.reduce((n,p)=>n+productStock(p,ix).total,0);
    const unmatched=[...ix.looseByKey].filter(([key])=>!ix.ownerByKey.has(key)).reduce((n,[,list])=>n+list.length,0);
    let text=`Se activarán ${legacy.length} ${plural(legacy.length,"producto","productos")} con ${total} ${plural(total,"unidad","unidades")} en total.`;
    if(linking)text+=` ${linking} ${plural(linking,"se vinculará","se vincularán")} con unidades que ya tienes en Compras con el mismo nombre, conservando su costo.`;
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
      return `<article class="card"><div class="client-head"><h2>${esc(c.name)}</h2><button type="button" class="quiet" data-delete-client="${esc(c.id)}" aria-label="Eliminar cliente ${esc(c.name)}">Eliminar</button></div><p class="muted">${esc(c.document?c.doc_type+" "+c.document:"Sin documento")}${c.email?" · "+esc(c.email):""}</p>${list.map(r=>`<div class="client-sale"><div><strong>${esc(r.series+"-"+r.number)}</strong><small>${esc(r.date)} · ${esc((r.payload.items||[]).map(i=>i.description).join(", "))}</small></div><strong>${money(r.total_cents/100)}</strong><button class="quiet" data-client-receipt="${r.id}">Ver boleta</button></div>`).join("")}</article>`;
    }).join("")||'<p class="empty">Los clientes aparecerán aquí cuando confirmes una boleta. Los compradores de ventas anteriores se consultan en el historial del inventario.</p>';
  }
  $("clientSearch").addEventListener("input",renderClients);
  // Eliminar un cliente: solo si no tiene boletas emitidas, porque sus boletas son el historial de la venta.
  let deletingClient=null,clientDeleteBusy=false;
  function resetClientDeletion(){
    deletingClient=null;clientDeleteBusy=false;
    for(const id of ["deleteClientConfirm","deleteClientCancel","deleteClientClose"])$(id).disabled=false;
    $("deleteClientConfirm").textContent="Sí, eliminar cliente";$("deleteClientMessage").textContent="";
    if($("deleteClientDialog").open)$("deleteClientDialog").close();
  }
  function openClientDeletion(client){
    if(!client||clientDeleteBusy)return;
    const issued=sales.filter(s=>s.client_id===client.id),numbers=issued.map(s=>receipts.find(r=>r.id===s.receipt_id)).filter(Boolean).map(r=>r.series+"-"+r.number);
    deletingClient={id:client.id,name:client.name,generation};
    $("deleteClientSummary").textContent=client.name+" · "+(client.document?client.doc_type+" "+client.document:"Sin documento");
    $("deleteClientDetails").textContent=issued.length
      ?`Este cliente tiene ${issued.length} ${plural(issued.length,"boleta emitida","boletas emitidas")}${numbers.length?" ("+numbers.slice(0,5).join(", ")+(numbers.length>5?"…":"")+")":""}. Sus boletas son el historial de la venta, por eso no se puede eliminar. Si alguna fue un error, elimínala primero en «Boletas emitidas».`
      :"Se quitará de tu lista de clientes. No afecta tus boletas, ventas ni stock. Si vuelve a comprar, se registrará de nuevo con su boleta.";
    $("deleteClientConfirm").hidden=issued.length>0;$("deleteClientMessage").textContent="";
    $("deleteClientDialog").showModal();$("deleteClientCancel").focus();
  }
  $("deleteClientForm").addEventListener("submit",async e=>{
    e.preventDefault();if(!db||!deletingClient||clientDeleteBusy)return;
    const target=deletingClient,current=()=>deletingClient===target&&generation===target.generation;
    clientDeleteBusy=true;for(const id of ["deleteClientConfirm","deleteClientCancel","deleteClientClose"])$(id).disabled=true;
    $("deleteClientConfirm").textContent="Eliminando…";$("deleteClientMessage").textContent="Eliminando el cliente…";
    try{
      const result=await rpc("ao_suite_delete_client",{client_key:target.id});
      if(!current())return;
      if(!result?.deleted)throw Error("El servidor no confirmó la eliminación. Inténtalo de nuevo.");
      let refreshed=true;try{await refreshAfterMutation();}catch{refreshed=false;}
      if(!current())return;
      resetClientDeletion();toast(`Cliente «${target.name}» eliminado.`+(refreshed?"":" Pulsa Actualizar para recargar la lista."));
    }catch(error){
      if(!current())return;
      // La función se agrega con database/delete_clients.sql; sin ella, la base de datos no la encuentra.
      const missing=error?.code==="PGRST202"||/could not find the function|ao_suite_delete_client/i.test(error?.message||"");
      $("deleteClientMessage").textContent=missing?"Falta activar la eliminación de clientes en tu base de datos: ejecuta una vez database/delete_clients.sql en el editor SQL de Supabase.":(error?.message||String(error));
    }finally{
      if(current()){clientDeleteBusy=false;for(const id of ["deleteClientConfirm","deleteClientCancel","deleteClientClose"])$(id).disabled=false;$("deleteClientConfirm").textContent="Sí, eliminar cliente";}
    }
  });
  for(const id of ["deleteClientCancel","deleteClientClose"])$(id).addEventListener("click",()=>{if(!clientDeleteBusy)resetClientDeletion();});
  $("deleteClientDialog").addEventListener("cancel",e=>{e.preventDefault();if(!clientDeleteBusy)resetClientDeletion();});
  $("clientList").addEventListener("click",e=>{const del=e.target.closest("[data-delete-client]");if(del){openClientDeletion(clients.find(c=>String(c.id)===del.dataset.deleteClient));return;}const b=e.target.closest("[data-client-receipt]");if(!b)return;const r=receipts.find(r=>r.id===b.dataset.clientReceipt);document.querySelector('[data-view="editor"]').click();const renderer=$("receiptFrame").contentWindow;if(renderer?.loadCloudReceipt)renderer.loadCloudReceipt(r.payload,r.id);else toast("La boleta se está cargando. Inténtalo en un momento.");});
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
    for(const id of ["externalName","externalPrice"])$(id).value="";$("externalBox").open=false;
    renderPicker();$("inventoryDialog").showModal();return new Promise(resolve=>{pickResolve=resolve;});
  }
  // Unidades que aún se pueden elegir en esta venta (no vendidas, ni en otra línea de la boleta, ni ya elegidas aquí).
  const freeUnit=u=>available(u)&&!blockedIds.has(String(u.id))&&!picking.some(x=>x.source==="stock"&&String(x.id)===String(u.id));
  const unitFor=part=>part.source==="stock"?units.find(u=>String(u.id)===String(part.id)):null;
  const partGone=part=>part.source==="stock"&&!(unitFor(part)&&available(unitFor(part)));
  // Precio de venta de un producto: el de tu web o, si no tiene, el sugerido de sus unidades.
  const productPrice=(p,info)=>Number(p.web_price)>0?Number(p.web_price):Number([...info.linked,...info.loose].find(u=>Number(u.precio_sugerido)>0)?.precio_sugerido)||0;
  // «Mi stock»: solo lo que tienes, un renglón por producto (y por nombre para lo de Compras que no está en tu web).
  function stockRows(term,ix){
    const rows=searchProducts(products,term).map(p=>({p,info:productStock(p,ix)})).filter(x=>x.info.free>0)
      .map(({p,info})=>({kind:"product",id:p.id,name:p.data.name,n:info.free,price:productPrice(p,info)}));
    const groups=[...ix.looseByKey].filter(([key])=>!ix.ownerByKey.has(key)).map(([key,list])=>({kind:"loose",key,name:list[0].nombre.trim(),n:list.filter(freeUnit).length,price:Number(list.find(u=>Number(u.precio_sugerido)>0)?.precio_sugerido)||0})).filter(g=>g.n>0);
    return rows.concat(searchProducts(groups,term,g=>g.name)).sort((x,y)=>x.name.localeCompare(y.name,"es"));
  }
  // Productos parecidos a un nombre que sí tienes (para no venderlos como de otra tienda sin descontar su stock).
  function similarInStock(name,ix){
    const tokens=searchTokens(name),models=modelTokens(tokens);if(!tokens.length)return [];
    return products.filter(p=>productStock(p,ix).total>0&&(matchesTokens(productText(p),tokens)||models.length&&matchesTokens(productText(p),models)));
  }
  function renderPicker() {
    const term=$("inventorySearch").value.trim(),ix=stockIndex(),rows=stockRows(term,ix);
    $("inventoryUnits").innerHTML=rows.map(r=>`<div class="unit-row catalogue-row"><span><strong>${esc(r.name)}</strong><small>${r.n} en stock</small></span><strong>${r.price>0?money(r.price):""}</strong><button type="button" class="secondary" ${r.kind==="product"?`data-sell-product="${esc(r.id)}"`:`data-sell-loose="${esc(r.key)}"`} aria-label="Agregar ${esc(r.name)} a esta venta">Agregar</button></div>`).join("")||`<p class="empty">${term?`No tienes «${esc(term)}» en stock.`:"No tienes productos en stock."}</p>`;
    renderMissing(term,ix,rows.length>0);
    $("inventorySelected").innerHTML=picking.map((p,i)=>`<div class="selected-part"><div><strong>${esc(p.name)}</strong><small>${partGone(p)?"ya no está disponible (se vendió o se retiró): quítalo":p.source==="stock"?"De tu stock":"No está en tu stock"}</small></div><label>Venta (S/)<input type="number" min="0" step="0.01" value="${esc(p.price)}" data-part-price="${i}" aria-label="Precio de venta de ${esc(p.name)}"></label><button type="button" class="quiet" data-remove-part="${i}" aria-label="Quitar ${esc(p.name)}">✕</button></div>`).join("")||'<p class="empty">Elige arriba lo que entregas al cliente.</p>';
    if(new Set(picking.map(p=>nameKey(p.name))).size>1)$("inventorySelected").insertAdjacentHTML("beforeend",'<p class="hint">Estos productos se imprimirán juntos en una sola línea («Computadora completa: …»). Para venderlos en líneas separadas, deja aquí uno y usa «Agregar producto» en la boleta para los demás.</p>');
    updatePickerTotal();
  }
  // Al buscar algo que no tienes: productos de tu web sin stock y lo escrito, para venderlo igual (no cambia tu stock).
  function renderMissing(term,ix,inStock) {
    if(!term){$("inventoryCatalogue").innerHTML="";return;}
    const matching=searchProducts(products,term),out=matching.filter(p=>productStock(p,ix).total===0).slice(0,5);
    const rows=out.map(p=>`<div class="unit-row catalogue-row"><span><strong>${esc(p.data.name)}</strong><small>Sin stock · venderlo igual no cambia tu stock</small></span><strong>${Number(p.web_price)>0?money(p.web_price):""}</strong><button type="button" class="secondary" data-sell-product="${esc(p.id)}" aria-label="Vender ${esc(p.data.name)} aunque no esté en tu stock">Venderlo igual</button></div>`);
    // Lo escrito solo se ofrece si no se parece a ningún producto de tu web ni de tu stock.
    if(!inStock&&!matching.length&&!similarInStock(term,ix).length)rows.push(`<div class="unit-row catalogue-row"><span><strong>«${esc(term)}»</strong><small>No está en tu stock · producto de otra tienda</small></span><button type="button" class="secondary" data-use-other aria-label="Agregar ${esc(term)} como producto de otra tienda">Venderlo igual</button></div>`);
    $("inventoryCatalogue").innerHTML=rows.length?`<h3 class="stock-title">No está en tu stock</h3><div class="unit-list">${rows.join("")}</div>`:"";
  }
  function pickedOk(text) {
    const message=$("inventoryMessage");message.classList.add("success");message.textContent=text;
    // En computadora se puede seguir buscando; en el celular no se abre el teclado.
    if(matchMedia("(pointer:fine)").matches){$("inventorySearch").focus({preventScroll:true});$("inventorySearch").select();}
  }
  const remainingText=n=>n?`te ${plural(n,"quedará","quedarán")} ${n}`:"te quedará 0 (pasa a «Para reponer»)";
  function openExternal(name,message) {
    $("externalBox").open=true;$("externalName").value=name.slice(0,350);$("externalPrice").value="";
    $("inventoryMessage").classList.remove("success");$("inventoryMessage").textContent=message;
    $("externalPrice").scrollIntoView({block:"center"});$("externalPrice").focus();
  }
  const noStockPart=(name,price)=>({source:"external",name:name.slice(0,350),supplier:NO_STOCK_SUPPLIER,cost:"0.00",price:Number(price).toFixed(2)});
  // «Agregar» en un producto de tu web: con los datos actuales se registra su stock si hace falta y se elige una unidad,
  // para que al emitir la boleta su stock baje y al eliminarla vuelva.
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
      const name=p.data.name,info=productStock(p,stockIndex());
      if(!info.total){
        // Sin stock: se vende igual, sin cambiar ningún stock.
        if(pickResolve!==mine)return;
        if(Number(p.web_price)>0){picking.push(noStockPart(name,p.web_price));renderPicker();pickedOk(`«${name}» no está en tu stock: se agregó a ${money(p.web_price)} (no cambia tu stock).`);}
        else openExternal(name,`«${name}» no tiene precio en tu web: escribe el precio de venta y pulsa «Agregar a esta venta».`);
        return;
      }
      if(await registerStock(p,info)){await refreshAfterMutation();$("accountingFrame").contentWindow?.refreshFromSuite?.();}
      if(client!==db)return;
      p=products.find(x=>String(x.id)===String(productId))||p;
      if(pickResolve!==mine){toast(`«${name}» quedó listo en tu stock; vuelve a agregarlo a la venta.`);return;}
      const now=productStock(p,stockIndex()),unit=now.linked.find(freeUnit);
      if(!unit)throw Error(`«${name}» ya no tiene unidades libres para esta venta (puede que se haya vendido en otro dispositivo o ya esté en otra línea).`);
      picking.push({source:"stock",id:unit.id,name:name.slice(0,350),serial:unit.serial||"",price:productPrice(p,now).toFixed(2)});
      renderPicker();pickedOk(`«${name}» agregado. Al emitir la boleta se descuenta de tu stock: ${remainingText(productStock(p,stockIndex()).free)}.`);
    }catch(error){report("inventoryMessage",error);}
    finally{if(client===db){activatingProduct=false;button.disabled=false;}}
  }
  // Unidades de Compras que no son de ningún producto de tu web: se elige una del grupo.
  function sellLoose(key) {
    const ix=stockIndex(),list=ix.ownerByKey.has(key)?[]:(ix.looseByKey.get(key)||[]),unit=list.find(freeUnit);
    if(!unit){report("inventoryMessage",Error("Ya no hay unidades libres de ese producto."));return;}
    const price=Number(list.find(u=>Number(u.precio_sugerido)>0)?.precio_sugerido)||0;
    picking.push({source:"stock",id:unit.id,name:list[0].nombre.trim().slice(0,350),serial:unit.serial||"",price:price.toFixed(2)});
    renderPicker();
    const left=list.filter(freeUnit).length;
    pickedOk(`«${list[0].nombre.trim()}» agregado. Al emitir la boleta se descuenta de tu stock: ${remainingText(left)}.${price?"":" Escribe su precio en «Venta (S/)»."}`);
    if(!price)document.querySelector(`[data-part-price="${picking.length-1}"]`)?.focus();
  }
  for(const id of ["inventoryUnits","inventoryCatalogue"])$(id).addEventListener("click",e=>{
    const product=e.target.closest("[data-sell-product]");if(product){sellCatalogueProduct(product,product.dataset.sellProduct);return;}
    const loose=e.target.closest("[data-sell-loose]");if(loose){sellLoose(loose.dataset.sellLoose);return;}
    if(e.target.closest("[data-use-other]")){const name=$("inventorySearch").value.trim();openExternal(name,`«${name}» está listo abajo: escribe el precio de venta y pulsa «Agregar a esta venta».`);}
  });
  function updatePickerTotal() {let n=0,valid=true;for(const p of picking){try{n+=core.cents(p.price);}catch{valid=false;}}$("inventoryTotal").textContent=valid?money(n/100):"Revisa los precios";}
  let searchTimer;
  $("inventorySearch").addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderPicker,120);});
  $("inventorySelected").addEventListener("input",e=>{if(e.target.dataset.partPrice===undefined)return;picking[Number(e.target.dataset.partPrice)].price=e.target.value;updatePickerTotal();});
  $("inventorySelected").addEventListener("click",e=>{const b=e.target.closest("[data-remove-part]");if(!b)return;picking.splice(Number(b.dataset.removePart),1);renderPicker();});
  // Un producto que tienes, escrito a mano, se vendería como de otra tienda y su stock no bajaría: se avisa una vez.
  let externalConfirmedName="";
  function addExternalPart() {
    try{
      const name=$("externalName").value.trim();
      if(!name)throw Error("Indica el nombre del producto.");if(!$("externalPrice").value.trim())throw Error("Indica el precio al que lo vendes.");
      const part=noStockPart(name,core.cents($("externalPrice").value)/100);core.validateParts([part]);
      const similar=similarInStock(name,stockIndex());
      if(similar.length&&externalConfirmedName!==nameKey(name)){
        externalConfirmedName=nameKey(name);$("inventorySearch").value=name;renderPicker();
        throw Error(`Tienes «${similar[0].data.name}» en tu stock. Si es ese, pulsa su «Agregar» en «Mi stock» (arriba) para que la venta lo descuente. Si de verdad es de otra tienda, pulsa «Agregar a esta venta» otra vez.`);
      }
      externalConfirmedName="";picking.push(part);for(const id of ["externalName","externalPrice"])$(id).value="";$("inventoryMessage").textContent="";renderPicker();return true;
    }catch(error){report("inventoryMessage",error);$("externalBox").open=true;return false;}
  }
  $("addExternal").addEventListener("click",addExternalPart);
  for(const id of ["externalName","externalPrice"])$(id).addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addExternalPart();}});
  $("inventoryConfirm").addEventListener("click",()=>{
    // Si dejaste escrito un producto de otra tienda (con el apartado abierto) sin pulsar «Agregar a esta venta», se agrega ahora.
    if($("externalBox").open&&["externalName","externalPrice"].some(id=>$(id).value.trim())&&!addExternalPart())return;
    const gone=picking.find(partGone);
    if(gone){report("inventoryMessage",Error(`«${gone.name}» ya no está disponible (se vendió o se retiró). Quítalo de la lista y elige otro.`));return;}
    const free=picking.findIndex(p=>{try{return core.cents(p.price)===0;}catch{return false;}});
    if(free>=0){report("inventoryMessage",Error(`«${picking[free].name}» no tiene precio de venta: escríbelo en «Venta (S/)».`));document.querySelector(`[data-part-price="${free}"]`)?.focus();return;}
    try{core.validateParts(picking);if(picking.length>500)throw Error("Selecciona hasta 500 componentes.");const selected=structuredClone(picking).map(p=>p.source==="external"?{...p,cost:(core.optionalCents(p.cost)/100).toFixed(2)}:p),resolve=pickResolve;pickResolve=null;$("inventoryDialog").close();resolve(selected);}catch(error){report("inventoryMessage",error);}
  });
  $("inventoryDialog").addEventListener("close",()=>{if(pickResolve){const resolve=pickResolve;pickResolve=null;resolve(null);}});
  document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>$(b.dataset.close).close()));
  window.AOSuite={initialize,refresh,refreshAfterMutation,navigate,logout,pickInventory,openStockGroup,stockProducts:()=>products.map(p=>({id:p.id,name:p.data.name,managed:p.managed}))};
})();
