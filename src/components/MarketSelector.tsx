import { useState } from 'react'
import { cn } from '../lib/cn'
import { VOLATILITY_MARKETS } from '../lib/deriv-types'
import { Search, Wifi, WifiOff, TrendingUp, TrendingDown, Minus, ChevronDown } from 'lucide-react'

type MarketSelectorProps = {
  selectedSymbol: string
  onSelect: (symbol: string) => void
  connected: boolean
  currentPrice: number | null
  priceChange: number
  priceChangePercent: number
}

export function MarketSelector({
  selectedSymbol,
  onSelect,
  connected,
  currentPrice,
  priceChange,
  priceChangePercent,
}: MarketSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selected = VOLATILITY_MARKETS.find(m => m.symbol === selectedSymbol)
  const filtered = VOLATILITY_MARKETS.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.symbol.toLowerCase().includes(search.toLowerCase())
  )

  const isUp = priceChange > 0
  const isDown = priceChange < 0

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg border transition-all',
            'bg-[#1a1a2e] hover:bg-gray-700 text-sm font-medium border-gray-700',
            open && 'ring-2 ring-blue-500/30'
          )}
        >
          <span className="font-mono text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
            {selected?.symbol}
          </span>
          <span className="text-gray-300">{selected?.name}</span>
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform text-gray-400', open && 'rotate-180')} />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute top-full mt-1 left-0 w-72 bg-[#1a1a2e] border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
              <div className="p-2 border-b border-gray-700">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search volatility index..."
                    className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-800/50 rounded-lg border-0 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto p-1">
                {filtered.map(market => (
                  <button
                    key={market.symbol}
                    onClick={() => { onSelect(market.symbol); setOpen(false); setSearch('') }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors',
                      market.symbol === selectedSymbol
                        ? 'bg-blue-500/20 text-blue-300 font-medium'
                        : 'hover:bg-gray-800/50 text-gray-300'
                    )}
                  >
                    <span className="font-mono text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded w-14 text-center">
                      {market.symbol}
                    </span>
                    <div>
                      <div>{market.name}</div>
                      <div className="text-[10px] text-gray-400">{market.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <div className="flex items-center gap-1.5">
          {connected ? (
            <Wifi className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-red-500" />
          )}
          <span className={cn('text-xs font-medium', connected ? 'text-emerald-600' : 'text-red-500')}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        {currentPrice != null && (
          <>
            <div className="h-4 w-px bg-gray-200" />
            <div className="font-mono text-base font-bold tabular-nums text-gray-900">
              {currentPrice.toFixed(5)}
            </div>
            <div className={cn(
              'flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full',
              isUp ? 'bg-emerald-500/20 text-emerald-300' : isDown ? 'bg-red-500/20 text-red-300' : 'bg-gray-800 text-gray-500'
            )}>
              {isUp ? <TrendingUp className="w-3 h-3" /> : isDown ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
              <span className="font-mono">{isUp ? '+' : ''}{priceChangePercent.toFixed(3)}%</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
