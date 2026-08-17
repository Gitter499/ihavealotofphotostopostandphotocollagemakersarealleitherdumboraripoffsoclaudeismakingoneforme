// Classic fixed layouts, the counterpart to the automatic BSP engine.
// A template pins a slide's geometry: one cell per photo, in reading order,
// in fraction-of-canvas coordinates. `rot` (degrees) leans a cell — that's
// how the polaroid scatters work — and scattered cells may overlap: later
// cells draw on top, like prints tossed on a table.
//
// { id, name, count, cells: [{x, y, w, h, rot?}], loose?: true }
// `loose` templates keep their own breathing room, so the gutter inset is
// skipped and photos get a paper-white edge instead.

const T = []
const add = (id, name, count, cells, extra = {}) => T.push({ id, name, count, cells, ...extra })

// ---- one photo ----
add('full', 'Full Bleed', 1, [{ x: 0, y: 0, w: 1, h: 1 }])
add('letterbox', 'Letterbox', 1, [{ x: 0, y: 0.22, w: 1, h: 0.56 }])
add('polaroid1', 'Polaroid', 1, [{ x: 0.14, y: 0.16, w: 0.72, h: 0.62, rot: -2.5 }], { loose: true })

// ---- two ----
add('split-v', 'Half & Half', 2, [
  { x: 0, y: 0, w: 0.5, h: 1 },
  { x: 0.5, y: 0, w: 0.5, h: 1 },
])
add('split-h', 'Stacked', 2, [
  { x: 0, y: 0, w: 1, h: 0.5 },
  { x: 0, y: 0.5, w: 1, h: 0.5 },
])
add('hero-left-2', 'Hero Left', 2, [
  { x: 0, y: 0, w: 0.66, h: 1 },
  { x: 0.66, y: 0, w: 0.34, h: 1 },
])
add('hero-top-2', 'Big Sky', 2, [
  { x: 0, y: 0, w: 1, h: 0.66 },
  { x: 0, y: 0.66, w: 1, h: 0.34 },
])
add('toss-2', 'Polaroid Toss', 2, [
  { x: 0.06, y: 0.1, w: 0.55, h: 0.5, rot: -4 },
  { x: 0.42, y: 0.42, w: 0.55, h: 0.5, rot: 3 },
], { loose: true })

// ---- three ----
add('triptych', 'Triptych', 3, [
  { x: 0, y: 0, w: 1 / 3, h: 1 },
  { x: 1 / 3, y: 0, w: 1 / 3, h: 1 },
  { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
])
add('ladder', 'Ladder', 3, [
  { x: 0, y: 0, w: 1, h: 1 / 3 },
  { x: 0, y: 1 / 3, w: 1, h: 1 / 3 },
  { x: 0, y: 2 / 3, w: 1, h: 1 / 3 },
])
add('hero-left-3', 'Hero + Pair', 3, [
  { x: 0, y: 0, w: 0.62, h: 1 },
  { x: 0.62, y: 0, w: 0.38, h: 0.5 },
  { x: 0.62, y: 0.5, w: 0.38, h: 0.5 },
])
add('hero-top-3', 'Marquee', 3, [
  { x: 0, y: 0, w: 1, h: 0.62 },
  { x: 0, y: 0.62, w: 0.5, h: 0.38 },
  { x: 0.5, y: 0.62, w: 0.5, h: 0.38 },
])
add('filmstrip-3', 'Filmstrip', 3, [
  { x: 0.02, y: 0.3, w: 0.32, h: 0.4 },
  { x: 0.34, y: 0.3, w: 0.32, h: 0.4 },
  { x: 0.66, y: 0.3, w: 0.32, h: 0.4 },
])
add('toss-3', 'Polaroid Toss', 3, [
  { x: 0.04, y: 0.05, w: 0.52, h: 0.42, rot: -5 },
  { x: 0.44, y: 0.28, w: 0.52, h: 0.42, rot: 4 },
  { x: 0.18, y: 0.54, w: 0.52, h: 0.42, rot: -2 },
], { loose: true })

// ---- four ----
add('grid-2x2', 'Quad', 4, [
  { x: 0, y: 0, w: 0.5, h: 0.5 },
  { x: 0.5, y: 0, w: 0.5, h: 0.5 },
  { x: 0, y: 0.5, w: 0.5, h: 0.5 },
  { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
])
add('hero-rail-4', 'Hero + Rail', 4, [
  { x: 0, y: 0, w: 0.68, h: 1 },
  { x: 0.68, y: 0, w: 0.32, h: 1 / 3 },
  { x: 0.68, y: 1 / 3, w: 0.32, h: 1 / 3 },
  { x: 0.68, y: 2 / 3, w: 0.32, h: 1 / 3 },
])
add('hero-base-4', 'Skyline', 4, [
  { x: 0, y: 0, w: 1, h: 0.64 },
  { x: 0, y: 0.64, w: 1 / 3, h: 0.36 },
  { x: 1 / 3, y: 0.64, w: 1 / 3, h: 0.36 },
  { x: 2 / 3, y: 0.64, w: 1 / 3, h: 0.36 },
])
add('columns-4', 'Pillars', 4, [
  { x: 0, y: 0, w: 0.25, h: 1 },
  { x: 0.25, y: 0, w: 0.25, h: 1 },
  { x: 0.5, y: 0, w: 0.25, h: 1 },
  { x: 0.75, y: 0, w: 0.25, h: 1 },
])
add('magazine-4', 'Magazine', 4, [
  { x: 0, y: 0, w: 0.62, h: 0.62 },
  { x: 0.62, y: 0, w: 0.38, h: 0.62 },
  { x: 0, y: 0.62, w: 0.38, h: 0.38 },
  { x: 0.38, y: 0.62, w: 0.62, h: 0.38 },
])
add('toss-4', 'Polaroid Toss', 4, [
  { x: 0.03, y: 0.03, w: 0.48, h: 0.38, rot: -5 },
  { x: 0.5, y: 0.08, w: 0.48, h: 0.38, rot: 3.5 },
  { x: 0.06, y: 0.5, w: 0.48, h: 0.38, rot: 2.5 },
  { x: 0.47, y: 0.55, w: 0.48, h: 0.38, rot: -3 },
], { loose: true })

// ---- five ----
add('quilt-5', 'Quilt', 5, [
  { x: 0, y: 0, w: 0.5, h: 0.5 },
  { x: 0.5, y: 0, w: 0.5, h: 0.5 },
  { x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
  { x: 0, y: 0.5, w: 0.5, h: 0.5 },
  { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
])
add('hero-quad-5', 'Hero + Quad', 5, [
  { x: 0, y: 0, w: 1, h: 0.6 },
  { x: 0, y: 0.6, w: 0.25, h: 0.4 },
  { x: 0.25, y: 0.6, w: 0.25, h: 0.4 },
  { x: 0.5, y: 0.6, w: 0.25, h: 0.4 },
  { x: 0.75, y: 0.6, w: 0.25, h: 0.4 },
])
add('rows-23', 'Two & Three', 5, [
  { x: 0, y: 0, w: 0.5, h: 0.55 },
  { x: 0.5, y: 0, w: 0.5, h: 0.55 },
  { x: 0, y: 0.55, w: 1 / 3, h: 0.45 },
  { x: 1 / 3, y: 0.55, w: 1 / 3, h: 0.45 },
  { x: 2 / 3, y: 0.55, w: 1 / 3, h: 0.45 },
])
add('spine-5', 'Spine', 5, [
  { x: 0.3, y: 0, w: 0.4, h: 1 },
  { x: 0, y: 0, w: 0.3, h: 0.5 },
  { x: 0, y: 0.5, w: 0.3, h: 0.5 },
  { x: 0.7, y: 0, w: 0.3, h: 0.5 },
  { x: 0.7, y: 0.5, w: 0.3, h: 0.5 },
])
add('toss-5', 'Polaroid Toss', 5, [
  { x: 0.02, y: 0.02, w: 0.44, h: 0.34, rot: -5 },
  { x: 0.52, y: 0.04, w: 0.44, h: 0.34, rot: 4 },
  { x: 0.26, y: 0.32, w: 0.46, h: 0.36, rot: -1.5 },
  { x: 0.02, y: 0.62, w: 0.44, h: 0.34, rot: 3 },
  { x: 0.52, y: 0.6, w: 0.44, h: 0.34, rot: -3.5 },
], { loose: true })

// ---- six ----
add('grid-2x3', 'Six Pack', 6, [
  { x: 0, y: 0, w: 0.5, h: 1 / 3 },
  { x: 0.5, y: 0, w: 0.5, h: 1 / 3 },
  { x: 0, y: 1 / 3, w: 0.5, h: 1 / 3 },
  { x: 0.5, y: 1 / 3, w: 0.5, h: 1 / 3 },
  { x: 0, y: 2 / 3, w: 0.5, h: 1 / 3 },
  { x: 0.5, y: 2 / 3, w: 0.5, h: 1 / 3 },
])
add('grid-3x2', 'Contact Sheet', 6, [
  { x: 0, y: 0, w: 1 / 3, h: 0.5 },
  { x: 1 / 3, y: 0, w: 1 / 3, h: 0.5 },
  { x: 2 / 3, y: 0, w: 1 / 3, h: 0.5 },
  { x: 0, y: 0.5, w: 1 / 3, h: 0.5 },
  { x: 1 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
  { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
])
add('hero-five-6', 'Hero + Five', 6, [
  { x: 0, y: 0, w: 0.6, h: 0.6 },
  { x: 0.6, y: 0, w: 0.4, h: 0.3 },
  { x: 0.6, y: 0.3, w: 0.4, h: 0.3 },
  { x: 0, y: 0.6, w: 1 / 3, h: 0.4 },
  { x: 1 / 3, y: 0.6, w: 1 / 3, h: 0.4 },
  { x: 2 / 3, y: 0.6, w: 1 / 3, h: 0.4 },
])
add('magazine-6', 'Editorial', 6, [
  { x: 0, y: 0, w: 0.66, h: 0.44 },
  { x: 0.66, y: 0, w: 0.34, h: 0.44 },
  { x: 0, y: 0.44, w: 0.34, h: 0.28 },
  { x: 0.34, y: 0.44, w: 0.66, h: 0.28 },
  { x: 0, y: 0.72, w: 0.5, h: 0.28 },
  { x: 0.5, y: 0.72, w: 0.5, h: 0.28 },
])

// ---- seven ----
add('hero-six-7', 'Hero + Six', 7, [
  { x: 0, y: 0, w: 1, h: 0.5 },
  { x: 0, y: 0.5, w: 1 / 3, h: 0.25 },
  { x: 1 / 3, y: 0.5, w: 1 / 3, h: 0.25 },
  { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.25 },
  { x: 0, y: 0.75, w: 1 / 3, h: 0.25 },
  { x: 1 / 3, y: 0.75, w: 1 / 3, h: 0.25 },
  { x: 2 / 3, y: 0.75, w: 1 / 3, h: 0.25 },
])
add('quilt-7', 'Patchwork', 7, [
  { x: 0, y: 0, w: 0.38, h: 0.38 },
  { x: 0.38, y: 0, w: 0.62, h: 0.38 },
  { x: 0, y: 0.38, w: 0.62, h: 0.31 },
  { x: 0.62, y: 0.38, w: 0.38, h: 0.31 },
  { x: 0, y: 0.69, w: 0.31 , h: 0.31 },
  { x: 0.31, y: 0.69, w: 0.31, h: 0.31 },
  { x: 0.62, y: 0.69, w: 0.38, h: 0.31 },
])

// ---- eight ----
add('grid-2x4', 'Octet', 8, [
  { x: 0, y: 0, w: 0.5, h: 0.25 },
  { x: 0.5, y: 0, w: 0.5, h: 0.25 },
  { x: 0, y: 0.25, w: 0.5, h: 0.25 },
  { x: 0.5, y: 0.25, w: 0.5, h: 0.25 },
  { x: 0, y: 0.5, w: 0.5, h: 0.25 },
  { x: 0.5, y: 0.5, w: 0.5, h: 0.25 },
  { x: 0, y: 0.75, w: 0.5, h: 0.25 },
  { x: 0.5, y: 0.75, w: 0.5, h: 0.25 },
])
add('hero-seven-8', 'Centerpiece', 8, [
  { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
  { x: 0, y: 0, w: 0.25, h: 0.5 },
  { x: 0.25, y: 0, w: 0.5, h: 0.25 },
  { x: 0.75, y: 0, w: 0.25, h: 0.5 },
  { x: 0.75, y: 0.5, w: 0.25, h: 0.5 },
  { x: 0.25, y: 0.75, w: 0.5, h: 0.25 },
  { x: 0, y: 0.5, w: 0.25, h: 0.5 },
  { x: 0.375, y: 0.375, w: 0.25, h: 0.25 },
])

export const TEMPLATES = T

export function templatesFor(count) {
  return TEMPLATES.filter((t) => t.count === count)
}

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) ?? null
}

// Map a template's fractional cells onto the slide canvas. Regular templates
// share the BSP margin/gutter treatment so the two engines compose the same;
// loose (scatter) templates only respect the outer margin and keep their
// rotation, expressed in radians on the rect.
export function templateRects(tpl, { canvasW, canvasH, margin, gutter }) {
  const g = tpl.loose ? 0 : gutter
  const work = {
    x: margin - g / 2,
    y: margin - g / 2,
    w: canvasW - 2 * margin + g,
    h: canvasH - 2 * margin + g,
  }
  return tpl.cells.map((c) => ({
    x: work.x + c.x * work.w + g / 2,
    y: work.y + c.y * work.h + g / 2,
    w: c.w * work.w - g,
    h: c.h * work.h - g,
    ...(c.rot ? { rot: (c.rot * Math.PI) / 180 } : {}),
    ...(tpl.loose ? { frame: true } : {}),
  }))
}
