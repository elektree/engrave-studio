# Engrave Pattern Generator — Design

**Date:** 2026-05-12
**Status:** Approved

## 1. Goal

Build a small browser-based tool to generate SVG patterns for laser-engraving leather belts. The tool runs entirely client-side, lets the user pick a canvas size (default = a whole belt), combine procedural patterns and text on stackable layers, see a live preview at all times, and export a laser-ready SVG.

## 2. Stack

- **Vite + TypeScript** (template `vanilla-ts`). No UI framework — direct DOM manipulation.
- One external runtime dependency: **`opentype.js`** to convert text to SVG paths at export time.
- ESLint + Prettier with minimal config.
- **No automated tests** (per user decision — validate manually in the browser).

## 3. Data model (single source of truth)

```ts
type Project = {
  canvas: { width: number; height: number; unit: 'mm' }; // default 1100 × 35
  layers: Layer[];      // bottom to top
  version: 1;           // for future JSON migrations
};

type Layer = {
  id: string;
  name: string;
  visible: boolean;
  blendMode: 'normal' | 'mask'; // 'mask' clips layers below until the next normal layer
  pattern: Pattern;
};

type Pattern =
  | { kind: 'geometric'; params: GeometricParams }
  | { kind: 'frieze';    params: FriezeParams }
  | { kind: 'scatter';   params: ScatterParams }
  | { kind: 'text';      params: TextParams };
```

The SVG output is **derived** from the `Project` object; it is never stored. Any mutation triggers a re-render via a tiny in-house event bus (`store.subscribe(...)`).

## 4. Pattern catalogue (V1)

| `kind`       | Sub-variants                                       | Key parameters                                                |
|--------------|----------------------------------------------------|---------------------------------------------------------------|
| `geometric`  | parallel lines, grid, chevrons, lattice, dots      | spacing, angle, stroke width, margin                          |
| `frieze`     | wave, greek key, braid, crenel                     | period, amplitude, stroke width, x-offset, mirror             |
| `scatter`    | star, flower, rune, circle                         | density, jitter seed, min/max size, rotation                  |
| `text`       | one text element per layer                         | content, font, size in mm, x/y, rotation, alignment           |

Each generator is a pure function: `(params, canvas) => SVGElement[]`. This keeps them isolated, swappable, and easy to reason about.

## 5. Composition

- **Layers panel** (Photoshop-like): list with drag to reorder, visibility toggle, rename, delete.
- **Mask mode**: when `layer.blendMode === 'mask'`, the layer becomes an SVG `<clipPath>` that clips all layers below it, until the next `normal` layer. Implemented with native `<clipPath>` + `<g clip-path="url(#...)">`.

## 6. UI layout

```
┌─────────────────────────────────────────────────────────────┐
│ Header: project name · canvas dims · export SVG · JSON ↑↓    │
├──────────┬──────────────────────────────────────┬───────────┤
│ LAYERS   │                                      │ PROPS     │
│          │   PREVIEW (live SVG, zoom + pan)     │ (params   │
│ + add ▼  │   ──────────────────────────────     │  of the   │
│ [x] L1   │   belt 1100 × 35 mm                  │  selected │
│ [x] L2   │                                      │  layer)   │
│ [ ] L3   │                                      │           │
└──────────┴──────────────────────────────────────┴───────────┘
```

- **Preview**: inline SVG, `viewBox` set to canvas mm. Wheel = zoom, drag = pan. A thin rectangle shows the belt edge.
- **Props panel**: adapts to the selected layer's pattern kind. Mostly number inputs / sliders / selects. No color picker (laser = black only); the only "visual" parameter is stroke width.

## 7. SVG export (laser-ready)

- `<svg width="1100mm" height="35mm" viewBox="0 0 1100 35">` — millimetres, ready for LightBurn / RDWorks.
- Export dialog toggles:
  - **Stroke-only** (default): every shape `stroke="#000" fill="none"`, with a configurable stroke width (default `0.1` mm — "hairline").
  - **Include fills**: optional, for raster-engraved areas.
  - **Text → path**: text layers are flattened with `opentype.js` at export time. Text stays editable in the app.
- All transforms are baked into the geometry before export (no nested `transform="..."` on the output) — avoids surprises in laser software.

## 8. Persistence

- **LocalStorage**: auto-save of the full `Project` object on every change, debounced 300 ms.
- **Export / Import JSON**: two buttons in the header. JSON is `JSON.stringify(project, null, 2)` with a top-level `version` field for future migrations.

## 9. Project layout

```
src/
├─ main.ts                  // entry point, mounts the app
├─ state/
│  ├─ project.ts            // types + store + event bus
│  └─ persistence.ts        // localStorage + JSON import/export
├─ patterns/
│  ├─ geometric.ts
│  ├─ frieze.ts
│  ├─ scatter.ts
│  ├─ text.ts
│  └─ index.ts              // registry + dispatch by kind
├─ render/
│  ├─ preview.ts            // live SVG re-render in the preview area
│  └─ export.ts             // builds the final laser SVG (stroke-only, text→path)
├─ ui/
│  ├─ header.ts
│  ├─ layers-panel.ts
│  ├─ props-panel.ts
│  └─ canvas-panel.ts       // preview + zoom/pan
├─ utils/
│  ├─ svg.ts                // tiny helpers to build SVG elements
│  └─ id.ts                 // unique id generator
└─ style.css
```

## 10. Out of scope for V1

- Color (laser is black-only).
- Undo / redo.
- Text on a curve / textPath.
- Boolean operations (union, intersection).
- Perlin / Voronoi / fractal patterns.
- Custom font upload.
- Multi-document / projects management beyond one active `Project`.
