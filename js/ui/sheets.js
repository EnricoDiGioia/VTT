// Fichas de personagem genéricas (atributos + ações roláveis + notas).
import { S, on, isGM, saveSheet, patchSheet, R } from '../state.js';
import { getImage } from '../assets.js';
import { resolveRefs, dndMod } from '../dice.js';
import { $, h, icon, iconBtn, modal, confirmBox, toast, fill } from './dom.js';
import { doRoll } from './chat.js';
import { pickAsset, placeToken } from './library.js';

const TEMPLATES = {
  generic: { label: 'Genérica', make: () => ({ stats: [{ label: 'Iniciativa', value: 0 }], actions: [{ name: 'Teste', f: '1d20' }] }) },
  dnd: {
    label: 'D&D 5e',
    make: () => ({
      dnd: true,
      stats: ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map((l) => ({ label: l, value: 10, mod: true }))
        .concat([{ label: 'CA', value: 10 }, { label: 'Prof', value: 2 }, { label: 'Iniciativa', value: 0 }, { label: 'Desloc.', value: 9 }]),
      actions: [
        { name: 'Ataque corpo a corpo', f: '1d20+@FOR.mod+@Prof' },
        { name: 'Dano', f: '1d8+@FOR.mod' },
        { name: 'Ataque à distância', f: '1d20+@DES.mod+@Prof' },
      ],
    }),
  },
  d6: { label: 'Parada de d6', make: () => ({ stats: [{ label: 'Físico', value: 3 }, { label: 'Mental', value: 3 }, { label: 'Social', value: 3 }], actions: [{ name: 'Teste Físico', f: '@Físicod6>=5' }] }) },
};

const visible = (s) => isGM() || s.owner === S.uid || s.public;
const canEdit = (s) => isGM() || s.owner === S.uid;

export function initSheets() {
  on('sheets', render);
  on('meta', render);
  render();
}

function render() {
  const p = $('#p-sheets');
  const list = Object.entries(S.sheets).filter(([, s]) => visible(s)).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
  fill(p, 
    h('h3', 'Fichas', h('button.btn.sm.primary', { type: 'button', on: { click: newSheet } }, icon('plus'), 'Nova')),
    list.length ? h('div.list', list.map(([id, s]) => {
      const img = getImage(s.img);
      return h('div.item', { style: { cursor: 'pointer' }, on: { click: () => openSheet(id) } },
        h('div.thumb.round', { style: { backgroundImage: img ? `url(${img.src})` : '', backgroundColor: S.members[s.owner]?.color || 'var(--bg4)' } }),
        h('div.grow', h('div.title', s.name || 'Sem nome'), h('div.sub', `${S.members[s.owner]?.name || 'Mestre'}${s.hpMax ? ` · PV ${s.hp ?? 0}/${s.hpMax}` : ''}${s.public ? ' · pública' : ''}`)),
      );
    })) : h('div.empty', 'Nenhuma ficha. Crie uma e vincule a um token — a barra de vida do token passa a usar o PV da ficha.'),
  );
}

function newSheet() {
  let tpl = 'generic';
  const sel = h('div.seg', Object.entries(TEMPLATES).map(([k, t]) => {
    const b = h('button', { type: 'button', class: k === tpl ? 'on' : '', on: { click: () => { tpl = k; sel.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); } } }, t.label);
    return b;
  }));
  const name = h('input', { placeholder: 'Nome do personagem', style: { width: '100%' } });
  modal('Nova ficha', h('div', { style: { display: 'grid', gap: '10px' } }, name, h('div.small.muted', 'Modelo'), sel), [
    { label: 'Cancelar', cls: 'ghost' },
    { label: 'Criar', cls: 'primary', onClick: async () => {
      const id = S.be.key();
      await saveSheet(id, { name: name.value.trim() || 'Personagem', owner: isGM() ? '' : S.uid, hp: 10, hpMax: 10, notes: '', ...TEMPLATES[tpl].make() });
      setTimeout(() => openSheet(id), 50);
    } },
  ]);
}

function statMod(s) { return s.mod ? dndMod(s.value) : null; }

export function openSheet(id) {
  const s0 = S.sheets[id];
  if (!s0) return;
  const sheet = structuredClone(s0);
  sheet.stats ||= []; sheet.actions ||= [];
  const ed = canEdit(sheet);
  const save = (obj) => { Object.assign(sheet, obj); if (ed) patchSheet(id, obj); };
  const rollF = (f, label) => doRoll(resolveRefs(f, sheet.stats), `${sheet.name}: ${label}`, { gm: rollHidden.checked });
  const rollHidden = h('input', { type: 'checkbox' });

  const portrait = h('div.thumb.round', { style: { width: '64px', height: '64px', cursor: ed ? 'pointer' : 'default' } });
  const setPortrait = () => { const img = getImage(sheet.img); portrait.style.backgroundImage = img ? `url(${img.src})` : ''; };
  setPortrait();
  if (ed) portrait.addEventListener('click', async () => { const r = await pickAsset('token'); if (r) { save({ img: r }); setPortrait(); } });

  const inp = (key, attrs = {}) => h('input', { value: sheet[key] ?? '', disabled: !ed, ...attrs, on: { change: (e) => save({ [key]: attrs.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value }) } });

  // atributos
  const statsBox = h('div.sheet-stats');
  function renderStats() {
    fill(statsBox, ...sheet.stats.map((st, i) => {
      const val = h('input.val', { value: st.value ?? '', disabled: !ed, inputMode: 'numeric', on: { change: (e) => { const n = Number(e.target.value); st.value = Number.isFinite(n) && e.target.value !== '' ? n : e.target.value; save({ stats: sheet.stats }); renderStats(); } } });
      const lb = h('input.lb', { value: st.label, disabled: !ed, on: { change: (e) => { st.label = e.target.value; save({ stats: sheet.stats }); } } });
      const m = statMod(st);
      return h('div.stat',
        lb, val,
        h('button.rollbtn', { type: 'button', style: { justifyContent: 'center', padding: '3px 6px' }, title: 'Rolar 1d20 + ' + (m ?? st.value), on: { click: () => rollF(`1d20+${m ?? (Number(st.value) || 0)}`, st.label) } },
          m !== null ? h('span.modv', (m >= 0 ? '+' : '') + m) : icon('dice')),
        ed ? h('button.icon-btn', { type: 'button', title: 'Remover', style: { justifySelf: 'center', padding: '2px' }, on: { click: () => { sheet.stats.splice(i, 1); save({ stats: sheet.stats }); renderStats(); } } }, icon('x')) : null,
      );
    }));
  }
  renderStats();

  // ações
  const actsBox = h('div.list');
  function renderActs() {
    fill(actsBox, ...sheet.actions.map((a, i) => ed
      ? h('div.act-row',
        h('input', { value: a.name, placeholder: 'Nome', on: { change: (e) => { a.name = e.target.value; save({ actions: sheet.actions }); } } }),
        h('input.f', { value: a.f, placeholder: '1d20+@FOR.mod', on: { change: (e) => { a.f = e.target.value; save({ actions: sheet.actions }); } } }),
        iconBtn('dice', 'Rolar', () => rollF(a.f, a.name)),
        iconBtn('x', 'Remover', () => { sheet.actions.splice(i, 1); save({ actions: sheet.actions }); renderActs(); }),
      )
      : h('button.rollbtn', { type: 'button', on: { click: () => rollF(a.f, a.name) } }, icon('dice'), a.name, h('small', a.f))));
  }
  renderActs();

  const owner = h('select', { disabled: !isGM(), on: { change: (e) => save({ owner: e.target.value }) } },
    h('option', { value: '' }, 'Mestre'),
    Object.entries(S.members).map(([uid, m]) => h('option', { value: uid, selected: sheet.owner === uid }, m.name || uid)));
  const pub = h('input', { type: 'checkbox', checked: !!sheet.public, disabled: !ed, on: { change: (e) => save({ public: e.target.checked || null }) } });

  const body = h('div', { style: { display: 'grid', gap: '12px' } },
    h('div.row', portrait, h('div.grow', { style: { display: 'grid', gap: '6px' } },
      inp('name', { placeholder: 'Nome', style: { fontWeight: '700', fontSize: '16px' } }),
      h('div.row', h('span', { style: { color: 'var(--red)', display: 'inline-flex' } }, icon('heart')),
        inp('hp', { type: 'number', style: { width: '70px' } }), h('span.muted', '/'), inp('hpMax', { type: 'number', style: { width: '70px' } }),
        h('span.small.muted', 'PV')),
    )),
    h('h3', 'Atributos', ed ? h('button.btn.sm.ghost', { type: 'button', on: { click: () => { sheet.stats.push({ label: 'Novo', value: 0 }); save({ stats: sheet.stats }); renderStats(); } } }, '+ Atributo') : null),
    statsBox,
    h('div.small.muted', 'Toque no botão do atributo para rolar 1d20 + valor (ou + modificador, em fichas D&D).'),
    h('h3', 'Ações e rolagens', ed ? h('button.btn.sm.ghost', { type: 'button', on: { click: () => { sheet.actions.push({ name: 'Nova ação', f: '1d20' }); save({ actions: sheet.actions }); renderActs(); } } }, '+ Ação') : null),
    actsBox,
    ed ? h('div.small.muted', 'Use @Atributo na fórmula (ex.: 1d20+@FOR.mod+@Prof). “.mod” converte valor em modificador D&D.') : null,
    h('label.inline', rollHidden, 'Rolar oculto (só eu e o mestre)'),
    h('h3', 'Notas'),
    h('textarea', { rows: 5, value: sheet.notes || '', disabled: !ed, placeholder: 'Equipamento, magias, história…', on: { change: (e) => save({ notes: e.target.value }) } }),
    ed ? h('div.grid2', h('label.stack', 'Dono', owner), h('label.inline', { style: { alignSelf: 'end' } }, pub, 'Visível para todos')) : null,
  );
  const buttons = [];
  if (ed) {
    buttons.push({ label: 'Excluir', cls: 'danger', onClick: async () => {
      if (!(await confirmBox(`Excluir a ficha "${sheet.name}"?`, 'Excluir'))) return false;
      S.be.remove(R(`sheets/${id}`));
    } });
    buttons.push({ label: 'Criar token', cls: 'ghost', onClick: () => {
      placeToken({ name: sheet.name, img: sheet.img || null, sheet: id, owner: sheet.owner || '', color: S.members[sheet.owner]?.color || S.me.color });
      toast('Token criado no centro da tela');
    } });
  }
  buttons.push({ label: 'Fechar', cls: 'primary' });
  modal(sheet.name || 'Ficha', body, buttons);
}
