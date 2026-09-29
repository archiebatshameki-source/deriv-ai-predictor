/**
 * Settlement accounting for the trade-stat columns.
 *
 * Kept pure and outside React so the numbers can be verified without a live
 * account — see scripts/test-trade-stats.ts.
 */

export type AutoTradeStats = {
  trades: number
  wins: number
  losses: number
  pnl: number
  /** Sum of every stake committed this session. */
  totalStake: number
  /** Sum of payouts actually received (won contracts only). */
  totalPayout: number
}

export type Settlement = {
  /** What the contract actually cost. */
  stake: number
  /** The contract's payout. Only counted when the contract wins. */
  payout: number
  /** Realised profit: payout − stake on a win, −stake on a loss. */
  profit: number
}

export function emptyStats(): AutoTradeStats {
  return { trades: 0, wins: 0, losses: 0, pnl: 0, totalStake: 0, totalPayout: 0 }
}

/**
 * Folds one settled contract into the running session totals.
 *
 * Invariant: `totalPayout - totalStake === pnl`, because a win contributes
 * `payout` and a loss contributes nothing, while every trade contributes its
 * stake — so the difference is exactly the summed profit.
 */
export function accumulateSettlement(prev: AutoTradeStats, s: Settlement): AutoTradeStats {
  const won = s.profit > 0
  return {
    trades: prev.trades + 1,
    wins: prev.wins + (won ? 1 : 0),
    losses: prev.losses + (won ? 0 : 1),
    pnl: prev.pnl + s.profit,
    totalStake: prev.totalStake + s.stake,
    totalPayout: prev.totalPayout + (won ? s.payout : 0),
  }
}
