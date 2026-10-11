// Mesa: renderização em canvas (só redesenha quando algo muda) + entrada por mouse/toque.
import {
  S, on, emit, scene, isGM, canMove, canDrag, updateToken, addDrawing, removeDrawing, addFog,
  setCursor, ping, pushUndo, select, undo, redo, write, addWall, updateWall, removeWall, undoGroup,
} from './state.js';
import { getImage } from './assets.js';
import * as G from './grid.js';
import { COND } from './data.js';
import { createVisionCache, distToSeg } from './vision.js';
import {
  zOrder, selectableLayers, onSystemCopy, duplicateSelection, deleteSelection, selectAll,
  bringTo, rotateSelection, toggleLockSelection, toggleHideSelection,
} from './tokens-ops.js';
import { toast } from './ui/dom.js';

export const cam = { x: 0, y: 0, z: 1 };
const FOG = '#0d0f13';
let canvas, ctx, W = 0, H = 0, dpr = 1;
let pending = false;
let fogC = null, fogDirty = true;
let live = null;        // forma sendo desenhada localmente
let myRuler = null;     // régua local: [x0,y0, x1,y1, ...] — o último ponto segue o dedo/mouse
let rulerSticky = false; // modo caminho por toques (régua fica até limpar)
let dwellT = null;       // segurar parado durante o arraste = novo ponto
let myTpl = null;       // área de efeito (círculo/cone/quadrado/linha) local
let dragPos = null;     // id -> {x,y} durante arraste de token
let resizeLive = null;  // { id, s, x, y } enquanto arrasta a alça de tamanho
let dragInfo = null;    // {from:[x,y], to:[x,y]} para mostrar distância
let polyPts = null;     // polígono de névoa em construção
let hoverW = null;      // ponteiro (mundo) para prévias
const camMemo = {};     // câmera por cena
let lastSceneId = null;
let spaceDown = false;
let needFit = false;
let fitted = null;
let calib = null;       // calibração do grid: { a:[x,y], b:[x,y], n, type, fine:{s,x,y} }
let rotLive = null;     // { id, rot } enquanto gira um token pela alça
let marquee = null;     // [x0,y0,x1,y1] seleção em área
let myLaser = null;     // [[x,y,t], ...] rastro do ponteiro laser
let editSel = null;     // { coll: 'drawings'|'fog', key } item selecionado para editar
let editLive = null;    // { coll, key, item } cópia transformada durante mover/redimensionar
let wallPts = null;     // parede em construção
let lastPointer = null; // última posição do ponteiro no mundo (para colar)
let visC = null, exploredC = null, visDirty = true, visSceneId = null, wallsVersion = 0;
const visCache = createVisionCache();
export const pointerWorld = () => lastPointer;

export const toWorld = (sx, sy) => [sx / cam.z + cam.x, sy / cam.z + cam.y];
export const toScreen = (wx, wy) => [(wx - cam.x) * cam.z, (wy - cam.y) * cam.z];
export function clientToWorld(cx, cy) { const r = canvas.getBoundingClientRect(); return toWorld(cx - r.left, cy - r.top); }
export function viewCenter() { return toWorld(W / 2, H / 2); }
const cell = () => G.cellSize(scene()?.grid);

export function requestDraw() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; if (!document.hidden) draw(); });
}

export function initBoard(el) {
  canvas = el;
  ctx = canvas.getContext('2d', { alpha: false });
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();
  bindInput();
  on('scene', (sc) => {
    fogDirty = true;
    if (S.sceneId !== lastSceneId) {
      if (lastSceneId) camMemo[lastSceneId] = { ...cam };
      lastSceneId = S.sceneId;
      polyPts = null; live = null; fitted = null;
      if (camMemo[S.sceneId]) { Object.assign(cam, camMemo[S.sceneId]); fitted = S.sceneId; }
    }
    if (sc && fitted !== S.sceneId) { fitted = S.sceneId; if (W > 0) fit(); else needFit = true; }
    requestDraw();
  });
  on('fog', () => { fogDirty = true; requestDraw(); });
  on('walls', () => { wallsVersion++; visDirty = true; requestDraw(); });
  on('tokens', () => { visDirty = true; });
  on('scene', () => { visDirty = true; });
  on('tool', (t) => { if (t !== 'calib' && calib) { calib = null; } editSel = null; editLive = null; wallPts = null; emit('editsel'); if (t !== 'measure' && myTpl) clearTemplate(); if (t !== 'measure' && myRuler) clearRuler(); requestDraw(); });
  for (const e of ['tokens', 'drawings', 'cursors', 'image', 'selection', 'meta', 'sheets']) on(e, requestDraw);
  on('pings', () => {
    for (const k in S.pings) {
      const p = S.pings[k];
      if (p.focus && p.uid !== S.uid && isGM(p.uid) && !p.done) { p.done = true; centerOn(p.x, p.y); }
    }
    requestDraw();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestDraw(); });
}

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = r.width; H = r.height;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  if (needFit && W > 0 && scene()) { needFit = false; fit(); }
  requestDraw();
}

export function fit() {
  const sc = scene(); if (!sc || !W) return;
  cam.z = Math.min(W / sc.w, H / sc.h) * 0.92;
  cam.x = sc.w / 2 - W / 2 / cam.z;
  cam.y = sc.h / 2 - H / 2 / cam.z;
  requestDraw();
}
export function centerOn(x, y) { cam.x = x - W / 2 / cam.z; cam.y = y - H / 2 / cam.z; requestDraw(); }
export function zoomBy(f, sx = W / 2, sy = H / 2) {
  const [wx, wy] = toWorld(sx, sy);
  cam.z = Math.max(0.03, Math.min(8, cam.z * f));
  cam.x = wx - sx / cam.z; cam.y = wy - sy / cam.z;
  requestDraw();
}

// ---------------- Desenho ----------------
function tokenList(layer) {
  return Object.keys(S.tokens).filter((k) => (S.tokens[k].layer || 'token') === layer).sort(zOrder).map((k) => [k, S.tokens[k]]);
}
function tokenPos(id, t) { return dragPos?.[id] || [t.x, t.y]; }
// PV, CA e ND do token (vêm da ficha vinculada quando houver)
export function tokenStats(t) {
  const sh = t.sheet && S.sheets[t.sheet];
  if (!sh) return { hp: t.hp, hpMax: t.hpMax, ac: t.ac, cr: t.cr };
  const find = (re) => (sh.stats || []).find((x) => re.test(String(x.label || '').trim()))?.value;
  return { hp: sh.hp, hpMax: sh.hpMax, ac: find(/^(ca|ac)$/i) ?? t.ac, cr: find(/^(nd|cr)$/i) ?? t.cr };
}

function draw() {
  const sc = scene();
  const z = cam.z;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#121418';
  ctx.fillRect(0, 0, W, H);
  if (!sc) return;
  const gm = isGM();
  const view = { x0: cam.x, y0: cam.y, x1: cam.x + W / z, y1: cam.y + H / z };
  ctx.setTransform(dpr * z, 0, 0, dpr * z, -cam.x * z * dpr, -cam.y * z * dpr);
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = sc.bg || '#2a2d33';
  ctx.fillRect(0, 0, sc.w, sc.h);
  const mi = getImage(sc.map);
  if (mi) ctx.drawImage(mi, 0, 0, sc.w, sc.h);

  for (const [id, t] of tokenList('map')) drawToken(id, t, z, view);

  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, sc.w, sc.h); ctx.clip();
  const cg = S.tool === 'calib' ? calibGrid(true) : null;
  G.drawGrid(ctx, cg || sc.grid, view, z);
  ctx.restore();

  const dkeys = Object.keys(S.drawings).sort();
  const dItem = (k) => (editLive?.coll === 'drawings' && editLive.key === k ? editLive.item : S.drawings[k]);
  for (const k of dkeys) { const d = dItem(k); if (d.type !== 'text' && d.type !== 'note') drawShape(d, z); }
  if (live?.kind === 'draw') drawShape(live.d, z);

  for (const [id, t] of tokenList('token')) drawToken(id, t, z, view);
  if (gm) for (const [id, t] of tokenList('gm')) drawToken(id, t, z, view, 0.5);

  // textos e notas ficam por cima dos tokens
  for (const k of dkeys) { const d = dItem(k); if (d.type === 'text' || d.type === 'note') drawShape(d, z); }

  // visão dinâmica (paredes + luzes)
  if (sc.vision?.on && S.tool !== 'calib') {
    if (visDirty || !visC || visSceneId !== S.sceneId) buildVision(sc, gm);
    const asPlayer = !gm || S.sub.walls?.preview;
    ctx.save();
    ctx.globalAlpha = asPlayer ? 1 : 0.45;
    ctx.drawImage(visC, 0, 0, sc.w, sc.h);
    ctx.restore();
    // jogadores sempre enxergam os próprios tokens
    if (!gm) for (const [id, t] of tokenList('token')) if (t.owner === S.uid || t.owner === '*') drawToken(id, t, z, view);
  }

  // névoa
  if (sc.fog?.on && S.tool !== 'calib') {
    if (fogDirty || !fogC || editLive?.coll === 'fog') buildFog(sc);
    ctx.save();
    ctx.globalAlpha = gm ? 0.55 : 1;
    ctx.drawImage(fogC, 0, 0, sc.w, sc.h);
    if (!gm) {
      ctx.fillStyle = FOG;
      ctx.beginPath();
      ctx.rect(view.x0 - 10, view.y0 - 10, view.x1 - view.x0 + 20, view.y1 - view.y0 + 20);
      ctx.rect(0, 0, sc.w, sc.h);
      ctx.fill('evenodd');
    }
    ctx.restore();
  }
  if (live?.kind === 'fog') drawFogPreview(live.op, z);
  if (polyPts) drawPolyPreview(z);
  if (gm && S.tool === 'fog' && S.sub.fog?.shape === 'edit') drawFogOutlines(z);
  if (gm && S.tool === 'walls') drawWalls(z);
  if (editSel) drawEditBox(z);
  if (marquee) {
    ctx.save();
    ctx.fillStyle = 'rgba(232,163,61,.12)'; ctx.strokeStyle = '#e8a33d'; ctx.lineWidth = 1.5 / z; ctx.setLineDash([6 / z, 4 / z]);
    ctx.beginPath(); ctx.rect(Math.min(marquee[0], marquee[2]), Math.min(marquee[1], marquee[3]), Math.abs(marquee[2] - marquee[0]), Math.abs(marquee[3] - marquee[1]));
    ctx.fill(); ctx.stroke(); ctx.restore();
  }

  // seleção
  for (const id of S.selected) {
    let t = S.tokens[id]; if (!t) continue;
    if (resizeLive?.id === id) t = { ...t, s: resizeLive.s, x: resizeLive.x, y: resizeLive.y };
    const [x, y] = tokenPos(id, t);
    const r = tokenRadius(t) + 4 / z;
    if (t.locked) { ctx.save(); ctx.font = `${14 / z}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('🔒', x - r, y - r); ctx.restore(); }
    ctx.save();
    ctx.strokeStyle = '#e8a33d'; ctx.lineWidth = 2.5 / z; ctx.setLineDash([7 / z, 5 / z]);
    ctx.beginPath();
    if (t.shape === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2);
    else { const [w, h] = tokenBox(t); ctx.rect(x - w / 2 - 4 / z, y - h / 2 - 4 / z, w + 8 / z, h + 8 / z); }
    ctx.stroke(); ctx.restore();
  }
  // alça de redimensionar (um token selecionado que eu posso mexer)
  const hd = handleInfo();
  if (hd) {
    ctx.save();
    ctx.fillStyle = '#e8a33d'; ctx.strokeStyle = '#1b1e25'; ctx.lineWidth = 2 / z;
    ctx.beginPath(); ctx.arc(hd.x, hd.y, 9 / z, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#1b1e25'; ctx.lineWidth = 1.8 / z; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hd.x - 4 / z, hd.y + 4 / z); ctx.lineTo(hd.x + 4 / z, hd.y - 4 / z);
    ctx.moveTo(hd.x + 4 / z, hd.y - 4 / z); ctx.lineTo(hd.x + 4 / z, hd.y); ctx.moveTo(hd.x + 4 / z, hd.y - 4 / z); ctx.lineTo(hd.x, hd.y - 4 / z);
    ctx.moveTo(hd.x - 4 / z, hd.y + 4 / z); ctx.lineTo(hd.x - 4 / z, hd.y); ctx.moveTo(hd.x - 4 / z, hd.y + 4 / z); ctx.lineTo(hd.x, hd.y + 4 / z);
    ctx.stroke();
    if (resizeLive) {
      const label = `${fmtSize(resizeLive.s)}×${fmtSize(resizeLive.s)} · ${sizeName(resizeLive.s)}`;
      const fs = 13 / z;
      ctx.font = `700 ${fs}px system-ui, sans-serif`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(15,17,21,.92)';
      roundRect(hd.x + 14 / z, hd.y - 8 / z, tw + 12 / z, fs + 8 / z, 5 / z); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      ctx.fillText(label, hd.x + 20 / z, hd.y - 4 / z);
    }
    ctx.restore();
  }

  const rh = rotHandleInfo();
  if (rh) {
    ctx.save();
    ctx.strokeStyle = '#e8a33d'; ctx.lineWidth = 1.5 / z;
    ctx.beginPath(); ctx.moveTo(rh.x, rh.y + 9 / z); ctx.lineTo(rh.x, rh.top); ctx.stroke();
    ctx.fillStyle = '#e8a33d'; ctx.strokeStyle = '#1b1e25'; ctx.lineWidth = 2 / z;
    ctx.beginPath(); ctx.arc(rh.x, rh.y, 9 / z, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1.8 / z; ctx.beginPath(); ctx.arc(rh.x, rh.y, 4.2 / z, -Math.PI * 0.9, Math.PI * 0.55); ctx.stroke();
    if (rotLive) {
      const label = `${Math.round(rotLive.rot)}°`;
      ctx.font = `700 ${13 / z}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(15,17,21,.92)'; roundRect(rh.x + 14 / z, rh.y - 10 / z, ctx.measureText(label).width + 12 / z, 20 / z, 5 / z); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(label, rh.x + 20 / z, rh.y);
    }
    ctx.restore();
  }

  if (S.tool === 'calib' && calib) drawCalib(z);

  // réguas (minha + dos outros)
  for (const uid in S.cursors) {
    if (uid === S.uid) continue;
    const c = S.cursors[uid];
    if (c?.ruler) drawRuler(c.ruler, c.color, z, sc, c.name);
    if (c?.tpl) drawTemplate(c.tpl, c.color, z, sc, c.name);
  }
  if (myRuler) drawRuler(myRuler, S.me.color, z, sc);
  if (myTpl) drawTemplate(myTpl, S.me.color, z, sc);
  if (dragInfo) drawRuler([...dragInfo.from, ...dragInfo.to], '#e8a33d', z, sc, null, true);

  // ponteiro laser (meu e dos outros)
  const now = performance.now();
  let anim = false;
  for (const uid in S.cursors) {
    if (uid === S.uid) continue;
    const c = S.cursors[uid];
    if (c?.laser?.length >= 2) drawLaser(c.laser, c.color, z);
  }
  if (myLaser) {
    myLaser = myLaser.filter((p) => now - p[2] < 900);
    if (myLaser.length) { drawLaser(myLaser.flatMap((p) => [p[0], p[1]]), S.me.color, z); anim = true; }
  }

  // pings
  for (const k in S.pings) {
    const p = S.pings[k];
    const el = now - p.t0;
    if (el > 2400) { delete S.pings[k]; continue; }
    anim = true;
    ctx.save();
    for (let i = 0; i < 2; i++) {
      const e = (el - i * 400) / 1600;
      if (e < 0 || e > 1) continue;
      ctx.globalAlpha = 1 - e;
      ctx.strokeStyle = p.color || '#fff';
      ctx.lineWidth = 4 / z;
      ctx.beginPath(); ctx.arc(p.x, p.y, (8 + e * 60) / z, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.fillStyle = p.color || '#fff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 5 / z, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  if (anim) requestDraw();
  emit('view');
}

function tokenSize(t) { return (Number(t.s) || 1) * cell(); }
function tokenBox(t) {
  const s = tokenSize(t);
  if (t.shape === 'free') {
    const img = getImage(t.img);
    if (img) return [s, s * img.naturalHeight / img.naturalWidth];
  }
  return [s, s];
}
function tokenRadius(t) { const [w, h] = tokenBox(t); return Math.max(w, h) / 2; }

function drawToken(id, t, z, view, alpha = 1) {
  if (resizeLive?.id === id) t = { ...t, s: resizeLive.s, x: resizeLive.x, y: resizeLive.y };
  if (rotLive?.id === id) t = { ...t, rot: rotLive.rot };
  const [x, y] = tokenPos(id, t);
  const [w, h] = tokenBox(t);
  if (x + w < view.x0 || x - w > view.x1 || y + h < view.y0 || y - h > view.y1) return;
  const img = getImage(t.img);
  ctx.save();
  ctx.globalAlpha = alpha;
  const border = Math.max(2 / z, w * 0.04);
  // corpo do token desenhado em volta de (0,0), já girado/espelhado
  ctx.save();
  ctx.translate(x, y);
  if (t.rot) ctx.rotate((Number(t.rot) * Math.PI) / 180);
  if (t.flip) ctx.scale(-1, 1);
  if (t.shape === 'circle') {
    const r = w / 2;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = t.color || '#888'; ctx.fill();
    if (img) {
      ctx.save(); ctx.clip();
      const sc = Math.max(w / img.naturalWidth, w / img.naturalHeight);
      ctx.drawImage(img, -img.naturalWidth * sc / 2, -img.naturalHeight * sc / 2, img.naturalWidth * sc, img.naturalHeight * sc);
      ctx.restore();
    } else drawInitials(t, 0, 0, w);
    ctx.lineWidth = border; ctx.strokeStyle = t.color || '#888';
    ctx.beginPath(); ctx.arc(0, 0, r - border / 2, 0, Math.PI * 2); ctx.stroke();
  } else if (t.shape === 'free') {
    if (img) ctx.drawImage(img, -w / 2, -h / 2, w, h);
    else { ctx.fillStyle = t.color || '#888'; ctx.fillRect(-w / 2, -h / 2, w, h); drawInitials(t, 0, 0, w); }
  } else {
    ctx.fillStyle = t.color || '#888';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    if (img) {
      const sc = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      ctx.drawImage(img, -img.naturalWidth * sc / 2, -img.naturalHeight * sc / 2, img.naturalWidth * sc, img.naturalHeight * sc);
    } else drawInitials(t, 0, 0, w);
    ctx.lineWidth = border; ctx.strokeStyle = t.color || '#888';
    ctx.strokeRect(-w / 2 + border / 2, -h / 2 + border / 2, w - border, h - border);
  }
  ctx.restore();
  // morto: X vermelho
  if (t.cond?.dead) {
    ctx.strokeStyle = '#e05d6f'; ctx.lineWidth = Math.max(3 / z, w * 0.08); ctx.lineCap = 'round';
    const a = w * 0.32;
    ctx.beginPath(); ctx.moveTo(x - a, y - a); ctx.lineTo(x + a, y + a); ctx.moveTo(x + a, y - a); ctx.lineTo(x - a, y + a); ctx.stroke();
  }
  const isMapLayer = (t.layer || 'token') === 'map';
  const ow = Math.min(w, cell() * 1.25); // tamanho de referência dos indicadores (não cresce com monstros enormes)
  const st = tokenStats(t);
  const seeStats = !isMapLayer && (isGM() || !t.hideHp || t.owner === S.uid);
  // CA (escudo, canto inferior esquerdo) e ND (etiqueta, canto inferior direito)
  if (seeStats && (st.ac !== '' && st.ac != null)) {
    const fs = Math.max(10 / z, ow * 0.2);
    const cx = x - w / 2 + fs * 0.55, cy = y + h / 2 - fs * 0.6;
    ctx.beginPath();
    ctx.moveTo(cx - fs * 0.55, cy - fs * 0.6);
    ctx.lineTo(cx + fs * 0.55, cy - fs * 0.6);
    ctx.lineTo(cx + fs * 0.55, cy + fs * 0.05);
    ctx.quadraticCurveTo(cx + fs * 0.5, cy + fs * 0.55, cx, cy + fs * 0.75);
    ctx.quadraticCurveTo(cx - fs * 0.5, cy + fs * 0.55, cx - fs * 0.55, cy + fs * 0.05);
    ctx.closePath();
    ctx.fillStyle = '#1b1e25'; ctx.fill();
    ctx.lineWidth = Math.max(1.2 / z, fs * 0.08); ctx.strokeStyle = '#a5abb8'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `800 ${fs * 0.62}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(st.ac), cx, cy + fs * 0.02);
  }
  if (seeStats && st.cr !== '' && st.cr != null) {
    const fs = Math.max(9 / z, ow * 0.16);
    ctx.font = `800 ${fs}px system-ui, sans-serif`;
    const label = 'ND ' + st.cr;
    const tw = ctx.measureText(label).width + fs * 0.7;
    const bx = x + w / 2 - tw, by = y + h / 2 - fs * 1.35;
    ctx.fillStyle = 'rgba(122,62,160,.95)';
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, tw, fs * 1.3, fs * 0.35); else ctx.rect(bx, by, tw, fs * 1.3); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + tw / 2, by + fs * 0.68);
  }
  // barra de vida (abaixo do token)
  let below = y + h / 2 + 3 / z;
  const hpMaxN = Number(st.hpMax) > 0 ? Number(st.hpMax) : (Number(st.hp) > 0 ? Number(st.hp) : 0);
  if (seeStats && hpMaxN > 0) {
    const frac = Math.max(0, Math.min(1, (Number(st.hp) || 0) / hpMaxN));
    const bw = Math.max(Math.min(w * 0.9, w - 2 * cell() * 0.1), 30 / z), bh = Math.max(6 / z, ow * 0.08);
    const bx = x - bw / 2, by = below;
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(bx - 1.5 / z, by - 1.5 / z, bw + 3 / z, bh + 3 / z);
    ctx.fillStyle = '#3a1f25'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = frac > 0.5 ? '#6cc56b' : frac > 0.25 ? '#e6d24a' : '#e05d6f';
    ctx.fillRect(bx, by, bw * frac, bh);
    // números dentro da barra quando há espaço
    if (bh * z >= 9) {
      ctx.font = `700 ${bh * 0.82}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = bh * 0.22; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineJoin = 'round';
      const txt = `${st.hp ?? 0}/${hpMaxN}`;
      ctx.strokeText(txt, x, by + bh * 0.55); ctx.fillStyle = '#fff'; ctx.fillText(txt, x, by + bh * 0.55);
    }
    below = by + bh + 3 / z;
  }
  // condições
  const conds = Object.keys(t.cond || {}).filter((c) => c !== 'dead' && COND[c]);
  if (conds.length) {
    const fs = Math.max(11 / z, ow * 0.2);
    ctx.font = `${fs}px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    conds.slice(0, 6).forEach((c, i) => {
      const cx = x + w / 2 - fs * 0.35, cy = y - h / 2 + fs * 0.5 + i * fs * 1.05;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.beginPath(); ctx.arc(cx, cy, fs * 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(COND[c].icon, cx, cy + fs * 0.05);
    });
  }
  // nome (abaixo da barra)
  if (t.name && t.showName !== false) {
    const fs = 12.5 / z;
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineJoin = 'round'; ctx.lineWidth = 3.5 / z; ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.strokeText(t.name, x, below);
    ctx.fillStyle = '#fff'; ctx.fillText(t.name, x, below);
  }
  ctx.restore();
}

function drawInitials(t, x, y, w) {
  const txt = (t.name || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.font = `700 ${w * 0.38}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, x, y + w * 0.02);
}

function drawShape(d, z) {
  if (d?.type === 'tpl') { if (d.tpl) drawTemplate(d.tpl, d.color, z, scene(), null, true); return; }
  if (d?.type === 'text') { drawText(d); return; }
  if (d?.type === 'note') { if (!d.gmOnly || isGM()) drawNote(d, z); return; }
  if (!d?.pts) return;
  const p = d.pts;
  ctx.save();
  ctx.strokeStyle = d.color || '#fff';
  ctx.fillStyle = d.color || '#fff';
  ctx.lineWidth = d.w || 4;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (d.type === 'free' || d.type === 'line') {
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    if (p.length === 2) ctx.lineTo(p[0] + 0.1, p[1]);
    ctx.stroke();
  } else if (d.type === 'rect') {
    ctx.rect(Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.abs(p[2] - p[0]), Math.abs(p[3] - p[1]));
    if (d.fill) { ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.stroke();
  } else if (d.type === 'circle') {
    ctx.arc(p[0], p[1], Math.hypot(p[2] - p[0], p[3] - p[1]), 0, Math.PI * 2);
    if (d.fill) { ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.stroke();
  }
  ctx.restore();
  void z;
}

// ---------------- Texto e notas ----------------
function textLines(d) { return String(d.text || '').split('\n'); }
function drawText(d) {
  const fs = Number(d.size) || 24;
  ctx.save();
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const lines = textLines(d);
  lines.forEach((ln, i) => {
    const y = d.y + (i - (lines.length - 1) / 2) * fs * 1.2;
    ctx.lineWidth = fs * 0.2; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(ln, d.x, y);
    ctx.fillStyle = d.color || '#fff'; ctx.fillText(ln, d.x, y);
  });
  ctx.restore();
}
function lighten(hex, k = 0.72) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff3b0';
  const n = parseInt(m[1], 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function noteLayout(d) {
  const w = Number(d.w) || 210;
  const fs = w / 11, pad = fs * 0.75;
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  const lines = [];
  for (const para of textLines(d)) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      const test = cur ? cur + ' ' + word : word;
      if (ctx.measureText(test).width > w - pad * 2 && cur) { lines.push(cur); cur = word; } else cur = test;
    }
    lines.push(cur);
  }
  const hgt = Math.max(fs * 2.2, pad * 2 + lines.length * fs * 1.3);
  return { w, h: hgt, fs, pad, lines };
}
function drawNote(d, z) {
  ctx.save();
  const L = noteLayout(d);
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 10 / z; ctx.shadowOffsetY = 3 / z;
  ctx.fillStyle = d.color ? lighten(d.color) : '#fff3b0';
  roundRect(d.x, d.y, L.w, L.h, L.fs * 0.35); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#2a2208'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = `600 ${L.fs}px system-ui, sans-serif`;
  L.lines.forEach((ln, i) => ctx.fillText(ln, d.x + L.pad, d.y + L.pad + i * L.fs * 1.3));
  if (d.gmOnly) { ctx.font = `${L.fs * 0.8}px system-ui`; ctx.textAlign = 'right'; ctx.fillText('🔒', d.x + L.w - L.pad * 0.4, d.y + L.pad * 0.3); }
  ctx.restore();
}

// ---------------- Edição de desenhos e névoa ----------------
function itemOf(sel) { if (!sel) return null; if (editLive && editLive.coll === sel.coll && editLive.key === sel.key) return editLive.item; return S[sel.coll]?.[sel.key] || null; }
function bboxOf(d) {
  if (!d) return null;
  if (d.type === 'tpl' && d.tpl) return tplGeom(d.tpl).bbox;
  if (d.type === 'text') {
    const fs = Number(d.size) || 24; ctx.save(); ctx.font = `700 ${fs}px system-ui, sans-serif`;
    const lines = textLines(d); const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)); ctx.restore();
    const hh = lines.length * fs * 1.2;
    return [d.x - tw / 2 - 4, d.y - hh / 2, d.x + tw / 2 + 4, d.y + hh / 2];
  }
  if (d.type === 'note') { const L = noteLayout(d); return [d.x, d.y, d.x + L.w, d.y + L.h]; }
  const p = d.pts || [];
  if (d.type === 'circle') { const r = Math.hypot(p[2] - p[0], p[3] - p[1]); return [p[0] - r, p[1] - r, p[0] + r, p[1] + r]; }
  if (!p.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  const pad = d.shape === 'brush' ? (d.r || 0) : (d.w || 0) / 2;
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
// aplica (x,y) -> f(x,y) em todos os pontos do item; k = escala (para raio, tamanho de texto etc.)
function transformItem(d, f, k = 1) {
  const o = structuredClone(d);
  if (o.pts) { const p = o.pts; for (let i = 0; i + 1 < p.length; i += 2) { const [a, b] = f(p[i], p[i + 1]); p[i] = Math.round(a * 10) / 10; p[i + 1] = Math.round(b * 10) / 10; } }
  if (o.tpl) { o.tpl.a = f(...o.tpl.a); o.tpl.b = f(...o.tpl.b); }
  if (o.type === 'text' || o.type === 'note') [o.x, o.y] = f(o.x, o.y);
  if (k !== 1) {
    if (o.type === 'text') o.size = Math.max(6, (Number(o.size) || 24) * k);
    if (o.type === 'note') o.w = Math.max(60, (Number(o.w) || 210) * k);
    if (o.shape === 'brush') o.r = (o.r || 35) * k;
  }
  return o;
}
function editHandle() {
  const d = itemOf(editSel); const b = bboxOf(d);
  if (!b) return null;
  const [sx, sy] = toScreen(b[2], b[3]);
  return { x: b[2], y: b[3], sx, sy, b };
}
function drawEditBox(z) {
  const hd = editHandle(); if (!hd) return;
  const [x0, y0, x1, y1] = hd.b;
  ctx.save();
  ctx.strokeStyle = '#4fb3d9'; ctx.lineWidth = 1.5 / z; ctx.setLineDash([6 / z, 4 / z]);
  ctx.strokeRect(x0 - 4 / z, y0 - 4 / z, x1 - x0 + 8 / z, y1 - y0 + 8 / z);
  ctx.setLineDash([]); ctx.fillStyle = '#4fb3d9'; ctx.strokeStyle = '#1b1e25'; ctx.lineWidth = 2 / z;
  ctx.beginPath(); ctx.arc(hd.x, hd.y, 8 / z, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawFogOutlines(z) {
  ctx.save();
  ctx.lineWidth = 2 / z; ctx.setLineDash([7 / z, 5 / z]);
  for (const k of Object.keys(S.fog)) {
    const op = itemOf({ coll: 'fog', key: k }) || S.fog[k];
    if (op.shape === 'all') continue;
    ctx.strokeStyle = op.mode === 'reveal' ? '#6cc56b' : '#e05d6f';
    fogPath(ctx, op);
    if (op.shape === 'brush') { ctx.lineWidth = Math.max(2 / z, 2); ctx.stroke(); ctx.lineWidth = 2 / z; } else { ctx.closePath?.(); ctx.stroke(); }
  }
  ctx.restore();
}
function pointInPoly(p, x, y) {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function hitFog(wx, wy) {
  for (const k of Object.keys(S.fog).sort().reverse()) {
    const op = S.fog[k], p = op.pts || [];
    if (op.shape === 'rect' && wx >= Math.min(p[0], p[2]) && wx <= Math.max(p[0], p[2]) && wy >= Math.min(p[1], p[3]) && wy <= Math.max(p[1], p[3])) return k;
    if (op.shape === 'poly' && pointInPoly(p, wx, wy)) return k;
    if (op.shape === 'brush') for (let i = 0; i + 1 < p.length; i += 2) if (Math.hypot(wx - p[i], wy - p[i + 1]) <= (op.r || 35)) return k;
  }
  return null;
}
export function getEditSel() { return editSel ? { ...editSel, item: itemOf(editSel) } : null; }
export function editSelPatch(obj) {
  if (!editSel) return;
  const cur = S[editSel.coll][editSel.key]; if (!cur) return;
  write(`${editSel.coll}/${S.sceneId}/${editSel.key}`, { ...cur, ...obj });
}
export function editSelDelete() {
  if (!editSel) return;
  write(`${editSel.coll}/${S.sceneId}/${editSel.key}`, null);
  editSel = null; emit('editsel'); requestDraw();
}
export function clearEditSel() { editSel = null; editLive = null; emit('editsel'); requestDraw(); }
const canEditDrawing = (d) => d && (isGM() || d.owner === S.uid);

// ---------------- Paredes e visão ----------------
function hitWall(wx, wy, doorsOnly = false) {
  const tol = 10 / cam.z;
  for (const k of Object.keys(S.walls)) {
    const w = S.walls[k], p = w.pts || [];
    if (doorsOnly && !w.door) continue;
    for (let i = 2; i + 1 < p.length; i += 2) if (distToSeg(wx, wy, p[i - 2], p[i - 1], p[i], p[i + 1]) < tol) return k;
  }
  return null;
}
function drawWalls(z) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const line = (p) => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); ctx.stroke(); };
  for (const k of Object.keys(S.walls)) {
    const w = S.walls[k]; if (!w.pts) continue;
    ctx.setLineDash(w.door && w.open ? [8 / z, 6 / z] : []);
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 7 / z; line(w.pts);
    ctx.strokeStyle = w.door ? '#e8a33d' : '#4fb3d9'; ctx.lineWidth = 4 / z; line(w.pts);
    ctx.setLineDash([]); ctx.fillStyle = ctx.strokeStyle;
    for (let i = 0; i + 1 < w.pts.length; i += 2) { ctx.beginPath(); ctx.arc(w.pts[i], w.pts[i + 1], 3.5 / z, 0, Math.PI * 2); ctx.fill(); }
  }
  if (wallPts) {
    ctx.strokeStyle = S.sub.walls?.mode === 'door' ? '#e8a33d' : '#4fb3d9'; ctx.lineWidth = 4 / z; ctx.setLineDash([6 / z, 4 / z]);
    line(hoverW ? [...wallPts, ...hoverW] : wallPts);
    ctx.setLineDash([]); ctx.fillStyle = '#fff';
    for (let i = 0; i + 1 < wallPts.length; i += 2) { ctx.beginPath(); ctx.arc(wallPts[i], wallPts[i + 1], 5 / z, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}
// luzes: tokens com luz (camada de tokens e de mapa — tochas, lampiões)
function sceneLights() {
  const c = cell();
  const out = [];
  for (const id in S.tokens) {
    const t = S.tokens[id];
    const b = Number(t.light) || 0, dm = Number(t.dim) || 0;
    if (b + dm <= 0 || t.layer === 'gm') continue;
    const [x, y] = tokenPos(id, t);
    out.push({ id, x, y, R: (b + dm) * c + c / 2, bright: b * c + c / 2 });
  }
  return out;
}
function buildVision(sc, gm) {
  visDirty = false;
  const fs = Math.min(1, 2048 / Math.max(sc.w, sc.h));
  const W2 = Math.max(1, Math.ceil(sc.w * fs)), H2 = Math.max(1, Math.ceil(sc.h * fs));
  if (!visC) visC = document.createElement('canvas');
  if (visSceneId !== S.sceneId || !exploredC || exploredC.width !== W2 || exploredC.height !== H2) {
    exploredC = document.createElement('canvas'); exploredC.width = W2; exploredC.height = H2;
    visSceneId = S.sceneId;
  }
  visC.width = W2; visC.height = H2;
  const lights = visCache.compute(sceneLights(), S.walls, String(wallsVersion));
  const v = sc.vision || {};
  const dark = v.dark ?? 1;
  const g = visC.getContext('2d');
  g.setTransform(fs, 0, 0, fs, 0, 0);
  g.fillStyle = `rgba(4,5,9,${dark})`; g.fillRect(0, 0, sc.w, sc.h);
  const polyPath = (gg, poly) => { gg.beginPath(); gg.moveTo(poly[0], poly[1]); for (let i = 2; i < poly.length; i += 2) gg.lineTo(poly[i], poly[i + 1]); gg.closePath(); };
  // áreas já exploradas ficam à meia-luz (memória deste aparelho)
  if (v.explore !== false && !gm) {
    const e = exploredC.getContext('2d');
    e.setTransform(fs, 0, 0, fs, 0, 0); e.fillStyle = '#fff';
    for (const L of lights) { polyPath(e, L.poly); e.fill(); }
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.45; g.drawImage(exploredC, 0, 0); g.restore();
  }
  g.globalCompositeOperation = 'destination-out';
  for (const L of lights) {
    const grad = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.R);
    const bf = Math.min(0.999, L.bright / L.R);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(bf, 'rgba(0,0,0,1)');
    if (bf < 0.95) grad.addColorStop(Math.min(0.999, bf + (1 - bf) * 0.85), 'rgba(0,0,0,.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    polyPath(g, L.poly); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}

function drawLaser(pts, color, z) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const n = pts.length / 2;
  for (let i = 1; i < n; i++) {
    ctx.globalAlpha = (i / n) * 0.9;
    ctx.strokeStyle = color || '#e05d6f';
    ctx.lineWidth = (2 + (i / n) * 4) / z;
    ctx.beginPath(); ctx.moveTo(pts[i * 2 - 2], pts[i * 2 - 1]); ctx.lineTo(pts[i * 2], pts[i * 2 + 1]); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const hx = pts[pts.length - 2], hy = pts[pts.length - 1];
  ctx.shadowColor = color || '#e05d6f'; ctx.shadowBlur = 12 / z;
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, hy, 4 / z, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function buildFog(sc) {
  fogDirty = false;
  const fs = Math.min(1, 2048 / Math.max(sc.w, sc.h));
  fogC ||= document.createElement('canvas');
  fogC.width = Math.max(1, Math.ceil(sc.w * fs)); fogC.height = Math.max(1, Math.ceil(sc.h * fs));
  const g = fogC.getContext('2d');
  g.setTransform(fs, 0, 0, fs, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = FOG; g.fillRect(0, 0, sc.w, sc.h);
  for (const k of Object.keys(S.fog).sort()) applyFogOp(g, itemOf({ coll: 'fog', key: k }) || S.fog[k], sc);
}
function fogPath(g, op) {
  const p = op.pts || [];
  g.beginPath();
  if (op.shape === 'rect') g.rect(Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.abs(p[2] - p[0]), Math.abs(p[3] - p[1]));
  else if (op.shape === 'poly') { g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); }
  else if (op.shape === 'brush') { g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); if (p.length === 2) g.lineTo(p[0] + 0.1, p[1]); }
}
function applyFogOp(g, op, sc) {
  g.globalCompositeOperation = op.mode === 'reveal' ? 'destination-out' : 'source-over';
  g.fillStyle = FOG; g.strokeStyle = FOG;
  if (op.shape === 'all') { g.fillRect(0, 0, sc.w, sc.h); return; }
  fogPath(g, op);
  if (op.shape === 'brush') { g.lineWidth = (op.r || 35) * 2; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); }
  else g.fill();
}
function drawFogPreview(op, z) {
  ctx.save();
  const col = op.mode === 'reveal' ? '#6cc56b' : '#e05d6f';
  ctx.globalAlpha = 0.35; ctx.fillStyle = col; ctx.strokeStyle = col;
  fogPath(ctx, op);
  if (op.shape === 'brush') { ctx.lineWidth = (op.r || 35) * 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); }
  else { ctx.fill(); ctx.globalAlpha = 1; ctx.lineWidth = 2 / z; ctx.stroke(); }
  ctx.restore();
}
function drawPolyPreview(z) {
  const col = (S.sub.fog?.mode || 'reveal') === 'reveal' ? '#6cc56b' : '#e05d6f';
  ctx.save();
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2 / z;
  ctx.beginPath();
  ctx.moveTo(polyPts[0], polyPts[1]);
  for (let i = 2; i < polyPts.length; i += 2) ctx.lineTo(polyPts[i], polyPts[i + 1]);
  if (hoverW) ctx.lineTo(hoverW[0], hoverW[1]);
  ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
  for (let i = 0; i < polyPts.length; i += 2) { ctx.beginPath(); ctx.arc(polyPts[i], polyPts[i + 1], (i ? 4 : 7) / z, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function drawRuler(r, color, z, sc, name, small) {
  if (!r || r.length < 4) return;
  // ignora pontos repetidos em sequência (ex.: soltar no mesmo lugar do último ponto)
  const d = [r[0], r[1]];
  for (let i = 2; i < r.length; i += 2) if (r[i] !== d[d.length - 2] || r[i + 1] !== d[d.length - 1]) d.push(r[i], r[i + 1]);
  if (d.length < 4) d.push(r[0], r[1]);
  r = d;
  const n = r.length / 2;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const path = () => { ctx.beginPath(); ctx.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1]); };
  ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 6 / z; path(); ctx.stroke();
  ctx.strokeStyle = color || '#fff'; ctx.lineWidth = 3 / z;
  ctx.setLineDash(small ? [6 / z, 6 / z] : []);
  path(); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color || '#fff';
  for (let i = 0; i < r.length; i += 2) { ctx.beginPath(); ctx.arc(r[i], r[i + 1], (i && i < r.length - 2 ? 6 : 5) / z, 0, Math.PI * 2); ctx.fill(); }
  const tag = (label, x, y, big) => {
    const fs = (big ? 14 : 11.5) / z;
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width;
    const lx = x + 12 / z, ly = y - (big ? 26 : 22) / z;
    ctx.fillStyle = big ? 'rgba(15,17,21,.92)' : 'rgba(15,17,21,.75)';
    roundRect(lx - 5 / z, ly - 3 / z, tw + 10 / z, fs + 7 / z, 5 / z); ctx.fill();
    ctx.fillStyle = big ? '#fff' : '#cfd3dc'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText(label, lx, ly + 1 / z);
  };
  // distância acumulada em cada ponto intermediário
  for (let k = 2; k < n; k++) tag(G.cellsLabel(sc.grid, G.pathCells(sc.grid, r.slice(0, k * 2))), r[k * 2 - 2], r[k * 2 - 1], false);
  const total = G.cellsLabel(sc.grid, G.pathCells(sc.grid, r));
  tag(total + (n > 2 ? ` · ${n - 1} trechos` : '') + (name ? ` · ${name}` : ''), r[r.length - 2], r[r.length - 1], true);
  ctx.restore();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---------------- Hit testing ----------------
export function hitToken(wx, wy) {
  const layers = selectableLayers();
  const order = ['map', 'token', 'gm'];
  const ids = Object.keys(S.tokens).sort((a, b) => order.indexOf(S.tokens[a].layer || 'token') - order.indexOf(S.tokens[b].layer || 'token') || zOrder(a, b)).reverse();
  for (const id of ids) {
    const t = S.tokens[id];
    if (!layers.includes(t.layer || 'token')) continue;
    const [x, y] = tokenPos(id, t);
    const [w, h] = tokenBox(t);
    if (t.shape === 'circle' ? Math.hypot(wx - x, wy - y) <= w / 2 : Math.abs(wx - x) <= w / 2 && Math.abs(wy - y) <= h / 2) return id;
  }
  return null;
}
function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function hitDrawing(wx, wy) {
  const tol = 10 / cam.z;
  for (const k of Object.keys(S.drawings).sort().reverse()) {
    const d = S.drawings[k], p = d.pts || [];
    const w = (d.w || 4) / 2 + tol;
    if (d.type === 'tpl') { if (d.tpl && tplGeom(d.tpl).contains(wx, wy)) return k; continue; }
    if (d.type === 'text' || d.type === 'note') {
      if (d.gmOnly && !isGM()) continue;
      const b = bboxOf(d); if (b && wx >= b[0] && wx <= b[2] && wy >= b[1] && wy <= b[3]) return k;
      continue;
    }
    if (d.type === 'free' || d.type === 'line') {
      if (p.length === 2 && Math.hypot(wx - p[0], wy - p[1]) < w) return k;
      for (let i = 2; i < p.length; i += 2) if (distSeg(wx, wy, p[i - 2], p[i - 1], p[i], p[i + 1]) < w) return k;
    } else if (d.type === 'rect') {
      const x0 = Math.min(p[0], p[2]), x1 = Math.max(p[0], p[2]), y0 = Math.min(p[1], p[3]), y1 = Math.max(p[1], p[3]);
      const inside = wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1;
      const edge = Math.min(distSeg(wx, wy, x0, y0, x1, y0), distSeg(wx, wy, x0, y1, x1, y1), distSeg(wx, wy, x0, y0, x0, y1), distSeg(wx, wy, x1, y0, x1, y1));
      if ((d.fill && inside) || edge < w) return k;
    } else if (d.type === 'circle') {
      const r = Math.hypot(p[2] - p[0], p[3] - p[1]), dd = Math.hypot(wx - p[0], wy - p[1]);
      if ((d.fill && dd <= r) || Math.abs(dd - r) < w) return k;
    }
  }
  return null;
}

// ---------------- Entrada ----------------
const pointers = new Map();
let gesture = null;
let longPress = null;
let lastNet = 0;
let lastTap = { t: 0, x: 0, y: 0 };

let trailT = null, trailFn = null;
function cancelTrail() { clearTimeout(trailT); trailT = null; trailFn = null; }
function throttled(fn, ms = 70) {
  // envia no máximo a cada `ms`, mas sempre manda o último valor (para a régua não parar no meio)
  const now = performance.now();
  if (now - lastNet >= ms) { lastNet = now; clearTimeout(trailT); trailFn = null; fn(); return true; }
  trailFn = fn;
  if (!trailT) trailT = setTimeout(() => { trailT = null; if (trailFn) { const f = trailFn; trailFn = null; lastNet = performance.now(); f(); } }, ms - (now - lastNet));
  return false;
}

function bindInput() {
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const k = e.deltaMode === 1 ? 0.05 : 0.0018;
    zoomBy(Math.exp(-e.deltaY * k * (e.ctrlKey ? 2.5 : 1)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    const [wx, wy] = clientToWorld(e.clientX, e.clientY);
    if (S.tool === 'fog' && polyPts) { finishPoly(); return; }
    if (S.tool === 'select') { const id = hitToken(wx, wy); if (id) emit('token:open', id); }
    if (S.tool === 'draw' && S.sub.draw?.shape === 'select') { const k = hitDrawing(wx, wy); const d = k && S.drawings[k]; if (d && (d.type === 'text' || d.type === 'note') && canEditDrawing(d)) emit('edit-text', k); }
    if (S.tool === 'walls' && wallPts) finishWall();
  });
  addEventListener('keydown', onKey);
  // Ctrl+C / Ctrl+X nos tokens: grava uma marca na área de transferência do sistema,
  // assim o Ctrl+V cola os tokens (e não um print/imagem copiado antes)
  const sysCopy = (cut) => (e) => {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || document.querySelector('dialog[open]')) return;
    if (String(getSelection?.() || '').trim()) return; // texto selecionado na página: deixa copiar normal
    if (!S.selected.size) return;
    const n = onSystemCopy(e, cut);
    if (n) toast(cut ? `${n} token(s) recortado(s)` : `${n} token(s) copiado(s) — Ctrl+V para colar`);
  };
  document.addEventListener('copy', sysCopy(false));
  document.addEventListener('cut', sysCopy(true));
  addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
}

function pos(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

function onDown(e) {
  canvas.setPointerCapture?.(e.pointerId);
  const [sx, sy] = pos(e);
  pointers.set(e.pointerId, { x: sx, y: sy });
  clearTimeout(longPress);
  if (pointers.size === 2) { cancelGesture(); startPinch(); return; }
  if (pointers.size > 2 || !scene()) return;
  const [wx, wy] = toWorld(sx, sy);
  const down = { sx, sy, wx, wy, t: performance.now(), moved: false, alt: e.altKey, shift: e.shiftKey };

  if (e.button === 1 || e.button === 2 || spaceDown) { gesture = { type: 'pan', ...down, cx: cam.x, cy: cam.y }; return; }
  const sc = scene();
  const g = sc.grid;

  switch (S.tool) {
    case 'select': {
      const near = e.pointerType === 'mouse' ? 13 : 22;
      const rh = rotHandleInfo();
      if (rh && Math.hypot(sx - rh.sx, sy - rh.sy) <= near) {
        gesture = { type: 'rotate', ...down, id: rh.id, prev: structuredClone(S.tokens[rh.id]), cx: rh.cx, cy: rh.cy };
        break;
      }
      const hd = handleInfo();
      if (hd && Math.hypot(sx - hd.sx, sy - hd.sy) <= near) {
        const t = S.tokens[hd.id];
        const half = (Number(t.s) || 1) * cell() / 2;
        gesture = { type: 'resize', ...down, id: hd.id, prev: structuredClone(t), tl: [t.x - half, t.y - half] };
        break;
      }
      const id = hitToken(wx, wy);
      const multi = e.shiftKey || e.ctrlKey || e.metaKey;
      if (id) {
        if (multi) { S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id); emit('selection'); }
        else if (!S.selected.has(id)) select([id]);
        const movable = [...S.selected].filter((k) => S.tokens[k] && canDrag(S.tokens[k]));
        if (movable.length && S.selected.has(id)) {
          const start = {};
          for (const k of movable) start[k] = [S.tokens[k].x, S.tokens[k].y];
          gesture = { type: 'token', ...down, id, start, prev: Object.fromEntries(movable.map((k) => [k, structuredClone(S.tokens[k])])) };
        } else gesture = { type: 'pan', ...down, cx: cam.x, cy: cam.y, tapToken: id };
      } else {
        if (!multi && S.selected.size) select([]);
        // arrastar no vazio: caixa de seleção (padrão no mouse) ou mover o mapa (padrão no toque)
        const dragMode = S.sub.select?.drag || (e.pointerType === 'mouse' ? 'select' : 'pan');
        if (dragMode === 'select') gesture = { type: 'marquee', ...down, add: multi };
        else {
          gesture = { type: 'pan', ...down, cx: cam.x, cy: cam.y, emptyTap: true };
          longPress = setTimeout(() => { if (gesture && !gesture.moved) { ping(wx, wy); gesture = { type: 'none' }; } }, 550);
        }
      }
      break;
    }
    case 'measure': {
      const mode = S.sub.measure?.mode || 'ruler';
      if (mode !== 'ruler') {
        // áreas: origem no canto do grid (regra do D&D), a não ser com Alt
        const a = g.type === 'none' || e.altKey ? [wx, wy] : (g.type === 'square' ? G.snapCorner(g, wx, wy) : G.snap(g, wx, wy, 1));
        myTpl = { k: mode, a: [a[0], a[1]], b: [a[0], a[1]], w: S.sub.measure?.lineW || 1 };
        gesture = { type: 'tpl', ...down };
        requestDraw();
        break;
      }
      if (myTpl) myTpl = null;
      if (rulerSticky && myRuler) { gesture = { type: 'rulertap', ...down, cx: cam.x, cy: cam.y }; break; }
      const a = g.type === 'none' ? [wx, wy] : G.snap(g, wx, wy, 1);
      myRuler = [a[0], a[1], a[0], a[1]];
      gesture = { type: 'measure', ...down };
      requestDraw();
      break;
    }
    case 'ping':
      // toque = ping; arrastar = ponteiro laser
      myLaser = [[wx, wy, performance.now()]];
      gesture = { type: 'laser', ...down, focus: isGM() && (S.sub.ping?.focus || e.shiftKey) };
      break;
    case 'walls': {
      if (!isGM()) { gesture = { type: 'pan', ...down, cx: cam.x, cy: cam.y }; break; }
      gesture = { type: 'walltap', ...down, cx: cam.x, cy: cam.y };
      break;
    }
    case 'draw': {
      const sub = S.sub.draw || {};
      const shape = sub.shape || 'free';
      if (shape === 'erase') { gesture = { type: 'erase', ...down }; eraseAt(wx, wy); break; }
      if (shape === 'select') { startEditGesture('drawings', down, wx, wy, sx, sy, e); break; }
      if (shape === 'text' || shape === 'note') { gesture = { type: 'placetext', ...down, kind: shape }; break; }
      const width = (sub.w || 4) * cell() / 70;
      live = { kind: 'draw', d: { type: shape, pts: [wx, wy], color: sub.color || '#e05d6f', w: width, fill: !!sub.fill } };
      if (shape !== 'free') live.d.pts.push(wx, wy);
      gesture = { type: 'draw', ...down };
      requestDraw();
      break;
    }
    case 'calib': {
      if (!isGM()) { gesture = { type: 'pan', ...down, cx: cam.x, cy: cam.y }; break; }
      calib = { a: [wx, wy], b: [wx, wy], fine: { s: 0, x: 0, y: 0 } };
      gesture = { type: 'calib', ...down };
      requestDraw();
      break;
    }
    case 'fog': {
      if (!isGM()) { gesture = { type: 'pan', ...down, cx: cam.x, cy: cam.y }; break; }
      const sub = S.sub.fog || {};
      const shape = sub.shape || 'rect', mode = sub.mode || 'reveal';
      if (shape === 'edit') { startEditGesture('fog', down, wx, wy, sx, sy, e); break; }
      if (shape === 'poly') { gesture = { type: 'poly', ...down }; break; }
      if (shape === 'rect') {
        const a = e.altKey ? [wx, wy] : G.snapCorner(g, wx, wy);
        live = { kind: 'fog', op: { mode, shape: 'rect', pts: [a[0], a[1], a[0], a[1]] } };
      } else {
        live = { kind: 'fog', op: { mode, shape: 'brush', pts: [wx, wy], r: (sub.size || 1) * cell() / 2 } };
      }
      gesture = { type: 'fog', ...down };
      requestDraw();
      break;
    }
  }
}

function onMove(e) {
  const [sx, sy] = pos(e);
  const p = pointers.get(e.pointerId);
  if (p) { p.x = sx; p.y = sy; }
  const [wx, wy] = toWorld(sx, sy);
  lastPointer = [wx, wy];
  if (polyPts) { hoverW = [wx, wy]; requestDraw(); }
  if (wallPts && e.pointerType === 'mouse') { const sc0 = scene(); hoverW = sc0 && !e.altKey ? G.snapCorner(sc0.grid, wx, wy) : [wx, wy]; requestDraw(); }
  if (rulerSticky && myRuler && (!gesture || gesture.type === 'rulertap') && e.pointerType === 'mouse') {
    const sc = scene();
    if (sc) {
      const b = sc.grid.type === 'none' || e.altKey ? [wx, wy] : G.snap(sc.grid, wx, wy, 1);
      myRuler[myRuler.length - 2] = b[0]; myRuler[myRuler.length - 1] = b[1];
      throttled(() => setCursor({ ruler: myRuler }), 90);
      requestDraw();
    }
  }
  if (!gesture || !p) return;
  if (gesture.type === 'pinch') { movePinch(); return; }
  if (!gesture.moved && Math.hypot(sx - gesture.sx, sy - gesture.sy) > 6) { gesture.moved = true; clearTimeout(longPress); }
  const sc = scene(); if (!sc) return;
  const g = sc.grid;
  switch (gesture.type) {
    case 'pan':
      if (!gesture.moved) return;
      cam.x = gesture.cx - (sx - gesture.sx) / cam.z;
      cam.y = gesture.cy - (sy - gesture.sy) / cam.z;
      requestDraw();
      break;
    case 'rotate': {
      let ang = (Math.atan2(wy - gesture.cy, wx - gesture.cx) * 180) / Math.PI + 90;
      if (!e.altKey) ang = Math.round(ang / 15) * 15;
      rotLive = { id: gesture.id, rot: ((ang % 360) + 360) % 360 };
      requestDraw();
      break;
    }
    case 'marquee':
      if (!gesture.moved) return;
      marquee = [gesture.wx, gesture.wy, wx, wy];
      requestDraw();
      break;
    case 'laser': {
      const last = myLaser[myLaser.length - 1];
      if (Math.hypot(wx - last[0], wy - last[1]) > 2 / cam.z) myLaser.push([wx, wy, performance.now()]);
      if (gesture.moved) throttled(() => setCursor({ laser: myLaser.slice(-40).flatMap((q) => [Math.round(q[0]), Math.round(q[1])]) }), 60);
      requestDraw();
      break;
    }
    case 'walltap':
    case 'pan2':
      if (gesture.moved) { cam.x = gesture.cx - (sx - gesture.sx) / cam.z; cam.y = gesture.cy - (sy - gesture.sy) / cam.z; requestDraw(); }
      break;
    case 'emove': {
      if (!gesture.moved) return;
      const dx = wx - gesture.wx, dy = wy - gesture.wy;
      editLive = { coll: gesture.coll, key: gesture.key, item: transformItem(gesture.orig, (x, y) => [x + dx, y + dy]) };
      requestDraw();
      break;
    }
    case 'escale': {
      const [x0, y0, x1, y1] = gesture.box;
      const k = Math.max(0.05, Math.max((wx - x0) / Math.max(1, x1 - x0), (wy - y0) / Math.max(1, y1 - y0)));
      editLive = { coll: gesture.coll, key: gesture.key, item: transformItem(gesture.orig, (x, y) => [x0 + (x - x0) * k, y0 + (y - y0) * k], k) };
      requestDraw();
      break;
    }
    case 'resize': {
      const c = cell();
      const [tlx, tly] = gesture.tl;
      let sz = Math.max(wx - tlx, wy - tly) / c;
      if (!e.altKey) sz = sz < 0.75 ? 0.5 : Math.round(sz);
      sz = Math.max(0.25, Math.min(20, Math.round(sz * 100) / 100));
      resizeLive = { id: gesture.id, s: sz, x: tlx + sz * c / 2, y: tly + sz * c / 2 };
      requestDraw();
      break;
    }
    case 'token': {
      if (!gesture.moved) return;
      const dx = wx - gesture.wx, dy = wy - gesture.wy;
      dragPos = {};
      for (const k in gesture.start) dragPos[k] = [gesture.start[k][0] + dx, gesture.start[k][1] + dy];
      const lead = gesture.start[gesture.id] ? gesture.id : Object.keys(gesture.start)[0];
      const t = S.tokens[lead];
      const [ex, ey] = g.snap === false || e.altKey ? dragPos[lead] : G.snap(g, ...dragPos[lead], t?.s || 1);
      dragInfo = { from: gesture.start[lead], to: [ex, ey] };
      throttled(() => { for (const k in dragPos) updateToken(k, { x: dragPos[k][0], y: dragPos[k][1] }, { undo: false }); });
      if (sc.vision?.on) visDirty = true;
      requestDraw();
      break;
    }
    case 'tpl': {
      myTpl.b = tplEnd(myTpl, wx, wy, g, e.altKey);
      throttled(() => setCursor({ tpl: myTpl }), 90);
      requestDraw();
      break;
    }
    case 'measure': {
      const b = g.type === 'none' || e.altKey ? [wx, wy] : G.snap(g, wx, wy, 1);
      const L = myRuler.length;
      const changed = myRuler[L - 2] !== b[0] || myRuler[L - 1] !== b[1];
      myRuler[L - 2] = b[0]; myRuler[L - 1] = b[1];
      // parou o dedo por um instante longe do último ponto = novo ponto do caminho
      if (changed && e.pointerType !== 'mouse') { clearTimeout(dwellT); dwellT = setTimeout(addWaypoint, 800); }
      throttled(() => setCursor({ ruler: myRuler }), 90);
      requestDraw();
      break;
    }
    case 'rulertap':
      if (gesture.moved) { cam.x = gesture.cx - (sx - gesture.sx) / cam.z; cam.y = gesture.cy - (sy - gesture.sy) / cam.z; requestDraw(); }
      break;
    case 'draw': {
      const d = live.d;
      if (d.type === 'free') {
        const lx = d.pts[d.pts.length - 2], ly = d.pts[d.pts.length - 1];
        if (Math.hypot(wx - lx, wy - ly) > 2.5 / cam.z) d.pts.push(Math.round(wx * 10) / 10, Math.round(wy * 10) / 10);
      } else { d.pts[2] = wx; d.pts[3] = wy; }
      requestDraw();
      break;
    }
    case 'erase': eraseAt(wx, wy); break;
    case 'calib': calib.b = [wx, wy]; requestDraw(); break;
    case 'fog': {
      const op = live.op;
      if (op.shape === 'rect') { const b = e.altKey ? [wx, wy] : G.snapCorner(g, wx, wy); op.pts[2] = b[0]; op.pts[3] = b[1]; }
      else {
        const lx = op.pts[op.pts.length - 2], ly = op.pts[op.pts.length - 1];
        if (Math.hypot(wx - lx, wy - ly) > op.r * 0.25) op.pts.push(Math.round(wx), Math.round(wy));
      }
      requestDraw();
      break;
    }
  }
}

function onUp(e) {
  const [sx, sy] = pos(e);
  if (gesture && gesture.type !== 'rulertap') cancelTrail(); // o envio final abaixo é o que vale
  pointers.delete(e.pointerId);
  clearTimeout(longPress);
  if (!gesture) return;
  if (gesture.type === 'pinch' || gesture.type === 'none') { if (!pointers.size) gesture = null; return; }
  const sc = scene();
  const g = sc?.grid || {};
  const [wx, wy] = toWorld(sx, sy);
  const G0 = gesture; gesture = null;
  switch (G0.type) {
    case 'rotate': {
      const rl = rotLive; rotLive = null;
      if (G0.moved && rl) { pushUndo(`tokens/${S.sceneId}/${rl.id}`, G0.prev); updateToken(rl.id, { rot: rl.rot || null }, { undo: false }); }
      requestDraw();
      break;
    }
    case 'marquee': {
      const m = marquee; marquee = null;
      if (!G0.moved || !m) {
        // clique no vazio: o mestre abre/fecha portas com clique simples
        if (isGM() && sc?.vision?.on) { const dk = hitWall(wx, wy, true); if (dk) updateWall(dk, { open: S.walls[dk].open ? null : true }); }
        requestDraw(); break;
      }
      const [x0, x1] = [Math.min(m[0], m[2]), Math.max(m[0], m[2])], [y0, y1] = [Math.min(m[1], m[3]), Math.max(m[1], m[3])];
      const layers = selectableLayers();
      const ids = Object.keys(S.tokens).filter((k) => { const t = S.tokens[k]; return layers.includes(t.layer || 'token') && t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1; });
      select(ids, G0.add);
      requestDraw();
      break;
    }
    case 'laser': {
      if (!G0.moved) { myLaser = null; ping(G0.wx, G0.wy, G0.focus); break; }
      setCursor({ laser: myLaser.slice(-40).flatMap((q) => [Math.round(q[0]), Math.round(q[1])]) });
      setTimeout(() => { if (!gesture || gesture.type !== 'laser') setCursor(null); }, 700);
      requestDraw();
      break;
    }
    case 'walltap': {
      if (G0.moved) break;
      onWallTap(wx, wy, sx, sy, e.altKey);
      break;
    }
    case 'emove':
    case 'escale': {
      const el = editLive; editLive = null;
      if (G0.moved && el) { write(`${el.coll}/${S.sceneId}/${el.key}`, el.item); if (el.coll === 'fog') fogDirty = true; }
      emit('editsel');
      requestDraw();
      break;
    }
    case 'placetext': {
      if (G0.moved) break;
      emit('place-text', { kind: G0.kind, x: G0.wx, y: G0.wy });
      break;
    }
    case 'resize': {
      const rl = resizeLive; resizeLive = null;
      if (G0.moved && rl) {
        let [x, y] = [rl.x, rl.y];
        if (g.snap !== false && !e.altKey) [x, y] = G.snap(g, x, y, rl.s);
        pushUndo(`tokens/${S.sceneId}/${rl.id}`, G0.prev);
        updateToken(rl.id, { s: rl.s, x: Math.round(x), y: Math.round(y) }, { undo: false });
      }
      requestDraw();
      break;
    }
    case 'token': {
      if (!G0.moved || !dragPos) { dragPos = null; dragInfo = null; break; }
      for (const k in dragPos) {
        const t = S.tokens[k];
        let [x, y] = dragPos[k];
        if (g.snap !== false && !e.altKey) [x, y] = G.snap(g, x, y, t?.s || 1);
        x = Math.round(x); y = Math.round(y);
        if (t) { t.x = x; t.y = y; }
        pushUndo(`tokens/${S.sceneId}/${k}`, G0.prev[k]);
        updateToken(k, { x, y }, { undo: false });
      }
      dragPos = null; dragInfo = null;
      requestDraw();
      break;
    }
    case 'pan': {
      if (!G0.moved && G0.emptyTap && isGM() && sc?.vision?.on) { const dk = hitWall(wx, wy, true); if (dk) updateWall(dk, { open: S.walls[dk].open ? null : true }); }
      if (!G0.moved) {
        // toque duplo em token no celular abre o painel
        const now = performance.now();
        if (G0.tapToken && now - lastTap.t < 350 && Math.hypot(sx - lastTap.x, sy - lastTap.y) < 20) emit('token:open', G0.tapToken);
        lastTap = { t: now, x: sx, y: sy };
      }
      break;
    }
    case 'measure':
      clearTimeout(dwellT);
      if (!G0.moved && myRuler.length === 4) {
        // toque simples: começa um caminho ponto a ponto
        rulerSticky = true;
        emit('ruler');
        setCursor({ ruler: myRuler });
        requestDraw();
        break;
      }
      myRuler = null; setCursor(null); requestDraw();
      break;
    case 'rulertap': {
      if (G0.moved) break; // foi só um arraste para mover a câmera
      const b = g.type === 'none' || e.altKey ? [wx, wy] : G.snap(g, wx, wy, 1);
      const L = myRuler.length;
      const lastFixed = [myRuler[L - 4], myRuler[L - 3]];
      // tocar de novo no último ponto encerra o caminho
      if (Math.hypot(...toScreen(...lastFixed).map((v, i) => v - [sx, sy][i])) < 18) { clearRuler(); break; }
      myRuler[L - 2] = b[0]; myRuler[L - 1] = b[1];
      myRuler.push(b[0], b[1]);
      setCursor({ ruler: myRuler });
      emit('ruler');
      requestDraw();
      break;
    }
    case 'tpl': {
      const sz = tplSize(myTpl);
      if (!G0.moved || sz < 2) { myTpl = null; setCursor(null); requestDraw(); emit('tpl'); break; }
      if (S.sub.measure?.persist) {
        addDrawing({ type: 'tpl', tpl: myTpl, pts: [...myTpl.a, ...myTpl.b], color: S.me.color });
        myTpl = null; setCursor(null);
      } else setCursor({ tpl: myTpl }); // fica visível para todos até a próxima medição
      emit('tpl');
      requestDraw();
      break;
    }
    case 'draw': {
      const d = live.d; live = null;
      const ok = d.type === 'free' ? d.pts.length >= 2 : Math.hypot(d.pts[2] - d.pts[0], d.pts[3] - d.pts[1]) > 3 / cam.z;
      if (ok) addDrawing(d);
      requestDraw();
      break;
    }
    case 'fog': {
      const op = live.op; live = null;
      const ok = op.shape === 'brush' || (Math.abs(op.pts[2] - op.pts[0]) > 2 && Math.abs(op.pts[3] - op.pts[1]) > 2);
      if (ok) addFog(op);
      requestDraw();
      break;
    }
    case 'calib':
      if (!G0.moved) calib = null;
      emit('calib');
      requestDraw();
      break;
    case 'poly': {
      if (G0.moved) break;
      if (!polyPts) polyPts = [];
      if (polyPts.length >= 6 && Math.hypot(...toScreen(polyPts[0], polyPts[1]).map((v, i) => v - [sx, sy][i])) < 16) { finishPoly(); break; }
      polyPts.push(Math.round(wx), Math.round(wy));
      hoverW = [wx, wy];
      emit('poly', polyPts.length / 2);
      requestDraw();
      break;
    }
  }
}

// ---------------- Tamanho de token ----------------
export const SIZES = [[0.5, 'Miúdo'], [1, 'Médio'], [2, 'Grande'], [3, 'Enorme'], [4, 'Imenso']];
export function sizeName(sz) {
  if (sz < 1) return 'Miúdo';
  if (sz < 2) return sz === 1 ? 'Médio' : 'Médio+';
  if (sz < 3) return 'Grande';
  if (sz < 4) return 'Enorme';
  return 'Imenso';
}
const fmtSize = (sz) => String(sz).replace('.', ',');
// Muda o tamanho mantendo o canto superior esquerdo no lugar e reencaixando no grid
export function resizeToken(id, sz) {
  const t = S.tokens[id]; const sc = scene();
  if (!t || !sc) return;
  const c = cell();
  const half = (Number(t.s) || 1) * c / 2;
  let x = t.x - half + sz * c / 2, y = t.y - half + sz * c / 2;
  if (sc.grid.snap !== false) [x, y] = G.snap(sc.grid, x, y, sz);
  updateToken(id, { s: sz, x: Math.round(x), y: Math.round(y) });
}
// Alça no canto inferior direito do token selecionado
function handleInfo() {
  if (S.tool !== 'select' || S.selected.size !== 1 || dragPos) return null;
  const id = [...S.selected][0];
  let t = S.tokens[id];
  if (!t || !canDrag(t)) return null;
  if (isGM() && (t.layer || 'token') === 'map' && S.layer !== 'map') return null;
  if (resizeLive?.id === id) t = { ...t, s: resizeLive.s, x: resizeLive.x, y: resizeLive.y };
  const [w, h] = tokenBox(t);
  const x = t.x + w / 2, y = t.y + h / 2;
  const [hsx, hsy] = toScreen(x, y);
  return { id, x, y, sx: hsx, sy: hsy };
}
// Alça de girar: acima do token selecionado
function rotHandleInfo() {
  const hd = handleInfo(); if (!hd || resizeLive) return null;
  const t = S.tokens[hd.id];
  const [, h] = tokenBox(t);
  const top = t.y - h / 2 - 4 / cam.z;
  const y = top - 22 / cam.z;
  const [sx, sy] = toScreen(t.x, y);
  return { id: hd.id, x: t.x, y, top, sx, sy, cx: t.x, cy: t.y };
}

// ---------------- Régua com pontos (caminho) ----------------
function addWaypoint() {
  if (!myRuler || gesture?.type !== 'measure') return;
  const L = myRuler.length;
  const s = cell();
  // só cria ponto se andou pelo menos meia casa desde o último
  if (Math.hypot(myRuler[L - 2] - myRuler[L - 4], myRuler[L - 1] - myRuler[L - 3]) < s * 0.5) return;
  myRuler.push(myRuler[L - 2], myRuler[L - 1]);
  navigator.vibrate?.(15);
  setCursor({ ruler: myRuler });
  requestDraw();
}
export function clearRuler() {
  clearTimeout(dwellT); cancelTrail();
  rulerSticky = false; myRuler = null;
  setCursor(null); emit('ruler'); requestDraw();
}
export const hasRuler = () => !!(rulerSticky && myRuler);

// ---------------- Áreas de efeito (magias) ----------------
export function clearTemplate() { cancelTrail(); myTpl = null; setCursor(null); emit('tpl'); requestDraw(); }
export const hasTemplate = () => !!myTpl;
export function pinTemplate() {
  if (!myTpl) return;
  addDrawing({ type: 'tpl', tpl: myTpl, pts: [...myTpl.a, ...myTpl.b], color: S.me.color });
  clearTemplate();
}
function tplSize(t) { return Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]); }

// Ajusta a ponta da área para tamanhos inteiros de casas (5 ft / 1,5 m)
function tplEnd(t, wx, wy, g, free) {
  const [ax, ay] = t.a;
  let dx = wx - ax, dy = wy - ay;
  const s = G.cellSize(g);
  const snapOn = g.type !== 'none' && !free;
  if (t.k === 'square') {
    let side = Math.max(Math.abs(dx), Math.abs(dy));
    if (snapOn) side = Math.max(1, Math.round(side / s)) * s;
    return [ax + Math.sign(dx || 1) * side, ay + Math.sign(dy || 1) * side];
  }
  let L = Math.hypot(dx, dy);
  if (L < 0.01) return [ax, ay];
  if (snapOn) L = Math.max(1, Math.round(L / s)) * s;
  // direção do cone/linha: encaixa em 15° quando o grid está ligado (fica mais fácil de mirar)
  let ang = Math.atan2(dy, dx);
  if (snapOn && t.k !== 'circle') ang = Math.round(ang / (Math.PI / 24)) * (Math.PI / 24);
  return [ax + Math.cos(ang) * L, ay + Math.sin(ang) * L];
}

// Geometria da área: polígono/círculo + teste de "ponto dentro"
function tplGeom(t) {
  const [ax, ay] = t.a, [bx, by] = t.b;
  const L = Math.hypot(bx - ax, by - ay) || 0.0001;
  const ux = (bx - ax) / L, uy = (by - ay) / L, px = -uy, py = ux;
  if (t.k === 'circle') {
    return { circle: [ax, ay, L], contains: (x, y) => Math.hypot(x - ax, y - ay) <= L + 0.5, bbox: [ax - L, ay - L, ax + L, ay + L], L };
  }
  let poly;
  if (t.k === 'square') poly = [[ax, ay], [bx, ay], [bx, by], [ax, by]];
  else if (t.k === 'cone') poly = [[ax, ay], [bx + px * L / 2, by + py * L / 2], [bx - px * L / 2, by - py * L / 2]]; // largura = comprimento (D&D 5e)
  else { const hw = (Number(t.w) || 1) * cell() / 2; poly = [[ax + px * hw, ay + py * hw], [bx + px * hw, by + py * hw], [bx - px * hw, by - py * hw], [ax - px * hw, ay - py * hw]]; }
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const contains = (x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  return { poly, contains, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], L: t.k === 'square' ? Math.abs(bx - ax) : L };
}

function tplLabel(t, g) {
  const geo = tplGeom(t);
  const per = Number(g?.per) || 1;
  const v = Math.round((geo.L / G.cellSize(g)) * per * 10) / 10;
  const u = g?.unit || '';
  const n = String(v).replace('.', ',') + (u ? ' ' + u : '');
  return { circle: `raio ${n}`, cone: `cone ${n}`, square: `${n} × ${n}`, line: `linha ${n}` }[t.k] || n;
}

function drawTemplate(t, color, z, sc, name, pinned) {
  if (!t?.a || !t?.b || !sc) return;
  const geo = tplGeom(t);
  const g = sc.grid || {};
  const col = color || '#e8a33d';
  ctx.save();
  // casas atingidas (centro da casa dentro da área)
  if (g.type === 'square' || g.type === 'hexH' || g.type === 'hexV') {
    const s = G.cellSize(g);
    const [x0, y0, x1, y1] = geo.bbox;
    if (((x1 - x0) / s) * ((y1 - y0) / s) < 6000) {
      ctx.fillStyle = col; ctx.globalAlpha = 0.28;
      ctx.beginPath();
      if (g.type === 'square') {
        const ox = g.ox || 0, oy = g.oy || 0;
        for (let cx = ox + (Math.floor((x0 - ox) / s) + 0.5) * s; cx <= x1 + s; cx += s) {
          for (let cy = oy + (Math.floor((y0 - oy) / s) + 0.5) * s; cy <= y1 + s; cy += s) {
            if (geo.contains(cx, cy)) ctx.rect(cx - s / 2, cy - s / 2, s, s);
          }
        }
      } else {
        const r = s / Math.sqrt(3);
        const corners = [];
        for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i + (g.type === 'hexV' ? 0 : 30)); corners.push([r * Math.cos(a), r * Math.sin(a)]); }
        const qs = [G.pixelToHex(g, x0 - s, y0 - s), G.pixelToHex(g, x1 + s, y1 + s), G.pixelToHex(g, x1 + s, y0 - s), G.pixelToHex(g, x0 - s, y1 + s)];
        const qmin = Math.min(...qs.map((q) => q[0])), qmax = Math.max(...qs.map((q) => q[0]));
        const rmin = Math.min(...qs.map((q) => q[1])), rmax = Math.max(...qs.map((q) => q[1]));
        for (let q = qmin; q <= qmax; q++) for (let rr = rmin; rr <= rmax; rr++) {
          const [cx, cy] = G.hexToPixel(g, q, rr);
          if (!geo.contains(cx, cy)) continue;
          ctx.moveTo(cx + corners[0][0], cy + corners[0][1]);
          for (let i = 1; i < 6; i++) ctx.lineTo(cx + corners[i][0], cy + corners[i][1]);
          ctx.closePath();
        }
      }
      ctx.fill();
    }
  }
  // contorno da área
  ctx.globalAlpha = 1;
  ctx.beginPath();
  if (geo.circle) ctx.arc(geo.circle[0], geo.circle[1], geo.circle[2], 0, Math.PI * 2);
  else { ctx.moveTo(...geo.poly[0]); for (const p of geo.poly.slice(1)) ctx.lineTo(...p); ctx.closePath(); }
  ctx.fillStyle = col; ctx.globalAlpha = 0.12; ctx.fill();
  ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 2.5 / z;
  if (!pinned) ctx.setLineDash([8 / z, 5 / z]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(t.a[0], t.a[1], 4 / z, 0, Math.PI * 2); ctx.fill();
  // rótulo
  const label = tplLabel(t, g) + (name ? ` · ${name}` : '');
  const fs = 13 / z;
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  const tw = ctx.measureText(label).width;
  const lx = t.b[0] + 12 / z, ly = t.b[1] - 24 / z;
  ctx.fillStyle = 'rgba(15,17,21,.9)';
  roundRect(lx - 6 / z, ly - 4 / z, tw + 12 / z, fs + 9 / z, 6 / z); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillText(label, lx, ly + 1 / z);
  ctx.restore();
}

// ---------------- Calibração do grid ----------------
// Opções valem para a próxima seleção também (tipo de grid e quantas casas a seleção cobre)
export const calibOpts = { n: 1, type: null };
export function startCalib() {
  const t = scene()?.grid?.type;
  calibOpts.type = t && t !== 'none' ? t : 'square';
  calibOpts.n = 1;
  calib = null;
}
export function getCalib() { return calib; }
export function setCalibOpt(k, v) { calibOpts[k] = v; emit('calib'); requestDraw(); }
export function nudgeCalib(ds, dx, dy) {
  if (!calib) return;
  calib.fine.s += ds; calib.fine.x += dx; calib.fine.y += dy;
  emit('calib'); requestDraw();
}
export function clearCalib() { calib = null; emit('calib'); requestDraw(); }

// Grid resultante da seleção. preview=true usa cor de destaque.
export function calibGrid(preview = false) {
  const sc = scene();
  if (!sc || !calib) return null;
  const g = { ...sc.grid, type: calibOpts.type || 'square' };
  const [x1, y1] = calib.a, [x2, y2] = calib.b;
  const n = Math.max(1, Number(calibOpts.n) || 1);
  let size, ox, oy;
  if (g.type === 'square') {
    const w = Math.abs(x2 - x1), hh = Math.abs(y2 - y1);
    if (w < 2 && hh < 2) return null;
    let s = Math.max(w, 1) / n;
    if (hh > s * 0.5) {
      const rows = Math.max(1, Math.round(hh / s));
      s = w > 2 ? (w / n + hh / rows) / 2 : hh / rows;
    }
    size = s + calib.fine.s;
    const mod = (v) => ((v % size) + size) % size;
    ox = mod(Math.min(x1, x2) + calib.fine.x);
    oy = mod(Math.min(y1, y2) + calib.fine.y);
  } else {
    // hexágonos: do centro de um até o centro de outro, em linha reta (n casas)
    const d = Math.hypot(x2 - x1, y2 - y1);
    if (d < 2) return null;
    size = d / n + calib.fine.s;
    ox = x1 + calib.fine.x; oy = y1 + calib.fine.y;
  }
  if (!(size >= 4)) return null;
  g.size = Math.round(size * 100) / 100;
  g.ox = Math.round(ox * 100) / 100;
  g.oy = Math.round(oy * 100) / 100;
  if (preview) { g.color = '#e8a33d'; g.opacity = 0.95; }
  return g;
}

function drawCalib(z) {
  const [x1, y1] = calib.a, [x2, y2] = calib.b;
  ctx.save();
  ctx.lineWidth = 2.5 / z;
  ctx.strokeStyle = '#4fb3d9';
  ctx.fillStyle = 'rgba(79,179,217,.15)';
  if (calibOpts.type === 'square') {
    ctx.beginPath(); ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.fillStyle = '#4fb3d9';
  for (const [x, y] of [[x1, y1], [x2, y2]]) { ctx.beginPath(); ctx.arc(x, y, 5 / z, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function startEditGesture(coll, down, wx, wy, sx, sy, e) {
  const near = e.pointerType === 'mouse' ? 12 : 22;
  const hd = editHandle();
  if (hd && Math.hypot(sx - hd.sx, sy - hd.sy) <= near) {
    gesture = { type: 'escale', ...down, coll, key: editSel.key, orig: structuredClone(S[coll][editSel.key]), box: hd.b };
    return;
  }
  const k = coll === 'fog' ? hitFog(wx, wy) : hitDrawing(wx, wy);
  const item = k && S[coll][k];
  if (item && (coll === 'fog' ? isGM() : canEditDrawing(item))) {
    editSel = { coll, key: k }; emit('editsel');
    gesture = { type: 'emove', ...down, coll, key: k, orig: structuredClone(item) };
  } else {
    if (editSel) { editSel = null; emit('editsel'); }
    gesture = { type: 'pan', ...down, cx: cam.x, cy: cam.y };
  }
  requestDraw();
}

function onWallTap(wx, wy, sx, sy, alt) {
  const sc = scene(); if (!sc) return;
  const mode = S.sub.walls?.mode || 'wall';
  const pt = alt ? [Math.round(wx), Math.round(wy)] : G.snapCorner(sc.grid, wx, wy).map(Math.round);
  if (mode === 'erase') { const k = hitWall(wx, wy); if (k) removeWall(k); return; }
  if (mode === 'toggle') { const k = hitWall(wx, wy, true); if (k) updateWall(k, { open: S.walls[k].open ? null : true }); else toast('Toque em cima de uma porta (laranja)'); return; }
  if (!wallPts) { wallPts = pt; hoverW = pt; emit('wallpts'); requestDraw(); return; }
  const L = wallPts.length;
  // tocar no último ponto (ou o 2º ponto de uma porta) encerra
  const [lx, ly] = toScreen(wallPts[L - 2], wallPts[L - 1]);
  if (Math.hypot(lx - sx, ly - sy) < 16) { finishWall(); return; }
  wallPts.push(...pt);
  if (mode === 'door') { finishWall(); return; }
  emit('wallpts');
  requestDraw();
}
export function finishWall() {
  if (wallPts && wallPts.length >= 4) addWall({ pts: wallPts, door: S.sub.walls?.mode === 'door' || null });
  wallPts = null; hoverW = null; emit('wallpts'); requestDraw();
}
export function cancelWall() { wallPts = null; hoverW = null; emit('wallpts'); requestDraw(); }
export const wallInProgress = () => (wallPts ? wallPts.length / 2 : 0);
export function resetExplored() { exploredC = null; visDirty = true; requestDraw(); }

export function finishPoly() {
  if (polyPts && polyPts.length >= 6) addFog({ mode: S.sub.fog?.mode || 'reveal', shape: 'poly', pts: polyPts });
  polyPts = null; hoverW = null; emit('poly', 0); requestDraw();
}
export function cancelPoly() { polyPts = null; hoverW = null; emit('poly', 0); requestDraw(); }

function eraseAt(wx, wy) {
  const k = hitDrawing(wx, wy);
  if (k && (isGM() || S.drawings[k].owner === S.uid)) removeDrawing(k);
}

function startPinch() {
  const [a, b] = [...pointers.values()];
  const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
  gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: cam.z, m0: toWorld(...mid) };
}
function movePinch() {
  if (pointers.size < 2) return;
  const [a, b] = [...pointers.values()];
  const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
  cam.z = Math.max(0.03, Math.min(8, gesture.z0 * d / gesture.d0));
  cam.x = gesture.m0[0] - mid[0] / cam.z;
  cam.y = gesture.m0[1] - mid[1] / cam.z;
  requestDraw();
}
function cancelGesture() {
  cancelTrail();
  resizeLive = null; rotLive = null; marquee = null; editLive = null;
  if (gesture?.type === 'laser') { myLaser = null; setCursor(null); }
  if (gesture?.type === 'token' && dragPos) {
    for (const k in gesture.start) updateToken(k, { x: gesture.start[k][0], y: gesture.start[k][1] }, { undo: false });
  }
  if (gesture?.type === 'measure') setCursor(null);
  dragPos = null; dragInfo = null; live = null;
  if (!rulerSticky) myRuler = null;
  gesture = null;
  requestDraw();
}

function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
  if (document.querySelector('dialog[open]')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (e.code === 'Space' && gesture?.type === 'measure') { e.preventDefault(); clearTimeout(dwellT); addWaypoint(); return; }
  if (e.code === 'Space') { spaceDown = true; return; }
  if (ctrl && key === 'z' && !e.shiftKey) { e.preventDefault(); if (!undo()) toast('Nada para desfazer'); return; }
  if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); if (!redo()) toast('Nada para refazer'); return; }
  if (ctrl && key === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if (ctrl && key === 'a' && S.tool === 'select') { e.preventDefault(); selectAll(); return; }
  if (e.key === 'Escape') {
    if (polyPts) cancelPoly(); else if (wallPts) cancelWall(); else if (myTpl) clearTemplate(); else if (myRuler) clearRuler();
    else if (editSel) clearEditSel(); else { cancelGesture(); select([]); }
    return;
  }
  if (e.key === 'Enter' && polyPts) { finishPoly(); return; }
  if (e.key === 'Enter' && wallPts) { finishWall(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (editSel) { editSelDelete(); return; }
    if (S.selected.size) { deleteSelection(); return; }
  }
  if (S.selected.size && !ctrl && !e.altKey) {
    if (key === 'r') { rotateSelection(e.shiftKey ? -45 : 45); return; }
    if (e.key === ']') { bringTo(true); return; }
    if (e.key === '[') { bringTo(false); return; }
    if (key === 'l') { toast(toggleLockSelection() ? 'Travado' : 'Destravado'); return; }
    if (key === 'h' && isGM()) { toast(toggleHideSelection() ? 'Escondido dos jogadores' : 'Visível para os jogadores'); return; }
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key] && S.selected.size) {
    e.preventDefault();
    const sc = scene(); const s = cell();
    const [dx, dy] = arrows[e.key];
    undoGroup(() => {
      for (const id of S.selected) {
        const t = S.tokens[id]; if (!canDrag(t)) continue;
        let x = t.x + dx * s, y = t.y + dy * s;
        if (sc.grid.type !== 'square') [x, y] = G.snap(sc.grid, x, y, t.s || 1);
        updateToken(id, { x, y });
      }
    });
    return;
  }
  const keys = { v: 'select', m: 'measure', d: 'draw', f: 'fog', p: 'ping', w: 'walls' };
  if (!ctrl && !e.altKey && keys[key]) emit('tool:key', keys[key]);
}
