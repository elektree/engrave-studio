import { Project } from '../state/project';
import { makeSvg, rect, svgEl } from '../utils/svg';
import { renderLayer } from '../patterns';

export function buildPreviewSvg(project: Project): SVGSVGElement {
  const { width, height } = project.canvas;
  const svg = makeSvg(width, height);

  // Belt outline (thin guide, not exported in laser SVG)
  svg.appendChild(rect(0, 0, width, height, { stroke: '#bbb', 'stroke-width': 0.1 }));

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
    const elements = renderLayer(layer, project.canvas);

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

    pending.push(...elements);
  }
  flushPending(null);

  return svg;
}
