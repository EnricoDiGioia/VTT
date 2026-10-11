// Rastreador de iniciativa.
import { S, on, isGM, R, setInitiative, patchInitiative, select } from '../state.js';
import { centerOn } from '../board.js';
import { roll, resolveRefs } from '../dice.js';
import { $, h, iconBtn, icon, promptBox, confirmBox, esc, fill } from './dom.js';
import { doRoll } from './chat.js';

const list = () => S.initiative?.list || {};
function ordered() {
  const gm = isGM();
  return Object.entries(list())
    .filter(([, e]) => gm || !e.hidden)
    .sort((a, b) => (Number(b[1].v ?? -999) - Number(a[1].v ?? -999)) || (Number(b[1].mod || 0) - Number(a[1].mod || 0)) || a[0].localeCompare(b[0]));
}
const canEdit = (e) => isGM() || e.owner === S.uid;

export function initInitiative() {
  on('initiative', () => { render(); strip(); });
  on('members', strip);
  on('selection', render);
  render(); strip();
}

function initMod(tokenId) {
  const t = S.tokens[tokenId];
  const sh = t?.sheet && S.sheets[t.sheet];
  if (!sh?.stats) return 0;
  const st = sh.stats.find((s) => /^(inic|init)/i.test(s.label || ''));
  if (!st) return 0;
  const n = parseFloat(resolveRefs(String(st.value), sh.stats).replace(/[()]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function addToInit(tokenId) {
  const t = S.tokens[tokenId]; if (!t) return;
  if (Object.values(list()).some((e) => e.token === tokenId)) return;
  const key = S.be.key();
  const entry = { name: t.name || 'Token', token: tokenId, color: t.color || '#888', owner: t.owner || '', v: null, mod: initMod(tokenId) || null, hidden: t.layer === 'gm' || null };
  S.be.set(R(`initiative/list/${key}`), entry);
  if (!S.initiative?.round) patchInitiative({ round: 1 });
}

function rollFor(key, e, silentGm) {
  const f = `1d20${e.mod ? (e.mod > 0 ? '+' : '') + e.mod : ''}`;
  const silent = isGM() && (e.hidden || silentGm);
  const r = silent ? roll(f) : doRoll(f, `Iniciativa — ${e.name}`);
  if (r) S.be.update(R(`initiative/list/${key}`), { v: r.total });
}

function next(dir = 1) {
  const o = ordered().filter(([, e]) => isGM() || !e.hidden);
  if (!o.length) return;
  const all = Object.entries(list()).sort((a, b) => (Number(b[1].v ?? -999) - Number(a[1].v ?? -999)) || (Number(b[1].mod || 0) - Number(a[1].mod || 0)) || a[0].localeCompare(b[0]));
  let i = all.findIndex(([k]) => k === S.initiative?.turn);
  let round = S.initiative?.round || 1;
  i += dir;
  if (i >= all.length) { i = 0; round++; }
  if (i < 0) { i = all.length - 1; round = Math.max(1, round - 1); }
  patchInitiative({ turn: all[i][0], round });
  const tok = S.tokens[all[i][1].token];
  if (tok && isGM()) { centerOn(tok.x, tok.y); select([all[i][1].token]); }
}

function strip() {
  const el = $('#tb-turn');
  const cur = S.initiative?.turn && list()[S.initiative.turn];
  if (!cur || (cur.hidden && !isGM())) { el.hidden = true; return; }
  el.hidden = false;
  const mine = canEdit(cur);
  fill(el, 
    h('span.rnd', `Rodada ${S.initiative.round || 1}`),
    h('span.cur', { style: { borderColor: cur.color }, title: 'Vez de ' + cur.name }, '▶ ' + cur.name),
    mine ? h('button.btn.sm', { type: 'button', title: 'Passar a vez', on: { click: () => next(1) } }, icon('next')) : null,
  );
}

function render() {
  const p = $('#p-init');
  const gm = isGM();
  const o = ordered();
  const turn = S.initiative?.turn;
  const items = o.map(([k, e]) => {
    const v = h('input.val', { type: 'number', value: e.v ?? '', placeholder: '—', disabled: !canEdit(e), on: { change: (ev) => S.be.update(R(`initiative/list/${k}`), { v: ev.target.value === '' ? null : Number(ev.target.value) }) } });
    return h('div.init-item', { class: k === turn ? 'cur' : '' },
      h('span.dot', { style: { background: e.color || '#888' } }),
      h('span.nm', { title: e.name, on: { click: () => { const t = S.tokens[e.token]; if (t) { centerOn(t.x, t.y); select([e.token]); } } } }, e.name, e.hidden ? ' 👁‍🗨' : ''),
      canEdit(e) ? iconBtn('dice', 'Rolar iniciativa (1d20' + (e.mod ? (e.mod > 0 ? '+' : '') + e.mod : '') + ')', () => rollFor(k, e)) : null,
      v,
      canEdit(e) ? iconBtn('x', 'Remover', () => {
        S.be.remove(R(`initiative/list/${k}`));
        if (turn === k) patchInitiative({ turn: null });
      }) : null,
    );
  });
  fill(p, 
    h('h3', `Iniciativa · Rodada ${S.initiative?.round || 1}`),
    h('div.row',
      h('button.btn.primary', { type: 'button', disabled: !o.length, on: { click: () => next(1) } }, icon('next'), turn ? 'Próximo' : 'Começar'),
      gm ? h('button.btn.ghost', { type: 'button', disabled: !turn, on: { click: () => next(-1) } }, 'Voltar') : null,
      h('button.btn.ghost', { type: 'button', title: 'Adicionar tokens selecionados', disabled: !S.selected.size, on: { click: () => { S.selected.forEach(addToInit); } } }, '+ Selecionados'),
    ),
    o.length ? h('div.list', items) : h('div.empty', 'Selecione tokens no mapa e toque em ⚔ para adicioná-los, ou adicione uma entrada manual.'),
    h('div.row',
      h('button.btn.sm.ghost', { type: 'button', on: { click: async () => {
        const n = await promptBox('Nome da entrada', '', 'Ex.: Goblins');
        if (n) S.be.set(R(`initiative/list/${S.be.key()}`), { name: n, color: S.me.color, owner: gm ? '' : S.uid, v: null, hidden: null });
      } } }, '+ Manual'),
      gm ? h('button.btn.sm.ghost', { type: 'button', on: { click: () => o.forEach(([k, e]) => { if (e.v == null) rollFor(k, e, true); }) } }, 'Rolar faltantes') : null,
      gm ? h('button.btn.sm.danger', { type: 'button', on: { click: async () => { if (await confirmBox('Encerrar o combate e limpar a iniciativa?', 'Limpar')) setInitiative(null); } } }, 'Limpar') : null,
    ),
  );
  void esc;
}
