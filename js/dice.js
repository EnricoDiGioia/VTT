// Rolador de dados. Suporta: 2d6+3, d20, d%, 4dF, 4d6kh3 / kl / dh / dl, 3d6! (explode),
// 2d20r1 (rerrola 1 uma vez), 8d10>=7 (conta sucessos), * e /, parênteses, adv/dis.

function rnd(n) {
  const a = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / n) * n;
  do crypto.getRandomValues(a); while (a[0] >= lim);
  return (a[0] % n) + 1;
}

const ALIASES = [
  [/\b(adv|vantagem|vant)\b/gi, '2d20kh1'],
  [/\b(dis|desvantagem|desv)\b/gi, '2d20kl1'],
];

export function roll(input) {
  let src = String(input).trim();
  for (const [re, rep] of ALIASES) src = src.replace(re, rep);
  src = src.replace(/\s+/g, '');
  if (!src) throw new Error('Fórmula vazia');
  let i = 0;
  const segs = [];
  let diceCount = 0;

  const peek = () => src[i];
  const eat = (s) => { if (src.startsWith(s, i)) { i += s.length; return true; } return false; };
  const num = () => {
    const m = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length; return parseFloat(m[0]);
  };

  function expr() {
    let v = term();
    for (;;) {
      if (eat('+')) { segs.push(' + '); v += term(); }
      else if (eat('-')) { segs.push(' − '); v -= term(); }
      else return v;
    }
  }
  function term() {
    let v = unary();
    for (;;) {
      if (eat('*')) { segs.push(' × '); v *= unary(); }
      else if (eat('/')) { segs.push(' ÷ '); const d = unary(); v = d === 0 ? 0 : Math.floor(v / d); }
      else return v;
    }
  }
  function unary() {
    if (eat('-')) { segs.push('−'); return -unary(); }
    return atom();
  }
  function atom() {
    if (eat('(')) {
      segs.push('(');
      const v = expr();
      if (!eat(')')) throw new Error('Falta “)”');
      segs.push(')');
      if (peek() === 'd' || peek() === 'D') { i++; segs.push('→'); return dice(Math.max(0, Math.floor(v))); }
      return v;
    }
    let n = num();
    if (peek() === 'd' || peek() === 'D') {
      i++;
      return dice(n === null ? 1 : n);
    }
    if (n === null) throw new Error(`Não entendi “${src.slice(i, i + 6) || src}”`);
    segs.push(String(n));
    return n;
  }
  function dice(n) {
    let sides;
    if (eat('%')) sides = 100;
    else if (eat('F') || eat('f')) sides = 'F';
    else { sides = num(); if (!sides) throw new Error('Faces do dado faltando'); }
    if (n > 200 || (typeof sides === 'number' && sides > 1000)) throw new Error('Dados demais');
    diceCount += n;
    if (diceCount > 500) throw new Error('Dados demais');
    const d = { n, sides, rolls: [], value: 0 };
    // modificadores
    let keep = null, explode = false, reroll = null, cmp = null;
    for (;;) {
      if (eat('kh') || eat('k')) keep = { t: 'kh', n: num() ?? 1 };
      else if (eat('kl')) keep = { t: 'kl', n: num() ?? 1 };
      else if (eat('dh')) keep = { t: 'dh', n: num() ?? 1 };
      else if (eat('dl')) keep = { t: 'dl', n: num() ?? 1 };
      else if (eat('!')) explode = true;
      else if (eat('r')) reroll = num() ?? 1;
      else if (eat('>=')) cmp = { op: '>=', n: num() };
      else if (eat('<=')) cmp = { op: '<=', n: num() };
      else if (eat('>')) cmp = { op: '>', n: num() };
      else if (eat('<')) cmp = { op: '<', n: num() };
      else break;
    }
    const one = () => (sides === 'F' ? rnd(3) - 2 : rnd(sides));
    let extra = 0;
    for (let k = 0; k < n; k++) {
      let v = one();
      const r = { v };
      if (reroll !== null && sides !== 'F' && v <= reroll) { r.rr = v; v = r.v = one(); }
      d.rolls.push(r);
      while (explode && sides !== 'F' && v === sides && extra < 100) { extra++; v = one(); d.rolls.push({ v, ex: true }); }
    }
    if (keep) {
      const order = d.rolls.map((r, idx) => [r.v, idx]).sort((a, b) => a[0] - b[0]);
      let drop = [];
      const kn = Math.min(keep.n, d.rolls.length);
      if (keep.t === 'kh') drop = order.slice(0, d.rolls.length - kn);
      if (keep.t === 'kl') drop = order.slice(kn);
      if (keep.t === 'dl') drop = order.slice(0, kn);
      if (keep.t === 'dh') drop = order.slice(d.rolls.length - kn);
      for (const [, idx] of drop) d.rolls[idx].drop = true;
    }
    const live = d.rolls.filter((r) => !r.drop);
    if (cmp && cmp.n !== null) {
      const ok = (v) => (cmp.op === '>=' ? v >= cmp.n : cmp.op === '<=' ? v <= cmp.n : cmp.op === '>' ? v > cmp.n : v < cmp.n);
      for (const r of live) if (ok(r.v)) r.hit = true;
      d.value = live.filter((r) => r.hit).length;
      d.cmp = cmp.op + cmp.n;
    } else {
      d.value = live.reduce((a, r) => a + r.v, 0);
    }
    if (typeof sides === 'number') for (const r of d.rolls) { if (r.v === sides) r.max = true; if (r.v === 1) r.min = true; }
    d.label = `${n}d${sides === 100 ? '%' : sides}`;
    segs.push(d);
    return d.value;
  }

  const total = expr();
  if (i < src.length) throw new Error(`Não entendi “${src.slice(i)}”`);
  return { formula: String(input).trim(), total: Math.round(total * 100) / 100, segs };
}

// Substitui @Atributo / @{Nome com espaço} pelos valores da ficha
export function resolveRefs(formula, stats) {
  if (!stats) return formula;
  const map = {};
  for (const s of stats) if (s && s.label) map[norm(s.label)] = s.value;
  return formula.replace(/@\{([^}]+)\}(\.mod)?|@([\p{L}\w]+)(\.mod)?/gu, (m, a, am, b, bm) => {
    const v = map[norm(a || b)];
    let n = parseFloat(v);
    if (Number.isFinite(n) && (am || bm)) n = dndMod(n);
    return Number.isFinite(n) ? `(${n})` : '0';
  });
}
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');

// Modificador estilo D&D: 16 -> +3
export const dndMod = (score) => Math.floor((Number(score) - 10) / 2);
