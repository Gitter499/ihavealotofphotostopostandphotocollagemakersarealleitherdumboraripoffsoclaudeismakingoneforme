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
export default function SlideCanvas({ slide, layout, photos, canvasW, canvasH, bg, imagesOverride, tilt, radius, animKey, onPhotoPointerDown }) {
  const ref = useRef(null)
  const lastAnimKey = useRef(null)
  const shownRects = useRef(null) // Map id → rect currently on screen

  useEffect(() => {
    const canvas = ref.current
    const scale = BACKING_W / canvasW
    const bw = BACKING_W
    const bh = Math.round(canvasH * scale)
    if (canvas.width !== bw) canvas.width = bw
    if (canvas.height !== bh) canvas.height = bh
    const ctx = canvas.getContext('2d')
    const images = new Map()
    const neededIds = [...slide.photoIds, ...(layout.bridges ?? []).map((b) => b.id)]
    for (const id of neededIds) {
      const p = photos.get(id)
      const bmp = imagesOverride?.get(id) ?? p?.previewBitmap
      if (bmp) images.set(id, bmp)
    }
    const draw = (rects, progressOf) => {
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      drawSlide(ctx, {
        width: canvasW,
        height: canvasH,
        bg,
        photoIds: slide.photoIds,
        rects,
        images,
        progressOf,
        tilt,
        radius,
        bridges: layout.bridges ?? [],
      })
      // remember what is actually on screen so an interrupted morph
      // continues from where it is instead of jumping
      shownRects.current = new Map(slide.photoIds.map((id, i) => [id, rects[i]]).filter(([, r]) => r))
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const keyChanged = animKey !== lastAnimKey.current
    lastAnimKey.current = animKey

    const prev = shownRects.current
    const morphIds = slide.photoIds.filter((_, i) => layout.rects[i])
    const canMorph = prev && morphIds.length > 0 && morphIds.every((id) => prev.has(id))
    let raf

    if (reduced || !keyChanged) {
      draw(layout.rects)
      return
    }

    if (canMorph) {
      // FLIP: interpolate every photo from where it was to where it belongs
      const from = slide.photoIds.map((id) => prev.get(id) ?? null)
      const t0 = performance.now()
      const tick = (t) => {
        const raw = Math.min(1, (t - t0) / MORPH_MS)
        const e = easeOut(raw)
        draw(slide.photoIds.map((_, i) => (from[i] && layout.rects[i] ? lerpRect(from[i], layout.rects[i], e) : layout.rects[i])))
        if (raw < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    }

    // entrance: staggered settle
    const { totalMs, progressAt } = makeStagger(slide.photoIds.length)
    const t0 = performance.now()
    const tick = (t) => {
      const elapsed = t - t0
      draw(layout.rects, (i) => progressAt(elapsed, i))
      if (elapsed < totalMs) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [slide, layout, photos, canvasW, canvasH, bg, imagesOverride, tilt, radius, animKey])

  const handlePointerDown = (e) => {
    if (!onPhotoPointerDown) return
    const box = ref.current.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * canvasW
    const y = ((e.clientY - box.top) / box.height) * canvasH
    for (let i = 0; i < layout.rects.length; i++) {
      const r = layout.rects[i]
      if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        onPhotoPointerDown(e, slide.photoIds[i])
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
