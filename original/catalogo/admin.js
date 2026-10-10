/* =========================================================
   AO NEXUS — Panel de stock (admin.html)
   - "En stock" / "Agotado": muestra u oculta un producto en la web
   - Cambia precios y unidades; agrega, duplica, edita o elimina productos
   - Recorta, achica y guarda las fotos en WebP
   - Publica todo junto en GitHub; la web se actualiza sola en 1-2 minutos
   ========================================================= */

const REPO    = 'AONEXUSpe/AONEXUSpe.github.io';
const RAMA    = 'main';
const ARCHIVO = 'productos.json';
const API     = `https://api.github.com/repos/${REPO}`;
const CLAVE_LLAVE = 'aonexus-panel-llave';

/* ---------- Estado ---------- */
let modo = null;                     // 'github' (publica directo) | 'manual' (descarga el archivo)
let llave = null;                    // llave de acceso de GitHub
let guardado = [];                   // productos tal como están publicados
let productos = [];                  // copia de trabajo con los cambios
let shaArchivo = null;               // versión de productos.json que se cargó
const fotosPendientes = new Map();   // ruta -> { blob, sha }   fotos nuevas por subir
const vistaPrevia = new Map();       // ruta -> url local (para ver fotos que aún no se publican)
const stockPrevio = new Map();       // id -> unidades que tenía antes de marcarlo "Agotado"
let filtro = 'todos';
let busqueda = '';
let dlg = null;                      // producto abierto en el formulario
let publicando = false;

/* =========================================================
   UTILIDADES
   ========================================================= */
const $ = s => document.querySelector(s);
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE');
const pausa = ms => new Promise(r => setTimeout(r, ms));
const clonar = o => JSON.parse(JSON.stringify(o));
const grupoDe = p => (CATEGORIAS[p.category] || {}).grupo;
const iconoDe = p => (GRUPOS[grupoDe(p)] || {}).icon || 'fa-box';
const ORDEN_CAT = Object.keys(CATEGORIAS);

function leer(clave){ try { return localStorage.getItem(clave); } catch(e){ return null; } }
function escribir(clave, valor){
  try { valor == null ? localStorage.removeItem(clave) : localStorage.setItem(clave, valor); } catch(e){}
}

function textoDeBase64(b64){
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
function base64DeBlob(blob){
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => mal(r.error);
    r.readAsDataURL(blob);
  });
}

function avisar(tipo, texto, detalle){
  const icono = { error:'fa-triangle-exclamation', ok:'fa-circle-check', info:'fa-circle-info' }[tipo];
  $('#aviso').innerHTML = texto ? `<div class="aviso ${tipo}"><i class="fas ${icono}"></i><div>${texto}${detalle ? `<small>${esc(detalle)}</small>` : ''}</div></div>` : '';
  if(texto) window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* =========================================================
   GITHUB
   ========================================================= */
async function gh(ruta, opciones = {}){
  let res;
  try {
    res = await fetch(API + ruta, {
      method: opciones.method || 'GET',
      cache: 'no-store',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + llave,
        ...(opciones.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: opciones.body ? JSON.stringify(opciones.body) : undefined
    });
  } catch(e){
    const err = new Error('sin conexión'); err.status = 0; throw err;
  }
  if(!res.ok){
    const cuerpo = await res.json().catch(() => ({}));
    const err = new Error(cuerpo.message || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function textoError(e){
  const m = (e && e.message) || '';
  if(e.status === 0) return 'No hay conexión con GitHub. Revisa tu internet e inténtalo de nuevo.';
  if(e.status === 401) return 'La llave no es válida o ya venció. Crea una nueva en GitHub y vuelve a conectar.';
  if(e.status === 403 && /rate limit/i.test(m)) return 'GitHub está recibiendo demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.';
  if(e.status === 403 || e.status === 404) return 'La llave no tiene permiso para guardar en el repositorio <b>AONEXUSpe.github.io</b>. Revisa que en <b>Resource owner</b> elegiste <b>AONEXUSpe</b>, que seleccionaste el repositorio, que <b>Contents</b> esté en <b>Read and write</b> y que la organización haya aprobado la llave.';
  if(e.status === 409 || e.status === 422) return 'GitHub no aceptó el cambio porque la web se modificó al mismo tiempo. Inténtalo de nuevo.';
  return 'Algo salió mal al hablar con GitHub.';
}

/* =========================================================
   DATOS
   ========================================================= */
const CAMPOS = ['id','name','brand','category','price','oldPrice','stock','featured','best','sub','image','specs'];

/* Deja un producto con el formato de productos.json (campos en orden, sin datos vacíos) */
function limpio(p){
  const o = {
    id: Number(p.id),
    name: String(p.name || '').trim(),
    brand: String(p.brand || '').trim(),
    category: p.category,
    price: Number(p.price) || 0
  };
  if(Number(p.oldPrice) > o.price) o.oldPrice = Number(p.oldPrice);
  o.stock = p.stock == null || p.stock === '' ? 1 : Math.max(0, Math.floor(Number(p.stock) || 0));
  if(p.featured) o.featured = true;
  if(p.best) o.best = true;
  o.sub = String(p.sub || '').trim();
  o.image = String(p.image || '');
  o.specs = {};
  for(const [k, v] of Object.entries(p.specs || {})){
    const kk = String(k).trim(), vv = String(v ?? '').trim();
    if(kk && vv) o.specs[kk] = vv;
  }
  for(const k of Object.keys(p)) if(!CAMPOS.includes(k)) o[k] = p[k];   // datos extra agregados a mano
  return o;
}
const igual = (a, b) => JSON.stringify(limpio(a)) === JSON.stringify(limpio(b));

/* Orden del archivo y de la lista: categoría (como el menú de la web) y luego precio */
function ordenar(lista){
  return [...lista].sort((a, b) => {
    const ca = ORDEN_CAT.indexOf(a.category), cb = ORDEN_CAT.indexOf(b.category);
    return (ca < 0 ? 999 : ca) - (cb < 0 ? 999 : cb) || b.price - a.price || a.name.localeCompare(b.name);
  });
}

async function cargarProductos(){
  let datos;
  if(modo === 'github'){
    const f = await gh(`/contents/${ARCHIVO}?ref=${RAMA}`);
    shaArchivo = f.sha;
    datos = JSON.parse(textoDeBase64(f.content));
  } else {
    const r = await fetch(`${ARCHIVO}?v=${Date.now()}`, { cache: 'no-store' });
    if(!r.ok) throw new Error('No se encontró productos.json (' + r.status + ')');
    datos = await r.json();
  }
  guardado = (datos.productos || []).map(limpio);
  productos = clonar(guardado);
}

/* Fotos nuevas que todavía usa algún producto */
const fotosEnUso = () => [...fotosPendientes].filter(([ruta]) => productos.some(p => p.image === ruta));

/* Lista de cambios en palabras (se muestra en la barra y se guarda en el historial de GitHub) */
function listaCambios(){
  const cambios = [];
  const antes = new Map(guardado.map(p => [p.id, p]));
  for(const p of productos){
    const a = antes.get(p.id);
    if(!a){ cambios.push(`Nuevo: ${p.name}`); continue; }
    const pa = limpio(a), pn = limpio(p);
    if(pa.stock > 0 && pn.stock === 0) cambios.push(`Agotado: ${pn.name}`);
    else if(pa.stock === 0 && pn.stock > 0) cambios.push(`De vuelta en stock: ${pn.name}`);
    else if(pa.stock !== pn.stock) cambios.push(`Unidades de ${pn.name}: ${pa.stock} → ${pn.stock}`);
    if(pa.price !== pn.price) cambios.push(`Precio de ${pn.name}: ${soles(pa.price)} → ${soles(pn.price)}`);
    const fotoNueva = fotosPendientes.has(pn.image);   // el cambio de foto se cuenta aparte
    const resto = o => JSON.stringify({ ...o, stock: 0, price: 0, image: fotoNueva ? '' : o.image });
    if(resto(pa) !== resto(pn)) cambios.push(`Editado: ${pn.name}`);
  }
  for(const a of guardado) if(!productos.some(p => p.id === a.id)) cambios.push(`Eliminado: ${a.name}`);
  for(const [ruta] of fotosEnUso()){
    const p = productos.find(x => x.image === ruta);
    cambios.push(`Foto nueva: ${p.name}`);
  }
  return cambios;
}

/* =========================================================
   LISTA DE PRODUCTOS
   ========================================================= */
function render(){
  const total = productos.length, activos = productos.filter(enStock).length;
  const agotados = total - activos;
  $('#resumen').innerHTML = `<b>${total}</b> productos · <b class="ok">${activos}</b> en stock (se ven en la web) · ` +
    `<b class="off">${agotados}</b> ${agotados === 1 ? 'agotado (oculto)' : 'agotados (ocultos)'}`;
  $('#modoChip').className = 'modo ' + modo;
  $('#modoChip').innerHTML = modo === 'github'
    ? '<i class="fas fa-circle-check"></i> Conectado a GitHub'
    : '<i class="fas fa-download"></i> Sin conectar';

  const q = busqueda.toLowerCase();
  const lista = ordenar(productos).filter(p =>
    (filtro === 'todos' || (filtro === 'stock' ? enStock(p) : !enStock(p))) &&
    (!q || `${p.name} ${p.brand} ${(CATEGORIAS[p.category] || {}).label || ''}`.toLowerCase().includes(q)));

  const grupos = [...Object.keys(GRUPOS), null];   // null = productos con una categoría desconocida
  const html = grupos.map(g => {
    const items = lista.filter(p => g ? grupoDe(p) === g : !grupoDe(p));
    if(!items.length) return '';
    const titulo = g ? `<i class="fas ${GRUPOS[g].icon}"></i> ${GRUPOS[g].label}` : '<i class="fas fa-circle-question"></i> Sin categoría';
    return `<section class="grupo"><h2>${titulo} <small>${items.length}</small></h2>${items.map(fila).join('')}</section>`;
  }).join('');

  $('#lista').innerHTML = html || `<p class="vacio"><i class="fas fa-box-open"></i> No hay productos con ese filtro.</p>`;
  $('#marcas').innerHTML = [...new Set(productos.map(p => p.brand).filter(Boolean))].sort()
    .map(m => `<option value="${esc(m)}">`).join('');
  actualizarBarra();
}

function fila(p){
  const a = guardado.find(x => x.id === p.id);
  const cambiado = !a || !igual(a, p) || fotosPendientes.has(p.image);
  const stock = enStock(p);
  const extras = [
    !a ? '<em>Nuevo</em>' : '',
    p.featured ? '<i class="fas fa-star" title="Destacado en el inicio"></i>' : '',
    p.best ? '<i class="fas fa-fire" title="Más vendido en el inicio"></i>' : ''
  ].filter(Boolean).join(' ');
  return `
  <article class="fila ${stock ? '' : 'agotado'} ${cambiado ? 'cambiado' : ''}" data-id="${p.id}">
    <div class="foto" data-accion="editar" title="Editar">
      <i class="fas ${iconoDe(p)}"></i>
      <img src="${esc(vistaPrevia.get(p.image) || p.image)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('sinfoto')">
      <span class="sinfoto-txt">SIN FOTO</span>
    </div>
    <div class="datos">
      <b title="${esc(p.name)}">${esc(p.name)}</b>
      <span>${esc((CATEGORIAS[p.category] || {}).label || p.category)}${extras ? ' · ' + extras : ''}</span>
    </div>
    <label class="precio">S/ <input class="num" type="number" min="1" step="1" inputmode="numeric" value="${esc(p.price)}" data-campo="price" aria-label="Precio"></label>
    <div class="unidades" title="Unidades en stock">
      <button type="button" data-accion="menos" aria-label="Quitar una unidad"><i class="fas fa-minus"></i></button>
      <input type="number" min="0" step="1" inputmode="numeric" value="${esc(p.stock)}" data-campo="stock" aria-label="Unidades">
      <button type="button" data-accion="mas" aria-label="Agregar una unidad"><i class="fas fa-plus"></i></button>
    </div>
    <button type="button" class="estado ${stock ? 'on' : 'off'}" data-accion="estado" title="${stock ? 'Tocar para marcar como agotado (se oculta en la web)' : 'Tocar para volver a mostrar en la web'}">
      ${stock ? '<i class="fas fa-circle-check"></i> En stock' : '<i class="fas fa-eye-slash"></i> Agotado'}
    </button>
    <button type="button" class="editar" data-accion="editar" title="Editar" aria-label="Editar"><i class="fas fa-pen"></i></button>
  </article>`;
}

function productoDe(el){
  const f = el.closest('.fila');
  return f ? productos.find(p => p.id === Number(f.dataset.id)) : null;
}

function alternarStock(p){
  if(enStock(p)){ stockPrevio.set(p.id, p.stock); p.stock = 0; }
  else p.stock = stockPrevio.get(p.id) || 1;
}

function actualizarBarra(){
  const cambios = listaCambios();
  $('#barra').hidden = cambios.length === 0;
  $('#numCambios').textContent = cambios.length;
  $('#txtCambios').textContent = cambios.length === 1 ? 'cambio sin publicar' : 'cambios sin publicar';
  $('#listaCambios').innerHTML = cambios.map(c => `<li>${esc(c)}</li>`).join('');
  $('#txtPublicar').textContent = publicando ? 'Publicando…' : (modo === 'manual' ? 'Descargar archivos' : 'Publicar cambios');
  $('#btnPublicar').disabled = publicando;
}

/* =========================================================
   FORMULARIO: AGREGAR / EDITAR
   ========================================================= */
function opcionesCategoria(){
  return '<option value="" disabled selected>Elige una categoría…</option>' + Object.entries(GRUPOS).map(([g, info]) => {
    const cats = Object.entries(CATEGORIAS).filter(([, c]) => c.grupo === g);
    return `<optgroup label="${esc(info.label)}">${cats.map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('')}</optgroup>`;
  }).join('');
}

function filaDato(clave, valor, propio){
  return propio
    ? `<div class="spec propio"><input class="k" value="${esc(clave)}" placeholder="Dato (ej: Color)"><input class="v" value="${esc(valor)}" placeholder="Valor"><button type="button" class="quitar" title="Quitar"><i class="fas fa-xmark"></i></button></div>`
    : `<div class="spec" data-k="${esc(clave)}"><span>${esc(clave)}</span><input class="v" value="${esc(valor)}"><span></span></div>`;
}

/* Arma los datos técnicos: primero los típicos de la categoría y luego los propios del producto */
function mostrarDatos(categoria, specs){
  const tipicos = (CATEGORIAS[categoria] || {}).datos || [];
  const html = tipicos.map(k => filaDato(k, specs[k] || '', false)).join('') +
    Object.entries(specs).filter(([k]) => !tipicos.includes(k)).map(([k, v]) => filaDato(k, v, true)).join('');
  $('#specs').innerHTML = html;
  actualizarSubSugerida();
}

function leerDatos(){
  const specs = {};
  document.querySelectorAll('#specs .spec').forEach(r => {
    const k = (r.dataset.k || (r.querySelector('.k') || {}).value || '').trim();
    const v = r.querySelector('.v').value.trim();
    if(k && v) specs[k] = v;
  });
  return specs;
}

/* Descripción corta automática con los datos técnicos */
function subAutomatica(specs){
  return Object.entries(specs).filter(([k]) => !/^(modelo|compatibilidad)$/i.test(k)).map(([, v]) => v).slice(0, 4).join(' · ');
}
function actualizarSubSugerida(){
  $('#fSub').placeholder = subAutomatica(leerDatos()) || 'Ej: 8 núcleos / 16 hilos · AM5';
}

function abrirFormulario(producto, opciones = {}){
  const nuevo = !producto || opciones.copia;
  const p = producto ? clonar(producto) : { category:'', stock:1, specs:{} };
  if(opciones.copia){ p.id = null; p.image = ''; p.stock = 1; p.featured = false; p.best = false; }
  dlg = { p, nuevo, foto: null, archivo: null, copiaDe: opciones.copia ? producto.name : null };

  $('#dlgTitulo').textContent = opciones.copia ? 'Nuevo producto (copia)' : nuevo ? 'Agregar producto' : 'Editar producto';
  $('#fCategoria').innerHTML = opcionesCategoria();
  $('#fNombre').value = p.name || '';
  $('#fMarca').value = p.brand || '';
  $('#fCategoria').value = p.category || '';
  $('#fPrecio').value = p.price || '';
  $('#fStock').value = p.stock ?? 1;
  $('#fAntes').value = p.oldPrice || '';
  $('#fSub').value = p.sub || '';
  $('#fDestacado').checked = !!p.featured;
  $('#fVendido').checked = !!p.best;
  $('#fRecorte').checked = true;
  $('#fotoInput').value = '';
  mostrarDatos(p.category, p.specs || {});
  mostrarFoto(p.image ? (vistaPrevia.get(p.image) || p.image) : null);
  $('#fotoInfo').textContent = 'La foto se recorta, se achica y se guarda en WebP automáticamente.';
  $('#btnEliminar').hidden = nuevo;
  $('#btnDuplicar').hidden = nuevo;
  $('#dlgError').innerHTML = opciones.copia
    ? `<div class="aviso info"><i class="fas fa-copy"></i><div>Copia de <b>${esc(producto.name)}</b>: cámbiale el nombre (por ejemplo el color) y agrégale su foto.</div></div>`
    : '';
  $('#dlg').showModal();
  if(nuevo) setTimeout(() => { $('#fNombre').focus(); $('#fNombre').select(); }, 50);
}

function mostrarFoto(url){
  const img = $('#fotoImg');
  img.hidden = !url;
  if(url){ img.src = url; img.onerror = () => { img.hidden = true; }; }
  $('#txtFoto').textContent = url ? 'Cambiar foto' : 'Elegir foto';
}

function errorFormulario(texto){
  $('#dlgError').innerHTML = `<div class="aviso error"><i class="fas fa-triangle-exclamation"></i><div>${texto}</div></div>`;
  $('#dlgError').scrollIntoView({ block: 'nearest' });
}

/* Nombre de archivo para la foto: RYZEN_7_9800X3D.webp en la carpeta de su categoría */
function nombreArchivo(nombre){
  return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'PRODUCTO';
}
function rutaFoto(p, ext){
  const carpeta = CATEGORIAS[p.category].carpeta;
  const publicada = (guardado.find(q => q.id === p.id) || {}).image;
  const ocupada = r => r === publicada || productos.some(q => q.id !== p.id && q.image === r);
  // una foto que todavía no se publicó se puede reemplazar en el mismo lugar
  if(p.image && p.image.startsWith(`img/${carpeta}/`) && !ocupada(p.image)) return p.image.replace(/\.[a-z0-9]+$/i, '.' + ext);
  // si ya estaba publicada, va con otro nombre: así nadie sigue viendo la foto vieja guardada en su navegador
  const base = `img/${carpeta}/${nombreArchivo(p.name)}`;
  let ruta = `${base}.${ext}`, n = 2;
  while(ocupada(ruta)) ruta = `${base}_${n++}.${ext}`;
  return ruta;
}

function aceptarFormulario(){
  const p = dlg.p;
  p.name = $('#fNombre').value.trim().replace(/\s+/g, ' ');
  p.brand = $('#fMarca').value.trim();
  p.category = $('#fCategoria').value;
  p.price = Number($('#fPrecio').value);
  p.stock = $('#fStock').value === '' ? 1 : Math.max(0, Math.floor(Number($('#fStock').value)));
  p.oldPrice = Number($('#fAntes').value) || undefined;
  p.specs = leerDatos();
  p.sub = $('#fSub').value.trim() || subAutomatica(p.specs);
  p.featured = $('#fDestacado').checked;
  p.best = $('#fVendido').checked;

  if(!p.name) return errorFormulario('Escribe el <b>nombre</b> del producto.');
  if(!p.brand) return errorFormulario('Escribe la <b>marca</b> del producto.');
  if(!CATEGORIAS[p.category]) return errorFormulario('Elige la <b>categoría</b> del producto.');
  if(!(p.price > 0)) return errorFormulario('Escribe el <b>precio</b> en soles.');
  if(p.oldPrice && p.oldPrice <= p.price) return errorFormulario('El <b>precio antes</b> tiene que ser mayor que el precio actual (o déjalo vacío).');
  const repetido = productos.find(q => q.id !== p.id && q.name.toLowerCase() === p.name.toLowerCase());
  if(repetido) return errorFormulario(`Ya existe un producto llamado <b>${esc(repetido.name)}</b>. Cámbiale el nombre (por ejemplo agrega el color o la capacidad).`);

  if(dlg.nuevo) p.id = Math.max(0, ...productos.map(q => q.id), ...guardado.map(q => q.id)) + 1;

  const anterior = productos.find(q => q.id === p.id);
  if(dlg.foto){
    const ruta = rutaFoto(p, dlg.foto.ext);
    if(anterior && anterior.image !== ruta) fotosPendientes.delete(anterior.image);
    fotosPendientes.set(ruta, { blob: dlg.foto.blob });
    vistaPrevia.set(ruta, dlg.foto.url);
    p.image = ruta;
  } else if(!p.image || !p.image.startsWith('img/')){
    p.image = rutaFoto({ ...p, image: '' }, 'webp');   // donde irá la foto cuando la subas
  }

  const limpioP = limpio(p);
  if(anterior) productos[productos.indexOf(anterior)] = limpioP;
  else productos.push(limpioP);
  $('#dlg').close();
  dlg = null;
  render();
}

function eliminarDesdeFormulario(){
  const p = productos.find(q => q.id === dlg.p.id);
  if(!p) return;
  const ok = confirm(`¿Eliminar "${p.name}" de la lista?\n\nSi solo se agotó, mejor márcalo como "Agotado": así lo vuelves a activar con un toque cuando reingrese.`);
  if(!ok) return;
  productos = productos.filter(q => q !== p);
  if(!productos.some(q => q.image === p.image)) fotosPendientes.delete(p.image);
  $('#dlg').close();
  dlg = null;
  render();
}

function duplicarDesdeFormulario(){
  const base = productos.find(q => q.id === dlg.p.id);
  $('#dlg').close();
  abrirFormulario(base, { copia: true });
}

/* =========================================================
   FOTOS: recorte 4:3, 800x600, WebP
   ========================================================= */
async function cargarImagen(archivo){
  if('createImageBitmap' in window){
    try { return await createImageBitmap(archivo, { imageOrientation: 'from-image' }); } catch(e){}
  }
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => mal(new Error('No se pudo leer la foto'));
    img.src = URL.createObjectURL(archivo);
  });
}

async function procesarFoto(archivo, recortar){
  const img = await cargarImagen(archivo);
  const W = img.width, H = img.height;

  // 1) Se analiza una versión pequeña para encontrar el producto y el color de fondo
  const k0 = Math.min(1, 320 / Math.max(W, H));
  const w = Math.max(3, Math.round(W * k0)), h = Math.max(3, Math.round(H * k0));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for(let i = 0; i < w * h; i++) lum[i] = 0.299 * px[i*4] + 0.587 * px[i*4+1] + 0.114 * px[i*4+2];

  const franja = Math.max(1, Math.round(h / 30));
  const borde = [], rr = [], gg = [], bb = [];
  for(let y = 0; y < h; y++){
    if(y >= franja && y < h - franja) continue;
    for(let x = 0; x < w; x++){ const i = y * w + x; borde.push(lum[i]); rr.push(px[i*4]); gg.push(px[i*4+1]); bb.push(px[i*4+2]); }
  }
  const mediana = arr => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  const fondoL = mediana(borde);
  const fondo = `rgb(${mediana(rr)},${mediana(gg)},${mediana(bb)})`;

  // 2) Caja del producto: lo que se diferencia del fondo
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  if(recortar){
    for(let y = 1; y < h - 1; y++) for(let x = 1; x < w - 1; x++){
      let s = 0;
      for(let dy = -1; dy <= 1; dy++) for(let dx = -1; dx <= 1; dx++) s += lum[(y + dy) * w + x + dx];
      if(Math.abs(s / 9 - fondoL) > 38){ if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; }
    }
  }
  let bx, by, bw, bh;
  if(!recortar || x1 < 0 || (x1 - x0) * (y1 - y0) < w * h * 0.02){ bx = 0; by = 0; bw = W; bh = H; }
  else {
    bx = x0 / k0; by = y0 / k0; bw = (x1 - x0 + 1) / k0; bh = (y1 - y0 + 1) / k0;
    const m = 0.09; bx -= bw * m; by -= bh * m; bw *= 1 + 2 * m; bh *= 1 + 2 * m;
  }

  // 3) Se ajusta a 4:3 alrededor del producto, sin salirse de la foto si se puede
  const cx = bx + bw / 2, cy = by + bh / 2;
  if(bw / bh > 4 / 3) bh = bw * 3 / 4; else bw = bh * 4 / 3;
  let sx = cx - bw / 2, sy = cy - bh / 2;
  sx = bw <= W ? Math.min(Math.max(sx, 0), W - bw) : (W - bw) / 2;
  sy = bh <= H ? Math.min(Math.max(sy, 0), H - bh) : (H - bh) / 2;

  // 4) Se dibuja en 800x600 con el color del fondo detrás
  const out = document.createElement('canvas'); out.width = 800; out.height = 600;
  const o = out.getContext('2d');
  o.fillStyle = fondo; o.fillRect(0, 0, 800, 600);
  o.imageSmoothingQuality = 'high';
  const k = 800 / bw;
  o.drawImage(img, -sx * k, -sy * k, W * k, H * k);

  // 5) WebP (o JPG si el navegador no sabe hacer WebP)
  let blob = await new Promise(r => out.toBlob(r, 'image/webp', 0.82));
  let ext = 'webp';
  if(!blob || blob.type !== 'image/webp'){ blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.86)); ext = 'jpg'; }
  return { blob, ext, url: URL.createObjectURL(blob) };
}

async function usarFoto(){
  if(!dlg || !dlg.archivo) return;
  $('#fotoInfo').textContent = 'Preparando la foto…';
  try {
    dlg.foto = await procesarFoto(dlg.archivo, $('#fRecorte').checked);
    mostrarFoto(dlg.foto.url);
    $('#fotoInfo').textContent = `Lista: 800×600 px · ${Math.max(1, Math.round(dlg.foto.blob.size / 1024))} KB. Se sube al publicar.`;
  } catch(e){
    dlg.foto = null;
    $('#fotoInfo').textContent = 'No se pudo leer esa foto. Prueba con otra (JPG, PNG o WebP).';
  }
}

/* =========================================================
   PUBLICAR
   ========================================================= */

/* Si productos.json cambió desde otro lugar, se aplican mis cambios encima de esa versión */
function fusionar(remotos){
  const base = new Map(guardado.map(p => [p.id, p]));
  const mios = new Set(productos.map(p => p.id));
  const resultado = new Map(remotos.map(p => [p.id, p]));
  for(const p of productos){
    const antes = base.get(p.id);
    if(antes && igual(antes, p)) continue;              // no lo toqué: queda la versión de afuera
    if(!antes && resultado.has(p.id))                   // producto nuevo cuyo número ya se usó afuera
      p.id = Math.max(0, ...resultado.keys(), ...mios) + 1;
    resultado.set(p.id, limpio(p));
  }
  for(const a of guardado) if(!mios.has(a.id)) resultado.delete(a.id);   // los que eliminé
  return [...resultado.values()];
}

function mensajeCommit(cambios){
  const titulo = cambios.length === 1 ? cambios[0] : `${cambios.length} cambios`;
  return `Panel de stock: ${titulo}\n\n` + cambios.map(c => `- ${c}`).join('\n');
}

const jsonProductos = marca => JSON.stringify({ actualizado: marca, productos: ordenar(productos).map(limpio) }, null, 2) + '\n';

async function publicarEnGitHub(){
  for(let intento = 1; intento <= 3; intento++){
    const head = (await gh(`/git/ref/heads/${RAMA}`)).object.sha;
    const actual = await gh(`/contents/${ARCHIVO}?ref=${head}`);
    if(actual.sha !== shaArchivo){
      const remotos = (JSON.parse(textoDeBase64(actual.content)).productos || []).map(limpio);
      productos = fusionar(remotos);
      guardado = remotos;
      shaArchivo = actual.sha;
    }
    const cambios = listaCambios();
    if(!cambios.length) return null;

    const marca = new Date().toISOString();
    const commit = await gh(`/git/commits/${head}`);
    const arbol = [{ path: ARCHIVO, mode: '100644', type: 'blob', content: jsonProductos(marca) }];
    for(const [ruta, f] of fotosEnUso()){
      if(!f.sha) f.sha = (await gh('/git/blobs', { method: 'POST', body: { content: await base64DeBlob(f.blob), encoding: 'base64' } })).sha;
      arbol.push({ path: ruta, mode: '100644', type: 'blob', sha: f.sha });
    }
    const tree = await gh('/git/trees', { method: 'POST', body: { base_tree: commit.tree.sha, tree: arbol } });
    const nuevo = await gh('/git/commits', { method: 'POST', body: { message: mensajeCommit(cambios), tree: tree.sha, parents: [head] } });
    try {
      await gh(`/git/refs/heads/${RAMA}`, { method: 'PATCH', body: { sha: nuevo.sha } });
    } catch(e){
      if(e.status === 422 && intento < 3) continue;     // alguien guardó justo en ese momento: se reintenta
      throw e;
    }
    const entrada = (tree.tree || []).find(t => t.path === ARCHIVO);
    shaArchivo = entrada ? entrada.sha : (await gh(`/contents/${ARCHIVO}?ref=${nuevo.sha}`)).sha;
    return marca;
  }
}

function descargar(nombre, blob){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function publicarManual(){
  const subir = `https://github.com/${REPO}/upload/${RAMA}`;
  const fotos = fotosEnUso();
  descargar(ARCHIVO, new Blob([jsonProductos(new Date().toISOString())], { type: 'application/json' }));
  fotos.forEach(([ruta, f], i) => setTimeout(() => descargar(ruta.split('/').pop(), f.blob), 500 * (i + 1)));

  const carpetas = {};
  fotos.forEach(([ruta]) => { const d = ruta.slice(0, ruta.lastIndexOf('/')); (carpetas[d] = carpetas[d] || []).push(ruta.split('/').pop()); });
  $('#pasosManual').innerHTML =
    `<li>Abre <a href="${subir}" target="_blank" rel="noopener">esta página de GitHub</a>, arrastra el archivo <code>${ARCHIVO}</code> que se descargó y toca <b>Commit changes</b>. (Reemplaza al anterior.)</li>` +
    Object.entries(carpetas).map(([d, archivos]) =>
      `<li>Abre <a href="${subir}/${d}" target="_blank" rel="noopener">la carpeta ${esc(d)}</a> y sube: ${archivos.map(a => `<code>${esc(a)}</code>`).join(', ')}. Luego <b>Commit changes</b>.</li>`).join('') +
    '<li>En 1 o 2 minutos se ve en tu web.</li>';
  $('#dlgManual').showModal();
  terminarPublicacion();
}

function terminarPublicacion(){
  guardado = clonar(productos.map(limpio));
  productos = clonar(guardado);
  fotosPendientes.clear();
  render();
}

async function publicar(){
  if(publicando || !listaCambios().length) return;
  if(modo === 'manual') return publicarManual();
  publicando = true;
  actualizarBarra();
  avisar();
  try {
    const marca = await publicarEnGitHub();
    terminarPublicacion();
    if(marca) esperarPublicacion(marca);
  } catch(e){
    console.error(e);
    avisar('error', textoError(e), e.message);
  } finally {
    publicando = false;
    actualizarBarra();
  }
}

/* Avisa cuando la web ya tiene los cambios (GitHub tarda 1-2 minutos en publicar) */
async function esperarPublicacion(marca){
  const caja = $('#publicando');
  const estado = (clase, icono, titulo, texto) => {
    caja.className = 'publicando ' + clase;
    caja.querySelector('i').className = 'fas ' + icono;
    $('#pubTitulo').textContent = titulo;
    $('#pubTexto').innerHTML = texto;
    caja.hidden = false;
  };
  estado('', 'fa-spinner fa-spin', 'Guardado. Publicando en tu web…', 'Normalmente tarda 1 o 2 minutos. Puedes seguir trabajando.');
  const fin = Date.now() + 5 * 60 * 1000;
  while(Date.now() < fin){
    await pausa(8000);
    try {
      const r = await fetch(`${ARCHIVO}?espera=${Date.now()}`, { cache: 'no-store' });
      if(r.ok){
        const d = await r.json();
        if(d.actualizado && d.actualizado >= marca){
          estado('listo', 'fa-circle-check', '¡Listo! Ya se ve en tu web.', '<a href="./" target="_blank" rel="noopener">Abrir mi web</a> (si no ves el cambio, recarga la página).');
          setTimeout(() => { if(caja.classList.contains('listo')) caja.hidden = true; }, 15000);
          return;
        }
      }
    } catch(e){}
  }
  estado('lento', 'fa-clock', 'Tus cambios están guardados.', 'La web está tardando más de lo normal en actualizarse. Revísala en unos minutos.');
}

/* =========================================================
   CONECTAR
   ========================================================= */
function mostrarPanel(){
  $('#vistaLogin').hidden = true;
  $('#vistaPanel').hidden = false;
  $('#btnSalir').hidden = false;
  render();
}

async function conectar(nuevaLlave, automatico){
  llave = nuevaLlave.trim();
  modo = 'github';
  const boton = $('#btnConectar');
  boton.disabled = true;
  boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Conectando…';
  try {
    await gh('');                                                                     // ¿la llave sirve?
    await gh('/git/blobs', { method: 'POST', body: { content: 'prueba del panel AO NEXUS', encoding: 'utf-8' } });   // ¿puede guardar? (GitHub descarta este dato solo)
    try { await cargarProductos(); }
    catch(e){
      if(e.status === 404) throw Object.assign(new Error('falta productos.json'), { status: -1 });
      throw e;
    }
    escribir(CLAVE_LLAVE, llave);
    avisar();
    mostrarPanel();
  } catch(e){
    console.error(e);
    if(e.status === 401) escribir(CLAVE_LLAVE, null);
    modo = null;
    $('#vistaLogin').hidden = false;
    $('#vistaPanel').hidden = true;
    avisar('error', e.status === -1
      ? 'Todavía no existe <code>productos.json</code> en tu repositorio. Primero fusiona el pull request del panel de stock.'
      : (automatico ? 'No se pudo conectar con la llave guardada. ' : '') + textoError(e), e.message);
  } finally {
    boton.disabled = false;
    boton.innerHTML = '<i class="fas fa-plug"></i> Conectar';
  }
}

async function usarSinConectar(){
  modo = 'manual';
  try {
    await cargarProductos();
    avisar('info', 'Estás usando el panel <b>sin conectar</b>: al terminar, el botón <b>Descargar archivos</b> te dará el archivo para que lo subas a GitHub.');
    mostrarPanel();
  } catch(e){
    modo = null;
    avisar('error', 'No se pudo leer la lista de productos de la web.', e.message);
  }
}

function salir(){
  if(listaCambios().length && !confirm('Tienes cambios sin publicar. ¿Salir igual y perderlos?')) return;
  escribir(CLAVE_LLAVE, null);
  location.reload();
}

/* =========================================================
   EVENTOS
   ========================================================= */
function iniciar(){
  // Conectar
  $('#formLlave').addEventListener('submit', e => { e.preventDefault(); conectar($('#inputLlave').value); });
  $('#btnManual').addEventListener('click', usarSinConectar);
  $('#btnSalir').addEventListener('click', salir);

  // Lista
  const lista = $('#lista');
  lista.addEventListener('click', e => {
    const boton = e.target.closest('[data-accion]');
    if(!boton) return;
    const p = productoDe(boton);
    if(!p) return;
    const accion = boton.dataset.accion;
    if(accion === 'editar') return abrirFormulario(p);
    if(accion === 'estado') alternarStock(p);
    if(accion === 'menos') p.stock = Math.max(0, p.stock - 1);
    if(accion === 'mas') p.stock = p.stock + 1;
    render();
  });
  lista.addEventListener('input', e => {
    const campo = e.target.dataset.campo;
    const p = campo && productoDe(e.target);
    if(!p) return;
    const n = Number(e.target.value);
    if(e.target.value === '' || !(n >= 0)) return;
    p[campo] = campo === 'stock' ? Math.floor(n) : n;
    e.target.closest('.fila').classList.toggle('cambiado', true);
    actualizarBarra();
  });
  lista.addEventListener('change', e => { if(e.target.dataset.campo) render(); });

  $('#buscar').addEventListener('input', e => { busqueda = e.target.value.trim(); render(); });
  $('#filtros').addEventListener('click', e => {
    const b = e.target.closest('[data-filtro]');
    if(!b) return;
    filtro = b.dataset.filtro;
    document.querySelectorAll('#filtros button').forEach(x => x.classList.toggle('on', x === b));
    render();
  });
  $('#btnNuevo').addEventListener('click', () => abrirFormulario(null));

  // Barra de publicar
  $('#btnPublicar').addEventListener('click', publicar);
  $('#btnDescartar').addEventListener('click', () => {
    if(!confirm('¿Descartar todos los cambios que no publicaste?')) return;
    productos = clonar(guardado);
    fotosPendientes.clear();
    render();
  });
  $('#btnVerCambios').addEventListener('click', () => {
    const l = $('#listaCambios');
    l.hidden = !l.hidden;
    $('#btnVerCambios').textContent = l.hidden ? 'Ver' : 'Ocultar';
  });
  $('#pubCerrar').addEventListener('click', () => { $('#publicando').hidden = true; });

  // Formulario
  $('#frm').addEventListener('submit', e => { e.preventDefault(); aceptarFormulario(); });
  document.querySelectorAll('#dlg [data-cerrar]').forEach(b => b.addEventListener('click', () => $('#dlg').close()));
  $('#btnEliminar').addEventListener('click', eliminarDesdeFormulario);
  $('#btnDuplicar').addEventListener('click', duplicarDesdeFormulario);
  $('#fCategoria').addEventListener('change', () => mostrarDatos($('#fCategoria').value, leerDatos()));
  $('#specs').addEventListener('input', actualizarSubSugerida);
  $('#specs').addEventListener('click', e => {
    const q = e.target.closest('.quitar');
    if(q){ q.closest('.spec').remove(); actualizarSubSugerida(); }
  });
  $('#btnDato').addEventListener('click', () => {
    $('#specs').insertAdjacentHTML('beforeend', filaDato('', '', true));
    $('#specs .spec:last-child .k').focus();
  });
  $('#fotoInput').addEventListener('change', e => {
    const archivo = e.target.files && e.target.files[0];
    if(!archivo || !dlg) return;
    dlg.archivo = archivo;
    usarFoto();
  });
  $('#fRecorte').addEventListener('change', usarFoto);
  $('#fotoPrev').addEventListener('click', () => $('#fotoInput').click());

  // No perder cambios sin publicar al cerrar la pestaña
  window.addEventListener('beforeunload', e => {
    if(modo && listaCambios().length){ e.preventDefault(); e.returnValue = ''; }
  });

  // Llave para crear el token con los datos ya llenos (si GitHub los acepta)
  const params = new URLSearchParams({
    name: 'Panel AO NEXUS', description: 'Panel de stock de la web AO NEXUS',
    target_name: 'AONEXUSpe', expires_in: '365', contents: 'write'
  });
  $('#linkLlave').href = 'https://github.com/settings/personal-access-tokens/new?' + params;

  $('#vistaLogin').hidden = false;
  const guardada = leer(CLAVE_LLAVE);
  if(guardada) conectar(guardada, true);
}

document.addEventListener('DOMContentLoaded', iniciar);
