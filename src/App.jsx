import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { importFiles } from './lib/importer.js'
import {
  sortPhotos,
  groupPhotos,
  groupPhotosAuto,
  effectiveQualities,
  adjustGroupSize,
  MAX_SLIDES,
} from './lib/grouping.js'
import { computeLayout } from './lib/layout.js'
import { averageColor, ambientFrom } from './lib/colors.js'
import { LOOKS, matrixFor, applyMatrix, filteredBitmap } from './lib/filters.js'
import { fireConfetti } from './lib/confetti.js'
import { exportAllAsZip, renderSlideBlob, slideFileName, saveBlob } from './lib/exportZip.js'
import { randomSeed } from './lib/rng.js'
import SlideCanvas from './components/SlideCanvas.jsx'
import Logo from './components/Logo.jsx'

const BG_SWATCHES = [
  { key: 'dark', color: '#0d0d0d', label: 'Near-black' },
  { key: 'light', color: '#f2efe9', label: 'Off-white' },
  { key: 'auto', color: null, label: 'Sampled from photos' },
]

let slideKeyCounter = 1

// Stable per-position base seed so re-grouping (e.g. gutter change) doesn't
// silently reshuffle layouts the user already liked.
const baseSeedFor = (i) => ((i + 1) * 2654435761) >>> 0

export default function App() {
  const [photos, setPhotos] = useState(() => new Map())
  const [slides, setSlides] = useState([])
  const [perSlide, setPerSlide] = useState('auto') // 'auto' | 4..8
  const [gutter, setGutter] = useState(8)
  const [bgMode, setBgMode] = useState('dark')
  const [look, setLook] = useState('auto')
  const [aspect, setAspect] = useState('4:5')
  const [importState, setImportState] = useState(null) // {done, total}
  const [skipped, setSkipped] = useState([])
  const [notice, setNotice] = useState(null)
  const [exportState, setExportState] = useState(null) // {done, total}
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [drag, setDrag] = useState(null) // {photoId, fromKey, x, y, overKey}
  const fileInputRef = useRef(null)
  const dragRef = useRef(null)

  const canvasW = 1080
  const canvasH = aspect === '1:1' ? 1080 : 1350
  const margin = gutter * 2 // gutter 8 → margin 16 (spec defaults); gutter 0 → full bleed

  const recompose = useCallback((photosMap, per) => {
    const sorted = sortPhotos([...photosMap.values()])
    const sortedIds = sorted.map((p) => p.id)
    const { groups, notice } =
      per === 'auto'
        ? groupPhotosAuto(sortedIds, (id) => photosMap.get(id))
        : groupPhotos(sortedIds, (id) => photosMap.get(id), per)
    setNotice(notice)
    setSlides(
      groups.map((ids, i) => ({
        key: `s${slideKeyCounter++}`,
        photoIds: ids,
        seed: baseSeedFor(i),
      })),
    )
  }, [])

  const addFiles = useCallback(
    async (fileList) => {
      const files = [...fileList].filter((f) => f.size > 0)
      if (files.length === 0) return
      setImportState({ done: 0, total: files.length })
      const incoming = []
      await importFiles(files, {
        onPhoto: (photo) => incoming.push(photo),
        onSkip: (name) => setSkipped((s) => [...s, name]),
        onProgress: (done, total) => setImportState({ done, total }),
      })
      setImportState(null)
      if (incoming.length === 0) return
      setPhotos((prev) => {
        const next = new Map(prev)
        for (const p of incoming) next.set(p.id, p)
        recompose(next, perSlide)
        return next
      })
    },
    [perSlide, recompose],
  )

  // Esc closes the options popover.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setOptionsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The popover is non-modal: touching anything outside it — a slide, a
  // photo drag, the canvas — hides the toolbox, and the touch still lands
  // on whatever was touched. The dock and filter strip don't dismiss it.
  useEffect(() => {
    if (!optionsOpen) return
    const onDown = (e) => {
      if (e.target.closest?.('.options-popover') || e.target.closest?.('.bottom-cluster')) return
      setOptionsOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [optionsOpen])

  // Accept drops anywhere on the page.
  useEffect(() => {
    const onDragOver = (e) => e.preventDefault()
    const onDrop = (e) => {
      e.preventDefault()
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [addFiles])

  const handlePerSlide = (per) => {
    setPerSlide(per)
    if (photos.size) recompose(photos, per)
  }

  const handleAspect = (a) => setAspect(a)

  const layouts = useMemo(
    () =>
      slides.map((s) => {
        const eff = effectiveQualities(s.photoIds, (id) => photos.get(id))
        const layout = computeLayout(
          s.photoIds.map((id) => photos.get(id)?.aspect ?? 1),
          {
            canvasW,
            canvasH,
            margin,
            gutter,
            baseSeed: s.seed,
            qualities: s.photoIds.map((id) => eff.get(id) ?? 0.5),
          },
        )
        // user-dragged reorders: the two photos' rects trade places
        if (s.swaps?.length) {
          const rects = [...layout.rects]
          for (const [a, b] of s.swaps) {
            const ia = s.photoIds.indexOf(a)
            const ib = s.photoIds.indexOf(b)
            if (ia >= 0 && ib >= 0) {
              const t = rects[ia]
              rects[ia] = rects[ib]
              rects[ib] = t
            }
          }
          return { ...layout, rects }
        }
        return layout
      }),
    [slides, photos, canvasW, canvasH, margin, gutter],
  )

  const layoutsRef = useRef(layouts)
  layoutsRef.current = layouts
  const slidesRef = useRef(slides)
  slidesRef.current = slides

  // Filtered preview bitmaps for the active look. Built off the originals
  // with colour-matrix math (works everywhere, unlike ctx.filter) and cached
  // per photo+look; null means "draw the originals" (look = Off).
  const filterCache = useRef(new Map())
  const [lookImages, setLookImages] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (look === 'off' || photos.size === 0) {
      setLookImages(null)
      return
    }
    ;(async () => {
      const cache = filterCache.current
      for (const key of [...cache.keys()]) {
        if (!key.endsWith(`:${look}`)) cache.delete(key)
      }
      const map = new Map()
      let n = 0
      for (const p of photos.values()) {
        const key = `${p.id}:${look}`
        let bmp = cache.get(key)
        if (!bmp && p.previewBitmap) {
          bmp = await filteredBitmap(p.previewBitmap, matrixFor(p, look))
          cache.set(key, bmp)
        }
        if (bmp) map.set(p.id, bmp)
        if (++n % 12 === 0) {
          if (cancelled) return
          await new Promise((r) => setTimeout(r)) // keep the main thread breathing
        }
      }
      if (!cancelled) setLookImages(map)
    })()
    return () => {
      cancelled = true
    }
  }, [photos, look])

  // Once photos exist, the ambient field takes its light from them.
  const ambientColors = useMemo(() => {
    if (photos.size === 0) return null
    const list = [...photos.values()]
    const picks = [list[0], list[Math.floor(list.length / 2)], list[list.length - 1]]
    const colors = picks.map((p) => ambientFrom(p?.previewBitmap)).filter(Boolean)
    return colors.length === 3 ? colors : null
  }, [photos])

  const slideBgs = useMemo(() => {
    if (bgMode === 'dark') return slides.map(() => '#0d0d0d')
    if (bgMode === 'light') return slides.map(() => '#f2efe9')
    return slides.map((s) => averageColor(s.photoIds.map((id) => photos.get(id)?.previewBitmap)))
  }, [bgMode, slides, photos])

  const shuffleSlide = (i) => {
    setSlides((prev) => prev.map((s, j) => (j === i ? { ...s, seed: randomSeed(), swaps: [] } : s)))
  }
  const shuffleAll = () => {
    setSlides((prev) => prev.map((s) => ({ ...s, seed: randomSeed(), swaps: [] })))
  }

  const addEmptySlide = () => {
    setSlides((prev) =>
      prev.length >= MAX_SLIDES ? prev : [...prev, { key: `s${slideKeyCounter++}`, photoIds: [], seed: randomSeed() }],
    )
  }

  // reorder two photos within one slide: their rects trade places
  const swapPhotos = (slideKey, idA, idB) => {
    setSlides((prev) =>
      prev.map((s) => (s.key === slideKey ? { ...s, swaps: [...(s.swaps ?? []), [idA, idB]] } : s)),
    )
  }

  // "−"/"+" on a slide: rebalance a boundary photo with a neighbouring slide
  const adjustSlide = (i, delta) => {
    setSlides((prev) => {
      const groups = prev.map((s) => s.photoIds)
      const result = adjustGroupSize(groups, i, delta)
      if (!result) return prev
      const byRef = new Map(groups.map((g, j) => [g, prev[j]]))
      return result.map(
        (g) => byRef.get(g) ?? { key: `s${slideKeyCounter++}`, photoIds: g, seed: randomSeed() },
      )
    })
  }

  const moveSlide = (from, to) => {
    setSlides((prev) => {
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [s] = next.splice(from, 1)
      next.splice(to, 0, s)
      return next
    })
  }

  const movePhoto = (photoId, fromKey, toKey) => {
    setSlides((prev) => {
      const from = prev.find((s) => s.key === fromKey)
      const to = prev.find((s) => s.key === toKey)
      if (!from || !to || from === to) return prev
      const next = prev
        .map((s) => {
          if (s.key === fromKey)
            return { ...s, photoIds: s.photoIds.filter((id) => id !== photoId), seed: randomSeed() }
          if (s.key === toKey) return { ...s, photoIds: [...s.photoIds, photoId], seed: randomSeed() }
          return s
        })
        // only the drained source slide folds away — deliberately added empty
        // slides stay put, waiting for photos
        .filter((s) => s.photoIds.length > 0 || s.key !== fromKey)
      return next
    })
  }

  // ---- photo drag between slides (pointer-based, works with touch) ----
  const startPhotoDrag = (e, slideKey, photoId) => {
    if (drag || exportState) return
    const start = { x: e.clientX, y: e.clientY }
    const isTouch = e.pointerType === 'touch'
    let active = false
    let holdTimer = null
    const activate = (x, y) => {
      active = true
      document.body.dataset.dragging = '1'
      setDrag({ photoId, fromKey: slideKey, x, y, overKey: null })
    }
    if (isTouch) holdTimer = setTimeout(() => activate(start.x, start.y), 320)

    const onMove = (ev) => {
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      if (!active) {
        if (isTouch) {
          if (Math.hypot(dx, dy) > 10) cleanup() // user is scrolling
          return
        }
        if (Math.hypot(dx, dy) > 8) activate(ev.clientX, ev.clientY)
        else return
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY)
      const card = el?.closest?.('[data-slide-key]')
      const overKey = card?.dataset.slideKey ?? null
      setDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY, overKey } : d))
    }
    const onUp = (ev) => {
      if (active) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY)
        const card = el?.closest?.('[data-slide-key]')
        const toKey = card?.dataset.slideKey
        if (toKey && toKey !== slideKey) {
          movePhoto(photoId, slideKey, toKey)
        } else if (toKey === slideKey) {
          // dropped within the same slide → swap with the photo under the pointer
          const canvasEl = card.querySelector('.slide-canvas')
          const idx = slidesRef.current.findIndex((s) => s.key === slideKey)
          if (canvasEl && idx >= 0) {
            const box = canvasEl.getBoundingClientRect()
            const x = ((ev.clientX - box.left) / box.width) * canvasW
            const y = ((ev.clientY - box.top) / box.height) * canvasH
            const rects = layoutsRef.current[idx]?.rects ?? []
            const ids = slidesRef.current[idx].photoIds
            for (let r = 0; r < rects.length; r++) {
              const rect = rects[r]
              if (rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
                if (ids[r] !== photoId) swapPhotos(slideKey, photoId, ids[r])
                break
              }
            }
          }
        }
      }
      cleanup()
    }
    const cleanup = () => {
      clearTimeout(holdTimer)
      delete document.body.dataset.dragging
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', cleanup)
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', cleanup)
  }

  // ---- slide reordering via native DnD (desktop) ----
  const slideDragIndex = useRef(null)

  // ---- export ----
  const exportOpts = { width: canvasW, height: canvasH }
  const downloadAll = async () => {
    if (exportState) return
    // empty slides are workspace, not output
    const filled = slides.map((s, i) => ({ s, layout: layouts[i], bg: slideBgs[i] })).filter((x) => x.s.photoIds.length)
    if (filled.length === 0) return
    setExportState({ done: 0, total: filled.length })
    try {
      const zip = await exportAllAsZip(
        filled.map((x) => x.s),
        filled.map((x) => x.layout),
        photos,
        { ...exportOpts, bgs: filled.map((x) => x.bg), look },
        (done, total) => setExportState({ done, total }),
      )
      saveBlob(zip, 'carousel.zip')
      const btn = document.querySelector('.dock-btn-primary')
      const box = btn?.getBoundingClientRect()
      fireConfetti(box ? box.left + box.width / 2 : window.innerWidth / 2, box ? box.top : window.innerHeight - 60)
    } finally {
      setExportState(null)
    }
  }
  const downloadOne = async (i) => {
    const blob = await renderSlideBlob(slides[i], layouts[i].rects, photos, {
      ...exportOpts,
      bg: slideBgs[i],
      look,
    })
    saveBlob(blob, slideFileName(i))
  }

  const hasPhotos = photos.size > 0
  const busyImporting = importState != null

  return (
    <div className="app">
      <div className="ambient" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={
              ambientColors
                ? { background: `radial-gradient(circle, ${ambientColors[i]}, transparent 65%)` }
                : undefined
            }
          />
        ))}
      </div>
      <header className="topbar glass-thick">
        <div className="brand">
          <Logo size={18} />
          <span className="brand-name">photogram</span>
        </div>
        {hasPhotos && (
          <div className="counts" aria-live="polite">
            {photos.size} photos · {slides.length} slides
          </div>
        )}
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
        data-testid="file-input"
      />

      {(notice || skipped.length > 0) && (
        <div className="notices">
          {notice?.type === 'raised' && (
            <div className="notice glass-thin">
              Raised to {notice.per} photos per slide so everything fits in Instagram’s 20-slide limit.
            </div>
          )}
          {notice?.type === 'overflow' && (
            <div className="notice notice-warn glass-thin">
              Instagram caps a carousel at 20 slides of 8 photos — {notice.included} photos fit,{' '}
              {notice.excluded} (the most recent) are left out. Post them as a second carousel.
            </div>
          )}
          {skipped.length > 0 && (
            <div className="notice notice-warn glass-thin">
              Skipped {skipped.length === 1 ? 'an unsupported file' : `${skipped.length} unsupported files`}:{' '}
              {skipped.slice(0, 4).join(', ')}
              {skipped.length > 4 ? '…' : ''} — JPEG, PNG, WebP, GIF and HEIC work.
              <button className="notice-dismiss" onClick={() => setSkipped([])} aria-label="Dismiss">
                ×
              </button>
            </div>
          )}
        </div>
      )}

      {!hasPhotos ? (
        <div
          className="dropzone glass-thin"
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInputRef.current?.click()}
        >
          {busyImporting ? (
            <div className="drop-progress">
              <div className="drop-progress-bar">
                <div
                  className="drop-progress-fill"
                  style={{ width: `${(importState.done / importState.total) * 100}%` }}
                />
              </div>
              <p>
                Reading {importState.done}/{importState.total}…
              </p>
            </div>
          ) : (
            <>
              <div className="drop-ghosts" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p className="drop-title">Drop your photos.</p>
              <p className="drop-sub">You’ll get carousel slides, ready to post.</p>
            </>
          )}
        </div>
      ) : (
        <>
          {busyImporting && (
            <div className="importing-inline">
              Reading {importState.done}/{importState.total}…
            </div>
          )}

          <div className="filmstrip" data-testid="filmstrip">
            {slides.map((slide, i) => (
              <div
                key={slide.key}
                className={`slide-card glass-thin ${drag?.overKey === slide.key && drag.fromKey !== slide.key ? 'drop-target' : ''}`}
                data-slide-key={slide.key}
                onMouseMove={(e) => {
                  if (drag || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
                  const box = e.currentTarget.getBoundingClientRect()
                  const rx = ((e.clientX - box.left) / box.width - 0.5) * 5
                  const ry = ((e.clientY - box.top) / box.height - 0.5) * -5
                  e.currentTarget.style.setProperty('--tilt-x', `${rx.toFixed(2)}deg`)
                  e.currentTarget.style.setProperty('--tilt-y', `${ry.toFixed(2)}deg`)
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.setProperty('--tilt-x', '0deg')
                  e.currentTarget.style.setProperty('--tilt-y', '0deg')
                }}
                onDragOver={(e) => {
                  if (slideDragIndex.current != null) e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (slideDragIndex.current != null) {
                    moveSlide(slideDragIndex.current, i)
                    slideDragIndex.current = null
                  }
                }}
              >
                <div
                  className="slide-head"
                  draggable
                  onDragStart={(e) => {
                    slideDragIndex.current = i
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => (slideDragIndex.current = null)}
                  title="Drag to reorder"
                >
                  <span className="slide-num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="slide-count">
                    <button
                      className="icon-btn icon-btn-sm"
                      onClick={() => adjustSlide(i, -1)}
                      disabled={slide.photoIds.length <= 1 || slides.length < 2}
                      aria-label="Fewer photos on this slide"
                      title="Move a photo to a neighbouring slide"
                    >
                      <Glyph d="M3.5 8h9" />
                    </button>
                    {slide.photoIds.length} {slide.photoIds.length === 1 ? 'photo' : 'photos'}
                    <button
                      className="icon-btn icon-btn-sm"
                      onClick={() => adjustSlide(i, 1)}
                      disabled={slide.photoIds.length >= 8 || slides.length < 2}
                      aria-label="More photos on this slide"
                      title="Pull a photo from a neighbouring slide"
                    >
                      <Glyph d="M8 3.5v9M3.5 8h9" />
                    </button>
                  </span>
                  <span className="slide-actions">
                    <button
                      className="icon-btn"
                      onClick={() => shuffleSlide(i)}
                      disabled={slide.photoIds.length === 0}
                      aria-label="Shuffle this slide"
                      title="Shuffle this slide"
                    >
                      <Glyph d="M2 4.5h2.6l6.8 7H14M2 11.5h2.6l1.7-1.75M9.7 6.25l1.7-1.75H14M12 2.5l2 2-2 2M12 9.5l2 2-2 2" />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => downloadOne(i)}
                      disabled={slide.photoIds.length === 0}
                      aria-label="Download this slide"
                      title="Download this slide"
                    >
                      <Glyph d="M8 2.5v7.5m0 0 3-3m-3 3-3-3M3 13.5h10" />
                    </button>
                  </span>
                </div>
                {slide.photoIds.length === 0 ? (
                  <div className="slide-empty" style={{ aspectRatio: `${canvasW} / ${canvasH}` }}>
                    Drag photos here
                  </div>
                ) : (
                  <SlideCanvas
                    slide={slide}
                    layout={layouts[i]}
                    photos={photos}
                    canvasW={canvasW}
                    canvasH={canvasH}
                    bg={slideBgs[i]}
                    imagesOverride={lookImages}
                    animKey={`${slide.key}:${slide.seed}:${slide.photoIds.join(',')}:${aspect}:${gutter}:${(slide.swaps ?? []).length}`}
                    onPhotoPointerDown={(e, photoId) => startPhotoDrag(e, slide.key, photoId)}
                  />
                )}
              </div>
            ))}
            {slides.length < MAX_SLIDES && !busyImporting && (
              <button className="add-slide" onClick={addEmptySlide} aria-label="Add slide">
                <span className="add-slide-plus" aria-hidden="true">
                  +
                </span>
                <span className="add-slide-hint">New slide</span>
              </button>
            )}
          </div>
        </>
      )}

      {hasPhotos && optionsOpen && (
        <div className="options-popover glass-thick" role="dialog" aria-label="Options">
            <div className="control">
              <span className="control-label">
                Photos per slide <b>{perSlide === 'auto' ? 'Auto' : perSlide}</b>
              </span>
              <div className="per-slide">
                <button
                  className={`chip ${perSlide === 'auto' ? 'active' : ''}`}
                  onClick={() => handlePerSlide('auto')}
                  title="Slide sizes follow the photos — solo heroes, natural breaks"
                >
                  Auto
                </button>
                <input
                  type="range"
                  min="4"
                  max="8"
                  value={perSlide === 'auto' ? 6 : perSlide}
                  className={perSlide === 'auto' ? 'dimmed' : ''}
                  aria-label="Photos per slide"
                  onChange={(e) => handlePerSlide(Number(e.target.value))}
                />
              </div>
            </div>
            <label className="control">
              <span className="control-label">
                Gutter <b>{gutter}px</b>
              </span>
              <input type="range" min="0" max="24" value={gutter} onChange={(e) => setGutter(Number(e.target.value))} />
            </label>
            <div className="control">
              <span className="control-label">Background</span>
              <div className="swatches">
                {BG_SWATCHES.map((s) => (
                  <button
                    key={s.key}
                    className={`swatch ${bgMode === s.key ? 'active' : ''} ${s.key === 'auto' ? 'swatch-auto' : ''}`}
                    style={s.color ? { background: s.color } : undefined}
                    title={s.label}
                    aria-label={s.label}
                    onClick={() => setBgMode(s.key)}
                  />
                ))}
              </div>
            </div>
            <div className="control">
              <span className="control-label">Aspect</span>
              <div className="segmented">
                {['4:5', '1:1'].map((a) => (
                  <button key={a} className={aspect === a ? 'active' : ''} onClick={() => handleAspect(a)}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
        </div>
      )}

      {hasPhotos && (
        <div className="bottom-cluster">
          <FilterBar photo={photos.values().next().value} look={look} setLook={setLook} />
          <nav className="dock glass-thick" aria-label="Actions">
            <button
              className="dock-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={busyImporting}
              aria-label="Add photos"
              title="Add photos"
            >
              <Glyph size={19} d="M8 2.5v11M2.5 8h11" />
            </button>
            <button
              className="dock-btn"
              onClick={shuffleAll}
              disabled={busyImporting}
              aria-label="Shuffle all"
              title="Shuffle all"
            >
              <Glyph size={19} d="M2 4.5h2.6l6.8 7H14M2 11.5h2.6l1.7-1.75M9.7 6.25l1.7-1.75H14M12 2.5l2 2-2 2M12 9.5l2 2-2 2" />
            </button>
            <button
              className={`dock-btn ${optionsOpen ? 'dock-btn-active' : ''}`}
              onClick={() => setOptionsOpen((o) => !o)}
              aria-expanded={optionsOpen}
              aria-label="Options"
              title="Options"
            >
              <Glyph size={19} d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6M9.5 3v4M4.5 9v4" />
            </button>
            <button
              className="dock-btn dock-btn-primary"
              onClick={downloadAll}
              disabled={busyImporting || !!exportState}
              aria-label="Download all"
              title="Download all"
            >
              {exportState ? (
                <span className="dock-progress">
                  {exportState.done < exportState.total ? `${exportState.done + 1}/${exportState.total}` : '…'}
                </span>
              ) : (
                <Glyph size={19} d="M8 2.5v7.5m0 0 3-3m-3 3-3-3M3 13.5h10" />
              )}
            </button>
          </nav>
        </div>
      )}

      {drag && <DragGhost drag={drag} photo={photos.get(drag.photoId)} />}
    </div>
  )
}

// Instagram-style filter picker: a strip of circular bubbles, each showing a
// real photo from the dump with that look applied. Pop-in, idle bob, and
// selection scale are pure CSS, all gated behind prefers-reduced-motion.
function FilterBar({ photo, look, setLook }) {
  return (
    <div className="filterbar glass-thick" role="radiogroup" aria-label="Filter">
      {LOOKS.map((l, i) => (
        <button
          key={l.key}
          data-look={l.key}
          role="radio"
          aria-checked={look === l.key}
          className={`bubble ${look === l.key ? 'active' : ''}`}
          style={{ '--i': i }}
          onClick={() => setLook(l.key)}
        >
          <span className="bubble-float">
            <BubbleThumb photo={photo} lookKey={l.key} />
          </span>
          <span className="bubble-label">{l.label}</span>
        </button>
      ))}
    </div>
  )
}

function BubbleThumb({ photo, lookKey }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    const size = 104
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const bmp = photo?.previewBitmap
    if (!bmp) {
      ctx.fillStyle = '#3a3a44'
      ctx.fillRect(0, 0, size, size)
      return
    }
    const s = Math.max(size / bmp.width, size / bmp.height)
    const sw = size / s
    const sh = size / s
    ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, size, size)
    const m = matrixFor(photo, lookKey)
    if (m) {
      const imageData = ctx.getImageData(0, 0, size, size)
      applyMatrix(imageData.data, m)
      ctx.putImageData(imageData, 0, 0)
    }
  }, [photo, lookKey])
  return <canvas ref={ref} className="bubble-thumb" aria-hidden="true" />
}

// One icon voice: 16px grid, 1.8 stroke, round caps — no mixed glyph sets.
function Glyph({ d, size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

function DragGhost({ drag, photo }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !photo?.previewBitmap) return
    const bmp = photo.previewBitmap
    const s = 72 / Math.max(bmp.width, bmp.height)
    canvas.width = Math.max(1, Math.round(bmp.width * s))
    canvas.height = Math.max(1, Math.round(bmp.height * s))
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
  }, [photo])
  return (
    <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
      <canvas ref={ref} />
    </div>
  )
}
