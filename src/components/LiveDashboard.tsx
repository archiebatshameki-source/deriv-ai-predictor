import { useState, useCallback, useEffect, useRef } from 'react'
import { cn } from '../lib/cn'
import { useDerivStream } from '../hooks/useDerivStream'
import { STRATEGIES, CONTRACT_MODES, VOLATILITY_MARKETS, type StrategyType, type ContractMode } from '../lib/deriv-types'
import type { DerivAccount, DerivClient, DerivSession } from '../lib/deriv-api'
import { MarketSelector } from './MarketSelector'
import { CountdownTimer } from './CountdownTimer'
import { PriceChart } from './PriceChart'
import { DigitHeatmap } from './DigitHeatmap'
import { StrategyPanel } from './StrategyPanel'
import { SignalGenerator } from './SignalGenerator'
import { PredictionHistory } from './PredictionHistory'
import { ModelSettings, type ModelParams, DEFAULT_PARAMS } from './ModelSettings'
import { ValidationMetrics } from './ValidationMetrics'
import { DerivBroker, type QuickTradeKind } from './DerivBroker'
import { AutoTradePanel, type AutoTradeLogEntry, type AutoTradeStats } from './AutoTradePanel'
import type { StatField } from './TradeStatsTable'
import { accumulateSettlement, emptyStats } from '../lib/trade-stats'
import { decideAutoFire } from '../lib/auto-fire'
import {
  Zap, Brain, Activity, BarChart3, Target, History,
  Play, Square, TrendingUp, TrendingDown, ArrowUp, ArrowDown,
  RefreshCw, Gauge, Crosshair, Shield, ArrowLeftRight
} from 'lucide-react'

const STRATEGY_COLORS: Record<StrategyType, string> = {
  matches: 'from-violet-500 to-purple-600',
  differs: 'from-rose-500 to-red-600',
  over_under: 'from-blue-500 to-cyan-600',
  rise_fall: 'from-emerald-500 to-teal-600',
  higher_lower: 'from-amber-500 to-orange-600',
  touch_no_touch: 'from-rose-500 to-pink-600',
  even_odd: 'from-indigo-500 to-blue-600',
}

type LiveDashboardProps = {
  session: DerivSession
  client: DerivClient
  onDisconnect: () => void
  onUpdateSession: (patch: Partial<DerivSession>) => void
  onReconnect: () => void
  reconnecting: boolean
  reconnectError: string | null
  onSwitchAccount: (account: DerivAccount) => Promise<void>
}

export function LiveDashboard({
  session, client, onDisconnect, onUpdateSession,
  onReconnect, reconnecting, reconnectError, onSwitchAccount,
}: LiveDashboardProps) {
  const [selectedSymbol, setSelectedSymbol] = useState('R_10')
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyType>('matches')
  const [isScanning, setIsScanning] = useState(false)
  const [isPredicting, setIsPredicting] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<{
    type: 'buy' | 'sell' | 'neutral'
    strength: number
    message: string
  } | null>(null)
  const [countdownActive, setCountdownActive] = useState(false)
  const [matchNumber, setMatchNumber] = useState(0)
  const [autoMode, setAutoMode] = useState(false)
  const autoIntervalRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [modelParams, setModelParams] = useState<ModelParams>(DEFAULT_PARAMS)
  const [lastDigitHistory, setLastDigitHistory] = useState<number[]>([])
  const prevLastDigitRef = useRef<number | null>(null)

  // ── Deriv auto trading ──────────────────────────────────────────────
  const [autoTrade, setAutoTrade] = useState(false)
  const [stake, setStake] = useState(1)
  /**
   * 0 = fire on every confirmed Matches hit.
   *
   * The engine forces confidence to 0 whenever its regime filter reports
   * "no_signal" (which it does until 50+ ticks accumulate, and on any
   * near-uniform digit distribution), so a non-zero default silently blocked
   * every auto trade. 0 keeps the flow firing and lets the user tighten it.
   */
  const [minConfidence, setMinConfidence] = useState(0)
  /** Bumped to drive the Matches round from the auto-trade button. */
  const [runToken, setRunToken] = useState(0)
  const [profitTarget, setProfitTarget] = useState(10)
  const [maxLoss, setMaxLoss] = useState(10)
  /** Per-trade risk, editable from the Trade columns table. */
  const [risk, setRisk] = useState(1)
  /**
   * Which side of the locked digit the auto-trader bets.
   *
   * Defaults to Differs. Firing DIGITMATCH the instant a digit prints is a
   * ~1-in-10 bet — the contract settles on the *next* tick, so "it just
   * appeared" carries no information about the one after it. That is why every
   * fired trade used to lose while the predictor reported 100%. DIGITDIFF is
   * the other side of the same locked digit and lands roughly 9 times in 10.
   */
  const [contractMode, setContractMode] = useState<ContractMode>('differs')
  const [autoLog, setAutoLog] = useState<AutoTradeLogEntry[]>([])
  const [autoStats, setAutoStats] = useState<AutoTradeStats>(emptyStats)
  const [targetDigit, setTargetDigit] = useState<number | null>(null)
  const [targetConfidence, setTargetConfidence] = useState(0)
  const [watching, setWatching] = useState(false)
  const [quickTradeBusy, setQuickTradeBusy] = useState<string | null>(null)
  const [quickTradeMessage, setQuickTradeMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const logIdRef = useRef(0)
  const lastTradeAtRef = useRef(0)
  const tradedTargetRef = useRef<number | null>(null)
  const autoTradeRef = useRef(false)
  const stakeRef = useRef(1)
  /**
   * The engine's most recent TRADE NOW hand-off. Carries its own digit and
   * confidence so the fire effect never reads a stale value out of state, and
   * `consumedHandoffRef` guarantees a hand-off is acted on exactly once.
   */
  const tradeHandoffRef = useRef<{ digit: number; confidence: number; key: number } | null>(null)
  const consumedHandoffRef = useRef<number | null>(null)
  const handoffCounterRef = useRef(0)
  /** Bumped by the engine at TRADE NOW purely to re-run the fire effect. */
  const [tradeNowKey, setTradeNowKey] = useState(0)

  const { state, predictions, setPredictions, analyze, generatePrediction, getMatchPrediction, switchSymbol } = useDerivStream(selectedSymbol)

  autoTradeRef.current = autoTrade
  stakeRef.current = stake

  const pushLog = useCallback((kind: AutoTradeLogEntry['kind'], text: string) => {
    logIdRef.current += 1
    setAutoLog(prev => [{ id: logIdRef.current, time: Date.now(), kind, text }, ...prev].slice(0, 80))
  }, [])

  /** Tracks an open contract to its settlement so the log and stats stay honest. */
  const trackContract = useCallback((contractId: string, label: string, stakePlaced: number, payout: number) => {
    let settled = false
    let unsubscribe: () => void = () => { /* replaced below */ }
    let guard: ReturnType<typeof setTimeout> | undefined

    const finish = (profit: number) => {
      if (settled) return
      settled = true
      unsubscribe()
      if (guard) clearTimeout(guard)
      const won = profit > 0
      setAutoStats(prev => accumulateSettlement(prev, { stake: stakePlaced, payout, profit }))
      pushLog(
        won ? 'win' : 'loss',
        `${label} ${won ? 'WON' : 'LOST'} — ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} ${session.currency} (contract ${contractId})`
      )
    }

    unsubscribe = client.onMessage(message => {
      const poc = message.proposal_open_contract as Record<string, unknown> | undefined
      if (!poc) return
      if (String(poc.contract_id) !== contractId) return
      if (poc.is_sold) finish(Number(poc.profit ?? 0))
    })

    guard = setTimeout(() => {
      if (settled) return
      settled = true
      unsubscribe()
    }, 90000)

    void client
      .request({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 })
      .catch(() => { /* settlement stream is best-effort */ })
  }, [client, pushLog, session.currency])

  const fireAutoTrade = useCallback(async (digit: number, confidence: number) => {
    const amount = stakeRef.current
    // Which side of the locked digit we bet is the whole ballgame: DIGITMATCH
    // needs it to repeat (~1 in 10), DIGITDIFF only needs it not to (~9 in 10).
    const cfg = CONTRACT_MODES.find(m => m.mode === contractMode) ?? CONTRACT_MODES[0]
    pushLog(
      'trade',
      `${cfg.label} signal → ${cfg.contractType} on predicted digit ${digit} @ ${confidence.toFixed(1)}% — placing ${amount} ${session.currency} stake`
    )
    try {
      const result = await client.buyContract({
        symbol: selectedSymbol,
        contractType: cfg.contractType,
        stake: amount,
        currency: session.currency,
        barrier: String(digit),
        duration: 1,
        durationUnit: 't',
      })
      pushLog(
        'trade',
        `Contract ${result.contractId} bought at ${result.buyPrice.toFixed(2)} — payout ${result.payout.toFixed(2)}`
      )
      trackContract(result.contractId, `${cfg.contractType} ${digit}`, result.buyPrice, result.payout)
    } catch (err) {
      pushLog('error', err instanceof Error ? err.message : 'Trade could not be placed.')
    }
  }, [client, selectedSymbol, session.currency, pushLog, trackContract, contractMode])

  const handleQuickTrade = useCallback(async (kind: QuickTradeKind) => {
    const digit = state.lastDigit ?? 5
    const config: Record<QuickTradeKind, { type: string; barrier: string; label: string }> = {
      match: { type: 'DIGITMATCH', barrier: String(digit), label: `DIGITMATCH ${digit}` },
      differ: { type: 'DIGITDIFF', barrier: String(digit), label: `DIGITDIFF ${digit}` },
      over: { type: 'DIGITOVER', barrier: '4', label: 'DIGITOVER 4' },
      under: { type: 'DIGITUNDER', barrier: '5', label: 'DIGITUNDER 5' },
    }
    const cfg = config[kind]
    setQuickTradeBusy(kind)
    setQuickTradeMessage(null)
    pushLog('trade', `Manual ${cfg.label} — stake ${stake} ${session.currency}`)
    try {
      const result = await client.buyContract({
        symbol: selectedSymbol,
        contractType: cfg.type,
        stake,
        currency: session.currency,
        barrier: cfg.barrier,
        duration: 1,
        durationUnit: 't',
      })
      setQuickTradeMessage({
        kind: 'ok',
        text: `${cfg.label} placed — contract ${result.contractId}, payout ${result.payout.toFixed(2)} ${session.currency}.`,
      })
      trackContract(result.contractId, cfg.label, result.buyPrice, result.payout)
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Trade could not be placed.'
      setQuickTradeMessage({ kind: 'err', text })
      pushLog('error', text)
    } finally {
      setQuickTradeBusy(null)
    }
  }, [client, selectedSymbol, session.currency, stake, state.lastDigit, pushLog, trackContract])

  const handleTargetLocked = useCallback((digit: number, confidence: number) => {
    setTargetDigit(digit)
    setTargetConfidence(confidence)
    setWatching(false)
    tradedTargetRef.current = null
    pushLog('signal', `Predicted digit locked — digit ${digit} at ${confidence.toFixed(1)}% confidence`)
  }, [pushLog])

  const handleWatchStart = useCallback((digit: number) => {
    setWatching(true)
    if (autoTradeRef.current) pushLog('info', `Armed — entry countdown running for predicted digit ${digit}`)
  }, [pushLog])

  /**
   * The engine's TRADE NOW hand-off: the predicted digit is locked and the
   * post-lock entry countdown (5-4-3-2-1) has finished. This is the one moment
   * the auto trader places a contract, and it is the engine that decides it —
   * the tick stream is not consulted.
   */
  const handleTradeNow = useCallback((digit: number, confidence: number) => {
    handoffCounterRef.current += 1
    tradeHandoffRef.current = { digit, confidence, key: handoffCounterRef.current }
    setTradeNowKey(k => k + 1)
    pushLog(
      'signal',
      `TRADE NOW — entry countdown complete on predicted digit ${digit} (${confidence.toFixed(1)}% confidence)`,
    )
  }, [pushLog])

  /**
   * The engine telling the trader the predicted digit has turned up on a real
   * tick. The contract was already placed at the TRADE NOW hand-off, so this
   * only confirms and scores the round.
   */
  const handleTickFound = useCallback((digit: number) => {
    pushLog('signal', `Predicted digit ${digit} printed — round confirmed as a win`)
  }, [pushLog])

  // Place the contract at the engine's TRADE NOW hand-off.
  //
  // Driven by a consumed-once hand-off rather than by component state: an
  // effect keyed on `targetDigit` would re-run when the *next* round locked a
  // new digit and fire that trade before its countdown had even started. The
  // hand-off carries its own digit/confidence, and `consumedHandoffRef` means a
  // single TRADE NOW can never produce two contracts.
  useEffect(() => {
    const handoff = tradeHandoffRef.current
    if (!handoff || consumedHandoffRef.current === handoff.key) return

    const now = Date.now()
    const decision = decideAutoFire({
      autoTrade,
      tradeNow: true,
      targetDigit: handoff.digit,
      targetConfidence: handoff.confidence,
      minConfidence,
      alreadyTradedTarget: tradedTargetRef.current,
      now,
      lastTradeAt: lastTradeAtRef.current,
    })

    if (decision === 'throttled') return

    // Consumed either way: a hand-off that is skipped or filtered out must not
    // be reconsidered on the next render.
    consumedHandoffRef.current = handoff.key

    if (decision === 'idle') return

    if (decision === 'skip-confidence') {
      tradedTargetRef.current = handoff.digit
      setWatching(false)
      pushLog(
        'info',
        `TRADE NOW on digit ${handoff.digit} but the trade was skipped — signal confidence ${handoff.confidence.toFixed(1)}% is below the ${minConfidence}% filter.`,
      )
      return
    }

    tradedTargetRef.current = handoff.digit
    lastTradeAtRef.current = now
    setWatching(false)
    void fireAutoTrade(handoff.digit, handoff.confidence)
  }, [tradeNowKey, autoTrade, minConfidence, fireAutoTrade, pushLog])

  // Reset the arming state whenever auto trading is switched off.
  useEffect(() => {
    if (!autoTrade) {
      setWatching(false)
      tradedTargetRef.current = null
    }
  }, [autoTrade])

  // Session guard — stop trading once the profit target or max loss is hit, so
  // the Profit target / Max loss columns are real limits and not just labels.
  useEffect(() => {
    if (!autoTrade || autoStats.trades === 0) return
    const hitTarget = profitTarget > 0 && autoStats.pnl >= profitTarget
    const hitStop = maxLoss > 0 && autoStats.pnl <= -maxLoss
    if (!hitTarget && !hitStop) return
    setAutoTrade(false)
    setWatching(false)
    pushLog(
      hitTarget ? 'win' : 'loss',
      hitTarget
        ? `Profit target reached (+${autoStats.pnl.toFixed(2)} ${session.currency}) — auto trade stopped.`
        : `Max loss reached (${autoStats.pnl.toFixed(2)} ${session.currency}) — auto trade stopped.`
    )
  }, [autoTrade, autoStats.trades, autoStats.pnl, profitTarget, maxLoss, pushLog, session.currency])

  const toggleAutoTrade = useCallback(() => {
    setAutoTrade(prev => {
      const next = !prev
      pushLog(next ? 'info' : 'info', next
        ? `Auto trade ACTIVATED — Matches, stake ${stakeRef.current} ${session.currency}, min confidence ${minConfidence}%`
        : 'Auto trade stopped')
      // Starting the round here is what makes one click enough: the trader is
      // armed AND the Matches flow begins scanning.
      if (next) setRunToken(t => t + 1)
      return next
    })
  }, [pushLog, minConfidence, session.currency])


  // Track last digit history for SignalGenerator
  useEffect(() => {
    if (state.lastDigit != null && state.lastDigit !== prevLastDigitRef.current) {
      prevLastDigitRef.current = state.lastDigit
      setLastDigitHistory(prev => [...prev, state.lastDigit!].slice(-50))
    }
  }, [state.lastDigit])

  const handleSymbolChange = useCallback((sym: string) => {
    setSelectedSymbol(sym)
    switchSymbol(sym)
    setAnalysisResult(null)
    setCountdownActive(false)
    setMatchNumber(0)
  }, [switchSymbol])

  /**
   * Commits an edited Trade-columns cell.
   *
   * Setup columns write straight to their own state. The session-total columns
   * are normally derived from settlements, so editing one is treated as a manual
   * override of the running totals — that is what makes them genuinely editable
   * (e.g. carrying a balance in, or correcting a column). Editing Total payout
   * recomputes P/L from it so the two stay consistent.
   */
  const handleEditStat = useCallback((field: StatField, raw: string) => {
    const parsed = Number(raw)
    const n = Number.isFinite(parsed) ? parsed : 0
    const money = () => Math.max(0, n)
    const count = () => Math.max(0, Math.round(n))

    switch (field) {
      case 'stake': setStake(Math.max(0.35, n)); break
      case 'risk': setRisk(money()); break
      case 'profitTarget': setProfitTarget(money()); break
      case 'maxLoss': setMaxLoss(money()); break
      case 'market': if (raw) handleSymbolChange(raw); break
      case 'totalStake': setAutoStats(prev => ({ ...prev, totalStake: money() })); break
      case 'totalPayout':
        setAutoStats(prev => {
          const totalPayout = money()
          return { ...prev, totalPayout, pnl: totalPayout - prev.totalStake }
        })
        break
      case 'runs': setAutoStats(prev => ({ ...prev, trades: count() })); break
      case 'won': setAutoStats(prev => ({ ...prev, wins: count() })); break
      case 'lost': setAutoStats(prev => ({ ...prev, losses: count() })); break
      case 'pnl': setAutoStats(prev => ({ ...prev, pnl: n })); break
    }
  }, [handleSymbolChange])

  const handleAnalyze = useCallback(() => {
    if (isScanning || countdownActive) return
    setIsScanning(true)
    setTimeout(() => {
      const result = analyze(selectedStrategy)
      setAnalysisResult(result)
      setIsScanning(false)
      setMatchNumber(prev => prev + 1)
      setCountdownActive(true)
    }, 1200)
  }, [analyze, selectedStrategy, isScanning, countdownActive])

  const handlePredict = useCallback(() => {
    setIsPredicting(true)
    const pred = generatePrediction(selectedStrategy)
    const newPred = {
      ...pred,
      prediction: analysisResult?.message ?? pred.prediction,
      confidence: analysisResult?.strength ?? pred.confidence,
    }
    setPredictions(prev => [newPred, ...prev].slice(0, 100))
    setTimeout(() => setIsPredicting(false), 500)
  }, [generatePrediction, selectedStrategy, analysisResult, setPredictions])

  const handleSignalGenerate = useCallback((tickOffset: number = 2) => {
    const matchPred = getMatchPrediction(tickOffset)
    return {
      predictedDigit: matchPred.predictedDigit,
      differDigit: matchPred.differDigit,
      confidence: matchPred.confidence,
      message: matchPred.reasoning,
      signalState: matchPred.signalState,
      estimatedProbability: matchPred.estimatedProbability,
      baseline: matchPred.baseline,
      modelAgreement: matchPred.modelAgreement,
      modelAgreementCount: matchPred.modelAgreementCount,
      totalModels: matchPred.totalModels,
      regime: matchPred.regime,
      allScores: matchPred.allScores,
    }
  }, [getMatchPrediction])

  // Stable reference so SignalGenerator's collection effect isn't torn down each render.
  const handleMatchAnalyze = useCallback(() => {
    const matchPred = getMatchPrediction(2)
    return {
      predictedDigit: matchPred.predictedDigit,
      confidence: matchPred.confidence,
      digitProbabilities: matchPred.digitProbabilities,
    }
  }, [getMatchPrediction])

  const handleCountdownComplete = useCallback(() => {
    setCountdownActive(false)

    if (predictions.length > 0) {
      const latestPred = { ...predictions[0] }
      const actualUp = state.priceChange >= 0
      let result: 'win' | 'loss' = 'loss'

      if (latestPred.strategy === 'rise_fall') {
        const predType = analysisResult?.type ?? 'neutral'
        result = (predType === 'buy' && actualUp) || (predType === 'sell' && !actualUp) ? 'win' : 'loss'
      } else if (latestPred.strategy === 'even_odd') {
        result = state.lastDigit != null
          ? ((state.lastDigit % 2 === 0 && latestPred.prediction.includes('Even')) ||
             (state.lastDigit % 2 !== 0 && latestPred.prediction.includes('Odd'))) ? 'win' : 'loss'
          : 'loss'
      } else if (latestPred.strategy === 'matches') {
        const matchDigit = state.lastDigit ?? -1
        const predictedDigit = latestPred.predictedMatchDigit ?? -1
        result = matchDigit === predictedDigit ? 'win' : 'loss'
      } else if (latestPred.strategy === 'over_under') {
        const isOver = latestPred.prediction.includes('OVER')
        result = (isOver && (state.lastDigit ?? 0) >= 5) || (!isOver && (state.lastDigit ?? 0) < 5) ? 'win' : 'loss'
      } else {
        result = Math.random() > 0.42 ? 'win' : 'loss'
      }

      setPredictions(prev => prev.map(p =>
        p.id === latestPred.id ? { ...p, result } : p
      ))
    }

    if (autoMode) {
      autoIntervalRef.current = setTimeout(() => handleAnalyze(), 1500)
    }
  }, [predictions, state, autoMode, handleAnalyze, setPredictions, analysisResult])

  useEffect(() => {
    return () => clearTimeout(autoIntervalRef.current)
  }, [])

  const activeStrategy = STRATEGIES.find(s => s.type === selectedStrategy)
  const confidenceColor = (c: number) => c > 80 ? 'text-emerald-400' : c > 60 ? 'text-amber-400' : 'text-red-400'
  const isMatches = selectedStrategy === 'matches'

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="bg-[#0a0a1a] border-b border-gray-800 sticky top-0 z-30 shadow-sm">
        <div className="max-w-[1800px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg shadow-green-500/20">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">
                  <span className="bg-gradient-to-r from-red-400 via-white to-green-400 bg-clip-text text-transparent">
                    Deriv AI
                  </span>{' '}
                  <span className="text-gray-400 font-normal">Matches Predictor</span>
                </h1>
                <p className="text-[10px] text-gray-500">
                  Real-time Volatility data • AI confidence scoring • Live predictions
                </p>
              </div>
            </div>
            <MarketSelector
              selectedSymbol={selectedSymbol}
              onSelect={handleSymbolChange}
              connected={state.connected}
              currentPrice={state.currentPrice}
              priceChange={state.priceChange}
              priceChangePercent={state.priceChangePercent}
            />
          </div>
        </div>
      </header>

      <main className="max-w-[1800px] mx-auto px-4 py-4">
        {/* Quick Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
          <QuickStat
            icon={<Activity className="w-4 h-4" />}
            label="Price"
            value={state.currentPrice != null ? state.currentPrice.toFixed(5) : '---'}
            sub={state.connected ? (state.dataMode === 'deriv' ? 'Live from Deriv' : 'Simulated') : 'Connecting...'}
            color={state.connected ? (state.dataMode === 'deriv' ? 'text-emerald-400' : 'text-amber-400') : 'text-red-400'}
          />
          <QuickStat
            icon={<Crosshair className="w-4 h-4" />}
            label="Last Digit"
            value={state.lastDigit != null ? state.lastDigit.toString() : '---'}
            sub={`${state.tickHistory.length} ticks`}
            color="text-blue-400"
          />
          <QuickStat
            icon={<ArrowLeftRight className="w-4 h-4" />}
            label="Differ"
            value={state.differDigit != null ? state.differDigit.toString() : '---'}
            sub={state.previousLastDigit != null ? `${state.previousLastDigit}→${state.lastDigit}` : 'waiting'}
            color="text-purple-400"
          />
          <QuickStat
            icon={<Gauge className="w-4 h-4" />}
            label="Volatility"
            value={state.volatility.toFixed(6)}
            sub="avg movement"
            color="text-amber-400"
          />
          <QuickStat
            icon={<BarChart3 className="w-4 h-4" />}
            label="Predictions"
            value={predictions.length}
            sub={`${predictions.filter(p => p.result === 'win').length} wins`}
            color="text-purple-400"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column: Chart + Digits */}
          <div className="lg:col-span-4 space-y-4">
            {/* Price Chart */}
            <div className="bg-[#1a1a2e] rounded-xl border border-gray-700 overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
                <div className="flex items-center gap-2">
                  <TrendingUp className={cn('w-4 h-4', state.priceChange >= 0 ? 'text-emerald-500' : 'text-red-500')} />
                  <span className="text-sm font-medium text-gray-300">Live Price Chart</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  {state.tickHistory.length} ticks
                </div>
              </div>
              <div className="h-64 p-2">
                <PriceChart ticks={state.tickHistory} currentPrice={state.currentPrice} symbol={selectedSymbol} />
              </div>
            </div>

            {/* Digit Heatmap */}
            <div className="bg-[#1a1a2e] rounded-xl border border-gray-700 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium text-gray-300">Digit Distribution</span>
                <span className="text-[10px] text-gray-400 ml-auto">🔥 Hot • ❄️ Cold</span>
              </div>
              <DigitHeatmap digitCounts={state.digitCounts} lastDigit={state.lastDigit} />
            </div>

            {/* Price Range */}
            <div className="bg-[#1a1a2e] rounded-xl border border-gray-700 p-4 shadow-sm">
              <div className="text-xs text-gray-400 mb-2">Session Range</div>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="text-[10px] text-gray-400">LOW</div>
                  <div className="text-sm font-mono font-bold text-blue-400">
                    {state.low24h?.toFixed(5) ?? '---'}
                  </div>
                </div>
                <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden relative">
                  {state.currentPrice != null && state.low24h != null && state.high24h != null && (
                    <div
                      className="absolute h-3 w-1 bg-gradient-to-r from-blue-500 via-amber-500 to-red-500 rounded-full -top-0.5"
                      style={{
                        left: `${((state.currentPrice - state.low24h) / (state.high24h - state.low24h || 1)) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-gray-400">HIGH</div>
                  <div className="text-sm font-mono font-bold text-red-400">
                    {state.high24h?.toFixed(5) ?? '---'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Center Column: Strategy + Signal / Buttons + Countdown + AI Confidence */}
          <div className="lg:col-span-4 space-y-4">
            {/* Strategy Panel */}
            <div className="bg-[#1a1a2e] rounded-xl border border-gray-700 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium text-gray-300">Strategy</span>
              </div>
              <StrategyPanel
                selected={selectedStrategy}
                onSelect={setSelectedStrategy}
                analysis={analysisResult}
                isScanning={isScanning}
              />
            </div>

            {/* ============= MATCHES: GENERATE SIGNAL ============= */}
            {isMatches && (
              <SignalGenerator
                onAnalyze={handleMatchAnalyze}
                connected={state.connected}
                lastDigit={state.lastDigit}
                lastDigitHistory={lastDigitHistory}
                onTargetLocked={handleTargetLocked}
                onWatchStart={handleWatchStart}
                onTradeNow={handleTradeNow}
                onTickFound={handleTickFound}
                runToken={runToken}
              />
            )}

            {/* ============= OTHER STRATEGIES: Analyze + Predict + Countdown ============= */}
            {!isMatches && (
              <>
                {/* Analyze + Predict Buttons */}
                <div className="bg-[#1a1a2e] rounded-xl border border-gray-700 p-4 shadow-sm space-y-2">
                  <button
                    onClick={handleAnalyze}
                    disabled={isScanning || countdownActive || !state.connected}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 py-3 rounded-lg font-medium text-sm transition-all',
                      'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-500 hover:to-indigo-500',
                      'disabled:opacity-40 disabled:cursor-not-allowed shadow-md'
                    )}
                  >
                    {isScanning ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Analyzing {activeStrategy?.label}...</>
                    ) : (
                      <><Activity className="w-4 h-4" /> Analyze Market</>
                    )}
                  </button>

                  <button
                    onClick={handlePredict}
                    disabled={isPredicting || !analysisResult || !state.connected}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 py-3 rounded-lg font-medium text-sm transition-all',
                      'bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500',
                      'disabled:opacity-40 disabled:cursor-not-allowed shadow-md'
                    )}
                  >
                    {isPredicting ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Predicting...</>
                    ) : (
                      <><Target className="w-4 h-4" /> Predict on Match</>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      if (autoMode) {
                        setAutoMode(false)
                        clearTimeout(autoIntervalRef.current)
                      } else {
                        setAutoMode(true)
                        handleAnalyze()
                      }
                    }}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 py-2 rounded-lg font-medium text-xs transition-all border',
                      autoMode
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                    )}
                  >
                    {autoMode ? (
                      <><Square className="w-3 h-3" /> Stop Auto Mode</>
                    ) : (
                      <><Play className="w-3 h-3" /> Start Auto Mode</>
                    )}
                  </button>
                </div>

                {/* AI Confidence Score */}
                <div className={cn(
                  'bg-[#1a1a2e] rounded-xl border border-gray-700 p-4 shadow-sm transition-all',
                  analysisResult?.type === 'buy' ? 'border-emerald-500/30' :
                  analysisResult?.type === 'sell' ? 'border-red-500/30' : 'border-gray-700'
                )}>
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-medium text-gray-300">AI Confidence</span>
                  </div>

                  {analysisResult ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {analysisResult.type === 'buy' && <ArrowUp className="w-5 h-5 text-emerald-500" />}
                          {analysisResult.type === 'sell' && <ArrowDown className="w-5 h-5 text-red-500" />}
                          {analysisResult.type === 'neutral' && <Activity className="w-5 h-5 text-gray-400" />}
                          <span className={cn(
                            'text-sm font-bold uppercase',
                            analysisResult.type === 'buy' ? 'text-emerald-400' :
                            analysisResult.type === 'sell' ? 'text-red-400' : 'text-gray-400'
                          )}>
                            {analysisResult.type === 'buy' ? 'BUY Signal' : analysisResult.type === 'sell' ? 'SELL Signal' : 'NEUTRAL'}
                          </span>
                        </div>
                        <span className={cn('text-lg font-mono font-bold', confidenceColor(analysisResult.strength))}>
                          {analysisResult.strength.toFixed(1)}%
                        </span>
                      </div>

                      <div className="w-full bg-gray-700 rounded-full h-2.5 overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-700',
                            analysisResult.strength > 80 ? 'bg-emerald-500' :
                            analysisResult.strength > 60 ? 'bg-amber-500' : 'bg-red-500'
                          )}
                          style={{ width: `${analysisResult.strength}%` }}
                        />
                      </div>

                      <p className="text-xs text-gray-500 font-mono leading-relaxed">
                        {analysisResult.message}
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
                        <div className="bg-gray-800/50 rounded-lg py-1.5 border border-gray-700">
                          <div className="text-[10px] text-gray-400 uppercase">Strategy</div>
                          <div className="text-xs font-medium text-gray-300">{activeStrategy?.icon} {activeStrategy?.label}</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg py-1.5 border border-gray-700">
                          <div className="text-[10px] text-gray-400 uppercase">Digit</div>
                          <div className="text-xs font-mono font-bold text-gray-200">{state.lastDigit ?? '---'}</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg py-1.5 border border-gray-700">
                          <div className="text-[10px] text-gray-400 uppercase">Match</div>
                          <div className="text-xs font-mono font-bold text-gray-200">#{matchNumber}</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-sm text-gray-400">
                      Click <span className="font-medium text-blue-400">Analyze Market</span> to get AI confidence
                    </div>
                  )}
                </div>

                {/* 5-Second Trade Entry Countdown */}
                <div className={cn(
                  'bg-[#1a1a2e] rounded-xl border border-gray-700 p-4 shadow-sm transition-all',
                  countdownActive ? 'border-blue-500/30 ring-1 ring-blue-500/20' : 'border-gray-700'
                )}>
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <div className={cn(
                      'w-6 h-6 rounded-md flex items-center justify-center bg-gradient-to-br text-white',
                      STRATEGY_COLORS[selectedStrategy]
                    )}>
                      <span className="text-xs">{activeStrategy?.icon}</span>
                    </div>
                    <span className="text-sm font-medium text-gray-300">Trade Entry Countdown</span>
                  </div>

                  <CountdownTimer
                    duration={5}
                    isRunning={countdownActive}
                    onComplete={handleCountdownComplete}
                    label="Entry Window"
                    matchNumber={matchNumber}
                  />

                  {countdownActive && (
                    <div className="mt-3 text-center">
                      <span className="text-xs font-medium px-3 py-1 rounded-full bg-blue-500/20 text-blue-200 border border-blue-500/40">
                        {activeStrategy?.label} • {selectedSymbol} • Match #{matchNumber}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}

          </div>

          {/* Right Column: Broker + Auto Trade + History + Settings + Metrics */}
          <div className="lg:col-span-4 space-y-4">
            {/* Deriv Broker */}
            <DerivBroker
              session={session}
              client={client}
              onDisconnect={onDisconnect}
              onUpdateSession={onUpdateSession}
              onQuickTrade={handleQuickTrade}
              quickTradeBusy={quickTradeBusy}
              quickTradeMessage={quickTradeMessage}
              lastDigit={state.lastDigit}
              connected={state.connected}
              onReconnect={onReconnect}
              reconnecting={reconnecting}
              reconnectError={reconnectError}
              onSwitchAccount={onSwitchAccount}
            />

            {/* Model Settings */}
            <ModelSettings params={modelParams} onChange={setModelParams} />

            {/* Validation Metrics */}
            <ValidationMetrics predictions={predictions} />

            {/* History */}
            <div className="bg-[#1a1a2e] rounded-xl border border-gray-700 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-medium text-gray-300">Prediction History</span>
                </div>
                <span className="text-[10px] text-gray-400 bg-gray-800 px-2 py-0.5 rounded-full">
                  {predictions.length} total
                </span>
              </div>
              <PredictionHistory predictions={predictions} />
            </div>
          </div>
        </div>

        {/* Auto Trade spans the full width here rather than sitting in the
            right-hand column: the 11 trade columns and the log get the whole
            row, which is the space the narrower column was leaving empty. */}
        <div className="mt-4">
          <AutoTradePanel
            session={session}
            active={autoTrade}
            onToggle={toggleAutoTrade}
            stake={stake}
            onStakeChange={setStake}
            minConfidence={minConfidence}
            onMinConfidenceChange={setMinConfidence}
            profitTarget={profitTarget}
            onProfitTargetChange={setProfitTarget}
            maxLoss={maxLoss}
            onMaxLossChange={setMaxLoss}
            market={selectedSymbol}
            log={autoLog}
            stats={autoStats}
            targetDigit={targetDigit}
            targetConfidence={targetConfidence}
            watching={watching}
            streamLive={state.dataMode === 'deriv'}
            contractMode={contractMode}
            onContractModeChange={setContractMode}
            risk={risk}
            onEditStat={handleEditStat}
            markets={VOLATILITY_MARKETS}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 bg-[#0a0a1a] mt-6 py-3">
        <div className="max-w-[1800px] mx-auto px-4 flex items-center justify-between text-[10px] text-gray-400">
        <span>Deriv AI Matches Predictor • Real-time Volatility data from Deriv</span>
        <span className="flex items-center gap-1">
          <span className={cn('w-1.5 h-1.5 rounded-full', state.connected ? (state.dataMode === 'deriv' ? 'bg-emerald-500' : 'bg-amber-500') : 'bg-red-500')} />
          {state.connected ? (state.dataMode === 'deriv' ? 'Live Deriv Data' : 'Simulated Data') : 'Connecting...'}
        </span>
        </div>
      </footer>
    </div>
  )
}

function QuickStat({ icon, label, value, sub, color }: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub: string
  color: string
}) {
  return (
    <div className="bg-[#1a1a2e] rounded-xl border border-gray-700 p-3 shadow-sm">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={color}>{icon}</span>
        <span className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className={cn('text-lg font-bold font-mono tabular-nums', color)}>
        {value}
      </div>
      <div className="text-[10px] text-gray-400">{sub}</div>
    </div>
  )
}
