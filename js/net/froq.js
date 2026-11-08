// Backend "Froq": a Mesa aberta dentro do Froq, na aba Atividades.
// Os dados ficam no servidor do Froq. A Mesa não fala com o servidor direto: conversa só com a página
// do Froq que a abriu (postMessage), e a página repassa as operações pelo WebSocket da atividade.
// Quem confere as permissões é o servidor, com as mesmas regras do database.rules.json.
// Aqui fica um espelho do que está assinado, com os mesmos eventos do Firebase (value e child
// added/changed/removed), então o resto da Mesa não sabe qual backend está usando.
import { makeKey } from './local.js';

const split = (p) => p.split('/').filter(Boolean);
const join = (segs) => segs.join('/');
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

function isPrefix(a, b) { // a é prefixo de b
  if (a.length > b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Endereço do Froq que abriu a Mesa (?froq=<origem>), se for um dos permitidos. */
export function froqParentOrigin(allowed) {
  if (window.parent === window) return null;
  const origin = new URLSearchParams(location.search).get('froq');
  return origin && allowed.includes(origin) ? origin : null;
}

export function createFroqBackend(parentOrigin) {
  let root = {};
  let user = null;
  let session = null;
  const sessionListeners = new Set();
  const listeners = new Set();          // { type, segs, path, cb|cbs, limit, ready, sid }
  const subs = new Map();               // id da assinatura no servidor -> listener
  const requests = new Map();           // rid -> { resolve, reject }
  const pending = new Map();            // caminho -> escritas minhas ainda sem resposta
  const disconnectOps = new Map();      // caminho -> valor
  let seq = 0;
  let initResolve = null;

  const post = (msg) => window.parent.postMessage({ froq: 1, ...msg }, parentOrigin);
  const send = (msg) => post({ type: 'db', msg });

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

  // Aplica uma mudança no espelho e avisa os ouvintes prontos (mesma lógica do backend local).
  function mutate(path, value, skip = null) {
    const P = split(path);
    const v = norm(value);
    const work = [];
    for (const L of listeners) {
      if (!L.ready || L === skip) continue;
      const below = isPrefix(L.segs, P) && P.length > L.segs.length;
      const above = isPrefix(P, L.segs);
      if (!below && !above) continue;
      if (L.type === 'value') { work.push({ L, before: JSON.stringify(getAt(L.segs) ?? null) }); continue; }
      if (below) {
        const k = P[L.segs.length];
        work.push({ L, k, had: getAt([...L.segs, k]) !== undefined });
      } else {
        const old = getAt(L.segs);
        const snap = {};
        if (old && typeof old === 'object') for (const k in old) snap[k] = JSON.stringify(old[k]);
        work.push({ L, snap });
      }
    }
    setAt(P, v);
    for (const w of work) {
      const L = w.L;
      if (!listeners.has(L)) continue;
      if (L.type === 'value') {
        const now = getAt(L.segs);
        if (JSON.stringify(now ?? null) !== w.before) L.cb(clone(now));
        continue;
      }
      if (w.k !== undefined) {
        const now = getAt([...L.segs, w.k]);
        if (now === undefined) { if (w.had) L.cbs.removed?.(w.k); }
        else if (w.had) L.cbs.changed?.(w.k, clone(now));
        else L.cbs.added?.(w.k, clone(now));
      } else {
        const cur = getAt(L.segs) || {};
        for (const k in w.snap) if (!(k in cur)) L.cbs.removed?.(k);
        for (const k of Object.keys(cur).sort()) {
          if (!(k in w.snap)) L.cbs.added?.(k, clone(cur[k]));
          else if (w.snap[k] !== JSON.stringify(cur[k])) L.cbs.changed?.(k, clone(cur[k]));
        }
      }
    }
  }

  // Primeira leitura de um ouvinte: o espelho recebe o valor do servidor e o ouvinte ganha tudo de uma vez.
  function firstValue(L, value) {
    // Assinatura refeita depois de uma queda: o ouvinte já existia e recebe só o que mudou.
    if (L.ready) { mutate(L.path, value); return; }
    mutate(L.path, value, L);
    if (!listeners.has(L)) return;
    L.ready = true;
    if (L.type === 'value') { L.cb(clone(getAt(L.segs))); return; }
    const cur = getAt(L.segs) || {};
    let keys = Object.keys(cur).sort();
    if (L.limit) keys = keys.slice(-L.limit);
    for (const k of keys) L.cbs.added?.(k, clone(cur[k]));
    L.cbs.ready?.();
  }

  function subscribe(L) {
    const id = 's' + (++seq);
    L.sid = id;
    subs.set(id, L);
    send({ op: 'sub', id, path: L.path, limit: L.limit || undefined });
  }

  function unsubscribe(L) {
    listeners.delete(L);
    if (L.sid) { subs.delete(L.sid); send({ op: 'unsub', id: L.sid }); }
  }

  function request(msg) {
    const rid = 'r' + (++seq);
    return new Promise((resolve, reject) => {
      requests.set(rid, { resolve, reject });
      send({ ...msg, rid });
    });
  }

  // Escrita: aparece aqui na hora e vai para o servidor. Cada caminho escrito volta do servidor uma vez,
  // com o meu rid; enquanto houver escrita minha mais nova no mesmo caminho, a volta da antiga é ignorada.
  function write(paths, msg) {
    const rid = 'r' + (++seq);
    for (const [p, v] of paths) { pending.set(p, (pending.get(p) || 0) + 1); mutate(p, v); }
    return new Promise((resolve, reject) => {
      requests.set(rid, { resolve, reject });
      send({ ...msg, rid });
    });
  }

  function onServer(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'val') { const L = subs.get(m.id); if (L) firstValue(L, m.value); return; }
    if (m.t === 'mut') {
      const path = join(split(m.path));
      const n = pending.get(path) || 0;
      if (m.mine) {
        if (n <= 1) { pending.delete(path); mutate(path, m.value); }
        else pending.set(path, n - 1);
      } else if (!n) mutate(path, m.value);
      return;
    }
    if (m.t === 'res') {
      const r = requests.get(m.rid);
      if (!r) return;
      requests.delete(m.rid);
      if (m.error) r.reject(new Error(m.error)); else r.resolve(m.value ?? null);
    }
  }

  // A conexão do Froq caiu e voltou: o servidor esqueceu as assinaturas. Assina tudo de novo.
  function reset() {
    pending.clear();
    for (const r of requests.values()) r.reject(new Error('Conexão perdida'));
    requests.clear();
    subs.clear();
    for (const L of listeners) subscribe(L);
    for (const [path, value] of disconnectOps) send({ op: 'ondc', path, value });
  }

  addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== parentOrigin) return;
    const d = e.data;
    if (!d || d.froq !== 1) return;
    if (d.type === 'init') {
      user = { uid: String(d.user.id), name: String(d.user.name || 'Jogador').slice(0, 24), email: null, guest: false, provider: 'froq' };
      session = d.session || null;
      initResolve?.(user);
      initResolve = null;
    } else if (d.type === 'session') {
      session = d.session || null;
      for (const fn of sessionListeners) { try { fn(session); } catch (err) { console.error(err); } }
    } else if (d.type === 'db') onServer(d.msg);
    else if (d.type === 'db-reset') reset();
  });

  return {
    mode: 'froq',
    get uid() { return user?.uid || null; },
    get user() { return user; },
    async init() {
      const got = new Promise((resolve, reject) => {
        initResolve = resolve;
        setTimeout(() => reject(new Error('o Froq não respondeu')), 15000);
      });
      post({ type: 'hello' });
      return got;
    },
    // Conta: quem entra é a pessoa logada no Froq. Não há sair nem trocar de conta por aqui.
    auth: {
      async out() { /* sai pelo Froq */ },
      async rename() { /* o nome na mesa fica em members/profile */ },
    },
    key: makeKey,
    onValue(path, cb) {
      const L = { type: 'value', segs: split(path), path: join(split(path)), cb, ready: false };
      listeners.add(L);
      subscribe(L);
      return () => unsubscribe(L);
    },
    onChildren(path, cbs, opts = {}) {
      const L = { type: 'child', segs: split(path), path: join(split(path)), cbs, limit: opts.limit || 0, ready: false };
      listeners.add(L);
      subscribe(L);
      return () => unsubscribe(L);
    },
    get(path) { return request({ op: 'get', path: join(split(path)) }); },
    set(path, value) {
      const p = join(split(path));
      return write([[p, value ?? null]], { op: 'set', path: p, value: norm(value) });
    },
    update(path, obj) {
      const p = join(split(path));
      const entries = Object.entries(obj || {}).map(([k, v]) => [join(split(p + '/' + k)), v ?? null]);
      const value = {};
      for (const [k, v] of Object.entries(obj || {})) value[k] = norm(v);
      return write(entries, { op: 'update', path: p, value });
    },
    remove(path) {
      const p = join(split(path));
      return write([[p, null]], { op: 'set', path: p, value: null });
    },
    onDisconnect(path, value = null) {
      const p = join(split(path));
      disconnectOps.set(p, norm(value));
      send({ op: 'ondc', path: p, value: norm(value) });
    },
    cancelDisconnect(path) {
      const p = join(split(path));
      disconnectOps.delete(p);
      send({ op: 'ondc_cancel', path: p });
    },
    // O que é próprio de estar dentro do Froq: a sessão da atividade (quem abriu e qual mesa está aberta).
    froq: {
      get session() { return session; },
      onSession(fn) { sessionListeners.add(fn); return () => sessionListeners.delete(fn); },
      /** Quem abriu a atividade escolheu a mesa: o Froq leva todo mundo da chamada para ela. */
      setRoom(roomId, name) { post({ type: 'room', roomId, name: String(name || 'Mesa').slice(0, 60) }); },
    },
  };
}
