import {defaultAreas,areaOptions} from '../areas';
import {type LifeArea,type PlannerStore} from '../model';
import type {CalendarConnection,CalendarConnectionSettings} from '../integrations/connection';
import {button,el,field,select} from './elements';
export function renderCalendarConnection(host:HTMLElement,connection:CalendarConnection,get:()=>CalendarConnectionSettings,save:(s:CalendarConnectionSettings)=>Promise<void>,store:PlannerStore,areas:()=>LifeArea[]=defaultAreas){
 host.replaceChildren();const s=get();el('h3',host,'Яндекс Календарь');
 el('p',host,'Начните с отдельного календаря «Manifest — тест». Проверка подключения только получает список календарей.');
 const login=field(host,'Почта Яндекса',s.username);login.autocomplete='username';
 const password=field(host,'Пароль приложения «Календарь»','','password');password.autocomplete='new-password';
 const rememberLabel=el('label',host,undefined,'lp-setting-row'),remember=el('input',rememberLabel);remember.type='checkbox';remember.checked=!!connection.secrets;remember.disabled=!connection.secrets;el('span',rememberLabel,'Сохранить пароль в хранилище секретов Obsidian');
 if(!connection.secrets)el('small',host,'В этой версии Obsidian пароль действует до закрытия приложения. Для сохранения нужен Obsidian 1.11.4+.');
 const status=el('p',host,connection.status,'lp-muted');status.setAttribute('role','status');
 const lock=(value:boolean)=>{for(const e of host.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select'))e.disabled=value;if(!value)remember.disabled=!connection.secrets;};
 const run=(work:()=>Promise<unknown>)=>{lock(true);status.textContent='Подождите…';void work().then(()=>{if(host.isConnected)renderCalendarConnection(host,connection,get,save,store,areas);}).catch(e=>{status.textContent=e instanceof Error?e.message:String(e);lock(false);});};
 login.addEventListener('change',()=>run(async()=>{if(login.value.trim()!==get().username){await save({...get(),username:login.value.trim(),calendarUrl:'',secretId:'',auto:false});connection.calendars=[];}}));
 button(host,'Проверить подключение',()=>run(async()=>{if(password.value){await connection.password(password.value,remember.checked);password.value='';}await connection.discover();}));
 const calendars=connection.calendars.filter(c=>!c.components.length||c.components.includes('VEVENT'));
 const choices=[{id:'',title:'Выберите календарь'},...calendars.map(c=>({id:c.url,title:c.title}))];if(s.calendarUrl&&!choices.some(c=>c.id===s.calendarUrl))choices.push({id:s.calendarUrl,title:'Ранее выбранный календарь'});
 const calendar=select(host,'Календарь для обмена',choices,s.calendarUrl);calendar.addEventListener('change',()=>run(()=>save({...get(),calendarUrl:calendar.value,auto:false})));
 for(const c of connection.calendars)el('small',host,`${c.title}: `+(c.components.includes('VTODO')?'сервер заявил поддержку списков дел; совместимость ещё проверяется.':'поддержка списков дел сервером не заявлена.'));
 const area=select(host,'Сфера для новых событий из Яндекса',[{id:'',title:'Выберите сферу'},...areaOptions(areas(),s.areaId||undefined)],s.areaId);area.addEventListener('change',()=>run(()=>save({...get(),areaId:area.value})));
 const mode=select(host,'Обмен событиями',[{id:'read',title:'Только получать из Яндекса'},{id:'both',title:'Получать и отправлять изменения'}],s.mode);mode.addEventListener('change',()=>run(()=>save({...get(),mode:mode.value as 'read'|'both'})));
 el('small',host,'Двусторонний обмен изменяет только уже связанные события. Остальные локальные события отправляются по одному, по вашему выбору. Повторы и встречи с участниками в этой первой версии не передаются.');
 const autoLabel=el('label',host,undefined,'lp-setting-row'),auto=el('input',autoLabel);auto.type='checkbox';auto.checked=s.auto;el('span',autoLabel,'Обновлять каждую минуту, пока Obsidian открыт');auto.addEventListener('change',()=>run(()=>save({...get(),auto:auto.checked})));
 button(host,'Синхронизировать сейчас',()=>run(()=>connection.sync()));
 if(s.mode==='both'){const events=store.all('event').filter(e=>!e.deleted&&!e.recurrence&&!e.exceptions);const event=select(host,'Локальное событие для отправки',[{id:'',title:'Выберите событие'},...events.map(e=>({id:e.id,title:e.title+' · '+e.start.replace('T',' ')}))],'');button(host,'Отправить выбранное событие',()=>run(()=>connection.publish(event.value)));}
 if(connection.result){el('small',host,'Последний успешный обмен: '+new Date(connection.result.at).toLocaleString('ru-RU'));for(const issue of connection.result.issues){const row=el('div',host,undefined,'lp-connection-issue');el('strong',row,issue.title);el('p',row,issue.message);if(issue.conflict&&issue.id){button(row,'Взять версию Яндекса',()=>run(()=>connection.resolve(issue.id!,'remote')));if(s.mode==='both')button(row,'Оставить версию плагина',()=>run(()=>connection.resolve(issue.id!,'local')));}}}
 button(host,'Отключить Яндекс',()=>run(()=>connection.disconnect()));lock(connection.busy);
}
