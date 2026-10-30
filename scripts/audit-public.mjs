import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const forbiddenDirs=new Set(['backups','candidates','releases','final','mobile','.codex','TimeGarden','timegarden']);
const ignored=new Set(['.git','node_modules','dist','test-results']);
const findings=[],files=[];
async function walk(dir=''){
 for(const entry of await readdir(dir||'.',{withFileTypes:true})){
  if(!dir&&ignored.has(entry.name))continue;
  const name=dir?dir+'/'+entry.name:entry.name;
  if(entry.isSymbolicLink())throw Error('Symlink in public project: '+name);
  if(entry.isDirectory()){if(forbiddenDirs.has(entry.name)||/^test-vault/.test(entry.name))findings.push(name);await walk(name);continue;}
  files.push(name);
  if(/\.(?:ts|mts|mjs|json|md|txt|ya?ml|css)$/.test(name)||['LICENSE','IMAGE_LICENSE'].includes(name)){
   const text=await readFile(name,'utf8');
   if(/C:[\\/]Users[\\/]trall|D:[\\/]Codex-Life-Planner|\.codex[\\/]attachments|https:\/\/chatgpt\.com\/share\//i.test(text))findings.push('Private path/reference: '+name);
   if(/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))findings.push('Credential-like content: '+name);
  }
 }
}
await walk();
const m=JSON.parse(await readFile('manifest.json','utf8')),c=JSON.parse(await readFile('release.config.json','utf8'));
if(m.id!=='life-planner'||m.name!=='Manifest'||m.author!=='neurasthenick1d'||c.repository!=='neurasthenickid/Manifest'||c.codeLicense!=='PolyForm-Noncommercial-1.0.0'||c.imageLicense!=='CC-BY-NC-4.0')findings.push('Approved metadata/licensing mismatch');
if(!(await readFile('LICENSE','utf8')).includes('PolyForm Noncommercial License 1.0.0')||!(await readFile('IMAGE_LICENSE','utf8')).includes('Attribution-NonCommercial 4.0 International'))findings.push('Full approved licenses missing');
const catalog=JSON.parse(await readFile('src/headers/catalog.json','utf8'));let images=0;
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const f of new Map(catalog.files.map(f=>[f.sha256,f])).values()){
 const b=await readFile('collection-source/objects/'+f.sha256+'.webp');if(b.length!==f.bytes||sha(b)!==f.sha256)throw Error('Image checksum differs');
 if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WEBP')throw Error('Not WebP');
 for(let p=12;p+8<=b.length;){const type=b.toString('ascii',p,p+4),size=b.readUInt32LE(p+4);if(['ANIM','ANMF','EXIF','XMP '].includes(type))findings.push('Animation or unaudited metadata: '+f.path);p+=8+size+(size%2);}
 images++;
}
if(findings.length)throw Error('Public audit failed: '+findings.join('; '));
await mkdir('test-results',{recursive:true});await writeFile('test-results/public-audit.json',JSON.stringify({status:'PASS',files:files.length,images,logicalImages:catalog.files.length,privatePathFindings:0,credentialPatternFindings:0,method:'Explicit export allowlist plus full text scan, image SHA/chunk inspection, metadata and license checks. Pattern scans are not a mathematical guarantee of absence of secrets.'},null,2)+'\n');
console.log('Public source/content/license/image audit: PASS');
