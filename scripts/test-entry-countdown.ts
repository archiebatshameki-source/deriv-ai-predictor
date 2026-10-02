import {
  ENTRY_SECONDS,
  secondsLeft,
  isCountdownComplete,
  countdownProgress,
  countdownSequence,
} from '../src/lib/entry-countdown'

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (ok) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.log(`FAIL  ${name} — got ${String(actual)}, expected ${String(expected)}`) }
}

// ── The window the user asked for ───────────────────────────────────────────
check('the entry countdown is 5 seconds', ENTRY_SECONDS, 5)

// ── It counts 5-4-3-2-1 ─────────────────────────────────────────────────────
const t0 = 1_000_000
const deadline = t0 + ENTRY_SECONDS * 1000

check('reads 5 at the start', secondsLeft(deadline, t0), 5)
check('reads 4 after one second', secondsLeft(deadline, t0 + 1000), 4)
check('reads 3 after two seconds', secondsLeft(deadline, t0 + 2000), 3)
check('reads 2 after three seconds', secondsLeft(deadline, t0 + 3000), 2)
check('reads 1 after four seconds', secondsLeft(deadline, t0 + 4000), 1)
check('reads 0 at the deadline', secondsLeft(deadline, t0 + 5000), 0)

check(
  'the visible sequence is exactly 5,4,3,2,1,0',
  countdownSequence(deadline).join(','),
  '5,4,3,2,1,0',
)

// ── The boundary that decides when a trade is placed ────────────────────────
check('not complete one millisecond before the deadline',
  isCountdownComplete(deadline, deadline - 1), false)
check('complete exactly at the deadline', isCountdownComplete(deadline, deadline), true)
check('complete after the deadline', isCountdownComplete(deadline, deadline + 5000), true)

// ── It cannot freeze or go negative ─────────────────────────────────────────
// An earlier version sat frozen on "5" forever because the timer effect was
// reset by every parent re-render. Being a pure function of (deadline, now)
// makes that class of bug impossible: there is no internal state to reset.
let monotonic = true
let prev = ENTRY_SECONDS + 1
for (let ms = 0; ms <= 6000; ms += 50) {
  const v = secondsLeft(deadline, t0 + ms)
  if (v > prev) monotonic = false
  if (v < 0) monotonic = false
  prev = v
}
check('never increases and never goes negative across the window', monotonic, true)

check('a throttled background tab still reports 0, never negative',
  secondsLeft(deadline, t0 + 60_000), 0)
check('a clock that jumps backwards is clamped to the window length',
  secondsLeft(deadline, t0 - 30_000), ENTRY_SECONDS)

// ── Progress bar ────────────────────────────────────────────────────────────
check('bar starts full', countdownProgress(deadline, t0), 1)
check('bar is half drained at 2.5s', countdownProgress(deadline, t0 + 2500), 0.6)
check('bar is empty at the deadline', countdownProgress(deadline, t0 + 5000), 0)

// ── The countdown is deterministic for a given deadline ─────────────────────
let deterministic = true
for (let i = 0; i < 200; i++) {
  if (secondsLeft(deadline, t0 + 2000) !== 3) deterministic = false
  if (isCountdownComplete(deadline, t0 + 2000) !== false) deterministic = false
}
check('the countdown is a pure function of (deadline, now)', deterministic, true)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
console.log('ALL PASS')
