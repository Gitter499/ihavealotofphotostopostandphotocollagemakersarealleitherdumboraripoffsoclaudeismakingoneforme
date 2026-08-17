// Import worker: EXIF date + decode + downscale off the main thread.
// Stateless — HEIC files the browser can't decode bounce back to the main
// thread for conversion, then return here as JPEG via {type:'converted'}.

import exifr from 'exifr'

const MAX_DIM = 2160 // spec: cap the long edge on import so 200 photos fit in memory
const PREVIEW_DIM = 480 // small bitmap kept resident for on-screen rendering

async function readDate(blob) {
  try {
    const ex = await exifr.parse(blob, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] })
    const d = ex?.DateTimeOriginal ?? ex?.CreateDate ?? ex?.ModifyDate
    if (d instanceof Date && !isNaN(d)) return d.getTime()
  } catch {
    // no metadata is fine — sorting falls back to filename
  }
  return null
}

async function decode(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    // some engines reject the options bag — retry bare
    return await createImageBitmap(blob)
  }
}

function looksLikeHeic(name, type) {
  if (type && /hei[cf]/i.test(type)) return true
  return /\.hei[cf]$/i.test(name || '')
}

async function process(id, blob, name, date) {
  let bmp
  try {
    bmp = await decode(blob)
  } catch {
    if (looksLikeHeic(name, blob.type)) {
      postMessage({ type: 'needs-conversion', id, date })
    } else {
      postMessage({ type: 'error', id, reason: 'unsupported' })
    }
    return
  }
  try {
    const w0 = bmp.width
    const h0 = bmp.height
    const scale = Math.min(1, MAX_DIM / Math.max(w0, h0))
    let width = w0
    let height = h0
    let stored = blob
    if (scale < 1) {
      width = Math.max(1, Math.round(w0 * scale))
      height = Math.max(1, Math.round(h0 * scale))
      const oc = new OffscreenCanvas(width, height)
      const ctx = oc.getContext('2d')
      ctx.drawImage(bmp, 0, 0, width, height)
      stored = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
    }
    const ps = Math.min(1, PREVIEW_DIM / Math.max(width, height))
    const pw = Math.max(1, Math.round(width * ps))
    const ph = Math.max(1, Math.round(height * ps))
    const pc = new OffscreenCanvas(pw, ph)
    pc.getContext('2d').drawImage(bmp, 0, 0, pw, ph)
    const preview = pc.transferToImageBitmap()
    postMessage({ type: 'done', id, blob: stored, width, height, date, preview }, [preview])
  } catch (err) {
    postMessage({ type: 'error', id, reason: String(err?.message || err) })
  } finally {
    bmp.close()
  }
}

self.onmessage = async (e) => {
  const msg = e.data
  if (msg.type === 'file') {
    const date = await readDate(msg.file)
    await process(msg.id, msg.file, msg.name, date)
  } else if (msg.type === 'converted') {
    await process(msg.id, msg.blob, msg.name, msg.date)
  }
}
