import type { PaletteEntry } from '../state/project';

// Returns the palette entry whose value is closest to `depth`. Tie-break by the
// entry encountered first in the array — combined with the editor's ascending
// sort, this maps a tie down to the lower value (deterministic).
export function snapToPalette(depth: number, palette: PaletteEntry[]): PaletteEntry {
  if (palette.length === 0) throw new Error('Palette must have at least 1 entry');
  let best = palette[0];
  let bestDist = Math.abs(palette[0].value - depth);
  for (let i = 1; i < palette.length; i++) {
    const d = Math.abs(palette[i].value - depth);
    if (d < bestDist) { best = palette[i]; bestDist = d; }
  }
  return best;
}

export function colorForDepth(depth: number, palette: PaletteEntry[]): string {
  return snapToPalette(depth, palette).color;
}

// Parses common CSS color forms — hex (#rgb, #rrggbb), rgb(), rgba(). Returns
// null for anything else (gradients, "none", currentColor, named colors we
// don't recognise). Stays small on purpose; expand as patterns hit it.
export function parseColor(input: string): { r: number; g: number; b: number; a: number } | null {
  const s = input.trim().toLowerCase();
  if (!s || s === 'none' || s === 'currentcolor' || s === 'transparent') return null;
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length === 6 && /^[0-9a-f]{6}$/.test(h)) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: 1,
      };
    }
    if (h.length === 8 && /^[0-9a-f]{8}$/.test(h)) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: parseInt(h.slice(6, 8), 16) / 255,
      };
    }
    return null;
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) {
    const r = Math.round(parseFloat(m[1]));
    const g = Math.round(parseFloat(m[2]));
    const b = Math.round(parseFloat(m[3]));
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    if ([r, g, b].every((n) => Number.isFinite(n))) return { r, g, b, a };
  }
  return null;
}

function toHex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}
function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

// Rec.709 luminance, normalised to [0, 1]. Accepts any color parseColor handles;
// returns 0 for anything else (including unrecognised inputs).
export function luminance(input: string): number {
  const c = parseColor(input);
  if (!c) return 0;
  return 0.2126 * (c.r / 255) + 0.7152 * (c.g / 255) + 0.0722 * (c.b / 255);
}

// Maps a source luminance to a depth between `depthForBlack` (lum=0) and
// `depthForWhite` (lum=1). To invert the mapping (light → deep), swap the two
// values. Result clamped to [0, 1].
export function remapLuminance(lum: number, depthForBlack: number, depthForWhite: number): number {
  const l = Math.max(0, Math.min(1, lum));
  const v = depthForBlack + l * (depthForWhite - depthForBlack);
  return Math.max(0, Math.min(1, v));
}

// Walk an SVG's <defs> and build a gradient-id → averaged-hex-color map. Used
// when the layer's source SVG paints with `fill="url(#some-grad)"`. The avg
// weights each stop by its alpha so transparent stops contribute less.
export function buildGradientColorMap(svg: SVGSVGElement): Map<string, string> {
  const map = new Map<string, string>();
  const grads = svg.querySelectorAll('linearGradient, radialGradient');
  grads.forEach((g) => {
    const id = g.getAttribute('id');
    if (!id) return;
    let stops: Element[] = Array.from(g.querySelectorAll('stop'));
    // Gradients can chain via xlink:href / href — follow one level so we pick
    // up stops defined on a referenced sibling.
    if (stops.length === 0) {
      const ref = g.getAttribute('xlink:href') || g.getAttribute('href');
      if (ref && ref.startsWith('#')) {
        const tgt = svg.querySelector(ref);
        if (tgt) stops = Array.from(tgt.querySelectorAll('stop'));
      }
    }
    if (stops.length === 0) return;
    let r = 0, gC = 0, b = 0, totalA = 0;
    for (const stop of stops) {
      const color = stop.getAttribute('stop-color') ?? '#000';
      const opacityAttr = stop.getAttribute('stop-opacity');
      const a = opacityAttr !== null ? parseFloat(opacityAttr) : 1;
      const parsed = parseColor(color);
      if (!parsed) continue;
      r += parsed.r * a;
      gC += parsed.g * a;
      b += parsed.b * a;
      totalA += a;
    }
    if (totalA <= 0) return;
    map.set(id, rgbToHex(r / totalA, gC / totalA, b / totalA));
  });
  return map;
}

// Resolves a fill/stroke attribute to a flat hex color. `url(#id)` references
// look up the averaged gradient color; everything else round-trips parseColor.
// Returns null when no usable color can be derived.
export function resolveColorAttr(attr: string | null, gradients: Map<string, string>): string | null {
  if (!attr || attr === 'none') return null;
  const m = attr.match(/^url\(#([^)]+)\)$/);
  if (m) return gradients.get(m[1]) ?? null;
  const parsed = parseColor(attr);
  if (!parsed) return null;
  return rgbToHex(parsed.r, parsed.g, parsed.b);
}
