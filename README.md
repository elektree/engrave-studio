# Engrave Pattern Generator

Browser tool to combine procedural patterns and text into an SVG pattern for laser-engraving leather belts.

## Quick start

    npm install
    npm run dev

Open the URL Vite prints. Add layers from the left panel, tweak parameters on the right, export with "Export SVG" in the header.

## Output

The exported SVG is in millimetres (`width="1100mm" height="35mm"`), stroke-only by default, with text flattened to paths via opentype.js. Import directly into LightBurn or RDWorks.

## Notes

- The bundled font for `text→path` is **Noto Sans Regular** (Apache-2.0). Add the file at `public/fonts/NotoSans-Regular.ttf` before exporting text.
- LocalStorage autosaves your project. Use the JSON ↑↓ buttons in the header to share presets.
