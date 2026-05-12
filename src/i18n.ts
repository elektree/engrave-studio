// Display-only French translations. Internal keys (pattern.kind, variant, shape, align…)
// stay in English so the data model and JSON files remain stable.

const FR: Record<string, string> = {
  // Pattern kinds
  geometric: 'géométrique',
  frieze: 'frise',
  scatter: 'parsemé',
  text: 'texte',
  maze: 'labyrinthe',
  shape: 'forme',
  svg: 'SVG',

  // Shape kinds
  rect: 'rectangle',
  ellipse: 'ellipse',

  // Maze stroke styles & cell shapes
  square: 'carré',
  rounded: 'arrondi',
  hex: 'hexagone',
  // Legacy style names (kept so old project files still display sensibly post-migration)
  box: 'carré',
  organic: 'organique',
  zigzag: 'zigzag',
  sketch: 'esquisse',
  circles: 'cercles',

  // Geometric variants
  lines: 'lignes',
  grid: 'grille',
  chevrons: 'chevrons',
  lattice: 'treillis',
  dots: 'points',

  // Frieze variants
  wave: 'vague',
  greek: 'grecque',
  braid: 'tresse',
  crenel: 'créneau',

  // Scatter shapes
  star: 'étoile',
  flower: 'fleur',
  rune: 'rune',
  circle: 'cercle',
  custom: 'personnalisé',

  // Text alignment
  start: 'début',
  middle: 'milieu',
  end: 'fin',

  // Blend modes (used in layers panel badge)
  normal: 'normal',
  mask: 'masque',
};

export function tr(key: string): string {
  return FR[key] ?? key;
}
