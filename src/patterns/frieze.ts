import { FriezeParams, Canvas } from '../state/project';
import { path } from '../utils/svg';

export function renderFrieze(params: FriezeParams, canvas: Canvas): SVGElement[] {
  const { width: W } = canvas;
  const { variant, period: P, amplitude: A, strokeWidth, offsetX, y, mirror } = params;
  const out: SVGElement[] = [];

  const drawOne = (yc: number, flipY = false): SVGElement => {
    const sign = flipY ? -1 : 1;
    let d = '';
    switch (variant) {
      case 'wave': {
        // Quadratic bezier waves over each half period
        const half = P / 2;
        d = `M ${offsetX} ${yc}`;
        let x = offsetX;
        let up = true;
        while (x < W) {
          const nx = x + half;
          const cy = yc + sign * (up ? -A : A);
          d += ` Q ${(x + nx) / 2} ${cy} ${nx} ${yc}`;
          x = nx; up = !up;
        }
        break;
      }
      case 'greek': {
        // Classic greek key: repeating right-angle motif of width P
        let x = offsetX;
        d = `M ${x} ${yc + sign * A}`;
        while (x < W) {
          d += ` L ${x} ${yc - sign * A}`;
          d += ` L ${x + P * 0.7} ${yc - sign * A}`;
          d += ` L ${x + P * 0.7} ${yc + sign * A * 0.3}`;
          d += ` L ${x + P * 0.3} ${yc + sign * A * 0.3}`;
          d += ` L ${x + P * 0.3} ${yc - sign * A * 0.4}`;
          d += ` L ${x + P * 0.55} ${yc - sign * A * 0.4}`;
          x += P;
          d += ` L ${x} ${yc - sign * A * 0.4}`;
          d += ` L ${x} ${yc + sign * A}`;
        }
        break;
      }
      case 'braid': {
        // Two interlaced sinusoids
        const steps = Math.max(1, Math.floor(W / 2));
        d = `M ${offsetX} ${yc + Math.sin(0) * A * sign}`;
        for (let i = 0; i <= steps; i++) {
          const x = offsetX + (i / steps) * W;
          d += ` L ${x} ${yc + Math.sin((x / P) * Math.PI * 2) * A * sign}`;
        }
        const d2: string[] = [`M ${offsetX} ${yc + Math.cos(0) * A * sign}`];
        for (let i = 0; i <= steps; i++) {
          const x = offsetX + (i / steps) * W;
          d2.push(`L ${x} ${yc + Math.cos((x / P) * Math.PI * 2) * A * sign}`);
        }
        out.push(path(d2.join(' '), strokeWidth));
        break;
      }
      case 'crenel': {
        let x = offsetX;
        d = `M ${x} ${yc + sign * A}`;
        let high = true;
        const half = P / 2;
        while (x < W) {
          d += ` L ${x + half} ${yc + sign * (high ? A : -A)}`;
          x += half;
          d += ` L ${x} ${yc + sign * (high ? -A : A)}`;
          high = !high;
        }
        break;
      }
    }
    return path(d, strokeWidth);
  };

  out.push(drawOne(y));
  if (mirror) out.push(drawOne(y, true));
  return out;
}
