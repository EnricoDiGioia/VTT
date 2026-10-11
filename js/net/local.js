// Backend "modo local": imita o Firebase Realtime Database dentro do navegador.
// Abas do mesmo navegador se sincronizam por BroadcastChannel e o estado fica no IndexedDB.
// Serve para testar o VTT sem configurar nada.
import { idbGet, idbSet } from './idb.js';

const split = (p) => p.split('/').filter(Boolean);
const clone = (v) => (v === undefined || v === null ? null : (typeof v === 'object' ? structuredClone(v) : v));

function norm(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === 'object') {
    const o = {}; let n = 0;
    for (const k in v) { const x = norm(v[k]); if (x !== null) { o[k] = x; n++; } }
    return n ? o : null;
  }
  return v;
}

let keyLast = 0, keyCounter = 0;
export function makeKey() {
  const now = Date.now();
  if (now === keyLast) keyCounter++; else { keyLast = now; keyCounter = 0; }
  const rand = Math.random().toString(36).slice(2, 8);
  return now.toString(36).padStart(9, '0') + keyCounter.toString(36).padStart(2, '0') + rand;
}

export function createLocalBackend() {
  let root = {};
  const listeners = new Set();
  const disconnectOps = new Map();
  const channel = 'BroadcastChannel' in self ? new BroadcastChannel('vtt-local') : null;
  let persistTimer = null;

  // Conta no modo local (teste): a conta é só um nome. Mesmo nome = mesma pessoa,
  // então quem criou a mesa continua mestre ao fechar e abrir o navegador.
  // Cada aba pode usar uma conta diferente para simular jogadores.
  const slug = (n) => String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'conta';
  let user = null;
  const readAcc = (store) => { try { return JSON.parse(store.getItem('vtt-local-acc') || 'null'); } catch { return null; } };
  const saveAcc = (u) => { for (const st of [sessionStorage, localStorage]) { try { u ? st.setItem('vtt-local-acc', JSON.stringify(u)) : st.removeItem('vtt-local-acc'); } catch { /* */ } } };

  function getAt(segs) {
    let n = root;
    for (const s of segs) { if (n === null || typeof n !== 'object' || !(s in n)) return undefined; n = n[s]; }
    return n;
  }

  function setAt(segs, value) {
    if (!segs.length) { root = value && typeof value === 'object' ? value : {}; return; }
    if (value === null) {
      const stack = [];
      let n = root;
      for (let i = 0; i < segs.length - 1; i++) {
        if (!n || typeof n !== 'object' || !(segs[i] in n)) return;
        stack.push([n, segs[i]]); n = n[segs[i]];
      }
      if (n && typeof n === 'object') delete n[segs[segs.length - 1]];
      // remove pais vazios (como o RTDB)
      for (let i = stack.length - 1; i >= 0; i--) {
        const [parent, k] = stack[i];
        const child = parent[k];
        if (child && typeof child === 'object' && Object.keys(child).length === 0) delete parent[k]; else break;
      }
      return;
    }
    let n = root;
    for (let i = 0; i < segs.length - 1; i++) {
      if (!n[segs[i]] || typeof n[segs[i]] !== 'object') n[segs[i]] = {};
      n = n[segs[i]];
    }
    n[segs[segs.length - 1]] = value;
  }

  function isPrefix(a, b) { // a é prefixo de b
    if (a.length > b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function mutate(path, value, remote = false) {
    const P = split(path);
    const v = norm(value);
    const pending = [];
    for (const L of listeners) {
      const below = isPrefix(L.segs, P) && P.length > L.segs.length;
      const above = isPrefix(P, L.segs);
      if (!below && !above) continue;
      if (L.type === 'value') { pending.push({ L }); continue; }
      if (below) {
        const k = P[L.segs.length];
        pending.push({ L, k, had: getAt([...L.segs, k]) !== undefined });
      } else {
        const old = getAt(L.segs);
        const snap = {};
        if (old && typeof old === 'object') for (const k in old) snap[k] = JSON.stringify(old[k]);
        pending.push({ L, snap });
      }
    }
    setAt(P, v);
    for (const p of pending) {
      const L = p.L;
      if (!listeners.has(L)) continue;
      if (L.type === 'value') { L.cb(clone(getAt(L.segs))); continue; }
      if (p.k !== undefined) {
        const now = getAt([...L.segs, p.k]);
        if (now === undefined) { if (p.had) L.cbs.removed?.(p.k); }
        else if (p.had) L.cbs.changed?.(p.k, clone(now));
        else L.cbs.added?.(p.k, clone(now));
      } else {
        const cur = getAt(L.segs) || {};
        for (const k in p.snap) if (!(k in cur)) L.cbs.removed?.(k);
        for (const k of Object.keys(cur).sort()) {
          if (!(k in p.snap)) L.cbs.added?.(k, clone(cur[k]));
          else if (p.snap[k] !== JSON.stringify(cur[k])) L.cbs.changed?.(k, clone(cur[k]));
        }
      }
    }
    if (!remote && channel) channel.postMessage({ path, value: v });
    schedulePersist();
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => idbSet('kv', 'localdb', root), 400);
  }

  let ready = false;
  let gotState = null;
  if (channel) channel.onmessage = (e) => {
    const d = e.data || {};
    if (d.hello) { if (ready) channel.postMessage({ state: root }); return; }
    if (d.state) { if (!ready && !gotState) gotState = d.state; return; }
    if (typeof d.path === 'string' && ready) mutate(d.path, d.value, true);
  };

  addEventListener('pagehide', () => {
    for (const [path, value] of disconnectOps) mutate(path, value);
    clearTimeout(persistTimer);
    idbSet('kv', 'localdb', root);
  });

  return {
    mode: 'local',
    get uid() { return user?.uid || null; },
    get user() { return user; },
    async init() {
      // pede o estado mais recente para outras abas abertas; senão usa o IndexedDB
      if (channel) { channel.postMessage({ hello: 1 }); await new Promise((r) => setTimeout(r, 200)); }
      const saved = gotState || await idbGet('kv', 'localdb');
      if (saved && typeof saved === 'object') root = saved;
      ready = true;
      user = readAcc(sessionStorage) || readAcc(localStorage);
      return user;
    },
    auth: {
      async local(name) {
        name = String(name || '').trim();
        if (!name) throw new Error('Digite um nome de conta');
        user = { uid: 'acc-' + slug(name), name, email: null, guest: false, provider: 'local' };
        saveAcc(user);
        return user;
      },
      async out() { user = null; saveAcc(null); },
      async rename(name) { if (user) { user.name = name; saveAcc(user); } },
    },
    key: makeKey,
    onValue(path, cb) {
      const L = { type: 'value', segs: split(path), cb };
      listeners.add(L);
      queueMicrotask(() => { if (listeners.has(L)) cb(clone(getAt(L.segs))); });
      return () => listeners.delete(L);
    },
    onChildren(path, cbs, opts = {}) {
      const L = { type: 'child', segs: split(path), cbs };
      listeners.add(L);
      queueMicrotask(() => {
        if (!listeners.has(L)) return;
        const cur = getAt(L.segs) || {};
        let keys = Object.keys(cur).sort();
        if (opts.limit) keys = keys.slice(-opts.limit);
        for (const k of keys) cbs.added?.(k, clone(cur[k]));
        cbs.ready?.();
      });
      return () => listeners.delete(L);
    },
    async get(path) { return clone(getAt(split(path))); },
    async set(path, value) { mutate(path, value); },
    async update(path, obj) {
      for (const k in obj) mutate(path + '/' + k, obj[k]);
    },
    async remove(path) { mutate(path, null); },
    onDisconnect(path, value = null) { disconnectOps.set(path, value); },
    cancelDisconnect(path) { disconnectOps.delete(path); },
  };
}
