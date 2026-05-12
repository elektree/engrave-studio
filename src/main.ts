import './style.css';
import { Store, makeLayer } from './state/project';
import { loadProject, attachAutosave } from './state/persistence';
import { mountCanvasPanel } from './ui/canvas-panel';
import { mountLayersPanel } from './ui/layers-panel';
import { mountPropsPanel } from './ui/props-panel';
import { defaultPatternForKind } from './patterns';

const store = new Store(loadProject());
attachAutosave(store);

if (store.get().layers.length === 0) {
  store.update((p) => {
    const l = makeLayer(defaultPatternForKind('geometric'), 'Geometric 1');
    p.layers = [l];
    p.selectedLayerId = l.id;
  });
}

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
mountLayersPanel(app.querySelector('.layers') as HTMLElement, store);
mountPropsPanel(app.querySelector('.props') as HTMLElement, store);
