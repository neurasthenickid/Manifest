import {el} from './elements';
import type { EventFields, EventOccurrence } from '../model';
import { assertLocalDate } from '../periods';
import { eventFields } from '../recurrence';

const MINUTE = 60_000;
export const snapMinute = (minute: number): number => Math.round(minute / 15) * 15;
export function wallStamp(time: number): string {
  const stamp = new Date(time).toISOString().slice(0, -1); assertLocalDate(stamp.slice(0, 10)); return stamp;
}
export function rangeFields(date: string, startMinute: number, endMinute: number): Pick<EventFields, 'start' | 'end'> {
  assertLocalDate(date);
  const midnight = Date.parse(`${date}T00:00:00Z`);
  return { start: wallStamp(midnight + startMinute * MINUTE), end: wallStamp(midnight + endMinute * MINUTE) };
}
export function gestureFields(occurrence: EventOccurrence, mode: 'move' | 'resize', date: string, minute: number, grabMinutes: number): EventFields {
  assertLocalDate(date);
  const target = Date.parse(`${date}T00:00:00Z`) + snapMinute(minute) * MINUTE;
  const originalStart = Date.parse(`${occurrence.start}Z`), originalEnd = Date.parse(`${occurrence.end}Z`);
  const start = mode === 'move' ? target - grabMinutes * MINUTE : originalStart;
  const end = mode === 'move' ? start + originalEnd - originalStart : Math.max(target, start + 15 * MINUTE);
  return { ...eventFields(occurrence), start: wallStamp(start), end: wallStamp(end) };
}

/** Mouse gestures supplement forms. Touch retains native scrolling and tap-to-edit. */
function track(node: HTMLElement, start: (event: PointerEvent) => ((event: PointerEvent, finish: boolean) => void) | undefined): () => void {
  let active: { id: number; x: number; y: number; target: HTMLElement; moved: boolean; update: (event: PointerEvent, finish: boolean) => void } | undefined;
  const win=node.ownerDocument.defaultView!;let suppressClick = false;
  const down = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    suppressClick = false;
    const update = start(event); if (update) { active = { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target as HTMLElement, moved: false, update }; node.setPointerCapture(event.pointerId); }
  };
  const move = (event: PointerEvent) => {
    if (!active || active.id !== event.pointerId) return;
    if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 5) return;
    active.moved = true; node.setPointerCapture(event.pointerId); event.preventDefault(); active.update(event, false);
  };
  const up = (event: PointerEvent) => {
    if (!active || active.id !== event.pointerId) return;
    const finished = active; active = undefined;
    if (finished.moved) { event.preventDefault(); suppressClick = true; finished.update(event, true); }
    else if (finished.target !== node) { finished.target.click(); suppressClick = true; }
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
  };
  const cancel = () => { const previous=active;active = undefined;if(previous&&node.hasPointerCapture(previous.id))node.releasePointerCapture(previous.id); };
  const click = (event: MouseEvent) => { if (suppressClick && event.detail !== 0) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); } };
  win.addEventListener('blur',cancel);win.addEventListener('pagehide',cancel);node.addEventListener('pointerdown', down); node.addEventListener('pointermove', move); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', cancel); node.addEventListener('click', click, true);
  return () => { cancel();win.removeEventListener('blur',cancel);win.removeEventListener('pagehide',cancel); node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', cancel); node.removeEventListener('click', click, true); };
}
const scale=(timeline:HTMLElement)=>({start:Number(timeline.dataset.startMinute??0),end:Number(timeline.dataset.endMinute??1440),height:Number(timeline.dataset.hourHeight??40)});
const minuteAt = (timeline: HTMLElement, y: number): number => {const s=scale(timeline);return Math.max(s.start,Math.min(s.end,s.start+(y-timeline.getBoundingClientRect().top)*60/s.height));};
function ghost(timeline: HTMLElement, from: number, to: number): HTMLElement {
  const node = el('div',timeline); node.className = 'lp-selection';
  const s=scale(timeline);node.style.top = `${(from-s.start) * s.height / 60}px`; node.style.height = `${Math.max(10, (to - from) * s.height / 60)}px`; timeline.append(node); return node;
}
export function bindSelection(timeline: HTMLElement, date: string, create: (fields: Pick<EventFields, 'start' | 'end'>) => void): () => void {
  let preview: HTMLElement | undefined;
  const unbind = track(timeline, down => {
    if ((down.target as Element).closest('.lp-event')) return;
    const anchor = minuteAt(timeline, down.clientY);
    return (event, finish) => {
      const cursor = minuteAt(timeline, event.clientY);
      const from = Math.min(1425, Math.floor(Math.min(anchor, cursor) / 15) * 15), to = Math.min(1440, Math.max(from + 15, Math.ceil(Math.max(anchor, cursor) / 15) * 15));
      preview?.remove(); preview = undefined;
      if (finish) create(rangeFields(date, from, to)); else preview = ghost(timeline, from, to);
    };
  });
  const cancel = () => { preview?.remove(); preview = undefined; }; timeline.addEventListener('pointercancel', cancel);timeline.win.addEventListener('blur',cancel);timeline.win.addEventListener('pagehide',cancel);
  return () => { unbind(); cancel(); timeline.removeEventListener('pointercancel', cancel);timeline.win.removeEventListener('blur',cancel);timeline.win.removeEventListener('pagehide',cancel); };
}
export function bindEventGesture(button: HTMLElement, occurrence: EventOccurrence, calendar: HTMLElement, propose: (fields: EventFields) => void, report: (error: unknown) => void): () => void {
  let preview: HTMLElement | undefined;
  const unbind = track(button, down => {
    const timeline = button.closest<HTMLElement>('.lp-timeline')!;
    const mode = (down.target as Element).closest('.lp-resize-handle') ? 'resize' : 'move';
    const sourceDate = timeline.dataset.date!;
    const grab = snapMinute((Date.parse(`${sourceDate}T00:00:00Z`) + minuteAt(timeline, down.clientY) * MINUTE - Date.parse(`${occurrence.start}Z`)) / MINUTE);
    return (event, finish) => {
      preview?.remove(); preview = undefined;
      const target = [...calendar.querySelectorAll<HTMLElement>('.lp-timeline')].find(node => { const rect = node.getBoundingClientRect(); return event.clientX >= rect.left && event.clientX < rect.right; });
      if (!target) return;
      try {
        const fields = gestureFields(occurrence, mode, target.dataset.date!, minuteAt(target, event.clientY), grab);
        if (finish) propose(fields);
        else { const midnight = Date.parse(`${target.dataset.date}T00:00:00Z`); preview = ghost(target, Math.max(0,(Date.parse(`${fields.start}Z`)-midnight)/MINUTE), Math.min(1440,(Date.parse(`${fields.end}Z`)-midnight)/MINUTE)); }
      } catch (error) { if (finish) report(error); }
    };
  });
  const cancel = () => { preview?.remove(); preview = undefined; }; button.addEventListener('pointercancel', cancel);button.win.addEventListener('blur',cancel);button.win.addEventListener('pagehide',cancel);
  return () => { unbind(); cancel(); button.removeEventListener('pointercancel', cancel);button.win.removeEventListener('blur',cancel);button.win.removeEventListener('pagehide',cancel); };
}
