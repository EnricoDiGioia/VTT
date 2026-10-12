// Botão "Instalar o app": usa o convite do navegador (Android/PC) ou explica o passo a passo (iPhone).
import { promptInstall } from '../pwa.js';
import { h, modal, toast } from './dom.js';

export async function installApp() {
  const r = await promptInstall();
  if (r === 'accepted') toast('App instalado! Procure o ícone "Mesa" na tela inicial.');
  else if (r === 'ios') {
    modal('Instalar no iPhone / iPad', h('ol', { style: { lineHeight: 1.7, paddingLeft: '20px', margin: 0 } },
      h('li', 'Abra este site no Safari.'),
      h('li', 'Toque no botão Compartilhar (quadrado com a seta para cima).'),
      h('li', 'Escolha "Adicionar à Tela de Início" e toque em Adicionar.'),
    ));
  } else if (r === 'unavailable') {
    modal('Instalar o app', h('div', { style: { lineHeight: 1.6 } },
      'Abra o menu do navegador (⋮) e toque em "Instalar app" ou "Adicionar à tela inicial". No Chrome do PC, use o ícone de instalar na barra de endereço.'));
  }
}
