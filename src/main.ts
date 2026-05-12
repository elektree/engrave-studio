import './style.css';
import { Store, defaultProject } from './state/project';

const store = new Store(defaultProject());

const app = document.getElementById('app')!;
const probe = document.createElement('pre');
app.appendChild(probe);

const render = () => { probe.textContent = JSON.stringify(store.get(), null, 2); };
store.subscribe(render);
render();
