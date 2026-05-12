import { uid } from '../utils/id';

// Runtime-only registry of user-uploaded SVG shapes. Each entry stores a
// template element whose children are cloned at scatter render time.

export type CustomShape = {
  id: string;
  name: string;
  // Template element: children get cloned. The transform we apply normalises
  // the shape from its viewBox to the requested size at the requested centre.
  template: SVGElement;
  // Bounding box used to position/scale the shape into a unit-centred frame.
  vb: { x: number; y: number; w: number; h: number };
};

const shapes = new Map<string, CustomShape>();
const subscribers = new Set<() => void>();

const SVG_NS = 'http://www.w3.org/2000/svg';

function readViewBox(svg: SVGSVGElement): { x: number; y: number; w: number; h: number } {
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const [x, y, w, h] = vb.split(/\s+|,/).map(Number);
    if ([x, y, w, h].every((n) => Number.isFinite(n)) && w > 0 && h > 0) {
      return { x, y, w, h };
    }
  }
  const w = parseFloat(svg.getAttribute('width') ?? '100');
  const h = parseFloat(svg.getAttribute('height') ?? '100');
  return { x: 0, y: 0, w: w || 100, h: h || 100 };
}

export async function registerCustomShape(file: File): Promise<CustomShape> {
  const text = await file.text();
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!(root instanceof SVGSVGElement) || root.nodeName.toLowerCase() !== 'svg') {
    throw new Error('Fichier SVG invalide');
  }
  const vb = readViewBox(root);
  // Copy the SVG's children into a plain <g> template (drop title/desc/metadata).
  const template = document.createElementNS(SVG_NS, 'g');
  for (const child of Array.from(root.children)) {
    const tag = child.nodeName.toLowerCase();
    if (tag === 'title' || tag === 'desc' || tag === 'metadata' || tag === 'defs') continue;
    template.appendChild(child.cloneNode(true));
  }
  const shape: CustomShape = {
    id: uid('shape'),
    name: file.name.replace(/\.svg$/i, ''),
    template,
    vb,
  };
  shapes.set(shape.id, shape);
  subscribers.forEach((s) => s());
  return shape;
}

export function getCustomShapes(): CustomShape[] {
  return Array.from(shapes.values());
}

export function getCustomShape(id: string): CustomShape | null {
  return shapes.get(id) ?? null;
}

export function subscribeShapeRegistry(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// Instantiate a custom shape at (cx, cy) with the requested visual `size` and rotation.
// Strokes are forced to black with the given stroke width; fills are removed (so the
// laser cutter draws outlines only).
export function instantiateCustomShape(
  shape: CustomShape,
  cx: number,
  cy: number,
  size: number,
  rot: number,
  sw: number,
): SVGElement {
  const longest = Math.max(shape.vb.w, shape.vb.h);
  const scale = size / longest;
  const vbcx = shape.vb.x + shape.vb.w / 2;
  const vbcy = shape.vb.y + shape.vb.h / 2;
  const g = document.createElementNS(SVG_NS, 'g');
  // Outer transform: place at (cx, cy), apply rotation, then scale, then re-centre
  // the shape on the origin.
  g.setAttribute(
    'transform',
    `translate(${cx} ${cy}) rotate(${rot}) scale(${scale}) translate(${-vbcx} ${-vbcy})`,
  );
  const inner = shape.template.cloneNode(true) as SVGElement;
  const preserve = shape.template.getAttribute('data-preserve-colours') === 'true';
  if (!preserve) {
    // The on-paper stroke width is sw mm; we're inside a `scale(scale)` group
    // so attribute strokes get amplified by `scale`. Compensate by dividing.
    forceStroke(inner, sw / scale);
  }
  // Move the contents from the cloned group into our positioned group.
  while (inner.firstChild) g.appendChild(inner.firstChild);
  return g;
}

function forceStroke(el: SVGElement, sw: number): void {
  if (el instanceof SVGElement) {
    const tag = el.nodeName.toLowerCase();
    if (
      tag === 'path' || tag === 'polygon' || tag === 'polyline'
      || tag === 'line' || tag === 'rect' || tag === 'circle' || tag === 'ellipse'
    ) {
      el.setAttribute('stroke', '#000');
      el.setAttribute('stroke-width', String(sw));
      el.setAttribute('fill', 'none');
    }
  }
  for (const c of Array.from(el.children) as SVGElement[]) forceStroke(c, sw);
}
