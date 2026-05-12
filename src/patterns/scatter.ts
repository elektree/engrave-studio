import { ScatterParams, Canvas } from '../state/project';
import { svgEl, path, circle } from '../utils/svg';

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

function shapePath(shape: ScatterParams['shape'], cx: number, cy: number, size: number, rot: number, sw: number): SVGElement {
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
}

export function renderScatter(params: ScatterParams, canvas: Canvas): SVGElement[] {
  const { width: W, height: H } = canvas;
  const rng = mulberry32(params.seed);
  const count = Math.max(0, Math.round((params.density * W) / 100));
  const margin = Math.max(params.maxSize / 2, 1);
  const g = svgEl('g');
  for (let i = 0; i < count; i++) {
    const x = margin + rng() * (W - margin * 2);
    const y = margin + rng() * (H - margin * 2);
    const size = params.minSize + rng() * (params.maxSize - params.minSize);
    const rot = (rng() - 0.5) * 2 * params.rotationJitter;
    g.appendChild(shapePath(params.shape, x, y, size, rot, params.strokeWidth));
  }
  return [g];
}
