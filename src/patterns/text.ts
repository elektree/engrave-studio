import { TextParams, Canvas } from '../state/project';
import { svgEl } from '../utils/svg';

// Rough bbox estimate so we can rotate around the visual centre. Width depends
// on the content + font size; height is roughly the font size.
function estimateHalfWidth(params: TextParams): number {
  return ((params.content?.length ?? 0) * params.sizeMm * 0.55) / 2;
}

export function renderText(params: TextParams, _canvas: Canvas): SVGElement[] {
  // Layer-local origin. Layer offsetX/offsetY positions the text in canvas
  // coordinates — that replaces the old pattern-level x/y.
  const halfW = estimateHalfWidth(params);
  let pivotX = 0;
  if (params.align === 'start') pivotX = halfW;
  else if (params.align === 'end') pivotX = -halfW;
  const t = svgEl('text', {
    x: 0,
    y: 0,
    'font-family': params.fontFamily,
    'font-size': params.sizeMm,
    'text-anchor': params.align,
    'dominant-baseline': 'central',
    transform: `rotate(${params.rotation} ${pivotX} 0)`,
    // textToPath ON → render as stroked outlines (engraving-ready preview that
    // matches what the laser will actually cut). OFF → solid filled glyphs.
    fill: params.textToPath ? 'none' : '#000',
    stroke: params.textToPath ? '#000' : 'none',
    ...(params.textToPath ? { 'stroke-width': params.strokeWidth, 'paint-order': 'stroke' } : {}),
  });
  t.textContent = params.content;
  return [t];
}
