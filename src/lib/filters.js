// Automatic looks, picked from a bottom bubble strip like a story editor.
// "Auto" is adaptive per photo — it reads the measured exposure and contrast
// from import analysis and corrects toward a balanced image. "Off" guards
// against a bad result: one tap disables everything, previews and export.
//
// Filters are implemented as 3×4 colour matrices applied to pixels — the
// exact math behind the CSS/SVG filter primitives — rather than canvas
// `ctx.filter`, which Safari (i.e. every iPhone) does not support. One code
// path, identical output on every browser and in the export.

export const LOOKS = [
  { key: 'off', label: 'Off' },
  { key: 'auto', label: 'Auto' },
  { key: 'film', label: 'Film' },
  { key: 'golden', label: 'Golden' },
  { key: 'frost', label: 'Frost' },
  { key: 'fade', label: 'Fade' },
  { key: 'noir', label: 'Noir' },
]

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// --- colour matrices: rows R,G,B of [r, g, b, offset], offsets on 0..1 ---

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

// apply `b` after `a` (b ∘ a)
function compose(a, b) {
  const r = new Array(12)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 4 + j] = b[i * 4] * a[j] + b[i * 4 + 1] * a[4 + j] + b[i * 4 + 2] * a[8 + j]
    }
    r[i * 4 + 3] = b[i * 4] * a[3] + b[i * 4 + 1] * a[7] + b[i * 4 + 2] * a[11] + b[i * 4 + 3]
  }
  return r
}

const brightness = (v) => [v, 0, 0, 0, 0, v, 0, 0, 0, 0, v, 0]

const contrast = (v) => {
  const o = 0.5 - 0.5 * v
  return [v, 0, 0, o, 0, v, 0, o, 0, 0, v, o]
}

// SVG feColorMatrix saturate constants
const saturate = (s) => [
  0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0,
  0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0,
  0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0,
]

const grayscale = (g) => saturate(1 - g)

const SEPIA_FULL = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131]

const sepia = (a) => {
  const m = [...IDENTITY]
  const rows = [0, 4, 8]
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const id = i === j ? 1 : 0
      m[rows[i] + j] = id * (1 - a) + SEPIA_FULL[i * 3 + j] * a
    }
  }
  return m
}

const hueRotate = (deg) => {
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0,
  ]
}

// The per-photo adaptive base + the look's own grade, as one composed matrix.
export function matrixFor(photo, look) {
  if (!look || look === 'off') return null
  const luma = photo?.luma ?? 0.5
  const measured = photo?.contrast ?? 0.5
  const b = clamp(1 + (0.52 - luma) * 0.35, 0.9, 1.12)
  const c = measured < 0.18 ? 1.1 : 1.04
  const steps = {
    auto: [brightness(b), contrast(c), saturate(1.08)],
    film: [brightness(b), contrast(c * 0.97), saturate(1.16), sepia(0.14)],
    golden: [brightness(b), contrast(c), sepia(0.28), saturate(1.35), hueRotate(-10)],
    frost: [brightness(b * 1.03), contrast(c), saturate(0.92), hueRotate(12)],
    fade: [brightness(b * 1.05), contrast(0.86), saturate(0.85)],
    noir: [grayscale(1), brightness(b), contrast(Math.max(c, 1.14))],
  }[look]
  if (!steps) return null
  let m = IDENTITY
  for (const step of steps) m = compose(m, step)
  return m
}

// In-place on a Uint8ClampedArray of RGBA pixels.
export function applyMatrix(data, m) {
  const o0 = m[3] * 255
  const o1 = m[7] * 255
  const o2 = m[11] * 255
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    data[i] = m[0] * r + m[1] * g + m[2] * b + o0
    data[i + 1] = m[4] * r + m[5] * g + m[6] * b + o1
    data[i + 2] = m[8] * r + m[9] * g + m[10] * b + o2
  }
}

// Filtered copy of a bitmap (any drawable). Returns an ImageBitmap.
export async function filteredBitmap(source, m) {
  const w = source.width
  const h = source.height
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(source, 0, 0)
  const imageData = ctx.getImageData(0, 0, w, h)
  applyMatrix(imageData.data, m)
  return createImageBitmap(imageData)
}
