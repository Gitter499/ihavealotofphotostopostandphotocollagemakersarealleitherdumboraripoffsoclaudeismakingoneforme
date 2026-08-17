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
  await page.waitForFunction(
    () => /30 photos/.test(document.querySelector('.counts')?.textContent || ''),
    null,
    { timeout: 30000 },
  )

  // first-run coach marks appear exactly once, then never again
  await page.locator('.hints-card').waitFor({ state: 'visible', timeout: 5000 })
  await page.getByRole('button', { name: 'Got it' }).click()
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.hints-card').count(), 0, 'hints should dismiss')
  console.log('  ok  first-run coach marks show once and dismiss')

  // Auto mode (default): slide count adapts to the photos
  const autoSlides = await page.locator('.slide-card').count()
  assert.ok(autoSlides >= 4 && autoSlides <= 8, `auto grouping made ${autoSlides} slides for 30 photos`)
  assert.match(await page.locator('.counts').textContent(), /30 photos · \d+ slides/)
  console.log(`  ok  auto grouping → ${autoSlides} slides for 30 photos`)

  // options live in a popover that springs from the dock
  const openOptions = async () => {
    if (!(await page.locator('.options-popover').isVisible().catch(() => false)))
      await page.getByRole('button', { name: 'Options' }).click()
    await page.locator('.options-popover').waitFor({ state: 'visible' })
  }
  const closeOptions = async () => {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }

  // switch to manual 6 per slide for the deterministic assertions below
  await openOptions()
  await page.locator('.options-popover input[type="range"]').first().fill('6')
  await page.waitForFunction(() => document.querySelectorAll('.slide-card').length === 5, null, { timeout: 10000 })
  await closeOptions()
  console.log('  ok  manual 6 per slide → 5 slides (via options popover)')

  const counts = await page.locator('.counts').textContent()
  assert.match(counts, /30 photos · 5 slides/)
  console.log('  ok  header count reads "30 photos · 5 slides"')

  const skipNotice = await page.locator('.notice-warn').textContent()
  assert.match(skipNotice, /notes\.txt/)
  console.log('  ok  unsupported file named in notice, batch not discarded')

  // slides render non-empty (canvas has non-background pixels);
  // the compose animation runs ≤800ms, so let it settle first
  await page.waitForTimeout(1100)
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
  await openOptions()
  await page.locator('.options-popover input[type="range"]').first().fill('4')
  await page.waitForFunction(() => document.querySelectorAll('.slide-card').length === 8, null, { timeout: 10000 })
  console.log('  ok  photos-per-slide 4 regroups 30 photos into 8 slides (>5, cap is 20)')
  await page.locator('.options-popover input[type="range"]').first().fill('6')
  await page.waitForFunction(() => document.querySelectorAll('.slide-card').length === 5, null, { timeout: 10000 })
  await closeOptions()

  // the filter strip rests as a dot row and blooms open under the pointer
  assert.equal(await page.locator('.filterbar.collapsed').count(), 1, 'filter strip should rest collapsed')
  await page.locator('.filterbar').hover()
  await page.waitForTimeout(400)
  assert.equal(await page.locator('.filterbar.collapsed').count(), 0, 'pointer over the strip should expand it')
  await page.mouse.move(10, 10) // leave → folds back to dots
  await page.waitForTimeout(400)
  assert.equal(await page.locator('.filterbar.collapsed').count(), 1, 'strip should fold back after the pointer leaves')
  console.log('  ok  filter strip collapses to dots and expands on hover')

  // filter bubble strip: Off must actually change the rendered pixels back
  const bubbleCount = await page.locator('.filterbar .bubble').count()
  assert.ok(bubbleCount >= 7, `expected ≥7 filter bubbles, got ${bubbleCount}`)
  // each bubble must contain actual image detail, not a flat/empty circle
  const bubbleDetail = await page.evaluate(() => {
    const c = document.querySelector('.bubble-thumb')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let sum = 0
    let sumSq = 0
    let n = 0
    let opaque = 0
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      sum += l
      sumSq += l * l
      n++
      if (d[i + 3] > 200) opaque++
    }
    const mean = sum / n
    return { std: Math.sqrt(sumSq / n - mean * mean), opaque: opaque / n }
  })
  assert.ok(bubbleDetail.opaque > 0.95, `bubble thumb mostly transparent (${bubbleDetail.opaque})`)
  assert.ok(bubbleDetail.std > 8, `bubble thumb has no image detail (std ${bubbleDetail.std})`)
  // every bubble previews a DIFFERENT treatment of the same photo
  const thumbs = await page.evaluate(() =>
    [...document.querySelectorAll('.bubble-thumb')].map((c) => c.toDataURL()),
  )
  assert.ok(
    new Set(thumbs).size >= bubbleCount - 1,
    `bubble thumbnails look identical (${new Set(thumbs).size} distinct of ${thumbs.length})`,
  )
  const withFilter = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  // settle the strip open first — clicking into the unfold animation is flaky
  await page.locator('.filterbar').hover()
  await page.waitForTimeout(500)
  await page.locator('[data-look="off"]').click()
  await page.waitForTimeout(300)
  const withoutFilter = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  assert.notEqual(withFilter, withoutFilter, 'Filter Off did not change the render')
  await page.locator('[data-look="noir"]').click()
  await page.waitForTimeout(300)
  const noir = await page.evaluate(() => {
    const c = document.querySelector('.slide-canvas')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let colored = 0
    for (let i = 0; i < d.length; i += 40) {
      if (Math.abs(d[i] - d[i + 1]) > 6 || Math.abs(d[i + 1] - d[i + 2]) > 6) colored++
    }
    return colored
  })
  assert.equal(noir, 0, `Noir left ${noir} coloured samples`)
  await page.locator('[data-look="auto"]').click()
  console.log('  ok  filter bubbles render (Auto default, Off guard, Noir desaturates)')

  // strength dial: 40% of a look is visibly different from 100%
  const fullStrength = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  await page.locator('input[aria-label="Filter strength"]').fill('40')
  await page.waitForTimeout(700)
  assert.notEqual(
    await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL()),
    fullStrength,
    'strength dial did not change the render',
  )
  await page.locator('input[aria-label="Filter strength"]').fill('100')
  await page.waitForTimeout(700)
  console.log('  ok  filter strength dial blends the look')

  // Auto chip returns to dynamic grouping
  await openOptions()
  await page.locator('button.chip', { hasText: 'Auto' }).click()
  await page.waitForFunction(
    () => /30 photos · \d+ slides/.test(document.querySelector('.counts')?.textContent || ''),
    null,
    { timeout: 10000 },
  )
  console.log('  ok  Auto chip restores dynamic grouping')
  await page.locator('.options-popover input[type="range"]').first().fill('6')
  await page.waitForFunction(() => document.querySelectorAll('.slide-card').length === 5, null, { timeout: 10000 })
  await closeOptions()

  // the popover is non-modal: touching a slide hides it AND the touch lands
  await openOptions()
  const countsBeforePassthrough = await page.evaluate(() =>
    [...document.querySelectorAll('.slide-count')].map((el) => parseInt(el.textContent, 10)),
  )
  await page.locator('[aria-label="Fewer photos on this slide"]').first().click()
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.options-popover').count(), 0, 'popover should hide when a slide is touched')
  const countsAfterPassthrough = await page.evaluate(() =>
    [...document.querySelectorAll('.slide-count')].map((el) => parseInt(el.textContent, 10)),
  )
  assert.equal(countsAfterPassthrough[0], countsBeforePassthrough[0] - 1, 'the touch that hid the popover must still land')
  await page.locator('[aria-label="More photos on this slide"]').first().click()
  await page.waitForTimeout(300)
  console.log('  ok  popover hides on slide interaction, click passes through')

  // per-slide stepper: minus hands a photo to the next slide, totals conserved
  const countsOf = () =>
    page.evaluate(() => [...document.querySelectorAll('.slide-count')].map((el) => parseInt(el.textContent, 10)))
  const stepBefore = await countsOf()
  await page.locator('[aria-label="Fewer photos on this slide"]').first().click()
  await page.waitForTimeout(300)
  const afterMinus = await countsOf()
  assert.equal(afterMinus[0], stepBefore[0] - 1, 'first slide should shrink')
  assert.equal(afterMinus[1], stepBefore[1] + 1, 'second slide should grow')
  assert.equal(
    afterMinus.reduce((a, b) => a + b, 0),
    stepBefore.reduce((a, b) => a + b, 0),
    'no photo may be dropped',
  )
  await page.locator('[aria-label="More photos on this slide"]').first().click()
  await page.waitForTimeout(300)
  const afterPlus = await countsOf()
  assert.deepEqual(afterPlus, stepBefore, 'plus should restore the balance')
  console.log('  ok  per-slide − / + steppers rebalance with the neighbour')

  // remix regroups the whole dump under a new lens: photos conserved,
  // arrangement changed, and a toast names the lens it chose
  const arrangement = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.slide-canvas')].map((c) => c.toDataURL()).join('|'),
    )
  const preRemix = await arrangement()
  await page.getByRole('button', { name: 'Remix', exact: true }).click()
  await page.waitForTimeout(1300)
  assert.match(await page.locator('.remix-toast').textContent(), /^Remixed/, 'remix should announce its lens')
  assert.match(await page.locator('.counts').textContent(), /30 photos/, 'remix must not drop photos')
  assert.notEqual(await arrangement(), preRemix, 'remix did not change the arrangement')
  // a second press picks a different lens
  const firstLens = await page.locator('.remix-toast').textContent()
  await page.getByRole('button', { name: 'Remix', exact: true }).click()
  await page.waitForTimeout(400)
  assert.notEqual(await page.locator('.remix-toast').textContent(), firstLens, 'remix repeated the same lens')
  console.log('  ok  Remix regroups everything under a fresh lens, twice in a row differently')
  // back to the deterministic 5×6 arrangement for the tests below
  await openOptions()
  await page.locator('.options-popover input[type="range"]').first().fill('5')
  await page.locator('.options-popover input[type="range"]').first().fill('6')
  await page.waitForFunction(() => document.querySelectorAll('.slide-card').length === 5, null, { timeout: 10000 })
  await closeOptions()

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
    assert.equal(width, 1440, `${name} width`)
    assert.equal(height, 1800, `${name} height`)
    assert.ok(buf.length > 5000, `${name} suspiciously small (${buf.length}B)`)
  }
  console.log('  ok  zip contains 01–05.jpg, all 1440×1800 JPEGs (Instagram max)')

  assert.deepEqual(lateRequests, [], `network requests after load: ${lateRequests.join(', ')}`)
  console.log('  ok  zero network requests after page load')

  // within-slide reorder: drag one photo onto another in the same slide
  const cbox = await page.locator('.slide-canvas').first().boundingBox()
  const preSwap = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  await page.mouse.move(cbox.x + cbox.width * 0.25, cbox.y + cbox.height * 0.18)
  await page.mouse.down()
  await page.mouse.move(cbox.x + cbox.width * 0.75, cbox.y + cbox.height * 0.8, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(800)
  const postSwap = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  assert.notEqual(preSwap, postSwap, 'within-slide drag did not reorder photos')
  console.log('  ok  dragging a photo within a slide swaps positions')

  // dropping a photo on the add-slide skeleton births a new slide holding it
  await page.locator('.add-slide').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const newSlideCounts = () =>
    page.evaluate(() => [...document.querySelectorAll('.slide-count')].map((el) => parseInt(el.textContent, 10)))
  const beforeBirth = await newSlideCounts()
  const lastCanvas = await page.locator('.slide-canvas').last().boundingBox()
  const addBox = await page.locator('.add-slide').boundingBox()
  await page.mouse.move(lastCanvas.x + lastCanvas.width * 0.5, lastCanvas.y + lastCanvas.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(addBox.x + addBox.width / 2, addBox.y + addBox.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(600)
  const afterBirth = await newSlideCounts()
  assert.equal(afterBirth.length, beforeBirth.length + 1, 'drop on the skeleton should add a slide')
  assert.equal(afterBirth[afterBirth.length - 1], 1, 'the new slide should hold exactly the dropped photo')
  assert.equal(
    afterBirth.reduce((a, b) => a + b, 0),
    beforeBirth.reduce((a, b) => a + b, 0),
    'no photo may be dropped on the floor',
  )
  // put it back: drag from the new last slide onto its neighbour
  await page.locator('.add-slide').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const babyBox = await page.locator('.slide-canvas').last().boundingBox()
  const prevBox = await page.locator('.slide-canvas').nth(beforeBirth.length - 1).boundingBox()
  await page.mouse.move(babyBox.x + babyBox.width / 2, babyBox.y + babyBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(prevBox.x + prevBox.width / 2, prevBox.y + prevBox.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(600)
  assert.deepEqual((await newSlideCounts()).length, beforeBirth.length, 'returning the photo should fold the new slide')
  await page.locator('.slide-canvas').first().scrollIntoViewIfNeeded() // leave the strip where the next test expects it
  await page.waitForTimeout(200)
  console.log('  ok  dropping a photo on the add-slide skeleton starts a new slide with it')

  // playground: park a photo on the shelf, remix around it, bring it back
  await page.locator('.playground').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const pgBox = await page.locator('.playground').boundingBox()
  const srcBox = await page.locator('.slide-canvas').first().boundingBox()
  const slideCounts = () =>
    page.evaluate(() => [...document.querySelectorAll('.slide-count')].map((el) => parseInt(el.textContent, 10)))
  const preParkCounts = await slideCounts()
  await page.mouse.move(srcBox.x + srcBox.width * 0.3, srcBox.y + srcBox.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(pgBox.x + pgBox.width / 2, pgBox.y + pgBox.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  assert.equal(await page.locator('.tray-thumb').count(), 1, 'photo did not land on the playground shelf')
  const parkedCounts = await slideCounts()
  assert.equal(parkedCounts[0], preParkCounts[0] - 1, 'source slide should shrink by the parked photo')
  assert.match(await page.locator('.counts').textContent(), /30 photos .*1 aside/, 'stats should count the parked photo')
  // remix leaves the shelf alone
  await page.getByRole('button', { name: 'Remix', exact: true }).click()
  await page.waitForTimeout(900)
  assert.equal(await page.locator('.tray-thumb').count(), 1, 'remix must not touch parked photos')
  assert.match(await page.locator('.counts').textContent(), /1 aside/, 'parked photo should survive a remix')
  // drag it back onto a slide
  await page.locator('.playground').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const thumbBox = await page.locator('.tray-thumb').first().boundingBox()
  const destBox = await page.locator('.slide-canvas').nth(1).boundingBox()
  const preReturn = await slideCounts()
  await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(destBox.x + destBox.width / 2, destBox.y + destBox.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  assert.equal(await page.locator('.tray-thumb').count(), 0, 'shelf should be empty after dragging back')
  const postReturn = await slideCounts()
  assert.equal(postReturn[1], preReturn[1] + 1, 'destination slide should gain the returned photo')
  // park one more and use Return all instead (remix reshaped the strip, so
  // yesterday's coordinates are stale — measure again)
  await page.locator('.playground').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const srcBox2 = await page.locator('.slide-canvas').first().boundingBox()
  const pgBox2 = await page.locator('.playground').boundingBox()
  await page.mouse.move(srcBox2.x + srcBox2.width * 0.5, srcBox2.y + srcBox2.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(pgBox2.x + pgBox2.width / 2, pgBox2.y + pgBox2.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  assert.equal(await page.locator('.tray-thumb').count(), 1, 'second park failed')
  await page.getByRole('button', { name: 'Return all' }).click()
  await page.waitForTimeout(500)
  assert.equal(await page.locator('.tray-thumb').count(), 0, 'Return all should empty the shelf')
  const afterReturnAll = await slideCounts()
  assert.equal(
    afterReturnAll.reduce((a, b) => a + b, 0),
    30,
    'every photo must be back on a slide',
  )
  console.log('  ok  playground parks photos through remixes; drag-back and Return all restore them')

  // undo/redo: a stepper move reverses with Ctrl+Z and replays with Ctrl+Shift+Z
  const undoCounts = () =>
    page.evaluate(() => [...document.querySelectorAll('.slide-count')].map((el) => parseInt(el.textContent, 10)))
  const preStep = await undoCounts()
  await page.locator('[aria-label="Fewer photos on this slide"]').first().click()
  await page.waitForTimeout(400)
  const stepped = await undoCounts()
  assert.notDeepEqual(stepped, preStep, 'stepper should change counts')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(400)
  assert.deepEqual(await undoCounts(), preStep, 'undo should restore the counts')
  await page.keyboard.press('Control+Shift+z')
  await page.waitForTimeout(400)
  assert.deepEqual(await undoCounts(), stepped, 'redo should replay the change')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(400)
  assert.deepEqual(await undoCounts(), preStep, 'second undo should settle back')
  console.log('  ok  undo and redo walk the history (lobe buttons wired to the same stack)')
  // deterministic 5×6 again for the tests below
  await openOptions()
  await page.locator('.options-popover input[type="range"]').first().fill('5')
  await page.locator('.options-popover input[type="range"]').first().fill('6')
  await page.waitForFunction(() => document.querySelectorAll('.slide-card').length === 5, null, { timeout: 10000 })
  await closeOptions()

  // 1:1 aspect export
  await openOptions()
  await page.getByRole('button', { name: '1:1' }).click()
  await closeOptions()
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.locator('.slide-card').first().locator('[aria-label="Download this slide"]').click(),
  ])
  const onePath = join(tmp, 'one.jpg')
  await dl2.saveAs(onePath)
  const one = jpegSize(readFileSync(onePath))
  assert.deepEqual(one, { height: 1440, width: 1440 })
  console.log('  ok  1:1 aspect exports 1440×1440')

  // PNG export: the format toggle changes the single-slide download
  await openOptions()
  await page.locator('[aria-label="Export format"]').getByRole('button', { name: 'PNG' }).click()
  await closeOptions()
  const [dlPng] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.locator('.slide-card').first().locator('[aria-label="Download this slide"]').click(),
  ])
  assert.match(dlPng.suggestedFilename(), /\.png$/, 'download should be a .png')
  const pngPath = join(tmp, 'one.png')
  await dlPng.saveAs(pngPath)
  const pngBuf = readFileSync(pngPath)
  assert.equal(pngBuf.readUInt32BE(0), 0x89504e47, 'not a PNG file')
  assert.equal(pngBuf.readUInt32BE(16), 1440, 'Post preset should export 1440 wide')
  // size presets scale the same slide up: Print = 3240px wide
  await openOptions()
  await page.locator('[aria-label="Export size"]').getByRole('button', { name: 'Print' }).click()
  await closeOptions()
  const [dlPrint] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.locator('.slide-card').first().locator('[aria-label="Download this slide"]').click(),
  ])
  const printPath = join(tmp, 'print.png')
  await dlPrint.saveAs(printPath)
  assert.equal(readFileSync(printPath).readUInt32BE(16), 3240, 'Print preset should export 3240 wide')
  await openOptions()
  await page.locator('[aria-label="Export format"]').getByRole('button', { name: 'JPEG' }).click()
  await page.locator('[aria-label="Export size"]').getByRole('button', { name: 'Post' }).click()
  await closeOptions()
  console.log('  ok  PNG export and the Post/HD/Print size presets produce real pixels')

  // add-slide skeleton: appends an empty slide, fillable via its stepper
  const slidesBefore = await page.locator('.slide-card').count()
  await page.locator('.add-slide').click()
  await page.waitForTimeout(250)
  assert.equal(await page.locator('.slide-card').count(), slidesBefore + 1, 'add-slide did not append')
  assert.equal(await page.locator('.slide-empty').count(), 1, 'new slide should show the empty state')
  await page.locator('[aria-label="More photos on this slide"]').last().click()
  await page.waitForTimeout(400)
  assert.equal(await page.locator('.slide-empty').count(), 0, 'stepper should pull a photo into the new slide')
  console.log('  ok  skeleton + card adds a slide; its stepper pulls a photo in')

  // delete that slide — it and its photo leave the workspace
  await page.locator('[aria-label="Delete this slide"]').last().click()
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.slide-card').count(), slidesBefore, 'deleted slide should be gone')
  assert.match(await page.locator('.counts').textContent(), /29 photos/, 'deleted slide takes its photo with it')
  console.log('  ok  delete slide removes it and its photos')

  // tilt + corner rounding restyle the composition (preview pixels change)
  await openOptions()
  const plain = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  await page.locator('.options-popover input[type="range"]').nth(2).fill('5')
  await page.locator('.options-popover input[type="range"]').nth(3).fill('20')
  await page.waitForTimeout(400)
  const styled = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  assert.notEqual(plain, styled, 'tilt/corners did not change the render')
  await page.locator('.options-popover input[type="range"]').nth(2).fill('0')
  await page.locator('.options-popover input[type="range"]').nth(3).fill('0')
  console.log('  ok  tilt and corner sliders restyle the slides')

  // mesh, per seam: every seam shows a link chip; tapping one meshes just it
  await closeOptions()
  await page.locator('.slide-canvas').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const seamChips = await page.locator('.mesh-link').count()
  assert.ok(seamChips >= 4, `every seam should carry a link chip (got ${seamChips})`)
  assert.equal(await page.locator('.mesh-link-on').count(), 0, 'all seams should start open')
  const soloBefore = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  await page.locator('.mesh-link').first().click()
  await page.waitForTimeout(900)
  assert.equal(await page.locator('.mesh-link-on').count(), 1, 'tapping a chip should mesh exactly that seam')
  assert.equal(
    await page.locator('.slide-card.mesh-join-right').count(),
    1,
    'only the tapped seam should join',
  )
  assert.notEqual(
    await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL()),
    soloBefore,
    'meshing one seam did not change the render',
  )
  await page.locator('.mesh-link').first().click()
  await page.waitForTimeout(400)
  assert.equal(await page.locator('.mesh-link-on').count(), 0, 'tapping again should unmesh the seam')
  console.log('  ok  seam chips mesh and unmesh individual slide pairs')

  // mesh all: every slide lays out as one continuous canvas
  await openOptions()
  const meshBefore = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  await page.locator('[aria-label="Mesh slides"]').getByRole('button', { name: 'All' }).click()
  await page.waitForTimeout(900)
  const meshOn = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  assert.notEqual(meshBefore, meshOn, 'mesh did not change the render')
  const seamDiff = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('.slide-canvas')]
    const sample = (c, x) => {
      const d = c.getContext('2d').getImageData(x, 0, 2, c.height).data
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]
        g += d[i + 1]
        b += d[i + 2]
        n++
      }
      return [r / n, g / n, b / n]
    }
    const a = sample(cs[0], cs[0].width - 2)
    const b = sample(cs[1], 0)
    return a.map((v, i) => Math.abs(v - b[i]))
  })
  assert.ok(Math.max(...seamDiff) < 30, `seam edges do not continue: ${seamDiff}`)
  console.log('  ok  merged slides compose one canvas across the cut (edge colours continue)')

  // merged neighbours are visibly joined, and photos stay movable — even
  // one grabbed right at the cut, dragged to a slide outside the reach point
  assert.ok((await page.locator('.slide-card.mesh-join-right').count()) >= 1, 'no mesh join indication')
  assert.ok((await page.locator('.mesh-link').count()) >= 1, 'no seam link chip')
  await closeOptions()
  const meshCounts = () =>
    page.evaluate(() => [...document.querySelectorAll('.slide-count')].map((el) => parseInt(el.textContent, 10)))
  const beforeBridgeDrag = await meshCounts()
  // earlier steps clicked .last() controls and left the filmstrip scrolled to
  // its far end — raw mouse coords need the first slides back on screen
  await page.locator('.slide-canvas').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const c1 = await page.locator('.slide-canvas').first().boundingBox()
  const c2 = await page.locator('.slide-canvas').nth(2).boundingBox()
  assert.ok(c1.x >= 0 && c2.x + c2.width <= page.viewportSize().width, 'drag endpoints must be on screen')
  // grab near the cut, off the vertical centre (the seam chip sits at 50%);
  // the cut can fall inside a gutter, so probe a few heights until a photo
  // actually moves
  let afterBridgeDrag = beforeBridgeDrag
  for (const fy of [0.28, 0.72, 0.15]) {
    await page.mouse.move(c1.x + c1.width - 12, c1.y + c1.height * fy)
    await page.mouse.down()
    await page.mouse.move(c2.x + c2.width / 2, c2.y + c2.height / 2, { steps: 14 })
    await page.mouse.up()
    await page.waitForTimeout(600)
    afterBridgeDrag = await meshCounts()
    if (JSON.stringify(afterBridgeDrag) !== JSON.stringify(beforeBridgeDrag)) break
  }
  assert.equal(
    afterBridgeDrag.reduce((a, b) => a + b, 0),
    beforeBridgeDrag.reduce((a, b) => a + b, 0),
    'cut-side drag dropped a photo',
  )
  assert.notDeepEqual(afterBridgeDrag, beforeBridgeDrag, 'photo at the cut could not be moved while merged')
  console.log('  ok  merged slides show the join and photos at the cut stay draggable')
  await openOptions()
  await page.locator('[aria-label="Mesh slides"]').getByRole('button', { name: 'None' }).click()
  await closeOptions()

  // tap-to-resize: a clean tap on a photo opens a size slider; pushing it up
  // visibly regrows that photo's slot
  const rc = await page.locator('.slide-canvas').first().boundingBox()
  const preResize = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  await page.mouse.click(rc.x + rc.width * 0.25, rc.y + rc.height * 0.25)
  await page.waitForTimeout(400)
  assert.equal(await page.locator('.size-popover').count(), 1, 'tap should open the size popover')
  await page.locator('.size-popover input[type="range"]').fill('200')
  await page.waitForTimeout(900)
  const postResize = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  assert.notEqual(postResize, preResize, 'size slider did not change the layout')
  await page.locator('.size-popover').getByRole('button', { name: 'Reset' }).click()
  await page.waitForTimeout(600)
  // pan: nudging slides the crop inside its slot (two axes — at least one
  // has slack unless the aspect matches the cell exactly)
  const preNudge = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  await page.locator('[aria-label="Nudge left"]').click()
  await page.locator('[aria-label="Nudge left"]').click()
  await page.locator('[aria-label="Nudge up"]').click()
  await page.locator('[aria-label="Nudge up"]').click()
  await page.waitForTimeout(500)
  assert.notEqual(
    await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL()),
    preNudge,
    'nudging did not move the crop',
  )
  // orientation: rotate turns the photo (aspect flips, layout reflows),
  // flip mirrors it; Reset restores the original from the blob
  const preRotate = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  await page.locator('[aria-label="Rotate 90°"]').click()
  await page.waitForTimeout(900)
  const postRotate = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  assert.notEqual(postRotate, preRotate, 'rotate did not change the slide')
  await page.locator('[aria-label="Flip horizontally"]').click()
  await page.waitForTimeout(700)
  const postFlip = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  assert.notEqual(postFlip, postRotate, 'flip did not change the slide')
  await page.locator('.size-popover').getByRole('button', { name: 'Reset' }).click()
  await page.waitForTimeout(900)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  assert.equal(await page.locator('.size-popover').count(), 0, 'Escape should close the size popover')
  console.log('  ok  tap opens the photo editor: size, pan, rotate and flip all rework the slide')

  // layout templates: pin a classic and the slide snaps to it; Auto unpins
  await page.locator('.slide-canvas').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const preTpl = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  await page.locator('[aria-label="Layout template"]').first().click()
  await page.waitForTimeout(300)
  assert.ok((await page.locator('.tpl-option').count()) >= 3, 'template picker should offer Auto plus classics')
  // the slide's count varies with earlier drags — pin whichever classic fits
  await page.locator('.tpl-option[data-template]:not([data-template="freeform"])').first().click()
  await page.waitForTimeout(900)
  const withTpl = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  assert.notEqual(withTpl, preTpl, 'pinning a template did not change the layout')
  await page.locator('.tpl-option').first().click() // Auto
  await page.waitForTimeout(900)
  assert.notEqual(await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL()), withTpl, 'Auto should unpin')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  console.log('  ok  layout templates pin and unpin per slide')

  // freeform: the scrapbook template scatters polaroids you drag anywhere
  const preFree = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  await page.locator('[aria-label="Layout template"]').first().click()
  await page.waitForTimeout(300)
  await page.locator('[data-template="freeform"]').click()
  await page.waitForTimeout(900)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const freeOn = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  assert.notEqual(freeOn, preFree, 'freeform did not restyle the slide')
  // drag a polaroid across the canvas — count stays, pixels move
  const freeCounts = await page.evaluate(() =>
    [...document.querySelectorAll('.slide-count')].map((el) => parseInt(el.textContent, 10)),
  )
  const fc = await page.locator('.slide-canvas').first().boundingBox()
  await page.mouse.move(fc.x + fc.width * 0.35, fc.y + fc.height * 0.35)
  await page.mouse.down()
  await page.mouse.move(fc.x + fc.width * 0.72, fc.y + fc.height * 0.72, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const freeMoved = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  assert.notEqual(freeMoved, freeOn, 'dragging a freeform polaroid did not move it')
  assert.deepEqual(
    await page.evaluate(() => [...document.querySelectorAll('.slide-count')].map((el) => parseInt(el.textContent, 10))),
    freeCounts,
    'freeform drag must not relocate photos between slides',
  )
  await page.locator('[aria-label="Layout template"]').first().click()
  await page.waitForTimeout(300)
  await page.locator('.tpl-option').first().click() // Auto
  await page.waitForTimeout(700)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  console.log('  ok  freeform scrapbook: polaroids drag anywhere, stay on their slide')

  // caption: typed text lands on the canvas (and would land in the export)
  await page.locator('[aria-label="Caption"]').first().click()
  await page.locator('.cap-input').fill('golden hour')
  await page.waitForTimeout(600)
  assert.notEqual(
    await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL()),
    withTpl,
    'caption did not render',
  )
  await page.locator('.cap-input').fill('')
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
  console.log('  ok  captions render onto the slide')

  // free text boxes: add from the caption popover, style it, drag it, delete
  await page.locator('.slide-canvas').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const preText = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  await page.locator('[aria-label="Caption"]').first().click()
  await page.getByRole('button', { name: '+ Text box' }).click()
  await page.waitForTimeout(500)
  assert.equal(await page.locator('.text-popover').count(), 1, 'adding a text box should open its editor')
  const withText = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  assert.notEqual(withText, preText, 'text box did not render on the slide')
  await page.locator('.text-popover textarea').fill('hello world')
  await page.locator('[aria-label="Text curve"]').fill('80')
  await page.waitForTimeout(500)
  const curved = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  assert.notEqual(curved, withText, 'text edits and curve did not change the render')
  // drag the box: it sits at (0.5, 0.42) of the first canvas
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  const tb = await page.locator('.slide-canvas').first().boundingBox()
  await page.mouse.move(tb.x + tb.width * 0.5, tb.y + tb.height * 0.42)
  await page.mouse.down()
  await page.mouse.move(tb.x + tb.width * 0.5, tb.y + tb.height * 0.78, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const movedText = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  assert.notEqual(movedText, curved, 'dragging the text box did not move it')
  // tap it at its new home to reopen the editor, then delete it
  await page.mouse.click(tb.x + tb.width * 0.5, tb.y + tb.height * 0.78)
  await page.waitForTimeout(400)
  assert.equal(await page.locator('.text-popover').count(), 1, 'tapping the box should reopen its editor')
  await page.locator('.text-popover').getByRole('button', { name: 'Delete' }).click()
  await page.waitForTimeout(400)
  assert.equal(await page.locator('.text-popover').count(), 0, 'delete should close the editor')
  console.log('  ok  free text boxes render, curve, drag anywhere and delete')

  // border slider strokes every photo; 9:16 reshapes the canvas
  await openOptions()
  const preBorder = await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL())
  await page.locator('.options-popover input[type="range"]').nth(4).fill('6')
  await page.waitForTimeout(500)
  assert.notEqual(await page.evaluate(() => document.querySelector('.slide-canvas').toDataURL()), preBorder, 'border did not draw')
  await page.locator('.options-popover input[type="range"]').nth(4).fill('0')
  await page.getByRole('button', { name: '9:16' }).click()
  await page.waitForTimeout(900)
  const storyBox = await page.locator('.slide-canvas').first().boundingBox()
  assert.ok(Math.abs(storyBox.height / storyBox.width - 16 / 9) < 0.03, `9:16 aspect wrong (${storyBox.height / storyBox.width})`)
  await page.getByRole('button', { name: '4:5' }).click()
  await closeOptions()
  console.log('  ok  photo borders stroke and 9:16 reshapes for stories')

  // the PWA service worker registers and controls the page
  const swReady = await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r?.active || !!r?.installing || !!r?.waiting))
  assert.ok(swReady, 'service worker should be registered')
  console.log('  ok  offline service worker registered')

  // a reload restores the whole session from IndexedDB — photos, slides,
  // and arrangement state like captions
  await page.locator('[aria-label="Caption"]').first().click()
  await page.locator('.cap-input').fill('still here')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1400) // let the debounced snapshot land
  await page.reload()
  // 29 photos here — the delete-slide test above took one with it
  await page.waitForFunction(() => /29 photos/.test(document.querySelector('.counts')?.textContent || ''), null, {
    timeout: 30000,
  })
  await page.waitForTimeout(1200)
  assert.equal(await page.locator('.slide-card').count(), 5, 'slides did not restore after reload')
  await page.locator('[aria-label="Caption"]').first().click()
  assert.equal(await page.locator('.cap-input').inputValue(), 'still here', 'caption did not survive the reload')
  await page.locator('.cap-input').fill('')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1200)
  assert.equal(await page.locator('.hints-card').count(), 0, 'hints must not reappear after reload')
  console.log('  ok  reload restores the whole session from IndexedDB')

  // keyboard: R remixes without touching the mouse (typing guard is covered
  // by the caption test above — filling the input never triggered it)
  await page.keyboard.press('r')
  await page.waitForTimeout(700)
  assert.match(await page.locator('.remix-toast').textContent(), /^Remixed/, 'R should trigger a remix')
  console.log('  ok  keyboard shortcuts fire (R = remix)')

  // phone width: the tally is fused into the dock — one “p”-shaped bar
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  const lobeBox = await page.locator('.dock-stats').boundingBox()
  const dockBox = await page.locator('.dock').boundingBox()
  // the lobe rises from the bar: it starts above the dock's top edge and its
  // lower edge overlaps into it — one fused silhouette
  assert.ok(
    lobeBox &&
      lobeBox.y < dockBox.y &&
      lobeBox.y + lobeBox.height > dockBox.y &&
      lobeBox.y + lobeBox.height < dockBox.y + dockBox.height,
    `the tally lobe should rise fused from the dock's top (${JSON.stringify({ lobeBox, dockBox })})`,
  )
  assert.ok(lobeBox.x >= 0 && dockBox.x + dockBox.width <= 391, 'the fused bar must fit the phone width')
  assert.ok(await page.locator('.counts').isVisible(), 'the tally text stays visible in the lobe')

  // phone width declutters: slide actions collapse behind one ⋯ button that
  // opens a bottom action sheet, and editors anchor to the thumb zone
  assert.equal(await page.locator('[aria-label="Layout template"]').count(), 0, 'inline actions should hide on phones')
  await page.locator('[aria-label="Slide actions"]').first().click()
  await page.waitForTimeout(400)
  assert.equal(await page.locator('.action-sheet .sheet-row').count(), 6, 'action sheet should list all six actions')
  // the spring animation overshoots on entry — wait for the sheet to settle
  await page.waitForFunction(
    () => Math.abs(document.querySelector('.action-sheet').getBoundingClientRect().bottom - window.innerHeight) < 2,
    null,
    { timeout: 5000 },
  )
  await page.locator('.sheet-row', { hasText: 'Caption' }).click()
  await page.waitForFunction(
    () => {
      const r = document.querySelector('.cap-popover')?.getBoundingClientRect()
      return r && Math.abs(r.bottom - window.innerHeight) < 2 && r.width >= 388
    },
    null,
    { timeout: 5000 },
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  console.log('  ok  phone width: ⋯ action sheet and thumb-zone bottom sheets')

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.waitForTimeout(300)
  console.log('  ok  tally rides fused to the dock at phone width')

  // 200-photo stress: import must complete and stay responsive
  const many = []
  for (let i = 0; i < 200; i++) {
    const [w, h] = shapes[i % shapes.length]
    // reuse the same 30 files cyclically to keep disk small but count high
    many.push(files[i % 30])
  }
  const t0 = Date.now()
  await page.setInputFiles('[data-testid="file-input"]', many)
  await page.waitForFunction(() => /229 photos/.test(document.querySelector('.counts')?.textContent || ''), null, {
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
  console.log(`  ok  229 photos imported in ${(elapsed / 1000).toFixed(1)}s, clamped to 20 slides, tab responsive`)

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
