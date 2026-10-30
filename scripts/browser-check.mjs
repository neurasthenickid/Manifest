import {spawn,spawnSync} from 'node:child_process';
const server=(file,ready)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file],{stdio:['ignore','pipe','inherit']});const timeout=setTimeout(()=>{child.kill();reject(Error('Local UI server did not become ready'));},30000);child.once('exit',code=>{clearTimeout(timeout);reject(Error('UI server exited: '+code));});child.stdout.on('data',b=>{process.stdout.write(b);if(String(b).includes(ready)){clearTimeout(timeout);resolve(child);}});});
const children=[];
try{children.push(await server('scripts/preview.mjs','Manifest local UI:'));children.push(await server('scripts/header-ui-server.mjs','Header collection UI fixture:'));
 for(const script of ['ui-activity-statistics-check.mjs','ui-month-cards-check.mjs','header-ui-check.mjs','daily-ui-check.mjs']){
  const r=spawnSync(process.execPath,['scripts/'+script],{encoding:'utf8',maxBuffer:8*1024*1024});
  process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');
  if(r.status!==0){
   // Public check annotations retain the precise fixture failure without exposing credentials.
   if(process.env.GITHUB_ACTIONS){const detail=(r.stderr||String(r.error||'Test process exited '+r.status)).slice(-6000).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');console.error('::error title=Browser regression '+script+'::'+detail);}
   throw Error('Browser regression failed: '+script);
  }
 }
}finally{for(const child of children)child.kill();}
