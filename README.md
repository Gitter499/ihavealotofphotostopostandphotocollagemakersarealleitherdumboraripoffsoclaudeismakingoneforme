# Photo Dump → Instagram Carousel

Drop an unsorted pile of photos in, get a numbered set of finished Instagram
carousel slides out. Each slide is its own complete collage — nothing is
sliced across slide boundaries. No photo limit, no watermark, no account,
no upload: photos never leave the browser.

Every existing tool either makes one giant collage image (no carousel) or
caps you at ~20 photos behind a paywall. This does auto-layout of 30+ photos
into multiple complete slides, which is the whole point.

## Use

```
npm install
npm run dev        # local dev server
npm run build      # production build in dist/ — any static host works
```

Then: drop photos → wait a moment → **Download all** → select all the
numbered JPEGs in Instagram and post. Files are named `01.jpg`, `02.jpg`, …
so upload order is unambiguous.

## How it works

1. **Order** — EXIF `DateTimeOriginal` (via `exifr`), falling back to
   filename, then file order. A photo dump has an implicit narrative;
   chronology preserves it for free.
2. **Group** — balanced slides of 4–8 photos (target set by a slider,
   default 6), with neighbour-only swaps to mix portrait/landscape per slide
   without wrecking chronology. Slide count grows with the dump — 30 photos
   → 5 slides, 100 → 17 — up to Instagram's 20-slide carousel limit.
3. **Lay out** — recursive binary space partitioning on a 1080×1350 canvas,
   split direction/position weighted by the aspect ratios of the photos
   assigned to each side, then per-node refinement to minimise crop loss.
   A photo that would lose more than ~35% of its area to the crop triggers a
   retry with a different seed; the best-scoring attempt wins.
4. **Export** — offscreen canvas at full 1080×1350 (or 1080×1080), JPEG
   quality 0.92, zipped with JSZip.

Imports are decoded, EXIF-read, and downscaled (max 2160px long edge) in a
Web Worker pool so a 200-photo dump doesn't freeze the tab. Only small
preview bitmaps stay resident; full-quality pixels are re-decoded per slide
at export time, keeping memory flat at any photo count. HEIC decodes
natively where the browser supports it (Safari) and falls back to a bundled
libheif (heic2any) elsewhere. Everything the app can ever need is fetched at
page load — zero network requests afterwards.

## Controls

Everything has a working default — the app produces a finished result before
you touch anything. Shuffle (per-slide and all), photos per slide, gutter
width, background (near-black / off-white / sampled from the photos),
aspect ratio (4:5 or 1:1), drag a slide header to reorder slides, drag a
photo onto another slide to move it (press-and-hold on touch).

## Tests

```
npm test           # unit tests: sorting, grouping, balancing, BSP geometry
npm run test:e2e   # headless-browser test: 30 photos → 5 slides → verified zip
```

## Agent testing (MCP)

`.mcp.json` configures the [Playwright MCP server](https://github.com/microsoft/playwright-mcp)
(installed as a dev dependency) so an AI agent working in this repo can
drive a real browser against the app — navigate, click, drag, fill, take
screenshots, and inspect them — including coordinate-based vision tools
(`--caps vision`). Run `npm run build`, serve `dist/`, and point the browser
tools at it.

The config pins `--executable-path /opt/pw-browsers/chromium` for the
remote dev container this repo is developed in; on a machine with standard
Playwright browsers installed, drop that flag.
