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

// Image analysis for smarter selection: a quality score (sharpness via
// Laplacian variance + exposure balance + contrast) steers the best photo of
// a slide into the biggest slot, and a 64-bit average hash lets near-duplicate
// shots be detected so only the best of a burst gets prominence.
function analyze(bmp) {
  const S = 64
  const c = new OffscreenCanvas(S, S)
  const cx = c.getContext('2d', { willReadFrequently: true })
  cx.drawImage(bmp, 0, 0, S, S)
  const d = cx.getImageData(0, 0, S, S).data
  const luma = new Float32Array(S * S)
  let mean = 0
  for (let i = 0; i < S * S; i++) {
    const l = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]
    luma[i] = l
    mean += l
  }
  mean /= S * S

  let varSum = 0
  for (let i = 0; i < S * S; i++) {
    const dl = luma[i] - mean
    varSum += dl * dl
  }
  const contrast = Math.sqrt(varSum / (S * S)) / 128

  let lapMean = 0
  const lapVals = new Float32Array((S - 2) * (S - 2))
  let k = 0
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x
      const v = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - S] - luma[i + S]
      lapVals[k++] = v
      lapMean += v
    }
  }
  lapMean /= k
  let lapVar = 0
  for (let i = 0; i < k; i++) {
    const dv = lapVals[i] - lapMean
    lapVar += dv * dv
  }
  lapVar /= k
  const sharpness = Math.min(1, Math.log10(1 + lapVar) / 3)
  const exposure = 1 - Math.min(1, Math.abs(mean / 255 - 0.5) * 2)
  const quality = 0.55 * sharpness + 0.25 * exposure + 0.2 * Math.min(1, contrast * 2)

  // 8×8 average hash over the same luma buffer
  const cells = new Float32Array(64)
  let avg = 0
  for (let cy = 0; cy < 8; cy++) {
    for (let cx8 = 0; cx8 < 8; cx8++) {
      let s = 0
      for (let y = cy * 8; y < cy * 8 + 8; y++) {
        for (let x = cx8 * 8; x < cx8 * 8 + 8; x++) s += luma[y * S + x]
      }
      cells[cy * 8 + cx8] = s / 64
      avg += s / 64
    }
  }
  avg /= 64
  let hi = 0
  let lo = 0
  for (let i = 0; i < 64; i++) {
    const bit = cells[i] > avg ? 1 : 0
    if (i < 32) hi = ((hi << 1) | bit) >>> 0
    else lo = ((lo << 1) | bit) >>> 0
  }
  return { quality, hash: [hi, lo] }
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
    const metrics = analyze(bmp)
    postMessage(
      { type: 'done', id, blob: stored, width, height, date, preview, quality: metrics.quality, hash: metrics.hash },
      [preview],
    )
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
