import {readFile} from 'node:fs/promises';
const manifest=JSON.parse(await readFile('manifest.json','utf8')),config=JSON.parse(await readFile('release.config.json','utf8'));
if(!process.env.TAG_REF||![manifest.version,config.collectionTag].includes(process.env.TAG_REF))throw Error('Tag must equal the manifest version or the configured collection tag');
if(process.env.GH_REPO&&process.env.GH_REPO!==config.repository)throw Error('Wrong release repository');
console.log('Exact tag/version agreement: PASS');
