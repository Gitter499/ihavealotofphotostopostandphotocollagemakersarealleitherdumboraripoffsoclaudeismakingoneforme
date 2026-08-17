// Regenerates the README screenshots from the built app so they track the
// real UI. Files are written with content-hashed names and the README's
// image references are rewritten to match — a fresh URL every time, so
// GitHub's image cache can never show a stale shot.
// Run after `npm run build`:  npm run screens
// Generates its own demo photos, serves dist/, drives headless Chromium.
// Locally it uses the preinstalled browser at /opt/pw-browsers/chromium; in CI
// it falls back to playwright's default browser registry.
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docs = join(root, 'docs')
mkdirSync(docs, { recursive: true })

// ---- tiny PNG demo-photo generator (sky/ground gradients, warm + cool) ----
const T = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
const crc32 = (b) => {
  let c = -1
  for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (ty, d) => {
  const l = Buffer.alloc(4)
  l.writeUInt32BE(d.length)
  const body = Buffer.concat([Buffer.from(ty), d])
  const cr = Buffer.alloc(4)
  cr.writeUInt32BE(crc32(body))
  return Buffer.concat([l, body, cr])
}
const hsl = (h, s, l) => {
  const a = s * Math.min(l, 1 - l)
  const f = (n) => {
    const k = (n + h / 30) % 12
    return Math.max(0, Math.min(255, (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)) | 0
  }
  return [f(0), f(8), f(4)]
}
function demoPhoto(w, h, seed, hue) {
  let s = seed | 1
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296)
  const c0 = hsl(hue + rnd() * 14 - 7, 0.55, 0.6)
  const c1 = hsl(hue + rnd() * 14 - 7, 0.5, 0.3)
  const raw = Buffer.alloc(h * (1 + w * 3))
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3)
    for (let x = 0; x < w; x++) {
      const o = row + 1 + x * 3
      const t = y / h
      const n = ((x * 7919 + y * 104729 + seed) % 11) - 5
      raw[o] = Math.max(0, Math.min(255, c0[0] + (c1[0] - c0[0]) * t + n))
      raw[o + 1] = Math.max(0, Math.min(255, c0[1] + (c1[1] - c0[1]) * t + n))
      raw[o + 2] = Math.max(0, Math.min(255, c0[2] + (c1[2] - c0[2]) * t + n))
    }
  }
  const ih = Buffer.alloc(13)
  ih.writeUInt32BE(w, 0)
  ih.writeUInt32BE(h, 4)
  ih[8] = 8
  ih[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ih),
    chunk('IDAT', deflateSync(raw, { level: 3 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const shapes = [
  [1000, 750],
  [750, 1000],
  [1200, 675],
  [900, 900],
]
const photoDir = join(tmpdir(), 'photogram-screens')
mkdirSync(photoDir, { recursive: true })
const files = []
for (let i = 0; i < 24; i++) {
  const [w, h] = shapes[i % shapes.length]
  const hue = i % 4 < 2 ? 25 : 210
  const p = join(photoDir, `demo_${String(i + 1).padStart(2, '0')}.png`)
  writeFileSync(p, demoPhoto(w, h, i * 17 + 3, hue))
  files.push(p)
}

// ---- serve dist ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  try {
    const d = readFileSync(join(root, 'dist', path))
    res.writeHead(200, { 'content-type': MIME[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream' })
    res.end(d)
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((r) => server.listen(4599, r))

const localChromium = '/opt/pw-browsers/chromium'
const browser = await chromium.launch(existsSync(localChromium) ? { executablePath: localChromium } : {})

const loadWithPhotos = async (page, count) => {
  await page.goto('http://localhost:4599/')
  await page.setInputFiles('[data-testid="file-input"]', files.slice(0, count))
  await page.waitForFunction(
    (c) => new RegExp(`${c} photos`).test(document.querySelector('.counts')?.textContent || ''),
    count,
    { timeout: 60000 },
  )
  await page.waitForTimeout(1400)
}

const shots = {}

// desktop, default state
const desktop = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await loadWithPhotos(desktop, 24)
shots.desktop = await desktop.screenshot()

// desktop, tilt + rounded corners
await desktop.getByRole('button', { name: 'Options' }).click()
await desktop.waitForTimeout(350)
await desktop.locator('input[type="range"]').nth(2).fill('4')
await desktop.locator('input[type="range"]').nth(3).fill('18')
await desktop.locator('input[type="range"]').nth(1).fill('12')
await desktop.keyboard.press('Escape')
await desktop.waitForTimeout(600)
shots.scrapbook = await desktop.screenshot()

// mobile
const mobile = await (
  await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 })
).newPage()
await loadWithPhotos(mobile, 12)
shots.mobile = await mobile.screenshot()

// mobile with the ⋯ action sheet open — the thumb-zone story
await mobile.locator('[aria-label="Slide actions"]').first().click()
await mobile.waitForTimeout(600)
shots.sheet = await mobile.screenshot()

await browser.close()
server.close()

// content-hashed filenames + README rewrite
for (const f of readdirSync(docs)) {
  if (/^screen-(desktop|scrapbook|mobile|sheet).*\.png$/.test(f)) rmSync(join(docs, f))
}
const names = {}
for (const [k, buf] of Object.entries(shots)) {
  const h = createHash('sha1').update(buf).digest('hex').slice(0, 8)
  names[k] = `screen-${k}-${h}.png`
  writeFileSync(join(docs, names[k]), buf)
}
const readmePath = join(root, 'README.md')
let readme = readFileSync(readmePath, 'utf8')
for (const k of Object.keys(names)) {
  readme = readme.replace(new RegExp(`docs/screen-${k}[^)">]*\\.png`, 'g'), `docs/${names[k]}`)
}
writeFileSync(readmePath, readme)
console.log('screenshots:', Object.values(names).join(' '))
