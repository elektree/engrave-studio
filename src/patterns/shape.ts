import { ShapeParams, Canvas } from '../state/project';
import { svgEl } from '../utils/svg';

export function renderShape(params: ShapeParams, _canvas: Canvas): SVGElement[] {
  const { shape, width, height, rotation, cornerRadius, strokeWidth, fill } = params;
  const w = Math.max(0.1, width);
  const h = Math.max(0.1, height);
  // Render centred on origin so the layer offset places the shape's centre.
  // This matches the user's mental model when they drag the layer.
  const halfW = w / 2;
  const halfH = h / 2;
  const fillColor = fill ? '#000' : 'none';
  const strokeColor = strokeWidth > 0 || !fill ? '#000' : 'none';
  const baseAttrs: Record<string, string | number> = {
    fill: fillColor,
    stroke: strokeColor,
    'stroke-width': strokeWidth,
    transform: `rotate(${rotation})`,
  };

  if (shape === 'rect') {
    return [svgEl('rect', {
      ...baseAttrs,
      x: -halfW, y: -halfH, width: w, height: h,
      rx: cornerRadius, ry: cornerRadius,
    })];
  }
  return [svgEl('ellipse', {
    ...baseAttrs,
    cx: 0, cy: 0, rx: halfW, ry: halfH,
  })];
}

export function defaultShapeParams(): ShapeParams {
  return {
    shape: 'rect',
    width: 40,
    height: 20,
    rotation: 0,
    cornerRadius: 0,
    strokeWidth: 0.3,
    fill: true,
  };
}
