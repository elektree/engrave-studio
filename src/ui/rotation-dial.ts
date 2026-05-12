// Small circular dial. The user grabs anywhere on it and the angle from the
// dial's centre to the cursor becomes the rotation. Shift snaps to 15°.

const SVG_NS = 'http://www.w3.org/2000/svg';

export type RotationDialHandle = {
  el: HTMLElement;
  setValue: (deg: number) => void;
  getValue: () => number;
};

export function mountRotationDial(
  parent: HTMLElement,
  initial: number,
  onChange: (deg: number) => void,
): RotationDialHandle {
  const root = document.createElement('div');
  root.className = 'rotation-dial';

  const size = 48;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 3;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  // Outer ring
  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('cx', String(cx));
  ring.setAttribute('cy', String(cy));
  ring.setAttribute('r', String(r));
  ring.setAttribute('fill', 'var(--panel-muted)');
  ring.setAttribute('stroke', 'var(--border-strong)');
  ring.setAttribute('stroke-width', '1');
  svg.appendChild(ring);
  // Tick line
  const tick = document.createElementNS(SVG_NS, 'line');
  tick.setAttribute('x1', String(cx));
  tick.setAttribute('y1', String(cy));
  tick.setAttribute('x2', String(cx));
  tick.setAttribute('y2', String(cy - r + 2));
  tick.setAttribute('stroke', 'var(--accent)');
  tick.setAttribute('stroke-width', '2');
  tick.setAttribute('stroke-linecap', 'round');
  svg.appendChild(tick);
  root.appendChild(svg);

  // Numeric readout — also editable for precise values.
  const readout = document.createElement('input');
  readout.type = 'number';
  readout.step = '1';
  readout.value = String(Math.round(initial));
  readout.className = 'rotation-dial-readout';

  let current = initial;

  const applyTick = (deg: number) => {
    // 0° = up (north). SVG y axis is downward — angles measured clockwise from up.
    const rad = ((deg - 90) * Math.PI) / 180;
    const x2 = cx + Math.cos(rad) * (r - 3);
    const y2 = cy + Math.sin(rad) * (r - 3);
    tick.setAttribute('x2', String(x2));
    tick.setAttribute('y2', String(y2));
  };
  applyTick(initial);

  const setValue = (deg: number) => {
    // Normalise to [0, 360).
    let v = ((deg % 360) + 360) % 360;
    current = v;
    applyTick(v);
    if (document.activeElement !== readout) readout.value = String(Math.round(v * 10) / 10);
  };

  let dragging = false;
  const angleFromEvent = (e: MouseEvent): number => {
    const rect = svg.getBoundingClientRect();
    const cxScreen = rect.left + rect.width / 2;
    const cyScreen = rect.top + rect.height / 2;
    const dx = e.clientX - cxScreen;
    const dy = e.clientY - cyScreen;
    // Convert dy-flip + 90° offset (north = 0°).
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    return ((deg % 360) + 360) % 360;
  };

  svg.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    const initialAngle = angleFromEvent(e);
    const snapped = e.shiftKey ? Math.round(initialAngle / 15) * 15 : initialAngle;
    setValue(snapped);
    onChange(snapped);
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const a = angleFromEvent(e);
    const snapped = e.shiftKey ? Math.round(a / 15) * 15 : a;
    setValue(snapped);
    onChange(snapped);
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  readout.oninput = () => {
    const v = Number(readout.value);
    if (Number.isFinite(v)) {
      current = v;
      applyTick(v);
      onChange(v);
    }
  };

  root.appendChild(readout);
  parent.appendChild(root);

  return {
    el: root,
    setValue,
    getValue: () => current,
  };
}
