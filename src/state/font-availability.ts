// Probes browsers for which font families are actually available on the system.
// document.fonts.check() returns false for families that exist by name but
// would resolve to a fallback at paint time, so we use it to filter out fonts
// the user picked but can't actually see.

const cache = new Map<string, boolean>();
const subscribers = new Set<() => void>();
let pending: Promise<void> | null = null;

function fontsApi(): FontFaceSet | null {
  return (document as unknown as { fonts?: FontFaceSet }).fonts ?? null;
}

export function ensureFontsChecked(families: string[]): Promise<void> {
  const fonts = fontsApi();
  if (!fonts) return Promise.resolve();
  if (pending) return pending;
  pending = (async () => {
    await Promise.all(families.map(async (fam) => {
      if (cache.has(fam)) return;
      try {
        await fonts.load(`16px "${fam}"`);
      } catch { /* ignore */ }
      cache.set(fam, fonts.check(`16px "${fam}"`));
    }));
    subscribers.forEach((s) => s());
  })();
  return pending;
}

export function isFontAvailable(family: string): boolean {
  if (cache.has(family)) return cache.get(family)!;
  const fonts = fontsApi();
  if (!fonts) return true; // be permissive when API absent
  const live = fonts.check(`16px "${family}"`);
  cache.set(family, live);
  return live;
}

export function markFontAvailable(family: string): void {
  cache.set(family, true);
  subscribers.forEach((s) => s());
}

export function subscribeFontAvailability(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// Synchronously await a single font load (used before committing a selection
// so the SVG re-renders with the font already in document.fonts).
export async function loadFont(family: string): Promise<boolean> {
  const fonts = fontsApi();
  if (!fonts) return true;
  try {
    await fonts.load(`16px "${family}"`);
  } catch { /* ignore */ }
  const ok = fonts.check(`16px "${family}"`);
  cache.set(family, ok);
  return ok;
}
