import { uid } from '../utils/id';

export type Unit = 'mm';

export type Canvas = { width: number; height: number; unit: Unit };

export type GeometricVariant = 'lines' | 'grid' | 'chevrons' | 'lattice' | 'dots';
export type GeometricParams = {
  variant: GeometricVariant;
  spacing: number;       // mm
  angle: number;         // degrees
  strokeWidth: number;   // mm
  zoneWidth: number;     // mm (defaults to canvas at creation; replaces old margin)
  zoneHeight: number;    // mm
};

export type FriezeVariant = 'wave' | 'greek' | 'braid' | 'crenel';
export type FriezeParams = {
  variant: FriezeVariant;
  period: number;        // mm
  amplitude: number;     // mm
  strokeWidth: number;   // mm
  offsetX: number;       // mm — phase shift of the signal
  mirror: boolean;       // duplicate mirrored vertically
  mirrorOffsetY: number; // mm — vertical distance from the primary to the mirror
};

// Built-in shapes ('star'/'flower'/'rune'/'circle') plus 'custom:<id>' that
// references an entry in the shape registry.
export type ScatterShape = 'star' | 'flower' | 'rune' | 'circle' | 'custom';
export type ScatterParams = {
  shape: ScatterShape;
  customSvg: string;       // raw SVG markup; used when shape === 'custom'
  customForceStroke: boolean; // override custom SVG colours with black stroke / no fill
  density: number;         // approx items per 100 mm
  minSize: number;         // mm
  maxSize: number;         // mm
  rotationJitter: number;  // degrees
  seed: number;
  strokeWidth: number;     // mm
  zoneWidth: number;       // mm — generation zone (defaults to canvas at creation)
  zoneHeight: number;      // mm
};

export type TextAlign = 'start' | 'middle' | 'end';
export type TextParams = {
  content: string;
  fontFamily: string;
  sizeMm: number;
  rotation: number;      // degrees, around the text's visual centre
  align: TextAlign;
  strokeWidth: number;   // mm — visible when textToPath is true
  textToPath: boolean;   // true → render as outlined glyphs (engraving-ready)
};

// Only affects how strokes terminate — both options keep walls connected without
// a visible gap at shared corners (butt caps would leave one).
export type MazeStyle = 'square' | 'rounded';
export type MazeCellShape = 'square' | 'hex';
export type MazeParams = {
  cellSize: number;        // mm — width of one maze cell
  strokeWidth: number;     // mm
  style: MazeStyle;        // stroke linecap/linejoin style
  cellShape: MazeCellShape;
  organicAmount: number;   // 0..1 — master organic dial
  vertexPerturb: number;   // 0..1 — multiplier for vertex displacement
  wallCurve: number;       // 0..1 — multiplier for Catmull-Rom blend
  noiseScale: number;      // mm — spatial scale of the coherent noise
  noiseOctaves: number;    // FBM octaves — bigger = finer detail layered on top
  noiseEvolution: number;  // shifts the noise field without changing the seed
  vertexSmooth: number;    // 0..1 — Laplacian relaxation strength after perturbation
  deformBorders: boolean;  // true → boundary vertices also get perturbed
  seed: number;
  zoneWidth: number;       // mm — maze extent (defaults to canvas at creation)
  zoneHeight: number;      // mm
};

export type ShapeKind = 'rect' | 'ellipse';
export type ShapeParams = {
  shape: ShapeKind;
  width: number;          // mm
  height: number;         // mm
  rotation: number;       // degrees
  cornerRadius: number;   // mm (rect only)
  strokeWidth: number;    // mm; 0 = filled
  fill: boolean;          // true = solid fill (useful for masking), false = stroke only
};

export type SvgLayerParams = {
  svgText: string;        // raw SVG markup
  scale: number;          // uniform scale factor — preserves aspect ratio
  rotation: number;       // degrees
  strokeWidth: number;    // mm (used when forceStroke is true)
  forceStroke: boolean;   // force black stroke, no fill (laser-friendly)
  tile: boolean;          // true = repeat across the canvas as a texture
  tileSpacingX: number;   // mm — extra horizontal gap between repeats
  tileSpacingY: number;   // mm — extra vertical gap between repeats
};

export type Pattern =
  | { kind: 'geometric'; params: GeometricParams }
  | { kind: 'frieze';    params: FriezeParams }
  | { kind: 'scatter';   params: ScatterParams }
  | { kind: 'text';      params: TextParams }
  | { kind: 'maze';      params: MazeParams }
  | { kind: 'shape';     params: ShapeParams }
  | { kind: 'svg';       params: SvgLayerParams };

export type PatternKind = Pattern['kind'];

// Blend mode controls how the layer interacts with the one immediately below it.
//   normal    — renders normally
//   intersect — masks the layer below: only kept where this layer's geometry exists
//   exclude   — masks the layer below: kept where this layer's geometry does NOT exist
export type BlendMode = 'normal' | 'intersect' | 'exclude';

// Per-layer gradient definition. `angle` is the direction of the gradient axis
// in degrees (0 = +X, 90 = +Y). `t0` / `t1` are positions along that axis as
// fractions of the canvas diagonal; the gradient value at any point is the
// projection clamped to [t0, t1] and re-normalised to 0..1.
export type LayerGradient = {
  enabled: boolean;
  angle: number;
  t0: number;
  t1: number;
};

// Modulation map: when a parameter key has a (min, max) here, its effective
// value at a point is `lerp(min, max, gradient(x, y))`. Layers can decide which
// of their numeric params support modulation in their renderer.
export type ParamMod = { min: number; max: number };

export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  blendMode: BlendMode;
  offsetX: number;       // mm — shifts whole rendered layer horizontally
  offsetY: number;       // mm — shifts whole rendered layer vertically
  grow: number;          // mm — inflates every stroke-width in the layer
  gradient: LayerGradient;
  mods: Record<string, ParamMod>;
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
    name: 'Ceinture sans titre',
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
    offsetX: 0,
    offsetY: 0,
    grow: 0,
    gradient: { enabled: true, angle: 0, t0: 0, t1: 1 },
    mods: {},
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
