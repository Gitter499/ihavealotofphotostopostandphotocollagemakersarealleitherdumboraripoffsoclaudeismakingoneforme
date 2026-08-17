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

// Cover-fit crop window, slid toward the photo's focal point (saliency —
// see worker.js) instead of blindly centring, then clamped to the frame.
export function coverCrop(iw, ih, ra, focal) {
  let sw, sh
  if (iw / ih > ra) {
    sh = ih
    sw = ih * ra
  } else {
    sw = iw
    sh = iw / ra
  }
  const sx = Math.min(Math.max((focal?.x ?? 0.5) * iw - sw / 2, 0), iw - sw)
  const sy = Math.min(Math.max((focal?.y ?? 0.5) * ih - sh / 2, 0), ih - sh)
  return { sx, sy, sw, sh }
}

// progress < 1 draws the entrance settle: fade + slight grow + a whisper of
// spin (alternating sign per photo) that rights itself as the photo lands.
// `angle` is the standing tilt (template cells carry their own); `radius`
// rounds corners; `frame` mats the photo on paper, polaroid-style, with a
// deeper chin at the bottom. Filters are pre-baked into the bitmaps
// (see filters.js) — no ctx.filter, which Safari doesn't support.
function drawCover(
  ctx,
  img,
  rect,
  { progress = 1, spin = 0, angle = 0, radius = 0, frame = false, focal = null, border = null } = {},
) {
  const iw = img.width
  const ih = img.height
  if (!iw || !ih || rect.w <= 0 || rect.h <= 0) return
  const e = progress >= 1 ? 1 : easeOutCubic(progress)
  const grow = progress >= 1 ? 1 : 1 - 0.06 * (1 - e)
  const dw = rect.w * grow
  const dh = rect.h * grow
  const rotation = angle + (spin ? spin * (1 - e) : 0)

  if (e >= 1 && !rotation && !radius && !frame) {
    const { sx, sy, sw, sh } = coverCrop(iw, ih, rect.w / rect.h, focal)
    ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h)
    if (border?.width) strokeBorder(ctx, rect.x, rect.y, rect.w, rect.h, 0, border)
    return
  }
  ctx.save()
  ctx.globalAlpha = e
  ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2)
  if (rotation) ctx.rotate(rotation)
  let px = -dw / 2
  let py = -dh / 2
  let pw = dw
  let ph = dh
  if (frame) {
    // paper mat under the photo, deeper chin at the bottom — polaroid
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
    ctx.shadowBlur = 22
    ctx.shadowOffsetY = 8
    ctx.fillStyle = '#f6f4ef'
    ctx.fillRect(px, py, dw, dh)
    ctx.shadowColor = 'transparent'
    const m = Math.min(dw, dh) * 0.05
    px += m
    py += m
    pw -= 2 * m
    ph -= 2 * m + m * 1.6
  } else if (radius > 0) {
    roundedRectPath(ctx, px, py, pw, ph, radius)
    ctx.clip()
  }
  const { sx, sy, sw, sh } = coverCrop(iw, ih, pw / ph, focal)
  ctx.drawImage(img, sx, sy, sw, sh, px, py, pw, ph)
  if (border?.width && !frame) strokeBorder(ctx, px, py, pw, ph, radius, border)
  ctx.restore()
}

// Border styles are pure canvas strokes — solid, a fine double line, or a
// hand-tick dashed edge — inset so the stroke never bleeds outside the photo.
function strokeBorder(ctx, x, y, w, h, radius, border) {
  const bw = border.width
  ctx.save()
  ctx.strokeStyle = border.color
  ctx.setLineDash(border.style === 'dashed' ? [bw * 2.4, bw * 1.8] : [])
  const line = (inset, width) => {
    ctx.lineWidth = width
    if (radius > 0) {
      roundedRectPath(ctx, x + inset, y + inset, w - 2 * inset, h - 2 * inset, Math.max(1, radius - inset))
      ctx.stroke()
    } else {
      ctx.strokeRect(x + inset, y + inset, w - 2 * inset, h - 2 * inset)
    }
  }
  if (border.style === 'double') {
    const t = Math.max(1, bw / 3)
    line(t / 2, t)
    line(bw * 1.6, t)
  } else {
    line(bw / 2, bw)
  }
  ctx.restore()
}

// Slide caption: display type over a soft scrim so it reads on any photo.
// Wraps to at most two lines; pos is 'top' or 'bottom'.
function drawCaption(ctx, width, height, caption) {
  const text = caption?.text?.trim()
  if (!text) return
  const size = Math.round(width * 0.055)
  ctx.save()
  ctx.font = `700 ${size}px 'Bricolage Grotesque', -apple-system, 'Helvetica Neue', sans-serif`
  ctx.textAlign = 'center'
  const maxW = width * 0.86
  const words = text.split(/\s+/)
  const lines = ['']
  for (const w of words) {
    const probe = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w
    if (ctx.measureText(probe).width <= maxW || !lines[lines.length - 1]) lines[lines.length - 1] = probe
    else if (lines.length < 2) lines.push(w)
    else {
      lines[1] = `${lines[1]} ${w}`
    }
  }
  const lineH = size * 1.2
  const pad = size * 1.1
  const blockH = lines.length * lineH + pad * 2
  const top = caption.pos === 'top'
  const grad = ctx.createLinearGradient(0, top ? 0 : height - blockH * 1.5, 0, top ? blockH * 1.5 : height)
  grad.addColorStop(top ? 0 : 1, 'rgba(0, 0, 0, 0.55)')
  grad.addColorStop(top ? 1 : 0, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, top ? 0 : height - blockH * 1.5, width, blockH * 1.5)
  ctx.fillStyle = '#fff'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 2
  lines.forEach((line, i) => {
    const y = top ? pad + (i + 0.8) * lineH : height - pad - (lines.length - 1 - i + 0.25) * lineH
    ctx.fillText(line, width / 2, y)
  })
  ctx.restore()
}

// A bridge photo spans the seam between two slides: its crop continues
// pixel-perfectly from the right strip of one slide into the left strip of
// the next, so swiping the carousel reads as one continuous image.
// `half` picks which half of the combined crop this slide shows. Bridges are
// drawn edge-to-edge, without tilt or rounding — the seam must touch.
function drawBridge(ctx, img, rect, half, focal) {
  const iw = img.width
  const ih = img.height
  if (!iw || !ih || rect.w <= 0 || rect.h <= 0) return
  const crop = coverCrop(iw, ih, (rect.w * 2) / rect.h, focal)
  const sx = crop.sx + (half === 'right' ? crop.sw / 2 : 0)
  ctx.drawImage(img, sx, crop.sy, crop.sw / 2, crop.sh, rect.x, rect.y, rect.w, rect.h)
}

// slide: { photoIds }, rects aligned with photoIds, images: Map id → drawable.
// progressOf: optional (index) → 0..1 for the compose animation.
// tilt (deg) leans each photo by its deterministic angle (a template cell's
// own rot/frame win); radius rounds corners; focals: Map id → {x,y} slides
// each crop toward its subject.
export function drawSlide(
  ctx,
  {
    width,
    height,
    bg,
    photoIds,
    rects,
    images,
    progressOf,
    tilt = 0,
    radius = 0,
    bridges = [],
    focals = null,
    border = null,
    caption = null,
  },
) {
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)
  for (const b of bridges) {
    const img = images.get(b.id)
    if (img) drawBridge(ctx, img, b.rect, b.half, focals?.get(b.id))
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
      angle: rect.rot ?? tiltAngle(photoIds[i], tilt),
      radius: rect.frame ? 0 : radius,
      frame: !!rect.frame,
      focal: focals?.get(photoIds[i]) ?? null,
      border,
    })
  }
  if (caption) drawCaption(ctx, width, height, caption)
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
