import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function sourceDigest(root='.'){
 const entries=[];
 async function visit(dir){for(const item of (await readdir(root+'/'+dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=dir?dir+'/'+item.name:item.name;if(!dir&&['.git','node_modules','dist','test-results'].includes(item.name))continue;if(path.startsWith('collection-source/objects/'))continue;if(item.isDirectory())await visit(path);else if(item.isFile())entries.push([path,sha(await readFile(root+'/'+path))]);else throw Error('Symlinks are not public source inputs: '+path);}}
 await visit('');return sha(JSON.stringify(entries));
}
export async function artifactHashes(paths){return Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));}
export async function verifyProof(proof,head,root='.'){
 if(!/^[a-f0-9]{40}$/.test(head)||proof?.commit!==head||proof.source!==await sourceDigest(root)||!proof.artifacts||!Object.keys(proof.artifacts).length)throw Error('Release does not match the checked source commit');
 for(const [path,hash] of Object.entries(proof.artifacts)){if(!/^dist\/(light\/(main\.js|manifest\.json|styles\.css)|packages\/([a-z0-9.-]+\.(zip|json)|SHA256SUMS\.txt)|collection\/(h-[a-f0-9]{64}\.webp|[-a-z0-9]+\.json|IMAGE_LICENSE\.txt|SHA256SUMS\.txt)|SHA256SUMS\.txt)$/.test(path)||sha(await readFile(root+'/'+path))!==hash)throw Error('Release artifact changed: '+path);}
}
export function checkedCommand(run,args,allowMissing=false){const r=run(args);if(r.status!==0){if(allowMissing&&/HTTP 404/.test(r.stderr??''))return null;throw Error('GitHub verification failed; no tag or release was overwritten');}return r.stdout?.trim()??'';}
export function verifyTag(run,repository,tag,commit){
 const ref=checkedCommand(run,['api',`repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`],true);if(ref===null)return;
 let object=JSON.parse(ref).object;const seen=new Set();
 while(object?.type==='tag'){if(seen.has(object.sha)||seen.size>8)throw Error('Invalid annotated tag');seen.add(object.sha);object=JSON.parse(checkedCommand(run,['api',`repos/${repository}/git/tags/${object.sha}`])).object;}
 if(object?.type!=='commit'||object.sha!==commit)throw Error('Existing tag points to a different commit; refusing to publish');
}
export function createDrafts(run,{repository,commit,version,collectionTag,collectionVersion,collectionAssets,codeAssets,kind='code-only'}){
 if(!/^[a-f0-9]{40}$/.test(commit)||!/^[-\w]+\/[-\w.]+$/.test(repository))throw Error('Exact checked commit/repository required');
 const jobs=[];if(kind!=='code-only')jobs.push({tag:collectionTag,title:'Static header collection '+collectionVersion,assets:collectionAssets,notes:['--notes','Data-only static images. See image license and checksums.'],collection:true});
 if(kind!=='collection-only')jobs.push({tag:version,title:'Manifest '+version,assets:codeAssets,notes:['--notes-file','CHANGELOG.md'],collection:false});
 for(const job of jobs){verifyTag(run,repository,job.tag,commit);const exists=checkedCommand(run,['api',`repos/${repository}/releases/tags/${encodeURIComponent(job.tag)}`],true);if(exists!==null)throw Error('Release already exists; refusing to replace it');}
 for(const job of jobs)checkedCommand(run,['release','create',job.tag,...job.assets,'--repo',repository,'--target',commit,'--draft',...(job.collection?['--latest=false']:[]),'--title',job.title,...job.notes]);
 return jobs.length;
}
