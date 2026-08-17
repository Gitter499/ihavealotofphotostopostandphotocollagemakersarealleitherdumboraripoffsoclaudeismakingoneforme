import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { importFiles, bumpIdCounter, claimId } from './lib/importer.js'
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
import { LOOKS, matrixFor, applyMatrix, filteredBitmap, withStrength } from './lib/filters.js'
import { fireConfetti } from './lib/confetti.js'
import { exportAllAsZip, renderSlideBlob, slideFileName, saveBlob } from './lib/exportZip.js'
import { remixPlan } from './lib/remix.js'
import { randomSeed } from './lib/rng.js'
import { tiltAngle, orientBitmap, drawDoodles } from './lib/render.js'
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
  CaretUpIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  HandTapIcon,
  ArrowsOutCardinalIcon,
  SparkleIcon,
  CopyIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  ArrowClockwiseIcon,
  FlipHorizontalIcon,
  ScribbleIcon,
  CheckIcon,
} from '@phosphor-icons/react'

const BG_SWATCHES = [
  { key: 'dark', color: '#0d0d0d', label: 'Near-black' },
  { key: 'light', color: '#f2efe9', label: 'Off-white' },
  { key: 'auto', color: null, label: 'Sampled from photos' },
]

let slideKeyCounter = 1
let textKeyCounter = 1
const EMPTY_TEXTS = [] // stable ref so canvases without text don't re-render
const FREEFORM = 'freeform' // sentinel template id: scrapbook absolute placement

// Deterministic scrapbook lean per photo (±7°) — survives drags and reloads.
const tossRot = (id) => ((((id * 2654435761) >>> 9) % 1000) / 1000 - 0.5) * 0.24

// Seeded starting spot for a freeform photo that hasn't been placed yet:
// a loose grid with jitter, so a fresh freeform slide reads as a hand toss.
const autoToss = (j, seed, n) => {
  const h = ((seed + j * 2654435761) ^ (j << 7)) >>> 0
  const rnd = (k) => ((h >>> k) & 1023) / 1023
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  const rows = Math.max(1, Math.ceil(n / cols))
  return {
    x: ((j % cols) + 0.5) / cols * 0.82 + 0.09 + (rnd(0) - 0.5) * 0.12,
    y: (Math.floor(j / cols) + 0.5) / rows * 0.78 + 0.11 + (rnd(5) - 0.5) * 0.1,
  }
}

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
  const [meshSeams, setMeshSeams] = useState(() => new Set()) // seam keys "aKey|bKey" merged into one canvas
  const [sizeBoosts, setSizeBoosts] = useState(() => new Map()) // photoId → area weight (1 = neutral)
  const [sizeEdit, setSizeEdit] = useState(null) // {photoId, x, y} — tap-to-resize popover
  const [slideTemplates, setSlideTemplates] = useState(() => new Map()) // slideKey → template id ('' = auto)
  const [tplEdit, setTplEdit] = useState(null) // {slideKey, count, x, y} — template picker
  const [captions, setCaptions] = useState(() => new Map()) // slideKey → {text, pos}
  const [capEdit, setCapEdit] = useState(null) // {slideKey, x, y} — caption editor
  const [textBoxes, setTextBoxes] = useState(() => new Map()) // slideKey → [{id, text, x, y, size, color, curve}]
  const [freeformPos, setFreeformPos] = useState(() => new Map()) // photoId → {x, y} on a freeform slide
  const [insets, setInsets] = useState(() => new Map()) // photoId → {x, y}: floats above its slide's collage
  const [doodles, setDoodles] = useState(() => new Map()) // slideKey → [{color, size, pts:[x,y,...]}]
  const [doodleEdit, setDoodleEdit] = useState(null) // {slideKey} — full-screen draw mode
  const [doodlePen, setDoodlePen] = useState({ color: '#ffd60a', size: 0.012 })
  const [textEdit, setTextEdit] = useState(null) // {slideKey, textId, x, y} — text box editor
  const [moreEdit, setMoreEdit] = useState(null) // {slideKey} — mobile ⋯ action sheet
  const [showHints, setShowHints] = useState(false) // first-run coach marks
  const [borderW, setBorderW] = useState(0) // px stroke around every photo
  const [borderColor, setBorderColor] = useState('#ffffff')
  const [borderStyle, setBorderStyle] = useState('solid') // solid | double | dashed
  const [lookStrength, setLookStrength] = useState(1) // 0..1 dial on the active look
  const [exportFormat, setExportFormat] = useState('jpeg') // jpeg | png
  const [exportSize, setExportSize] = useState('post') // post 1440 | hd 2160 | print 3240
  const [customAspect, setCustomAspect] = useState({ w: 4, h: 5 })
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
  const canvasH =
    aspect === '1:1'
      ? 1080
      : aspect === '9:16'
        ? 1920
        : aspect === 'custom'
          ? Math.round(Math.min(1920, Math.max(540, (1080 * (customAspect.h || 1)) / (customAspect.w || 1))))
          : 1350
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
      pushHistory()
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
          // rec.width/height are view dims — the blob keeps its original
          // orientation, so decode at blob dims and re-apply rot/flip
          const odd = (rec.rot ?? 0) % 2 === 1
          const bw = odd ? rec.height : rec.width
          const bh = odd ? rec.width : rec.height
          const scale = Math.min(1, 480 / Math.max(bw, bh))
          const decoded = await createImageBitmap(rec.blob, {
            resizeWidth: Math.max(1, Math.round(bw * scale)),
            resizeHeight: Math.max(1, Math.round(bh * scale)),
            resizeQuality: 'medium',
          })
          map.set(rec.id, { ...rec, previewBitmap: orientBitmap(decoded, rec.rot ?? 0, !!rec.flip) })
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
      setCustomAspect(workspace.customAspect ?? { w: 4, h: 5 })
      setBorderW(workspace.borderW ?? 0)
      setBorderColor(workspace.borderColor ?? '#ffffff')
      setBorderStyle(workspace.borderStyle ?? 'solid')
      setLookStrength(workspace.lookStrength ?? 1)
      setExportFormat(workspace.exportFormat ?? 'jpeg')
      setExportSize(workspace.exportSize ?? 'post')
      setMeshSeams(new Set(workspace.meshSeams ?? []))
      setSizeBoosts(new Map(workspace.sizeBoosts ?? []))
      setSlideTemplates(new Map(workspace.slideTemplates ?? []))
      setCaptions(new Map(workspace.captions ?? []))
      const restoredTexts = new Map(workspace.textBoxes ?? [])
      for (const list of restoredTexts.values())
        for (const t of list) {
          const m = /^t(\d+)$/.exec(t.id)
          if (m) textKeyCounter = Math.max(textKeyCounter, Number(m[1]) + 1)
        }
      setTextBoxes(restoredTexts)
      setFreeformPos(new Map(workspace.freeformPos ?? []))
      setInsets(new Map(workspace.insets ?? []))
      setDoodles(new Map(workspace.doodles ?? []))
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
        customAspect,
        borderW,
        borderColor,
        borderStyle,
        lookStrength,
        exportFormat,
        exportSize,
        meshSeams: [...meshSeams],
        sizeBoosts: [...sizeBoosts],
        slideTemplates: [...slideTemplates],
        captions: [...captions],
        textBoxes: [...textBoxes],
        freeformPos: [...freeformPos],
        insets: [...insets],
        doodles: [...doodles],
        savedAt: Date.now(),
      })
    }, 800)
    return () => clearTimeout(t)
  }, [restoring, photos, slides, tray, perSlide, gutter, bgMode, look, tilt, cornerRadius, aspect, customAspect, borderW, borderColor, borderStyle, lookStrength, exportFormat, exportSize, meshSeams, sizeBoosts, slideTemplates, captions, textBoxes, freeformPos, insets, doodles])

  // Per-photo pan: nudge the crop's focal point inside its cell. The photo
  // object carries the new focal (so previews, exports, and the stored
  // session all follow), keeping the saliency answer aside for Reset.
  const nudgeFocal = (photoId, dx, dy) => {
    const p = photos.get(photoId)
    if (!p) return
    pushHistory(`nudge:${photoId}`)
    haptics.tap()
    const base = p.focal ?? { x: 0.5, y: 0.5 }
    const upd = {
      ...p,
      focalAuto: p.focalAuto ?? p.focal ?? null,
      focal: {
        x: Math.min(1, Math.max(0, base.x + dx)),
        y: Math.min(1, Math.max(0, base.y + dy)),
      },
    }
    setPhotos((prev) => new Map(prev).set(photoId, upd))
    savePhotos([upd])
  }

  // Rotate / flip: the orientation is baked into a fresh preview bitmap on
  // the spot (exports and session restore re-apply it from the rot/flip
  // fields), and the focal point rides along so the crop stays on subject.
  const rotatePhoto = (photoId) => {
    const p = photos.get(photoId)
    if (!p?.previewBitmap) return
    pushHistory(`rot:${photoId}`)
    haptics.select()
    const turn = ({ x, y }) => ({ x: 1 - y, y: x })
    const upd = {
      ...p,
      previewBitmap: orientBitmap(p.previewBitmap, 1, false),
      width: p.height,
      height: p.width,
      aspect: p.height / p.width,
      rot: ((p.rot ?? 0) + (p.flip ? 3 : 1)) % 4,
      focal: p.focal ? turn(p.focal) : null,
      focalAuto: p.focalAuto ? turn(p.focalAuto) : (p.focalAuto ?? null),
    }
    setPhotos((prev) => new Map(prev).set(photoId, upd))
    savePhotos([upd])
  }

  const flipPhoto = (photoId) => {
    const p = photos.get(photoId)
    if (!p?.previewBitmap) return
    pushHistory(`flip:${photoId}`)
    haptics.select()
    const mirror = ({ x, y }) => ({ x: 1 - x, y })
    const upd = {
      ...p,
      previewBitmap: orientBitmap(p.previewBitmap, 0, true),
      flip: !p.flip,
      focal: p.focal ? mirror(p.focal) : null,
      focalAuto: p.focalAuto ? mirror(p.focalAuto) : (p.focalAuto ?? null),
    }
    setPhotos((prev) => new Map(prev).set(photoId, upd))
    savePhotos([upd])
  }

  const resetPhotoEdits = async (photoId) => {
    const p = photos.get(photoId)
    if (!p) return
    pushHistory()
    const upd = { ...p, focal: p.focalAuto ?? p.focal, rot: 0, flip: false }
    if ((p.rot ?? 0) !== 0 || p.flip) {
      // un-rotating means re-deriving the preview from the untouched blob
      const ow = (p.rot ?? 0) % 2 === 1 ? p.height : p.width
      const oh = (p.rot ?? 0) % 2 === 1 ? p.width : p.height
      const scale = Math.min(1, 480 / Math.max(ow, oh))
      try {
        upd.previewBitmap = await createImageBitmap(p.blob, {
          resizeWidth: Math.max(1, Math.round(ow * scale)),
          resizeHeight: Math.max(1, Math.round(oh * scale)),
          resizeQuality: 'medium',
        })
        upd.width = ow
        upd.height = oh
        upd.aspect = ow / oh
      } catch {
        // keep the oriented preview if the blob refuses to decode
        upd.rot = p.rot ?? 0
        upd.flip = !!p.flip
      }
    }
    setPhotos((prev) => new Map(prev).set(photoId, upd))
    savePhotos([upd])
    setSizeBoosts((prev) => {
      const next = new Map(prev)
      next.delete(photoId)
      return next
    })
  }

  // First photos ever → one round of coach marks, never again after that.
  useEffect(() => {
    try {
      if (!restoring && photos.size > 0 && !localStorage.getItem('pg-hints-seen')) setShowHints(true)
    } catch {
      // storage blocked — just skip the hints
    }
  }, [restoring, photos])

  const dismissHints = () => {
    haptics.tap()
    try {
      localStorage.setItem('pg-hints-seen', '1')
    } catch {
      // fine — they may see the card once more
    }
    setShowHints(false)
  }

  // Duplicate a slide. Photos live in exactly one slide (drags, mesh and
  // layouts all assume it), so the copy mints fresh photo ids that share the
  // original blobs and metrics.
  const duplicateSlide = (i) => {
    const orig = slides[i]
    if (!orig || slides.length >= MAX_SLIDES) return
    pushHistory()
    haptics.select()
    const clones = orig.photoIds.map((id) => ({ ...photos.get(id), id: claimId() }))
    savePhotos(clones)
    setPhotos((prev) => {
      const next = new Map(prev)
      for (const c of clones) next.set(c.id, c)
      return next
    })
    const copy = { key: `s${slideKeyCounter++}`, photoIds: clones.map((c) => c.id), seed: randomSeed() }
    setSlides((prev) => [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)])
    const cap = captions.get(orig.key)
    if (cap) setCaptions((prev) => new Map(prev).set(copy.key, { ...cap }))
    const tpl = slideTemplates.get(orig.key)
    if (tpl) setSlideTemplates((prev) => new Map(prev).set(copy.key, tpl))
    const texts = textBoxes.get(orig.key)
    if (texts?.length)
      setTextBoxes((prev) => new Map(prev).set(copy.key, texts.map((t) => ({ ...t, id: `t${textKeyCounter++}` }))))
    setFreeformPos((prev) => {
      const next = new Map(prev)
      orig.photoIds.forEach((id, j) => {
        const pos = prev.get(id)
        if (pos) next.set(clones[j].id, { ...pos })
      })
      return next
    })
    setInsets((prev) => {
      const next = new Map(prev)
      orig.photoIds.forEach((id, j) => {
        if (prev.has(id)) next.set(clones[j].id, { ...prev.get(id) })
      })
      return next
    })
    const ink = doodles.get(orig.key)
    if (ink?.length) setDoodles((prev) => new Map(prev).set(copy.key, ink.map((st) => ({ ...st, pts: [...st.pts] }))))
  }

  // Start over: wipe the stored session and the workspace together.
  const startOver = () => {
    if (!window.confirm('Clear every photo and start over?')) return
    pushHistory()
    haptics.warning()
    clearSession()
    setPhotos(new Map())
    setSlides([])
    setTray([])
    setMeshSeams(new Set())
    setSizeBoosts(new Map())
    setSlideTemplates(new Map())
    setCaptions(new Map())
    setTextBoxes(new Map())
    setFreeformPos(new Map())
    setInsets(new Map())
    setDoodles(new Map())
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
        setTextEdit(null)
        setDoodleEdit(null)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) keyActions.current.__redo?.()
        else keyActions.current.__undo?.()
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
  useDismiss(!!textEdit, (e) => e.target.closest?.('.text-popover'), () => setTextEdit(null))
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
    if (photos.size) pushHistory('perSlide')
    setPerSlide(per)
    if (photos.size) recompose(photos, per)
  }

  const seamKey = (i) => (slides[i + 1] ? `${slides[i].key}|${slides[i + 1].key}` : null)

  // Meshed seams chain adjacent filled slides into groups. A group is laid
  // out as ONE wide canvas (n × canvasW): the composition simply continues
  // across the cut, and each slide shows its own window of it.
  const meshGroups = useMemo(() => {
    const groups = [] // { start, end } inclusive slide indices
    let i = 0
    while (i < slides.length) {
      let end = i
      while (
        end < slides.length - 1 &&
        slides[end].photoIds.length > 0 &&
        slides[end + 1].photoIds.length > 0 &&
        slideTemplates.get(slides[end].key) !== FREEFORM &&
        slideTemplates.get(slides[end + 1].key) !== FREEFORM &&
        meshSeams.has(`${slides[end].key}|${slides[end + 1].key}`)
      )
        end++
      groups.push({ start: i, end })
      i = end + 1
    }
    return groups
  }, [slides, meshSeams, slideTemplates])

  const layoutCache = useRef(new Map())
  const layouts = useMemo(() => {
    const nextCache = new Map()
    const result = new Array(slides.length)
    for (const g of meshGroups) {
      const members = slides.slice(g.start, g.end + 1)
      const n = members.length
      const groupW = n * canvasW
      const allIds = members.flatMap((s) => s.photoIds)
      // a pinned template wins over the BSP engine on a solo slide — merged
      // groups always compose freely across the full width
      const pinned = n === 1 ? slideTemplates.get(members[0].key) : null
      const isFree = pinned === FREEFORM
      // inset photos float above the collage, so the flow layout skips them
      // (freeform slides place everything absolutely — insets are moot there)
      const flowIds = isFree ? allIds : allIds.filter((id) => !insets.has(id))
      const eff = effectiveQualities(flowIds, (id) => photos.get(id))
      // tap-to-resize: a boosted photo pulls a matching share of the canvas
      const boosts = flowIds.map((id) => sizeBoosts.get(id) ?? 1)
      const quals = flowIds.map((id) => eff.get(id) ?? 0.5)
      const tpl = pinned && !isFree ? templateById(pinned) : null
      const usingTpl = tpl && tpl.count === flowIds.length
      const seed = members.reduce((a, s) => (Math.imul(a, 31) + s.seed) >>> 0, 17)
      const opts = {
        canvasW: groupW,
        canvasH,
        margin,
        gutter,
        baseSeed: seed,
        qualities: quals,
        weights: boosts.some((b) => b !== 1) ? boosts : null,
      }
      // per-group cache: dragging one photo's size slider only relays out
      // the group that actually changed
      const cacheKey = JSON.stringify([
        members.map((s) => s.key), flowIds, boosts, quals, groupW, canvasH, margin, gutter, seed, usingTpl && tpl.id,
        isFree && allIds.map((id) => freeformPos.get(id) ?? null),
      ])
      const inner =
        layoutCache.current.get(cacheKey) ??
        (isFree
          ? {
              // scrapbook: every photo is a tossed polaroid at its own spot;
              // stored drag positions win over the seeded auto-toss
              rects: allIds.map((id, j) => {
                const pos = freeformPos.get(id) ?? autoToss(j, seed, allIds.length)
                const a = photos.get(id)?.aspect ?? 1
                const base = canvasW * 0.4 * (sizeBoosts.get(id) ?? 1)
                const w = Math.min(canvasW * 0.9, base)
                const h = Math.min(canvasH * 0.9, w / a)
                return { x: pos.x * canvasW - w / 2, y: pos.y * canvasH - h / 2, w, h, rot: tossRot(id), frame: true }
              }),
              seed,
            }
          : usingTpl
            ? { rects: templateRects(tpl, { canvasW: groupW, canvasH, margin, gutter }), seed }
            : computeLayout(flowIds.map((id) => photos.get(id)?.aspect ?? 1), opts))
      nextCache.set(cacheKey, inner)
      // stitch flow cells and floating insets back into photo order; insets
      // sit in their own slide's window, sized by the tap slider
      const rectByFlow = new Map(flowIds.map((id, j) => [id, inner.rects[j] ?? null]))
      const memberOf = new Map()
      members.forEach((s, k) => s.photoIds.forEach((id) => memberOf.set(id, k)))
      const groupRects = allIds.map((id) => {
        if (!isFree && insets.has(id)) {
          const pos = insets.get(id)
          const a = photos.get(id)?.aspect ?? 1
          const w = Math.min(canvasW * 0.62, canvasW * 0.3 * (sizeBoosts.get(id) ?? 1))
          const h = Math.min(canvasH * 0.62, w / a)
          const k = memberOf.get(id) ?? 0
          return { x: k * canvasW + pos.x * canvasW - w / 2, y: pos.y * canvasH - h / 2, w, h, pip: true }
        }
        return rectByFlow.get(id) ?? null
      })
      for (const s of members) {
        for (const [a, b] of s.swaps ?? []) {
          const ia = allIds.indexOf(a)
          const ib = allIds.indexOf(b)
          if (ia >= 0 && ib >= 0 && groupRects[ia] && groupRects[ib] && !groupRects[ia].pip && !groupRects[ib].pip) {
            const t = groupRects[ia]
            groupRects[ia] = groupRects[ib]
            groupRects[ib] = t
          }
        }
      }
      // draw order: flow cells first, floating insets on top of everything
      const drawOrder = allIds
        .map((_, j) => j)
        .sort((a, b) => (groupRects[a]?.pip ? 1 : 0) - (groupRects[b]?.pip ? 1 : 0))
      members.forEach((s, k) => {
        const offsetX = k * canvasW
        // every group cell in this slide's local space — cells crossing the
        // cut clip at the canvas edge and continue on the neighbour; keep
        // only cells near this window so huge groups stay cheap to draw
        const drawIds = []
        const drawRects = []
        const slack = canvasW * 0.1 // tilt rotation can poke past a cell
        drawOrder.forEach((j) => {
          const id = allIds[j]
          const r = groupRects[j]
          if (!r) return
          const local = { ...r, x: r.x - offsetX }
          if (local.x + local.w > -slack && local.x < canvasW + slack) {
            drawIds.push(id)
            drawRects.push(local)
          }
        })
        const rectByAll = new Map(allIds.map((id, j) => [id, groupRects[j]]))
        const rects = s.photoIds.map((id) => {
          const r = rectByAll.get(id)
          return r ? { ...r, x: r.x - offsetX } : null
        })
        result[g.start + k] = { seed: inner.seed, rects, drawIds, drawRects, groupSize: n, groupIndex: k }
      })
    }
    layoutCache.current = nextCache
    return result
  }, [slides, photos, canvasW, canvasH, margin, gutter, meshGroups, sizeBoosts, slideTemplates, freeformPos, insets])

  const toggleSeam = (i) => {
    const key = seamKey(i)
    if (!key) return
    pushHistory()
    haptics.select()
    setMeshSeams((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const meshAll = () => {
    pushHistory()
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
    pushHistory()
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
      const suffix = `:${look}@${lookStrength.toFixed(2)}`
      for (const key of [...cache.keys()]) {
        if (!key.endsWith(suffix)) cache.delete(key)
      }
      const map = new Map()
      let n = 0
      for (const p of photos.values()) {
        const key = `${p.id}o${p.rot ?? 0}${p.flip ? 'f' : ''}${suffix}`
        let bmp = cache.get(key)
        if (!bmp && p.previewBitmap) {
          bmp = await filteredBitmap(p.previewBitmap, withStrength(matrixFor(p, look), lookStrength))
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
  }, [photos, look, lookStrength])

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
    if (bgMode.startsWith('#')) return slides.map(() => bgMode)
    // merged slides share one canvas, so they share one background
    const bgs = new Array(slides.length)
    for (const g of meshGroups) {
      const ids = slides.slice(g.start, g.end + 1).flatMap((s) => s.photoIds)
      const c = averageColor(ids.map((id) => photos.get(id)?.previewBitmap))
      for (let i = g.start; i <= g.end; i++) bgs[i] = c
    }
    return bgs
  }, [bgMode, slides, photos, meshGroups])

  const shuffleSlide = (i) => {
    pushHistory()
    if (slideTemplates.get(slides[i]?.key) === FREEFORM) {
      const ids = new Set(slides[i].photoIds)
      setFreeformPos((prev) => {
        const next = new Map(prev)
        for (const id of ids) next.delete(id)
        return next
      })
    }
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
    pushHistory()
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
    pushHistory()
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
    pushHistory()
    setSlides((prev) =>
      prev.length >= MAX_SLIDES ? prev : [...prev, { key: `s${slideKeyCounter++}`, photoIds: [], seed: randomSeed() }],
    )
  }

  // reorder two photos within one slide: their rects trade places
  const swapPhotos = (slideKey, idA, idB) => {
    pushHistory()
    haptics.select()
    setSlides((prev) =>
      prev.map((s) => (s.key === slideKey ? { ...s, swaps: [...(s.swaps ?? []), [idA, idB]] } : s)),
    )
  }

  // A shelf photo dropped on a cell slots in right at that position. If the
  // slide is already at capacity the drop swaps instead: the shelf photo
  // takes the slot and the old photo goes to the shelf.
  const dropFromTray = (trayId, targetId) => {
    const target = slidesRef.current.find((s) => s.photoIds.includes(targetId))
    if (!target) return
    const swap = target.photoIds.length >= 8
    pushHistory()
    haptics.success()
    setSlides((prev) =>
      prev.map((s) => {
        const idx = s.photoIds.indexOf(targetId)
        if (idx < 0) return s
        const ids = [...s.photoIds]
        if (swap) ids[idx] = trayId
        else ids.splice(idx, 0, trayId)
        return { ...s, photoIds: ids }
      }),
    )
    setTray((t) => {
      const rest = t.filter((id) => id !== trayId)
      return swap ? [...rest, targetId] : rest
    })
  }

  // ---- free text boxes ----
  const addTextBox = (slideKey) => {
    pushHistory()
    haptics.select()
    const id = `t${textKeyCounter++}`
    setTextBoxes((prev) => {
      const next = new Map(prev)
      next.set(slideKey, [
        ...(next.get(slideKey) ?? []),
        { id, text: 'Your words', x: 0.5, y: 0.42, size: 0.07, color: '#ffffff', curve: 0 },
      ])
      return next
    })
    return id
  }

  const updateTextBox = (slideKey, textId, patch, tag = '') => {
    pushHistory(tag)
    setTextBoxes((prev) => {
      const next = new Map(prev)
      next.set(
        slideKey,
        (next.get(slideKey) ?? []).map((t) => (t.id === textId ? { ...t, ...patch } : t)),
      )
      return next
    })
  }

  const deleteTextBox = (slideKey, textId) => {
    pushHistory()
    haptics.tap()
    setTextBoxes((prev) => {
      const next = new Map(prev)
      const rest = (next.get(slideKey) ?? []).filter((t) => t.id !== textId)
      if (rest.length) next.set(slideKey, rest)
      else next.delete(slideKey)
      return next
    })
    setTextEdit(null)
  }

  // Drag moves the box; a clean tap opens its editor. `box` is the canvas
  // rect captured at pointerdown so coords stay stable through the drag.
  const startTextDrag = (e, slideKey, textId, box) => {
    if (exportState) return
    const start = { x: e.clientX, y: e.clientY }
    let moved = false
    const onMove = (ev) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return
      if (!moved) {
        moved = true
        document.body.dataset.dragging = '1'
        haptics.pickup()
        setTextEdit(null)
      }
      const x = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width))
      const y = Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height))
      updateTextBox(slideKey, textId, { x, y }, `tmove:${textId}`)
    }
    const onUp = (ev) => {
      cleanup()
      if (!moved) setTextEdit({ slideKey, textId, x: ev.clientX, y: ev.clientY })
    }
    const cleanup = () => {
      delete document.body.dataset.dragging
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', cleanup)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', cleanup)
  }

  // in a merged group, dropping a photo onto a cell owned by another member
  // slide trades the two photos' slots across the slides
  const swapAcrossSlides = (idA, idB) => {
    pushHistory()
    haptics.select()
    setSlides((prev) =>
      prev.map((s) => {
        let changed = false
        const ids = s.photoIds.map((id) => {
          if (id === idA) {
            changed = true
            return idB
          }
          if (id === idB) {
            changed = true
            return idA
          }
          return id
        })
        return changed ? { ...s, photoIds: ids } : s
      }),
    )
  }

  // "−"/"+" on a slide: rebalance a boundary photo with a neighbouring slide
  const adjustSlide = (i, delta) => {
    pushHistory()
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
    pushHistory()
    setSlides((prev) => {
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [s] = next.splice(from, 1)
      next.splice(to, 0, s)
      return next
    })
  }

  // ---- undo / redo ----
  //
  // Snapshots cover the content state (photos map, slides, tray, seams,
  // boosts, templates, captions) — style settings are cheap to redo by hand
  // and would flood the stack. Maps/arrays are copied shallowly; photo
  // objects are treated as immutable (edits like nudges replace them), so a
  // snapshot is a handful of container copies, not a deep clone.
  const stateRef = useRef(null)
  stateRef.current = { photos, slides, tray, meshSeams, sizeBoosts, slideTemplates, captions, textBoxes, freeformPos, insets, doodles }
  const history = useRef({ past: [], future: [], lastTag: '', lastAt: 0 })
  const [historyTick, setHistoryTick] = useState(0)

  const snap = () => ({
    photos: new Map(stateRef.current.photos),
    slides: stateRef.current.slides,
    tray: stateRef.current.tray,
    meshSeams: new Set(stateRef.current.meshSeams),
    sizeBoosts: new Map(stateRef.current.sizeBoosts),
    slideTemplates: new Map(stateRef.current.slideTemplates),
    captions: new Map(stateRef.current.captions),
    textBoxes: new Map(stateRef.current.textBoxes),
    freeformPos: new Map(stateRef.current.freeformPos),
    insets: new Map(stateRef.current.insets),
    doodles: new Map(stateRef.current.doodles),
  })

  // call BEFORE mutating; same-tag pushes within a second coalesce, so a
  // slider drag is one history entry, not fifty
  const pushHistory = (tag = '') => {
    const h = history.current
    const now = Date.now()
    if (tag && h.lastTag === tag && now - h.lastAt < 1000) {
      h.lastAt = now
      return
    }
    h.lastTag = tag
    h.lastAt = now
    h.past.push(snap())
    if (h.past.length > 60) h.past.shift()
    h.future = []
    setHistoryTick((t) => t + 1)
  }

  const applySnapshot = (s) => {
    // keep the photo store in step: resurrect blobs an undo brings back,
    // drop the ones a redo removes again
    const cur = stateRef.current.photos
    const back = []
    const gone = []
    for (const [id, p] of s.photos) if (!cur.has(id)) back.push(p)
    for (const id of cur.keys()) if (!s.photos.has(id)) gone.push(id)
    if (back.length) savePhotos(back)
    if (gone.length) deletePhotos(gone)
    setPhotos(s.photos)
    setSlides(s.slides)
    setTray(s.tray)
    setMeshSeams(s.meshSeams)
    setSizeBoosts(s.sizeBoosts)
    setSlideTemplates(s.slideTemplates)
    setCaptions(s.captions)
    setTextBoxes(s.textBoxes)
    setFreeformPos(s.freeformPos)
    setInsets(s.insets)
    setDoodles(s.doodles)
  }

  const undo = () => {
    const h = history.current
    const prev = h.past.pop()
    if (!prev) return
    haptics.tap()
    h.future.push(snap())
    h.lastTag = ''
    applySnapshot(prev)
    setHistoryTick((t) => t + 1)
  }

  const redo = () => {
    const h = history.current
    const next = h.future.pop()
    if (!next) return
    haptics.tap()
    h.past.push(snap())
    h.lastTag = ''
    applySnapshot(next)
    setHistoryTick((t) => t + 1)
  }

  // ---- playground: a shelf where photos sit out of every slide ----
  const TRAY_KEY = '__tray__'
  const ADD_KEY = '__new__' // dropping on the add-slide skeleton births a slide

  // Move a photo anywhere: slide → slide, slide → playground, playground →
  // slide, or onto the add-slide card to start a fresh slide with it. A
  // drained source slide folds away, but deliberately added empty slides
  // stay put, waiting for photos.
  const relocatePhoto = (photoId, toKey) => {
    const fromKey = slidesRef.current.find((s) => s.photoIds.includes(photoId))?.key ?? TRAY_KEY
    if (fromKey === toKey) return
    if (toKey === ADD_KEY && slidesRef.current.length >= MAX_SLIDES) return
    pushHistory()
    haptics.select()
    setTray((prev) => (toKey === TRAY_KEY ? [...prev, photoId] : prev.filter((id) => id !== photoId)))
    setSlides((prev) => {
      const next = prev
        .map((s) => {
          if (s.key === fromKey)
            return { ...s, photoIds: s.photoIds.filter((id) => id !== photoId), seed: randomSeed() }
          if (s.key === toKey) return { ...s, photoIds: [...s.photoIds, photoId], seed: randomSeed() }
          return s
        })
        .filter((s) => s.photoIds.length > 0 || s.key !== fromKey)
      return toKey === ADD_KEY ? [...next, { key: `s${slideKeyCounter++}`, photoIds: [photoId], seed: randomSeed() }] : next
    })
  }

  // hand every parked photo back, each to whichever slide is emptiest
  const returnAllFromTray = () => {
    const parked = trayRef.current
    if (parked.length === 0) return
    pushHistory()
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
    // Freeform slides are scrapbooks: dragging moves the photo absolutely on
    // its own canvas (like a text box) instead of relocating it. "To shelf"
    // in the tap popover and the steppers still move photos out.
    const freeOwner = slidesRef.current.find((s) => s.photoIds.includes(photoId))
    const ownerIsFree = freeOwner && slideTemplates.get(freeOwner.key) === FREEFORM
    const floating = ownerIsFree || (freeOwner && insets.has(photoId))
    if (floating && !trayRef.current.includes(photoId)) {
      const box = e.target.getBoundingClientRect?.()
      if (box) {
        const start = { x: e.clientX, y: e.clientY }
        let moved = false
        const onMove = (ev) => {
          if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return
          if (!moved) {
            moved = true
            document.body.dataset.dragging = '1'
            haptics.pickup()
            setSizeEdit(null)
          }
          pushHistory(`fmove:${photoId}`)
          const x = Math.min(0.96, Math.max(0.04, (ev.clientX - box.left) / box.width))
          const y = Math.min(0.96, Math.max(0.04, (ev.clientY - box.top) / box.height))
          const place = ownerIsFree ? setFreeformPos : setInsets
          place((prev) => new Map(prev).set(photoId, { x, y }))
        }
        const onUp = (ev) => {
          cleanupFree()
          if (!moved) setSizeEdit({ photoId, x: ev.clientX, y: ev.clientY })
        }
        const cleanupFree = () => {
          delete document.body.dataset.dragging
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', cleanupFree)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', cleanupFree)
        return
      }
    }
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
      const overKey = el?.closest?.('.playground')
        ? TRAY_KEY
        : el?.closest?.('.add-slide')
          ? ADD_KEY
          : (card?.dataset.slideKey ?? null)
      setDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY, overKey } : d))
    }
    const onUp = (ev) => {
      if (!active) {
        // a clean tap (no drag) selects the photo for resizing — shelf
        // thumbs stay tap-free
        if (!trayRef.current.includes(photoId)) setSizeEdit({ photoId, x: ev.clientX, y: ev.clientY })
      }
      if (active) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY)
        const card = el?.closest?.('[data-slide-key]')
        const toKey = card?.dataset.slideKey
        const fromTray = trayRef.current.includes(photoId)
        // in a merged group a photo can be drawn on its neighbour's canvas —
        // resolve the slide that actually owns it before deciding move vs swap
        const ownerKey = slidesRef.current.find((s) => s.photoIds.includes(photoId))?.key ?? slideKey
        if (el?.closest?.('.playground')) {
          relocatePhoto(photoId, TRAY_KEY)
        } else if (el?.closest?.('.add-slide')) {
          relocatePhoto(photoId, ADD_KEY)
        } else if (toKey && fromTray) {
          // a shelf photo dropped on a cell slots in at that position (or
          // swaps, when the slide is full); on empty canvas it just joins
          const canvasEl = card.querySelector('.slide-canvas')
          const idx = slidesRef.current.findIndex((s) => s.key === toKey)
          let targetId = null
          if (canvasEl && idx >= 0) {
            const box = canvasEl.getBoundingClientRect()
            const x = ((ev.clientX - box.left) / box.width) * canvasW
            const y = ((ev.clientY - box.top) / box.height) * canvasH
            const layout = layoutsRef.current[idx] ?? {}
            const ids = layout.drawIds ?? slidesRef.current[idx].photoIds
            const rects = layout.drawRects ?? layout.rects ?? []
            for (let r = rects.length - 1; r >= 0; r--) {
              const rect = rects[r]
              if (rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
                targetId = ids[r]
                break
              }
            }
          }
          if (targetId != null) dropFromTray(photoId, targetId)
          else relocatePhoto(photoId, toKey)
        } else if (toKey && toKey !== ownerKey) {
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
            const ids = layout.drawIds ?? slidesRef.current[idx].photoIds
            const rects = layout.drawRects ?? layout.rects ?? []
            let targetId = null
            // reverse order: overlapping cells draw last-on-top
            for (let r = rects.length - 1; r >= 0; r--) {
              const rect = rects[r]
              if (rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
                targetId = ids[r]
                break
              }
            }
            if (targetId != null && targetId !== photoId) {
              const targetOwner = slidesRef.current.find((s) => s.photoIds.includes(targetId))?.key
              if (targetOwner === ownerKey) swapPhotos(ownerKey, photoId, targetId)
              else if (targetOwner) swapAcrossSlides(photoId, targetId)
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
  const EXPORT_SCALES = { post: 4 / 3, hd: 2, print: 3 }
  const exportOpts = { width: canvasW, height: canvasH, scale: EXPORT_SCALES[exportSize] ?? 4 / 3 }
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
          lookStrength,
          tilt,
          radius: cornerRadius,
          border: borderW > 0 ? { width: borderW, color: borderColor, style: borderStyle } : null,
          captions,
          textsBySlide: textBoxes,
          doodlesBySlide: doodles,
          format: exportFormat,
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
      lookStrength,
      tilt,
      radius: cornerRadius,
      border: borderW > 0 ? { width: borderW, color: borderColor, style: borderStyle } : null,
      caption: captions.get(slides[i].key) ?? null,
      texts: textBoxes.get(slides[i].key) ?? [],
      doodles: doodles.get(slides[i].key) ?? [],
      format: exportFormat,
    })
    saveBlob(blob, slideFileName(i, exportFormat))
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
    {
      Icon: ScribbleIcon,
      label: 'Doodle on this slide',
      fn: () => {
        haptics.select()
        setDoodleEdit({ slideKey: slide.key })
      },
      disabled: slide.photoIds.length === 0,
    },
    {
      Icon: CopyIcon,
      label: 'Duplicate this slide',
      fn: () => duplicateSlide(i),
      disabled: slide.photoIds.length === 0 || slides.length >= MAX_SLIDES,
    },
    { Icon: ShuffleIcon, label: 'Shuffle this slide', fn: () => shuffleSlide(i), disabled: slide.photoIds.length === 0, primary: true },
    {
      Icon: DownloadSimpleIcon,
      label: 'Download this slide',
      fn: () => downloadOne(i),
      disabled: slide.photoIds.length === 0,
      primary: true,
    },
    { Icon: TrashIcon, label: 'Delete this slide', fn: () => deleteSlide(i), danger: true, primary: true },
  ]

  const hasPhotos = photos.size > 0
  const busyImporting = importState != null

  // single-letter shortcuts, hinted in the dock button titles
  keyActions.current = {
    __undo: undo,
    __redo: redo,
    ...(hasPhotos
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
      : {}),
  }

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
          {look !== 'off' && (
            <div className="strength-row">
              <input
                type="range"
                min="20"
                max="100"
                value={Math.round(lookStrength * 100)}
                aria-label="Filter strength"
                onChange={(e) => setLookStrength(Number(e.target.value) / 100)}
              />
              <span className="strength-value">{Math.round(lookStrength * 100)}%</span>
            </div>
          )}
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
                  layouts[i]?.groupIndex > 0 ? 'mesh-join-left' : ''
                } ${layouts[i] && layouts[i].groupIndex < layouts[i].groupSize - 1 ? 'mesh-join-right' : ''} ${
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
                    {/* budgeted header: the three most-used actions inline on
                        desktop, everything else behind one ⋯ sheet — the same
                        grammar phones already use */}
                    {!isMobile &&
                      slideActions(slide, i)
                        .filter((a) => a.primary)
                        .map(({ Icon, label, fn, disabled, danger }) => (
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
                        ))}
                    <button
                      className="icon-btn"
                      onClick={() => {
                        haptics.tap()
                        setMoreEdit({ slideKey: slide.key })
                      }}
                      aria-label="Slide actions"
                      title="Layout, caption, doodle, duplicate…"
                    >
                      <DotsThreeIcon size={20} weight="bold" />
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
                    tilt={tilt}
                    radius={cornerRadius}
                    border={borderW > 0 ? { width: borderW, color: borderColor, style: borderStyle } : null}
                    caption={captions.get(slide.key) ?? null}
                    texts={textBoxes.get(slide.key) ?? EMPTY_TEXTS}
                    doodles={doodles.get(slide.key) ?? EMPTY_TEXTS}
                    onTextPointerDown={(e, textId, box) => startTextDrag(e, slide.key, textId, box)}
                    animKey={`${slide.key}:${aspect}:${gutter}:${(layouts[i]?.drawIds ?? []).join('.')}:${(layouts[i]?.drawRects ?? [])
                      .map((r) => (r ? `${r.x | 0},${r.y | 0},${r.w | 0}` : ''))
                      .join(';')}`}
                    onPhotoPointerDown={(e, photoId) => startPhotoDrag(e, slide.key, photoId)}
                  />
                )}
                {/* the chip for the seam BEFORE this card lives on this card:
                    later cards paint above earlier ones (glass = stacking
                    context), so the chip stays on top of a fused joint */}
                {i > 0 &&
                  slide.photoIds.length > 0 &&
                  slides[i - 1].photoIds.length > 0 &&
                  slideTemplates.get(slide.key) !== FREEFORM &&
                  slideTemplates.get(slides[i - 1].key) !== FREEFORM &&
                  (() => {
                    const meshed = meshSeams.has(seamKey(i - 1))
                    const Icon = meshed ? LinkSimpleIcon : LinkBreakIcon
                    return (
                      <button
                        className={`mesh-link glass-thick ${meshed ? 'mesh-link-on' : 'mesh-link-off'}`}
                        onClick={() => toggleSeam(i - 1)}
                        onMouseEnter={() => setHoverSeam(i - 1)}
                        onMouseLeave={() => setHoverSeam(null)}
                        onFocus={() => setHoverSeam(i - 1)}
                        onBlur={() => setHoverSeam(null)}
                        aria-pressed={meshed}
                        aria-label={meshed ? 'Unmesh these slides' : 'Mesh these slides'}
                        title={
                          meshed
                            ? 'Merged — one composition flows across both slides. Tap to separate.'
                            : 'Tap to merge these slides into one wide canvas.'
                        }
                      >
                        <Icon size={17} weight="bold" />
                      </button>
                    )
                  })()}
              </div>
            ))}
            {slides.length < MAX_SLIDES && !busyImporting && (
              <button
                className={`add-slide ${drag?.overKey === ADD_KEY ? 'drop-target' : ''}`}
                onClick={addEmptySlide}
                aria-label="Add slide"
              >
                <span className="add-slide-plus" aria-hidden="true">
                  +
                </span>
                <span className="add-slide-hint">{drag ? 'Drop for a new slide' : 'New slide'}</span>
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
                <span className="control-label">Border style</span>
                <div className="segmented" role="group" aria-label="Border style">
                  {['solid', 'double', 'dashed'].map((s) => (
                    <button key={s} className={borderStyle === s ? 'active' : ''} onClick={() => setBorderStyle(s)}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
                <input
                  type="color"
                  className={`swatch swatch-pick ${bgMode.startsWith('#') ? 'active' : ''}`}
                  value={bgMode.startsWith('#') ? bgMode : '#22242c'}
                  aria-label="Custom background colour"
                  title="Pick any colour"
                  onChange={(e) => setBgMode(e.target.value)}
                />
              </div>
            </div>
            <div className="control">
              <span className="control-label">Aspect</span>
              <div className="segmented">
                {['4:5', '1:1', '9:16', 'custom'].map((a) => (
                  <button key={a} className={aspect === a ? 'active' : ''} onClick={() => setAspect(a)}>
                    {a === 'custom' ? '…' : a}
                  </button>
                ))}
              </div>
            </div>
            {aspect === 'custom' && (
              <div className="control">
                <span className="control-label">
                  Custom ratio <b>{customAspect.w}:{customAspect.h}</b>
                </span>
                <div className="ratio-inputs">
                  {['w', 'h'].map((k) => (
                    <input
                      key={k}
                      type="number"
                      min="1"
                      max="32"
                      value={customAspect[k]}
                      aria-label={k === 'w' ? 'Ratio width' : 'Ratio height'}
                      onChange={(e) =>
                        setCustomAspect((c) => ({ ...c, [k]: Math.max(1, Math.min(32, Number(e.target.value) || 1)) }))
                      }
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="control">
              <span className="control-label">Export</span>
              <div className="segmented" role="group" aria-label="Export format">
                {['jpeg', 'png'].map((f) => (
                  <button key={f} className={exportFormat === f ? 'active' : ''} onClick={() => setExportFormat(f)}>
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="segmented" role="group" aria-label="Export size">
                {[
                  ['post', 'Post', 'Instagram max — 1440px wide'],
                  ['hd', 'HD', '2160px wide'],
                  ['print', 'Print', '3240px wide — 300dpi at ~11in'],
                ].map(([k, label, tip]) => (
                  <button key={k} className={exportSize === k ? 'active' : ''} title={tip} onClick={() => setExportSize(k)}>
                    {label}
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
                  title="Every slide merges into one continuous canvas — or tap the link at any single seam"
                >
                  All
                </button>
              </div>
            </div>
        </div>
      )}

      {hasPhotos && (
        <div className="bottom-cluster">
          {remixNote && (
            <div className="remix-toast glass-thin" role="status" key={remixNote.at}>
              {remixNote.label}
            </div>
          )}
          <div className="dock-row">
            <span className="dock-stats">
              <span className="counts" aria-live="polite">
                {photos.size}
                <span className="cw"> photos</span>
                {' · '}
                {slides.length}
                <span className="cw"> slides</span>
                {tray.length > 0 && (
                  <>
                    {' · '}
                    {tray.length}
                    <span className="cw"> aside</span>
                  </>
                )}
              </span>
              <button
                className="lobe-btn"
                onClick={undo}
                disabled={history.current.past.length === 0}
                aria-label="Undo"
                title="Undo (⌘Z)"
              >
                <ArrowUUpLeftIcon size={14} weight="bold" />
              </button>
              <button
                className="lobe-btn"
                onClick={redo}
                disabled={history.current.future.length === 0}
                aria-label="Redo"
                title="Redo (⇧⌘Z)"
              >
                <ArrowUUpRightIcon size={14} weight="bold" />
              </button>
            </span>
            <nav className="dock" aria-label="Actions">
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
        </div>
      )}

      {showHints && (
        <div className="hints-scrim" onClick={dismissHints}>
          <div className="hints-card glass-thick" role="dialog" aria-label="How it works" onClick={(e) => e.stopPropagation()}>
            <span className="control-label">How it works</span>
            {[
              { Icon: HandTapIcon, text: 'Tap any photo to resize it or slide its crop around.' },
              { Icon: ArrowsOutCardinalIcon, text: 'Drag photos between slides — or park them on the playground shelf below.' },
              { Icon: LinkSimpleIcon, text: 'Tap the link between two slides to merge them into one wide canvas.' },
              { Icon: SparkleIcon, text: 'The dots up top are filters. Point at them to preview, tap to apply.' },
            ].map(({ Icon, text }) => (
              <div key={text} className="hint-row">
                <Icon size={22} weight="duotone" />
                <span>{text}</span>
              </div>
            ))}
            <button className="dock-btn dock-btn-primary dock-btn-wide hints-done" onClick={dismissHints}>
              Got it
            </button>
          </div>
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
              {slideActions(slides[mi], mi)
                .filter((a) => isMobile || !a.primary)
                .map(({ Icon, label, fn, disabled, danger }) => (
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
                pushHistory()
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
            <button
              data-template="freeform"
              className={`tpl-option ${slideTemplates.get(tplEdit.slideKey) === FREEFORM ? 'active' : ''}`}
              title="Scrapbook: polaroids you drag anywhere on the slide"
              onClick={() => {
                pushHistory()
                haptics.select()
                setSlideTemplates((prev) => new Map(prev).set(tplEdit.slideKey, FREEFORM))
              }}
            >
              <span className="tpl-preview tpl-auto">✋</span>
              <span className="tpl-name">Freeform</span>
            </button>
            {templatesFor(tplEdit.count).map((t) => (
              <button
                key={t.id}
                data-template={t.id}
                className={`tpl-option ${slideTemplates.get(tplEdit.slideKey) === t.id ? 'active' : ''}`}
                onClick={() => {
                  pushHistory()
                  setSlideTemplates((prev) => new Map(prev).set(tplEdit.slideKey, t.id))
                }}
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
              pushHistory(`cap:${capEdit.slideKey}`)
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
          <button
            className="chip"
            title="Drop a movable text box on the slide — drag it anywhere, tap it to style"
            onClick={() => {
              const slideKey = capEdit.slideKey
              const id = addTextBox(slideKey)
              setCapEdit(null)
              setTextEdit({ slideKey, textId: id, x: capEdit.x, y: capEdit.y })
            }}
          >
            + Text box
          </button>
        </div>
      )}

      {textEdit &&
        (() => {
          const t = (textBoxes.get(textEdit.slideKey) ?? []).find((b) => b.id === textEdit.textId)
          if (!t) return null
          return (
            <div
              className="text-popover glass-thick"
              role="dialog"
              aria-label="Text box"
              style={
                isMobile
                  ? undefined
                  : {
                      left: Math.max(8, Math.min(textEdit.x - 150, window.innerWidth - 320)),
                      top: Math.max(8, Math.min(textEdit.y + 14, window.innerHeight - 250)),
                    }
              }
            >
              <span className="control-label">Text box</span>
              <textarea
                className="cap-input"
                rows={2}
                maxLength={120}
                placeholder="Say something…"
                value={t.text}
                autoFocus
                onChange={(e) => updateTextBox(textEdit.slideKey, textEdit.textId, { text: e.target.value }, `ttext:${t.id}`)}
              />
              <div className="size-popover-row">
                <span className="mini-label">Size</span>
                <input
                  type="range"
                  min="3"
                  max="18"
                  value={Math.round((t.size ?? 0.07) * 100)}
                  aria-label="Text size"
                  onChange={(e) => updateTextBox(textEdit.slideKey, textEdit.textId, { size: Number(e.target.value) / 100 }, `tsize:${t.id}`)}
                />
              </div>
              <div className="size-popover-row">
                <span className="mini-label">Curve</span>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={Math.round((t.curve ?? 0) * 100)}
                  aria-label="Text curve"
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100
                    if ((t.curve ?? 0) !== 0 && (t.curve ?? 0) * v <= 0) haptics.detent()
                    updateTextBox(textEdit.slideKey, textEdit.textId, { curve: v }, `tcurve:${t.id}`)
                  }}
                />
              </div>
              <div className="size-popover-row">
                <input
                  type="color"
                  className="swatch swatch-pick"
                  value={t.color ?? '#ffffff'}
                  aria-label="Text colour"
                  onChange={(e) => updateTextBox(textEdit.slideKey, textEdit.textId, { color: e.target.value }, `tcolor:${t.id}`)}
                />
                <span className="nudge-hint">drag the text on the slide to place it</span>
                <button className="chip chip-danger" onClick={() => deleteTextBox(textEdit.slideKey, textEdit.textId)}>
                  Delete
                </button>
              </div>
            </div>
          )
        })()}

      {doodleEdit &&
        (() => {
          const dIdx = slides.findIndex((s) => s.key === doodleEdit.slideKey)
          if (dIdx < 0) return null
          const dSlide = slides[dIdx]
          const ink = doodles.get(dSlide.key) ?? EMPTY_TEXTS
          return (
            <div className="doodle-mode" role="dialog" aria-label="Doodle">
              <div
                className="doodle-stage"
                style={{
                  aspectRatio: `${canvasW} / ${canvasH}`,
                  width: `min(92vw, calc((100dvh - 180px) * ${(canvasW / canvasH).toFixed(4)}))`,
                }}
              >
                <SlideCanvas
                  slide={dSlide}
                  layout={layouts[dIdx]}
                  photos={photos}
                  canvasW={canvasW}
                  canvasH={canvasH}
                  bg={slideBgs[dIdx]}
                  imagesOverride={lookImages}
                  tilt={tilt}
                  radius={cornerRadius}
                  border={borderW > 0 ? { width: borderW, color: borderColor, style: borderStyle } : null}
                  caption={captions.get(dSlide.key) ?? null}
                  texts={textBoxes.get(dSlide.key) ?? EMPTY_TEXTS}
                  doodles={ink}
                  animKey="doodle-mode"
                />
                <DoodleOverlay
                  pen={doodlePen}
                  onCommit={(stroke) => {
                    pushHistory()
                    setDoodles((prev) => {
                      const next = new Map(prev)
                      next.set(dSlide.key, [...(next.get(dSlide.key) ?? []), stroke])
                      return next
                    })
                  }}
                />
              </div>
              <div className="doodle-tools glass-thick">
                {['#ffffff', '#0a0a0f', '#ffd60a', '#ff375f', '#0a84ff'].map((c) => (
                  <button
                    key={c}
                    className={`swatch ${doodlePen.color === c ? 'active' : ''}`}
                    style={{ background: c }}
                    aria-label={`Pen colour ${c}`}
                    onClick={() => setDoodlePen((p) => ({ ...p, color: c }))}
                  />
                ))}
                <input
                  type="range"
                  min="4"
                  max="30"
                  value={Math.round(doodlePen.size * 1000)}
                  aria-label="Brush size"
                  onChange={(e) => setDoodlePen((p) => ({ ...p, size: Number(e.target.value) / 1000 }))}
                />
                <button
                  className="chip"
                  disabled={ink.length === 0}
                  onClick={() => {
                    pushHistory()
                    setDoodles((prev) => {
                      const next = new Map(prev)
                      const rest = (next.get(dSlide.key) ?? []).slice(0, -1)
                      if (rest.length) next.set(dSlide.key, rest)
                      else next.delete(dSlide.key)
                      return next
                    })
                  }}
                >
                  Undo stroke
                </button>
                <button
                  className="chip"
                  disabled={ink.length === 0}
                  onClick={() => {
                    pushHistory()
                    setDoodles((prev) => {
                      const next = new Map(prev)
                      next.delete(dSlide.key)
                      return next
                    })
                  }}
                >
                  Clear
                </button>
                <button
                  className="chip doodle-done"
                  onClick={() => {
                    haptics.success()
                    setDoodleEdit(null)
                  }}
                >
                  <CheckIcon size={15} weight="bold" /> Done
                </button>
              </div>
            </div>
          )
        })()}

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
                pushHistory(`size:${sizeEdit.photoId}`)
                if (prev !== v && (prev - 1) * (v - 1) <= 0) haptics.detent()
                setSizeBoosts((prev) => {
                  const next = new Map(prev)
                  if (v === 1) next.delete(sizeEdit.photoId)
                  else next.set(sizeEdit.photoId, v)
                  return next
                })
              }}
            />
            <button className="chip" onClick={() => resetPhotoEdits(sizeEdit.photoId)}>
              Reset
            </button>
          </div>
          <div className="size-popover-row">
            <button
              className="chip"
              title="Park this photo on the playground shelf"
              onClick={() => {
                relocatePhoto(sizeEdit.photoId, TRAY_KEY)
                setSizeEdit(null)
              }}
            >
              To shelf
            </button>
            {(() => {
              const owner = slides.find((s) => s.photoIds.includes(sizeEdit.photoId))
              if (!owner || slideTemplates.get(owner.key) === FREEFORM) return null
              const isInset = insets.has(sizeEdit.photoId)
              const others = owner.photoIds.filter((id) => !insets.has(id)).length
              return (
                <button
                  className="chip"
                  disabled={!isInset && others < 2}
                  title={
                    isInset
                      ? 'Tuck the photo back into the collage grid'
                      : 'Float this photo above the collage — drag it anywhere'
                  }
                  onClick={() => {
                    pushHistory()
                    haptics.select()
                    setInsets((prev) => {
                      const next = new Map(prev)
                      if (isInset) next.delete(sizeEdit.photoId)
                      else next.set(sizeEdit.photoId, { x: 0.76, y: 0.76 })
                      return next
                    })
                  }}
                >
                  {isInset ? 'Un-float' : 'Float'}
                </button>
              )
            })()}
          </div>
          <span className="control-label">Position</span>
          <div className="size-popover-row nudge-row">
            {[
              { Icon: CaretLeftIcon, label: 'Nudge left', dx: -0.1, dy: 0 },
              { Icon: CaretUpIcon, label: 'Nudge up', dx: 0, dy: -0.1 },
              { Icon: CaretDownIcon, label: 'Nudge down', dx: 0, dy: 0.1 },
              { Icon: CaretRightIcon, label: 'Nudge right', dx: 0.1, dy: 0 },
            ].map(({ Icon, label, dx, dy }) => (
              <button
                key={label}
                className="icon-btn"
                aria-label={label}
                title={label}
                onClick={() => nudgeFocal(sizeEdit.photoId, dx, dy)}
              >
                <Icon size={16} weight="bold" />
              </button>
            ))}
            <span className="nudge-hint">slides the crop inside its slot</span>
          </div>
          <span className="control-label">Orientation</span>
          <div className="size-popover-row nudge-row">
            <button
              className="icon-btn"
              aria-label="Rotate 90°"
              title="Rotate 90° clockwise"
              onClick={() => rotatePhoto(sizeEdit.photoId)}
            >
              <ArrowClockwiseIcon size={16} weight="bold" />
            </button>
            <button
              className="icon-btn"
              aria-label="Flip horizontally"
              title="Flip horizontally"
              onClick={() => flipPhoto(sizeEdit.photoId)}
            >
              <FlipHorizontalIcon size={16} weight="bold" />
            </button>
            <span className="nudge-hint">
              {(photos.get(sizeEdit.photoId)?.rot ?? 0) * 90}°{photos.get(sizeEdit.photoId)?.flip ? ' · mirrored' : ''}
            </span>
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
// Transparent capture layer for doodle mode: committed strokes render in the
// SlideCanvas beneath; this only draws the stroke being dragged right now.
function DoodleOverlay({ pen, onCommit }) {
  const ref = useRef(null)
  const live = useRef(null)

  const redraw = () => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth
    const h = c.clientHeight
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (live.current) drawDoodles(ctx, w, h, [live.current])
  }

  const onPointerDown = (e) => {
    e.preventDefault()
    const box = ref.current.getBoundingClientRect()
    const norm = (ev) => [
      Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width)),
      Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height)),
    ]
    const [x, y] = norm(e)
    live.current = { color: pen.color, size: pen.size, pts: [x, y] }
    haptics.tap()
    redraw()
    const onMove = (ev) => {
      const [nx, ny] = norm(ev)
      const pts = live.current.pts
      const lx = pts[pts.length - 2]
      const ly = pts[pts.length - 1]
      if (Math.hypot((nx - lx) * box.width, (ny - ly) * box.height) < 2.5) return
      pts.push(nx, ny)
      redraw()
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (live.current) onCommit(live.current)
      live.current = null
      redraw()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return <canvas ref={ref} className="doodle-overlay" onPointerDown={onPointerDown} />
}

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
