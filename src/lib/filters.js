// Automatic looks. "Auto" is adaptive per photo — it reads the measured
// exposure and contrast from import analysis and corrects toward a balanced
// image, so a dark photo gets lifted and a flat one gets punch, while an
// already-good photo is barely touched. "Off" guards against a bad result:
// one tap disables everything, previews and export alike.

export const LOOKS = [
  { key: 'auto', label: 'Auto' },
  { key: 'film', label: 'Film' },
  { key: 'noir', label: 'Noir' },
  { key: 'off', label: 'Off' },
]

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function filterFor(photo, look) {
  if (!look || look === 'off') return null
  const luma = photo?.luma ?? 0.5
  const contrast = photo?.contrast ?? 0.5
  const b = clamp(1 + (0.52 - luma) * 0.35, 0.9, 1.12).toFixed(3)
  const c = (contrast < 0.18 ? 1.1 : 1.04).toFixed(3)
  if (look === 'auto') return `brightness(${b}) contrast(${c}) saturate(1.08)`
  if (look === 'film') return `brightness(${b}) contrast(${(c * 0.97).toFixed(3)}) saturate(1.16) sepia(0.14)`
  if (look === 'noir') return `grayscale(1) brightness(${b}) contrast(${Math.max(c, 1.14).toFixed(3)})`
  return null
}
