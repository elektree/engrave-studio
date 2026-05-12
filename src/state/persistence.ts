import { Project, Store, defaultProject, Layer } from './project';

const KEY = 'engrave-pattern-generator:project';
const DEBOUNCE_MS = 300;

// Map a legacy SvgLayerParams `width` value to the new uniform `scale` by
// peeking at the stored SVG's viewBox.
function readScaleFromLegacy(svgText: string, width: number): number {
  try {
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root instanceof SVGSVGElement) {
      const vb = root.getAttribute('viewBox');
      if (vb) {
        const parts = vb.split(/\s+|,/).map(Number);
        if (parts.length === 4 && parts[2] > 0) return width / parts[2];
      }
    }
  } catch { /* fall through */ }
  return 1;
}

// Fill in fields that may be missing on projects saved before the schema gained them.
function migrate(project: Project): Project {
  return {
    ...project,
    layers: project.layers.map((l) => {
      const legacyMode = (l as unknown as { blendMode?: string }).blendMode;
      const blendMode = legacyMode === 'mask' ? 'intersect'
        : (legacyMode === 'normal' || legacyMode === 'intersect' || legacyMode === 'exclude')
          ? legacyMode
          : 'normal';
      let pattern = l.pattern;
      // SVG layer schema changed: width/height → uniform scale, plus tile mode.
      if (pattern.kind === 'svg') {
        const old = pattern.params as unknown as Record<string, unknown>;
        const scale = typeof old.scale === 'number' ? old.scale
          : (typeof old.width === 'number' && typeof old.height === 'number'
            ? readScaleFromLegacy(old.svgText as string, old.width as number)
            : 1);
        pattern = {
          kind: 'svg',
          params: {
            svgText: (old.svgText as string) ?? '',
            scale,
            rotation: (old.rotation as number) ?? 0,
            strokeWidth: (old.strokeWidth as number) ?? 0.3,
            forceStroke: (old.forceStroke as boolean) ?? true,
            tile: (old.tile as boolean) ?? false,
            tileSpacingX: (old.tileSpacingX as number) ?? 0,
            tileSpacingY: (old.tileSpacingY as number) ?? 0,
          },
        };
      }
      // Text: textToPath moved from a global export option to a per-layer flag.
      // Default to true so engraving-ready outlines are the norm.
      if (pattern.kind === 'text') {
        const old = pattern.params as unknown as Record<string, unknown>;
        // Legacy x/y get folded into the layer offset so the text stays put.
        const legacyX = typeof old.x === 'number' ? old.x : 0;
        const legacyY = typeof old.y === 'number' ? old.y : 0;
        pattern = {
          kind: 'text',
          params: {
            content: (old.content as string) ?? '',
            fontFamily: (old.fontFamily as string) ?? 'Noto Sans',
            sizeMm: (old.sizeMm as number) ?? 15,
            rotation: (old.rotation as number) ?? 0,
            align: (old.align as 'start' | 'middle' | 'end') ?? 'middle',
            strokeWidth: (old.strokeWidth as number) ?? 0.3,
            textToPath: (old.textToPath as boolean) ?? true,
          },
        };
        // Stash the legacy offsets on the layer record below.
        (l as unknown as { __legacyTextX?: number; __legacyTextY?: number }).__legacyTextX = legacyX;
        (l as unknown as { __legacyTextX?: number; __legacyTextY?: number }).__legacyTextY = legacyY;
      }
      // Frieze: y → mirrorOffsetY. The old `y` was the centerline absolute
      // position; we drop it (layer-level offsetY positions the whole strip).
      if (pattern.kind === 'frieze') {
        const old = pattern.params as unknown as Record<string, unknown>;
        pattern = {
          kind: 'frieze',
          params: {
            variant: (old.variant as 'wave' | 'greek' | 'braid' | 'crenel') ?? 'wave',
            period: (old.period as number) ?? 20,
            amplitude: (old.amplitude as number) ?? 5,
            strokeWidth: (old.strokeWidth as number) ?? 0.3,
            offsetX: (old.offsetX as number) ?? 0,
            mirror: (old.mirror as boolean) ?? false,
            mirrorOffsetY: (old.mirrorOffsetY as number) ?? 0,
          },
        };
      }
      // Maze schema changed — old fields (obstacle*, zoneX/Y, morph*, multi-style) are dropped.
      if (pattern.kind === 'maze') {
        const old = pattern.params as unknown as Record<string, unknown>;
        const style = old.style === 'rounded' ? 'rounded' : 'square';
        pattern = {
          kind: 'maze',
          params: {
            cellSize: (old.cellSize as number) ?? 4,
            strokeWidth: (old.strokeWidth as number) ?? 0.3,
            style,
            cellShape: (old.cellShape === 'hex' ? 'hex' : 'square'),
            organicAmount: (old.organicAmount as number) ?? (old.morphAmount as number) ?? 0,
            vertexPerturb: (old.vertexPerturb as number) ?? 1,
            wallCurve: (old.wallCurve as number) ?? 1,
            noiseScale: (old.noiseScale as number) ?? 4,
            noiseOctaves: (old.noiseOctaves as number) ?? 1,
            noiseEvolution: (old.noiseEvolution as number) ?? 0,
            vertexSmooth: (old.vertexSmooth as number) ?? 0,
            deformBorders: (old.deformBorders as boolean) ?? false,
            seed: (old.seed as number) ?? 1,
            zoneWidth: ((old.zoneWidth as number) && (old.zoneWidth as number) > 0
              ? (old.zoneWidth as number)
              : project.canvas.width),
            zoneHeight: ((old.zoneHeight as number) && (old.zoneHeight as number) > 0
              ? (old.zoneHeight as number)
              : project.canvas.height),
          },
        };
      }
      // Geometric: drop the margin field, use a zone matching canvas instead.
      if (pattern.kind === 'geometric') {
        const old = pattern.params as unknown as Record<string, unknown>;
        pattern = {
          kind: 'geometric',
          params: {
            variant: (old.variant as 'lines' | 'grid' | 'chevrons' | 'lattice' | 'dots') ?? 'lines',
            spacing: (old.spacing as number) ?? 4,
            angle: (old.angle as number) ?? 45,
            strokeWidth: (old.strokeWidth as number) ?? 0.2,
            zoneWidth: (old.zoneWidth as number) ?? project.canvas.width,
            zoneHeight: (old.zoneHeight as number) ?? project.canvas.height,
          },
        };
      }
      // Scatter: persist custom shape inline; add zone.
      if (pattern.kind === 'scatter') {
        const old = pattern.params as unknown as Record<string, unknown>;
        const oldShape = old.shape as string;
        const validShapes = ['star', 'flower', 'rune', 'circle', 'custom'] as const;
        const shape = oldShape && oldShape.startsWith('custom:') ? 'custom'
          : (validShapes as readonly string[]).includes(oldShape)
            ? oldShape : 'star';
        pattern = {
          kind: 'scatter',
          params: {
            shape: shape as 'star' | 'flower' | 'rune' | 'circle' | 'custom',
            customSvg: (old.customSvg as string) ?? '',
            customForceStroke: (old.customForceStroke as boolean) ?? true,
            density: (old.density as number) ?? 5,
            minSize: (old.minSize as number) ?? 2,
            maxSize: (old.maxSize as number) ?? 4,
            rotationJitter: (old.rotationJitter as number) ?? 45,
            seed: (old.seed as number) ?? 1,
            strokeWidth: (old.strokeWidth as number) ?? 0.2,
            zoneWidth: (old.zoneWidth as number) ?? project.canvas.width,
            zoneHeight: (old.zoneHeight as number) ?? project.canvas.height,
          },
        };
      }
      const anyL = l as unknown as {
        grow?: number; gradient?: unknown; mods?: unknown;
        __legacyTextX?: number; __legacyTextY?: number;
      };
      const gradient = (anyL.gradient as Layer['gradient']) ?? { enabled: false, angle: 0, t0: 0, t1: 1 };
      const mods = (anyL.mods as Layer['mods']) ?? {};
      // Strip the deprecated softEdges so it doesn't linger in re-exported JSON.
      const { softEdges: _drop, ...lRest } = l as unknown as { softEdges?: number } & Layer;
      void _drop;
      // Fold legacy text x/y into the layer offset so existing projects keep
      // their text in place after the schema change.
      const offsetX = (l.offsetX ?? 0) + (anyL.__legacyTextX ?? 0);
      const offsetY = (l.offsetY ?? 0) + (anyL.__legacyTextY ?? 0);
      delete anyL.__legacyTextX;
      delete anyL.__legacyTextY;
      return {
        ...lRest,
        blendMode,
        offsetX,
        offsetY,
        grow: anyL.grow ?? 0,
        gradient,
        mods,
        pattern,
      };
    }),
  };
}

export function loadProject(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProject();
    const obj = JSON.parse(raw);
    if (obj && obj.version === 1) return migrate(obj as Project);
  } catch { /* fall through */ }
  return defaultProject();
}

export function attachAutosave(store: Store): void {
  let t: number | undefined;
  store.subscribe((p) => {
    if (t !== undefined) window.clearTimeout(t);
    t = window.setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* quota errors are ignored */ }
    }, DEBOUNCE_MS);
  });
}

export function exportProjectJson(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(project.name || 'project').replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importProjectJson(file: File, store: Store): Promise<void> {
  return file.text().then((txt) => {
    const obj = JSON.parse(txt);
    if (!obj || obj.version !== 1) throw new Error('Unsupported project version');
    store.set(migrate(obj as Project));
  });
}
