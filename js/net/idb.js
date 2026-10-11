// Mini helper de IndexedDB (chave/valor). Usado para cache de imagens e para o modo local.
const DB_NAME = 'vtt';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function idbGet(store, key) {
  try { return await tx(store, 'readonly', (s) => s.get(key)); } catch { return undefined; }
}
export async function idbSet(store, key, value) {
  try { await tx(store, 'readwrite', (s) => s.put(value, key)); } catch (e) { console.warn('idbSet', e); }
}
export async function idbDel(store, key) {
  try { await tx(store, 'readwrite', (s) => s.delete(key)); } catch { /* ignora */ }
}
