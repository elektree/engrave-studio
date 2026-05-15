// Materialises the rendered SVG tree for the laser. Per palette entry:
//  - mode='fill' → each stroked leaf is replaced by a closed filled path (the
//    boundary of the painted region). Filled leaves pass through unchanged.
//    LightBurn picks up the colour and the user assigns a Fill (scan) op.
//  - mode='line' → each stroked leaf is normalised to stroke-width = kerf
//    (single-pass centerline). LightBurn user assigns a Line op.
//
// Same code path drives the laser preview and the SVG export — preview is
// exactly what the export will produce.

import type { PaletteEntry } from '../state/project';
import {
  Pt, offsetPolyline, polyD, parsePolylineD, splitMSubpaths, sampleSubpath,
} from './path-offset';
import { cumulativeScale, num } from '../utils/svg';

const GEOMETRY_TAGS = new Set(['line', 'rect', 'circle', 'ellipse', 'polyline', 'polygon', 'path']);
// clipPath rects define the clip region by their fill area only, transforming
// stroked clip shapes corrupts the clip silhouette. Symbol/pattern are SVG
// reuse primitives we don't author. Defs/mask ARE walked — the mask def's
// painted strokes must be turned into ribbons too so the masked content
// matches what the laser will actually engrave.
const SKIP_TAGS = new Set(['clipPath', 'symbol', 'pattern']);
const NS = 'http://www.w3.org/2000/svg';

type Collected = { el: SVGElement; inMask: boolean };

export function materializeForLaser(root: SVGElement, kerf: number, palette: PaletteEntry[]): void {
  const leaves: Collected[] = [];
  collectLeaves(root, leaves, false);
  for (const { el, inMask } of leaves) {
    const stroke = effectiveStroke(el);
    const sw = effectiveStrokeWidth(el);
    if (!stroke || sw <= 0) continue;  // filled-only leaf — LightBurn will fill it natively

    // Mask def contents are coloured by paintForMask (white/black, signal-only)
    // — palette mode lookup on those would be meaningless. Force fill so the
    // mask silhouette matches the visible laser interpretation (a ribbon of
    // the stroke's grown width).
    const mode = inMask ? 'fill' : modeForColor(stroke, palette);
    if (mode === 'line') {
      // kerf is measured in canvas mm. The leaf may be nested inside scaled
      // groups (e.g. an SVG layer's internal `scale(scale)` instance); writing
      // `kerf` straight onto the attribute would render at `kerf × cumulative
      // scale` after transforms. Divide so the on-paper width is exactly kerf.
      const s = cumulativeScale(el);
      el.setAttribute('stroke-width', String(kerf / s));
      continue;
    }
    const replacement = strokeToFilledShape(el, sw, stroke);
    if (replacement) el.replaceWith(replacement);
  }
}

function collectLeaves(el: Element, out: Collected[], inMask: boolean): void {
  const tag = el.nodeName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return;
  if (el.getAttribute?.('data-no-expand') === 'true') return;
  if (GEOMETRY_TAGS.has(tag)) {
    out.push({ el: el as SVGElement, inMask });
    return;
  }
  const nestedInMask = inMask || tag === 'mask';
  for (const c of Array.from(el.children)) collectLeaves(c, out, nestedInMask);
}

function effectiveStroke(el: Element): string | null {
  let cur: Element | null = el;
  while (cur) {
    const s = cur.getAttribute?.('stroke');
    if (s) return s === 'none' ? null : s;
    cur = cur.parentElement;
  }
  return null;
}

function effectiveStrokeWidth(el: Element): number {
  let cur: Element | null = el;
  while (cur) {
    const s = cur.getAttribute?.('stroke-width');
    if (s) return parseFloat(s) || 0;
    cur = cur.parentElement;
  }
  return 0;
}

function modeForColor(color: string, palette: PaletteEntry[]): 'fill' | 'line' {
  const key = color.toLowerCase();
  const entry = palette.find((p) => p.color.toLowerCase() === key);
  return entry?.mode ?? 'fill';
}

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

// ── Stroke → filled shape (per tag) ───────────────────────────────────

function strokeToFilledShape(el: SVGElement, sw: number, stroke: string): SVGElement | null {
  const tag = el.nodeName.toLowerCase();
  const halfW = sw / 2;
  let out: SVGElement | null = null;
  switch (tag) {
    case 'line':    out = lineToFilled(el as SVGLineElement, halfW, stroke); break;
    case 'rect':    out = rectToFilled(el as SVGRectElement, halfW, stroke); break;
    case 'circle':  out = circleToFilled(el as SVGCircleElement, halfW, stroke); break;
    case 'ellipse': out = ellipseToFilled(el as SVGEllipseElement, halfW, stroke); break;
    case 'polyline':out = polyToFilled(el, halfW, stroke, false); break;
    case 'polygon': out = polyToFilled(el, halfW, stroke, true); break;
    case 'path':    out = pathToFilled(el as SVGPathElement, halfW, stroke); break;
  }
  // Preserve the leaf's own transform so layer-level rotation (e.g. on a
  // shape pattern) survives the stroke→fill conversion. Without this, an
  // outlined rotated rect would lose its rotation in laser mode.
  if (out) {
    const tx = el.getAttribute('transform');
    if (tx) out.setAttribute('transform', tx);
  }
  return out;
}

function lineToFilled(el: SVGLineElement, halfW: number, stroke: string): SVGElement {
  const x1 = num(el, 'x1'), y1 = num(el, 'y1');
  const x2 = num(el, 'x2'), y2 = num(el, 'y2');
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const ax = x1 + nx * halfW, ay = y1 + ny * halfW;
  const bx = x2 + nx * halfW, by = y2 + ny * halfW;
  const cx = x2 - nx * halfW, cy = y2 - ny * halfW;
  const dxp = x1 - nx * halfW, dyp = y1 - ny * halfW;
  return svgEl('path', {
    d: `M ${ax} ${ay} L ${bx} ${by} L ${cx} ${cy} L ${dxp} ${dyp} Z`,
    fill: stroke,
    stroke: 'none',
  });
}

function rectToFilled(el: SVGRectElement, halfW: number, stroke: string): SVGElement {
  const x = num(el, 'x'), y = num(el, 'y');
  const w = num(el, 'width'), h = num(el, 'height');
  const outer = rectD(x - halfW, y - halfW, w + 2 * halfW, h + 2 * halfW);
  const innerW = w - 2 * halfW;
  const innerH = h - 2 * halfW;
  const hasHole = innerW > 0 && innerH > 0;
  const inner = hasHole ? rectD(x + halfW, y + halfW, innerW, innerH) : '';
  return svgEl('path', {
    d: outer + (inner ? ' ' + inner : ''),
    fill: stroke,
    stroke: 'none',
    ...(hasHole ? { 'fill-rule': 'evenodd' } : {}),
  });
}

function rectD(x: number, y: number, w: number, h: number): string {
  return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
}

function circleToFilled(el: SVGCircleElement, halfW: number, stroke: string): SVGElement {
  const cx = num(el, 'cx'), cy = num(el, 'cy'), r = num(el, 'r');
  return ringPath(cx, cy, r + halfW, r - halfW, r + halfW, r - halfW, stroke);
}

function ellipseToFilled(el: SVGEllipseElement, halfW: number, stroke: string): SVGElement {
  const cx = num(el, 'cx'), cy = num(el, 'cy');
  const rx = num(el, 'rx'), ry = num(el, 'ry');
  return ringPath(cx, cy, rx + halfW, rx - halfW, ry + halfW, ry - halfW, stroke);
}

function ringPath(
  cx: number, cy: number,
  rxO: number, rxI: number, ryO: number, ryI: number,
  stroke: string,
): SVGElement {
  const outer = ellipseD(cx, cy, rxO, ryO);
  const hasHole = rxI > 0 && ryI > 0;
  const inner = hasHole ? ellipseD(cx, cy, rxI, ryI) : '';
  return svgEl('path', {
    d: outer + (inner ? ' ' + inner : ''),
    fill: stroke,
    stroke: 'none',
    ...(hasHole ? { 'fill-rule': 'evenodd' } : {}),
  });
}

function ellipseD(cx: number, cy: number, rx: number, ry: number): string {
  // Two arcs cover the full ellipse outline. Sweep flag = 1 (clockwise).
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy} Z`;
}

function polyToFilled(el: SVGElement, halfW: number, stroke: string, closed: boolean): SVGElement | null {
  const pts = parsePoints(el.getAttribute('points') ?? '');
  if (pts.length < 2) return null;
  return ribbonFromCenterline(pts, halfW, stroke, closed);
}

function pathToFilled(el: SVGPathElement, halfW: number, stroke: string): SVGElement | null {
  const d = el.getAttribute('d') ?? '';
  // Multi-subpath glyphs ('O', 'A', 'B', …) emit `M … Z M … Z …`. Sampling
  // the whole path with getPointAtLength would tunnel between contours; split
  // by M and ribbon each independently so each outline gets its own band.
  const subpaths = splitMSubpaths(d);
  if (subpaths.length === 0) return null;
  const parent = el.parentNode instanceof Element ? el.parentNode : null;

  const dParts: string[] = [];
  let anyClosed = false;
  for (const sub of subpaths) {
    const closed = /[zZ]\s*$/.test(sub.trim());
    let pts = parsePolylineD(sub);
    if (!pts && parent) pts = sampleSubpath(parent, sub);
    if (!pts || pts.length < 2) continue;
    const ctr = closed && pts.length > 1
      && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.1
      ? pts.slice(0, -1)
      : pts;
    const right = offsetPolyline(ctr, halfW, closed);
    const left = offsetPolyline(ctr, -halfW, closed);
    if (closed) {
      dParts.push(polyD(right, true));
      dParts.push(polyD(left.slice().reverse(), true));
      anyClosed = true;
    } else {
      dParts.push(polyD([...right, ...left.slice().reverse()], true));
    }
  }
  if (dParts.length === 0) return null;
  return svgEl('path', {
    d: dParts.join(' '),
    fill: stroke,
    stroke: 'none',
    // evenodd lets nested contours cut holes in the painted ribbon (glyphs
    // with counters like 'O' or 'A' work correctly).
    ...(anyClosed ? { 'fill-rule': 'evenodd' } : {}),
  });
}

// ── Centerline → filled boundary ─────────────────────────────────────

function ribbonFromCenterline(pts: Pt[], halfW: number, stroke: string, closed: boolean): SVGElement | null {
  const right = offsetPolyline(pts, halfW, closed);
  const left = offsetPolyline(pts, -halfW, closed);
  let d: string;
  if (closed) {
    // Closed centerline: two nested loops → ring via evenodd.
    d = polyD(right, true) + ' ' + polyD(left.slice().reverse(), true);
    return svgEl('path', { d, fill: stroke, stroke: 'none', 'fill-rule': 'evenodd' });
  }
  // Open centerline: right side + reverse(left side) + close → single ribbon.
  d = polyD([...right, ...left.slice().reverse()], true);
  return svgEl('path', { d, fill: stroke, stroke: 'none' });
}

// ── Helpers ──────────────────────────────────────────────────────────

function parsePoints(s: string): Pt[] {
  const nums = s.trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  const out: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] });
  return out;
}
