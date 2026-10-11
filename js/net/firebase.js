// Backend Firebase Realtime Database + contas (Google, e-mail/senha, convidado). Carregado do CDN oficial, sem build.
const V = '10.14.1';
const BASE = `https://www.gstatic.com/firebasejs/${V}`;

const ERROS = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'Não existe conta com esse e-mail.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/email-already-in-use': 'Já existe uma conta com esse e-mail. Use "Entrar".',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'auth/missing-password': 'Digite a senha.',
  'auth/too-many-requests': 'Muitas tentativas. Espere um pouco e tente de novo.',
  'auth/popup-closed-by-user': 'Login cancelado.',
  'auth/cancelled-popup-request': 'Login cancelado.',
  'auth/network-request-failed': 'Sem conexão com a internet.',
  'auth/operation-not-allowed': 'Esse tipo de login não está ativado no Firebase (Authentication → Método de login).',
  'auth/admin-restricted-operation': 'Esse tipo de login não está ativado no Firebase (Authentication → Método de login).',
};
function traduz(e) {
  if (e?.code === 'auth/unauthorized-domain') return `Este endereço (${location.hostname}) não está autorizado. Adicione-o no Firebase em Authentication → Configurações → Domínios autorizados.`;
  return ERROS[e?.code] || e?.message || String(e);
}
const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { throw new Error(traduz(e)); } };

export async function createFirebaseBackend(config) {
  const [{ initializeApp }, A, db] = await Promise.all([
    import(`${BASE}/firebase-app.js`),
    import(`${BASE}/firebase-auth.js`),
    import(`${BASE}/firebase-database.js`),
  ]);
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  const database = db.getDatabase(app);
  const r = (p) => db.ref(database, p);
  let user = null;
  const toUser = (u) => u && ({
    uid: u.uid,
    name: u.displayName || (u.email ? u.email.split('@')[0] : 'Convidado'),
    email: u.email || null,
    guest: !!u.isAnonymous,
    provider: u.isAnonymous ? 'guest' : (u.providerData?.[0]?.providerId || 'password'),
  });

  return {
    mode: 'firebase',
    get uid() { return user?.uid || null; },
    get user() { return user; },
    async init() {
      try { await A.getRedirectResult(auth); } catch { /* volta de login por redirecionamento */ }
      await new Promise((resolve) => {
        const off = A.onAuthStateChanged(auth, (u) => { user = toUser(u); off(); resolve(); });
      });
      return user;
    },
    auth: {
      google: wrap(async () => {
        const prov = new A.GoogleAuthProvider();
        prov.setCustomParameters({ prompt: 'select_account' });
        try {
          const res = await A.signInWithPopup(auth, prov);
          user = toUser(res.user);
        } catch (e) {
          // celular costuma bloquear pop-up: usa redirecionamento (a página recarrega já logada)
          if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
            await A.signInWithRedirect(auth, prov);
            return new Promise(() => {});
          }
          throw e;
        }
        return user;
      }),
      emailIn: wrap(async (email, pass) => {
        const res = await A.signInWithEmailAndPassword(auth, email.trim(), pass);
        user = toUser(res.user);
        return user;
      }),
      emailUp: wrap(async (name, email, pass) => {
        if (!name?.trim()) throw new Error('Digite seu nome.');
        const res = await A.createUserWithEmailAndPassword(auth, email.trim(), pass);
        await A.updateProfile(res.user, { displayName: name.trim() });
        user = toUser(res.user); user.name = name.trim();
        return user;
      }),
      reset: wrap(async (email) => { await A.sendPasswordResetEmail(auth, email.trim()); }),
      guest: wrap(async () => { const res = await A.signInAnonymously(auth); user = toUser(res.user); return user; }),
      out: wrap(async () => { await A.signOut(auth); user = null; }),
      rename: wrap(async (name) => { if (auth.currentUser && !auth.currentUser.isAnonymous) await A.updateProfile(auth.currentUser, { displayName: name }); if (user) user.name = name; }),
    },
    key() { return db.push(r('_keys')).key; },
    onValue(path, cb) {
      return db.onValue(r(path), (s) => cb(s.val()), (e) => console.warn('onValue', path, e.message));
    },
    onChildren(path, cbs, opts = {}) {
      const q = opts.limit ? db.query(r(path), db.limitToLast(opts.limit)) : r(path);
      const err = (e) => console.warn('onChildren', path, e.message);
      const offs = [];
      if (cbs.added) offs.push(db.onChildAdded(q, (s) => cbs.added(s.key, s.val()), err));
      if (cbs.changed) offs.push(db.onChildChanged(q, (s) => cbs.changed(s.key, s.val()), err));
      if (cbs.removed) offs.push(db.onChildRemoved(q, (s) => cbs.removed(s.key), err));
      if (cbs.ready) db.onValue(q, () => cbs.ready(), { onlyOnce: true });
      return () => offs.forEach((f) => f());
    },
    async get(path) { return (await db.get(r(path))).val(); },
    set(path, value) { return db.set(r(path), value ?? null); },
    update(path, obj) { return db.update(r(path), obj); },
    remove(path) { return db.remove(r(path)); },
    onDisconnect(path, value = null) {
      const od = db.onDisconnect(r(path));
      return value === null ? od.remove() : od.set(value);
    },
    cancelDisconnect(path) { return db.onDisconnect(r(path)).cancel(); },
  };
}
