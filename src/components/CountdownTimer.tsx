import { useState, useEffect, useRef } from 'react'
import { cn } from '../lib/cn'

type CountdownTimerProps = {
  duration?: number
  onComplete?: () => void
  isRunning: boolean
  label?: string
  matchNumber?: number
}

export function CountdownTimer({ duration = 5, onComplete, isRunning, label, matchNumber }: CountdownTimerProps) {
  const [display, setDisplay] = useState(duration)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (!isRunning) {
      setDisplay(duration)
      return
    }

    let remaining = duration
    setDisplay(remaining)

    const tick = () => {
      remaining -= 1
      if (remaining <= 0) {
        setDisplay(0)
        timerRef.current = null
        onCompleteRef.current?.()
      } else {
        setDisplay(remaining)
        timerRef.current = setTimeout(tick, 1000)
      }
    }

    timerRef.current = setTimeout(tick, 1000)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isRunning, duration])

  const progress = display > 0 ? display / duration : 0
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - progress)

  const isUrgent = display <= 2 && display > 0
  const isWarning = display <= 3 && display > 2
  const isDone = display === 0

  const getStroke = () => {
    if (isDone) return '#6366f1'
    if (isUrgent) return '#ef4444'
    if (isWarning) return '#f59e0b'
    return '#10b981'
  }

  const getColor = () => {
    if (isDone) return 'text-indigo-600'
    if (isUrgent) return 'text-red-500'
    if (isWarning) return 'text-amber-500'
    return 'text-emerald-500'
  }

  const getGlow = () => {
    if (isDone) return 'drop-shadow(0 0 25px rgba(99,102,241,0.7))'
    if (isUrgent) return 'drop-shadow(0 0 20px rgba(239,68,68,0.7))'
    if (isWarning) return 'drop-shadow(0 0 14px rgba(245,158,11,0.5))'
    return 'drop-shadow(0 0 10px rgba(16,185,129,0.4))'
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {(label || matchNumber != null) && (
        <div className="text-center">
          {label && (
            <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">{label}</span>
          )}
          {matchNumber != null && (
            <div className="text-sm font-mono font-bold text-gray-600">Match #{matchNumber}</div>
          )}
        </div>
      )}

      <div
        className="relative"
        style={{ filter: isRunning ? getGlow() : 'none' }}
      >
        <svg width="130" height="130" className="-rotate-90">
          <circle
            cx="65" cy="65" r={radius}
            fill="none" stroke="currentColor"
            strokeWidth="7"
            className="text-gray-100"
          />
          <circle
            cx="65" cy="65" r={radius}
            fill="none" stroke={getStroke()}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease' }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {isRunning && display > 0 && (
            <>
              <span className="text-[10px] text-gray-400 font-medium mb-0.5 uppercase tracking-wider">Entry in</span>
              <span
                key={display}
                className={cn(
                  'text-6xl font-black font-mono tabular-nums leading-none animate-[scale-in_0.2s_ease-out]',
                  getColor()
                )}
              >
                {display}
              </span>
            </>
          )}
          {isDone && (
            <span className="text-4xl font-black text-indigo-600 animate-pulse">GO!</span>
          )}
          {!isRunning && (
            <span className="text-4xl font-black text-gray-300">{duration}</span>
          )}
          <span className="text-[10px] text-gray-400 font-medium mt-1">SEC</span>
        </div>
      </div>

      {isRunning && display > 0 && (
        <div className={cn(
          'text-xs font-bold px-4 py-1.5 rounded-full',
          isUrgent ? 'bg-red-100 text-red-600 animate-pulse' :
          isWarning ? 'bg-amber-100 text-amber-600' :
          'bg-emerald-100 text-emerald-600'
        )}>
          {isUrgent ? '⚡ TRADE NOW — ENTRY CLOSING' :
           isWarning ? '⚠️ ENTERING SOON' :
           '✅ TRADE ENTRY OPEN'}
        </div>
      )}

      {isDone && (
        <div className="text-xs font-bold px-4 py-1.5 rounded-full bg-indigo-100 text-indigo-600 animate-pulse">
          🎯 ENTRY CLOSED
        </div>
      )}

      {!isRunning && (
        <div className="text-xs text-gray-400">
          Ready — click PREDICTION
        </div>
      )}
    </div>
  )
}
