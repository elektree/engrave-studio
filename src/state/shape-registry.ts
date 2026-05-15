import { uid } from '../utils/id';
import { readSvgViewBox } from '../utils/svg';

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

export async function registerCustomShape(file: File): Promise<CustomShape> {
  const text = await file.text();
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!(root instanceof SVGSVGElement) || root.nodeName.toLowerCase() !== 'svg') {
    throw new Error('Fichier SVG invalide');
  }
  const vb = readSvgViewBox(root);
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

// Instantiate a custom shape at (cx, cy) with the requested visual `size`
// and rotation. Colours/paint were baked in by the caller (the scatter
// pattern runs the SVG layer's source-colour pipeline at parse time), so
// here we just clone the template, position it, and compensate any inner
// stroke-width for the outer scale transform.
export function instantiateCustomShape(
  shape: CustomShape,
  cx: number,
  cy: number,
  size: number,
  rot: number,
): SVGElement {
  const longest = Math.max(shape.vb.w, shape.vb.h);
  const scale = size / longest;
  const vbcx = shape.vb.x + shape.vb.w / 2;
  const vbcy = shape.vb.y + shape.vb.h / 2;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute(
    'transform',
    `translate(${cx} ${cy}) rotate(${rot}) scale(${scale}) translate(${-vbcx} ${-vbcy})`,
  );
  const inner = shape.template.cloneNode(true) as SVGElement;
  // Per-instance scale compensation: divide stroke-width by scale so the
  // on-paper stroke matches what the user set, regardless of the chosen
  // instance size.
  compensateStrokes(inner, scale);
  while (inner.firstChild) g.appendChild(inner.firstChild);
  return g;
}

function compensateStrokes(el: SVGElement, scale: number): void {
  if (scale <= 0 || scale === 1) return;
  const stroke = el.getAttribute('stroke');
  if (stroke && stroke !== 'none') {
    const cur = parseFloat(el.getAttribute('stroke-width') ?? '0');
    if (cur > 0) el.setAttribute('stroke-width', String(cur / scale));
  }
  for (const c of Array.from(el.children) as SVGElement[]) compensateStrokes(c, scale);
}
