 /* =========================================================
   AO NEXUS — Lógica del sitio
   ========================================================= */

const WA_NUMBER = '51936177329';

/* ---------- Categorías (definidas en categorias.js) ---------- */
const categoryLabels = Object.fromEntries(Object.entries(CATEGORIAS).map(([k, c]) => [k, c.label]));

/* Grupos de la barra superior, en el orden de GRUPOS */
const groups = Object.fromEntries(Object.entries(GRUPOS).map(([g, info]) => [g, {
  label: info.label,
  cats: Object.keys(CATEGORIAS).filter(c => CATEGORIAS[c].grupo === g)
}]));

/* Los grupos con varias categorías se muestran divididos en secciones */
const subGroups = Object.fromEntries(Object.entries(groups)
  .filter(([, g]) => g.cats.length > 1)
  .map(([k, g]) => [k, g.cats.map(c => ({ label: CATEGORIAS[c].seccion || CATEGORIAS[c].label, cats: [c] }))]));

/* ---------- Catálogo: stock y precios compartidos con AO Nexus Central ----------
   Los productos se editan desde Mi web en AO Nexus Central.
   Solo se muestran los que tienen unidades en stock. */
let products = [];

const AO_CATALOG_SOURCE = Object.freeze({"url": "https://vundymszmdbkhuliglwz.supabase.co", "key": "sb_publishable_4cIHkmrCiUDRGVEaEGrhdw_vFe3xdrg"});
let loadingCatalogue = null;
async function loadCatalog(){
  if(loadingCatalogue)return loadingCatalogue;
  loadingCatalogue=(async()=>{
    const response=await fetch(AO_CATALOG_SOURCE.url+'/rest/v1/rpc/ao_catalog_snapshot',{
      method:'POST',headers:{'Content-Type':'application/json',apikey:AO_CATALOG_SOURCE.key},
      body:'{}',cache:'no-store',signal:AbortSignal.timeout(12000)
    });
    if(!response.ok)throw new Error('No se pudo consultar el catálogo actualizado.');
    const data=await response.json();
    if(!data||!Array.isArray(data.productos))throw new Error('Respuesta de catálogo inválida.');
    products=data.productos.filter(p=>CATEGORIAS[p.category]&&enStock(p));
    for(const [id,qty] of cart){const p=products.find(p=>p.id===id);if(!p)cart.delete(id);else if(qty>p.stock)cart.set(id,p.stock);}
  })().finally(()=>{loadingCatalogue=null;});
  return loadingCatalogue;
}
async function refreshCatalogue(){
  if(document.hidden)return;
  try{
    await loadCatalog();buildNav();
    if(currentGroup||searchTerm)renderCatalog();else renderHome();
    if(currentProduct&&!products.some(p=>p.id===currentProduct.id))closeModal();
    updateCart();
  }catch(error){console.warn('El catálogo no pudo actualizarse.',error);}
}

/* ---------- Estado ---------- */
let currentProduct = null;
let currentGroup   = null;
let currentSort    = 'default';
let searchTerm     = '';
const cart         = new Map();   // id -> qty
const favorites    = new Set();

const WA_BASE = `https://wa.me/${WA_NUMBER}?text=`;

/* =========================================================
   UTILIDADES
   ========================================================= */
const money = n => 'S/ ' + Number(n).toLocaleString('es-PE');
const esc = t => String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const byId = id => products.find(x => x.id === id);
const groupOf = cat => Object.keys(groups).find(g => groups[g].cats.includes(cat));
const iconOf = cat => (GRUPOS[(CATEGORIAS[cat] || {}).grupo] || {}).icon || 'fa-microchip';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function stockInfo(stock){
  if(stock === 0) return { cls:'no', text:'Sin stock' };
  return { cls:'ok', text:'En stock' };
}

function toast(msg){
  let t = document.querySelector('.toast');
  if(!t){
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.innerHTML = `<i class="fas fa-circle-check"></i> ${msg}`;
  requestAnimationFrame(()=> t.classList.add('show'));
  clearTimeout(t._tm);
  t._tm = setTimeout(()=> t.classList.remove('show'), 2400);
}

function scrollTop(){ window.scrollTo({top:0, behavior:'smooth'}); }
function focusSearch(){ document.getElementById('searchInput').focus(); }
function toggleNav(){ document.getElementById('catNav').classList.toggle('open'); }
function toggleTerms(){
  const box = document.getElementById('termsBox');
  box.hidden = !box.hidden;
  if(!box.hidden) box.scrollIntoView({behavior:'smooth', block:'center'});
}

/* Si una foto no existe (o no carga) se muestra la tarjeta de marca */
function imgFallback(img){
  img.onerror = null;
  if(img.parentElement) img.parentElement.classList.add('noimg');
}

/* Tarjeta de marca para productos que aún no tienen foto */
function placeholderHtml(p){
  return `<div class="ph">
      <i class="fas ${iconOf(p.category)}"></i>
      <span class="ph-brand">${esc(p.brand || 'AO NEXUS')}</span>
      <small>Nuevo y sellado</small>
    </div>`;
}

/* Reparte una lista para que no salgan varios productos seguidos de la misma categoría */
function diversify(list){
  const buckets = Object.keys(groups).map(g =>
    list.filter(p => groupOf(p.category) === g).sort((a,b)=> b.price - a.price));
  const out = [];
  while(buckets.some(b => b.length)) buckets.forEach(b => { if(b.length) out.push(b.shift()); });
  return out;
}

/* =========================================================
   TARJETAS
   ========================================================= */
function productCard(p){
  const s = stockInfo(p.stock);
  const cat = categoryLabels[p.category] || '';
  const hasSale = p.oldPrice && p.oldPrice > p.price;
  const off = hasSale ? Math.round((1 - p.price / p.oldPrice) * 100) : 0;
  const badge = hasSale ? `<span class="p-badge">-${off}%</span>` : '';

  return `
  <article class="p-card">
    <div class="p-media" onclick="openModal(${p.id})">
      ${badge}
      <button class="p-fav ${favorites.has(p.id)?'on':''}" onclick="event.stopPropagation();toggleFav(${p.id},this)" title="Guardar" aria-label="Guardar en favoritos">
        <i class="fa${favorites.has(p.id)?'s':'r'} fa-heart"></i>
      </button>
      ${placeholderHtml(p)}
      <img src="${esc(p.image || '')}" alt="${esc(p.name)}" loading="lazy" onerror="imgFallback(this)">
    </div>
    <div class="p-body">
      <span class="p-cat">${cat}</span>
      <h4 class="p-name" onclick="openModal(${p.id})">${esc(p.name)}</h4>
      <p class="p-spec">${esc(p.sub || '')}</p>
      <div class="p-meta">
        <div class="p-prices">
          <span class="p-price ${hasSale?'sale':''}">${money(p.price)}</span>
          ${hasSale ? `<span class="p-old">${money(p.oldPrice)}</span>` : ''}
        </div>
        <div class="p-stock ${s.cls}"><span class="dot"></span>${s.text}</div>
      </div>
      <div class="p-actions">
        <button class="p-btn" onclick="addToCart(${p.id})"><i class="fas fa-cart-plus"></i> AGREGAR</button>
        <button class="p-wa" onclick="askWhatsApp(${p.id})" title="Consultar por WhatsApp" aria-label="Consultar por WhatsApp"><i class="fab fa-whatsapp"></i></button>
      </div>
    </div>
  </article>`;
}

function toggleFav(id, el){
  if(favorites.has(id)){ favorites.delete(id); el.classList.remove('on'); el.innerHTML = '<i class="far fa-heart"></i>'; }
  else { favorites.add(id); el.classList.add('on'); el.innerHTML = '<i class="fas fa-heart"></i>'; toast('Guardado en favoritos'); }
}

const CAT_ORDER = Object.keys(CATEGORIAS);
const catRank = p => CAT_ORDER.indexOf(p.category);

function sortList(list, mode){
  const out = [...list];
  if(mode === 'price-asc')  out.sort((a,b)=> a.price - b.price);
  else if(mode === 'price-desc') out.sort((a,b)=> b.price - a.price);
  else if(mode === 'name-asc')   out.sort((a,b)=> a.name.localeCompare(b.name));
  else out.sort((a,b)=> catRank(a) - catRank(b) || b.price - a.price);   // relevancia: categoría y luego precio
  return out;
}

/* =========================================================
   HOME
   ========================================================= */
function renderHome(){
  // Cada producto aparece una sola vez en el inicio
  const shown = new Set();
  const pick = (test, n) => {
    const list = diversify(products.filter(p => test(p) && !shown.has(p.id))).slice(0, n);
    list.forEach(p => shown.add(p.id));
    return list;
  };

  const fill = (gridId, sectionId, list) => {
    document.getElementById(gridId).innerHTML = list.map(productCard).join('');
    document.getElementById(sectionId).hidden = list.length === 0;
  };
  fill('featuredGrid',    'featuredSection',    pick(p => p.featured,  5));
  fill('bestsellersGrid', 'bestsellersSection', pick(p => p.best,      5));

  // Categorías: una tarjeta por grupo con productos, con la foto de su producto más destacado
  document.getElementById('categoryGrid').innerHTML = activeGroups().map(g => {
    const items = products.filter(p => groups[g].cats.includes(p.category))
      .sort((a,b)=> (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.price - a.price);
    return `
    <div class="c-card" onclick="filterByGroup('${g}')">
      <div class="c-ph"><i class="fas ${GRUPOS[g].icon}"></i></div>
      <img src="${esc(items[0].image || '')}" alt="${esc(groups[g].label)}" loading="lazy" onerror="imgFallback(this)">
      <div class="c-label">
        <div><b>${esc(groups[g].label)}</b><small>${plural(items.length, 'producto', 'productos')}</small></div>
        <i class="fas fa-arrow-right"></i>
      </div>
    </div>`;
  }).join('');

  const brands = {};
  products.forEach(p => { if(p.brand) brands[p.brand] = (brands[p.brand] || 0) + 1; });
  document.getElementById('brandRow').innerHTML = Object.entries(brands)
    .sort((a,b)=> b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([b,n]) => `<button class="brand-chip" data-brand="${esc(b)}">${esc(b)}<small>${n}</small></button>`)
    .join('');

}

/* Grupos que tienen al menos un producto en stock (en el orden del menú) */
function activeGroups(){
  return Object.keys(groups).filter(g => products.some(p => groups[g].cats.includes(p.category)));
}

/* Menú de categorías: Inicio + grupos con productos + Ver todo */
function buildNav(){
  const all = document.querySelector('#catNav .cat-all');
  document.querySelectorAll('#catNav .cat-link[data-group]').forEach(l => l.remove());
  activeGroups().forEach(g => {
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'cat-link';
    a.dataset.group = g;
    a.innerHTML = `<i class="fas ${GRUPOS[g].icon}"></i><span>${esc(GRUPOS[g].menu)}</span>`;
    a.addEventListener('click', e => { e.preventDefault(); filterByGroup(g); });
    all.before(a);
  });
}

const homeSections = ['heroSection','featuredSection','categoriesSection',
                      'bestsellersSection','brandsSection','orderSection','helpCtaSection'];

function showHomeSections(show){
  homeSections.forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.style.display = show ? '' : 'none';
  });
  const bm = document.querySelector('.benefits-mobile');
  if(bm) bm.style.display = show ? '' : 'none';
  document.getElementById('productsSection').style.display = show ? 'none' : 'block';
}

function setActiveLink(match){
  document.querySelectorAll('.cat-link').forEach(l => l.classList.toggle('active', l === match));
}

function goHome(){
  currentGroup = null;
  searchTerm = '';
  currentSort = 'default';
  const si = document.getElementById('searchInput');
  if(si) si.value = '';
  setActiveLink(document.querySelector('.cat-link'));
  document.getElementById('catNav').classList.remove('open');
  showHomeSections(true);
  scrollTop();
}

/* =========================================================
   CATÁLOGO
   ========================================================= */
function filterByGroup(group){
  currentGroup = group;
  searchTerm = '';
  const si = document.getElementById('searchInput');
  if(si) si.value = '';

  setActiveLink(document.querySelector(`.cat-link[data-group="${group}"]`));

  document.getElementById('catNav').classList.remove('open');
  document.getElementById('catalogTitle').innerHTML =
    `Categoría <span>${groups[group] ? groups[group].label : ''}</span>`;

  showHomeSections(false);
  renderCatalog();
  window.scrollTo({top:0, behavior:'smooth'});
}

function showAllProducts(){
  currentGroup = null;
  searchTerm = '';
  const si = document.getElementById('searchInput');
  if(si) si.value = '';
  setActiveLink(null);
  document.getElementById('catNav').classList.remove('open');
  document.getElementById('catalogTitle').innerHTML = 'Todos los <span>Productos</span>';
  showHomeSections(false);
  renderCatalog();
  window.scrollTo({top:0, behavior:'smooth'});
}

function searchBrand(brand){
  const si = document.getElementById('searchInput');
  if(si) si.value = brand;
  onSearch(brand);
  window.scrollTo({top:0, behavior:'smooth'});
}

function getFilteredList(){
  let list = products;

  if(searchTerm){
    const t = searchTerm.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(t) ||
      (p.brand||'').toLowerCase().includes(t) ||
      (p.sub||'').toLowerCase().includes(t) ||
      (categoryLabels[p.category]||'').toLowerCase().includes(t) ||
      Object.values(p.specs || {}).join(' ').toLowerCase().includes(t)
    );
  } else if(currentGroup && groups[currentGroup]){
    list = list.filter(p => groups[currentGroup].cats.includes(p.category));
  }

  return sortList(list, currentSort);
}

function filtersBarHtml(count){
  return `
    <div class="filters-bar">
      <span class="results-info"><strong>${count}</strong> producto(s)${searchTerm?` para "<strong>${esc(searchTerm)}</strong>"`:''}</span>
      <select class="sort-select" onchange="onSortChange(this)">
        <option value="default"    ${currentSort==='default'?'selected':''}>Ordenar por: Relevancia</option>
        <option value="price-asc"  ${currentSort==='price-asc'?'selected':''}>Precio: menor a mayor</option>
        <option value="price-desc" ${currentSort==='price-desc'?'selected':''}>Precio: mayor a menor</option>
        <option value="name-asc"   ${currentSort==='name-asc'?'selected':''}>Nombre: A – Z</option>
      </select>
    </div>`;
}

function emptyStateHtml(){
  const msg = `Hola AO NEXUS, estoy buscando ${searchTerm ? `"${searchTerm}"` : 'un componente'} ¿lo pueden conseguir?`;
  return `
    <div class="empty-state">
      <i class="fas fa-box-open"></i>
      <p>No lo tenemos en stock ahora mismo</p>
      <small>Pero lo podemos conseguir por pedido. Escríbenos y te cotizamos.</small>
      <a class="btn-wa" href="${WA_BASE}${encodeURIComponent(msg)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> Pedir por WhatsApp</a>
    </div>`;
}

function sectionsHtml(sections){
  return sections.map(s => `
    <h3 class="subcat-title">${s.label}<small>${plural(s.items.length, 'producto', 'productos')}</small></h3>
    <div class="p-grid">${s.items.map(productCard).join('')}</div>
  `).join('');
}

function renderCatalog(){
  const box = document.getElementById('productsContainer');

  // ---- Secciones: subcategorías de un grupo, o todos los grupos en "Todos los productos" ----
  let defs = null;
  if(!searchTerm && currentGroup && subGroups[currentGroup]) defs = subGroups[currentGroup];
  else if(!searchTerm && !currentGroup) defs = Object.values(groups);

  if(defs){
    const sections = defs.map(s => {
      const items = products.filter(p => s.cats.includes(p.category));
      return { label: s.label, items: sortList(items, currentSort) };
    }).filter(s => s.items.length > 0);

    const total = sections.reduce((a, s) => a + s.items.length, 0);
    box.innerHTML = filtersBarHtml(total) + (sections.length ? sectionsHtml(sections) : emptyStateHtml());
    return;
  }

  // ---- Vista plana (búsqueda y grupos sin subcategorías) ----
  const list = getFilteredList();
  box.innerHTML = filtersBarHtml(list.length) +
    (list.length ? `<div class="p-grid">${list.map(productCard).join('')}</div>` : emptyStateHtml());
}

function onSortChange(sel){ currentSort = sel.value; renderCatalog(); }

/* =========================================================
   BÚSQUEDA
   ========================================================= */
function onSearch(value){
  searchTerm = value.trim();
  if(!searchTerm){
    if(currentGroup) { renderCatalog(); }
    else { goHome(); }
    return;
  }
  currentGroup = null;
  setActiveLink(null);
  document.getElementById('catalogTitle').innerHTML = 'Resultados de <span>Búsqueda</span>';
  showHomeSections(false);
  renderCatalog();
}

/* =========================================================
   MODAL DE PRODUCTO
   ========================================================= */
function openModal(id){
  const p = byId(id);
  if(!p) return;
  currentProduct = p;

  const s = stockInfo(p.stock);
  const media = document.querySelector('.modal-media');
  media.classList.remove('noimg');
  document.getElementById('modalPh').outerHTML = placeholderHtml(p).replace('class="ph"', 'class="ph" id="modalPh"');
  const img = document.getElementById('modalImage');
  img.onerror = function(){ imgFallback(this); };
  img.src = p.image || '';
  img.alt = p.name;
  document.getElementById('modalCat').textContent  = categoryLabels[p.category] || '';
  document.getElementById('modalName').textContent = p.name;
  document.getElementById('modalStock').innerHTML  = `<span class="p-stock ${s.cls}"><span class="dot"></span>${s.text}</span>`;
  document.getElementById('modalPrice').textContent = money(p.price);
  document.getElementById('modalSpecs').innerHTML = Object.entries(p.specs || {})
    .map(([k,v]) => `<div class="spec-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');

  document.getElementById('productModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(){
  document.getElementById('productModal').classList.remove('open');
  document.body.style.overflow = '';
}

function productMessage(p){
  return `Hola AO NEXUS, me interesa el *${p.name}* (${money(p.price)}) que vi en su web. ¿Está disponible?`;
}

function askWhatsApp(id){
  const p = byId(id);
  if(p) window.open(WA_BASE + encodeURIComponent(productMessage(p)), '_blank');
}

function contactWhatsApp(){
  if(currentProduct) askWhatsApp(currentProduct.id);
}

/* =========================================================
   COTIZACIÓN (carrito)
   ========================================================= */
function addToCartFromModal(){
  if(currentProduct) addToCart(currentProduct.id);
}

function addToCart(id){
  const p = byId(id);
  if(!p) return;
  if(p.stock === 0){ toast('Producto sin stock — consulta por WhatsApp'); return; }
  const qty = cart.get(id) || 0;
  if(qty >= p.stock){ toast(`Solo hay ${plural(p.stock, 'unidad disponible', 'unidades disponibles')}`); return; }
  cart.set(id, qty + 1);
  updateCart();
  toast('Agregado a tu cotización');
  const btn = document.querySelector('.cart-btn');
  if(btn){ btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump'); }
}

function changeQty(id, delta){
  const p = byId(id);
  const qty = (cart.get(id) || 0) + delta;
  if(qty <= 0){ cart.delete(id); }
  else if(p && qty > p.stock){ toast(`Solo hay ${plural(p.stock, 'unidad', 'unidades')}`); return; }
  else cart.set(id, qty);
  updateCart();
}

function removeFromCart(id){ cart.delete(id); updateCart(); }
function clearCart(){ cart.clear(); updateCart(); }

function updateCart(){
  const items = [...cart.entries()].map(([id,qty]) => ({ p: byId(id), qty })).filter(x=>x.p);
  const count = items.reduce((a,i)=> a + i.qty, 0);
  const total = items.reduce((a,i)=> a + i.p.price * i.qty, 0);

  document.getElementById('cartCount').textContent = count;
  document.getElementById('cartTotal').textContent = money(total);

  const box = document.getElementById('cartItems');
  if(items.length === 0){
    box.innerHTML = `<div class="cart-empty"><i class="fas fa-cart-shopping"></i>Tu cotización está vacía.<br>Agrega productos para enviarlos por WhatsApp.</div>`;
  } else {
    box.innerHTML = items.map(({p,qty}) => `
      <div class="cart-item">
        <div class="ci-media"><i class="fas ${iconOf(p.category)}"></i><img src="${esc(p.image || '')}" alt="${esc(p.name)}" onerror="imgFallback(this)"></div>
        <div class="ci-info">
          <div class="ci-name">${esc(p.name)}</div>
          <div class="ci-price">${money(p.price * qty)}</div>
          <div class="ci-qty">
            <button onclick="changeQty(${p.id},-1)" aria-label="Quitar uno"><i class="fas fa-minus"></i></button>
            <span>${qty}</span>
            <button onclick="changeQty(${p.id},1)" aria-label="Agregar uno"><i class="fas fa-plus"></i></button>
          </div>
        </div>
        <button class="ci-del" onclick="removeFromCart(${p.id})" aria-label="Eliminar"><i class="fas fa-trash"></i></button>
      </div>`).join('');
  }

  const lines = items.map(({p,qty}) => `• ${qty} x ${p.name} — ${money(p.price*qty)}`).join('\n');
  const msg = items.length
    ? `Hola AO NEXUS, quisiera cotizar:\n\n${lines}\n\n*Total estimado: ${money(total)}*`
    : 'Hola AO NEXUS, quisiera cotizar unos componentes.';
  document.getElementById('cartWaBtn').href = WA_BASE + encodeURIComponent(msg);
}

function openCart(){
  document.getElementById('cartDrawer').classList.add('open');
  document.getElementById('cartBackdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeCart(){
  document.getElementById('cartDrawer').classList.remove('open');
  document.getElementById('cartBackdrop').classList.remove('open');
  document.body.style.overflow = '';
}

/* =========================================================
   INIT
   ========================================================= */
function showLoadError(){
  document.getElementById('featuredGrid').innerHTML = `
    <div class="load-error">
      <i class="fas fa-triangle-exclamation"></i>
      <p>No pudimos cargar los productos.</p>
      <button class="link-more" onclick="location.reload()"><i class="fas fa-rotate"></i> Volver a intentar</button>
    </div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  updateCart();
  setInterval(refreshCatalogue,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshCatalogue();});
  window.addEventListener('focus',refreshCatalogue);
  loadCatalog()
    .then(() => { buildNav(); renderHome(); })
    .catch(err => { console.error('No se pudo cargar el catálogo compartido', err); showLoadError(); });

  document.getElementById('brandRow').addEventListener('click', e => {
    const chip = e.target.closest('.brand-chip');
    if(chip) searchBrand(chip.dataset.brand);
  });

  const si = document.getElementById('searchInput');
  if(si){
    let t;
    si.addEventListener('input', e => {
      clearTimeout(t);
      const v = e.target.value;
      t = setTimeout(()=> onSearch(v), 220);
    });
    si.addEventListener('keydown', e => { if(e.key === 'Enter') onSearch(e.target.value); });
  }

  document.addEventListener('keydown', e => {
    if(e.key === 'Escape'){ closeModal(); closeCart(); }
  });

  const toTop = document.getElementById('toTop');
  window.addEventListener('scroll', () => {
    toTop.classList.toggle('show', window.scrollY > 500);
  }, { passive:true });

  setActiveLink(document.querySelector('.cat-link'));
});
