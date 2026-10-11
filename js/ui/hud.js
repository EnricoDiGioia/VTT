// Painel flutuante do token selecionado + editor de token.
import { S, on, isGM, canMove, updateToken, removeToken, scene, patchSheet, select } from '../state.js';
import { toScreen, requestDraw, tokenStats, SIZES, resizeToken } from '../board.js';
import { getImage, uploadAsset } from '../assets.js';
import { CONDITIONS } from '../data.js';
import { copyViaSystem, duplicateSelection, deleteSelection, bringTo, rotateSelection, flipSelection, toggleLockSelection, toggleHideSelection } from '../tokens-ops.js';
import { $, h, icon, iconBtn, modal, toast } from './dom.js';
import { isMobile } from './layout.js';
import { addToInit } from './initiative.js';
import { openSheet } from './sheets.js';
import { pickAsset } from './library.js';

let renderedFor = null;

export function initHud() {
  on('selection', render);
  on('tokens', (ev) => { if (!ev || S.selected.has(ev.k)) render(); });
  on('sheets', render);
  on('view', position);
  on('token:open', (id) => {
    const t = S.tokens[id]; if (!t) return;
    if (t.sheet && S.sheets[t.sheet]) openSheet(t.sheet);
    else if (canMove(t)) editToken(id);
  });
}

function stats(t) {
  const sh = t.sheet && S.sheets[t.sheet];
  return sh ? { hp: sh.hp, hpMax: sh.hpMax, src: 'sheet' } : { hp: t.hp, hpMax: t.hpMax, src: 'token' };
}
function setHp(id, t, val) {
  const st = stats(t);
  const max = Number(st.hpMax) || 0;
  let v = String(val).trim();
  let n;
  if (/^[+-]/.test(v)) n = (Number(st.hp) || 0) + Number(v);
  else n = Number(v);
  if (!Number.isFinite(n)) return;
  const extra = !max && n > 0 ? { hpMax: n } : {}; // primeiro PV digitado vira o máximo também
  if (st.src === 'sheet') patchSheet(t.sheet, { hp: n, ...extra });
  else updateToken(id, { hp: n, ...extra });
  // morte automática sugerida
  if (max && n <= 0 && !t.cond?.dead && !t.cond?.down) updateToken(id, { cond: { ...(t.cond || {}), down: true } });
}

function render() {
  const hud = $('#hud');
  const ids = [...S.selected].filter((k) => S.tokens[k]);
  if (!ids.length) { hud.hidden = true; renderedFor = null; return; }
  if (document.activeElement?.tagName === 'INPUT' && hud.contains(document.activeElement) && renderedFor === ids.join()) { softUpdate(); return; }
  renderedFor = ids.join();
  hud.replaceChildren();
  hud.hidden = false;
  if (ids.length > 1) {
    const movable = ids.filter((k) => canMove(S.tokens[k]));
    hud.append(h('div.hud-head', h('b', `${ids.length} tokens selecionados`), iconBtn('x', 'Fechar', () => select([]))));
    if (movable.length) hud.append(h('div.hud-actions',
      iconBtn('swords', 'Adicionar à iniciativa', () => { movable.forEach((k) => addToInit(k)); toast('Adicionados à iniciativa'); }),
      iconBtn('copy2', 'Duplicar (Ctrl+D)', () => duplicateSelection()),
      iconBtn('copy', 'Copiar (Ctrl+C)', () => { const n = copyViaSystem(); if (n) toast(`${n} copiado(s) — cole com Ctrl+V ou "Colar"`); }),
      iconBtn('rotate', 'Girar 90°', () => rotateSelection(90)),
      iconBtn('lock', 'Travar/destravar', () => toast(toggleLockSelection() ? 'Travados' : 'Destravados')),
      isGM() ? iconBtn('eyeoff', 'Esconder/mostrar para jogadores', () => toast(toggleHideSelection() ? 'Escondidos dos jogadores' : 'Visíveis para os jogadores')) : null,
      iconBtn('trash', 'Remover', () => deleteSelection()),
    ));
    position();
    return;
  }
  const id = ids[0];
  const t = S.tokens[id];
  const can = canMove(t);
  const gm = isGM();
  const st = stats(t);

  const head = h('div.hud-head',
    h('span.av', { style: { background: t.color || '#888' } }),
    h('b', t.name || 'Sem nome'),
    t.sheet && S.sheets[t.sheet] ? iconBtn('sheet', 'Abrir ficha', () => openSheet(t.sheet)) : null,
    can ? iconBtn('edit', 'Editar token', () => editToken(id)) : null,
    iconBtn('x', 'Fechar', () => select([])),
  );
  hud.append(head);

  const showHp = Number(st.hpMax) > 0 && (gm || can || !t.hideHp);
  if (showHp || can) {
    const hpIn = h('input#hud-hp', { value: st.hp ?? '', inputMode: 'text', title: 'Digite um valor ou -5 / +3', disabled: !can });
    hpIn.addEventListener('change', () => setHp(id, S.tokens[id], hpIn.value));
    hpIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') hpIn.blur(); });
    hud.append(h('div.hp-row',
      h('span', { style: { color: 'var(--red)', display: 'inline-flex' } }, icon('heart')),
      can ? h('button', { type: 'button', on: { click: () => setHp(id, S.tokens[id], '-1') } }, '−') : null,
      hpIn,
      h('span.hpmax', '/'),
      (() => {
        const mx = h('input#hud-hpmax', { value: st.hpMax ?? '', placeholder: 'máx', inputMode: 'numeric', title: 'PV máximo', disabled: !can });
        mx.addEventListener('change', () => {
          const v = mx.value.trim(); const n = v === '' ? null : Number(v);
          if (v !== '' && !Number.isFinite(n)) return;
          const cur = stats(S.tokens[id]);
          const obj = { hpMax: n };
          if (n && (cur.hp == null || cur.hp === '')) obj.hp = n; // sem PV atual: começa cheio
          if (cur.src === 'sheet') patchSheet(S.tokens[id].sheet, obj); else updateToken(id, obj);
        });
        mx.addEventListener('keydown', (e) => { if (e.key === 'Enter') mx.blur(); });
        return mx;
      })(),
      can ? h('button', { type: 'button', on: { click: () => setHp(id, S.tokens[id], '+1') } }, '+') : null,
    ));
  }
  // CA e ND
  const ts = tokenStats(t);
  const fromSheet = (k) => t.sheet && S.sheets[t.sheet] && ts[k] !== t[k];
  if (can || ((gm || !t.hideHp) && (ts.ac != null || ts.cr != null))) {
    const fld = (k, label, title) => {
      const inp = h('input', { value: ts[k] ?? '', placeholder: '—', title, disabled: !can || fromSheet(k), style: { width: '52px', textAlign: 'center', padding: '5px' } });
      inp.addEventListener('change', () => { const v = inp.value.trim(); updateToken(id, { [k]: v === '' ? null : (k === 'ac' && Number.isFinite(Number(v)) ? Number(v) : v) }); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      return [h('span.small.muted', { title }, label), inp];
    };
    hud.append(h('div.hp-row', ...fld('ac', 'CA', 'Classe de Armadura'), ...fld('cr', 'ND', 'Nível de Desafio (CR)')));
  }

  if (can) {
    hud.append(h('div.conds', CONDITIONS.map((c) => h('button', {
      type: 'button', title: c.label, class: t.cond?.[c.id] ? 'on' : '',
      on: { click: () => { const cond = { ...(S.tokens[id].cond || {}) }; if (cond[c.id]) delete cond[c.id]; else cond[c.id] = true; updateToken(id, { cond: Object.keys(cond).length ? cond : null }); } },
    }, c.icon))));
    const cur = Number(t.s) || 1;
    hud.append(h('div.size-row', SIZES.map(([v, label]) => h('button', {
      type: 'button', class: cur === v ? 'on' : '', title: `${label} — ${v === 0.5 ? 'meia casa' : `${v}×${v} casas`}`,
      on: { click: () => resizeToken(id, v) },
    }, label))));
    // luz (visão dinâmica): raio em casas
    if (scene()?.vision?.on || t.light) {
      const li = h('input', { value: t.light ?? '', placeholder: '0', inputMode: 'numeric', title: 'Luz: raio em casas (0 = sem luz)', style: { width: '52px', textAlign: 'center', padding: '5px' } });
      li.addEventListener('change', () => { const n = Number(li.value); updateToken(id, { light: li.value === '' || !n ? null : n }); });
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') li.blur(); });
      hud.append(h('div.hp-row', h('span', { style: { color: 'var(--acc)', display: 'inline-flex' } }, icon('sun')), h('span.small.muted', 'Luz'), li, h('span.small.muted', 'casas')));
    }
    const acts = h('div.hud-actions',
      iconBtn('swords', 'Adicionar à iniciativa', () => { addToInit(id); toast('Adicionado à iniciativa'); }),
      iconBtn('copy2', 'Duplicar (Ctrl+D)', () => duplicateSelection()),
      iconBtn('copy', 'Copiar (Ctrl+C)', () => { if (copyViaSystem()) toast('Copiado — cole com Ctrl+V ou "Colar"'); }),
      iconBtn('rotate', 'Girar 90° (R gira 45°)', () => rotateSelection(90)),
      iconBtn('flip', 'Espelhar', () => flipSelection(), t.flip ? 'on' : ''),
      iconBtn('front', 'Trazer para frente ( ] )', () => bringTo(true)),
      iconBtn('back', 'Mandar para trás ( [ )', () => bringTo(false)),
    );
    if (gm) {
      acts.append(
        iconBtn(t.layer === 'gm' ? 'eyeoff' : 'eye', t.layer === 'gm' ? 'Escondido dos jogadores (clique para mostrar)' : 'Visível (clique para esconder)', () => {
          toast(toggleHideSelection() ? 'Token escondido (camada do Mestre)' : 'Token visível para os jogadores');
        }, t.layer === 'gm' ? 'on' : ''),
      );
    }
    acts.append(
      iconBtn('lock', t.locked ? 'Travado (ninguém arrasta) — clique para destravar' : 'Travar no lugar', () => toggleLockSelection(), t.locked ? 'on' : ''),
      iconBtn('trash', 'Remover token', () => deleteSelection()),
    );
    hud.append(acts);
  } else {
    hud.append(h('div.small.muted', isGM() ? '' : 'Só o mestre ou o dono deste token pode mexer nele.'));
    const conds = Object.keys(t.cond || {}).map((c) => CONDITIONS.find((x) => x.id === c)).filter(Boolean);
    if (conds.length) hud.append(h('div.small.muted', conds.map((c) => c.icon + ' ' + c.label).join(' · ')));
  }
  position();
}

function softUpdate() {
  const id = [...S.selected][0]; const t = S.tokens[id]; if (!t) return;
  const hp = $('#hud-hp');
  if (hp && document.activeElement !== hp) hp.value = stats(t).hp ?? '';
  const mx = $('#hud-hpmax');
  if (mx && document.activeElement !== mx) mx.value = stats(t).hpMax ?? '';
}

function position() {
  const hud = $('#hud');
  if (hud.hidden || isMobile()) return;
  const ids = [...S.selected].filter((k) => S.tokens[k]);
  if (!ids.length) return;
  const t = S.tokens[ids[0]];
  const cell = Number(scene()?.grid?.size) || 70;
  const half = (Number(t.s) || 1) * cell / 2;
  const [sx, sy] = toScreen(t.x + half, t.y - half);
  const stage = $('#stage').getBoundingClientRect();
  const w = hud.offsetWidth, hh = hud.offsetHeight;
  let x = sx + 14, y = sy - 10;
  if (x + w > stage.width - 56) { const [lx] = toScreen(t.x - half, t.y); x = lx - w - 14; }
  x = Math.max(8, Math.min(stage.width - w - 56, x));
  y = Math.max(8, Math.min(stage.height - hh - 8, y));
  hud.style.left = x + 'px'; hud.style.top = y + 'px';
}

// ---------- Editor de token ----------
export function editToken(id) {
  const t = structuredClone(S.tokens[id]);
  if (!t) return;
  const gm = isGM();
  const preview = h('div.thumb.round', { style: { width: '64px', height: '64px', backgroundColor: t.color || '#888' } });
  const setPrev = () => {
    const img = getImage(t.img);
    preview.style.backgroundImage = img ? `url(${img.src})` : '';
  };
  setPrev();
  const name = h('input', { value: t.name || '', placeholder: 'Nome' });
  const color = h('input', { type: 'color', value: t.color || '#888888' });
  const shape = h('select', [['circle', 'Redondo'], ['square', 'Quadrado'], ['free', 'Imagem livre (sem borda)']].map(([v, l]) => h('option', { value: v, selected: t.shape === v }, l)));
  const size = h('input', { type: 'number', min: 0.25, max: 30, step: 0.25, value: t.s || 1 });
  const hp = h('input', { type: 'number', value: t.hp ?? '', placeholder: 'PV' });
  const hpMax = h('input', { type: 'number', value: t.hpMax ?? '', placeholder: 'Máx' });
  const showName = h('input', { type: 'checkbox', checked: t.showName !== false });
  const hideHp = h('input', { type: 'checkbox', checked: !!t.hideHp });
  const ac = h('input', { type: 'number', value: t.ac ?? '', placeholder: 'ex.: 15' });
  const light = h('input', { type: 'number', min: 0, step: 1, value: t.light ?? '', placeholder: '0' });
  const dim = h('input', { type: 'number', min: 0, step: 1, value: t.dim ?? '', placeholder: '0' });
  const cr = h('input', { value: t.cr ?? '', placeholder: 'ex.: 1/4', maxLength: 6 });
  const owner = h('select',
    h('option', { value: '' }, 'Só o mestre'),
    h('option', { value: '*', selected: t.owner === '*' }, 'Todos os jogadores'),
    Object.entries(S.members).map(([uid, m]) => h('option', { value: uid, selected: t.owner === uid }, m.name || uid)),
  );
  const sheet = h('select',
    h('option', { value: '' }, '— nenhuma —'),
    Object.entries(S.sheets).filter(([, s]) => gm || s.owner === S.uid).map(([sid, s]) => h('option', { value: sid, selected: t.sheet === sid }, s.name || 'Sem nome')),
  );
  const layer = h('select', [['token', 'Tokens'], ['map', 'Mapa (fundo)'], ['gm', 'Mestre (escondido)']].map(([v, l]) => h('option', { value: v, selected: (t.layer || 'token') === v }, l)));

  const body = h('div', { style: { display: 'grid', gap: '12px' } },
    h('div.row', preview, h('div.grow', { style: { display: 'grid', gap: '6px' } },
      h('div.row',
        h('button.btn.sm', { type: 'button', on: { click: async () => { const ref = await pickAsset('token'); if (ref) { t.img = ref; setPrev(); } } } }, 'Escolher imagem'),
        h('button.btn.sm.ghost', { type: 'button', on: { click: () => { t.img = null; setPrev(); } } }, 'Sem imagem'),
      ),
      h('label.inline', showName, 'Mostrar nome'),
    )),
    h('div.grid2', h('label.stack', 'Nome', name), h('label.stack', 'Cor da borda', color)),
    h('div.grid2', h('label.stack', 'Formato', shape), h('label.stack', 'Tamanho em casas (0,5 Miúdo · 1 Médio · 2 Grande · 3 Enorme · 4 Imenso)', size)),
    h('div.grid2', h('label.stack', 'PV atual', hp), h('label.stack', 'PV máximo', hpMax)),
    h('div.grid2', h('label.stack', 'CA (Classe de Armadura)', ac), h('label.stack', 'ND / CR', cr)),
    h('label.inline', hideHp, 'Esconder vida, CA e ND dos outros jogadores'),
    h('div.grid2', h('label.stack', 'Luz forte (casas) — visão dinâmica', light), h('label.stack', 'Penumbra extra (casas)', dim)),
    h('div.grid2', h('label.stack', 'Ficha vinculada (PV vem da ficha)', sheet), gm ? h('label.stack', 'Quem controla', owner) : h('span')),
    gm ? h('label.stack', 'Camada', layer) : null,
  );
  modal('Editar token', body, [
    { label: 'Cancelar', cls: 'ghost' },
    { label: 'Salvar', cls: 'primary', onClick: () => {
      const obj = {
        name: name.value.trim(), color: color.value, shape: shape.value, s: Math.max(0.25, Number(size.value) || 1),
        hp: hp.value === '' ? null : Number(hp.value), hpMax: hpMax.value === '' ? null : Number(hpMax.value),
        showName: showName.checked, hideHp: hideHp.checked || null,
        ac: ac.value === '' ? null : Number(ac.value), cr: cr.value.trim() || null,
        light: Number(light.value) > 0 ? Number(light.value) : null, dim: Number(dim.value) > 0 ? Number(dim.value) : null, img: t.img || null, sheet: sheet.value || null,
      };
      if (gm) { obj.owner = owner.value; obj.layer = layer.value; }
      // tamanho novo: reencaixa no grid mantendo o canto superior esquerdo
      if (obj.s !== (Number(S.tokens[id]?.s) || 1)) resizeToken(id, obj.s);
      delete obj.s;
      updateToken(id, obj);
      if (gm && (obj.layer === 'map') !== (S.layer === 'map')) select([]);
      requestDraw();
    } },
  ]);
  void uploadAsset;
}
