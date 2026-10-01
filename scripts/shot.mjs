// Full-page + element capture over CDP. Usage:
//   node scripts/shot.mjs <url> <label> <width> <height> [selector]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2]
const label = process.argv[3] ?? 'shot'
const width = Number(process.argv[4] ?? 1440)
const height = Number(process.argv[5] ?? 900)
const selector = process.argv[6]

const profile = mkdtempSync(join(tmpdir(), 'cr-'))
const port = 9700 + Math.floor(Math.random() * 200)
const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`, '--no-sandbox', '--disable-gpu', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' })

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function ws() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('no debugger')
}

const sock = new WebSocket(await ws())
let id = 0
const pending = new Map()
await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej })
sock.onmessage = ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) }
}
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej })
  sock.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }))
})

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 }, sessionId)
  await send('Page.navigate', { url }, sessionId)
  await sleep(6000)

  if (selector) {
    const ev = `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return null
        el.scrollIntoView({ block: 'start' })
        const r = el.getBoundingClientRect()
        return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height })
      })()`
    const r = await send('Runtime.evaluate', { expression: ev, returnByValue: true }, sessionId)
    await sleep(800)
    const box = JSON.parse(r.result.value)
    // Viewport-relative capture after scrolling: `captureBeyondViewport` with a
    // clip uses document coordinates, which silently returns the page top.
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    writeFileSync(`/tmp/${label}.png`, Buffer.from(shot.data, 'base64'))
    console.log(`${label}: element ${box.w}x${box.h} -> /tmp/${label}.png`)
  } else {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId)
    writeFileSync(`/tmp/${label}.png`, Buffer.from(shot.data, 'base64'))
    console.log(`${label}: full page -> /tmp/${label}.png`)
  }
} finally {
  chrome.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
