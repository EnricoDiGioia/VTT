// Painel lateral (PC) / gaveta inferior (celular) e abas.
import { emit } from '../state.js';
import { $, $$ } from './dom.js';

let tab = 'chat';
const mq = matchMedia('(max-width: 820px)');
export const isMobile = () => mq.matches;

export function initLayout() {
  const app = $('#app');
  let saved = null;
  try { saved = localStorage.getItem('vtt-side'); } catch { /* */ }
  if (isMobile() || saved === 'closed') app.classList.add('side-closed');
  $$('.side-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => openPanel(b.dataset.tab)));
  $('#side-close').addEventListener('click', () => setOpen(false));
  $('#t-panel').addEventListener('click', () => setOpen(app.classList.contains('side-closed')));
  mq.addEventListener('change', () => { if (isMobile()) setOpen(false); });
}

export function setOpen(open) {
  const app = $('#app');
  app.classList.toggle('side-closed', !open);
  if (!isMobile()) try { localStorage.setItem('vtt-side', open ? 'open' : 'closed'); } catch { /* */ }
  emit('panel', tab);
}

export function openPanel(name) {
  tab = name;
  $$('.side-tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.side .panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === name));
  setOpen(true);
}

export function isPanelVisible(name) {
  return tab === name && !$('#app').classList.contains('side-closed') && document.visibilityState === 'visible';
}
