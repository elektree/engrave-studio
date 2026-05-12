import opentype from 'opentype.js';
import { Project, TextParams, BlendMode } from '../state/project';
import { renderLayer } from '../patterns';
import { svgEl, applyGrow } from '../utils/svg';
import { getCustomFont } from '../state/font-registry';

let cachedNoto: opentype.Font | null = null;
async function loadNotoSans(): Promise<opentype.Font> {
  if (cachedNoto) return cachedNoto;
  const buf = await fetch('/fonts/NotoSans-Regular.ttf').then((r) => {
    if (!r.ok) throw new Error('Could not load /fonts/NotoSans-Regular.ttf');
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

function textToPathElement(params: TextParams, font: opentype.Font): SVGElement {
  const tmp = font.getPath(params.content, 0, 0, params.sizeMm);
  const bbox = tmp.getBoundingBox();
  const bboxW = bbox.x2 - bbox.x1;
  let dx = 0;
  if (params.align === 'middle') dx = -bbox.x1 - bboxW / 2;
  else if (params.align === 'start') dx = -bbox.x1;
  else if (params.align === 'end') dx = -bbox.x1 - bboxW;
  // Vertical: bbox vertical centre at y=0 — text lives at layer-local (0, 0).
  const dy = -(bbox.y1 + bbox.y2) / 2;
  const p = font.getPath(params.content, dx, dy, params.sizeMm);
  const d = p.toPathData(3);
  let pivotX = 0;
  if (params.align === 'start') pivotX = bboxW / 2;
  else if (params.align === 'end') pivotX = -bboxW / 2;
  return svgEl('path', {
    d,
    transform: `rotate(${params.rotation} ${pivotX} 0)`,
    stroke: '#000',
    'stroke-width': params.strokeWidth,
    fill: 'none',
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

export async function exportLaserSvg(
  project: Project,
  options: { strokeOnly: boolean },
): Promise<string> {
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
    // Per-layer textToPath drives the vectorisation. Mask layers are never
    // visible in the export, so skip the expensive opentype call for them.
    const shouldVectoriseText =
      layer.pattern.kind === 'text'
      && (layer.pattern.params as TextParams).textToPath
      && layer.blendMode === 'normal';
    if (shouldVectoriseText) {
      const font = await resolveFont((layer.pattern.params as TextParams).fontFamily);
      if (font) {
        elements = [textToPathElement(layer.pattern.params as TextParams, font)];
      } else {
        // Font unavailable in opentype — fall back to renderer's <text> element.
        elements = renderLayer(layer, project.canvas);
      }
    } else {
      elements = renderLayer(layer, project.canvas);
    }

    const wrapper = svgEl('g', { transform: `translate(${layer.offsetX} ${layer.offsetY})` });
    for (const e of elements) wrapper.appendChild(e);
    if (layer.grow > 0) applyGrow(wrapper, layer.grow);

    if (layer.blendMode === 'normal') {
      if (options.strokeOnly) forceStroke(wrapper);
      stack.push(wrapper);
      continue;
    }

    // intersect/exclude only acts on the immediate layer below — must be visible.
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

  const clipped = svgEl('g', { 'clip-path': `url(#${clipId})` });
  for (const e of stack) clipped.appendChild(e);
  svg.appendChild(clipped);

  return new XMLSerializer().serializeToString(svg);
}

function forceStroke(el: SVGElement): void {
  const stroke = el.getAttribute('stroke');
  if (!stroke || stroke === 'none') el.setAttribute('stroke', '#000');
  if (!el.hasAttribute('stroke-width')) el.setAttribute('stroke-width', '0.1');
  el.setAttribute('fill', 'none');
  for (const child of Array.from(el.children) as SVGElement[]) forceStroke(child);
}

function paintForMask(el: SVGElement, colour: string): void {
  if (el.hasAttribute('stroke') && el.getAttribute('stroke') !== 'none') el.setAttribute('stroke', colour);
  if (el.hasAttribute('fill') && el.getAttribute('fill') !== 'none') el.setAttribute('fill', colour);
  if (!el.hasAttribute('stroke')) el.setAttribute('stroke', colour);
  for (const child of Array.from(el.children) as SVGElement[]) paintForMask(child, colour);
}
