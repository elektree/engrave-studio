import { uid } from '../utils/id';
import type { MaterialId } from '../render/materials';

export type Unit = 'mm';

export type Canvas = { width: number; height: number; unit: Unit };

export type PaletteEntry = {
  id: string;
  name: string;
  color: string;   // hex, e.g. "#404040"
  value: number;   // [0, 1]
  // 'fill' → strokes are converted to closed filled shapes at export. LightBurn
  // user assigns a Fill (scan) operation to the colour layer. Default for
  // engraving depths.
  // 'line' → strokes are kept as single-pass centerlines at kerf width.
  // LightBurn user assigns a Line operation. Default for the cut depth.
  mode: 'fill' | 'line';
};

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
  // Same semantic as text/shape: true = stroked outlines at strokeWidth,
  // false = filled silhouettes. Applies to built-in shapes too.
  outlined: boolean;
  // Hard minimum distance between any two instances (mm) — drives the Poisson
  // disk spacing constraint.
  minDistance: number;
  // Peak target count (items per 100 mm of zone width). The actual count is
  // `density × densityFactor × zoneWidth / 100`.
  density: number;
  // [0, 1] multiplier applied on top of `density`. Lets the user thin out a
  // scatter without touching the spacing constraint.
  densityFactor: number;
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

export type ShapeKind = 'rect' | 'ellipse' | 'star' | 'polygon';
export type ShapeParams = {
  shape: ShapeKind;
  width: number;          // mm — outer bbox width
  height: number;         // mm — outer bbox height
  rotation: number;       // degrees
  cornerRadius: number;   // mm (rect only)
  strokeWidth: number;    // mm; used when `outlined` is true
  // When true the shape is rendered as a stroked outline at strokeWidth (and
  // exported as such — LightBurn user assigns Line). When false (default)
  // the shape is rendered as a filled silhouette (LightBurn user assigns
  // Fill). Same semantic as text's `textToPath` flag.
  outlined: boolean;
  branches: number;       // star only — number of points
  sides: number;          // polygon only — number of vertices
};

export type BezierAnchorType = 'line' | 'corner' | 'smooth' | 'symmetric';
export type BezierAnchor = {
  x: number; y: number;             // anchor position in local mm (centred coords)
  hxIn: number; hyIn: number;       // incoming handle offset relative to the anchor
  hxOut: number; hyOut: number;     // outgoing handle offset relative to the anchor
  type: BezierAnchorType;           // governs handle propagation while editing
};
export type BezierParams = {
  anchors: BezierAnchor[];
  closed: boolean;
  rotation: number;       // degrees, around the centroid (local origin)
  strokeWidth: number;    // mm — used when outlined or path is open
  outlined: boolean;      // true → stroke, false → fill (silently forced to stroke when open)
};

export type SvgLayerParams = {
  svgText: string;        // raw SVG markup
  scale: number;          // uniform scale factor — preserves aspect ratio
  rotation: number;       // degrees
  strokeWidth: number;    // mm (used when outlined=true, or for source strokes)
  // outlined=true → force every imported element to be drawn as a stroke at
  // strokeWidth (source fills become outlines of their silhouette).
  // outlined=false → preserve the source's paint role (filled stays filled,
  // stroked stays stroked); the laser materialise pass later turns strokes
  // into ribbons so the engraved output is uniformly shape-like.
  outlined: boolean;
  // Source colour mapping. Each imported element's effective colour (its
  // stroke if any, else its fill, gradients averaged to a flat hex) is
  // converted to a luminance value and remapped into the [depthForBlack,
  // depthForWhite] depth range, then snapped to the project palette.
  depthForBlack: number;  // [0, 1]; default 1
  depthForWhite: number;  // [0, 1]; default 0
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
  | { kind: 'svg';       params: SvgLayerParams }
  | { kind: 'bezier';    params: BezierParams };

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
  depth: number;         // [0, 1]; snaps to palette at render time
  gradient: LayerGradient;
  mods: Record<string, ParamMod>;
  pattern: Pattern;
};

export type Project = {
  version: 2;
  name: string;
  canvas: Canvas;
  layers: Layer[];                    // index 0 = bottom
  selectedLayerId: string | null;
  kerf: number;                       // mm — laser beam width
  palette: PaletteEntry[];            // ≥1 entry, ordered by value
  // When set, canvas switches to a chrome-free "final result" preview using
  // the named material's burn-colour ramp. Undefined = standard edit mode.
  previewMaterial?: MaterialId;
  showRuler?: boolean;                // UI-only: mm ruler overlay (default on)
};

export function defaultPalette(): PaletteEntry[] {
  return [
    { id: 'depth-effleurage', name: 'effleurage', color: '#E0E0E0', value: 0.0,  mode: 'fill' },
    { id: 'depth-leger',      name: 'léger',      color: '#A0A0A0', value: 0.25, mode: 'fill' },
    { id: 'depth-moyen',      name: 'moyen',      color: '#606060', value: 0.5,  mode: 'fill' },
    { id: 'depth-profond',    name: 'profond',    color: '#303030', value: 0.75, mode: 'fill' },
    { id: 'depth-decoupe',    name: 'découpe',    color: '#000000', value: 1.0,  mode: 'line' },
  ];
}

export function defaultProject(): Project {
  return {
    version: 2,
    name: 'Ceinture sans titre',
    canvas: { width: 1100, height: 35, unit: 'mm' },
    layers: [],
    selectedLayerId: null,
    kerf: 0.12,
    palette: defaultPalette(),
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
    depth: 0.5,
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
