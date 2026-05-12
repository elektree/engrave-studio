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
    i.type = 'number'; i.value = String(value); i.step = String(step); i.min = '1'; i.style.width = '80px';
    i.oninput = () => {
      const v = Number(i.value);
      if (!Number.isFinite(v) || v < 1) return;
      onChange(v);
    };
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
