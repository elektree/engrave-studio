// Lightweight custom dropdown that supports per-option HTML rendering.
// Native <option> elements ignore most styling (font-family, embedded SVG, etc.)
// in Chromium and Firefox; this gives us full control over both the selected
// indicator and the options panel.

export type RichSelectOption<T extends string = string> = {
  value: T;
  render: () => HTMLElement;
};

export type RichSelectHandle<T extends string = string> = {
  el: HTMLElement;
  setValue: (v: T) => void;
  setOptions: (opts: RichSelectOption<T>[]) => void;
  getValue: () => T;
};

export function mountRichSelect<T extends string>(
  parent: HTMLElement,
  initialValue: T,
  options: RichSelectOption<T>[],
  onChange: (v: T) => void,
): RichSelectHandle<T> {
  const root = document.createElement('div');
  root.className = 'rich-select';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rich-select-button';
  root.appendChild(button);

  const panel = document.createElement('div');
  panel.className = 'rich-select-panel hidden';
  root.appendChild(panel);

  let value = initialValue;
  let opts = options;

  const renderButton = (): void => {
    button.innerHTML = '';
    const sel = opts.find((o) => o.value === value);
    const content = document.createElement('span');
    content.className = 'rich-select-value';
    if (sel) content.appendChild(sel.render());
    const caret = document.createElement('span');
    caret.className = 'rich-select-caret';
    caret.textContent = '▾';
    button.appendChild(content);
    button.appendChild(caret);
  };

  const renderPanel = (): void => {
    panel.innerHTML = '';
    for (const o of opts) {
      const item = document.createElement('div');
      item.className = 'rich-select-item' + (o.value === value ? ' selected' : '');
      item.appendChild(o.render());
      item.addEventListener('mousedown', (e) => {
        // mousedown so we beat the document-mousedown that closes the panel.
        e.preventDefault();
        if (value !== o.value) {
          value = o.value;
          onChange(o.value);
          renderButton();
        }
        close();
      });
      panel.appendChild(item);
    }
  };

  const open = (): void => {
    renderPanel();
    panel.classList.remove('hidden');
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);
  };

  const close = (): void => {
    panel.classList.add('hidden');
    document.removeEventListener('mousedown', onDocMouseDown);
    document.removeEventListener('keydown', onDocKeyDown);
  };

  const onDocMouseDown = (e: MouseEvent): void => {
    if (!root.contains(e.target as Node)) close();
  };

  const onDocKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };

  button.addEventListener('click', () => {
    if (panel.classList.contains('hidden')) open(); else close();
  });

  renderButton();
  parent.appendChild(root);

  return {
    el: root,
    setValue: (v: T) => { value = v; renderButton(); },
    setOptions: (next: RichSelectOption<T>[]) => {
      opts = next;
      renderButton();
      if (!panel.classList.contains('hidden')) renderPanel();
    },
    getValue: () => value,
  };
}
