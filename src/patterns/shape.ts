import { ShapeParams, Project, Layer } from '../state/project';
import { svgEl } from '../utils/svg';
import { colorForDepth } from '../utils/palette';

// All four variants emit a single closed shape — filled silhouette by default,
// stroked outline when `outlined` is true. Same model as text: pick fill OR
// outline, never both.
export function renderShape(params: ShapeParams, project: Project, layer: Layer): SVGElement[] {
  const { shape, width, height, rotation, cornerRadius, strokeWidth, outlined } = params;
  const w = Math.max(0.1, width);
  const h = Math.max(0.1, height);
  const color = colorForDepth(layer.depth, project.palette);
  const halfW = w / 2;
  const halfH = h / 2;
  const paint: Record<string, string | number> = outlined
    ? { fill: 'none', stroke: color, 'stroke-width': strokeWidth }
    : { fill: color, stroke: 'none' };
  const transform = `rotate(${rotation})`;

  if (shape === 'rect') {
    return [svgEl('rect', {
      ...paint, transform,
      x: -halfW, y: -halfH, width: w, height: h,
      rx: cornerRadius, ry: cornerRadius,
    })];
  }
  if (shape === 'ellipse') {
    return [svgEl('ellipse', {
      ...paint, transform,
      cx: 0, cy: 0, rx: halfW, ry: halfH,
    })];
  }
  if (shape === 'star') {
    const n = Math.max(3, Math.floor(params.branches));
    // Inner radius at 40 % of outer — a balanced "classic" star. Independent
    // of W/H so the user can squash a star by changing only one axis.
    return [svgEl('path', {
      ...paint, transform,
      d: starPath(halfW, halfH, n, 0.4),
    })];
  }
  // Regular polygon
  const n = Math.max(3, Math.floor(params.sides));
  return [svgEl('path', {
    ...paint, transform,
    d: polygonPath(halfW, halfH, n),
  })];
}

// Star with `n` outer points and a matching number of inner concave vertices.
// `rOuter`/`rInner` are independent X/Y radii so non-square `width != height`
// produces a squashed star instead of a circular one.
function starPath(rxOuter: number, ryOuter: number, n: number, innerRatio: number): string {
  const pts: string[] = [];
  // Start with the first outer point at the top (angle = -π/2).
  for (let i = 0; i < 2 * n; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / n;
    const isOuter = i % 2 === 0;
    const rx = isOuter ? rxOuter : rxOuter * innerRatio;
    const ry = isOuter ? ryOuter : ryOuter * innerRatio;
    pts.push(`${rx * Math.cos(angle)} ${ry * Math.sin(angle)}`);
  }
  return 'M ' + pts.join(' L ') + ' Z';
}

function polygonPath(rx: number, ry: number, n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push(`${rx * Math.cos(angle)} ${ry * Math.sin(angle)}`);
  }
  return 'M ' + pts.join(' L ') + ' Z';
}

export function defaultShapeParams(kerf = 0.12): ShapeParams {
  return {
    shape: 'rect',
    width: 40,
    height: 20,
    rotation: 0,
    cornerRadius: 0,
    strokeWidth: kerf,
    outlined: false,
    branches: 5,
    sides: 6,
  };
}
