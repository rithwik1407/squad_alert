/** Per-device accent colour. Stored in localStorage and applied as <html data-accent>. index.html applies it before first paint. */
export const ACCENTS = [
  { id: 'ember', label: 'Ember', rgb: '255 138 31' },
  { id: 'cyan', label: 'Neon cyan', rgb: '34 211 238' },
  { id: 'lime', label: 'Neon lime', rgb: '163 230 53' },
  { id: 'pink', label: 'Neon pink', rgb: '236 72 153' },
  { id: 'violet', label: 'Violet', rgb: '139 92 246' },
  { id: 'red', label: 'Red', rgb: '239 68 68' },
] as const;
export type AccentId = (typeof ACCENTS)[number]['id'];
const KEY = 'squadsync-accent';

export function getAccent(): AccentId {
  try {
    const v = localStorage.getItem(KEY);
    return ACCENTS.some((a) => a.id === v) ? (v as AccentId) : 'ember';
  } catch {
    return 'ember';
  }
}

export function setAccent(id: AccentId) {
  try { localStorage.setItem(KEY, id); } catch { /* private mode: still apply for this visit */ }
  if (id === 'ember') document.documentElement.removeAttribute('data-accent');
  else document.documentElement.setAttribute('data-accent', id);
}
