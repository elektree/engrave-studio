import { Project } from '../state/project';
import { makeSvg, rect } from '../utils/svg';
import { renderLayer } from '../patterns';

export function buildPreviewSvg(project: Project): SVGSVGElement {
  const { width, height } = project.canvas;
  const svg = makeSvg(width, height);

  // Belt outline (thin guide, not exported in laser SVG)
  svg.appendChild(rect(0, 0, width, height, { stroke: '#bbb', 'stroke-width': 0.1 }));

  // Layers bottom-up, applying mask if needed
  let maskGroup: SVGGElement | null = null;
  for (const layer of project.layers) {
    if (!layer.visible) continue;
    const elements = renderLayer(layer, project.canvas);

    if (layer.blendMode === 'mask') {
      // Build a clipPath from this layer's geometry, applied to next layers
      const clipId = `mask_${layer.id}`;
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const cp = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
      cp.setAttribute('id', clipId);
      for (const e of elements) cp.appendChild(e.cloneNode(true) as SVGElement);
      defs.appendChild(cp);
      svg.appendChild(defs);

      maskGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
      maskGroup.setAttribute('clip-path', `url(#${clipId})`);
      svg.appendChild(maskGroup);
      continue; // mask layer does not render itself
    }

    const target = maskGroup ?? svg;
    for (const e of elements) target.appendChild(e);
  }

  return svg;
}
