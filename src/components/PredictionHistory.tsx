import { cn } from '../lib/cn'
import type { Prediction } from '../lib/deriv-types'
import { STRATEGIES } from '../lib/deriv-types'
import { Clock, Target, TrendingUp, TrendingDown, Check, X, Circle } from 'lucide-react'

type PredictionHistoryProps = {
  predictions: Prediction[]
}

export function PredictionHistory({ predictions }: PredictionHistoryProps) {
  if (predictions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        No predictions yet. Click Predict to generate one.
      </div>
    )
  }

  return (
    <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
      {predictions.slice().reverse().map(pred => {
        const strategy = STRATEGIES.find(s => s.type === pred.strategy)
        const isWin = pred.result === 'win'
        const isLoss = pred.result === 'loss'
        const time = new Date(pred.timestamp).toLocaleTimeString()

        return (
          <div
            key={pred.id}
            className={cn(
              'rounded-lg border p-3 transition-all',
              isWin ? 'bg-emerald-50 border-emerald-200' :
              isLoss ? 'bg-red-50 border-red-200' :
              'bg-gray-800/50 border-gray-700'
            )}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm">{strategy?.icon}</span>
                <span className="text-xs font-medium text-gray-300">{strategy?.label}</span>
                <span className="text-[10px] font-mono text-gray-400 bg-gray-800 px-1 py-0.5 rounded">
                  {pred.symbol}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {pred.result === 'pending' ? (
                  <Circle className="w-3 h-3 text-amber-500 animate-pulse" />
                ) : isWin ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <X className="w-3 h-3 text-red-500" />
                )}
                <span className={cn(
                  'text-[10px] font-medium uppercase',
                  isWin ? 'text-emerald-600' : isLoss ? 'text-red-600' : 'text-amber-500'
                )}>
                  {pred.result === 'pending' ? 'PENDING' : isWin ? 'WIN' : 'LOSS'}
                </span>
              </div>
            </div>

            <p className="text-xs text-gray-500 font-mono leading-relaxed mb-1.5">
              {pred.prediction}
            </p>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-[10px] text-gray-400">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {time}
                </span>
                <span className="flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  Match #{pred.matchNumber}
                </span>
                <span className="font-mono">Digit: {pred.lastDigit}</span>
              </div>
              <div className={cn(
                'text-xs font-mono font-bold',
                pred.confidence > 80 ? 'text-emerald-600' :
                pred.confidence > 60 ? 'text-amber-600' : 'text-red-600'
              )}>
                {pred.confidence.toFixed(1)}%
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function PredictionStats({ predictions }: { predictions: Prediction[] }) {
  const resolved = predictions.filter(p => p.result === 'win' || p.result === 'loss')
  const wins = resolved.filter(p => p.result === 'win').length
  const losses = resolved.filter(p => p.result === 'loss').length
  const winRate = resolved.length > 0 ? (wins / resolved.length) * 100 : 0

  return (
    <div className="grid grid-cols-4 gap-2">
      <StatBox label="Total" value={predictions.length} color="text-gray-200" />
      <StatBox label="Wins" value={wins} color="text-emerald-600" icon={<TrendingUp className="w-3 h-3" />} />
      <StatBox label="Losses" value={losses} color="text-red-600" icon={<TrendingDown className="w-3 h-3" />} />
      <StatBox label="Win Rate" value={`${winRate.toFixed(0)}%`} color={winRate > 60 ? 'text-emerald-600' : winRate > 40 ? 'text-amber-600' : 'text-red-600'} />
    </div>
  )
}

function StatBox({ label, value, color, icon }: { label: string; value: string | number; color: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-2 text-center border border-gray-700">
      <div className={cn('text-lg font-bold font-mono tabular-nums flex items-center justify-center gap-1', color)}>
        {icon}
        {value}
      </div>
      <div className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</div>
    </div>
  )
}
