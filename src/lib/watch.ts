/**
 * The Stage B watch decision, pulled out of the component so it can be tested
 * without a live tick stream.
 *
 * The rule is deliberately ONE condition: has the anticipated tick — the digit
 * Stage A locked — turned up yet? Nothing else may end a round.
 *
 * `ticksWaited` is carried in the input because callers have it to hand and it
 * is useful telemetry, but it is NOT consulted here. A tick-count ceiling is
 * exactly what used to break the auto trader: a round that did not match inside
 * WATCH_WINDOW_TICKS ticks was closed as a miss and a brand new digit was
 * locked, so the trade for the digit the engine was actually waiting on never
 * fired. Waiting is unbounded by design — a fair digit stream expects roughly 1
 * hit in 10 per tick, so the chance of never seeing the digit collapses quickly
 * (0.9^100 ≈ 0.0027%), while a cap silently converts "not yet" into "give up".
 */

export type WatchDecision = 'keep-watching' | 'found'

export type WatchDecisionInput = {
  targetDigit: number | null
  lastDigit: number | null
  /** Telemetry only — never part of the decision. */
  ticksWaited: number
}

export function decideWatch(input: WatchDecisionInput): WatchDecision {
  const { targetDigit, lastDigit } = input

  if (targetDigit == null) return 'keep-watching'
  if (lastDigit == null) return 'keep-watching'
  return lastDigit === targetDigit ? 'found' : 'keep-watching'
}
