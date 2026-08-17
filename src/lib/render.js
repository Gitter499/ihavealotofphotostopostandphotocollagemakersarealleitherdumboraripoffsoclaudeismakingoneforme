// Shared slide compositor — used for on-screen previews (scaled ctx) and
// full-resolution export. Rects live in canvas space (e.g. 1080×1350).

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

// Deterministic per-photo tilt: each photo leans its own way, scaled by the
// user's tilt setting (degrees). Same id + setting → same angle everywhere,
// preview and export alike.
export function tiltAngle(photoId, tiltDeg) {
  if (!tiltDeg) return 0
  const h = (photoId * 2654435761) >>> 0
  const unit = ((h % 1000) / 999) * 2 - 1 // -1..1
  return ((unit * tiltDeg) * Math.PI) / 180
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

// progress < 1 draws the entrance settle: fade + slight grow + a whisper of
// spin (alternating sign per photo) that rights itself as the photo lands.
// `angle` is the user's standing tilt; `radius` rounds the photo's corners.
// Filters are pre-baked into the bitmaps (see filters.js) — no ctx.filter,
// which Safari doesn't support.
function drawCover(ctx, img, rect, { progress = 1, spin = 0, angle = 0, radius = 0 } = {}) {
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

  const e = progress >= 1 ? 1 : easeOutCubic(progress)
  const grow = progress >= 1 ? 1 : 1 - 0.06 * (1 - e)
  const dw = rect.w * grow
  const dh = rect.h * grow
  const rotation = angle + (spin ? spin * (1 - e) : 0)

  if (e >= 1 && !rotation && !radius) {
    ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h)
    return
  }
  ctx.save()
  ctx.globalAlpha = e
  ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2)
  if (rotation) ctx.rotate(rotation)
  if (radius > 0) {
    roundedRectPath(ctx, -dw / 2, -dh / 2, dw, dh, radius)
    ctx.clip()
  }
  ctx.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh)
  ctx.restore()
}

// A bridge photo spans the seam between two slides: its crop continues
// pixel-perfectly from the right strip of one slide into the left strip of
// the next, so swiping the carousel reads as one continuous image.
// `half` picks which half of the combined crop this slide shows. Bridges are
// drawn edge-to-edge, without tilt or rounding — the seam must touch.
function drawBridge(ctx, img, rect, half) {
  const iw = img.width
  const ih = img.height
  if (!iw || !ih || rect.w <= 0 || rect.h <= 0) return
  const combinedAspect = (rect.w * 2) / rect.h
  const pa = iw / ih
  let sw, sh
  if (pa > combinedAspect) {
    sh = ih
    sw = ih * combinedAspect
  } else {
    sw = iw
    sh = iw / combinedAspect
  }
  const sx = (iw - sw) / 2 + (half === 'right' ? sw / 2 : 0)
  const sy = (ih - sh) / 2
  ctx.drawImage(img, sx, sy, sw / 2, sh, rect.x, rect.y, rect.w, rect.h)
}

// slide: { photoIds }, rects aligned with photoIds, images: Map id → drawable.
// progressOf: optional (index) → 0..1 for the compose animation.
// tilt (deg) leans each photo by its deterministic angle; radius rounds corners.
export function drawSlide(ctx, { width, height, bg, photoIds, rects, images, progressOf, tilt = 0, radius = 0, bridges = [] }) {
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)
  for (const b of bridges) {
    const img = images.get(b.id)
    if (img) drawBridge(ctx, img, b.rect, b.half)
  }
  for (let i = 0; i < photoIds.length; i++) {
    const rect = rects[i]
    const img = images.get(photoIds[i])
    if (!rect || !img) continue
    const p = progressOf ? progressOf(i) : 1
    if (p <= 0) continue
    drawCover(ctx, img, rect, {
      progress: p,
      spin: p < 1 ? (i % 2 ? 1 : -1) * 0.05 : 0,
      angle: tiltAngle(photoIds[i], tilt),
      radius,
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
