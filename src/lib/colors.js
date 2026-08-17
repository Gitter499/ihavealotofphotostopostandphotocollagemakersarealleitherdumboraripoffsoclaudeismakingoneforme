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
