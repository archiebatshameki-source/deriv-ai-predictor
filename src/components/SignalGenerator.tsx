import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '../lib/cn'
import { Brain, Target, Play, Square, Check, X, Eye, Ban, ShieldAlert, Hash, ArrowLeftRight } from 'lucide-react'

type Phase = 'idle' | 'collecting' | 'locked' | 'watching' | 'result'

type JournalEntry = {
  time: number
  phase: string
  message: string
  digit?: number
  isTarget?: boolean
}

type HistoryEntry = {
  match: number
  targetDigit: number
  result: 'win' | 'loss'
  ticksWaited: number
  confidence: number
  time: number
}

type SignalGeneratorProps = {
  onAnalyze: () => { predictedDigit: number; confidence: number; digitProbabilities: number[] }
  connected: boolean
  lastDigit: number | null
  lastDigitHistory: number[]
  onTargetLocked?: (digit: number, confidence: number) => void
  onWatchStart?: (digit: number) => void
}

const SAMPLE_SIZE = 10

export function SignalGenerator({ onAnalyze, connected, lastDigit, lastDigitHistory, onTargetLocked, onWatchStart }: SignalGeneratorProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [samples, setSamples] = useState<number[]>([])
  const [targetDigit, setTargetDigit] = useState<number | null>(null)
  const [targetFreq, setTargetFreq] = useState(0)
  const [targetConfidence, setTargetConfidence] = useState(0)
  const [journal, setJournal] = useState<JournalEntry[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [watchTicks, setWatchTicks] = useState(0)
  const [autoMode, setAutoMode] = useState(false)

  const lastProcessedRef = useRef<number | null>(null)
  const matchCounterRef = useRef(0)
  const targetRef = useRef<number | null>(null)
  const phaseRef = useRef<Phase>('idle')
  const autoModeRef = useRef(false)
  const watchStartRef = useRef(0)

  phaseRef.current = phase
  targetRef.current = targetDigit
  autoModeRef.current = autoMode

  const addJournal = useCallback((phase: string, message: string, digit?: number, isTarget?: boolean) => {
    setJournal(prev => [{ time: Date.now(), phase, message, digit, isTarget }, ...prev].slice(0, 100))
  }, [])

  // ══════════════ STAGE A: Collect samples ══════════════
  useEffect(() => {
    if (phase !== 'collecting') return
    if (lastDigit == null) return
    if (lastDigit === lastProcessedRef.current) return

    lastProcessedRef.current = lastDigit

    setSamples(prev => {
      if (prev.length >= SAMPLE_SIZE) return prev
      const next = [...prev, lastDigit]
      addJournal('collect', `Collecting samples: ${next.length} / ${SAMPLE_SIZE} — tick digit: ${lastDigit}`, lastDigit)

      if (next.length === SAMPLE_SIZE) {
        // Pick the LEAST frequent digit
        const freq = Array(10).fill(0)
        for (const d of next) freq[d]++
        let minFreq = Infinity
        let bestDigit = 0
        for (let d = 0; d < 10; d++) {
          if (freq[d] < minFreq) {
            minFreq = freq[d]
            bestDigit = d
          }
        }
        const pct = ((minFreq / SAMPLE_SIZE) * 100).toFixed(0)

        // Run the 6-layer analysis to get confidence
        const analysis = onAnalyze()
        const conf = analysis.confidence

        // Schedule lock-in after a short delay
        setTimeout(() => {
          setTargetDigit(bestDigit)
          setTargetFreq(minFreq)
          setTargetConfidence(conf)
          targetRef.current = bestDigit
          addJournal('lock', `Target digit locked: ${bestDigit} (freq ${pct}%, ${minFreq}/${SAMPLE_SIZE}) — now watching for it live`, bestDigit, true)
          setPhase('locked')
          onTargetLocked?.(bestDigit, conf)

          // After showing lock message, start watching
          setTimeout(() => {
            setPhase('watching')
            watchStartRef.current = Date.now()
            setWatchTicks(0)
            lastProcessedRef.current = null // Reset to catch next tick
            addJournal('watch', `Watching for digit ${bestDigit}... waiting for match`)
            onWatchStart?.(bestDigit)
          }, 1500)
        }, 500)
      }

      return next
    })
  }, [phase, lastDigit, addJournal, onAnalyze, onTargetLocked, onWatchStart])

  // ══════════════ STAGE B: Watch for target digit ══════════════
  useEffect(() => {
    if (phase !== 'watching') return
    if (lastDigit == null) return
    if (lastDigit === lastProcessedRef.current) return

    lastProcessedRef.current = lastDigit
    const target = targetRef.current
    if (target == null) return

    setWatchTicks(prev => prev + 1)
    addJournal('watch', `Watching for digit ${target}... last tick was ${lastDigit}`, lastDigit, lastDigit === target)

    if (lastDigit === target) {
      // WIN!
      matchCounterRef.current += 1
      const entry: HistoryEntry = {
        match: matchCounterRef.current,
        targetDigit: target,
        result: 'win',
        ticksWaited: watchTicks + 1,
        confidence: targetConfidence,
        time: Date.now(),
      }
      setHistory(prev => [entry, ...prev].slice(0, 50))
      addJournal('result', `✅ DIGIT ${target} APPEARED! Win after ${watchTicks + 1} ticks`, target, true)
      setPhase('result')

      // After showing result, either loop or go idle
      setTimeout(() => {
        if (autoModeRef.current) {
          startNewRound()
        } else {
          setPhase('idle')
          setSamples([])
          setTargetDigit(null)
          setWatchTicks(0)
          lastProcessedRef.current = null
        }
      }, 2500)
    }
  }, [phase, lastDigit, addJournal, watchTicks, targetConfidence])

  const startNewRound = useCallback(() => {
    setPhase('collecting')
    setSamples([])
    setTargetDigit(null)
    setTargetFreq(0)
    setTargetConfidence(0)
    setWatchTicks(0)
    lastProcessedRef.current = null
    addJournal('system', '🔄 Starting new prediction round...')
  }, [addJournal])

  const handlePredictionClick = useCallback(() => {
    if (!connected || phase === 'collecting' || phase === 'watching') return
    startNewRound()
  }, [connected, phase, startNewRound])

  const handleAutoToggle = useCallback(() => {
    if (autoMode) {
      setAutoMode(false)
      setPhase('idle')
      setSamples([])
      setTargetDigit(null)
      setWatchTicks(0)
      lastProcessedRef.current = null
    } else {
      setAutoMode(true)
      startNewRound()
    }
  }, [autoMode, startNewRound])

  const handleStop = useCallback(() => {
    setAutoMode(false)
    setPhase('idle')
    setSamples([])
    setTargetDigit(null)
    setWatchTicks(0)
    lastProcessedRef.current = null
  }, [])

  // ══════════════ Derived stats ══════════════
  const wins = history.filter(h => h.result === 'win').length
  const total = history.length
  const winRate = total > 0 ? (wins / total) * 100 : 0
  const avgTicks = total > 0 ? history.reduce((s, h) => s + h.ticksWaited, 0) / total : 0

  const digitColor = (d: number) => {
    if (d === 0 || d === 5) return 'text-violet-400'
    if (d <= 2) return 'text-emerald-400'
    if (d <= 4) return 'text-blue-400'
    if (d <= 7) return 'text-amber-400'
    return 'text-red-400'
  }

  const digitBg = (d: number) => {
    if (d === 0 || d === 5) return 'from-violet-500/20 to-purple-500/20 border-violet-500/30'
    if (d <= 2) return 'from-emerald-500/20 to-green-500/20 border-emerald-500/30'
    if (d <= 4) return 'from-blue-500/20 to-cyan-500/20 border-blue-500/30'
    if (d <= 7) return 'from-amber-500/20 to-yellow-500/20 border-amber-500/30'
    return 'from-red-500/20 to-rose-500/20 border-red-500/30'
  }

  // Sample frequency chart
  const sampleFreq = Array(10).fill(0)
  for (const d of samples) sampleFreq[d]++
  const maxSampleFreq = Math.max(...sampleFreq, 1)

  return (
    <div className="space-y-3">
      {/* ══════════════ MAIN PANEL ══════════════ */}
      <div className={cn(
        'rounded-2xl border-2 p-5 transition-all duration-300 relative overflow-hidden',
        phase === 'watching' ? 'bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border-blue-500/30' :
        phase === 'collecting' ? 'bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-500/30' :
        phase === 'locked' ? 'bg-gradient-to-br from-emerald-500/10 to-green-500/10 border-emerald-500/30' :
        phase === 'result' ? 'bg-gradient-to-br from-emerald-500/15 to-yellow-500/10 border-emerald-500/40' :
        'bg-[#1a1a2e] border-gray-700'
      )}>

        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-violet-400" />
            <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">
              Matches Prediction
            </span>
          </div>
          {matchCounterRef.current > 0 && (
            <div className="flex items-center gap-1.5 bg-violet-500/20 rounded-lg px-2 py-1">
              <Hash className="w-3 h-3 text-violet-400" />
              <span className="text-xs font-bold text-violet-400 font-mono">#{matchCounterRef.current}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-center py-3 min-h-[200px] justify-center">

          {/* ══════════════ IDLE ══════════════ */}
          {phase === 'idle' && (
            <div className="text-center space-y-4">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center border border-violet-500/30">
                <Brain className="w-10 h-10 text-violet-400" />
              </div>
              <div>
                <p className="text-sm text-gray-300 font-medium">AI Matrix Prediction Ready</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Stage A: Collect 10 samples → Stage B: Watch for target</p>
              </div>
              <button
                onClick={handlePredictionClick}
                disabled={!connected}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-sm transition-all shadow-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-500 hover:to-purple-500 shadow-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Brain className="w-4 h-4" />
                PREDICTION
              </button>
              <button
                onClick={handleAutoToggle}
                disabled={!connected}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-xs transition-all border',
                  autoMode ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
                  !connected && 'opacity-40 cursor-not-allowed'
                )}
              >
                {autoMode ? <><Square className="w-3.5 h-3.5" /> STOP AUTO MODE</> : <><Play className="w-3.5 h-3.5" /> START AUTO MODE</>}
              </button>
            </div>
          )}

          {/* ══════════════ STAGE A: COLLECTING ══════════════ */}
          {phase === 'collecting' && (
            <div className="text-center space-y-4 w-full">
              <div className="relative w-20 h-20 mx-auto">
                <div className="absolute inset-0 rounded-2xl border-4 border-violet-500/20" />
                <div className="absolute inset-0 rounded-2xl border-4 border-violet-500 border-t-transparent border-r-transparent animate-spin" />
                <div className="absolute inset-2 rounded-xl bg-violet-500/10 flex items-center justify-center">
                  <Eye className="w-7 h-7 text-violet-400 animate-pulse" />
                </div>
              </div>
              <div>
                <p className="text-sm font-bold text-violet-400 uppercase tracking-wide">Stage A — Collecting Samples</p>
                <p className="text-2xl font-black text-white font-mono mt-1">
                  {samples.length} <span className="text-sm text-gray-400 font-normal">/ {SAMPLE_SIZE}</span>
                </p>
              </div>

              {/* Progress bar */}
              <div className="w-full max-w-xs mx-auto">
                <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full transition-all duration-300"
                    style={{ width: `${(samples.length / SAMPLE_SIZE) * 100}%` }}
                  />
                </div>
              </div>

              {/* Frequency chart */}
              <div className="flex items-end justify-center gap-1 h-12">
                {sampleFreq.map((count, d) => (
                  <div key={d} className="flex flex-col items-center gap-0.5">
                    <div
                      className="w-3 bg-violet-500/60 rounded-t transition-all duration-300"
                      style={{ height: `${(count / maxSampleFreq) * 36}px`, minHeight: count > 0 ? '2px' : '0' }}
                    />
                    <span className="text-[8px] text-gray-500 font-mono">{d}</span>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-gray-500 font-mono">
                {samples.length < SAMPLE_SIZE
                  ? `Waiting for next tick... (${SAMPLE_SIZE - samples.length} more needed)`
                  : 'Analyzing frequency...'}
              </p>
            </div>
          )}

          {/* ══════════════ LOCKED ══════════════ */}
          {phase === 'locked' && targetDigit != null && (
            <div className="text-center space-y-4 w-full animate-[scale-in_0.3s_ease-out]">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Target Digit Locked</p>
              </div>
              <div className={cn('w-28 h-28 mx-auto rounded-3xl flex items-center justify-center border-2 shadow-xl bg-gradient-to-br', digitBg(targetDigit))}>
                <span className={cn('font-black font-mono tabular-nums leading-none text-6xl', digitColor(targetDigit))}>{targetDigit}</span>
              </div>
              <div className="bg-black/30 rounded-xl border border-gray-700 p-3 text-center">
                <p className="text-[11px] text-gray-400 font-mono">
                  Target: <span className="text-white font-bold">{targetDigit}</span> — freq: <span className="text-white font-bold">{targetFreq}/{SAMPLE_SIZE}</span>
                </p>
                <p className="text-[11px] text-emerald-400 font-mono mt-1">
                  Now watching for it live...
                </p>
              </div>
            </div>
          )}

          {/* ══════════════ STAGE B: WATCHING ══════════════ */}
          {phase === 'watching' && targetDigit != null && (
            <div className="text-center space-y-4 w-full">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Eye className="w-4 h-4 text-blue-400 animate-pulse" />
                <p className="text-xs font-bold text-blue-400 uppercase tracking-wider">Stage B — Watching</p>
              </div>

              {/* Target digit — big display */}
              <div className={cn('w-28 h-28 mx-auto rounded-3xl flex items-center justify-center border-2 shadow-xl bg-gradient-to-br', digitBg(targetDigit))}>
                <span className={cn('font-black font-mono tabular-nums leading-none text-6xl', digitColor(targetDigit))}>{targetDigit}</span>
              </div>

              {/* Watching status */}
              <div className="bg-black/30 rounded-xl border border-blue-500/20 p-3 text-center">
                <p className="text-xs text-blue-400 font-mono">
                  Watching for digit <span className="text-white font-bold">{targetDigit}</span>...
                </p>
                <p className="text-xs text-gray-400 font-mono mt-1">
                  Last tick: <span className="text-white font-bold">{lastDigit ?? '—'}</span>
                  {lastDigit != null && lastDigit !== targetDigit && (
                    <span className="text-red-400 ml-1">✗</span>
                  )}
                </p>
                <p className="text-[10px] text-gray-500 mt-1">
                  Ticks waited: <span className="text-white font-mono">{watchTicks}</span>
                </p>
              </div>

              {/* Target progress — shows how close we are */}
              <div className="w-full max-w-xs mx-auto">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <p className="text-[10px] text-gray-500 font-mono">Scanning every tick...</p>
                </div>
              </div>

              {/* Last 5 ticks mini-display */}
              <div className="flex items-center justify-center gap-1">
                {lastDigitHistory.slice(-8).map((d, i) => (
                  <div
                    key={i}
                    className={cn(
                      'w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold font-mono border',
                      d === targetDigit
                        ? 'bg-emerald-500/30 border-emerald-500/50 text-emerald-400'
                        : 'bg-gray-800 border-gray-700 text-gray-400'
                    )}
                  >
                    {d}
                  </div>
                ))}
              </div>

              <button
                onClick={handleStop}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-xs transition-all border bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
              >
                <Square className="w-3.5 h-3.5" /> STOP
              </button>
            </div>
          )}

          {/* ══════════════ RESULT (WIN) ══════════════ */}
          {phase === 'result' && targetDigit != null && (
            <div className="text-center space-y-4 w-full animate-[scale-in_0.3s_ease-out]">
              <div className="w-20 h-20 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 flex items-center justify-center">
                <Check className="w-10 h-10 text-emerald-400" />
              </div>
              <div>
                <p className="text-lg font-black text-emerald-400 uppercase tracking-wider">✅ WIN!</p>
                <p className="text-xs text-gray-400 mt-1">
                  Digit <span className="text-white font-bold">{targetDigit}</span> appeared after <span className="text-white font-bold">{watchTicks}</span> ticks
                </p>
              </div>
              <div className="flex items-center justify-center gap-4">
                <div className="text-center">
                  <p className="text-[10px] text-gray-500 uppercase">Target</p>
                  <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center border bg-gradient-to-br', digitBg(targetDigit))}>
                    <span className={cn('font-black font-mono text-2xl', digitColor(targetDigit))}>{targetDigit}</span>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-gray-500 uppercase">Last Tick</p>
                  <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center border bg-gradient-to-br', digitBg(lastDigit ?? 0))}>
                    <span className={cn('font-black font-mono text-2xl', digitColor(lastDigit ?? 0))}>{lastDigit ?? '—'}</span>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-gray-500 font-mono">
                {autoMode ? 'Starting next round...' : 'Returning to idle...'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ══════════════ JOURNAL LOG ══════════════ */}
      {journal.length > 0 && (
        <div className="bg-[#1a1a2e] rounded-xl border border-gray-700 p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Eye className="w-3 h-3 text-gray-400" />
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Journal</p>
            </div>
            <span className="text-[10px] text-gray-500 font-mono">{journal.length} entries</span>
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {journal.slice(0, 30).map((entry, i) => (
              <div
                key={i}
                className={cn(
                  'text-[10px] font-mono py-1 px-2 rounded',
                  entry.isTarget ? 'bg-emerald-500/10 text-emerald-400' :
                  entry.phase === 'result' ? 'bg-emerald-500/20 text-emerald-300 font-bold' :
                  entry.phase === 'lock' ? 'bg-violet-500/10 text-violet-400' :
                  'text-gray-500'
                )}
              >
                <span className="text-gray-600">{new Date(entry.time).toLocaleTimeString()}</span>
                {' '}{entry.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════ WIN / LOSS HISTORY ══════════════ */}
      {history.length > 0 && (
        <div className="bg-[#1a1a2e] rounded-xl border border-gray-700 p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Target className="w-3 h-3 text-gray-400" />
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Results</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold text-emerald-400">{wins}W</span>
              <span className="text-[10px] font-mono font-bold text-gray-400">{total - wins}L</span>
              <span className={cn('text-[10px] font-mono font-bold px-1.5 py-0.5 rounded', winRate >= 50 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400')}>
                {winRate.toFixed(0)}%
              </span>
              <span className="text-[10px] font-mono text-gray-500">Avg: {avgTicks.toFixed(1)} ticks</span>
            </div>
          </div>

          {/* Win/loss bar */}
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden flex mb-2">
            <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${winRate}%` }} />
            <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${100 - winRate}%` }} />
          </div>

          <div className="space-y-1 max-h-48 overflow-y-auto">
            {history.map((h, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-center justify-between text-xs py-1.5 px-2.5 rounded-lg border',
                  h.result === 'win' ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'
                )}
              >
                <span className="text-gray-500 font-mono text-[10px] w-8">#{h.match}</span>
                <div className="flex items-center gap-1.5">
                  <span className={cn('font-mono font-black text-lg', digitColor(h.targetDigit))}>{h.targetDigit}</span>
                  <ArrowLeftRight className="w-3 h-3 text-gray-600" />
                  <span className={cn('font-mono font-black text-lg', digitColor(h.targetDigit))}>{h.targetDigit}</span>
                </div>
                <span className="text-[10px] font-mono text-gray-400">{h.ticksWaited}t</span>
                {h.result === 'win'
                  ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                  : <X className="w-3.5 h-3.5 text-red-400" />
                }
                <span className="text-[10px] text-gray-500 font-mono">{new Date(h.time).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
