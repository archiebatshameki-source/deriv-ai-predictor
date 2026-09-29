/**
 * Pins down the exact new-API request shape for a digit proposal.
 *
 * Two candidate defects in the app:
 *   - request key `propose` vs `proposal`
 *   - symbol field `symbol` vs `underlying_symbol`
 *
 * Run: node scripts/probe-deriv-proposal-shape.mjs
 */
const URL_PUBLIC = 'wss://api.derivws.com/trading/v1/options/ws/public'

const common = {
  amount: 1,
  basis: 'stake',
  contract_type: 'DIGITMATCH',
  currency: 'USD',
  duration: 1,
  duration_unit: 't',
  barrier: '5',
}

const cases = [
  ['1. propose + symbol      (both wrong — app today)', { propose: 1, ...common, symbol: 'R_10' }],
  ['2. propose + underlying_symbol', { propose: 1, ...common, underlying_symbol: 'R_10' }],
  ['3. proposal + symbol', { proposal: 1, ...common, symbol: 'R_10' }],
  ['4. proposal + underlying_symbol  (expected fix)', { proposal: 1, ...common, underlying_symbol: 'R_10' }],
]

async function ask(payload) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL_PUBLIC)
    const done = (v) => { try { ws.close() } catch {} ; resolve(v) }
    const timer = setTimeout(() => done({ error: 'timeout' }), 10000)
    ws.onerror = () => { clearTimeout(timer); done({ error: 'socket error' }) }
    ws.onopen = () => ws.send(JSON.stringify({ ...payload, req_id: 1 }))
    ws.onmessage = (ev) => {
      clearTimeout(timer)
      const m = JSON.parse(ev.data)
      done({
        error_code: m.error?.code ?? null,
        error_message: m.error?.message ?? null,
        proposal_keys: m.proposal ? Object.keys(m.proposal).sort() : null,
        proposal_sample: m.proposal
          ? { id: m.proposal.id, ask_price: m.proposal.ask_price, payout: m.proposal.payout }
          : null,
      })
    }
  })
}

for (const [name, payload] of cases) {
  console.log(`\n=== ${name} ===`)
  console.log(JSON.stringify(await ask(payload), null, 1))
}
