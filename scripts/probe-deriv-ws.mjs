// Probe which Deriv WebSocket endpoints are reachable, and whether they accept `authorize`.
const ENDPOINTS = [
  'wss://ws.binaryws.com/websockets/v3?app_id=1089',
  'wss://api.derivws.com/trading/v1/options/ws/public?app_id=1089',
  'wss://api.derivws.com/trading/v1/options/ws?app_id=1089',
  'wss://green.derivws.com/websockets/v3?app_id=1089',
]

function probe(url, timeoutMs = 8000) {
  return new Promise(resolve => {
    const started = Date.now()
    let ws
    try {
      ws = new WebSocket(url)
    } catch (err) {
      resolve({ url, result: 'threw', detail: String(err?.message ?? err) })
      return
    }

    const done = (result, detail) => {
      try { ws.close() } catch {}
      resolve({ url, result, detail, ms: Date.now() - started })
    }

    const timer = setTimeout(() => done('timeout', 'no open within limit'), timeoutMs)

    ws.addEventListener('open', () => {
      clearTimeout(timer)
      // Authenticate with a deliberately bogus token — we only care that the
      // server *answers*, which proves the endpoint speaks the JSON API.
      try {
        ws.send(JSON.stringify({ authorize: 'bogus-token-probe-000000000000', req_id: 1 }))
      } catch (e) {
        done('open', `send failed: ${e}`)
        return
      }
      const replyTimer = setTimeout(() => done('open', 'connected, no authorize reply in 6s'), 6000)
      ws.addEventListener('message', ev => {
        clearTimeout(replyTimer)
        const text = typeof ev.data === 'string' ? ev.data : '[binary]'
        done('open+reply', text.slice(0, 220))
      })
    })

    ws.addEventListener('error', () => {
      clearTimeout(timer)
      done('error', 'socket error before open')
    })
  })
}

for (const url of ENDPOINTS) {
  const r = await probe(url)
  console.log(`\n${url}`)
  console.log(`  → ${r.result}${r.ms ? ` (${r.ms}ms)` : ''}`)
  if (r.detail) console.log(`    ${r.detail}`)
}
