import { SvgLayerParams, Project, Layer, PaletteEntry } from '../state/project';
import { svgEl, readSvgViewBox } from '../utils/svg';
import {
  colorForDepth, luminance, remapLuminance,
  buildGradientColorMap, resolveColorAttr,
} from '../utils/palette';

const STROKEABLE = new Set([
  'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text',
]);

// Per-element repaint, source-aware. Each paintable element's effective
// colour (stroke if any, else fill, gradients flattened to a hex) drives a
// luminance → depth remap → palette colour. Elements with no usable colour
// (currentColor, opaque patterns, parsing failures) fall back to the layer's
// own depth colour.
//
// The `outlined` flag controls structural intent of the OUTPUT, not what was
// in the source:
//  - true  → every element rendered as a stroke at sw (source fills become
//            outlines of their silhouette).
//  - false → source paint role preserved (fill→fill, stroke→stroke at sw).
//            materializeForLaser later converts surviving strokes to ribbons
//            so the engraved result is uniformly "shape-like".
// Reads `attr` from the element directly OR from its inline `style` (the
// latter is what most modern SVG exporters emit — Illustrator, Figma, etc.).
function readPaintAttr(el: Element, attr: 'stroke' | 'fill'): string | null {
  const direct = el.getAttribute?.(attr);
  if (direct) return direct;
  const style = el.getAttribute?.('style');
  if (style) {
    const m = style.match(new RegExp(`(?:^|;)\\s*${attr}\\s*:\\s*([^;]+)`, 'i'));
    if (m) return m[1].trim();
  }
  return null;
}

// CSS-in-SVG: an inline `style="fill:url(#…)"` *overrides* a presentation
// attribute `fill="…"`. Without stripping the paint declarations from the
// style, our setAttribute('fill', color) is ignored and the element keeps
// trying to paint with the original (unresolved) gradient.
const PAINT_STYLE_PROPS = new Set(['fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'stroke-width']);
function clearPaintStyle(el: Element): void {
  const style = el.getAttribute?.('style');
  if (!style) return;
  const kept = style
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => {
      const colon = s.indexOf(':');
      if (colon < 0) return true;
      const prop = s.slice(0, colon).trim().toLowerCase();
      return !PAINT_STYLE_PROPS.has(prop);
    })
    .join(';');
  if (kept) el.setAttribute('style', kept);
  else el.removeAttribute('style');
}

// Walks up the ancestor chain looking for an explicit `attr` value. Groups
// often carry the paint for their children (e.g. `<g fill="red"><path/></g>`
// where the path has no direct attribute) — reading just the leaf would miss
// that and fall back to the layer's default colour.
function effectivePaint(
  el: Element,
  attr: 'stroke' | 'fill',
  gradients: Map<string, string>,
): { value: string; resolved: string | null } | null {
  let cur: Element | null = el;
  while (cur) {
    const v = readPaintAttr(cur, attr);
    if (v) return { value: v, resolved: resolveColorAttr(v, gradients) };
    cur = cur.parentElement;
  }
  return null;
}

export type SvgRepaintOpts = {
  outlined: boolean;
  depthForBlack: number;
  depthForWhite: number;
};

// Shared by the SVG layer and scatter custom shapes — walks the template,
// resolving each leaf's source paint (style or attribute, inherited from
// ancestors, gradients flattened to flat colour) and remapping luminance →
// palette via the black/white depth thresholds.
export function applySvgSourceColors(
  el: SVGElement,
  sw: number,
  params: SvgRepaintOpts,
  palette: PaletteEntry[],
  fallbackColor: string,
  gradients: Map<string, string>,
): void {
  const tag = el.nodeName.toLowerCase();
  if (STROKEABLE.has(tag)) {
    const strokeInfo = effectivePaint(el, 'stroke', gradients);
    const fillInfo = effectivePaint(el, 'fill', gradients);
    // "Explicit none" still counts as a paint role — a stroke="none" element
    // really means "don't draw a stroke", same for fill. Pick a colour from
    // whichever role actually paints, preferring stroke since that's what most
    // line-art SVGs use as their colour signal.
    const srcStroke = strokeInfo && strokeInfo.value !== 'none' ? strokeInfo.resolved : null;
    const srcFill = fillInfo && fillInfo.value !== 'none' ? fillInfo.resolved : null;
    const src = srcStroke ?? srcFill;
    let color = fallbackColor;
    if (src) {
      const depth = remapLuminance(luminance(src), params.depthForBlack, params.depthForWhite);
      color = colorForDepth(depth, palette);
    }
    // Nuke the leaf's inline paint declarations so our setAttribute below
    // actually takes effect (CSS specificity: style wins over attribute).
    clearPaintStyle(el);
    if (params.outlined) {
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', String(sw));
      el.setAttribute('fill', 'none');
    } else if (srcStroke && !srcFill) {
      // Source is a stroke-only element (open paths, line art) — keep it as
      // a stroke so the materialise pass can ribbon it later.
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', String(sw));
      el.setAttribute('fill', 'none');
    } else {
      // Source has a fill (with or without stroke) — paint as fill silhouette.
      el.setAttribute('fill', color);
      el.setAttribute('stroke', 'none');
    }
  }
  for (const c of Array.from(el.children) as SVGElement[]) {
    applySvgSourceColors(c, sw, params, palette, fallbackColor, gradients);
  }
}

export function renderSvgLayer(params: SvgLayerParams, project: Project, layer: Layer): SVGElement[] {
  if (!params.svgText) return [];
  const canvas = project.canvas;
  const palette = project.palette;
  // Elements with no resolvable source colour fall back to the depth of an
  // ideal-black source — the same value the threshold pair maps black to.
  // The UI no longer exposes a per-layer depth slider for SVG since this
  // override would render it meaningless.
  const fallbackColor = colorForDepth(params.depthForBlack, palette);
  const parsed = new DOMParser().parseFromString(params.svgText, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!(root instanceof SVGSVGElement)) return [];
  const vb = readSvgViewBox(root);
  const scale = Math.max(params.scale, 0.001);

  // Build a template <g> that contains the SVG content centred on origin and
  // stripped of metadata. Clone it for every tile to keep things cheap.
  // <defs> is dropped from the template but kept around so gradient lookups
  // still work — gradient resolution is done against the parsed root.
  const template = svgEl('g');
  for (const child of Array.from(root.children) as SVGElement[]) {
    const tag = child.nodeName.toLowerCase();
    if (tag === 'title' || tag === 'desc' || tag === 'metadata' || tag === 'defs') continue;
    template.appendChild(child.cloneNode(true) as SVGElement);
  }
  // Outer scale uniformly multiplies stroke widths; compensate so paper width is sw.
  const compensated = params.strokeWidth / scale;
  const gradients = buildGradientColorMap(root);
  applySvgSourceColors(template, compensated, params, palette, fallbackColor, gradients);

  const cx = vb.x + vb.w / 2;
  const cy = vb.y + vb.h / 2;
  const instanceTransform = (px: number, py: number): string =>
    `translate(${px} ${py}) rotate(${params.rotation}) scale(${scale}) translate(${-cx} ${-cy})`;

  const buildInstance = (px: number, py: number): SVGElement => {
    const g = svgEl('g', { transform: instanceTransform(px, py) });
    for (const c of Array.from(template.children) as SVGElement[]) g.appendChild(c.cloneNode(true) as SVGElement);
    return g;
  };

  if (!params.tile) return [buildInstance(0, 0)];

  // Texture mode — tile across the canvas in a grid that rotates WITH the SVG's
  // own rotation, so the texture follows the pattern's orientation.
  const tileW = vb.w * scale + Math.max(0, params.tileSpacingX);
  const tileH = vb.h * scale + Math.max(0, params.tileSpacingY);
  const ox = layer.offsetX;
  const oy = layer.offsetY;
  const ang = (params.rotation * Math.PI) / 180;
  const cosA = Math.cos(ang);
  const sinA = Math.sin(ang);

  // Iterate k, j over a range that's guaranteed to cover the canvas under any
  // rotation. We compute the inverse-rotated layer-local positions of the canvas
  // corners, then take the bounding box in grid space.
  const cosNa = Math.cos(-ang);
  const sinNa = Math.sin(-ang);
  const corners = [
    [0 - ox, 0 - oy],
    [canvas.width - ox, 0 - oy],
    [0 - ox, canvas.height - oy],
    [canvas.width - ox, canvas.height - oy],
  ];
  let kMin = Infinity, kMax = -Infinity, jMin = Infinity, jMax = -Infinity;
  for (const [lx, ly] of corners) {
    const gx = lx * cosNa - ly * sinNa;
    const gy = lx * sinNa + ly * cosNa;
    const k = gx / tileW;
    const j = gy / tileH;
    if (k < kMin) kMin = k;
    if (k > kMax) kMax = k;
    if (j < jMin) jMin = j;
    if (j > jMax) jMax = j;
  }
  kMin = Math.floor(kMin) - 1;
  kMax = Math.ceil(kMax) + 1;
  jMin = Math.floor(jMin) - 1;
  jMax = Math.ceil(jMax) + 1;

  const out = svgEl('g');
  for (let j = jMin; j <= jMax; j++) {
    for (let k = kMin; k <= kMax; k++) {
      // Place each tile in the rotated grid frame.
      const localX = k * tileW;
      const localY = j * tileH;
      const px = localX * cosA - localY * sinA;
      const py = localX * sinA + localY * cosA;
      out.appendChild(buildInstance(px, py));
    }
  }
  return [out];
}

export function defaultSvgLayerParams(svgText: string, scale = 1, kerf = 0.12): SvgLayerParams {
  return {
    svgText,
    scale,
    rotation: 0,
    strokeWidth: kerf,
    outlined: false,
    depthForBlack: 1,
    depthForWhite: 0,
    tile: false,
    tileSpacingX: 0,
    tileSpacingY: 0,
  };
}

// Pick the import scale for a dropped SVG. Priority:
//   1. SVG declares width (or height) in real-world units (mm, cm, in, pt)
//      → honour it. Re-importing a file we exported with width="1100mm"
//      lands back at native 1100 mm, not shrunk to a target.
//   2. Otherwise (no units, px, unknown) → fit `fallbackTargetMm` to the
//      longest viewBox side so the layer is at least visible.
export function scaleForTargetSize(svgText: string, fallbackTargetMm: number): number {
  try {
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root instanceof SVGSVGElement) {
      const vb = readSvgViewBox(root);
      const widthMm = parseLengthMm(root.getAttribute('width'));
      if (widthMm !== null && vb.w > 0) return widthMm / vb.w;
      const heightMm = parseLengthMm(root.getAttribute('height'));
      if (heightMm !== null && vb.h > 0) return heightMm / vb.h;
      const longest = Math.max(vb.w, vb.h, 0.1);
      return fallbackTargetMm / longest;
    }
  } catch { /* ignore */ }
  return 1;
}

function parseLengthMm(s: string | null): number | null {
  if (!s) return null;
  const m = s.trim().match(/^([\d.]+)\s*(mm|cm|in|pt)?$/i);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val)) return null;
  switch ((m[2] ?? '').toLowerCase()) {
    case 'mm': return val;
    case 'cm': return val * 10;
    case 'in': return val * 25.4;
    case 'pt': return val * 25.4 / 72;
    default:   return null; // bare number / px → can't trust as mm
  }
}
