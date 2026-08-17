// Automatic looks, picked from a bottom bubble strip like a story editor.
// "Auto" is adaptive per photo — it reads the measured exposure and contrast
// from import analysis and corrects toward a balanced image, so a dark photo
// gets lifted and a flat one gets punch, while an already-good photo is
// barely touched. Every look keeps that adaptive base. "Off" guards against
// a bad result: one tap disables everything, previews and export alike.

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

export function filterFor(photo, look) {
  if (!look || look === 'off') return null
  const luma = photo?.luma ?? 0.5
  const contrast = photo?.contrast ?? 0.5
  const b = clamp(1 + (0.52 - luma) * 0.35, 0.9, 1.12)
  const c = contrast < 0.18 ? 1.1 : 1.04
  const fx = (n) => n.toFixed(3)
  switch (look) {
    case 'auto':
      return `brightness(${fx(b)}) contrast(${fx(c)}) saturate(1.08)`
    case 'film':
      return `brightness(${fx(b)}) contrast(${fx(c * 0.97)}) saturate(1.16) sepia(0.14)`
    case 'golden':
      return `brightness(${fx(b)}) contrast(${fx(c)}) sepia(0.28) saturate(1.35) hue-rotate(-10deg)`
    case 'frost':
      return `brightness(${fx(b * 1.03)}) contrast(${fx(c)}) saturate(0.92) hue-rotate(12deg)`
    case 'fade':
      return `brightness(${fx(b * 1.05)}) contrast(0.86) saturate(0.85)`
    case 'noir':
      return `grayscale(1) brightness(${fx(b)}) contrast(${fx(Math.max(c, 1.14))})`
    default:
      return null
  }
}
