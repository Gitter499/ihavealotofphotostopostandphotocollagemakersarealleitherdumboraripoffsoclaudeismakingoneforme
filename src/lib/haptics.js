// Haptic vocabulary. In the Capacitor builds this reaches the real Taptic
// engine / vibration motor; on the Android web app it falls back to
// navigator.vibrate patterns; everywhere else (iOS Safari, desktop) the
// calls are silent no-ops. Fire-and-forget by design — feedback must never
// block or throw.

const native = () => {
  try {
    return globalThis.Capacitor?.Plugins?.Haptics ?? null
  } catch {
    return null
  }
}

const buzz = (pattern) => {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // no vibration hardware — fine
  }
}

const impact = (style, pattern) => {
  const h = native()
  if (h) h.impact({ style }).catch(() => {})
  else buzz(pattern)
}

export const haptics = {
  // light tick — button presses, chips, filter picks
  tap: () => impact('LIGHT', 8),
  // a value changed — seam meshed, template pinned, photo dropped
  select: () => {
    const h = native()
    if (h) h.selectionChanged().catch(() => {})
    else buzz(14)
  },
  // a photo lifted off the canvas
  pickup: () => impact('MEDIUM', [6, 20, 12]),
  // the slider crossed its neutral detent
  detent: () => impact('LIGHT', 5),
  // something big finished — export done, remix landed
  success: () => {
    const h = native()
    if (h) h.notification({ type: 'SUCCESS' }).catch(() => {})
    else buzz([14, 50, 22])
  },
  // destructive — slide deleted
  warning: () => {
    const h = native()
    if (h) h.notification({ type: 'WARNING' }).catch(() => {})
    else buzz([28, 40, 28])
  },
}
