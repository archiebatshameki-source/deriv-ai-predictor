/**
 * Regression test for the Deriv trade request shape.
 *
 * Drives the real `DerivClient.buyContract()` against the public socket, which
 * accepts the request envelope but refuses account-scoped actions. So a
 * *recognised* proposal (it comes back with an id) plus an `AuthorizationRequired`
 * on the buy step is exactly the proof we want:
 *
 *   - proposal reaches Deriv's validator and returns a priced contract
 *   - buy is recognised (not "Unrecognised request") and only blocked by auth
 *
 * Run: bun run scripts/test-deriv-trade-shape.ts
 */
import { DerivClient, DerivApiError } from '../src/lib/deriv-api'

const PUBLIC_WS = 'wss://api.derivws.com/trading/v1/options/ws/public'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const client = new DerivClient()
await client.connectTo(PUBLIC_WS)
check('socket connects to the public endpoint', client.connected)

// Same call the Quick Trade buttons and the auto-trader make.
let proposalId: string | null = null
let buyError: DerivApiError | null = null

try {
  await client.buyContract({
    symbol: 'R_10',
    contractType: 'DIGITMATCH',
    stake: 1,
    currency: 'USD',
    barrier: '5',
    duration: 1,
    durationUnit: 't',
  })
} catch (err) {
  buyError = err instanceof DerivApiError ? err : new DerivApiError(String(err))
}

// The public socket cannot authenticate, so the buy must be refused for *auth*.
check(
  'proposal is accepted (no UnrecognisedRequest / InputValidationFailed)',
  buyError?.code !== 'UnrecognisedRequest' && buyError?.code !== 'InputValidationFailed',
  `code=${buyError?.code ?? 'none'}`
)
check(
  'buy is recognised and refused only for missing auth',
  buyError?.code === 'AuthorizationRequired',
  buyError?.message ?? '(unexpected success)'
)

// Prove the proposal itself really priced, by asking for one directly.
const raw = await client.request<{
  proposal?: { id?: string; ask_price?: number; payout?: number }
}>({
  proposal: 1,
  amount: 1,
  basis: 'stake',
  contract_type: 'DIGITMATCH',
  currency: 'USD',
  duration: 1,
  duration_unit: 't',
  underlying_symbol: 'R_10',
  barrier: '5',
})
proposalId = raw.proposal?.id ?? null
check('direct proposal returns an id', !!proposalId, `id=${proposalId}`)
check(
  'direct proposal returns ask_price and payout',
  typeof raw.proposal?.ask_price === 'number' && typeof raw.proposal?.payout === 'number',
  `ask=${raw.proposal?.ask_price} payout=${raw.proposal?.payout}`
)

client.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
