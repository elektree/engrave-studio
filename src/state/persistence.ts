import { Project, Store, defaultProject } from './project';

const KEY = 'engrave-pattern-generator:project';
const DEBOUNCE_MS = 300;

export function loadProject(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProject();
    const obj = JSON.parse(raw);
    if (obj && obj.version === 1) return obj as Project;
  } catch { /* fall through */ }
  return defaultProject();
}

export function attachAutosave(store: Store): void {
  let t: number | undefined;
  store.subscribe((p) => {
    if (t !== undefined) window.clearTimeout(t);
    t = window.setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* quota errors are ignored */ }
    }, DEBOUNCE_MS);
  });
}

export function exportProjectJson(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(project.name || 'project').replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importProjectJson(file: File, store: Store): Promise<void> {
  return file.text().then((txt) => {
    const obj = JSON.parse(txt);
    if (!obj || obj.version !== 1) throw new Error('Unsupported project version');
    store.set(obj as Project);
  });
}
