import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(await readFile('release.config.json','utf8')),m=JSON.parse(await readFile('manifest.json','utf8'));
const allowed=[m.version,config.collectionTag];if(!allowed.includes(process.env.TAG_REF))throw Error('Unapproved release tag');
const result=spawnSync(process.execPath,['scripts/publish.mjs',process.env.TAG_REF===config.collectionTag?'--collection-only':'--code-only'],{stdio:'inherit'});process.exit(result.status??1);
