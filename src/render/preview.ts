import { Project, Layer, BlendMode } from '../state/project';
import { makeSvg, rect, svgEl, applyGrow } from '../utils/svg';
import { renderLayer } from '../patterns';

function wrapLayer(layer: Layer, elements: SVGElement[]): SVGGElement {
  const g = svgEl('g', {
    'data-layer-id': layer.id,
    transform: `translate(${layer.offsetX} ${layer.offsetY})`,
  });
  for (const e of elements) g.appendChild(e);
  if (layer.grow > 0) applyGrow(g, layer.grow);
  return g;
}

function paintForMask(el: SVGElement, colour: string): SVGElement {
  if (el.hasAttribute('stroke') && el.getAttribute('stroke') !== 'none') el.setAttribute('stroke', colour);
  if (el.hasAttribute('fill') && el.getAttribute('fill') !== 'none') el.setAttribute('fill', colour);
  if (!el.hasAttribute('stroke')) el.setAttribute('stroke', colour);
  for (const child of Array.from(el.children) as SVGElement[]) paintForMask(child, colour);
  return el;
}

function buildMaskDef(
  id: string,
  mode: Exclude<BlendMode, 'normal'>,
  layer: Layer,
  elements: SVGElement[],
  W: number,
  H: number,
): SVGElement {
  const mask = svgEl('mask', { id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H });
  const bg = mode === 'intersect' ? '#000' : '#fff';
  const fg = mode === 'intersect' ? '#fff' : '#000';
  mask.appendChild(svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: bg }));
  const inner = svgEl('g', { transform: `translate(${layer.offsetX} ${layer.offsetY})` });
  for (const e of elements) inner.appendChild(paintForMask(e.cloneNode(true) as SVGElement, fg));
  // Honour layer-level grow inside the mask too — that's how users replace the
  // old "obstacle" feature: a text layer with grow=N + blendMode=exclude carves
  // a grown silhouette out of the layer below.
  if (layer.grow > 0) applyGrow(inner, layer.grow);
  mask.appendChild(inner);
  return mask;
}

export function buildPreviewSvg(project: Project): SVGSVGElement {
  const { width: W, height: H } = project.canvas;
  const svg = makeSvg(W, H);

  svg.appendChild(rect(0, 0, W, H, { stroke: '#bbb', 'stroke-width': 0.1 }));

  const defs = svgEl('defs');
  const clipId = 'canvas-bounds';
  const clip = svgEl('clipPath', { id: clipId });
  clip.appendChild(svgEl('rect', { x: 0, y: 0, width: W, height: H }));
  defs.appendChild(clip);
  svg.appendChild(defs);

  const stack: SVGElement[] = [];
  const guides: SVGElement[] = [];

  for (let i = 0; i < project.layers.length; i++) {
    const layer = project.layers[i];
    if (!layer.visible) continue;
    const elements = renderLayer(layer, project.canvas);

    if (layer.blendMode === 'normal') {
      stack.push(wrapLayer(layer, elements));
      continue;
    }

    // A mask only ever applies to the layer immediately below it in the array.
    // If that neighbour is invisible (or doesn't exist), the mask renders only
    // as a faint guide and we don't reach further down the stack.
    const below = project.layers[i - 1];
    const targetable = below && below.visible && below.blendMode === 'normal';
    const guide = wrapLayer(layer, elements);
    guide.setAttribute('class', 'mask-guide');
    guides.push(guide);
    if (!targetable) continue;
    const target = stack[stack.length - 1];
    if (!target) continue;

    const maskId = `mask_${layer.id}`;
    defs.appendChild(buildMaskDef(maskId, layer.blendMode, layer, elements, W, H));
    const wrapped = svgEl('g', { mask: `url(#${maskId})` });
    wrapped.appendChild(target);
    stack[stack.length - 1] = wrapped;
  }

  const clipped = svgEl('g', { 'clip-path': `url(#${clipId})` });
  for (const e of stack) clipped.appendChild(e);
  for (const g of guides) clipped.appendChild(g);
  svg.appendChild(clipped);

  if (project.selectedLayerId) {
    const sel = svg.querySelector(`.mask-guide[data-layer-id="${project.selectedLayerId}"]`);
    if (sel) sel.setAttribute('data-selected', 'true');
  }

  const selectedLayer = project.selectedLayerId
    ? project.layers.find((l) => l.id === project.selectedLayerId)
    : null;
  if (selectedLayer) {
    let zw = 0, zh = 0, ox = selectedLayer.offsetX, oy = selectedLayer.offsetY;
    const k = selectedLayer.pattern.kind;
    if (k === 'maze' || k === 'scatter' || k === 'geometric') {
      const p = selectedLayer.pattern.params as { zoneWidth?: number; zoneHeight?: number };
      zw = p.zoneWidth && p.zoneWidth > 0 ? p.zoneWidth : W;
      zh = p.zoneHeight && p.zoneHeight > 0 ? p.zoneHeight : H;
    } else if (k === 'shape') {
      const p = selectedLayer.pattern.params as { width: number; height: number };
      zw = p.width;
      zh = p.height;
      // Shapes are centred on the offset, so the bounding box top-left is offset-half.
      ox = selectedLayer.offsetX - zw / 2;
      oy = selectedLayer.offsetY - zh / 2;
    }
    if (zw > 0 && zh > 0) {
      const outline = svgEl('rect', {
        x: ox, y: oy, width: zw, height: zh,
        fill: 'none',
        stroke: '#c2410c',
        'stroke-width': 0.15,
        'stroke-dasharray': '0.8 0.6',
        class: 'maze-zone-outline',
      });
      svg.appendChild(outline);
    }
  }

  return svg;
}
