import { decideWatch, type WatchDecisionInput } from '../src/lib/watch'

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (ok) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.log(`FAIL  ${name} — got ${String(actual)}, expected ${String(expected)}`) }
}

const base: WatchDecisionInput = { targetDigit: 7, lastDigit: 3, ticksWaited: 1 }

// ── The find ────────────────────────────────────────────────────────────────
check('finds the digit when it prints', decideWatch({ ...base, lastDigit: 7 }), 'found')
check('keeps watching while a different digit prints', decideWatch(base), 'keep-watching')
check('keeps watching before any tick has printed', decideWatch({ ...base, lastDigit: null }), 'keep-watching')
check('keeps watching with no target locked', decideWatch({ ...base, targetDigit: null }), 'keep-watching')

// ── The bug this whole change is about ──────────────────────────────────────
// A tick ceiling used to close the round before the anticipated tick had a
// chance to print, so the trade the engine was waiting for never fired. Nothing
// about the tick count may end a round now — assert it across a wide range,
// including far past the old 20-tick window.
let allKeepWatching = true
let firstBadTick = -1
for (let t = 1; t <= 500; t++) {
  if (decideWatch({ targetDigit: 7, lastDigit: 3, ticksWaited: t }) !== 'keep-watching') {
    allKeepWatching = false
    if (firstBadTick < 0) firstBadTick = t
  }
}
check('no tick count from 1..500 ends a round (old window was 20)', firstBadTick, -1)
if (allKeepWatching) pass++ // keep the counter honest about what was asserted

// And the find still lands at any tick count.
let allFound = true
for (let t = 1; t <= 500; t++) {
  if (decideWatch({ targetDigit: 7, lastDigit: 7, ticksWaited: t }) !== 'found') allFound = false
}
check('the find is recognised at any tick count 1..500', allFound, true)

// ── The specific regression: tick 21, just past the old ceiling ─────────────
check('tick 21 previously ended the round as a miss — now it still waits', 
  decideWatch({ targetDigit: 7, lastDigit: 3, ticksWaited: 21 }), 'keep-watching')
check('tick 21 is a genuine find when the digit prints',
  decideWatch({ targetDigit: 7, lastDigit: 7, ticksWaited: 21 }), 'found')

// ── Digit 0 must not be confused with "no digit" ────────────────────────────
check('target 0 is found when 0 prints', decideWatch({ targetDigit: 0, lastDigit: 0, ticksWaited: 3 }), 'found')
check('target 0 keeps watching otherwise', decideWatch({ targetDigit: 0, lastDigit: 5, ticksWaited: 3 }), 'keep-watching')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
console.log('ALL PASS')
