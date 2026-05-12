import './style.css';
import { Store, defaultProject, makeLayer } from './state/project';
import { mountCanvasPanel } from './ui/canvas-panel';
import { mountLayersPanel } from './ui/layers-panel';
import { defaultPatternForKind } from './patterns';

const store = new Store(defaultProject());

// Seed one geometric layer so the preview is not blank
store.update((p) => {
  const l = makeLayer(defaultPatternForKind('geometric'), 'Geometric 1');
  p.layers = [l];
  p.selectedLayerId = l.id;
});

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
