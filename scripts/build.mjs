import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex'),manifest=JSON.parse(await readFile('manifest.json','utf8'));
await mkdir('dist/light',{recursive:true});
const result=await build({entryPoints:['src/main.ts'],bundle:true,preserveSymlinks:true,external:['obsidian','@codemirror/state','@codemirror/view'],format:'cjs',platform:'browser',target:'es2020',outfile:'dist/light/main.js',metafile:true,banner:{js:'/* Manifest. Includes unmodified ical.js 2.2.1 (MPL-2.0). Corresponding source: third-party/ical.js/lib in the source release; upstream https://github.com/kewisch/ical.js/tree/v2.2.1/lib . License https://www.mozilla.org/MPL/2.0/ . Plugin code licensing: see LICENSE. */'}});
const allowed=['obsidian','@codemirror/state','@codemirror/view'];for(const o of Object.values(result.metafile.outputs))for(const i of o.imports)if(!allowed.includes(i.path))throw new Error('Unexpected runtime import '+i.path);
const inventory=JSON.parse(await readFile('assets/fonts/manifest.json','utf8'));let css='/* Bundled fonts: SIL OFL 1.1. Font licenses and conversion log follow. */\n';
for(const name of ['manrope-OFL.txt','manrope-FONTLOG.txt','literata-OFL.txt','jetbrainsmono-OFL.txt'])css+='/*\n'+(await readFile('assets/fonts/'+name,'utf8')).replaceAll('*/','* /')+'\n*/\n';
for(const f of inventory.fonts){const b=await readFile('assets/fonts/'+f.file);if(sha(b)!==f.sha256)throw new Error('Font changed');css+=`@font-face{font-family:"LP ${f.family}";font-style:normal;font-weight:${f.weight.join(' ')};font-display:optional;src:url("data:font/woff2;base64,${b.toString('base64')}") format("woff2")}\n`;}
css+=await readFile('styles.css','utf8');await writeFile('dist/light/styles.css',css);await writeFile('dist/light/manifest.json',JSON.stringify(manifest,null,2)+'\n');
const sums={};for(const name of ['main.js','manifest.json','styles.css'])sums[name]=sha(await readFile('dist/light/'+name));await writeFile('dist/light-checksums.json',JSON.stringify(sums,null,2)+'\n');await writeFile('dist/SHA256SUMS.txt',Object.entries(sums).map(([n,h])=>h+'  '+n).join('\n')+'\n');await writeFile('dist/build-meta.json',JSON.stringify(result.metafile,null,2));console.log('Light build: three standard files, no required collection directory.');
