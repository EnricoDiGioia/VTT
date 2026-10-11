// Cenas (mestre): lista, troca, configurações de grid/mapa, e seletor no topo.
import { S, on, isGM, createScene, updateScene, deleteScene, showToPlayers, viewScene, scene, DEFAULT_GRID } from '../state.js';
import { fit, requestDraw } from '../board.js';
import { $, h, icon, iconBtn, modal, confirmBox, promptBox, toast, fill } from './dom.js';
import { pickAsset, setAsMap } from './library.js';
import { assetRef } from '../assets.js';
import { enterCalib } from './toolbar.js';

export function initScenes() {
  const rr = () => { render(); topPicker(); };
  on('scenes', rr); on('scene', rr); on('meta', rr);
  rr();
}

const sorted = () => Object.entries(S.scenes).sort((a, b) => (a[1].created || 0) - (b[1].created || 0));

function topPicker() {
  const box = $('#tb-scene');
  const sc = scene();
  if (!isGM()) { fill(box, h('span.muted', sc?.name || '')); return; }
  const sel = h('select', { title: 'Cena que você está vendo', on: { change: (e) => viewScene(e.target.value) } },
    sorted().map(([id, s]) => h('option', { value: id, selected: id === S.sceneId }, (id === S.meta?.playerScene ? '● ' : '') + (s.name || 'Cena'))));
  const live = S.sceneId === S.meta?.playerScene;
  fill(box, sel,
    live ? h('span.live', { title: 'Os jogadores estão vendo esta cena' }, 'ao vivo')
      : h('button.btn.sm', { type: 'button', title: 'Levar os jogadores para esta cena', on: { click: () => { showToPlayers(S.sceneId); toast('Jogadores movidos para esta cena'); } } }, icon('eye'), 'Mostrar'));
}

function render() {
  const p = $('#p-scenes');
  if (!isGM()) { fill(p, ); return; }
  fill(p, 
    h('h3', 'Cenas', h('button.btn.sm.primary', { type: 'button', on: { click: async () => {
      const n = await promptBox('Nome da cena', `Cena ${Object.keys(S.scenes).length + 1}`);
      if (n == null) return;
      const id = await createScene(n || 'Cena');
      viewScene(id);
      settings(id);
    } } }, icon('plus'), 'Nova')),
    h('div.list', sorted().map(([id, s]) => h('div.item', { class: id === S.sceneId ? 'active' : '' },
      h('div.grow', { style: { cursor: 'pointer' }, on: { click: () => viewScene(id) } },
        h('div.title', s.name || 'Cena'),
        h('div.sub', (id === S.meta?.playerScene ? '● jogadores aqui · ' : '') + `${s.grid?.type === 'none' ? 'sem grid' : s.grid?.type?.startsWith('hex') ? 'hexagonal' : 'quadrado'}${s.fog?.on ? ' · névoa' : ''}`)),
      id !== S.meta?.playerScene ? iconBtn('eye', 'Mostrar aos jogadores', () => { showToPlayers(id); toast('Jogadores movidos'); }) : null,
      iconBtn('gear', 'Configurar', () => { viewScene(id); settings(id); }),
      iconBtn('trash', 'Excluir', async () => {
        if (Object.keys(S.scenes).length <= 1) return toast('A mesa precisa de pelo menos uma cena');
        if (!(await confirmBox(`Excluir "${s.name}" com tokens, desenhos e névoa?`, 'Excluir'))) return;
        const other = sorted().find(([k]) => k !== id)[0];
        if (S.meta?.playerScene === id) await showToPlayers(other);
        if (S.sceneId === id) viewScene(other);
        deleteScene(id);
      }),
    ))),
    h('div.small.muted', 'Você pode preparar uma cena sem os jogadores verem e só depois tocar em “Mostrar”.'),
  );
}

export function settings(id) {
  const s = structuredClone(S.scenes[id]);
  if (!s) return;
  s.grid = { ...DEFAULT_GRID, ...(s.grid || {}) };
  let t; let pend = {};
  const flush = () => { clearTimeout(t); if (Object.keys(pend).length) updateScene(id, pend); pend = {}; requestDraw(); };
  const push = (obj) => { Object.assign(s, obj); Object.assign(pend, obj); clearTimeout(t); t = setTimeout(flush, 120); };
  const pushGrid = (k, v) => { s.grid[k] = v; push({ grid: { ...s.grid } }); };
  const num = (k, attrs = {}) => h('input', { type: 'number', value: s.grid[k], ...attrs, on: { input: (e) => { const n = Number(e.target.value); if (Number.isFinite(n)) pushGrid(k, n); } } });

  const name = h('input', { value: s.name || '', on: { input: (e) => push({ name: e.target.value }) } });
  const bg = h('input', { type: 'color', value: s.bg || '#2a2d33', on: { input: (e) => push({ bg: e.target.value }) } });
  const type = h('select', { on: { change: (e) => pushGrid('type', e.target.value) } },
    [['square', 'Quadrado'], ['hexH', 'Hexágono (pontudo)'], ['hexV', 'Hexágono (chato)'], ['none', 'Sem grid']].map(([v, l]) => h('option', { value: v, selected: s.grid.type === v }, l)));
  const size = num('size', { min: 8, max: 600, step: 1 });
  const cols = h('input', { type: 'number', min: 1, placeholder: 'ex.: 30', on: { input: (e) => {
    const c = Number(e.target.value);
    if (!(c > 0)) return;
    // largura total do mapa = c casas; no hex as colunas se encaixam de forma diferente
    let v;
    if (s.grid.type === 'hexH') v = s.w / (c + 0.5);
    else if (s.grid.type === 'hexV') v = (s.w / (1.5 * c + 0.5)) * Math.sqrt(3);
    else v = s.w / c;
    v = Math.round(v * 100) / 100;
    size.value = v; pushGrid('size', v);
  } } });
  const gcolor = h('input', { type: 'color', value: s.grid.color || '#000000', on: { input: (e) => pushGrid('color', e.target.value) } });
  const op = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.grid.opacity ?? 0.35, on: { input: (e) => pushGrid('opacity', Number(e.target.value)) } });
  const unit = h('input', { value: s.grid.unit || '', maxLength: 6, on: { input: (e) => pushGrid('unit', e.target.value) } });
  const diag = h('select', { on: { change: (e) => pushGrid('diag', e.target.value) } },
    [['5e', 'Diagonal = 1 (D&D 5e)'], ['alt', 'Alternada 1-2-1 (Pathfinder)'], ['euclid', 'Distância real']].map(([v, l]) => h('option', { value: v, selected: s.grid.diag === v }, l)));
  const snapC = h('input', { type: 'checkbox', checked: s.grid.snap !== false, on: { change: (e) => pushGrid('snap', e.target.checked) } });
  const W = h('input', { type: 'number', value: s.w, min: 100, on: { input: (e) => { const n = Number(e.target.value); if (n >= 100) push({ w: n }); } } });
  const H = h('input', { type: 'number', value: s.h, min: 100, on: { input: (e) => { const n = Number(e.target.value); if (n >= 100) push({ h: n }); } } });

  const body = h('div', { style: { display: 'grid', gap: '12px' } },
    h('div.grid2', h('label.stack', 'Nome', name), h('label.stack', 'Cor de fundo', bg)),
    h('h3', 'Mapa'),
    h('div.row',
      h('button.btn', { type: 'button', on: { click: async () => {
        const ref = await pickAsset('map');
        if (!ref) return;
        const meta = Object.entries(S.assets).find(([k, m]) => assetRef(k, m) === ref)?.[1] || Object.entries(S.library || {}).find(([k]) => ref.endsWith(':' + k))?.[1];
        if (meta) { await setAsMap({ ref, w: meta.w, h: meta.h }); const ns = S.scenes[id]; W.value = ns.w; H.value = ns.h; s.w = ns.w; s.h = ns.h; }
        else { push({ map: ref }); toast('Mapa por link definido. Ajuste largura/altura abaixo.'); }
        fit();
      } } }, icon('image'), s.map ? 'Trocar mapa' : 'Escolher mapa'),
      s.map ? h('button.btn.ghost', { type: 'button', on: { click: () => push({ map: '' }) } }, 'Remover mapa') : null,
    ),
    h('div.grid2', h('label.stack', 'Largura (px)', W), h('label.stack', 'Altura (px)', H)),
    h('h3', 'Visão dinâmica'),
    (() => {
      const v = { on: false, dark: 1, explore: true, ...(s.vision || {}) };
      const pushV = (obj) => { Object.assign(v, obj); push({ vision: { ...v } }); };
      return h('div.card',
        h('label.inline', h('input', { type: 'checkbox', checked: !!v.on, on: { change: (e) => pushV({ on: e.target.checked }) } }), 'Ligada (paredes bloqueiam a visão; só aparece o que alguma luz alcança)'),
        h('label.stack', 'Escuridão fora da luz (para os jogadores)', h('input', { type: 'range', min: 0.3, max: 1, step: 0.05, value: v.dark ?? 1, on: { input: (e) => pushV({ dark: Number(e.target.value) }) } })),
        h('label.inline', h('input', { type: 'checkbox', checked: v.explore !== false, on: { change: (e) => pushV({ explore: e.target.checked }) } }), 'Lembrar áreas já exploradas (ficam à meia-luz)'),
        h('div.small.muted', 'Desenhe paredes e portas com a ferramenta Paredes e dê luz aos tokens (editar token → Luz forte). Tochas e lampiões: tokens na camada Mapa com luz.'),
      );
    })(),
    h('h3', 'Grid'),
    h('div.card',
      h('div.small', 'Jeito mais fácil: arraste em cima de um quadrado (ou hexágono) do próprio mapa e o grid se alinha sozinho.'),
      h('div.row', h('button.btn.primary', { type: 'button', on: { click: () => { m.close(); viewScene(id); enterCalib(); } } }, icon('fit'), 'Alinhar no mapa')),
    ),
    h('div.grid2', h('label.stack', 'Tipo', type), h('label.stack', 'Tamanho do quadrado (px)', size)),
    h('div.grid2', h('label.stack', 'Ou: quantos quadrados de largura o mapa tem?', cols), h('label.inline', { style: { alignSelf: 'end', paddingBottom: '8px' } }, snapC, 'Encaixar tokens no grid')),
    h('div.grid2', h('label.stack', 'Deslocamento X', num('ox', { step: 1 })), h('label.stack', 'Deslocamento Y', num('oy', { step: 1 }))),
    h('div.grid2', h('label.stack', 'Cor das linhas', gcolor), h('label.stack', 'Opacidade', op)),
    h('div.grid2', h('label.stack', 'Cada quadrado vale', num('per', { step: 0.5, min: 0 })), h('label.stack', 'Unidade', unit)),
    h('label.stack', 'Regra de diagonal', diag),
    h('div.small.muted', 'Dica: se o mapa já tem grid desenhado, informe quantos quadrados de largura ele tem e depois ajuste o deslocamento até as linhas baterem.'),
  );
  const m = modal('Configurar cena', body, [{ label: 'Pronto', cls: 'primary' }]);
  m.dlg.addEventListener('close', flush, { once: true });
}
