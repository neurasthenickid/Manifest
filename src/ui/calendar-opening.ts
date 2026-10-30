import type {Workspace, WorkspaceItem,WorkspaceLeaf} from 'obsidian';
export interface CalendarPreferences {enabled:boolean;side:'left'|'right'}
/** Restored background leaves may still have DeferredView. Inspect saved type too. */
export class SingleCalendar {
 private pending?:Promise<WorkspaceLeaf|undefined>;
 private creating?:WorkspaceLeaf;
 private generation=0;
 private started=false;
 constructor(private workspace:Workspace,private type:string,private side:()=> 'left'|'right'){}
 /** One layout-ready attempt per plugin instance. Mobile drawers remain user-controlled. */
 async startup(preferences:CalendarPreferences,mobile:boolean){
  if(this.started)return;this.started=true;
  if(!preferences.enabled||mobile)return;
  await this.open('background');
 }
 async settingsChanged(previous:CalendarPreferences,next:CalendarPreferences,mobile:boolean){
  if(!next.enabled){if(previous.enabled)this.close();return;}
  const moved=previous.side!==next.side;
  if(moved)this.close();
  if(moved||!previous.enabled)await this.open(mobile?false:'background');
 }
 close(){
  this.generation++;this.pending=undefined;
  const leaves=this.calendars();if(this.creating)leaves.add(this.creating);
  for(const leaf of leaves)leaf.detach();this.creating=undefined;
 }
 open(reveal:boolean|'background'=true):Promise<void>{
  const generation=this.generation;
  if(!this.pending){
   const operation=this.ensure(generation);this.pending=operation;
   void operation.then(()=>{if(this.pending===operation)this.pending=undefined;},()=>{if(this.pending===operation)this.pending=undefined;});
  }
  return this.pending.then(async leaf=>{if(!leaf||generation!==this.generation||!reveal)return;await leaf.loadIfDeferred?.();if(generation!==this.generation)return;
   if(reveal==='background')await this.showWithoutFocus(leaf);else await this.workspace.revealLeaf(leaf);
  });
 }
 private calendars(){
  const calendars=new Set(this.workspace.getLeavesOfType(this.type));
  this.workspace.iterateAllLeaves(candidate=>{if(candidate.getViewState().type===this.type)calendars.add(candidate);});
  return calendars;
 }
 private async ensure(generation:number):Promise<WorkspaceLeaf|undefined>{
  const calendars=this.calendars();
  let leaf:WorkspaceLeaf|undefined=[...calendars][0];
  // Reparenting leaves is not a public Obsidian API. Only an explicit side change
  // (or restoration on the wrong side) replaces our view; unrelated saves reuse it.
  if(leaf&&this.otherSide(leaf)){for(const existing of calendars)existing.detach();leaf=undefined;}
  if(leaf){for(const extra of calendars)if(extra!==leaf)extra.detach();return leaf;}
  const created=this.side()==='left'?this.workspace.getLeftLeaf(false):this.workspace.getRightLeaf(false);
  if(!created)throw new Error('Не удалось создать боковую вкладку календаря.');
  leaf=created;this.creating=leaf;
  try{await leaf.setViewState({type:this.type,active:false});if(generation!==this.generation){leaf.detach();return;}return leaf;}
  catch(error){leaf.detach?.();throw error;}
  finally{if(this.creating===leaf)this.creating=undefined;}
 }
 private otherSide(leaf:WorkspaceLeaf){
  const seen=new Set<WorkspaceItem>();let item:WorkspaceItem|undefined=leaf;
  while(item&&!seen.has(item)){seen.add(item);if(item===this.workspace.leftSplit)return this.side()!=='left';if(item===this.workspace.rightSplit)return this.side()!=='right';item=item.parent;}
  return false;
 }
 private async showWithoutFocus(leaf:WorkspaceLeaf){
  // revealLeaf selects the sidebar tab. Restore the note only if the API activated
  // this calendar, never if the user switched to a different note while awaiting it.
  const active=this.workspace.activeLeaf,doc=this.workspace.containerEl?.ownerDocument,focused=doc?.activeElement;
  await this.workspace.revealLeaf(leaf);
  if(active&&active!==leaf&&this.workspace.activeLeaf===leaf)this.workspace.setActiveLeaf(active,{focus:false});
  if(focused&&'focus' in focused&&focused.isConnected&&doc?.activeElement!==focused&&
   (doc?.activeElement===doc?.body||!!doc?.activeElement&&leaf.view?.containerEl?.contains(doc.activeElement)))(focused as HTMLElement).focus({preventScroll:true});
 }
}
