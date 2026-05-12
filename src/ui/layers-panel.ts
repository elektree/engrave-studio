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
