import { FriezeParams, Canvas, Layer } from '../state/project';
import { path } from '../utils/svg';
import { makeParamResolver } from './gradient';

export function renderFrieze(params: FriezeParams, canvas: Canvas, layer?: Layer): SVGElement[] {
  const { width: W, height: H } = canvas;
  const { variant, period: P, amplitude: A, strokeWidth, offsetX, mirror, mirrorOffsetY } = params;
  const out: SVGElement[] = [];
  const resolve = makeParamResolver(layer, W, H);
  const ampAt = (xq: number, yq: number) => Math.max(0, resolve('amplitude', A, xq, yq));
  const periodAt = (xq: number, yq: number) => Math.max(0.5, resolve('period', P, xq, yq));
  const mirrorOffsetAt = (xq: number) => resolve('mirrorOffsetY', mirrorOffsetY, xq, 0);

  // Each copy is drawn around its own baseline yc. The primary is at y=0 in
  // layer-local coords; the mirror sits at mirrorOffsetY with sign flipped.
  const drawOne = (ycResolver: (xq: number) => number, flipY = false): SVGElement => {
    const sign = flipY ? -1 : 1;
    let d = '';
    switch (variant) {
      case 'wave': {
        const sampleStep = 0.5;
        const samples = Math.max(2, Math.ceil(W / sampleStep) + 1);
        for (let i = 0; i < samples; i++) {
          const x = (i / (samples - 1)) * W;
          const ph = periodAt(x, 0);
          const yv = ycResolver(x) - Math.sin(((x - offsetX) / ph) * Math.PI * 2) * ampAt(x, 0) * sign;
          d += i === 0 ? `M ${x} ${yv}` : ` L ${x} ${yv}`;
        }
        break;
      }
      case 'braid': {
        const sampleStep = 0.5;
        const samples = Math.max(2, Math.ceil(W / sampleStep) + 1);
        for (let i = 0; i < samples; i++) {
          const x = (i / (samples - 1)) * W;
          const ph = periodAt(x, 0);
          const a = ampAt(x, 0);
          const yv = ycResolver(x) + Math.sin(((x - offsetX) / ph) * Math.PI * 2) * a * sign;
          d += i === 0 ? `M ${x} ${yv}` : ` L ${x} ${yv}`;
        }
        const d2: string[] = [];
        for (let i = 0; i < samples; i++) {
          const x = (i / (samples - 1)) * W;
          const ph = periodAt(x, 0);
          const a = ampAt(x, 0);
          const yv = ycResolver(x) + Math.cos(((x - offsetX) / ph) * Math.PI * 2) * a * sign;
          d2.push(i === 0 ? `M ${x} ${yv}` : `L ${x} ${yv}`);
        }
        out.push(path(d2.join(' '), strokeWidth));
        break;
      }
      case 'greek': {
        const baseP = P;
        const startIdx = Math.floor((0 - offsetX) / baseP);
        const endIdx = Math.ceil((W - offsetX) / baseP);
        let started = false;
        for (let i = startIdx; i <= endIdx; i++) {
          const motifX = offsetX + i * baseP;
          const motifEnd = motifX + baseP;
          if (motifEnd < 0 || motifX > W) continue;
          const a = ampAt(motifX + baseP / 2, 0);
          const yc = ycResolver(motifX + baseP / 2);
          if (!started) { d += `M ${motifX} ${yc + sign * a}`; started = true; }
          d += ` L ${motifX} ${yc - sign * a}`;
          d += ` L ${motifX + baseP * 0.7} ${yc - sign * a}`;
          d += ` L ${motifX + baseP * 0.7} ${yc + sign * a * 0.3}`;
          d += ` L ${motifX + baseP * 0.3} ${yc + sign * a * 0.3}`;
          d += ` L ${motifX + baseP * 0.3} ${yc - sign * a * 0.4}`;
          d += ` L ${motifX + baseP * 0.55} ${yc - sign * a * 0.4}`;
          d += ` L ${motifEnd} ${yc - sign * a * 0.4}`;
          d += ` L ${motifEnd} ${yc + sign * a}`;
        }
        break;
      }
      case 'crenel': {
        const baseHalfP = P / 2;
        const startIdx = Math.floor((0 - offsetX) / baseHalfP);
        const endIdx = Math.ceil((W - offsetX) / baseHalfP);
        let started = false;
        let prevDir = 1;
        for (let i = startIdx; i <= endIdx; i++) {
          const x0 = offsetX + i * baseHalfP;
          const x1 = x0 + baseHalfP;
          if (x1 < 0 || x0 > W) continue;
          const cx = Math.max(0, x0);
          const ce = Math.min(W, x1);
          const dirA = ((i % 2) + 2) % 2 === 0 ? 1 : -1;
          const a = ampAt((cx + ce) / 2, 0);
          const yc = ycResolver((cx + ce) / 2);
          if (!started) { d += `M ${cx} ${yc + sign * dirA * a}`; started = true; prevDir = dirA; }
          if (dirA !== prevDir) d += ` L ${cx} ${yc + sign * dirA * a}`;
          d += ` L ${ce} ${yc + sign * dirA * a}`;
          prevDir = dirA;
        }
        break;
      }
    }
    return path(d, strokeWidth);
  };
  void H;

  // Symmetric layout: with no mirror, primary at y=0. With mirror enabled the
  // primary moves up by half the offset and the mirror down by half, so the
  // pair is centred on the layer's local origin.
  if (mirror) {
    out.push(drawOne((xq) => -mirrorOffsetAt(xq) / 2, false));
    out.push(drawOne((xq) => mirrorOffsetAt(xq) / 2, true));
  } else {
    out.push(drawOne(() => 0, false));
  }
  return out;
}
