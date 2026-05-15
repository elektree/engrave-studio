import { offsetFilledPathD } from '../render/path-offset';

const NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  children: SVGElement[] = [],
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.appendChild(c);
  return el;
}

export function group(attrs: Record<string, string | number> = {}, children: SVGElement[] = []): SVGGElement {
  return svgEl('g', attrs, children);
}

export function line(x1: number, y1: number, x2: number, y2: number, sw: number, stroke: string = '#000'): SVGLineElement {
  return svgEl('line', { x1, y1, x2, y2, stroke, 'stroke-width': sw, fill: 'none' });
}

export function rect(x: number, y: number, w: number, h: number, attrs: Record<string, string | number> = {}): SVGRectElement {
  return svgEl('rect', { x, y, width: w, height: h, fill: 'none', stroke: '#000', 'stroke-width': 0.1, ...attrs });
}

export function path(d: string, sw: number, stroke: string = '#000'): SVGPathElement {
  return svgEl('path', { d, stroke, 'stroke-width': sw, fill: 'none' });
}

export function circle(cx: number, cy: number, r: number, sw: number, stroke: string = '#000'): SVGCircleElement {
  return svgEl('circle', { cx, cy, r, stroke, 'stroke-width': sw, fill: 'none' });
}

export function makeSvg(canvasWidth: number, canvasHeight: number): SVGSVGElement {
  return svgEl('svg', {
    xmlns: NS,
    viewBox: `0 0 ${canvasWidth} ${canvasHeight}`,
    width: '100%',
    height: '100%',
    'preserveAspectRatio': 'xMidYMid meet',
  });
}

// Recursively inflate every stroke-width by 2*grow mm. Transform-aware: when
// descending into a <g transform="scale(N) ..."> the effective inner stroke
// would render at N * stroke-width on paper, so we divide the grow contribution
// by the cumulative scale before adding to the stroke-width attribute.
// This is what makes layer "grow" produce the same on-paper width regardless
// of inner pattern scaling (e.g. scatter custom shapes scaled down to size).
const GEOMETRY_TAGS = new Set([
  'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text',
]);
// `<defs>` content (clipPath/mask/etc.) is shape metadata; growing the stroke
// on those internal rects/paths would either be invisible (clip uses fill
// region only) or worse, set a default stroke on what was supposed to be a
// pure clipping shape — that shape then leaks into the export bucket.
const GROW_SKIP_TAGS = new Set(['defs', 'mask', 'clipPath', 'symbol', 'pattern']);

const SCALE_RE = /scale\(\s*([-\d.eE]+)(?:\s*[,\s]\s*([-\d.eE]+))?\s*\)/g;

export function extractUniformScale(transform: string | null): number {
  if (!transform) return 1;
  SCALE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let s = 1;
  while ((m = SCALE_RE.exec(transform)) !== null) {
    const sx = parseFloat(m[1]);
    const sy = m[2] ? parseFloat(m[2]) : sx;
    if (Number.isFinite(sx) && Number.isFinite(sy)) {
      // Geometric mean for non-uniform scale — close enough for stroke widths.
      s *= Math.sqrt(Math.abs(sx * sy));
    }
  }
  return s || 1;
}

// Multiply every `scale(...)` transform up the ancestor chain. Lets callers
// convert a canvas-mm value into the element's local units.
export function cumulativeScale(el: Element): number {
  let s = 1;
  let cur: Element | null = el;
  while (cur && cur.nodeName.toLowerCase() !== 'svg') {
    s *= extractUniformScale(cur.getAttribute?.('transform') ?? null);
    cur = cur.parentElement;
  }
  return s || 1;
}

export type ViewBox = { x: number; y: number; w: number; h: number };

// Read the viewBox of an `<svg>` root. Falls back to width/height (as bare
// numbers — px-equivalent) when the viewBox attribute is missing.
export function readSvgViewBox(svg: SVGSVGElement): ViewBox {
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const parts = vb.split(/\s+|,/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
      return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
  }
  const w = parseFloat(svg.getAttribute('width') ?? '100') || 100;
  const h = parseFloat(svg.getAttribute('height') ?? '100') || 100;
  return { x: 0, y: 0, w, h };
}

// Parse a raw SVG string just to get its viewBox — avoids forcing callers to
// build a full DOMParser pipeline when they only need bounding metrics.
export function parseSvgViewBoxText(svgText: string): ViewBox {
  try {
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root instanceof SVGSVGElement) return readSvgViewBox(root);
  } catch { /* ignore */ }
  return { x: 0, y: 0, w: 100, h: 100 };
}

// Recursively recolour every painted element under `el`. Used to build mask
// silhouettes (where the colour is the mask signal — white/black, not depth).
export function paintForMask(el: SVGElement, colour: string): void {
  if (el.hasAttribute('stroke') && el.getAttribute('stroke') !== 'none') el.setAttribute('stroke', colour);
  if (el.hasAttribute('fill') && el.getAttribute('fill') !== 'none') el.setAttribute('fill', colour);
  if (!el.hasAttribute('stroke')) el.setAttribute('stroke', colour);
  for (const child of Array.from(el.children) as SVGElement[]) paintForMask(child, colour);
}

function isFilled(el: SVGElement): boolean {
  const stroke = el.getAttribute('stroke');
  const fill = el.getAttribute('fill');
  const hasStroke = !!stroke && stroke !== 'none';
  const hasFill = !!fill && fill !== 'none';
  return hasFill && !hasStroke;
}

export function num(el: Element, k: string): number {
  const v = parseFloat(el.getAttribute(k) ?? '0');
  return Number.isFinite(v) ? v : 0;
}

export function applyGrow(el: SVGElement, grow: number, cumScale = 1): void {
  if (grow === 0) return;
  // Renderer-baked geometry (text vectorised in preview) opts out of the
  // generic grow walk — the renderer has already applied the offset to the
  // path, applying it again here would double-shift the outline.
  if (el.getAttribute?.('data-no-grow') === 'true') return;
  const tag = el.nodeName.toLowerCase();
  if (GROW_SKIP_TAGS.has(tag)) return;

  // Filled shapes grow/shrink by modifying their geometry directly — this is
  // what makes negative grow useful (a "skinnier" text, a smaller dot). For
  // stroked-only elements we keep the historic behaviour of inflating the
  // stroke-width (which is the meaningful concept of growth for a line).
  const localGrow = grow / cumScale;
  if (GEOMETRY_TAGS.has(tag) && isFilled(el)) {
    growFilledGeometry(el, localGrow);
  } else if (GEOMETRY_TAGS.has(tag)) {
    const curSw = parseFloat(el.getAttribute('stroke-width') ?? '0') || 0;
    el.setAttribute('stroke-width', String(Math.max(0, curSw + 2 * localGrow)));
    // For positive grow on a stroke-less leaf, synthesise a stroke so the
    // 2*grow inflation has something to paint. Skip for negative grow — we'd
    // be growing the bounding box instead of shrinking it.
    const stroke = el.getAttribute('stroke');
    if (grow > 0 && (!stroke || stroke === 'none')) {
      const fill = el.getAttribute('fill');
      el.setAttribute('stroke', fill && fill !== 'none' ? fill : '#000');
    }
  }
  const tx = el.getAttribute('transform');
  const nextScale = tx ? cumScale * extractUniformScale(tx) : cumScale;
  for (const c of Array.from(el.children) as SVGElement[]) applyGrow(c, grow, nextScale);
}

// Grow a filled element's geometry by `g` mm on every side (negative shrinks).
function growFilledGeometry(el: SVGElement, g: number): void {
  const tag = el.nodeName.toLowerCase();
  if (tag === 'rect') {
    const x = num(el, 'x'), y = num(el, 'y');
    const w = num(el, 'width'), h = num(el, 'height');
    const nw = w + 2 * g, nh = h + 2 * g;
    if (nw <= 0 || nh <= 0) return;
    el.setAttribute('x', String(x - g));
    el.setAttribute('y', String(y - g));
    el.setAttribute('width', String(nw));
    el.setAttribute('height', String(nh));
    const rx = num(el, 'rx');
    if (rx > 0) el.setAttribute('rx', String(Math.max(0, rx + g)));
    const ry = num(el, 'ry');
    if (ry > 0) el.setAttribute('ry', String(Math.max(0, ry + g)));
  } else if (tag === 'circle') {
    const r = num(el, 'r') + g;
    if (r > 0) el.setAttribute('r', String(r));
  } else if (tag === 'ellipse') {
    const rx = num(el, 'rx') + g;
    const ry = num(el, 'ry') + g;
    if (rx > 0 && ry > 0) {
      el.setAttribute('rx', String(rx));
      el.setAttribute('ry', String(ry));
    }
  } else if (tag === 'path') {
    // Filled paths (e.g. text vectorised at export) — offset every closed
    // subpath outline by g. Requires DOM attachment for the sub-path sampler.
    const parent = el.parentNode;
    if (!(parent instanceof Element)) return;
    const d = el.getAttribute('d');
    if (!d) return;
    const next = offsetFilledPathD(parent, d, g);
    if (next) el.setAttribute('d', next);
  }
  // line / polyline / polygon / text fall through with no geometry grow —
  // line/polyline/polygon don't have a single "size" attribute, and `<text>`
  // can't be reliably resized via attributes alone (would need vectorisation
  // — already handled at export time).
}
