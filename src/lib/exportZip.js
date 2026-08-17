// Full-resolution export. Slides render one at a time — each slide decodes
// only its own photos from their stored (≤2160px) blobs, draws at full canvas
// size, encodes to JPEG 0.92, then releases the bitmaps. Keeps peak memory
// flat regardless of photo count.

import JSZip from 'jszip'
import { drawSlide } from './render.js'

async function decodeFull(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    return await createImageBitmap(blob)
  }
}

export async function renderSlideBlob(slide, rects, photosById, { width, height, bg }) {
  const images = new Map()
  try {
    await Promise.all(
      slide.photoIds.map(async (id) => {
        const photo = photosById.get(id)
        if (photo) images.set(id, await decodeFull(photo.blob))
      }),
    )
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    drawSlide(ctx, { width, height, bg, photoIds: slide.photoIds, rects, images })
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
  } finally {
    for (const img of images.values()) img.close()
  }
}

export function slideFileName(index) {
  return String(index + 1).padStart(2, '0') + '.jpg'
}

export async function exportAllAsZip(slides, layouts, photosById, { width, height, bgs }, onProgress) {
  const zip = new JSZip()
  for (let i = 0; i < slides.length; i++) {
    onProgress?.(i, slides.length)
    const blob = await renderSlideBlob(slides[i], layouts[i].rects, photosById, { width, height, bg: bgs[i] })
    zip.file(slideFileName(i), blob)
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
