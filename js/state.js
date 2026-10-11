// Estado da sala + ações. Tudo que vem da rede passa por aqui e é emitido como evento.
import { firebaseConfig } from './config.js';

const listeners = {};
export function on(evt, fn) { (listeners[evt] ||= new Set()).add(fn); return () => listeners[evt].delete(fn); }
export function emit(evt, data) { listeners[evt]?.forEach((fn) => { try { fn(data); } catch (e) { console.error(evt, e); } }); }

const COLORS = ['#e8a33d', '#4fb3d9', '#e05d6f', '#6cc56b', '#a77de8', '#e6d24a', '#e07b39', '#4ad1b5', '#d16bc0', '#8fa1b3'];

export const S = {
  be: null,
  uid: null,
  roomId: null,
  meta: null,
  members: {},
  scenes: {},
  sceneId: null,      // cena exibida neste cliente
  tokens: {},
  drawings: {},
  fog: {},
  walls: {},          // paredes da cena (visão dinâmica)
  library: {},        // biblioteca da conta (imagens reaproveitáveis)
  chat: [],
  sheets: {},
  initiative: null,
  assets: {},
  cursors: {},
  pings: {},
  selected: new Set(),
  tool: 'select',
  sub: {},            // sub-ferramenta por ferramenta
  me: loadMe(),
  user: null,         // conta logada { uid, name, email, guest, provider }
};

function loadMe() {
  let me = null;
  try { me = JSON.parse(localStorage.getItem('vtt-me') || 'null'); } catch { /* */ }
  return me || { name: '', color: COLORS[Math.floor(Math.random() * COLORS.length)] };
}
export function saveMe() { try { localStorage.setItem('vtt-me', JSON.stringify(S.me)); } catch { /* */ } }
export { COLORS };

export const R = (p = '') => `rooms/${S.roomId}${p ? '/' + p : ''}`;
export const isGM = (uid = S.uid) => !!S.meta?.gms?.[uid];
export const scene = () => (S.sceneId && S.scenes[S.sceneId]) || null;

export async function connect() {
  if (firebaseConfig) {
    const { createFirebaseBackend } = await import('./net/firebase.js');
    S.be = await createFirebaseBackend(firebaseConfig);
  } else {
    const { createLocalBackend } = await import('./net/local.js');
    S.be = createLocalBackend();
  }
  setUser(await S.be.init());
  return S.be.mode;
}

// ---------- Conta ----------
let libUnsub = null;
function setUser(u) {
  S.user = u || null;
  S.uid = u?.uid || null;
  // biblioteca da conta (imagens que servem em todas as mesas)
  libUnsub?.(); libUnsub = null; S.library = {};
  if (u && !u.guest) libUnsub = S.be.onValue(`users/${u.uid}/library`, (v) => { S.library = v || {}; emit('library', S.library); });
  if (u?.name && !u.guest) { S.me.name = u.name; saveMe(); }
  emit('user', S.user);
}
// kind: 'google' | 'emailIn' | 'emailUp' | 'guest' | 'local'
export async function login(kind, ...args) {
  const u = await S.be.auth[kind](...args);
  setUser(u);
  if (u && !u.guest) {
    // perfil (cor) salvo na conta, para valer em qualquer aparelho
    const prof = await S.be.get(`users/${u.uid}/profile`).catch(() => null);
    // cada conta tem a sua cor; conta nova ganha uma cor aleatória
    S.me.color = prof?.color || COLORS[Math.floor(Math.random() * COLORS.length)];
    if (prof?.name && u.provider !== 'local') S.me.name = prof.name;
    saveMe();
    S.be.update(`users/${u.uid}/profile`, { name: S.me.name, color: S.me.color }).catch(() => {});
  }
  return u;
}
export async function logout() { await S.be.auth.out(); setUser(null); }
export function resetPassword(email) { return S.be.auth.reset(email); }
export async function myRooms() {
  if (!S.uid || S.user?.guest) return [];
  const v = await S.be.get(`users/${S.uid}/rooms`).catch(() => null);
  return Object.entries(v || {}).map(([id, r]) => ({ id, ...r })).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
export function forgetRoom(id) { return S.be.remove(`users/${S.uid}/rooms/${id}`); }
async function rememberRoom(id, name, gm) {
  if (!S.uid || S.user?.guest) return;
  const cur = await S.be.get(`users/${S.uid}/rooms/${id}`).catch(() => null);
  await S.be.set(`users/${S.uid}/rooms/${id}`, { name: name || cur?.name || 'Mesa', gm: !!(gm || cur?.gm) || null, ts: Date.now() }).catch(() => {});
}

// ---------- Sala ----------
const ALPH = 'abcdefghjkmnpqrstuvwxyz23456789';
function code(n = 7) {
  const a = new Uint32Array(n); crypto.getRandomValues(a);
  return Array.from(a, (x) => ALPH[x % ALPH.length]).join('');
}

export async function createRoom(name) {
  if (!S.uid || S.user?.guest) throw new Error('Entre com uma conta para criar uma mesa');
  const id = code();
  await S.be.set(`rooms/${id}/meta`, { name: name || 'Mesa', gms: { [S.uid]: true }, owner: S.uid, created: Date.now() });
  await joinRoom(id);
  const sid = await createScene('Cena 1');
  await S.be.update(R('meta'), { playerScene: sid });
  rememberRoom(id, name || 'Mesa', true);
  return id;
}

export async function roomExists(id) {
  try { return !!(await S.be.get(`rooms/${id}/meta/name`)); } catch { return false; }
}

const unsubs = [];
let sceneUnsubs = [];

export async function joinRoom(id) {
  if (!S.uid) throw new Error('Entre com sua conta primeiro');
  S.roomId = id;
  const memberPath = R(`members/${S.uid}`);
  await S.be.update(memberPath, { name: S.me.name, color: S.me.color, online: true, seen: Date.now() });
  S.be.onDisconnect(memberPath + '/online', false);
  S.be.onDisconnect(R(`cursors/${S.uid}`), null);

  const be = S.be;
  let remembered = false;
  unsubs.push(be.onValue(R('meta'), (m) => {
    const prevPlayerScene = S.meta?.playerScene;
    S.meta = m || {};
    // quem criou a mesa é sempre mestre (conserta se alguém tirou)
    if (S.meta.owner === S.uid && !S.meta.gms?.[S.uid]) S.be.set(R(`meta/gms/${S.uid}`), true);
    if (!remembered && S.meta.name) { remembered = true; rememberRoom(id, S.meta.name, S.meta.owner === S.uid || !!S.meta.gms?.[S.uid]); }
    emit('meta', S.meta);
    if (!isGM()) {
      if (S.meta.playerScene && S.meta.playerScene !== S.sceneId) viewScene(S.meta.playerScene);
    } else if (!S.sceneId) {
      let saved = null;
      try { saved = localStorage.getItem('vtt-gmscene-' + S.roomId); } catch { /* */ }
      viewScene(saved || S.meta.playerScene);
    }
    void prevPlayerScene;
  }));
  unsubs.push(be.onValue(R('members'), (m) => {
    S.members = m || {};
    // mesma conta aberta em outra aba/aparelho que fechou: continuo online aqui
    if (S.members[S.uid] && S.members[S.uid].online === false && !document.hidden) S.be.update(memberPath, { online: true, seen: Date.now() });
    emit('members', S.members);
  }));
  unsubs.push(be.onChildren(R('scenes'), {
    ...mapHandlers('scenes', 'scenes', (k) => { if (k === S.sceneId) emit('scene', scene()); }),
    ready: () => {
      if (S.sceneId && !S.scenes[S.sceneId]) { const first = S.meta?.playerScene || Object.keys(S.scenes)[0]; if (first) { S.sceneId = null; viewScene(first); } }
    },
  }));
  unsubs.push(be.onValue(R('sheets'), (v) => { S.sheets = v || {}; emit('sheets', S.sheets); }));
  unsubs.push(be.onValue(R('initiative'), (v) => { S.initiative = v; emit('initiative', v); }));
  unsubs.push(be.onChildren(R('assets'), mapHandlers('assets', 'assets')));
  unsubs.push(be.onChildren(R('cursors'), mapHandlers('cursors', 'cursors')));
  unsubs.push(be.onChildren(R('pings'), {
    added: (k, v) => { if (v && Date.now() - (v.ts || 0) < 5000) { S.pings[k] = { ...v, t0: performance.now() }; emit('pings'); } },
  }));
  unsubs.push(be.onChildren(R('chat'), {
    added: (k, v) => { const m = { id: k, ...v }; S.chat.push(m); emit('chat:add', m); },
    removed: (k) => { S.chat = S.chat.filter((m) => m.id !== k); emit('chat:reset'); },
  }, { limit: 150 }));
  // atualiza "visto por último" a cada minuto
  setInterval(() => S.be.update(memberPath, { seen: Date.now(), online: true }), 60000);
  addEventListener('beforeunload', () => { S.be.set(memberPath + '/online', false); });
}

function mapHandlers(field, evt, extra) {
  return {
    added: (k, v) => { S[field][k] = v; emit(evt, { k, v, op: 'add' }); extra?.(k); },
    changed: (k, v) => { S[field][k] = v; emit(evt, { k, v, op: 'change' }); extra?.(k); },
    removed: (k) => { const old = S[field][k]; delete S[field][k]; emit(evt, { k, old, op: 'remove' }); extra?.(k); },
  };
}

export function viewScene(sid) {
  if (!sid || sid === S.sceneId) { if (sid) emit('scene', scene()); return; }
  sceneUnsubs.forEach((f) => f());
  sceneUnsubs = [];
  S.sceneId = sid;
  S.tokens = {}; S.drawings = {}; S.fog = {}; S.walls = {};
  S.selected.clear();
  if (isGM()) try { localStorage.setItem('vtt-gmscene-' + S.roomId, sid); } catch { /* */ }
  emit('scene', scene());
  emit('tokens'); emit('drawings'); emit('fog'); emit('walls'); emit('selection');
  sceneUnsubs.push(S.be.onChildren(R(`tokens/${sid}`), mapHandlers('tokens', 'tokens')));
  sceneUnsubs.push(S.be.onChildren(R(`drawings/${sid}`), mapHandlers('drawings', 'drawings')));
  sceneUnsubs.push(S.be.onChildren(R(`fog/${sid}`), mapHandlers('fog', 'fog')));
  sceneUnsubs.push(S.be.onChildren(R(`walls/${sid}`), mapHandlers('walls', 'walls')));
}

// ---------- Escrita com desfazer / refazer ----------
// Cada entrada: { items: [{ path, prev }] } — várias mudanças juntas (ex.: colar 5 tokens) desfazem de uma vez.
const undoStack = [];
const redoStack = [];
let group = null;
function getLocal(path) {
  // path relativo à sala, ex: tokens/<cena>/<id>
  const segs = path.split('/');
  const map = { tokens: S.tokens, drawings: S.drawings, fog: S.fog, walls: S.walls };
  if (map[segs[0]] && segs[1] === S.sceneId) {
    let v = map[segs[0]][segs[2]];
    for (let i = 3; i < segs.length && v != null; i++) v = v[segs[i]];
    return v === undefined ? null : structuredClone(v);
  }
  return null;
}
function record(path, prev) {
  redoStack.length = 0;
  if (group) { group.items.push({ path, prev }); return; }
  undoStack.push({ items: [{ path, prev }] });
  if (undoStack.length > 150) undoStack.shift();
}
// Agrupa várias escritas num único passo de desfazer
export function undoGroup(fn) {
  const outer = !group;
  if (outer) group = { items: [] };
  try { return fn(); } finally {
    if (outer) { if (group.items.length) { undoStack.push(group); if (undoStack.length > 150) undoStack.shift(); } group = null; }
  }
}
export function write(path, value, { undo = true } = {}) {
  if (undo) record(path, getLocal(path));
  return S.be.set(R(path), value);
}
export function patch(path, obj, { undo = true } = {}) {
  if (undo) record(path, getLocal(path));
  return S.be.update(R(path), obj);
}
export function pushUndo(path, prev) { record(path, prev); }
function applyStep(step, toStack) {
  const back = { items: [] };
  for (const it of [...step.items].reverse()) {
    back.items.push({ path: it.path, prev: getLocal(it.path) });
    S.be.set(R(it.path), it.prev);
  }
  toStack.push(back);
}
export function undo() {
  const u = undoStack.pop();
  if (!u) return false;
  applyStep(u, redoStack);
  return true;
}
export function redo() {
  const u = redoStack.pop();
  if (!u) return false;
  applyStep(u, undoStack);
  return true;
}

// ---------- Cenas ----------
export const DEFAULT_GRID = { type: 'square', size: 70, ox: 0, oy: 0, color: '#000000', opacity: 0.35, per: 1.5, unit: 'm', diag: '5e', snap: true };
export async function createScene(name, extra = {}) {
  const sid = S.be.key();
  await S.be.set(R(`scenes/${sid}`), {
    name, map: '', w: 70 * 24, h: 70 * 16, bg: '#2a2d33',
    grid: { ...DEFAULT_GRID }, fog: { on: false }, created: Date.now(), ...extra,
  });
  return sid;
}
export function updateScene(sid, obj) { return S.be.update(R(`scenes/${sid}`), obj); }
export async function deleteScene(sid) {
  await Promise.all(['scenes', 'tokens', 'drawings', 'fog', 'walls'].map((p) => S.be.remove(R(`${p}/${sid}`))));
}
export function showToPlayers(sid) { return S.be.update(R('meta'), { playerScene: sid }); }

// ---------- Tokens ----------
export function addToken(t) {
  const id = S.be.key();
  const tok = { s: 1, layer: 'token', shape: 'circle', color: S.me.color, owner: isGM() ? '' : S.uid, showName: true, ...t };
  write(`tokens/${S.sceneId}/${id}`, tok);
  return id;
}
export function updateToken(id, obj, opts) { return patch(`tokens/${S.sceneId}/${id}`, obj, opts); }
export function removeToken(id) { S.selected.delete(id); return write(`tokens/${S.sceneId}/${id}`, null); }
export function canMove(tok) {
  if (!tok) return false;
  if (isGM()) return true;
  if (tok.layer !== 'token' || tok.locked) return false;
  return tok.owner === S.uid || tok.owner === '*';
}
// Pode arrastar: pode editar e não está travado (travado vale até para o mestre — evita mover sem querer)
export function canDrag(tok) { return canMove(tok) && !tok.locked; }

// ---------- Desenho / névoa ----------
export function addDrawing(d) { const id = S.be.key(); write(`drawings/${S.sceneId}/${id}`, { ...d, owner: S.uid }); return id; }
export function removeDrawing(id) { return write(`drawings/${S.sceneId}/${id}`, null); }
export function clearDrawings(mineOnly) {
  const upd = {};
  for (const k in S.drawings) if (!mineOnly || S.drawings[k].owner === S.uid) upd[k] = null;
  return S.be.update(R(`drawings/${S.sceneId}`), upd);
}
// ---------- Paredes (visão dinâmica) ----------
export function addWall(w) { const id = S.be.key(); write(`walls/${S.sceneId}/${id}`, w); return id; }
export function updateWall(id, obj) { return patch(`walls/${S.sceneId}/${id}`, obj); }
export function removeWall(id) { return write(`walls/${S.sceneId}/${id}`, null); }
export function clearWalls() { return S.be.remove(R(`walls/${S.sceneId}`)); }

export function addFog(op) { const id = S.be.key(); write(`fog/${S.sceneId}/${id}`, op); return id; }
export function resetFog(mode) { // mode: 'cover' | 'reveal'
  S.be.remove(R(`fog/${S.sceneId}`)).then(() => { if (mode === 'reveal') addFog({ mode: 'reveal', shape: 'all' }); });
}

// ---------- Chat ----------
export function sendChat(msg) {
  const id = S.be.key();
  return S.be.set(R(`chat/${id}`), { uid: S.uid, name: S.me.name, color: S.me.color, ts: Date.now(), ...msg });
}
export function canSeeMsg(m) {
  if (m.to) return m.uid === S.uid || m.to === S.uid;
  if (m.gm) return m.uid === S.uid || isGM();
  return true;
}

// ---------- Cursores (régua) e pings ----------
export function setCursor(obj) { return S.be.set(R(`cursors/${S.uid}`), obj ? { ...obj, color: S.me.color, name: S.me.name } : null); }
export function ping(x, y, focus = false) {
  const id = S.be.key();
  S.be.set(R(`pings/${id}`), { x, y, color: S.me.color, ts: Date.now(), uid: S.uid, focus: focus || null });
  setTimeout(() => S.be.remove(R(`pings/${id}`)), 4000);
}

// ---------- Fichas ----------
export function saveSheet(id, sheet) { return S.be.set(R(`sheets/${id}`), sheet); }
export function patchSheet(id, obj) { return S.be.update(R(`sheets/${id}`), obj); }

// ---------- Iniciativa ----------
export function setInitiative(v) { return S.be.set(R('initiative'), v); }
export function patchInitiative(obj) { return S.be.update(R('initiative'), obj); }

// ---------- Membros ----------
export function setGM(uid, on) {
  if (!on && uid === S.meta?.owner) return Promise.resolve(); // o criador não perde o papel de mestre
  return S.be.set(R(`meta/gms/${uid}`), on ? true : null);
}
export function updateMe(obj) {
  Object.assign(S.me, obj); saveMe();
  if (S.roomId) S.be.update(R(`members/${S.uid}`), obj);
  if (S.uid && !S.user?.guest) {
    S.be.update(`users/${S.uid}/profile`, obj).catch(() => {});
    if (obj.name) S.be.auth.rename?.(obj.name).catch?.(() => {});
  }
}

export function setTool(tool, sub) {
  S.tool = tool;
  if (sub !== undefined) S.sub[tool] = sub;
  emit('tool', tool);
}
export function select(ids, add = false) {
  if (!add) S.selected.clear();
  for (const id of ids) S.selected.add(id);
  emit('selection');
}
