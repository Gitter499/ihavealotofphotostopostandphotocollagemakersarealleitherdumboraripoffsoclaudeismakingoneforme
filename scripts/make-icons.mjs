// Rasterize the app icon from the same SVG mark the favicon uses.
// Maskable-safe: the logo sits in the middle 70% on the app's ground colour.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright-core'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'public/favicon.svg'), 'utf8')

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 512, height: 512 } })
await page.setContent(`<!doctype html><html><body style="margin:0;width:512px;height:512px;background:#0a0a0f;display:grid;place-items:center">
  <div style="width:358px;height:358px;display:grid;place-items:center">${svg.replace(/<svg /, '<svg style="width:100%;height:100%" ')}</div>
</body></html>`)
await page.waitForTimeout(200)
mkdirSync(join(root, 'public'), { recursive: true })
writeFileSync(join(root, 'public/icon-512.png'), await page.screenshot({ type: 'png' }))
await page.setViewportSize({ width: 192, height: 192 })
await page.setContent(`<!doctype html><html><body style="margin:0;width:192px;height:192px;background:#0a0a0f;display:grid;place-items:center">
  <div style="width:134px;height:134px;display:grid;place-items:center">${svg.replace(/<svg /, '<svg style="width:100%;height:100%" ')}</div>
</body></html>`)
await page.waitForTimeout(200)
writeFileSync(join(root, 'public/icon-192.png'), await page.screenshot({ type: 'png' }))
await browser.close()
console.log('icons written: public/icon-192.png, public/icon-512.png')
