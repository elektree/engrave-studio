import { BezierParams, BezierAnchor, BezierAnchorType, Project, Layer } from '../state/project';
import { svgEl } from '../utils/svg';
import { colorForDepth } from '../utils/palette';

export function renderBezier(params: BezierParams, project: Project, layer: Layer): SVGElement[] {
  const { anchors, closed, rotation, strokeWidth, outlined } = params;
  if (anchors.length < 2) return [];

  const color = colorForDepth(layer.depth, project.palette);
  // Open paths can't be meaningfully filled — force stroke painting so the
  // user always sees something on screen even with `outlined: false`.
  const stroke = outlined || !closed;
  const paint: Record<string, string | number> = stroke
    ? { fill: 'none', stroke: color, 'stroke-width': strokeWidth, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }
    : { fill: color, stroke: 'none' };
  // Rotate around the local origin (0, 0). The centroid sits at the origin
  // after auto-recentre on commit; using a fixed pivot keeps individual
  // anchor edits from making the other anchors drift as the bbox shifts.
  const transform = rotation ? `rotate(${rotation})` : '';
  const d = buildPathD(anchors, closed);
  return [svgEl('path', { ...paint, ...(transform ? { transform } : {}), d })];
}

export function buildPathD(anchors: BezierAnchor[], closed: boolean): string {
  if (anchors.length === 0) return '';
  // Normalize winding for closed paths: the offset/grow logic (offsetPolyline
  // in render/path-offset.ts) uses left-side normals, which only expand
  // outward for visually-CCW polygons (signed area < 0 in y-down screen
  // coords). If the user drew the shape CW, flip the anchor order so the
  // rendered path is always CCW. The visible shape is unchanged.
  let seq = anchors;
  if (closed && anchors.length >= 2 && anchorSignedArea(anchors) > 0) {
    seq = reverseAnchors(anchors);
  }
  const parts: string[] = [];
  const a0 = seq[0];
  parts.push(`M ${fmt(a0.x)} ${fmt(a0.y)}`);
  for (let i = 1; i < seq.length; i++) {
    const prev = seq[i - 1];
    const cur = seq[i];
    parts.push(cubicSegment(prev, cur));
  }
  if (closed && seq.length >= 2) {
    const last = seq[seq.length - 1];
    parts.push(cubicSegment(last, a0));
    parts.push('Z');
  }
  return parts.join(' ');
}

// Shoelace area of the anchor polygon (handles excluded — handles refine the
// curve but don't change overall winding in normal cases). Positive in y-down
// screen coords = visually CW; negative = visually CCW.
export function anchorSignedArea(anchors: BezierAnchor[]): number {
  let a = 0;
  const n = anchors.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += anchors[i].x * anchors[j].y - anchors[j].x * anchors[i].y;
  }
  return a / 2;
}

// Reverse the path direction: swap anchor order AND swap each anchor's
// hIn/hOut so the curve traces the same geometry in the opposite direction.
export function reverseAnchors(anchors: BezierAnchor[]): BezierAnchor[] {
  const rev = [...anchors].reverse();
  return rev.map((a) => ({
    ...a,
    hxIn: a.hxOut, hyIn: a.hyOut,
    hxOut: a.hxIn, hyOut: a.hyIn,
  }));
}

function cubicSegment(a: BezierAnchor, b: BezierAnchor): string {
  const c1x = a.x + a.hxOut, c1y = a.y + a.hyOut;
  const c2x = b.x + b.hxIn,  c2y = b.y + b.hyIn;
  return `C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(b.x)} ${fmt(b.y)}`;
}

function fmt(n: number): string {
  return (Math.round(n * 10000) / 10000).toString();
}

export function defaultBezierParams(kerf = 0.12): BezierParams {
  return {
    anchors: [],
    closed: false,
    rotation: 0,
    strokeWidth: kerf,
    outlined: false,
  };
}

// Tight curve bbox — samples each cubic segment instead of using control
// points. Used for the bounds gizmo so the box hugs the rendered shape and
// doesn't balloon out to where handles would project.
export function bezierShapeBBox(anchors: BezierAnchor[], closed: boolean): { x0: number; y0: number; x1: number; y1: number } {
  if (anchors.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  if (anchors.length === 1) return { x0: anchors[0].x, y0: anchors[0].y, x1: anchors[0].x, y1: anchors[0].y };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const consume = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  const segCount = closed ? anchors.length : anchors.length - 1;
  const SAMPLES = 24;
  for (let i = 0; i < segCount; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];
    consume(a.x, a.y);
    for (let s = 1; s < SAMPLES; s++) {
      const t = s / SAMPLES;
      const p = cubicPointAt(
        a.x, a.y, a.x + a.hxOut, a.y + a.hyOut,
        b.x + b.hxIn, b.y + b.hyIn, b.x, b.y, t,
      );
      consume(p.x, p.y);
    }
    consume(b.x, b.y);
  }
  if (!closed) consume(anchors[anchors.length - 1].x, anchors[anchors.length - 1].y);
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0, y0, x1, y1 };
}

// Approximate bounding box of every cubic in the path. Uses the convex hull of
// anchors + control points — overestimates a touch (true bbox would need root
// finding on each cubic's derivative) but it's enough for a selection gizmo.
export function bezierBBox(anchors: BezierAnchor[], closed: boolean): { x0: number; y0: number; x1: number; y1: number } {
  if (anchors.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const consume = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    consume(a.x, a.y);
    const hasNext = closed || i < anchors.length - 1;
    if (hasNext) consume(a.x + a.hxOut, a.y + a.hyOut);
    const hasPrev = closed || i > 0;
    if (hasPrev) consume(a.x + a.hxIn, a.y + a.hyIn);
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0, y0, x1, y1 };
}

// Centroid of anchor points (handles excluded — they're geometric helpers,
// not part of the visual mass). Used by the "Recentrer" action.
export function bezierCentroid(anchors: BezierAnchor[]): { x: number; y: number } {
  if (anchors.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const a of anchors) { sx += a.x; sy += a.y; }
  return { x: sx / anchors.length, y: sy / anchors.length };
}

// Cubic Bezier point at parameter t (used by edge-double-click "insert anchor").
export function cubicPointAt(
  ax: number, ay: number, c1x: number, c1y: number,
  c2x: number, c2y: number, bx: number, by: number, t: number,
): { x: number; y: number } {
  const u = 1 - t;
  const x = u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx;
  const y = u * u * u * ay + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * by;
  return { x, y };
}

// Synthesize curve handles for an anchor whose handles are both zero (most
// commonly: switching back from `line` to any curve type). Direction follows
// the polyline edges to the neighbours, length = a third of each segment so
// the curve smoothly threads through the points.
export function defaultHandlesForAnchor(
  anchors: BezierAnchor[],
  idx: number,
  closed: boolean,
): { hxIn: number; hyIn: number; hxOut: number; hyOut: number } {
  const n = anchors.length;
  const a = anchors[idx];
  let hxIn = 0, hyIn = 0, hxOut = 0, hyOut = 0;
  const hasPrev = closed || idx > 0;
  const hasNext = closed || idx < n - 1;
  if (hasPrev) {
    const p = anchors[(idx - 1 + n) % n];
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const k = Math.min(len * 0.33, 6);
      hxIn = (dx / len) * k;
      hyIn = (dy / len) * k;
    }
  }
  if (hasNext) {
    const m = anchors[(idx + 1) % n];
    const dx = m.x - a.x;
    const dy = m.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const k = Math.min(len * 0.33, 6);
      hxOut = (dx / len) * k;
      hyOut = (dy / len) * k;
    }
  }
  // Edge anchor with only one neighbour: mirror the existing handle so the
  // curve doesn't collapse to a line on switch.
  if (!hasPrev && hasNext) { hxIn = -hxOut; hyIn = -hyOut; }
  if (hasPrev && !hasNext) { hxOut = -hxIn; hyOut = -hyIn; }
  return { hxIn, hyIn, hxOut, hyOut };
}

// Coerce an anchor's handles to satisfy the constraint of `next` type.
// - line: zero both handles
// - corner: leave geometry untouched (constraint is "no constraint")
// - smooth: make handles colinear by reflecting hIn's direction onto hOut
//           while preserving hOut's length (or hIn's, if hOut is null)
// - symmetric: exact mirror — hOut = -hIn
export function normalizeAnchorForType(a: BezierAnchor, next: BezierAnchorType): BezierAnchor {
  if (next === 'line') {
    return { ...a, type: next, hxIn: 0, hyIn: 0, hxOut: 0, hyOut: 0 };
  }
  if (next === 'corner') {
    return { ...a, type: next };
  }
  if (next === 'symmetric') {
    // Mirror whichever handle is non-zero; if both zero, leave as-is.
    const lin = Math.hypot(a.hxIn, a.hyIn);
    const lout = Math.hypot(a.hxOut, a.hyOut);
    if (lout > 0) return { ...a, type: next, hxIn: -a.hxOut, hyIn: -a.hyOut };
    if (lin > 0)  return { ...a, type: next, hxOut: -a.hxIn,  hyOut: -a.hyIn };
    return { ...a, type: next };
  }
  // smooth: colinear (opposite directions). Keep both lengths if both non-zero.
  const lin = Math.hypot(a.hxIn, a.hyIn);
  const lout = Math.hypot(a.hxOut, a.hyOut);
  if (lin > 0 && lout > 0) {
    // Align hOut to be opposite hIn direction, preserve hOut's length.
    const k = lout / lin;
    return { ...a, type: next, hxOut: -a.hxIn * k, hyOut: -a.hyIn * k };
  }
  if (lout > 0) return { ...a, type: next, hxIn: -a.hxOut, hyIn: -a.hyOut };
  if (lin > 0) return { ...a, type: next, hxOut: -a.hxIn, hyOut: -a.hyIn };
  return { ...a, type: next };
}

// De Casteljau split: returns the new anchor (point at t) along with the
// adjusted handles for the two surrounding anchors so the curve shape is
// preserved exactly. Caller is responsible for inserting the new anchor and
// patching prev.hOut / next.hIn.
export function splitCubic(
  a: BezierAnchor, b: BezierAnchor, t: number,
): { newAnchor: BezierAnchor; aHxOut: number; aHyOut: number; bHxIn: number; bHyIn: number } {
  const u = 1 - t;
  const p0x = a.x,             p0y = a.y;
  const p1x = a.x + a.hxOut,   p1y = a.y + a.hyOut;
  const p2x = b.x + b.hxIn,    p2y = b.y + b.hyIn;
  const p3x = b.x,             p3y = b.y;

  const q0x = u * p0x + t * p1x, q0y = u * p0y + t * p1y;
  const q1x = u * p1x + t * p2x, q1y = u * p1y + t * p2y;
  const q2x = u * p2x + t * p3x, q2y = u * p2y + t * p3y;

  const r0x = u * q0x + t * q1x, r0y = u * q0y + t * q1y;
  const r1x = u * q1x + t * q2x, r1y = u * q1y + t * q2y;

  const sx = u * r0x + t * r1x, sy = u * r0y + t * r1y;

  const newAnchor: BezierAnchor = {
    x: sx, y: sy,
    hxIn: r0x - sx, hyIn: r0y - sy,
    hxOut: r1x - sx, hyOut: r1y - sy,
    type: 'smooth',
  };
  return {
    newAnchor,
    aHxOut: q0x - a.x, aHyOut: q0y - a.y,
    bHxIn: q2x - b.x, bHyIn: q2y - b.y,
  };
}
