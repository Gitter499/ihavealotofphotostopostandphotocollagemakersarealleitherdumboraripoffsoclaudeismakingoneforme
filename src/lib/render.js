// Shared slide compositor — used for on-screen previews (scaled ctx) and
// full-resolution export. Rects live in canvas space (e.g. 1080×1350).

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

const supportsFilter = (ctx) => 'filter' in ctx

// progress < 1 draws the entrance settle: fade + slight grow + a whisper of
// spin (alternating sign per photo) that rights itself as the photo lands.
export function drawCover(ctx, img, rect, { progress = 1, filter = null, spin = 0 } = {}) {
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

  const useFilter = filter && supportsFilter(ctx)
  if (progress >= 1) {
    if (useFilter) ctx.filter = filter
    ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h)
    if (useFilter) ctx.filter = 'none'
    return
  }
  const e = easeOutCubic(progress)
  const grow = 1 - 0.06 * (1 - e)
  const dw = rect.w * grow
  const dh = rect.h * grow
  ctx.save()
  ctx.globalAlpha = e
  if (useFilter) ctx.filter = filter
  if (spin) {
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2)
    ctx.rotate(spin * (1 - e))
    ctx.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh)
  } else {
    ctx.drawImage(img, sx, sy, sw, sh, rect.x + (rect.w - dw) / 2, rect.y + (rect.h - dh) / 2, dw, dh)
  }
  ctx.restore()
}

// slide: { photoIds }, rects aligned with photoIds, images: Map id → drawable.
// progressOf: optional (index) → 0..1 for the compose animation.
// filterOf: optional (index) → CSS filter string or null.
export function drawSlide(ctx, { width, height, bg, photoIds, rects, images, progressOf, filterOf }) {
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)
  for (let i = 0; i < photoIds.length; i++) {
    const rect = rects[i]
    const img = images.get(photoIds[i])
    if (!rect || !img) continue
    const p = progressOf ? progressOf(i) : 1
    if (p <= 0) continue
    drawCover(ctx, img, rect, {
      progress: p,
      filter: filterOf ? filterOf(i) : null,
      spin: p < 1 ? (i % 2 ? 1 : -1) * 0.05 : 0,
    })
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

export const easeOut = easeOutCubic

export function lerpRect(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  }
}
