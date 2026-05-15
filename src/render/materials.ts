import type { PaletteEntry } from '../state/project';

// Material presets for the chrome-free "Aperçu" mode. Each material maps to:
//  - a background colour (the visible material itself),
//  - a 5-stop ramp matching real-world laser appearance on that material,
//    sampled by palette entry `.value`. Light touches sit at the low end,
//    cut-through at the high end.
// Note: anodised metal is the only "inverse" preset — laser etching reveals
// lighter aluminium underneath the dark coating, so its ramp goes from dark
// to light instead of light to dark.

export type MaterialId =
  | 'cuir'
  | 'bois-clair'
  | 'bois-fonce'
  | 'papier-kraft'
  | 'metal-anodise';

export const MATERIAL_LABELS: Record<MaterialId, string> = {
  'cuir':          'Cuir',
  'bois-clair':    'Bois clair',
  'bois-fonce':    'Bois foncé',
  'papier-kraft':  'Papier kraft',
  'metal-anodise': 'Métal anodisé',
};

export const MATERIAL_BG: Record<MaterialId, string> = {
  'cuir':          '#b08866',  // natural tan
  'bois-clair':    '#d4b48a',  // pine / birch
  'bois-fonce':    '#5a3a1c',  // walnut / stained oak
  'papier-kraft':  '#c6a986',  // unbleached kraft
  'metal-anodise': '#1a1a1a',  // black anodised aluminium
};

const RAMPS: Record<MaterialId, string[]> = {
  'cuir':          ['#a17a55', '#8a6440', '#6a4928', '#3e2814', '#1a0e07'],
  'bois-clair':    ['#c2a075', '#a87f50', '#7a5530', '#4a2f1a', '#231308'],
  // Dark wood stays dark; engraved areas only get a touch deeper to stay
  // legible against the already-dark base.
  'bois-fonce':    ['#503320', '#3e2616', '#2a190d', '#1a0e07', '#0a0503'],
  'papier-kraft':  ['#a08560', '#7a5e3a', '#4f3a1f', '#2a1e10', '#100805'],
  // Inverse ramp — etching reveals lighter aluminium.
  'metal-anodise': ['#3a3a3a', '#5a5a5a', '#8a8a8a', '#bbbbbb', '#e0e0e0'],
};

export function materialPalette(material: MaterialId, palette: PaletteEntry[]): PaletteEntry[] {
  const ramp = RAMPS[material];
  return palette.map((e) => {
    const t = Math.max(0, Math.min(1, e.value));
    const idx = Math.round(t * (ramp.length - 1));
    return { ...e, color: ramp[idx] };
  });
}

export const MATERIAL_IDS: MaterialId[] = ['cuir', 'bois-clair', 'bois-fonce', 'papier-kraft', 'metal-anodise'];
