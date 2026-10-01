/**
 * The auto-trade fire decision, pulled out of the dashboard effect so it can be
 * tested without a live Deriv socket.
 *
 * The trigger is deliberately the *appearance* of the digit Stage A locked:
 * the Matches engine picked it, and Stage B has now confirmed it on a real
 * tick. That is the genuine signal. The only thing that may stop it is the
 * user's own confidence filter.
 */

export type FireDecision = 'idle' | 'throttled' | 'skip-confidence' | 'fire'

export type FireDecisionInput = {
  autoTrade: boolean
  watching: boolean
  targetDigit: number | null
  lastDigit: number | null
  targetConfidence: number
  minConfidence: number
  alreadyTradedTarget: number | null
  now: number
  lastTradeAt: number
  /** One contract at a time; avoids double-firing on the same printed digit. */
  throttleMs?: number
}

export const DEFAULT_FIRE_THROTTLE_MS = 8000

export function decideAutoFire(input: FireDecisionInput): FireDecision {
  const {
    autoTrade, watching, targetDigit, lastDigit, targetConfidence,
    minConfidence, alreadyTradedTarget, now, lastTradeAt,
    throttleMs = DEFAULT_FIRE_THROTTLE_MS,
  } = input

  if (!autoTrade || !watching) return 'idle'
  if (targetDigit == null || lastDigit !== targetDigit) return 'idle'
  if (alreadyTradedTarget === targetDigit) return 'idle'
  if (now - lastTradeAt < throttleMs) return 'throttled'
  if (targetConfidence < minConfidence) return 'skip-confidence'
  return 'fire'
}
