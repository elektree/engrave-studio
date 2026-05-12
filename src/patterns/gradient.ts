import { Layer } from '../state/project';

// A Resolver returns the effective value of a layer parameter at a point (x, y)
// in canvas/zone coordinates. When no modulation applies it returns the scalar.
//
// The gradient axis is anchored on the (W/2, H/2) centre of the layer's
// reference frame; projections fall in 0..1 across the diagonal. t0/t1 carve
// the active range; outside that range we clamp.
export type Resolver = (key: string, scalar: number, x: number, y: number) => number;

export function makeParamResolver(layer: Layer | undefined, W: number, H: number): Resolver {
  if (!layer || !layer.gradient.enabled) return (_k, s) => s;
  const { angle, t0, t1 } = layer.gradient;
  const ar = (angle * Math.PI) / 180;
  const cx = W / 2;
  const cy = H / 2;
  const axisLen = Math.hypot(W, H) || 1;
  // Allow t1 < t0 → inverted gradient. Only guard against the degenerate t0 == t1.
  const rawDenom = t1 - t0;
  const denom = Math.abs(rawDenom) < 1e-6 ? 1e-6 : rawDenom;
  return (key, scalar, x, y) => {
    const mod = layer.mods[key];
    if (!mod) return scalar;
    const proj = ((x - cx) * Math.cos(ar) + (y - cy) * Math.sin(ar)) / axisLen + 0.5;
    const ts = (proj - t0) / denom;
    const t = Math.max(0, Math.min(1, ts));
    return mod.min + (mod.max - mod.min) * t;
  };
}
