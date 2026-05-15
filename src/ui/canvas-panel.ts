import { Store, Layer, Pattern } from '../state/project';
import { buildPreviewSvg } from '../render/preview';
import { materialPalette } from '../render/materials';
import { subscribeFontRegistry } from '../state/font-registry';
import { defaultSvgLayerParams, scaleForTargetSize } from '../patterns/svg-layer';
import { makeLayer } from '../state/project';
import { parseSvgViewBoxText } from '../utils/svg';
import { tr } from '../i18n';

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
    svgRoot = buildPreviewSvg(renderInput);
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

  let drag: DragKind | null = null;

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
    // Zone edge gizmo takes priority over layer drag.
    const pos = screenToCanvas(e.clientX, e.clientY);
    const edge = hitEdge(pos.x, pos.y);
    if (edge) {
      const rect = selectedZoneRect()!;
      const sel = store.get().layers.find((l) => l.id === rect.layerId)!;
      // Bbox-in-mm comes from the rect for SVG layers (scale-derived), and
      // straight from the params for the other layer kinds.
      const baseZw = rect.scaleBase !== undefined ? rect.x1 - rect.x0 : (Number((sel.pattern.params as Record<string, unknown>)[rect.widthKey]) || (rect.x1 - rect.x0));
      const baseZh = rect.scaleBase !== undefined ? rect.y1 - rect.y0 : (Number((sel.pattern.params as Record<string, unknown>)[rect.heightKey]) || (rect.y1 - rect.y0));
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

  viewport.addEventListener('contextmenu', (e) => e.preventDefault());
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
    const shift = e.shiftKey;
    const info = EDGE_INFO[d.edge];
    // SVG layers have one scale param — non-uniform stretching isn't meaningful,
    // so any handle (edge or corner) goes through the uniform path.
    const isCorner = (info.sigX !== 0 && info.sigY !== 0) || d.scaleBase !== undefined;
    const minDim = 1;
    let nextOx = d.baseOffsetX;
    let nextOy = d.baseOffsetY;
    let nextZw = d.baseZw;
    let nextZh = d.baseZh;

    if (d.centred) {
      // Shapes: rotate cursor delta into the shape-local frame so a handle
      // labelled "right" actually grows the shape's local width regardless of
      // the layer's rotation. With shift the centre stays put; without shift
      // the opposite edge stays put and the centre tracks the cursor.
      const local = rotateDelta(dxMm, dyMm, d.rotation);
      const dxL = local.x;
      const dyL = local.y;
      if (isCorner) {
        // Uniform scaling — aspect ratio preserved. Pick whichever axis has
        // the larger relative change to drive the new scale.
        const xRel = (info.sigX * dxL) / d.baseZw;
        const yRel = (info.sigY * dyL) / d.baseZh;
        const rel = Math.abs(xRel) > Math.abs(yRel) ? xRel : yRel;
        const mult = shift ? 2 : 1;
        nextZw = Math.max(minDim, d.baseZw * (1 + mult * rel));
        nextZh = Math.max(minDim, d.baseZh * (1 + mult * rel));
        if (!shift) {
          // Anchor = opposite corner; centre shifts by half the equivalent
          // local-frame corner movement in each axis.
          const localCX = info.sigX * rel * d.baseZw / 2;
          const localCY = info.sigY * rel * d.baseZh / 2;
          const a = d.rotation * Math.PI / 180;
          const cos = Math.cos(a), sin = Math.sin(a);
          nextOx = d.baseOffsetX + localCX * cos - localCY * sin;
          nextOy = d.baseOffsetY + localCX * sin + localCY * cos;
        }
      } else if (shift) {
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
      if (isCorner) {
        const xRel = (info.sigX * dxMm) / d.baseZw;
        const yRel = (info.sigY * dyMm) / d.baseZh;
        const rel = Math.abs(xRel) > Math.abs(yRel) ? xRel : yRel;
        const mult = shift ? 2 : 1;
        nextZw = Math.max(minDim, d.baseZw * (1 + mult * rel));
        nextZh = Math.max(minDim, d.baseZh * (1 + mult * rel));
        if (shift) {
          nextOx = d.baseOffsetX - rel * d.baseZw;
          nextOy = d.baseOffsetY - rel * d.baseZh;
        } else {
          if (info.sigX === -1) nextOx = d.baseOffsetX - rel * d.baseZw;
          if (info.sigY === -1) nextOy = d.baseOffsetY - rel * d.baseZh;
        }
      } else if (shift) {
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
        if (d.scaleBase !== undefined) {
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
    // Mouseup with no significant move on a selected text layer → inline edit.
    if (drag.kind === 'layer' && drag.potentialEdit) {
      const layerId = drag.layerId;
      const clickEvt = drag.editClickEvent;
      drag = null;
      viewport.classList.remove('panning', 'dragging-layer', 'resizing-zone');
      viewport.style.cursor = '';
      enterTextEdit(layerId, clickEvt);
      return;
    }
    drag = null;
    viewport.classList.remove('panning', 'dragging-layer', 'resizing-zone');
    viewport.style.cursor = '';
  });

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
          const np = d.scaleBase !== undefined
            ? { ...base, scale: d.scaleBase }
            : { ...base, [d.widthKey]: d.baseZw, [d.heightKey]: d.baseZh };
          return { ...l, offsetX: d.baseOffsetX, offsetY: d.baseOffsetY, pattern: { ...l.pattern, params: np } as Layer['pattern'] };
        });
      });
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
