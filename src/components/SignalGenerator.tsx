import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '../lib/cn'
import { decideWatch } from '../lib/watch'
import { Brain, Target, Play, Square, Check, X, Eye, Ban, ShieldAlert, Hash } from 'lucide-react'

type Phase = 'idle' | 'collecting' | 'watching' | 'result'

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
  /**
   * Fired the moment the predicted digit turns up on a real tick. This is the
   * hand-off that connects the prediction engine to the auto trader: the trader
   * no longer infers the find by diffing the raw digit stream — it is told.
   * The predicted digit IS the signal; there is no tick count involved.
   */
  onTickFound?: (digit: number) => void
  /**
   * Bumped by the parent to drive a round from outside this panel. The
   * auto-trade button lives in the dashboard, so one click there has to start
   * the Matches flow here — otherwise "activated" means nothing happens until
   * the user also presses a button inside this card.
   */
  runToken?: number
}

const SAMPLE_SIZE = 10

export function SignalGenerator({ onAnalyze, connected, lastDigit, lastDigitHistory, onTargetLocked, onWatchStart, onTickFound, runToken = 0 }: SignalGeneratorProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [samples, setSamples] = useState<number[]>([])
  const [targetDigit, setTargetDigit] = useState<number | null>(null)
  const [targetConfidence, setTargetConfidence] = useState(0)
  const [journal, setJournal] = useState<JournalEntry[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [autoMode, setAutoMode] = useState(false)
  /** True from the moment the predicted digit prints — this is the trade moment. */
  const [firedNow, setFiredNow] = useState(false)

  const lastProcessedRef = useRef<number | null>(null)
  const matchCounterRef = useRef(0)
  const targetRef = useRef<number | null>(null)
  const phaseRef = useRef<Phase>('idle')
  const autoModeRef = useRef(false)
  const watchTicksRef = useRef(0)
  const confidenceRef = useRef(0)
  const startNewRoundRef = useRef<() => void>(() => {})

  phaseRef.current = phase
  targetRef.current = targetDigit
  autoModeRef.current = autoMode
  confidenceRef.current = targetConfidence

  const addJournal = useCallback((phase: string, message: string, digit?: number, isTarget?: boolean) => {
    setJournal(prev => [{ time: Date.now(), phase, message, digit, isTarget }, ...prev].slice(0, 100))
  }, [])

  // Latest callback identities, so the countdown effect can stay keyed on
  // `phase` alone instead of being torn down by every parent re-render.
  const onWatchStartRef = useRef(onWatchStart)
  onWatchStartRef.current = onWatchStart

  const addJournalRef = useRef(addJournal)
  addJournalRef.current = addJournal

  const onTickFoundRef = useRef(onTickFound)
  onTickFoundRef.current = onTickFound

  /**
   * Closes a round: records it in the history, then either loops into a fresh
   * round (auto mode) or parks the engine.
   *
   * A win and a loss are recorded on the same footing, so the hit rate is
   * measured rather than assumed — the only way a round ends without a win is a
   * deliberate stop, and that is logged as a miss.
   */
  const finishRound = useCallback((result: 'win' | 'loss') => {
    const target = targetRef.current
    matchCounterRef.current += 1
    setHistory(prev => [{
      match: matchCounterRef.current,
      targetDigit: target ?? -1,
      result,
      confidence: confidenceRef.current,
      time: Date.now(),
    }, ...prev].slice(0, 50))

    addJournal(
      'result',
      result === 'win'
        ? `✅ PREDICTED DIGIT ${target} APPEARED — trade fired`
        : `⚠️ Round stopped before digit ${target} appeared — logged as a MISS`,
      target ?? undefined,
      result === 'win',
    )
    setPhase('result')

    setTimeout(() => {
      if (autoModeRef.current) {
        startNewRoundRef.current()
      } else {
        setPhase('idle')
        setSamples([])
        setTargetDigit(null)
        watchTicksRef.current = 0
        lastProcessedRef.current = null
      }
    }, 2500)
  }, [addJournal])

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
        // Run the 6-layer analysis to get confidence
        const analysis = onAnalyze()
        const conf = analysis.confidence

        // Lock the prediction and go straight into watching. There is no entry
        // countdown and no tick budget: the predicted digit IS the signal, so
        // Stage B starts on the very next tick rather than waiting out a timer.
        setTimeout(() => {
          setTargetDigit(bestDigit)
          setTargetConfidence(conf)
          targetRef.current = bestDigit
          addJournal('lock', `Predicted digit locked: ${bestDigit} — watching for it now`, bestDigit, true)
          onTargetLocked?.(bestDigit, conf)
          setPhase('watching')
          watchTicksRef.current = 0
          lastProcessedRef.current = null
          addJournalRef.current('watch', `Watching for predicted digit ${bestDigit}...`)
          onWatchStartRef.current?.(bestDigit)
        }, 500)
      }

      return next
    })
  }, [phase, lastDigit, addJournal, onAnalyze, onTargetLocked])

  // ══════════════ STAGE B: Watch for target digit ══════════════
  useEffect(() => {
    if (phase !== 'watching') return
    if (lastDigit == null) return
    if (lastDigit === lastProcessedRef.current) return

    lastProcessedRef.current = lastDigit
    const target = targetRef.current
    if (target == null) return

    watchTicksRef.current += 1

    const decision = decideWatch({ targetDigit: target, lastDigit })

    if (decision === 'keep-watching') {
      // Still waiting. The round runs for as many ticks as it takes and nothing
      // here can end it early — the predicted digit printing is the only exit.
      addJournal(
        'watch',
        `Waiting for predicted digit ${target}... last tick was ${lastDigit}`,
        lastDigit,
        false,
      )
      return
    }

    // The predicted digit turned up on a real tick. That appearance IS the
    // signal, and it is handed to the auto trader.
    setFiredNow(true)
    onTickFoundRef.current?.(target)
    finishRound('win')
  }, [phase, lastDigit, addJournal, finishRound])

  const startNewRound = useCallback(() => {
    setPhase('collecting')
    setSamples([])
    setTargetDigit(null)
    setTargetConfidence(0)
    watchTicksRef.current = 0
    setFiredNow(false)
    lastProcessedRef.current = null
    addJournal('system', '🔄 Starting new prediction round...')
  }, [addJournal])

  // Published through a ref so `finishRound` (declared above) can loop without
  // referencing a `const` that does not exist yet in the render pass.
  startNewRoundRef.current = startNewRound

  // Drive a round from the dashboard's auto-trade button. Without this,
  // activating auto trade arms the trader but nothing happens until the user
  // also presses a button inside this panel.
  useEffect(() => {
    if (runToken <= 0) return
    const p = phaseRef.current
    if (p === 'collecting' || p === 'watching') return
    setAutoMode(true)
    startNewRound()
  }, [runToken, startNewRound])

  const handlePredictionClick = useCallback(() => {
    if (!connected || phase === 'collecting' || phase === 'watching') return
    startNewRound()
  }, [connected, phase, startNewRound])

  const handleStop = useCallback(() => {
    const wasWatching = phaseRef.current === 'watching'
    const target = targetRef.current
    const waited = watchTicksRef.current

    setAutoMode(false)
    // Set the ref too: the round-end timeout reads it, and state updates are not
    // visible until the next render — without this a STOP mid-round could still
    // kick off another round.
    autoModeRef.current = false
    setFiredNow(false)
    lastProcessedRef.current = null

    // A stop mid-watch is the one honest way a round can end without the digit
    // turning up. Record it, so an unbounded watch never reports a hit rate that
    // is 100% by construction.
    if (wasWatching && target != null && waited > 0) {
      watchTicksRef.current = 0
      finishRound('loss')
      return
    }

    setPhase('idle')
    setSamples([])
    setTargetDigit(null)
    watchTicksRef.current = 0
  }, [finishRound])

  // Turning auto trade off abandons whatever round is in flight, so it goes
  // through the same stop path — otherwise a round dropped this way would leave
  // no trace in the history.
  const handleAutoToggle = useCallback(() => {
    if (autoMode) {
      handleStop()
    } else {
      setAutoMode(true)
      startNewRound()
    }
  }, [autoMode, startNewRound, handleStop])

  // ══════════════ Derived stats ══════════════
  const wins = history.filter(h => h.result === 'win').length
  const total = history.length
  const winRate = total > 0 ? (wins / total) * 100 : 0

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
                  Waiting for predicted digit <span className="text-white font-bold">{targetDigit}</span>...
                </p>
                <p className="text-xs text-gray-400 font-mono mt-1">
                  Last tick: <span className="text-white font-bold">{lastDigit ?? '—'}</span>
                  {lastDigit != null && lastDigit !== targetDigit && (
                    <span className="text-red-400 ml-1">✗</span>
                  )}
                </p>
              </div>

              {/* Target progress */}
              <div className="w-full max-w-xs mx-auto">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <p className="text-[10px] text-gray-500 font-mono">
                    Fires the moment {targetDigit} prints — the predicted digit is the only trigger
                  </p>
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
                  Predicted digit <span className="text-white font-bold">{targetDigit}</span> appeared
                </p>
                {firedNow && (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-sm font-black tracking-wider text-emerald-300 animate-pulse">
                    TRADE NOW
                  </p>
                )}
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
                <span className="text-gray-500">{new Date(entry.time).toLocaleTimeString()}</span>
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
                  <span className="text-[9px] uppercase tracking-wider text-gray-500">predicted</span>
                  <span className={cn('font-mono font-black text-lg', digitColor(h.targetDigit))}>{h.targetDigit}</span>
                </div>
                <span className="text-[10px] font-mono text-gray-400">{h.confidence.toFixed(0)}%</span>
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
