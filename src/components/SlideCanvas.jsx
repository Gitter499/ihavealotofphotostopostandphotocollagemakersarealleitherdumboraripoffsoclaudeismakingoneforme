import { useEffect, useRef } from 'react'
import { drawSlide, makeStagger } from '../lib/render.js'

const BACKING_W = 640

// Preview canvas for one slide. Handles the compose animation (staggered
// settle, ≤800ms, skipped under prefers-reduced-motion) and pointer-down hit
// testing so photos can be dragged out to another slide.
export default function SlideCanvas({ slide, layout, photos, canvasW, canvasH, bg, animKey, onPhotoPointerDown }) {
  const ref = useRef(null)
  const lastAnimKey = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    const scale = BACKING_W / canvasW
    const bw = BACKING_W
    const bh = Math.round(canvasH * scale)
    if (canvas.width !== bw) canvas.width = bw
    if (canvas.height !== bh) canvas.height = bh
    const ctx = canvas.getContext('2d')
    const images = new Map()
    for (const id of slide.photoIds) {
      const p = photos.get(id)
      if (p?.previewBitmap) images.set(id, p.previewBitmap)
    }
    const draw = (progressOf) => {
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      drawSlide(ctx, { width: canvasW, height: canvasH, bg, photoIds: slide.photoIds, rects: layout.rects, images, progressOf })
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const shouldAnimate = animKey !== lastAnimKey.current && !reduced
    lastAnimKey.current = animKey
    if (!shouldAnimate) {
      draw()
      return
    }
    const { totalMs, progressAt } = makeStagger(slide.photoIds.length)
    let raf
    const t0 = performance.now()
    const tick = (t) => {
      const elapsed = t - t0
      draw((i) => progressAt(elapsed, i))
      if (elapsed < totalMs) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [slide, layout, photos, canvasW, canvasH, bg, animKey])

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
