import { GeometricParams, Canvas, Layer } from '../state/project';
import { svgEl, line } from '../utils/svg';
import { makeParamResolver } from './gradient';

export function renderGeometric(params: GeometricParams, canvas: Canvas, layer?: Layer): SVGElement[] {
  const out: SVGElement[] = [];
  const sw = params.strokeWidth;
  const spacing = Math.max(params.spacing, 0.1);
  // Zone replaces the old margin. Defaults to canvas dimensions for safety.
  const zw = params.zoneWidth > 0 ? params.zoneWidth : canvas.width;
  const zh = params.zoneHeight > 0 ? params.zoneHeight : canvas.height;
  const resolve = makeParamResolver(layer, zw, zh);

  // Clip everything to the zone — lines extending past it get trimmed.
  const clipId = `clip_${Math.random().toString(36).slice(2, 8)}`;
  const defs = svgEl('defs', {}, [
    svgEl('clipPath', { id: clipId }, [
      svgEl('rect', { x: 0, y: 0, width: zw, height: zh }),
    ]),
  ]);
  out.push(defs);

  const wrap = svgEl('g', { 'clip-path': `url(#${clipId})` });

  const minStep = Math.max(0.1, spacing * 0.05);
  const drawParallelLines = (angle: number, parent: SVGElement) => {
    const diag = Math.hypot(zw, zh);
    const px = Math.cos(angle + Math.PI / 2);
    const py = Math.sin(angle + Math.PI / 2);
    const ex = Math.cos(angle) * diag;
    const ey = Math.sin(angle) * diag;
    const cx0 = zw / 2;
    const cy0 = zh / 2;
    const startU = -diag;
    const endU = diag;
    let u = startU;
    let safety = 0;
    while (u <= endU && safety++ < 5000) {
      const ox = cx0 + px * u;
      const oy = cy0 + py * u;
      const swHere = Math.max(0.01, resolve('strokeWidth', sw, ox, oy));
      parent.appendChild(line(ox - ex, oy - ey, ox + ex, oy + ey, swHere));
      u += Math.max(minStep, resolve('spacing', spacing, ox, oy));
    }
  };

  switch (params.variant) {
    case 'lines':
    case 'chevrons':
    case 'lattice': {
      const angle = (params.angle * Math.PI) / 180;
      drawParallelLines(angle, wrap);
      if (params.variant === 'lattice' || params.variant === 'chevrons') {
        const angle2 = params.variant === 'lattice' ? angle + Math.PI / 2 : Math.PI - angle;
        drawParallelLines(angle2, wrap);
      }
      break;
    }
    case 'grid': {
      let x = 0;
      let safety = 0;
      while (x <= zw + 1e-6 && safety++ < 5000) {
        const swHere = Math.max(0.01, resolve('strokeWidth', sw, x, zh / 2));
        wrap.appendChild(line(x, 0, x, zh, swHere));
        x += Math.max(minStep, resolve('spacing', spacing, x, zh / 2));
      }
      let y = 0;
      safety = 0;
      while (y <= zh + 1e-6 && safety++ < 5000) {
        const swHere = Math.max(0.01, resolve('strokeWidth', sw, zw / 2, y));
        wrap.appendChild(line(0, y, zw, y, swHere));
        y += Math.max(minStep, resolve('spacing', spacing, zw / 2, y));
      }
      break;
    }
    case 'dots': {
      const dotsGroup = svgEl('g');
      let x = 0;
      let safety = 0;
      while (x <= zw + 1e-6 && safety++ < 10000) {
        let y = 0;
        let ySafety = 0;
        while (y <= zh + 1e-6 && ySafety++ < 10000) {
          const swHere = Math.max(0.01, resolve('strokeWidth', sw, x, y));
          dotsGroup.appendChild(svgEl('circle', { cx: x, cy: y, r: swHere / 2, fill: '#000', stroke: 'none' }));
          y += Math.max(minStep, resolve('spacing', spacing, x, y));
        }
        x += Math.max(minStep, resolve('spacing', spacing, x, 0));
      }
      wrap.appendChild(dotsGroup);
      break;
    }
  }

  out.push(wrap);
  return out;
}

export function defaultGeometricParams(canvas?: Canvas): GeometricParams {
  return {
    variant: 'lines',
    spacing: 4,
    angle: 45,
    strokeWidth: 0.2,
    zoneWidth: canvas?.width ?? 100,
    zoneHeight: canvas?.height ?? 35,
  };
}
