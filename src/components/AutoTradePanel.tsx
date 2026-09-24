import { cn } from '../lib/cn'
import type { DerivSession } from '../lib/deriv-api'
import {
  Bot, Play, Square, Loader2, Target, Trophy, AlertTriangle,
  CheckCircle2, XCircle, Info, Zap,
} from 'lucide-react'

export type AutoTradeLogKind = 'info' | 'signal' | 'trade' | 'win' | 'loss' | 'error'

export type AutoTradeLogEntry = {
  id: number
  time: number
  kind: AutoTradeLogKind
  text: string
}

export type AutoTradeStats = {
  trades: number
  wins: number
  losses: number
  pnl: number
}

type Props = {
  session: DerivSession
  active: boolean
  onToggle: () => void
  stake: number
  onStakeChange: (stake: number) => void
  minConfidence: number
  onMinConfidenceChange: (value: number) => void
  log: AutoTradeLogEntry[]
  stats: AutoTradeStats
  targetDigit: number | null
  targetConfidence: number
  watching: boolean
  streamLive: boolean
}

const STAKES = [0.35, 1, 2, 5, 10]
const CONFIDENCE_STEPS = [5, 10, 15, 20, 25]

const LOG_STYLE: Record<AutoTradeLogKind, { icon: React.ReactNode; className: string }> = {
  info: { icon: <Info className="w-3 h-3" />, className: 'text-gray-400' },
  signal: { icon: <Target className="w-3 h-3" />, className: 'text-violet-400' },
  trade: { icon: <Zap className="w-3 h-3" />, className: 'text-blue-400' },
  win: { icon: <CheckCircle2 className="w-3 h-3" />, className: 'text-emerald-400' },
  loss: { icon: <XCircle className="w-3 h-3" />, className: 'text-red-400' },
  error: { icon: <AlertTriangle className="w-3 h-3" />, className: 'text-amber-400' },
}

function stamp(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour12: false })
}

export function AutoTradePanel({
  session, active, onToggle, stake, onStakeChange, minConfidence, onMinConfidenceChange,
  log, stats, targetDigit, targetConfidence, watching, streamLive,
}: Props) {
  const winRate = stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0

  return (
    <div className="bg-[#1a1a2e] rounded-xl border border-gray-700 p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <Bot className={cn('w-4 h-4', active ? 'text-emerald-500' : 'text-gray-500')} />
        <span className="text-sm font-medium text-gray-300">Auto Trade</span>
        <span className="text-[10px] text-gray-500 ml-auto">Matches strategy</span>
      </div>

      {/* Primary one-click activation */}
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-xs transition-all border',
          active
            ? 'bg-amber-500/10 border-amber-500/40 text-amber-300 hover:bg-amber-500/20'
            : 'bg-gradient-to-r from-emerald-600 to-green-600 border-transparent text-white hover:from-emerald-500 hover:to-green-500 shadow-lg shadow-green-600/20'
        )}
      >
        {active ? (
          <>
            <Square className="w-3.5 h-3.5" />
            STOP AUTO TRADE — MATCHES
          </>
        ) : (
          <>
            <Play className="w-3.5 h-3.5" />
            ACTIVATE AUTO TRADE — MATCHES
          </>
        )}
      </button>

      {active && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2">
          <Target className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="min-w-0 text-[11px] leading-relaxed">
            {watching && targetDigit != null ? (
              <>
                <span className="text-emerald-300 font-medium">
                  Watching for digit {targetDigit}
                </span>
                <span className="text-gray-500"> · {targetConfidence.toFixed(1)}% confidence</span>
                <span className="block text-gray-500">
                  A {session.isVirtual ? 'demo' : 'live'} DIGITMATCH trade fires the moment it appears.
                </span>
              </>
            ) : (
              <span className="text-gray-400">
                Running the Matches engine — collecting samples and locking a target digit…
              </span>
            )}
          </div>
        </div>
      )}

      {/* Settings */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Stake ({session.currency})</div>
          <div className="flex flex-wrap gap-1">
            {STAKES.map(s => (
              <button
                key={s}
                onClick={() => onStakeChange(s)}
                className={cn(
                  'px-2 py-1 rounded-md text-[11px] font-mono border transition-all',
                  stake === s
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:bg-gray-700/60'
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
            Min confidence: {minConfidence}%
          </div>
          <div className="flex flex-wrap gap-1">
            {CONFIDENCE_STEPS.map(c => (
              <button
                key={c}
                onClick={() => onMinConfidenceChange(c)}
                className={cn(
                  'px-2 py-1 rounded-md text-[11px] font-mono border transition-all',
                  minConfidence === c
                    ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                    : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:bg-gray-700/60'
                )}
              >
                {c}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-1.5">
        <Stat label="Trades" value={stats.trades.toString()} color="text-gray-200" />
        <Stat label="Wins" value={stats.wins.toString()} color="text-emerald-400" />
        <Stat label="Win %" value={stats.trades ? `${winRate.toFixed(0)}%` : '—'} color="text-blue-400" />
        <Stat
          label="P&L"
          value={`${stats.pnl >= 0 ? '+' : ''}${stats.pnl.toFixed(2)}`}
          color={stats.pnl > 0 ? 'text-emerald-400' : stats.pnl < 0 ? 'text-red-400' : 'text-gray-400'}
        />
      </div>

      {!streamLive && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <span className="text-[10px] text-amber-300 leading-relaxed">
            Deriv tick stream is not connected — predictions are running on simulated data.
            Trades still execute against your real Deriv account when a signal fires.
          </span>
        </div>
      )}

      {/* Log */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">Auto trade log</span>
          {stats.trades > 0 && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-gray-500">
              <Trophy className="w-3 h-3" /> {stats.wins}/{stats.trades}
            </span>
          )}
        </div>
        <div className="h-40 overflow-y-auto rounded-lg border border-gray-800 bg-[#0c0c16] p-2 space-y-1">
          {log.length === 0 ? (
            <p className="text-[10px] text-gray-600 text-center py-6">
              No auto trades yet. Activate and wait for a Matches signal.
            </p>
          ) : (
            log.map(entry => {
              const style = LOG_STYLE[entry.kind]
              return (
                <div key={entry.id} className="flex items-start gap-1.5 text-[10px] leading-relaxed">
                  <span className={cn('shrink-0 mt-px', style.className)}>{style.icon}</span>
                  <span className="text-gray-600 font-mono shrink-0">{stamp(entry.time)}</span>
                  <span className={cn('min-w-0 break-words', style.className)}>{entry.text}</span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-gray-800/40 rounded-lg border border-gray-700 py-1.5 px-1 text-center">
      <div className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={cn('text-xs font-mono font-bold tabular-nums', color)}>{value}</div>
    </div>
  )
}
