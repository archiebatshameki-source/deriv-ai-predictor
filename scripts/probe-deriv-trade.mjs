/**
 * Probes the *new* authenticated Deriv WebSocket API to learn which request
 * envelope it accepts for trading. Run: node scripts/probe-deriv-trade.mjs
 *
 * Uses the public (unauthenticated) socket, which is enough to distinguish
 * "unknown request type" from "not authorized".
 */
const URL_PUBLIC = 'wss://api.derivws.com/trading/v1/options/ws/public?app_id=1089'

async function tryMessages(messages) {
  return new Promise((resolve) => {
    let ws
    try {
      ws = new WebSocket(URL_PUBLIC)
    } catch (err) {
      resolve({ opened: false, error: String(err) })
      return
    }
    const out = []
    const timer = setTimeout(() => {
      try { ws.close() } catch {}
      resolve({ opened: true, replies: out, timedOut: true })
    }, 12000)

    ws.onopen = () => {
      for (const m of messages) ws.send(JSON.stringify(m))
    }
    ws.onmessage = (ev) => {
      out.push(JSON.parse(ev.data))
      if (out.length >= messages.length) {
        clearTimeout(timer)
        try { ws.close() } catch {}
        resolve({ opened: true, replies: out })
      }
    }
    ws.onerror = () => {
      clearTimeout(timer)
      resolve({ opened: false, error: 'socket error' })
    }
  })
}

const cases = [
  ['legacy tick', [{ ticks: 'R_10', subscribe: 1, req_id: 1 }]],
  ['legacy ping', [{ ping: 1, req_id: 1 }]],
  ['legacy time', [{ time: 1, req_id: 1 }]],
  [
    'legacy propose digitmatch',
    [
      {
        propose: 1,
        amount: 1,
        basis: 'stake',
        contract_type: 'DIGITMATCH',
        currency: 'USD',
        duration: 1,
        duration_unit: 't',
        symbol: 'R_10',
        barrier: '5',
        req_id: 1,
      },
    ],
  ],
  ['legacy balance', [{ balance: 1, req_id: 1 }]],
]

for (const [name, msgs] of cases) {
  const res = await tryMessages(msgs)
  console.log(`\n=== ${name} ===`)
  console.log(JSON.stringify(res, null, 2).slice(0, 1200))
}
