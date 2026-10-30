import {isObject} from '../json';
import type {SyncResult} from './calendar-sync';
import type {TaskSyncResult} from './task-sync';
import type {CloudResult} from './cloud-connection';
const count=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const issues=(v:unknown):boolean=>Array.isArray(v)&&v.every((item:unknown)=>isObject(item)&&typeof item.title==='string'&&typeof item.message==='string'&&(item.id===undefined||typeof item.id==='string'));
export function isEventResult(v:unknown):v is SyncResult{return isObject(v)&&typeof v.at==='string'&&count(v.received)&&count(v.sent)&&count(v.removed)&&issues(v.issues);}
export function isTaskResult(v:unknown):v is TaskSyncResult{return isObject(v)&&typeof v.at==='string'&&['created','updated','received','conflicts','skipped'].every(k=>count(v[k]))&&issues(v.issues);}
export function isCloudResult(v:unknown):v is CloudResult&{lastSuccess?:string}{return isObject(v)&&typeof v.at==='string'&&Array.isArray(v.errors)&&v.errors.every((e:unknown)=>typeof e==='string')&&(v.events===undefined||isEventResult(v.events))&&(v.tasks===undefined||isTaskResult(v.tasks))&&(v.lastSuccess===undefined||typeof v.lastSuccess==='string');}
