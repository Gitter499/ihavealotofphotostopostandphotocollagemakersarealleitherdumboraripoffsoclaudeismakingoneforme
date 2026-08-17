import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { importFiles } from './lib/importer.js'
import { sortPhotos, groupPhotos, effectiveQualities } from './lib/grouping.js'
import { computeLayout } from './lib/layout.js'
import { averageColor, ambientFrom } from './lib/colors.js'
import { exportAllAsZip, renderSlideBlob, slideFileName, saveBlob } from './lib/exportZip.js'
import { randomSeed } from './lib/rng.js'
import SlideCanvas from './components/SlideCanvas.jsx'

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
  const [perSlide, setPerSlide] = useState(6)
  const [gutter, setGutter] = useState(8)
  const [bgMode, setBgMode] = useState('dark')
  const [aspect, setAspect] = useState('4:5')
  const [importState, setImportState] = useState(null) // {done, total}
  const [skipped, setSkipped] = useState([])
  const [notice, setNotice] = useState(null)
  const [exportState, setExportState] = useState(null) // {done, total}
  const [drag, setDrag] = useState(null) // {photoId, fromKey, x, y, overKey}
  const fileInputRef = useRef(null)
  const dragRef = useRef(null)

  const canvasW = 1080
  const canvasH = aspect === '1:1' ? 1080 : 1350
  const margin = gutter * 2 // gutter 8 → margin 16 (spec defaults); gutter 0 → full bleed

  const recompose = useCallback((photosMap, per) => {
    const sorted = sortPhotos([...photosMap.values()])
    const { groups, notice } = groupPhotos(
      sorted.map((p) => p.id),
      (id) => photosMap.get(id).aspect,
      per,
    )
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
        return computeLayout(
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
      }),
    [slides, photos, canvasW, canvasH, margin, gutter],
  )

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
    setSlides((prev) => prev.map((s, j) => (j === i ? { ...s, seed: randomSeed() } : s)))
  }
  const shuffleAll = () => {
    setSlides((prev) => prev.map((s) => ({ ...s, seed: randomSeed() })))
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
        .filter((s) => s.photoIds.length > 0)
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
        if (toKey && toKey !== slideKey) movePhoto(photoId, slideKey, toKey)
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
    setExportState({ done: 0, total: slides.length })
    try {
      const zip = await exportAllAsZip(slides, layouts, photos, { ...exportOpts, bgs: slideBgs }, (done, total) =>
        setExportState({ done, total }),
      )
      saveBlob(zip, 'carousel.zip')
    } finally {
      setExportState(null)
    }
  }
  const downloadOne = async (i) => {
    const blob = await renderSlideBlob(slides[i], layouts[i].rects, photos, {
      ...exportOpts,
      bg: slideBgs[i],
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
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">
            Photo Dump <span className="brand-arrow">→</span> Carousel
          </span>
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
          <div className="controls glass">
            <label className="control">
              <span className="control-label">
                Photos per slide <b>{perSlide}</b>
              </span>
              <input
                type="range"
                min="4"
                max="8"
                value={perSlide}
                onChange={(e) => handlePerSlide(Number(e.target.value))}
              />
            </label>
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
                  <span className="slide-count">{slide.photoIds.length} photos</span>
                  <span className="slide-actions">
                    <button
                      className="icon-btn"
                      onClick={() => moveSlide(i, i - 1)}
                      disabled={i === 0}
                      aria-label="Move slide left"
                      title="Move left"
                    >
                      <Glyph d="M9.5 3.5 5 8l4.5 4.5" />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => moveSlide(i, i + 1)}
                      disabled={i === slides.length - 1}
                      aria-label="Move slide right"
                      title="Move right"
                    >
                      <Glyph d="M6.5 3.5 11 8l-4.5 4.5" />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => shuffleSlide(i)}
                      aria-label="Shuffle this slide"
                      title="Shuffle this slide"
                    >
                      <Glyph d="M2 4.5h2.6l6.8 7H14M2 11.5h2.6l1.7-1.75M9.7 6.25l1.7-1.75H14M12 2.5l2 2-2 2M12 9.5l2 2-2 2" />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => downloadOne(i)}
                      aria-label="Download this slide"
                      title="Download this slide"
                    >
                      <Glyph d="M8 2.5v7.5m0 0 3-3m-3 3-3-3M3 13.5h10" />
                    </button>
                  </span>
                </div>
                <SlideCanvas
                  slide={slide}
                  layout={layouts[i]}
                  photos={photos}
                  canvasW={canvasW}
                  canvasH={canvasH}
                  bg={slideBgs[i]}
                  animKey={`${slide.key}:${slide.seed}:${slide.photoIds.join(',')}:${aspect}`}
                  onPhotoPointerDown={(e, photoId) => startPhotoDrag(e, slide.key, photoId)}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {hasPhotos && (
        <nav className="dock glass-thick" aria-label="Actions">
          <button className="dock-btn" onClick={() => fileInputRef.current?.click()} disabled={busyImporting}>
            Add photos
          </button>
          <button className="dock-btn" onClick={shuffleAll} disabled={busyImporting}>
            Shuffle all
          </button>
          <button
            className="dock-btn dock-btn-primary"
            onClick={downloadAll}
            disabled={busyImporting || !!exportState}
          >
            {exportState
              ? exportState.done < exportState.total
                ? `Rendering ${exportState.done + 1}/${exportState.total}…`
                : 'Zipping…'
              : 'Download all'}
          </button>
        </nav>
      )}

      {drag && <DragGhost drag={drag} photo={photos.get(drag.photoId)} />}
    </div>
  )
}

// One icon voice: 16px grid, 1.8 stroke, round caps — no mixed glyph sets.
function Glyph({ d }) {
  return (
    <svg
      width="16"
      height="16"
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
