// Biblioteca: envio de imagens, tokens rápidos, mapas.
import { S, on, isGM, addToken, scene, updateScene, COLORS } from '../state.js';
import { uploadAsset, deleteAsset, deleteLibraryAsset, addLibraryToRoom, assetRef, getImage } from '../assets.js';
import { viewCenter, clientToWorld, requestDraw, pointerWorld } from '../board.js';
import { pasteClipboard, clipboard, CLIP_MARK } from '../tokens-ops.js';
import { snap } from '../grid.js';
import { $, h, modal, toast, confirmBox, iconBtn, icon, fill } from './dom.js';
import { isPanelVisible } from './layout.js';
import { enterCalib } from './toolbar.js';

// só monta a biblioteca quando o painel está aberto (evita baixar imagens à toa)
let dirty = true;
function maybeRender() { if (isPanelVisible('library')) { dirty = false; render(); } else dirty = true; }

export function initLibrary() {
  on('panel', () => { if (dirty) maybeRender(); });
  on('assets', debounce(maybeRender, 150));
  on('library', debounce(maybeRender, 150));
  on('meta', debounce(maybeRender, 150));
  on('image', debounce(refreshThumbs, 200));

  // soltar arquivos no mapa
  const stage = $('#stage');
  stage.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  stage.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    const at = clientToWorld(e.clientX, e.clientY);
    for (const f of files) await handleDroppedImage(f, at);
  });
  // colar imagem (Ctrl+V)
  addEventListener('paste', async (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || document.querySelector('dialog[open]')) return;
    const text = e.clipboardData?.getData('text/plain') || '';
    // o último Ctrl+C foi de tokens do VTT: cola os tokens
    if (text.startsWith(CLIP_MARK) && clipboard()?.items?.length && S.sceneId) { e.preventDefault(); pasteClipboard(pointerWorld() || viewCenter()); return; }
    // senão, se houver uma imagem (print, imagem copiada de um site), envia a imagem
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); handleDroppedImage(f, pointerWorld() || viewCenter()); return; }
  });
}

function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

async function imgDims(file) {
  try { const b = await createImageBitmap(file); const d = [b.width, b.height]; b.close?.(); return d; } catch { return [0, 0]; }
}

async function handleDroppedImage(file, at) {
  const [w, hh] = await imgDims(file);
  const big = Math.max(w, hh) >= 1100;
  if (big && isGM()) {
    const useMap = await confirmBox('Imagem grande — usar como mapa desta cena?', 'Usar como mapa', false);
    if (useMap) { await setAsMap(file); return; }
  }
  toast('Enviando imagem…');
  const a = await uploadAsset(file, 'token');
  placeToken({ img: a.ref, name: file.name.replace(/\.[^.]+$/, '').slice(0, 24) }, at);
}

export async function setAsMap(fileOrAsset) {
  const sc = scene(); if (!sc) return;
  let ref, w, hh;
  if (fileOrAsset instanceof Blob) {
    toast('Comprimindo e enviando o mapa…', 4000);
    const a = await uploadAsset(fileOrAsset, 'map');
    ref = a.ref; w = a.w; hh = a.h;
  } else { ({ ref, w, h: hh } = fileOrAsset); }
  await updateScene(S.sceneId, { map: ref, w, h: hh });
  if (await confirmBox('Mapa definido! Quer alinhar o grid com os quadrados do mapa agora? (Dá para fazer depois em Cenas → ⚙)', 'Alinhar agora', false)) enterCalib();
  requestDraw();
}

export function placeToken(t, at = viewCenter()) {
  const sc = scene();
  let [x, y] = sc ? snap(sc.grid, at[0], at[1], t.s || 1) : at;
  // não empilha em cima de outro token: anda uma casa para a direita
  const step = Number(sc?.grid?.size) || 70;
  for (let i = 0; i < 12 && Object.values(S.tokens).some((o) => Math.abs(o.x - x) < 2 && Math.abs(o.y - y) < 2); i++) {
    x += step;
    if (sc && sc.grid.type !== 'square') [x, y] = snap(sc.grid, x, y, t.s || 1);
  }
  const mapLayer = isGM() && S.layer === 'map';
  return addToken({ x: Math.round(x), y: Math.round(y), ...(mapLayer ? { layer: 'map', shape: 'free' } : {}), ...t });
}

function chooseFiles(multiple = true) {
  return new Promise((res) => {
    const inp = $('#file-in');
    inp.multiple = multiple;
    inp.value = '';
    inp.onchange = () => res([...inp.files]);
    inp.click();
  });
}

async function uploadMany(kind) {
  const files = await chooseFiles(true);
  if (!files.length) return [];
  toast(`Enviando ${files.length} imagem(ns)…`, 3000);
  const out = [];
  for (const f of files) {
    try { out.push(await uploadAsset(f, kind)); } catch (e) { toast('Falhou: ' + e.message); }
  }
  toast('Pronto!');
  return out;
}

function thumbStyle(ref) {
  const img = getImage(ref);
  return img ? `url(${img.src})` : '';
}
function refreshThumbs() {
  document.querySelectorAll('[data-ref]').forEach((el) => { const s = thumbStyle(el.dataset.ref); if (s) el.style.backgroundImage = s; });
}
const libRef = (id) => `lib:${S.uid}:${id}`;

function render() {
  const p = $('#p-library');
  const gm = isGM();
  const qName = h('input.grow', { placeholder: 'Nome do token', maxLength: 24 });
  let qColor = S.me.color;
  const dots = h('div.dots', COLORS.slice(0, 8).map((c) => {
    const b = h('button', { type: 'button', style: { background: c }, class: c === qColor ? 'on' : '', on: { click: () => { qColor = c; dots.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); } } });
    return b;
  }));
  const mine = Object.entries(S.assets).filter(([, a]) => gm || a.owner === S.uid || a.kind === 'token').sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
  const tokens = mine.filter(([, a]) => a.kind !== 'map');
  const maps = mine.filter(([, a]) => a.kind === 'map');
  const lib = Object.entries(S.library || {}).filter(([id, a]) => !S.assets[id] && (gm || a.kind !== 'map')).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));

  fill(p, 
    h('h3', 'Token rápido'),
    h('div.card',
      h('div.row', qName, h('button.btn.primary', { type: 'button', on: { click: () => {
        placeToken({ name: qName.value.trim() || 'Token', color: qColor });
        qName.value = '';
      } } }, 'Criar')),
      dots,
    ),
    h('h3', 'Imagens de token', h('button.btn.sm', { type: 'button', on: { click: async () => { const a = await uploadMany('token'); if (a.length === 1) placeToken({ img: a[0].ref, name: a[0].name }); } } }, icon('upload'), 'Enviar')),
    tokens.length ? h('div.assets', tokens.map(([id, a]) => assetTile(id, a))) : h('div.empty', 'Envie imagens (ou arraste para o mapa / cole com Ctrl+V). Elas são comprimidas automaticamente.'),
    gm ? h('h3', 'Mapas', h('button.btn.sm', { type: 'button', on: { click: async () => { const f = await chooseFiles(false); if (f[0]) setAsMap(f[0]); } } }, icon('upload'), 'Novo mapa')) : null,
    gm ? (maps.length ? h('div.assets', maps.map(([id, a]) => assetTile(id, a))) : h('div.empty', 'Nenhum mapa ainda. O mapa enviado vira o fundo da cena atual.')) : null,
    S.user && !S.user.guest ? h('h3', 'Minha biblioteca (outras mesas)') : null,
    S.user && !S.user.guest ? (lib.length
      ? h('div.assets', lib.map(([id, a]) => libTile(id, a)))
      : h('div.empty', 'Tudo que você envia fica guardado na sua conta. Imagens que você usou em outras mesas aparecem aqui.')) : null,
  );
}

function assetTile(id, a) {
  const ref = assetRef(id, a);
  return h('button.asset', { type: 'button', title: a.name, on: { click: () => assetMenu(id, a) } },
    h('div.img', { 'data-ref': ref, style: { backgroundImage: thumbStyle(ref) } }),
    h('div.nm', a.name || 'imagem'),
  );
}
function libTile(id, a) {
  const ref = libRef(id);
  return h('button.asset', { type: 'button', title: a.name, on: { click: () => libMenu(id, a) } },
    h('div.img', { 'data-ref': ref, style: { backgroundImage: thumbStyle(ref) } }),
    h('div.nm', a.name || 'imagem'),
  );
}
function preview(ref, a) {
  const kb = Math.round((a.size || 0) / 1024);
  return h('div', { style: { display: 'grid', gap: '10px' } },
    h('div', { style: { aspectRatio: `${a.w}/${a.h}`, maxHeight: '45vh', background: `center/contain no-repeat ${thumbStyle(ref) || ''}` } }),
    h('div.small.muted', `${a.w}×${a.h}px · ${kb} KB`),
  );
}
function libMenu(id, a) {
  const gm = isGM();
  modal(a.name || 'Imagem', preview(libRef(id), a), [
    { label: 'Apagar da conta', cls: 'danger', onClick: async () => { if (await confirmBox('Apagar esta imagem da sua conta? Ela some de todas as mesas.', 'Apagar')) deleteLibraryAsset(id); } },
    { label: 'Trazer para esta mesa', cls: 'ghost', onClick: () => addLibraryToRoom(id) },
    ...(gm ? [{ label: 'Usar como mapa', cls: 'ghost', onClick: async () => { const ref = await addLibraryToRoom(id); setAsMap({ ref, w: a.w, h: a.h }); } }] : []),
    { label: 'Colocar como token', cls: 'primary', onClick: async () => { const ref = await addLibraryToRoom(id); placeToken({ img: ref, name: a.name }); } },
  ]);
}

function assetMenu(id, a) {
  const gm = isGM();
  const ref = assetRef(id, a);
  const fromLib = !!a.ref;
  modal(a.name || 'Imagem', preview(ref, a), [
    ...(gm || a.owner === S.uid ? [{ label: fromLib ? 'Tirar desta mesa' : 'Excluir', cls: 'danger', onClick: async () => {
      const msg = fromLib ? 'Tirar esta imagem da biblioteca desta mesa? Ela continua na conta de quem enviou.' : 'Excluir esta imagem? Tokens que usam ela ficam sem imagem.';
      if (await confirmBox(msg, fromLib ? 'Tirar' : 'Excluir')) deleteAsset(id);
    } }] : []),
    ...(gm ? [{ label: 'Usar como mapa', cls: 'ghost', onClick: () => setAsMap({ ref, w: a.w, h: a.h }) }] : []),
    { label: 'Colocar como token', cls: 'primary', onClick: () => placeToken({ img: ref, name: a.name }) },
  ]);
}

// Seletor de imagem (usado no editor de token / ficha)
export function pickAsset(kind = 'token') {
  return new Promise((res) => {
    let out = null;
    const url = h('input.grow', { placeholder: 'ou cole um link https://…' });
    const ok = (a) => kind === 'any' || a.kind === kind || isGM();
    const list = Object.entries(S.assets).filter(([, a]) => ok(a)).map(([id, a]) => ({ a, ref: assetRef(id, a), pick: async () => assetRef(id, a) }))
      .concat(Object.entries(S.library || {}).filter(([id, a]) => !S.assets[id] && ok(a)).map(([id, a]) => ({ a, ref: libRef(id), pick: () => addLibraryToRoom(id) })));
    const grid = h('div.assets', list.map((it) => h('button.asset', { type: 'button', on: { click: async () => { out = await it.pick(); m.close(); } } },
      h('div.img', { 'data-ref': it.ref, style: { backgroundImage: thumbStyle(it.ref) } }), h('div.nm', it.a.name))));
    const m = modal('Escolher imagem', h('div', { style: { display: 'grid', gap: '10px' } },
      h('div.row', h('button.btn', { type: 'button', on: { click: async () => { const a = await uploadMany(kind === 'map' ? 'map' : 'token'); if (a[0]) { out = a[0].ref; m.close(); } } } }, icon('upload'), 'Enviar do aparelho')),
      list.length ? grid : h('div.empty', 'Nenhuma imagem enviada ainda.'),
      h('div.row', url, h('button.btn', { type: 'button', on: { click: () => { if (/^https?:\/\//.test(url.value)) { out = url.value.trim(); m.close(); } } } }, 'Usar link')),
    ), [{ label: 'Cancelar', cls: 'ghost' }]);
    m.dlg.addEventListener('close', () => res(out), { once: true });
  });
}
void iconBtn;
