import { cn } from '../lib/cn'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Coins, Target, ShieldAlert, Globe2, OctagonX, Layers,
  Banknote, Repeat, XCircle, CheckCircle2, Scale, Pencil,
} from 'lucide-react'
import type { MarketSymbol } from '../lib/deriv-types'

/** Every editable column, so the dashboard can route a commit to the right field. */
export type StatField =
  | 'stake' | 'profitTarget' | 'risk' | 'market' | 'maxLoss'
  | 'totalStake' | 'totalPayout' | 'runs' | 'lost' | 'won' | 'pnl'

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
  /** When supplied, every column becomes an input that commits into session state. */
  onEdit?: (field: StatField, value: string) => void
  /** Symbols offered by the Market column. */
  markets?: MarketSymbol[]
}

function money(value: number, currency: string): string {
  const sign = value < 0 ? '-' : ''
  return `${sign}${Math.abs(value).toFixed(2)} ${currency}`
}

function Shell({
  label, icon, tone, hint, children,
}: {
  label: string
  icon: React.ReactNode
  tone: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-700 bg-gray-800/40 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-gray-400">
        <span className={cn('shrink-0', tone)}>{icon}</span>
        <span className="min-w-0 leading-tight">{label}</span>
      </div>
      {children}
      {hint && <div className="text-[9px] text-gray-500 mt-0.5">{hint}</div>}
    </div>
  )
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
    <Shell label={label} icon={icon} tone={tone} hint={hint}>
      <div className={cn('mt-1 text-[13px] font-mono font-bold tabular-nums break-words', tone)}>
        {value}
      </div>
    </Shell>
  )
}

/**
 * Uncontrolled on purpose: committing on blur instead of on every keystroke
 * means formatting can never fight the user mid-entry (typing "1." or clearing
 * the box stays intact). The `key` carries the current value so an update from
 * elsewhere — a settlement, or another panel — still refreshes the field.
 *
 * The unit lives in the label rather than beside the box: shadcn's Input is
 * `w-full`, so a sibling suffix gets pushed out and clipped.
 */
function EditableNumber({
  label, icon, tone, hint, value, step, suffix, onCommit,
}: {
  label: string
  icon: React.ReactNode
  tone: string
  hint?: string
  value: number
  step: number
  suffix: string
  onCommit: (raw: string) => void
}) {
  return (
    <Shell label={suffix ? `${label} (${suffix})` : label} icon={icon} tone={tone} hint={hint}>
      <Input
        key={`${label}-${value}`}
        type="number"
        step={step}
        defaultValue={value}
        onBlur={e => {
          if (e.target.value !== String(value)) onCommit(e.target.value)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className="mt-1 h-7 px-1.5 text-[12px] font-mono font-bold tabular-nums rounded-md border-gray-600 bg-[#0c0c16] text-gray-100 focus-visible:ring-1 focus-visible:ring-emerald-500"
      />
    </Shell>
  )
}

function EditableMarket({
  value, markets, onCommit,
}: {
  value: string
  markets: MarketSymbol[]
  onCommit: (raw: string) => void
}) {
  return (
    <Shell label="Market" icon={<Globe2 className="w-3 h-3" />} tone="text-violet-400" hint="underlying">
      <div className="mt-1">
        <Select value={value} onValueChange={onCommit}>
          <SelectTrigger className="h-7 px-1.5 text-[12px] font-mono font-bold rounded-md border-gray-600 bg-[#0c0c16] text-violet-300 focus:ring-1 focus:ring-emerald-500">
            <SelectValue placeholder={value} />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {markets.map(m => (
              <SelectItem key={m.symbol} value={m.symbol} className="font-mono text-xs">
                {m.symbol} — {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Shell>
  )
}

export function TradeStatsTable({
  currency, stake, profitTarget, risk, market, maxLoss,
  totalStake, totalPayout, runs, lost, won, pnl, active, onEdit, markets = [],
}: Props) {
  const pnlTone = pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-red-400' : 'text-gray-300'
  const net = totalPayout - totalStake
  const editing = Boolean(onEdit)

  /** Money columns commit as a number; counts as an integer. */
  const num = (field: StatField) => (raw: string) => onEdit?.(field, raw)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Layers className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
          Trade columns
        </span>
        {editing && (
          <span className="flex items-center gap-1 text-[9px] text-emerald-400/80">
            <Pencil className="w-2.5 h-2.5" /> editable
          </span>
        )}
        <span className="ml-auto text-[10px] font-mono text-gray-500">
          {active ? 'session live' : 'session idle'}
        </span>
      </div>

      {/* Trade setup */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
        {editing ? (
          <>
            <EditableNumber label="Stake" icon={<Coins className="w-3 h-3" />} tone="text-emerald-400"
              hint="per trade" value={stake} step={0.01} suffix={currency} onCommit={num('stake')} />
            <EditableNumber label="Profit target" icon={<Target className="w-3 h-3" />} tone="text-blue-400"
              hint="session stop" value={profitTarget} step={1} suffix={currency} onCommit={num('profitTarget')} />
            <EditableNumber label="Risk" icon={<ShieldAlert className="w-3 h-3" />} tone="text-amber-400"
              hint="max loss / trade" value={risk} step={0.01} suffix={currency} onCommit={num('risk')} />
            <EditableMarket value={market} markets={markets} onCommit={num('market')} />
            <EditableNumber label="Max loss" icon={<OctagonX className="w-3 h-3" />} tone="text-red-400"
              hint="session stop" value={maxLoss} step={1} suffix={currency} onCommit={num('maxLoss')} />
          </>
        ) : (
          <>
            <Column label="Stake" value={money(stake, currency)} icon={<Coins className="w-3 h-3" />}
              tone="text-emerald-400" hint="per trade" />
            <Column label="Profit target" value={money(profitTarget, currency)} icon={<Target className="w-3 h-3" />}
              tone="text-blue-400" hint="session stop" />
            <Column label="Risk" value={money(risk, currency)} icon={<ShieldAlert className="w-3 h-3" />}
              tone="text-amber-400" hint="max loss / trade" />
            <Column label="Market" value={market} icon={<Globe2 className="w-3 h-3" />}
              tone="text-violet-400" hint="underlying" />
            <Column label="Max loss" value={money(maxLoss, currency)} icon={<OctagonX className="w-3 h-3" />}
              tone="text-red-400" hint="session stop" />
          </>
        )}
      </div>

      {/* Session totals */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
        {editing ? (
          <>
            <EditableNumber label="Total stake" icon={<Coins className="w-3 h-3" />} tone="text-gray-200"
              value={totalStake} step={0.01} suffix={currency} onCommit={num('totalStake')} />
            <EditableNumber label="Total payout" icon={<Banknote className="w-3 h-3" />} tone="text-emerald-400"
              hint="won contracts" value={totalPayout} step={0.01} suffix={currency} onCommit={num('totalPayout')} />
            <EditableNumber label="No. of runs" icon={<Repeat className="w-3 h-3" />} tone="text-gray-200"
              value={runs} step={1} suffix="" onCommit={num('runs')} />
            <EditableNumber label="Contract lost" icon={<XCircle className="w-3 h-3" />} tone="text-red-400"
              value={lost} step={1} suffix="" onCommit={num('lost')} />
            <EditableNumber label="Contract won" icon={<CheckCircle2 className="w-3 h-3" />} tone="text-emerald-400"
              value={won} step={1} suffix="" onCommit={num('won')} />
            <EditableNumber label="Total P/L" icon={<Scale className="w-3 h-3" />} tone={pnlTone}
              value={pnl} step={0.01} suffix={currency} onCommit={num('pnl')} />
          </>
        ) : (
          <>
            <Column label="Total stake" value={money(totalStake, currency)} icon={<Coins className="w-3 h-3" />}
              tone="text-gray-200" />
            <Column label="Total payout" value={money(totalPayout, currency)} icon={<Banknote className="w-3 h-3" />}
              tone="text-emerald-400" hint="won contracts" />
            <Column label="No. of runs" value={runs.toString()} icon={<Repeat className="w-3 h-3" />}
              tone="text-gray-200" />
            <Column label="Contract lost" value={lost.toString()} icon={<XCircle className="w-3 h-3" />}
              tone="text-red-400" />
            <Column label="Contract won" value={won.toString()} icon={<CheckCircle2 className="w-3 h-3" />}
              tone="text-emerald-400" />
            <Column label="Total P/L" value={`${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ${currency}`}
              icon={<Scale className="w-3 h-3" />} tone={pnlTone} />
          </>
        )}
      </div>

      {/* Internal consistency: payouts minus stakes must equal the summed P/L. */}
      {runs > 0 && Math.abs(net - pnl) > 0.01 && (
        <p className="text-[9px] text-amber-400 font-mono">
          Reconciling — payout {net.toFixed(2)} vs P/L {pnl.toFixed(2)} (a contract may still be open, or a column was edited by hand)
        </p>
      )}
    </div>
  )
}
