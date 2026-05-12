// Drag-to-edit numeric values from their label, Blender-style.
//   • Double-click → reset to default.
//   • Mousedown + drag → horizontal motion scrubs the value (right = +, left = −).
//   • Shift  → precision (×0.1)
//   • Ctrl   → fast (×10)
//   • Esc    → cancel & restore the value at drag start.
//
// We use setPointerCapture (NOT Pointer Lock) so the browser doesn't show its
// "site has control of your pointer" overlay and Escape isn't hijacked.

export type DragEditOpts = {
  getValue: () => number;
  setValue: (v: number) => void;
  defaultValue: number;
  step: number;
  min?: number;
  max?: number;
};

export function attachDragEdit(label: HTMLElement, opts: DragEditOpts): void {
  label.classList.add('drag-edit-label');

  label.addEventListener('dblclick', (e) => {
    e.preventDefault();
    opts.setValue(opts.defaultValue);
  });

  label.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // Don't trigger drag-edit on top of inline icons or upload buttons — only
    // when clicking the label text proper.
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    e.preventDefault(); // suppress text selection
    (document.activeElement as HTMLElement | null)?.blur?.();

    const startValue = opts.getValue();
    let totalDx = 0;
    let cancelled = false;
    let dragged = false;
    const baseStep = opts.step > 0 ? opts.step : 1;
    const pointerId = e.pointerId;

    // Capture the pointer so events keep flowing even if the cursor leaves the
    // label. No browser overlay, cursor stays visible.
    try { label.setPointerCapture(pointerId); } catch { /* ignore */ }

    const onMove = (ev: PointerEvent) => {
      // movementX is the delta since the last pointermove for this pointer.
      const mult = ev.shiftKey ? 0.1 : ev.ctrlKey ? 10 : 1;
      totalDx += ev.movementX;
      if (Math.abs(totalDx) > 1) dragged = true;
      let next = startValue + totalDx * baseStep * mult * 0.5;
      if (opts.min !== undefined) next = Math.max(opts.min, next);
      if (opts.max !== undefined) next = Math.min(opts.max, next);
      // Snap to step grid for clean values.
      const grid = baseStep * mult;
      next = Math.round(next / grid) * grid;
      opts.setValue(next);
    };
    const cleanup = () => {
      label.removeEventListener('pointermove', onMove);
      label.removeEventListener('pointerup', onUp);
      label.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      try { label.releasePointerCapture(pointerId); } catch { /* ignore */ }
      label.classList.remove('drag-edit-active');
      // Clear any selection the click might have caused.
      const sel = window.getSelection?.();
      if (sel && dragged) sel.removeAllRanges();
      if (cancelled) opts.setValue(startValue);
    };
    const onUp = () => cleanup();
    const onCancel = () => cleanup();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cancelled = true;
        cleanup();
      }
    };

    label.classList.add('drag-edit-active');
    label.addEventListener('pointermove', onMove);
    label.addEventListener('pointerup', onUp);
    label.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
  });
}
