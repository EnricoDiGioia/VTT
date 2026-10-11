// Chat + dados.
import { S, on, sendChat, canSeeMsg, isGM, R, emit } from '../state.js';
import { roll } from '../dice.js';
import { $, h, esc, toast, fill } from './dom.js';
import { isPanelVisible } from './layout.js';

const joinedAt = Date.now();
let unread = 0;

export function initChat() {
  const log = $('#chat-log');
  const form = $('#chat-form');
  const inp = $('#chat-in');
  const hist = []; let hi = 0;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = inp.value.trim();
    if (!v) return;
    hist.push(v); hi = hist.length;
    inp.value = '';
    handleInput(v);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && hi > 0) { hi--; inp.value = hist[hi]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); inp.value = hist[hi] || ''; e.preventDefault(); }
  });

  // dados rápidos
  const quick = $('#dice-quick');
  const mod = h('input.mod', { type: 'number', placeholder: '±0', title: 'Modificador', inputMode: 'numeric' });
  const q = (f, label) => h('button', { type: 'button', on: { click: (e) => {
    const m = parseInt(mod.value, 10);
    const formula = f + (m ? (m > 0 ? '+' : '') + m : '');
    doRoll(formula, null, { gm: e.shiftKey });
  } } }, label || f);
  quick.append(q('1d4', 'd4'), q('1d6', 'd6'), q('1d8', 'd8'), q('1d10', 'd10'), q('1d12', 'd12'), q('1d20', 'd20'), q('1d100', 'd%'), q('2d20kh1', 'Vant'), q('2d20kl1', 'Desv'), mod);

  on('chat:add', (m) => {
    if (!canSeeMsg(m)) return;
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.append(renderMsg(m));
    while (log.childElementCount > 200) log.firstElementChild.remove();
    if (stick || m.uid === S.uid) log.scrollTop = log.scrollHeight;
    const fresh = (m.ts || 0) > joinedAt - 2000;
    if (fresh && m.uid !== S.uid && !isPanelVisible('chat')) {
      unread++; updateBadge();
    }
    if (fresh && (m.t === 'roll') && !isPanelVisible('chat')) showRollToast(m);
  });
  on('chat:reset', () => {
    fill(log, ...S.chat.filter(canSeeMsg).map(renderMsg));
    log.scrollTop = log.scrollHeight;
  });
  on('panel', () => { if (isPanelVisible('chat')) { unread = 0; updateBadge(); log.scrollTop = log.scrollHeight; } });
}

function updateBadge() {
  const b = $('#unread');
  b.hidden = !unread;
  b.textContent = unread > 99 ? '99+' : unread;
}

function findMember(text) {
  // aceita nomes com espaço: escolhe o maior nome que casa com o começo do texto
  const t = text.toLowerCase();
  let best = null;
  for (const uid in S.members) {
    const n = (S.members[uid].name || '').toLowerCase();
    if (n && t.startsWith(n) && (!best || n.length > best.n.length)) best = { uid, n };
  }
  if (!best) {
    const first = t.split(/\s+/)[0];
    for (const uid in S.members) if ((S.members[uid].name || '').toLowerCase().startsWith(first)) return { uid, n: first };
  }
  return best;
}

export function handleInput(v) {
  const cmd = /^\/(\w+)\s*([\s\S]*)$/.exec(v);
  if (cmd) {
    const [, c, rest] = cmd;
    const name = c.toLowerCase();
    if (['r', 'roll', 'rolar'].includes(name)) return rollCmd(rest);
    if (['gr', 'gmroll', 'oculto'].includes(name)) return rollCmd(rest, { gm: true });
    if (['w', 'sussurro', 'whisper'].includes(name)) {
      const m = findMember(rest);
      if (!m) return toast('Jogador não encontrado');
      const text = rest.slice(m.n.length).trim();
      if (!text) return;
      return sendText(text, { to: m.uid, toName: S.members[m.uid].name });
    }
    if (name === 'me' || name === 'eu') return sendChat({ t: 'me', text: rest });
    if (name === 'limpar' && isGM()) { S.be.remove(R('chat')).then(() => { S.chat = []; emit('chat:reset'); }); return; }
    if (['ajuda', 'help', '?'].includes(name)) return showHelp();
    return toast(`Comando /${c} desconhecido — use /ajuda`);
  }
  sendText(v);
}

function rollCmd(rest, opts = {}) {
  const [formula, ...label] = rest.split('#');
  doRoll(formula.trim() || '1d20', label.join('#').trim() || null, opts);
}

function sendText(text, extra = {}) {
  // rolagens embutidas [[1d20+3]]
  const inl = [];
  const out = text.replace(/\[\[([^\]]+)\]\]/g, (m, f) => {
    try { const r = roll(f); inl.push(r); return `[[${inl.length - 1}]]`; } catch { return m; }
  });
  sendChat({ t: 'msg', text: out, inl: inl.length ? inl : null, ...extra });
}

export function doRoll(formula, label, opts = {}) {
  try {
    const r = roll(formula);
    r.label = label || null;
    sendChat({ t: 'roll', roll: r, gm: opts.gm || null, as: opts.as || null });
    return r;
  } catch (e) {
    toast('Dado inválido: ' + e.message);
    return null;
  }
}

function showHelp() {
  const lines = [
    '<b>/r 1d20+5 # Ataque</b> — rola (o texto após # é o rótulo)',
    '<b>/gr 2d6</b> — rolagem oculta (só você e o mestre veem)',
    '<b>/w Nome mensagem</b> — sussurro',
    '<b>/me</b> ação — narra uma ação',
    '<b>[[1d8+2]]</b> no meio do texto — rolagem embutida',
    'Fórmulas: <code>4d6kh3</code> (mantém 3 maiores), <code>kl</code>, <code>dl</code>, <code>dh</code>, <code>3d6!</code> (explode), <code>2d20r1</code> (rerrola 1), <code>8d10>=7</code> (sucessos), <code>4dF</code>, <code>adv</code>/<code>dis</code>',
    'Shift+clique nos dados rápidos = rolagem oculta',
  ];
  const el = h('div.msg.sys');
  el.innerHTML = lines.join('<br>');
  $('#chat-log').append(el);
  $('#chat-log').scrollTop = 1e9;
}

function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function rollHTML(r) {
  const parts = (r.segs || []).map((s) => {
    if (typeof s === 'string') return esc(s);
    if (typeof s === 'number') return String(s);
    const ds = (s.rolls || []).map((x) => `<span class="d${x.max ? ' max' : ''}${x.min ? ' min' : ''}${x.drop ? ' drop' : ''}${x.hit ? ' hit' : ''}" title="${x.rr ? 'rerrolado de ' + x.rr : ''}${x.ex ? 'explodiu' : ''}">${s.sides === 'F' ? (x.v > 0 ? '+' : x.v < 0 ? '−' : '0') : x.v}</span>`).join('');
    return `${esc(s.label)}${s.cmp ? esc(s.cmp) : ''}[${ds}]`;
  }).join('');
  return parts;
}
function critClass(r) {
  const d20 = (r.segs || []).filter((s) => s && typeof s === 'object' && s.sides === 20);
  if (d20.length !== 1) return '';
  const kept = d20[0].rolls.filter((x) => !x.drop);
  if (kept.length !== 1) return '';
  return kept[0].v === 20 ? ' crit' : kept[0].v === 1 ? ' fumble' : '';
}

export function rollCard(r, who) {
  const el = h('div.roll');
  el.className = 'roll' + critClass(r);
  el.innerHTML = `
    ${who ? `<div class="who" style="color:${esc(who.color)}">${esc(who.name)}</div>` : ''}
    <div class="roll-head"><span class="roll-label">${esc(r.label || '')}</span><span class="roll-formula">${esc(r.formula)}</span></div>
    <div class="roll-body"><span class="roll-detail">${rollHTML(r)}</span><span class="roll-total">${esc(r.total)}</span></div>`;
  return el;
}

function renderMsg(m) {
  const el = h('div.msg');
  const who = `<span class="who" style="color:${esc(m.color || '#fff')}">${esc(m.as || m.name || '?')}</span>`;
  const when = `<span class="when">${fmtTime(m.ts)}</span>`;
  if (m.t === 'sys') { el.className = 'msg sys'; el.textContent = m.text; return el; }
  if (m.t === 'me') { el.className = 'msg me'; el.innerHTML = `${who}${esc(m.text)}`; return el; }
  let tag = '';
  if (m.to) { el.classList.add('priv'); tag = `<span class="tag">${m.uid === S.uid ? 'para ' + esc(m.toName || '') : 'sussurro'}</span>`; }
  if (m.gm) { el.classList.add('priv'); tag = '<span class="tag">oculta</span>'; }
  if (m.t === 'roll' && m.roll) {
    el.innerHTML = `${tag}${who}${when}`;
    el.append(rollCard(m.roll));
    return el;
  }
  let text = esc(m.text);
  if (m.inl) {
    text = text.replace(/\[\[(\d+)\]\]/g, (x, i) => {
      const r = m.inl[i]; if (!r) return x;
      const tip = esc(r.formula + ' → ' + rollHTML(r).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
      return `<span class="inline-roll${critClass(r)}" title="${tip}">${esc(r.total)}</span>`;
    });
  }
  text = text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--blue)">$1</a>');
  el.innerHTML = `${tag}${who}${when}<div>${text}</div>`;
  return el;
}

function showRollToast(m) {
  const box = $('#rolltoast');
  const card = rollCard(m.roll, { name: m.as || m.name, color: m.color });
  box.prepend(card);
  while (box.childElementCount > 3) box.lastElementChild.remove();
  setTimeout(() => card.remove(), 5000);
}
