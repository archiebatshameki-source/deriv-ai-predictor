/**
 * Probes Deriv's current Options REST surface to confirm which endpoints exist and
 * what a browser needs in order to call them.
 *
 * Distinguishing signal: an endpoint that EXISTS answers with an auth error for a bogus
 * credential. A non-existent path returns 404. That is how the map below was established.
 *
 * Also checks the CORS preflight, because the app calls these endpoints directly from the
 * browser (GitHub Pages is static, so there is no server-side proxy).
 *
 * Run: bun run scripts/probe-deriv-rest.mjs
 */

const REST = 'https://api.derivws.com'
const BOGUS = 'Bearer bogus-token-probe'
const ORIGIN = process.env.PROBE_ORIGIN || 'https://archiebatshameki-source.github.io'

async function probe(label, url, init = {}) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
    let body = ''
    try {
      body = (await res.text()).replace(/\s+/g, ' ').slice(0, 140)
    } catch {
      /* no body */
    }
    console.log(`${(res.status === 404 ? 'MISSING' : 'EXISTS').padEnd(8)} ${label}`)
    console.log(`         HTTP ${res.status}${body ? `  ${body}` : ''}`)
  } catch (err) {
    console.log(`ERROR    ${label} — ${err.message}`)
  }
}

const auth = { Authorization: BOGUS }

console.log('\n=== Options trading REST (auth required) ===')
await probe('GET  /trading/v1/options/accounts               list accounts', `${REST}/trading/v1/options/accounts`, { headers: auth })
await probe('POST /trading/v1/options/accounts/{id}/otp      authenticated WS url', `${REST}/trading/v1/options/accounts/DOT90004580/otp`, { method: 'POST', headers: auth })
await probe('POST /trading/v1/options/accounts               CREATE account (never use to list!)', `${REST}/trading/v1/options/accounts`, { method: 'POST', headers: auth })
await probe('GET  /trading/v1/options/accounts/nope/nope/nope control (expect MISSING)', `${REST}/trading/v1/options/accounts/nope/nope/nope`, { headers: auth })

console.log('\n=== Deriv-App-ID is required for PAT auth (per the OpenAPI spec) ===')
await probe('GET  /accounts  with app id', `${REST}/trading/v1/options/accounts`, {
  headers: { ...auth, 'Deriv-App-ID': '00000000-0000-0000-0000-000000000000' },
})
await probe('GET  /accounts  without app id', `${REST}/trading/v1/options/accounts`, { headers: auth })

console.log(`\n=== CORS preflight from the app origin (${ORIGIN}) ===`)
{
  const res = await fetch(`${REST}/trading/v1/options/accounts`, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,deriv-app-id',
    },
  })
  const allowOrigin = res.headers.get('access-control-allow-origin')
  const allowHeaders = res.headers.get('access-control-allow-headers')
  console.log(`allow-origin : ${allowOrigin}`)
  console.log(`allow-headers: ${allowHeaders}`)
  console.log(
    allowOrigin === ORIGIN
      ? 'OK  a browser on this origin may call Deriv directly (no proxy needed)'
      : 'WARN  browsers on this origin are NOT allowed — a proxy would be required'
  )
}

console.log('\n=== WebSocket endpoints (see probe-deriv-ws.mjs) ===')
console.log('public  wss://api.derivws.com/trading/v1/options/ws/public   no auth — market data')
console.log('demo    wss://api.derivws.com/trading/v1/options/ws/demo     OTP in URL — virtual trading')
console.log('real    wss://api.derivws.com/trading/v1/options/ws/real     OTP in URL — real trading')
