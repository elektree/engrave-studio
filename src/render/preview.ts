import { Project, Layer, BlendMode, TextParams } from '../state/project';
import { makeSvg, rect, svgEl, applyGrow, paintForMask, parseSvgViewBoxText } from '../utils/svg';
import { renderLayer } from '../patterns';
import { buildRulerOverlay } from './ruler';
import { MATERIAL_BG } from './materials';
import { textBboxHalfMetrics } from '../patterns/text';

function wrapLayer(layer: Layer, elements: SVGElement[]): SVGGElement {
  const g = svgEl('g', {
    'data-layer-id': layer.id,
    transform: `translate(${layer.offsetX} ${layer.offsetY})`,
  });
  for (const e of elements) g.appendChild(e);
  if (layer.grow !== 0) applyGrow(g, layer.grow);
  return g;
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
  for (const e of elements) {
    const cloned = e.cloneNode(true) as SVGElement;
    paintForMask(cloned, fg);
    inner.appendChild(cloned);
  }
  // Honour layer-level grow inside the mask too — that's how users replace the
  // old "obstacle" feature: a text layer with grow=N + blendMode=exclude carves
  // a grown silhouette out of the layer below.
  if (layer.grow !== 0) applyGrow(inner, layer.grow);
  mask.appendChild(inner);
  return mask;
}

export function buildPreviewSvg(project: Project): SVGSVGElement {
  const { width: W, height: H } = project.canvas;
  const svg = makeSvg(W, H);

  // Canvas backdrop: a thin grey border for edit mode, a filled material
  // colour for "Aperçu" mode (so the engraved shapes read against the same
  // tone the laser will actually run on).
  const material = project.previewMaterial;
  if (material) {
    svg.appendChild(rect(0, 0, W, H, { stroke: 'none', fill: MATERIAL_BG[material] }));
  } else {
    svg.appendChild(rect(0, 0, W, H, { stroke: '#bbb', 'stroke-width': 0.1 }));
  }

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
    const elements = renderLayer(layer, project);

    if (layer.blendMode === 'normal') {
      stack.push(wrapLayer(layer, elements));
      continue;
    }

    // A mask only ever applies to the layer immediately below it in the array.
    // If that neighbour is invisible (or doesn't exist), the mask renders only
    // as a faint guide and we don't reach further down the stack.
    const below = project.layers[i - 1];
    const targetable = below && below.visible && below.blendMode === 'normal';
    // Skip the ghost-guide in material preview — it's pure UI chrome that
    // would muddy the "final result" view.
    if (!material) {
      const guide = wrapLayer(layer, elements);
      guide.setAttribute('class', 'mask-guide');
      guides.push(guide);
    }
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
    let rotation = 0;
    const k = selectedLayer.pattern.kind;
    if (k === 'maze' || k === 'scatter' || k === 'geometric') {
      const p = selectedLayer.pattern.params as { zoneWidth?: number; zoneHeight?: number };
      zw = p.zoneWidth && p.zoneWidth > 0 ? p.zoneWidth : W;
      zh = p.zoneHeight && p.zoneHeight > 0 ? p.zoneHeight : H;
    } else if (k === 'shape') {
      const p = selectedLayer.pattern.params as { width: number; height: number; rotation: number };
      zw = p.width;
      zh = p.height;
      // Shapes are centred on the offset, so the bounding box top-left is offset-half.
      ox = selectedLayer.offsetX - zw / 2;
      oy = selectedLayer.offsetY - zh / 2;
      rotation = p.rotation || 0;
    } else if (k === 'svg') {
      const p = selectedLayer.pattern.params as { svgText: string; scale: number; rotation: number };
      const vb = parseSvgViewBoxText(p.svgText);
      const scale = Math.max(p.scale, 0.001);
      zw = vb.w * scale;
      zh = vb.h * scale;
      ox = selectedLayer.offsetX - zw / 2;
      oy = selectedLayer.offsetY - zh / 2;
      rotation = p.rotation || 0;
    }
    if (zw > 0 && zh > 0) {
      // Group the outline + corner handles so a single rotate transform covers
      // both. Rotation pivot is the shape's centre (offset for shapes, bbox
      // centre for zones — which is unrotated, so no visual change).
      const cx = ox + zw / 2;
      const cy = oy + zh / 2;
      const gizmoGroup = svgEl('g', {
        class: 'gizmo-group',
        // Keep materializeForLaser away — the gizmo is preview-only UI chrome.
        'data-no-expand': 'true',
        ...(rotation ? { transform: `rotate(${rotation} ${cx} ${cy})` } : {}),
      });
      gizmoGroup.appendChild(svgEl('rect', {
        x: ox, y: oy, width: zw, height: zh,
        fill: 'none',
        stroke: '#c2410c',
        'stroke-width': 0.15,
        'stroke-dasharray': '0.8 0.6',
        class: 'maze-zone-outline',
      }));
      const r = 0.5; // corner marker radius in mm
      for (const [hx, hy] of [[ox, oy], [ox + zw, oy], [ox, oy + zh], [ox + zw, oy + zh]] as const) {
        gizmoGroup.appendChild(svgEl('circle', {
          cx: hx, cy: hy, r,
          fill: '#c2410c',
          stroke: 'white',
          'stroke-width': 0.1,
          class: 'gizmo-corner',
        }));
      }
      svg.appendChild(gizmoGroup);
    }
  }

  // Text editor click-capture overlay — mounted at the SVG root (above
  // everything, outside any mask wrappers) so a click within the text's
  // bbox triggers the editor even when another layer is wrapping the text
  // in a <g mask=…>. Only added for the selected text layer.
  if (selectedLayer && selectedLayer.pattern.kind === 'text' && !material) {
    const params = selectedLayer.pattern.params as TextParams;
    const { halfW, halfH } = textBboxHalfMetrics(params);
    const w = Math.max(2, halfW * 2);
    const h = Math.max(2, halfH * 2);
    let pivotX = 0;
    let x = -halfW;
    if (params.align === 'start') { pivotX = halfW; x = 0; }
    else if (params.align === 'end') { pivotX = -halfW; x = -halfW * 2; }
    svg.appendChild(svgEl('rect', {
      x, y: -halfH, width: w, height: h,
      fill: 'none', stroke: 'none',
      'pointer-events': 'fill',
      transform: `translate(${selectedLayer.offsetX} ${selectedLayer.offsetY}) rotate(${params.rotation} ${pivotX} 0)`,
      'data-text-hit': 'true',
      'data-layer-id': selectedLayer.id,
    }));
  }

  if (project.showRuler !== false) {
    svg.appendChild(buildRulerOverlay(W, H));
  }

  return svg;
}
