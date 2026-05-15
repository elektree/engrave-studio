import { Layer, Project, Canvas, PatternKind, Pattern } from '../state/project';
import { renderGeometric, defaultGeometricParams } from './geometric';
import { renderFrieze } from './frieze';
import { renderScatter } from './scatter';
import { renderText } from './text';
import { renderMaze, defaultMazeParams } from './maze';
import { renderShape, defaultShapeParams } from './shape';
import { renderSvgLayer, defaultSvgLayerParams } from './svg-layer';

export function renderLayer(layer: Layer, project: Project): SVGElement[] {
  switch (layer.pattern.kind) {
    case 'geometric': return renderGeometric(layer.pattern.params, project, layer);
    case 'frieze':    return renderFrieze(layer.pattern.params, project, layer);
    case 'scatter':   return renderScatter(layer.pattern.params, project, layer);
    case 'text':      return renderText(layer.pattern.params, project, layer);
    case 'maze':      return renderMaze(layer.pattern.params, project, layer);
    case 'shape':     return renderShape(layer.pattern.params, project, layer);
    case 'svg':       return renderSvgLayer(layer.pattern.params, project, layer);
  }
}

export function defaultPatternForKind(kind: PatternKind, canvas?: Canvas, kerf = 0.12): Pattern {
  switch (kind) {
    case 'geometric': return { kind: 'geometric', params: defaultGeometricParams(canvas, kerf) };
    case 'frieze':    return { kind: 'frieze',    params: { variant: 'wave',  period: 20, amplitude: 5, strokeWidth: kerf, offsetX: 0, mirror: false, mirrorOffsetY: 0 } };
    case 'scatter':   return { kind: 'scatter',   params: { shape: 'star', customSvg: '', outlined: false, minDistance: 5, density: 5, densityFactor: 1, minSize: 2, maxSize: 4, rotationJitter: 45, seed: 1, strokeWidth: kerf, zoneWidth: canvas?.width ?? 100, zoneHeight: canvas?.height ?? 35 } };
    case 'text':      return { kind: 'text',      params: { content: 'HELLO', fontFamily: 'Noto Sans', sizeMm: 15, rotation: 0, align: 'middle', strokeWidth: kerf, textToPath: false } };
    case 'maze':      return { kind: 'maze',      params: defaultMazeParams(canvas, kerf) };
    case 'shape':     return { kind: 'shape',     params: defaultShapeParams(kerf) };
    case 'svg':       return { kind: 'svg',       params: defaultSvgLayerParams('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="#000" stroke-width="0.2"/></svg>', 3, kerf) };
  }
}

export const PATTERN_KINDS: PatternKind[] = ['geometric', 'frieze', 'scatter', 'text', 'maze', 'shape', 'svg'];
