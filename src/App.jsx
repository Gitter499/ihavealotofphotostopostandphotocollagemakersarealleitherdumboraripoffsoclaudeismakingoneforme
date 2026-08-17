import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { importFiles, bumpIdCounter } from './lib/importer.js'
import { savePhotos, deletePhotos, saveWorkspace, loadSession, clearSession } from './lib/store.js'
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
import { remixPlan } from './lib/remix.js'
import { randomSeed } from './lib/rng.js'
import { tiltAngle } from './lib/render.js'
import { templatesFor, templateById, templateRects } from './lib/templates.js'
import { haptics } from './lib/haptics.js'
import SlideCanvas from './components/SlideCanvas.jsx'
import Logo from './components/Logo.jsx'
import Wordmark from './components/Wordmark.jsx'
import {
  ImagesIcon,
  ShuffleIcon,
  FadersHorizontalIcon,
  DownloadSimpleIcon,
  PlusIcon,
  MinusIcon,
  TrashIcon,
  LinkSimpleIcon,
  LinkBreakIcon,
  SquaresFourIcon,
  TextTIcon,
  DotsThreeIcon,
} from '@phosphor-icons/react'

const BG_SWATCHES = [
  { key: 'dark', color: '#0d0d0d', label: 'Near-black' },
  { key: 'light', color: '#f2efe9', label: 'Off-white' },
  { key: 'auto', color: null, label: 'Sampled from photos' },
]

let slideKeyCounter = 1

// Phone-width detection: below this, floating popovers become bottom sheets
// in the thumb zone and per-slide actions collapse behind one ⋯ button.
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 640px)').matches)
  useEffect(() => {
    const q = window.matchMedia('(max-width: 640px)')
    const on = () => setMobile(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return mobile
}

// Non-modal popovers: a pointerdown anywhere `isInside` doesn't claim closes
// them, and the touch still lands on whatever was touched.
function useDismiss(active, isInside, close) {
  useEffect(() => {
    if (!active) return
    const onDown = (e) => {
      if (!isInside(e)) close()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps
}

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
  const [tilt, setTilt] = useState(0) // degrees of per-photo lean
  const [cornerRadius, setCornerRadius] = useState(0)
  const [meshSeams, setMeshSeams] = useState(() => new Set()) // seam keys "aKey|bKey" bridged by a photo
  const [sizeBoosts, setSizeBoosts] = useState(() => new Map()) // photoId → area weight (1 = neutral)
  const [sizeEdit, setSizeEdit] = useState(null) // {photoId, x, y} — tap-to-resize popover
  const [slideTemplates, setSlideTemplates] = useState(() => new Map()) // slideKey → template id ('' = auto)
  const [tplEdit, setTplEdit] = useState(null) // {slideKey, count, x, y} — template picker
  const [captions, setCaptions] = useState(() => new Map()) // slideKey → {text, pos}
  const [capEdit, setCapEdit] = useState(null) // {slideKey, x, y} — caption editor
  const [moreEdit, setMoreEdit] = useState(null) // {slideKey} — mobile ⋯ action sheet
  const [borderW, setBorderW] = useState(0) // px stroke around every photo
  const [borderColor, setBorderColor] = useState('#ffffff')
  const [aspect, setAspect] = useState('4:5')
  const [importState, setImportState] = useState(null) // {done, total}
  const [skipped, setSkipped] = useState([])
  const [notice, setNotice] = useState(null)
  const [exportState, setExportState] = useState(null) // {done, total}
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [drag, setDrag] = useState(null) // {photoId, fromKey, x, y, overKey}
  const [hoverSeam, setHoverSeam] = useState(null) // seam index under the pointer — previews the join
  const [tray, setTray] = useState([]) // playground: photo ids set aside from every slide
  const [restoring, setRestoring] = useState(true) // gate saves until the stored session loads
  const fileInputRef = useRef(null)
  const trayRef = useRef(tray)
  trayRef.current = tray

  const canvasW = 1080
  const canvasH = aspect === '1:1' ? 1080 : aspect === '9:16' ? 1920 : 1350
  const margin = gutter * 2 // gutter 8 → margin 16 (spec defaults); gutter 0 → full bleed

  const recompose = useCallback((photosMap, per) => {
    // photos resting in the playground sit out of every regroup
    const sorted = sortPhotos([...photosMap.values()].filter((p) => !trayRef.current.includes(p.id)))
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
      savePhotos(incoming) // survive reloads — blobs to IndexedDB, fire-and-forget
      setPhotos((prev) => {
        const next = new Map(prev)
        for (const p of incoming) next.set(p.id, p)
        recompose(next, perSlide)
        return next
      })
    },
    [perSlide, recompose],
  )

  // Restore the previous session, if any: photos come back from IndexedDB
  // with previews re-decoded natively; the arrangement snapshot follows.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const session = await loadSession()
      if (!session || cancelled) {
        setRestoring(false)
        return
      }
      const { workspace, photos: stored } = session
      const map = new Map()
      let maxId = 0
      setImportState({ done: 0, total: stored.length })
      let n = 0
      for (const rec of stored) {
        try {
          const scale = Math.min(1, 480 / Math.max(rec.width, rec.height))
          const previewBitmap = await createImageBitmap(rec.blob, {
            resizeWidth: Math.max(1, Math.round(rec.width * scale)),
            resizeHeight: Math.max(1, Math.round(rec.height * scale)),
            resizeQuality: 'medium',
          })
          map.set(rec.id, { ...rec, previewBitmap })
        } catch {
          // a record that no longer decodes just drops out
        }
        maxId = Math.max(maxId, rec.id)
        if (++n % 8 === 0 && !cancelled) setImportState({ done: n, total: stored.length })
      }
      if (cancelled) return
      bumpIdCounter(maxId)
      for (const s of workspace.slides ?? []) {
        const m = /^s(\d+)$/.exec(s.key)
        if (m) slideKeyCounter = Math.max(slideKeyCounter, Number(m[1]) + 1)
      }
      const restoredSlides = (workspace.slides ?? [])
        .map((s) => ({ ...s, photoIds: s.photoIds.filter((id) => map.has(id)) }))
        .filter((s) => s.photoIds.length > 0)
      setPhotos(map)
      setSlides(restoredSlides)
      setTray((workspace.tray ?? []).filter((id) => map.has(id)))
      setPerSlide(workspace.perSlide ?? 'auto')
      setGutter(workspace.gutter ?? 8)
      setBgMode(workspace.bgMode ?? 'dark')
      setLook(workspace.look ?? 'auto')
      setTilt(workspace.tilt ?? 0)
      setCornerRadius(workspace.cornerRadius ?? 0)
      setAspect(workspace.aspect ?? '4:5')
      setBorderW(workspace.borderW ?? 0)
      setBorderColor(workspace.borderColor ?? '#ffffff')
      setMeshSeams(new Set(workspace.meshSeams ?? []))
      setSizeBoosts(new Map(workspace.sizeBoosts ?? []))
      setSlideTemplates(new Map(workspace.slideTemplates ?? []))
      setCaptions(new Map(workspace.captions ?? []))
      setImportState(null)
      setRestoring(false)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced workspace snapshot — every meaningful change survives a reload.
  useEffect(() => {
    if (restoring || photos.size === 0) return
    const t = setTimeout(() => {
      saveWorkspace({
        slides,
        tray,
        perSlide,
        gutter,
        bgMode,
        look,
        tilt,
        cornerRadius,
        aspect,
        borderW,
        borderColor,
        meshSeams: [...meshSeams],
        sizeBoosts: [...sizeBoosts],
        slideTemplates: [...slideTemplates],
        captions: [...captions],
        savedAt: Date.now(),
      })
    }, 800)
    return () => clearTimeout(t)
  }, [restoring, photos, slides, tray, perSlide, gutter, bgMode, look, tilt, cornerRadius, aspect, borderW, borderColor, meshSeams, sizeBoosts, slideTemplates, captions])

  // Start over: wipe the stored session and the workspace together.
  const startOver = () => {
    if (!window.confirm('Clear every photo and start over?')) return
    haptics.warning()
    clearSession()
    setPhotos(new Map())
    setSlides([])
    setTray([])
    setMeshSeams(new Set())
    setSizeBoosts(new Map())
    setSlideTemplates(new Map())
    setCaptions(new Map())
    setNotice(null)
    setSkipped([])
    setOptionsOpen(false)
  }

  // Keyboard: Esc closes whatever is open; single letters fire the big
  // actions (guarded so typing in a field never triggers them). The ref
  // keeps the once-mounted listener pointed at fresh handlers.
  const keyActions = useRef({})
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOptionsOpen(false)
        setSizeEdit(null)
        setTplEdit(null)
        setCapEdit(null)
        setMoreEdit(null)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
      const fn = keyActions.current[e.key.toLowerCase()]
      if (fn) {
        e.preventDefault()
        fn()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])


  // the dock itself doesn't dismiss the toolbox — its buttons stay usable
  useDismiss(
    optionsOpen,
    (e) => e.target.closest?.('.options-popover') || e.target.closest?.('.bottom-cluster'),
    () => setOptionsOpen(false),
  )
  useDismiss(!!sizeEdit, (e) => e.target.closest?.('.size-popover'), () => setSizeEdit(null))
  useDismiss(!!tplEdit, (e) => e.target.closest?.('.tpl-popover'), () => setTplEdit(null))
  useDismiss(!!capEdit, (e) => e.target.closest?.('.cap-popover'), () => setCapEdit(null))
  useDismiss(!!moreEdit, (e) => e.target.closest?.('.action-sheet'), () => setMoreEdit(null))
  const isMobile = useIsMobile()

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

  const BRIDGE_STRIP = 300 // width (in 1080-space) each slide gives to a seam photo

  const seamKey = (i) => (slides[i + 1] ? `${slides[i].key}|${slides[i + 1].key}` : null)

  const layoutCache = useRef(new Map())
  const layouts = useMemo(() => {
    const nextCache = new Map()
    // Mesh planning: each seam is its own switch. For every meshed seam
    // between adjacent filled slides, pick a boundary photo (the more
    // portrait of the pair's tail/head) to span it.
    const bridgeAfter = new Array(slides.length).fill(null) // seam i → {id, owner}
    if (meshSeams.size) {
      const used = new Set()
      for (let i = 0; i < slides.length - 1; i++) {
        const a = slides[i]
        const b = slides[i + 1]
        if (!meshSeams.has(`${a.key}|${b.key}`)) continue
        if (a.photoIds.length === 0 || b.photoIds.length === 0) continue
        const tail = a.photoIds[a.photoIds.length - 1]
        const head = b.photoIds[0]
        const candidates = [
          { id: tail, owner: i },
          { id: head, owner: i + 1 },
        ].filter((c) => !used.has(c.id))
        if (candidates.length === 0) continue
        candidates.sort((x, y) => (photos.get(x.id)?.aspect ?? 1) - (photos.get(y.id)?.aspect ?? 1))
        bridgeAfter[i] = candidates[0]
        used.add(candidates[0].id)
      }
    }

    const result = slides.map((s, i) => {
      const leftBridge = i > 0 ? bridgeAfter[i - 1] : null
      const rightBridge = bridgeAfter[i]
      const leftStrip = leftBridge ? BRIDGE_STRIP : 0
      const rightStrip = rightBridge ? BRIDGE_STRIP : 0
      const ownedBridgeIds = new Set(
        [leftBridge, rightBridge].filter((b) => b && b.owner === i).map((b) => b.id),
      )
      const innerIds = s.photoIds.filter((id) => !ownedBridgeIds.has(id))
      const eff = effectiveQualities(innerIds, (id) => photos.get(id))
      // tap-to-resize: a boosted photo pulls a matching share of the canvas
      const boosts = innerIds.map((id) => sizeBoosts.get(id) ?? 1)
      const quals = innerIds.map((id) => eff.get(id) ?? 0.5)
      const innerW = canvasW - leftStrip - rightStrip
      // a pinned template wins over the BSP engine while its count matches
      const tpl = templateById(slideTemplates.get(s.key))
      const usingTpl = tpl && tpl.count === innerIds.length
      const opts = {
        canvasW: innerW,
        canvasH,
        margin,
        gutter,
        baseSeed: s.seed,
        qualities: quals,
        weights: boosts.some((b) => b !== 1) ? boosts : null,
      }
      // per-slide cache: dragging one photo's size slider only relays out
      // the slide that actually changed
      const cacheKey = JSON.stringify([s.key, innerIds, boosts, quals, innerW, canvasH, margin, gutter, s.seed, usingTpl && tpl.id])
      const inner =
        layoutCache.current.get(cacheKey) ??
        (usingTpl
          ? { rects: templateRects(tpl, { canvasW: innerW, canvasH, margin, gutter }), seed: s.seed }
          : computeLayout(innerIds.map((id) => photos.get(id)?.aspect ?? 1), opts))
      nextCache.set(cacheKey, inner)
      const rectById = new Map(
        innerIds.map((id, j) => [
          id,
          inner.rects[j] ? { ...inner.rects[j], x: inner.rects[j].x + leftStrip } : null,
        ]),
      )
      let rects = s.photoIds.map((id) => rectById.get(id) ?? null)
      // user-dragged reorders: the two photos' rects trade places
      if (s.swaps?.length) {
        rects = [...rects]
        for (const [a, b] of s.swaps) {
          const ia = s.photoIds.indexOf(a)
          const ib = s.photoIds.indexOf(b)
          if (ia >= 0 && ib >= 0 && rects[ia] && rects[ib]) {
            const t = rects[ia]
            rects[ia] = rects[ib]
            rects[ib] = t
          }
        }
      }
      const bridges = []
      if (leftBridge) bridges.push({ id: leftBridge.id, rect: { x: 0, y: 0, w: leftStrip, h: canvasH }, half: 'right' })
      if (rightBridge)
        bridges.push({ id: rightBridge.id, rect: { x: canvasW - rightStrip, y: 0, w: rightStrip, h: canvasH }, half: 'left' })
      return { ...inner, rects, bridges }
    })
    layoutCache.current = nextCache
    return result
  }, [slides, photos, canvasW, canvasH, margin, gutter, meshSeams, sizeBoosts, slideTemplates])

  const toggleSeam = (i) => {
    const key = seamKey(i)
    if (!key) return
    haptics.select()
    setMeshSeams((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const meshAll = () => {
    haptics.tap()
    setMeshSeams(() => {
      const next = new Set()
      for (let i = 0; i < slides.length - 1; i++) {
        if (slides[i].photoIds.length && slides[i + 1].photoIds.length) next.add(`${slides[i].key}|${slides[i + 1].key}`)
      }
      return next
    })
  }
  const meshNone = () => {
    haptics.tap()
    setMeshSeams(new Set())
  }

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
    // shuffling always shows something new — a pinned template unpins first
    const key = slides[i]?.key
    setSlideTemplates((prev) => {
      if (!prev.has(key)) return prev
      const next = new Map(prev)
      next.delete(key)
      return next
    })
    setSlides((prev) => prev.map((s, j) => (j === i ? { ...s, seed: randomSeed(), swaps: [] } : s)))
  }

  // Remix: rebuild every slide around a fresh pairing idea (colour runs,
  // light arcs, hero anchors, twins split up…) — never the same lens twice
  // in a row, so mashing the button keeps finding new arrangements.
  const lastLens = useRef(null)
  const [remixNote, setRemixNote] = useState(null)
  const remixAll = () => {
    const pool = [...photos.values()].filter((p) => !tray.includes(p.id))
    if (pool.length === 0) return
    const { key, label, groups } = remixPlan(pool, (id) => photos.get(id), {
      avoid: lastLens.current,
    })
    lastLens.current = key
    haptics.success()
    setSlides(groups.map((ids) => ({ key: `s${slideKeyCounter++}`, photoIds: ids, seed: randomSeed() })))
    setRemixNote({ label, at: randomSeed() })
  }
  useEffect(() => {
    if (!remixNote) return
    const t = setTimeout(() => setRemixNote(null), 2600)
    return () => clearTimeout(t)
  }, [remixNote])

  // Delete a slide outright — its photos leave the workspace with it.
  const deleteSlide = (i) => {
    const removed = slides[i]
    if (!removed) return
    haptics.warning()
    deletePhotos(removed.photoIds) // prune the stored blobs too
    setSlides((prev) => prev.filter((_, j) => j !== i))
    if (removed.photoIds.length) {
      setPhotos((prev) => {
        const next = new Map(prev)
        for (const id of removed.photoIds) next.delete(id)
        return next
      })
    }
  }

  const addEmptySlide = () => {
    setSlides((prev) =>
      prev.length >= MAX_SLIDES ? prev : [...prev, { key: `s${slideKeyCounter++}`, photoIds: [], seed: randomSeed() }],
    )
  }

  // reorder two photos within one slide: their rects trade places
  const swapPhotos = (slideKey, idA, idB) => {
    haptics.select()
    setSlides((prev) =>
      prev.map((s) => (s.key === slideKey ? { ...s, swaps: [...(s.swaps ?? []), [idA, idB]] } : s)),
    )
  }

  // swap the two photos' positions in the slide's order — used when a seam
  // bridge is involved, since the bridge is chosen from boundary positions.
  // Dragging a photo onto the bridge (or the bridge onto a photo) hands the
  // seam over to the other photo.
  const swapPhotoOrder = (slideKey, idA, idB) => {
    haptics.select()
    setSlides((prev) =>
      prev.map((s) => {
        if (s.key !== slideKey) return s
        const ids = [...s.photoIds]
        const ia = ids.indexOf(idA)
        const ib = ids.indexOf(idB)
        if (ia < 0 || ib < 0) return s
        ;[ids[ia], ids[ib]] = [ids[ib], ids[ia]]
        return { ...s, photoIds: ids }
      }),
    )
  }

  // "−"/"+" on a slide: rebalance a boundary photo with a neighbouring slide
  const adjustSlide = (i, delta) => {
    haptics.tap()
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

  // ---- playground: a shelf where photos sit out of every slide ----
  const TRAY_KEY = '__tray__'

  // Move a photo anywhere: slide → slide, slide → playground, playground →
  // slide. A drained source slide folds away, but deliberately added empty
  // slides stay put, waiting for photos.
  const relocatePhoto = (photoId, toKey) => {
    const fromKey = slidesRef.current.find((s) => s.photoIds.includes(photoId))?.key ?? TRAY_KEY
    if (fromKey === toKey) return
    haptics.select()
    setTray((prev) => (toKey === TRAY_KEY ? [...prev, photoId] : prev.filter((id) => id !== photoId)))
    setSlides((prev) =>
      prev
        .map((s) => {
          if (s.key === fromKey)
            return { ...s, photoIds: s.photoIds.filter((id) => id !== photoId), seed: randomSeed() }
          if (s.key === toKey) return { ...s, photoIds: [...s.photoIds, photoId], seed: randomSeed() }
          return s
        })
        .filter((s) => s.photoIds.length > 0 || s.key !== fromKey),
    )
  }

  // hand every parked photo back, each to whichever slide is emptiest
  const returnAllFromTray = () => {
    const parked = trayRef.current
    if (parked.length === 0) return
    haptics.tap()
    setSlides((prev) => {
      const next = prev.length
        ? prev.map((s) => ({ ...s, photoIds: [...s.photoIds] }))
        : [{ key: `s${slideKeyCounter++}`, photoIds: [], seed: randomSeed() }]
      for (const id of parked) {
        let best = 0
        for (let i = 1; i < next.length; i++) {
          if (next[i].photoIds.length < next[best].photoIds.length) best = i
        }
        next[best].photoIds.push(id)
        next[best].seed = randomSeed()
      }
      return next
    })
    setTray([])
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
      haptics.pickup()
      setSizeEdit(null)
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
      const overKey = el?.closest?.('.playground') ? TRAY_KEY : (card?.dataset.slideKey ?? null)
      setDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY, overKey } : d))
    }
    const onUp = (ev) => {
      if (!active) {
        // a clean tap (no drag) selects the photo for resizing — but not on
        // shelf thumbs, and not on a seam bridge (its strip has a fixed width)
        const fromTray = trayRef.current.includes(photoId)
        const isBridge = layoutsRef.current.some((l) => l.bridges?.some((b) => b.id === photoId))
        if (!fromTray && !isBridge) setSizeEdit({ photoId, x: ev.clientX, y: ev.clientY })
      }
      if (active) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY)
        const card = el?.closest?.('[data-slide-key]')
        const toKey = card?.dataset.slideKey
        const fromTray = trayRef.current.includes(photoId)
        // a seam bridge can be drawn on its neighbour's canvas — resolve the
        // slide that actually owns the photo before deciding move vs swap
        const ownerKey = slidesRef.current.find((s) => s.photoIds.includes(photoId))?.key ?? slideKey
        if (el?.closest?.('.playground')) {
          relocatePhoto(photoId, TRAY_KEY)
        } else if (toKey && (fromTray || toKey !== ownerKey)) {
          relocatePhoto(photoId, toKey)
        } else if (toKey === ownerKey && !fromTray) {
          // dropped within the same slide → swap with the photo under the pointer
          const canvasEl = card.querySelector('.slide-canvas')
          const idx = slidesRef.current.findIndex((s) => s.key === ownerKey)
          if (canvasEl && idx >= 0) {
            const box = canvasEl.getBoundingClientRect()
            const x = ((ev.clientX - box.left) / box.width) * canvasW
            const y = ((ev.clientY - box.top) / box.height) * canvasH
            const layout = layoutsRef.current[idx] ?? {}
            const rects = layout.rects ?? []
            const bridgeList = layout.bridges ?? []
            const ids = slidesRef.current[idx].photoIds
            let targetId = null
            for (let r = 0; r < rects.length; r++) {
              const rect = rects[r]
              if (rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
                targetId = ids[r]
                break
              }
            }
            if (targetId == null) {
              for (const b of bridgeList) {
                const rect = b.rect
                if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
                  targetId = b.id
                  break
                }
              }
            }
            if (targetId != null && targetId !== photoId) {
              const bridgeInvolved = bridgeList.some((b) => b.id === photoId || b.id === targetId)
              if (bridgeInvolved) swapPhotoOrder(ownerKey, photoId, targetId)
              else swapPhotos(ownerKey, photoId, targetId)
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
        {
          ...exportOpts,
          bgs: filled.map((x) => x.bg),
          look,
          tilt,
          radius: cornerRadius,
          border: borderW > 0 ? { width: borderW, color: borderColor } : null,
          captions,
        },
        (done, total) => setExportState({ done, total }),
      )
      saveBlob(zip, 'carousel.zip')
      haptics.success()
      const btn = document.querySelector('.dock-btn-primary')
      const box = btn?.getBoundingClientRect()
      fireConfetti(box ? box.left + box.width / 2 : window.innerWidth / 2, box ? box.top : window.innerHeight - 60)
    } finally {
      setExportState(null)
    }
  }
  const downloadOne = async (i) => {
    const blob = await renderSlideBlob(slides[i], layouts[i], photos, {
      ...exportOpts,
      bg: slideBgs[i],
      look,
      tilt,
      radius: cornerRadius,
      border: borderW > 0 ? { width: borderW, color: borderColor } : null,
      caption: captions.get(slides[i].key) ?? null,
    })
    saveBlob(blob, slideFileName(i))
  }

  // one definition of a slide's actions, rendered inline on desktop and as
  // an action sheet behind ⋯ on phones
  const slideActions = (slide, i) => [
    {
      Icon: SquaresFourIcon,
      label: 'Layout template',
      fn: (e) => setTplEdit({ slideKey: slide.key, count: slide.photoIds.length, x: e?.clientX ?? 0, y: e?.clientY ?? 0 }),
      disabled: slide.photoIds.length === 0,
    },
    {
      Icon: TextTIcon,
      label: 'Caption',
      fn: (e) => setCapEdit({ slideKey: slide.key, x: e?.clientX ?? 0, y: e?.clientY ?? 0 }),
      disabled: slide.photoIds.length === 0,
    },
    { Icon: ShuffleIcon, label: 'Shuffle this slide', fn: () => shuffleSlide(i), disabled: slide.photoIds.length === 0 },
    {
      Icon: DownloadSimpleIcon,
      label: 'Download this slide',
      fn: () => downloadOne(i),
      disabled: slide.photoIds.length === 0,
    },
    { Icon: TrashIcon, label: 'Delete this slide', fn: () => deleteSlide(i), danger: true },
  ]

  const hasPhotos = photos.size > 0
  const busyImporting = importState != null

  // single-letter shortcuts, hinted in the dock button titles
  keyActions.current = hasPhotos
    ? {
        r: remixAll,
        d: downloadAll,
        o: () => setOptionsOpen((o) => !o),
        f: () => {
          const order = LOOKS.map((l) => l.key)
          setLook((cur) => order[(order.indexOf(cur) + 1) % order.length])
          haptics.tap()
        },
      }
    : {}

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
      <header className="topbar">
        <div className="brand">
          <Logo size={40} />
          <Wordmark height={30} />
        </div>
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
          <div className="filterbar-row">
            <FilterBar
              photo={photos.values().next().value}
              look={look}
              setLook={(k) => {
                haptics.tap()
                setLook(k)
              }}
            />
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
                className={`slide-card glass-thin ${drag?.overKey === slide.key && drag.fromKey !== slide.key ? 'drop-target' : ''} ${
                  layouts[i]?.bridges?.some((b) => b.rect.x === 0) ? 'mesh-join-left' : ''
                } ${layouts[i]?.bridges?.some((b) => b.rect.x > 0) ? 'mesh-join-right' : ''} ${
                  hoverSeam === i || hoverSeam === i - 1 ? 'mesh-preview' : ''
                }`}
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
                      <MinusIcon size={14} weight="bold" />
                    </button>
                    {slide.photoIds.length} {slide.photoIds.length === 1 ? 'photo' : 'photos'}
                    <button
                      className="icon-btn icon-btn-sm"
                      onClick={() => adjustSlide(i, 1)}
                      disabled={slide.photoIds.length >= 8 || slides.length < 2}
                      aria-label="More photos on this slide"
                      title="Pull a photo from a neighbouring slide"
                    >
                      <PlusIcon size={14} weight="bold" />
                    </button>
                  </span>
                  <span className="slide-actions">
                    {isMobile ? (
                      // progressive disclosure: one thumb-sized ⋯ opens the
                      // action sheet instead of five tiny targets in a row
                      <button
                        className="icon-btn"
                        onClick={() => {
                          haptics.tap()
                          setMoreEdit({ slideKey: slide.key })
                        }}
                        aria-label="Slide actions"
                        title="Slide actions"
                      >
                        <DotsThreeIcon size={20} weight="bold" />
                      </button>
                    ) : (
                      slideActions(slide, i).map(({ Icon, label, fn, disabled, danger }) => (
                        <button
                          key={label}
                          className={`icon-btn ${danger ? 'icon-btn-danger' : ''}`}
                          onClick={fn}
                          disabled={disabled}
                          aria-label={label}
                          title={label}
                        >
                          <Icon size={16} weight="duotone" />
                        </button>
                      ))
                    )}
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
                    tilt={tilt}
                    radius={cornerRadius}
                    border={borderW > 0 ? { width: borderW, color: borderColor } : null}
                    caption={captions.get(slide.key) ?? null}
                    animKey={`${slide.key}:${slide.seed}:${slide.photoIds.join(',')}:${aspect}:${gutter}:${(slide.swaps ?? []).length}:${slide.photoIds.map((id) => sizeBoosts.get(id) ?? 1).join('_')}:${slideTemplates.get(slide.key) ?? ''}`}
                    onPhotoPointerDown={(e, photoId) => startPhotoDrag(e, slide.key, photoId)}
                  />
                )}
                {i < slides.length - 1 &&
                  slide.photoIds.length > 0 &&
                  slides[i + 1].photoIds.length > 0 &&
                  (() => {
                    const meshed = meshSeams.has(seamKey(i))
                    const Icon = meshed ? LinkSimpleIcon : LinkBreakIcon
                    return (
                      <button
                        className={`mesh-link glass-thick ${meshed ? 'mesh-link-on' : 'mesh-link-off'}`}
                        onClick={() => toggleSeam(i)}
                        onMouseEnter={() => setHoverSeam(i)}
                        onMouseLeave={() => setHoverSeam(null)}
                        onFocus={() => setHoverSeam(i)}
                        onBlur={() => setHoverSeam(null)}
                        aria-pressed={meshed}
                        aria-label={meshed ? 'Unmesh these slides' : 'Mesh these slides'}
                        title={
                          meshed
                            ? 'Meshed — a photo continues across both slides. Tap to separate.'
                            : 'Tap to mesh these slides — a photo will flow across the seam.'
                        }
                      >
                        <Icon size={17} weight="bold" />
                      </button>
                    )
                  })()}
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

          <div
            className={`playground glass-thin ${
              drag && drag.overKey === TRAY_KEY && !tray.includes(drag.photoId) ? 'drop-target' : ''
            }`}
            data-testid="playground"
          >
            <div className="playground-head">
              <span className="playground-title">Playground</span>
              {tray.length > 0 && (
                <button className="chip" onClick={returnAllFromTray} title="Hand every parked photo back to the slides">
                  Return all
                </button>
              )}
            </div>
            {tray.length === 0 ? (
              <p className="playground-hint">Drop photos here.</p>
            ) : (
              <div className="playground-shelf">
                {tray.map((id) => (
                  <TrayThumb key={id} photo={photos.get(id)} onPointerDown={(e) => startPhotoDrag(e, TRAY_KEY, id)} />
                ))}
              </div>
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
            {[
              ['Gutter', gutter, setGutter, 24, 'px'],
              ['Tilt', tilt, setTilt, 6, '°'],
              ['Corners', cornerRadius, setCornerRadius, 28, 'px'],
              ['Border', borderW, setBorderW, 12, 'px'],
            ].map(([label, value, set, max, unit]) => (
              <label className="control" key={label}>
                <span className="control-label">
                  {label}{' '}
                  <b>
                    {value}
                    {unit}
                  </b>
                </span>
                <input type="range" min="0" max={max} value={value} onChange={(e) => set(Number(e.target.value))} />
              </label>
            ))}
            {borderW > 0 && (
              <div className="control">
                <span className="control-label">Border colour</span>
                <div className="swatches">
                  {['#ffffff', '#0d0d0d', '#f6f4ef'].map((c) => (
                    <button
                      key={c}
                      className={`swatch ${borderColor === c ? 'active' : ''}`}
                      style={{ background: c }}
                      aria-label={`Border ${c}`}
                      onClick={() => setBorderColor(c)}
                    />
                  ))}
                </div>
              </div>
            )}
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
                {['4:5', '1:1', '9:16'].map((a) => (
                  <button key={a} className={aspect === a ? 'active' : ''} onClick={() => setAspect(a)}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div className="control">
              <span className="control-label">Session</span>
              <button className="chip chip-danger" onClick={startOver}>
                Start over
              </button>
            </div>
            <div className="control">
              <span className="control-label">Mesh</span>
              <div className="segmented" role="group" aria-label="Mesh slides">
                <button className={meshSeams.size === 0 ? 'active' : ''} onClick={meshNone}>
                  None
                </button>
                <button
                  className={meshSeams.size > 0 && meshSeams.size >= Math.max(1, slides.length - 1) ? 'active' : ''}
                  onClick={meshAll}
                  title="Photos flow across every slide seam — or tap the link at any single seam"
                >
                  All
                </button>
              </div>
            </div>
        </div>
      )}

      {hasPhotos && (
        <div className="counts stats-corner glass-thin" aria-live="polite">
          {photos.size} photos · {slides.length} slides
          {tray.length > 0 ? ` · ${tray.length} aside` : ''}
        </div>
      )}

      {hasPhotos && (
        <div className="bottom-cluster">
          {remixNote && (
            <div className="remix-toast glass-thin" role="status" key={remixNote.at}>
              {remixNote.label}
            </div>
          )}
          <nav className="dock glass-thick" aria-label="Actions">
            <button
              className="dock-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={busyImporting}
              aria-label="Add photos"
              title="Add photos"
            >
              <ImagesIcon size={22} weight="duotone" />
            </button>
            <button
              className="dock-btn"
              onClick={remixAll}
              disabled={busyImporting}
              aria-label="Remix"
              title="Remix — regroup every slide with a fresh pairing idea (R)"
            >
              <ShuffleIcon size={22} weight="duotone" />
            </button>
            <button
              className={`dock-btn ${optionsOpen ? 'dock-btn-active' : ''}`}
              onClick={() => setOptionsOpen((o) => !o)}
              aria-expanded={optionsOpen}
              aria-label="Options"
              title="Options (O)"
            >
              <FadersHorizontalIcon size={22} weight="duotone" />
            </button>
            <button
              className="dock-btn dock-btn-primary dock-btn-wide"
              onClick={downloadAll}
              disabled={busyImporting || !!exportState}
              aria-label="Download all"
              title="Download all (D)"
            >
              {exportState ? (
                <span className="dock-progress">
                  {exportState.done < exportState.total
                    ? `Rendering ${exportState.done + 1}/${exportState.total}`
                    : 'Zipping…'}
                </span>
              ) : (
                <>
                  <DownloadSimpleIcon size={18} weight="bold" />
                  <span>Download all</span>
                </>
              )}
            </button>
          </nav>
        </div>
      )}

      {drag && <DragGhost drag={drag} photo={photos.get(drag.photoId)} />}

      {moreEdit &&
        (() => {
          const mi = slides.findIndex((s) => s.key === moreEdit.slideKey)
          if (mi < 0) return null
          return (
            <div className="action-sheet glass-thick" role="dialog" aria-label="Slide actions">
              <span className="sheet-grabber" aria-hidden="true" />
              {slideActions(slides[mi], mi).map(({ Icon, label, fn, disabled, danger }) => (
                <button
                  key={label}
                  className={`sheet-row ${danger ? 'sheet-row-danger' : ''}`}
                  disabled={disabled}
                  onClick={(e) => {
                    haptics.select()
                    setMoreEdit(null)
                    fn(e)
                  }}
                >
                  <Icon size={20} weight="duotone" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )
        })()}

      {tplEdit && (
        <div
          className="tpl-popover glass-thick"
          role="dialog"
          aria-label="Layout template"
          style={
            isMobile
              ? undefined
              : {
                  left: Math.max(8, Math.min(tplEdit.x - 150, window.innerWidth - 320)),
                  top: Math.max(8, Math.min(tplEdit.y + 14, window.innerHeight - 300)),
                }
          }
        >
          <span className="control-label">Template</span>
          <div className="tpl-grid">
            <button
              className={`tpl-option ${!slideTemplates.get(tplEdit.slideKey) ? 'active' : ''}`}
              onClick={() => {
                setSlideTemplates((prev) => {
                  const next = new Map(prev)
                  next.delete(tplEdit.slideKey)
                  return next
                })
              }}
            >
              <span className="tpl-preview tpl-auto">✳︎</span>
              <span className="tpl-name">Auto</span>
            </button>
            {templatesFor(tplEdit.count).map((t) => (
              <button
                key={t.id}
                data-template={t.id}
                className={`tpl-option ${slideTemplates.get(tplEdit.slideKey) === t.id ? 'active' : ''}`}
                onClick={() => setSlideTemplates((prev) => new Map(prev).set(tplEdit.slideKey, t.id))}
              >
                <span className="tpl-preview" style={{ aspectRatio: `${canvasW} / ${canvasH}` }}>
                  {t.cells.map((c, j) => (
                    <span
                      key={j}
                      className="tpl-cell"
                      style={{
                        left: `${c.x * 100}%`,
                        top: `${c.y * 100}%`,
                        width: `${c.w * 100}%`,
                        height: `${c.h * 100}%`,
                        transform: c.rot ? `rotate(${c.rot}deg)` : undefined,
                      }}
                    />
                  ))}
                </span>
                <span className="tpl-name">{t.name}</span>
              </button>
            ))}
          </div>
          {templatesFor(tplEdit.count).length === 0 && (
            <p className="playground-hint">No fixed templates for {tplEdit.count} photos — Auto composes them.</p>
          )}
        </div>
      )}

      {capEdit && (
        <div
          className="cap-popover glass-thick"
          role="dialog"
          aria-label="Caption"
          style={
            isMobile
              ? undefined
              : {
                  left: Math.max(8, Math.min(capEdit.x - 150, window.innerWidth - 320)),
                  top: Math.max(8, Math.min(capEdit.y + 14, window.innerHeight - 180)),
                }
          }
        >
          <span className="control-label">Caption</span>
          <input
            type="text"
            className="cap-input"
            maxLength={80}
            placeholder="Say something…"
            value={captions.get(capEdit.slideKey)?.text ?? ''}
            autoFocus
            onChange={(e) => {
              const text = e.target.value
              setCaptions((prev) => {
                const next = new Map(prev)
                if (!text) next.delete(capEdit.slideKey)
                else next.set(capEdit.slideKey, { text, pos: prev.get(capEdit.slideKey)?.pos ?? 'bottom' })
                return next
              })
            }}
          />
          <div className="segmented" role="group" aria-label="Caption position">
            {['top', 'bottom'].map((p) => (
              <button
                key={p}
                className={(captions.get(capEdit.slideKey)?.pos ?? 'bottom') === p ? 'active' : ''}
                onClick={() =>
                  setCaptions((prev) => {
                    const cur = prev.get(capEdit.slideKey)
                    if (!cur) return prev
                    return new Map(prev).set(capEdit.slideKey, { ...cur, pos: p })
                  })
                }
              >
                {p === 'top' ? 'Top' : 'Bottom'}
              </button>
            ))}
          </div>
        </div>
      )}

      {sizeEdit && (
        <div
          className="size-popover glass-thick"
          role="dialog"
          aria-label="Photo size"
          style={
            isMobile
              ? undefined
              : {
                  left: Math.max(8, Math.min(sizeEdit.x - 130, window.innerWidth - 268)),
                  top: Math.max(8, Math.min(sizeEdit.y + 16, window.innerHeight - 120)),
                }
          }
        >
          <span className="control-label">
            Size <b>×{(sizeBoosts.get(sizeEdit.photoId) ?? 1).toFixed(2)}</b>
          </span>
          <div className="size-popover-row">
            <input
              type="range"
              min="50"
              max="200"
              step="1"
              value={Math.round((sizeBoosts.get(sizeEdit.photoId) ?? 1) * 100)}
              aria-label="Photo size"
              onChange={(e) => {
                const v = Number(e.target.value) / 100
                const prev = sizeBoosts.get(sizeEdit.photoId) ?? 1
                if (prev !== v && (prev - 1) * (v - 1) <= 0) haptics.detent()
                setSizeBoosts((prev) => {
                  const next = new Map(prev)
                  if (v === 1) next.delete(sizeEdit.photoId)
                  else next.set(sizeEdit.photoId, v)
                  return next
                })
              }}
            />
            <button
              className="chip"
              disabled={!sizeBoosts.has(sizeEdit.photoId)}
              onClick={() =>
                setSizeBoosts((prev) => {
                  const next = new Map(prev)
                  next.delete(sizeEdit.photoId)
                  return next
                })
              }
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Instagram-style filter picker: a strip of circular bubbles, each showing a
// real photo from the dump with that look applied. When nobody's choosing,
// the strip rests as a slim row of white dots with the filter names beside
// them; pointing at it (or tapping, on touch) blooms the previews back open.
// Pop-in, idle bob, and selection scale are pure CSS, gated behind
// prefers-reduced-motion.
function FilterBar({ photo, look, setLook }) {
  const [open, setOpen] = useState(false)
  const barRef = useRef(null)
  const closeTimer = useRef(null)
  const cancelClose = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  useEffect(() => cancelClose, [])

  // touch has no hover — a tap anywhere outside the open strip collapses it
  useDismiss(open, (e) => barRef.current?.contains(e.target), () => setOpen(false))

  return (
    <div
      ref={barRef}
      className={`filterbar glass-thick ${open ? '' : 'collapsed'}`}
      role="radiogroup"
      aria-label="Filter"
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return
        cancelClose()
        setOpen(true)
      }}
      // the unfold relayout makes Chrome emit a phantom leave/enter pair, so
      // collapsing waits a beat — a real exit survives it, the phantom doesn't
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return
        cancelClose()
        closeTimer.current = setTimeout(() => setOpen(false), 140)
      }}
    >
      {LOOKS.map((l, i) => (
        <button
          key={l.key}
          data-look={l.key}
          role="radio"
          aria-checked={look === l.key}
          className={`bubble ${look === l.key ? 'active' : ''}`}
          style={{ '--i': i }}
          onFocus={() => setOpen(true)}
          // selection happens on pointerdown — the unfold shifts the strip's
          // layout mid-gesture, so a down/up pair can straddle two elements
          // and never produce a click. Touch gets one wake-up tap first.
          onPointerDown={(e) => {
            if (e.pointerType === 'touch' && !open) {
              setOpen(true)
              return
            }
            setLook(l.key)
          }}
          // keyboard activation (Enter/Space) arrives as a detail-0 click
          onClick={(e) => {
            if (e.detail === 0) setLook(l.key)
          }}
        >
          <span className="bubble-dot" aria-hidden="true" />
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
    if (!bmp || !bmp.width) {
      ctx.fillStyle = '#3a3a44'
      ctx.fillRect(0, 0, size, size)
      return
    }
    // Destination-rect cover draw (no source cropping) + a pure pixel
    // hand-off to the visible canvas — the most Safari-tolerant path.
    const s = Math.max(size / bmp.width, size / bmp.height)
    const dw = bmp.width * s
    const dh = bmp.height * s
    ctx.drawImage(bmp, (size - dw) / 2, (size - dh) / 2, dw, dh)
    const m = matrixFor(photo, lookKey)
    if (m) {
      const imageData = ctx.getImageData(0, 0, size, size)
      applyMatrix(imageData.data, m)
      ctx.putImageData(imageData, 0, 0)
    }
  }, [photo, lookKey])
  return <canvas ref={ref} className="bubble-thumb" aria-hidden="true" />
}

// Draw a photo's preview into a canvas at the size scaleFor picks (2× backed).
function useBitmapCanvas(photo, scaleFor) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    const bmp = photo?.previewBitmap
    if (!canvas || !bmp?.width) return
    const [w, h] = scaleFor(bmp)
    canvas.width = Math.max(1, Math.round(w * 2))
    canvas.height = Math.max(1, Math.round(h * 2))
    canvas.style.width = `${Math.round(w)}px`
    canvas.style.height = `${Math.round(h)}px`
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
  }, [photo]) // eslint-disable-line react-hooks/exhaustive-deps
  return ref
}

// One parked photo on the playground shelf — sized by its own aspect,
// leaning at its own angle like a print on a light table.
function TrayThumb({ photo, onPointerDown }) {
  const ref = useBitmapCanvas(photo, (bmp) => [Math.max(28, (bmp.width / bmp.height) * 76), 76])
  // block scroll only while a drag is actually active, same as the slides
  useEffect(() => {
    const canvas = ref.current
    const onTouchMove = (e) => {
      if (document.body.dataset.dragging === '1') e.preventDefault()
    }
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => canvas.removeEventListener('touchmove', onTouchMove)
  }, [ref])
  const lean = (tiltAngle(photo?.id ?? 0, 7) * 180) / Math.PI
  return (
    <canvas
      ref={ref}
      className="tray-thumb"
      style={{ transform: `rotate(${lean.toFixed(1)}deg)` }}
      onPointerDown={onPointerDown}
    />
  )
}

function DragGhost({ drag, photo }) {
  const ref = useBitmapCanvas(photo, (bmp) => {
    const s = 72 / Math.max(bmp.width, bmp.height)
    return [bmp.width * s, bmp.height * s]
  })
  return (
    <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
      <canvas ref={ref} />
    </div>
  )
}
