export const CONDITIONS = [
  { id: 'dead', label: 'Morto', icon: '💀' },
  { id: 'down', label: 'Inconsciente', icon: '😵' },
  { id: 'prone', label: 'Caído', icon: '⤵️' },
  { id: 'poison', label: 'Envenenado', icon: '🧪' },
  { id: 'stun', label: 'Atordoado', icon: '💫' },
  { id: 'fear', label: 'Amedrontado', icon: '😱' },
  { id: 'charm', label: 'Enfeitiçado', icon: '💗' },
  { id: 'blind', label: 'Cego', icon: '🙈' },
  { id: 'grab', label: 'Agarrado', icon: '⛓️' },
  { id: 'para', label: 'Paralisado', icon: '🧊' },
  { id: 'burn', label: 'Queimando', icon: '🔥' },
  { id: 'bleed', label: 'Sangrando', icon: '🩸' },
  { id: 'invis', label: 'Invisível', icon: '👻' },
  { id: 'conc', label: 'Concentrando', icon: '🎯' },
  { id: 'buff', label: 'Abençoado', icon: '✨' },
  { id: 'hidden', label: 'Escondido', icon: '🕶️' },
];
export const COND = Object.fromEntries(CONDITIONS.map((c) => [c.id, c]));

export const DRAW_COLORS = ['#ffffff', '#111111', '#e05d6f', '#e8a33d', '#e6d24a', '#6cc56b', '#4fb3d9', '#a77de8'];
