import { TextParams, Project, Layer } from '../state/project';
import { svgEl } from '../utils/svg';
import { colorForDepth } from '../utils/palette';
import { getFontSync, ensureNotoSans } from '../state/font-registry';
import { Pt, offsetPolyline, polyD, sampleOpentypeCommands, signedArea } from '../render/path-offset';

// Rough bbox estimate so we can rotate around the visual centre. Width depends
// on the content + font size; height is roughly the font size.
function estimateHalfWidth(params: TextParams): number {
  return ((params.content?.length ?? 0) * params.sizeMm * 0.55) / 2;
}

export function renderText(params: TextParams, project: Project, layer: Layer): SVGElement[] {
  const color = colorForDepth(layer.depth, project.palette);

  // When grow != 0 we need vectorised geometry to apply the offset — preview
  // can't shrink a `<text>` element by attribute. Try to resolve the font
  // synchronously; if it's Noto Sans not yet loaded, kick off the async fetch
  // (subscribers re-render once it's cached).
  if (layer.grow !== 0) {
    const font = getFontSync(params.fontFamily);
    if (font) {
      const el = vectoriseGrowText(params, font, color, layer.grow);
      if (el) return [el];
    } else if (params.fontFamily === 'Noto Sans') {
      ensureNotoSans().catch(() => { /* the registry's subscriber wakes up the re-render anyway */ });
    }
    // Fall through to the <text> element below — grow won't be visible yet,
    // but the export still vectorises (where applyGrow re-applies the offset).
  }

  const halfW = estimateHalfWidth(params);
  let pivotX = 0;
  if (params.align === 'start') pivotX = halfW;
  else if (params.align === 'end') pivotX = -halfW;

  // `textToPath` is the "contours" flag in the UI. When true the glyph is
  // rendered as an outlined stroke (LightBurn will engrave just the outline).
  // When false the glyph is a filled silhouette (LightBurn will fill it).
  const outline = params.textToPath;
  const t = svgEl('text', {
    x: 0,
    y: 0,
    'font-family': params.fontFamily,
    'font-size': params.sizeMm,
    'text-anchor': params.align,
    'dominant-baseline': 'central',
    transform: `rotate(${params.rotation} ${pivotX} 0)`,
    fill: outline ? 'none' : color,
    stroke: outline ? color : 'none',
    ...(outline ? { 'stroke-width': params.strokeWidth, 'paint-order': 'stroke' } : {}),
  });
  t.textContent = params.content;
  return [t];
}

// Exposed for the preview layer — the text editor's click-capture rectangle
// is mounted at the SVG root (not inside the layer wrapper) so it stays
// reachable even when another layer wraps the text in a <g mask=…>.
export function textBboxHalfMetrics(params: TextParams): { halfW: number; halfH: number } {
  return {
    halfW: estimateHalfWidth(params),
    halfH: params.sizeMm * 0.7,
  };
}

// Build a vectorised path for the text with `grow` already baked into the
// outline (every closed subpath is offset). Marked `data-no-grow` so the
// generic applyGrow doesn't try to offset it a second time.
function vectoriseGrowText(
  params: TextParams,
  // opentype.Font — typed loosely to avoid importing the type just here.
  font: { getPath: (s: string, x: number, y: number, size: number) => { commands: unknown[]; getBoundingBox: () => { x1: number; y1: number; x2: number; y2: number } } },
  color: string,
  grow: number,
): SVGElement | null {
  const tmp = font.getPath(params.content, 0, 0, params.sizeMm);
  const bbox = tmp.getBoundingBox();
  const bboxW = bbox.x2 - bbox.x1;
  let dx = 0;
  if (params.align === 'middle') dx = -bbox.x1 - bboxW / 2;
  else if (params.align === 'start') dx = -bbox.x1;
  else if (params.align === 'end') dx = -bbox.x1 - bboxW;
  const dy = -(bbox.y1 + bbox.y2) / 2;
  const placed = font.getPath(params.content, dx, dy, params.sizeMm);

  // Sample the opentype commands into polylines, offset each by `grow`, emit
  // a single path with evenodd so glyph counters (holes) cut through.
  const step = Math.max(0.05, params.sizeMm / 200);
  const subs = sampleOpentypeCommands(placed.commands as Parameters<typeof sampleOpentypeCommands>[0], step);
  if (subs.length === 0) return null;
  // Different font formats emit contours in opposite windings (TrueType vs
  // CFF). With a fixed offset sign, the user's custom font shrinks for
  // negative grow while Noto Sans grows — depends on winding. Detect via the
  // largest contour and flip uniformly so positive grow always expands.
  const centerlines: Pt[][] = [];
  let outerSignedArea = 0;
  let maxAbs = 0;
  for (const pts of subs) {
    if (pts.length < 3) { centerlines.push([]); continue; }
    const ctr = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < step * 0.5
      ? pts.slice(0, -1)
      : pts;
    centerlines.push(ctr);
    const a = signedArea(ctr);
    if (Math.abs(a) > maxAbs) { maxAbs = Math.abs(a); outerSignedArea = a; }
  }
  // For my offsetPolyline (leftNormal in y-down points "below the edge"):
  // an outer contour with negative signed area is visually CCW → +grow
  // expands. Positive signed area → CW → +grow shrinks, so flip.
  const sign = outerSignedArea < 0 ? 1 : outerSignedArea > 0 ? -1 : 1;
  const parts: string[] = [];
  for (const ctr of centerlines) {
    if (ctr.length < 3) continue;
    const offset = offsetPolyline(ctr, grow * sign, true);
    parts.push(polyD(offset, true));
  }
  if (parts.length === 0) return null;

  let pivotX = 0;
  if (params.align === 'start') pivotX = bboxW / 2;
  else if (params.align === 'end') pivotX = -bboxW / 2;
  const outline = params.textToPath;
  return svgEl('path', {
    d: parts.join(' '),
    transform: `rotate(${params.rotation} ${pivotX} 0)`,
    fill: outline ? 'none' : color,
    stroke: outline ? color : 'none',
    ...(outline ? { 'stroke-width': params.strokeWidth } : {}),
    'fill-rule': 'evenodd',
    'data-no-grow': 'true',
  });
}
