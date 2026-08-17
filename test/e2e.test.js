// End-to-end test: build output served locally, driven with headless Chromium.
// Generates 30 mixed-orientation PNGs, imports them, checks the 5 rendered
// slides, downloads the zip, and verifies numbered 1080×1350 JPEGs inside.
// Also asserts zero network requests after page load (spec non-negotiable).
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const tmp = join(here, 'tmp')

// ---------- tiny PNG encoder (solid-ish colour, any size) ----------

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function makePng(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3)
    for (let x = 0; x < width; x++) {
      const o = row + 1 + x * 3
      // slight gradient so JPEG re-encode isn't trivially uniform
      raw[o] = (r + x) % 256
      raw[o + 1] = (g + y) % 256
      raw[o + 2] = b
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- minimal JPEG dimension parser (SOF marker) ----------

function jpegSize(buf) {
  assert.equal(buf[0], 0xff)
  assert.equal(buf[1], 0xd8, 'not a JPEG')
  let i = 2
  while (i < buf.length - 8) {
    assert.equal(buf[i], 0xff, `bad marker at ${i}`)
    const marker = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    i += 2 + len
  }
  throw new Error('no SOF marker')
}

// ---------- static file server for dist/ ----------

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }

function serveDist(port) {
  const server = createServer((req, res) => {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0]
    try {
      const data = readFileSync(join(root, 'dist', path))
      res.writeHead(200, { 'content-type': MIME[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream' })
      res.end(data)
    } catch {
      res.writeHead(404)
      res.end('nope')
    }
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

// ---------- the test ----------

rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })

// 30 mixed-orientation photos + 1 unsupported file
const files = []
const shapes = [
  [800, 600],
  [600, 800],
  [1200, 675],
  [675, 1200],
  [900, 900],
  [1600, 1200],
]
for (let i = 0; i < 30; i++) {
  const [w, h] = shapes[i % shapes.length]
  const name = `img_${String(i + 1).padStart(3, '0')}.png`
  writeFileSync(join(tmp, name), makePng(w, h, [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256]))
  files.push(join(tmp, name))
}
writeFileSync(join(tmp, 'notes.txt'), 'not an image')
files.push(join(tmp, 'notes.txt'))

const PORT = 4517
const server = await serveDist(PORT)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
let failed = false
try {
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', (err) => {
    failed = true
    console.error('PAGE ERROR:', err)
  })
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForLoadState('networkidle')

  // From here on, the app must make no network requests.
  const lateRequests = []
  page.on('request', (req) => {
    if (/^https?:/.test(req.url())) lateRequests.push(req.url())
  })

  await page.setInputFiles('[data-testid="file-input"]', files)
  await page.waitForSelector('.slide-card', { timeout: 30000 })
  await page.waitForFunction(() => document.querySelectorAll('.slide-card').length >= 5, null, { timeout: 30000 })

  const slideCount = await page.locator('.slide-card').count()
  assert.equal(slideCount, 5, `expected 5 slides for 30 photos, got ${slideCount}`)
  console.log('  ok  30 photos → 5 slides')

  const counts = await page.locator('.counts').textContent()
  assert.match(counts, /30 photos · 5 slides/)
  console.log('  ok  header count reads "30 photos · 5 slides"')

  const skipNotice = await page.locator('.notice-warn').textContent()
  assert.match(skipNotice, /notes\.txt/)
  console.log('  ok  unsupported file named in notice, batch not discarded')

  // slides render non-empty (canvas has non-background pixels)
  const painted = await page.evaluate(() => {
    const c = document.querySelector('.slide-canvas')
    const ctx = c.getContext('2d')
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    let nonBg = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 30 || data[i + 1] > 30 || data[i + 2] > 30) nonBg++
    }
    return nonBg / (data.length / 4)
  })
  assert.ok(painted > 0.5, `only ${painted} of preview pixels painted`)
  console.log('  ok  slide preview actually painted')

  // more than 5 slides: lower photos-per-slide → 30 photos at 4 → 8 slides
  await page.locator('input[type="range"]').first().fill('4')
  await page.waitForFunction(() => document.querySelectorAll('.slide-card').length === 8, null, { timeout: 10000 })
  console.log('  ok  photos-per-slide 4 regroups 30 photos into 8 slides (>5, cap is 20)')
  await page.locator('input[type="range"]').first().fill('6')
  await page.waitForFunction(() => document.querySelectorAll('.slide-card').length === 5, null, { timeout: 10000 })

  // shuffle changes the layout
  const before = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  await page.locator('.slide-card').first().locator('[aria-label="Shuffle this slide"]').click()
  await page.waitForTimeout(1200) // let the settle animation finish
  const after = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  assert.notEqual(before, after, 'shuffle did not change the slide')
  console.log('  ok  per-slide shuffle produces a different layout')

  // download all → zip with 01..05.jpg at 1080×1350
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.getByRole('button', { name: /download all/i }).click(),
  ])
  const zipPath = join(tmp, 'out.zip')
  await download.saveAs(zipPath)
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(readFileSync(zipPath))
  const names = Object.keys(zip.files).sort()
  assert.deepEqual(names, ['01.jpg', '02.jpg', '03.jpg', '04.jpg', '05.jpg'])
  for (const name of names) {
    const buf = Buffer.from(await zip.files[name].async('arraybuffer'))
    const { width, height } = jpegSize(buf)
    assert.equal(width, 1080, `${name} width`)
    assert.equal(height, 1350, `${name} height`)
    assert.ok(buf.length > 5000, `${name} suspiciously small (${buf.length}B)`)
  }
  console.log('  ok  zip contains 01–05.jpg, all 1080×1350 JPEGs')

  assert.deepEqual(lateRequests, [], `network requests after load: ${lateRequests.join(', ')}`)
  console.log('  ok  zero network requests after page load')

  // 1:1 aspect export
  await page.getByRole('button', { name: '1:1' }).click()
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.locator('.slide-card').first().locator('[aria-label="Download this slide"]').click(),
  ])
  const onePath = join(tmp, 'one.jpg')
  await dl2.saveAs(onePath)
  const one = jpegSize(readFileSync(onePath))
  assert.deepEqual(one, { height: 1080, width: 1080 })
  console.log('  ok  1:1 aspect exports 1080×1080')

  // 200-photo stress: import must complete and stay responsive
  const many = []
  for (let i = 0; i < 200; i++) {
    const [w, h] = shapes[i % shapes.length]
    // reuse the same 30 files cyclically to keep disk small but count high
    many.push(files[i % 30])
  }
  const t0 = Date.now()
  await page.setInputFiles('[data-testid="file-input"]', many)
  await page.waitForFunction(() => /230 photos/.test(document.querySelector('.counts')?.textContent || ''), null, {
    timeout: 120000,
  })
  const elapsed = Date.now() - t0
  const slides2 = await page.locator('.slide-card').count()
  assert.equal(slides2, 20, `expected 20 slides (clamped), got ${slides2}`)
  const overflow = await page.locator('.notice-warn').first().textContent()
  assert.match(overflow, /160 photos fit/, 'overflow notice should say how many fit')
  // main thread responsive: a trivial evaluate returns quickly
  const r0 = Date.now()
  await page.evaluate(() => 1 + 1)
  assert.ok(Date.now() - r0 < 1000, 'main thread blocked after bulk import')
  console.log(`  ok  230 photos imported in ${(elapsed / 1000).toFixed(1)}s, clamped to 20 slides, tab responsive`)

  await page.screenshot({ path: join(tmp, 'app.png'), fullPage: false })
  console.log('\nAll e2e tests passed')
} catch (err) {
  failed = true
  console.error(err)
} finally {
  await browser.close()
  server.close()
}
if (failed) process.exit(1)
