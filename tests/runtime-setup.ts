import {setTimeout,clearTimeout} from 'node:timers';
import {configureTimerHost} from '../src/timers';
let next=0;const handles=new Map<number,ReturnType<typeof setTimeout>>();
configureTimerHost({setTimeout:(fn,ms)=>{const id=++next;handles.set(id,setTimeout(()=>{handles.delete(id);if(typeof fn==='function')fn();},ms));return id;},clearTimeout:id=>{if(id!==undefined){clearTimeout(handles.get(id));handles.delete(id);}}});
