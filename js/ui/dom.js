// Helpers de DOM leves (sem framework).
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// h('div.cls#id', {attrs, on:{click}}, ...children)
export function h(sel, attrs, ...kids) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
  const el = document.createElement(m[1] || 'div');
  for (const p of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (p[0] === '.') el.classList.add(p.slice(1)); else el.id = p.slice(1);
  }
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'on') for (const ev in v) el.addEventListener(ev, v[ev]);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k in el && k !== 'list' && k !== 'form') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#i-' + name);
  s.append(u);
  return s;
}
export function iconBtn(name, title, onclick, cls = '') {
  return h('button.icon-btn', { title, type: 'button', class: cls, on: { click: onclick } }, icon(name));
}

let toastT;
export function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), ms);
}

// Modal simples. body: Node; buttons: [{label, cls, onClick -> false mantém aberto}]
export function modal(title, body, buttons = [{ label: 'Fechar' }]) {
  // cada modal é um <dialog> novo, então dá para abrir um por cima do outro
  const dlg = h('dialog.modal');
  document.body.append(dlg);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
  dlg.replaceChildren(
    h('div.modal-head', h('h2', title), iconBtn('x', 'Fechar', () => close())),
    h('div.modal-body', body),
    buttons.length ? h('div.modal-foot', buttons.map((b) => h('button.btn', {
      class: b.cls || '', type: 'button',
      on: { click: async () => { if ((await b.onClick?.()) !== false) close(); } },
    }, b.label))) : null,
  );
  function close() { dlg.close(); }
  dlg.onclick = (e) => { if (e.target === dlg) close(); };
  dlg.showModal();
  return { close, dlg };
}

export function confirmBox(msg, okLabel = 'Confirmar', danger = true) {
  return new Promise((res) => {
    let ok = false;
    const m = modal('Confirmar', h('p', msg), [
      { label: 'Cancelar', cls: 'ghost' },
      { label: okLabel, cls: danger ? 'danger' : 'primary', onClick: () => { ok = true; } },
    ]);
    m.dlg.addEventListener('close', () => res(ok), { once: true });
  });
}

export function promptBox(title, value = '', placeholder = '') {
  return new Promise((res) => {
    const inp = h('input', { value, placeholder, style: { width: '100%' } });
    let out = null;
    const m = modal(title, inp, [
      { label: 'Cancelar', cls: 'ghost' },
      { label: 'OK', cls: 'primary', onClick: () => { out = inp.value; } },
    ]);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { out = inp.value; m.close(); } });
    m.dlg.addEventListener('close', () => res(out), { once: true });
    setTimeout(() => inp.select(), 30);
  });
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const initials = (n) => (n || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

// replaceChildren que ignora null/false e aceita arrays
export function fill(el, ...kids) {
  el.replaceChildren();
  add(el, kids);
  return el;
}
