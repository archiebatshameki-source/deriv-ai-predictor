import { cn } from '../lib/cn'
import {
  Coins, Target, ShieldAlert, Globe2, OctagonX, Layers,
  Banknote, Repeat, XCircle, CheckCircle2, Scale,
} from 'lucide-react'

type Props = {
  currency: string
  /** Per-trade stake. */
  stake: number
  /** Session profit target — auto trading stops once P/L reaches it. */
  profitTarget: number
  /** Per-trade risk. For a digit contract the most you can lose is the stake. */
  risk: number
  /** Selected market symbol, e.g. R_10. */
  market: string
  /** Session stop-loss — auto trading stops once P/L falls this far. */
  maxLoss: number
  totalStake: number
  totalPayout: number
  runs: number
  lost: number
  won: number
  pnl: number
  active: boolean
}

function money(value: number, currency: string): string {
  const sign = value < 0 ? '-' : ''
  return `${sign}${Math.abs(value).toFixed(2)} ${currency}`
}

function Column({
  label, value, icon, tone, hint,
}: {
  label: string
  value: string
  icon: React.ReactNode
  tone: string
  hint?: string
}) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-700 bg-gray-800/40 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-gray-400">
        <span className={cn('shrink-0', tone)}>{icon}</span>
        <span className="min-w-0 leading-tight">{label}</span>
      </div>
      <div className={cn('mt-1 text-[13px] font-mono font-bold tabular-nums break-words', tone)}>
        {value}
      </div>
      {hint && <div className="text-[9px] text-gray-500 mt-0.5">{hint}</div>}
    </div>
  )
}

export function TradeStatsTable({
  currency, stake, profitTarget, risk, market, maxLoss,
  totalStake, totalPayout, runs, lost, won, pnl, active,
}: Props) {
  const pnlTone = pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-red-400' : 'text-gray-300'
  const net = totalPayout - totalStake

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Layers className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
          Trade columns
        </span>
        <span className="ml-auto text-[10px] font-mono text-gray-500">
          {active ? 'session live' : 'session idle'}
        </span>
      </div>

      {/* Trade setup */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
        <Column
          label="Stake"
          value={money(stake, currency)}
          icon={<Coins className="w-3 h-3" />}
          tone="text-emerald-400"
          hint="per trade"
        />
        <Column
          label="Profit target"
          value={money(profitTarget, currency)}
          icon={<Target className="w-3 h-3" />}
          tone="text-blue-400"
          hint="session stop"
        />
        <Column
          label="Risk"
          value={money(risk, currency)}
          icon={<ShieldAlert className="w-3 h-3" />}
          tone="text-amber-400"
          hint="max loss / trade"
        />
        <Column
          label="Market"
          value={market}
          icon={<Globe2 className="w-3 h-3" />}
          tone="text-violet-400"
          hint="underlying"
        />
        <Column
          label="Max loss"
          value={money(maxLoss, currency)}
          icon={<OctagonX className="w-3 h-3" />}
          tone="text-red-400"
          hint="session stop"
        />
      </div>

      {/* Session totals */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
        <Column
          label="Total stake"
          value={money(totalStake, currency)}
          icon={<Coins className="w-3 h-3" />}
          tone="text-gray-200"
        />
        <Column
          label="Total payout"
          value={money(totalPayout, currency)}
          icon={<Banknote className="w-3 h-3" />}
          tone="text-emerald-400"
          hint="won contracts"
        />
        <Column
          label="No. of runs"
          value={runs.toString()}
          icon={<Repeat className="w-3 h-3" />}
          tone="text-gray-200"
        />
        <Column
          label="Contract lost"
          value={lost.toString()}
          icon={<XCircle className="w-3 h-3" />}
          tone="text-red-400"
        />
        <Column
          label="Contract won"
          value={won.toString()}
          icon={<CheckCircle2 className="w-3 h-3" />}
          tone="text-emerald-400"
        />
        <Column
          label="Total P/L"
          value={`${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ${currency}`}
          icon={<Scale className="w-3 h-3" />}
          tone={pnlTone}
        />
      </div>

      {/* Internal consistency: payouts minus stakes must equal the summed P/L. */}
      {runs > 0 && Math.abs(net - pnl) > 0.01 && (
        <p className="text-[9px] text-amber-400 font-mono">
          Reconciling — payout {net.toFixed(2)} vs P/L {pnl.toFixed(2)} (a contract may still be open)
        </p>
      )}
    </div>
  )
}
