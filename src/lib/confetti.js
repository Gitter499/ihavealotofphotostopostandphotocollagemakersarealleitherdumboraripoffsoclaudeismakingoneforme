// One celebratory burst when the carousel zip lands — canvas particles,
// self-cleaning, skipped entirely under prefers-reduced-motion.

export function fireConfetti(x, y, colors = ['#0a84ff', '#64d2ff', '#5e5ce6', '#ff375f', '#ffd60a']) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:200'
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = window.innerWidth * dpr
  canvas.height = window.innerHeight * dpr
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  const N = 110
  const parts = []
  for (let i = 0; i < N; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6
    const speed = 7 + Math.random() * 9
    parts.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 4 + Math.random() * 5,
      h: 6 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      color: colors[i % colors.length],
    })
  }
  const t0 = performance.now()
  const DURATION = 1500
  const tick = (t) => {
    const elapsed = t - t0
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const fade = Math.min(1, Math.max(0, 1 - (elapsed - 900) / (DURATION - 900)))
    for (const p of parts) {
      p.vy += 0.32 // gravity
      p.vx *= 0.99
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vr
      ctx.save()
      ctx.globalAlpha = fade
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    }
    if (elapsed < DURATION) requestAnimationFrame(tick)
    else canvas.remove()
  }
  requestAnimationFrame(tick)
}
