import { cn } from '../lib/cn'
import type { DigitAnalysis } from '../lib/deriv-types'

type DigitHeatmapProps = {
  digitCounts: DigitAnalysis[]
  lastDigit: number | null
}

export function DigitHeatmap({ digitCounts, lastDigit }: DigitHeatmapProps) {
  const maxCount = Math.max(...digitCounts.map(d => d.count), 1)

  return (
    <div className="grid grid-cols-5 gap-1.5">
      {digitCounts.map(d => {
        const intensity = d.count / maxCount
        const isHot = intensity > 0.7
        const isCold = intensity < 0.3
        const isLast = d.digit === lastDigit

        return (
          <div
            key={d.digit}
            className={cn(
              'relative flex flex-col items-center justify-center rounded-lg p-2 transition-all border',
              isLast && 'ring-2 ring-blue-500/50 border-blue-400',
              !isLast && isHot && 'border-red-200',
              !isLast && isCold && 'border-blue-200',
              !isLast && !isHot && !isCold && 'border-gray-100'
            )}
            style={{
              background: isHot
                ? `rgba(239, 68, 68, ${0.08 + intensity * 0.15})`
                : isCold
                  ? `rgba(59, 130, 246, ${0.06 + (1 - intensity) * 0.12})`
                  : `rgba(148, 163, 184, ${0.03 + intensity * 0.08})`,
            }}
          >
            <span className={cn(
              'text-lg font-bold font-mono tabular-nums',
              isHot ? 'text-red-600' : isCold ? 'text-blue-600' : 'text-gray-600'
            )}>
              {d.digit}
            </span>
            <span className="text-[10px] text-gray-400 font-mono">
              {d.count} ({d.percentage.toFixed(0)}%)
            </span>
            {isHot && <span className="absolute -top-1 -right-1 text-[8px]">🔥</span>}
            {isCold && <span className="absolute -top-1 -right-1 text-[8px]">❄️</span>}
          </div>
        )
      })}
    </div>
  )
}
