/**
 * Probes Deriv's real REST/OAuth surface to confirm which endpoints exist.
 *
 * Distinguishing signal: an endpoint that EXISTS answers with an auth error
 * (401 / OAuth error) for a bogus credential. A non-existent path returns 404
 * "404 page not found". That is how the map below was established.
 *
 * Run: bun run scripts/probe-deriv-rest.mjs
 */

const REST = 'https://api.derivws.com'
const BOGUS = 'Bearer bogus-token-probe'

async function probe(label, url, init = {}) {
  try {
    const res = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15000) })
    const location = res.headers.get('location') ?? ''
    let body = ''
    try {
      body = (await res.text()).replace(/\s+/g, ' ').slice(0, 180)
    } catch { /* no body */ }
    const verdict = res.status === 404 ? 'MISSING' : 'EXISTS'
    console.log(`${verdict.padEnd(8)} ${label}`)
    console.log(`         HTTP ${res.status}${location ? `  → ${location.slice(0, 150)}` : ''}`)
    if (!location && body) console.log(`         ${body}`)
  } catch (err) {
    console.log(`ERROR    ${label} — ${err.message}`)
  }
}

const auth = { Authorization: BOGUS }

console.log('\n=== Authorize / token (HTTPS OAuth) ===')
await probe(
  'GET  /oauth2/auth          authorize endpoint',
  `${'https://auth.deriv.com'}/oauth2/auth?response_type=code&client_id=bogus&redirect_uri=https%3A%2F%2Fexample.test%2Foauth%2Fcallback&scope=trade&state=ST&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256`
)
await probe('POST /oauth2/token          code→token exchange', 'https://auth.deriv.com/oauth2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=authorization_code&code=x&client_id=bogus',
})

console.log('\n=== Options trading REST ===')
await probe('GET  /trading/v1/options/accounts                  list accounts', `${REST}/trading/v1/options/accounts`, { headers: auth })
await probe('POST /trading/v1/options/accounts                  CREATE account (never use to list!)', `${REST}/trading/v1/options/accounts`, { method: 'POST', headers: auth })
await probe('POST /trading/v1/options/accounts/{id}/otp         authenticated WS url', `${REST}/trading/v1/options/accounts/DOT90004580/otp`, { method: 'POST', headers: auth })
await probe('GET  /trading/v1/options/accounts/{id}              account detail', `${REST}/trading/v1/options/accounts/DOT90004580`, { headers: auth })
await probe('GET  /trading/v1/options/accounts/{id}/balance      balance', `${REST}/trading/v1/options/accounts/DOT90004580/balance`, { headers: auth })
await probe('GET  /trading/v1/options/accounts/nope/nope/nope    control (expect MISSING)', `${REST}/trading/v1/options/accounts/nope/nope/nope`, { headers: auth })

console.log('\n=== WebSocket endpoints (see probe-deriv-ws.mjs) ===')
console.log('public  wss://api.derivws.com/trading/v1/options/ws/public   no auth — market data')
console.log('demo    wss://api.derivws.com/trading/v1/options/ws/demo     OTP in URL — virtual trading')
console.log('real    wss://api.derivws.com/trading/v1/options/ws/real     OTP in URL — real trading')
