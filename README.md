# Engrave Pattern Generator

Browser tool to combine procedural patterns and text into a laser-ready SVG for engraving on leather belts.

## Quick start

    npm install
    npm run dev

Open the URL Vite prints. Add layers from the left panel, tweak parameters on the right.

## Laser-aware workflow

The app outputs SVGs where each path is colored by **depth** — a per-layer value (0–1) that snaps to a user-editable palette. Each palette entry maps to a stroke color in the export, which LightBurn (or similar) translates to a laser operation (power, speed, passes).

- **Palette**: edit via "Palette…" in the header. Default 5 entries (effleurage → découpe).
- **Depth per layer**: each layer has a `Profondeur` slider in the right panel; a colored badge shows the snapped palette entry.
- **Kerf**: set the beam width (mm) in the header. Default 0.12.
- **Preview modes** (toggle in the header or press `L`):
  - **Design**: clean rendering, fast feedback.
  - **Laser**: simulates the real laser output — strokes wider than kerf are drawn as parallel hatches, fills as zigzags, mm ruler shown. Optional "Warnings hors-kerf" highlights features that will fuse or vanish.
- **SVG import**: imported SVGs can either use a single layer depth (`uniform`) or map source-color luminance to depth (`luminance`, with `invert` and `lumMin/lumMax` remap).

## Output

The exported SVG is in millimetres (`width="1100mm" height="35mm"`), grouped by palette color (`<g id="depth-{name}" stroke="#…">`), stroke-only, with text flattened to paths via opentype.js. Import directly into LightBurn or RDWorks; assign laser operations per color.

## Notes

- The bundled font for `text→path` is **Noto Sans Regular** (Apache-2.0). Add the file at `public/fonts/NotoSans-Regular.ttf` before exporting text.
- LocalStorage autosaves your project. Use the JSON ↑↓ buttons in the header to share presets.
- Projects from before the laser-aware refactor (`version: 1`) are not loaded — start a new project.
