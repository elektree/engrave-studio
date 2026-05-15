import { svgEl } from '../utils/svg';

// Two graduated axes anchored at the canvas origin. Coordinates are in mm so
// the ruler sits flush against the laser-mode preview content.
export function buildRulerOverlay(W: number, H: number): SVGElement {
  const g = svgEl('g', { class: 'ruler-overlay', 'data-no-expand': 'true' });
  // Top axis: ticks every 1mm, label every 10mm.
  for (let x = 0; x <= W; x += 1) {
    const isMajor = x % 10 === 0;
    g.appendChild(svgEl('line', {
      x1: x, y1: 0, x2: x, y2: isMajor ? 1.2 : 0.4,
      stroke: '#666', 'stroke-width': isMajor ? 0.1 : 0.05,
    }));
    if (isMajor) {
      const label = svgEl('text', {
        x, y: 2.2,
        'font-size': 0.9, fill: '#666', 'text-anchor': 'middle',
      });
      label.textContent = String(x);
      g.appendChild(label);
    }
  }
  // Left axis: vertical version of the same pattern.
  for (let y = 0; y <= H; y += 1) {
    const isMajor = y % 10 === 0;
    g.appendChild(svgEl('line', {
      x1: 0, y1: y, x2: isMajor ? 1.2 : 0.4, y2: y,
      stroke: '#666', 'stroke-width': isMajor ? 0.1 : 0.05,
    }));
  }
  return g;
}
