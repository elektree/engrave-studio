import { MazeParams, MazeStyle, Canvas, Layer } from '../state/project';
import { svgEl } from '../utils/svg';
import { makeParamResolver } from './gradient';

function vertHash(gx: number, gy: number, seed: number, channel: number): number {
  let h = (seed + 0x9E3779B9) >>> 0;
  h = Math.imul(h ^ gx, 0x85EBCA6B) >>> 0;
  h = Math.imul(h ^ gy, 0xC2B2AE35) >>> 0;
  h = Math.imul(h ^ channel, 0x27D4EB2F) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Fractal noise — sum of value-noise octaves, each at half amplitude and double
// frequency. octaves=1 is plain value noise; higher values add fine detail on
// top of the base shape (and feel more "natural").
function fbm2D(x: number, y: number, seed: number, scale: number, octaves: number, evolution: number, channel: number): number {
  const oct = Math.max(1, Math.floor(octaves));
  // Evolution shifts the noise input; tiny perturbations produce visibly
  // different fields without changing the seed.
  const ex = x + evolution * scale * 0.37;
  const ey = y + evolution * scale * 0.71;
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let total = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * valueNoise2D(ex * freq, ey * freq, seed + i * 1009, scale, channel);
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / total;
}

// 2D value noise — smooth-interpolated grid hashes. Returns 0..1. The scale
// parameter sets the coherence wavelength: bigger scale = smoother, bigger blobs.
function valueNoise2D(x: number, y: number, seed: number, scale: number, channel: number): number {
  const s = Math.max(scale, 0.001);
  const sx = x / s;
  const sy = y / s;
  const xi = Math.floor(sx);
  const yi = Math.floor(sy);
  const xf = sx - xi;
  const yf = sy - yi;
  // Smoothstep for both axes.
  const ssx = xf * xf * (3 - 2 * xf);
  const ssy = yf * yf * (3 - 2 * yf);
  const v00 = vertHash(xi, yi, seed, channel);
  const v10 = vertHash(xi + 1, yi, seed, channel);
  const v01 = vertHash(xi, yi + 1, seed, channel);
  const v11 = vertHash(xi + 1, yi + 1, seed, channel);
  const a = v00 * (1 - ssx) + v10 * ssx;
  const b = v01 * (1 - ssx) + v11 * ssx;
  return a * (1 - ssy) + b * ssy;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Cell = { walls: [boolean, boolean, boolean, boolean]; visited: boolean }; // N, E, S, W

export function renderMaze(params: MazeParams, canvas: Canvas, layer?: Layer): SVGElement[] {
  if (params.cellShape === 'hex') return renderMazeHex(params, canvas, layer);
  return renderMazeSquare(params, canvas, layer);
}

function renderMazeSquare(params: MazeParams, canvas: Canvas, layer?: Layer): SVGElement[] {
  const { width: CW, height: CH } = canvas;
  const zoneW = params.zoneWidth > 0 ? params.zoneWidth : CW;
  const zoneH = params.zoneHeight > 0 ? params.zoneHeight : CH;
  const cell = Math.max(params.cellSize, 0.5);
  const nx = Math.max(1, Math.floor(zoneW / cell));
  const ny = Math.max(1, Math.floor(zoneH / cell));
  const ox = (zoneW - nx * cell) / 2;
  const oy = (zoneH - ny * cell) / 2;

  // Layer-level resolver — modulates organicAmount AND strokeWidth across the zone.
  const resolve = makeParamResolver(layer, zoneW, zoneH);
  // The master `organicAmount` is split into two sub-knobs: vertex displacement
  // and Catmull-Rom curvature. Each is a multiplier on top of organic.
  // organicAmount is the 0..1 master dial — kept clamped. The other knobs are
  // unbounded so the user can push them past 1 for stronger / weirder effects.
  const vertexK = Math.max(0, params.vertexPerturb);
  const curveK = Math.max(0, params.wallCurve);
  const organicAt = (x: number, y: number) =>
    Math.max(0, Math.min(1, resolve('organicAmount', params.organicAmount, x, y)));

  // ─ Carve passages (recursive backtracker) ────────────────
  const cells: Cell[][] = [];
  for (let y = 0; y < ny; y++) {
    cells[y] = [];
    for (let x = 0; x < nx; x++) {
      cells[y][x] = { walls: [true, true, true, true], visited: false };
    }
  }
  const rng = mulberry32(params.seed);
  const stack: [number, number][] = [[0, 0]];
  cells[0][0].visited = true;
  while (stack.length > 0) {
    const [cx, cy] = stack[stack.length - 1];
    const candidates: [number, number, number][] = [];
    if (cy > 0 && !cells[cy - 1][cx].visited) candidates.push([cx, cy - 1, 0]);
    if (cx < nx - 1 && !cells[cy][cx + 1].visited) candidates.push([cx + 1, cy, 1]);
    if (cy < ny - 1 && !cells[cy + 1][cx].visited) candidates.push([cx, cy + 1, 2]);
    if (cx > 0 && !cells[cy][cx - 1].visited) candidates.push([cx - 1, cy, 3]);
    if (candidates.length === 0) { stack.pop(); continue; }
    const [nxC, nyC, dir] = candidates[Math.floor(rng() * candidates.length)];
    cells[cy][cx].walls[dir] = false;
    cells[nyC][nxC].walls[(dir + 2) % 4] = false;
    cells[nyC][nxC].visited = true;
    stack.push([nxC, nyC]);
  }

  // ─ Perturbed corner positions ────────────────────────────
  // Interior vertices perturbed; boundary fixed (keeps maze inside the zone).
  const cornerCache = new Map<number, { x: number; y: number; org: number }>();
  const stride = nx + 1;
  const cornerOf = (gx: number, gy: number) => {
    const key = gy * stride + gx;
    const hit = cornerCache.get(key);
    if (hit) return hit;
    const baseX = ox + gx * cell;
    const baseY = oy + gy * cell;
    const boundary = gx === 0 || gx === nx || gy === 0 || gy === ny;
    const org = organicAt(baseX, baseY);
    if (boundary && !params.deformBorders) {
      const node = { x: baseX, y: baseY, org };
      cornerCache.set(key, node);
      return node;
    }
    // Vertex perturbation scales the master organicAmount by vertexPerturb.
    // FBM noise + an evolution offset replace the per-vertex hash so adjacent
    // corners move together — visually smooth flow instead of independent jitter.
    const range = cell * 0.45 * org * vertexK;
    const nx2 = fbm2D(baseX, baseY, params.seed, params.noiseScale, params.noiseOctaves, params.noiseEvolution, 0);
    const ny2 = fbm2D(baseX, baseY, params.seed, params.noiseScale, params.noiseOctaves, params.noiseEvolution, 1);
    const node = {
      x: baseX + (nx2 - 0.5) * 2 * range,
      y: baseY + (ny2 - 0.5) * 2 * range,
      org,
    };
    cornerCache.set(key, node);
    return node;
  };

  // ─ Eager corner precompute + optional Laplacian smoothing ─
  // Smoothing pulls each interior vertex toward the mean of its 4 grid neighbours
  // — a relaxation that softens jagged FBM perturbation without removing flow.
  for (let gy = 0; gy <= ny; gy++) {
    for (let gx = 0; gx <= nx; gx++) cornerOf(gx, gy);
  }
  const iters = Math.max(0, Math.round(params.vertexSmooth));
  // The actual smoothing now happens on the dense resampled polyline below —
  // see the per-path render loop. That way both corner positions AND the
  // intermediate Catmull-Rom samples get relaxed, which is what the user expects
  // (otherwise smoothing barely shifts coherent FBM corners).

  // ─ Build edge list & vertex incidences ────────────────────
  type Edge = { a: number; b: number };
  const edges: Edge[] = [];
  const vid = (gx: number, gy: number) => gy * stride + gx;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const c = cells[y][x];
      if (c.walls[0]) edges.push({ a: vid(x, y), b: vid(x + 1, y) });
      if (c.walls[3]) edges.push({ a: vid(x, y), b: vid(x, y + 1) });
      if (c.walls[1] && x === nx - 1) edges.push({ a: vid(x + 1, y), b: vid(x + 1, y + 1) });
      if (c.walls[2] && y === ny - 1) edges.push({ a: vid(x, y + 1), b: vid(x + 1, y + 1) });
    }
  }
  const incidence = new Map<number, number[]>();
  for (let i = 0; i < edges.length; i++) {
    const { a, b } = edges[i];
    if (!incidence.has(a)) incidence.set(a, []);
    if (!incidence.has(b)) incidence.set(b, []);
    incidence.get(a)!.push(i);
    incidence.get(b)!.push(i);
  }
  const degreeOf = (v: number) => incidence.get(v)?.length ?? 0;

  // ─ Decompose into polylines through degree-2 vertices ────
  // Paths terminate at vertices of degree 1 or ≥ 3 — those keep their original
  // sharp character; runs of degree-2 vertices form a single smooth curve.
  const visited = new Set<number>();
  const paths: number[][] = [];

  const walkFrom = (startVert: number, startEdge: number): number[] => {
    const path: number[] = [startVert];
    let curV = startVert;
    let curE = startEdge;
    while (true) {
      if (visited.has(curE)) break;
      visited.add(curE);
      const e = edges[curE];
      const next = e.a === curV ? e.b : e.a;
      path.push(next);
      if (degreeOf(next) !== 2) break;
      const adj = incidence.get(next) ?? [];
      const nextE = adj.find((ei) => ei !== curE && !visited.has(ei));
      if (nextE === undefined) break;
      curV = next;
      curE = nextE;
    }
    return path;
  };

  // Phase 1: paths starting at non-degree-2 vertices
  for (const [vert, adj] of incidence) {
    if (degreeOf(vert) === 2) continue;
    for (const ei of adj) {
      if (visited.has(ei)) continue;
      paths.push(walkFrom(vert, ei));
    }
  }
  // Phase 2: remaining closed loops (all degree-2)
  for (let i = 0; i < edges.length; i++) {
    if (visited.has(i)) continue;
    paths.push(walkFrom(edges[i].a, i));
  }

  // ─ Render each polyline as a Catmull-Rom blended cubic bezier ─
  const out = svgEl('g');
  const cap: MazeStyle = params.style;
  out.setAttribute('stroke', '#000');
  out.setAttribute('fill', 'none');
  out.setAttribute('stroke-linecap', cap === 'rounded' ? 'round' : 'square');
  out.setAttribute('stroke-linejoin', cap === 'rounded' ? 'round' : 'miter');
  const hasStrokeMod = !!(layer?.gradient.enabled && layer.mods.strokeWidth);
  // When no per-wall stroke modulation, set once on the parent so children inherit.
  if (!hasStrokeMod) out.setAttribute('stroke-width', String(params.strokeWidth));

  // Resampling density along each Catmull-Rom segment. Higher = smoother curves
  // and more points available for the Laplacian smoothing pass.
  const SAMPLES = 6;

  // Hermite/Catmull-Rom blended sampler. blend=0 → linear, blend=1 → CR tension 0.5.
  type Pt = { x: number; y: number; org: number };
  const sampleCR = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number, blend: number): Pt => {
    const lx = p1.x + t * (p2.x - p1.x);
    const ly = p1.y + t * (p2.y - p1.y);
    const org = (p1.org + p2.org) / 2;
    if (blend <= 0) return { x: lx, y: ly, org };
    const t2 = t * t;
    const t3 = t2 * t;
    const crX = 0.5 * (
      (2 * p1.x)
      + (-p0.x + p2.x) * t
      + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
      + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    );
    const crY = 0.5 * (
      (2 * p1.y)
      + (-p0.y + p2.y) * t
      + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
      + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );
    return { x: lx + (crX - lx) * blend, y: ly + (crY - ly) * blend, org };
  };

  // Points on the outer zone boundary stay fixed during smoothing when
  // deformBorders is off — that keeps the maze inside its zone.
  const eps = 0.001;
  const isBoundaryPt = (p: Pt): boolean => {
    if (params.deformBorders) return false;
    return p.x <= eps || p.x >= zoneW - eps || p.y <= eps || p.y >= zoneH - eps;
  };

  for (const vertPath of paths) {
    if (vertPath.length < 2) continue;
    const pts = vertPath.map((v) => {
      const gx = v % stride;
      const gy = Math.floor(v / stride);
      return cornerOf(gx, gy);
    });

    // 1. Build dense polyline by Catmull-Rom sampling per segment.
    const dense: Pt[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = i === 0 ? pts[0] : pts[i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = i === pts.length - 2 ? pts[pts.length - 1] : pts[i + 2];
      const blend = ((p1.org + p2.org) / 2) * curveK;
      for (let s = 1; s <= SAMPLES; s++) {
        dense.push(sampleCR(p0, p1, p2, p3, s / SAMPLES, blend));
      }
    }

    // 2. Per-point Laplacian smoothing. alpha = baseAlpha × local organic, so
    // smoothing follows the gradient modulation: zero-organic points stay put.
    const baseAlpha = 0.5;
    let cur: Pt[] = dense;
    for (let it = 0; it < iters; it++) {
      const next: Pt[] = [cur[0]];
      for (let j = 1; j < cur.length - 1; j++) {
        const p = cur[j];
        if (isBoundaryPt(p)) { next.push(p); continue; }
        const prev = cur[j - 1];
        const nxt = cur[j + 1];
        const a = baseAlpha * Math.max(0, Math.min(1, p.org));
        next.push({
          x: (1 - a) * p.x + a * (prev.x + nxt.x) / 2,
          y: (1 - a) * p.y + a * (prev.y + nxt.y) / 2,
          org: p.org,
        });
      }
      next.push(cur[cur.length - 1]);
      cur = next;
    }

    // 3. Emit as a polyline path.
    let d = `M ${cur[0].x} ${cur[0].y}`;
    for (let k = 1; k < cur.length; k++) d += ` L ${cur[k].x} ${cur[k].y}`;
    const attrs: Record<string, string | number> = { d };
    if (hasStrokeMod) {
      const mid = cur[Math.floor(cur.length / 2)];
      attrs['stroke-width'] = resolve('strokeWidth', params.strokeWidth, mid.x, mid.y);
    }
    out.appendChild(svgEl('path', attrs));
  }

  return [out];
}

// Pointy-top hex grid in odd-r offset coordinates.
function renderMazeHex(params: MazeParams, canvas: Canvas, layer?: Layer): SVGElement[] {
  const { width: CW, height: CH } = canvas;
  const zoneW = params.zoneWidth > 0 ? params.zoneWidth : CW;
  const zoneH = params.zoneHeight > 0 ? params.zoneHeight : CH;
  const R = Math.max(0.25, params.cellSize / 2);
  const hexW = Math.sqrt(3) * R;
  const hexH = 2 * R;
  const colSpacing = hexW;
  const rowSpacing = 1.5 * R;
  const nCols = Math.max(1, Math.floor((zoneW - hexW * 0.5) / colSpacing));
  const nRows = Math.max(1, Math.floor((zoneH - R * 0.5) / rowSpacing) + 1);
  const gridW = nCols * colSpacing + colSpacing * 0.5;
  const gridH = (nRows - 1) * rowSpacing + hexH;
  const padX = (zoneW - gridW) / 2 + hexW / 2;
  const padY = (zoneH - gridH) / 2 + R;

  const centre = (col: number, row: number) => ({
    x: padX + col * colSpacing + (row % 2 === 0 ? 0 : colSpacing / 2),
    y: padY + row * rowSpacing,
  });

  // 6 vertex offsets (pointy-top, vertex 0 = top, going clockwise)
  const va = [-90, -30, 30, 90, 150, 210].map((d) => (d * Math.PI) / 180);
  const voff = va.map((a) => ({ x: Math.cos(a) * R, y: Math.sin(a) * R }));

  // Wall directions: 0=NE, 1=E, 2=SE, 3=SW, 4=W, 5=NW (odd-r offset)
  const evenOff: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const oddOff: [number, number][] = [[1, -1], [1, 0], [1, 1], [0, 1], [-1, 0], [0, -1]];
  const neighbour = (col: number, row: number, k: number) => {
    const offs = row % 2 === 0 ? evenOff : oddOff;
    return { col: col + offs[k][0], row: row + offs[k][1] };
  };

  // Cells with 6 walls each (one per edge).
  type HexCell = { walls: boolean[]; visited: boolean };
  const cells: HexCell[][] = [];
  for (let r = 0; r < nRows; r++) {
    cells[r] = [];
    for (let c = 0; c < nCols; c++) {
      cells[r][c] = { walls: [true, true, true, true, true, true], visited: false };
    }
  }
  const rng = mulberry32(params.seed);
  const stack: [number, number][] = [[0, 0]];
  cells[0][0].visited = true;
  while (stack.length > 0) {
    const [cc, cr] = stack[stack.length - 1];
    const candidates: [number, number, number][] = [];
    for (let k = 0; k < 6; k++) {
      const n = neighbour(cc, cr, k);
      if (n.col < 0 || n.col >= nCols || n.row < 0 || n.row >= nRows) continue;
      if (cells[n.row][n.col].visited) continue;
      candidates.push([n.col, n.row, k]);
    }
    if (candidates.length === 0) { stack.pop(); continue; }
    const [nc, nr, dir] = candidates[Math.floor(rng() * candidates.length)];
    cells[cr][cc].walls[dir] = false;
    cells[nr][nc].walls[(dir + 3) % 6] = false;
    cells[nr][nc].visited = true;
    stack.push([nc, nr]);
  }

  const resolve = makeParamResolver(layer, zoneW, zoneH);
  const organicAt = (x: number, y: number) =>
    Math.max(0, Math.min(1, resolve('organicAmount', params.organicAmount, x, y)));
  const vertexK = Math.max(0, params.vertexPerturb);
  const curveK = Math.max(0, params.wallCurve);

  const perturb = (vx: number, vy: number) => {
    const onBoundary = vx <= R * 0.2 || vx >= zoneW - R * 0.2 || vy <= R * 0.2 || vy >= zoneH - R * 0.2;
    const org = organicAt(vx, vy);
    if (onBoundary && !params.deformBorders) return { x: vx, y: vy, org };
    const range = R * 0.9 * org * vertexK;
    const dx = (fbm2D(vx, vy, params.seed, params.noiseScale, params.noiseOctaves, params.noiseEvolution, 0) - 0.5) * 2 * range;
    const dy = (fbm2D(vx, vy, params.seed, params.noiseScale, params.noiseOctaves, params.noiseEvolution, 1) - 0.5) * 2 * range;
    return { x: vx + dx, y: vy + dy, org };
  };

  // Build wall edges as pairs of perturbed vertices. Shared corners (where up to
  // three hexes meet) are deduped via snapped base coordinates so the polyline
  // decomposition sees a single vertex with the right degree.
  type Pt = { x: number; y: number; org: number };
  const vertexMap = new Map<string, number>();
  const vertices: Pt[] = [];
  const vertexIdFor = (baseX: number, baseY: number): number => {
    const key = `${Math.round(baseX * 100)},${Math.round(baseY * 100)}`;
    const hit = vertexMap.get(key);
    if (hit !== undefined) return hit;
    const id = vertices.length;
    vertices.push(perturb(baseX, baseY));
    vertexMap.set(key, id);
    return id;
  };

  type Edge = { a: number; b: number };
  const edges: Edge[] = [];
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const ce = centre(c, r);
      const cell = cells[r][c];
      for (let k = 0; k < 6; k++) {
        if (!cell.walls[k]) continue;
        let render = k < 3;
        if (!render) {
          const n = neighbour(c, r, k);
          render = n.col < 0 || n.col >= nCols || n.row < 0 || n.row >= nRows;
        }
        if (!render) continue;
        const v1 = voff[k];
        const v2 = voff[(k + 1) % 6];
        edges.push({
          a: vertexIdFor(ce.x + v1.x, ce.y + v1.y),
          b: vertexIdFor(ce.x + v2.x, ce.y + v2.y),
        });
      }
    }
  }

  // Polyline decomposition through degree-2 vertices — identical to the square
  // path: this is what makes corner smoothing possible across walls.
  const incidence = new Map<number, number[]>();
  for (let i = 0; i < edges.length; i++) {
    const { a, b } = edges[i];
    if (!incidence.has(a)) incidence.set(a, []);
    if (!incidence.has(b)) incidence.set(b, []);
    incidence.get(a)!.push(i);
    incidence.get(b)!.push(i);
  }
  const degreeOf = (v: number) => incidence.get(v)?.length ?? 0;
  const visited = new Set<number>();
  const polys: number[][] = [];
  const walkFrom = (startV: number, startE: number): number[] => {
    const path: number[] = [startV];
    let curV = startV;
    let curE = startE;
    while (true) {
      if (visited.has(curE)) break;
      visited.add(curE);
      const e = edges[curE];
      const next = e.a === curV ? e.b : e.a;
      path.push(next);
      if (degreeOf(next) !== 2) break;
      const adj = incidence.get(next) ?? [];
      const nextE = adj.find((ei) => ei !== curE && !visited.has(ei));
      if (nextE === undefined) break;
      curV = next;
      curE = nextE;
    }
    return path;
  };
  for (const [vert, adj] of incidence) {
    if (degreeOf(vert) === 2) continue;
    for (const ei of adj) if (!visited.has(ei)) polys.push(walkFrom(vert, ei));
  }
  for (let i = 0; i < edges.length; i++) {
    if (!visited.has(i)) polys.push(walkFrom(edges[i].a, i));
  }

  const out = svgEl('g');
  out.setAttribute('stroke', '#000');
  out.setAttribute('fill', 'none');
  out.setAttribute('stroke-linecap', params.style === 'rounded' ? 'round' : 'square');
  out.setAttribute('stroke-linejoin', params.style === 'rounded' ? 'round' : 'miter');
  const hasStrokeMod = !!(layer?.gradient.enabled && layer.mods.strokeWidth);
  if (!hasStrokeMod) out.setAttribute('stroke-width', String(params.strokeWidth));

  const iters = Math.max(0, Math.round(params.vertexSmooth));
  const isBoundary = (p: { x: number; y: number }): boolean => {
    if (params.deformBorders) return false;
    const tol = R * 0.5;
    return p.x <= tol || p.x >= zoneW - tol || p.y <= tol || p.y >= zoneH - tol;
  };

  for (const idPath of polys) {
    if (idPath.length < 2) continue;
    const pts = idPath.map((id) => vertices[id]);
    const paths = renderSmoothedPolyline(pts, curveK, iters, isBoundary, hasStrokeMod, resolve, params.strokeWidth);
    for (const el of paths) out.appendChild(el);
  }
  return [out];
}

// Shared helper: densify a polyline with Catmull-Rom sampling (per-segment blend
// from organic), then run Laplacian smoothing iterations, then emit as a single
// polyline path. Used by both square and hex maze renderers.
function renderSmoothedPolyline(
  pts: { x: number; y: number; org: number }[],
  curveK: number,
  iters: number,
  isBoundary: (p: { x: number; y: number }) => boolean,
  hasStrokeMod: boolean,
  resolve: (key: string, scalar: number, x: number, y: number) => number,
  strokeWidth: number,
  samplesPerSegment = 6,
): SVGElement[] {
  if (pts.length < 2) return [];
  type Pt = { x: number; y: number; org: number };
  const sampleCR = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number, blend: number): Pt => {
    const lx = p1.x + t * (p2.x - p1.x);
    const ly = p1.y + t * (p2.y - p1.y);
    if (blend <= 0) return { x: lx, y: ly, org: (p1.org + p2.org) / 2 };
    const t2 = t * t;
    const t3 = t2 * t;
    const crX = 0.5 * (
      (2 * p1.x)
      + (-p0.x + p2.x) * t
      + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
      + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    );
    const crY = 0.5 * (
      (2 * p1.y)
      + (-p0.y + p2.y) * t
      + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
      + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );
    return {
      x: lx + (crX - lx) * blend,
      y: ly + (crY - ly) * blend,
      org: (p1.org + p2.org) / 2,
    };
  };

  const dense: Pt[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = i === 0 ? pts[0] : pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i === pts.length - 2 ? pts[pts.length - 1] : pts[i + 2];
    const blend = ((p1.org + p2.org) / 2) * curveK;
    for (let s = 1; s <= samplesPerSegment; s++) {
      dense.push(sampleCR(p0, p1, p2, p3, s / samplesPerSegment, blend));
    }
  }

  // Per-point alpha scaled by local organic — same idea as the square renderer.
  const baseAlpha = 0.5;
  let cur: Pt[] = dense;
  for (let it = 0; it < iters; it++) {
    const next: Pt[] = [cur[0]];
    for (let j = 1; j < cur.length - 1; j++) {
      const p = cur[j];
      if (isBoundary(p)) { next.push(p); continue; }
      const prev = cur[j - 1];
      const nxt = cur[j + 1];
      const a = baseAlpha * Math.max(0, Math.min(1, p.org));
      next.push({
        x: (1 - a) * p.x + a * (prev.x + nxt.x) / 2,
        y: (1 - a) * p.y + a * (prev.y + nxt.y) / 2,
        org: p.org,
      });
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }

  let d = `M ${cur[0].x} ${cur[0].y}`;
  for (let k = 1; k < cur.length; k++) d += ` L ${cur[k].x} ${cur[k].y}`;
  const attrs: Record<string, string | number> = { d };
  if (hasStrokeMod) {
    const mid = cur[Math.floor(cur.length / 2)];
    attrs['stroke-width'] = resolve('strokeWidth', strokeWidth, mid.x, mid.y);
  }
  return [svgEl('path', attrs)];
}

export function defaultMazeParams(canvas?: Canvas): MazeParams {
  return {
    cellSize: 4,
    strokeWidth: 0.3,
    style: 'square',
    cellShape: 'square',
    organicAmount: 0,
    vertexPerturb: 1,
    wallCurve: 1,
    noiseScale: 8,
    noiseOctaves: 1,
    noiseEvolution: 0,
    vertexSmooth: 0,
    deformBorders: false,
    seed: 1,
    zoneWidth: canvas?.width ?? 100,
    zoneHeight: canvas?.height ?? 35,
  };
}
