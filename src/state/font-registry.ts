import opentype from 'opentype.js';

// Runtime registry of user-uploaded fonts. Mirrored to localStorage as base64
// blobs so they survive a refresh.

type Entry = { family: string; font: opentype.Font };

const STORAGE_KEY = 'engrave-pattern-generator:fonts';
const custom = new Map<string, Entry>();
const subscribers = new Set<() => void>();

function readFamily(font: opentype.Font): string {
  const names = font.names as unknown as Record<string, Record<string, string>>;
  const fam = names.fontFamily ?? names.preferredFamily;
  if (!fam) return 'Police';
  return fam.en ?? Object.values(fam)[0] ?? 'Police';
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  // Chunked to avoid blowing the call stack on big fonts (apply-args limit).
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function readStored(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return typeof v === 'object' && v !== null ? v : {};
  } catch { return {}; }
}

function writeStored(family: string, b64: string): void {
  try {
    const cur = readStored();
    cur[family] = b64;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cur));
  } catch (e) {
    console.warn(`Failed to persist font "${family}":`, e);
  }
}

export async function registerCustomFont(bytes: ArrayBuffer, persist = true): Promise<string> {
  const font = opentype.parse(bytes);
  const family = readFamily(font);
  custom.set(family, { family, font });
  const ff = new FontFace(family, bytes);
  await ff.load();
  (document as unknown as { fonts: FontFaceSet }).fonts.add(ff);
  if (persist) writeStored(family, arrayBufferToBase64(bytes));
  subscribers.forEach((s) => s());
  return family;
}

// Replays every stored font through the registration path on app boot, so
// `<text font-family="…">` resolves to the right glyphs from the first render.
export async function loadStoredFonts(): Promise<void> {
  const stored = readStored();
  for (const [family, b64] of Object.entries(stored)) {
    try {
      const bytes = base64ToArrayBuffer(b64);
      await registerCustomFont(bytes, false);
    } catch (e) {
      console.warn(`Failed to restore stored font "${family}":`, e);
    }
  }
}

export function getCustomFontFamilies(): string[] {
  return Array.from(custom.keys()).sort((a, b) => a.localeCompare(b));
}

export function getCustomFont(family: string): opentype.Font | null {
  return custom.get(family)?.font ?? null;
}

// Noto Sans is shipped as a static asset rather than a custom upload. Cache
// the parsed opentype.Font so both export and preview vectorisation can resolve
// it synchronously after the first fetch.
let notoSans: opentype.Font | null = null;
let notoPromise: Promise<opentype.Font> | null = null;

export function getNotoSans(): opentype.Font | null {
  return notoSans;
}

export function ensureNotoSans(): Promise<opentype.Font> {
  if (notoSans) return Promise.resolve(notoSans);
  if (!notoPromise) {
    const url = `${import.meta.env.BASE_URL}fonts/NotoSans-Regular.ttf`;
    notoPromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load ${url}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        notoSans = opentype.parse(buf);
        subscribers.forEach((s) => s());
        return notoSans;
      });
  }
  return notoPromise;
}

// Sync accessor used by renderers that want vectorised text without awaiting:
// returns a custom font if present, the cached Noto Sans, or null.
export function getFontSync(family: string): opentype.Font | null {
  const custom = getCustomFont(family);
  if (custom) return custom;
  if (family === 'Noto Sans') return getNotoSans();
  return null;
}

export function subscribeFontRegistry(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
