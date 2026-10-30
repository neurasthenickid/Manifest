# Packaging is build-time Python only; never imported by the mobile plugin.
from pathlib import Path
import json,hashlib,zipfile,subprocess
subprocess.run(['node','scripts/verify-manifest.mjs','manifest.json','dist/light/manifest.json'],check=True)
root=Path.cwd();meta=json.loads((root/'manifest.json').read_text(encoding='utf-8'));manifest=json.loads((root/'src/headers/catalog.json').read_text(encoding='utf-8'));release=root/'dist/packages';release.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
normalized={k:manifest[k] for k in ['schemaVersion','version','minPluginVersion','maxPluginMajor','files']}
normalized['files']=[{k:f[k] for k in ['path','bytes','sha256']} for f in manifest['files']]
identity=sha(json.dumps(normalized,ensure_ascii=False,separators=(',',':')).encode());directory='versions/'+identity
records={f['sha256']:f for f in manifest['files']};result={}
def make(name,entries):
 p=release/name
 with zipfile.ZipFile(p,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
  for name,data in entries:
   assert not name.startswith('/') and '..' not in name.split('/') and '\\' not in name
   info=zipfile.ZipInfo(name,(2026,10,18,0,0,0));info.external_attr=0o100644<<16;archive.writestr(info,data,compress_type=zipfile.ZIP_DEFLATED,compresslevel=6)
 with zipfile.ZipFile(p) as z:
  assert z.testzip() is None
  if 'life-planner/manifest.json' in z.namelist():
   packed=json.loads(z.read('life-planner/manifest.json').decode('utf-8'))
   assert packed==meta and packed['version']==json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
   assert packed['description']==json.loads((root/'manifest.json').read_text(encoding='utf-8'))['description']
 result[p.name]={'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())}
objects=[]
for h,f in records.items():
 b=(root/'collection-source/objects'/ (h+'.webp')).read_bytes();assert len(b)==f['bytes'] and sha(b)==h;objects.append((h,b))
text=json.dumps(manifest,ensure_ascii=False,indent=2).encode()
make('header-collection-'+manifest['version']+'.zip',[('headers-manifest.json',text),('IMAGE_LICENSE.txt',(root/'IMAGE_LICENSE').read_bytes())]+[('h-'+h+'.webp',b) for h,b in objects])
receipt=json.dumps({'schemaVersion':1,'directory':directory,'manifest':normalized},ensure_ascii=False,separators=(',',':')).encode()
light=[(name,(root/'dist/light'/name).read_bytes()) for name in ['main.js','manifest.json','styles.css']]
extra=[(name,(root/name).read_bytes()) for name in ['LICENSE','IMAGE_LICENSE','THIRD_PARTY_NOTICES.md','README.md']]+[(p.relative_to(root).as_posix(),p.read_bytes()) for d in ['licenses','docs'] for p in sorted((root/d).rglob('*')) if p.is_file()]
full=[('life-planner/'+n,b) for n,b in light+extra]+[('life-planner/header-collection/active.json',receipt)]+[('life-planner/header-collection/'+directory+'/'+h+'.webp',b) for h,b in objects]
make('life-planner-'+meta['version']+'-full.zip',full)
result['light']={'bytes':sum(len(b) for _,b in light),'files':{n:{'bytes':len(b),'sha256':sha(b)} for n,b in light}};result['collection']={'images':len(manifest['files']),'uniqueObjects':len(objects),'imageBytes':sum(len(b) for _,b in objects),'manifestBytes':len(text),'unpackedBytes':sum(len(b) for _,b in objects)+len(text)+len((root/'IMAGE_LICENSE').read_bytes())}
(release/'sizes-and-checksums.json').write_text(json.dumps(result,indent=2),encoding='utf-8');(release/'SHA256SUMS.txt').write_text('\n'.join(f"{v['sha256']}  {k}" for k,v in result.items() if 'sha256' in v)+'\n',encoding='utf-8');print(json.dumps(result))
