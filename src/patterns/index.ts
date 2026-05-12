import { Layer, Canvas, PatternKind, Pattern } from '../state/project';
import { renderGeometric, defaultGeometricParams } from './geometric';
import { renderFrieze } from './frieze';

export function renderLayer(layer: Layer, canvas: Canvas): SVGElement[] {
  switch (layer.pattern.kind) {
    case 'geometric': return renderGeometric(layer.pattern.params, canvas);
    case 'frieze':    return renderFrieze(layer.pattern.params, canvas);
    case 'scatter':   return [];   // implemented in Task 9
    case 'text':      return [];   // implemented in Task 10
  }
}

export function defaultPatternForKind(kind: PatternKind): Pattern {
  switch (kind) {
    case 'geometric': return { kind: 'geometric', params: defaultGeometricParams() };
    case 'frieze':    return { kind: 'frieze',    params: { variant: 'wave',  period: 20, amplitude: 5, strokeWidth: 0.3, offsetX: 0, mirror: false, y: 17.5 } };
    case 'scatter':   return { kind: 'scatter',   params: { shape: 'star',    density: 5, minSize: 2, maxSize: 4, rotationJitter: 45, seed: 1, strokeWidth: 0.2 } };
    case 'text':      return { kind: 'text',      params: { content: 'HELLO', fontFamily: 'serif', sizeMm: 15, x: 100, y: 25, rotation: 0, align: 'start', strokeWidth: 0.3 } };
  }
}

export const PATTERN_KINDS: PatternKind[] = ['geometric', 'frieze', 'scatter', 'text'];
