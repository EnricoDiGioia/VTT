// Inicialização: login -> minhas mesas -> mesa.
import {
  S, connect, createRoom, joinRoom, roomExists, updateMe, COLORS, saveMe, on,
  login, logout, resetPassword, myRooms, forgetRoom,
} from './state.js';
import { initBoard } from './board.js';
import { initLayout } from './ui/layout.js';
import { initToolbar } from './ui/toolbar.js';
import { initChat } from './ui/chat.js';
import { initHud } from './ui/hud.js';
import { initInitiative } from './ui/initiative.js';
import { initSheets } from './ui/sheets.js';
import { initLibrary } from './ui/library.js';
import { initScenes } from './ui/scenes.js';
import { initRoom } from './ui/room.js';
import { $, $$, h, toast, fill, initials, confirmBox, promptBox } from './ui/dom.js';
import { initPWA, canInstall } from './pwa.js';
import { installApp } from './ui/install.js';

const params = new URLSearchParams(location.search);
let pendingRoom = params.get('sala') || '';

let uiReady = false;
function initUI() {
  if (uiReady) return;
  uiReady = true;
  initLayout();
  initBoard($('#board'));
  initToolbar();
  initChat();
  initHud();
  initInitiative();
  initSheets();
  initLibrary();
  initScenes();
  initRoom();
}

function enterApp() {
  $('#lobby').hidden = true;
  $('#app').hidden = false;
  const u = new URL(location.href);
  u.searchParams.set('sala', S.roomId);
  history.replaceState(null, '', u);
}

// ---------- tela de login ----------
let authMode = 'in';
function showAuth() {
  $('#lb-home').hidden = true;
  $('#lb-auth').hidden = false;
  const local = S.be.mode === 'local';
  $('#lb-auth-local').hidden = !local;
  $('#lb-auth-fb').hidden = local;
  $('#lb-mode').innerHTML = pendingRoom ? `Entre na sua conta para acessar a mesa <b>${pendingRoom.replace(/[^a-z0-9]/gi, '')}</b>.` : '';
  setTimeout(() => (local ? $('#au-local') : $('#au-email')).focus(), 50);
}

function bindAuth() {
  const busyBtn = async (btn, fn) => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await fn(); } catch (e) { toast(e.message, 4500); } finally { btn.disabled = false; }
  };
  const afterLogin = () => showHome();

  $$('#au-tabs button').forEach((b) => b.addEventListener('click', () => {
    authMode = b.dataset.m;
    $$('#au-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $('#au-name-f').hidden = authMode !== 'up';
    $('#au-go').textContent = authMode === 'up' ? 'Criar conta' : 'Entrar';
    $('#au-pass').autocomplete = authMode === 'up' ? 'new-password' : 'current-password';
  }));
  $('#au-google').addEventListener('click', (e) => busyBtn(e.currentTarget, async () => { await login('google'); afterLogin(); }));
  const goEmail = () => busyBtn($('#au-go'), async () => {
    const email = $('#au-email').value, pass = $('#au-pass').value;
    if (!email) { $('#au-email').focus(); throw new Error('Digite seu e-mail.'); }
    if (authMode === 'up') await login('emailUp', $('#au-name').value, email, pass);
    else await login('emailIn', email, pass);
    afterLogin();
  });
  $('#au-go').addEventListener('click', goEmail);
  $('#au-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') goEmail(); });
  $('#au-forgot').addEventListener('click', async () => {
    const email = $('#au-email').value || await promptBox('Seu e-mail', '', 'email@exemplo.com');
    if (!email) return;
    try { await resetPassword(email); toast('Enviamos um e-mail para trocar a senha.', 4000); } catch (e) { toast(e.message, 4000); }
  });
  $('#au-guest').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!(await confirmBox('Convidados entram em mesas como jogadores, mas não criam mesas e perdem o acesso ao trocar de aparelho. Continuar?', 'Entrar como convidado', false))) return;
    const name = await promptBox('Seu nome na mesa', S.me.name || '');
    if (!name?.trim()) return;
    busyBtn(btn, async () => {
      await login('guest');
      S.me.name = name.trim(); saveMe();
      afterLogin();
    });
  });
  const goLocal = () => busyBtn($('#au-local-go'), async () => { await login('local', $('#au-local').value); afterLogin(); });
  $('#au-local-go').addEventListener('click', goLocal);
  $('#au-local').addEventListener('keydown', (e) => { if (e.key === 'Enter') goLocal(); });
}

// ---------- minhas mesas ----------
async function showHome() {
  $('#lb-auth').hidden = true;
  $('#lb-home').hidden = false;
  const u = S.user;
  const av = $('#lb-avatar');
  av.textContent = initials(S.me.name || u.name); av.style.background = S.me.color;
  $('#lb-user').textContent = S.me.name || u.name;
  $('#lb-user-sub').textContent = u.guest ? 'Convidado (só pode entrar em mesas)' : (u.email || (S.be.mode === 'local' ? 'conta de teste (modo local)' : ''));
  $('#lb-create-box').hidden = !!u.guest;
  $('#lb-mode').innerHTML = S.be.mode === 'local'
    ? '<b>Modo local</b> — funciona só entre abas deste navegador. Configure o Firebase (veja o README) para jogar online.'
    : '';
  drawColors();
  if (pendingRoom) { const r = pendingRoom; pendingRoom = ''; $('#lb-code').value = r; go('join', r); return; }
  const rooms = await myRooms();
  fill($('#lb-rooms'), rooms.length ? [
    h('h4', 'Minhas mesas'),
    ...rooms.slice(0, 12).map((r) => h('div.rm',
      h('button', { type: 'button', style: { flex: '1' }, on: { click: () => go('join', r.id) } },
        h('span', r.name),
        h('span.role', { class: r.gm ? 'gm' : 'pl' }, r.gm ? 'Mestre' : 'Jogador')),
      h('button.icon-btn', { type: 'button', title: 'Tirar da lista', on: { click: async () => { await forgetRoom(r.id); showHome(); } } }, '×'),
    )),
  ] : null);
}

function drawColors() {
  fill($('#lb-colors'), ...COLORS.map((c) => h('button.swatch', {
    type: 'button', class: c === S.me.color ? 'on' : '', style: { background: c }, title: c,
    on: { click: () => { updateMe({ color: c }); drawColors(); $('#lb-avatar').style.background = c; } },
  })));
}

let busy = false;
async function go(kind, codeArg) {
  if (busy) return;
  busy = true;
  try {
    if (kind === 'create') {
      const name = $('#lb-room').value.trim() || `Mesa de ${S.me.name}`;
      initUI();
      await createRoom(name);
      enterApp();
    } else {
      const code = String(codeArg || $('#lb-code').value).trim().replace(/.*[?&]sala=/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (!code) { $('#lb-code').focus(); return; }
      if (!(await roomExists(code))) { toast('Mesa não encontrada'); return; }
      initUI();
      await joinRoom(code);
      updateMe({ name: S.me.name, color: S.me.color });
      enterApp();
    }
  } catch (e) {
    console.error(e);
    toast('Erro: ' + e.message, 4500);
  } finally { busy = false; }
}

async function main() {
  initPWA();
  const inst = $('#lb-install');
  const showInst = () => { inst.hidden = !canInstall(); };
  inst.addEventListener('click', installApp);
  on('pwa', showInst); showInst();
  bindAuth();
  $('#lb-create').addEventListener('click', () => go('create'));
  $('#lb-join').addEventListener('click', () => go('join'));
  $('#lb-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') go('join'); });
  $('#lb-room').addEventListener('keydown', (e) => { if (e.key === 'Enter') go('create'); });
  $('#lb-logout').addEventListener('click', async () => { await logout(); showAuth(); });
  on('logout', async () => { await logout(); location.href = location.pathname; });

  $('#lb-mode').textContent = 'Conectando…';
  try { await connect(); }
  catch (e) {
    $('#lb-mode').innerHTML = `<b>Erro ao conectar:</b> ${e.message}. Confira o firebaseConfig no js/config.js.`;
    return;
  }
  if (S.user) showHome(); else showAuth();
}

main();
