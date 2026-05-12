import { ScatterParams, Canvas, Layer } from '../state/project';
import { svgEl, path, circle } from '../utils/svg';
import { CustomShape, instantiateCustomShape } from '../state/shape-registry';
import { makeParamResolver } from './gradient';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Parse the SVG text stored on a scatter layer into a CustomShape template the
// renderer can clone for each placed element. Cached per render call only.
// `preserveColours` keeps the user's original stroke/fill (no forceStroke pass).
function buildCustomShape(svgText: string, preserveColours: boolean): CustomShape | null {
  if (!svgText) return null;
  try {
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = parsed.documentElement;
    if (!(root instanceof SVGSVGElement)) return null;
    const vbAttr = root.getAttribute('viewBox');
    let vb = { x: 0, y: 0, w: 100, h: 100 };
    if (vbAttr) {
      const parts = vbAttr.split(/\s+|,/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        vb = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
      }
    } else {
      const w = parseFloat(root.getAttribute('width') ?? '100') || 100;
      const h = parseFloat(root.getAttribute('height') ?? '100') || 100;
      vb = { x: 0, y: 0, w, h };
    }
    const template = document.createElementNS(SVG_NS, 'g');
    for (const child of Array.from(root.children) as SVGElement[]) {
      const tag = child.nodeName.toLowerCase();
      if (tag === 'title' || tag === 'desc' || tag === 'metadata' || tag === 'defs') continue;
      template.appendChild(child.cloneNode(true) as SVGElement);
    }
    // Tag the template so instantiateCustomShape can skip the forceStroke pass
    // when the user wants to keep the source SVG's own colours / strokes.
    if (preserveColours) template.setAttribute('data-preserve-colours', 'true');
    return { id: 'inline', name: 'inline', template, vb };
  } catch {
    return null;
  }
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
): SVGElement {
  if (shape === 'custom') {
    if (customShape) return instantiateCustomShape(customShape, cx, cy, size, rot, sw);
    return circle(cx, cy, size / 2, sw);
  }
  const r = size / 2;
  switch (shape) {
    case 'circle':
      return circle(cx, cy, r, sw);
    case 'star': {
      const points: string[] = [];
      const n = 5;
      for (let i = 0; i < n * 2; i++) {
        const ang = (rot * Math.PI) / 180 + (i * Math.PI) / n - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        points.push(`${cx + Math.cos(ang) * rr},${cy + Math.sin(ang) * rr}`);
      }
      return svgEl('polygon', { points: points.join(' '), stroke: '#000', 'stroke-width': sw, fill: 'none' });
    }
    case 'flower': {
      // 6 petals as small circles around the center
      const g = svgEl('g');
      const k = 6;
      for (let i = 0; i < k; i++) {
        const ang = (rot * Math.PI) / 180 + (i * Math.PI * 2) / k;
        g.appendChild(circle(cx + Math.cos(ang) * r * 0.5, cy + Math.sin(ang) * r * 0.5, r * 0.5, sw));
      }
      g.appendChild(circle(cx, cy, r * 0.25, sw));
      return g;
    }
    case 'rune': {
      // A simple cross with serifs — feels rune-ish
      const cosA = Math.cos((rot * Math.PI) / 180);
      const sinA = Math.sin((rot * Math.PI) / 180);
      const p = (x: number, y: number) => `${cx + x * cosA - y * sinA} ${cy + x * sinA + y * cosA}`;
      const d = `M ${p(-r, 0)} L ${p(r, 0)} M ${p(0, -r)} L ${p(0, r)} M ${p(-r * 0.6, -r)} L ${p(r * 0.6, -r)} M ${p(-r * 0.6, r)} L ${p(r * 0.6, r)}`;
      return path(d, sw);
    }
  }
  // Fallback for any shape not handled above (e.g., stale `custom:` ids).
  return circle(cx, cy, r, sw);
}

export function renderScatter(params: ScatterParams, canvas: Canvas, layer?: Layer): SVGElement[] {
  // Generation happens inside the zone (defaults to canvas size). Layer offset
  // positions the zone in canvas coordinates.
  const zw = params.zoneWidth > 0 ? params.zoneWidth : canvas.width;
  const zh = params.zoneHeight > 0 ? params.zoneHeight : canvas.height;
  const rng = mulberry32(params.seed);
  const margin = Math.max(params.maxSize / 2, 1);
  const resolve = makeParamResolver(layer, zw, zh);
  const customShape = params.shape === 'custom'
    ? buildCustomShape(params.customSvg, !params.customForceStroke)
    : null;
  const g = svgEl('g');
  const isModulatedDensity = !!(layer?.gradient.enabled && layer.mods.density);
  const peakDensity = isModulatedDensity
    ? Math.max(layer!.mods.density.min, layer!.mods.density.max)
    : params.density;
  const candidates = Math.max(0, Math.round((peakDensity * zw) / 100));
  for (let i = 0; i < candidates; i++) {
    const x = margin + rng() * (zw - margin * 2);
    const y = margin + rng() * (zh - margin * 2);
    if (isModulatedDensity) {
      const localDensity = resolve('density', params.density, x, y);
      if (rng() > localDensity / Math.max(peakDensity, 1e-6)) continue;
    }
    const minS = Math.max(0.1, resolve('minSize', params.minSize, x, y));
    const maxS = Math.max(minS, resolve('maxSize', params.maxSize, x, y));
    const size = minS + rng() * (maxS - minS);
    const rot = (rng() - 0.5) * 2 * params.rotationJitter;
    const sw = Math.max(0.01, resolve('strokeWidth', params.strokeWidth, x, y));
    g.appendChild(shapePath(params.shape, x, y, size, rot, sw, customShape));
  }
  return [g];
}
