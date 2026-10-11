// Sala: convite, jogadores, papel de mestre, seu perfil. + avatares no topo.
import { S, on, emit, isGM, setGM, updateMe, COLORS, R } from '../state.js';
import { $, h, icon, toast, initials, confirmBox, fill } from './dom.js';
import { openPanel } from './layout.js';

export function inviteLink() {
  const u = new URL(location.href);
  u.search = '?sala=' + S.roomId; u.hash = '';
  return u.toString();
}

export function initRoom() {
  $('#tb-room').addEventListener('click', () => openPanel('room'));
  on('members', () => { render(); presence(); });
  on('meta', () => { render(); presence(); $('#tb-room-name').textContent = S.meta?.name || 'Mesa'; roleChip(); document.title = (S.meta?.name || 'Mesa') + ' · VTT'; document.body.classList.toggle('is-gm', isGM()); });
  render(); presence();
}

function roleChip() {
  let chip = $('#tb-role');
  if (!chip) { chip = h('span.role-chip#tb-role'); $('#tb-room').after(chip); }
  const gm = isGM();
  chip.className = 'role-chip ' + (gm ? 'gm' : 'pl');
  chip.textContent = gm ? 'Mestre' : 'Jogador';
}

function presence() {
  const box = $('#tb-presence');
  const list = Object.entries(S.members).sort((a, b) => (b[1].online ? 1 : 0) - (a[1].online ? 1 : 0));
  fill(box, ...list.filter(([, m]) => m.online).map(([uid, m]) => h('span.av', {
    class: (isGM(uid) ? 'gm ' : '') + (m.online ? '' : 'off'), title: `${m.name}${isGM(uid) ? ' (mestre)' : ''}`, style: { background: m.color },
  }, initials(m.name))));
}

function render() {
  const p = $('#p-room');
  const gm = isGM();
  const link = inviteLink();
  const name = h('input.grow', { value: S.me.name, maxLength: 24, on: { change: (e) => { const v = e.target.value.trim(); if (v) updateMe({ name: v }); } } });
  const colors = h('div.swatches', COLORS.map((c) => h('button.swatch', { type: 'button', class: c === S.me.color ? 'on' : '', style: { background: c }, on: { click: () => { updateMe({ color: c }); render(); } } })));
  const members = Object.entries(S.members).sort((a, b) => (b[1].online ? 1 : 0) - (a[1].online ? 1 : 0) || (a[1].name || '').localeCompare(b[1].name || ''));
  fill(p, 
    h('h3', 'Convidar'),
    h('div.card',
      h('div.row', h('code.grow', { style: { fontSize: '20px', fontWeight: 800, letterSpacing: '2px', color: 'var(--acc)' } }, S.roomId)),
      h('div.row',
        h('button.btn.primary', { type: 'button', on: { click: async () => {
          try {
            if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) await navigator.share({ title: S.meta?.name, url: link });
            else { await navigator.clipboard.writeText(link); toast('Link copiado!'); }
          } catch { /* cancelado */ }
        } } }, icon('copy'), 'Copiar link'),
        S.be.mode === 'local' ? h('span.small.muted', 'Modo local: só funciona em abas deste navegador.') : null,
      ),
    ),
    h('h3', 'Você', h('span.role-chip', { class: gm ? 'gm' : 'pl' }, gm ? (S.meta?.owner === S.uid ? 'Mestre (criador)' : 'Mestre') : 'Jogador')),
    h('div.small.muted', S.user?.guest ? 'Convidado' : `Conta: ${S.user?.email || S.user?.name || ''}`),
    h('div.card', h('div.row', name), colors),
    h('h3', `Jogadores (${members.filter(([, m]) => m.online).length} online)`),
    h('div.list', members.map(([uid, m]) => h('div.item',
      h('span.av', { class: (isGM(uid) ? 'gm ' : '') + (m.online ? '' : 'off'), style: { background: m.color } }, initials(m.name)),
      h('div.grow', h('div.title', m.name || '?', uid === S.uid ? ' (você)' : ''), h('div.sub', (uid === S.meta?.owner ? 'Mestre (criador) · ' : isGM(uid) ? 'Mestre · ' : '') + (m.online ? 'online' : 'offline'))),
      gm && uid !== S.uid && uid !== S.meta?.owner ? h('button.btn.sm.ghost', { type: 'button', on: { click: async () => {
        if (isGM(uid)) { if (await confirmBox(`Tirar ${m.name} de mestre?`, 'Tirar')) setGM(uid, false); }
        else if (await confirmBox(`Tornar ${m.name} mestre também? Ele poderá ver e mudar tudo.`, 'Tornar mestre', false)) setGM(uid, true);
      } } }, isGM(uid) ? 'Tirar mestre' : 'Tornar mestre') : null,
      gm && uid !== S.uid && !m.online ? h('button.icon-btn', { type: 'button', title: 'Remover da lista', on: { click: () => S.be.remove(R(`members/${uid}`)) } }, icon('x')) : null,
    ))),
    h('h3', 'Atalhos'),
    h('div.small.muted', { style: { lineHeight: 1.7 } },
      'V mover · M medir · D desenho · F névoa · W paredes · P ping/laser · Ctrl+C/X/V copiar/colar · Ctrl+D duplicar · Ctrl+A tudo · Ctrl+Z/Y desfazer/refazer · R gira · [ ] ordem · L trava · H esconde · Del apaga · Alt desliga o encaixe · arrastar no vazio seleciona (PC) · botão direito/Espaço move o mapa · duplo clique abre token/ficha'),
    h('div.row',
      h('button.btn.ghost', { type: 'button', on: { click: () => { location.href = location.pathname; } } }, 'Voltar às minhas mesas'),
      h('button.btn.ghost', { type: 'button', on: { click: async () => { if (await confirmBox('Sair da sua conta neste aparelho?', 'Sair', false)) emit('logout'); } } }, 'Sair da conta'),
    ),
  );
}
