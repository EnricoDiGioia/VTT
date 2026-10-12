// Instalar como app: registra o service worker e guarda o convite de instalação do navegador.
import { emit } from './state.js';

let deferred = null;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
/** true quando dá para mostrar um botão "Instalar o app" */
export const canInstall = () => !isInstalled() && (!!deferred || isIOS);

export async function promptInstall() {
  if (deferred) {
    deferred.prompt();
    const { outcome } = await deferred.userChoice.catch(() => ({}));
    if (outcome === 'accepted') deferred = null;
    emit('pwa');
    return outcome;
  }
  return isIOS ? 'ios' : 'unavailable';
}

export function initPWA() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit('pwa'); });
  addEventListener('appinstalled', () => { deferred = null; emit('pwa'); });
}
