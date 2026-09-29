/**
 * Verifies the browser-side Deriv REST layer (src/lib/deriv-rest.ts).
 *
 * Two halves:
 *   1. LIVE  — hits the real Deriv endpoints with a bogus token, proving the URLs exist
 *              and that Deriv's own error is surfaced rather than a generic failure.
 *   2. STUBS — replaces global fetch to exercise every response shape and error mapping
 *              deterministically, including ones a bogus token can never trigger.
 *
 * Run: bun run scripts/test-deriv-rest.ts
 */
import {
  DerivRestError,
  buildDerivSession,
  listAccounts,
  pickDefaultAccount,
  requestOtpUrl,
  toDerivAccount,
  type DerivRestAccount,
} from '../src/lib/deriv-rest'

let failures = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
}

const realFetch = globalThis.fetch

const ACCOUNTS_PAYLOAD = {
  data: [
    {
      account_id: 'DOT90004580',
      balance: 10000,
      currency: 'USD',
      group: 'row',
      status: 'active',
      account_type: 'demo',
    },
    {
      account_id: 'DOT90004581',
      balance: '1320.44',
      currency: 'USD',
      group: 'row',
      status: 'active',
      account_type: 'real',
    },
  ],
  meta: { endpoint: '/trading/v1/options/accounts', method: 'GET', timing: 222 },
}

/** Swaps in a canned response, then restores the real fetch. */
async function withStubbedFetch(
  handler: (url: string, init?: RequestInit) => Response,
  run: () => Promise<void>
) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch
  try {
    await run()
  } finally {
    globalThis.fetch = realFetch
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/* ── 1. live endpoints ─────────────────────────────────────────────────── */

console.log('\n--- live Deriv endpoints (bogus token) ---')

try {
  await listAccounts({ token: 'definitely-not-a-real-token' })
  ok('GET /accounts rejects a bogus token', false, 'no error thrown')
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  ok('GET /accounts rejects a bogus token', err instanceof DerivRestError)
  ok('error is human-readable, not an HTTP dump', !/^Deriv returned HTTP/.test(message), message)
  ok('does not leak the raw upstream text', !/invalid token format/i.test(message), message)
}

try {
  await requestOtpUrl({
    token: 'definitely-not-a-real-token',
    accountId: 'DOT90004580',
  })
  ok('POST /otp rejects a bogus token', false, 'no error thrown')
} catch (err) {
  ok('POST /otp rejects a bogus token', err instanceof DerivRestError)
}

/* ── 2. CORS: can a browser call this from the Pages origin? ───────────── */

console.log('\n--- CORS preflight from the GitHub Pages origin ---')
{
  const origin = 'https://archiebatshameki-source.github.io'
  const res = await realFetch('https://api.derivws.com/trading/v1/options/accounts', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,deriv-app-id',
    },
  })
  const allowOrigin = res.headers.get('access-control-allow-origin')
  const allowHeaders = res.headers.get('access-control-allow-headers') ?? ''
  ok('Deriv allows the Pages origin', allowOrigin === origin, `got ${allowOrigin}`)
  ok('authorization header is allowed', allowHeaders.includes('authorization'), allowHeaders)
  ok('deriv-app-id header is allowed', allowHeaders.includes('deriv-app-id'), allowHeaders)
}

/* ── 3. response parsing ──────────────────────────────────────────────── */

console.log('\n--- response parsing ---')

await withStubbedFetch(
  () => json(ACCOUNTS_PAYLOAD),
  async () => {
    const accounts = await listAccounts({ token: 't', appId: 'app-1' })
    ok('parses both accounts', accounts.length === 2, `got ${accounts.length}`)
    ok('reads account_type=demo', accounts[0]?.accountType === 'demo')
    ok('reads account_type=real', accounts[1]?.accountType === 'real')
    ok('reads a numeric balance', accounts[0]?.balance === 10000)
    ok('coerces a string balance', accounts[1]?.balance === 1320.44, String(accounts[1]?.balance))
  }
)

await withStubbedFetch(
  () => json(ACCOUNTS_PAYLOAD),
  async () => {
    let senderHeaders: Record<string, string> = {}
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      senderHeaders = (init?.headers ?? {}) as Record<string, string>
      return json(ACCOUNTS_PAYLOAD)
    }) as typeof fetch
    try {
      await listAccounts({ token: 'tok', appId: 'app-abc' })
      ok('sends Bearer token', senderHeaders.Authorization === 'Bearer tok', senderHeaders.Authorization)
      ok('sends Deriv-App-ID when provided', senderHeaders['Deriv-App-ID'] === 'app-abc')

      await listAccounts({ token: 'tok' })
      ok('omits Deriv-App-ID when blank', senderHeaders['Deriv-App-ID'] === undefined)
    } finally {
      globalThis.fetch = realFetch
    }
  }
)

await withStubbedFetch(
  () => json({ data: { url: 'wss://api.derivws.com/trading/v1/options/ws/demo?otp=abc' } }),
  async () => {
    const url = await requestOtpUrl({ token: 't', accountId: 'DOT90004580' })
    ok('extracts the OTP websocket url', url.includes('otp=abc'), url)
  }
)

await withStubbedFetch(
  () => json({ data: {} }),
  async () => {
    try {
      await requestOtpUrl({ token: 't', accountId: 'DOT90004580' })
      ok('missing ws url is reported', false, 'no error thrown')
    } catch (err) {
      ok(
        'missing ws url is reported',
        err instanceof DerivRestError && /did not return a trading connection/.test(err.message)
      )
    }
  }
)

await withStubbedFetch(
  () => json({ data: 'unexpected' }),
  async () => {
    const accounts = await listAccounts({ token: 't' })
    ok('a non-array payload yields no accounts rather than throwing', accounts.length === 0)
  }
)

/* ── 4. error mapping ─────────────────────────────────────────────────── */

console.log('\n--- error mapping ---')

const errorCases: Array<{ label: string; res: Response; expect: RegExp }> = [
  {
    label: 'Deriv-App-ID field error asks for the App ID',
    res: json(
      { errors: [{ status: 403, code: 'AccessDenied', message: 'forbidden', field: 'Deriv-App-ID' }], meta: {} },
      403
    ),
    expect: /App ID/,
  },
  {
    label: 'plain-text token failure maps to a token hint',
    res: new Response('Invalid token format', { status: 401 }),
    expect: /API token/,
  },
  {
    label: 'RateLimit maps to a retry hint',
    res: json({ errors: [{ status: 429, code: 'RateLimit', message: 'slow down' }], meta: {} }, 429),
    expect: /rate-limiting/i,
  },
  {
    label: 'AccountNotFound is explained',
    res: json({ errors: [{ status: 404, code: 'AccountNotFound', message: 'nope' }], meta: {} }, 404),
    expect: /does not recognise that account/i,
  },
  {
    label: 'AccessDenied suggests the required scopes',
    res: json({ errors: [{ status: 403, code: 'AccessDenied', message: 'nope' }], meta: {} }, 403),
    expect: /Trade and Account management/,
  },
]

for (const { label, res, expect } of errorCases) {
  await withStubbedFetch(
    () => res,
    async () => {
      try {
        await listAccounts({ token: 't' })
        ok(label, false, 'no error thrown')
      } catch (err) {
        const message = err instanceof Error ? err.message : ''
        ok(label, expect.test(message), message)
      }
    }
  )
}

/* ── 5. pure helpers ──────────────────────────────────────────────────── */

console.log('\n--- session shaping ---')

const demo: DerivRestAccount = {
  accountId: 'DOT1',
  balance: 10000,
  currency: 'USD',
  accountType: 'demo',
  status: 'active',
  group: 'row',
}
const live: DerivRestAccount = { ...demo, accountId: 'DOT2', balance: 250, accountType: 'real' }

ok('demo maps to isVirtual', toDerivAccount(demo).isVirtual === true)
ok('real maps to not-virtual', toDerivAccount(live).isVirtual === false)

ok('prefers the remembered account', pickDefaultAccount([live, demo], 'DOT2').accountId === 'DOT2')
ok('falls back to demo on a fresh login', pickDefaultAccount([live, demo], null).accountId === 'DOT1')
ok('falls back to the first account when there is no demo', pickDefaultAccount([live], null).accountId === 'DOT2')
ok(
  'ignores a remembered account that no longer exists',
  pickDefaultAccount([live, demo], 'GONE').accountId === 'DOT1'
)

const session = buildDerivSession({
  token: 'tok',
  appId: 'app-1',
  accounts: [demo, live],
  activeAccountId: 'DOT2',
  balance: 999,
})
ok('session points at the active account', session.loginid === 'DOT2')
ok('session balance is the live balance', session.balance === 999)
ok('session is marked live', session.isVirtual === false)
ok('session currency follows the active account', session.currency === 'USD')
ok('active account balance is refreshed in the list', session.accounts[1]?.balance === 999)
ok('inactive account keeps its REST balance', session.accounts[0]?.balance === 10000)
ok('session carries the token for reconnect', session.token === 'tok')

const noAppId = buildDerivSession({
  token: 'tok',
  appId: '   ',
  accounts: [demo],
  activeAccountId: 'DOT1',
  balance: 1,
})
ok('blank App ID is normalised to undefined', noAppId.appId === undefined)

console.log(failures === 0 ? '\nAll deriv-rest checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
