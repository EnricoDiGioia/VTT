// Operações com tokens no estilo Owlbear: copiar/recortar/colar, duplicar com numeração,
// ordem (frente/trás), girar, espelhar, selecionar tudo.
import { S, isGM, canMove, addToken, removeToken, updateToken, select, emit, scene, undoGroup } from './state.js';
import { snap, cellSize } from './grid.js';
import { portableRef } from './assets.js';

const CLIP_KEY = 'vtt-clipboard';

// camadas que o usuário pode selecionar agora
export function selectableLayers() {
  if (!isGM()) return ['token'];
  return S.layer === 'map' ? ['map'] : ['token', 'gm'];
}

// ordem de desenho: z menor fica embaixo; empate pela ordem de criação
export function zOrder(a, b) {
  const za = Number(S.tokens[a]?.z) || 0, zb = Number(S.tokens[b]?.z) || 0;
  return za - zb || (a < b ? -1 : a > b ? 1 : 0);
}

// "Goblin" -> "Goblin 2", "Goblin 2" -> "Goblin 3" (usa o maior número que já existe na cena)
export function nextName(name) {
  if (!name) return name;
  const m = /^(.*?)\s*(\d+)$/.exec(name);
  const base = (m ? m[1] : name).trim();
  let max = m ? Number(m[2]) : 1;
  for (const t of Object.values(S.tokens)) {
    if (!t.name) continue;
    if (t.name === base) max = Math.max(max, 1);
    const mm = /^(.*?)\s*(\d+)$/.exec(t.name);
    if (mm && mm[1].trim() === base) max = Math.max(max, Number(mm[2]));
  }
  return `${base} ${max + 1}`;
}

function editableSelection() {
  return [...S.selected].filter((id) => S.tokens[id] && canMove(S.tokens[id]));
}

export const CLIP_MARK = 'vtt-tokens:';
// Copiar pelo botão (sem Ctrl+C): dispara o evento "copy" do navegador para que a área de
// transferência do sistema também mude — senão um Ctrl+V depois colaria um print antigo.
export function copyViaSystem(cut = false) {
  let ok = false;
  try { ok = document.execCommand(cut ? 'cut' : 'copy'); } catch { ok = false; }
  if (!ok) return copySelection(cut);
  return lastCopyCount;
}
let lastCopyCount = 0;
// Handler do evento copy/cut (Ctrl+C / Ctrl+X ou execCommand)
export function onSystemCopy(e, cut = false) {
  const n = copySelection(cut);
  lastCopyCount = n;
  if (!n) return 0;
  try { e.clipboardData.setData('text/plain', CLIP_MARK + Date.now()); e.preventDefault(); } catch { /* */ }
  return n;
}

export function clipboard() {
  try { return JSON.parse(localStorage.getItem(CLIP_KEY) || 'null'); } catch { return null; }
}

export function copySelection(cut = false) {
  const ids = editableSelection();
  if (!ids.length) return 0;
  const toks = ids.map((id) => structuredClone(S.tokens[id]));
  const cx = toks.reduce((a, t) => a + t.x, 0) / toks.length;
  const cy = toks.reduce((a, t) => a + t.y, 0) / toks.length;
  const clip = {
    room: S.roomId, scene: S.sceneId, cell: cellSize(scene()?.grid), ts: Date.now(),
    items: toks.map((t) => ({ ...t, dx: t.x - cx, dy: t.y - cy })),
  };
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch { /* */ }
  if (cut) undoGroup(() => ids.forEach(removeToken));
  emit('clipboard');
  return ids.length;
}

// Cola no ponto `at` (mundo). rename=true numera nomes repetidos (duplicar).
export async function pasteClipboard(at, { rename = false, clip = clipboard() } = {}) {
  if (!clip?.items?.length || !scene()) return 0;
  const sc = scene();
  const scale = cellSize(sc.grid) / (clip.cell || cellSize(sc.grid)); // cenas com grid de tamanho diferente
  const otherRoom = clip.room !== S.roomId;
  const gm = isGM();
  // imagens de outra mesa viram imagens da sua biblioteca (para todos da mesa nova verem)
  const refs = {};
  if (otherRoom) for (const it of clip.items) if (it.img && !(it.img in refs)) refs[it.img] = await portableRef(it.img, clip.room);
  const newIds = [];
  undoGroup(() => {
    for (const it of clip.items) {
      const { dx, dy, ...t } = it;
      let x = at[0] + dx * scale, y = at[1] + dy * scale;
      if (sc.grid.snap !== false) [x, y] = snap(sc.grid, x, y, t.s || 1);
      const names = Object.values(S.tokens).map((o) => o.name);
      const tok = { ...t, x: Math.round(x), y: Math.round(y) };
      if (rename || names.includes(tok.name)) tok.name = nextName(tok.name);
      if (otherRoom) { tok.img = refs[t.img] ?? t.img; delete tok.sheet; }
      if (!gm) { tok.owner = S.uid; tok.layer = 'token'; delete tok.locked; }
      delete tok.z;
      newIds.push(addToken(tok));
    }
  });
  select(newIds);
  return newIds.length;
}

export async function duplicateSelection() {
  const ids = editableSelection();
  if (!ids.length) return 0;
  const toks = ids.map((id) => S.tokens[id]);
  const c = cellSize(scene()?.grid);
  const cx = toks.reduce((a, t) => a + t.x, 0) / toks.length;
  const cy = toks.reduce((a, t) => a + t.y, 0) / toks.length;
  const clip = { room: S.roomId, cell: c, items: toks.map((t) => ({ ...structuredClone(t), dx: t.x - cx, dy: t.y - cy })) };
  // uma casa para a direita, como no Owlbear
  return pasteClipboard([cx + c, cy], { rename: true, clip });
}

export function deleteSelection() {
  const ids = editableSelection();
  undoGroup(() => ids.forEach(removeToken));
  select([]);
  return ids.length;
}

export function selectAll() {
  const layers = selectableLayers();
  select(Object.keys(S.tokens).filter((k) => layers.includes(S.tokens[k].layer || 'token')));
}

export function bringTo(front = true) {
  const ids = editableSelection();
  if (!ids.length) return;
  const zs = Object.values(S.tokens).map((t) => Number(t.z) || 0);
  let z = front ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1;
  undoGroup(() => { for (const id of ids.sort(zOrder)) { updateToken(id, { z }); z += front ? 1 : -1; } });
}

export function rotateSelection(deg) {
  const ids = editableSelection();
  undoGroup(() => { for (const id of ids) updateToken(id, { rot: (((Number(S.tokens[id].rot) || 0) + deg) % 360 + 360) % 360 || null }); });
}
export function flipSelection() {
  const ids = editableSelection();
  undoGroup(() => { for (const id of ids) updateToken(id, { flip: S.tokens[id].flip ? null : true }); });
}
export function toggleLockSelection() {
  const ids = editableSelection();
  const lock = ids.some((id) => !S.tokens[id].locked);
  undoGroup(() => { for (const id of ids) updateToken(id, { locked: lock || null }); });
  return lock;
}
export function toggleHideSelection() {
  if (!isGM()) return;
  const ids = editableSelection().filter((id) => (S.tokens[id].layer || 'token') !== 'map');
  const hide = ids.some((id) => S.tokens[id].layer !== 'gm');
  undoGroup(() => { for (const id of ids) updateToken(id, { layer: hide ? 'gm' : 'token' }); });
  return hide;
}
