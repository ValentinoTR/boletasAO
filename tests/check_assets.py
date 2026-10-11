from pathlib import Path
from html.parser import HTMLParser
import re, subprocess

ROOT=Path(__file__).resolve().parents[1]
errors=[]
scripts=0
(ROOT/'.qa').mkdir(exist_ok=True)

class Document(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids=[]; self.assets=[]
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if 'id' in attrs: self.ids.append(attrs['id'])
        for name in ['src','href']:
            value=attrs.get(name,'')
            if value.startswith('assets/'): self.assets.append(value)

for html in (ROOT/'dist').glob('*.html'):
    text=html.read_text(encoding='utf-8'); doc=Document(); doc.feed(text)
    assert len(doc.ids)==len(set(doc.ids)), 'IDs repetidos: '+str(html)
    for n,src in enumerate(re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',text,re.S)):
        if not src.strip(): continue
        temp=ROOT/'.qa'/f'{html.stem}-syntax-{n}.js'; temp.write_text(src,encoding='utf-8')
        result=subprocess.run(['node','--check',str(temp)],capture_output=True,text=True)
        scripts+=1
        if result.returncode: errors.append(result.stderr)
    for asset in doc.assets: assert (ROOT/'dist'/asset.split('?')[0]).is_file(), 'Falta asset: '+asset
for js in list((ROOT/'dist/assets').glob('*.js'))+list((ROOT/'integrations/catalogo').glob('*.js')):
    result=subprocess.run(['node','--check',str(js)],capture_output=True,text=True)
    scripts+=1
    if result.returncode: errors.append(result.stderr)
assert not errors, '\n'.join(errors)
doc=Document(); doc.feed((ROOT/'dist/index.html').read_text(encoding='utf-8')); known=set(doc.ids)
for file in ['app.js','suite.js']:
    for field in re.findall(r'''\$\(["']([^"']+)["']\)''',(ROOT/'dist/assets'/file).read_text(encoding='utf-8')):
        assert field in known, 'Falta control: '+field
# Los ?v= de caché deben coincidir con el contenido actual y la raíz debe ser una copia exacta de dist/ (python publish.py).
import hashlib
for html in (ROOT/'dist').glob('*.html'):
    for asset,version in re.findall(r'''(?:src|href)=["'](assets/[^"'?]+)\?v=([0-9a-f]{12})["']''',html.read_text(encoding='utf-8')):
        actual=hashlib.sha256((ROOT/'dist'/asset).read_bytes()).hexdigest()[:12]
        assert version==actual, f'Versión de caché desactualizada en {html.name}: {asset} (ejecuta python publish.py)'
for page in ['index.html','boletas.html','accounting.html']:
    assert (ROOT/page).read_bytes()==(ROOT/'dist'/page).read_bytes(), 'La raíz no coincide con dist/: '+page+' (ejecuta python publish.py)'
for file in (ROOT/'dist/assets').iterdir():
    assert (ROOT/'assets'/file.name).read_bytes()==file.read_bytes(), 'La raíz no coincide con dist/: assets/'+file.name+' (ejecuta python publish.py)'
print(f'HTML, controles y {scripts} scripts verificados')
