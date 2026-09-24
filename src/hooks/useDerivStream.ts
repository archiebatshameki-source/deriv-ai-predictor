import { useState, useEffect, useRef, useCallback } from 'react'
import type { TickData, DigitAnalysis, StrategyType, Prediction } from '../lib/deriv-types'

const DERIV_PRIMARY = 'wss://api.derivws.com/trading/v1/options/ws/public?app_id=1089'

const SIM_PRICES: Record<string, number> = {
  R_10: 5439, R_10S: 5439,
  R_25: 5128, R_25S: 5128,
  R_50: 4876, R_50S: 4876,
  R_75: 8234, R_75S: 8234,
  R_100: 9567, R_100S: 9567,
}

export type SignalState = 'high' | 'medium' | 'no_signal'

export type MarketState = {
  connected: boolean
  dataMode: 'deriv' | 'simulation'
  currentPrice: number | null
  previousPrice: number | null
  lastDigit: number | null
  previousLastDigit: number | null
  differDigit: number | null
  tickHistory: TickData[]
  digitCounts: DigitAnalysis[]
  priceChange: number
  priceChangePercent: number
  high24h: number | null
  low24h: number | null
  volatility: number
}

export type AnalysisSignal = {
  type: 'buy' | 'sell' | 'neutral'
  strength: number
  strategy: StrategyType
  message: string
}

export type MatchPrediction = {
  predictedDigit: number
  differDigit: number
  confidence: number
  direction: 'buy' | 'sell' | 'neutral'
  reasoning: string
  score: number
  allScores: number[]
  regime: string
  entropy: number
  digitProbabilities: number[]
  signalState: SignalState
  estimatedProbability: number
  baseline: number
  modelAgreement: number
  modelAgreementCount: number
  totalModels: number
}

const BASELINE = 0.1 // 10% — uniform probability per digit

const INITIAL_STATE: MarketState = {
  connected: false,
  dataMode: 'simulation',
  currentPrice: null,
  previousPrice: null,
  lastDigit: null,
  previousLastDigit: null,
  differDigit: null,
  tickHistory: [],
  digitCounts: Array.from({ length: 10 }, (_, i) => ({
    digit: i, count: 0, percentage: 0, predicted: false,
  })),
  priceChange: 0,
  priceChangePercent: 0,
  high24h: null,
  low24h: null,
  volatility: 0,
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function extractDigit(price: number): number {
  const s = price.toFixed(2)
  return parseInt(s[s.length - 1], 10)
}

function extractDigits(prices: number[]): number[] {
  return prices.map(extractDigit)
}

function digitFreq(digits: number[]): number[] {
  const freq = Array(10).fill(0)
  for (const d of digits) freq[d]++
  return freq
}

function normalize(scores: number[]): number[] {
  const sum = scores.reduce((a, b) => a + b, 0) || 1
  return scores.map(s => s / sum)
}

function shannonEntropy(probs: number[]): number {
  let entropy = 0
  for (const p of probs) {
    if (p > 0) entropy -= p * Math.log2(p)
  }
  return entropy
}

function chiSquaredTest(observed: number[], expected: number[]): number {
  let chi2 = 0
  for (let i = 0; i < observed.length; i++) {
    const e = expected[i] || 0.001
    chi2 += Math.pow(observed[i] - e, 2) / e
  }
  return chi2
}

function computeState(buffer: TickData[], prev: MarketState): Partial<MarketState> {
  if (buffer.length === 0) return {}
  const latest = buffer[buffer.length - 1]
  const lastDigit = extractDigit(latest.quote)

  let previousLastDigit = prev.lastDigit
  if (buffer.length >= 2) {
    previousLastDigit = extractDigit(buffer[buffer.length - 2].quote)
  }

  const differDigit = previousLastDigit != null ? Math.abs(lastDigit - previousLastDigit) : null

  const counts = Array.from({ length: 10 }, (_, i) => {
    const count = buffer.filter(t => extractDigit(t.quote) === i).length
    return { digit: i, count, percentage: buffer.length > 0 ? (count / buffer.length) * 100 : 0, predicted: false }
  })

  const prices = buffer.map(t => t.quote)
  const high = Math.max(...prices)
  const low = Math.min(...prices)
  const changes: number[] = []
  for (let i = 1; i < Math.min(buffer.length, 50); i++) {
    changes.push(Math.abs(buffer[i].quote - buffer[i - 1].quote))
  }
  const avgVol = changes.reduce((a, b) => a + b, 0) / (changes.length || 1)
  const firstPrice = buffer.length > 100 ? buffer[buffer.length - 100].quote : buffer[0].quote

  return {
    connected: true,
    currentPrice: latest.quote,
    previousPrice: latest.previousQuote ?? prev.currentPrice,
    lastDigit,
    previousLastDigit,
    differDigit,
    tickHistory: buffer.slice(-500),
    digitCounts: counts,
    priceChange: latest.quote - firstPrice,
    priceChangePercent: ((latest.quote - firstPrice) / firstPrice) * 100,
    high24h: high,
    low24h: low,
    volatility: avgVol,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5 ROLLING WINDOWS — W20, W50, W100, W500, W1000
// ═══════════════════════════════════════════════════════════════════════════════

function getWindow(digits: number[], size: number): number[] {
  return digits.slice(-Math.min(size, digits.length))
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORING ENGINE 1: FrequencyScore(d)
// Compare each digit's frequency across windows against uniform baseline
// ═══════════════════════════════════════════════════════════════════════════════

function frequencyScore(digits: number[]): number[] {
  const windows = [20, 50, 100, 500, 1000]
  const windowWeights = [0.30, 0.25, 0.20, 0.15, 0.10]
  const scores = Array(10).fill(0)

  for (let w = 0; w < windows.length; w++) {
    const slice = getWindow(digits, windows[w])
    if (slice.length === 0) continue
    const freq = digitFreq(slice)
    const expected = slice.length / 10

    for (let d = 0; d < 10; d++) {
      const deviation = (freq[d] - expected) / (expected || 1)
      scores[d] += deviation * windowWeights[w]
    }
  }

  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const range = max - min || 1
  return scores.map(s => (s - min) / range)
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORING ENGINE 2: TransitionScore(d) — P(next | context)
// Markov/n-gram: test 1-digit, 2-digit, 3-digit context
// ═══════════════════════════════════════════════════════════════════════════════

function transitionScore(digits: number[]): number[] {
  const scores = Array(10).fill(0)
  if (digits.length < 20) return normalize(scores)

  const decay = (age: number) => Math.exp(-age * 0.004)

  // ── 1-digit context: P(next | prev) ──
  const trans1: number[][] = Array.from({ length: 10 }, () => Array(10).fill(0))
  for (let i = 1; i < digits.length; i++) {
    trans1[digits[i - 1]][digits[i]] += decay(digits.length - 1 - i)
  }

  // ── 2-digit context: P(next | prev, prev-1) ──
  const trans2 = new Map<string, number[]>()
  for (let i = 2; i < digits.length; i++) {
    const key = `${digits[i - 2]}${digits[i - 1]}`
    if (!trans2.has(key)) trans2.set(key, Array(10).fill(0))
    trans2.get(key)![digits[i]] += decay(digits.length - 1 - i)
  }

  // ── 3-digit context: P(next | prev-2, prev-1, prev) ──
  const trans3 = new Map<string, number[]>()
  for (let i = 3; i < digits.length; i++) {
    const key = `${digits[i - 3]}${digits[i - 2]}${digits[i - 1]}`
    if (!trans3.has(key)) trans3.set(key, Array(10).fill(0))
    trans3.get(key)![digits[i]] += decay(digits.length - 1 - i)
  }

  const last1 = digits[digits.length - 1]
  const last2 = digits[digits.length - 2]
  const last3 = digits[digits.length - 3]

  // Context confidence: how much data exists for each context length
  const key1 = `${last1}`
  const key2 = `${last2}${last1}`
  const key3 = `${last3}${last2}${last1}`

  const trans1Row = trans1[last1]
  const trans1Sum = trans1Row.reduce((a, b) => a + b, 0) || 1
  const trans2Row = trans2.get(key2)
  const trans2Sum = trans2Row ? trans2Row.reduce((a, b) => a + b, 0) : 0
  const trans3Row = trans3.get(key3)
  const trans3Sum = trans3Row ? trans3Row.reduce((a, b) => a + b, 0) : 0

  // Weight by context availability (more data = more weight)
  const w1 = trans1Sum > 5 ? 0.30 : 0.15
  const w2 = trans2Sum > 3 ? 0.35 : 0.15
  const w3 = trans3Sum > 2 ? 0.35 : 0.15
  const wTotal = w1 + w2 + w3

  for (let d = 0; d < 10; d++) {
    const s1 = trans1Row[d] / trans1Sum
    const s2 = trans2Row ? trans2Row[d] / trans2Sum : BASELINE
    const s3 = trans3Row ? trans3Row[d] / trans3Sum : BASELINE
    scores[d] = (s1 * w1 + s2 * w2 + s3 * w3) / wTotal
  }

  return normalize(scores)
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORING ENGINE 3: RecencyScore(d) — Exponential decay weighting
// ═══════════════════════════════════════════════════════════════════════════════

function recencyScore(digits: number[]): number[] {
  const scores = Array(10).fill(0)
  if (digits.length < 10) return normalize(scores)

  for (let i = 0; i < digits.length; i++) {
    const age = digits.length - 1 - i
    const weight = Math.exp(-age * 0.008)
    scores[digits[i]] += weight
  }

  return normalize(scores)
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORING ENGINE 4: PatternScore(d) — Bigram, trigram, cycle, alternation
// ═══════════════════════════════════════════════════════════════════════════════

function patternScore(digits: number[]): number[] {
  const scores = Array(10).fill(0)
  if (digits.length < 15) return normalize(scores)

  // Bigram pattern (2-digit context)
  if (digits.length >= 3) {
    const bigramNext = new Map<number, number>()
    for (let i = 2; i < digits.length; i++) {
      if (digits[i - 2] === digits[digits.length - 2] && digits[i - 1] === digits[digits.length - 1]) {
        const age = digits.length - 1 - i
        bigramNext.set(digits[i], (bigramNext.get(digits[i]) ?? 0) + Math.exp(-age * 0.01))
      }
    }
    let total = 0
    for (const v of bigramNext.values()) total += v
    if (total > 0) {
      for (const [d, w] of bigramNext) scores[d] += (w / total) * 0.3
    }
  }

  // Trigram pattern (3-digit context)
  if (digits.length >= 4) {
    const last3 = digits.slice(-3)
    const trigramNext = new Map<number, number>()
    for (let i = 3; i < digits.length; i++) {
      if (digits[i - 3] === last3[0] && digits[i - 2] === last3[1] && digits[i - 1] === last3[2]) {
        const age = digits.length - 1 - i
        trigramNext.set(digits[i], (trigramNext.get(digits[i]) ?? 0) + Math.exp(-age * 0.015))
      }
    }
    let total = 0
    for (const v of trigramNext.values()) total += v
    if (total > 0) {
      for (const [d, w] of trigramNext) scores[d] += (w / total) * 0.25
    }
  }

  // Cycle detection (length 2-8)
  for (let cycleLen = 2; cycleLen <= Math.min(8, Math.floor(digits.length / 3)); cycleLen++) {
    let matchCount = 0, checkCount = 0
    const start = Math.max(0, digits.length - cycleLen * 5)
    for (let i = start; i < digits.length - cycleLen; i++) {
      if (digits[i] === digits[i + cycleLen]) matchCount++
      checkCount++
    }
    if (checkCount > 0 && matchCount / checkCount > 0.3) {
      scores[digits[digits.length - cycleLen]] += (matchCount / checkCount) * 0.15
    }
  }

  // Alternation (A-B-A-B)
  if (digits.length >= 4) {
    const last4 = digits.slice(-4)
    if (last4[0] === last4[2] && last4[1] === last4[3] && last4[0] !== last4[1]) {
      scores[last4[0]] += 0.15
    }
  }

  // Anti-streak: penalize repeated digits after 3+ streak
  let streakCount = 1
  const lastDigit = digits[digits.length - 1]
  for (let i = digits.length - 2; i >= 0; i--) {
    if (digits[i] === lastDigit) streakCount++
    else break
  }
  if (streakCount >= 3) {
    scores[lastDigit] -= 0.1
    for (let d = 0; d < 10; d++) {
      if (d !== lastDigit) scores[d] += 0.015
    }
  }

  const minS = Math.min(...scores)
  if (minS < 0) {
    for (let d = 0; d < 10; d++) scores[d] -= minS
  }

  return normalize(scores)
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORING ENGINE 5: RegimeScore(d) — Classify and score by market regime
// ═══════════════════════════════════════════════════════════════════════════════

type RegimeType = 'stable' | 'concentrated' | 'changing' | 'random'

function classifyRegime(digits: number[]): { regime: RegimeType; scores: number[]; measurable: boolean } {
  if (digits.length < 50) {
    return { regime: 'stable', scores: normalize(Array(10).fill(1)), measurable: false }
  }

  const w20 = getWindow(digits, 20)
  const w50 = getWindow(digits, 50)
  const w100 = getWindow(digits, 100)

  // Entropy of W50 — is the distribution near-uniform?
  const freq50 = digitFreq(w50)
  const probs50 = freq50.map(c => c / 50)
  const entropy = shannonEntropy(probs50)
  const maxEntropy = Math.log2(10)
  const normalizedEntropy = entropy / maxEntropy

  // Chi-squared: how far from uniform?
  const expected = Array(10).fill(5) // 50/10
  const chi2 = chiSquaredTest(freq50, expected)

  // Concentration: std deviation of digit frequencies
  const mean = 5
  const variance = freq50.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / 10
  const concentration = Math.sqrt(variance)

  // Change rate: distribution shift between W20 and W50
  const freq20 = digitFreq(w20)
  let shift = 0
  for (let d = 0; d < 10; d++) {
    shift += Math.abs(freq20[d] / 20 - freq50[d] / 50)
  }

  // Streak analysis
  let maxStreak = 1, curStreak = 1
  for (let i = digits.length - 2; i >= Math.max(0, digits.length - 50); i--) {
    if (digits[i] === digits[i + 1]) { curStreak++; maxStreak = Math.max(maxStreak, curStreak) }
    else curStreak = 1
  }

  // Cross-window agreement: do W20, W50, W100 agree on the top digit?
  const topDigitW20 = freq20.indexOf(Math.max(...freq20))
  const topDigitW50 = freq50.indexOf(Math.max(...freq50))
  const freq100 = digitFreq(w100)
  const topDigitW100 = freq100.indexOf(Math.max(...freq100))
  const agreement = [topDigitW20 === topDigitW50, topDigitW50 === topDigitW100, topDigitW20 === topDigitW100]
    .filter(Boolean).length

  let regime: RegimeType
  let measurable = true

  if (normalizedEntropy > 0.93) {
    // Near-uniform → data is essentially random
    regime = 'random'
    measurable = false
  } else if (shift > 0.25 && concentration > 3) {
    // Distribution is rapidly changing
    regime = 'changing'
  } else if (concentration > 3.5 && maxStreak >= 3 && agreement >= 2) {
    // Distribution is concentrated around certain digits
    regime = 'concentrated'
  } else if (normalizedEntropy > 0.85 && shift < 0.15) {
    // Stable, detectable structure
    regime = 'stable'
  } else {
    regime = 'stable'
  }

  const scores = Array(10).fill(0)
  if (regime === 'random') {
    // Uniform scores — no actionable signal
    for (let d = 0; d < 10; d++) scores[d] = 1
  } else if (regime === 'concentrated') {
    // Follow the concentration
    for (let d = 0; d < 10; d++) scores[d] = (freq50[d] / 50) * 2
  } else if (regime === 'changing') {
    // Weight recent data much more heavily
    for (let d = 0; d < 10; d++) scores[d] = (freq20[d] / 20) * 2
  } else {
    // Stable — use W100 with slight recency boost
    for (let d = 0; d < 10; d++) scores[d] = (freq100[d] / 100) * 1.5 + (freq50[d] / 50) * 0.5
  }

  return { regime, scores: normalize(scores), measurable }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGIME FILTER — Before prediction, check if data is worth predicting
// ═══════════════════════════════════════════════════════════════════════════════

function regimeFilter(digits: number[]): { pass: boolean; regime: RegimeType; reason: string } {
  if (digits.length < 50) {
    return { pass: false, regime: 'stable', reason: 'Collecting data — need 50+ ticks' }
  }

  const w50 = getWindow(digits, 50)
  const freq = digitFreq(w50)
  const probs = freq.map(c => c / 50)
  const entropy = shannonEntropy(probs)
  const maxEntropy = Math.log2(10)
  const normalizedEntropy = entropy / maxEntropy

  // Chi-squared test against uniform
  const chi2 = chiSquaredTest(freq, Array(10).fill(5))

  // Distribution shift: W20 vs W100
  const w20 = getWindow(digits, 20)
  const w100 = getWindow(digits, 100)
  const freq20 = digitFreq(w20)
  const freq100 = digitFreq(w100)
  let shift = 0
  for (let d = 0; d < 10; d++) {
    shift += Math.abs(freq20[d] / 20 - freq100[d] / 100)
  }

  // Near-uniform / random → NO SIGNAL
  if (normalizedEntropy > 0.93) {
    return { pass: false, regime: 'random', reason: `Near-random distribution (entropy: ${(normalizedEntropy * 100).toFixed(0)}%) — no measurable pattern` }
  }

  // Very low chi-squared → data doesn't deviate enough from uniform
  if (chi2 < 3.0) {
    return { pass: false, regime: 'random', reason: `Low chi-squared (${chi2.toFixed(1)}) — distribution too close to uniform` }
  }

  // Rapidly changing → reduced confidence but allow signal
  if (shift > 0.3) {
    return { pass: true, regime: 'changing', reason: `Rapidly changing distribution (shift: ${(shift * 100).toFixed(0)}%) — reduced confidence` }
  }

  // Stable with measurable structure
  if (chi2 >= 3.0 && normalizedEntropy < 0.90) {
    return { pass: true, regime: 'stable', reason: `Stable distribution with measurable structure (χ²: ${chi2.toFixed(1)})` }
  }

  // Concentrated
  const concentration = Math.sqrt(freq.reduce((sum, c) => sum + Math.pow(c - 5, 2), 0) / 10)
  if (concentration > 3) {
    return { pass: true, regime: 'concentrated', reason: `Concentrated around certain digits (σ: ${concentration.toFixed(1)})` }
  }

  return { pass: true, regime: 'stable', reason: 'Measurable deviation from uniform' }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ANALYSIS — Combine 5 scoring engines + regime filter + 3-state signal
// ═══════════════════════════════════════════════════════════════════════════════

function analyzeMatches(
  prices: number[],
  _symbol: string,
  tickOffset: number = 2,
): MatchPrediction {
  const digits = extractDigits(prices)

  const defaultPred: MatchPrediction = {
    predictedDigit: 0, differDigit: 0, confidence: 0, direction: 'neutral',
    reasoning: 'Collecting data — need 15+ ticks', score: 0,
    allScores: Array(10).fill(0), regime: 'stable', entropy: 0,
    digitProbabilities: Array(10).fill(BASELINE),
    signalState: 'no_signal', estimatedProbability: BASELINE,
    baseline: BASELINE, modelAgreement: 0, modelAgreementCount: 0, totalModels: 5,
  }

  if (digits.length < 15) return defaultPred

  const lastDigit = digits[digits.length - 1]
  const prevDigit = digits[digits.length - 2]
  const differ = Math.abs(lastDigit - prevDigit)

  // ── STEP 1: REGIME FILTER — Check if data is worth predicting ──
  const filter = regimeFilter(digits)

  // ── STEP 2: Run 5 scoring engines ──
  const freqScores = frequencyScore(digits)
  const transScores = transitionScore(digits)
  const recScores = recencyScore(digits)
  const patScores = patternScore(digits)
  const { scores: regimeScores, regime, measurable } = classifyRegime(digits)

  // ── STEP 3: Weighted ensemble ──
  // Weights: Freq=0.25, Transition=0.25, Recency=0.15, Pattern=0.15, Regime=0.20
  const W = { freq: 0.25, trans: 0.25, rec: 0.15, pat: 0.15, regime: 0.20 }

  const rawScores = Array(10).fill(0)
  for (let d = 0; d < 10; d++) {
    rawScores[d] =
      freqScores[d] * W.freq +
      transScores[d] * W.trans +
      recScores[d] * W.rec +
      patScores[d] * W.pat +
      regimeScores[d] * W.regime
  }

  const finalScores = normalize(rawScores)
  const estimatedProb = finalScores

  // ── STEP 4: Find top digit ──
  const sorted = finalScores.map((score, digit) => ({ digit, score }))
    .sort((a, b) => b.score - a.score)

  const bestDigit = sorted[0].digit
  const secondScore = sorted[1].score
  const bestScore = sorted[0].score
  const scoreGap = bestScore - secondScore

  // ── STEP 5: Model agreement — how many scoring engines agree on the top digit ──
  const engineTopDigits = [
    freqScores.indexOf(Math.max(...freqScores)),
    transScores.indexOf(Math.max(...transScores)),
    recScores.indexOf(Math.max(...recScores)),
    patScores.indexOf(Math.max(...patScores)),
    regimeScores.indexOf(Math.max(...regimeScores)),
  ]
  const agreementCount = engineTopDigits.filter(d => d === bestDigit).length
  const agreement = agreementCount / 5

  // ── STEP 6: Statistical test ──
  const chi2 = chiSquaredTest(
    finalScores.map(s => s * 10),
    Array(10).fill(1)
  )

  // ── STEP 7: Entropy ──
  const entropy = shannonEntropy(finalScores)
  const maxEntropy = Math.log2(10)

  // ── STEP 8: Confidence calculation ──
  const estimatedProbOfBest = estimatedProb[bestDigit]
  const excess = estimatedProbOfBest - BASELINE // How much above 10% baseline

  // Base confidence from excess probability
  let confidence = BASELINE + excess * 300 // Scale up

  // Bonus for model agreement
  confidence += agreement * 12

  // Bonus for score gap (top vs second)
  confidence += scoreGap * 15

  // Bonus for chi-squared (statistical evidence)
  confidence += Math.min(10, chi2 * 0.5)

  // ── STEP 9: Apply regime penalties ──
  if (!filter.pass) {
    // Regime filter failed → NO SIGNAL
    confidence = Math.min(confidence, BASELINE * 100 + 2)
  } else if (regime === 'changing') {
    confidence *= 0.75
  } else if (regime === 'concentrated') {
    confidence *= 1.05
  }

  // Entropy penalty: near-random = heavy penalty
  const normalizedEntropy = entropy / maxEntropy
  if (normalizedEntropy > 0.90) confidence *= 0.6
  if (normalizedEntropy > 0.85) confidence *= 0.8

  confidence = Math.max(0, Math.min(95, confidence))

  // ── STEP 10: Determine signal state ──
  let signalState: SignalState
  if (!filter.pass || confidence <= BASELINE * 100 + 5) {
    signalState = 'no_signal'
    confidence = 0
  } else if (confidence >= 18 && agreement >= 0.6 && excess > 0.01) {
    signalState = 'high'
  } else if (confidence >= 12 && excess > 0.005) {
    signalState = 'medium'
  } else {
    signalState = 'no_signal'
    confidence = 0
  }

  // ── Build reasoning ──
  const reasoning = [
    `Freq:${(freqScores[bestDigit] * 100).toFixed(1)}%`,
    `Trans:${(transScores[bestDigit] * 100).toFixed(1)}%`,
    `Rec:${(recScores[bestDigit] * 100).toFixed(1)}%`,
    `Pat:${(patScores[bestDigit] * 100).toFixed(1)}%`,
    `Reg:${(regimeScores[bestDigit] * 100).toFixed(1)}%`,
    `χ²:${chi2.toFixed(1)}`,
    `Gap:${(scoreGap * 100).toFixed(1)}%`,
  ].join(' | ')

  return {
    predictedDigit: bestDigit,
    differDigit: differ,
    confidence: Math.round(confidence * 10) / 10,
    direction: 'neutral',
    reasoning,
    score: bestScore,
    allScores: finalScores,
    regime: filter.reason,
    entropy,
    digitProbabilities: finalScores,
    signalState,
    estimatedProbability: Math.round(estimatedProbOfBest * 1000) / 10,
    baseline: BASELINE * 100,
    modelAgreement: Math.round(agreement * 100),
    modelAgreementCount: agreementCount,
    totalModels: 5,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET HOOK — Real Deriv connection + simulation fallback
// ═══════════════════════════════════════════════════════════════════════════════

export function useDerivStream(symbol: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const [state, setState] = useState<MarketState>(INITIAL_STATE)
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const tickBufferRef = useRef<TickData[]>([])
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const simTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const symbolRef = useRef(symbol)
  const gotRealDataRef = useRef(false)
  const failoverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  symbolRef.current = symbol

  const updateState = useCallback(() => {
    setState(prev => ({ ...prev, ...computeState(tickBufferRef.current, prev) }))
  }, [])

  const stopSim = useCallback(() => {
    if (simTimerRef.current) { clearInterval(simTimerRef.current); simTimerRef.current = undefined }
  }, [])

  const startSim = useCallback((sym: string) => {
    stopSim()
    const base = SIM_PRICES[sym] ?? 5000
    const is1s = sym.endsWith('S')
    let price = base + (Math.random() - 0.5) * base * 0.02
    const speed = is1s ? 500 : sym.includes('100') ? 600 : sym.includes('75') ? 800 : 1000

    if (tickBufferRef.current.length < 50) {
      const histPrices: TickData[] = []
      let histPrice = base + (Math.random() - 0.5) * base * 0.01
      const baseTime = Math.floor(Date.now() / 1000) - 200
      for (let i = 0; i < 200; i++) {
        const vol = base * 0.0006
        histPrice += (Math.random() - 0.502) * vol
        histPrice = Math.max(base * 0.98, Math.min(base * 1.02, histPrice))
        histPrices.push({
          symbol: sym,
          epoch: baseTime + Math.floor((i * speed) / 1000),
          quote: parseFloat(histPrice.toFixed(5)),
          previousQuote: histPrices.length > 0 ? histPrices[histPrices.length - 1].quote : undefined,
        })
      }
      tickBufferRef.current = histPrices
      price = histPrice
      updateState()
    }

    let tickCount = 0
    simTimerRef.current = setInterval(() => {
      tickCount++
      const vol = base * 0.0006
      const drift = (Math.random() - 0.502) * vol
      const jump = Math.random() < 0.015 ? (Math.random() - 0.5) * base * 0.003 : 0
      const noise = (Math.random() - 0.5) * vol * 0.3
      price = Math.max(base * 0.98, Math.min(base * 1.02, price + drift + jump + noise))
      const prevEpoch = tickBufferRef.current.length > 0
        ? tickBufferRef.current[tickBufferRef.current.length - 1].epoch
        : Math.floor(Date.now() / 1000) - 1
      const newEpoch = Math.floor(Date.now() / 1000) + (speed < 600 ? Math.floor(tickCount / 2) : 0)
      const uniqueEpoch = Math.max(prevEpoch + 1, newEpoch)
      const tick: TickData = {
        symbol: sym,
        epoch: uniqueEpoch,
        quote: parseFloat(price.toFixed(5)),
        previousQuote: tickBufferRef.current.length > 0
          ? tickBufferRef.current[tickBufferRef.current.length - 1].quote
          : undefined,
      }
      tickBufferRef.current.push(tick)
      if (tickBufferRef.current.length > 1200) tickBufferRef.current.shift()
      updateState()
    }, speed)
  }, [stopSim, updateState])

  const connectWs = useCallback((url: string, sym: string) => {
    try {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            ticks_history: sym,
            adjust_start_time: 1,
            count: 1000,
            end: 'latest',
            style: 'ticks',
            subscribe: 1,
          }))
        }
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.error) return

          if (data.history && data.history.prices) {
            gotRealDataRef.current = true
            stopSim()
            setState(prev => ({ ...prev, dataMode: 'deriv' }))
            const ticks: TickData[] = data.history.prices.map((price: number, i: number) => ({
              symbol: sym,
              epoch: data.history.times?.[i] ?? Math.floor(Date.now() / 1000) - (data.history.prices.length - i),
              quote: price,
              previousQuote: i > 0 ? data.history.prices[i - 1] : undefined,
            }))
            tickBufferRef.current = ticks
            updateState()
          }

          if (data.tick) {
            gotRealDataRef.current = true
            stopSim()
            setState(prev => ({ ...prev, dataMode: 'deriv' }))
            const tick: TickData = {
              symbol: data.tick.symbol ?? sym,
              epoch: data.tick.epoch,
              quote: data.tick.quote,
              previousQuote: tickBufferRef.current.length > 0
                ? tickBufferRef.current[tickBufferRef.current.length - 1].quote
                : undefined,
            }
            tickBufferRef.current.push(tick)
            if (tickBufferRef.current.length > 1200) tickBufferRef.current.shift()
            updateState()
          }
        } catch { /* ignore */ }
      }

      ws.onerror = () => {
        setState(prev => ({ ...prev, connected: false }))
      }

      ws.onclose = () => {
        setState(prev => ({ ...prev, connected: false }))
        reconnectTimerRef.current = setTimeout(() => connect(), 3000)
      }

      return ws
    } catch {
      return null
    }
  }, [stopSim, updateState])

  const connect = useCallback(() => {
    if (wsRef.current) {
      const old = wsRef.current
      wsRef.current = null
      try { old.close() } catch { /* noop */ }
    }

    gotRealDataRef.current = false
    clearTimeout(failoverTimerRef.current)
    const curSymbol = symbolRef.current

    const ws = connectWs(DERIV_PRIMARY, curSymbol)

    if (ws) {
      failoverTimerRef.current = setTimeout(() => {
        if (!gotRealDataRef.current) {
          try { ws.close() } catch { /* noop */ }
          setState(prev => ({ ...prev, connected: true, dataMode: 'simulation' }))
          startSim(curSymbol)
        }
      }, 4000)
    } else {
      setState(prev => ({ ...prev, connected: true, dataMode: 'simulation' }))
      startSim(curSymbol)
    }
  }, [connectWs, startSim])

  const switchSymbol = useCallback((newSymbol: string) => {
    clearTimeout(reconnectTimerRef.current)
    clearTimeout(failoverTimerRef.current)
    stopSim()
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        try { wsRef.current.send(JSON.stringify({ forget_all: 'ticks' })) } catch { /* noop */ }
      }
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }
    tickBufferRef.current = []
    symbolRef.current = newSymbol
    gotRealDataRef.current = false
    setState(INITIAL_STATE)
    reconnectTimerRef.current = setTimeout(() => connect(), 300)
  }, [connect, stopSim])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimerRef.current)
      clearTimeout(failoverTimerRef.current)
      stopSim()
      if (wsRef.current) {
        wsRef.current.onclose = null
        try {
          if (wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ forget_all: 'ticks' }))
          }
        } catch { /* noop */ }
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect, stopSim])

  const getMatchPrediction = useCallback((tickOffset: number = 2): MatchPrediction => {
    const buffer = tickBufferRef.current
    if (buffer.length < 15) {
      return {
        predictedDigit: 0, differDigit: 0, confidence: 0, direction: 'neutral',
        reasoning: 'Collecting data...', score: 0, allScores: Array(10).fill(0),
        regime: 'Collecting data', entropy: 0, digitProbabilities: Array(10).fill(BASELINE),
        signalState: 'no_signal', estimatedProbability: BASELINE,
        baseline: BASELINE * 100, modelAgreement: 0, modelAgreementCount: 0, totalModels: 5,
      }
    }
    const prices = buffer.map(t => t.quote)
    return analyzeMatches(prices, symbolRef.current, tickOffset)
  }, [])

  const analyze = useCallback((strategy: StrategyType): AnalysisSignal => {
    const buffer = tickBufferRef.current
    if (buffer.length < 3) {
      return { type: 'neutral', strength: 0, strategy, message: 'Collecting data...' }
    }

    const prices = buffer.map(t => t.quote)
    const digits = extractDigits(prices)
    const lastDigit = digits[digits.length - 1]
    const currentPrice = prices[prices.length - 1]

    const momentum = (arr: number[], n: number) => arr.length < n ? 0 : arr[arr.length - 1] - arr[arr.length - n]
    const movingAvg = (arr: number[], n: number) => { const s = arr.slice(-Math.min(n, arr.length)); return s.reduce((a, b) => a + b, 0) / s.length }
    const bollingerBands = (arr: number[], period = 20) => { const s = arr.slice(-Math.min(period, arr.length)); const m = s.reduce((a, b) => a + b, 0) / s.length; const sd = Math.sqrt(s.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / s.length); return { upper: m + 2 * sd, lower: m - 2 * sd, middle: m } }
    const rsiCalc = (p: number[], period = 14) => { if (p.length < period + 1) return 50; let gains = 0, losses = 0; for (let i = p.length - period; i < p.length; i++) { const diff = p[i] - p[i - 1]; if (diff > 0) gains += diff; else losses -= diff }; return losses === 0 ? 100 : gains === 0 ? 0 : 100 - 100 / (1 + gains / losses) }
    const emaCalc = (arr: number[], period: number) => { if (arr.length === 0) return 0; const k = 2 / (period + 1); let val = arr[0]; for (let i = 1; i < arr.length; i++) val = arr[i] * k + val * (1 - k); return val }

    if (strategy === 'matches') {
      const match = getMatchPrediction()
      return {
        type: match.direction,
        strength: match.confidence,
        strategy,
        message: `PREDICTED: ${match.predictedDigit} | Differ: ${match.differDigit} | Confidence: ${match.confidence}%`,
      }
    }

    switch (strategy) {
      case 'over_under': {
        const isOver = lastDigit >= 5
        const mom = momentum(prices, 5)
        const rsiVal = rsiCalc(prices)
        const bb = bollingerBands(prices)
        const nearUpper = currentPrice > bb.upper * 0.998
        const nearLower = currentPrice < bb.lower * 1.002
        let adjustedOver = isOver
        if (nearUpper) adjustedOver = false
        if (nearLower) adjustedOver = true
        const confidence = Math.min(92, 55 + Math.abs(mom) * 5000 + (rsiVal > 70 || rsiVal < 30 ? 10 : 0))
        return { type: adjustedOver ? 'buy' : 'sell', strength: confidence, strategy, message: `${adjustedOver ? 'OVER' : 'UNDER'} ${lastDigit} | RSI: ${rsiVal.toFixed(1)}` }
      }
      case 'rise_fall': {
        const trend = momentum(prices, 5)
        const trend10 = momentum(prices, 10)
        const emaVal = emaCalc(prices, 9)
        const aboveEma = currentPrice > emaVal
        const aligned = (trend > 0 && trend10 > 0) || (trend < 0 && trend10 < 0)
        const confidence = Math.min(93, 55 + (aligned ? 10 : 0) + Math.abs(trend) * 8000)
        return { type: trend > 0 ? 'buy' : 'sell', strength: confidence, strategy, message: `${trend > 0 ? 'Rising' : 'Falling'} | EMA9: ${aboveEma ? 'Above' : 'Below'}` }
      }
      case 'higher_lower': {
        const ma5 = movingAvg(prices, 5)
        const ma10 = movingAvg(prices, 10)
        const ma20 = movingAvg(prices, 20)
        const aboveAll = currentPrice > ma5 && currentPrice > ma10 && currentPrice > ma20
        const belowAll = currentPrice < ma5 && currentPrice < ma10 && currentPrice < ma20
        const isHigher = currentPrice > ma10
        const gap = Math.abs(currentPrice - ma10)
        const avgRange = movingAvg(prices.map((p, i) => i > 0 ? Math.abs(p - prices[i - 1]) : 0).slice(1), 20)
        const gapRatio = avgRange > 0 ? gap / avgRange : 0
        const confidence = Math.min(90, 52 + gapRatio * 15 + (aboveAll || belowAll ? 12 : 0))
        return { type: isHigher ? 'buy' : 'sell', strength: confidence, strategy, message: `${isHigher ? 'HIGHER' : 'LOWER'}${aboveAll ? ' Above All' : belowAll ? ' Below All' : ''}` }
      }
      case 'touch_no_touch': {
        const high = Math.max(...prices.slice(-50))
        const low = Math.min(...prices.slice(-50))
        const range = high - low
        const distFromHigh = high - currentPrice
        const distFromLow = currentPrice - low
        const willTouch = distFromHigh < range * 0.12 || distFromLow < range * 0.12
        const bb = bollingerBands(prices)
        const nearBand = currentPrice > bb.upper * 0.999 || currentPrice < bb.lower * 1.001
        const confidence = Math.min(88, 55 + (nearBand ? 10 : 0) + (willTouch ? 5 : 3))
        return { type: willTouch ? 'buy' : 'sell', strength: confidence, strategy, message: `Touch: ${willTouch ? 'YES' : 'NO'}${nearBand ? ' NearBand' : ''}` }
      }
      case 'even_odd': {
        const isEven = lastDigit % 2 === 0
        const last20 = digits.slice(-20)
        const recentEvens = last20.filter(d => d % 2 === 0).length
        const recentOdds = last20.length - recentEvens
        let sc = 1, sd = lastDigit
        for (let i = digits.length - 2; i >= 0; i--) { if (digits[i] === sd) sc++; else break }
        const streakBias = sc >= 3 ? sd % 2 === 0 ? -5 : 5 : 0
        const confidence = Math.min(90, 50 + Math.abs(recentEvens - recentOdds) * 2 + streakBias)
        return { type: isEven ? 'buy' : 'sell', strength: confidence, strategy, message: `Recent E${recentEvens}/O${recentOdds} | Streak: ${sc}x | ${isEven ? 'Even' : 'Odd'}` }
      }
      default:
        return { type: 'neutral', strength: 0, strategy, message: 'Unknown strategy' }
    }
  }, [getMatchPrediction])

  const generatePrediction = useCallback((strategy: StrategyType): Prediction => {
    const signal = analyze(strategy)
    const buffer = tickBufferRef.current
    const currentDigit = buffer.length > 0 ? extractDigit(buffer[buffer.length - 1].quote) : 0

    let predictedMatchDigit: number | undefined
    let differDigit: number | undefined

    if (strategy === 'matches') {
      const matchPred = getMatchPrediction()
      predictedMatchDigit = matchPred.predictedDigit
      differDigit = matchPred.differDigit
    }

    return {
      id: `pred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      symbol: symbolRef.current,
      strategy,
      prediction: signal.message,
      confidence: signal.strength,
      result: 'pending',
      lastDigit: currentDigit,
      matchNumber: buffer.length,
      predictedMatchDigit,
      differDigit,
    }
  }, [analyze, getMatchPrediction])

  return { state, predictions, setPredictions, analyze, generatePrediction, getMatchPrediction, switchSymbol }
}
