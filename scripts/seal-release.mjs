import {readFile,readdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {sourceDigest,artifactHashes} from './release-integrity.mjs';
const git=args=>{const r=spawnSync('git',args,{encoding:'utf8'});if(r.status!==0)throw Error('A clean public Git checkout is required to seal a publishable release');return r.stdout.trim();};
const commit=git(['rev-parse','HEAD']);if(commit!==process.env.CHECKED_COMMIT||git(['status','--porcelain','--untracked-files=all']))throw Error('Checkout differs from the workflow checked commit');
const check=JSON.parse(await readFile('test-results/check.json','utf8'));if(check.status!=='PASS'||check.source!==await sourceDigest())throw Error('Sources changed after verification');
for(const [p,h]of Object.entries(check.light))if((await artifactHashes([p]))[p]!==h)throw Error('Light build changed after checks');
const paths=Object.keys(check.light).concat(['dist/SHA256SUMS.txt']);
for(const dir of ['dist/packages','dist/collection'])try{for(const name of await readdir(dir))paths.push(dir+'/'+name);}catch(e){if(e.code!=='ENOENT')throw e;}
await writeFile('dist/verified-source.json',JSON.stringify({schemaVersion:1,commit,source:check.source,artifacts:await artifactHashes(paths)},null,2)+'\n');
