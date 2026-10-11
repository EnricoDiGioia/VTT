// Matemática de grid: quadrado e hexágono (pontudo em cima = hexH, chato em cima = hexV).
const SQ3 = Math.sqrt(3);

export function cellSize(g) { return Math.max(8, Number(g?.size) || 70); }

function hexRound(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return [rx, rz];
}

export function pixelToHex(g, x, y) {
  const r = cellSize(g) / SQ3;
  x -= g.ox || 0; y -= g.oy || 0;
  if (g.type === 'hexV') return hexRound((2 / 3 * x) / r, (-1 / 3 * x + SQ3 / 3 * y) / r);
  return hexRound((SQ3 / 3 * x - 1 / 3 * y) / r, (2 / 3 * y) / r);
}
export function hexToPixel(g, q, rr) {
  const r = cellSize(g) / SQ3;
  if (g.type === 'hexV') return [r * 1.5 * q + (g.ox || 0), r * (SQ3 / 2 * q + SQ3 * rr) + (g.oy || 0)];
  return [r * (SQ3 * q + SQ3 / 2 * rr) + (g.ox || 0), r * 1.5 * rr + (g.oy || 0)];
}

// Encaixa um ponto (centro de token de tamanho `n` células) no grid
export function snap(g, x, y, n = 1) {
  if (!g || g.type === 'none') return [x, y];
  const s = cellSize(g);
  if (g.type === 'square') {
    const ox = g.ox || 0, oy = g.oy || 0;
    const odd = Math.round(n) % 2 === 1 || n < 1;
    const off = odd ? 0.5 : 0;
    return [ox + (Math.round((x - ox) / s - off) + off) * s, oy + (Math.round((y - oy) / s - off) + off) * s];
  }
  const [q, r] = pixelToHex(g, x, y);
  return hexToPixel(g, q, r);
}

// Encaixa em interseções (cantos) — usado para retângulos de névoa
export function snapCorner(g, x, y) {
  if (!g || g.type !== 'square') return [x, y];
  const s = cellSize(g), ox = g.ox || 0, oy = g.oy || 0;
  return [ox + Math.round((x - ox) / s) * s, oy + Math.round((y - oy) / s) * s];
}

// Distância em células entre dois pontos
export function cellDistance(g, x1, y1, x2, y2) {
  const s = cellSize(g);
  if (g && (g.type === 'hexH' || g.type === 'hexV')) {
    const [q1, r1] = pixelToHex(g, x1, y1), [q2, r2] = pixelToHex(g, x2, y2);
    const dq = q2 - q1, dr = r2 - r1;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
  }
  const dx = Math.abs(x2 - x1) / s, dy = Math.abs(y2 - y1) / s;
  const diag = g?.diag || '5e';
  if (g?.type === 'none' || diag === 'euclid') return Math.hypot(dx, dy);
  const a = Math.round(dx), b = Math.round(dy);
  if (diag === 'alt') return Math.max(a, b) + Math.floor(Math.min(a, b) / 2);
  return Math.max(a, b);
}

export function distanceLabel(g, x1, y1, x2, y2) {
  const c = cellDistance(g, x1, y1, x2, y2);
  const per = Number(g?.per) || 1;
  const v = Math.round(c * per * 10) / 10;
  return `${String(v).replace('.', ',')} ${g?.unit || ''}`.trim();
}

// Desenha o grid na área visível (coordenadas do mundo)
export function drawGrid(ctx, g, view, z) {
  if (!g || g.type === 'none') return;
  const s = cellSize(g);
  if (s * z < 6) return; // muito afastado: não vale a pena
  ctx.save();
  ctx.strokeStyle = g.color || '#000';
  ctx.globalAlpha = Math.max(0, Math.min(1, g.opacity ?? 0.35));
  ctx.lineWidth = 1 / z;
  ctx.beginPath();
  const { x0, y0, x1, y1 } = view;
  if (g.type === 'square') {
    const ox = g.ox || 0, oy = g.oy || 0;
    for (let x = ox + Math.floor((x0 - ox) / s) * s; x <= x1; x += s) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = oy + Math.floor((y0 - oy) / s) * s; y <= y1; y += s) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  } else {
    const r = s / SQ3;
    const cells = ((x1 - x0) / s) * ((y1 - y0) / s);
    if (cells > 6000) { ctx.restore(); return; }
    const corners = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i + (g.type === 'hexV' ? 0 : 30));
      corners.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    const [qa, ra] = pixelToHex(g, x0, y0), [qb, rb] = pixelToHex(g, x1, y1);
    const [qc, rc] = pixelToHex(g, x1, y0), [qd, rd] = pixelToHex(g, x0, y1);
    const qmin = Math.min(qa, qb, qc, qd) - 1, qmax = Math.max(qa, qb, qc, qd) + 1;
    const rmin = Math.min(ra, rb, rc, rd) - 1, rmax = Math.max(ra, rb, rc, rd) + 1;
    for (let q = qmin; q <= qmax; q++) {
      for (let rr = rmin; rr <= rmax; rr++) {
        const [cx, cy] = hexToPixel(g, q, rr);
        if (cx < x0 - s || cx > x1 + s || cy < y0 - s || cy > y1 + s) continue;
        // desenha só 3 arestas por hex (evita linhas duplicadas)
        ctx.moveTo(cx + corners[5][0], cy + corners[5][1]);
        for (let i = 0; i < 3; i++) ctx.lineTo(cx + corners[i][0], cy + corners[i][1]);
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

// Distância de um caminho com vários pontos [x0,y0,x1,y1,...] em células.
// Na regra 1-2-1 a contagem de diagonais continua de um trecho para o outro.
export function pathCells(g, pts) {
  let total = 0, diag = 0, straight = 0;
  const alt = g && g.type === 'square' && g.diag === 'alt';
  const s = cellSize(g);
  for (let i = 2; i + 1 < pts.length; i += 2) {
    if (alt) {
      const a = Math.round(Math.abs(pts[i] - pts[i - 2]) / s), b = Math.round(Math.abs(pts[i + 1] - pts[i - 1]) / s);
      diag += Math.min(a, b); straight += Math.max(a, b) - Math.min(a, b);
    } else total += cellDistance(g, pts[i - 2], pts[i - 1], pts[i], pts[i + 1]);
  }
  return alt ? straight + diag + Math.floor(diag / 2) : total;
}
export function cellsLabel(g, c) {
  const per = Number(g?.per) || 1;
  const v = Math.round(c * per * 10) / 10;
  return `${String(v).replace('.', ',')} ${g?.unit || ''}`.trim();
}
