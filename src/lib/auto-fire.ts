/**
 * The auto-trade fire decision, pulled out of the dashboard effect so it can be
 * tested without a live Deriv socket.
 *
 * The trigger is deliberately the engine's own TRADE NOW hand-off: Stage A has
 * locked the predicted digit and the post-lock entry countdown (5-4-3-2-1) has
 * run out. The predicted digit is the entire contract signal — the tick stream
 * is never consulted here, so no tick count can decide whether a signal gets
 * taken. The only thing that may stop it is the user's own confidence filter.
 */

export type FireDecision = 'idle' | 'throttled' | 'skip-confidence' | 'fire'

export type FireDecisionInput = {
  autoTrade: boolean
  /** The engine's TRADE NOW hand-off — the post-lock entry countdown finished. */
  tradeNow: boolean
  /** The digit Stage A predicted. Also the digit the contract is placed on. */
  targetDigit: number | null
  targetConfidence: number
  minConfidence: number
  alreadyTradedTarget: number | null
  now: number
  lastTradeAt: number
  /** One contract at a time; avoids double-firing within the same round. */
  throttleMs?: number
}

/**
 * Burst guard only.
 *
 * `alreadyTradedTarget` already guarantees one trade per round, so this exists
 * only to absorb the handful of re-renders a single TRADE NOW hand-off
 * produces. It must stay well under the shortest possible round (Stage A's 10
 * ticks plus the entry countdown) — at the old 8s it could swallow the next
 * genuine signal outright, which is the same class of bug as the tick ceiling:
 * a real signal that never became a trade.
 */
export const DEFAULT_FIRE_THROTTLE_MS = 1200

export function decideAutoFire(input: FireDecisionInput): FireDecision {
  const {
    autoTrade, tradeNow, targetDigit, targetConfidence,
    minConfidence, alreadyTradedTarget, now, lastTradeAt,
    throttleMs = DEFAULT_FIRE_THROTTLE_MS,
  } = input

  if (!autoTrade || !tradeNow) return 'idle'
  if (targetDigit == null) return 'idle'
  if (alreadyTradedTarget === targetDigit) return 'idle'
  if (now - lastTradeAt < throttleMs) return 'throttled'
  if (targetConfidence < minConfidence) return 'skip-confidence'
  return 'fire'
}
