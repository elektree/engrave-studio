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
