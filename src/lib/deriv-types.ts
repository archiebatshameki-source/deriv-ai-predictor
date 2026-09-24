export type MarketSymbol = {
  symbol: string
  name: string
  category: string
  description: string
}

export const VOLATILITY_MARKETS: MarketSymbol[] = [
  { symbol: 'R_10', name: 'Volatility 10 Index', category: 'Synthetics', description: 'Volatility 10 — Lower volatility' },
  { symbol: 'R_10S', name: 'Volatility 10 (1s) Index', category: 'Synthetics (1s)', description: 'Volatility 10 (1s) — Lower volatility, 1s ticks' },
  { symbol: 'R_25', name: 'Volatility 25 Index', category: 'Synthetics', description: 'Volatility 25 — Moderate volatility' },
  { symbol: 'R_25S', name: 'Volatility 25 (1s) Index', category: 'Synthetics (1s)', description: 'Volatility 25 (1s) — Moderate volatility, 1s ticks' },
  { symbol: 'R_50', name: 'Volatility 50 Index', category: 'Synthetics', description: 'Volatility 50 — Medium volatility' },
  { symbol: 'R_50S', name: 'Volatility 50 (1s) Index', category: 'Synthetics (1s)', description: 'Volatility 50 (1s) — Medium volatility, 1s ticks' },
  { symbol: 'R_75', name: 'Volatility 75 Index', category: 'Synthetics', description: 'Volatility 75 — Higher volatility' },
  { symbol: 'R_75S', name: 'Volatility 75 (1s) Index', category: 'Synthetics (1s)', description: 'Volatility 75 (1s) — Higher volatility, 1s ticks' },
  { symbol: 'R_100', name: 'Volatility 100 Index', category: 'Synthetics', description: 'Volatility 100 — Highest volatility' },
  { symbol: 'R_100S', name: 'Volatility 100 (1s) Index', category: 'Synthetics (1s)', description: 'Volatility 100 (1s) — Highest volatility, 1s ticks' },
]

export type StrategyType =
  | 'matches'
  | 'over_under'
  | 'rise_fall'
  | 'higher_lower'
  | 'touch_no_touch'
  | 'even_odd'

export const STRATEGIES: { type: StrategyType; label: string; icon: string }[] = [
  { type: 'matches', label: 'Matches', icon: '🎯' },
  { type: 'over_under', label: 'Over/Under', icon: '📊' },
  { type: 'rise_fall', label: 'Rise/Fall', icon: '📈' },
  { type: 'higher_lower', label: 'Higher/Lower', icon: '⬆️' },
  { type: 'touch_no_touch', label: 'Touch/No Touch', icon: '👆' },
  { type: 'even_odd', label: 'Even/Odd', icon: '🔢' },
]

export type TickData = {
  symbol: string
  epoch: number
  quote: number
  previousQuote?: number
}

export type DigitAnalysis = {
  digit: number
  count: number
  percentage: number
  predicted: boolean
}

export type Prediction = {
  id: string
  timestamp: number
  symbol: string
  strategy: StrategyType
  prediction: string
  confidence: number
  result?: 'win' | 'loss' | 'pending'
  lastDigit: number
  matchNumber: number
  differDigit?: number
  predictedMatchDigit?: number
}
