import {object,parseJSON} from '../json';
import type {FileIO} from '../storage';
import {normalizeTaskConnection,taskConnectionDefaults,type TaskConnectionSettings} from './task-connection';
/** Shared vault configuration; the password never enters this file. */
export class TaskSettingsFile {
 private source:string|null=null;private loaded=false;readonly path='Planner/Data/task-connection.json';
 constructor(private io:FileIO){}
 async assertCurrent(){if(!this.loaded||await this.io.read(this.path)!==this.source)throw new Error('Настройки OneTask изменились в хранилище. Новые записи остановлены; перечитайте подключение.');}
 async load(){const raw=await this.io.read(this.path);if(raw===null){this.source=null;this.loaded=true;return taskConnectionDefaults();}let data:Record<string,unknown>;try{data=object(parseJSON(raw));if(data.schemaVersion!==1||!data.settings||typeof data.settings!=='object')throw new Error();}catch{throw new Error('Настройки OneTask повреждены. Исходник сохранён; обмен не включён.');}this.source=raw;this.loaded=true;return normalizeTaskConnection(data.settings);}
 async save(settings:TaskConnectionSettings){if(!this.loaded)throw new Error('Настройки OneTask не загружены.');const source=this.source;if(await this.io.read(this.path)!==source)throw new Error('Настройки OneTask изменены другим устройством. Перечитайте данные и повторите.');await this.io.mkdir('Planner/Data');const raw=JSON.stringify({schemaVersion:1,settings:normalizeTaskConnection(settings)},null,2);if(source!==null&&this.io.replace)await this.io.replace(this.path,source,raw);else if(source===null&&this.io.create){if(!await this.io.create(this.path,raw))throw new Error('Настройки созданы другим устройством. Перечитайте их.');}else{if(await this.io.read(this.path)!==source)throw new Error('Настройки изменены во время сохранения.');await this.io.write(this.path,raw);}if(await this.io.read(this.path)!==raw)throw new Error('Настройки OneTask не подтверждены.');this.source=raw;}
}
