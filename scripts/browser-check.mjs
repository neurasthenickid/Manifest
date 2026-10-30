import {spawn,spawnSync} from 'node:child_process';
const server=(file,ready)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file],{stdio:['ignore','pipe','inherit']});const timeout=setTimeout(()=>{child.kill();reject(Error('Local UI server did not become ready'));},30000);child.once('exit',code=>{clearTimeout(timeout);reject(Error('UI server exited: '+code));});child.stdout.on('data',b=>{process.stdout.write(b);if(String(b).includes(ready)){clearTimeout(timeout);resolve(child);}});});
const children=[];
try{children.push(await server('scripts/preview.mjs','Manifest local UI:'));children.push(await server('scripts/header-ui-server.mjs','Header collection UI fixture:'));
 for(const script of ['ui-activity-statistics-check.mjs','ui-month-cards-check.mjs','header-ui-check.mjs','daily-ui-check.mjs']){const r=spawnSync(process.execPath,['scripts/'+script],{stdio:'inherit'});if(r.status!==0)throw Error('Browser regression failed: '+script);}
}finally{for(const child of children)child.kill();}
