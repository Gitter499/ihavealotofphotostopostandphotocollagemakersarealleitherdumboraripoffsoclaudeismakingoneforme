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

// Bake a photo's orientation into a new drawable: `rot` clockwise quarter
// turns, then `flip` mirrors horizontally. Previews, filtered bitmaps and
// full-res exports all pass through this so every surface agrees.
export function orientBitmap(img, rot = 0, flip = false) {
  rot = ((rot % 4) + 4) % 4
  if (!rot && !flip) return img
  const odd = rot % 2 === 1
  const w = odd ? img.height : img.width
  const h = odd ? img.width : img.height
  const c = new OffscreenCanvas(w, h)
  const x = c.getContext('2d')
  if (flip) {
    x.translate(w, 0)
    x.scale(-1, 1)
  }
  x.translate(w / 2, h / 2)
  x.rotate((rot * Math.PI) / 2)
  x.drawImage(img, -img.width / 2, -img.height / 2)
  return c
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
  { progress = 1, spin = 0, angle = 0, radius = 0, frame = false, pip = false, focal = null, border = null } = {},
) {
  const iw = img.width
  const ih = img.height
  if (!iw || !ih || rect.w <= 0 || rect.h <= 0) return
  const e = progress >= 1 ? 1 : easeOutCubic(progress)
  const grow = progress >= 1 ? 1 : 1 - 0.06 * (1 - e)
  const dw = rect.w * grow
  const dh = rect.h * grow
  const rotation = angle + (spin ? spin * (1 - e) : 0)

  if (e >= 1 && !rotation && !radius && !frame && !pip) {
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
  if (frame || pip) {
    // paper mat under the photo — polaroid chin for frames, an even white
    // border for floating picture-in-picture insets
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
    ctx.shadowBlur = 22
    ctx.shadowOffsetY = 8
    ctx.fillStyle = pip ? '#ffffff' : '#f6f4ef'
    ctx.fillRect(px, py, dw, dh)
    ctx.shadowColor = 'transparent'
    const m = Math.min(dw, dh) * (pip ? 0.035 : 0.05)
    px += m
    py += m
    pw -= 2 * m
    ph -= 2 * m + (pip ? 0 : m * 1.6)
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

const TEXT_FONT = (size) => `700 ${size}px 'Bricolage Grotesque', -apple-system, 'Helvetica Neue', sans-serif`

// A free text box: centred at (x, y) in 0..1 canvas fractions, size relative
// to canvas width, any colour, and an optional curve that bends the baseline
// into an arc (positive arches up, negative bowls down). Multi-line via \n.
function drawTextBox(ctx, width, height, t) {
  const text = (t.text ?? '').trimEnd()
  if (!text.trim()) return
  const size = Math.max(8, Math.round(width * (t.size ?? 0.07)))
  const lines = text.split('\n')
  const lineH = size * 1.15
  ctx.save()
  ctx.font = TEXT_FONT(size)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = t.color || '#ffffff'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = size * 0.18
  ctx.shadowOffsetY = 2
  const cx = t.x * width
  const y0 = t.y * height - ((lines.length - 1) * lineH) / 2
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const py = y0 + i * lineH
    const bend = t.curve ?? 0
    if (Math.abs(bend) < 0.04 || !line.trim()) {
      ctx.fillText(line, cx, py)
      continue
    }
    // chars walk an arc: radius from the text length and the bend's span
    const chars = [...line]
    const widths = chars.map((c) => ctx.measureText(c).width)
    const total = widths.reduce((a, b) => a + b, 0) || 1
    const span = bend * 2.4
    const R = total / Math.abs(span)
    const dir = span > 0 ? 1 : -1
    ctx.save()
    ctx.translate(cx, py + dir * R)
    let ang = -Math.abs(span) / 2
    for (let j = 0; j < chars.length; j++) {
      ang += widths[j] / (2 * R)
      ctx.save()
      ctx.rotate(dir * ang)
      ctx.fillText(chars[j], 0, -dir * R)
      ctx.restore()
      ang += widths[j] / (2 * R)
    }
    ctx.restore()
  }
  ctx.restore()
}

// Generous bounding box for hit-testing a text box, in canvas units.
export function textBoxRect(ctx, width, height, t) {
  const size = Math.max(8, Math.round(width * (t.size ?? 0.07)))
  const lines = (t.text ?? '').split('\n')
  ctx.save()
  ctx.font = TEXT_FONT(size)
  const w = Math.max(size, ...lines.map((l) => ctx.measureText(l).width))
  ctx.restore()
  const h = lines.length * size * 1.15 + Math.abs(t.curve ?? 0) * w * 0.3
  const pad = size * 0.25
  return { x: t.x * width - w / 2 - pad, y: t.y * height - h / 2 - pad, w: w + 2 * pad, h: h + 2 * pad }
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

// slide: { photoIds }, rects aligned with photoIds, images: Map id → drawable.
// progressOf: optional (index) → 0..1 for the compose animation.
// tilt (deg) leans each photo by its deterministic angle (a template cell's
// own rot/frame win); radius rounds corners; focals: Map id → {x,y} slides
// each crop toward its subject. Rects may extend past the canvas (merged
// groups share cells across the cut) — the canvas clips them naturally.
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
    focals = null,
    border = null,
    caption = null,
    texts = [],
  },
) {
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
      spin: p < 1 ? (i % 2 ? 1 : -1) * 0.05 : 0,
      angle: rect.pip ? 0 : (rect.rot ?? tiltAngle(photoIds[i], tilt)),
      radius: rect.frame || rect.pip ? 0 : radius,
      frame: !!rect.frame,
      pip: !!rect.pip,
      focal: focals?.get(photoIds[i]) ?? null,
      border: rect.pip ? null : border,
    })
  }
  if (caption) drawCaption(ctx, width, height, caption)
  for (const t of texts) drawTextBox(ctx, width, height, t)
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

// Geometry interpolates; the target's extras (rot, frame) ride along so a
// morph into a polaroid keeps its mat and lean for every frame.
export function lerpRect(a, b, t) {
  return {
    ...b,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  }
}
