// Main-thread side of the import pipeline: a persistent worker pool plus a
// serialized heic2any fallback for browsers without native HEIC decode.
//
// The pool and the heic2any chunk are both created/prefetched at page load so
// the app makes zero network requests afterwards (spec non-negotiable) —
// everything it could ever need is already in the browser.

let nextId = 1

function makeWorker() {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
}

const WORKER_COUNT = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))
const pool = Array.from({ length: WORKER_COUNT }, makeWorker)

// Prefetch the HEIC converter during initial load; resolves to null offline —
// in that case HEIC files on non-Safari browsers are reported as skipped.
const heicModule = import('heic2any').then(
  (m) => m.default,
  () => null,
)

let heicQueue = Promise.resolve()

function convertHeic(file) {
  // serialize conversions — libheif decodes are memory-hungry
  const run = heicQueue.then(async () => {
    const heic2any = await heicModule
    if (!heic2any) throw new Error('heic converter unavailable')
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
    return Array.isArray(out) ? out[0] : out
  })
  heicQueue = run.catch(() => {})
  return run
}

// Imports are serialized so concurrent drops don't fight over the pool.
let importQueue = Promise.resolve()

// Imports files, calling onPhoto(photo) as each finishes, onSkip(name) for
// unsupported files, onProgress(done, total) throughout. Resolves when all
// files have settled. Photo: {id, name, order, blob, previewBitmap, width,
// height, date, aspect}.
export function importFiles(files, callbacks) {
  const run = importQueue.then(() => runImport([...files], callbacks))
  importQueue = run.catch(() => {})
  return run
}

function runImport(list, { onPhoto, onSkip, onProgress }) {
  if (list.length === 0) return Promise.resolve()
  const jobs = new Map() // id → {file, order}
  let queued = 0
  let done = 0

  return new Promise((resolve) => {
    const finishOne = () => {
      done++
      onProgress?.(done, list.length)
      if (done === list.length) {
        for (const w of pool) w.onmessage = null
        resolve()
      }
    }

    const feed = (worker) => {
      if (queued >= list.length) return
      const file = list[queued]
      const order = queued
      queued++
      const id = nextId++
      jobs.set(id, { file, order })
      worker.postMessage({ type: 'file', id, file, name: file.name })
    }

    for (const worker of pool) {
      worker.onmessage = async (e) => {
        const msg = e.data
        const job = jobs.get(msg.id)
        if (!job) return
        if (msg.type === 'done') {
          jobs.delete(msg.id)
          onPhoto({
            id: msg.id,
            name: job.file.name,
            order: job.order,
            blob: msg.blob,
            previewBitmap: msg.preview,
            width: msg.width,
            height: msg.height,
            aspect: msg.width / msg.height,
            date: msg.date,
            quality: msg.quality,
            hash: msg.hash,
            hue: msg.hue,
            sat: msg.sat,
            luma: msg.luma,
            contrast: msg.contrast,
          })
          finishOne()
          feed(worker)
        } else if (msg.type === 'needs-conversion') {
          try {
            const jpeg = await convertHeic(job.file)
            worker.postMessage({ type: 'converted', id: msg.id, blob: jpeg, name: job.file.name, date: msg.date })
          } catch {
            jobs.delete(msg.id)
            onSkip?.(job.file.name)
            finishOne()
            feed(worker)
          }
        } else if (msg.type === 'error') {
          jobs.delete(msg.id)
          onSkip?.(job.file.name)
          finishOne()
          feed(worker)
        }
      }
      feed(worker)
      feed(worker) // keep one job buffered per worker
    }
  })
}
