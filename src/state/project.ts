import { uid } from '../utils/id';

export type Unit = 'mm';

export type Canvas = { width: number; height: number; unit: Unit };

export type GeometricVariant = 'lines' | 'grid' | 'chevrons' | 'lattice' | 'dots';
export type GeometricParams = {
  variant: GeometricVariant;
  spacing: number;       // mm
  angle: number;         // degrees
  strokeWidth: number;   // mm
  margin: number;        // mm, all sides
};

export type FriezeVariant = 'wave' | 'greek' | 'braid' | 'crenel';
export type FriezeParams = {
  variant: FriezeVariant;
  period: number;        // mm
  amplitude: number;     // mm
  strokeWidth: number;   // mm
  offsetX: number;       // mm
  mirror: boolean;       // duplicate vertically mirrored on the X axis
  y: number;             // mm, vertical center
};

export type ScatterShape = 'star' | 'flower' | 'rune' | 'circle';
export type ScatterParams = {
  shape: ScatterShape;
  density: number;       // approx items per 100 mm
  minSize: number;       // mm
  maxSize: number;       // mm
  rotationJitter: number;// degrees
  seed: number;
  strokeWidth: number;   // mm
};

export type TextAlign = 'start' | 'middle' | 'end';
export type TextParams = {
  content: string;
  fontFamily: string;
  sizeMm: number;
  x: number;             // mm
  y: number;             // mm (baseline)
  rotation: number;      // degrees
  align: TextAlign;
  strokeWidth: number;   // mm (used by export)
};

export type Pattern =
  | { kind: 'geometric'; params: GeometricParams }
  | { kind: 'frieze';    params: FriezeParams }
  | { kind: 'scatter';   params: ScatterParams }
  | { kind: 'text';      params: TextParams };

export type PatternKind = Pattern['kind'];

export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  blendMode: 'normal' | 'mask';
  pattern: Pattern;
};

export type Project = {
  version: 1;
  name: string;
  canvas: Canvas;
  layers: Layer[];          // index 0 = bottom
  selectedLayerId: string | null;
};

export function defaultProject(): Project {
  return {
    version: 1,
    name: 'Untitled belt',
    canvas: { width: 1100, height: 35, unit: 'mm' },
    layers: [],
    selectedLayerId: null,
  };
}

export function makeLayer(pattern: Pattern, name: string): Layer {
  return {
    id: uid('layer'),
    name,
    visible: true,
    blendMode: 'normal',
    pattern,
  };
}

type Listener = (p: Project) => void;

export class Store {
  private state: Project;
  private listeners = new Set<Listener>();

  constructor(initial: Project) {
    this.state = initial;
  }

  get(): Project { return this.state; }

  set(next: Project): void {
    this.state = next;
    this.listeners.forEach((l) => l(this.state));
  }

  update(mutator: (draft: Project) => Project | void): void {
    // Shallow copy at top-level; deeper structures are replaced explicitly by callers.
    const draft: Project = { ...this.state };
    const result = mutator(draft);
    this.set(result ?? draft);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
