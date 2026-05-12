import { GeometricParams, Canvas } from '../state/project';
import { svgEl, line } from '../utils/svg';

export function renderGeometric(params: GeometricParams, canvas: Canvas): SVGElement[] {
  const out: SVGElement[] = [];
  const { width: W, height: H } = canvas;
  const m = params.margin;
  const sw = params.strokeWidth;
  const spacing = Math.max(params.spacing, 0.1);

  // Clip area = inset rect [m, m, W-m, H-m]
  const clipId = `clip_${Math.random().toString(36).slice(2, 8)}`;
  const defs = svgEl('defs', {}, [
    svgEl('clipPath', { id: clipId }, [
      svgEl('rect', { x: m, y: m, width: Math.max(0, W - 2 * m), height: Math.max(0, H - 2 * m) }),
    ]),
  ]);
  out.push(defs);

  const wrap = svgEl('g', { 'clip-path': `url(#${clipId})` });

  switch (params.variant) {
    case 'lines':
    case 'chevrons':
    case 'lattice': {
      const angle = (params.angle * Math.PI) / 180;
      // Generate enough parallel lines to cover the bounding box rotated by `angle`.
      const diag = Math.hypot(W, H);
      const dx = Math.cos(angle + Math.PI / 2) * spacing;
      const dy = Math.sin(angle + Math.PI / 2) * spacing;
      const steps = Math.ceil(diag / spacing) + 2;
      const cx = W / 2;
      const cy = H / 2;
      for (let i = -steps; i <= steps; i++) {
        const ox = cx + i * dx;
        const oy = cy + i * dy;
        const ex = Math.cos(angle) * diag;
        const ey = Math.sin(angle) * diag;
        wrap.appendChild(line(ox - ex, oy - ey, ox + ex, oy + ey, sw));
      }
      if (params.variant === 'lattice' || params.variant === 'chevrons') {
        const angle2 = params.variant === 'lattice' ? angle + Math.PI / 2 : Math.PI - angle;
        const dx2 = Math.cos(angle2 + Math.PI / 2) * spacing;
        const dy2 = Math.sin(angle2 + Math.PI / 2) * spacing;
        for (let i = -steps; i <= steps; i++) {
          const ox = cx + i * dx2;
          const oy = cy + i * dy2;
          const ex = Math.cos(angle2) * diag;
          const ey = Math.sin(angle2) * diag;
          wrap.appendChild(line(ox - ex, oy - ey, ox + ex, oy + ey, sw));
        }
      }
      break;
    }
    case 'grid': {
      for (let x = m; x <= W - m + 1e-6; x += spacing) wrap.appendChild(line(x, m, x, H - m, sw));
      for (let y = m; y <= H - m + 1e-6; y += spacing) wrap.appendChild(line(m, y, W - m, y, sw));
      break;
    }
    case 'dots': {
      // Small filled circles work reliably for engraving (single-pulse spots).
      const dotsGroup = svgEl('g');
      for (let x = m; x <= W - m + 1e-6; x += spacing) {
        for (let y = m; y <= H - m + 1e-6; y += spacing) {
          dotsGroup.appendChild(svgEl('circle', { cx: x, cy: y, r: sw / 2, fill: '#000', stroke: 'none' }));
        }
      }
      wrap.appendChild(dotsGroup);
      break;
    }
  }

  out.push(wrap);
  return out;
}

export function defaultGeometricParams(): GeometricParams {
  return { variant: 'lines', spacing: 4, angle: 45, strokeWidth: 0.2, margin: 2 };
}
