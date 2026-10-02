/**
 * The Stage B watch decision, pulled out of the component so it can be tested
 * without a live tick stream.
 *
 * The rule is deliberately ONE condition, and the only input that matters is
 * the predicted digit: has the digit Stage A picked turned up on a real tick?
 *
 * There is no tick counter here and no tick ceiling. An earlier version capped
 * the wait at a fixed number of ticks and closed the round as a miss, which is
 * exactly what stopped the auto trader from firing on a slow digit: the signal
 * for the digit the engine was actually waiting on never reached it. Waiting is
 * unbounded by design — a fair digit stream expects roughly 1 hit in 10 per
 * tick, so the chance of never seeing the digit collapses quickly
 * (0.9^100 ≈ 0.0027%), while a cap silently converts "not yet" into "give up".
 */

export type WatchDecision = 'keep-watching' | 'found'

export type WatchDecisionInput = {
  /** The digit Stage A predicted. The only thing Stage B watches for. */
  targetDigit: number | null
  lastDigit: number | null
}

export function decideWatch(input: WatchDecisionInput): WatchDecision {
  const { targetDigit, lastDigit } = input

  if (targetDigit == null) return 'keep-watching'
  if (lastDigit == null) return 'keep-watching'
  return lastDigit === targetDigit ? 'found' : 'keep-watching'
}
