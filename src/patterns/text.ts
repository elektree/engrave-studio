import { TextParams, Canvas } from '../state/project';
import { svgEl } from '../utils/svg';

export function renderText(params: TextParams, _canvas: Canvas): SVGElement[] {
  // SVG font-size is in user units (mm here). Stroke for preview = thin black line so the user
  // sees roughly the engraving result; fill is none.
  const t = svgEl('text', {
    x: params.x,
    y: params.y,
    'font-family': params.fontFamily,
    'font-size': params.sizeMm,
    'text-anchor': params.align,
    transform: `rotate(${params.rotation} ${params.x} ${params.y})`,
    fill: '#000',
    stroke: 'none',
  });
  t.textContent = params.content;
  return [t];
}
