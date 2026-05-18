import { Store, makeLayer, BlendMode, Layer } from '../state/project';
import { defaultPatternForKind, PATTERN_KINDS } from '../patterns';
import { tr } from '../i18n';
import { uid } from '../utils/id';

const BLEND_CYCLE: BlendMode[] = ['normal', 'intersect', 'exclude'];
const BLEND_ICON: Record<BlendMode, string> = {
  normal: '○',
  intersect: '◐',
  exclude: '⊘',
};
const BLEND_TITLE: Record<BlendMode, string> = {
  normal: 'Calque normal — cliquer pour activer le masque',
  intersect: 'Masque : intersection (clip sur le calque dessous)',
  exclude: 'Masque : exclusion (clip inversé sur le calque dessous)',
};

function nextBlend(mode: BlendMode): BlendMode {
  const i = BLEND_CYCLE.indexOf(mode);
  return BLEND_CYCLE[(i + 1) % BLEND_CYCLE.length];
}

export function mountLayersPanel(container: HTMLElement, store: Store): void {
  container.classList.add('layers-panel');

  // Empty-area click anywhere in the panel (title bar, gap between rows,
  // below the last row) deselects. Rows and the add-layer affordances stop
  // propagation / are filtered out, so only true "no-target" clicks reach us.
  container.addEventListener('click', (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (t.closest('.layer-row')) return;
    if (t.closest('.layers-add')) return;
    if (t.closest('.add-layer-popup')) return;
    if (store.get().selectedLayerId) {
      store.update((p) => { p.selectedLayerId = null; });
    }
  });

  // Tracks the id of the layer currently being dragged — dataTransfer is
  // unreadable during `dragover`, so we keep our own reference.
  let draggingId: string | null = null;

  const render = () => {
    const project = store.get();
    container.innerHTML = '';

    const title = document.createElement('h4');
    title.className = 'layers-panel-title';
    title.textContent = 'Calques';
    container.appendChild(title);

    const addRow = document.createElement('div');
    addRow.className = 'layers-add';

    const addBtn = document.createElement('button');
    addBtn.className = 'add-menu-trigger';
    addBtn.textContent = '+ Ajouter un calque';
    addBtn.onclick = (e) => {
      e.stopPropagation();
      openAddMenu(addBtn);
    };
    addRow.appendChild(addBtn);
    container.appendChild(addRow);

    const addLayerOfKind = (kind: typeof PATTERN_KINDS[number]) => {
      store.update((p) => {
        const l = makeLayer(defaultPatternForKind(kind, p.canvas, p.kerf), `${tr(kind)} ${p.layers.length + 1}`);
        if (kind === 'shape') {
          l.offsetX = p.canvas.width / 2;
          l.offsetY = p.canvas.height / 2;
        }
        if (kind === 'text') {
          // Text now lives at layer-local (0, 0); offsetY/X positions it.
          l.offsetX = p.canvas.width / 2;
          l.offsetY = p.canvas.height / 2;
        }
        if (kind === 'bezier') {
          // Empty anchor list — canvas-panel detects this and enters pen-tool
          // draw mode. offsetX/Y is the local origin where future clicks land.
          l.offsetX = p.canvas.width / 2;
          l.offsetY = p.canvas.height / 2;
        }
        // New frieze layers are vertically centred — the strip lives around the
        // layer's local y=0, and offsetY positions it.
        if (kind === 'frieze') {
          l.offsetY = p.canvas.height / 2;
        }
        const params = l.pattern.params as Record<string, unknown>;
        if ('seed' in params && typeof params.seed === 'number') {
          params.seed = Math.floor(Math.random() * 1_000_000);
        }
        p.layers = [...p.layers, l];
        p.selectedLayerId = l.id;
      });
    };

    // Popup menu — sibling of the button so we can position it relative to the
    // viewport. Click an item to add the layer of that kind. Clicking outside
    // dismisses without changing anything.
    const openAddMenu = (anchor: HTMLElement) => {
      const existing = document.querySelector('.add-layer-popup');
      if (existing) { existing.remove(); return; }
      const menu = document.createElement('div');
      menu.className = 'add-layer-popup';
      for (const k of PATTERN_KINDS) {
        const item = document.createElement('div');
        item.className = 'add-layer-popup-item';
        item.textContent = tr(k);
        item.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          addLayerOfKind(k);
          close();
        });
        menu.appendChild(item);
      }
      const rect = anchor.getBoundingClientRect();
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.minWidth = `${rect.width}px`;
      document.body.appendChild(menu);
      const close = () => {
        menu.remove();
        document.removeEventListener('mousedown', onOutside, true);
      };
      const onOutside = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node)) close();
      };
      setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
    };

    const list = document.createElement('div');
    list.className = 'layers-list';
    container.appendChild(list);

    [...project.layers].reverse().forEach((layer) => {
      const row = document.createElement('div');
      row.className = 'layer-row' + (layer.id === project.selectedLayerId ? ' selected' : '');
      row.onclick = () => store.update((p) => { p.selectedLayerId = layer.id; });

      // Drag handle: this is what initiates the drag. Keeping the handle separate
      // from the row means inputs/buttons inside don't accidentally start drags.
      const handle = document.createElement('span');
      handle.className = 'layer-handle';
      handle.textContent = '⋮⋮';
      handle.title = 'Glisser pour réordonner';
      handle.draggable = true;
      handle.addEventListener('dragstart', (e) => {
        draggingId = layer.id;
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', layer.id);
          e.dataTransfer.effectAllowed = 'move';
        }
        row.classList.add('dragging');
      });
      handle.addEventListener('dragend', () => {
        draggingId = null;
        row.classList.remove('dragging');
        // Clear any lingering drop indicators across rows.
        list.querySelectorAll('.drop-above, .drop-below').forEach((el) => {
          el.classList.remove('drop-above', 'drop-below');
        });
      });
      row.appendChild(handle);

      // Drop target wiring on the row itself.
      row.addEventListener('dragover', (e) => {
        if (!draggingId || draggingId === layer.id) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const rect = row.getBoundingClientRect();
        const beforeInDisplay = e.clientY < rect.top + rect.height / 2;
        row.classList.toggle('drop-above', beforeInDisplay);
        row.classList.toggle('drop-below', !beforeInDisplay);
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('drop-above', 'drop-below');
      });
      row.addEventListener('drop', (e) => {
        if (!draggingId || draggingId === layer.id) return;
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const beforeInDisplay = e.clientY < rect.top + rect.height / 2;
        reorder(draggingId, layer.id, beforeInDisplay);
        row.classList.remove('drop-above', 'drop-below');
      });

      const vis = document.createElement('input');
      vis.type = 'checkbox';
      vis.checked = layer.visible;
      vis.title = 'Visible';
      vis.onclick = (e) => { e.stopPropagation(); };
      vis.onchange = () => store.update((p) => {
        p.layers = p.layers.map((l) => l.id === layer.id ? { ...l, visible: vis.checked } : l);
      });
      row.appendChild(vis);

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'layer-name';
      nameInput.value = layer.name;
      nameInput.onclick = (e) => e.stopPropagation();
      nameInput.onchange = () => store.update((p) => {
        p.layers = p.layers.map((l) => l.id === layer.id ? { ...l, name: nameInput.value } : l);
      });
      row.appendChild(nameInput);

      const blendBtn = document.createElement('button');
      blendBtn.className = 'ghost icon blend-btn' + (layer.blendMode !== 'normal' ? ' active' : '');
      blendBtn.textContent = BLEND_ICON[layer.blendMode];
      blendBtn.title = BLEND_TITLE[layer.blendMode];
      blendBtn.onclick = (e) => {
        e.stopPropagation();
        store.update((p) => {
          p.layers = p.layers.map((l) => l.id === layer.id ? { ...l, blendMode: nextBlend(l.blendMode) } : l);
        });
      };
      row.appendChild(blendBtn);

      const dup = document.createElement('button');
      dup.className = 'ghost icon';
      dup.textContent = '⧉';
      dup.title = 'Dupliquer';
      dup.onclick = (e) => {
        e.stopPropagation();
        duplicate(layer.id);
      };
      row.appendChild(dup);

      const del = document.createElement('button');
      del.className = 'ghost icon';
      del.textContent = '✕';
      del.title = 'Supprimer';
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

  function reorder(draggedId: string, targetId: string, beforeInDisplay: boolean): void {
    store.update((p) => {
      const arr = [...p.layers];
      const dragIdx = arr.findIndex((l) => l.id === draggedId);
      if (dragIdx < 0) return;
      const [dragged] = arr.splice(dragIdx, 1);
      const targetIdx = arr.findIndex((l) => l.id === targetId);
      if (targetIdx < 0) {
        arr.push(dragged);
        p.layers = arr;
        return;
      }
      // Display is top→bottom = array high→low. "Before in display" means dragged
      // ends up visually above target → at a higher array index than target.
      const insertAt = beforeInDisplay ? targetIdx + 1 : targetIdx;
      arr.splice(insertAt, 0, dragged);
      p.layers = arr;
    });
  }

  function duplicate(layerId: string): void {
    store.update((p) => {
      const idx = p.layers.findIndex((l) => l.id === layerId);
      if (idx < 0) return;
      const src = p.layers[idx];
      const copy: Layer = {
        ...src,
        id: uid('layer'),
        name: `${src.name} copie`,
        pattern: { ...src.pattern, params: { ...src.pattern.params } } as Layer['pattern'],
      };
      const next = [...p.layers];
      next.splice(idx + 1, 0, copy);
      p.layers = next;
      p.selectedLayerId = copy.id;
    });
  }

  store.subscribe(render);
  render();
}
