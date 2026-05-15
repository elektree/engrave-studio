import './style.css';
import { Store } from './state/project';
import { loadProject, attachAutosave } from './state/persistence';
import { loadStoredFonts } from './state/font-registry';
import { mountCanvasPanel } from './ui/canvas-panel';
import { mountLayersPanel } from './ui/layers-panel';
import { mountPropsPanel } from './ui/props-panel';
import { mountHeader } from './ui/header';

const store = new Store(loadProject());
attachAutosave(store);
// Restore previously-uploaded custom fonts. Fire-and-forget: the FontFace
// registrations don't gate first paint, they just trigger a re-render once
// the registry subscribers fire.
loadStoredFonts();

const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="app-header"></header>
  <main class="app-main">
    <aside class="layers"></aside>
    <section class="canvas"></section>
    <aside class="props"></aside>
  </main>
`;

mountHeader(app.querySelector('.app-header') as HTMLElement, store);
mountCanvasPanel(app.querySelector('.canvas') as HTMLElement, store);
mountLayersPanel(app.querySelector('.layers') as HTMLElement, store);
mountPropsPanel(app.querySelector('.props') as HTMLElement, store);
