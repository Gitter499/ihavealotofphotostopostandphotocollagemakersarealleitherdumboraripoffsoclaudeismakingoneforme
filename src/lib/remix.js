// Remix: regroup the whole dump around a randomly chosen pairing idea.
// Each press picks a different lens — photos that share a palette, photos
// that share light, heroes spread out, twins pulled apart — orders the dump
// to suit it, then lets the usual grouping pipeline cut the slides.

import { mulberry32 } from './rng.js'
import {
  sortPhotos,
  groupPhotosAuto,
  planSizes,
  hammingDistance,
  DUPLICATE_HAMMING,
  MAX_SLIDES,
  HARD_MAX_PER_SLIDE,
} from './grouping.js'

function shuffle(list, rnd) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// circular hue sort starting from a random angle, so two colour runs of the
// same dump still read differently; washed-out photos trail by brightness
function colorRun(photos, rnd) {
  const start = rnd() * 360
  const vivid = photos.filter((p) => (p.sat ?? 0) >= 0.15 && p.hue != null)
  const plain = photos.filter((p) => !((p.sat ?? 0) >= 0.15 && p.hue != null))
  vivid.sort((a, b) => (((a.hue - start) % 360) + 360) % 360 - ((((b.hue - start) % 360) + 360) % 360))
  plain.sort((a, b) => (a.luma ?? 0.5) - (b.luma ?? 0.5))
  return [...vivid, ...plain].map((p) => p.id)
}

// dark→light or light→dark, a coin flip per press
function lightArc(photos, rnd) {
  const dir = rnd() < 0.5 ? 1 : -1
  return [...photos].sort((a, b) => dir * ((a.luma ?? 0.5) - (b.luma ?? 0.5))).map((p) => p.id)
}

// alternate portraits and landscapes so every slide packs a lively mix
function mosaic(photos, rnd) {
  const ports = shuffle(photos.filter((p) => (p.aspect ?? 1) < 1), rnd)
  const lands = shuffle(photos.filter((p) => (p.aspect ?? 1) >= 1), rnd)
  const out = []
  // interleave proportionally so the tail isn't all one orientation
  let pi = 0
  let li = 0
  for (let k = 0; k < photos.length; k++) {
    const wantPortrait = pi / Math.max(1, ports.length) <= li / Math.max(1, lands.length)
    if ((wantPortrait && pi < ports.length) || li >= lands.length) out.push(ports[pi++])
    else out.push(lands[li++])
  }
  return out.map((p) => p.id)
}

// the best shots anchor slides; the rest fill in around them
function heroes(photos, rnd, getPhoto) {
  const byQuality = [...photos].sort((a, b) => (b.quality ?? 0.5) - (a.quality ?? 0.5))
  const { sizes } = planSizes(photos.length, 6)
  const anchors = byQuality.slice(0, sizes.length)
  const rest = shuffle(byQuality.slice(sizes.length), rnd)
  const groups = []
  let cursor = 0
  for (let i = 0; i < sizes.length; i++) {
    const g = [anchors[i].id]
    while (g.length < sizes[i] && cursor < rest.length) g.push(rest[cursor++].id)
    groups.push(g)
  }
  while (cursor < rest.length) {
    const gi = groups.findIndex((g) => g.length < HARD_MAX_PER_SLIDE)
    if (gi < 0) break
    groups[gi].push(rest[cursor++].id)
  }
  return { groups: groups.filter((g) => g.length > 0) }
}

// near-duplicates (bursts, retakes) never share a slide: clusters are dealt
// round-robin across the deck, everything else keeps its place in time
function twinsApart(photos, rnd) {
  const ordered = sortPhotos(photos)
  const clusters = []
  for (const p of ordered) {
    let home = null
    if (p.hash) {
      for (const c of clusters) {
        const rep = c[0]
        if (rep.hash && hammingDistance(rep.hash, p.hash) <= DUPLICATE_HAMMING) {
          home = c
          break
        }
      }
    }
    if (home) home.push(p)
    else clusters.push([p])
  }
  const { sizes } = planSizes(photos.length, 6)
  const groups = Array.from({ length: sizes.length }, () => [])
  // deal each cluster's members to different slides, filling the emptiest
  const room = (gi) => sizes[gi] - groups[gi].length
  for (const c of clusters.sort((a, b) => b.length - a.length)) {
    const taken = new Set()
    for (const p of c) {
      let best = -1
      for (let gi = 0; gi < groups.length; gi++) {
        if (room(gi) <= 0 || taken.has(gi)) continue
        if (best < 0 || room(gi) > room(best)) best = gi
      }
      if (best < 0) {
        // more twins than slides — least-bad: the emptiest slide overall
        best = groups.reduce((m, _, gi) => (room(gi) > room(m) ? gi : m), 0)
      }
      groups[best].push(p.id)
      taken.add(best)
    }
  }
  return { groups: groups.filter((g) => g.length > 0) }
}

const LENSES = [
  { key: 'color', label: 'Remixed by colour — palettes run together', order: colorRun },
  { key: 'light', label: 'Remixed by light — dark to bright in one arc', order: lightArc },
  { key: 'mosaic', label: 'Remixed as mosaics — orientations interleaved', order: mosaic },
  { key: 'heroes', label: 'Remixed around heroes — your best shots anchor each slide', group: heroes },
  { key: 'twins', label: 'Remixed twins apart — lookalikes split up', group: twinsApart },
  { key: 'chance', label: 'Remixed by pure chance', order: (photos, rnd) => shuffle(photos, rnd).map((p) => p.id) },
]

// Pick a lens (never the same one twice in a row), apply it, and cut slides.
// Returns { key, label, groups } — groups always contain every photo exactly
// once (the DP regrouper is capacity-clamped the same way import is).
export function remixPlan(photosList, getPhoto, { avoid, seed } = {}) {
  const rnd = mulberry32(seed ?? (Math.random() * 0xffffffff) >>> 0)
  // same ceiling the import pipeline applies — anything past it stays off-slide
  const list = photosList.slice(0, MAX_SLIDES * HARD_MAX_PER_SLIDE)
  const pool = LENSES.filter((l) => l.key !== avoid)
  const lens = pool[Math.floor(rnd() * pool.length)]
  if (lens.group) {
    const { groups } = lens.group(list, rnd, getPhoto)
    return { key: lens.key, label: lens.label, groups }
  }
  const orderedIds = lens.order(list, rnd)
  const { groups } = groupPhotosAuto(orderedIds, getPhoto)
  return { key: lens.key, label: lens.label, groups }
}

export const REMIX_LENSES = LENSES.map((l) => l.key)

// test hook: run one specific lens deterministically
export function remixWith(key, photosList, getPhoto, seed = 1) {
  const rnd = mulberry32(seed)
  const lens = LENSES.find((l) => l.key === key)
  if (lens.group) return lens.group(photosList, rnd, getPhoto).groups
  const { groups } = groupPhotosAuto(lens.order(photosList, rnd), getPhoto)
  return groups
}
