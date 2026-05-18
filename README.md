# Engrave Pattern Generator

Browser tool to combine procedural patterns, vector art and text into a laser-ready SVG for engraving on leather belts (or any flat strip).

Live build: deployed to GitHub Pages on every push to `main`.

## Quick start

    npm install
    npm run dev

Open the URL Vite prints. Add layers from the left panel, tweak parameters on the right, drag and edit on the canvas.

## Layer types

- **Geometric** — tiled motifs (lines, grids, etc.).
- **Frieze** — repeating waves and bands, with optional mirror.
- **Maze** — generated mazes.
- **Scatter** — Poisson-disk distribution of a chosen shape (built-in or custom SVG), with size, rotation and density jitter.
- **Shape** — single parametric shape from the registry.
- **SVG** — imported SVG, repainted per-element (each path's source colour drives a luminance → depth remap and snaps to the palette; the `outlined` flag forces every element to a stroke).
- **Bezier** — pen-tool (click to add anchor, drag for handles) plus an edit mode to move/insert/delete points and toggle smooth/corner handles.
- **Text** — flattened to paths via opentype.js on export.

## Laser-aware pipeline

The exported SVG is in millimetres, stroke-only, grouped by palette colour (`<g id="depth-{name}" stroke="#…">`). LightBurn / RDWorks reads each group as one laser operation (power, speed, passes).

- **Palette**: edit via *Palette…* in the header. Default 5 entries (effleurage → découpe). Each layer's *Profondeur* slider snaps to a palette entry — a coloured badge in the right panel shows which one.
- **Kerf**: beam width in mm, set in the header (default `0.12`). Strokes wider than kerf are materialised as parallel hatches at export; fills become zigzags.

## Aperçu (material preview)

A dropdown in the header switches between **Édition** (chrome-on canvas with rulers, handles, guides) and **Aperçu — {material}**, which renders the design directly on a realistic backdrop with a per-material burn ramp:

- Cuir
- Bois clair
- Bois foncé
- Papier kraft
- Métal anodisé (inverse ramp — the laser exposes lighter aluminium under the dark coating)

Each material remaps the palette colours to the burnt-tone appearance you'd get on that substrate, so you can sanity-check contrast before cutting.

## Output

Output SVG: millimetres (`width="…mm" height="…mm"`), stroke-only, grouped by palette colour. Text is flattened to paths via opentype.js. Drop it into LightBurn or RDWorks and assign laser operations per colour group.

## Notes

- Bundled font for `text → path` is **Noto Sans Regular** (Apache-2.0) at `public/fonts/NotoSans-Regular.ttf`.
- LocalStorage autosaves your project. Use the 💾 / 📂 buttons in the header to export/import the JSON.
- Project schema is `version: 2`. Older files (unversioned or `version: 1`, pre laser-aware refactor) are rejected — start a new project.
