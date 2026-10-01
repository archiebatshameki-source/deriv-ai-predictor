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
  watching: true,
  targetDigit: 7,
  lastDigit: 7,
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

// ── The trigger ─────────────────────────────────────────────────────────────
check('fires when the locked digit prints', decideAutoFire(base), 'fire')
check('waits while a different digit prints',
  decideAutoFire({ ...base, lastDigit: 3 }), 'idle')
check('waits before the digit has printed at all',
  decideAutoFire({ ...base, lastDigit: null }), 'idle')
check('waits when Stage B has not started',
  decideAutoFire({ ...base, watching: false }), 'idle')
check('waits when auto trade is off',
  decideAutoFire({ ...base, autoTrade: false }), 'idle')

// ── One trade per printed digit ─────────────────────────────────────────────
check('does not re-fire on the same target',
  decideAutoFire({ ...base, alreadyTradedTarget: 7 }), 'idle')
check('a new target is tradeable again',
  decideAutoFire({ ...base, targetDigit: 4, lastDigit: 4, alreadyTradedTarget: 7 }), 'fire')

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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
console.log('ALL PASS')
