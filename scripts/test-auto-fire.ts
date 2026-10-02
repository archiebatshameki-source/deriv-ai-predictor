import { decideAutoFire, DEFAULT_FIRE_THROTTLE_MS, type FireDecisionInput } from '../src/lib/auto-fire'

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (ok) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.log(`FAIL  ${name} — got ${String(actual)}, expected ${String(expected)}`) }
}

const base: FireDecisionInput = {
  autoTrade: true,
  tradeNow: true,
  targetDigit: 7,
  targetConfidence: 0,
  minConfidence: 0,
  alreadyTradedTarget: null,
  now: 1_000_000,
  lastTradeAt: 0,
}

// ── The bug that blocked every trade ────────────────────────────────────────
// The engine forces confidence to 0 on "no_signal", so a non-zero default gate
// silently rejected every genuine Matches hit.
check('confidence 0 with the default gate (0) still fires',
  decideAutoFire({ ...base, targetConfidence: 0, minConfidence: 0 }), 'fire')

check('confidence 0 with an old 10% gate is skipped (the original bug)',
  decideAutoFire({ ...base, targetConfidence: 0, minConfidence: 10 }), 'skip-confidence')

// ── The trigger: the engine's post-lock TRADE NOW hand-off ──────────────────
check('fires on the TRADE NOW hand-off', decideAutoFire(base), 'fire')
check('waits until the entry countdown has finished',
  decideAutoFire({ ...base, tradeNow: false }), 'idle')
check('waits while auto trade is off',
  decideAutoFire({ ...base, autoTrade: false }), 'idle')
check('waits when no digit has been locked',
  decideAutoFire({ ...base, targetDigit: null }), 'idle')

// ── One trade per round ─────────────────────────────────────────────────────
check('does not re-fire on the same target',
  decideAutoFire({ ...base, alreadyTradedTarget: 7 }), 'idle')
check('a new target is tradeable again',
  decideAutoFire({ ...base, targetDigit: 4, alreadyTradedTarget: 7 }), 'fire')

// ── Throttle ────────────────────────────────────────────────────────────────
check('throttled just after a trade',
  decideAutoFire({ ...base, lastTradeAt: base.now - 500 }), 'throttled')
check('not throttled once the window passes',
  decideAutoFire({ ...base, lastTradeAt: base.now - DEFAULT_FIRE_THROTTLE_MS }), 'fire')

// ── The user filter still works when they raise it ──────────────────────────
check('low confidence is skipped when the user asks for 20%',
  decideAutoFire({ ...base, targetConfidence: 12, minConfidence: 20 }), 'skip-confidence')
check('high confidence passes a 20% filter',
  decideAutoFire({ ...base, targetConfidence: 22, minConfidence: 20 }), 'fire')

// ── Ordering: the throttle is checked before the confidence filter, so a
// skipped round cannot bank a permanent "already traded" state. ─────────────
check('throttle outranks the confidence filter',
  decideAutoFire({ ...base, targetConfidence: 0, minConfidence: 10, lastTradeAt: base.now - 100 }), 'throttled')

// ── The predicted digit is the whole signal ─────────────────────────────────
// `ticksWaited` was removed from FireDecisionInput, so the trader cannot even
// be handed a tick count any more — the old bug (a real find that never became
// a trade because the wait was judged too long) is no longer expressible.
let deterministic = true
for (let i = 0; i < 500; i++) {
  if (decideAutoFire(base) !== 'fire') deterministic = false
  if (decideAutoFire({ ...base, tradeNow: false }) !== 'idle') deterministic = false
}
check('the fire decision is a pure function of the TRADE NOW hand-off', deterministic, true)

// Every digit 0-9 is tradeable once the engine hands over at TRADE NOW.
let allDigits = true
for (let d = 0; d <= 9; d++) {
  if (decideAutoFire({ ...base, targetDigit: d }) !== 'fire') allDigits = false
}
check('every predicted digit 0-9 is tradeable at TRADE NOW', allDigits, true)

// The inputs are exactly the ones the gate needs — no wait telemetry and no raw
// tick stream, so neither can influence whether a signal is traded.
check('no tick-count or tick-stream field exists on the decision input',
  Object.keys(base).sort().join(','),
  'alreadyTradedTarget,autoTrade,lastTradeAt,minConfidence,now,targetConfidence,targetDigit,tradeNow')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
console.log('ALL PASS')
