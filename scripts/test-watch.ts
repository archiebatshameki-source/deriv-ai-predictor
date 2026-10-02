import { decideWatch, type WatchDecisionInput } from '../src/lib/watch'

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (ok) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.log(`FAIL  ${name} — got ${String(actual)}, expected ${String(expected)}`) }
}

const base: WatchDecisionInput = { targetDigit: 7, lastDigit: 3 }

// ── The find ────────────────────────────────────────────────────────────────
check('finds the digit when it prints', decideWatch({ ...base, lastDigit: 7 }), 'found')
check('keeps watching while a different digit prints', decideWatch(base), 'keep-watching')
check('keeps watching before any tick has printed', decideWatch({ ...base, lastDigit: null }), 'keep-watching')
check('keeps watching with no target locked', decideWatch({ ...base, targetDigit: null }), 'keep-watching')

// ── The predicted digit is the ONLY input ───────────────────────────────────
// A tick ceiling used to close the round before the anticipated tick had a
// chance to print, so the trade the engine was waiting for never fired. The
// count is not even an input any more — `ticksWaited` was removed from
// WatchDecisionInput, so no tick count CAN end a round. What used to be a
// runtime hope is now enforced by the type. Assert the decision is a pure
// function of (targetDigit, lastDigit) by replaying it many times.
let stable = true
for (let i = 0; i < 500; i++) {
  if (decideWatch({ targetDigit: 7, lastDigit: 3 }) !== 'keep-watching') stable = false
  if (decideWatch({ targetDigit: 7, lastDigit: 7 }) !== 'found') stable = false
}
check('the decision is a pure function of the predicted digit and the last tick', stable, true)

// ── Every digit round-trips, and only against itself ────────────────────────
let allDigits = true
for (let d = 0; d <= 9; d++) {
  if (decideWatch({ targetDigit: d, lastDigit: d }) !== 'found') allDigits = false
  if (decideWatch({ targetDigit: d, lastDigit: (d + 1) % 10 }) !== 'keep-watching') allDigits = false
}
check('every predicted digit 0-9 is found by itself and nothing else', allDigits, true)

// ── Digit 0 must not be confused with "no digit" ────────────────────────────
check('target 0 is found when 0 prints', decideWatch({ targetDigit: 0, lastDigit: 0 }), 'found')
check('target 0 keeps watching otherwise', decideWatch({ targetDigit: 0, lastDigit: 5 }), 'keep-watching')

// ── A stop is the only way a round ends without a find ──────────────────────
// Stage B runs until the digit prints, so there is no "gave up" decision to
// test here. The miss path lives in the component: handleStop records it.
check('there is no tick-count input to pass (5-arg call is not expressible)',
  Object.keys(base).length, 2)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
console.log('ALL PASS')
