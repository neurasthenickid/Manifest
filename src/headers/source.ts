import {object} from '../json';
import {startTimeout,stopTimeout} from '../timers';
import config from '../../release.config.json';
import type {HeaderSource} from './collection';
export type HeaderRequest=(url:string)=>Promise<{status:number;arrayBuffer:ArrayBuffer}>;
export interface HeaderRelease {repository:string|null;collectionTag:string;manifestAsset:string;collectionVersion?:string;author?:string|null;codeLicense?:string|null;imageLicense?:string|null}
/** Data-only GitHub releases and tags, never executable updates or credentials. */
export function githubHeaderSource(request:HeaderRequest,release:HeaderRelease=config):HeaderSource{
 let selectedTag=release.collectionTag;
 const stopped=(signal?:AbortSignal)=>{if(signal?.aborted)throw new Error('cancelled');};
 const validate=()=>{if(!release.repository||!/^[-a-zA-Z0-9_]+\/[-a-zA-Z0-9_.]+$/.test(release.repository)||!/^headers-\d+\.\d+\.\d+$/.test(release.collectionTag)||!/^[-a-z0-9]+\.json$/.test(release.manifestAsset))throw new Error('source not configured');};
 const requestData=async(url:string,signal?:AbortSignal)=>{stopped(signal);let timer:ReturnType<typeof startTimeout>|undefined;try{const r=await Promise.race([request(url),new Promise<never>((_,reject)=>{timer=startTimeout(()=>reject(new Error('network timeout')),45_000);})]);stopped(signal);return r;}finally{stopTimeout(timer);}};
 const read=async(tag:string,asset:string,signal?:AbortSignal)=>{validate();const r=await requestData(`https://github.com/${release.repository}/releases/download/${tag}/${asset}`,signal);if(r.status!==200)throw new Error(`Сервер коллекции вернул ошибку ${r.status}. Повторите позже.`);return r.arrayBuffer;};
 return {manifest:async signal=>{validate();let tag=release.collectionTag;try{const r=await requestData(`https://api.github.com/repos/${release.repository}/git/matching-refs/tags/headers-`,signal);if(r.status===200&&r.arrayBuffer.byteLength<=512_000){const refs:unknown=JSON.parse(new TextDecoder().decode(r.arrayBuffer));if(Array.isArray(refs)){const tags=refs.map(v=>object(v).ref).filter((v):v is string=>typeof v==='string'&&/^refs\/tags\/headers-\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(v)).map(v=>v.slice(10));tags.push(tag);tags.sort((a,b)=>{const x=a.slice(8).split('.').map(Number),y=b.slice(8).split('.').map(Number);return y[0]-x[0]||y[1]-x[1]||y[2]-x[2];});tag=tags[0];}}}catch{stopped(signal);/* Tags unavailable: retain the explicitly configured release. */}let bytes:ArrayBuffer;try{bytes=await read(tag,release.manifestAsset,signal);}catch(error){stopped(signal);if(tag===release.collectionTag)throw error;tag=release.collectionTag;bytes=await read(tag,release.manifestAsset,signal);}stopped(signal);selectedTag=tag;return bytes;},image:(sha,signal)=>{if(!/^[a-f0-9]{64}$/.test(sha))return Promise.reject(new Error('Invalid object'));return read(selectedTag,'h-'+sha+'.webp',signal);}};
}
