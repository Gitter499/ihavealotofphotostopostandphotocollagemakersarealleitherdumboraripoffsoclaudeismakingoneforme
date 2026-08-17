// Shared slide compositor — used for on-screen previews (scaled ctx) and
// full-resolution export. Rects live in canvas space (e.g. 1080×1350).

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

export function drawCover(ctx, img, rect, progress = 1) {
  const iw = img.width
  const ih = img.height
  if (!iw || !ih || rect.w <= 0 || rect.h <= 0) return
  const ra = rect.w / rect.h
  const pa = iw / ih
  let sw, sh
  if (pa > ra) {
    sh = ih
    sw = ih * ra
  } else {
    sw = iw
    sh = iw / ra
  }
  const sx = (iw - sw) / 2
  const sy = (ih - sh) / 2
  if (progress >= 1) {
    ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h)
    return
  }
  const e = easeOutCubic(progress)
  const grow = 1 - 0.06 * (1 - e)
  const dw = rect.w * grow
  const dh = rect.h * grow
  ctx.save()
  ctx.globalAlpha = e
  ctx.drawImage(img, sx, sy, sw, sh, rect.x + (rect.w - dw) / 2, rect.y + (rect.h - dh) / 2, dw, dh)
  ctx.restore()
}

// slide: { photoIds }, rects aligned with photoIds, images: Map id → drawable.
// progressOf: optional (index) → 0..1 for the compose animation.
export function drawSlide(ctx, { width, height, bg, photoIds, rects, images, progressOf }) {
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)
  for (let i = 0; i < photoIds.length; i++) {
    const rect = rects[i]
    const img = images.get(photoIds[i])
    if (!rect || !img) continue
    const p = progressOf ? progressOf(i) : 1
    if (p <= 0) continue
    drawCover(ctx, img, rect, p)
  }
}

// Per-photo animation timing: staggered settle, total run ≤ ~800ms.
export function makeStagger(count, totalMs = 800, durMs = 380) {
  const stagger = count > 1 ? Math.min(70, (totalMs - durMs) / (count - 1)) : 0
  return {
    totalMs: durMs + stagger * Math.max(0, count - 1),
    progressAt(elapsed, index) {
      return Math.min(1, Math.max(0, (elapsed - index * stagger) / durMs))
    },
  }
}
