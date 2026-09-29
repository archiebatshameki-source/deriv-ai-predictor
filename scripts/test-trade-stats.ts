/**
 * Verifies the trade-stat columns' accounting.
 *
 * The headline invariant is `totalPayout - totalStake === pnl`: a win adds its
 * payout, a loss adds nothing, and every trade adds its stake — so the
 * difference is exactly the summed profit. If that ever drifts, the Total
 * stake / Total payout / Total P/L columns disagree with each other on screen.
 *
 * Run: bun run scripts/test-trade-stats.ts
 */
import { accumulateSettlement, emptyStats, type AutoTradeStats } from '../src/lib/trade-stats'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const run = (trades: Array<{ stake: number; payout: number; won: boolean }>): AutoTradeStats =>
  trades.reduce(
    (acc, t) =>
      accumulateSettlement(acc, {
        stake: t.stake,
        payout: t.payout,
        // A win returns payout − stake; a loss returns −stake.
        profit: t.won ? t.payout - t.stake : -t.stake,
      }),
    emptyStats()
  )

// ── Empty session ──────────────────────────────────────────────────────────
const zero = emptyStats()
check('empty session starts at zero', Object.values(zero).every(v => v === 0))

// ── One win: 1.00 stake, 8.93 payout ───────────────────────────────────────
const oneWin = run([{ stake: 1, payout: 8.93, won: true }])
check('single win — runs', oneWin.trades === 1, `trades=${oneWin.trades}`)
check('single win — won', oneWin.wins === 1 && oneWin.losses === 0)
check('single win — total stake', Math.abs(oneWin.totalStake - 1) < 1e-9, `${oneWin.totalStake}`)
check('single win — total payout', Math.abs(oneWin.totalPayout - 8.93) < 1e-9, `${oneWin.totalPayout}`)
check('single win — pnl', Math.abs(oneWin.pnl - 7.93) < 1e-9, `${oneWin.pnl}`)

// ── One loss: the payout must NOT be banked ────────────────────────────────
const oneLoss = run([{ stake: 1, payout: 8.93, won: false }])
check('single loss — lost count', oneLoss.losses === 1 && oneLoss.wins === 0)
check('single loss — payout stays 0', oneLoss.totalPayout === 0, `${oneLoss.totalPayout}`)
check('single loss — pnl is -stake', Math.abs(oneLoss.pnl + 1) < 1e-9, `${oneLoss.pnl}`)

// ── Mixed session, including a fractional stake ────────────────────────────
const mixed = run([
  { stake: 1, payout: 8.93, won: true },
  { stake: 0.35, payout: 3.12, won: true },
  { stake: 2, payout: 17.9, won: false },
  { stake: 5, payout: 44.8, won: true },
])
check('mixed — runs', mixed.trades === 4, `${mixed.trades}`)
check('mixed — won', mixed.wins === 3, `${mixed.wins}`)
check('mixed — lost', mixed.losses === 1, `${mixed.losses}`)
check('mixed — total stake sums every trade', Math.abs(mixed.totalStake - 8.35) < 1e-9, `${mixed.totalStake}`)
check('mixed — total payout sums wins only', Math.abs(mixed.totalPayout - 56.85) < 1e-9, `${mixed.totalPayout}`)

// ── The invariant the UI depends on ────────────────────────────────────────
for (const [name, s] of [['one win', oneWin], ['one loss', oneLoss], ['mixed', mixed]] as const) {
  check(
    `${name} — payout − stake reconciles with P/L`,
    Math.abs(s.totalPayout - s.totalStake - s.pnl) < 1e-9,
    `${s.totalPayout} - ${s.totalStake} = ${(s.totalPayout - s.totalStake).toFixed(2)} vs ${s.pnl.toFixed(2)}`
  )
  check(
    `${name} — won + lost === runs`,
    s.wins + s.losses === s.trades,
    `${s.wins}+${s.losses} vs ${s.trades}`
  )
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
