import { useEffect, useRef } from 'react'
import { drawSlide, makeStagger, easeOut, lerpRect } from '../lib/render.js'

const BACKING_W = 640
const MORPH_MS = 420

// Preview canvas for one slide. Three draw modes:
//  - entrance: staggered settle (≤800ms) the first time photos appear
//  - morph: photos glide/resize from their old rects to the new layout
//    (shuffle, gutter, aspect changes) — FLIP on canvas
//  - static: plain redraw (filter/background changes)
// All motion collapses to a static draw under prefers-reduced-motion.
//
// In a merged group the layout supplies drawIds/drawRects: every group cell
// near this slide's window, in local coordinates. Cells crossing the cut
// clip at the canvas edge and continue on the neighbouring slide.
export default function SlideCanvas({
  slide,
  layout,
  photos,
  canvasW,
  canvasH,
  bg,
  imagesOverride,
  tilt,
  radius,
  border,
  caption,
  animKey,
  onPhotoPointerDown,
}) {
  const ref = useRef(null)
  const lastAnimKey = useRef(null)
  const shownRects = useRef(null) // Map id → rect currently on screen

  const ids = layout.drawIds ?? slide.photoIds
  const rects = layout.drawRects ?? layout.rects

  useEffect(() => {
    const canvas = ref.current
    const scale = BACKING_W / canvasW
    const bw = BACKING_W
    const bh = Math.round(canvasH * scale)
    if (canvas.width !== bw) canvas.width = bw
    if (canvas.height !== bh) canvas.height = bh
    const ctx = canvas.getContext('2d')
    const images = new Map()
    const focals = new Map()
    for (const id of ids) {
      const p = photos.get(id)
      const bmp = imagesOverride?.get(id) ?? p?.previewBitmap
      if (bmp) images.set(id, bmp)
      if (p?.focal) focals.set(id, p.focal)
    }
    const draw = (frameRects, progressOf) => {
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      drawSlide(ctx, {
        width: canvasW,
        height: canvasH,
        bg,
        photoIds: ids,
        rects: frameRects,
        images,
        progressOf,
        tilt,
        radius,
        focals,
        border,
        caption,
      })
      // remember what is actually on screen so an interrupted morph
      // continues from where it is instead of jumping
      shownRects.current = new Map(ids.map((id, i) => [id, frameRects[i]]).filter(([, r]) => r))
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const keyChanged = animKey !== lastAnimKey.current
    lastAnimKey.current = animKey

    const prev = shownRects.current
    const morphIds = ids.filter((_, i) => rects[i])
    // FLIP for every cell that was already on screen; cells arriving from a
    // neighbour (mesh toggled, photo moved) fade in alongside the glide
    const canMorph = prev && morphIds.length > 0 && morphIds.some((id) => prev.has(id))
    let raf

    if (reduced || !keyChanged) {
      draw(rects)
      return
    }

    if (canMorph) {
      const from = ids.map((id) => prev.get(id) ?? null)
      const t0 = performance.now()
      const tick = (t) => {
        const raw = Math.min(1, (t - t0) / MORPH_MS)
        const e = easeOut(raw)
        draw(
          ids.map((_, i) => (from[i] && rects[i] ? lerpRect(from[i], rects[i], e) : rects[i])),
          (i) => (from[i] ? 1 : e),
        )
        if (raw < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    }

    // entrance: staggered settle
    const { totalMs, progressAt } = makeStagger(ids.length)
    const t0 = performance.now()
    const tick = (t) => {
      const elapsed = t - t0
      draw(rects, (i) => progressAt(elapsed, i))
      if (elapsed < totalMs) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [slide, layout, photos, canvasW, canvasH, bg, imagesOverride, tilt, radius, border, caption, animKey])

  const handlePointerDown = (e) => {
    if (!onPhotoPointerDown) return
    const box = ref.current.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * canvasW
    const y = ((e.clientY - box.top) / box.height) * canvasH
    // reverse order: overlapping cells draw last-on-top
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i]
      if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        onPhotoPointerDown(e, ids[i])
        return
      }
    }
  }

  // Block scroll only while a drag is actually active (set by App via a data
  // attribute on <body>) so the filmstrip still scrolls normally on touch.
  useEffect(() => {
    const canvas = ref.current
    const onTouchMove = (e) => {
      if (document.body.dataset.dragging === '1') e.preventDefault()
    }
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => canvas.removeEventListener('touchmove', onTouchMove)
  }, [])

  return (
    <canvas
      ref={ref}
      className="slide-canvas"
      style={{ aspectRatio: `${canvasW} / ${canvasH}` }}
      onPointerDown={handlePointerDown}
    />
  )
}
