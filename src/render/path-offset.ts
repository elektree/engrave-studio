// Shared polyline / path offsetting helpers. Used by:
//  - expand-strokes.ts to turn stroked geometry into filled ribbons,
//  - utils/svg.ts (applyGrow) to expand or shrink filled-path outlines.

export type Pt = { x: number; y: number };

// Unit left-side normal of the segment a→b (rotated 90° CCW in math convention,
// which is "down" in SVG y-down coordinates).
export function leftNormal(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

// Perpendicular-offset a polyline by distance `d`. Interior vertices use a
// bisector miter; endpoints use a single-edge normal; sharp turns where the
// miter would explode are clamped to the outgoing edge's normal.
export function offsetPolyline(pts: Pt[], d: number, closed: boolean): Pt[] {
  const n = pts.length;
  if (n < 2 || Math.abs(d) < 1e-9) return pts.map((p) => ({ ...p }));
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n] : (i > 0 ? pts[i - 1] : null);
    const next = closed ? pts[(i + 1) % n] : (i < n - 1 ? pts[i + 1] : null);
    const n1 = prev ? leftNormal(prev, pts[i]) : null;
    const n2 = next ? leftNormal(pts[i], next) : null;
    if (n1 && n2) {
      const dot = n1.x * n2.x + n1.y * n2.y;
      const k = 1 + dot;
      if (k < 0.2) {
        out.push({ x: pts[i].x + n2.x * d, y: pts[i].y + n2.y * d });
      } else {
        const m = d / k;
        out.push({ x: pts[i].x + (n1.x + n2.x) * m, y: pts[i].y + (n1.y + n2.y) * m });
      }
    } else {
      const nrm = n1 ?? n2!;
      out.push({ x: pts[i].x + nrm.x * d, y: pts[i].y + nrm.y * d });
    }
  }
  return out;
}

// Signed area in y-down screen coordinates via the shoelace formula.
// Visually-CCW polygons return a negative value (the math y-up convention is
// inverted by the y-axis flip). Used to detect contour winding when offset
// direction depends on the orientation of the outer contour.
export function signedArea(pts: Pt[]): number {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

export function polyD(pts: Pt[], close: boolean): string {
  if (pts.length === 0) return '';
  let s = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) s += ` L ${pts[i].x} ${pts[i].y}`;
  if (close) s += ' Z';
  return s;
}

// Parses pure M/L polyline `d` strings. Returns null if the path uses any
// other command — caller falls back to getPointAtLength sampling.
export function parsePolylineD(d: string): Pt[] | null {
  const re = /([A-Za-z])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) tokens.push(m[0]);
  if (tokens.length === 0) return null;
  const pts: Pt[] = [];
  let i = 0;
  let mode: 'M' | 'L' | null = null;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z]$/.test(t)) {
      if (t === 'M' || t === 'L') { mode = t; i++; continue; }
      if (t === 'Z' || t === 'z') { i++; continue; }
      return null;
    }
    if (!mode) return null;
    const x = parseFloat(t);
    const y = parseFloat(tokens[i + 1] ?? '');
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push({ x, y });
    if (mode === 'M') mode = 'L';
    i += 2;
  }
  return pts.length >= 2 ? pts : null;
}

// Splits a `d` attribute on each M command. Each chunk starts with M (or m)
// and ends just before the next move command. Used to handle multi-contour
// glyphs (the natural form of any non-trivial vectorised text).
export function splitMSubpaths(d: string): string[] {
  return d.match(/[Mm][^Mm]*/g) ?? [];
}

// Samples a single sub-path's centerline by attaching a temp <path> alongside
// the original. Requires the original to be DOM-attached (it provides the
// parent element to host the temp). Returns null on degenerate paths.
export function sampleSubpath(parent: Element, subD: string): Pt[] | null {
  const NS = 'http://www.w3.org/2000/svg';
  const temp = document.createElementNS(NS, 'path');
  temp.setAttribute('d', subD);
  parent.appendChild(temp);
  try {
    let total = 0;
    try { total = temp.getTotalLength(); } catch { return null; }
    if (!Number.isFinite(total) || total <= 0) return null;
    const step = Math.max(0.1, Math.min(1, total / 500));
    const n = Math.max(2, Math.ceil(total / step));
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      try {
        const p = temp.getPointAtLength((i / n) * total);
        pts.push({ x: p.x, y: p.y });
      } catch { /* skip */ }
    }
    return pts.length >= 2 ? pts : null;
  } finally {
    temp.remove();
  }
}

// DOM-free sampling of an opentype.js Path's commands into polylines (one per
// subpath). Used by text.ts so that text grow is visible in preview without
// requiring the SVG to be DOM-attached first.
type OpentypeCmd =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'Z' };

export function sampleOpentypeCommands(commands: OpentypeCmd[], step: number): Pt[][] {
  const subs: Pt[][] = [];
  let cur: Pt[] = [];
  let lastX = 0, lastY = 0;
  const minStep = Math.max(0.01, step);
  for (const cmd of commands) {
    if (cmd.type === 'M') {
      if (cur.length > 1) subs.push(cur);
      cur = [{ x: cmd.x, y: cmd.y }];
      lastX = cmd.x; lastY = cmd.y;
    } else if (cmd.type === 'L') {
      const dx = cmd.x - lastX, dy = cmd.y - lastY;
      const len = Math.hypot(dx, dy);
      const n = Math.max(1, Math.ceil(len / minStep));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        cur.push({ x: lastX + dx * t, y: lastY + dy * t });
      }
      lastX = cmd.x; lastY = cmd.y;
    } else if (cmd.type === 'C') {
      const approx = Math.hypot(cmd.x1 - lastX, cmd.y1 - lastY)
        + Math.hypot(cmd.x2 - cmd.x1, cmd.y2 - cmd.y1)
        + Math.hypot(cmd.x - cmd.x2, cmd.y - cmd.y2);
      const n = Math.max(2, Math.ceil(approx / minStep));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        const px = u*u*u*lastX + 3*u*u*t*cmd.x1 + 3*u*t*t*cmd.x2 + t*t*t*cmd.x;
        const py = u*u*u*lastY + 3*u*u*t*cmd.y1 + 3*u*t*t*cmd.y2 + t*t*t*cmd.y;
        cur.push({ x: px, y: py });
      }
      lastX = cmd.x; lastY = cmd.y;
    } else if (cmd.type === 'Q') {
      const approx = Math.hypot(cmd.x1 - lastX, cmd.y1 - lastY)
        + Math.hypot(cmd.x - cmd.x1, cmd.y - cmd.y1);
      const n = Math.max(2, Math.ceil(approx / minStep));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        const px = u*u*lastX + 2*u*t*cmd.x1 + t*t*cmd.x;
        const py = u*u*lastY + 2*u*t*cmd.y1 + t*t*cmd.y;
        cur.push({ x: px, y: py });
      }
      lastX = cmd.x; lastY = cmd.y;
    } else if (cmd.type === 'Z') {
      if (cur.length > 1) subs.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) subs.push(cur);
  return subs;
}

// Offsets every closed subpath of `d` by `distance` (positive = outward in the
// subpath's natural winding). Open subpaths pass through verbatim. Useful for
// "grow" / "shrink" of filled-path content like vectorised text. Returns the
// new d string, or null if every subpath was unusable.
export function offsetFilledPathD(parent: Element, d: string, distance: number): string | null {
  if (Math.abs(distance) < 1e-9) return d;
  const subs = splitMSubpaths(d);
  if (subs.length === 0) return null;
  const parts: string[] = [];
  for (const sub of subs) {
    const closed = /[zZ]\s*$/.test(sub.trim());
    if (!closed) { parts.push(sub.trim()); continue; }
    let pts = parsePolylineD(sub);
    if (!pts) pts = sampleSubpath(parent, sub);
    if (!pts || pts.length < 3) continue;
    const ctr = pts.length > 1
      && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.1
      ? pts.slice(0, -1)
      : pts;
    const offset = offsetPolyline(ctr, distance, true);
    parts.push(polyD(offset, true));
  }
  return parts.length > 0 ? parts.join(' ') : null;
}
