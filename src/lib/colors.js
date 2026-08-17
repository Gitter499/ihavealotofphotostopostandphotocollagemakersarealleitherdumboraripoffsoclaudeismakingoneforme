// "Auto" background: the average colour of the slide's own photos, pulled
// toward dark so gutters stay quiet behind the images.

let scratch = null

export function averageColor(bitmaps) {
  if (bitmaps.length === 0) return '#131313'
  if (!scratch) scratch = document.createElement('canvas')
  const size = 8
  scratch.width = size
  scratch.height = size
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (const bmp of bitmaps) {
    if (!bmp) continue
    ctx.drawImage(bmp, 0, 0, size, size)
    const data = ctx.getImageData(0, 0, size, size).data
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      n++
    }
  }
  if (n === 0) return '#131313'
  // darken so photos stay the brightest thing on the slide
  const k = 0.38
  const toHex = (v) => Math.round((v / n) * k).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// Ambient light colour drawn from a photo: its average hue, pushed to a
// saturation and lightness that reads as coloured light rather than mud.
// This is what the interface glass refracts once photos are loaded.
export function ambientFrom(bitmap) {
  if (!bitmap) return null
  if (!scratch) scratch = document.createElement('canvas')
  scratch.width = 1
  scratch.height = 1
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const l = (max + min) / 2
  let h = 0
  if (max !== min) {
    const d = max - min
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    else if (max === gn) h = ((bn - rn) / d + 2) / 6
    else h = ((rn - gn) / d + 4) / 6
  }
  return `hsl(${Math.round(h * 360)} 62% ${Math.round(Math.min(0.62, Math.max(0.45, l)) * 100)}%)`
}
