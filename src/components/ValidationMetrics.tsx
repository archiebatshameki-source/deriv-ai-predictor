import { useState, useMemo } from 'react'
import { cn } from '../lib/cn'
import { BarChart3, TrendingUp, TrendingDown, Target, ChevronDown, ChevronUp, Activity } from 'lucide-react'
import type { Prediction } from '../lib/deriv-types'

type ValidationMetricsProps = {
  predictions: Prediction[]
}

export function ValidationMetrics({ predictions }: ValidationMetricsProps) {
  const [isOpen, setIsOpen] = useState(true)

  const metrics = useMemo(() => {
    const completed = predictions.filter(p => p.result === 'win' || p.result === 'loss')
    const wins = completed.filter(p => p.result === 'win').length
    const losses = completed.filter(p => p.result === 'loss').length
    const total = completed.length
    const winRate = total > 0 ? (wins / total) * 100 : 0

    const stratMetrics: Record<string, { wins: number; losses: number; total: number; avgConf: number }> = {}
    for (const p of completed) {
      if (!stratMetrics[p.strategy]) stratMetrics[p.strategy] = { wins: 0, losses: 0, total: 0, avgConf: 0 }
      stratMetrics[p.strategy].total++
      stratMetrics[p.strategy].avgConf += p.confidence
      if (p.result === 'win') stratMetrics[p.strategy].wins++
      else stratMetrics[p.strategy].losses++
    }
    for (const k of Object.keys(stratMetrics)) {
      stratMetrics[k].avgConf /= stratMetrics[k].total || 1
    }

    const recent20 = completed.slice(0, 20)
    const recentWinRate = recent20.length > 0
      ? (recent20.filter(p => p.result === 'win').length / recent20.length) * 100
      : 0

    const highConf = completed.filter(p => p.confidence >= 70)
    const highConfWinRate = highConf.length > 0
      ? (highConf.filter(p => p.result === 'win').length / highConf.length) * 100
      : 0

    const lowConf = completed.filter(p => p.confidence < 50)
    const lowConfWinRate = lowConf.length > 0
      ? (lowConf.filter(p => p.result === 'win').length / lowConf.length) * 100
      : 0

    let maxStreak = 0, curStreak = 0, maxLossStreak = 0, curLossStreak = 0
    for (const p of completed) {
      if (p.result === 'win') {
        curStreak++
        curLossStreak = 0
        maxStreak = Math.max(maxStreak, curStreak)
      } else {
        curLossStreak++
        curStreak = 0
        maxLossStreak = Math.max(maxLossStreak, curLossStreak)
      }
    }

    const strategyNames: Record<string, string> = {
      matches: '🎯 Matches',
      over_under: '📊 Over/Under',
      rise_fall: '📈 Rise/Fall',
      higher_lower: '⬆️ Higher/Lower',
      touch_no_touch: '👆 Touch/NoTouch',
      even_odd: '🔢 Even/Odd',
    }

    return {
      total, wins, losses, winRate,
      recentWinRate, highConfWinRate, lowConfWinRate,
      maxStreak, maxLossStreak,
      stratMetrics, strategyNames,
      pending: predictions.filter(p => p.result === 'pending').length,
    }
  }, [predictions])

  return (
    <div className="bg-[#1a1a2e] rounded-xl border border-gray-700 shadow-sm overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-medium text-gray-300">Validation & Performance Metrics</span>
        </div>
        {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-700 pt-3">
          {/* Overall Stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-emerald-50 rounded-lg p-2.5 border border-emerald-200 text-center">
              <div className="text-lg font-black text-emerald-600 font-mono">{metrics.winRate.toFixed(1)}%</div>
              <div className="text-[10px] text-emerald-500 font-medium">Win Rate</div>
            </div>
            <div className="bg-blue-500/20 rounded-lg p-2.5 border border-blue-500/30 text-center">
              <div className="text-lg font-black text-blue-600 font-mono">{metrics.total}</div>
              <div className="text-[10px] text-blue-500 font-medium">Total Trades</div>
            </div>
            <div className="bg-violet-50 rounded-lg p-2.5 border border-violet-200 text-center">
              <div className="text-lg font-black text-violet-400 font-mono">{metrics.pending}</div>
              <div className="text-[10px] text-violet-500 font-medium">Pending</div>
            </div>
          </div>

          {/* Win/Loss Bar */}
          {metrics.total > 0 && (
            <div>
              <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3 text-emerald-500" /> {metrics.wins} wins</span>
                <span className="flex items-center gap-1">{metrics.losses} losses <TrendingDown className="w-3 h-3 text-red-500" /></span>
              </div>
              <div className="h-3 bg-red-500/20 rounded-full overflow-hidden flex">
                <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${metrics.winRate}%` }} />
              </div>
            </div>
          )}

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-800/50 rounded-lg p-2 border border-gray-700">
              <div className="text-[10px] text-gray-400 uppercase">Recent 20 Win Rate</div>
              <div className={cn('font-bold font-mono', metrics.recentWinRate >= 50 ? 'text-emerald-600' : 'text-red-600')}>
                {metrics.recentWinRate.toFixed(1)}%
              </div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-2 border border-gray-700">
              <div className="text-[10px] text-gray-400 uppercase">High Conf (≥70%) Win</div>
              <div className={cn('font-bold font-mono', metrics.highConfWinRate >= 50 ? 'text-emerald-600' : 'text-red-600')}>
                {metrics.highConfWinRate.toFixed(1)}%
              </div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-2 border border-gray-700">
              <div className="text-[10px] text-gray-400 uppercase">Max Win Streak</div>
              <div className="font-bold font-mono text-amber-600">{metrics.maxStreak}</div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-2 border border-gray-700">
              <div className="text-[10px] text-gray-400 uppercase">Max Loss Streak</div>
              <div className="font-bold font-mono text-red-600">{metrics.maxLossStreak}</div>
            </div>
          </div>

          {/* Per-Strategy Breakdown */}
          {Object.keys(metrics.stratMetrics).length > 0 && (
            <div>
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Strategy Breakdown</span>
              <div className="space-y-1">
                {Object.entries(metrics.stratMetrics).map(([strat, m]) => {
                  const wr = m.total > 0 ? (m.wins / m.total) * 100 : 0
                  return (
                    <div key={strat} className="flex items-center gap-2 text-[11px] bg-gray-800/50 rounded-lg px-2.5 py-1.5 border border-gray-700">
                      <span className="w-24 truncate font-medium text-gray-400">{metrics.strategyNames[strat] ?? strat}</span>
                      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full', wr >= 50 ? 'bg-emerald-500' : 'bg-red-400')} style={{ width: `${wr}%` }} />
                      </div>
                      <span className={cn('font-mono font-bold w-12 text-right', wr >= 50 ? 'text-emerald-600' : 'text-red-600')}>
                        {wr.toFixed(0)}%
                      </span>
                      <span className="text-gray-400 w-8 text-right">({m.total})</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Empty State */}
          {metrics.total === 0 && (
            <div className="text-center py-4">
              <Activity className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-xs text-gray-400">No completed predictions yet. Start predicting to see metrics.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
