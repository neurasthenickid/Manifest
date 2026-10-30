import {parseJSON} from './json';
import {HeaderCollection} from './headers/collection';
import {githubHeaderSource} from './headers/source';
import {normalizeSettings,type PlannerSettings} from './settings';
import {PlannerViewState} from './view-state';
import {period} from './periods';
import {renderSettingsPanel,disposeSettingsPanel,MODULE_TITLES} from './ui/settings-panel';
import {CALENDAR_VIEW,PlannerCalendarView} from './ui/sidebar';
import {MarkdownRenderChild,Modal,Notice,Plugin,PluginSettingTab,Platform,type WorkspaceLeaf,TFile,TFolder,normalizePath} from 'obsidian';
import { RecordStore, type FileIO } from './storage';
import { NotesService } from './notes';
import {configureDailyNotes,dailyNotesStartupChoice,ownsDailyNotes} from './daily-notes';
import { PlannerWidget } from './ui/widget';
import { button, el, field, select } from './ui/elements';
import { formatDate, parseDate, today } from './periods';
import type { PeriodType, RecordKind } from './model';
import { widgetModule, type WidgetModule } from './ui/modules';
import { acquirePlannerWidth } from './ui/layout';
import {hidePlannerMarkers,bindFreeNotes} from './ui/note-chrome';
import {openFreeNotesEditor} from './ui/native-notes';
import {SingleCalendar} from './ui/calendar-opening';
import {plannerEditorMarkers} from './ui/editor-markers';
import {editorLivePreviewField} from 'obsidian';
import {requestUrl} from 'obsidian';
import {type SecretStore} from './integrations/connection';
import {CloudConnection,CloudAutoSync} from './integrations/cloud-connection';
import {CloudSettingsFile,migrateCloud} from './integrations/cloud-settings';
import {TaskSettingsFile} from './integrations/task-settings';
import {validateRecord} from './domain';

interface AppearanceSettings { accent: string; background: string }

/** No Node/Electron/file-system imports in plugin runtime. */
export default class LifePlannerPlugin extends Plugin {
  store!: RecordStore;
  headers!:HeaderCollection;
  notes!: NotesService;
  cloudConnection!:CloudConnection;private cloudSettings!:CloudSettingsFile;cloudAuto!:CloudAutoSync;
  private io!: FileIO;
  private reloadTimer?: number;
  private alive = true;
  private children = new Set<PlannerChild>();
  settings:PlannerSettings=normalizeSettings({});
  private states=new WeakMap<WorkspaceLeaf,PlannerViewState>();
  private settingsQueue:Promise<unknown>=Promise.resolve();
  private calendarOpening?:SingleCalendar;
  private calendarReady=false;
  private notesReturnCleanup?:()=>void;
  get appearance(){return this.settings;}
  async onload() {
    this.registerEditorExtension(plannerEditorMarkers(state=>state.field(editorLivePreviewField,false)===true));
    const adapter=this.app.vault.adapter,pluginDir=this.manifest.dir??this.app.vault.configDir+'/plugins/life-planner';
    this.headers=new HeaderCollection({read:async p=>await adapter.exists(p)?adapter.read(p):null,write:(p,v)=>adapter.write(p,v),readBinary:async p=>await adapter.exists(p)?adapter.readBinary(p):null,writeBinary:(p,v)=>adapter.writeBinary(p,v),mkdir:async p=>{let path='';for(const part of p.split('/')){path=path?path+'/'+part:part;if(!await adapter.exists(path))await adapter.mkdir(path);}}},pluginDir,githubHeaderSource(async url=>{const r=await requestUrl({url,throw:false});return {status:r.status,arrayBuffer:r.arrayBuffer};}));
    this.register(()=>this.headers.cancel());void this.headers.initialize();
    this.settings=normalizeSettings(await this.loadData());this.applyAppearance();this.addSettingTab(new AppearanceTab(this));this.io = this.vaultIO(); this.store = new RecordStore(this.io); this.notes = new NotesService(this.io,'Planner',()=>this.settings);
    try {await this.store.load();} catch(error){this.notice(error);}
    void this.notes.simplifyStandardNotes().catch(error=>this.notice(error));
    const legacyTasks=new TaskSettingsFile(this.io);try{this.settings.taskConnection=await legacyTasks.load();}catch(e){this.notice(e);}
    let cloudLoadError:unknown;this.cloudSettings=new CloudSettingsFile(this.io);try{this.settings.cloudConnection=await this.cloudSettings.load(migrateCloud(this.settings.calendarConnection,this.settings.taskConnection));}catch(e){this.settings.cloudConnection.enabled=false;cloudLoadError=e;this.notice(e);}
    this.cloudConnection=new CloudConnection(()=>this.settings.cloudConnection,c=>this.saveSettings({...this.settings,cloudConnection:c}),this.io,this.store,async q=>{const r=await requestUrl({...q,throw:false});return{status:r.status,headers:r.headers,text:r.text};},(this.app as unknown as {secretStorage?:SecretStore}).secretStorage,()=>this.settings.areas,()=>this.cloudSettings.assertCurrent());
    if(cloudLoadError)this.cloudConnection.reportError(cloudLoadError);this.cloudAuto=new CloudAutoSync(this.cloudConnection);this.register(()=>{this.cloudAuto.dispose();this.cloudConnection.dispose();});
    this.register(this.store.subscribe(change=>{if(change?.records.some(r=>r.kind==='event'||r.kind==='task'))this.cloudAuto.trigger();}));
    void this.cloudConnection.restore().then(()=>this.cloudAuto.trigger()).catch(e=>this.notice(e));
    this.addCommand({id:'sync-cloud',name:'Синхронизировать связь с облаком',callback:()=>{void this.cloudConnection.sync().then(()=>new Notice(this.cloudConnection.status)).catch(e=>this.notice(e));}});
    const automatic=()=>{if(this.alive&&!document.hidden)this.cloudAuto.trigger();};
    this.registerInterval(window.setInterval(automatic,60_000));this.registerDomEvent(window,'focus',automatic);this.registerDomEvent(window,'online',automatic);
    this.registerDomEvent(document,'visibilitychange',()=>{if(!document.hidden)automatic();});
    this.addRibbonIcon('calendar-days','Manifest · Сегодня',()=>{void this.openPeriod('day',today()).catch(e=>this.notice(e));});
    this.registerView(CALENDAR_VIEW,leaf=>new PlannerCalendarView(leaf,this));
    this.addCommand({id:'open-calendar',name:'Открыть боковой календарь',callback:()=>{void this.openCalendar().catch(e=>this.notice(e));}});
    this.app.workspace.onLayoutReady(()=>{if(!this.alive)return;this.calendarReady=true;void this.calendar().startup(this.settings.sidebar,Platform.isMobile).catch(e=>this.notice(e));void this.restoreDailyNotesChoice().catch(e=>this.notice(e));});
    this.addCommand({id:'connect-daily-notes',name:'Подключить дневные заметки к Daily Notes',callback:()=>{void this.connectDailyNotes().catch(e=>this.notice(e));}});
    this.addCommand({id:'open-today',name:'Открыть сегодня',callback:()=>{void this.openPeriod('day',today()).catch(e=>this.notice(e));}});
    this.addCommand({id:'open-period',name:'Открыть период по дате',callback:()=>this.periodPicker()});
    this.addCommand({id:'reload-data',name:'Перечитать данные',callback:()=>{void this.store.reload().then(()=>new Notice('Данные перечитаны')).catch(e=>this.notice(e));}});
    this.addCommand({id:'export-data',name:'Экспортировать данные',callback:()=>{void this.exportData().catch(e=>this.notice(e));}});
    this.addCommand({id:'recover-data',name:'Восстановить запись из копии',callback:()=>{void this.recovery().catch(e=>this.notice(e));}});
    this.registerMarkdownCodeBlockProcessor('life-planner',(source,container,ctx)=>{
      if(this.notes.isTemplate(ctx.sourcePath)){container.classList.add('lp-template-description');el('p',container,'Блок: '+(MODULE_TITLES[source.trim()]??(source.trim()||'Все виджеты'))+'. Состав и порядок меняются в настройках Manifest; обычный текст ниже — шаблон новых заметок.');return;}
      let module:WidgetModule;try{module=widgetModule(source);}catch(error){el('p',container,String(error),'lp-error');return;}
      const child=new PlannerChild(container,this,ctx.sourcePath,module);this.children.add(child);ctx.addChild(child);
    });
    this.registerMarkdownPostProcessor((container,ctx)=>{const file=this.app.vault.getAbstractFileByPath(ctx.sourcePath);if(!this.notes.isTemplate(ctx.sourcePath)&&(ctx.sourcePath.startsWith('Planner/Journal/')||file instanceof TFile&&this.app.metadataCache.getFileCache(file)?.frontmatter?.['life-planner-type'])){hidePlannerMarkers(container);bindFreeNotes(container,()=>{void this.editFreeNotes(ctx.sourcePath,container).catch(e=>this.notice(e));});}});
    const reload = (path:string)=>{
      if(path===this.cloudSettings.path||path.startsWith('Planner/Data/cloud-connection-history/')){window.setTimeout(()=>{if(this.alive)void this.cloudSettings.load().then(s=>{this.settings.cloudConnection=s;this.cloudConnection.settingsChanged();return this.cloudConnection.restore();}).then(()=>this.cloudAuto.trigger()).catch(e=>{this.settings.cloudConnection.enabled=false;this.cloudConnection.settingsChanged();this.cloudConnection.reportError(e);this.notice(e);});},250);return;}
      if(path.startsWith('Planner/Data/task-revisions/')||path.startsWith('Planner/Data/event-revisions/')){window.clearTimeout(this.reloadTimer);this.reloadTimer=window.setTimeout(()=>{if(this.alive)void this.store.reload().catch(e=>this.notice(e));},250);return;}
      if(!path.startsWith('Planner/Data/records/'))return;
      window.clearTimeout(this.reloadTimer);
      this.reloadTimer=window.setTimeout(()=>{if(this.alive)void this.store.reload().catch(e=>this.notice(e));},250);
    };
    this.registerEvent(this.app.vault.on('modify',file=>reload(file.path)));
    this.registerEvent(this.app.vault.on('create',file=>reload(file.path)));
    this.registerEvent(this.app.vault.on('delete',file=>reload(file.path)));
    this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{reload(file.path);reload(oldPath);}));
    this.register(()=>{this.alive=false;this.notesReturnCleanup?.();window.clearTimeout(this.reloadTimer);for(const child of this.children)child.unload();this.children.clear();});
  }
  applyAppearance(){for(const node of document.querySelectorAll<HTMLElement>('.life-planner')){if(!node.dataset.style||node.dataset.style==='plain')node.style.setProperty('--lp-accent',this.appearance.accent);if(this.appearance.background)node.style.setProperty('--lp-background',this.appearance.background);else node.style.removeProperty('--lp-background');}}
  async saveAppearance(next:AppearanceSettings){await this.saveSettings({...this.settings,...next});}
  private dailyIO():FileIO{const a=this.app.vault.adapter;return {read:async p=>await a.exists(p)?a.read(p):null,write:(p,t)=>a.write(p,t),list:async()=>[],mkdir:async p=>{let path='';for(const part of p.split('/')){path=path?path+'/'+part:part;if(!await a.exists(path))await a.mkdir(path);}}};}
  private async restoreDailyNotesChoice(){const choice=await dailyNotesStartupChoice(this.dailyIO(),this.settings,this.app.vault.configDir);if(choice!==this.settings.dailyNotes)await this.saveSettings({...this.settings,dailyNotes:choice});}
  async connectDailyNotes(){
    await this.notes.ensureFoundation();const io=this.dailyIO();
    if(await configureDailyNotes(io,this.settings,this.app.vault.configDir))new Notice('Daily Notes подключён к дневным заметкам планировщика. Перезапустите Obsidian, чтобы он прочитал новые настройки.',12000);
    await this.saveSettings({...this.settings,dailyNotes:'enabled'});
  }
  async saveSettings(next:PlannerSettings){
    const previous=this.settings,normalized=normalizeSettings(next);const cloudChanged=JSON.stringify(previous.cloudConnection)!==JSON.stringify(normalized.cloudConnection);if(cloudChanged)await this.cloudSettings.save(normalized.cloudConnection);this.settings=normalized;if(cloudChanged){this.cloudConnection?.settingsChanged();this.cloudAuto?.trigger();}this.applyAppearance();for(const child of this.children)child.refresh();
    const layoutChanged=JSON.stringify(previous.layouts)!==JSON.stringify(normalized.layouts);
    this.settingsQueue=this.settingsQueue.catch(()=>undefined).then(async()=>{await this.saveData(normalized);if(layoutChanged)await this.notes.syncLayouts();if(normalized.dailyNotes==='enabled'&&previous.folders.day!==normalized.folders.day&&await ownsDailyNotes(this.dailyIO(),previous,this.app.vault.configDir))await configureDailyNotes(this.dailyIO(),normalized,this.app.vault.configDir);if(this.calendarReady)await this.calendar().settingsChanged(previous.sidebar,normalized.sidebar,Platform.isMobile);for(const leaf of this.app.workspace.getLeavesOfType(CALENDAR_VIEW))if(leaf.view instanceof PlannerCalendarView)leaf.view.render();});
    await this.settingsQueue;
  }
  private mainLeaf(){const recent=this.app.workspace.getMostRecentLeaf();return recent?.view.getViewType()==='markdown'?recent:this.app.workspace.getLeavesOfType('markdown')[0]??this.app.workspace.getLeaf('tab');}
  stateForActive(){return this.stateForLeaf(this.mainLeaf());}
  private stateForLeaf(leaf:WorkspaceLeaf){let state=this.states.get(leaf);if(!state){state=new PlannerViewState();this.states.set(leaf,state);}return state;}
  leafFor(container:HTMLElement){return this.app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.containerEl.contains(container))??this.mainLeaf();}
  stateFor(container:HTMLElement){return this.stateForLeaf(this.leafFor(container));}
  private calendar(){return this.calendarOpening??=new SingleCalendar(this.app.workspace,CALENDAR_VIEW,()=>this.settings.sidebar.side);}
  async openCalendar(reveal=true){await this.calendar().open(reveal);}
  async editFreeNotes(path:string,container?:HTMLElement){
    const file=this.app.vault.getAbstractFileByPath(path);if(!(file instanceof TFile))throw new Error('Заметка не найдена.');
    const leaf=container?this.leafFor(container):this.app.workspace.getLeavesOfType('markdown').find(l=>l.getViewState().state?.file===path)??this.mainLeaf();
    await openFreeNotesEditor(leaf,file,target=>this.app.workspace.revealLeaf(target));
    this.notesReturnCleanup?.();const view=leaf.view as import('obsidian').MarkdownView;
    if(typeof view.addAction==='function'){
      const action=view.addAction('book-open','Показать запись',()=>{const state=leaf.getViewState();if(state.state?.file!==path)return;void leaf.setViewState({...state,state:{...state.state,mode:'preview'},active:true}).then(()=>this.notesReturnCleanup?.()).catch(e=>this.notice(e));});
      action.classList.add('lp-notes-return');const ref=this.app.workspace.on('file-open',opened=>{if(opened?.path!==path)this.notesReturnCleanup?.();});
      this.notesReturnCleanup=()=>{action.remove();this.app.workspace.offref(ref);this.notesReturnCleanup=undefined;};
    }
  }
  async editTemplate(type:PeriodType){const path=await this.notes.template(type);const leaf=this.mainLeaf();await leaf.setViewState({type:'markdown',state:{file:path,mode:'source'},active:true});}
  preview(type:PeriodType){
    const modal=new Modal(this.app);modal.modalEl.classList.add('lp-layout-preview');el('h2',modal.contentEl,'Предпросмотр · '+type);el('p',modal.contentEl,'Предпросмотр без записи данных.');
    const widgets:PlannerWidget[]=[],view=new PlannerViewState();
    const store={all:()=>[],get:()=>undefined,subscribe:()=>()=>{},save:async()=>{throw new Error('Предпросмотр не записывает данные.');}} as unknown as import('./model').PlannerStore;
    widgets.push(new PlannerWidget(el('div',modal.contentEl),store,period(type,today()),{headerCollection:this.headers,view,settings:()=>this.settings,resolveMedia:(file,builtin)=>builtin?(this.headers.resolve(file)?this.app.vault.adapter.getResourcePath(this.headers.resolve(file)!):undefined):this.app.vault.adapter.getResourcePath(file),openPeriod:async()=>{},openNote:async()=>{},openArea:async()=>{},exportData:async()=>{},recover:async()=>{},issues:()=>[]},'all'));
    const close=modal.onClose.bind(modal);modal.onClose=()=>{for(const w of widgets)w.destroy();close();};modal.open();
  }
  releaseChild(child:PlannerChild){this.children.delete(child);}
  private notice(error:unknown){new Notice(error instanceof Error?error.message:String(error),10000);}
  private vaultIO():FileIO {
    const vault=this.app.vault;
    const safe=(path:string)=>{const normalized=normalizePath(path);if(normalized.startsWith('/')||normalized.split('/').includes('..')||/^[A-Za-z]:/.test(path))throw new Error('Путь должен находиться внутри vault.');return normalized;};
    const mkdir=async(path:string)=>{
      const parts=safe(path).split('/');let current='';
      for(const part of parts){if(!part)continue;current=current?`${current}/${part}`:part;const found=vault.getAbstractFileByPath(current);if(found instanceof TFile)throw new Error(`Вместо папки найден файл: ${current}`);if(!found){try{await vault.createFolder(current);}catch(error){if(!(vault.getAbstractFileByPath(current) instanceof TFolder))throw error;}}}
    };
    return {
      read:async path=>{const file=vault.getAbstractFileByPath(safe(path));if(!file)return null;if(!(file instanceof TFile))throw new Error(`Ожидался файл: ${path}`);return vault.read(file);},
      mkdir,
      list:async prefix=>{const p=prefix?safe(prefix).replace(/\/$/,'')+'/':'';return vault.getFiles().map(f=>f.path).filter(path=>!p||path.startsWith(p));},
      create:async(path,text)=>{const p=safe(path);if(vault.getAbstractFileByPath(p))return false;try{await vault.create(p,text);return true;}catch(error){if(vault.getAbstractFileByPath(p))return false;throw error;}},
      write:async(path,text)=>{const p=safe(path),file=vault.getAbstractFileByPath(p);if(file instanceof TFile)await vault.modify(file,text);else if(file)throw new Error('Путь занят папкой.');else await vault.create(p,text);},
      replace:async(path,expected,text)=>{const file=vault.getAbstractFileByPath(safe(path));if(!(file instanceof TFile))throw new Error('Файл исчез до сохранения.');await vault.process(file,current=>{if(current!==expected)throw new Error('Конфликт: файл изменился до записи. Обновите данные.');return text;});}
    };
  }
  async openPeriod(type:PeriodType,date:string,leaf?:WorkspaceLeaf){const target=leaf??this.mainLeaf();this.stateForLeaf(target).setDate(date);const path=await this.notes.ensurePeriod(type,date);await this.openNote(path,target);}
  async openArea(id:string){await this.openNote(await this.notes.areaNote(id));}
  async openNote(path:string,leaf?:WorkspaceLeaf){await this.notes.ensureFoundation();const file=this.app.vault.getAbstractFileByPath(path);if(!(file instanceof TFile))throw new Error(`Не найдена заметка: ${path}`);await (leaf??this.mainLeaf()).openFile(file);}
  private periodPicker(){
    const modal=new Modal(this.app);el('h2',modal.contentEl,'Открыть период');
    const type=select(modal.contentEl,'Период',[{id:'day',title:'День'},{id:'week',title:'Неделя'},{id:'month',title:'Месяц'},{id:'quarter',title:'Квартал'},{id:'year',title:'Год'}],'day');
    const date=field(modal.contentEl,'Дата (ДД-ММ-ГГГГ)',formatDate(today()));const error=el('p',modal.contentEl,'','lp-error');
    const open=button(modal.contentEl,'Открыть',()=>{open.disabled=true;void Promise.resolve().then(()=>this.openPeriod(type.value as PeriodType,parseDate(date.value.trim()))).then(()=>modal.close()).catch(e=>{error.textContent=String(e);}).finally(()=>{open.disabled=false;});});
    modal.open();
  }
  async exportData(){
    if(!this.store.ready||this.store.issues.length)throw new Error('Сначала устраните ошибки чтения. Экспорт неполных данных не создаётся.');
    const kinds:RecordKind[]=['task','event','visibility','day-rating','area-rating','daily-area-rating','definition','checkin'];
    const records=kinds.flatMap(kind=>this.store.all(kind));const stamp=new Date().toISOString().replace(/[:.]/g,'-');const folder='Planner/Exports';await this.io.mkdir(folder);
    const json=JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),records},null,2);
    await this.io.create!(`${folder}/${stamp}.json`,json);
    const lines=['# Manifest — экспорт',`\nДата: ${formatDate(today())}`,'\n## Задачи',...this.store.all('task').map(t=>`- [${t.status==='done'?'x':' '}] ${t.title} (${t.areaId})${t.plannedDate?` · план ${formatDate(t.plannedDate)}`:''}${t.dueDate?` · срок ${formatDate(t.dueDate)}`:''} — ID ${t.id}`),'\n## События',...this.store.all('event').filter(e=>!e.deleted).map(e=>`- ${e.start} — ${e.end}: ${e.title} (${e.timezone})`),'\nОстальные записи и история — в соседнем JSON. Обычный Markdown хранится в исходных заметках.'];
    const path=`${folder}/${stamp}.md`;await this.io.create!(path,lines.join('\n'));await this.openNote(path);
  }
  async recovery(){
    const modal=new Modal(this.app);el('h2',modal.contentEl,'Восстановление записи');el('p',modal.contentEl,'Выберите предыдущую версию. Текущий файл будет сохранён в recovery-originals.');
    const ids=new Set([...this.store.issues.map(i=>i.id).filter((id):id is string=>!!id),...(['task','event','visibility','day-rating','area-rating','daily-area-rating','definition','checkin'] as const).flatMap(k=>this.store.all(k).map(r=>r.id))]);
    const status=el('p',modal.contentEl);let found=false;
    for(const id of ids){for(const path of await this.store.backups(id)){let label=`${id} · ${path.split('/').at(-1)}`;try{const backup=parseJSON(await this.io.read(path)??'null');validateRecord(backup);if(backup.kind==='task')label=`${backup.title} · ${backup.status==='done'?'выполнено':backup.status==='doing'?'в работе':'не выполнено'} · ${this.settings.areas.find(a=>a.id===backup.areaId)?.title??backup.areaId} · версия ${backup.version}`+(backup.plannedDate?' · план '+formatDate(backup.plannedDate):'')+(backup.dueDate?' · срок '+formatDate(backup.dueDate):'')+(backup.description?' · '+backup.description.slice(0,120):'');}catch{continue;}found=true;button(modal.contentEl,label,()=>{void this.store.recover(id,path).then(()=>{modal.close();new Notice('Запись восстановлена');}).catch(e=>{status.textContent=String(e);});});}}
    if(!found)el('p',modal.contentEl,'Проверенных предыдущих версий пока нет. Исходные файлы сохранены; не заменяйте их пустыми данными.');modal.open();
  }
}

class AppearanceTab extends PluginSettingTab {
 constructor(private plugin:LifePlannerPlugin){super(plugin.app,plugin);}
 hide(){disposeSettingsPanel(this.containerEl);}
 display(){renderSettingsPanel(this.containerEl,{get:()=>this.plugin.settings,save:s=>this.plugin.saveSettings(s),connectDailyNotes:()=>this.plugin.connectDailyNotes(),template:type=>this.plugin.editTemplate(type),preview:type=>this.plugin.preview(type),openCalendar:()=>this.plugin.openCalendar(),sync:()=>this.plugin.notes.syncLayouts(),export:()=>this.plugin.exportData(),recover:()=>this.plugin.recovery(),store:this.plugin.store,headers:this.plugin.headers,openArea:id=>this.plugin.openArea(id),cloudConnection:this.plugin.cloudConnection,cloudAuto:this.plugin.cloudAuto});}
}

class PlannerChild extends MarkdownRenderChild {
  private widget?:PlannerWidget;
  private releaseWidth?:()=>void;
  private disposed=false;
  constructor(container:HTMLElement,private plugin:LifePlannerPlugin,private path:string,private module:WidgetModule){super(container);}
  refresh(){this.widget?.render();this.plugin.applyAppearance();}
  onload(){void this.mount();}
  private async mount(){
    try{const context=await this.plugin.notes.context(this.path);if(this.disposed)return;this.releaseWidth=acquirePlannerWidth(this.containerEl);this.widget=new PlannerWidget(this.containerEl,this.plugin.store,context,{
      headerCollection:this.plugin.headers,view:this.plugin.stateFor(this.containerEl),settings:()=>this.plugin.settings,saveSettings:next=>this.plugin.saveSettings(next),resolveMedia:(file,builtin)=>{if(builtin){const path=this.plugin.headers.resolve(file);return path?this.plugin.app.vault.adapter.getResourcePath(path):undefined;}const f=this.plugin.app.vault.getAbstractFileByPath(file);return f instanceof TFile?this.plugin.app.vault.getResourcePath(f):undefined;},openPeriod:(type,date)=>this.plugin.openPeriod(type,date,this.plugin.leafFor(this.containerEl)),openNote:path=>this.plugin.openNote(path),openArea:id=>this.plugin.openArea(id),exportData:()=>this.plugin.exportData(),recover:()=>this.plugin.recovery(),issues:()=>this.plugin.store.issues.map(i=>`${i.path}: ${i.message}`)
    },this.module);this.plugin.applyAppearance();}catch(e){if(!this.disposed)el('p',this.containerEl,`Manifest: ${e instanceof Error?e.message:String(e)}`,'lp-error');}
  }
  onunload(){this.disposed=true;this.widget?.destroy();this.releaseWidth?.();this.plugin.releaseChild(this);}
}
