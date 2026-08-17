// Unit tests for the pure algorithm modules (run with `npm test`).
import assert from 'node:assert/strict'
import {
  sortPhotos,
  planSizes,
  groupPhotos,
  balanceOrientations,
  hammingDistance,
  effectiveQualities,
  groupPhotosAuto,
  harmonizeColors,
  adjustGroupSize,
} from '../src/lib/grouping.js'
import { matrixFor, applyMatrix } from '../src/lib/filters.js'
import { tiltAngle } from '../src/lib/render.js'
import { computeLayout, cropLoss, MAX_CROP_LOSS } from '../src/lib/layout.js'
import { mulberry32 } from '../src/lib/rng.js'

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (err) {
    failures++
    console.error(`FAIL  ${name}`)
    console.error(err.message)
  }
}

// ---------- sorting ----------

test('sorts by EXIF date, then filename, then order', () => {
  const photos = [
    { id: 1, name: 'z.jpg', order: 0, date: 3000 },
    { id: 2, name: 'IMG_10.jpg', order: 1, date: null },
    { id: 3, name: 'a.jpg', order: 2, date: 1000 },
    { id: 4, name: 'IMG_2.jpg', order: 3, date: null },
  ]
  const sorted = sortPhotos(photos).map((p) => p.id)
  // dated first in date order, undated after, numeric filename order
  assert.deepEqual(sorted, [3, 1, 4, 2])
})

// ---------- slide planning ----------

test('30 photos at 6 per slide → 5 slides of 6', () => {
  const { sizes, notice } = planSizes(30, 6)
  assert.deepEqual(sizes, [6, 6, 6, 6, 6])
  assert.equal(notice, null)
})

test('remainder spreads — no orphan final slide', () => {
  const { sizes } = planSizes(37, 6)
  assert.equal(sizes.length, 7)
  assert.equal(sizes.reduce((a, b) => a + b, 0), 37)
  const min = Math.min(...sizes)
  const max = Math.max(...sizes)
  assert.ok(max - min <= 1, `unbalanced: ${sizes}`)
})

test('slide count scales past 5 — 100 photos at 6 per slide → 17 slides', () => {
  const { sizes, notice } = planSizes(100, 6)
  assert.equal(sizes.length, 17)
  assert.equal(notice, null)
  assert.equal(sizes.reduce((a, b) => a + b, 0), 100)
})

test('120 photos at 6 per slide → exactly the 20-slide cap, nothing dropped', () => {
  const { sizes, notice, included } = planSizes(120, 6)
  assert.equal(sizes.length, 20)
  assert.equal(included, 120)
  assert.equal(notice, null)
})

test('clamps to 20 slides by raising photos per slide', () => {
  const { sizes, notice, included } = planSizes(130, 5) // would be 26 slides
  assert.equal(sizes.length, 20)
  assert.equal(included, 130)
  assert.equal(notice.type, 'raised')
  assert.equal(notice.per, 7)
  assert.ok(Math.max(...sizes) <= 8)
})

test('hard overflow past 20×8 reports the excluded count', () => {
  const { sizes, notice, included } = planSizes(200, 6)
  assert.equal(included, 160)
  assert.equal(notice.type, 'overflow')
  assert.equal(notice.excluded, 40)
  assert.equal(sizes.reduce((a, b) => a + b, 0), 160)
  assert.ok(Math.max(...sizes) <= 8)
})

test('single photo still produces one slide', () => {
  const { sizes } = planSizes(1, 6)
  assert.deepEqual(sizes, [1])
})

// ---------- orientation balancing ----------

test('neighbour swaps even out portrait/landscape mix', () => {
  // group A: all portrait (0.7), group B: all landscape (1.5)
  const aspects = { 1: 0.7, 2: 0.7, 3: 0.7, 4: 0.7, 5: 1.5, 6: 1.5, 7: 1.5, 8: 1.5 }
  const groups = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
  ]
  balanceOrientations(groups, (id) => aspects[id])
  const pf = (g) => g.filter((id) => aspects[id] < 1).length / g.length
  // was 1.0 vs 0.0 — should move toward 0.5 each
  assert.ok(Math.abs(pf(groups[0]) - pf(groups[1])) < 1, 'no movement at all')
  assert.ok(pf(groups[0]) < 1 && pf(groups[1]) > 0, `still fully segregated: ${JSON.stringify(groups)}`)
})

test('balancing only swaps near group boundaries (chronology roughly kept)', () => {
  const aspects = { 1: 0.7, 2: 0.7, 3: 0.7, 4: 0.7, 5: 1.5, 6: 1.5, 7: 1.5, 8: 1.5 }
  const groups = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
  ]
  balanceOrientations(groups, (id) => aspects[id])
  // first two of group A must be untouched (only last two may swap)
  assert.deepEqual(groups[0].slice(0, 2), [1, 2])
})

test('groupPhotos returns groups plus excluded tail', () => {
  const ids = Array.from({ length: 200 }, (_, i) => i + 1)
  const { groups, excluded, notice } = groupPhotos(ids, () => ({ aspect: 1 }), 6)
  assert.equal(groups.length, 20)
  assert.equal(excluded.length, 40)
  assert.equal(notice.type, 'overflow')
  const flat = groups.flat()
  assert.equal(new Set(flat).size, 160)
})

const LAYOUT_OPTS = { canvasW: 1080, canvasH: 1350, margin: 16, gutter: 8, baseSeed: 12345 }

// ---------- per-slide size stepper ----------

test('minus hands the boundary photo to the next slide', () => {
  const groups = [
    [1, 2, 3, 4],
    [5, 6, 7],
  ]
  const out = adjustGroupSize(groups, 0, -1)
  assert.deepEqual(out, [
    [1, 2, 3],
    [4, 5, 6, 7],
  ])
  assert.equal(out[1] === groups[1], false)
  assert.equal(groups[0].length, 4, 'input must not be mutated')
})

test('minus on the last slide gives to the previous slide instead', () => {
  const out = adjustGroupSize(
    [
      [1, 2, 3],
      [4, 5, 6],
    ],
    1,
    -1,
  )
  assert.deepEqual(out, [
    [1, 2, 3, 4],
    [5, 6],
  ])
})

test('plus pulls the neighbouring boundary photo in', () => {
  const out = adjustGroupSize(
    [
      [1, 2, 3],
      [4, 5, 6],
    ],
    0,
    1,
  )
  assert.deepEqual(out, [
    [1, 2, 3, 4],
    [5, 6],
  ])
})

test('plus that empties a neighbour removes that slide', () => {
  const out = adjustGroupSize([[1, 2, 3], [4]], 0, 1)
  assert.deepEqual(out, [[1, 2, 3, 4]])
})

test('stepper respects the bounds', () => {
  assert.equal(adjustGroupSize([[1], [2, 3]], 0, -1), null, 'cannot shrink below one photo')
  assert.equal(adjustGroupSize([[1, 2, 3, 4, 5, 6, 7, 8], [9]], 0, 1), null, 'cannot grow past eight')
  assert.equal(adjustGroupSize([[1, 2, 3]], 0, -1), null, 'single slide has no neighbour to give to')
  const total = (g) => g.flat().length
  const groups = [
    [1, 2, 3, 4],
    [5, 6, 7],
    [8, 9],
  ]
  const out = adjustGroupSize(groups, 1, -1)
  assert.equal(total(out), total(groups), 'no photo may ever be dropped')
})

test('minus prefers the neighbour with room', () => {
  const groups = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9, 10, 11, 12, 13, 14], // full
  ]
  // slide 1 shrinks; next slide is full, so the photo should go backwards
  const out = adjustGroupSize(groups, 1, -1)
  assert.deepEqual(out[0], [1, 2, 3, 4])
  assert.equal(out[2].length, 8)
})

// ---------- colour coherence ----------

test('colour pass swaps a clashing boundary pair into coherent slides', () => {
  const photos = {
    1: { aspect: 1.5, hue: 30, sat: 0.8 },
    2: { aspect: 1.5, hue: 30, sat: 0.8 },
    3: { aspect: 1.5, hue: 30, sat: 0.8 },
    4: { aspect: 1.5, hue: 210, sat: 0.8 }, // cool photo stuck in the warm slide
    5: { aspect: 1.5, hue: 30, sat: 0.8 }, // warm photo stuck in the cool slide
    6: { aspect: 1.5, hue: 210, sat: 0.8 },
    7: { aspect: 1.5, hue: 210, sat: 0.8 },
    8: { aspect: 1.5, hue: 210, sat: 0.8 },
  }
  const groups = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
  ]
  harmonizeColors(groups, (id) => photos[id])
  const warm = (id) => photos[id].hue < 120
  assert.ok(groups[0].every(warm), `warm slide still mixed: ${groups[0]}`)
  assert.ok(groups[1].every((id) => !warm(id)), `cool slide still mixed: ${groups[1]}`)
})

test('colour swaps never cross orientation classes', () => {
  const photos = {
    1: { aspect: 1.5, hue: 30, sat: 0.8 },
    2: { aspect: 1.5, hue: 30, sat: 0.8 },
    3: { aspect: 1.5, hue: 30, sat: 0.8 },
    4: { aspect: 0.75, hue: 210, sat: 0.8 }, // clashing but portrait
    5: { aspect: 1.5, hue: 30, sat: 0.8 }, // landscape — would fix colour, wrong shape
    6: { aspect: 0.75, hue: 210, sat: 0.8 },
    7: { aspect: 1.5, hue: 210, sat: 0.8 },
    8: { aspect: 0.75, hue: 210, sat: 0.8 },
  }
  const groups = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
  ]
  const beforeA = [...groups[0]]
  harmonizeColors(groups, (id) => photos[id])
  // photo 4 may only ever be exchanged for another portrait; the tempting
  // landscape swap (4↔5) must not happen
  assert.ok(!(groups[0].includes(5) && groups[1].includes(4)), 'cross-orientation swap happened')
  const portraitCountA = groups[0].filter((id) => photos[id].aspect < 1).length
  assert.equal(portraitCountA, beforeA.filter((id) => photos[id].aspect < 1).length, 'orientation mix changed')
})

test('washed-out photos do not drive colour swaps', () => {
  const photos = {
    1: { aspect: 1.5, hue: 30, sat: 0.02 },
    2: { aspect: 1.5, hue: 30, sat: 0.02 },
    3: { aspect: 1.5, hue: 30, sat: 0.02 },
    4: { aspect: 1.5, hue: 210, sat: 0.02 },
    5: { aspect: 1.5, hue: 30, sat: 0.02 },
    6: { aspect: 1.5, hue: 210, sat: 0.02 },
    7: { aspect: 1.5, hue: 210, sat: 0.02 },
    8: { aspect: 1.5, hue: 210, sat: 0.02 },
  }
  const groups = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
  ]
  harmonizeColors(groups, (id) => photos[id])
  // near-grey photos: cost deltas are ~0, order should be untouched
  assert.deepEqual(groups, [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
  ])
})

// ---------- automatic filters (colour-matrix engine, Safari-safe) ----------

// run one RGB pixel through a look's matrix
const runPixel = (photo, look, rgb) => {
  const m = matrixFor(photo, look)
  if (!m) return null
  const data = new Uint8ClampedArray([...rgb, 255])
  applyMatrix(data, m)
  return [data[0], data[1], data[2]]
}

test('filters: Off is a hard guard, Auto adapts to the photo', () => {
  assert.equal(matrixFor({ luma: 0.2, contrast: 0.1 }, 'off'), null)
  const grey = [128, 128, 128]
  const lifted = runPixel({ luma: 0.2, contrast: 0.5 }, 'auto', grey)
  const pulled = runPixel({ luma: 0.85, contrast: 0.5 }, 'auto', grey)
  assert.ok(lifted[0] > 128, `dark photo should be lifted, got ${lifted}`)
  assert.ok(pulled[0] < 128, `bright photo should be pulled down, got ${pulled}`)
})

test('filters: Noir is truly neutral, Film warms, identity holds', () => {
  const colourful = [200, 80, 140]
  const noir = runPixel({ luma: 0.5, contrast: 0.5 }, 'noir', colourful)
  assert.ok(Math.abs(noir[0] - noir[1]) <= 1 && Math.abs(noir[1] - noir[2]) <= 1, `noir not neutral: ${noir}`)
  const film = runPixel({ luma: 0.5, contrast: 0.5 }, 'film', [128, 128, 128])
  assert.ok(film[0] > film[2], `film should warm (R>B), got ${film}`)
  const frost = runPixel({ luma: 0.5, contrast: 0.5 }, 'frost', [128, 128, 128])
  assert.ok(frost[2] >= frost[0], `frost should cool (B≥R), got ${frost}`)
})

test('filters: a well-exposed photo passes through Auto almost untouched', () => {
  const out = runPixel({ luma: 0.52, contrast: 0.5 }, 'auto', [128, 128, 128])
  for (const v of out) assert.ok(Math.abs(v - 128) <= 8, `auto shifted a good photo too far: ${out}`)
})

// ---------- tilt ----------

test('tiltAngle is deterministic, bounded, zero when off', () => {
  assert.equal(tiltAngle(42, 0), 0)
  assert.equal(tiltAngle(42, 4), tiltAngle(42, 4))
  const max = (6 * Math.PI) / 180
  const angles = new Set()
  for (let id = 1; id <= 40; id++) {
    const a = tiltAngle(id, 6)
    assert.ok(Math.abs(a) <= max + 1e-9, `angle out of range: ${a}`)
    angles.add(a.toFixed(5))
  }
  assert.ok(angles.size > 20, 'photos should lean by different amounts')
})

// ---------- dynamic (Auto) grouping ----------

const makePhotos = (n, fn = () => ({})) => {
  const map = new Map()
  for (let i = 0; i < n; i++) map.set(i + 1, { aspect: 1, quality: 0.5, date: null, ...fn(i) })
  return map
}

test('auto grouping keeps sizes 1–8, everything included, ≤20 slides', () => {
  const photos = makePhotos(47)
  const ids = [...photos.keys()]
  const { groups, excluded, notice } = groupPhotosAuto(ids, (id) => photos.get(id))
  assert.equal(excluded.length, 0)
  assert.equal(notice, null)
  assert.ok(groups.length <= 20)
  assert.equal(groups.flat().length, 47)
  for (const g of groups) assert.ok(g.length >= 1 && g.length <= 8, `bad size ${g.length}`)
})

test('auto grouping cuts at large time gaps — 4 bursts → 4 slides', () => {
  const photos = makePhotos(24, (i) => ({
    date: Math.floor(i / 6) * 10_000_000 + (i % 6) * 1000, // 4 bursts, ~3h apart
  }))
  const ids = [...photos.keys()]
  const { groups } = groupPhotosAuto(ids, (id) => photos.get(id))
  assert.equal(groups.length, 4, `expected 4 burst slides, got ${groups.map((g) => g.length)}`)
  assert.deepEqual(groups.map((g) => g.length), [6, 6, 6, 6])
})

test('a standout photo earns a solo hero slide', () => {
  const photos = makePhotos(13, (i) => ({ quality: i === 6 ? 0.95 : 0.4 }))
  const ids = [...photos.keys()]
  const { groups } = groupPhotosAuto(ids, (id) => photos.get(id))
  const solo = groups.find((g) => g.length === 1)
  assert.ok(solo, `no solo slide in ${groups.map((g) => g.length)}`)
  assert.equal(solo[0], 7, 'the solo slide should hold the standout photo')
})

test('uniform photos produce no gratuitous solo slides', () => {
  const photos = makePhotos(30)
  const ids = [...photos.keys()]
  const { groups } = groupPhotosAuto(ids, (id) => photos.get(id))
  for (const g of groups) assert.ok(g.length >= 4, `unjustified small slide: ${groups.map((x) => x.length)}`)
})

test('auto grouping reports overflow past the 20×8 ceiling', () => {
  const photos = makePhotos(200)
  const ids = [...photos.keys()]
  const { groups, excluded, notice } = groupPhotosAuto(ids, (id) => photos.get(id))
  assert.equal(notice.type, 'overflow')
  assert.equal(notice.excluded, 40)
  assert.equal(groups.flat().length, 160)
  assert.equal(excluded.length, 40)
  assert.ok(groups.length <= 20)
})

// ---------- smarter selection ----------

test('hamming distance over [hi, lo] hash pairs', () => {
  assert.equal(hammingDistance([0, 0], [0, 0]), 0)
  assert.equal(hammingDistance([0b1011, 0], [0b0010, 0]), 2)
  assert.equal(hammingDistance([0xffffffff, 0xffffffff], [0, 0]), 64)
})

test('near-duplicates are demoted to the best of the cluster', () => {
  const photos = {
    1: { quality: 0.9, hash: [0xabc0, 0x1230] },
    2: { quality: 0.6, hash: [0xabc1, 0x1230] }, // 1 bit from photo 1 → duplicate
    3: { quality: 0.7, hash: [0x0f0f0f0f, 0xf0f0f0f0] }, // distinct
  }
  const eff = effectiveQualities([1, 2, 3], (id) => photos[id])
  assert.equal(eff.get(1), 0.9) // best of cluster keeps its score
  assert.ok(eff.get(2) < 0.2, `duplicate not demoted: ${eff.get(2)}`)
  assert.equal(eff.get(3), 0.7) // unrelated photo untouched
})

test('higher-quality photos get the larger slots when aspects tie', () => {
  const aspects = [1.5, 1.5, 1.5, 0.75, 0.75, 0.75]
  const qualities = [0.9, 0.1, 0.5, 0.1, 0.9, 0.5]
  const { rects } = computeLayout(aspects, { ...LAYOUT_OPTS, qualities })
  const area = (i) => rects[i].w * rects[i].h
  // within each same-aspect class, area order must follow quality order
  assert.ok(area(0) >= area(2) && area(2) >= area(1), `landscape areas ${[area(0), area(2), area(1)]}`)
  assert.ok(area(4) >= area(5) && area(5) >= area(3), `portrait areas ${[area(4), area(5), area(3)]}`)
})

test('quality steering never sacrifices crop fit', () => {
  const aspects = [1.7778, 0.5625, 1.0, 1.33, 0.75]
  const qualities = [0.1, 0.95, 0.5, 0.4, 0.6]
  const withQ = computeLayout(aspects, { ...LAYOUT_OPTS, qualities })
  assert.ok(withQ.maxLoss <= MAX_CROP_LOSS + 0.05, `quality bias broke the crop guard: ${withQ.maxLoss}`)
})

// ---------- layout ----------

function checkGeometry(aspects, opts = LAYOUT_OPTS) {
  const { rects, maxLoss } = computeLayout(aspects, opts)
  assert.equal(rects.length, aspects.length)
  for (const r of rects) {
    assert.ok(r.w > 1 && r.h > 1, `degenerate rect ${JSON.stringify(r)}`)
    assert.ok(r.x >= opts.margin - 0.5 && r.y >= opts.margin - 0.5, `rect outside margin ${JSON.stringify(r)}`)
    assert.ok(
      r.x + r.w <= opts.canvasW - opts.margin + 0.5 && r.y + r.h <= opts.canvasH - opts.margin + 0.5,
      `rect past margin ${JSON.stringify(r)}`,
    )
  }
  // no overlaps
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]
      const b = rects[j]
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      assert.ok(overlapX <= 0.5 || overlapY <= 0.5, `rects ${i} and ${j} overlap`)
    }
  }
  // full coverage: photo area + gutters ≈ working area
  const workArea = (opts.canvasW - 2 * opts.margin + opts.gutter) * (opts.canvasH - 2 * opts.margin + opts.gutter)
  const photoArea = rects.reduce((s, r) => s + (r.w + opts.gutter) * (r.h + opts.gutter), 0)
  assert.ok(Math.abs(photoArea - workArea) / workArea < 0.01, `coverage gap: ${photoArea} vs ${workArea}`)
  return maxLoss
}

test('layout geometry is sound for 1–8 photos', () => {
  const rng = mulberry32(7)
  for (let n = 1; n <= 8; n++) {
    const aspects = Array.from({ length: n }, () => (rng() < 0.5 ? 0.75 : 1.5))
    checkGeometry(aspects)
  }
})

test('mixed-orientation slide keeps crops within the guard', () => {
  const aspects = [0.75, 1.5, 0.75, 1.33, 1.5, 0.75] // typical iPhone mix
  const maxLoss = checkGeometry(aspects)
  assert.ok(maxLoss <= MAX_CROP_LOSS, `maxLoss ${maxLoss}`)
})

test('random slides rarely breach the crop guard', () => {
  const rng = mulberry32(99)
  let breaches = 0
  const runs = 60
  for (let i = 0; i < runs; i++) {
    const n = 4 + Math.floor(rng() * 5)
    const choices = [0.75, 1.33, 1.5, 1.0, 0.5625, 1.7778] // iPhone portrait/landscape/square/16:9
    const aspects = Array.from({ length: n }, () => choices[Math.floor(rng() * choices.length)])
    const maxLoss = checkGeometry(aspects, { ...LAYOUT_OPTS, baseSeed: i * 101 + 1 })
    if (maxLoss > MAX_CROP_LOSS) breaches++
  }
  assert.ok(breaches <= runs * 0.1, `${breaches}/${runs} slides breached the crop guard`)
})

test('same seed → same layout, different seed → usually different', () => {
  const aspects = [0.75, 1.5, 1.0, 0.75, 1.33]
  const a = computeLayout(aspects, LAYOUT_OPTS)
  const b = computeLayout(aspects, LAYOUT_OPTS)
  assert.deepEqual(a.rects, b.rects)
  let differing = 0
  for (let s = 1; s <= 8; s++) {
    const c = computeLayout(aspects, { ...LAYOUT_OPTS, baseSeed: s * 7919 })
    if (JSON.stringify(c.rects) !== JSON.stringify(a.rects)) differing++
  }
  assert.ok(differing >= 3, `shuffle produced only ${differing}/8 distinct layouts`)
})

test('gutter 0 gives edge-to-edge rects when margin is 0', () => {
  const { rects } = computeLayout([1.5, 0.75, 1.0, 1.33], { canvasW: 1080, canvasH: 1350, margin: 0, gutter: 0, baseSeed: 5 })
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  assert.ok(minX <= 0.5 && minY <= 0.5)
})

test('cropLoss math', () => {
  assert.equal(cropLoss(1, 1), 0)
  assert.ok(Math.abs(cropLoss(2, 1) - 0.5) < 1e-9)
  assert.ok(Math.abs(cropLoss(0.5, 1) - 0.5) < 1e-9)
})

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`)
  process.exit(1)
}
console.log('\nAll unit tests passed')
