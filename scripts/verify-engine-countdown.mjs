// Observes the real SignalGenerator over CDP: lock → 5-4-3-2-1 → TRADE NOW,
// then asserts the auto-trade hand-off fires exactly once with the locked digit.
//
// REQUIRES THE TEMPORARY ENGINE HARNESS. This script drives `?harness=engine`,
// which is not part of the shipped app — re-add the EngineHarness component to
// `src/App.tsx`, build with `vite build --outDir /tmp/harness-dist --base=/`,
// serve that directory, then run:
//   node scripts/verify-engine-countdown.mjs "http://127.0.0.1:8899/?harness=engine" 1440 900 label
//
// The countdown *timing* is permanently pinned by scripts/test-entry-countdown.ts
// (pure functions, no harness needed); this script exists to prove the wiring
// between the engine and the auto trader, which unit tests cannot reach.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2]
const width = Number(process.argv[3] ?? 1440)
const height = Number(process.argv[4] ?? 900)
const label = process.argv[5] ?? 'engine'

const profile = mkdtempSync(join(tmpdir(), 'cr-'))
const port = 9900 + Math.floor(Math.random() * 90)
const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`, '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  // Headless chromium throttles timers on a "hidden" page and stalls the frame
  // clock without these, which makes a 500ms tick stream crawl.
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
  'about:blank',
], { stdio: 'ignore' })

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function debuggerUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('no debugger')
}

const sock = new WebSocket(await debuggerUrl())
let id = 0
const pending = new Map()
await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej })
sock.onmessage = ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id)
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)
  }
}
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej })
  sock.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }))
})

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 }, sessionId)
  await send('Page.navigate', { url }, sessionId)

  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)
    return r.result?.value
  }

  // Poll the DOM while the round runs. The engine needs ~10 ticks to collect
  // samples, then a 5s countdown, so 22s covers it with room to spare.
  const timeline = []
  let sawTradeNowText = false
  let mountedSeen = false
  let capturedCountdown = false
  let capturedTradeNow = false

  for (let i = 0; i < 90; i++) {
    const snap = await evalJs(`JSON.stringify({
      text: document.body.innerText,
      handoffs: window.__handoffs ?? null,
      locks: window.__locks ?? null,
      found: window.__found ?? null,
      mounted: !!document.querySelector('button'),
      badge: [...document.querySelectorAll('p')].some(el => el.textContent.trim() === 'TRADE NOW'),
      placing: /Placing the contract on/.test(document.body.innerText),
    })`)
    if (snap) {
      const s = JSON.parse(snap)
      const m = s.text.match(/Entry in\s+(\d+)\s+second/i)
      timeline.push({
        t: Date.now(),
        countdown: m ? Number(m[1]) : null,
        tradeNow: s.badge,
        handoffs: s.handoffs ? s.handoffs.length : 0,
      })
      // Exact-node match only: the journal legitimately contains the words
      // "TRADE NOW" ("5s to TRADE NOW"), so a substring test is a false positive.
      if (s.badge) sawTradeNowText = true
      // Only meaningful once React has mounted at least once.
      if (!mountedSeen) mountedSeen = s.mounted

      // Capture the two moments the user actually sees.
      if (mountedSeen && !capturedCountdown && m && Number(m[1]) === 4) {
        capturedCountdown = true
        const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
        writeFileSync(`/tmp/${label}-countdown.png`, Buffer.from(shot.data, 'base64'))
      }
      if (mountedSeen && !capturedTradeNow && s.badge) {
        capturedTradeNow = true
        const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
        writeFileSync(`/tmp/${label}-tradenow.png`, Buffer.from(shot.data, 'base64'))
      }
    }
    await sleep(250)
  }

  const final = JSON.parse(await evalJs(`JSON.stringify({
    handoffs: window.__handoffs ?? [],
    locks: window.__locks ?? [],
    found: window.__found ?? [],
    watch: window.__watch ?? [],
    text: document.body.innerText,
  })`))

  const countdownValues = [...new Set(timeline.map(t => t.countdown).filter(v => v !== null))]
  const order = timeline.filter(t => t.countdown !== null).map(t => t.countdown)

  console.log('\n── observed countdown values ──')
  console.log('  distinct:', countdownValues.join(', ') || '(none)')
  console.log('  first 30 samples:', order.slice(0, 30).join(' → ') || '(none)')
  console.log('\n── hand-offs ──')
  console.log('  locks:   ', JSON.stringify(final.locks))
  console.log('  watch:   ', JSON.stringify(final.watch))
  console.log('  onTradeNow calls:', JSON.stringify(final.handoffs))
  console.log('  onTickFound:', JSON.stringify(final.found))

  console.log('\n── assertions ──')
  check('the panel mounted', mountedSeen)
  check('the predicted digit locked', final.locks.length >= 1, `digit ${final.locks[0]?.d}`)

  // The countdown must actually step down, not sit frozen (the earlier bug).
  const stepped = order.filter((v, i) => i > 0 && v < order[i - 1]).length
  check('countdown steps down over time (not frozen)', stepped >= 3, `${stepped} decreases`)
  check('countdown reaches 1', countdownValues.includes(1))
  check('countdown never shows more than 5', Math.max(...order, 0) <= 5)
  check('countdown never goes negative', Math.min(...order, 99) >= 0)

  check('TRADE NOW rendered', sawTradeNowText)
  check('auto-trade hand-off fired exactly once', final.handoffs.length === 1, `${final.handoffs.length} call(s)`)
  check('hand-off carries the locked digit',
    final.handoffs.length === 1 && final.handoffs[0].d === final.locks[0]?.d,
    `handoff ${final.handoffs[0]?.d} vs locked ${final.locks[0]?.d}`)
  check('hand-off carries the AI confidence',
    final.handoffs.length === 1 && Math.abs(final.handoffs[0].c - 72.5) < 0.01,
    `confidence ${final.handoffs[0]?.c}`)
  check('the trade fires after the countdown, not at lock',
    final.handoffs.length === 1 && final.locks.length >= 1 &&
      final.handoffs[0].t - final.locks[0].t >= 4500,
    `${final.handoffs[0] && final.locks[0] ? final.handoffs[0].t - final.locks[0].t : '?'}ms after lock`)
  check('AI Confidence is on screen', /AI CONFIDENCE/i.test(final.text))

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId)
  writeFileSync(`/tmp/${label}.png`, Buffer.from(shot.data, 'base64'))
  console.log(`\nscreenshot: /tmp/${label}.png`)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exitCode = 1
  else console.log('ALL PASS')
} finally {
  chrome.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
