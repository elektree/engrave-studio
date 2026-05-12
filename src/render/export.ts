import opentype from 'opentype.js';
import { Project, TextParams } from '../state/project';
import { renderLayer } from '../patterns';
import { svgEl } from '../utils/svg';

let cachedFont: opentype.Font | null = null;
async function loadFont(): Promise<opentype.Font> {
  if (cachedFont) return cachedFont;
  const buf = await fetch('/fonts/NotoSans-Regular.ttf').then((r) => {
    if (!r.ok) throw new Error('Could not load /fonts/NotoSans-Regular.ttf');
    return r.arrayBuffer();
  });
  cachedFont = opentype.parse(buf);
  return cachedFont;
}

function textToPathElement(params: TextParams, font: opentype.Font): SVGElement {
  // opentype uses font units → use getPath with the requested em size; SVG units = mm here.
  const tmp = font.getPath(params.content, 0, 0, params.sizeMm);
  // Measure to support alignment
  const bbox = tmp.getBoundingBox();
  let dx = 0;
  if (params.align === 'middle') dx = -(bbox.x2 - bbox.x1) / 2;
  else if (params.align === 'end') dx = -(bbox.x2 - bbox.x1);
  const p = font.getPath(params.content, dx, 0, params.sizeMm);
  const d = p.toPathData(3);
  return svgEl('path', {
    d,
    transform: `translate(${params.x} ${params.y}) rotate(${params.rotation})`,
    stroke: '#000',
    'stroke-width': params.strokeWidth,
    fill: 'none',
  });
}

export async function exportLaserSvg(
  project: Project,
  options: { strokeOnly: boolean; textToPath: boolean },
): Promise<string> {
  // Strategy: reuse renderLayer for non-text layers; for text layers, replace with text-to-path when requested.
  const font = options.textToPath ? await loadFont() : null;

  const { width: W, height: H } = project.canvas;
  const svg = svgEl('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    width: `${W}mm`,
    height: `${H}mm`,
    viewBox: `0 0 ${W} ${H}`,
  });

  // A mask layer wraps the preceding contiguous block of normal layers in a clipPath
  // built from its own geometry. Block resets at each mask boundary.
  const pending: SVGElement[] = [];
  const flushPending = (clipPath: string | null): void => {
    if (pending.length === 0) return;
    if (clipPath) {
      const wrap = svgEl('g', { 'clip-path': clipPath });
      for (const e of pending) wrap.appendChild(e);
      svg.appendChild(wrap);
    } else {
      for (const e of pending) svg.appendChild(e);
    }
    pending.length = 0;
  };

  for (const layer of project.layers) {
    if (!layer.visible) continue;

    let elements: SVGElement[];
    if (layer.pattern.kind === 'text' && font) {
      elements = [textToPathElement(layer.pattern.params, font)];
    } else {
      elements = renderLayer(layer, project.canvas);
    }

    if (layer.blendMode === 'mask') {
      const clipId = `mask_${layer.id}`;
      const defs = svgEl('defs');
      const cp = svgEl('clipPath', { id: clipId });
      for (const e of elements) cp.appendChild(e.cloneNode(true) as SVGElement);
      defs.appendChild(cp);
      svg.appendChild(defs);
      flushPending(`url(#${clipId})`);
      continue;
    }

    if (options.strokeOnly) {
      for (const e of elements) forceStroke(e);
    }
    pending.push(...elements);
  }
  flushPending(null);

  return new XMLSerializer().serializeToString(svg);
}

function forceStroke(el: SVGElement): void {
  const stroke = el.getAttribute('stroke');
  if (!stroke || stroke === 'none') el.setAttribute('stroke', '#000');
  if (!el.hasAttribute('stroke-width')) el.setAttribute('stroke-width', '0.1');
  el.setAttribute('fill', 'none');
  for (const child of Array.from(el.children) as SVGElement[]) forceStroke(child);
}
