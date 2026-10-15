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
  let publicCatalog=new Map(),catalogReady=false,catalogError="";
  const available = core.available;
  const productFor = u => products.find(p => String(p.id) === String(u.product_id));
  const stock = p => p.published ? (catalogReady ? publicCatalog.get(String(p.id))?.stock||0 : 0) : core.productStock(p,units);
  let catalogueMode="available", productRequest, stockRequest, stockEditing, stockRestocking, stockExpected, stockPreparation;
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
      const result=await Promise.all([...["ao_products","COMPRAS","COMPONENTES","ao_clients","ao_sales","ao_receipts","ao_suite_state"].map(t=>rows(client,t)),client.rpc("ao_catalog_snapshot",{})]);
      if(result[7].error)throw result[7].error;
      const catalogue=core.catalogRows(result[7].data);
      if(current!==generation)return;
      [products,purchases,units,clients,sales,receipts]=result;
      publicCatalog=new Map(catalogue.filter(p=>window.AO_CATEGORIES[p.category]).map(p=>[String(p.id),p]));catalogReady=true;catalogError="";
      importState=result[6].find(s=>s.key==="legacy_import")?.value||{};
      const byPurchase=new Map(); for(const u of units){const key=String(u.compra_id);if(!byPurchase.has(key))byPurchase.set(key,[]);byPurchase.get(key).push(u);}
      units=purchases.flatMap(p=>core.allocate(p,byPurchase.get(String(p.id))||[]));
      renderCatalog(); renderClients(); renderImportStatus();
      $("accountingFrame").contentWindow?.renderInventario?.();
    })().catch(error=>{if(current===generation){catalogReady=false;catalogError=error.message||"No se pudieron cargar los datos.";toast(catalogError);renderCatalog();$("accountingFrame").contentWindow?.renderInventario?.();}throw error;}).finally(()=>{if(current===generation)loading=null;});
    return loading;
  }
  async function initialize(client,person) {
    ++generation; db=client; member=person; loading=null;publicCatalog=new Map();catalogReady=false;catalogError="";
    $("connectionNav").hidden=member.role!=="owner"; $("importForm").hidden=member.role!=="owner";
    if(!$("accountingFrame").getAttribute("src"))$("accountingFrame").src="accounting.html?v=20261015-cantidad";
    await refresh();
  }
  async function refreshAfterMutation() {
    // An earlier read may have started before the write. Finish it, then read
    // again so restored units and removed sales are reflected immediately.
    if (loading) { try { await loading; } catch {} }
    return refresh();
  }
  function logout() {
    ++generation;db=null;member=null;loading=null;publicCatalog=new Map();catalogReady=false;catalogError="";activatingAll=false;activatingProduct=false;products=[];purchases=[];units=[];clients=[];sales=[];receipts=[];
    for(const id of ["productDialog","linkDialog","inventoryDialog","stockDialog","autoStockDialog"])if($(id).open)$(id).close();resetClientDeletion();
    $("catalogGrid").replaceChildren();$("clientList").replaceChildren();$("oldPassword").value="";
  }
  function navigate(name) {
    const titles={dashboard:"Resumen del negocio",compras:"Compras y costos",inventario:"Inventario disponible",ventas:"Ventas y ganancias",catalog:"Productos de mi web",clients:"Clientes",editor:"Nueva boleta",history:"Boletas emitidas",team:"Mi equipo",account:"Mi cuenta",connection:"Conexión inicial",quotes:"Cotizaciones",quoteEditor:"Cotización"};
    $("suiteHeading").textContent=titles[name]||"AO Nexus Central";
    if(["dashboard","compras","inventario","ventas"].includes(name)){desiredView=name==="ventas"?"historial":name;$("accountingFrame").contentWindow?.navigateFromSuite?.(desiredView);}
    if(["catalog","clients","connection","inventario"].includes(name))refresh().catch(()=>{});
  }
  $("accountingFrame").addEventListener("load",()=>$("accountingFrame").contentWindow?.navigateFromSuite?.(desiredView));
  function renderCatalog() {
    if(!catalogReady){
      $("catalogSummary").textContent='Stock sin verificar';$("catalogGrid").innerHTML='<p class="empty">No se pudo consultar el stock de tu web. Pulsa Actualizar para reintentar.</p>';$("catalogConnection").textContent=catalogError;return;
    }
    const term=$("catalogSearch").value.trim().toLocaleLowerCase("es");
    const filtered=products.filter(p=>catalogueMode==='replenish'?stock(p)===0:stock(p)>0).filter(p=>(p.data.name+" "+p.data.brand).toLocaleLowerCase("es").includes(term));
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
    if(!product)return;if(product.published&&!catalogReady){toast("Actualiza el stock de tu web antes de modificarlo.");return;}stockEditing=product;stockRestocking=restocking;stockRequest=crypto.randomUUID();stockPreparation=product.id?{...productStock(product,stockIndex()),request:crypto.randomUUID(),purchasedOn:today(),linkedDone:false,complete:false}:null;stockExpected=stockPreparation?stockPreparation.total:groupUnits(product).length;
    $("stockForm").reset();$("stockTitle").textContent=(restocking?'Reponer · ':'Modificar stock · ')+product.data.name;
    $("stockSummary").textContent=stockExpected+' unidad(es) disponibles'+(stockPreparation?.extra?' · '+stockPreparation.extra+' del catálogo anterior':'');
    $("stockQuantityLabel").textContent=restocking?'¿Cuántas unidades estás trayendo?':'Cantidad disponible correcta';
    $("stockQuantity").value=restocking?'1':String(stockExpected);$("stockDate").value=today();$("stockMessage").textContent='';updateStockFields();$("stockDialog").showModal();
  }
  function openStockGroup(group,restocking=false){openStock(products.find(p=>String(p.id)===String(group.productId))||{id:null,data:{name:group.name},managed:true},restocking);}
  function updateStockFields(){const count=Number($("stockQuantity").value),delta=stockRestocking?count:count-stockExpected;$("stockPurchaseFields").hidden=delta<=0;$("stockQuantity").min=stockRestocking?'1':'0';$("stockHint").textContent=delta>0?`Se sumarán ${delta} unidad(es) al stock. El costo es opcional: si lo indicas se usará para calcular la ganancia; si no, quedará en S/ 0.00 y podrás completarlo después en Compras.`:delta<0?`Se retirarán ${-delta} unidad(es) del stock disponible. Se conservarán las compras y las ventas ya realizadas.`:'La cantidad disponible permanecerá igual.';}
  $("stockQuantity").addEventListener('input',updateStockFields);
  $("stockForm").addEventListener('submit',async e=>{
    e.preventDefault();const button=$("stockSave");button.disabled=true;
    try{
      const count=core.quantity($("stockQuantity").value),target=stockRestocking?stockExpected+count:count;
      const cost=target>stockExpected?core.optionalCents($("stockCost").value)/100:null;
      const supplier=$("stockSupplier").value.trim()||null,purchasedOn=$("stockDate").value||today();
      // Normaliza solo al confirmar: reutiliza las compras existentes y registra
      // únicamente la cantidad del catálogo que falta. Las claves permiten reintentar.
      const prep=stockPreparation;
      if(prep&&!prep.complete){
        if(!prep.extraStarted&&!prep.linkStarted){
          await refreshAfterMutation();
          const latest=products.find(p=>String(p.id)===String(stockEditing.id));
          const current=latest&&productStock(latest,stockIndex());
          if(!current||current.total!==stockExpected)throw Error('El stock de tu web cambió mientras editabas. Cierra esta ventana y revisa la cantidad actual.');
          Object.assign(prep,current);stockEditing=latest;
        }
        if(prep.extra>1000)throw Error('Activa hasta 1000 unidades del catálogo anterior antes de modificar o reponer este producto.');
        const linkedCount=prep.actualLinked+prep.loose.length;
        if(prep.loose.length&&!prep.linkedDone){
          prep.linkStarted=true;
          await rpc('ao_suite_link_stock',{product_key:stockEditing.id,unit_keys:prep.loose.map(u=>Number(u.id)),expected_stock:linkedCount});
          prep.linkedDone=true;
        }
        if(prep.extra>0){prep.extraStarted=true;await rpc('ao_suite_set_stock',{...core.legacyStockArgs(stockEditing,prep.request,prep.purchasedOn),target_quantity:linkedCount+prep.extra,expected_quantity:linkedCount});}
        prep.complete=true;
      }
      const result=await rpc('ao_suite_set_stock',{request_key:stockRequest,product_key:stockEditing.id||null,product_name:stockEditing.data.name,target_quantity:target,expected_quantity:prep?prep.actualLinked+prep.loose.length+prep.extra:stockExpected,cost_per_unit:cost,supplier,purchased_on:purchasedOn});
      await refreshAfterMutation();$("accountingFrame").contentWindow?.refreshFromSuite?.();$("stockDialog").close();toast('Stock actualizado: '+result.quantity+' unidad(es) disponibles.');
    }
    catch(error){report('stockMessage',error);}finally{button.disabled=false;}
  });
  // ---------- Stock para vender: reglas compartidas por el buscador de la boleta y la activación del catálogo anterior ----------
  // Compras creadas al vender algo que no estaba en tu stock. Si se elimina esa boleta vuelven como unidades, pero no son stock real.
  const NO_STOCK_SUPPLIER="Venta sin stock";
  const keyCache=new Map();
  // Compara nombres sin mayúsculas, tildes ni espacios repetidos.
  const nameKey=value=>{const text=String(value||"");let key=keyCache.get(text);if(key===undefined){key=text.normalize("NFD").replace(/[̀-ͯ]/g,"").toLocaleLowerCase("es").replace(/\s+/g," ").trim();keyCache.set(text,key);}return key;};
  const compactKey=value=>nameKey(value).replace(/[^a-z0-9ñ]/g,"");
  const identityKey=value=>(nameKey(value).match(/[a-z0-9]+/g)||[]).sort().join(" ");
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
    for(const p of products){const key=identityKey(p.data.name);ownerByKey.set(key,ownerByKey.has(key)?null:p);}
    for(const u of units){
      if(!available(u))continue;
      if(u.product_id&&productIds.has(String(u.product_id))){const id=String(u.product_id);if(!byProduct.has(id))byProduct.set(id,[]);byProduct.get(id).push(u);continue;}
      if(noStock.has(String(u.compra_id)))continue;
      const key=identityKey(u.nombre);if(!looseByKey.has(key))looseByKey.set(key,[]);looseByKey.get(key).push(u);
    }
    return {byProduct,ownerByKey,looseByKey};
  }
  // La cantidad pública manda; Compras solo permite reutilizar unidades y costos hasta esa cantidad.
  function productStock(p,ix){
    const key=identityKey(p.data.name),linked=ix.byProduct.get(String(p.id))||[],loose=ix.ownerByKey.get(key)===p?(ix.looseByKey.get(key)||[]):[];
    const total=stock(p),eligibleLinked=linked.slice(0,total);
    const eligibleLoose=p.managed?[]:loose.slice(0,Math.max(0,total-eligibleLinked.length));
    const extra=Math.max(0,total-eligibleLinked.length-eligibleLoose.length);
    return {linked:eligibleLinked,loose:eligibleLoose,extra,total,actualLinked:linked.length,free:eligibleLinked.filter(freeUnit).length+eligibleLoose.filter(freeUnit).length+extra};
  }
  // Para que la venta descuente el stock: vincula las unidades de Compras con su nombre (conservan su costo)
  // y registra como unidades sin costo la cantidad del catálogo anterior que falte.
  async function registerStock(p,info){
    if(!catalogReady)throw Error("Actualiza el stock de tu web antes de registrar unidades.");
    let changed=false;
    if(info.loose.length){await rpc("ao_suite_link_stock",{product_key:p.id,unit_keys:info.loose.map(u=>Number(u.id)),expected_stock:info.actualLinked+info.loose.length});changed=true;}
    if(info.extra>0){
      if(info.extra>1000)throw Error(`«${p.data.name}» tiene más de 1000 unidades: actívalo en Mi web con «Modificar stock» (1000) y luego «Reponer» el resto.`);
      const current=info.actualLinked+info.loose.length;
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
      await refresh();
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
    $("deleteClientMessage").setAttribute("tabindex","-1");$("deleteClientMessage").textContent="Eliminando el cliente…";$("deleteClientMessage").focus();
    clientDeleteBusy=true;for(const id of ["deleteClientConfirm","deleteClientCancel","deleteClientClose"])$(id).disabled=true;
    $("deleteClientConfirm").textContent="Eliminando…";
    try{
      const result=await rpc("ao_suite_delete_client",{client_key:target.id});
      if(!current())return;
      if(!result?.deleted)throw Error("El servidor no confirmó la eliminación. Inténtalo de nuevo.");
      let refreshed=true;try{await refreshAfterMutation();}catch{refreshed=false;}
      if(!current())return;
      resetClientDeletion();$("clientSearch").focus();toast(`Cliente «${target.name}» eliminado.`+(refreshed?"":" Recarga la página para ver la lista actualizada."));
    }catch(error){
      if(!current())return;
      // La función se agrega con database/delete_clients.sql; sin ella, la base de datos responde que no la encuentra.
      const missing=error?.code==="PGRST202"||/could not find the function/i.test(error?.message||"");
      const hasReceipts=error?.code==="23503"||/boleta\(s\) emitida/.test(error?.message||"");
      $("deleteClientMessage").textContent=missing?"Falta activar la eliminación de clientes en tu base de datos: ejecuta una vez database/delete_clients.sql en el editor SQL de Supabase.":(error?.message||String(error));
      // Si mientras tanto el cliente recibió una boleta, ya no se ofrece eliminarlo y la lista se actualiza.
      if(hasReceipts){$("deleteClientConfirm").hidden=true;$("deleteClientDetails").textContent="Sus boletas son el historial de la venta, por eso no se puede eliminar. Si alguna fue un error, elimínala primero en «Boletas emitidas».";refreshAfterMutation().catch(()=>{});}
    }finally{
      if(current()){clientDeleteBusy=false;for(const id of ["deleteClientConfirm","deleteClientCancel","deleteClientClose"])$(id).disabled=false;$("deleteClientConfirm").textContent="Sí, eliminar cliente";if($("deleteClientDialog").open)$("deleteClientCancel").focus();}
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
  // El mismo buscador sirve a la cotización ({mode:"quote"}): elige referencias (producto, nombre o a pedido), nunca unidades,
  // así que no aparta ni descuenta stock. Los textos del diálogo cambian según quién lo abre.
  let quoting=false;
  const PICKER_TEXT_IDS=["inventoryEyebrow","inventoryTitle","inventoryHint","externalSummary","externalHint","externalPriceLabel","inventorySelectedTitle","addExternal","inventoryConfirm"];
  const QUOTE_TEXTS={inventoryEyebrow:"PRODUCTOS DE LA COTIZACIÓN",inventoryTitle:"Productos que cotizas",inventoryHint:"Elige de tu stock lo que cotizas. La cotización no aparta ni descuenta stock: tu stock baja recién al emitir la boleta.",externalSummary:"¿No está en tu stock? Cotizar un producto a pedido",externalHint:"Solo necesitas el nombre y el precio. No cambia tu stock.",externalPriceLabel:"Precio cotizado (S/)",inventorySelectedTitle:"Productos de esta cotización",addExternal:"Agregar a esta cotización",inventoryConfirm:"Usar en la cotización"};
  // Para la boleta se restaura el contenido original del diálogo tal cual (index.html).
  const BOLETA_TEXTS=Object.fromEntries(PICKER_TEXT_IDS.map(id=>[id,$(id)?.innerHTML]));
  function pickerTexts(){for(const id of PICKER_TEXT_IDS){const el=$(id);if(!el)continue;if(quoting)el.textContent=QUOTE_TEXTS[id];else if(el.innerHTML!==BOLETA_TEXTS[id])el.innerHTML=BOLETA_TEXTS[id];}}
  async function pickInventory(item,index,options) {
    await refresh();if(pickResolve)throw Error("Ya hay una selección de stock abierta.");
    quoting=options?.mode==="quote";
    blockedIds=quoting?new Set():new Set(($("receiptFrame").contentWindow?.getInventoryIdsExcept?.(index)||[]).map(String));
    picking=quoting?(Array.isArray(item?.parts)?structuredClone(item.parts):[]).filter(p=>p&&typeof p==="object"):structuredClone(item.inventory||[]);$("inventorySearch").value="";$("inventoryMessage").textContent="";$("inventoryMessage").classList.remove("success");externalConfirmedName="";pickGoal=null;
    for(const id of ["externalName","externalPrice"])$(id).value="";$("externalBox").open=false;
    pickerTexts();if(!quoting)suggestPick(item);renderPicker();$("inventoryDialog").showModal();return new Promise(resolve=>{pickResolve=resolve;});
  }
  // Boleta: una línea a medias (por ejemplo, la de una cotización) abre el buscador con lo que le falta.
  let pickGoal=null;
  function suggestPick(item){
    const ix=stockIndex(),qtyText=String(item?.quantity??"").trim(),qty=/^\d{1,4}$/.test(qtyText)?Number(qtyText):0;
    if(!picking.length){
      // Con la descripción escrita, se busca solo si se parece a algo de tu stock o de tu web (si no, se ve todo tu stock como siempre).
      const text=String(item?.description??"").replace(/\s+/g," ").trim().slice(0,120);
      if(searchTokens(text).length&&(stockRows(text,ix).length||searchProducts(products,text).length))$("inventorySearch").value=text;
      return;
    }
    const name=String(picking[0].name??""),missing=qty-picking.length;
    if(item.inventoryMode==="bundle"||missing<1||!name||picking.some(p=>p.name!==name))return;
    $("inventorySearch").value=name.slice(0,120);
    if(stockRows(name,ix).length){$("inventoryMessage").textContent=`${missing===1?"Falta 1":`Faltan ${missing}`} de «${name}» para la cantidad de esta línea (${qty}): pulsa «Agregar» en «Mi stock».`;return;}
    // No queda más en tu stock: el apartado de abajo queda listo para venderlas sin stock, al mismo precio por unidad.
    let price="";try{price=(core.cents(picking[0].price)/100).toFixed(2);}catch{}
    pickGoal={name,qty};$("externalBox").open=true;$("externalName").value=name.slice(0,350);$("externalPrice").value=price;
    $("inventoryMessage").textContent=`No te quedan más «${name}» en tu stock. Para vender ${missing===1?"la que falta":`las ${missing} que faltan`}, pulsa «Agregar a esta venta» abajo (se venden sin descontar stock), o baja la cantidad en la boleta.`;
  }
  // Unidades que aún se pueden elegir en esta venta (no vendidas, ni en otra línea de la boleta, ni ya elegidas aquí).
  const freeUnit=u=>available(u)&&!blockedIds.has(String(u.id))&&!picking.some(x=>x.source==="stock"&&String(x.id)===String(u.id));
  const unitFor=part=>part.source==="stock"?units.find(u=>String(u.id)===String(part.id)):null;
  const partGone=part=>part.source==="stock"&&!(unitFor(part)&&available(unitFor(part)));
  // Precio de venta de un producto: el de tu web o, si no tiene, el sugerido de sus unidades.
  const productPrice=(p,info)=>Number(p.web_price)>0?Number(p.web_price):Number([...info.linked,...info.loose].find(u=>Number(u.precio_sugerido)>0)?.precio_sugerido)||0;
  // Otra unidad de un producto ya elegido conserva su precio (si lo cambiaste), para que la línea no se convierta en «Computadora completa».
  // Solo un precio válido y mayor que cero: uno vacío o con más de dos decimales no se copia a las demás unidades.
  const keptPrice=(name,price)=>{const kept=picking.find(x=>x.name===String(name).slice(0,350))?.price;try{if(core.cents(kept)>0)return (core.cents(kept)/100).toFixed(2);}catch{}return Number(price).toFixed(2);};
  // «Mi stock»: solo lo que tienes, un renglón por producto (y por nombre para lo de Compras que no está en tu web).
  function stockRows(term,ix){
    const rows=searchProducts(products,term).map(p=>({p,info:productStock(p,ix)})).filter(x=>x.info.free>0)
      .map(({p,info})=>({kind:"product",id:p.id,name:p.data.name,n:info.free,price:productPrice(p,info)}));
    const groups=[...ix.looseByKey].filter(([key])=>!ix.ownerByKey.has(key)).map(([key,list])=>({kind:"loose",key,name:list[0].nombre.trim(),n:list.filter(freeUnit).length,price:Number(list.find(u=>Number(u.precio_sugerido)>0)?.precio_sugerido)||0})).filter(g=>g.n>0);
    return rows.concat(searchProducts(groups,term,g=>g.name)).sort((x,y)=>x.name.localeCompare(y.name,"es"));
  }
  // Productos parecidos a un nombre que sí tienes libres para esta venta (para no venderlos como de otra tienda sin descontar su stock).
  // Si todas sus unidades ya están en esta venta o en otra línea, no se avisa: lo que falta se vende sin stock.
  function similarInStock(name,ix){
    const tokens=searchTokens(name),models=modelTokens(tokens);if(!tokens.length)return [];
    return products.filter(p=>productStock(p,ix).free>0&&(matchesTokens(productText(p),tokens)||models.length&&matchesTokens(productText(p),models)));
  }
  function renderPicker() {
    const term=$("inventorySearch").value.trim(),ix=stockIndex(),rows=stockRows(term,ix);
    // Boleta: si lo buscado sí está en tu stock pero todas sus unidades ya están en esta venta (o en otra línea), se dice así.
    const taken=!rows.length&&term&&!quoting&&searchProducts(products,term).some(p=>productStock(p,ix).total>0);
    $("inventoryUnits").innerHTML=rows.map(r=>`<div class="unit-row catalogue-row"><span><strong>${esc(r.name)}</strong><small>${r.n} en stock${quoting?quotedNote(r):""}</small></span><strong>${r.price>0?money(r.price):""}</strong><button type="button" class="secondary" ${r.kind==="product"?`data-sell-product="${esc(r.id)}"`:`data-sell-loose="${esc(r.key)}"`} aria-label="Agregar ${esc(r.name)} a esta ${quoting?"cotización":"venta"}">Agregar</button></div>`).join("")||`<p class="empty">${taken?`Todas tus unidades de «${esc(term)}» ya están en esta venta o en otra línea de la boleta.`:term?`No tienes «${esc(term)}» en stock.`:"No tienes productos en stock."}</p>`;
    renderMissing(term,ix,rows.length>0);
    $("inventorySelected").innerHTML=picking.map((p,i)=>`<div class="selected-part"><div><strong>${esc(p.name)}</strong><small>${quoting?quoteOrigin(p,ix):partGone(p)?"ya no está disponible (se vendió o se retiró): quítalo":p.source==="stock"?"De tu stock":"No está en tu stock"}</small></div><label>${quoting?"Precio":"Venta"} (S/)<input type="number" min="0" step="0.01" value="${esc(p.price)}" data-part-price="${i}" aria-label="Precio ${quoting?"cotizado":"de venta"} de ${esc(p.name)}"></label><button type="button" class="quiet" data-remove-part="${i}" aria-label="Quitar ${esc(p.name)}">✕</button></div>`).join("")||`<p class="empty">${quoting?"Elige arriba lo que cotizas.":"Elige arriba lo que entregas al cliente."}</p>`;
    if(new Set(picking.map(p=>nameKey(p.name))).size>1)$("inventorySelected").insertAdjacentHTML("beforeend",quoting?'<p class="hint">Estos productos se cotizarán juntos en una sola línea («Computadora completa: …»). Para cotizarlos en líneas separadas, deja aquí uno y usa «Agregar producto» en la cotización para los demás.</p>':'<p class="hint">Estos productos se imprimirán juntos en una sola línea («Computadora completa: …»). Para venderlos en líneas separadas, deja aquí uno y usa «Agregar producto» en la boleta para los demás.</p>');
    updatePickerTotal();
  }
  // Cotización: cuántas veces ya está ese producto en la lista y de dónde sale cada uno.
  const quotedCount=r=>picking.filter(x=>r.kind==="product"?x.source==="product"&&String(x.productId)===String(r.id):x.source==="loose"&&x.key===r.key).length;
  const quotedNote=r=>{const n=quotedCount(r);return n?` · ${n} en esta cotización`:"";};
  // Unidades que tienes de lo que se cotiza (null: a pedido). Lo de Compras cuyo nombre ya tiene ficha usa el stock de esa ficha.
  function quotedStock(part,ix){
    if(part.source==="product"){const p=products.find(x=>String(x.id)===String(part.productId));return p?productStock(p,ix).total:0;}
    if(part.source==="loose"){const owner=ix.ownerByKey.get(part.key);return owner?productStock(owner,ix).total:ix.ownerByKey.has(part.key)?0:(ix.looseByKey.get(part.key)||[]).length;}
    return null;
  }
  function quoteOrigin(p,ix){
    if(p.source==="product"&&!products.some(x=>String(x.id)===String(p.productId)))return "Ya no está en tu web";
    if(p.source==="product")return quotedStock(p,ix)?"De tu stock":"Producto de tu web sin stock";
    if(p.source==="loose")return quotedStock(p,ix)?"De tu stock":"Ya no está en tu stock";
    const n=externalStock(p,ix);if(n)return `A pedido · ahora tienes ${n} en stock (al convertirla se toma de tu stock)`;
    return products.some(x=>(p.productId!=null?String(x.id)===String(p.productId):nameKey(x.data.name)===nameKey(p.name))&&!productStock(x,ix).total)?"Producto de tu web sin stock":"No está en tu stock (a pedido)";
  }
  // Lo cotizado «a pedido» que hoy sí está en tu stock: el mismo producto de tu web (o su mismo nombre) o lo de Compras con ese nombre.
  function externalOwner(part,ix){
    const key=identityKey(part.name),p=part.productId!=null&&products.find(x=>String(x.id)===String(part.productId))||ix.ownerByKey.get(key);
    return p?{product:p}:ix.ownerByKey.has(key)?null:{key};
  }
  function externalStock(part,ix){
    const owner=externalOwner(part,ix);if(!owner)return null;
    const n=owner.product?productStock(owner.product,ix).total:(ix.looseByKey.get(owner.key)||[]).length;return n>0?n:null;
  }
  // Al buscar algo que no tienes: productos de tu web sin stock y lo escrito, para venderlo igual (no cambia tu stock).
  function renderMissing(term,ix,inStock) {
    if(!term){$("inventoryCatalogue").innerHTML="";return;}
    const matching=searchProducts(products,term),out=matching.filter(p=>productStock(p,ix).total===0).slice(0,5);
    const rows=out.map(p=>`<div class="unit-row catalogue-row"><span><strong>${esc(p.data.name)}</strong><small>${quoting?"Sin stock · se cotiza a pedido":"Sin stock · venderlo igual no cambia tu stock"}</small></span><strong>${Number(p.web_price)>0?money(p.web_price):""}</strong><button type="button" class="secondary" data-sell-product="${esc(p.id)}" aria-label="${quoting?"Cotizar":"Vender"} ${esc(p.data.name)} aunque no esté en tu stock">${quoting?"Cotizarlo igual":"Venderlo igual"}</button></div>`);
    // Lo escrito solo se ofrece si no se parece a ningún producto de tu web ni de tu stock.
    if(!inStock&&!matching.length&&!similarInStock(term,ix).length)rows.push(`<div class="unit-row catalogue-row"><span><strong>«${esc(term)}»</strong><small>No está en tu stock · producto ${quoting?"a pedido":"de otra tienda"}</small></span><button type="button" class="secondary" data-use-other aria-label="Agregar ${esc(term)} como producto ${quoting?"a pedido":"de otra tienda"}">${quoting?"Cotizarlo igual":"Venderlo igual"}</button></div>`);
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
        if(Number(p.web_price)>0){const price=keptPrice(name,p.web_price);picking.push({...noStockPart(name,p.web_price),price});renderPicker();pickedOk(`«${name}» no está en tu stock: se agregó a ${money(price)} (no cambia tu stock).`);}
        else openExternal(name,`«${name}» no tiene precio en tu web: escribe el precio de venta y pulsa «Agregar a esta venta».`);
        return;
      }
      if(await registerStock(p,info)){await refreshAfterMutation();$("accountingFrame").contentWindow?.refreshFromSuite?.();}
      if(client!==db)return;
      p=products.find(x=>String(x.id)===String(productId))||p;
      if(pickResolve!==mine){toast(`«${name}» quedó listo en tu stock; vuelve a agregarlo a la venta.`);return;}
      const now=productStock(p,stockIndex()),unit=now.linked.find(freeUnit);
      if(!unit)throw Error(`«${name}» ya no tiene unidades libres para esta venta (puede que se haya vendido en otro dispositivo o ya esté en otra línea).`);
      picking.push({source:"stock",id:unit.id,name:name.slice(0,350),serial:unit.serial||"",price:keptPrice(name,productPrice(p,now))});
      renderPicker();pickedOk(`«${name}» agregado. Al emitir la boleta se descuenta de tu stock: ${remainingText(productStock(p,stockIndex()).free)}.`);
    }catch(error){report("inventoryMessage",error);}
    finally{if(client===db){activatingProduct=false;button.disabled=false;}}
  }
  // Unidades de Compras que no son de ningún producto de tu web: se elige una del grupo.
  function sellLoose(key) {
    const ix=stockIndex(),list=ix.ownerByKey.has(key)?[]:(ix.looseByKey.get(key)||[]),unit=list.find(freeUnit);
    if(!unit){report("inventoryMessage",Error("Ya no hay unidades libres de ese producto."));return;}
    const price=Number(keptPrice(list[0].nombre.trim(),Number(list.find(u=>Number(u.precio_sugerido)>0)?.precio_sugerido)||0))||0;
    picking.push({source:"stock",id:unit.id,name:list[0].nombre.trim().slice(0,350),serial:unit.serial||"",price:keptPrice(list[0].nombre.trim(),price)});
    renderPicker();
    const left=list.filter(freeUnit).length;
    pickedOk(`«${list[0].nombre.trim()}» agregado. Al emitir la boleta se descuenta de tu stock: ${remainingText(left)}.${price?"":" Escribe su precio en «Venta (S/)»."}`);
    if(!price)document.querySelector(`[data-part-price="${picking.length-1}"]`)?.focus();
  }
  // Cotización: «Agregar» solo anota la referencia con el precio actual; no registra ni vincula stock (eso se hace al convertirla en boleta).
  function quotedOk(name,quoted,have,price) {
    const over=quoted>have,message=$("inventoryMessage");
    pickedOk(over?`«${name}» agregado. Cotizas ${quoted} y tienes ${have} en stock: al convertirla en boleta te avisaremos.`:`«${name}» agregado a la cotización · tienes ${have} en stock.`);
    if(over)message.classList.remove("success");
    if(!price){message.textContent+=" Escribe su precio en «Precio (S/)».";document.querySelector(`[data-part-price="${picking.length-1}"]`)?.focus();}
  }
  function quoteProduct(productId) {
    const p=products.find(x=>String(x.id)===String(productId));
    if(!p){report("inventoryMessage",Error("El producto ya no existe."));return;}
    const name=p.data.name,info=productStock(p,stockIndex());
    if(!info.total){
      // Se guarda el producto de tu web: si lo repones antes de convertirla, la boleta lo toma de tu stock.
      if(Number(p.web_price)>0){const price=keptPrice(name,p.web_price);picking.push({source:"external",productId:String(p.id),name:name.slice(0,350),price});renderPicker();pickedOk(`«${name}» no está en tu stock: se cotiza a pedido a ${money(price)} (no cambia tu stock).`);}
      else openExternal(name,`«${name}» no tiene precio en tu web: escribe el precio y pulsa «Agregar a esta cotización».`);
      return;
    }
    const price=Number(keptPrice(name,productPrice(p,info)))||0;
    picking.push({source:"product",productId:String(p.id),name:name.slice(0,350),price:keptPrice(name,price)});renderPicker();
    quotedOk(name,quotedCount({kind:"product",id:p.id}),info.total,price);
  }
  function quoteLoose(key) {
    const ix=stockIndex(),list=ix.ownerByKey.has(key)?[]:(ix.looseByKey.get(key)||[]);
    if(!list.length){report("inventoryMessage",Error("Ya no hay unidades de ese producto en tu stock."));return;}
    const name=list[0].nombre.trim(),price=Number(keptPrice(name,Number(list.find(u=>Number(u.precio_sugerido)>0)?.precio_sugerido)||0))||0;
    picking.push({source:"loose",key,name:name.slice(0,350),price:keptPrice(name,price)});renderPicker();
    quotedOk(name,quotedCount({kind:"loose",key}),list.length,price);
  }
  for(const id of ["inventoryUnits","inventoryCatalogue"])$(id).addEventListener("click",e=>{
    const product=e.target.closest("[data-sell-product]");if(product){if(quoting)quoteProduct(product.dataset.sellProduct);else sellCatalogueProduct(product,product.dataset.sellProduct);return;}
    const loose=e.target.closest("[data-sell-loose]");if(loose){if(quoting)quoteLoose(loose.dataset.sellLoose);else sellLoose(loose.dataset.sellLoose);return;}
    if(e.target.closest("[data-use-other]")){const name=$("inventorySearch").value.trim();openExternal(name,`«${name}» está listo abajo: escribe el precio ${quoting?"":"de venta "}y pulsa «${quoting?"Agregar a esta cotización":"Agregar a esta venta"}».`);}
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
      if(!name)throw Error("Indica el nombre del producto.");if(!$("externalPrice").value.trim())throw Error(quoting?"Indica el precio al que lo cotizas.":"Indica el precio al que lo vendes.");
      // En la cotización lo que no está en tu stock es solo nombre y precio (a pedido); al convertirla se vende sin stock.
      const part=quoting?{source:"external",name:name.slice(0,350),price:(core.cents($("externalPrice").value)/100).toFixed(2)}:noStockPart(name,core.cents($("externalPrice").value)/100);if(!quoting)core.validateParts([part]);
      const similar=similarInStock(name,stockIndex());
      if(similar.length&&externalConfirmedName!==nameKey(name)){
        externalConfirmedName=nameKey(name);$("inventorySearch").value=name;renderPicker();
        throw Error(quoting?`Tienes «${similar[0].data.name}» en tu stock. Si es ese, pulsa su «Agregar» en «Mi stock» (arriba) para cotizarlo de tu stock. Si de verdad es otro producto, pulsa «Agregar a esta cotización» otra vez.`:`Tienes «${similar[0].data.name}» en tu stock. Si es ese, pulsa su «Agregar» en «Mi stock» (arriba) para que la venta lo descuente. Si de verdad es de otra tienda, pulsa «Agregar a esta venta» otra vez.`);
      }
      externalConfirmedName="";picking.push(part);
      // Al completar una línea de la boleta, mientras falten unidades el apartado sigue listo con el mismo nombre y precio.
      const left=!quoting&&pickGoal&&part.name===pickGoal.name?pickGoal.qty-picking.filter(p=>p.name===pickGoal.name).length:0;
      if(left<1)for(const id of ["externalName","externalPrice"])$(id).value="";
      $("inventoryMessage").classList.remove("success");$("inventoryMessage").textContent=left>0?`«${part.name}» agregado sin stock. ${left===1?"Falta 1":`Faltan ${left}`}: pulsa «Agregar a esta venta» otra vez.`:"";renderPicker();return true;
    }catch(error){report("inventoryMessage",error);$("externalBox").open=true;return false;}
  }
  $("addExternal").addEventListener("click",addExternalPart);
  for(const id of ["externalName","externalPrice"])$(id).addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addExternalPart();}});
  $("inventoryConfirm").addEventListener("click",()=>{
    // Si dejaste escrito un producto de otra tienda (con el apartado abierto) sin pulsar «Agregar a esta venta», se agrega ahora.
    if($("externalBox").open&&["externalName","externalPrice"].some(id=>$(id).value.trim())&&!addExternalPart())return;
    if(quoting){confirmQuote();return;}
    const gone=picking.find(partGone);
    if(gone){report("inventoryMessage",Error(`«${gone.name}» ya no está disponible (se vendió o se retiró). Quítalo de la lista y elige otro.`));return;}
    const free=picking.findIndex(p=>{try{return core.cents(p.price)===0;}catch{return false;}});
    if(free>=0){report("inventoryMessage",Error(`«${picking[free].name}» no tiene precio de venta: escríbelo en «Venta (S/)».`));document.querySelector(`[data-part-price="${free}"]`)?.focus();return;}
    try{core.validateParts(picking);if(picking.length>500)throw Error("Selecciona hasta 500 componentes.");const selected=structuredClone(picking).map(p=>p.source==="external"?{...p,cost:(core.optionalCents(p.cost)/100).toFixed(2)}:p),resolve=pickResolve;pickResolve=null;$("inventoryDialog").close();resolve(selected);}catch(error){report("inventoryMessage",error);}
  });
  // La cotización acepta referencias (producto, nombre de Compras o a pedido): se valida nombre y precio de cada una.
  function confirmQuote() {
    if(!picking.length){report("inventoryMessage",Error("Elige al menos un producto de «Mi stock» o cotiza uno a pedido."));return;}
    if(picking.length>500){report("inventoryMessage",Error("Selecciona hasta 500 productos."));return;}
    const selected=[];
    for(const [i,p] of picking.entries()){
      const name=String(p.name??"").trim().slice(0,350);let price;
      try{price=core.cents(p.price);}catch{price=null;}
      if(!name||!["product","loose","external"].includes(p.source)||p.source==="product"&&!String(p.productId??"")||p.source==="loose"&&!String(p.key??"")){report("inventoryMessage",Error(`El producto ${i+1} no es válido: quítalo y vuelve a agregarlo.`));return;}
      if(!price){report("inventoryMessage",Error(price===0?`«${name}» no tiene precio: escríbelo en «Precio (S/)».`:`«${name}»: escribe un precio válido, sin separadores de miles y con hasta dos decimales.`));document.querySelector(`[data-part-price="${i}"]`)?.focus();return;}
      selected.push(p.source==="product"?{source:"product",productId:String(p.productId),name,price:(price/100).toFixed(2)}:p.source==="loose"?{source:"loose",key:String(p.key),name,price:(price/100).toFixed(2)}:{source:"external",...(String(p.productId??"")?{productId:String(p.productId)}:{}),name,price:(price/100).toFixed(2)});
    }
    const resolve=pickResolve;pickResolve=null;$("inventoryDialog").close();resolve(structuredClone(selected));
  }
  $("inventoryDialog").addEventListener("close",()=>{if(pickResolve){const resolve=pickResolve;pickResolve=null;resolve(null);}});
  document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>$(b.dataset.close).close()));
  // ---------- Convertir una cotización en boleta: cada producto cotizado toma una unidad real de tu stock ----------
  // Las unidades se eligen con available() y las ya tomadas en esta conversión; no dependen de la selección abierta (picking/blockedIds).
  let preparingQuote=false;
  const shortText=text=>text.length>60?text.slice(0,57).trimEnd()+"…":text;
  // Avisos que se completan en la boleta antes de emitir. «service» solo informa: se vende sin stock, como «Venderlo igual».
  const BLOCKING_NOTICES=new Set(["missing","manual","removed","instock"]);
  async function prepareQuoteSale(items) {
    if(!Array.isArray(items)||!items.length)throw Error("La cotización no tiene productos.");
    if(pickResolve)throw Error("Cierra la selección de productos que está abierta e inténtalo otra vez.");
    if(preparingQuote)throw Error("Ya se está revisando tu stock. Espera un momento.");
    preparingQuote=true;const client=db;
    try{
      try{await refreshAfterMutation();}catch{}
      if(!client||client!==db||!catalogReady)throw Error("Actualiza el stock de tu web e inténtalo otra vez.");
      const chosen=new Set(),groups=new Map(),registered=new Set(),out=[],notices=[];let ix=stockIndex(),taken=[],count=0;
      const group=(key,name,before)=>{if(!groups.has(key))groups.set(key,{name,before,linked:0});return groups.get(key);};
      // taken: lo que aparta la línea en curso; una computadora incompleta lo devuelve para que otra línea pueda usarlo.
      const take=(list,g)=>{const u=list.find(u=>available(u)&&!chosen.has(String(u.id)));if(u){chosen.add(String(u.id));g.linked++;taken.push({id:String(u.id),g});}return u;};
      const release=()=>{for(const t of taken){chosen.delete(t.id);t.g.linked--;}taken=[];};
      async function fromProduct(id,price) {
        let p=products.find(x=>String(x.id)===String(id));if(!p)return {removed:true};
        if(!registered.has(String(p.id))){
          registered.add(String(p.id));
          // Igual que «Agregar» en la boleta: vincula lo de Compras con su nombre y registra la cantidad del catálogo anterior.
          if(await registerStock(p,productStock(p,ix))){
            await refreshAfterMutation();if(client!==db)throw Error("Tu sesión cambió. Vuelve a intentarlo.");
            ix=stockIndex();$("accountingFrame").contentWindow?.refreshFromSuite?.();p=products.find(x=>String(x.id)===String(id))||p;
          }
        }
        const now=productStock(p,ix),unit=take(now.linked,group("p:"+p.id,p.data.name,now.linked.length));
        return unit?{part:{source:"stock",id:unit.id,name:p.data.name.slice(0,350),serial:unit.serial||"",price}}:{};
      }
      function fromLoose(key,price) {
        const owner=ix.ownerByKey.get(key);if(owner)return fromProduct(owner.id,price);
        const list=ix.ownerByKey.has(key)?[]:(ix.looseByKey.get(key)||[]);if(!list.length)return {};
        const name=String(list[0].nombre||"").trim(),unit=take(list,group("l:"+key,name,list.length));
        return unit?{part:{source:"stock",id:unit.id,name:name.slice(0,350),serial:unit.serial||"",price}}:{};
      }
      // ¿Se parece a algo que tienes libre? Mismas reglas que el aviso del buscador, también con lo de Compras sin ficha.
      const freeIn=p=>{const info=productStock(p,ix);return info.extra>0||[...info.linked,...info.loose].some(u=>available(u)&&!chosen.has(String(u.id)));};
      function resembles(name) {
        const tokens=searchTokens(name),models=modelTokens(tokens);if(!tokens.length)return "";
        const hit=text=>matchesTokens(text,tokens)||models.length>0&&matchesTokens(text,models);
        const p=products.find(p=>hit(productText(p))&&freeIn(p));if(p)return p.data.name;
        const loose=[...ix.looseByKey].find(([key,list])=>!ix.ownerByKey.has(key)&&hit(list[0].nombre)&&list.some(u=>available(u)&&!chosen.has(String(u.id))));
        return loose?String(loose[1][0].nombre).trim():"";
      }
      // Lo cotizado «a pedido» que ya repusiste (el mismo producto de tu web o el mismo nombre) sale de tu stock para que baje;
      // si no queda, se vende sin stock y, si se parece a otro producto que tienes, se avisa.
      async function fromExternal(ref,price) {
        const name=String(ref.name).trim(),owner=externalOwner({...ref,name},ix);
        if(owner?.product&&productStock(owner.product,ix).total>0){const r=await fromProduct(owner.product.id,price);if(r.part)return r;}
        else if(owner?.key){const r=fromLoose(owner.key,price);if(r.part)return r;}
        return {part:noStockPart(name,price),similar:resembles(name)};
      }
      const resolvePart=(part,price)=>part.source==="product"?fromProduct(part.productId,price):part.source==="loose"?fromLoose(String(part.key??""),price):fromExternal(part,price);
      const partPrice=part=>{try{return (core.cents(part.price)/100).toFixed(2);}catch{return "0.00";}};
      for(const item of items){
        const parts=(Array.isArray(item?.parts)?item.parts:[]).filter(p=>p&&["product","loose","external"].includes(p.source)&&String(p.name??"").trim());
        const qtyText=String(item?.quantity??"").trim(),qty=/^\d{1,4}$/.test(qtyText)&&Number(qtyText)>0?Number(qtyText):Math.max(1,parts.length);
        let cents=null;try{cents=core.cents(item?.price);}catch{}
        const line={description:String(item?.description??"").replace(/\s+/g," ").trim().slice(0,350),serial:"",code:String(item?.code??"").trim().slice(0,22),unit:String(item?.unit??"").trim().slice(0,5)||"NIU",quantity:String(qty),price:cents===null?String(item?.price??"").trim().slice(0,12):(cents/100).toFixed(2)};
        if(!parts.length){
          // Escrito a mano. Si no se parece a nada que tengas ni a un producto de tu web (un servicio como «Armado y configuración»),
          // se vende sin stock como «Venderlo igual»: una unidad por cantidad. Si se parece, se elige en la boleta.
          const desc=line.description,n=out.length+1,like=searchTokens(desc).length?resembles(desc)||searchProducts(products,desc)[0]?.data.name||"":"";
          if(desc&&!like&&cents!==null&&count+qty<=500){
            out.push({...line,inventory:core.repriceParts(Array.from({length:qty},()=>noStockPart(desc,cents/100)),cents*qty),inventoryMode:"units"});count+=qty;
            notices.push({kind:"service",line:n,name:desc,quoted:qty,linked:0,text:`Producto ${n} («${shortText(desc)}») se venderá sin stock: no cambia tu stock.`});continue;
          }
          out.push({...line,inventory:[],inventoryMode:"units"});
          notices.push({kind:"manual",line:n,name:desc,quoted:qty,linked:0,text:like
            ?`Producto ${n} («${shortText(desc)}») se escribió a mano y se parece a «${shortText(like)}»: en la boleta pulsa «Seleccionar productos para esta venta» y elígelo. Si es otro producto, agrégalo ahí en «¿No está en tu stock?».`
            :`Producto ${n} («${shortText(desc||"sin descripción")}») se escribió a mano: en la boleta pulsa «Seleccionar productos para esta venta» y elige lo que entregas.`});continue;
        }
        // Mismo producto en todas las unidades: una unidad por cantidad. Productos distintos: una computadora por línea.
        const bundle=item.mode==="bundle"||parts.some(p=>p.name!==parts[0].name);
        for(let copy=0;copy<(bundle?qty:1);copy++){
          const refs=bundle?parts:Array.from({length:qty},(_,k)=>parts[Math.min(k,parts.length-1)]),resolved=[],stats=new Map();taken=[];
          for(const ref of refs){
            const result=await resolvePart(ref,bundle||cents===null?partPrice(ref):line.price),name=String(ref.name).trim();
            if(!stats.has(name))stats.set(name,{quoted:0,linked:0,stock:0,removed:false,similar:""});
            const s=stats.get(name);s.quoted++;
            if(result.part){resolved.push(result.part);s.linked++;if(result.part.source==="stock")s.stock++;if(result.similar)s.similar=result.similar;}else if(result.removed)s.removed=true;
          }
          const total=cents===null?null:cents*(bundle?1:qty),complete=resolved.length===refs.length,n=out.length+1;
          // Una computadora incompleta se vuelve a armar en la boleta: no aparta ninguno de sus componentes.
          if(bundle&&!complete)release();
          taken=[];
          const inventory=complete&&total!==null?core.repriceParts(resolved,total):bundle&&!complete?[]:resolved;count+=inventory.length;
          out.push({...line,quantity:bundle?"1":String(qty),inventory,inventoryMode:bundle?"bundle":"units"});
          const missing=[...stats].filter(([,s])=>s.linked<s.quoted);
          if(bundle&&missing.length){
            const names=missing.map(([name])=>`«${shortText(name)}»`).join(", "),gone=missing.some(([,s])=>s.removed);
            notices.push({kind:missing.every(([,s])=>s.removed)?"removed":"missing",line:n,name:missing.map(([name])=>name).join(", "),quoted:refs.length,linked:resolved.length,
              text:`Producto ${n} (computadora): ${missing.length===1?"falta":"faltan"} ${names} en tu stock${gone?" o en tu web":""}. En la boleta pulsa «Seleccionar productos para esta venta» en el producto ${n} y vuelve a armarla: ninguno de sus componentes quedó apartado. Lo que no tengas, agrégalo en «¿No está en tu stock?» (se vende sin descontar stock).`});
          }
          else for(const [name,s] of missing)notices.push(s.removed
            ?{kind:"removed",line:n,name,quoted:s.quoted,linked:s.linked,text:`«${name}» ya no está en tu web. En la boleta pulsa «Seleccionar productos para esta venta» en el producto ${n} y elige otro, o agrégalo en «¿No está en tu stock?» (se vende sin descontar stock).`}
            :{kind:"missing",line:n,name,quoted:s.quoted,linked:s.linked,text:s.linked
              ?`${name}: cotizaste ${s.quoted} y tienes ${s.linked} en stock. En la boleta, producto ${n}: baja la cantidad a ${s.linked} o agrega ${s.quoted-s.linked===1?"la que falta":"las que faltan"} en «¿No está en tu stock?» (se venden sin descontar stock).`
              :`${name}: cotizaste ${s.quoted} y tienes 0 en stock. En la boleta, producto ${n}: pulsa «Seleccionar productos para esta venta» y agrégalo en «¿No está en tu stock?» (se vende sin descontar stock), o quita ese producto.`});
          for(const [name,s] of stats)if(s.similar)notices.push({kind:"instock",line:n,name,quoted:s.quoted,linked:s.stock,
            text:`Producto ${n}: «${shortText(name)}» se cotizó a pedido y tienes «${shortText(s.similar)}» en stock. Si es el mismo, en la boleta pulsa «Seleccionar productos para esta venta» y elígelo en «Mi stock» para que tu stock baje; si es otro, emítela así (se vende sin descontar stock).`});
        }
      }
      if(client!==db)throw Error("Tu sesión cambió. Vuelve a intentarlo.");
      if(out.length>100)throw Error("La boleta tendría más de 100 productos: divide la cotización en dos.");
      if(count>500)throw Error("La boleta tendría más de 500 unidades: divide la cotización en dos.");
      return {items:out,ready:!notices.some(n=>BLOCKING_NOTICES.has(n.kind)),notices,changes:[...groups.values()].filter(g=>g.linked>0).map(g=>({name:g.name,before:g.before,after:Math.max(0,g.before-g.linked)}))};
    }finally{preparingQuote=false;}
  }
  // Para las etiquetas del editor de cotizaciones: cuánto se cotiza y cuánto tienes de cada producto (sin consultar la base).
  function quoteStock(parts) {
    const ix=catalogReady?stockIndex():null,groups=new Map();
    for(const part of Array.isArray(parts)?parts:[]){
      if(!part||typeof part!=="object")continue;
      const source=["product","loose"].includes(part.source)?part.source:"external",name=String(part.name??"").trim();
      const key=source==="product"?"product:"+part.productId:source==="loose"?"loose:"+part.key:"external:"+nameKey(name);
      // Lo cotizado a pedido que ya repusiste cuenta con su stock (al convertirla se toma de tu stock).
      if(!groups.has(key))groups.set(key,{name,source,quoted:0,inStock:!ix?null:source==="external"?externalStock({...part,name},ix):quotedStock(part,ix)});
      groups.get(key).quoted++;
    }
    return [...groups.values()];
  }
  window.AOSuite={initialize,refresh,refreshAfterMutation,navigate,logout,pickInventory,openStockGroup,prepareQuoteSale,quoteStock,stockStatus:()=>({ready:catalogReady,error:catalogError}),
    // Clientes para sugerir en la cotización: ordenados por nombre y sin repetir el mismo cliente.
    clientsList:()=>{const seen=new Set();return clients.filter(c=>c&&String(c.name||"").trim()).map(c=>({name:String(c.name).trim(),docType:["DNI","RUC","CE","PAS","NONE"].includes(c.doc_type)?c.doc_type:"NONE",document:c.document||"",email:c.email||"",address:c.address||""})).filter(c=>{const key=nameKey(c.name)+"|"+c.docType+"|"+c.document;if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>a.name.localeCompare(b.name,"es"));},
    prepareInventoryProduct:async id=>{await refreshAfterMutation();const p=products.find(p=>String(p.id)===String(id));if(!p||!catalogReady||stock(p)<1)throw Error('Este producto ya no tiene stock disponible en tu web.');if(await registerStock(p,productStock(p,stockIndex())))await refreshAfterMutation();},
    stockProducts:()=>catalogReady?[...publicCatalog.values()].map(row=>{const p=products.find(p=>String(p.id)===String(row.id));return {id:row.id,name:row.name,stock:row.stock,managed:p?.managed===true,webPrice:row.price};}):[]};
})();
