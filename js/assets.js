// Imagens: compressão no navegador (WebP), envio em pedaços para o banco e cache local (IndexedDB).
import { S, R, emit } from './state.js';
import { idbGet, idbSet, idbDel } from './net/idb.js';

const CHUNK = 480 * 1024;
const cache = new Map(); // ref -> { img, status }

let webpOk = null;
async function canWebp() {
  if (webpOk !== null) return webpOk;
  const c = document.createElement('canvas'); c.width = c.height = 2;
  const b = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8));
  webpOk = !!b && b.type === 'image/webp';
  return webpOk;
}

async function loadFileImage(file) {
  if ('createImageBitmap' in self) {
    try { return await createImageBitmap(file); } catch { /* cai no fallback */ }
  }
  const url = URL.createObjectURL(file);
  const img = new Image(); img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  return img;
}

export async function compressImage(file, maxDim) {
  const src = await loadFileImage(file);
  const sw = src.width, sh = src.height;
  let scale = Math.min(1, maxDim / Math.max(sw, sh));
  const webp = await canWebp();
  for (let attempt = 0; attempt < 4; attempt++) {
    const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
    const mime = webp ? 'image/webp' : (maxDim <= 512 ? 'image/png' : 'image/jpeg');
    const blob = await new Promise((r) => c.toBlob(r, mime, 0.82));
    if (blob.size < 3.5 * 1024 * 1024 || attempt === 3) {
      src.close?.();
      return { blob, w, h, mime: blob.type, origW: sw, origH: sh };
    }
    scale *= 0.75;
  }
}

const blobToDataURL = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
async function dataURLToBlob(url) { return (await fetch(url)).blob(); }

const hasAccount = () => S.uid && !S.user?.guest;

// Grava um blob já comprimido. Com conta: vai para a biblioteca da conta (serve em todas as mesas).
// Sem conta (convidado): fica só nesta mesa.
async function storeBlob(blob, meta, { toRoom = true } = {}) {
  const data = await blobToDataURL(blob);
  const id = S.be.key();
  const n = Math.ceil(data.length / CHUNK);
  const full = { ...meta, mime: blob.type, n, size: blob.size, owner: S.uid, ts: Date.now() };
  let ref;
  if (hasAccount()) {
    ref = `lib:${S.uid}:${id}`;
    await idbSet('assets', ref, blob);
    // dados primeiro, depois o meta (assim quem vê o meta já consegue baixar)
    for (let i = 0; i < n; i++) await S.be.set(`users/${S.uid}/libraryData/${id}/${i}`, data.slice(i * CHUNK, (i + 1) * CHUNK));
    await S.be.set(`users/${S.uid}/library/${id}`, full);
    if (toRoom && S.roomId) await S.be.set(R(`assets/${id}`), { ...full, ref });
  } else {
    ref = 'asset:' + id;
    await idbSet('assets', id, blob);
    for (let i = 0; i < n; i++) await S.be.set(R(`assetData/${id}/${i}`), data.slice(i * CHUNK, (i + 1) * CHUNK));
    await S.be.set(R(`assets/${id}`), full);
  }
  return { id, ref, ...full };
}

export async function uploadAsset(file, kind = 'token', opts) {
  const maxDim = kind === 'map' ? 4096 : 400;
  const { blob, w, h, origW, origH } = await compressImage(file, maxDim);
  const name = (file.name || 'imagem').replace(/\.[^.]+$/, '').slice(0, 40);
  const r = await storeBlob(blob, { name, kind, w, h, origW, origH }, opts);
  return { ...r, w, h, origW, origH, name };
}

// referência de imagem de um item da biblioteca da mesa
export const assetRef = (id, meta = S.assets[id]) => meta?.ref || 'asset:' + id;

// Põe na biblioteca da mesa um item da biblioteca da conta (só o índice; a imagem continua na conta)
export async function addLibraryToRoom(id) {
  const meta = S.library[id];
  if (!meta || !S.roomId) return null;
  const ref = `lib:${S.uid}:${id}`;
  await S.be.set(R(`assets/${id}`), { ...meta, ref });
  return ref;
}

// Tira da mesa. Imagens só desta mesa (convidado / antigas) são apagadas de vez.
export async function deleteAsset(id) {
  const meta = S.assets[id];
  if (!meta?.ref) {
    await S.be.remove(R(`assetData/${id}`));
    idbDel('assets', id);
    cache.delete('asset:' + id);
  }
  await S.be.remove(R(`assets/${id}`));
}
// Apaga da biblioteca da conta (some de todas as mesas)
export async function deleteLibraryAsset(id) {
  await S.be.remove(`users/${S.uid}/libraryData/${id}`);
  await S.be.remove(`users/${S.uid}/library/${id}`);
  const ref = `lib:${S.uid}:${id}`;
  idbDel('assets', ref); cache.delete(ref);
  if (S.roomId && S.assets[id]) await S.be.remove(R(`assets/${id}`));
}

function parseRef(ref) {
  if (ref.startsWith('lib:')) { const [, uid, id] = ref.split(':'); return { key: ref, meta: `users/${uid}/library/${id}`, data: `users/${uid}/libraryData/${id}` }; }
  if (ref.startsWith('asset:')) { const id = ref.slice(6); return { key: id, meta: R(`assets/${id}`), data: R(`assetData/${id}`) }; }
  return null;
}

async function fetchAssetBlob(ref, room) {
  const p = parseRef(ref);
  if (room && ref.startsWith('asset:')) { const id = ref.slice(6); p.meta = `rooms/${room}/assets/${id}`; p.data = `rooms/${room}/assetData/${id}`; }
  let blob = await idbGet('assets', p.key);
  if (blob) return blob;
  const meta = await S.be.get(p.meta);
  const n = meta?.n || 1;
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(S.be.get(`${p.data}/${i}`));
  const data = (await Promise.all(parts)).join('');
  if (!data) throw new Error('imagem não encontrada');
  blob = await dataURLToBlob(data);
  idbSet('assets', p.key, blob);
  return blob;
}

// Imagem que veio de outra mesa (ao colar tokens): copia para a sua biblioteca, para todos da mesa atual verem
export async function portableRef(ref, fromRoom) {
  if (!ref || !ref.startsWith('asset:') || fromRoom === S.roomId) return ref;
  try {
    const blob = await fetchAssetBlob(ref, fromRoom);
    if (!hasAccount()) return null;
    const r = await storeBlob(blob, { name: 'colado', kind: 'token' });
    return r.ref;
  } catch { return null; }
}

// Retorna a imagem pronta ou null (e começa a carregar; emite 'image' quando chegar).
export function getImage(ref) {
  if (!ref) return null;
  const c = cache.get(ref);
  if (c) return c.status === 'ok' ? c.img : null;
  const entry = { status: 'loading', img: null };
  cache.set(ref, entry);
  (async () => {
    try {
      const img = new Image();
      img.decoding = 'async';
      if (parseRef(ref)) img.src = URL.createObjectURL(await fetchAssetBlob(ref));
      else img.src = ref;
      await img.decode();
      entry.img = img; entry.status = 'ok';
      emit('image', ref);
    } catch (e) {
      entry.status = 'error';
      console.warn('imagem falhou', ref, e);
      setTimeout(() => cache.delete(ref), 15000); // tenta de novo depois
    }
  })();
  return null;
}

export function imageURL(ref) {
  const img = getImage(ref);
  return img ? img.src : '';
}
