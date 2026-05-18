import { Store, Layer, Pattern, BezierAnchor, BezierParams } from '../state/project';
import { buildPreviewSvg } from '../render/preview';
import { materialPalette } from '../render/materials';
import { subscribeFontRegistry } from '../state/font-registry';
import { defaultSvgLayerParams, scaleForTargetSize } from '../patterns/svg-layer';
import { makeLayer } from '../state/project';
import { parseSvgViewBoxText } from '../utils/svg';
import { tr } from '../i18n';
import { splitCubic, bezierShapeBBox, normalizeAnchorForType, defaultHandlesForAnchor } from '../patterns/bezier';
import type { BezierAnchorType } from '../state/project';

type Edge = 'left' | 'right' | 'top' | 'bottom' | 'tl' | 'tr' | 'bl' | 'br';

// Rotate a (dx, dy) canvas-frame delta into the shape-local frame.
function rotateDelta(dx: number, dy: number, rotationDeg: number): { x: number; y: number } {
  if (rotationDeg === 0) return { x: dx, y: dy };
  const a = -rotationDeg * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function mountCanvasPanel(container: HTMLElement, store: Store): void {
  container.innerHTML = '';
  container.classList.add('canvas-panel');

  const viewport = document.createElement('div');
  viewport.className = 'preview-viewport';
  viewport.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  container.appendChild(viewport);

  const wrap = document.createElement('div');
  wrap.className = 'preview-wrap';
  viewport.appendChild(wrap);

  // Floating control bar — visible regardless of preview mode.
  const overlay = document.createElement('div');
  overlay.className = 'canvas-overlay-controls';

  const rulerLabel = document.createElement('label');
  rulerLabel.className = 'warnings-toggle';
  const rulerInput = document.createElement('input');
  rulerInput.type = 'checkbox';
  rulerInput.checked = store.get().showRuler !== false;
  rulerLabel.appendChild(rulerInput);
  rulerLabel.appendChild(document.createTextNode(' Règle'));
  rulerInput.onchange = () => store.update((p) => ({ ...p, showRuler: rulerInput.checked }));
  overlay.appendChild(rulerLabel);

  viewport.appendChild(overlay);
  store.subscribe(() => {
    const ruler = store.get().showRuler !== false;
    if (rulerInput.checked !== ruler) rulerInput.checked = ruler;
  });

  // Floating message shown while the selected bezier layer is empty in
  // draw mode — disappears as soon as the first anchor is placed.
  const drawMessage = document.createElement('div');
  drawMessage.className = 'canvas-draw-message';
  drawMessage.textContent = 'Cliquez pour placer le premier point';
  drawMessage.style.cssText =
    'position:absolute;top:12px;left:50%;transform:translateX(-50%);'
    + 'background:rgba(220,38,38,0.92);color:white;padding:6px 14px;'
    + 'border-radius:14px;font-size:13px;pointer-events:none;'
    + 'display:none;z-index:5;font-weight:500;';
  viewport.appendChild(drawMessage);
  const updateDrawMessageVisibility = (): void => {
    const p = store.get();
    const sel = p.layers.find((l) => l.id === p.selectedLayerId);
    const show = !!sel && sel.pattern.kind === 'bezier'
      && sel.pattern.params.anchors.length === 0
      && getBezierMode() === 'draw';
    drawMessage.style.display = show ? 'block' : 'none';
  };

  // viewBox-based pan/zoom — the canonical SVG zoom. The browser re-renders
  // vector content for every viewBox change so we never get rastered pixels.
  let vbX = 0;        // viewBox origin in canvas mm
  let vbY = 0;
  let vbScale = 1;    // 1 = canvas fills viewport (preserve aspect)

  let svgRoot: SVGSVGElement | null = null;

  // Inline text editing state — referenced by rerender so it must live at the
  // top of the closure. Wired up later.
  let textEditingId: string | null = null;
  let textEditInput: HTMLInputElement | null = null;
  let textEditDetach: (() => void) | null = null;
  let textEditOriginal = '';

  // Bezier UI mode for the selected layer. Three states:
  //   { mode: 'draw' } — pen-tool active, path not yet committed. No gizmos.
  //   { mode: 'edit' } — anchors editable, no bbox.
  //   null            — bounds mode (default for an existing bezier layer);
  //                     bbox gizmo + draggable, single click on the shape
  //                     re-enters edit mode.
  let bezierUiMode: { layerId: string; mode: 'draw' | 'edit' } | null = null;
  // Last anchor the user interacted with — Backspace targets this index.
  let activeAnchorIdx: { layerId: string; idx: number } | null = null;
  // Current drag — declared up here (rerender reads it for the bezier
  // pen-handle preview overlay). The DragKind union is declared further down
  // but TS type declarations are hoisted so the annotation resolves fine.
  let drag: DragKind | null = null;

  const getBezierMode = (): 'draw' | 'edit' | null => {
    if (!bezierUiMode) return null;
    const sel = store.get().selectedLayerId;
    if (sel !== bezierUiMode.layerId) return null;
    const layer = store.get().layers.find((l) => l.id === bezierUiMode!.layerId);
    if (!layer || layer.pattern.kind !== 'bezier') return null;
    return bezierUiMode.mode;
  };

  // Sync mode flag with the store: a freshly-created empty bezier layer
  // enters draw mode automatically; switching to another layer drops mode.
  store.subscribe(() => {
    const p = store.get();
    const sel = p.layers.find((l) => l.id === p.selectedLayerId);
    if (sel && sel.pattern.kind === 'bezier' && sel.pattern.params.anchors.length === 0
        && (!bezierUiMode || bezierUiMode.layerId !== sel.id)) {
      bezierUiMode = { layerId: sel.id, mode: 'draw' };
    } else if (bezierUiMode && p.selectedLayerId !== bezierUiMode.layerId) {
      bezierUiMode = null;
    }
    if (activeAnchorIdx && activeAnchorIdx.layerId !== p.selectedLayerId) {
      activeAnchorIdx = null;
    }
  });

  // Screen-mm → bezier local coordinate. Local frame is centred on
  // layer.offset; rotation pivots around the local origin so the inverse is
  // a straight unrotate around (0, 0). This is the same pivot used by the
  // renderer + overlay, and it stays constant across anchor edits → no drift.
  const canvasToBezierLocal = (layer: Layer, canvasX: number, canvasY: number): { x: number; y: number } => {
    if (layer.pattern.kind !== 'bezier') return { x: canvasX - layer.offsetX, y: canvasY - layer.offsetY };
    const rot = layer.pattern.params.rotation || 0;
    const dx = canvasX - layer.offsetX;
    const dy = canvasY - layer.offsetY;
    if (rot === 0) return { x: dx, y: dy };
    const a = -rot * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  };

  const getCanvasDims = () => store.get().canvas;

  // Recompute the overlay input's position + transform against the current
  // SVG text element's CTM. Called whenever the viewBox or the SVG tree
  // changes — keeps the overlay glued to the canvas instead of the viewport.
  // Resolve the live edit anchor for a text layer — <text> if it survived
  // the renderer, otherwise the vectorised <path> (grow != 0 case), with
  // the wrapper group as a final fallback so the overlay can at least sit
  // at the right offset.
  const findTextAnchor = (layerId: string): SVGGraphicsElement | null => {
    const wrapEl = wrap.querySelector(`g[data-layer-id="${layerId}"]`) as SVGGraphicsElement | null;
    if (!wrapEl) return null;
    return (wrapEl.querySelector('text')
      ?? wrapEl.querySelector('path[data-no-grow="true"]')
      ?? wrapEl) as SVGGraphicsElement;
  };

  const repositionTextEditOverlay = (anchor?: SVGGraphicsElement | null) => {
    if (!textEditInput || !textEditingId) return;
    const textEl = anchor ?? findTextAnchor(textEditingId);
    if (!textEl) return;
    const layer = store.get().layers.find((l) => l.id === textEditingId);
    if (!layer || layer.pattern.kind !== 'text') return;
    const ctm = textEl.getScreenCTM();
    if (!ctm) return;
    const sizeMm = layer.pattern.params.sizeMm;
    const align = layer.pattern.params.align;
    const widthLocal = 5000;
    const heightLocal = sizeMm * 1.4;
    let localLeft = -widthLocal / 2;
    if (align === 'start') localLeft = 0;
    else if (align === 'end') localLeft = -widthLocal;
    const localTop = -heightLocal / 2;
    const screenX = ctm.a * localLeft + ctm.c * localTop + ctm.e;
    const screenY = ctm.b * localLeft + ctm.d * localTop + ctm.f;
    textEditInput.style.left = `${screenX}px`;
    textEditInput.style.top = `${screenY}px`;
    textEditInput.style.transform = `matrix(${ctm.a}, ${ctm.b}, ${ctm.c}, ${ctm.d}, 0, 0)`;
  };

  const applyViewBox = () => {
    if (!svgRoot) return;
    const { width: W, height: H } = getCanvasDims();
    const vbW = W / vbScale;
    const vbH = H / vbScale;
    svgRoot.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
    // Zoom and pan change the SVG's screen CTM — keep the overlay in sync.
    if (textEditingId) repositionTextEditOverlay();
  };

  const rerender = () => {
    wrap.innerHTML = '';
    const project = store.get();
    // Material aperçu: swap palette for the burn-colour ramp and strip any UI
    // chrome (selection, ruler) so the canvas reads as a "final result" view.
    // The actual store stays untouched — only the render input is overridden.
    const material = project.previewMaterial;
    const renderInput = material
      ? { ...project, palette: materialPalette(material, project.palette), selectedLayerId: null, showRuler: false }
      : project;
    const uiState = {
      bezierMode: getBezierMode() ?? undefined,
      bezierDraggingAnchorIdx: (drag && drag.kind === 'bezier-pen-handle') ? drag.idx : undefined,
    };
    svgRoot = buildPreviewSvg(renderInput, uiState);
    updateDrawMessageVisibility();
    applyViewBox();
    wrap.appendChild(svgRoot);
    viewport.classList.toggle('preview-material', !!material);
    viewport.classList.toggle(`preview-${material ?? ''}`, !!material);
    if (textEditingId) {
      const editingEl = findTextAnchor(textEditingId);
      if (editingEl) (editingEl as unknown as HTMLElement).style.visibility = 'hidden';
      // Fresh DOM node — CTM may differ if the user changed transforms.
      repositionTextEditOverlay(editingEl);
    }
    const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts;
    if (fonts) {
      for (const layer of project.layers) {
        if (!layer.visible || layer.pattern.kind !== 'text') continue;
        const fam = (layer.pattern.params as { fontFamily: string }).fontFamily;
        if (fam) fonts.load(`16px "${fam}"`).catch(() => { /* unavailable family */ });
      }
    }
  };

  store.subscribe(rerender);
  // Font registry updates (custom uploads, Noto Sans async load completion)
  // can change the synchronous vectoriser path in text.ts — re-render so the
  // grow-aware text picks up the newly available font.
  subscribeFontRegistry(rerender);
  rerender();

  const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts;
  fonts?.addEventListener('loadingdone', rerender);

  // Metrics derived from the viewport rect and current viewBox.
  const metrics = () => {
    const vp = viewport.getBoundingClientRect();
    const { width: W, height: H } = getCanvasDims();
    const vbW = W / vbScale;
    const vbH = H / vbScale;
    // preserveAspectRatio="xMidYMid meet" fits the viewBox into the viewport.
    const effScale = Math.min(vp.width / vbW, vp.height / vbH);
    const meetLeft = (vp.width - vbW * effScale) / 2;
    const meetTop = (vp.height - vbH * effScale) / 2;
    return { vp, effScale, meetLeft, meetTop, vbW, vbH };
  };

  // Convert a screen-pixel point (relative to the viewport) to canvas-mm.
  const screenToCanvas = (clientX: number, clientY: number) => {
    const m = metrics();
    const userX = vbX + (clientX - m.vp.left - m.meetLeft) / m.effScale;
    const userY = vbY + (clientY - m.vp.top - m.meetTop) / m.effScale;
    return { x: userX, y: userY };
  };

  // Wheel zoom anchored to the cursor.
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.min(50, Math.max(0.1, vbScale * factor));
    // Cursor in canvas-mm before zoom.
    const before = screenToCanvas(e.clientX, e.clientY);
    vbScale = newScale;
    // After zoom: keep the same cursor location → adjust vbX/Y so screenToCanvas
    // returns the same point at the same screen position.
    const m2 = metrics();
    vbX = before.x - (e.clientX - m2.vp.left - m2.meetLeft) / m2.effScale;
    vbY = before.y - (e.clientY - m2.vp.top - m2.meetTop) / m2.effScale;
    applyViewBox();
  }, { passive: false });

  // ── Edge gizmos for zones ────────────────────────────────
  // The selected layer (maze/scatter/geometric) has zoneWidth/zoneHeight. We
  // hit-test the 4 edges in canvas-mm; dragging an edge resizes the zone, with
  // Shift = symmetric (both opposite edges toward / away from centre).

  // Layer-kind-specific zone geometry. `centred` means the layer offset is the
  // centre of the rect (shapes), not the top-left corner (zones).
  type ZoneRect = {
    layerId: string;
    x0: number; y0: number; x1: number; y1: number;
    widthKey: string; heightKey: string;
    centred: boolean;
    rotation: number;   // degrees, around the rect's centre (shape / svg only)
    cx: number; cy: number;  // rect centre in canvas mm
    // For SVG layers we don't have independent width/height — there's a single
    // `scale` param. When set, applyZoneEdgeDrag converts size changes back
    // into a scale multiplier (and enforces uniform aspect on every handle).
    scaleBase?: number;
    // For bezier layers: a snapshot of the anchors at drag-start, plus the
    // bbox half-extents in local coords. applyZoneEdgeDrag scales the
    // anchors by ratioX/ratioY when these are set.
    bezierBase?: { anchors: BezierAnchor[]; baseW: number; baseH: number; bbCxLocal: number; bbCyLocal: number };
  };
  function selectedZoneRect(): ZoneRect | null {
    const project = store.get();
    const sel = project.layers.find((l) => l.id === project.selectedLayerId);
    if (!sel) return null;
    const k = sel.pattern.kind;
    if (k === 'maze' || k === 'scatter' || k === 'geometric') {
      const p = sel.pattern.params as { zoneWidth?: number; zoneHeight?: number };
      const zw = p.zoneWidth && p.zoneWidth > 0 ? p.zoneWidth : store.get().canvas.width;
      const zh = p.zoneHeight && p.zoneHeight > 0 ? p.zoneHeight : store.get().canvas.height;
      return {
        layerId: sel.id,
        x0: sel.offsetX, y0: sel.offsetY,
        x1: sel.offsetX + zw, y1: sel.offsetY + zh,
        widthKey: 'zoneWidth', heightKey: 'zoneHeight',
        centred: false,
        rotation: 0,
        cx: sel.offsetX + zw / 2, cy: sel.offsetY + zh / 2,
      };
    }
    if (k === 'shape') {
      const p = sel.pattern.params as { width: number; height: number; rotation: number };
      return {
        layerId: sel.id,
        x0: sel.offsetX - p.width / 2, y0: sel.offsetY - p.height / 2,
        x1: sel.offsetX + p.width / 2, y1: sel.offsetY + p.height / 2,
        widthKey: 'width', heightKey: 'height',
        centred: true,
        rotation: p.rotation || 0,
        cx: sel.offsetX, cy: sel.offsetY,
      };
    }
    if (k === 'svg') {
      const p = sel.pattern.params as { svgText: string; scale: number; rotation: number };
      const vb = parseSvgViewBoxText(p.svgText);
      const scale = Math.max(p.scale, 0.001);
      const bboxW = vb.w * scale;
      const bboxH = vb.h * scale;
      return {
        layerId: sel.id,
        x0: sel.offsetX - bboxW / 2, y0: sel.offsetY - bboxH / 2,
        x1: sel.offsetX + bboxW / 2, y1: sel.offsetY + bboxH / 2,
        widthKey: 'scale', heightKey: 'scale',
        centred: true,
        rotation: p.rotation || 0,
        cx: sel.offsetX, cy: sel.offsetY,
        scaleBase: scale,
      };
    }
    if (k === 'bezier') {
      // Only expose the edge gizmo in bounds mode (no edit, no draw). The
      // bbox hugs the rendered shape (sampled), not the control hull.
      if (bezierUiMode && bezierUiMode.layerId === sel.id) return null;
      const p = sel.pattern.params as BezierParams;
      if (p.anchors.length < 2) return null;
      const bb = bezierShapeBBox(p.anchors, p.closed);
      const w = Math.max(0.0001, bb.x1 - bb.x0);
      const h = Math.max(0.0001, bb.y1 - bb.y0);
      const cxLocal = (bb.x0 + bb.x1) / 2;
      const cyLocal = (bb.y0 + bb.y1) / 2;
      // Rotation pivot for the gizmo = the layer origin (canvas position of
      // local (0, 0)). Same pivot used by the renderer / overlay; the bbox
      // may sit off-centre but it orbits the same point.
      return {
        layerId: sel.id,
        x0: sel.offsetX + bb.x0, y0: sel.offsetY + bb.y0,
        x1: sel.offsetX + bb.x1, y1: sel.offsetY + bb.y1,
        widthKey: '__bezier_w__', heightKey: '__bezier_h__',
        centred: true,
        rotation: p.rotation || 0,
        cx: sel.offsetX, cy: sel.offsetY,
        bezierBase: {
          anchors: p.anchors.map((a) => ({ ...a })),
          baseW: w, baseH: h,
          bbCxLocal: cxLocal, bbCyLocal: cyLocal,
        },
      };
    }
    return null;
  }

  // Convert a canvas-mm point into the rect's local (un-rotated) frame.
  function toLocal(rect: ZoneRect, x: number, y: number): { x: number; y: number } {
    const d = rotateDelta(x - rect.cx, y - rect.cy, rect.rotation);
    return { x: d.x + rect.cx, y: d.y + rect.cy };
  }

  function hitEdge(canvasX: number, canvasY: number): Edge | null {
    const rect = selectedZoneRect();
    if (!rect) return null;
    const m = metrics();
    // 8 screen pixels in canvas mm — feels right regardless of zoom level.
    const tol = 8 / m.effScale;
    // Hit-test in the rect's local frame so rotated shapes get matching gizmos.
    const { x: cx, y: cy } = toLocal(rect, canvasX, canvasY);
    // Corner hits first (small priority box around each corner).
    const nearLeft = Math.abs(cx - rect.x0) < tol;
    const nearRight = Math.abs(cx - rect.x1) < tol;
    const nearTop = Math.abs(cy - rect.y0) < tol;
    const nearBottom = Math.abs(cy - rect.y1) < tol;
    if (nearLeft && nearTop) return 'tl';
    if (nearRight && nearTop) return 'tr';
    if (nearLeft && nearBottom) return 'bl';
    if (nearRight && nearBottom) return 'br';
    const insideX = cx > rect.x0 - tol && cx < rect.x1 + tol;
    const insideY = cy > rect.y0 - tol && cy < rect.y1 + tol;
    if (insideY && nearLeft) return 'left';
    if (insideY && nearRight) return 'right';
    if (insideX && nearTop) return 'top';
    if (insideX && nearBottom) return 'bottom';
    return null;
  }

  // Cursor hint based on the edge AND the rect's rotation. Rotation snaps to
  // the nearest quadrant so the cursor visually matches the diagonal.
  function cursorFor(edge: Edge, rotation: number): string {
    // Normalise to [0, 360). For a 90°-rotated rect, what was 'left' becomes
    // 'top' visually — so we rotate the cursor hint accordingly.
    const r = ((rotation % 360) + 360) % 360;
    const quadrant = Math.round(r / 90) % 4;  // 0..3 for 0/90/180/270
    if (edge === 'left' || edge === 'right') {
      return (quadrant === 1 || quadrant === 3) ? 'ns-resize' : 'ew-resize';
    }
    if (edge === 'top' || edge === 'bottom') {
      return (quadrant === 1 || quadrant === 3) ? 'ew-resize' : 'ns-resize';
    }
    // Corners
    if (edge === 'tl' || edge === 'br') {
      return (quadrant === 1 || quadrant === 3) ? 'nesw-resize' : 'nwse-resize';
    }
    return (quadrant === 1 || quadrant === 3) ? 'nwse-resize' : 'nesw-resize';
  }

  function updateZoneCursor(e: MouseEvent) {
    if (drag) return; // cursor is set by drag mode
    if (store.get().previewMaterial) { viewport.style.cursor = ''; return; }
    const pos = screenToCanvas(e.clientX, e.clientY);
    const edge = hitEdge(pos.x, pos.y);
    if (!edge) { viewport.style.cursor = ''; return; }
    const rect = selectedZoneRect();
    viewport.style.cursor = cursorFor(edge, rect?.rotation ?? 0);
  }

  type DragKind =
    | { kind: 'pan'; startX: number; startY: number; baseVbX: number; baseVbY: number }
    | {
        kind: 'layer';
        layerId: string;
        startX: number; startY: number;
        baseOx: number; baseOy: number;
        pxPerMm: number;
        // True when the user pressed on an already-selected text element. If
        // they release without moving past the drag threshold we enter inline
        // edit instead of treating the gesture as a no-op drag.
        potentialEdit?: boolean;
        editClickEvent?: MouseEvent;
      }
    | {
        kind: 'edge'; layerId: string; edge: Edge;
        startX: number; startY: number;
        baseOffsetX: number; baseOffsetY: number;
        baseZw: number; baseZh: number;
        widthKey: string; heightKey: string;
        centred: boolean;
        rotation: number;
        // SVG layers: write the size change back as a scale multiplier on this
        // base. Also forces uniform aspect on every handle (no non-uniform
        // stretch on an imported vector).
        scaleBase?: number;
        // Bezier layers: snapshot of the anchors at drag-start; applyZoneEdgeDrag
        // scales their coords by the new bbox ratios.
        bezierBase?: { anchors: BezierAnchor[]; baseW: number; baseH: number; bbCxLocal: number; bbCyLocal: number };
      }
    | {
        kind: 'bezier-anchor'; layerId: string; idx: number;
        baseAnchor: BezierAnchor;
        startLocal: { x: number; y: number };
      }
    | {
        kind: 'bezier-handle'; layerId: string; idx: number;
        side: 'in' | 'out';
        baseAnchor: BezierAnchor;
        startLocal: { x: number; y: number };
      }
    | {
        // Pen mode: dragging out the handles of the anchor just added.
        kind: 'bezier-pen-handle'; layerId: string; idx: number;
        startLocal: { x: number; y: number };
      };

  // Signed effect of each handle on the (X, Y) axes. -1 means "this side
  // shrinks as the cursor moves positive on the axis", +1 means "grows", 0
  // means "doesn't move along this axis".
  const EDGE_INFO: Record<Edge, { sigX: -1 | 0 | 1; sigY: -1 | 0 | 1 }> = {
    left:   { sigX: -1, sigY: 0 },
    right:  { sigX: 1,  sigY: 0 },
    top:    { sigX: 0,  sigY: -1 },
    bottom: { sigX: 0,  sigY: 1 },
    tl:     { sigX: -1, sigY: -1 },
    tr:     { sigX: 1,  sigY: -1 },
    bl:     { sigX: -1, sigY: 1 },
    br:     { sigX: 1,  sigY: 1 },
  };

  viewport.addEventListener('mousedown', (e) => {
    // Aperçu mode is a frozen render — pan still works, everything else is
    // disabled to keep the "final result" view chrome-free and uneditable.
    if (store.get().previewMaterial) {
      if (e.button === 1) {
        drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, baseVbX: vbX, baseVbY: vbY };
        viewport.classList.add('panning');
        e.preventDefault();
      }
      return;
    }
    if (e.button === 1) {
      drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, baseVbX: vbX, baseVbY: vbY };
      viewport.classList.add('panning');
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    // ── Bezier interactions ────────────────────────────────────────────────
    // Three modes: draw (no gizmos, pen-tool) / edit (anchor gizmos) / bounds
    // (bbox + resize like shape layers). Each mode owns its hit-testing here.
    {
      const project = store.get();
      const sel = project.layers.find((l) => l.id === project.selectedLayerId);
      if (sel && sel.pattern.kind === 'bezier') {
        const params = sel.pattern.params;
        const mPx = metrics().effScale;
        const posMm = screenToCanvas(e.clientX, e.clientY);
        const local = canvasToBezierLocal(sel, posMm.x, posMm.y);
        const tolMm = 8 / mPx;
        const layerId = sel.id;
        const mode = getBezierMode();

        if (mode === 'draw') {
          // Click on first anchor closes the path (requires ≥ 2 anchors)
          // AND counts as draft validation — same as Enter / explicit commit.
          if (params.anchors.length >= 2 && !params.closed) {
            const a0 = params.anchors[0];
            if (Math.hypot(local.x - a0.x, local.y - a0.y) <= tolMm) {
              commitBezierDraft(layerId, true);
              rerender(); // mode flipped to 'edit'; rerender shows anchors
              e.preventDefault();
              return;
            }
          }
          // Otherwise: append a new anchor; drag grows handles symmetrically.
          const newAnchor: BezierAnchor = {
            x: local.x, y: local.y,
            hxIn: 0, hyIn: 0, hxOut: 0, hyOut: 0,
            type: 'symmetric',
          };
          let newIdx = -1;
          store.update((p) => {
            p.layers = p.layers.map((l) => {
              if (l.id !== layerId || l.pattern.kind !== 'bezier') return l;
              const anchors = [...l.pattern.params.anchors, newAnchor];
              newIdx = anchors.length - 1;
              return { ...l, pattern: { ...l.pattern, params: { ...l.pattern.params, anchors } } };
            });
          });
          activeAnchorIdx = { layerId, idx: newIdx };
          drag = { kind: 'bezier-pen-handle', layerId, idx: newIdx, startLocal: local };
          viewport.classList.add('dragging-layer');
          e.preventDefault();
          return;
        }

        if (mode === 'edit') {
          // Anchor hit-test (highest priority — the marker sits on top).
          let anchorIdx = -1;
          for (let i = 0; i < params.anchors.length; i++) {
            const a = params.anchors[i];
            if (Math.hypot(local.x - a.x, local.y - a.y) <= tolMm) { anchorIdx = i; break; }
          }
          if (anchorIdx >= 0) {
            const a = params.anchors[anchorIdx];
            activeAnchorIdx = { layerId, idx: anchorIdx };
            drag = { kind: 'bezier-anchor', layerId, idx: anchorIdx, baseAnchor: { ...a }, startLocal: local };
            viewport.classList.add('dragging-layer');
            e.preventDefault();
            return;
          }
          // Handle hit-test (only visible handles count).
          let handleHit: { idx: number; side: 'in' | 'out' } | null = null;
          for (let i = 0; i < params.anchors.length; i++) {
            const a = params.anchors[i];
            const hasIn = params.closed || i > 0;
            const hasOut = params.closed || i < params.anchors.length - 1;
            if (hasIn && (a.hxIn !== 0 || a.hyIn !== 0)) {
              if (Math.hypot(local.x - (a.x + a.hxIn), local.y - (a.y + a.hyIn)) <= tolMm) { handleHit = { idx: i, side: 'in' }; break; }
            }
            if (hasOut && (a.hxOut !== 0 || a.hyOut !== 0)) {
              if (Math.hypot(local.x - (a.x + a.hxOut), local.y - (a.y + a.hyOut)) <= tolMm) { handleHit = { idx: i, side: 'out' }; break; }
            }
          }
          if (handleHit) {
            const a = params.anchors[handleHit.idx];
            activeAnchorIdx = { layerId, idx: handleHit.idx };
            drag = { kind: 'bezier-handle', layerId, idx: handleHit.idx, side: handleHit.side, baseAnchor: { ...a }, startLocal: local };
            viewport.classList.add('dragging-layer');
            e.preventDefault();
            return;
          }
          // Double-click on the segment overlay → insert anchor at the click
          // location (de Casteljau split preserves the curve shape).
          if (e.detail === 2) {
            const tgt = e.target as Element | null;
            const segEl = tgt?.closest('[data-bezier-segment="true"]') as SVGPathElement | null;
            if (segEl && segEl.getAttribute('data-layer-id') === sel.id) {
              insertAnchorAt(sel.id, local);
              e.preventDefault();
              return;
            }
          }
          // No anchor / handle / segment hit. Edit mode is sticky: clicks
          // outside the geometry are swallowed (no-op). Only Escape or a
          // layer switch exits — per the explicit spec.
          e.preventDefault();
          return;
        }

        if (mode === null) {
          // Bounds mode. Edge gizmo wins first (uses its own hit-test below).
          // If the click falls inside the bbox interior (not on any edge),
          // treat it as a potential-edit drag: a quick tap enters edit mode,
          // a real drag moves the layer.
          const rect = selectedZoneRect();
          const edgeHit = rect ? hitEdge(posMm.x, posMm.y) : null;
          if (rect && !edgeHit) {
            const lp = toLocal(rect, posMm.x, posMm.y);
            const inside = lp.x > rect.x0 && lp.x < rect.x1 && lp.y > rect.y0 && lp.y < rect.y1;
            if (inside) {
              drag = {
                kind: 'layer',
                layerId: sel.id,
                startX: e.clientX,
                startY: e.clientY,
                baseOx: sel.offsetX,
                baseOy: sel.offsetY,
                pxPerMm: metrics().effScale,
                potentialEdit: true,
              };
              viewport.classList.add('dragging-layer');
              e.preventDefault();
              return;
            }
          }
        }
      }
    }

    // Zone edge gizmo takes priority over layer drag.
    const pos = screenToCanvas(e.clientX, e.clientY);
    const edge = hitEdge(pos.x, pos.y);
    if (edge) {
      const rect = selectedZoneRect()!;
      const sel = store.get().layers.find((l) => l.id === rect.layerId)!;
      // Bbox-in-mm comes from the rect for SVG layers (scale-derived), and
      // straight from the params for the other layer kinds.
      // Base dimensions for the drag: scale-derived for SVG, anchor-derived
      // for bezier (rect carries the snapshot), pattern-param for others.
      const baseZw = rect.bezierBase ? rect.bezierBase.baseW
        : rect.scaleBase !== undefined ? rect.x1 - rect.x0
        : (Number((sel.pattern.params as Record<string, unknown>)[rect.widthKey]) || (rect.x1 - rect.x0));
      const baseZh = rect.bezierBase ? rect.bezierBase.baseH
        : rect.scaleBase !== undefined ? rect.y1 - rect.y0
        : (Number((sel.pattern.params as Record<string, unknown>)[rect.heightKey]) || (rect.y1 - rect.y0));
      drag = {
        kind: 'edge',
        layerId: rect.layerId,
        edge,
        startX: e.clientX,
        startY: e.clientY,
        baseOffsetX: sel.offsetX,
        baseOffsetY: sel.offsetY,
        baseZw,
        baseZh,
        widthKey: rect.widthKey,
        heightKey: rect.heightKey,
        centred: rect.centred,
        rotation: rect.rotation,
        scaleBase: rect.scaleBase,
        bezierBase: rect.bezierBase,
      };
      viewport.classList.add('resizing-zone');
      e.preventDefault();
      return;
    }
    if (textEditingId) return; // active inline text edit owns the click
    const project = store.get();

    // If the click landed inside a text layer's rendered group, treat it as
    // a potential text-edit when that layer is already selected. We look at
    // the closest [data-layer-id] ancestor rather than the click target's
    // tag — vectorised text grows produce <path>, contours mode outputs
    // outlined glyphs, both should still trigger the editor.
    const target = e.target as Element | null;
    let potentialEdit = false;
    let editClickEvent: MouseEvent | undefined;
    const layerEl = target?.closest('[data-layer-id]') as Element | null;
    const clickedId = layerEl?.getAttribute('data-layer-id') ?? null;
    const clickedLayer = clickedId
      ? project.layers.find((l) => l.id === clickedId)
      : undefined;
    if (clickedLayer && clickedLayer.pattern.kind === 'text') {
      if (project.selectedLayerId === clickedId) {
        potentialEdit = true;
        editClickEvent = e;
      } else {
        // Text of a non-active layer: ignore the click — the user must select
        // the layer from the layers panel first (avoids the cursor stealing
        // focus while dragging another layer over a text).
        e.preventDefault();
        return;
      }
    }

    const layer = project.layers.find((l) => l.id === project.selectedLayerId);
    if (!layer) return;
    drag = {
      kind: 'layer',
      layerId: layer.id,
      startX: e.clientX,
      startY: e.clientY,
      baseOx: layer.offsetX,
      baseOy: layer.offsetY,
      pxPerMm: metrics().effScale,
      potentialEdit,
      editClickEvent,
    };
    viewport.classList.add('dragging-layer');
    e.preventDefault();
  });

  viewport.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // Bezier edit mode: right-click on an anchor opens a small menu with the
    // type choices + delete. Right-click elsewhere is silently swallowed.
    const project = store.get();
    const sel = project.layers.find((l) => l.id === project.selectedLayerId);
    if (!sel || sel.pattern.kind !== 'bezier' || getBezierMode() !== 'edit') return;
    const posMm = screenToCanvas(e.clientX, e.clientY);
    const local = canvasToBezierLocal(sel, posMm.x, posMm.y);
    const tolMm = 8 / metrics().effScale;
    let anchorIdx = -1;
    for (let i = 0; i < sel.pattern.params.anchors.length; i++) {
      const a = sel.pattern.params.anchors[i];
      if (Math.hypot(local.x - a.x, local.y - a.y) <= tolMm) { anchorIdx = i; break; }
    }
    if (anchorIdx < 0) return;
    openBezierAnchorMenu(sel.id, anchorIdx, e.clientX, e.clientY);
  });

  // Floating menu next to an anchor — emits type changes / delete for the
  // selected anchor and dismisses on outside-click.
  function openBezierAnchorMenu(layerId: string, anchorIdx: number, x: number, y: number): void {
    document.querySelectorAll('.bezier-anchor-menu').forEach((el) => el.remove());
    const layer = store.get().layers.find((l) => l.id === layerId);
    if (!layer || layer.pattern.kind !== 'bezier') return;
    const current = layer.pattern.params.anchors[anchorIdx];
    if (!current) return;
    const menu = document.createElement('div');
    menu.className = 'add-layer-popup bezier-anchor-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    const labels: Record<BezierAnchorType, string> = {
      line: 'Ligne',
      corner: 'Angle',
      smooth: 'Lissé',
      symmetric: 'Symétrique',
    };
    const types: BezierAnchorType[] = ['line', 'corner', 'smooth', 'symmetric'];
    const closeMenu = () => {
      menu.remove();
      document.removeEventListener('mousedown', onOutside, true);
    };
    for (const t of types) {
      const item = document.createElement('div');
      item.className = 'add-layer-popup-item' + (current.type === t ? ' active' : '');
      item.textContent = `${current.type === t ? '✓ ' : ''}${labels[t]}`;
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        store.update((p) => {
          p.layers = p.layers.map((l) => {
            if (l.id !== layerId || l.pattern.kind !== 'bezier') return l;
            const params = l.pattern.params;
            const closedFlag = params.closed;
            const anchorsRef = params.anchors;
            const anchors = anchorsRef.map((aa, idx) => {
              if (idx !== anchorIdx) return aa;
              // Switching FROM line (or otherwise zero-handled anchor) TO a
              // curve type → synthesize default handles based on neighbours.
              const allZero = aa.hxIn === 0 && aa.hyIn === 0 && aa.hxOut === 0 && aa.hyOut === 0;
              const target: BezierAnchor = (t !== 'line' && allZero)
                ? { ...aa, ...defaultHandlesForAnchor(anchorsRef, idx, closedFlag) }
                : aa;
              return normalizeAnchorForType(target, t);
            });
            return { ...l, pattern: { ...l.pattern, params: { ...params, anchors } } };
          });
        });
        recentreBezierToBBox(layerId);
        closeMenu();
      });
      menu.appendChild(item);
    }
    const sep = document.createElement('div');
    sep.className = 'add-layer-popup-item';
    sep.style.borderTop = '1px solid #444';
    sep.textContent = 'Supprimer ce point';
    sep.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      deleteBezierAnchor(layerId, anchorIdx);
      closeMenu();
    });
    menu.appendChild(sep);
    document.body.appendChild(menu);
    const onOutside = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) closeMenu();
    };
    setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
  }
  viewport.addEventListener('mousemove', updateZoneCursor);

  // ── Inline text editing via overlay <input> ─────────────
  // contenteditable on SVG <text> is unreliable across browsers (focus often
  // doesn't apply). Instead we drop an HTML <input> right on top of the text,
  // with the same font and size. Clicks on the visible text are actually
  // clicks on the input — so the caret lands exactly where the user pointed.
  // Live updates flow through the store; rerender runs normally because the
  // input sits on top of the SVG.

  function exitTextEdit(commit: boolean): void {
    if (!textEditingId) return;
    const id = textEditingId;
    textEditingId = null;
    textEditInput = null;
    textEditDetach?.();
    textEditDetach = null;
    if (!commit) {
      store.update((p) => {
        p.layers = p.layers.map((l) => {
          if (l.id !== id || l.pattern.kind !== 'text') return l;
          return { ...l, pattern: { ...l.pattern, params: { ...l.pattern.params, content: textEditOriginal } } };
        });
      });
    } else {
      // Force a rerender so the SVG text becomes visible again with the
      // committed content (the editing path skipped showing it).
      rerender();
    }
  }

  function enterTextEdit(layerId: string, clickEvent?: MouseEvent): void {
    if (textEditingId === layerId) return;
    exitTextEdit(true);
    const layer = store.get().layers.find((l) => l.id === layerId);
    if (!layer || layer.pattern.kind !== 'text') return;
    const textEl = findTextAnchor(layerId);
    if (!textEl) return;
    const original = layer.pattern.params.content;
    textEditOriginal = original;
    textEditingId = layerId;

    const sizeMm = layer.pattern.params.sizeMm;
    const align = layer.pattern.params.align;
    const fontFamily = layer.pattern.params.fontFamily;

    // Get the SVG text's screen CTM — encodes viewBox scale + the text's own
    // rotation. We use it both for positioning and for sizing the input.
    const ctm = textEl.getScreenCTM();
    if (!ctm) return;

    // The input sits in SVG-local coordinates (we'll let CSS transform map to
    // screen). It needs to be wide enough for editing: pick a generous fixed
    // width in mm. Align dictates which edge is anchored to local x=0.
    // Make the input far wider than any plausible content (5 metres of SVG
    // space) so the user can type freely without the input clipping or
    // scrolling. Text alignment within the box anchors visible content
    // correctly per the SVG text-anchor.
    const widthLocal = 5000;
    const heightLocal = sizeMm * 1.4;
    let localLeft = -widthLocal / 2;
    if (align === 'start') localLeft = 0;
    else if (align === 'end') localLeft = -widthLocal;
    const localTop = -heightLocal / 2;

    // Map (localLeft, localTop) to screen pixels via the CTM.
    const screenX = ctm.a * localLeft + ctm.c * localTop + ctm.e;
    const screenY = ctm.b * localLeft + ctm.d * localTop + ctm.f;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = original;
    input.className = 'text-edit-overlay';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.style.left = `${screenX}px`;
    input.style.top = `${screenY}px`;
    // CSS dimensions in "mm units" — the matrix below scales them to screen px.
    input.style.width = `${widthLocal}px`;
    input.style.height = `${heightLocal}px`;
    input.style.fontFamily = `"${fontFamily}", sans-serif`;
    input.style.fontSize = `${sizeMm}px`;
    input.style.lineHeight = `${heightLocal}px`;
    input.style.textAlign = align === 'middle' ? 'center' : align === 'end' ? 'right' : 'left';
    input.style.transform = `matrix(${ctm.a}, ${ctm.b}, ${ctm.c}, ${ctm.d}, 0, 0)`;
    input.style.transformOrigin = '0 0';
    document.body.appendChild(input);
    // Store the input so applyViewBox / rerender can recompute its placement
    // when the user zooms or pans.
    textEditInput = input;

    // Hide the SVG text while editing so we don't render the old content
    // behind the live input.
    const textElStyle = (textEl as unknown as HTMLElement).style;
    const previousVisibility = textElStyle.visibility;
    textElStyle.visibility = 'hidden';

    input.focus();

    // Place the caret near the click point. We unproject the click into SVG
    // local coordinates using the inverse CTM, then find the character index
    // whose canvas-measured width is closest to that x.
    if (clickEvent) {
      const inv = ctm.inverse();
      const localX = inv.a * clickEvent.clientX + inv.c * clickEvent.clientY + inv.e;
      const ctx = document.createElement('canvas').getContext('2d');
      let idx = 0;
      if (ctx && original.length > 0) {
        ctx.font = `${sizeMm}px "${fontFamily}", sans-serif`;
        const totalW = ctx.measureText(original).width;
        let textLeft = 0;
        if (align === 'middle') textLeft = -totalW / 2;
        else if (align === 'end') textLeft = -totalW;
        const relX = localX - textLeft;
        let bestDiff = Math.abs(relX);
        for (let i = 1; i <= original.length; i++) {
          const w = ctx.measureText(original.substring(0, i)).width;
          const diff = Math.abs(w - relX);
          if (diff < bestDiff) { bestDiff = diff; idx = i; }
        }
      }
      input.setSelectionRange(idx, idx);
    } else {
      input.select();
    }

    const onInput = () => {
      store.update((p) => {
        p.layers = p.layers.map((l) => {
          if (l.id !== layerId || l.pattern.kind !== 'text') return l;
          return { ...l, pattern: { ...l.pattern, params: { ...l.pattern.params, content: input.value } } };
        });
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); exitTextEdit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); exitTextEdit(false); }
    };
    // Click anywhere outside the input commits and exits. Capture phase so we
    // beat the viewport's mousedown handlers (which might preventDefault and
    // therefore prevent the input from blurring on its own).
    const onOutsideMouseDown = (e: MouseEvent) => {
      if (e.target === input) return;
      exitTextEdit(true);
    };
    // Backup commit path — tab-switching, alt-tab etc. all blur the input.
    const onBlur = () => exitTextEdit(true);
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', onBlur);
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    textEditDetach = () => {
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('blur', onBlur);
      document.removeEventListener('mousedown', onOutsideMouseDown, true);
      input.remove();
      // Restore the SVG text visibility — a fresh rerender will pick up the
      // committed content (or the restored original if Esc was pressed).
      const stillThere = findTextAnchor(layerId);
      if (stillThere) (stillThere as unknown as HTMLElement).style.visibility = previousVisibility;
    };
  }

  // (Text-edit entry is folded into the main mousedown / mousemove / mouseup
  // flow above via drag.potentialEdit — no separate capture-phase listener.)

  function applyZoneEdgeDrag(d: Extract<DragKind, { kind: 'edge' }>, e: MouseEvent) {
    const dxMm = (e.clientX - d.startX) / metrics().effScale;
    const dyMm = (e.clientY - d.startY) / metrics().effScale;
    // Modifier semantics:
    //   Ctrl  → mirror around the bbox centre (centre stays put, edge moves
    //           both ways). Was the old Shift behaviour.
    //   Shift → preserve aspect ratio (edge drags scale both axes; corner
    //           drags already do this).
    //   Cmd is treated as Ctrl on macOS.
    const mirror = e.ctrlKey || e.metaKey;
    const lockAspect = e.shiftKey;
    const info = EDGE_INFO[d.edge];
    const isPureCorner = info.sigX !== 0 && info.sigY !== 0;
    // Pure corners scale X / Y independently by default (cursor tracks the
    // grabbed corner exactly, opposite corner stays canvas-stable). Aspect
    // locking is opt-in via Shift. SVG layers force the uniform path because
    // they only have a single `scale` param.
    const treatAsCorner = d.scaleBase !== undefined || lockAspect;
    const minDim = 1;
    let nextOx = d.baseOffsetX;
    let nextOy = d.baseOffsetY;
    let nextZw = d.baseZw;
    let nextZh = d.baseZh;

    if (d.centred) {
      // Shapes: rotate cursor delta into the shape-local frame so a handle
      // labelled "right" actually grows the shape's local width regardless
      // of the layer's rotation.
      const local = rotateDelta(dxMm, dyMm, d.rotation);
      const dxL = local.x;
      const dyL = local.y;
      if (treatAsCorner) {
        // Uniform scaling — aspect ratio preserved. The "dominant" axis is
        // whichever side info points along: pure corner = larger of the two;
        // edge + lockAspect = the edge's own axis (the other is zero).
        let rel: number;
        if (isPureCorner) {
          const xRel = (info.sigX * dxL) / d.baseZw;
          const yRel = (info.sigY * dyL) / d.baseZh;
          rel = Math.abs(xRel) > Math.abs(yRel) ? xRel : yRel;
        } else if (info.sigX !== 0) {
          rel = (info.sigX * dxL) / d.baseZw;
        } else {
          rel = (info.sigY * dyL) / d.baseZh;
        }
        const mult = mirror ? 2 : 1;
        nextZw = Math.max(minDim, d.baseZw * (1 + mult * rel));
        nextZh = Math.max(minDim, d.baseZh * (1 + mult * rel));
        if (!mirror) {
          // Anchor = opposite corner (for pure corners) or opposite edge mid
          // for lock-aspect edges. Centre shifts by half the equivalent
          // local-frame corner movement on each non-zero axis.
          const localCX = info.sigX * rel * d.baseZw / 2;
          const localCY = info.sigY * rel * d.baseZh / 2;
          const a = d.rotation * Math.PI / 180;
          const cos = Math.cos(a), sin = Math.sin(a);
          nextOx = d.baseOffsetX + localCX * cos - localCY * sin;
          nextOy = d.baseOffsetY + localCX * sin + localCY * cos;
        }
      } else if (mirror) {
        nextZw = Math.max(minDim, d.baseZw + 2 * info.sigX * dxL);
        nextZh = Math.max(minDim, d.baseZh + 2 * info.sigY * dyL);
      } else {
        nextZw = Math.max(minDim, d.baseZw + info.sigX * dxL);
        nextZh = Math.max(minDim, d.baseZh + info.sigY * dyL);
        const localCX = info.sigX !== 0 ? dxL / 2 : 0;
        const localCY = info.sigY !== 0 ? dyL / 2 : 0;
        const a = d.rotation * Math.PI / 180;
        const cos = Math.cos(a), sin = Math.sin(a);
        nextOx = d.baseOffsetX + localCX * cos - localCY * sin;
        nextOy = d.baseOffsetY + localCX * sin + localCY * cos;
      }
    } else {
      // Top-left anchored zones: no rotation, work in canvas frame directly.
      if (treatAsCorner) {
        let rel: number;
        if (isPureCorner) {
          const xRel = (info.sigX * dxMm) / d.baseZw;
          const yRel = (info.sigY * dyMm) / d.baseZh;
          rel = Math.abs(xRel) > Math.abs(yRel) ? xRel : yRel;
        } else if (info.sigX !== 0) {
          rel = (info.sigX * dxMm) / d.baseZw;
        } else {
          rel = (info.sigY * dyMm) / d.baseZh;
        }
        const mult = mirror ? 2 : 1;
        nextZw = Math.max(minDim, d.baseZw * (1 + mult * rel));
        nextZh = Math.max(minDim, d.baseZh * (1 + mult * rel));
        if (mirror) {
          nextOx = d.baseOffsetX - rel * d.baseZw;
          nextOy = d.baseOffsetY - rel * d.baseZh;
        } else {
          if (info.sigX === -1) nextOx = d.baseOffsetX - rel * d.baseZw;
          if (info.sigY === -1) nextOy = d.baseOffsetY - rel * d.baseZh;
        }
      } else if (mirror) {
        nextZw = Math.max(minDim, d.baseZw + 2 * info.sigX * dxMm);
        nextZh = Math.max(minDim, d.baseZh + 2 * info.sigY * dyMm);
        nextOx = d.baseOffsetX - info.sigX * dxMm;
        nextOy = d.baseOffsetY - info.sigY * dyMm;
      } else {
        nextZw = Math.max(minDim, d.baseZw + info.sigX * dxMm);
        nextZh = Math.max(minDim, d.baseZh + info.sigY * dyMm);
        if (info.sigX === -1) nextOx = d.baseOffsetX + dxMm;
        if (info.sigY === -1) nextOy = d.baseOffsetY + dyMm;
      }
    }

    store.update((p) => {
      p.layers = p.layers.map((l) => {
        if (l.id !== d.layerId) return l;
        const base = l.pattern.params as unknown as Record<string, unknown>;
        let nextParams: Record<string, unknown>;
        if (d.bezierBase) {
          // Bezier: scale every anchor coord + handle vector around the bbox
          // centre by the new ratios. Coords stay in centred-local frame.
          const bz = d.bezierBase;
          const rx = bz.baseW > 0 ? nextZw / bz.baseW : 1;
          const ry = bz.baseH > 0 ? nextZh / bz.baseH : 1;
          const anchors = bz.anchors.map((a) => ({
            ...a,
            x: bz.bbCxLocal + (a.x - bz.bbCxLocal) * rx,
            y: bz.bbCyLocal + (a.y - bz.bbCyLocal) * ry,
            hxIn: a.hxIn * rx, hyIn: a.hyIn * ry,
            hxOut: a.hxOut * rx, hyOut: a.hyOut * ry,
          }));
          nextParams = { ...base, anchors };
        } else if (d.scaleBase !== undefined) {
          // SVG layer — bbox-in-mm changes are written back as a scale
          // multiplier on the original scale param.
          const ratio = d.baseZw > 0 ? nextZw / d.baseZw : 1;
          nextParams = { ...base, scale: round4(d.scaleBase * ratio) };
        } else {
          nextParams = {
            ...base,
            [d.widthKey]: round2(nextZw),
            [d.heightKey]: round2(nextZh),
          };
        }
        return {
          ...l,
          offsetX: round2(nextOx),
          offsetY: round2(nextOy),
          pattern: { ...l.pattern, params: nextParams } as Layer['pattern'],
        };
      });
    });
  }

  // Shift anchors so the bbox centre sits at the local origin (0, 0), then
  // compensate layer.offset (rotation-aware) so the shape stays visually put.
  // Keeps the rotation pivot (= local origin) aligned with the visual centre
  // after edits / resizes. Cheap to call repeatedly — early-outs when already
  // centred.
  function recentreBezierToBBox(layerId: string): void {
    const layer = store.get().layers.find((l) => l.id === layerId);
    if (!layer || layer.pattern.kind !== 'bezier') return;
    const params = layer.pattern.params;
    if (params.anchors.length < 1) return;
    const bb = bezierShapeBBox(params.anchors, params.closed);
    const cx = (bb.x0 + bb.x1) / 2;
    const cy = (bb.y0 + bb.y1) / 2;
    if (Math.abs(cx) < 0.001 && Math.abs(cy) < 0.001) return;
    const rot = (params.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const dxCanvas = cx * cos - cy * sin;
    const dyCanvas = cx * sin + cy * cos;
    store.update((p) => {
      p.layers = p.layers.map((l) => {
        if (l.id !== layerId || l.pattern.kind !== 'bezier') return l;
        const anchors = l.pattern.params.anchors.map((a) => ({
          ...a,
          x: a.x - cx,
          y: a.y - cy,
        }));
        return {
          ...l,
          offsetX: l.offsetX + dxCanvas,
          offsetY: l.offsetY + dyCanvas,
          pattern: { ...l.pattern, params: { ...l.pattern.params, anchors } },
        };
      });
    });
  }

  // Finalize a draft trace: auto-recentre anchors so the bbox centre sits at
  // the layer origin (cleaner editing afterwards) and switch to edit mode.
  // Returns true if the draft was committed; false if it was discarded.
  function commitBezierDraft(layerId: string, close: boolean): boolean {
    const layer = store.get().layers.find((l) => l.id === layerId);
    if (!layer || layer.pattern.kind !== 'bezier') return false;
    const params = layer.pattern.params;
    if (params.anchors.length < 2) {
      // Degenerate trace: drop the whole layer.
      store.update((p) => {
        p.layers = p.layers.filter((l) => l.id !== layerId);
        if (p.selectedLayerId === layerId) p.selectedLayerId = null;
      });
      bezierUiMode = null;
      return false;
    }
    // First write the closed flag, then recentre to bbox centre — keeps the
    // rotation pivot (= local origin) aligned with the visual centre.
    if (close) {
      store.update((p) => {
        p.layers = p.layers.map((l) => {
          if (l.id !== layerId || l.pattern.kind !== 'bezier') return l;
          return { ...l, pattern: { ...l.pattern, params: { ...l.pattern.params, closed: true } } };
        });
      });
    }
    recentreBezierToBBox(layerId);
    bezierUiMode = { layerId, mode: 'edit' };
    return true;
  }

  // Discard an in-progress draft (Escape during draw).
  function discardBezierDraft(layerId: string): void {
    store.update((p) => {
      p.layers = p.layers.filter((l) => l.id !== layerId);
      if (p.selectedLayerId === layerId) p.selectedLayerId = null;
    });
    bezierUiMode = null;
  }

  // Insert a new anchor on the segment closest to `localHit`. Walks every
  // cubic segment (incl. the closing one) sampling 32 points, picks the
  // closest, then refines t via de Casteljau split for a shape-preserving cut.
  function insertAnchorAt(layerId: string, localHit: { x: number; y: number }): void {
    const sel = store.get().layers.find((l) => l.id === layerId);
    if (!sel || sel.pattern.kind !== 'bezier') return;
    const params = sel.pattern.params;
    const anchors = params.anchors;
    if (anchors.length < 2) return;
    const SAMPLES = 32;
    let best = { i: -1, t: 0, d2: Infinity };
    const segCount = params.closed ? anchors.length : anchors.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = anchors[i];
      const b = anchors[(i + 1) % anchors.length];
      for (let s = 1; s < SAMPLES; s++) {
        const t = s / SAMPLES;
        const u = 1 - t;
        const c1x = a.x + a.hxOut, c1y = a.y + a.hyOut;
        const c2x = b.x + b.hxIn,  c2y = b.y + b.hyIn;
        const x = u*u*u*a.x + 3*u*u*t*c1x + 3*u*t*t*c2x + t*t*t*b.x;
        const y = u*u*u*a.y + 3*u*u*t*c1y + 3*u*t*t*c2y + t*t*t*b.y;
        const d2 = (x - localHit.x)*(x - localHit.x) + (y - localHit.y)*(y - localHit.y);
        if (d2 < best.d2) best = { i, t, d2 };
      }
    }
    if (best.i < 0) return;
    const a = anchors[best.i];
    const b = anchors[(best.i + 1) % anchors.length];
    const split = splitCubic(a, b, best.t);
    store.update((p) => {
      p.layers = p.layers.map((l) => {
        if (l.id !== layerId || l.pattern.kind !== 'bezier') return l;
        const next = [...l.pattern.params.anchors];
        next[best.i] = { ...next[best.i], hxOut: split.aHxOut, hyOut: split.aHyOut };
        const bIdx = (best.i + 1) % next.length;
        next[bIdx] = { ...next[bIdx], hxIn: split.bHxIn, hyIn: split.bHyIn };
        next.splice(best.i + 1, 0, split.newAnchor);
        return { ...l, pattern: { ...l.pattern, params: { ...l.pattern.params, anchors: next } } };
      });
    });
    recentreBezierToBBox(layerId);
  }

  // Mutate a single anchor in the bezier layer, given an index and a producer.
  function updateAnchor(layerId: string, idx: number, mut: (a: BezierAnchor) => BezierAnchor): void {
    store.update((p) => {
      p.layers = p.layers.map((l) => {
        if (l.id !== layerId || l.pattern.kind !== 'bezier') return l;
        const anchors = l.pattern.params.anchors.map((a, i) => i === idx ? mut(a) : a);
        return { ...l, pattern: { ...l.pattern, params: { ...l.pattern.params, anchors } } };
      });
    });
  }

  // Propagate the dragged handle to the opposite one per anchor type.
  function applyHandleType(a: BezierAnchor, side: 'in' | 'out'): BezierAnchor {
    if (a.type === 'corner') return a;
    if (side === 'in') {
      if (a.type === 'smooth') {
        const len = Math.hypot(a.hxOut, a.hyOut);
        const lin = Math.hypot(a.hxIn, a.hyIn);
        if (lin === 0 || len === 0) return { ...a, hxOut: -a.hxIn, hyOut: -a.hyIn };
        const k = len / lin;
        return { ...a, hxOut: -a.hxIn * k, hyOut: -a.hyIn * k };
      }
      // symmetric
      return { ...a, hxOut: -a.hxIn, hyOut: -a.hyIn };
    }
    if (a.type === 'smooth') {
      const lin = Math.hypot(a.hxIn, a.hyIn);
      const lout = Math.hypot(a.hxOut, a.hyOut);
      if (lin === 0 || lout === 0) return { ...a, hxIn: -a.hxOut, hyIn: -a.hyOut };
      const k = lin / lout;
      return { ...a, hxIn: -a.hxOut * k, hyIn: -a.hyOut * k };
    }
    return { ...a, hxIn: -a.hxOut, hyIn: -a.hyOut };
  }

  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const eff = metrics().effScale;
      vbX = drag.baseVbX - (e.clientX - drag.startX) / eff;
      vbY = drag.baseVbY - (e.clientY - drag.startY) / eff;
      applyViewBox();
      return;
    }
    if (drag.kind === 'edge') {
      applyZoneEdgeDrag(drag, e);
      return;
    }
    if (drag.kind === 'bezier-anchor' || drag.kind === 'bezier-handle' || drag.kind === 'bezier-pen-handle') {
      const dragLayerId = drag.layerId;
      const sel = store.get().layers.find((l) => l.id === dragLayerId);
      if (!sel || sel.pattern.kind !== 'bezier') return;
      const posMm = screenToCanvas(e.clientX, e.clientY);
      const local = canvasToBezierLocal(sel, posMm.x, posMm.y);
      if (drag.kind === 'bezier-anchor') {
        const d = drag;
        const dx = local.x - d.startLocal.x;
        const dy = local.y - d.startLocal.y;
        updateAnchor(d.layerId, d.idx, (a) => ({
          ...a,
          x: d.baseAnchor.x + dx,
          y: d.baseAnchor.y + dy,
        }));
        return;
      }
      if (drag.kind === 'bezier-handle') {
        const d = drag;
        const a = d.baseAnchor;
        const newHx = local.x - a.x;
        const newHy = local.y - a.y;
        updateAnchor(d.layerId, d.idx, (cur) => {
          let next: BezierAnchor;
          if (d.side === 'in') next = { ...cur, hxIn: newHx, hyIn: newHy };
          else                 next = { ...cur, hxOut: newHx, hyOut: newHy };
          return applyHandleType(next, d.side);
        });
        return;
      }
      // bezier-pen-handle: drag-out during the very first mousedown on a new
      // anchor. Start symmetric so the user gets a curve preview right away.
      const d = drag;
      const anchorState = store.get().layers
        .find((l) => l.id === d.layerId)?.pattern.params as BezierParams | undefined;
      if (!anchorState) return;
      const a = anchorState.anchors[d.idx];
      if (!a) return;
      const dxH = local.x - a.x;
      const dyH = local.y - a.y;
      updateAnchor(d.layerId, d.idx, (cur) => ({
        ...cur,
        hxOut: dxH, hyOut: dyH,
        hxIn: -dxH, hyIn: -dyH,
        type: 'symmetric',
      }));
      return;
    }
    let dxPx = e.clientX - drag.startX;
    let dyPx = e.clientY - drag.startY;
    // Drag has to move past a small threshold before it counts — if the click
    // ends up being a tap on text we'll enter inline edit instead.
    // Slightly more forgiving than the previous 4px to tolerate trackpad
    // jitter and "wiggle" between mousedown and mouseup on a deliberate click.
    if (drag.potentialEdit && Math.hypot(dxPx, dyPx) > 6) drag.potentialEdit = false;
    if (e.shiftKey) {
      if (Math.abs(dxPx) >= Math.abs(dyPx)) dyPx = 0; else dxPx = 0;
    }
    const dxMm = dxPx / drag.pxPerMm;
    const dyMm = dyPx / drag.pxPerMm;
    const id = drag.layerId;
    const ox = round2(drag.baseOx + dxMm);
    const oy = round2(drag.baseOy + dyMm);
    store.update((p) => {
      p.layers = p.layers.map((l: Layer) => l.id === id ? { ...l, offsetX: ox, offsetY: oy } : l);
    });
  });

  window.addEventListener('mouseup', () => {
    if (!drag) return;
    // Mouseup with no significant move on a selected text or bezier layer
    // triggers the kind-appropriate "tap" action: text → inline edit, bezier
    // → enter edit mode (from bounds).
    if (drag.kind === 'layer' && drag.potentialEdit) {
      const layerId = drag.layerId;
      const clickEvt = drag.editClickEvent;
      drag = null;
      viewport.classList.remove('panning', 'dragging-layer', 'resizing-zone');
      viewport.style.cursor = '';
      const tappedLayer = store.get().layers.find((l) => l.id === layerId);
      if (tappedLayer?.pattern.kind === 'bezier') {
        bezierUiMode = { layerId, mode: 'edit' };
        rerender();
      } else if (tappedLayer?.pattern.kind === 'text') {
        enterTextEdit(layerId, clickEvt);
      }
      return;
    }
    const completed = drag;
    drag = null;
    viewport.classList.remove('panning', 'dragging-layer', 'resizing-zone');
    viewport.style.cursor = '';
    // Recentre bezier after any drag that changed anchor geometry — keeps
    // the bbox centre aligned with the rotation pivot. Pen-handle drags
    // (draw mode) intentionally don't recentre: the user is still placing
    // anchors and shifting their canvas positions mid-gesture would be
    // disorienting; we recentre once at commit time instead.
    if (completed.kind === 'bezier-anchor' || completed.kind === 'bezier-handle') {
      recentreBezierToBBox(completed.layerId);
    } else if (completed.kind === 'edge' && completed.bezierBase) {
      recentreBezierToBBox(completed.layerId);
    }
  });

  // Bezier mode transitions via keyboard. Order matters: text editor owns its
  // keys first; then we look at the current mode (draw / edit) and the key.
  window.addEventListener('keydown', (e) => {
    if (textEditingId) return; // inline text editor owns the keyboard
    const project = store.get();
    const sel = project.layers.find((l) => l.id === project.selectedLayerId);
    if (!sel || sel.pattern.kind !== 'bezier') return;
    const mode = getBezierMode();

    if (mode === 'draw' && !drag) {
      if (e.key === 'Enter') {
        commitBezierDraft(sel.id, false);
        rerender();
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        // Cancel the in-progress trace entirely.
        discardBezierDraft(sel.id);
        rerender();
        e.preventDefault();
        return;
      }
    }

    if (mode === 'edit' && !drag && e.key === 'Escape') {
      bezierUiMode = null;
      activeAnchorIdx = null;
      rerender();
      e.preventDefault();
      return;
    }

    if ((e.key === 'Backspace' || e.key === 'Delete') && mode === 'edit') {
      if (drag) return;
      const layerId = sel.id;
      const idx = activeAnchorIdx && activeAnchorIdx.layerId === layerId
        ? activeAnchorIdx.idx
        : sel.pattern.params.anchors.length - 1;
      if (idx < 0) return;
      deleteBezierAnchor(layerId, idx);
      e.preventDefault();
    }
  });

  // Remove an anchor at `idx`. If the layer ends up with zero anchors, the
  // whole layer is removed (a bezier with no points is meaningless and would
  // otherwise become invisible-but-still-listed dead weight).
  function deleteBezierAnchor(layerId: string, idx: number): void {
    store.update((p) => {
      const layer = p.layers.find((l) => l.id === layerId);
      if (!layer || layer.pattern.kind !== 'bezier') return;
      const next = layer.pattern.params.anchors.filter((_, i) => i !== idx);
      if (next.length === 0) {
        p.layers = p.layers.filter((l) => l.id !== layerId);
        if (p.selectedLayerId === layerId) p.selectedLayerId = null;
        return;
      }
      p.layers = p.layers.map((l) => {
        if (l.id !== layerId || l.pattern.kind !== 'bezier') return l;
        return { ...l, pattern: { ...l.pattern, params: { ...l.pattern.params, anchors: next } } };
      });
    });
    activeAnchorIdx = null;
    if (!store.get().layers.some((l) => l.id === layerId)) {
      bezierUiMode = null;
    } else {
      recentreBezierToBBox(layerId);
    }
  }

  viewport.addEventListener('dragover', (e) => {
    if (!e.dataTransfer) return;
    const types = Array.from(e.dataTransfer.types);
    if (types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      viewport.classList.add('drop-target');
    }
  });
  viewport.addEventListener('dragleave', () => viewport.classList.remove('drop-target'));
  viewport.addEventListener('drop', async (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    viewport.classList.remove('drop-target');
    const files = Array.from(e.dataTransfer.files);
    const svgFile = files.find((f) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name));
    if (!svgFile) return;
    try {
      const text = await svgFile.text();
      // viewBox-based math: drop position straight to canvas-mm.
      const dropMm = screenToCanvas(e.clientX, e.clientY);
      const initialScale = scaleForTargetSize(text, 60);
      const params = defaultSvgLayerParams(text, initialScale, store.get().kerf);
      const pattern: Pattern = { kind: 'svg', params };
      store.update((p) => {
        const baseName = svgFile.name.replace(/\.svg$/i, '');
        const lyr = makeLayer(pattern, baseName || tr('svg'));
        lyr.offsetX = dropMm.x;
        lyr.offsetY = dropMm.y;
        p.layers = [...p.layers, lyr];
        p.selectedLayerId = lyr.id;
      });
    } catch (err) {
      alert(`Échec du dépôt SVG : ${(err as Error).message}`);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !drag) return;
    if (drag.kind === 'pan') {
      vbX = drag.baseVbX;
      vbY = drag.baseVbY;
      applyViewBox();
    } else if (drag.kind === 'edge') {
      const d = drag;
      store.update((p) => {
        p.layers = p.layers.map((l) => {
          if (l.id !== d.layerId) return l;
          const base = l.pattern.params as unknown as Record<string, unknown>;
          const np = d.bezierBase
            ? { ...base, anchors: d.bezierBase.anchors }
            : d.scaleBase !== undefined
              ? { ...base, scale: d.scaleBase }
              : { ...base, [d.widthKey]: d.baseZw, [d.heightKey]: d.baseZh };
          return { ...l, offsetX: d.baseOffsetX, offsetY: d.baseOffsetY, pattern: { ...l.pattern, params: np } as Layer['pattern'] };
        });
      });
    } else if (drag.kind === 'bezier-anchor' || drag.kind === 'bezier-handle') {
      // Restore the base anchor — wipes whatever ongoing drag did to it.
      const d = drag;
      updateAnchor(d.layerId, d.idx, () => d.baseAnchor);
    } else if (drag.kind === 'bezier-pen-handle') {
      // Pen-handle Escape: keep the anchor but zero its handles (it was just
      // placed; user effectively cancels the drag-out gesture).
      const d = drag;
      updateAnchor(d.layerId, d.idx, (a) => ({ ...a, hxIn: 0, hyIn: 0, hxOut: 0, hyOut: 0 }));
    } else {
      const id = drag.layerId;
      const ox = drag.baseOx;
      const oy = drag.baseOy;
      store.update((p) => {
        p.layers = p.layers.map((l: Layer) => l.id === id ? { ...l, offsetX: ox, offsetY: oy } : l);
      });
    }
    drag = null;
    viewport.classList.remove('panning', 'dragging-layer', 'resizing-zone');
    viewport.style.cursor = '';
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
