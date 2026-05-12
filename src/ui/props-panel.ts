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
