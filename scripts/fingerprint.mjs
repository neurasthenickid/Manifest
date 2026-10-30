import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export async function sourceHashes(){
 const files=['manifest.json','release.config.json','package.json','pnpm-lock.yaml','styles.css'];
 for(const entry of await readdir('src',{recursive:true,withFileTypes:true}))if(entry.isFile())files.push((entry.parentPath+'/'+entry.name).replaceAll('\\','/'));
 const result={};for(const file of files.sort())result[file]=sha256(await readFile(file));return result;
}
