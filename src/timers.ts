export type TimerHost=Pick<Window,'setTimeout'|'clearTimeout'>;
export interface TimeoutHandle {cancel():void}
let injectedHost:TimerHost|undefined;
const pending=new Set<TimeoutHandle>();
/** Tests explicitly inject their host; browser runtime never imports Node timers. */
export function configureTimerHost(host:TimerHost){const previous=injectedHost;injectedHost=host;return()=>{injectedHost=previous;};}
export function startTimeout(fn:()=>void,ms:number,host?:TimerHost):TimeoutHandle{
 const source=host??injectedHost??window;
 let done=false;
 const events=source as TimerHost&Partial<Pick<Window,'addEventListener'|'removeEventListener'>>;
 const release=()=>{pending.delete(handle);events.removeEventListener?.('pagehide',cancel);};
 const cancel=()=>{if(done)return;done=true;source.clearTimeout(id);release();};
 const handle:TimeoutHandle={cancel};
 const id=source.setTimeout(()=>{if(done)return;done=true;release();fn();},ms);
 pending.add(handle);events.addEventListener?.('pagehide',cancel,{once:true});return handle;
}
export function stopTimeout(handle:TimeoutHandle|undefined){handle?.cancel();}
/** Plugin unload also cancels timeout guards for outstanding network requests. */
export function disposeTimeouts(){for(const handle of pending)handle.cancel();}
