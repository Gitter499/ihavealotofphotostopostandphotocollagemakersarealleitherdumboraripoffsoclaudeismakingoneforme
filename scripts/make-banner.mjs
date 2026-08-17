// Builds docs/banner.svg for the README: the BSP-composed logo mark enlarged,
// beside "photogram" set in Shrikhand converted to vector paths (so GitHub
// renders it without loading any font). Run: node scripts/make-banner.mjs
// Expects the Shrikhand TTF at /tmp/shrikhand.ttf (see README of this script's
// commit for the fonts.gstatic.com source).
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import opentype from 'opentype.js'
import { computeLayout } from '../src/lib/layout.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// --- logo mark, same recipe as make-logo.mjs, scaled up ---
const MW = 96
const MH = 120
const { rects } = computeLayout([1.6, 0.8, 1.2, 1.0], {
  canvasW: MW,
  canvasH: MH,
  margin: 10,
  gutter: 7,
  baseSeed: 20260817,
})
const gradients = [
  ['#64d2ff', '#0a84ff'],
  ['#0a84ff', '#5e5ce6'],
  ['#5e5ce6', '#bf5af2'],
  ['#ffd60a', '#ff9f0a'],
]
const order = rects
  .map((r, i) => ({ i, area: r.w * r.h }))
  .sort((a, b) => a.area - b.area)
  .map((x) => x.i)
const fillIndex = new Array(rects.length)
fillIndex[order[0]] = 3
order.slice(1).forEach((ri, k) => (fillIndex[ri] = k % 3))

// --- wordmark as paths ---
const ttf = readFileSync('/tmp/shrikhand.ttf')
const font = opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength))
const SIZE = 92
const textPath = font.getPath('photogram', 0, 0, SIZE)
const bb = textPath.getBoundingBox()
const textData = textPath.toPathData(2)

// --- compose ---
const PAD = 44
const GAP = 40
const markScale = (bb.y2 - bb.y1 + 14) / MH
const markW = MW * markScale
const markH = MH * markScale
const textW = bb.x2 - bb.x1
const W = Math.ceil(PAD * 2 + markW + GAP + textW)
const H = Math.ceil(PAD * 2 + Math.max(markH, bb.y2 - bb.y1))

const defs =
  gradients
    .map(
      ([a, b], i) =>
        `<linearGradient id="g${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`,
    )
    .join('') +
  `<linearGradient id="word" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#64d2ff"/><stop offset="0.55" stop-color="#6aa8ff"/><stop offset="1" stop-color="#bf5af2"/></linearGradient>`

const tiles = rects
  .map(
    (r, i) =>
      `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" rx="7" fill="url(#g${fillIndex[i]})"/>`,
  )
  .join('')

const markX = PAD
const markY = (H - markH) / 2
const textX = PAD + markW + GAP - bb.x1
const textY = (H - (bb.y2 - bb.y1)) / 2 - bb.y1

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>${defs}</defs>
<rect width="${W}" height="${H}" rx="28" fill="#0a0a0f"/>
<g transform="translate(${markX} ${markY}) scale(${markScale.toFixed(4)})">
  <rect width="${MW}" height="${MH}" rx="24" fill="#101016"/>
  <rect width="${MW}" height="${MH}" rx="24" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="2"/>
  ${tiles}
</g>
<path transform="translate(${textX.toFixed(1)} ${textY.toFixed(1)})" d="${textData}" fill="url(#word)"/>
</svg>
`

mkdirSync(join(root, 'docs'), { recursive: true })
writeFileSync(join(root, 'docs/banner.svg'), svg)
console.log(`banner: ${W}×${H}`)
