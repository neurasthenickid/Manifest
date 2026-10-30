import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export const EXPECTED_DESCRIPTION='Plan your days, tasks, habits, routines and workouts with calendars, life areas and period statistics.';
export function validateManifest(m,p,versions){
 const semver=v=>typeof v==='string'&&/^\d+\.\d+\.\d+$/.test(v);
 if(!m||m.id!=='life-planner'||m.name!=='Manifest'||!semver(m.version)||!semver(m.minAppVersion)||m.minAppVersion!=='1.11.4'||m.isDesktopOnly!==false||m.author!=='neurasthenick1d')throw Error('Invalid plugin manifest fields');
 if(m.description!==EXPECTED_DESCRIPTION||m.description.length>250)throw Error('Manifest description is not the expected UTF-8 JSON value');
 if(p?.version!==m.version||versions?.[m.version]!==m.minAppVersion)throw Error('Manifest/package/versions.json versions disagree');
 return true;
}
export async function verifyManifest(paths=['manifest.json']){
 const p=JSON.parse(await readFile('package.json','utf8')),versions=JSON.parse(await readFile('versions.json','utf8'));
 for(const path of paths){const bytes=await readFile(path),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);validateManifest(JSON.parse(text),p,versions);}
 console.log('Manifest UTF-8 value, required fields and versions: PASS');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await verifyManifest(process.argv.slice(2).length?process.argv.slice(2):undefined);
