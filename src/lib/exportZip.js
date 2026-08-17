// Full-resolution export. Slides render one at a time — each slide decodes
// only its own photos from their stored (≤2160px) blobs, draws at Instagram's
// maximum accepted resolution (1440 wide — layout space is 1080, scaled ×4/3
// at render time), encodes to JPEG 0.95, then releases the bitmaps. Keeps
// peak memory flat regardless of photo count.

const EXPORT_SCALE = 4 / 3 // 1080×1350 layout space → 1440×1800 pixels
const EXPORT_QUALITY = 0.95

import JSZip from 'jszip'
import { drawSlide } from './render.js'
import { matrixFor, applyMatrix, withStrength } from './filters.js'

async function decodeFull(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    return await createImageBitmap(blob)
  }
}

// Full-size decode with the look's colour matrix baked in (Safari-safe).
async function decodeFiltered(photo, look, strength = 1) {
  const bmp = await decodeFull(photo.blob)
  const m = withStrength(matrixFor(photo, look), strength)
  if (!m) return bmp
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  applyMatrix(imageData.data, m)
  ctx.putImageData(imageData, 0, 0)
  return canvas
}

export async function renderSlideBlob(
  slide,
  layout,
  photosById,
  { width, height, bg, look, lookStrength = 1, tilt = 0, radius = 0, border = null, caption = null, format = 'jpeg' },
) {
  const images = new Map()
  const focals = new Map()
  const rects = layout.rects
  const bridges = layout.bridges ?? []
  try {
    const neededIds = [...new Set([...slide.photoIds, ...bridges.map((b) => b.id)])]
    await Promise.all(
      neededIds.map(async (id) => {
        const photo = photosById.get(id)
        if (!photo) return
        images.set(id, await decodeFiltered(photo, look, lookStrength))
        if (photo.focal) focals.set(id, photo.focal)
      }),
    )
    const canvas = new OffscreenCanvas(Math.round(width * EXPORT_SCALE), Math.round(height * EXPORT_SCALE))
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.scale(EXPORT_SCALE, EXPORT_SCALE)
    drawSlide(ctx, { width, height, bg, photoIds: slide.photoIds, rects, images, tilt, radius, bridges, focals, border, caption })
    return format === 'png'
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await canvas.convertToBlob({ type: 'image/jpeg', quality: EXPORT_QUALITY })
  } finally {
    for (const img of images.values()) img.close?.()
  }
}

export function slideFileName(index, format = 'jpeg') {
  return String(index + 1).padStart(2, '0') + (format === 'png' ? '.png' : '.jpg')
}

export async function exportAllAsZip(
  slides,
  layouts,
  photosById,
  { width, height, bgs, look, lookStrength, tilt, radius, border, captions, format },
  onProgress,
) {
  const zip = new JSZip()
  for (let i = 0; i < slides.length; i++) {
    onProgress?.(i, slides.length)
    const blob = await renderSlideBlob(slides[i], layouts[i], photosById, {
      width,
      height,
      bg: bgs[i],
      look,
      lookStrength,
      tilt,
      radius,
      border,
      caption: captions?.get(slides[i].key) ?? null,
      format,
    })
    zip.file(slideFileName(i, format), blob)
  }
  onProgress?.(slides.length, slides.length)
  return zip.generateAsync({ type: 'blob' })
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
