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

// Full grouping pipeline: sorted photo ids → array of id groups + notice.
export function groupPhotos(sortedIds, aspectOf, perSlide) {
  const { sizes, included, notice } = planSizes(sortedIds.length, perSlide)
  const groups = []
  let cursor = 0
  for (const size of sizes) {
    groups.push(sortedIds.slice(cursor, cursor + size))
    cursor += size
  }
  balanceOrientations(groups, aspectOf)
  return { groups, excluded: sortedIds.slice(included), notice }
}
