import { mulberry32 } from './rng.js'

// Recursive binary space partitioning weighted by aspect ratio.
// Each slide's canvas is split into one rectangle per photo, with split
// direction/position chosen so sub-rectangles match the aspect ratios of the
// photos assigned to them, then refined per-node to minimise actual crop loss.

export const MAX_CROP_LOSS = 0.35

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// Fraction of a photo's area lost when cover-fitted into a rect of aspect `ra`.
export function cropLoss(photoAspect, rectAspect) {
  const kept = Math.min(photoAspect / rectAspect, rectAspect / photoAspect)
  return 1 - kept
}

function splitRect(rect, dir, t) {
  if (dir === 'v') {
    // side-by-side
    const w = rect.w * t
    return {
      ra: { x: rect.x, y: rect.y, w, h: rect.h },
      rb: { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h },
    }
  }
  const h = rect.h * t
  return {
    ra: { x: rect.x, y: rect.y, w: rect.w, h },
    rb: { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h },
  }
}

// Rough estimate of the aspect ratio a single photo's cell will end up with
// if `count` photos share this rect (assumes near-square internal grid).
function estCellAspect(rect, count) {
  const ar = rect.w / rect.h
  let cols = Math.max(1, Math.round(Math.sqrt(count * ar)))
  cols = Math.min(cols, count)
  const rows = Math.ceil(count / cols)
  return (rect.w / cols) / (rect.h / rows)
}

function groupScore(group, rect, aspects) {
  const cell = estCellAspect(rect, group.length)
  let s = 0
  for (const i of group) s += Math.abs(Math.log(aspects[i] / cell))
  return s
}

// ---- tree construction ----

function buildTree(idxs, rect, rng, aspects) {
  if (idxs.length === 1) return { leaf: true, i: idxs[0] }
  const n = idxs.length
  const half = n >> 1
  const ks = new Set([half, n - half])
  if (n >= 3) {
    ks.add(1)
    ks.add(n - 1)
  }
  ks.delete(0)
  ks.delete(n)

  const sorted = [...idxs].sort((a, b) => aspects[a] - aspects[b])
  const cands = []
  for (const dir of ['v', 'h']) {
    for (const k of ks) {
      const t0 = k / n
      for (const dt of [0, -0.1, 0.1, -0.2, 0.2]) {
        const t = clamp(t0 + dt, 0.12, 0.88)
        const { ra, rb } = splitRect(rect, dir, t)
        const cellA = estCellAspect(ra, k)
        const cellB = estCellAspect(rb, n - k)
        // The child whose cells are more portrait gets the most-portrait photos.
        let ga, gb
        if (cellA <= cellB) {
          ga = sorted.slice(0, k)
          gb = sorted.slice(k)
        } else {
          gb = sorted.slice(0, n - k)
          ga = sorted.slice(n - k)
        }
        const score = groupScore(ga, ra, aspects) + groupScore(gb, rb, aspects)
        cands.push({ dir, t, ga, gb, ra, rb, score })
      }
    }
  }
  cands.sort((a, b) => a.score - b.score)
  // Pick among the top candidates with the rng — this is where shuffle
  // variety comes from while still favouring well-matched splits.
  const r = rng()
  const pickIdx = r < 0.6 ? 0 : r < 0.86 ? 1 : 2
  const pick = cands[Math.min(pickIdx, cands.length - 1)]
  return {
    leaf: false,
    dir: pick.dir,
    t: pick.t,
    count: n,
    a: buildTree(pick.ga, pick.ra, rng, aspects),
    b: buildTree(pick.gb, pick.rb, rng, aspects),
  }
}

// ---- refinement: per-node split position vs real subtree crop loss ----

function subtreeCost(node, rect, aspects, totalArea, n) {
  if (node.leaf) {
    const loss = cropLoss(aspects[node.i], rect.w / rect.h)
    let cost = loss
    if (loss > MAX_CROP_LOSS) cost += (loss - MAX_CROP_LOSS) * 8
    // area fairness — don't let a photo collapse into a sliver
    const frac = (rect.w * rect.h) / totalArea
    const floor = 0.55 / n
    if (frac < floor) cost += (floor - frac) * n * 4
    return cost
  }
  const { ra, rb } = splitRect(rect, node.dir, node.t)
  return subtreeCost(node.a, ra, aspects, totalArea, n) + subtreeCost(node.b, rb, aspects, totalArea, n)
}

function refine(node, rect, aspects, totalArea, n) {
  if (node.leaf) return
  let bestT = node.t
  let bestCost = subtreeCost(node, rect, aspects, totalArea, n)
  for (let t = 0.1; t <= 0.901; t += 0.02) {
    node.t = t
    const cost = subtreeCost(node, rect, aspects, totalArea, n)
    if (cost < bestCost - 1e-9) {
      bestCost = cost
      bestT = t
    }
  }
  node.t = bestT
  const { ra, rb } = splitRect(rect, node.dir, node.t)
  refine(node.a, ra, aspects, totalArea, n)
  refine(node.b, rb, aspects, totalArea, n)
}

function collectLeaves(node, rect, out) {
  if (node.leaf) {
    out.push({ i: node.i, rect })
    return
  }
  const { ra, rb } = splitRect(rect, node.dir, node.t)
  collectLeaves(node.a, ra, out)
  collectLeaves(node.b, rb, out)
}

function inset(rect, d) {
  return { x: rect.x + d, y: rect.y + d, w: rect.w - 2 * d, h: rect.h - 2 * d }
}

// Lay out `aspects` (one per photo, w/h) on a canvasW × canvasH slide.
// Returns { rects, seed, maxLoss, meanLoss } with rects aligned to input order.
// Tries several seeds; retries are the crop guard — a photo losing more than
// MAX_CROP_LOSS of its area to the crop penalises that attempt heavily.
export function computeLayout(aspects, { canvasW, canvasH, margin, gutter, baseSeed, attempts = 12 }) {
  const n = aspects.length
  if (n === 0) return { rects: [], seed: baseSeed, maxLoss: 0, meanLoss: 0 }
  const workArea = {
    x: margin - gutter / 2,
    y: margin - gutter / 2,
    w: canvasW - 2 * margin + gutter,
    h: canvasH - 2 * margin + gutter,
  }
  const totalArea = workArea.w * workArea.h
  let best = null
  for (let a = 0; a < attempts; a++) {
    const seed = (baseSeed + a * 0x9e3779b9) >>> 0
    const rng = mulberry32(seed)
    const tree = buildTree(aspects.map((_, i) => i), workArea, rng, aspects)
    refine(tree, workArea, aspects, totalArea, n)
    const leaves = []
    collectLeaves(tree, workArea, leaves)
    const rects = new Array(n)
    let maxLoss = 0
    let sum = 0
    for (const { i, rect } of leaves) {
      const r = inset(rect, gutter / 2)
      rects[i] = r
      const loss = cropLoss(aspects[i], r.w / r.h)
      if (loss > maxLoss) maxLoss = loss
      sum += loss
    }
    const meanLoss = sum / n
    const score = meanLoss + (maxLoss > MAX_CROP_LOSS ? (maxLoss - MAX_CROP_LOSS) * 10 : 0)
    if (!best || score < best.score) best = { rects, seed, maxLoss, meanLoss, score }
    if (a >= 3 && best.maxLoss <= MAX_CROP_LOSS) break
  }
  return best
}
