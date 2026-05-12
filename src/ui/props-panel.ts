import {
  Store, Layer, GeometricParams, FriezeParams, ScatterParams, TextParams, ScatterShape,
} from '../state/project';
import { tr } from '../i18n';
import { mountRichSelect, RichSelectHandle, RichSelectOption } from './rich-select';
import { mountRotationDial, RotationDialHandle } from './rotation-dial';
import { attachDragEdit } from './drag-edit';
import { defaultPatternForKind } from '../patterns';
import {
  registerCustomFont, getCustomFontFamilies, subscribeFontRegistry,
} from '../state/font-registry';
import {
  ensureFontsChecked, isFontAvailable, loadFont, markFontAvailable,
  subscribeFontAvailability,
} from '../state/font-availability';
import { shapePath } from '../patterns/scatter';
import { scaleForTargetSize } from '../patterns/svg-layer';
import { makeSvg } from '../utils/svg';

type FieldDef =
  | { kind: 'number'; key: string; label: string; min?: number; max?: number; step?: number; modulatable?: boolean }
  | { kind: 'slider'; key: string; label: string; min: number; max: number; step: number; modulatable?: boolean }
  | { kind: 'text';   key: string; label: string }
  | { kind: 'select'; key: string; label: string; options: string[] }
  | { kind: 'checkbox'; key: string; label: string }
  | { kind: 'layer-ids'; key: string; label: string };

const BUILTIN_FONTS = [
  'Noto Sans',
  'Arial', 'Arial Black', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS',
  'Geneva', 'Lucida Sans', 'Lucida Sans Unicode', 'Lucida Grande',
  'DejaVu Sans', 'Liberation Sans', 'Ubuntu', 'Cantarell', 'Segoe UI',
  'Times New Roman', 'Times', 'Georgia', 'Palatino', 'Palatino Linotype',
  'Book Antiqua', 'Garamond', 'Cambria', 'DejaVu Serif', 'Liberation Serif',
  'Courier New', 'Courier', 'Consolas', 'Lucida Console', 'Monaco',
  'DejaVu Sans Mono', 'Liberation Mono', 'Ubuntu Mono', 'Menlo',
  'Impact', 'Comic Sans MS', 'Brush Script MT',
  'sans-serif', 'serif', 'monospace',
];

const BUILTIN_SHAPES: ScatterShape[] = ['star', 'flower', 'rune', 'circle', 'custom'];

const GEOM_FIELDS: FieldDef[] = [
  { kind: 'select', key: 'variant', label: 'variante', options: ['lines', 'grid', 'chevrons', 'lattice', 'dots'] },
  { kind: 'number', key: 'spacing', label: 'espacement (mm)', min: 0.5, step: 0.5, modulatable: true },
  { kind: 'slider', key: 'angle', label: 'angle (°)', min: 0, max: 360, step: 1 },
  { kind: 'number', key: 'strokeWidth', label: 'trait (mm)', min: 0.05, step: 0.05, modulatable: true },
  { kind: 'number', key: 'zoneWidth', label: 'zone largeur (mm)', min: 1, step: 1 },
  { kind: 'number', key: 'zoneHeight', label: 'zone hauteur (mm)', min: 1, step: 1 },
];

const FRIEZE_FIELDS: FieldDef[] = [
  { kind: 'select', key: 'variant', label: 'variante', options: ['wave', 'greek', 'braid', 'crenel'] },
  { kind: 'number', key: 'period', label: 'période (mm)', min: 1, step: 1, modulatable: true },
  { kind: 'number', key: 'amplitude', label: 'amplitude (mm)', min: 0, step: 0.5, modulatable: true },
  { kind: 'number', key: 'strokeWidth', label: 'trait (mm)', min: 0.05, step: 0.05 },
  { kind: 'number', key: 'offsetX', label: 'phase (mm)', step: 1 },
  { kind: 'checkbox', key: 'mirror', label: 'miroir' },
  { kind: 'number', key: 'mirrorOffsetY', label: 'décalage Y miroir (mm)', step: 0.5, modulatable: true },
];

const SCATTER_FIELDS: FieldDef[] = [
  { kind: 'select', key: 'shape', label: 'forme', options: [] },
  { kind: 'checkbox', key: 'customForceStroke', label: 'forcer trait noir (custom)' },
  { kind: 'number', key: 'density', label: 'densité / 100mm', min: 0.5, step: 0.5, modulatable: true },
  { kind: 'number', key: 'minSize', label: 'taille min (mm)', min: 0.5, step: 0.5, modulatable: true },
  { kind: 'number', key: 'maxSize', label: 'taille max (mm)', min: 0.5, step: 0.5, modulatable: true },
  { kind: 'slider', key: 'rotationJitter', label: 'jitter rotation (°)', min: 0, max: 180, step: 5 },
  { kind: 'number', key: 'seed', label: 'graine', step: 1 },
  { kind: 'number', key: 'strokeWidth', label: 'trait (mm)', min: 0.05, step: 0.05, modulatable: true },
  { kind: 'number', key: 'zoneWidth', label: 'zone largeur (mm)', min: 1, step: 1 },
  { kind: 'number', key: 'zoneHeight', label: 'zone hauteur (mm)', min: 1, step: 1 },
];

const MAZE_FIELDS: FieldDef[] = [
  { kind: 'select', key: 'cellShape', label: 'cellule', options: ['square', 'hex'] },
  { kind: 'number', key: 'cellSize', label: 'taille cellule (mm)', min: 0.5, step: 0.5 },
  { kind: 'number', key: 'strokeWidth', label: 'trait (mm)', min: 0.05, step: 0.05, modulatable: true },
  { kind: 'select', key: 'style', label: 'trait', options: ['square', 'rounded'] },
  { kind: 'slider', key: 'organicAmount', label: 'organique', min: 0, max: 1, step: 0.01, modulatable: true },
  { kind: 'slider', key: 'vertexPerturb', label: '↳ intensité du bruit', min: 0, max: 3, step: 0.05 },
  { kind: 'slider', key: 'wallCurve', label: '↳ courbure murs', min: 0, max: 2, step: 0.05 },
  { kind: 'number', key: 'noiseScale', label: '↳ échelle bruit (mm)', min: 0.1, step: 0.5 },
  { kind: 'slider', key: 'noiseOctaves', label: '↳ complexité bruit', min: 1, max: 8, step: 1 },
  { kind: 'number', key: 'noiseEvolution', label: '↳ évolution bruit', step: 0.1 },
  { kind: 'slider', key: 'vertexSmooth', label: '↳ lissage sommets (passes)', min: 0, max: 30, step: 1 },
  { kind: 'checkbox', key: 'deformBorders', label: '↳ déformer bordures' },
  { kind: 'number', key: 'seed', label: 'graine', step: 1 },
  { kind: 'number', key: 'zoneWidth', label: 'zone largeur (mm)', min: 1, step: 1 },
  { kind: 'number', key: 'zoneHeight', label: 'zone hauteur (mm)', min: 1, step: 1 },
];

const TEXT_FIELDS: FieldDef[] = [
  { kind: 'text',   key: 'content', label: 'contenu' },
  { kind: 'select', key: 'fontFamily', label: 'police', options: [] },
  { kind: 'number', key: 'sizeMm', label: 'taille (mm)', min: 1, step: 0.5 },
  { kind: 'slider', key: 'rotation', label: 'rotation (°)', min: 0, max: 360, step: 1 },
  { kind: 'select', key: 'align', label: 'alignement', options: ['start', 'middle', 'end'] },
  { kind: 'checkbox', key: 'textToPath', label: 'forcer trait noir' },
  { kind: 'number', key: 'strokeWidth', label: 'trait (mm)', min: 0.05, step: 0.05 },
];

const SHAPE_FIELDS: FieldDef[] = [
  { kind: 'select', key: 'shape', label: 'forme', options: ['rect', 'ellipse'] },
  { kind: 'number', key: 'width', label: 'largeur (mm)', min: 0.5, step: 0.5 },
  { kind: 'number', key: 'height', label: 'hauteur (mm)', min: 0.5, step: 0.5 },
  { kind: 'slider', key: 'rotation', label: 'rotation (°)', min: 0, max: 360, step: 1 },
  { kind: 'number', key: 'cornerRadius', label: 'rayon coin (mm)', min: 0, step: 0.5 },
  { kind: 'number', key: 'strokeWidth', label: 'trait (mm)', min: 0, step: 0.05 },
  { kind: 'checkbox', key: 'fill', label: 'remplir (utile pour masque)' },
];

const SVG_FIELDS: FieldDef[] = [
  // __svg_thumb__ is a synthetic key that renders the SVG preview thumbnail and
  // opens the file picker on click. Always first so it's visible at a glance.
  { kind: 'text', key: '__svg_thumb__', label: 'source' },
  { kind: 'number', key: 'scale', label: 'échelle', min: 0.01, step: 0.05 },
  { kind: 'slider', key: 'rotation', label: 'rotation (°)', min: 0, max: 360, step: 1 },
  { kind: 'number', key: 'strokeWidth', label: 'trait (mm)', min: 0.05, step: 0.05 },
  { kind: 'checkbox', key: 'forceStroke', label: 'forcer trait noir' },
  { kind: 'checkbox', key: 'tile', label: 'répéter (texture)' },
  { kind: 'number', key: 'tileSpacingX', label: 'espace X texture (mm)', min: 0, step: 0.5 },
  { kind: 'number', key: 'tileSpacingY', label: 'espace Y texture (mm)', min: 0, step: 0.5 },
];

const LAYER_FIELDS: FieldDef[] = [
  { kind: 'number', key: 'offsetX', label: 'décalage X (mm)', step: 1 },
  { kind: 'number', key: 'offsetY', label: 'décalage Y (mm)', step: 0.5 },
  { kind: 'number', key: 'grow', label: 'grossissement (mm)', min: 0, step: 0.1 },
];

const TRANSLATED_KEYS = new Set(['variant', 'align', 'style', 'shape', 'cellShape']);

function patternFieldsFor(layer: Layer): FieldDef[] {
  switch (layer.pattern.kind) {
    case 'geometric': return GEOM_FIELDS;
    case 'frieze':    return FRIEZE_FIELDS;
    case 'scatter':   return SCATTER_FIELDS;
    case 'text':      return TEXT_FIELDS;
    case 'maze':      return MAZE_FIELDS;
    case 'shape':     return SHAPE_FIELDS;
    case 'svg':       return SVG_FIELDS;
  }
}

type Scope = 'layer' | 'pattern';
type SliderHandles = { range: HTMLInputElement; number: HTMLInputElement };
type FieldEntry =
  | { kind: 'native'; def: FieldDef; scope: Scope; el: HTMLInputElement | HTMLSelectElement }
  | { kind: 'rich'; def: FieldDef; scope: Scope; handle: RichSelectHandle }
  | { kind: 'slider'; def: FieldDef; scope: Scope; sliders: SliderHandles }
  | { kind: 'dial'; def: FieldDef; scope: Scope; handle: RotationDialHandle }
  | { kind: 'modulated'; def: FieldDef; scope: Scope; refresh: () => void }
  | { kind: 'callback'; def: FieldDef; scope: Scope; refresh: () => void };

export function mountPropsPanel(container: HTMLElement, store: Store): void {
  container.classList.add('props-panel');

  let currentSignature = '';
  let entries: FieldEntry[] = [];
  let titleEl: HTMLElement | null = null;

  // Signature includes mod keys and gradient enabled — those change UI structure.
  const sigOf = (layer: Layer): string => {
    const modKeys = Object.keys(layer.mods).sort().join(',');
    return `${layer.id}:${layer.pattern.kind}:g${layer.gradient.enabled ? 1 : 0}:m${modKeys}`;
  };

  const buildStructure = (layer: Layer): void => {
    container.innerHTML = '';
    entries = [];

    titleEl = document.createElement('h4');
    titleEl.className = 'props-title';
    container.appendChild(titleEl);

    const layerSection = section('Calque', container);
    for (const f of LAYER_FIELDS) entries.push(makeField(f, 'layer', layer, layerSection, store));

    // Gradient editor — always present so user can enable any time.
    const gradSection = section('Gradient', container);
    entries.push(makeGradientField(layer, gradSection, store));

    const patternSection = section(tr(layer.pattern.kind), container);
    for (const f of patternFieldsFor(layer)) entries.push(makeField(f, 'pattern', layer, patternSection, store));
  };

  const refreshValues = (layer: Layer): void => {
    if (titleEl) titleEl.textContent = `${tr(layer.pattern.kind)} — ${layer.name}`;
    const layerObj = layer as unknown as Record<string, unknown>;
    const patternObj = layer.pattern.params as unknown as Record<string, unknown>;
    for (const entry of entries) {
      const src = entry.scope === 'layer' ? layerObj : patternObj;
      if (entry.kind === 'rich') {
        const v = src[entry.def.key];
        if (entry.handle.getValue() !== String(v)) entry.handle.setValue(String(v));
        continue;
      }
      if (entry.kind === 'callback' || entry.kind === 'modulated') {
        entry.refresh();
        continue;
      }
      if (entry.kind === 'dial') {
        const v = Number(src[entry.def.key]) || 0;
        if (entry.handle.getValue() !== v) entry.handle.setValue(v);
        continue;
      }
      if (entry.kind === 'slider') {
        if (document.activeElement === entry.sliders.range || document.activeElement === entry.sliders.number) continue;
        const v = String(src[entry.def.key]);
        if (entry.sliders.range.value !== v) entry.sliders.range.value = v;
        if (entry.sliders.number.value !== v) entry.sliders.number.value = v;
        continue;
      }
      if (document.activeElement === entry.el) continue;
      const v = src[entry.def.key];
      if (entry.def.kind === 'checkbox') {
        (entry.el as HTMLInputElement).checked = Boolean(v);
      } else if (entry.def.kind === 'select') {
        const sel = entry.el as HTMLSelectElement;
        if (sel.value !== String(v)) sel.value = String(v);
      } else {
        const inp = entry.el as HTMLInputElement;
        const next = String(v);
        if (inp.value !== next) inp.value = next;
      }
    }
  };

  const render = (): void => {
    const project = store.get();
    const layer = project.layers.find((l) => l.id === project.selectedLayerId);
    if (!layer) {
      currentSignature = '';
      entries = [];
      titleEl = null;
      container.innerHTML = '<div class="props-empty">Aucun calque sélectionné.</div>';
      return;
    }
    const sig = sigOf(layer);
    if (sig !== currentSignature) {
      currentSignature = sig;
      buildStructure(layer);
    }
    refreshValues(layer);
  };

  store.subscribe(render);
  subscribeFontRegistry(() => { currentSignature = ''; render(); });

  render();
}

function section(title: string, parent: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'props-section';
  const h = document.createElement('div');
  h.className = 'props-section-title';
  h.textContent = title;
  wrap.appendChild(h);
  parent.appendChild(wrap);
  return wrap;
}

function commitChange(store: Store, layerId: string, scope: Scope, key: string, value: unknown): void {
  store.update((p) => {
    p.layers = p.layers.map((l) => {
      if (l.id !== layerId) return l;
      if (scope === 'layer') return { ...l, [key]: value } as Layer;
      const nextParams = { ...(l.pattern.params as unknown as Record<string, unknown>), [key]: value };
      return { ...l, pattern: { ...l.pattern, params: nextParams } as typeof l.pattern };
    });
  });
}

// Resolve the default value for a layer field — used by the label dblclick reset.
const LAYER_DEFAULTS: Record<string, number> = {
  offsetX: 0, offsetY: 0, grow: 0,
};
function defaultValueFor(scope: Scope, layer: Layer, key: string, canvas: { width: number; height: number; unit: 'mm' }): number {
  if (scope === 'layer') return LAYER_DEFAULTS[key] ?? 0;
  const pat = defaultPatternForKind(layer.pattern.kind, canvas);
  const defaults = pat.params as unknown as Record<string, unknown>;
  const v = defaults[key];
  return typeof v === 'number' ? v : 0;
}

// Wire the dblclick-reset + drag-to-edit behaviour onto a numeric field label.
// Slider fields keep their min as a hard floor but NOT max — the visible slider
// range is just a scrub hint, the user can drag the label past it.
function attachNumericLabel(
  span: HTMLElement,
  f: FieldDef & { kind: 'number' | 'slider' },
  scope: Scope,
  layer: Layer,
  store: Store,
): void {
  const step = (f.kind === 'slider' ? f.step : (f.step ?? 1)) || 1;
  const dragMax = f.kind === 'slider' ? undefined : f.max;
  attachDragEdit(span, {
    getValue: () => {
      const cur = store.get().layers.find((l) => l.id === layer.id);
      if (!cur) return 0;
      const obj = scope === 'layer'
        ? (cur as unknown as Record<string, unknown>)
        : (cur.pattern.params as unknown as Record<string, unknown>);
      return Number(obj[f.key]) || 0;
    },
    setValue: (v) => commitChange(store, layer.id, scope, f.key, v),
    defaultValue: defaultValueFor(scope, layer, f.key, store.get().canvas),
    step,
    min: f.min,
    max: dragMax,
  });
}

function makeSliderControl(
  parent: HTMLElement,
  initial: number,
  opts: { min: number; max: number; step: number },
  onChange: (v: number) => void,
): SliderHandles {
  const wrap = document.createElement('div');
  wrap.className = 'props-slider';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(opts.min); range.max = String(opts.max); range.step = String(opts.step);
  range.value = String(initial);
  range.className = 'props-slider-range';
  // The number input intentionally does NOT enforce `max` — the slider's range
  // is a "soft hint" for scrubbing, but typed values (and drag-edit) can exceed
  // it. The minimum is preserved because it's usually a semantic floor (0, etc.).
  const num = document.createElement('input');
  num.type = 'number';
  num.min = String(opts.min); num.step = String(opts.step);
  num.value = String(initial);
  num.className = 'props-slider-number';
  range.oninput = () => { num.value = range.value; onChange(Number(range.value)); };
  num.oninput = () => {
    const v = Number(num.value);
    if (!Number.isFinite(v)) return;
    range.value = num.value;
    onChange(v);
  };
  wrap.appendChild(range);
  wrap.appendChild(num);
  parent.appendChild(wrap);
  return { range, number: num };
}

function makeField(f: FieldDef, scope: Scope, layer: Layer, parent: HTMLElement, store: Store): FieldEntry {
  if (scope === 'pattern' && f.key === 'fontFamily') return makeFontField(f, layer, parent, store);
  if (scope === 'pattern' && f.key === 'shape' && layer.pattern.kind === 'scatter') {
    return makeScatterShapeField(f, layer, parent, store);
  }
  if (scope === 'pattern' && f.key === '__svg_thumb__' && layer.pattern.kind === 'svg') {
    return makeSvgThumbField(f, layer, parent, store);
  }
  // Rotation fields get a dial control instead of a slider — way more direct.
  if (scope === 'pattern' && f.key === 'rotation') return makeRotationField(f, scope, layer, parent, store);
  if (f.kind === 'layer-ids') return makeLayerIdsField(f, scope, layer, parent, store);
  // Modulatable field — exposes a "g" toggle that swaps the scalar control for
  // a min/max pair driven by the layer gradient. Applies to slider AND number kinds.
  if (
    scope === 'pattern'
    && (f.kind === 'slider' || f.kind === 'number')
    && f.modulatable
  ) {
    return makeModulatedField(f, scope, layer, parent, store);
  }

  const lbl = document.createElement('label');
  lbl.className = 'props-field';
  const span = document.createElement('span');
  span.textContent = f.label;
  lbl.appendChild(span);

  const initial = (scope === 'layer'
    ? (layer as unknown as Record<string, unknown>)
    : (layer.pattern.params as unknown as Record<string, unknown>))[f.key];

  if (f.kind === 'slider') {
    const sliders = makeSliderControl(lbl, Number(initial) || 0, { min: f.min, max: f.max, step: f.step }, (v) => {
      commitChange(store, layer.id, scope, f.key, v);
    });
    attachNumericLabel(span, f, scope, layer, store);
    parent.appendChild(lbl);
    return { kind: 'slider', def: f, scope, sliders };
  }

  let input: HTMLInputElement | HTMLSelectElement;
  if (f.kind === 'select') {
    input = document.createElement('select');
    for (const o of f.options) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = TRANSLATED_KEYS.has(f.key) ? tr(o) : o;
      input.appendChild(opt);
    }
    input.value = String(initial);
  } else if (f.kind === 'checkbox') {
    input = document.createElement('input');
    input.type = 'checkbox';
    (input as HTMLInputElement).checked = Boolean(initial);
  } else {
    input = document.createElement('input');
    input.type = f.kind === 'number' ? 'number' : 'text';
    if (f.kind === 'number') {
      if (f.min !== undefined) input.min = String(f.min);
      if (f.max !== undefined) input.max = String(f.max);
      if (f.step !== undefined) input.step = String(f.step);
    }
    (input as HTMLInputElement).value = String(initial);
  }

  input.oninput = () => {
    const v = f.kind === 'number'
      ? Number((input as HTMLInputElement).value)
      : f.kind === 'checkbox'
        ? (input as HTMLInputElement).checked
        : (input as HTMLInputElement | HTMLSelectElement).value;
    commitChange(store, layer.id, scope, f.key, v);
  };

  // Wire drag-edit on numeric labels too (it's a noop for select/text/checkbox).
  if (f.kind === 'number') attachNumericLabel(span, f, scope, layer, store);

  lbl.appendChild(input);
  parent.appendChild(lbl);
  return { kind: 'native', def: f, scope, el: input };
}

function makeFontField(f: FieldDef, layer: Layer, parent: HTMLElement, store: Store): FieldEntry {
  const lbl = document.createElement('label');
  lbl.className = 'props-field';
  const span = document.createElement('span');
  span.textContent = f.label;
  lbl.appendChild(span);

  const slot = document.createElement('div');
  slot.className = 'props-control-with-action';
  lbl.appendChild(slot);

  const initial = String((layer.pattern.params as unknown as Record<string, unknown>)[f.key]);

  const fontOption = (fam: string): RichSelectOption => ({
    value: fam,
    render: () => {
      const el = document.createElement('span');
      el.className = 'font-option';
      el.style.fontFamily = `"${fam}"`;
      el.textContent = `Aa — ${fam}`;
      return el;
    },
  });

  const buildOptions = (): RichSelectOption[] => {
    const customs = getCustomFontFamilies();
    const seen = new Set<string>();
    const list: string[] = [];
    const add = (fam: string) => { if (!seen.has(fam)) { seen.add(fam); list.push(fam); } };
    add(initial);
    for (const c of customs) add(c);
    add('Noto Sans');
    for (const fam of BUILTIN_FONTS) if (isFontAvailable(fam)) add(fam);
    return list.map(fontOption);
  };

  const handle = mountRichSelect(slot, initial, buildOptions(), async (v) => {
    await loadFont(v);
    markFontAvailable(v);
    commitChange(store, layer.id, 'pattern', f.key, v);
  });

  ensureFontsChecked(BUILTIN_FONTS).then(() => handle.setOptions(buildOptions()));
  subscribeFontAvailability(() => handle.setOptions(buildOptions()));

  const upload = document.createElement('button');
  upload.type = 'button';
  upload.className = 'ghost icon';
  upload.textContent = '⤴';
  upload.title = 'Importer une police (.ttf / .otf)';
  upload.onclick = (e) => {
    e.preventDefault();
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.ttf,.otf,font/ttf,font/otf,application/font-sfnt';
    inp.onchange = async () => {
      const file = inp.files?.[0]; if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const family = await registerCustomFont(buf);
        commitChange(store, layer.id, 'pattern', f.key, family);
      } catch (err) {
        alert(`Échec de l'import : ${(err as Error).message}`);
      }
    };
    inp.click();
  };
  slot.appendChild(upload);

  parent.appendChild(lbl);
  return { kind: 'rich', def: f, scope: 'pattern', handle };
}

function makeScatterShapeField(f: FieldDef, layer: Layer, parent: HTMLElement, store: Store): FieldEntry {
  const lbl = document.createElement('label');
  lbl.className = 'props-field';
  const span = document.createElement('span');
  span.textContent = f.label;
  lbl.appendChild(span);

  const slot = document.createElement('div');
  slot.className = 'props-control-with-action';
  lbl.appendChild(slot);

  const initial = String((layer.pattern.params as unknown as Record<string, unknown>)[f.key]) as ScatterShape;

  // Build options live from the store so the custom-shape preview reflects the
  // current customSvg, even after uploads from other points in the app.
  const buildOptions = (): RichSelectOption<string>[] => {
    const current = store.get().layers.find((l) => l.id === layer.id);
    const svg = current && current.pattern.kind === 'scatter'
      ? current.pattern.params.customSvg
      : '';
    return BUILTIN_SHAPES.map((value) => ({
      value,
      render: () => renderShapeOption(value, svg),
    }));
  };

  const handle = mountRichSelect<string>(slot, initial, buildOptions(), (v) => {
    commitChange(store, layer.id, 'pattern', f.key, v);
  });

  const upload = document.createElement('button');
  upload.type = 'button';
  upload.className = 'ghost icon';
  upload.textContent = '⤴';
  upload.title = 'Importer une forme (.svg) — stockée sur le calque, persiste après rechargement';
  upload.onclick = (e) => {
    e.preventDefault();
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.svg,image/svg+xml';
    inp.onchange = async () => {
      const file = inp.files?.[0]; if (!file) return;
      try {
        const text = await file.text();
        // Persist the SVG markup inline on the layer + flip to the custom shape.
        store.update((p) => {
          p.layers = p.layers.map((l) => {
            if (l.id !== layer.id || l.pattern.kind !== 'scatter') return l;
            return {
              ...l,
              pattern: {
                ...l.pattern,
                params: { ...l.pattern.params, shape: 'custom', customSvg: text },
              },
            };
          });
        });
      } catch (err) {
        alert(`Échec de l'import : ${(err as Error).message}`);
      }
    };
    inp.click();
  };
  slot.appendChild(upload);

  parent.appendChild(lbl);

  // Refresh both the selected value AND the option preview list — the latter is
  // what makes the custom-shape thumbnail update when customSvg changes.
  const refresh = () => {
    const current = store.get().layers.find((l) => l.id === layer.id);
    if (!current) return;
    const v = (current.pattern.params as unknown as Record<string, unknown>)[f.key] as string;
    handle.setOptions(buildOptions());
    if (handle.getValue() !== v) handle.setValue(v);
  };
  return { kind: 'callback', def: f, scope: 'pattern', refresh };
}

function makeRotationField(f: FieldDef, scope: Scope, layer: Layer, parent: HTMLElement, store: Store): FieldEntry {
  const lbl = document.createElement('label');
  lbl.className = 'props-field';
  const span = document.createElement('span');
  span.textContent = f.label;
  lbl.appendChild(span);
  const initial = Number((layer.pattern.params as unknown as Record<string, unknown>)[f.key]) || 0;
  const handle = mountRotationDial(lbl, initial, (v) => {
    commitChange(store, layer.id, scope, f.key, v);
  });
  // Rotation labels also support drag-edit (step = 1 degree).
  attachDragEdit(span, {
    getValue: () => {
      const cur = store.get().layers.find((l) => l.id === layer.id);
      if (!cur) return 0;
      const obj = scope === 'layer'
        ? (cur as unknown as Record<string, unknown>)
        : (cur.pattern.params as unknown as Record<string, unknown>);
      return Number(obj[f.key]) || 0;
    },
    setValue: (v) => commitChange(store, layer.id, scope, f.key, v),
    defaultValue: defaultValueFor(scope, layer, f.key, store.get().canvas),
    step: 1,
  });
  parent.appendChild(lbl);
  return { kind: 'dial', def: f, scope, handle };
}

function makeSvgThumbField(f: FieldDef, layer: Layer, parent: HTMLElement, store: Store): FieldEntry {
  const lbl = document.createElement('label');
  lbl.className = 'props-field';
  const span = document.createElement('span');
  span.textContent = f.label;
  lbl.appendChild(span);

  // Render the layer's current SVG inside a fixed-size thumbnail. Click → open
  // the file picker so the user can swap in a new SVG without removing the layer.
  const thumb = document.createElement('button');
  thumb.type = 'button';
  thumb.className = 'svg-thumb';
  thumb.title = 'Cliquer pour remplacer la source SVG';

  const setThumb = (svgText: string) => {
    thumb.innerHTML = '';
    try {
      const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const root = parsed.documentElement;
      if (root instanceof SVGSVGElement) {
        const clone = root.cloneNode(true) as SVGSVGElement;
        // Force width/height to fill the thumb regardless of source attrs.
        clone.setAttribute('width', '100%');
        clone.setAttribute('height', '100%');
        clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        thumb.appendChild(clone);
      }
    } catch { /* empty thumb on parse failure */ }
  };
  setThumb((layer.pattern.params as { svgText: string }).svgText);

  thumb.onclick = (e) => {
    e.preventDefault();
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.svg,image/svg+xml';
    inp.onchange = async () => {
      const file = inp.files?.[0]; if (!file) return;
      try {
        const text = await file.text();
        // Refit the new SVG to a sensible default size while keeping rotation etc.
        const newScale = scaleForTargetSize(text, 60);
        store.update((p) => {
          p.layers = p.layers.map((l) => {
            if (l.id !== layer.id || l.pattern.kind !== 'svg') return l;
            return {
              ...l,
              pattern: {
                ...l.pattern,
                params: { ...l.pattern.params, svgText: text, scale: newScale },
              },
            };
          });
        });
      } catch (err) {
        alert(`Échec de l'import : ${(err as Error).message}`);
      }
    };
    inp.click();
  };

  lbl.appendChild(thumb);
  parent.appendChild(lbl);

  const refresh = () => {
    const current = store.get().layers.find((l) => l.id === layer.id);
    if (!current || current.pattern.kind !== 'svg') return;
    setThumb(current.pattern.params.svgText);
  };
  return { kind: 'callback', def: f, scope: 'pattern', refresh };
}

function makeLayerIdsField(f: FieldDef, scope: Scope, layer: Layer, parent: HTMLElement, store: Store): FieldEntry {
  const wrap = document.createElement('div');
  wrap.className = 'props-section-block';
  const lbl = document.createElement('div');
  lbl.className = 'props-section-subtitle';
  lbl.textContent = f.label;
  wrap.appendChild(lbl);

  const list = document.createElement('div');
  list.className = 'layer-ids-list';
  wrap.appendChild(list);

  const refresh = (): void => {
    const project = store.get();
    const currentLayer = project.layers.find((l) => l.id === layer.id);
    if (!currentLayer) return;
    const selected = new Set(
      ((currentLayer.pattern.params as unknown as Record<string, string[]>)[f.key] ?? []),
    );
    list.innerHTML = '';
    const candidates = project.layers.filter((l) => l.id !== layer.id);
    if (candidates.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'layer-ids-empty';
      empty.textContent = 'Aucun autre calque';
      list.appendChild(empty);
      return;
    }
    for (const cand of candidates) {
      const row = document.createElement('label');
      row.className = 'layer-ids-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(cand.id);
      cb.onchange = () => {
        if (cb.checked) selected.add(cand.id); else selected.delete(cand.id);
        commitChange(store, layer.id, scope, f.key, Array.from(selected));
      };
      const name = document.createElement('span');
      name.textContent = `${tr(cand.pattern.kind)} — ${cand.name}`;
      row.appendChild(cb);
      row.appendChild(name);
      list.appendChild(row);
    }
  };

  parent.appendChild(wrap);
  refresh();
  return { kind: 'callback', def: f, scope, refresh };
}

function makeGradientField(layer: Layer, parent: HTMLElement, store: Store): FieldEntry {
  // Enable toggle
  const toggleRow = document.createElement('label');
  toggleRow.className = 'props-field';
  const toggleLabel = document.createElement('span');
  toggleLabel.textContent = 'activé';
  toggleRow.appendChild(toggleLabel);
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = layer.gradient.enabled;
  cb.onchange = () => {
    store.update((p) => {
      p.layers = p.layers.map((l) => l.id === layer.id
        ? { ...l, gradient: { ...l.gradient, enabled: cb.checked } }
        : l);
    });
  };
  toggleRow.appendChild(cb);
  parent.appendChild(toggleRow);

  // Sliders for angle / t0 / t1 — only shown when enabled.
  const detail = document.createElement('div');
  detail.className = 'gradient-detail';
  if (!layer.gradient.enabled) detail.style.display = 'none';
  parent.appendChild(detail);

  const setGradient = (patch: Partial<Layer['gradient']>) => {
    store.update((p) => {
      p.layers = p.layers.map((l) => l.id === layer.id
        ? { ...l, gradient: { ...l.gradient, ...patch } }
        : l);
    });
  };

  const angleLbl = document.createElement('label');
  angleLbl.className = 'props-field';
  const angleSpan = document.createElement('span');
  angleSpan.textContent = 'angle (°)';
  angleLbl.appendChild(angleSpan);
  const angleH = makeSliderControl(angleLbl, layer.gradient.angle, { min: 0, max: 360, step: 1 },
    (v) => setGradient({ angle: v }));
  detail.appendChild(angleLbl);

  const t0Lbl = document.createElement('label');
  t0Lbl.className = 'props-field';
  const t0Span = document.createElement('span');
  t0Span.textContent = 'début (0..1)';
  t0Lbl.appendChild(t0Span);
  const t0H = makeSliderControl(t0Lbl, layer.gradient.t0, { min: 0, max: 1, step: 0.01 },
    (v) => setGradient({ t0: v }));
  detail.appendChild(t0Lbl);

  const t1Lbl = document.createElement('label');
  t1Lbl.className = 'props-field';
  const t1Span = document.createElement('span');
  t1Span.textContent = 'fin (0..1)';
  t1Lbl.appendChild(t1Span);
  const t1H = makeSliderControl(t1Lbl, layer.gradient.t1, { min: 0, max: 1, step: 0.01 },
    (v) => setGradient({ t1: v }));
  detail.appendChild(t1Lbl);

  const refresh = () => {
    const current = store.get().layers.find((l) => l.id === layer.id);
    if (!current) return;
    cb.checked = current.gradient.enabled;
    detail.style.display = current.gradient.enabled ? '' : 'none';
    const sync = (h: SliderHandles, v: number) => {
      if (document.activeElement === h.range || document.activeElement === h.number) return;
      const s = String(v);
      if (h.range.value !== s) h.range.value = s;
      if (h.number.value !== s) h.number.value = s;
    };
    sync(angleH, current.gradient.angle);
    sync(t0H, current.gradient.t0);
    sync(t1H, current.gradient.t1);
  };

  return { kind: 'callback', def: { kind: 'number', key: '__gradient__', label: 'gradient' }, scope: 'layer', refresh };
}

// Refresh helper used by both slider and number controls in the modulation UI.
type ControlSync = (v: number) => void;

function makeNumberControl(
  parent: HTMLElement,
  initial: number,
  opts: { min?: number; max?: number; step?: number },
  onChange: (v: number) => void,
): { input: HTMLInputElement; sync: ControlSync } {
  const inp = document.createElement('input');
  inp.type = 'number';
  if (opts.min !== undefined) inp.min = String(opts.min);
  if (opts.max !== undefined) inp.max = String(opts.max);
  if (opts.step !== undefined) inp.step = String(opts.step);
  inp.value = String(initial);
  inp.className = 'props-mod-number';
  inp.oninput = () => {
    const v = Number(inp.value);
    if (Number.isFinite(v)) onChange(v);
  };
  parent.appendChild(inp);
  return {
    input: inp,
    sync: (v) => {
      if (document.activeElement === inp) return;
      const s = String(v);
      if (inp.value !== s) inp.value = s;
    },
  };
}

function makeModulatedField(
  f: FieldDef & { kind: 'slider' | 'number' },
  scope: Scope,
  layer: Layer,
  parent: HTMLElement,
  store: Store,
): FieldEntry {
  const lbl = document.createElement('label');
  lbl.className = 'props-field';
  const span = document.createElement('span');
  span.textContent = f.label;
  lbl.appendChild(span);

  const slot = document.createElement('div');
  slot.className = 'props-control-with-action props-modulated';
  lbl.appendChild(slot);
  parent.appendChild(lbl);

  // The main label also gets drag-edit, scrubbing the scalar value.
  attachNumericLabel(span, f, scope, layer, store);

  const isModulated = !!layer.mods[f.key];
  const scalar = Number((layer.pattern.params as unknown as Record<string, number>)[f.key]) || 0;

  // Build the appropriate control(s) for this field's kind in either scalar
  // or min/max mode. `syncs` is what refresh() calls when the store changes.
  const syncs: { scalar?: ControlSync; min?: ControlSync; max?: ControlSync } = {};

  const buildScalar = () => {
    if (f.kind === 'slider') {
      const h = makeSliderControl(slot, scalar, { min: f.min, max: f.max, step: f.step }, (v) => {
        commitChange(store, layer.id, scope, f.key, v);
      });
      syncs.scalar = (v) => {
        if (document.activeElement === h.range || document.activeElement === h.number) return;
        const s = String(v);
        if (h.range.value !== s) h.range.value = s;
        if (h.number.value !== s) h.number.value = s;
      };
    } else {
      const h = makeNumberControl(slot, scalar, { min: f.min, max: f.max, step: f.step }, (v) => {
        commitChange(store, layer.id, scope, f.key, v);
      });
      syncs.scalar = h.sync;
    }
  };

  // Modulated mode renders a single compact row: [min label] [num] [max label] [num] [g]
  // — same vertical footprint as a scalar field. The sliders are dropped here
  // since min/max wouldn't fit alongside the visible scrub track.
  const buildMod = () => {
    const m = layer.mods[f.key];
    const dflt = defaultValueFor(scope, layer, f.key, store.get().canvas);
    const step = f.kind === 'slider' ? f.step : (f.step ?? 1);
    const writeMin = (v: number) => store.update((p) => {
      p.layers = p.layers.map((l) => l.id === layer.id
        ? { ...l, mods: { ...l.mods, [f.key]: { min: v, max: l.mods[f.key]?.max ?? v } } }
        : l);
    });
    const writeMax = (v: number) => store.update((p) => {
      p.layers = p.layers.map((l) => l.id === layer.id
        ? { ...l, mods: { ...l.mods, [f.key]: { min: l.mods[f.key]?.min ?? v, max: v } } }
        : l);
    });
    const addPair = (text: string, getValue: () => number, setValue: (v: number) => void, initialV: number) => {
      const lbl = document.createElement('span');
      lbl.className = 'mod-sub-label';
      lbl.textContent = text;
      attachDragEdit(lbl, {
        getValue, setValue, defaultValue: dflt,
        step,
        min: f.min,
        // No max so user can scrub past the slider's visible range.
      });
      slot.appendChild(lbl);
      const h = makeNumberControl(slot, initialV, { min: f.min, step }, setValue);
      return h.sync;
    };
    syncs.min = addPair('min',
      () => store.get().layers.find((l) => l.id === layer.id)?.mods[f.key]?.min ?? 0,
      writeMin,
      m.min,
    );
    syncs.max = addPair('max',
      () => store.get().layers.find((l) => l.id === layer.id)?.mods[f.key]?.max ?? 0,
      writeMax,
      m.max,
    );
  };

  if (isModulated) buildMod(); else buildScalar();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ghost icon mod-toggle' + (isModulated ? ' active' : '');
  btn.textContent = 'g';
  btn.title = isModulated
    ? 'Désactiver la modulation par gradient'
    : 'Activer la modulation par gradient (min/max)';
  btn.onclick = (e) => {
    e.preventDefault();
    store.update((p) => {
      p.layers = p.layers.map((l) => {
        if (l.id !== layer.id) return l;
        const nextMods = { ...l.mods };
        if (nextMods[f.key]) {
          delete nextMods[f.key];
        } else {
          // Default sweep: from 0 to the current scalar value. If the scalar is
          // already 0 we widen to the field's natural ceiling so the user sees
          // an immediate effect.
          const sc = Number((l.pattern.params as unknown as Record<string, number>)[f.key]) || 0;
          const ceiling = f.kind === 'slider' ? f.max : (f.max ?? Math.max(sc * 2, 1));
          const minDefault = 0;
          const maxDefault = sc > minDefault ? sc : ceiling;
          nextMods[f.key] = { min: minDefault, max: maxDefault };
        }
        return { ...l, mods: nextMods };
      });
    });
  };
  slot.appendChild(btn);

  const refresh = () => {
    const current = store.get().layers.find((l) => l.id === layer.id);
    if (!current) return;
    if (syncs.scalar) {
      const v = Number((current.pattern.params as unknown as Record<string, number>)[f.key]) || 0;
      syncs.scalar(v);
    }
    if (syncs.min && syncs.max && current.mods[f.key]) {
      syncs.min(current.mods[f.key].min);
      syncs.max(current.mods[f.key].max);
    }
  };

  return { kind: 'modulated', def: f, scope, refresh };
}

function renderShapeOption(value: ScatterShape, customSvg = ''): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'shape-option';
  const dim = 26;
  const svg = makeSvg(dim, dim);
  svg.setAttribute('width', `${dim}px`);
  svg.setAttribute('height', `${dim}px`);
  if (value === 'custom') {
    // Show the user's uploaded SVG if any, otherwise a hint.
    if (customSvg) {
      try {
        const parsed = new DOMParser().parseFromString(customSvg, 'image/svg+xml');
        const root = parsed.documentElement;
        if (root instanceof SVGSVGElement) {
          const clone = root.cloneNode(true) as SVGSVGElement;
          clone.setAttribute('width', `${dim}px`);
          clone.setAttribute('height', `${dim}px`);
          clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          wrap.appendChild(clone);
        }
      } catch { /* fall through to label only */ }
    } else {
      // Empty box hint
      svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
      const r = svg.lastElementChild!;
      r.setAttribute('x', '4'); r.setAttribute('y', '4');
      r.setAttribute('width', String(dim - 8)); r.setAttribute('height', String(dim - 8));
      r.setAttribute('fill', 'none'); r.setAttribute('stroke', '#888');
      r.setAttribute('stroke-dasharray', '2 2'); r.setAttribute('stroke-width', '0.5');
      wrap.appendChild(svg);
    }
  } else {
    svg.appendChild(shapePath(value, dim / 2, dim / 2, dim - 6, 0, 0.6));
    wrap.appendChild(svg);
  }
  const lbl = document.createElement('span');
  lbl.className = 'shape-option-label';
  lbl.textContent = tr(value);
  wrap.appendChild(lbl);
  return wrap;
}

export type { GeometricParams, FriezeParams, ScatterParams, TextParams };
