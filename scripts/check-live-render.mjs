// Renders the LIVE GitHub Pages site in headless chromium over CDP and reports
// console errors, whether React actually mounted, and horizontal overflow.
// Usage: node scripts/check-live-render.mjs <url> <label> [width] [height]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'https://archiebatshameki-source.github.io/deriv-ai-predictor/'
const label = process.argv[3] ?? 'live'
const width = Number(process.argv[4] ?? 390)
const height = Number(process.argv[5] ?? 844)

const profile = mkdtempSync(join(tmpdir(), 'cr-'))
const port = 9500 + Math.floor(Math.random() * 400)

const chrome = spawn('/usr/bin/chromium', [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`,
  '--no-sandbox',
  '--disable-gpu',
  '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      const j = await res.json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('chromium debugger never came up')
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let id = 0
    const pending = new Map()
    const listeners = []
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { resolve: r, reject: j } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? j(new Error(JSON.stringify(msg.error))) : r(msg.result)
      } else if (msg.method) {
        for (const l of listeners) l(msg)
      }
    }
    ws.onerror = reject
    ws.onopen = () =>
      resolve({
        send: (method, params = {}, sessionId) =>
          new Promise((r, j) => {
            const mid = ++id
            pending.set(mid, { resolve: r, reject: j })
            ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }))
          }),
        on: (fn) => listeners.push(fn),
        close: () => ws.close(),
      })
  })
}

const consoleErrors = []
const failedRequests = []
let rootHtml = ''
let overflow = null
let title = ''

try {
  const cdp = await connect(await getWsUrl())
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })

  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params?.exceptionDetails
      consoleErrors.push(`[exception] ${d?.exception?.description ?? d?.text ?? 'unknown'}`)
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      consoleErrors.push(msg.params.args?.map((a) => a.value ?? a.description ?? '').join(' '))
    }
    if (msg.method === 'Network.loadingFailed') {
      failedRequests.push(`${msg.params?.type} ${msg.params?.errorText}`)
    }
  })

  await cdp.send('Runtime.enable', {}, sessionId)
  await cdp.send('Network.enable', {}, sessionId)
  await cdp.send('Page.enable', {}, sessionId)
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 2, mobile: width < 700 }, sessionId)

  await cdp.send('Page.navigate', { url }, sessionId)
  await sleep(7000)

  const evalJs = async (expr) => {
    const r = await cdp.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)
    return r.result?.value
  }

  title = await evalJs('document.title')
  rootHtml = await evalJs('document.getElementById("root")?.innerHTML?.length ?? 0')
  overflow = await evalJs(
    'JSON.stringify({doc: document.documentElement.scrollWidth, win: window.innerWidth})',
  )

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId)
  const { writeFileSync } = await import('node:fs')
  const out = `/tmp/render-${label}-${width}.png`
  writeFileSync(out, Buffer.from(shot.data, 'base64'))

  cdp.close()
  console.log(`URL:      ${url}`)
  console.log(`Viewport: ${width}x${height}`)
  console.log(`Title:    ${title}`)
  console.log(`Root:     ${rootHtml} chars ${rootHtml > 100 ? '✓ mounted' : '✗ EMPTY'}`)
  const o = overflow ? JSON.parse(overflow) : null
  if (o) {
    const bad = o.doc > o.win + 1
    console.log(`Overflow: doc=${o.doc} win=${o.win} ${bad ? '✗ HORIZONTAL SCROLL' : '✓ none'}`)
  }
  console.log(`Console errors: ${consoleErrors.length}`)
  consoleErrors.slice(0, 8).forEach((e) => console.log(`   ${e}`))
  console.log(`Failed requests: ${failedRequests.length}`)
  failedRequests.slice(0, 8).forEach((e) => console.log(`   ${e}`))
  console.log(`Screenshot: ${out}`)
  console.log(
    rootHtml > 100 && consoleErrors.length === 0 && (!o || o.doc <= o.win + 1)
      ? 'RESULT: PASS'
      : 'RESULT: FAIL',
  )
} finally {
  chrome.kill()
  await sleep(400)
  rmSync(profile, { recursive: true, force: true })
}
