import opentype from 'opentype.js';

// Runtime-only registry of user-uploaded fonts. Each entry caches both the
// opentype.js parse (for laser-export text→path conversion) and the raw bytes
// used to register a CSS @font-face via the FontFace API (for preview).

type Entry = { family: string; font: opentype.Font };

const custom = new Map<string, Entry>();
const subscribers = new Set<() => void>();

function readFamily(font: opentype.Font): string {
  const names = font.names as unknown as Record<string, Record<string, string>>;
  const fam = names.fontFamily ?? names.preferredFamily;
  if (!fam) return 'Police';
  return fam.en ?? Object.values(fam)[0] ?? 'Police';
}

export async function registerCustomFont(bytes: ArrayBuffer): Promise<string> {
  const font = opentype.parse(bytes);
  const family = readFamily(font);
  custom.set(family, { family, font });
  const ff = new FontFace(family, bytes);
  await ff.load();
  (document as unknown as { fonts: FontFaceSet }).fonts.add(ff);
  subscribers.forEach((s) => s());
  return family;
}

export function getCustomFontFamilies(): string[] {
  return Array.from(custom.keys()).sort((a, b) => a.localeCompare(b));
}

export function getCustomFont(family: string): opentype.Font | null {
  return custom.get(family)?.font ?? null;
}

export function subscribeFontRegistry(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
