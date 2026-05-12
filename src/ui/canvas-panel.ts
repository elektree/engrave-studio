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
