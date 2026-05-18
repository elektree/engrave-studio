import { Project, Layer, BlendMode, TextParams, BezierParams } from '../state/project';
import { makeSvg, rect, svgEl, applyGrow, paintForMask, parseSvgViewBoxText } from '../utils/svg';
import { renderLayer } from '../patterns';
import { buildRulerOverlay } from './ruler';
import { MATERIAL_BG } from './materials';
import { textBboxHalfMetrics } from '../patterns/text';
import { bezierShapeBBox, buildPathD as bezierPathD } from '../patterns/bezier';

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

export type PreviewUiState = {
  // Bezier-specific UI mode for the selected layer.
  //   'draw'  → in-progress pen-tool trace; minimal red overlay.
  //   'edit'  → editing anchors/handles; full type-aware overlay, no bbox.
  //   undefined → bounds mode; show bbox+resize gizmo, hide anchor overlay.
  bezierMode?: 'draw' | 'edit';
  // Index of the anchor whose handle is being actively dragged in pen mode
  // (mouse-down phase right after a new anchor was placed). Used to show its
  // temporary marker + dotted handle line; cleared on mouseup.
  bezierDraggingAnchorIdx?: number;
};

export function buildPreviewSvg(project: Project, uiState: PreviewUiState = {}): SVGSVGElement {
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

    // wrapLayer below mutates `elements` in-place when grow != 0 (applyGrow
    // walks the tree and changes stroke-width / geometry). The mask def needs
    // FRESH (un-grown) elements so its own applyGrow doesn't compound — pre-
    // clone before the guide step. Cheap and only when grow is active.
    const maskElements: SVGElement[] = layer.grow !== 0
      ? elements.map((e) => e.cloneNode(true) as SVGElement)
      : elements;

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
    defs.appendChild(buildMaskDef(maskId, layer.blendMode, layer, maskElements, W, H));
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
    } else if (k === 'bezier') {
      // The bezier bbox gizmo only shows in bounds mode (uiState.bezierMode
      // is undefined). Draw / edit modes use the dedicated anchor overlay
      // instead and skip the bbox entirely.
      const p = selectedLayer.pattern.params as BezierParams;
      if (!uiState.bezierMode && p.anchors.length >= 2) {
        const bb = bezierShapeBBox(p.anchors, p.closed);
        zw = Math.max(0, bb.x1 - bb.x0);
        zh = Math.max(0, bb.y1 - bb.y0);
        ox = selectedLayer.offsetX + bb.x0;
        oy = selectedLayer.offsetY + bb.y0;
        rotation = p.rotation || 0;
      }
    }
    if (zw > 0 && zh > 0) {
      // Group the outline + corner handles so a single rotate transform covers
      // both. Rotation pivot = the layer origin (canvas position of local
      // (0,0)). For shape / SVG this equals the bbox centre too; for bezier
      // the bbox may be off-centre but the layer still rotates around (0,0)
      // — keeping the gizmo and the rendered shape on the same pivot.
      const gizmoGroup = svgEl('g', {
        class: 'gizmo-group',
        // Keep materializeForLaser away — the gizmo is preview-only UI chrome.
        'data-no-expand': 'true',
        ...(rotation ? { transform: `rotate(${rotation} ${selectedLayer.offsetX} ${selectedLayer.offsetY})` } : {}),
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

  // Bezier overlay. Two modes:
  //   draw → minimal red overlay (round dot at anchor 0 as a "first point"
  //          reference, plus a dotted line + dot at the anchor currently
  //          being placed while its handle is being dragged out).
  //   edit → full interactive overlay with type-shaped markers + handles.
  // bounds (uiState.bezierMode undefined) → no overlay, just the bbox gizmo.
  if (selectedLayer && selectedLayer.pattern.kind === 'bezier' && !material
      && (uiState.bezierMode === 'edit' || uiState.bezierMode === 'draw')) {
    const params = selectedLayer.pattern.params as BezierParams;
    if (params.anchors.length > 0) {
      const rot = params.rotation || 0;
      const isDraw = uiState.bezierMode === 'draw';
      const wrap = svgEl('g', {
        'data-no-expand': 'true',
        class: 'bezier-overlay' + (isDraw ? ' bezier-overlay-readonly' : ''),
        ...(isDraw ? { 'pointer-events': 'none' } : {}),
        transform: `translate(${selectedLayer.offsetX} ${selectedLayer.offsetY})${rot ? ` rotate(${rot})` : ''}`,
      });

      if (isDraw) {
        // Anchor 0 marker — visible throughout draw mode so the user knows
        // where to click to close. Other anchors are NOT marked once their
        // mouseup has fired; only the in-progress one (dragIdx) is.
        const dragIdx = uiState.bezierDraggingAnchorIdx;
        const indicesToMark = new Set<number>();
        if (params.anchors.length > 0) indicesToMark.add(0);
        if (typeof dragIdx === 'number' && dragIdx >= 0 && dragIdx < params.anchors.length) {
          indicesToMark.add(dragIdx);
        }
        for (const i of indicesToMark) {
          const a = params.anchors[i];
          wrap.appendChild(svgEl('circle', {
            cx: a.x, cy: a.y, r: 0.55,
            fill: '#dc2626', stroke: 'none',
            class: 'bezier-anchor-draw',
          }));
        }
        // Handle preview: red dotted line from the in-progress anchor to its
        // outgoing handle endpoint (which tracks the cursor during the drag).
        if (typeof dragIdx === 'number' && dragIdx >= 0 && dragIdx < params.anchors.length) {
          const a = params.anchors[dragIdx];
          if (a.hxOut !== 0 || a.hyOut !== 0) {
            wrap.appendChild(svgEl('line', {
              x1: a.x, y1: a.y, x2: a.x + a.hxOut, y2: a.y + a.hyOut,
              stroke: '#dc2626', 'stroke-width': 0.18,
              'stroke-dasharray': '0.5 0.4',
            }));
          }
          // Mirror line for the incoming handle (helps the user see the
          // symmetric handle they're growing).
          if (a.hxIn !== 0 || a.hyIn !== 0) {
            wrap.appendChild(svgEl('line', {
              x1: a.x, y1: a.y, x2: a.x + a.hxIn, y2: a.y + a.hyIn,
              stroke: '#dc2626', 'stroke-width': 0.18,
              'stroke-dasharray': '0.5 0.4', opacity: 0.6,
            }));
          }
        }
        svg.appendChild(wrap);
      } else {
        // EDIT MODE — full overlay with hit-testable markers.
        // Segment hit-targets first (lowest z): an invisible thick path
        // receiving double-clicks for "insert anchor".
        // pointer-events: stroke makes the otherwise-invisible (transparent)
        // stroke catch hover/click events along its width.
        const segHit = svgEl('path', {
          d: bezierPathD(params.anchors, params.closed),
          fill: 'none',
          stroke: 'transparent',
          'stroke-width': 1.8,
          'pointer-events': 'stroke',
          'data-bezier-segment': 'true',
          'data-layer-id': selectedLayer.id,
        });
        wrap.appendChild(segHit);
        const n = params.anchors.length;
        // Handle lines + handle dots — only when a neighbour exists for that side.
        for (let i = 0; i < n; i++) {
          const a = params.anchors[i];
          const hasIn = params.closed || i > 0;
          const hasOut = params.closed || i < n - 1;
          if (hasIn && (a.hxIn !== 0 || a.hyIn !== 0)) {
            wrap.appendChild(svgEl('line', {
              x1: a.x, y1: a.y, x2: a.x + a.hxIn, y2: a.y + a.hyIn,
              stroke: '#c2410c', 'stroke-width': 0.1, opacity: 0.7,
            }));
            wrap.appendChild(svgEl('circle', {
              cx: a.x + a.hxIn, cy: a.y + a.hyIn, r: 0.4,
              fill: 'white', stroke: '#c2410c', 'stroke-width': 0.12,
              'data-bezier-handle': 'in',
              'data-bezier-anchor-idx': String(i),
              'data-layer-id': selectedLayer.id,
              class: 'bezier-handle',
            }));
          }
          if (hasOut && (a.hxOut !== 0 || a.hyOut !== 0)) {
            wrap.appendChild(svgEl('line', {
              x1: a.x, y1: a.y, x2: a.x + a.hxOut, y2: a.y + a.hyOut,
              stroke: '#c2410c', 'stroke-width': 0.1, opacity: 0.7,
            }));
            wrap.appendChild(svgEl('circle', {
              cx: a.x + a.hxOut, cy: a.y + a.hyOut, r: 0.4,
              fill: 'white', stroke: '#c2410c', 'stroke-width': 0.12,
              'data-bezier-handle': 'out',
              'data-bezier-anchor-idx': String(i),
              'data-layer-id': selectedLayer.id,
              class: 'bezier-handle',
            }));
          }
        }
        // Anchors on top of the handles so they're always grabbable. Shape
        // encodes the anchor type:
        //   symmetric → square   smooth → circle   corner/line → diamond
        // First anchor of an open path is tinted brighter so the close-click
        // target is obvious.
        for (let i = 0; i < n; i++) {
          const a = params.anchors[i];
          const isFirstOpen = i === 0 && !params.closed;
          const fill = isFirstOpen ? '#ea580c' : '#c2410c';
          wrap.appendChild(makeAnchorMarker(a, {
            fill,
            stroke: 'white',
            'stroke-width': 0.1,
            'data-bezier-anchor-idx': String(i),
            'data-layer-id': selectedLayer.id,
            class: 'bezier-anchor',
          }));
        }
        svg.appendChild(wrap);
      }
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

// Bezier anchor marker shaped per type — visual cue at a glance for which
// constraint applies. corner and line share the diamond (they're both
// "non-curve" anchors; line happens to lock handles to zero).
function makeAnchorMarker(
  a: { x: number; y: number; type: 'line' | 'corner' | 'smooth' | 'symmetric' },
  attrs: Record<string, string | number>,
): SVGElement {
  if (a.type === 'smooth') {
    return svgEl('circle', { cx: a.x, cy: a.y, r: 0.45, ...attrs });
  }
  if (a.type === 'symmetric') {
    const s = 0.7;
    return svgEl('rect', { x: a.x - s / 2, y: a.y - s / 2, width: s, height: s, ...attrs });
  }
  // corner | line → diamond (square rotated 45°)
  const s = 0.55;
  const pts = `${a.x},${a.y - s} ${a.x + s},${a.y} ${a.x},${a.y + s} ${a.x - s},${a.y}`;
  return svgEl('polygon', { points: pts, ...attrs });
}
