// Unit tests for the pure algorithm modules (run with `npm test`).
import assert from 'node:assert/strict'
import { sortPhotos, planSizes, groupPhotos, balanceOrientations } from '../src/lib/grouping.js'
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
  const { groups, excluded, notice } = groupPhotos(ids, () => 1, 6)
  assert.equal(groups.length, 20)
  assert.equal(excluded.length, 40)
  assert.equal(notice.type, 'overflow')
  const flat = groups.flat()
  assert.equal(new Set(flat).size, 160)
})

// ---------- layout ----------

const LAYOUT_OPTS = { canvasW: 1080, canvasH: 1350, margin: 16, gutter: 8, baseSeed: 12345 }

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
