import { Store, PaletteEntry } from '../state/project';

// Minimal modal: edit the existing palette entries in place. No add/remove —
// the default palette ships with 5 entries; that's enough for any laser run.
export function openPaletteEditor(store: Store): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const modal = document.createElement('div');
  modal.className = 'modal';
  backdrop.appendChild(modal);

  const title = document.createElement('h2');
  title.textContent = 'Palette';
  modal.appendChild(title);

  const list = document.createElement('div');
  list.className = 'palette-list';
  modal.appendChild(list);

  for (const entry of store.get().palette) list.appendChild(buildRow(entry, store));

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const close = () => { document.body.removeChild(backdrop); };
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'primary';
  closeBtn.textContent = 'Fermer';
  closeBtn.addEventListener('click', close);
  actions.appendChild(closeBtn);
  modal.appendChild(actions);

  document.body.appendChild(backdrop);
}

function buildRow(entry: PaletteEntry, store: Store): HTMLElement {
  const row = document.createElement('div');
  row.className = 'palette-row';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = entry.name;
  nameInput.addEventListener('change', () => updateEntry(store, entry.id, { name: nameInput.value }));

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = entry.color;
  colorInput.addEventListener('change', () => updateEntry(store, entry.id, { color: colorInput.value }));

  const valueInput = document.createElement('input');
  valueInput.type = 'range';
  valueInput.min = '0'; valueInput.max = '1'; valueInput.step = '0.01';
  valueInput.value = String(entry.value);
  const valueLabel = document.createElement('span');
  valueLabel.className = 'palette-value-label';
  valueLabel.textContent = entry.value.toFixed(2);
  valueInput.addEventListener('input', () => {
    valueLabel.textContent = parseFloat(valueInput.value).toFixed(2);
    updateEntry(store, entry.id, { value: parseFloat(valueInput.value) });
  });

  // Two-option toggle button — cheaper screen real-estate than a <select>.
  let currentMode: 'fill' | 'line' = entry.mode;
  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.className = 'palette-mode-toggle';
  const refreshModeLabel = () => {
    modeBtn.textContent = currentMode === 'fill' ? 'remplissage' : 'ligne';
    modeBtn.title = currentMode === 'fill'
      ? 'Remplissage (LightBurn Fill) — cliquer pour passer en ligne'
      : 'Ligne (LightBurn Line) — cliquer pour passer en remplissage';
  };
  refreshModeLabel();
  modeBtn.addEventListener('click', () => {
    currentMode = currentMode === 'fill' ? 'line' : 'fill';
    refreshModeLabel();
    updateEntry(store, entry.id, { mode: currentMode });
  });

  row.appendChild(nameInput);
  row.appendChild(colorInput);
  row.appendChild(valueInput);
  row.appendChild(valueLabel);
  row.appendChild(modeBtn);
  return row;
}

function updateEntry(store: Store, id: string, patch: Partial<PaletteEntry>): void {
  store.update((p) => ({
    ...p,
    palette: p.palette.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  }));
}
