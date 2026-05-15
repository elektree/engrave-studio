import { Store } from '../state/project';
import { exportProjectJson, importProjectJson } from '../state/persistence';
import { exportLaserSvg } from '../render/export';
import { openPaletteEditor } from './palette-editor';
import { MATERIAL_IDS, MATERIAL_LABELS, MaterialId } from '../render/materials';

export function mountHeader(container: HTMLElement, store: Store): void {
  // Build once — header is small and its structure doesn't depend on store updates.
  container.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'header-title';
  title.textContent = 'Engrave';
  container.appendChild(title);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'header-name';
  nameInput.value = store.get().name;
  nameInput.placeholder = 'Nom du projet';
  nameInput.oninput = () => store.update((p) => { p.name = nameInput.value; });
  container.appendChild(nameInput);

  container.appendChild(separator());

  const wInput = numberInput(store.get().canvas.width, 1, (v) =>
    store.update((p) => { p.canvas = { ...p.canvas, width: v }; }));
  const hInput = numberInput(store.get().canvas.height, 0.5, (v) =>
    store.update((p) => { p.canvas = { ...p.canvas, height: v }; }));
  container.appendChild(field('W', wInput));
  container.appendChild(field('H', hInput));

  const kerfInput = document.createElement('input');
  kerfInput.type = 'number';
  kerfInput.value = String(store.get().kerf);
  kerfInput.step = '0.01';
  kerfInput.min = '0.01';
  kerfInput.style.width = '70px';
  kerfInput.title = 'Largeur de trait du laser (mm)';
  kerfInput.oninput = () => {
    const v = Number(kerfInput.value);
    if (!Number.isFinite(v) || v <= 0) return;
    store.update((p) => ({ ...p, kerf: v }));
  };
  container.appendChild(field('kerf', kerfInput));

  container.appendChild(separator());

  // Aperçu select — Édition is the default "" entry, each material below it
  // switches the canvas into the chrome-free preview using that material's
  // backdrop + burn-colour ramp.
  const previewSelect = document.createElement('select');
  previewSelect.className = 'preview-select';
  previewSelect.title = 'Mode d\'affichage';
  const editOpt = document.createElement('option');
  editOpt.value = '';
  editOpt.textContent = 'Édition';
  previewSelect.appendChild(editOpt);
  for (const id of MATERIAL_IDS) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `Aperçu — ${MATERIAL_LABELS[id]}`;
    previewSelect.appendChild(opt);
  }
  const refreshToggle = () => {
    const mat = store.get().previewMaterial ?? '';
    if (previewSelect.value !== mat) previewSelect.value = mat;
  };
  previewSelect.onchange = () => {
    const v = previewSelect.value;
    store.update((p) => ({ ...p, previewMaterial: (v || undefined) as MaterialId | undefined }));
  };
  container.appendChild(previewSelect);

  const spacer = document.createElement('div');
  spacer.className = 'header-spacer';
  container.appendChild(spacer);

  const paletteBtn = document.createElement('button');
  paletteBtn.type = 'button';
  paletteBtn.className = 'ghost';
  paletteBtn.textContent = 'Palette…';
  paletteBtn.title = 'Modifier la palette de profondeurs';
  paletteBtn.onclick = () => openPaletteEditor(store);
  container.appendChild(paletteBtn);

  container.appendChild(separator());

  const jsonOut = document.createElement('button');
  jsonOut.className = 'ghost icon';
  jsonOut.textContent = '💾';
  jsonOut.title = 'Enregistrer le projet (JSON)';
  jsonOut.onclick = () => exportProjectJson(store.get());
  container.appendChild(jsonOut);

  const jsonIn = document.createElement('button');
  jsonIn.className = 'ghost icon';
  jsonIn.textContent = '📂';
  jsonIn.title = 'Ouvrir un projet (JSON)';
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

  const exportBtn = document.createElement('button');
  exportBtn.className = 'primary';
  exportBtn.textContent = 'Exporter SVG';
  exportBtn.onclick = async () => {
    try {
      const svg = await exportLaserSvg(store.get());
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

  // Keep the small inputs in sync if the project is reloaded via JSON import.
  store.subscribe(() => {
    const p = store.get();
    if (document.activeElement !== nameInput && nameInput.value !== p.name) nameInput.value = p.name;
    if (document.activeElement !== wInput && Number(wInput.value) !== p.canvas.width) wInput.value = String(p.canvas.width);
    if (document.activeElement !== hInput && Number(hInput.value) !== p.canvas.height) hInput.value = String(p.canvas.height);
    if (document.activeElement !== kerfInput && Number(kerfInput.value) !== p.kerf) kerfInput.value = String(p.kerf);
    refreshToggle();
  });
  refreshToggle();
}

function numberInput(value: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'number';
  i.value = String(value);
  i.step = String(step);
  i.min = '1';
  i.style.width = '70px';
  i.oninput = () => {
    const v = Number(i.value);
    if (!Number.isFinite(v) || v < 1) return;
    onChange(v);
  };
  return i;
}

function field(text: string, input: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'header-group';
  const s = document.createElement('span');
  s.textContent = text;
  wrap.appendChild(s);
  wrap.appendChild(input);
  return wrap;
}

function separator(): HTMLElement {
  const s = document.createElement('div');
  s.className = 'header-separator';
  return s;
}
