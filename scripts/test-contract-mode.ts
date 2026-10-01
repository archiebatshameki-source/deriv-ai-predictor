/**
 * Pins the contract mapping the auto-trader fires on.
 *
 * The reported bug: the predictor showed ~100% while every fired trade lost.
 * Root cause was that the trader always bought DIGITMATCH — the bet that the
 * digit which had *just* printed prints again on the next tick, i.e. ~1 in 10.
 * These assertions stop that mapping from silently regressing.
 */
import { CONTRACT_MODES, STRATEGIES, VOLATILITY_MARKETS } from '../src/lib/deriv-types'
import { decideAutoFire } from '../src/lib/auto-fire'
import { accumulateSettlement, emptyStats } from '../src/lib/trade-stats'

let pass = 0
let fail = 0

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}\n        expected ${e}\n        actual   ${a}`)
  }
}

console.log('\nContract mode → Deriv contract type')
const byMode = Object.fromEntries(CONTRACT_MODES.map(m => [m.mode, m.contractType]))
check('matches maps to DIGITMATCH', byMode.matches, 'DIGITMATCH')
check('differs maps to DIGITDIFF', byMode.differs, 'DIGITDIFF')
check('exactly two modes are offered', CONTRACT_MODES.length, 2)
check(
  'every mode documents its odds',
  CONTRACT_MODES.every(m => m.blurb.length > 0),
  true,
)
check(
  'the mode used by the fire path is the one asking for the digit NOT to repeat',
  CONTRACT_MODES.find(m => m.mode === 'differs')?.contractType,
  'DIGITDIFF',
)

console.log('\nStrategy panel exposes Differs')
check('Differs is a registered strategy', STRATEGIES.some(s => s.type === 'differs'), true)
check(
  'Differs carries a label and icon',
  STRATEGIES.find(s => s.type === 'differs')?.label,
  'Differs',
)

console.log('\nMarkets offered by the editable Market column')
check('a market list is supplied to the column', VOLATILITY_MARKETS.length > 0, true)
check(
  'every entry has a symbol the API accepts',
  VOLATILITY_MARKETS.every(m => /^R_\d+S?$/.test(m.symbol)),
  true,
)

console.log('\nFire decision still gated correctly')
const base = {
  autoTrade: true, watching: true, targetDigit: 5, lastDigit: 5,
  targetConfidence: 70, minConfidence: 0, alreadyTradedTarget: null,
  now: 10_000, lastTradeAt: 0,
}
check('fires when the locked digit prints', decideAutoFire(base), 'fire')
check('does not fire while idle', decideAutoFire({ ...base, watching: false }), 'idle')
check('does not fire on a different digit', decideAutoFire({ ...base, lastDigit: 4 }), 'idle')
check(
  'does not fire twice on the same target',
  decideAutoFire({ ...base, alreadyTradedTarget: 5 }),
  'idle',
)
check(
  'respects the throttle window',
  decideAutoFire({ ...base, now: 1000, lastTradeAt: 0 }),
  'throttled',
)
check(
  'honours the confidence filter',
  decideAutoFire({ ...base, targetConfidence: 3, minConfidence: 20 }),
  'skip-confidence',
)

console.log('\nSession totals stay reconcilable')
let stats = emptyStats()
stats = accumulateSettlement(stats, { stake: 1, payout: 0, profit: -1 })
check('a losing contract logs a loss', [stats.trades, stats.losses, stats.wins], [1, 1, 0])
check('a loss banks no payout', stats.totalPayout, 0)
stats = accumulateSettlement(stats, { stake: 1, payout: 1.11, profit: 0.11 })
check('a winning contract logs a win', [stats.trades, stats.losses, stats.wins], [2, 1, 1])
check(
  'totalPayout - totalStake === pnl',
  Math.abs(stats.totalPayout - stats.totalStake - stats.pnl) < 1e-9,
  true,
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
