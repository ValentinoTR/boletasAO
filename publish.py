"""Prepara la publicación del panel (GitHub Pages sirve la raíz del repositorio).

1. Recalcula los ?v= de caché de los HTML de dist/ a partir del contenido de cada archivo.
2. Copia dist/ a la raíz (páginas y assets).

dist/ se edita a mano: build_suite.py y build_stock.py ya no reproducen esta versión.
Ejecutar después de cada cambio en dist/:  python publish.py
"""
from pathlib import Path
import hashlib, re, shutil

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
PAGES = ['index.html', 'boletas.html', 'accounting.html', 'cotizacion.html']
REFERENCE = re.compile(r'''((?:src|href)=["'])(assets/[^"'?]+)(?:\?[^"']*)?(["'])''')

def version(asset):
    return hashlib.sha256(asset.read_bytes()).hexdigest()[:12]

def fingerprint(match):
    asset = DIST / match.group(2)
    assert asset.is_file(), 'Falta asset: ' + str(asset)
    return match.group(1) + match.group(2) + '?v=' + version(asset) + match.group(3)

def main():
    changed = []
    for name in PAGES:
        page = DIST / name
        old = page.read_text(encoding='utf-8')
        new = REFERENCE.sub(fingerprint, old)
        if new != old:
            page.write_text(new, encoding='utf-8', newline='')
            changed.append(name)
    for name in PAGES:
        shutil.copy2(DIST / name, ROOT / name)
    shutil.copytree(DIST / 'assets', ROOT / 'assets', dirs_exist_ok=True)
    print('Versiones de caché actualizadas en: ' + (', '.join(changed) or 'ninguna página (ya estaban al día)'))
    print('dist/ copiado a la raíz.')

if __name__ == '__main__':
    main()
