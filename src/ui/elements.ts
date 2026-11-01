export function el<K extends keyof HTMLElementTagNameMap>(tag: K, parent?: HTMLElement, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const node = parent ? parent.createEl(tag) : createEl(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  parent?.append(node); return node;
}
/** Temporary renderer nodes stay detached and belong to the container's document. */
export function detachedEl<K extends keyof HTMLElementTagNameMap>(parent:HTMLElement,tag:K):HTMLElementTagNameMap[K]{return (parent.ownerDocument.defaultView as Window&{createFragment:typeof createFragment}).createFragment().createEl(tag);}
export function button(parent: HTMLElement, text: string, action: () => void, cls = ''): HTMLButtonElement {
  const node = el('button', parent, text, cls); node.type = 'button'; node.addEventListener('click', action); return node;
}
export function field(parent: HTMLElement, title: string, value = '', type = 'text'): HTMLInputElement {
  const label = el('label', parent, undefined, 'lp-field'); el('span', label, title);
  const input = el('input', label); input.type = type; input.value = value; input.setAttribute('aria-label',title); return input;
}
export function select(parent: HTMLElement, title: string, options: readonly {id: string; title: string}[], value: string): HTMLSelectElement {
  const label = el('label', parent, undefined, 'lp-field'); el('span', label, title);
  const input = el('select', label); input.setAttribute('aria-label',title); for (const item of options) { const o = el('option', input, item.title); o.value = item.id; } input.value = value; return input;
}
export function section(parent: HTMLElement, title: string): HTMLElement {const s = el('section', parent, undefined, 'lp-section'); el('h3', s, title); return s;}
export function formatPercent(value: number | null): string { return value === null ? 'нет данных' : value < 100 && value > 99.995 ? '<100%' : `${value.toLocaleString('ru-RU',{maximumFractionDigits:2})}%`; }
