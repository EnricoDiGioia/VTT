// Visão dinâmica: calcula o que cada luz enxerga, bloqueada pelas paredes (raios a partir da luz).
// Só recalcula quando um token com luz, uma parede ou uma porta muda.

// Paredes viram segmentos [x1, y1, x2, y2]; portas abertas não bloqueiam.
export function wallSegments(walls) {
  const segs = [];
  for (const k in walls) {
    const w = walls[k];
    if (!w?.pts || (w.door && w.open)) continue;
    const p = w.pts;
    for (let i = 2; i + 1 < p.length; i += 2) segs.push([p[i - 2], p[i - 1], p[i], p[i + 1]]);
  }
  return segs;
}

// raio da origem (ox,oy) com direção (dx,dy) (já no tamanho do alcance): fração até a parede mais próxima
function cast(ox, oy, dx, dy, segs) {
  let best = 1;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const sx = s[2] - s[0], sy = s[3] - s[1];
    const den = dx * sy - dy * sx;
    if (den > -1e-9 && den < 1e-9) continue;
    const ax = s[0] - ox, ay = s[1] - oy;
    const t = (ax * sy - ay * sx) / den;
    if (t <= 0 || t >= best) continue;
    const u = (ax * dy - ay * dx) / den;
    if (u >= 0 && u <= 1) best = t;
  }
  return best;
}

// Polígono visível a partir de (lx,ly) até o alcance R. Retorna [x0,y0,x1,y1,...].
export function visibilityPolygon(lx, ly, R, allSegs) {
  // só as paredes perto da luz
  const segs = allSegs.filter((s) => !(Math.max(s[0], s[2]) < lx - R || Math.min(s[0], s[2]) > lx + R || Math.max(s[1], s[3]) < ly - R || Math.min(s[1], s[3]) > ly + R));
  const angles = [];
  const N = 72;
  for (let i = 0; i < N; i++) angles.push((i / N) * Math.PI * 2 - Math.PI);
  const R2 = R * R * 2.1;
  for (const s of segs) {
    for (const [x, y] of [[s[0], s[1]], [s[2], s[3]]]) {
      const dx = x - lx, dy = y - ly;
      if (dx * dx + dy * dy > R2) continue;
      const a = Math.atan2(dy, dx);
      angles.push(a - 0.00015, a, a + 0.00015);
    }
  }
  angles.sort((a, b) => a - b);
  const out = [];
  let last = null;
  for (const a of angles) {
    if (last !== null && a - last < 1e-6) continue;
    last = a;
    const dx = Math.cos(a) * R, dy = Math.sin(a) * R;
    const t = segs.length ? cast(lx, ly, dx, dy, segs) : 1;
    out.push(lx + dx * t, ly + dy * t);
  }
  return out;
}

// Cache por luz: só recalcula a luz que mudou de lugar/alcance ou quando as paredes mudam.
export function createVisionCache() {
  let wallsKey = '';
  let segs = [];
  const polys = new Map(); // id -> { key, poly }
  return {
    compute(lights, walls, wallsVersion) {
      if (wallsVersion !== wallsKey) { wallsKey = wallsVersion; segs = wallSegments(walls); polys.clear(); }
      const out = [];
      const seen = new Set();
      for (const L of lights) {
        seen.add(L.id);
        const key = `${Math.round(L.x)},${Math.round(L.y)},${Math.round(L.R)}`;
        let c = polys.get(L.id);
        if (!c || c.key !== key) { c = { key, poly: visibilityPolygon(L.x, L.y, L.R, segs) }; polys.set(L.id, c); }
        out.push({ ...L, poly: c.poly });
      }
      for (const k of polys.keys()) if (!seen.has(k)) polys.delete(k);
      return out;
    },
    reset() { wallsKey = ''; polys.clear(); },
  };
}

// distância de um ponto a um segmento (para clicar em paredes)
export function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
