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
    text=html.read_text(); doc=Document(); doc.feed(text)
    assert len(doc.ids)==len(set(doc.ids)), 'IDs repetidos: '+str(html)
    for n,src in enumerate(re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',text,re.S)):
        if not src.strip(): continue
        temp=ROOT/'.qa'/f'{html.stem}-syntax-{n}.js'; temp.write_text(src)
        result=subprocess.run(['node','--check',str(temp)],capture_output=True,text=True)
        scripts+=1
        if result.returncode: errors.append(result.stderr)
    for asset in doc.assets: assert (ROOT/'dist'/asset.split('?')[0]).is_file(), 'Falta asset: '+asset
for js in list((ROOT/'dist/assets').glob('*.js'))+list((ROOT/'integrations/catalogo').glob('*.js')):
    result=subprocess.run(['node','--check',str(js)],capture_output=True,text=True)
    scripts+=1
    if result.returncode: errors.append(result.stderr)
assert not errors, '\n'.join(errors)
doc=Document(); doc.feed((ROOT/'dist/index.html').read_text()); known=set(doc.ids)
for file in ['app.js','suite.js']:
    for field in re.findall(r'''\$\(["']([^"']+)["']\)''',(ROOT/'dist/assets'/file).read_text()):
        assert field in known, 'Falta control: '+field
print(f'HTML, controles y {scripts} scripts verificados')
