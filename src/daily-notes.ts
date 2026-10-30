import {object,parseJSON} from './json';
import type {FileIO} from './storage';
import type {PlannerSettings} from './settings';
import {dailyFilenameFormat} from './notes';

/** Read-only legacy detection: all owned values, an enabled core module and an
 * actual planner template are required. Ambiguity never grants write permission. */
export async function ownsDailyNotes(io:FileIO,settings:PlannerSettings,configDir:string,root='Planner'){
 try{
  const raw=await io.read(configDir+'/daily-notes.json'),core=await io.read(configDir+'/core-plugins.json');if(!raw||!core)return false;
  const value=JSON.parse(raw) as Record<string,unknown>,plugins:unknown=JSON.parse(core);
  const enabled=Array.isArray(plugins)?plugins.includes('daily-notes'):!!plugins&&typeof plugins==='object'&&(plugins as Record<string,unknown>)['daily-notes']===true;
  const folder=root+'/Journal/'+settings.folders.day,template=root+'/Templates/Obsidian Daily Notes';
  if(!enabled||value.folder!==folder||value.format!==await dailyFilenameFormat(io,folder)||value.template!==template)return false;
  return (await io.read(template+'.md'))?.includes('life-planner')===true;
 }catch{return false;}
}

export async function dailyNotesStartupChoice(io:FileIO,settings:PlannerSettings,configDir:string){
 if(settings.dailyNotes==='disabled'||settings.dailyNotes==='enabled')return settings.dailyNotes;
 return await ownsDailyNotes(io,settings,configDir)?'enabled':'pending';
}

/** Native config files are outside Vault's Markdown index; use the mobile DataAdapter. */
export async function configureDailyNotes(io:FileIO,settings:PlannerSettings,configDir='.obsidian',root='Planner'):Promise<boolean>{
 const daily=configDir+'/daily-notes.json',core=configDir+'/core-plugins.json';
 const beforeDaily=await io.read(daily),beforeCore=await io.read(core);
 const parsed=beforeDaily===null?{}:parseJSON(beforeDaily);
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Daily Notes: некорректные настройки; файл не изменён.');
 const folder=root+'/Journal/'+settings.folders.day;
 const options={...object(parsed),folder,format:await dailyFilenameFormat(io,folder),template:root+'/Templates/Obsidian Daily Notes'};
 let plugins:unknown=beforeCore===null?null:parseJSON(beforeCore);
 if(Array.isArray(plugins)){if(!plugins.every(p=>typeof p==='string'))throw new Error('Некорректный список основных плагинов.');plugins=[...new Set([...plugins,'daily-notes'])];}
 else if(plugins&&typeof plugins==='object'&&Object.values(plugins).every(v=>typeof v==='boolean'))plugins={...plugins,'daily-notes':true};
 else if(plugins!==null)throw new Error('Некорректный список основных плагинов; настройки не изменены.');
 // An absent file means host defaults; do not replace all implicit core plugins.
 const updates:Array<{path:string;before:string|null;value:unknown}>=[{path:daily,before:beforeDaily,value:options},...(beforeCore===null?[]:[{path:core,before:beforeCore,value:plugins}])].filter(u=>u.before===null||JSON.stringify(parseJSON(u.before))!==JSON.stringify(u.value));
 if(!updates.length)return false;
 // Keep complete original files. Recheck sources immediately before each write;
 // DataAdapter has no atomic compare-and-swap, so this is not a filesystem lock.
 const backup=root+'/Data/integration-backups/'+crypto.randomUUID()+'.json';await io.mkdir(root+'/Data/integration-backups');
 const backupText=JSON.stringify(updates.map(u=>({path:u.path,content:u.before})),null,2);await io.write(backup,backupText);
 if(await io.read(backup)!==backupText)throw new Error('Копия настроек Daily Notes не подтверждена.');
 for(const u of updates)if(await io.read(u.path)!==u.before)throw new Error('Настройки Daily Notes изменились во время подключения. Повторите действие.');
 for(const u of updates){if(await io.read(u.path)!==u.before)throw new Error('Настройки Daily Notes изменились во время подключения. Повторите действие.');const text=JSON.stringify(u.value,null,2)+'\n';await io.mkdir(configDir);await io.write(u.path,text);if(await io.read(u.path)!==text)throw new Error('Настройки Daily Notes не сохранились.');}
 return true;
}
