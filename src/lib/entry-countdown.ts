/**
 * The post-lock entry countdown: the predicted digit is locked, then 5-4-3-2-1
 * runs down and the contract is placed at zero (TRADE NOW).
 *
 * Pulled out of the component so the timing is testable. An earlier incarnation
 * of this countdown lived only in a `useEffect` and silently froze on "5" —
 * the tick stream re-renders the panel several times a second, and an effect
 * whose dependency array included the parent's callback was torn down and
 * restarted before it could ever elapse. A screenshot of a frozen "5" looks
 * entirely plausible, so the rule needs to be pinned by assertions rather than
 * eyeballed.
 *
 * Everything is derived from a wall-clock deadline, so the displayed number is
 * a pure function of `(deadline, now)` and cannot drift or restart.
 */

/** The fixed length of the entry countdown, in seconds. */
export const ENTRY_SECONDS = 5

/**
 * Seconds remaining, clamped to `0..ENTRY_SECONDS`.
 *
 * `Math.ceil` so the label reads "5" for the first whole second and only shows
 * "1" during the final second — i.e. the number the user sees counts 5,4,3,2,1
 * and then hits zero exactly at the deadline. The clamp means a late interval
 * callback (a throttled background tab, a slow frame) can only ever report 0,
 * never a negative number.
 */
export function secondsLeft(deadline: number, now: number): number {
  const remaining = Math.ceil((deadline - now) / 1000)
  return Math.max(0, Math.min(ENTRY_SECONDS, remaining))
}

/** True once the deadline has passed — the one moment a trade is placed. */
export function isCountdownComplete(deadline: number, now: number): boolean {
  return now >= deadline
}

/** Progress through the countdown as 0..1, for the draining bar. */
export function countdownProgress(deadline: number, now: number): number {
  const left = secondsLeft(deadline, now)
  return Math.max(0, Math.min(1, left / ENTRY_SECONDS))
}

/**
 * The five countdown values in order, for a test or a preview. Useful because
 * "5,4,3,2,1" is the user-visible contract and it should never silently become
 * four steps or six.
 */
export function countdownSequence(deadline: number): number[] {
  const out: number[] = []
  const start = deadline - ENTRY_SECONDS * 1000
  // Sample past the deadline so the terminal 0 is included.
  for (let i = 0; i <= ENTRY_SECONDS * 4 + 8; i++) {
    const value = secondsLeft(deadline, start + i * 250)
    if (out[out.length - 1] !== value) out.push(value)
  }
  return out
}
