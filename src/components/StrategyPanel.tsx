import { cn } from '../lib/cn'
import { STRATEGIES, type StrategyType } from '../lib/deriv-types'
import { ArrowUpCircle, ArrowDownCircle, Minus, Zap } from 'lucide-react'

type StrategyPanelProps = {
  selected: StrategyType
  onSelect: (s: StrategyType) => void
  analysis: {
    type: 'buy' | 'sell' | 'neutral'
    strength: number
    message: string
  } | null
  isScanning: boolean
}

export function StrategyPanel({ selected, onSelect, analysis, isScanning }: StrategyPanelProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {STRATEGIES.map(s => (
          <button
            key={s.type}
            onClick={() => onSelect(s.type)}
            className={cn(
              'flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
              selected === s.type
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-gray-800 hover:bg-gray-600 text-gray-400 hover:text-gray-900'
            )}
          >
            <span className="text-base">{s.icon}</span>
            <span className="truncate text-xs">{s.label}</span>
          </button>
        ))}
      </div>

      <div className={cn(
        'rounded-xl border p-4 transition-all',
        analysis?.type === 'buy' ? 'bg-emerald-50 border-emerald-200' :
        analysis?.type === 'sell' ? 'bg-red-50 border-red-200' :
        'bg-gray-800/50 border-gray-700'
      )}>
        {isScanning ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Zap className="w-4 h-4 animate-pulse text-blue-600" />
            <span>Scanning market data...</span>
          </div>
        ) : analysis ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {analysis.type === 'buy' && <ArrowUpCircle className="w-5 h-5 text-emerald-500" />}
                {analysis.type === 'sell' && <ArrowDownCircle className="w-5 h-5 text-red-500" />}
                {analysis.type === 'neutral' && <Minus className="w-5 h-5 text-gray-400" />}
                <span className={cn(
                  'text-sm font-bold uppercase',
                  analysis.type === 'buy' ? 'text-emerald-600' :
                  analysis.type === 'sell' ? 'text-red-600' : 'text-gray-500'
                )}>
                  {analysis.type === 'buy' ? 'SIGNAL: BUY' : analysis.type === 'sell' ? 'SIGNAL: SELL' : 'NEUTRAL'}
                </span>
              </div>
              <div className={cn(
                'text-xs font-mono font-bold px-2 py-0.5 rounded-full',
                analysis.strength > 80 ? 'bg-emerald-500/20 text-emerald-300' :
                analysis.strength > 60 ? 'bg-amber-100 text-amber-300' :
                'bg-red-500/20 text-red-300'
              )}>
                {analysis.strength.toFixed(1)}%
              </div>
            </div>

            <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  analysis.strength > 80 ? 'bg-emerald-500' :
                  analysis.strength > 60 ? 'bg-amber-500/200' : 'bg-red-500'
                )}
                style={{ width: `${analysis.strength}%` }}
              />
            </div>

            <p className="text-xs text-gray-500 font-mono leading-relaxed">
              {analysis.message}
            </p>
          </div>
        ) : (
          <div className="text-sm text-gray-400 text-center py-2">
            Select a strategy and click Analyze
          </div>
        )}
      </div>
    </div>
  )
}
