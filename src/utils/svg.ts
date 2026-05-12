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

export function line(x1: number, y1: number, x2: number, y2: number, sw: number): SVGLineElement {
  return svgEl('line', { x1, y1, x2, y2, stroke: '#000', 'stroke-width': sw, fill: 'none' });
}

export function rect(x: number, y: number, w: number, h: number, attrs: Record<string, string | number> = {}): SVGRectElement {
  return svgEl('rect', { x, y, width: w, height: h, fill: 'none', stroke: '#000', 'stroke-width': 0.1, ...attrs });
}

export function path(d: string, sw: number): SVGPathElement {
  return svgEl('path', { d, stroke: '#000', 'stroke-width': sw, fill: 'none' });
}

export function circle(cx: number, cy: number, r: number, sw: number): SVGCircleElement {
  return svgEl('circle', { cx, cy, r, stroke: '#000', 'stroke-width': sw, fill: 'none' });
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

function extractUniformScale(transform: string | null): number {
  if (!transform) return 1;
  // Catch all scale(N) and scale(Sx, Sy) occurrences; multiply them together.
  const re = /scale\(\s*([-\d.eE]+)(?:\s*[,\s]\s*([-\d.eE]+))?\s*\)/g;
  let m: RegExpExecArray | null;
  let s = 1;
  while ((m = re.exec(transform)) !== null) {
    const sx = parseFloat(m[1]);
    const sy = m[2] ? parseFloat(m[2]) : sx;
    if (Number.isFinite(sx) && Number.isFinite(sy)) {
      // Use the geometric mean for non-uniform scale — close enough for stroke.
      s *= Math.sqrt(Math.abs(sx * sy));
    }
  }
  return s || 1;
}

export function applyGrow(el: SVGElement, grow: number, cumScale = 1): void {
  if (grow <= 0) return;
  const tag = el.nodeName.toLowerCase();
  if (GEOMETRY_TAGS.has(tag)) {
    const curSw = parseFloat(el.getAttribute('stroke-width') ?? '0') || 0;
    // 2*grow on paper = 2*grow / cumScale in the local user space.
    el.setAttribute('stroke-width', String(curSw + (2 * grow) / cumScale));
    const stroke = el.getAttribute('stroke');
    if (!stroke || stroke === 'none') {
      const fill = el.getAttribute('fill');
      el.setAttribute('stroke', fill && fill !== 'none' ? fill : '#000');
    }
  }
  const tx = el.getAttribute('transform');
  const nextScale = tx ? cumScale * extractUniformScale(tx) : cumScale;
  for (const c of Array.from(el.children) as SVGElement[]) applyGrow(c, grow, nextScale);
}
