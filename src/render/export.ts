import opentype from 'opentype.js';
import { Project, TextParams, BlendMode } from '../state/project';
import { renderLayer } from '../patterns';
import { svgEl, applyGrow, paintForMask } from '../utils/svg';
import { getCustomFont } from '../state/font-registry';
import { snapToPalette } from '../utils/palette';
import { materializeForLaser } from './expand-strokes';

let cachedNoto: opentype.Font | null = null;
async function loadNotoSans(): Promise<opentype.Font> {
  if (cachedNoto) return cachedNoto;
  // Vite's `base` rewrites asset URLs at build time, but a hard-coded fetch
  // path skips that — use BASE_URL so the production deploy under
  // /engrave-studio/ resolves correctly.
  const url = `${import.meta.env.BASE_URL}fonts/NotoSans-Regular.ttf`;
  const buf = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Could not load ${url}`);
    return r.arrayBuffer();
  });
  cachedNoto = opentype.parse(buf);
  return cachedNoto;
}

async function resolveFont(family: string): Promise<opentype.Font | null> {
  const custom = getCustomFont(family);
  if (custom) return custom;
  if (family === 'Noto Sans') return loadNotoSans();
  return null;
}

function textToPathElement(params: TextParams, font: opentype.Font, color: string): SVGElement {
  const tmp = font.getPath(params.content, 0, 0, params.sizeMm);
  const bbox = tmp.getBoundingBox();
  const bboxW = bbox.x2 - bbox.x1;
  let dx = 0;
  if (params.align === 'middle') dx = -bbox.x1 - bboxW / 2;
  else if (params.align === 'start') dx = -bbox.x1;
  else if (params.align === 'end') dx = -bbox.x1 - bboxW;
  const dy = -(bbox.y1 + bbox.y2) / 2;
  const p = font.getPath(params.content, dx, dy, params.sizeMm);
  const d = p.toPathData(3);
  let pivotX = 0;
  if (params.align === 'start') pivotX = bboxW / 2;
  else if (params.align === 'end') pivotX = -bboxW / 2;
  const transform = `rotate(${params.rotation} ${pivotX} 0)`;
  // `textToPath` here means "contours" — outline the glyph at strokeWidth.
  // Otherwise emit the filled silhouette.
  if (params.textToPath) {
    return svgEl('path', {
      d, transform,
      stroke: color, 'stroke-width': params.strokeWidth, fill: 'none',
    });
  }
  return svgEl('path', {
    d, transform,
    fill: color, stroke: 'none',
  });
}

function buildMaskDef(
  id: string,
  mode: Exclude<BlendMode, 'normal'>,
  wrapper: SVGElement,
  W: number,
  H: number,
): SVGElement {
  const mask = svgEl('mask', { id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H });
  const bg = mode === 'intersect' ? '#000' : '#fff';
  const fg = mode === 'intersect' ? '#fff' : '#000';
  mask.appendChild(svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: bg }));
  const cloned = wrapper.cloneNode(true) as SVGElement;
  paintForMask(cloned, fg);
  mask.appendChild(cloned);
  return mask;
}

const LEAF_TAGS = new Set(['line', 'path', 'circle', 'ellipse', 'rect', 'polyline', 'polygon', 'text']);
// Pre-painted metadata containers — their contents are referenced by id, not
// emitted as visible geometry, so flattening must walk around them.
const COLLECT_SKIP_TAGS = new Set(['defs', 'mask', 'clipPath', 'symbol', 'pattern']);

// Collects leaves and remembers the cumulative ancestor transform AND mask AND
// clip-path so flattening into colour buckets preserves layer offsets, blend
// masks, and zone clips (e.g. geometric layer's zoneWidth/zoneHeight).
type CollectedLeaf = { el: SVGElement; transform: string; mask: string; clip: string };
function collectLeaves(
  root: SVGElement,
  parentTransform = '',
  parentMask = '',
  parentClip = '',
  out: CollectedLeaf[] = [],
): CollectedLeaf[] {
  const tag = root.nodeName.toLowerCase();
  if (COLLECT_SKIP_TAGS.has(tag)) return out;
  // Editor chrome (e.g. text hit-rects) never make it into the export.
  if (root.getAttribute?.('data-text-hit') === 'true') return out;
  const own = root.getAttribute('transform');
  const composed = own ? (parentTransform ? `${parentTransform} ${own}` : own) : parentTransform;
  const ownMask = root.getAttribute('mask');
  const mask = ownMask || parentMask;
  const ownClip = root.getAttribute('clip-path');
  const clip = ownClip || parentClip;
  if (LEAF_TAGS.has(tag)) {
    out.push({ el: root, transform: composed, mask, clip });
    return out;
  }
  for (const c of Array.from(root.children) as SVGElement[]) collectLeaves(c, composed, mask, clip, out);
  return out;
}

// Hoist any `<defs>` blocks nested inside a wrapper up to the SVG-level defs
// so id references (clipPath, mask) survive the bucketing flatten that drops
// the wrappers themselves.
function liftDefs(root: SVGElement, svgDefs: SVGElement): void {
  const found: SVGElement[] = [];
  const walk = (el: Element) => {
    for (const c of Array.from(el.children) as SVGElement[]) {
      if (c.nodeName.toLowerCase() === 'defs') found.push(c);
      else walk(c);
    }
  };
  walk(root);
  for (const d of found) {
    while (d.firstChild) svgDefs.appendChild(d.firstChild);
    d.remove();
  }
}

// Returns the leaf's effective color. Walks up the ancestor chain because
// renderers like maze set `stroke` on the outer <g> and rely on inheritance.
// Nearest explicit value wins: a stroke="none" on the leaf does suppress an
// ancestor's stroke colour, in which case we fall back to fill.
function leafColor(el: SVGElement): string | null {
  const stroke = nearestAttr(el, 'stroke');
  if (stroke && stroke !== 'none') return stroke;
  const fill = nearestAttr(el, 'fill');
  if (fill && fill !== 'none') return fill;
  return null;
}

function nearestAttr(el: SVGElement, name: string): string | null {
  let cur: Element | null = el;
  while (cur && cur.nodeName.toLowerCase() !== 'svg') {
    const v = cur.getAttribute(name);
    if (v) return v;
    cur = cur.parentElement;
  }
  return null;
}

function effectiveStrokeWidth(el: SVGElement): string | null {
  return nearestAttr(el, 'stroke-width');
}

export async function exportLaserSvg(project: Project): Promise<string> {
  const { width: W, height: H } = project.canvas;
  const svg = svgEl('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    width: `${W}mm`,
    height: `${H}mm`,
    viewBox: `0 0 ${W} ${H}`,
  });

  const defs = svgEl('defs');
  const clipId = 'canvas-bounds';
  const clip = svgEl('clipPath', { id: clipId });
  clip.appendChild(svgEl('rect', { x: 0, y: 0, width: W, height: H }));
  defs.appendChild(clip);
  svg.appendChild(defs);

  const stack: SVGElement[] = [];

  for (let i = 0; i < project.layers.length; i++) {
    const layer = project.layers[i];
    if (!layer.visible) continue;

    let elements: SVGElement[];
    // Always vectorise text on export — LightBurn can't render a `<text>`
    // element with an uploaded font, so we bake the glyph silhouette (or its
    // outline if "contours" is on) using opentype.js.
    if (layer.pattern.kind === 'text' && layer.blendMode === 'normal') {
      const params = layer.pattern.params as TextParams;
      const font = await resolveFont(params.fontFamily);
      if (font) {
        const color = snapToPalette(layer.depth, project.palette).color;
        elements = [textToPathElement(params, font, color)];
      } else {
        // No font resolved — fall back to <text> so something at least shows.
        elements = renderLayer(layer, project);
      }
    } else {
      elements = renderLayer(layer, project);
    }

    const wrapper = svgEl('g', { transform: `translate(${layer.offsetX} ${layer.offsetY})` });
    for (const e of elements) wrapper.appendChild(e);
    if (layer.grow !== 0) applyGrow(wrapper, layer.grow);

    if (layer.blendMode === 'normal') {
      stack.push(wrapper);
      continue;
    }
    const below = project.layers[i - 1];
    if (!below || !below.visible || below.blendMode !== 'normal') continue;
    const target = stack[stack.length - 1];
    if (!target) continue;
    const maskId = `mask_${layer.id}`;
    defs.appendChild(buildMaskDef(maskId, layer.blendMode, wrapper, W, H));
    const wrapped = svgEl('g', { mask: `url(#${maskId})` });
    wrapped.appendChild(target);
    stack[stack.length - 1] = wrapped;
  }

  // Multi-pass expansion needs the SVG attached to the document (path expansion
  // uses getPointAtLength). Host it offscreen while we mutate.
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;pointer-events:none;';
  const stageHost = svgEl('g', { 'data-stage-host': 'true' });
  for (const w of stack) stageHost.appendChild(w);
  svg.appendChild(stageHost);
  document.body.appendChild(host);
  host.appendChild(svg);

  try {
    // Materialise the whole SVG (not just wrappers) so mask defs at the SVG
    // root also get stroke→ribbon conversion — keeps the masked silhouette
    // consistent with the visible laser interpretation.
    materializeForLaser(svg, project.kerf, project.palette);

    // Hoist any wrapper-local <defs> (clipPath, etc.) to the SVG-level defs
    // before flattening — bucket leaves reference these ids by url(#…) and
    // would otherwise dangle once the wrappers are dropped.
    for (const w of stack) liftDefs(w, defs);

    // Bucket leaves by effective colour. Each leaf is cloned with its effective
    // stroke / stroke-width / fill set explicitly so the bucket can stay free
    // of inherited paint (allowing a single bucket to mix filled and stroked
    // elements of the same colour). Masks AND clip-paths captured on the way
    // down are re-applied per-leaf with wrapping groups.
    type Bucket = { color: string; entries: SVGElement[] };
    const buckets = new Map<string, Bucket>();
    for (const wrapper of stack) {
      for (const { el, transform, mask, clip } of collectLeaves(wrapper)) {
        const color = leafColor(el);
        if (!color) continue;
        const clone = el.cloneNode(true) as SVGElement;
        const sw = effectiveStrokeWidth(el);
        if (sw && !clone.getAttribute('stroke-width')) clone.setAttribute('stroke-width', sw);
        const stroke = nearestAttr(el, 'stroke');
        if (stroke && !clone.getAttribute('stroke')) clone.setAttribute('stroke', stroke);
        const fill = nearestAttr(el, 'fill');
        if (fill && !clone.getAttribute('fill')) clone.setAttribute('fill', fill);
        // When a clip-path is in play, the transform has to live on the
        // <g clip-path> wrapper rather than on the leaf — clipPath (lifted to
        // the SVG-level defs) is interpreted in the user space of the
        // referencing element, so the clip rect and the leaf must share the
        // same transformed coordinate frame.
        let entry: SVGElement = clone;
        if (clip) {
          const attrs: Record<string, string> = { 'clip-path': clip };
          if (transform) attrs.transform = transform;
          entry = svgEl('g', attrs, [entry]);
        } else if (transform) {
          clone.setAttribute('transform', transform);
        }
        if (mask) entry = svgEl('g', { mask }, [entry]);
        if (!buckets.has(color)) buckets.set(color, { color, entries: [] });
        buckets.get(color)!.entries.push(entry);
      }
    }

    const clipped = svgEl('g', { 'clip-path': `url(#${clipId})` });
    const colorOrder = new Map<string, number>();
    project.palette.forEach((e) => colorOrder.set(e.color.toLowerCase(), e.value));
    const ordered = Array.from(buckets.values()).sort((a, b) => {
      const av = colorOrder.get(a.color.toLowerCase()) ?? 1.001;
      const bv = colorOrder.get(b.color.toLowerCase()) ?? 1.001;
      return av - bv;
    });
    for (const { color, entries } of ordered) {
      const entry = project.palette.find((e) => e.color.toLowerCase() === color.toLowerCase());
      const id = entry ? entry.id : `depth-misc-${color.replace('#', '')}`;
      const bucket = svgEl('g', { id });
      for (const e of entries) bucket.appendChild(e);
      clipped.appendChild(bucket);
    }

    svg.removeChild(stageHost);
    svg.appendChild(clipped);
    cleanupSvgForExport(svg);
    return new XMLSerializer().serializeToString(svg);
  } finally {
    if (host.parentNode) host.parentNode.removeChild(host);
  }
}

// === LightBurn-friendly cleanup pass ===
//
// Strips namespace garbage (Inkscape/sodipodi/RDF/Dublin Core metadata),
// drops invisible elements (<metadata>/<title>/<desc>), rounds numeric
// attribute values to 3 decimal places (≈1 µm — well below the laser's
// physical precision), removes identity transforms, drops empty groups,
// and tags multi-subpath paths with `fill-rule="evenodd"` so glyph
// counters and shapes-with-holes render reliably in every parser.

const DROPPED_NS = new Set(['inkscape', 'sodipodi', 'dc', 'cc', 'rdf', 'xml']);
const DROPPED_TAGS = new Set(['metadata', 'title', 'desc']);
// 6 decimal places ≈ 1 nm — well below any laser's physical precision, but
// crucial when a transform string mixes a rounded `scale` with separately-
// computed `px` values (tile mode, where each instance position is derived
// from the *unrounded* scale). At 3 decimals the discrepancy showed up as a
// constant ~0.1 mm gap between adjacent tiles.
const ROUND_DECIMALS = 6;

function cleanupSvgForExport(root: SVGElement): void {
  walkClean(root);
  dropEmptyGroups(root);
}

function walkClean(el: Element): void {
  for (const c of Array.from(el.children)) {
    const tag = c.nodeName.toLowerCase();
    const local = tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag;
    const ns = tag.includes(':') ? tag.slice(0, tag.indexOf(':')) : '';
    if (DROPPED_TAGS.has(local) || DROPPED_NS.has(ns)) {
      c.remove();
      continue;
    }
    // Editor-only click-capture rectangles are never engraved.
    if (c.getAttribute('data-text-hit') === 'true') {
      c.remove();
      continue;
    }
    cleanAttributes(c);
    walkClean(c);
  }
}

function cleanAttributes(el: Element): void {
  // Strip namespace-prefixed attributes + their xmlns declarations.
  const toRemove: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name;
    if (name.startsWith('xmlns:')) {
      if (DROPPED_NS.has(name.slice(6))) toRemove.push(name);
      continue;
    }
    if (name.includes(':')) {
      const prefix = name.slice(0, name.indexOf(':'));
      if (DROPPED_NS.has(prefix)) toRemove.push(name);
    }
  }
  for (const name of toRemove) el.removeAttribute(name);

  // Round any float in the remaining attribute values.
  for (const attr of Array.from(el.attributes)) {
    if (!/\d\.\d/.test(attr.value)) continue;
    const rounded = roundFloats(attr.value, ROUND_DECIMALS);
    if (rounded !== attr.value) el.setAttribute(attr.name, rounded);
  }

  // Drop identity transforms (zero-translate, zero-rotate, unit-scale, etc.)
  const tx = el.getAttribute('transform');
  if (tx && isIdentityTransform(tx)) el.removeAttribute('transform');

  // Multi-subpath paths need fill-rule=evenodd to render holes correctly.
  if (el.nodeName.toLowerCase() === 'path') {
    const d = el.getAttribute('d') ?? '';
    const mCount = (d.match(/[Mm]/g) ?? []).length;
    if (mCount > 1 && !el.getAttribute('fill-rule')) {
      el.setAttribute('fill-rule', 'evenodd');
    }
  }
}

function dropEmptyGroups(el: Element): void {
  for (const c of Array.from(el.children)) dropEmptyGroups(c);
  if (el.nodeName.toLowerCase() !== 'g') return;
  if (el.children.length > 0) return;
  if (el.textContent && el.textContent.trim()) return;
  el.remove();
}

const FLOAT_RE = /-?\d*\.\d+(?:[eE][-+]?\d+)?/g;
function roundFloats(s: string, decimals: number): string {
  const k = Math.pow(10, decimals);
  return s.replace(FLOAT_RE, (m) => {
    const n = parseFloat(m);
    if (!Number.isFinite(n)) return m;
    return String(Math.round(n * k) / k);
  });
}

function isIdentityTransform(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  return /^translate\s*\(\s*0(?:\s*[,\s]\s*0)?\s*\)$/i.test(t)
    || /^rotate\s*\(\s*0(?:\s*[,\s]+[-\d.eE]+){0,2}\s*\)$/i.test(t)
    || /^scale\s*\(\s*1(?:\s*[,\s]\s*1)?\s*\)$/i.test(t)
    || /^matrix\s*\(\s*1\s*[,\s]+0\s*[,\s]+0\s*[,\s]+1\s*[,\s]+0\s*[,\s]+0\s*\)$/i.test(t);
}
