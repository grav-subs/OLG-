# Digital Calligraphy Studio

A vector calligraphy and lettering tool in the browser — brush and bezier-pen
drawing rendered live with [p5.js](https://p5js.org/), backed by real vector
geometry (editable anchors and bezier control points, not raster pixels).

## Features

- **Brush** — freehand strokes, auto-converted to a smooth editable bezier
  path on release.
- **Bezier Pen** — click to place anchors; paths auto-smooth as you go, click
  the start anchor to close a loop.
- **Direct Select / Edit** — drag anchors, control handles, or a whole stroke;
  marquee-select multiple anchors; rotate a stroke around its center.
- **Move (pan) and zoom** — drag to pan, scroll to zoom (centered on the
  cursor), `+`/`-`/`0` to zoom/reset. Zoom scales the actual drawing
  coordinate space, so strokes stay crisp vector redraws at any zoom level.
- **Simplify** — reduce a path's anchor count while preserving its shape
  (Ramer–Douglas–Peucker).
- **Smooth** — distance-weighted blending that smooths a path without
  flattening fine detail on tightly-packed or crossing strokes.
  Simplify and Smooth are both non-destructive: each stroke remembers its own
  amount, and either slider always recomputes from that stroke's original
  points, so dialing back to 0 exactly restores it.
- **Undo/redo** — steps a bezier path being placed one anchor at a time, and
  full strokes as single steps once committed.
- **Export** — SVG (editable control points), copy SVG source, or high-res PNG.

## Tech stack

React + TypeScript + Vite, [p5.js](https://p5js.org/) for the canvas,
[dialkit](https://github.com/joshpuckett/dialkit) for the tool sidebar,
[motion](https://motion.dev/) for UI animation, Tailwind for styling.

## Run locally

**Prerequisites:** Node.js

```bash
npm install
npm run dev
```
