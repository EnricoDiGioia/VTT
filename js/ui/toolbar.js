// Barra de ferramentas + opções de cada ferramenta.
import { S, on, setTool, isGM, undo, redo, scene, updateScene, resetFog, clearDrawings, emit, addDrawing, clearWalls, write } from '../state.js';
import {
  requestDraw, zoomBy, fit, finishPoly, cancelPoly, getCalib, calibOpts, setCalibOpt, nudgeCalib, calibGrid, startCalib, clearCalib,
  clearTemplate, pinTemplate, hasTemplate, clearRuler, hasRuler, getEditSel, editSelPatch, editSelDelete, clearEditSel,
  finishWall, cancelWall, wallInProgress, resetExplored, viewCenter, pointerWorld,
} from '../board.js';
import { DRAW_COLORS } from '../data.js';
import { clipboard, pasteClipboard } from '../tokens-ops.js';
import { $, $$, h, toast, confirmBox, modal } from './dom.js';
import { isMobile } from './layout.js';

const LAYERS = [['token', 'Tokens'], ['map', 'Mapa']];

export function initToolbar() {
  S.sub.draw = { shape: 'free', color: '#e05d6f', w: 4, fill: false };
  S.sub.fog = { mode: 'reveal', shape: 'rect', size: 2 };
  S.sub.ping = { focus: false };
  S.sub.measure = { mode: 'ruler', lineW: 1, persist: false };
  S.sub.walls = { mode: 'wall', preview: false };
  S.sub.select = { drag: matchMedia('(pointer: coarse)').matches ? 'pan' : 'select' };
  S.layer = 'token';

  $$('#tools [data-tool]').forEach((b) => b.addEventListener('click', () => {
    setTool(S.tool === b.dataset.tool && b.dataset.tool !== 'select' ? 'select' : b.dataset.tool);
  }));
  on('tool:key', (t) => { if ((t !== 'fog' && t !== 'walls') || isGM()) setTool(t); });
  on('editsel', () => { if (S.tool === 'draw' || S.tool === 'fog') renderOpts(); });
  on('wallpts', () => { if (S.tool === 'walls') renderOpts(); });
  on('clipboard', () => { if (S.tool === 'select') renderOpts(); });
  on('selection', () => { if (S.tool === 'select' && isMobile()) renderOpts(); });
  on('place-text', placeText);
  on('edit-text', (k) => editText(k));
  on('tool', () => { cancelPoly(); renderOpts(); $$('#tools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === S.tool)); });
  on('poly', renderOpts);
  on('calib', renderOpts);
  on('tpl', () => { if (S.tool === 'measure') renderOpts(); });
  on('ruler', () => { if (S.tool === 'measure') renderOpts(); });
  on('scene', () => { if (S.tool === 'fog') renderOpts(); });
  $('#t-undo').addEventListener('click', () => { if (!undo()) toast('Nada para desfazer'); });
  $('#t-undo').addEventListener('contextmenu', (e) => { e.preventDefault(); if (!redo()) toast('Nada para refazer'); });
  $('#t-layer').addEventListener('click', () => {
    const i = LAYERS.findIndex((l) => l[0] === S.layer);
    S.layer = LAYERS[(i + 1) % LAYERS.length][0];
    updateLayerBtn();
    S.selected.clear(); emit('selection');
    toast(S.layer === 'map' ? 'Editando a camada do MAPA (objetos de fundo)' : 'Editando tokens');
    requestDraw();
  });
  $$('.zoom [data-z]').forEach((b) => b.addEventListener('click', () => {
    const z = b.dataset.z;
    if (z === 'in') zoomBy(1.25); else if (z === 'out') zoomBy(0.8); else fit();
  }));
  updateLayerBtn();
  setTool('select');
}

function updateLayerBtn() {
  const b = $('#t-layer');
  b.classList.remove('l-map', 'l-gm');
  if (S.layer !== 'token') b.classList.add('l-' + S.layer);
  $('#t-layer-name').textContent = LAYERS.find((l) => l[0] === S.layer)[1];
}

// Entra no modo de alinhar o grid arrastando sobre o mapa
export function enterCalib() {
  if (!isGM()) return;
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  startCalib();
  setTool('calib');
}

function seg(options, value, onPick) {
  return h('div.seg', options.map(([v, label]) => h('button', { type: 'button', class: v === value ? 'on' : '', on: { click: () => onPick(v) } }, label)));
}

function renderOpts() {
  const box = $('#toolopts');
  box.replaceChildren();
  box.hidden = true;
  const t = S.tool;
  if (t === 'select') {
    const cl = clipboard();
    const sd = S.sub.select;
    box.append(
      h('span.lbl', 'Arrastar no vazio:'),
      seg([['select', 'Selecionar área'], ['pan', 'Mover mapa']], sd.drag, (v) => { sd.drag = v; renderOpts(); }),
    );
    if (cl?.items?.length) box.append(h('button.btn.sm', { type: 'button', title: 'Colar (Ctrl+V)', on: { click: () => pasteClipboard(pointerWorld() && !isMobile() ? pointerWorld() : viewCenter()) } }, `Colar ${cl.items.length}`));
    if (!isMobile()) box.append(h('span.lbl', 'Ctrl+C/X/V/D · R gira · [ ] ordem · L trava'));
    box.hidden = false;
  } else if (t === 'draw') {
    const d = S.sub.draw;
    const set = (k, v) => { d[k] = v; if (k === 'shape') clearEditSel(); renderOpts(); };
    box.append(
      seg([['select', 'Selecionar'], ['free', 'Livre'], ['line', 'Linha'], ['rect', 'Ret.'], ['circle', 'Círculo'], ['text', 'Texto'], ['note', 'Nota'], ['erase', 'Borracha']], d.shape, (v) => set('shape', v)),
    );
    const es = d.shape === 'select' ? getEditSel() : null;
    if (d.shape === 'select') {
      if (!es) box.append(h('span.lbl', 'Toque num desenho, texto ou nota para mover; arraste a bolinha azul para redimensionar'));
      else {
        const it = es.item || {};
        box.append(h('div.dots', DRAW_COLORS.map((c) => h('button', { type: 'button', title: 'Cor', class: c === it.color ? 'on' : '', style: { background: c }, on: { click: () => editSelPatch({ color: c }) } }))));
        if (it.type === 'text' || it.type === 'note') box.append(h('button.btn.sm', { type: 'button', on: { click: () => editText(es.key) } }, 'Editar texto'));
        if (it.type === 'note' && isGM()) box.append(h('label.inline', h('input', { type: 'checkbox', checked: !!it.gmOnly, on: { change: (e) => editSelPatch({ gmOnly: e.target.checked || null }) } }), 'Só o mestre vê'));
        box.append(h('button.btn.sm.danger', { type: 'button', on: { click: editSelDelete } }, 'Apagar'));
      }
      box.hidden = false;
      return;
    }
    if (d.shape === 'text' || d.shape === 'note') box.append(h('span.lbl', d.shape === 'text' ? 'Toque no mapa para escrever' : 'Toque no mapa para colar uma nota'));
    if (d.shape !== 'erase') {
      box.append(
        h('div.dots', DRAW_COLORS.map((c) => h('button', { type: 'button', title: c, class: c === d.color ? 'on' : '', style: { background: c }, on: { click: () => set('color', c) } }))),
        seg([[2, 'Fina'], [4, 'Média'], [9, 'Grossa']], d.w, (v) => set('w', v)),
      );
      if (d.shape === 'rect' || d.shape === 'circle') {
        box.append(h('label.inline', h('input', { type: 'checkbox', checked: d.fill, on: { change: (e) => { d.fill = e.target.checked; } } }), 'Preencher'));
      }
    }
    box.append(h('button.btn.sm.ghost', { type: 'button', on: { click: () => clearDrawings(true) } }, 'Limpar meus'));
    if (isGM()) box.append(h('button.btn.sm.danger', { type: 'button', on: { click: async () => { if (await confirmBox('Apagar todos os desenhos desta cena?', 'Apagar')) clearDrawings(false); } } }, 'Limpar tudo'));
    box.hidden = false;
  } else if (t === 'fog' && isGM()) {
    const f = S.sub.fog;
    const sc = scene();
    const fogOn = !!sc?.fog?.on;
    const set = (k, v) => { f[k] = v; if (k !== 'size') cancelPoly(); renderOpts(); };
    box.append(
      h('label.inline', h('input', { type: 'checkbox', checked: fogOn, on: { change: (e) => updateScene(S.sceneId, { fog: { ...(sc.fog || {}), on: e.target.checked } }) } }), 'Névoa ativa'),
    );
    if (fogOn) {
      box.append(
        seg([['reveal', 'Revelar'], ['hide', 'Esconder']], f.mode, (v) => set('mode', v)),
        seg([['rect', 'Retângulo'], ['poly', 'Polígono'], ['brush', 'Pincel'], ['edit', 'Editar']], f.shape, (v) => { clearEditSel(); set('shape', v); }),
      );
      if (f.shape === 'edit') {
        const es = getEditSel();
        if (!es) box.append(h('span.lbl', 'Toque numa forma (contorno verde = revelada, vermelho = escondida) para mover ou redimensionar'));
        else box.append(
          h('button.btn.sm', { type: 'button', on: { click: () => editSelPatch({ mode: es.item?.mode === 'reveal' ? 'hide' : 'reveal' }) } }, es.item?.mode === 'reveal' ? 'Virar esconder' : 'Virar revelar'),
          h('button.btn.sm.danger', { type: 'button', on: { click: editSelDelete } }, 'Apagar forma'),
        );
      }
      if (f.shape === 'brush') box.append(seg([[1, '1'], [2, '2'], [4, '4'], [8, '8']], f.size, (v) => set('size', v)), h('span.lbl', 'casas'));
      if (f.shape === 'edit') { box.hidden = false; return; }
      if (f.shape === 'poly') box.append(
        h('span.lbl', 'Toque para marcar pontos; toque no 1º para fechar'),
        h('button.btn.sm.primary', { type: 'button', on: { click: finishPoly } }, 'Concluir'),
        h('button.btn.sm.ghost', { type: 'button', on: { click: cancelPoly } }, 'Cancelar'),
      );
      box.append(
        h('button.btn.sm.ghost', { type: 'button', on: { click: async () => { if (await confirmBox('Revelar o mapa inteiro?', 'Revelar', false)) resetFog('reveal'); } } }, 'Revelar tudo'),
        h('button.btn.sm.ghost', { type: 'button', on: { click: async () => { if (await confirmBox('Cobrir o mapa inteiro de névoa?', 'Cobrir', false)) resetFog('cover'); } } }, 'Cobrir tudo'),
      );
    }
    box.hidden = false;
  } else if (t === 'walls' && isGM()) {
    const w = S.sub.walls;
    const sc = scene();
    const v = sc?.vision || {};
    const n = wallInProgress();
    box.append(
      h('label.inline', h('input', { type: 'checkbox', checked: !!v.on, on: { change: (e) => updateScene(S.sceneId, { vision: { ...v, on: e.target.checked } }) } }), 'Visão dinâmica ativa'),
      seg([['wall', 'Parede'], ['door', 'Porta'], ['toggle', 'Abrir/fechar'], ['erase', 'Apagar']], w.mode, (m) => { cancelWall(); w.mode = m; renderOpts(); }),
    );
    const tips = { wall: 'Toque ponto a ponto; toque no último ponto (ou Enter) para terminar', door: 'Toque nas duas pontas da porta', toggle: 'Toque numa porta para abrir/fechar (no Mover também: clique na porta)', erase: 'Toque numa parede para apagar' };
    box.append(h('span.lbl', tips[w.mode]));
    if (n) box.append(h('button.btn.sm.primary', { type: 'button', on: { click: finishWall } }, 'Concluir'), h('button.btn.sm.ghost', { type: 'button', on: { click: cancelWall } }, 'Cancelar'));
    box.append(
      h('label.inline', h('input', { type: 'checkbox', checked: !!w.preview, on: { change: (e) => { w.preview = e.target.checked; requestDraw(); } } }), 'Ver como jogador'),
      h('button.btn.sm.ghost', { type: 'button', on: { click: async () => { if (await confirmBox('Apagar todas as paredes e portas desta cena?', 'Apagar')) clearWalls(); } } }, 'Apagar todas'),
    );
    if (!v.on) box.append(h('span.lbl', 'Ligue a visão dinâmica e dê luz aos tokens (editar token → Luz). Só aparece o que alguma luz alcança.'));
    box.hidden = false;
  } else if (t === 'calib' && isGM()) {
    const c = getCalib();
    const hex = calibOpts.type !== 'square';
    const g = c ? calibGrid() : null;
    const n = h('input', { type: 'number', min: 1, max: 99, value: calibOpts.n, style: { width: '64px' }, on: { input: (e) => { const v = Math.max(1, parseInt(e.target.value, 10) || 1); calibOpts.n = v; requestDraw(); updSize(); } } });
    const sizeLbl = h('span.lbl');
    const updSize = () => { const gg = getCalib() ? calibGrid() : null; sizeLbl.textContent = gg ? `casa = ${String(gg.size).replace('.', ',')} px` : ''; };
    updSize();
    box.append(
      h('b', { style: { fontSize: '13px' } }, 'Alinhar grid'),
      seg([['square', 'Quadrado'], ['hexH', 'Hex pontudo'], ['hexV', 'Hex chato']], calibOpts.type, (v) => { clearCalib(); setCalibOpt('type', v); }),
      h('span.lbl', hex
        ? 'Arraste do CENTRO de um hexágono até o centro de outro em linha reta'
        : 'Arraste de um canto a outro de um quadrado do mapa (ou de um bloco de vários)'),
      h('span.lbl', 'Dê zoom para ficar preciso · dois dedos / botão direito movem o mapa'),
      h('label.inline', hex ? 'Distância em casas' : 'Casas de largura', n),
    );
    if (g) {
      const nb = (label, title, fn) => h('button.btn.sm.ghost', { type: 'button', title, on: { click: fn } }, label);
      box.append(
        sizeLbl,
        h('span.lbl', 'Ajuste fino:'),
        nb('−', 'Diminuir casa', () => nudgeCalib(-0.25, 0, 0)), nb('+', 'Aumentar casa', () => nudgeCalib(0.25, 0, 0)),
        nb('←', 'Mover grid', () => nudgeCalib(0, -1, 0)), nb('→', 'Mover grid', () => nudgeCalib(0, 1, 0)),
        nb('↑', 'Mover grid', () => nudgeCalib(0, 0, -1)), nb('↓', 'Mover grid', () => nudgeCalib(0, 0, 1)),
      );
    }
    box.append(
      h('button.btn.sm.primary', { type: 'button', disabled: !g, on: { click: () => {
        const gg = calibGrid();
        if (!gg) return;
        const sc = scene();
        updateScene(S.sceneId, { grid: { ...sc.grid, type: gg.type, size: gg.size, ox: gg.ox, oy: gg.oy } });
        toast(`Grid alinhado: casa de ${String(gg.size).replace('.', ',')} px`);
        setTool('select');
      } } }, 'Aplicar'),
      h('button.btn.sm.ghost', { type: 'button', on: { click: () => setTool('select') } }, 'Cancelar'),
    );
    box.hidden = false;
  } else if (t === 'measure') {
    const m = S.sub.measure;
    const set = (k, v) => { m[k] = v; renderOpts(); };
    box.append(seg([['ruler', 'Régua'], ['circle', 'Círculo'], ['cone', 'Cone'], ['square', 'Quadrado'], ['line', 'Linha']], m.mode, (v) => { clearTemplate(); clearRuler(); set('mode', v); }));
    if (m.mode === 'ruler') {
      box.append(h('span.lbl', hasRuler()
        ? 'Toque para adicionar pontos · toque de novo no último ponto (ou Esc) para terminar'
        : 'Arraste para medir. Caminho com curvas: toque ponto a ponto, ou ao arrastar aperte Espaço (no celular, pare o dedo um instante) em cada curva.'));
      if (hasRuler()) box.append(h('button.btn.sm.ghost', { type: 'button', on: { click: clearRuler } }, 'Limpar régua'));
    }
    else {
      const tips = { circle: 'Arraste do centro para fora (raio)', cone: 'Arraste da origem na direção do cone', square: 'Arraste de um canto ao outro', line: 'Arraste da origem na direção da linha' };
      box.append(h('span.lbl', tips[m.mode] + ' · casas atingidas ficam pintadas'));
      if (m.mode === 'line') box.append(h('span.lbl', 'Largura'), seg([[1, '1 casa'], [2, '2 casas']], m.lineW, (v) => set('lineW', v)));
      box.append(h('label.inline', h('input', { type: 'checkbox', checked: m.persist, on: { change: (e) => { m.persist = e.target.checked; } } }), 'Fixar no mapa ao soltar'));
      if (hasTemplate()) box.append(
        h('button.btn.sm', { type: 'button', title: 'Deixar a área no mapa (apaga com a borracha do Desenho)', on: { click: pinTemplate } }, 'Fixar esta'),
        h('button.btn.sm.ghost', { type: 'button', on: { click: clearTemplate } }, 'Limpar'),
      );
    }
    box.hidden = false;
  } else if (t === 'ping') {
    box.append(h('span.lbl', 'Toque = ping · arraste = ponteiro laser (todos veem). Segurar o dedo no mapa com o Mover também faz ping.'));
    if (isGM()) box.append(h('label.inline', h('input', { type: 'checkbox', checked: S.sub.ping.focus, on: { change: (e) => { S.sub.ping.focus = e.target.checked; } } }), 'Levar a câmera de todos'));
    box.hidden = false;
  }
}

// ---------- Texto e notas ----------
function textModal(title, value = '', withGm = false, gmOnly = false) {
  return new Promise((res) => {
    const ta = h('textarea', { rows: 4, value, placeholder: 'Escreva aqui…', style: { width: '100%' } });
    const gmC = h('input', { type: 'checkbox', checked: gmOnly });
    let out = null;
    const m = modal(title, h('div', { style: { display: 'grid', gap: '10px' } }, ta, withGm ? h('label.inline', gmC, 'Só o mestre vê') : null), [
      { label: 'Cancelar', cls: 'ghost' },
      { label: 'OK', cls: 'primary', onClick: () => { out = { text: ta.value, gmOnly: gmC.checked }; } },
    ]);
    m.dlg.addEventListener('close', () => res(out), { once: true });
    setTimeout(() => ta.focus(), 30);
  });
}
async function placeText({ kind, x, y }) {
  const sc = scene(); if (!sc) return;
  const c = Number(sc.grid?.size) || 70;
  const d = S.sub.draw;
  const r = await textModal(kind === 'note' ? 'Nova nota' : 'Novo texto', '', kind === 'note' && isGM());
  if (!r || !r.text.trim()) return;
  if (kind === 'text') {
    const size = c * ({ 2: 0.35, 4: 0.5, 9: 0.85 }[d.w] || 0.5);
    addDrawing({ type: 'text', x: Math.round(x), y: Math.round(y), text: r.text.trim(), size: Math.round(size), color: d.color || '#ffffff' });
  } else {
    addDrawing({ type: 'note', x: Math.round(x), y: Math.round(y), w: Math.round(c * 3), text: r.text.trim(), color: d.color === '#111111' || d.color === '#ffffff' ? '#e6d24a' : d.color, gmOnly: r.gmOnly || null });
  }
}
async function editText(k) {
  const d = S.drawings[k]; if (!d) return;
  const r = await textModal(d.type === 'note' ? 'Editar nota' : 'Editar texto', d.text || '');
  if (!r) return;
  if (!r.text.trim()) { write(`drawings/${S.sceneId}/${k}`, null); return; }
  write(`drawings/${S.sceneId}/${k}`, { ...d, text: r.text.trim() });
}
