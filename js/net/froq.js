// A Mesa aberta dentro do Froq, na aba Atividades.
// Os dados e a conta são os mesmos do navegador (Firebase): cada um entra com a sua conta da Mesa e vê as
// mesmas mesas. O Froq só cuida da sessão da atividade, pela página que abriu a Mesa (postMessage):
// quem abriu e qual mesa está aberta, para quem abriu escolher a mesa e os outros irem junto.

/** Endereço do Froq que abriu a Mesa (?froq=<origem>), se for um dos permitidos. */
export function froqParentOrigin(allowed) {
  if (window.parent === window) return null;
  const origin = new URLSearchParams(location.search).get('froq');
  return origin && allowed.includes(origin) ? origin : null;
}

export function createFroqBridge(parentOrigin) {
  let session = null;
  let froqUser = null;
  let initResolve = null;
  const sessionListeners = new Set();
  const post = (msg) => window.parent.postMessage({ froq: 1, ...msg }, parentOrigin);

  addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== parentOrigin) return;
    const d = e.data;
    if (!d || d.froq !== 1) return;
    if (d.type === 'init') {
      froqUser = { id: String(d.user?.id || ''), name: String(d.user?.name || '').slice(0, 24) };
      session = d.session || null;
      initResolve?.();
      initResolve = null;
    } else if (d.type === 'session') {
      session = d.session || null;
      for (const fn of sessionListeners) { try { fn(session); } catch (err) { console.error(err); } }
    }
  });

  return {
    /** Pede ao Froq quem está usando e a sessão da atividade. */
    init() {
      const got = new Promise((resolve, reject) => {
        initResolve = resolve;
        setTimeout(() => reject(new Error('o Froq não respondeu')), 15000);
      });
      post({ type: 'hello' });
      return got;
    },
    /** Quem está no Froq (para sugerir o nome na mesa). */
    get user() { return froqUser; },
    get session() { return session; },
    onSession(fn) { sessionListeners.add(fn); return () => sessionListeners.delete(fn); },
    /** Quem abriu a atividade escolheu a mesa: o Froq leva todo mundo da chamada para ela. */
    setRoom(roomId, name) { post({ type: 'room', roomId, name: String(name || 'Mesa').slice(0, 60) }); },
  };
}
