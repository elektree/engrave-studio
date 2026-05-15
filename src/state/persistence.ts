import { Project, Store, defaultProject } from './project';

const KEY = 'engrave-pattern-generator:project';
const DEBOUNCE_MS = 300;

// Validates only the structural shape needed to avoid runtime crashes downstream.
// Anything malformed (including the previous unversioned/version-1 schema) is dropped.
function isValidV2(obj: unknown): obj is Project {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  if (o.version !== 2) return false;
  if (!Array.isArray(o.layers)) return false;
  if (!o.canvas || typeof o.canvas !== 'object') return false;
  if (typeof o.kerf !== 'number') return false;
  if (!Array.isArray(o.palette) || o.palette.length === 0) return false;
  return true;
}

let lastLoadWasLegacy = false;
export function consumeLegacyFlag(): boolean {
  const v = lastLoadWasLegacy;
  lastLoadWasLegacy = false;
  return v;
}

// In-place patches for fields that have changed shape mid-version-2 (the
// laser-aware refactor went through a few iterations on SvgLayerParams).
function patchInPlace(p: Project): Project {
  // Drop UI fields that older saves had but the type no longer exposes.
  const root = p as unknown as Record<string, unknown>;
  if (root.previewMode !== undefined) delete root.previewMode;
  if (root.showWarnings !== undefined) delete root.showWarnings;
  // Palette entries gained a `mode` field — engraving entries default to fill,
  // the cut entry (value === 1) defaults to line.
  if (Array.isArray(p.palette)) {
    for (const e of p.palette) {
      const ee = e as unknown as { mode?: 'fill' | 'line'; value?: number };
      if (ee.mode === undefined) ee.mode = ee.value === 1 ? 'line' : 'fill';
    }
  }
  for (const layer of p.layers) {
    if (layer.pattern.kind === 'scatter') {
      const sp = layer.pattern.params as unknown as Record<string, unknown>;
      if (sp.customForceStroke !== undefined && sp.outlined === undefined) {
        sp.outlined = Boolean(sp.customForceStroke);
        delete sp.customForceStroke;
      }
      // The Poisson refactor added two new params. Keep old projects working
      // by filling sensible defaults (minDistance derived from maxSize like
      // the implicit value the old uniform sampler used).
      if (sp.minDistance === undefined) {
        const maxS = typeof sp.maxSize === 'number' ? sp.maxSize : 4;
        sp.minDistance = Math.max(0.5, maxS * 1.1);
      }
      if (sp.densityFactor === undefined) sp.densityFactor = 1;
      continue;
    }
    if (layer.pattern.kind === 'shape') {
      const sp = layer.pattern.params as unknown as Record<string, unknown>;
      // `fill: boolean` was inverted into `outlined: boolean` — keep visual
      // behaviour by flipping the value when migrating.
      if (sp.fill !== undefined && sp.outlined === undefined) {
        sp.outlined = !sp.fill;
        delete sp.fill;
      }
      if (sp.branches === undefined) sp.branches = 5;
      if (sp.sides === undefined) sp.sides = 6;
      continue;
    }
    if (layer.pattern.kind !== 'svg') continue;
    const sp = layer.pattern.params as unknown as Record<string, unknown>;
    // The `outlined` flag is the contour toggle (false = filled, true =
    // stroked). Old projects had no field, default to false.
    if (sp.outlined === undefined) sp.outlined = false;
    // useSourceColors was the old "luminance vs uniform" toggle — the new
    // model always uses source colours, so strip the field and rely on the
    // unconditional luminance mapping.
    if (sp.useSourceColors !== undefined) delete sp.useSourceColors;
    if (sp.depthForBlack === undefined) {
      const invert = sp.invert === true;
      const lMin = typeof sp.lumMin === 'number' ? sp.lumMin : 0;
      const lMax = typeof sp.lumMax === 'number' ? sp.lumMax : 1;
      // Legacy lumMin/lumMax + invert mapped luminance into [0,1] depth space;
      // closest fit in the new semantics is depthForBlack/depthForWhite = the
      // bounds of that range, possibly swapped.
      sp.depthForBlack = invert ? lMax : lMin;
      sp.depthForWhite = invert ? lMin : lMax;
    }
    delete sp.forceStroke;
    delete sp.depthMode;
    delete sp.lumMin;
    delete sp.lumMax;
    delete sp.invert;
  }
  return p;
}

export function loadProject(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProject();
    const obj = JSON.parse(raw);
    if (isValidV2(obj)) return patchInPlace(obj);
    lastLoadWasLegacy = true;
  } catch { /* corrupted JSON → fall through */ }
  return defaultProject();
}

export function attachAutosave(store: Store): void {
  let t: number | undefined;
  store.subscribe((p) => {
    if (t !== undefined) window.clearTimeout(t);
    t = window.setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* quota errors ignored */ }
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
    if (!isValidV2(obj)) throw new Error('Unsupported project version');
    store.set(patchInPlace(obj as Project));
  });
}
