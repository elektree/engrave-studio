import { ScatterParams, Project, Layer, PaletteEntry } from '../state/project';
import { svgEl, path, readSvgViewBox } from '../utils/svg';
import { CustomShape, instantiateCustomShape } from '../state/shape-registry';
import { makeParamResolver } from './gradient';
import { buildGradientColorMap, colorForDepth } from '../utils/palette';
import { applySvgSourceColors } from './svg-layer';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Parse the user-uploaded SVG and run it through the same source-colour
// pipeline as the SVG layer with default options (depthForBlack=1,
// depthForWhite=0). The scatter's own `outlined` flag controls the
// fill-vs-stroke output. Resulting template has colours baked in — the
// per-instance step just clones + transforms.
//
// Memoised on the input tuple: a typical render keeps these inputs stable
// while the user tweaks density/seed/etc., so re-parsing the whole SVG on
// every store update is pure waste.
let customShapeCache: {
  key: string;
  palette: PaletteEntry[];
  shape: CustomShape | null;
} | null = null;
function buildCustomShape(svgText: string, outlined: boolean, strokeWidth: number, palette: PaletteEntry[]): CustomShape | null {
  if (!svgText) return null;
  const key = `${outlined}|${strokeWidth}|${svgText}`;
  if (customShapeCache && customShapeCache.key === key && customShapeCache.palette === palette) {
    return customShapeCache.shape;
  }
  let shape: CustomShape | null = null;
  try {
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root instanceof SVGSVGElement) {
      const vb = readSvgViewBox(root);
      // Gradient lookup table needs the original <defs> in the parsed root.
      const gradients = buildGradientColorMap(root);
      const template = document.createElementNS(SVG_NS, 'g');
      for (const child of Array.from(root.children) as SVGElement[]) {
        const tag = child.nodeName.toLowerCase();
        if (tag === 'title' || tag === 'desc' || tag === 'metadata' || tag === 'defs') continue;
        template.appendChild(child.cloneNode(true) as SVGElement);
      }
      const opts = { outlined, depthForBlack: 1, depthForWhite: 0 };
      const fallback = colorForDepth(opts.depthForBlack, palette);
      applySvgSourceColors(template, strokeWidth, opts, palette, fallback, gradients);
      shape = { id: 'inline', name: 'inline', template, vb };
    }
  } catch { /* parse failure → cache the null result so we don't retry */ }
  customShapeCache = { key, palette, shape };
  return shape;
}

// Mulberry32 PRNG — small, deterministic, seedable
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shapePath(
  shape: ScatterParams['shape'],
  cx: number, cy: number, size: number, rot: number, sw: number,
  customShape?: CustomShape | null,
  color: string = '#000',
  outlined: boolean = false,
): SVGElement {
  if (shape === 'custom') {
    if (customShape) return instantiateCustomShape(customShape, cx, cy, size, rot);
    return paintCircle(cx, cy, size / 2, sw, color, outlined);
  }
  const r = size / 2;
  switch (shape) {
    case 'circle':
      return paintCircle(cx, cy, r, sw, color, outlined);
    case 'star': {
      const points: string[] = [];
      const n = 5;
      for (let i = 0; i < n * 2; i++) {
        const ang = (rot * Math.PI) / 180 + (i * Math.PI) / n - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        points.push(`${cx + Math.cos(ang) * rr},${cy + Math.sin(ang) * rr}`);
      }
      return svgEl('polygon', { points: points.join(' '), ...paintAttrs(color, sw, outlined) });
    }
    case 'flower': {
      // 6 petals as small circles around the center.
      const g = svgEl('g');
      const k = 6;
      for (let i = 0; i < k; i++) {
        const ang = (rot * Math.PI) / 180 + (i * Math.PI * 2) / k;
        g.appendChild(paintCircle(cx + Math.cos(ang) * r * 0.5, cy + Math.sin(ang) * r * 0.5, r * 0.5, sw, color, outlined));
      }
      g.appendChild(paintCircle(cx, cy, r * 0.25, sw, color, outlined));
      return g;
    }
    case 'rune': {
      // Open path — only meaningful as outlines. `outlined` ignored.
      const cosA = Math.cos((rot * Math.PI) / 180);
      const sinA = Math.sin((rot * Math.PI) / 180);
      const p = (x: number, y: number) => `${cx + x * cosA - y * sinA} ${cy + x * sinA + y * cosA}`;
      const d = `M ${p(-r, 0)} L ${p(r, 0)} M ${p(0, -r)} L ${p(0, r)} M ${p(-r * 0.6, -r)} L ${p(r * 0.6, -r)} M ${p(-r * 0.6, r)} L ${p(r * 0.6, r)}`;
      return path(d, sw, color);
    }
  }
  return paintCircle(cx, cy, r, sw, color, outlined);
}

function paintAttrs(color: string, sw: number, outlined: boolean): Record<string, string | number> {
  return outlined
    ? { stroke: color, 'stroke-width': sw, fill: 'none' }
    : { fill: color, stroke: 'none' };
}

function paintCircle(cx: number, cy: number, r: number, sw: number, color: string, outlined: boolean): SVGElement {
  return svgEl('circle', { cx, cy, r, ...paintAttrs(color, sw, outlined) });
}

type Pt = { x: number; y: number };

// Bridson's Poisson-disk sampling — produces points that are evenly spaced
// (no two within `minDist`) with the natural "blue noise" feel. `safetyCap`
// is an upper bound on placed points to prevent runaway growth when the
// caller asks for very tight spacing in a very big zone.
function poissonSaturate(
  width: number, height: number, minDist: number, rng: () => number,
  maxAttempts: number, safetyCap: number,
): Pt[] {
  const out: Pt[] = [];
  if (width <= 0 || height <= 0 || minDist <= 0) return out;
  const cellSize = minDist / Math.SQRT2;
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const grid: (Pt | null)[] = new Array(cols * rows).fill(null);
  const active: Pt[] = [];
  const minSq = minDist * minDist;
  const idx = (gx: number, gy: number) => gy * cols + gx;
  const fits = (p: Pt): boolean => {
    if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) return false;
    const gx = Math.floor(p.x / cellSize);
    const gy = Math.floor(p.y / cellSize);
    for (let yy = Math.max(0, gy - 2); yy <= Math.min(rows - 1, gy + 2); yy++) {
      for (let xx = Math.max(0, gx - 2); xx <= Math.min(cols - 1, gx + 2); xx++) {
        const n = grid[idx(xx, yy)];
        if (!n) continue;
        const dx = p.x - n.x, dy = p.y - n.y;
        if (dx * dx + dy * dy < minSq) return false;
      }
    }
    return true;
  };
  const place = (p: Pt): void => {
    const gx = Math.floor(p.x / cellSize);
    const gy = Math.floor(p.y / cellSize);
    grid[idx(gx, gy)] = p;
    active.push(p);
    out.push(p);
  };
  place({ x: rng() * width, y: rng() * height });
  while (active.length > 0 && out.length < safetyCap) {
    const ai = Math.floor(rng() * active.length);
    const c = active[ai];
    let placed = false;
    for (let k = 0; k < maxAttempts; k++) {
      const a = rng() * 2 * Math.PI;
      const r = minDist * (1 + rng());
      const p = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
      if (fits(p)) { place(p); placed = true; break; }
    }
    if (!placed) active.splice(ai, 1);
  }
  return out;
}

// Distribute up to `target` points evenly across the zone, respecting
// `minDist`. Bridson is run to *natural* saturation (the whole zone fills up
// with the minimum-spacing constraint) before sub-sampling — capping it
// early would cluster the result around the seed because Bridson grows
// outward from there.
function poissonDistribute(
  width: number, height: number, minDist: number, rng: () => number,
  target: number, maxAttempts = 30,
): Pt[] {
  if (target <= 0) return [];
  // Cap at ~3× target: enough spatial coverage for partial Fisher-Yates to
  // give a uniform subsample without burning cycles on a fully saturated
  // pool we'd just throw away. Still bounded by the theoretical max (so we
  // don't request more than physics allows for the spacing constraint) and
  // an absolute ceiling for degenerate inputs.
  const theoretical = Math.ceil(width * height * 2 * Math.sqrt(3) / (Math.PI * minDist * minDist));
  const safetyCap = Math.min(50000, Math.max(target * 3, 1000), theoretical + 200);
  const all = poissonSaturate(width, height, minDist, rng, maxAttempts, safetyCap);
  if (all.length <= target) return all;
  // Partial Fisher–Yates: shuffle just enough to pick `target` entries
  // uniformly from the saturated pool.
  const pool = all.slice();
  for (let i = 0; i < target; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, target);
}

export function renderScatter(params: ScatterParams, project: Project, layer: Layer): SVGElement[] {
  // Generation happens inside the zone (defaults to canvas size). Layer offset
  // positions the zone in canvas coordinates.
  const canvas = project.canvas;
  const palette = project.palette;
  const baseDepth = layer.depth;
  const zw = params.zoneWidth > 0 ? params.zoneWidth : canvas.width;
  const zh = params.zoneHeight > 0 ? params.zoneHeight : canvas.height;
  const rng = mulberry32(params.seed);
  // Shape centres land anywhere in the zone; near-edge shapes may extend a
  // touch beyond it (use a smaller zoneWidth/Height for strict containment).
  const margin = 0;
  const resolve = makeParamResolver(layer, zw, zh);
  const customShape = params.shape === 'custom'
    ? buildCustomShape(params.customSvg, params.outlined, params.strokeWidth, palette)
    : null;
  const g = svgEl('g');
  // density (items per 100 mm of width) sets the cap. Bridson saturates the
  // zone with `minDistance` spacing, then we sub-sample down to this target
  // so coverage stays uniform regardless of how dense the user picks.
  const target = Math.max(0, Math.round(params.density * zw / 100));
  const minDist = Math.max(0.1, params.minDistance);
  const innerW = Math.max(0, zw - 2 * margin);
  const innerH = Math.max(0, zh - 2 * margin);
  const points = poissonDistribute(innerW, innerH, minDist, rng, target);
  // densityFactor is a per-point keep probability applied *after* the spatial
  // distribution. Gradient modulation on it lets the user thin the scatter
  // smoothly across the zone without touching spacing.
  //
  // Determinism: every point consumes the same number of rng() draws (one
  // for keep, one for size, one for rotation) whether it survives or not.
  // That keeps the per-point properties stable as the user tweaks the
  // factor — the same star at the same position keeps the same size and
  // rotation regardless of how many of its neighbours get culled.
  for (const p of points) {
    const x = margin + p.x;
    const y = margin + p.y;
    const keepRoll = rng();
    const sizeRoll = rng();
    const rotRoll = rng();
    const localFactor = Math.max(0, Math.min(1, resolve('densityFactor', params.densityFactor, x, y)));
    if (keepRoll >= localFactor) continue;
    const minS = Math.max(0.1, resolve('minSize', params.minSize, x, y));
    const maxS = Math.max(minS, resolve('maxSize', params.maxSize, x, y));
    const size = minS + sizeRoll * (maxS - minS);
    const rot = (rotRoll - 0.5) * 2 * params.rotationJitter;
    const sw = Math.max(0.01, resolve('strokeWidth', params.strokeWidth, x, y));
    const color = colorForDepth(resolve('depth', baseDepth, x, y), palette);
    g.appendChild(shapePath(params.shape, x, y, size, rot, sw, customShape, color, params.outlined));
  }
  return [g];
}
