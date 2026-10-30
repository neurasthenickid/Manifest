import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
await mkdir('dist/preview',{recursive:true});
await build({entryPoints:['scripts/ui-harness.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/preview/ui.js',alias:{obsidian:'./scripts/obsidian-harness.ts'}});
await writeFile('dist/preview/styles.css',await readFile('dist/light/styles.css'));
await writeFile('dist/preview/index.html','<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manifest UI test</title><link rel="stylesheet" href="/styles.css"><style>body{margin:12px;font-family:system-ui;background:#faf9f6;color:#262530}#app{max-width:1400px;margin:auto}body.dark{--background-primary:#22232a;--background-secondary:#2d3039;--background-modifier-border:#484955;--text-normal:#ebe9ee;--text-muted:#b2adb9;background:#22232a;color:#ebe9ee}</style><main id="app"></main><script type="module" src="/ui.js"></script></html>');
if(!process.argv.includes('--build-only'))createServer(async(req,res)=>{const file={'/':'index.html','/styles.css':'styles.css','/ui.js':'ui.js'}[req.url];if(!file){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile('dist/preview/'+file));}).listen(4173,'127.0.0.1',()=>console.log('Manifest local UI: http://127.0.0.1:4173'));
