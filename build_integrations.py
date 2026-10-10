from pathlib import Path
import json, re, hashlib
import shutil

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'integrations'
(OUT/'catalogo').mkdir(parents=True,exist_ok=True)
(OUT/'contabilizador').mkdir(parents=True,exist_ok=True)
config=(ROOT/'dist/assets/config.js').read_text()
url=re.search(r'(?:"supabaseUrl"|supabaseUrl)\s*:\s*["\']([^"\']+)',config).group(1)
key=re.search(r'(?:"publishableKey"|publishableKey)\s*:\s*["\']([^"\']+)',config).group(1)
source=(ROOT/'original/catalogo/app.js').read_text()
start=source.index('async function loadCatalog(){')
end=source.index('\n/* ---------- Estado ---------- */',start)
loader='''const AO_CATALOG_SOURCE = Object.freeze(__CONFIG__);
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
'''.replace('__CONFIG__',json.dumps({'url':url,'key':key}))
source=source[:start]+loader+source[end:]
source=source.replace('Catálogo: se carga desde productos.json','Catálogo: stock y precios compartidos con AO Nexus Central')
source=source.replace('Los productos se editan desde el panel de stock (admin.html).','Los productos se editan desde Mi web en AO Nexus Central.')
source=source.replace("console.error('No se pudo cargar productos.json', err)","console.error('No se pudo cargar el catálogo compartido', err)")
source=source.replace("  updateCart();\n  loadCatalog()", "  updateCart();\n  setInterval(refreshCatalogue,60000);\n  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshCatalogue();});\n  window.addEventListener('focus',refreshCatalogue);\n  loadCatalog()",1)
(OUT/'catalogo/app.js').write_text(source)
index=(ROOT/'original/catalogo/index.html').read_text()
index=index.replace('<html lang="es">','<html lang="es" data-default-theme="dark">',1)
index=index.replace('<head>','<head>\n<script src="theme.js"></script>',1)
index=index.replace('</head>','<link rel="stylesheet" href="theme.css">\n</head>',1)
index=index.replace('<div class="header-icons">','<div class="header-icons"><button type="button" class="theme-toggle" data-theme-toggle aria-label="Cambiar tema">Modo claro</button>',1)
shutil.copy(ROOT/'dist/assets/theme.js',OUT/'catalogo/theme.js')
for asset in ['theme.js','theme.css']:
    version=hashlib.sha256((OUT/'catalogo'/asset).read_bytes()).hexdigest()[:12]
    index=index.replace('"'+asset+'"','"'+asset+'?v='+version+'"')
version=hashlib.sha256(source.encode()).hexdigest()[:12]
index=re.sub(r'''(src=["'])app\.js(?:\?[^"']*)?(["'])''',lambda m:m.group(1)+'app.js?v='+version+m.group(2),index)
(OUT/'catalogo/index.html').write_text(index)

def redirect(view,title,description):
    target='https://valentinotr.github.io/boletasAO/?vista='+view
    return '''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>__TITLE__ · AO Nexus Central</title><meta http-equiv="refresh" content="0;url=__TARGET__"><style>:root{font-family:system-ui,sans-serif;color:#2b1e38;background:#f7f5fa}body{margin:0;min-height:100vh;display:grid;place-items:center}main{width:min(400px,80vw);padding:34px;background:#fff;border:1px solid #e9e1f0;border-radius:18px}small{color:#78549c;letter-spacing:2px;font-size:10px;font-weight:800}h1{font-size:27px;letter-spacing:-.7px}p{color:#82748d;font-size:14px;line-height:1.7}a{display:inline-block;margin-top:12px;background:#7450a7;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:600;font-size:13px}</style></head><body><main><small>AO NEXUS CENTRAL</small><h1>__TITLE__</h1><p>__DESCRIPTION__</p><a href="__TARGET__">Abrir mi panel</a></main><script>location.replace('__TARGET__');</script></body></html>'''.replace('__TITLE__',title).replace('__DESCRIPTION__',description).replace('__TARGET__',target)

(OUT/'catalogo/admin.html').write_text(redirect('catalog','Tu stock y tu web, conectados','Administra productos, fotos, precios y disponibilidad desde Mi web en tu panel central.'))
(OUT/'contabilizador/index.html').write_text(redirect('dashboard','Tu negocio en un solo lugar','Compras, inventario, ventas, catálogo, clientes y boletas ahora forman parte de AO Nexus Central.'))
(OUT/'contabilizador/legacy.html').write_text((ROOT/'original/contabilizador/index.html').read_text())
print('Integraciones preparadas para catálogo, panel de stock y contabilizador')
