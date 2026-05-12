import { SvgLayerParams, Canvas, Layer } from '../state/project';
import { svgEl } from '../utils/svg';

function readViewBox(svg: SVGSVGElement): { x: number; y: number; w: number; h: number } {
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const parts = vb.split(/\s+|,/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
      return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
  }
  const w = parseFloat(svg.getAttribute('width') ?? '100') || 100;
  const h = parseFloat(svg.getAttribute('height') ?? '100') || 100;
  return { x: 0, y: 0, w, h };
}

function repaint(el: SVGElement, sw: number): void {
  const tag = el.nodeName.toLowerCase();
  if (
    tag === 'path' || tag === 'line' || tag === 'polyline'
    || tag === 'polygon' || tag === 'rect' || tag === 'circle' || tag === 'ellipse' || tag === 'text'
  ) {
    el.setAttribute('stroke', '#000');
    el.setAttribute('stroke-width', String(sw));
    el.setAttribute('fill', 'none');
  }
  for (const c of Array.from(el.children) as SVGElement[]) repaint(c, sw);
}

export function renderSvgLayer(params: SvgLayerParams, canvas: Canvas, layer?: Layer): SVGElement[] {
  if (!params.svgText) return [];
  const parsed = new DOMParser().parseFromString(params.svgText, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!(root instanceof SVGSVGElement)) return [];
  const vb = readViewBox(root);
  const scale = Math.max(params.scale, 0.001);

  // Build a template <g> that contains the SVG content centred on origin and
  // stripped of metadata. Clone it for every tile to keep things cheap.
  const template = svgEl('g');
  for (const child of Array.from(root.children) as SVGElement[]) {
    const tag = child.nodeName.toLowerCase();
    if (tag === 'title' || tag === 'desc' || tag === 'metadata' || tag === 'defs') continue;
    template.appendChild(child.cloneNode(true) as SVGElement);
  }
  if (params.forceStroke) {
    // Outer scale uniformly multiplies stroke widths; compensate so paper width is sw.
    const compensated = params.strokeWidth / scale;
    repaint(template, compensated);
  }

  const cx = vb.x + vb.w / 2;
  const cy = vb.y + vb.h / 2;
  const instanceTransform = (px: number, py: number): string =>
    `translate(${px} ${py}) rotate(${params.rotation}) scale(${scale}) translate(${-cx} ${-cy})`;

  const buildInstance = (px: number, py: number): SVGElement => {
    const g = svgEl('g', { transform: instanceTransform(px, py) });
    for (const c of Array.from(template.children) as SVGElement[]) g.appendChild(c.cloneNode(true) as SVGElement);
    return g;
  };

  if (!params.tile) return [buildInstance(0, 0)];

  // Texture mode — tile across the canvas in a grid that rotates WITH the SVG's
  // own rotation, so the texture follows the pattern's orientation.
  const tileW = vb.w * scale + Math.max(0, params.tileSpacingX);
  const tileH = vb.h * scale + Math.max(0, params.tileSpacingY);
  const ox = layer?.offsetX ?? 0;
  const oy = layer?.offsetY ?? 0;
  const ang = (params.rotation * Math.PI) / 180;
  const cosA = Math.cos(ang);
  const sinA = Math.sin(ang);

  // Iterate k, j over a range that's guaranteed to cover the canvas under any
  // rotation. We compute the inverse-rotated layer-local positions of the canvas
  // corners, then take the bounding box in grid space.
  const cosNa = Math.cos(-ang);
  const sinNa = Math.sin(-ang);
  const corners = [
    [0 - ox, 0 - oy],
    [canvas.width - ox, 0 - oy],
    [0 - ox, canvas.height - oy],
    [canvas.width - ox, canvas.height - oy],
  ];
  let kMin = Infinity, kMax = -Infinity, jMin = Infinity, jMax = -Infinity;
  for (const [lx, ly] of corners) {
    const gx = lx * cosNa - ly * sinNa;
    const gy = lx * sinNa + ly * cosNa;
    const k = gx / tileW;
    const j = gy / tileH;
    if (k < kMin) kMin = k;
    if (k > kMax) kMax = k;
    if (j < jMin) jMin = j;
    if (j > jMax) jMax = j;
  }
  kMin = Math.floor(kMin) - 1;
  kMax = Math.ceil(kMax) + 1;
  jMin = Math.floor(jMin) - 1;
  jMax = Math.ceil(jMax) + 1;

  const out = svgEl('g');
  for (let j = jMin; j <= jMax; j++) {
    for (let k = kMin; k <= kMax; k++) {
      // Place each tile in the rotated grid frame.
      const localX = k * tileW;
      const localY = j * tileH;
      const px = localX * cosA - localY * sinA;
      const py = localX * sinA + localY * cosA;
      out.appendChild(buildInstance(px, py));
    }
  }
  return [out];
}

export function defaultSvgLayerParams(svgText: string, scale = 1): SvgLayerParams {
  return {
    svgText,
    scale,
    rotation: 0,
    strokeWidth: 0.3,
    forceStroke: true,
    tile: false,
    tileSpacingX: 0,
    tileSpacingY: 0,
  };
}

// Compute a scale that fits the SVG's longest dimension within `targetMm`.
export function scaleForTargetSize(svgText: string, targetMm: number): number {
  try {
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root instanceof SVGSVGElement) {
      const vb = readViewBox(root);
      const longest = Math.max(vb.w, vb.h, 0.1);
      return targetMm / longest;
    }
  } catch { /* ignore */ }
  return 1;
}
