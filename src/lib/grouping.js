// Sorting and slide grouping. Photos are sorted chronologically (EXIF date,
// falling back to filename, then import order) and chunked into balanced
// slides of 4–8 photos, with a neighbour-swap pass to mix orientations.

export const MAX_SLIDES = 20 // Instagram carousel limit
export const HARD_MAX_PER_SLIDE = 8

const nameCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// photos: [{ date: number|null, name, order }]
export function sortPhotos(photos) {
  return [...photos].sort((a, b) => {
    if (a.date != null && b.date != null && a.date !== b.date) return a.date - b.date
    if (a.date != null && b.date == null) return -1
    if (a.date == null && b.date != null) return 1
    const byName = nameCompare.compare(a.name, b.name)
    if (byName !== 0) return byName
    return a.order - b.order
  })
}

// Plan slide sizes for n photos at a target of perSlide photos each.
// Returns { sizes, included, notice }:
//  - notice {type:'raised', per}  → per-slide was raised to fit the 20-slide cap
//  - notice {type:'overflow', excluded, included} → even 20×8 can't hold them
export function planSizes(n, perSlide) {
  if (n <= 0) return { sizes: [], included: 0, notice: null }
  let slideCount = Math.max(1, Math.ceil(n / perSlide))
  let included = n
  let notice = null
  if (slideCount > MAX_SLIDES) {
    slideCount = MAX_SLIDES
    const per = Math.ceil(n / MAX_SLIDES)
    if (per <= HARD_MAX_PER_SLIDE) {
      notice = { type: 'raised', per }
    } else {
      included = MAX_SLIDES * HARD_MAX_PER_SLIDE
      notice = { type: 'overflow', excluded: n - included, included }
    }
  }
  // Balanced distribution — the remainder spreads across the first slides so
  // there is never an orphan final slide.
  const base = Math.floor(included / slideCount)
  const rem = included % slideCount
  const sizes = Array.from({ length: slideCount }, (_, i) => base + (i < rem ? 1 : 0))
  return { sizes, included, notice }
}

const isPortrait = (aspect) => aspect < 1

function portraitFraction(group, aspectOf) {
  if (group.length === 0) return 0
  let p = 0
  for (const id of group) if (isPortrait(aspectOf(id))) p++
  return p / group.length
}

function mixScore(groups, aspectOf, globalP) {
  let s = 0
  for (const g of groups) s += Math.abs(portraitFraction(g, aspectOf) - globalP)
  return s
}

// Swap photos between *neighbouring* groups (only near the shared boundary,
// so chronology stays roughly intact) when it evens out the portrait/landscape
// mix across slides.
export function balanceOrientations(groups, aspectOf) {
  const all = groups.flat()
  if (all.length === 0) return groups
  let portraits = 0
  for (const id of all) if (isPortrait(aspectOf(id))) portraits++
  const globalP = portraits / all.length

  for (let pass = 0; pass < 2; pass++) {
    for (let gi = 0; gi < groups.length - 1; gi++) {
      const a = groups[gi]
      const b = groups[gi + 1]
      // tiny slides (solo heroes, pairs) are deliberate — leave them alone
      if (a.length < 3 || b.length < 3) continue
      // candidates: last two of a, first two of b
      const aIdxs = a.length > 1 ? [a.length - 1, a.length - 2] : [a.length - 1]
      const bIdxs = b.length > 1 ? [0, 1] : [0]
      for (const ai of aIdxs) {
        for (const bi of bIdxs) {
          if (ai < 0 || bi >= b.length) continue
          if (isPortrait(aspectOf(a[ai])) === isPortrait(aspectOf(b[bi]))) continue
          const before = mixScore([a, b], aspectOf, globalP)
          ;[a[ai], b[bi]] = [b[bi], a[ai]]
          const after = mixScore([a, b], aspectOf, globalP)
          if (after >= before - 1e-9) {
            // no improvement — swap back
            ;[a[ai], b[bi]] = [b[bi], a[ai]]
          }
        }
      }
    }
  }
  return groups
}

// ---- per-slide size stepper ----
//
// Grow or shrink one slide by a photo, rebalancing with a neighbour so no
// photo is ever dropped: "−" hands this slide's boundary photo to the next
// slide (or the previous, at the end of the strip); "+" pulls the adjacent
// boundary photo in. Chronology is preserved because only boundary photos
// move. Returns a new groups array — untouched groups keep their identity
// (same reference) so callers can keep their layouts stable — or null when
// the adjustment isn't possible.

export function adjustGroupSize(groups, i, delta, maxPer = HARD_MAX_PER_SLIDE) {
  if (i < 0 || i >= groups.length) return null
  const next = [...groups]
  if (delta === -1) {
    if (next[i].length <= 1) return null
    const canNext = i + 1 < next.length
    const canPrev = i > 0
    if (!canNext && !canPrev) return null
    // prefer a neighbour with room; fall back to the other side
    const useNext = canNext && (!canPrev || next[i + 1].length < maxPer || next[i - 1].length >= maxPer)
    if (useNext) {
      const moved = next[i][next[i].length - 1]
      next[i] = next[i].slice(0, -1)
      next[i + 1] = [moved, ...next[i + 1]]
    } else {
      const moved = next[i][0]
      next[i] = next[i].slice(1)
      next[i - 1] = [...next[i - 1], moved]
    }
  } else if (delta === 1) {
    if (next[i].length >= maxPer) return null
    if (i + 1 < next.length && next[i + 1].length > 0) {
      const moved = next[i + 1][0]
      next[i + 1] = next[i + 1].slice(1)
      next[i] = [...next[i], moved]
    } else if (i > 0 && next[i - 1].length > 0) {
      const moved = next[i - 1][next[i - 1].length - 1]
      next[i - 1] = next[i - 1].slice(0, -1)
      next[i] = [moved, ...next[i]]
    } else {
      return null
    }
  } else {
    return null
  }
  return next.filter((g) => g.length > 0)
}

// ---- colour coherence (subtle) ----
//
// After orientation balancing, a second neighbour-boundary pass swaps photos
// between adjacent slides when it makes each slide's palette more coherent.
// Swaps only happen between photos of the SAME orientation (so the packing
// mix is preserved) and only near slide boundaries (so chronology holds).

function hueDistance(a, b) {
  let d = Math.abs(a - b) % 360
  if (d > 180) d = 360 - d
  return d / 180
}

// weighted sum of pairwise hue distances — washed-out photos barely count
function groupColorCost(group, getPhoto) {
  let cost = 0
  for (let i = 0; i < group.length; i++) {
    const a = getPhoto(group[i])
    if (a?.hue == null) continue
    for (let j = i + 1; j < group.length; j++) {
      const b = getPhoto(group[j])
      if (b?.hue == null) continue
      const w = Math.min(a.sat ?? 0, b.sat ?? 0)
      cost += hueDistance(a.hue, b.hue) * w
    }
  }
  return cost
}

export function harmonizeColors(groups, getPhoto) {
  const isPortraitPhoto = (id) => (getPhoto(id)?.aspect ?? 1) < 1
  for (let pass = 0; pass < 2; pass++) {
    for (let gi = 0; gi < groups.length - 1; gi++) {
      const a = groups[gi]
      const b = groups[gi + 1]
      if (a.length < 3 || b.length < 3) continue
      const aIdxs = [a.length - 1, a.length - 2]
      const bIdxs = [0, 1]
      for (const ai of aIdxs) {
        for (const bi of bIdxs) {
          if (ai < 0 || bi >= b.length) continue
          const pa = getPhoto(a[ai])
          const pb = getPhoto(b[bi])
          if (pa?.hue == null || pb?.hue == null) continue
          // near-grey photos have no meaningful palette — moving them is churn
          if ((pa.sat ?? 0) < 0.15 || (pb.sat ?? 0) < 0.15) continue
          if (isPortraitPhoto(a[ai]) !== isPortraitPhoto(b[bi])) continue // keep the orientation mix
          const before = groupColorCost(a, getPhoto) + groupColorCost(b, getPhoto)
          ;[a[ai], b[bi]] = [b[bi], a[ai]]
          const after = groupColorCost(a, getPhoto) + groupColorCost(b, getPhoto)
          if (after >= before - 1e-9) {
            ;[a[ai], b[bi]] = [b[bi], a[ai]]
          }
        }
      }
    }
  }
  return groups
}

// ---- smarter selection: near-duplicate detection + quality demotion ----

function popcount(v) {
  v -= (v >>> 1) & 0x55555555
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  v = (v + (v >>> 4)) & 0x0f0f0f0f
  return (v * 0x01010101) >>> 24
}

// Hamming distance between two 64-bit average hashes stored as [hi, lo].
export function hammingDistance(a, b) {
  return popcount((a[0] ^ b[0]) >>> 0) + popcount((a[1] ^ b[1]) >>> 0)
}

export const DUPLICATE_HAMMING = 10

// Effective quality per photo: near-duplicates (burst shots, retakes) are
// clustered by hash; the best of each cluster keeps its score, the rest are
// demoted so the layout gives prominence to only one of them.
export function effectiveQualities(ids, getPhoto) {
  const eff = new Map()
  const used = new Array(ids.length).fill(false)
  for (let i = 0; i < ids.length; i++) {
    if (used[i]) continue
    const cluster = [ids[i]]
    used[i] = true
    const pi = getPhoto(ids[i])
    for (let j = i + 1; j < ids.length; j++) {
      if (used[j]) continue
      const pj = getPhoto(ids[j])
      if (pi?.hash && pj?.hash && hammingDistance(pi.hash, pj.hash) <= DUPLICATE_HAMMING) {
        cluster.push(ids[j])
        used[j] = true
      }
    }
    let best = cluster[0]
    let bestQ = -1
    for (const id of cluster) {
      const q = getPhoto(id)?.quality ?? 0.5
      if (q > bestQ) {
        bestQ = q
        best = id
      }
    }
    for (const id of cluster) {
      const q = getPhoto(id)?.quality ?? 0.5
      eff.set(id, id === best ? q : q * 0.2)
    }
  }
  return eff
}

// Full grouping pipeline: sorted photo ids → array of id groups + notice.
// getPhoto(id) → { aspect, hue, sat, ... }
export function groupPhotos(sortedIds, getPhoto, perSlide) {
  const { sizes, included, notice } = planSizes(sortedIds.length, perSlide)
  const groups = []
  let cursor = 0
  for (const size of sizes) {
    groups.push(sortedIds.slice(cursor, cursor + size))
    cursor += size
  }
  balanceOrientations(groups, (id) => getPhoto(id)?.aspect ?? 1)
  harmonizeColors(groups, getPhoto)
  return { groups, excluded: sortedIds.slice(included), notice }
}

// ---- dynamic grouping (Auto mode) ----
//
// Instead of a fixed target, choose variable slide sizes (1–8) with a DP over
// the chronological sequence. The cost model prefers 4–7 photos per slide but
// lets the content justify exceptions:
//  - cuts are cheap at large EXIF time gaps (natural event boundaries)
//  - a photo that clearly outshines its neighbours earns a solo hero slide
//  - extreme panoramas / verticals also read well alone
// Still clamped to Instagram's 20-slide × 8-photo ceiling.

const SIZE_COST = [Infinity, 2.4, 1.1, 0.45, 0.12, 0, 0, 0.15, 0.45]

const clamp01 = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function median(values) {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[s.length >> 1]
}

export function groupPhotosAuto(sortedIds, getPhoto) {
  const capacity = MAX_SLIDES * HARD_MAX_PER_SLIDE
  let notice = null
  let ids = sortedIds
  if (ids.length > capacity) {
    notice = { type: 'overflow', excluded: ids.length - capacity, included: capacity }
    ids = ids.slice(0, capacity)
  }
  const n = ids.length
  if (n === 0) return { groups: [], excluded: sortedIds.slice(0), notice }

  const photo = (i) => getPhoto(ids[i]) ?? {}
  // gap after photo i (between i and i+1), in ms; null when dates are missing
  const gaps = []
  for (let i = 0; i < n - 1; i++) {
    const a = photo(i).date
    const b = photo(i + 1).date
    gaps.push(a != null && b != null ? Math.max(0, b - a) : null)
  }
  const known = gaps.filter((g) => g != null && g > 0)
  const medGap = median(known) || 1

  // cutting after photo i: cheap when the time gap there is large
  const cutCost = (i) => {
    if (i >= n - 1) return 0 // final boundary is free
    const g = gaps[i]
    if (g == null || known.length < 3) return 0.45
    const score = clamp01(Math.log2(Math.max(g, 1) / medGap) / 3, 0, 1)
    return 0.9 * (1 - score)
  }

  // how much photo i stands out from its neighbourhood (drives hero slides)
  const standout = (i) => {
    const q = photo(i).quality ?? 0.5
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) {
      if (j === i) continue
      sum += photo(j).quality ?? 0.5
      count++
    }
    if (count === 0) return 0
    return q - sum / count
  }

  const groupCost = (start, end) => {
    // photos [start, end)
    const s = end - start
    let cost = SIZE_COST[s]
    if (s === 1) {
      cost -= clamp01(standout(start) * 8, 0, 2.9)
      const a = photo(start).aspect ?? 1
      if (a >= 1.85 || a <= 0.55) cost -= 0.6 // panoramas & tall verticals carry a slide alone
    }
    return cost + cutCost(end - 1)
  }

  // dp[i][g] = min cost of first i photos in g slides
  const INF = Number.POSITIVE_INFINITY
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(MAX_SLIDES + 1).fill(INF))
  const choice = Array.from({ length: n + 1 }, () => new Int8Array(MAX_SLIDES + 1))
  dp[0][0] = 0
  for (let i = 1; i <= n; i++) {
    for (let g = 1; g <= MAX_SLIDES; g++) {
      for (let k = 1; k <= Math.min(HARD_MAX_PER_SLIDE, i); k++) {
        const prev = dp[i - k][g - 1]
        if (prev === INF) continue
        const c = prev + groupCost(i - k, i)
        if (c < dp[i][g]) {
          dp[i][g] = c
          choice[i][g] = k
        }
      }
    }
  }
  let bestG = 1
  for (let g = 1; g <= MAX_SLIDES; g++) if (dp[n][g] < dp[n][bestG]) bestG = g

  const groups = []
  let i = n
  let g = bestG
  while (i > 0) {
    const k = choice[i][g]
    groups.unshift(ids.slice(i - k, i))
    i -= k
    g--
  }
  balanceOrientations(groups, (id) => getPhoto(id)?.aspect ?? 1)
  harmonizeColors(groups, getPhoto)
  return { groups, excluded: sortedIds.slice(ids.length), notice }
}
