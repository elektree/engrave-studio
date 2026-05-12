# Engrave Pattern Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vite + Vanilla TypeScript single-page tool that lets the user combine procedural patterns and text on stackable layers and export a laser-ready SVG for engraving leather belts.

**Architecture:** Single in-memory `Project` object is the source of truth. Pattern generators are pure functions `(params, canvas) => SVGElement[]`. A small event-bus store re-renders the preview SVG on every change. Persistence is LocalStorage + JSON download/upload. Export goes through a separate pipeline that flattens text via opentype.js and emits stroke-only SVG with mm units.

**Tech Stack:** Vite, TypeScript (vanilla template, no UI framework), `opentype.js` (text→path at export). No automated tests — manual validation in the browser.

**Important:** The user does not want automated tests for this project. Skip all `vitest` / `*.test.ts` infrastructure. Validate each task by running `npm run dev` and exercising the UI in the browser.

---

## File map

```
package.json
tsconfig.json
vite.config.ts
index.html
public/
src/
├─ main.ts                  // mounts the three panels + header
├─ style.css
├─ state/
│  ├─ project.ts            // types, default project, store + event bus
│  └─ persistence.ts        // localStorage autosave + JSON import/export
├─ patterns/
│  ├─ index.ts              // registry, defaults, dispatch by kind
│  ├─ geometric.ts          // parallel lines, grid, chevrons, lattice, dots
│  ├─ frieze.ts             // wave, greek key, braid, crenel
│  ├─ scatter.ts            // star, flower, rune, circle (with seeded jitter)
│  └─ text.ts               // <text> generator; flatten via opentype at export
├─ render/
│  ├─ preview.ts            // builds the live SVG into the canvas panel
│  └─ export.ts             // builds the laser-ready SVG and triggers download
├─ ui/
│  ├─ header.ts             // project name, canvas dims, export, JSON I/O
│  ├─ layers-panel.ts       // list, add, reorder, toggle visible, mask flag, delete
│  ├─ props-panel.ts        // params editor for selected layer (dispatches by kind)
│  └─ canvas-panel.ts       // preview container, zoom + pan
└─ utils/
   ├─ svg.ts                // tiny helpers to build SVG elements
   └─ id.ts                 // unique id generator
```

---

### Task 1: Bootstrap the Vite + Vanilla TS project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`
- Create: `src/main.ts`, `src/style.css`

- [ ] **Step 1: Initialize project files**

`package.json`:
```json
{
  "name": "engrave-pattern-generator",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "opentype.js": "^1.3.4"
  },
  "devDependencies": {
    "@types/opentype.js": "^1.3.8",
    "typescript": "~5.5.0",
    "vite": "^5.4.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
export default defineConfig({ server: { open: true } });
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Engrave Pattern Generator</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`.gitignore`:
```
node_modules
dist
.DS_Store
*.local
```

`src/main.ts` (placeholder so the dev server boots):
```ts
import './style.css';

const app = document.getElementById('app')!;
app.textContent = 'Engrave Pattern Generator — bootstrapping…';
```

`src/style.css`:
```css
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; font-family: system-ui, sans-serif; }
```

- [ ] **Step 2: Install deps & verify dev server boots**

Run: `npm install && npm run dev`
Expected: the browser opens on `http://localhost:5173` and shows the bootstrapping text without console errors.

- [ ] **Step 3: Commit**

```bash
git init
git add .
git commit -m "chore: bootstrap vite + ts project"
```

---

### Task 2: Define types, store and event bus

**Files:**
- Create: `src/utils/id.ts`
- Create: `src/state/project.ts`

- [ ] **Step 1: Write `src/utils/id.ts`**

```ts
export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}
```

- [ ] **Step 2: Write `src/state/project.ts`**

```ts
import { uid } from '../utils/id';

export type Unit = 'mm';

export type Canvas = { width: number; height: number; unit: Unit };

export type GeometricVariant = 'lines' | 'grid' | 'chevrons' | 'lattice' | 'dots';
export type GeometricParams = {
  variant: GeometricVariant;
  spacing: number;       // mm
  angle: number;         // degrees
  strokeWidth: number;   // mm
  margin: number;        // mm, all sides
};

export type FriezeVariant = 'wave' | 'greek' | 'braid' | 'crenel';
export type FriezeParams = {
  variant: FriezeVariant;
  period: number;        // mm
  amplitude: number;     // mm
  strokeWidth: number;   // mm
  offsetX: number;       // mm
  mirror: boolean;       // duplicate vertically mirrored on the X axis
  y: number;             // mm, vertical center
};

export type ScatterShape = 'star' | 'flower' | 'rune' | 'circle';
export type ScatterParams = {
  shape: ScatterShape;
  density: number;       // approx items per 100 mm
  minSize: number;       // mm
  maxSize: number;       // mm
  rotationJitter: number;// degrees
  seed: number;
  strokeWidth: number;   // mm
};

export type TextAlign = 'start' | 'middle' | 'end';
export type TextParams = {
  content: string;
  fontFamily: string;
  sizeMm: number;
  x: number;             // mm
  y: number;             // mm (baseline)
  rotation: number;      // degrees
  align: TextAlign;
  strokeWidth: number;   // mm (used by export)
};

export type Pattern =
  | { kind: 'geometric'; params: GeometricParams }
  | { kind: 'frieze';    params: FriezeParams }
  | { kind: 'scatter';   params: ScatterParams }
  | { kind: 'text';      params: TextParams };

export type PatternKind = Pattern['kind'];

export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  blendMode: 'normal' | 'mask';
  pattern: Pattern;
};

export type Project = {
  version: 1;
  name: string;
  canvas: Canvas;
  layers: Layer[];          // index 0 = bottom
  selectedLayerId: string | null;
};

export function defaultProject(): Project {
  return {
    version: 1,
    name: 'Untitled belt',
    canvas: { width: 1100, height: 35, unit: 'mm' },
    layers: [],
    selectedLayerId: null,
  };
}

export function makeLayer(pattern: Pattern, name: string): Layer {
  return {
    id: uid('layer'),
    name,
    visible: true,
    blendMode: 'normal',
    pattern,
  };
}

type Listener = (p: Project) => void;

export class Store {
  private state: Project;
  private listeners = new Set<Listener>();

  constructor(initial: Project) {
    this.state = initial;
  }

  get(): Project { return this.state; }

  set(next: Project): void {
    this.state = next;
    this.listeners.forEach((l) => l(this.state));
  }

  update(mutator: (draft: Project) => Project | void): void {
    // Shallow copy at top-level; deeper structures are replaced explicitly by callers.
    const draft: Project = { ...this.state };
    const result = mutator(draft);
    this.set(result ?? draft);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
```

- [ ] **Step 3: Wire the store into `main.ts` for a smoke check**

Edit `src/main.ts`:
```ts
import './style.css';
import { Store, defaultProject } from './state/project';

const store = new Store(defaultProject());

const app = document.getElementById('app')!;
const probe = document.createElement('pre');
app.appendChild(probe);

const render = () => { probe.textContent = JSON.stringify(store.get(), null, 2); };
store.subscribe(render);
render();
```

- [ ] **Step 4: Run dev server, verify the JSON dump of the default project shows up**

Run: `npm run dev` and open the page.
Expected: a pretty-printed JSON block showing the default project with `canvas: { width: 1100, height: 35, unit: 'mm' }` and empty `layers`.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(state): project types, default factory, store with event bus"
```

---

### Task 3: SVG helpers

**Files:**
- Create: `src/utils/svg.ts`

- [ ] **Step 1: Write `src/utils/svg.ts`**

```ts
const NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  children: SVGElement[] = [],
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.appendChild(c);
  return el;
}

export function group(attrs: Record<string, string | number> = {}, children: SVGElement[] = []): SVGGElement {
  return svgEl('g', attrs, children);
}

export function line(x1: number, y1: number, x2: number, y2: number, sw: number): SVGLineElement {
  return svgEl('line', { x1, y1, x2, y2, stroke: '#000', 'stroke-width': sw, fill: 'none' });
}

export function rect(x: number, y: number, w: number, h: number, attrs: Record<string, string | number> = {}): SVGRectElement {
  return svgEl('rect', { x, y, width: w, height: h, fill: 'none', stroke: '#000', 'stroke-width': 0.1, ...attrs });
}

export function path(d: string, sw: number): SVGPathElement {
  return svgEl('path', { d, stroke: '#000', 'stroke-width': sw, fill: 'none' });
}

export function circle(cx: number, cy: number, r: number, sw: number): SVGCircleElement {
  return svgEl('circle', { cx, cy, r, stroke: '#000', 'stroke-width': sw, fill: 'none' });
}

export function makeSvg(canvasWidth: number, canvasHeight: number): SVGSVGElement {
  return svgEl('svg', {
    xmlns: NS,
    viewBox: `0 0 ${canvasWidth} ${canvasHeight}`,
    width: '100%',
    height: '100%',
    'preserveAspectRatio': 'xMidYMid meet',
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/svg.ts
git commit -m "feat(utils): svg element helpers"
```

---

### Task 4: Pattern registry skeleton + geometric generator

**Files:**
- Create: `src/patterns/geometric.ts`, `src/patterns/index.ts`

- [ ] **Step 1: Write `src/patterns/geometric.ts`**

```ts
import { GeometricParams, Canvas } from '../state/project';
import { svgEl, line } from '../utils/svg';

export function renderGeometric(params: GeometricParams, canvas: Canvas): SVGElement[] {
  const out: SVGElement[] = [];
  const { width: W, height: H } = canvas;
  const m = params.margin;
  const sw = params.strokeWidth;
  const spacing = Math.max(params.spacing, 0.1);

  // Clip area = inset rect [m, m, W-m, H-m]
  const clipId = `clip_${Math.random().toString(36).slice(2, 8)}`;
  const defs = svgEl('defs', {}, [
    svgEl('clipPath', { id: clipId }, [
      svgEl('rect', { x: m, y: m, width: Math.max(0, W - 2 * m), height: Math.max(0, H - 2 * m) }),
    ]),
  ]);
  out.push(defs);

  const wrap = svgEl('g', { 'clip-path': `url(#${clipId})` });

  switch (params.variant) {
    case 'lines':
    case 'chevrons':
    case 'lattice': {
      const angle = (params.angle * Math.PI) / 180;
      // Generate enough parallel lines to cover the bounding box rotated by `angle`.
      const diag = Math.hypot(W, H);
      const dx = Math.cos(angle + Math.PI / 2) * spacing;
      const dy = Math.sin(angle + Math.PI / 2) * spacing;
      const steps = Math.ceil(diag / spacing) + 2;
      const cx = W / 2;
      const cy = H / 2;
      for (let i = -steps; i <= steps; i++) {
        const ox = cx + i * dx;
        const oy = cy + i * dy;
        const ex = Math.cos(angle) * diag;
        const ey = Math.sin(angle) * diag;
        wrap.appendChild(line(ox - ex, oy - ey, ox + ex, oy + ey, sw));
      }
      if (params.variant === 'lattice' || params.variant === 'chevrons') {
        const angle2 = params.variant === 'lattice' ? angle + Math.PI / 2 : Math.PI - angle;
        const dx2 = Math.cos(angle2 + Math.PI / 2) * spacing;
        const dy2 = Math.sin(angle2 + Math.PI / 2) * spacing;
        for (let i = -steps; i <= steps; i++) {
          const ox = cx + i * dx2;
          const oy = cy + i * dy2;
          const ex = Math.cos(angle2) * diag;
          const ey = Math.sin(angle2) * diag;
          wrap.appendChild(line(ox - ex, oy - ey, ox + ex, oy + ey, sw));
        }
      }
      break;
    }
    case 'grid': {
      for (let x = m; x <= W - m + 1e-6; x += spacing) wrap.appendChild(line(x, m, x, H - m, sw));
      for (let y = m; y <= H - m + 1e-6; y += spacing) wrap.appendChild(line(m, y, W - m, y, sw));
      break;
    }
    case 'dots': {
      // Small filled circles work reliably for engraving (single-pulse spots).
      const dotsGroup = svgEl('g');
      for (let x = m; x <= W - m + 1e-6; x += spacing) {
        for (let y = m; y <= H - m + 1e-6; y += spacing) {
          dotsGroup.appendChild(svgEl('circle', { cx: x, cy: y, r: sw / 2, fill: '#000', stroke: 'none' }));
        }
      }
      wrap.appendChild(dotsGroup);
      break;
    }
  }

  out.push(wrap);
  return out;
}

export function defaultGeometricParams(): GeometricParams {
  return { variant: 'lines', spacing: 4, angle: 45, strokeWidth: 0.2, margin: 2 };
}
```

- [ ] **Step 2: Write `src/patterns/index.ts`** (placeholder dispatch for now)

```ts
import { Layer, Canvas, PatternKind, Pattern } from '../state/project';
import { renderGeometric, defaultGeometricParams } from './geometric';

export function renderLayer(layer: Layer, canvas: Canvas): SVGElement[] {
  switch (layer.pattern.kind) {
    case 'geometric': return renderGeometric(layer.pattern.params, canvas);
    case 'frieze':    return [];   // implemented in Task 8
    case 'scatter':   return [];   // implemented in Task 9
    case 'text':      return [];   // implemented in Task 10
  }
}

export function defaultPatternForKind(kind: PatternKind): Pattern {
  switch (kind) {
    case 'geometric': return { kind: 'geometric', params: defaultGeometricParams() };
    case 'frieze':    return { kind: 'frieze',    params: { variant: 'wave',  period: 20, amplitude: 5, strokeWidth: 0.3, offsetX: 0, mirror: false, y: 17.5 } };
    case 'scatter':   return { kind: 'scatter',   params: { shape: 'star',    density: 5, minSize: 2, maxSize: 4, rotationJitter: 45, seed: 1, strokeWidth: 0.2 } };
    case 'text':      return { kind: 'text',      params: { content: 'HELLO', fontFamily: 'serif', sizeMm: 15, x: 100, y: 25, rotation: 0, align: 'start', strokeWidth: 0.3 } };
  }
}

export const PATTERN_KINDS: PatternKind[] = ['geometric', 'frieze', 'scatter', 'text'];
```

- [ ] **Step 3: Commit**

```bash
git add src/patterns
git commit -m "feat(patterns): geometric generator + registry skeleton"
```

---

### Task 5: Canvas/preview panel with zoom & pan

**Files:**
- Create: `src/render/preview.ts`
- Create: `src/ui/canvas-panel.ts`
- Modify: `src/main.ts`, `src/style.css`

- [ ] **Step 1: Write `src/render/preview.ts`**

```ts
import { Project } from '../state/project';
import { makeSvg, rect } from '../utils/svg';
import { renderLayer } from '../patterns';

export function buildPreviewSvg(project: Project): SVGSVGElement {
  const { width, height } = project.canvas;
  const svg = makeSvg(width, height);

  // Belt outline (thin guide, not exported in laser SVG)
  svg.appendChild(rect(0, 0, width, height, { stroke: '#bbb', 'stroke-width': 0.1 }));

  // Layers bottom-up, applying mask if needed
  let maskGroup: SVGGElement | null = null;
  for (const layer of project.layers) {
    if (!layer.visible) continue;
    const elements = renderLayer(layer, project.canvas);

    if (layer.blendMode === 'mask') {
      // Build a clipPath from this layer's geometry, applied to next layers
      const clipId = `mask_${layer.id}`;
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const cp = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
      cp.setAttribute('id', clipId);
      for (const e of elements) cp.appendChild(e.cloneNode(true) as SVGElement);
      defs.appendChild(cp);
      svg.appendChild(defs);

      maskGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
      maskGroup.setAttribute('clip-path', `url(#${clipId})`);
      svg.appendChild(maskGroup);
      continue; // mask layer does not render itself
    }

    const target = maskGroup ?? svg;
    for (const e of elements) target.appendChild(e);
  }

  return svg;
}
```

- [ ] **Step 2: Write `src/ui/canvas-panel.ts`**

```ts
import { Store } from '../state/project';
import { buildPreviewSvg } from '../render/preview';

export function mountCanvasPanel(container: HTMLElement, store: Store): void {
  container.innerHTML = '';
  container.classList.add('canvas-panel');

  const viewport = document.createElement('div');
  viewport.className = 'preview-viewport';
  container.appendChild(viewport);

  let scale = 1;
  let tx = 0;
  let ty = 0;

  const wrap = document.createElement('div');
  wrap.className = 'preview-wrap';
  viewport.appendChild(wrap);

  const apply = () => {
    wrap.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };

  const rerender = () => {
    wrap.innerHTML = '';
    wrap.appendChild(buildPreviewSvg(store.get()));
  };

  store.subscribe(rerender);
  rerender();

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    scale = Math.min(50, Math.max(0.1, scale * factor));
    apply();
  }, { passive: false });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  viewport.addEventListener('mousedown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    tx += e.clientX - lastX; ty += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    apply();
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  apply();
}
```

- [ ] **Step 3: Replace `src/main.ts` with the 3-column shell** (panels filled progressively)

```ts
import './style.css';
import { Store, defaultProject, makeLayer } from './state/project';
import { mountCanvasPanel } from './ui/canvas-panel';
import { defaultPatternForKind } from './patterns';

const store = new Store(defaultProject());

// Seed one geometric layer so the preview is not blank
store.update((p) => {
  const l = makeLayer(defaultPatternForKind('geometric'), 'Geometric 1');
  p.layers = [l];
  p.selectedLayerId = l.id;
});

const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="app-header"></header>
  <main class="app-main">
    <aside class="layers"></aside>
    <section class="canvas"></section>
    <aside class="props"></aside>
  </main>
`;

mountCanvasPanel(app.querySelector('.canvas') as HTMLElement, store);
```

- [ ] **Step 4: Extend `src/style.css` with the layout**

```css
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; font-family: system-ui, sans-serif; }
#app { display: flex; flex-direction: column; }
.app-header { height: 48px; border-bottom: 1px solid #ddd; padding: 0 12px; display: flex; align-items: center; gap: 12px; }
.app-main { flex: 1; display: grid; grid-template-columns: 240px 1fr 280px; min-height: 0; }
.layers, .props { border: 1px solid #ddd; overflow: auto; padding: 8px; background: #fafafa; }
.canvas { background: #f4f4f4; overflow: hidden; position: relative; }
.preview-viewport { width: 100%; height: 100%; overflow: hidden; cursor: grab; }
.preview-viewport:active { cursor: grabbing; }
.preview-wrap { width: 100%; height: 100%; transform-origin: 0 0; }
.preview-wrap svg { width: 100%; height: 100%; }
button { font: inherit; padding: 4px 8px; cursor: pointer; }
input[type="number"], input[type="text"], select { font: inherit; padding: 2px 4px; }
label { display: flex; gap: 6px; align-items: center; margin: 4px 0; font-size: 13px; }
label > span { flex: 1; }
label > input, label > select { width: 110px; }
```

- [ ] **Step 5: Run dev server, verify the geometric layer renders, zoom/pan works**

Run: `npm run dev`
Expected: a long thin belt rectangle (with grey outline) filled with diagonal parallel lines at 45° spaced 4 mm apart. Wheel zooms; click-drag pans.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(ui): canvas/preview panel with zoom and pan; geometric layer renders"
```

---

### Task 6: Layers panel

**Files:**
- Create: `src/ui/layers-panel.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/ui/layers-panel.ts`**

```ts
import { Store, makeLayer } from '../state/project';
import { defaultPatternForKind, PATTERN_KINDS } from '../patterns';

export function mountLayersPanel(container: HTMLElement, store: Store): void {
  const render = () => {
    const project = store.get();
    container.innerHTML = '';

    const addRow = document.createElement('div');
    addRow.style.display = 'flex';
    addRow.style.gap = '4px';

    const select = document.createElement('select');
    for (const k of PATTERN_KINDS) {
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = k;
      select.appendChild(opt);
    }
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add layer';
    addBtn.onclick = () => {
      const kind = select.value as typeof PATTERN_KINDS[number];
      store.update((p) => {
        const l = makeLayer(defaultPatternForKind(kind), `${kind} ${p.layers.length + 1}`);
        p.layers = [...p.layers, l];
        p.selectedLayerId = l.id;
      });
    };
    addRow.appendChild(select);
    addRow.appendChild(addBtn);
    container.appendChild(addRow);

    const list = document.createElement('div');
    list.style.marginTop = '8px';
    container.appendChild(list);

    // Show top-most first in UI (reverse of array order)
    [...project.layers].reverse().forEach((layer, revIdx) => {
      const realIdx = project.layers.length - 1 - revIdx;
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '4px';
      row.style.padding = '4px';
      row.style.border = '1px solid ' + (layer.id === project.selectedLayerId ? '#3366ff' : '#ddd');
      row.style.background = '#fff';
      row.style.marginBottom = '4px';
      row.style.cursor = 'pointer';
      row.onclick = () => store.update((p) => { p.selectedLayerId = layer.id; });

      const vis = document.createElement('input');
      vis.type = 'checkbox'; vis.checked = layer.visible;
      vis.onclick = (e) => { e.stopPropagation(); };
      vis.onchange = () => store.update((p) => {
        p.layers = p.layers.map((l) => l.id === layer.id ? { ...l, visible: vis.checked } : l);
      });
      row.appendChild(vis);

      const nameInput = document.createElement('input');
      nameInput.type = 'text'; nameInput.value = layer.name;
      nameInput.style.flex = '1';
      nameInput.onclick = (e) => e.stopPropagation();
      nameInput.onchange = () => store.update((p) => {
        p.layers = p.layers.map((l) => l.id === layer.id ? { ...l, name: nameInput.value } : l);
      });
      row.appendChild(nameInput);

      const maskBtn = document.createElement('button');
      maskBtn.textContent = layer.blendMode === 'mask' ? 'mask' : 'norm';
      maskBtn.title = 'Toggle mask mode';
      maskBtn.onclick = (e) => {
        e.stopPropagation();
        store.update((p) => {
          p.layers = p.layers.map((l) => l.id === layer.id
            ? { ...l, blendMode: l.blendMode === 'mask' ? 'normal' : 'mask' }
            : l);
        });
      };
      row.appendChild(maskBtn);

      const up = document.createElement('button');
      up.textContent = '↑';
      up.onclick = (e) => { e.stopPropagation(); move(realIdx, +1); };
      const down = document.createElement('button');
      down.textContent = '↓';
      down.onclick = (e) => { e.stopPropagation(); move(realIdx, -1); };
      row.appendChild(up);
      row.appendChild(down);

      const del = document.createElement('button');
      del.textContent = '✕';
      del.onclick = (e) => {
        e.stopPropagation();
        store.update((p) => {
          p.layers = p.layers.filter((l) => l.id !== layer.id);
          if (p.selectedLayerId === layer.id) p.selectedLayerId = p.layers[p.layers.length - 1]?.id ?? null;
        });
      };
      row.appendChild(del);

      list.appendChild(row);
    });
  };

  function move(idx: number, dir: number): void {
    store.update((p) => {
      const next = [...p.layers];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return;
      [next[idx], next[target]] = [next[target], next[idx]];
      p.layers = next;
    });
  }

  store.subscribe(render);
  render();
}
```

- [ ] **Step 2: Mount it in `src/main.ts`**

Add the import and the call after the canvas mount:
```ts
import { mountLayersPanel } from './ui/layers-panel';
// ...
mountLayersPanel(app.querySelector('.layers') as HTMLElement, store);
```

- [ ] **Step 3: Run dev server, exercise add/reorder/visibility/mask toggle/delete**

Run: `npm run dev`
Expected:
- The seeded geometric layer appears at top of the list.
- Add a new layer (any kind) → it appears at the top.
- Toggle visibility checkbox → preview updates (empty layers like frieze/scatter/text still render nothing in this task).
- Reorder ↑/↓ works without errors.
- Mask button toggles label between `norm` / `mask`.
- Delete removes the row.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(ui): layers panel with add/reorder/visibility/mask/delete"
```

---

### Task 7: Props panel (geometric only for now)

**Files:**
- Create: `src/ui/props-panel.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/ui/props-panel.ts`**

```ts
import { Store, Layer, GeometricParams, FriezeParams, ScatterParams, TextParams } from '../state/project';

type FieldDef =
  | { kind: 'number'; key: string; label: string; min?: number; max?: number; step?: number }
  | { kind: 'text';   key: string; label: string }
  | { kind: 'select'; key: string; label: string; options: string[] }
  | { kind: 'checkbox'; key: string; label: string };

const GEOM_FIELDS: FieldDef[] = [
  { kind: 'select', key: 'variant', label: 'variant', options: ['lines', 'grid', 'chevrons', 'lattice', 'dots'] },
  { kind: 'number', key: 'spacing', label: 'spacing (mm)', min: 0.5, step: 0.5 },
  { kind: 'number', key: 'angle', label: 'angle (°)', step: 5 },
  { kind: 'number', key: 'strokeWidth', label: 'stroke (mm)', min: 0.05, step: 0.05 },
  { kind: 'number', key: 'margin', label: 'margin (mm)', min: 0, step: 0.5 },
];

const FRIEZE_FIELDS: FieldDef[] = [
  { kind: 'select', key: 'variant', label: 'variant', options: ['wave', 'greek', 'braid', 'crenel'] },
  { kind: 'number', key: 'period', label: 'period (mm)', min: 1, step: 1 },
  { kind: 'number', key: 'amplitude', label: 'amplitude (mm)', min: 0, step: 0.5 },
  { kind: 'number', key: 'strokeWidth', label: 'stroke (mm)', min: 0.05, step: 0.05 },
  { kind: 'number', key: 'offsetX', label: 'offsetX (mm)', step: 1 },
  { kind: 'number', key: 'y', label: 'y center (mm)', step: 0.5 },
  { kind: 'checkbox', key: 'mirror', label: 'mirror' },
];

const SCATTER_FIELDS: FieldDef[] = [
  { kind: 'select', key: 'shape', label: 'shape', options: ['star', 'flower', 'rune', 'circle'] },
  { kind: 'number', key: 'density', label: 'density / 100mm', min: 0.5, step: 0.5 },
  { kind: 'number', key: 'minSize', label: 'min size (mm)', min: 0.5, step: 0.5 },
  { kind: 'number', key: 'maxSize', label: 'max size (mm)', min: 0.5, step: 0.5 },
  { kind: 'number', key: 'rotationJitter', label: 'rotation jitter (°)', step: 5 },
  { kind: 'number', key: 'seed', label: 'seed', step: 1 },
  { kind: 'number', key: 'strokeWidth', label: 'stroke (mm)', min: 0.05, step: 0.05 },
];

const TEXT_FIELDS: FieldDef[] = [
  { kind: 'text',   key: 'content', label: 'content' },
  { kind: 'text',   key: 'fontFamily', label: 'font family' },
  { kind: 'number', key: 'sizeMm', label: 'size (mm)', min: 1, step: 0.5 },
  { kind: 'number', key: 'x', label: 'x (mm)', step: 1 },
  { kind: 'number', key: 'y', label: 'y baseline (mm)', step: 0.5 },
  { kind: 'number', key: 'rotation', label: 'rotation (°)', step: 5 },
  { kind: 'select', key: 'align', label: 'align', options: ['start', 'middle', 'end'] },
  { kind: 'number', key: 'strokeWidth', label: 'stroke (mm)', min: 0.05, step: 0.05 },
];

function fieldsFor(layer: Layer): FieldDef[] {
  switch (layer.pattern.kind) {
    case 'geometric': return GEOM_FIELDS;
    case 'frieze':    return FRIEZE_FIELDS;
    case 'scatter':   return SCATTER_FIELDS;
    case 'text':      return TEXT_FIELDS;
  }
}

export function mountPropsPanel(container: HTMLElement, store: Store): void {
  const render = () => {
    const project = store.get();
    container.innerHTML = '';
    const layer = project.layers.find((l) => l.id === project.selectedLayerId);
    if (!layer) {
      container.textContent = 'No layer selected.';
      return;
    }
    const title = document.createElement('h4');
    title.textContent = `${layer.pattern.kind} — ${layer.name}`;
    title.style.margin = '0 0 8px';
    container.appendChild(title);

    const fields = fieldsFor(layer);
    const params = layer.pattern.params as unknown as Record<string, unknown>;
    for (const f of fields) {
      const lbl = document.createElement('label');
      const span = document.createElement('span');
      span.textContent = f.label;
      lbl.appendChild(span);
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.kind === 'select') {
        input = document.createElement('select');
        for (const o of f.options) {
          const opt = document.createElement('option');
          opt.value = o; opt.textContent = o;
          (input as HTMLSelectElement).appendChild(opt);
        }
        (input as HTMLSelectElement).value = String(params[f.key]);
      } else if (f.kind === 'checkbox') {
        input = document.createElement('input');
        input.type = 'checkbox';
        (input as HTMLInputElement).checked = Boolean(params[f.key]);
      } else {
        input = document.createElement('input');
        input.type = f.kind === 'number' ? 'number' : 'text';
        if (f.kind === 'number') {
          if (f.min !== undefined) input.min = String(f.min);
          if (f.max !== undefined) input.max = String(f.max);
          if (f.step !== undefined) input.step = String(f.step);
        }
        (input as HTMLInputElement).value = String(params[f.key]);
      }
      input.oninput = () => {
        const v = f.kind === 'number'
          ? Number((input as HTMLInputElement).value)
          : f.kind === 'checkbox'
            ? (input as HTMLInputElement).checked
            : (input as HTMLInputElement | HTMLSelectElement).value;
        store.update((p) => {
          p.layers = p.layers.map((l) => {
            if (l.id !== layer.id) return l;
            const nextParams = { ...(l.pattern.params as unknown as Record<string, unknown>), [f.key]: v };
            return { ...l, pattern: { ...l.pattern, params: nextParams } as typeof l.pattern };
          });
        });
      };
      lbl.appendChild(input);
      container.appendChild(lbl);
    }
  };

  store.subscribe(render);
  render();
}

// Re-export types so other modules can import from one place if needed.
export type { GeometricParams, FriezeParams, ScatterParams, TextParams };
```

- [ ] **Step 2: Mount in `src/main.ts`**

Add:
```ts
import { mountPropsPanel } from './ui/props-panel';
// ...
mountPropsPanel(app.querySelector('.props') as HTMLElement, store);
```

- [ ] **Step 3: Run dev server, tweak geometric params, confirm live update**

Run: `npm run dev`
Expected: editing `spacing`, `angle`, `variant`, `strokeWidth`, `margin` immediately re-renders the preview. Try `variant = grid`, `variant = lattice`, `variant = chevrons`, `variant = dots`.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(ui): props panel with field-driven editors for all pattern kinds"
```

---

### Task 8: Frieze generator

**Files:**
- Create: `src/patterns/frieze.ts`
- Modify: `src/patterns/index.ts`

- [ ] **Step 1: Write `src/patterns/frieze.ts`**

```ts
import { FriezeParams, Canvas } from '../state/project';
import { path } from '../utils/svg';

export function renderFrieze(params: FriezeParams, canvas: Canvas): SVGElement[] {
  const { width: W } = canvas;
  const { variant, period: P, amplitude: A, strokeWidth, offsetX, y, mirror } = params;
  const out: SVGElement[] = [];

  const drawOne = (yc: number, flipY = false): SVGElement => {
    const sign = flipY ? -1 : 1;
    let d = '';
    switch (variant) {
      case 'wave': {
        // Quadratic bezier waves over each half period
        const half = P / 2;
        d = `M ${offsetX} ${yc}`;
        let x = offsetX;
        let up = true;
        while (x < W) {
          const nx = x + half;
          const cy = yc + sign * (up ? -A : A);
          d += ` Q ${(x + nx) / 2} ${cy} ${nx} ${yc}`;
          x = nx; up = !up;
        }
        break;
      }
      case 'greek': {
        // Classic greek key: repeating right-angle motif of width P
        let x = offsetX;
        d = `M ${x} ${yc + sign * A}`;
        while (x < W) {
          d += ` L ${x} ${yc - sign * A}`;
          d += ` L ${x + P * 0.7} ${yc - sign * A}`;
          d += ` L ${x + P * 0.7} ${yc + sign * A * 0.3}`;
          d += ` L ${x + P * 0.3} ${yc + sign * A * 0.3}`;
          d += ` L ${x + P * 0.3} ${yc - sign * A * 0.4}`;
          d += ` L ${x + P * 0.55} ${yc - sign * A * 0.4}`;
          x += P;
          d += ` L ${x} ${yc - sign * A * 0.4}`;
          d += ` L ${x} ${yc + sign * A}`;
        }
        break;
      }
      case 'braid': {
        // Two interlaced sinusoids
        const steps = Math.max(1, Math.floor(W / 2));
        d = `M ${offsetX} ${yc + Math.sin(0) * A * sign}`;
        for (let i = 0; i <= steps; i++) {
          const x = offsetX + (i / steps) * W;
          d += ` L ${x} ${yc + Math.sin((x / P) * Math.PI * 2) * A * sign}`;
        }
        const d2: string[] = [`M ${offsetX} ${yc + Math.cos(0) * A * sign}`];
        for (let i = 0; i <= steps; i++) {
          const x = offsetX + (i / steps) * W;
          d2.push(`L ${x} ${yc + Math.cos((x / P) * Math.PI * 2) * A * sign}`);
        }
        out.push(path(d2.join(' '), strokeWidth));
        break;
      }
      case 'crenel': {
        let x = offsetX;
        d = `M ${x} ${yc + sign * A}`;
        let high = true;
        const half = P / 2;
        while (x < W) {
          d += ` L ${x + half} ${yc + sign * (high ? A : -A)}`;
          x += half;
          d += ` L ${x} ${yc + sign * (high ? -A : A)}`;
          high = !high;
        }
        break;
      }
    }
    return path(d, strokeWidth);
  };

  out.push(drawOne(y));
  if (mirror) out.push(drawOne(y, true));
  return out;
}
```

- [ ] **Step 2: Wire it into `src/patterns/index.ts`**

Change:
```ts
case 'frieze':    return [];
```
to:
```ts
case 'frieze':    return renderFrieze(layer.pattern.params, canvas);
```
and add `import { renderFrieze } from './frieze';` at the top.

- [ ] **Step 3: Run dev server, add a frieze layer, try every variant**

Run: `npm run dev`
Expected: each of `wave`, `greek`, `braid`, `crenel` renders a horizontal pattern centered around the chosen y. Mirror checkbox doubles it.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(patterns): frieze generator (wave, greek, braid, crenel)"
```

---

### Task 9: Scatter generator

**Files:**
- Create: `src/patterns/scatter.ts`
- Modify: `src/patterns/index.ts`

- [ ] **Step 1: Write `src/patterns/scatter.ts`**

```ts
import { ScatterParams, Canvas } from '../state/project';
import { svgEl, path, circle } from '../utils/svg';

// Mulberry32 PRNG — small, deterministic, seedable
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shapePath(shape: ScatterParams['shape'], cx: number, cy: number, size: number, rot: number, sw: number): SVGElement {
  const r = size / 2;
  switch (shape) {
    case 'circle':
      return circle(cx, cy, r, sw);
    case 'star': {
      const points: string[] = [];
      const n = 5;
      for (let i = 0; i < n * 2; i++) {
        const ang = (rot * Math.PI) / 180 + (i * Math.PI) / n - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        points.push(`${cx + Math.cos(ang) * rr},${cy + Math.sin(ang) * rr}`);
      }
      return svgEl('polygon', { points: points.join(' '), stroke: '#000', 'stroke-width': sw, fill: 'none' });
    }
    case 'flower': {
      // 6 petals as small circles around the center
      const g = svgEl('g');
      const k = 6;
      for (let i = 0; i < k; i++) {
        const ang = (rot * Math.PI) / 180 + (i * Math.PI * 2) / k;
        g.appendChild(circle(cx + Math.cos(ang) * r * 0.5, cy + Math.sin(ang) * r * 0.5, r * 0.5, sw));
      }
      g.appendChild(circle(cx, cy, r * 0.25, sw));
      return g;
    }
    case 'rune': {
      // A simple cross with serifs — feels rune-ish
      const cosA = Math.cos((rot * Math.PI) / 180);
      const sinA = Math.sin((rot * Math.PI) / 180);
      const p = (x: number, y: number) => `${cx + x * cosA - y * sinA} ${cy + x * sinA + y * cosA}`;
      const d = `M ${p(-r, 0)} L ${p(r, 0)} M ${p(0, -r)} L ${p(0, r)} M ${p(-r * 0.6, -r)} L ${p(r * 0.6, -r)} M ${p(-r * 0.6, r)} L ${p(r * 0.6, r)}`;
      return path(d, sw);
    }
  }
}

export function renderScatter(params: ScatterParams, canvas: Canvas): SVGElement[] {
  const { width: W, height: H } = canvas;
  const rng = mulberry32(params.seed);
  const count = Math.max(0, Math.round((params.density * W) / 100));
  const margin = Math.max(params.maxSize / 2, 1);
  const g = svgEl('g');
  for (let i = 0; i < count; i++) {
    const x = margin + rng() * (W - margin * 2);
    const y = margin + rng() * (H - margin * 2);
    const size = params.minSize + rng() * (params.maxSize - params.minSize);
    const rot = (rng() - 0.5) * 2 * params.rotationJitter;
    g.appendChild(shapePath(params.shape, x, y, size, rot, params.strokeWidth));
  }
  return [g];
}
```

- [ ] **Step 2: Wire into `src/patterns/index.ts`** (`case 'scatter'`) similar to Task 8.

- [ ] **Step 3: Run dev server, add a scatter layer, vary `seed`, `density`, `shape`**

Run: `npm run dev`
Expected: dots are stable per seed; switching seed changes the layout deterministically. All four shapes render.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(patterns): scatter generator with seeded jitter (star/flower/rune/circle)"
```

---

### Task 10: Text generator (preview only, via <text>)

**Files:**
- Create: `src/patterns/text.ts`
- Modify: `src/patterns/index.ts`

> The preview uses an SVG `<text>` element rendered by the browser. Conversion to path happens **only at export** (Task 12) using `opentype.js`. This keeps the preview fast and the text editable.

- [ ] **Step 1: Write `src/patterns/text.ts`**

```ts
import { TextParams, Canvas } from '../state/project';
import { svgEl } from '../utils/svg';

export function renderText(params: TextParams, _canvas: Canvas): SVGElement[] {
  // SVG font-size is in user units (mm here). Stroke for preview = thin black line so the user
  // sees roughly the engraving result; fill is none.
  const t = svgEl('text', {
    x: params.x,
    y: params.y,
    'font-family': params.fontFamily,
    'font-size': params.sizeMm,
    'text-anchor': params.align,
    transform: `rotate(${params.rotation} ${params.x} ${params.y})`,
    fill: '#000',
    stroke: 'none',
  });
  t.textContent = params.content;
  return [t];
}
```

- [ ] **Step 2: Wire into `src/patterns/index.ts`** (`case 'text'`).

- [ ] **Step 3: Run dev server, add a text layer, edit content/size/x/y/rotation**

Run: `npm run dev`
Expected: text appears at the configured position. Changing `align` shifts the anchor (start/middle/end). Rotating works around the (x,y) anchor.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(patterns): text generator (preview uses native <text>)"
```

---

### Task 11: Persistence — localStorage autosave + JSON import/export

**Files:**
- Create: `src/state/persistence.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/state/persistence.ts`**

```ts
import { Project, Store, defaultProject } from './project';

const KEY = 'engrave-pattern-generator:project';
const DEBOUNCE_MS = 300;

export function loadProject(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProject();
    const obj = JSON.parse(raw);
    if (obj && obj.version === 1) return obj as Project;
  } catch { /* fall through */ }
  return defaultProject();
}

export function attachAutosave(store: Store): void {
  let t: number | undefined;
  store.subscribe((p) => {
    if (t !== undefined) window.clearTimeout(t);
    t = window.setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* quota errors are ignored */ }
    }, DEBOUNCE_MS);
  });
}

export function exportProjectJson(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(project.name || 'project').replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importProjectJson(file: File, store: Store): Promise<void> {
  return file.text().then((txt) => {
    const obj = JSON.parse(txt);
    if (!obj || obj.version !== 1) throw new Error('Unsupported project version');
    store.set(obj as Project);
  });
}
```

- [ ] **Step 2: Use it from `src/main.ts`**

Replace the `new Store(defaultProject())` line:
```ts
import { loadProject, attachAutosave } from './state/persistence';
// ...
const store = new Store(loadProject());
attachAutosave(store);
```

Remove the "seed one geometric layer" block if the loaded project already has layers:
```ts
if (store.get().layers.length === 0) {
  store.update((p) => {
    const l = makeLayer(defaultPatternForKind('geometric'), 'Geometric 1');
    p.layers = [l];
    p.selectedLayerId = l.id;
  });
}
```

- [ ] **Step 3: Run dev server, reload, verify state persists; clear LocalStorage, verify default project comes back**

Run: `npm run dev`
Expected: any edit survives a hard refresh. Running `localStorage.clear()` in the devtools then reloading shows the default seeded project.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(state): localStorage autosave + JSON import/export helpers"
```

---

### Task 12: Header — name, canvas dims, export SVG, JSON I/O

**Files:**
- Create: `src/ui/header.ts`
- Modify: `src/main.ts`
- New: `src/render/export.ts` (used by header export button — implemented in Task 13)

> This task only wires the buttons. The actual export pipeline lands in Task 13.

- [ ] **Step 1: Stub `src/render/export.ts`**

```ts
import { Project } from '../state/project';

export async function exportLaserSvg(project: Project, options: { strokeOnly: boolean; textToPath: boolean }): Promise<string> {
  // Filled in by Task 13. For now, throw to make the missing wiring obvious.
  void project; void options;
  throw new Error('exportLaserSvg not implemented yet');
}
```

- [ ] **Step 2: Write `src/ui/header.ts`**

```ts
import { Store } from '../state/project';
import { exportProjectJson, importProjectJson } from '../state/persistence';
import { exportLaserSvg } from '../render/export';

export function mountHeader(container: HTMLElement, store: Store): void {
  const render = () => {
    const project = store.get();
    container.innerHTML = '';

    const name = document.createElement('input');
    name.type = 'text'; name.value = project.name; name.style.width = '180px';
    name.oninput = () => store.update((p) => { p.name = name.value; });
    container.appendChild(name);

    const wInput = numberInput(project.canvas.width, 1, (v) => store.update((p) => { p.canvas = { ...p.canvas, width: v }; }));
    const hInput = numberInput(project.canvas.height, 0.5, (v) => store.update((p) => { p.canvas = { ...p.canvas, height: v }; }));
    container.appendChild(label('W (mm)', wInput));
    container.appendChild(label('H (mm)', hInput));

    const spacer = document.createElement('div'); spacer.style.flex = '1';
    container.appendChild(spacer);

    const strokeOnly = document.createElement('input');
    strokeOnly.type = 'checkbox'; strokeOnly.checked = true;
    container.appendChild(label('stroke only', strokeOnly));

    const textToPath = document.createElement('input');
    textToPath.type = 'checkbox'; textToPath.checked = true;
    container.appendChild(label('text→path', textToPath));

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export SVG';
    exportBtn.onclick = async () => {
      try {
        const svg = await exportLaserSvg(store.get(), {
          strokeOnly: strokeOnly.checked,
          textToPath: textToPath.checked,
        });
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(store.get().name || 'belt').replace(/\s+/g, '_')}.svg`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert((err as Error).message);
      }
    };
    container.appendChild(exportBtn);

    const jsonOut = document.createElement('button');
    jsonOut.textContent = '↓ JSON';
    jsonOut.onclick = () => exportProjectJson(store.get());
    container.appendChild(jsonOut);

    const jsonIn = document.createElement('button');
    jsonIn.textContent = '↑ JSON';
    jsonIn.onclick = () => {
      const f = document.createElement('input');
      f.type = 'file'; f.accept = 'application/json';
      f.onchange = async () => {
        const file = f.files?.[0]; if (!file) return;
        try { await importProjectJson(file, store); } catch (e) { alert((e as Error).message); }
      };
      f.click();
    };
    container.appendChild(jsonIn);
  };

  function numberInput(value: number, step: number, onChange: (v: number) => void): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'number'; i.value = String(value); i.step = String(step); i.style.width = '80px';
    i.oninput = () => onChange(Number(i.value));
    return i;
  }
  function label(text: string, input: HTMLElement): HTMLElement {
    const l = document.createElement('label'); l.style.gap = '4px';
    const s = document.createElement('span'); s.textContent = text;
    l.appendChild(s); l.appendChild(input);
    return l;
  }

  store.subscribe(render);
  render();
}
```

- [ ] **Step 3: Mount in `src/main.ts`**

```ts
import { mountHeader } from './ui/header';
// ...
mountHeader(app.querySelector('.app-header') as HTMLElement, store);
```

- [ ] **Step 4: Run dev server, test name/dims/JSON download/upload; Export SVG should throw with the placeholder message**

Run: `npm run dev`
Expected:
- Project name persists in LocalStorage between reloads.
- Changing W/H updates the preview viewBox immediately.
- "↓ JSON" downloads the current state.
- "↑ JSON" reads it back.
- "Export SVG" pops an alert: `exportLaserSvg not implemented yet`.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(ui): header with name, canvas dims, JSON I/O, export button (stub)"
```

---

### Task 13: SVG export (stroke-only, text→path via opentype.js)

**Files:**
- Modify: `src/render/export.ts`
- Modify: `index.html` (load a default web font for text-to-path; see step 2)

`opentype.js` cannot read CSS-loaded fonts directly — it needs a font file URL. To keep the project self-contained and offline-capable, we ship a single default font (`NotoSans-Regular.ttf`) and use it for `text→path` regardless of `fontFamily` in V1. The `fontFamily` field still drives the **preview** (which uses native `<text>`), so the user can roughly preview a system font, but the exported path is always the bundled font.

- [ ] **Step 1: Add the bundled font**

Place `NotoSans-Regular.ttf` at `public/fonts/NotoSans-Regular.ttf` (Apache-2.0 — fetch from `https://fonts.google.com/noto/specimen/Noto+Sans` and download the regular weight TTF).

- [ ] **Step 2: Write `src/render/export.ts`**

```ts
import opentype from 'opentype.js';
import { Project, TextParams } from '../state/project';
import { renderLayer } from '../patterns';
import { svgEl } from '../utils/svg';

let cachedFont: opentype.Font | null = null;
async function loadFont(): Promise<opentype.Font> {
  if (cachedFont) return cachedFont;
  const buf = await fetch('/fonts/NotoSans-Regular.ttf').then((r) => {
    if (!r.ok) throw new Error('Could not load /fonts/NotoSans-Regular.ttf');
    return r.arrayBuffer();
  });
  cachedFont = opentype.parse(buf);
  return cachedFont;
}

function textToPathElement(params: TextParams, font: opentype.Font): SVGElement {
  // opentype uses font units → use getPath with the requested em size; SVG units = mm here.
  const tmp = font.getPath(params.content, 0, 0, params.sizeMm);
  // Measure to support alignment
  const bbox = tmp.getBoundingBox();
  let dx = 0;
  if (params.align === 'middle') dx = -(bbox.x2 - bbox.x1) / 2;
  else if (params.align === 'end') dx = -(bbox.x2 - bbox.x1);
  const p = font.getPath(params.content, dx, 0, params.sizeMm);
  const d = p.toPathData(3);
  return svgEl('path', {
    d,
    transform: `translate(${params.x} ${params.y}) rotate(${params.rotation})`,
    stroke: '#000',
    'stroke-width': params.strokeWidth,
    fill: 'none',
  });
}

export async function exportLaserSvg(
  project: Project,
  options: { strokeOnly: boolean; textToPath: boolean },
): Promise<string> {
  // Strategy: reuse buildPreviewSvg for non-text layers; for text layers, replace with text-to-path when requested.
  const font = options.textToPath ? await loadFont() : null;

  const { width: W, height: H } = project.canvas;
  const svg = svgEl('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    width: `${W}mm`,
    height: `${H}mm`,
    viewBox: `0 0 ${W} ${H}`,
  });

  let maskGroup: SVGGElement | null = null;
  for (const layer of project.layers) {
    if (!layer.visible) continue;

    let elements: SVGElement[];
    if (layer.pattern.kind === 'text' && font) {
      elements = [textToPathElement(layer.pattern.params, font)];
    } else {
      elements = renderLayer(layer, project.canvas);
    }

    if (layer.blendMode === 'mask') {
      const clipId = `mask_${layer.id}`;
      const defs = svgEl('defs');
      const cp = svgEl('clipPath', { id: clipId });
      for (const e of elements) cp.appendChild(e.cloneNode(true) as SVGElement);
      defs.appendChild(cp);
      svg.appendChild(defs);

      maskGroup = svgEl('g', { 'clip-path': `url(#${clipId})` });
      svg.appendChild(maskGroup);
      continue;
    }

    if (options.strokeOnly) {
      // Force stroke + no fill everywhere
      for (const e of elements) forceStroke(e);
    }
    const target: SVGElement = maskGroup ?? svg;
    for (const e of elements) target.appendChild(e);
  }

  return new XMLSerializer().serializeToString(svg);
}

function forceStroke(el: SVGElement): void {
  if (!el.hasAttribute('stroke')) el.setAttribute('stroke', '#000');
  el.setAttribute('fill', 'none');
  // Recurse into children
  for (const child of Array.from(el.children) as SVGElement[]) forceStroke(child);
}
```

- [ ] **Step 3: Run dev server, build a small belt, click Export SVG, open the file**

Run: `npm run dev`
Expected:
- The downloaded file `<name>.svg` opens in a browser tab.
- `<svg width="1100mm" height="35mm" viewBox="0 0 1100 35">` in the source.
- Text layers are `<path>`s (not `<text>`).
- With `stroke only` checked, every shape has `stroke="#000" fill="none"`.
- Opening in Inkscape or LightBurn shows correct physical dimensions in mm.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(export): laser-ready SVG with mm units, stroke-only, text→path via opentype.js"
```

---

### Task 14: Polish, README, and final sanity pass

**Files:**
- Modify: `src/style.css` (small refinements)
- Create: `README.md`

- [ ] **Step 1: Add a README explaining the app**

`README.md`:
```markdown
# Engrave Pattern Generator

Browser tool to combine procedural patterns and text into an SVG pattern for laser-engraving leather belts.

## Quick start

    npm install
    npm run dev

Open the URL Vite prints. Add layers from the left panel, tweak parameters on the right, export with "Export SVG" in the header.

## Output

The exported SVG is in millimetres (`width="1100mm" height="35mm"`), stroke-only by default, with text flattened to paths via opentype.js. Import directly into LightBurn or RDWorks.

## Notes

- The bundled font for `text→path` is **Noto Sans Regular** (Apache-2.0). Add the file at `public/fonts/NotoSans-Regular.ttf` before exporting text.
- LocalStorage autosaves your project. Use the JSON ↑↓ buttons in the header to share presets.
```

- [ ] **Step 2: Run a final manual pass**

Run: `npm run dev`
Walk through:
- Default project loads.
- Add one of each pattern kind. Tweak params. Reorder. Toggle visibility. Toggle mask on a small shape and check it clips the layers below.
- Edit project name and dimensions.
- Export JSON, clear localStorage, re-import JSON → state restored.
- Export SVG, open with `xmllint --noout export.svg` (or any SVG viewer): no errors.

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "docs: readme + final polish"
```

---

## Spec coverage self-check

- Canvas size with default 1100×35: Task 2 (default), Task 12 (UI) ✓
- Always-visible preview: Task 5 ✓
- Geometric / frieze / scatter patterns: Tasks 4, 8, 9 ✓
- Text zones with font/size/position: Tasks 10, 13 ✓
- Layers stacking: Tasks 2, 6 ✓
- Mask blend mode: Tasks 5 (preview), 13 (export) ✓
- LocalStorage + JSON I/O: Tasks 11, 12 ✓
- Stroke-only / fill option / text→path / mm units: Task 13 ✓
- No tests: respected throughout ✓
