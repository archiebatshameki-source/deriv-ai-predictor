import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, ColorType, CrosshairMode, LineSeries, CandlestickSeries } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts'
import { cn } from '../lib/cn'
import { LineChart, CandlestickChart } from 'lucide-react'
import type { TickData } from '../lib/deriv-types'

type PriceChartProps = {
  ticks: TickData[]
  currentPrice: number | null
  symbol: string
}

type ChartMode = 'line' | 'candle'

export function PriceChart({ ticks, currentPrice, symbol }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const [chartMode, setChartMode] = useState<ChartMode>('line')
  const initedRef = useRef(false)

  const initChart = useCallback(() => {
    if (!containerRef.current) return
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
      lineSeriesRef.current = null
      candleSeriesRef.current = null
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'white' },
        textColor: '#94a3b8',
        fontFamily: 'monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: '#f1f5f9' },
        horzLines: { color: '#f1f5f9' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 5,
        barSpacing: 6,
      },
      rightPriceScale: {
        borderColor: '#e2e8f0',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
    })

    const lineSeries = chart.addSeries(LineSeries, {
      color: '#10b981',
      lineWidth: 2,
      priceLineVisible: true,
      priceLineColor: '#10b981',
      priceLineWidth: 1,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      priceLineVisible: true,
      lastValueVisible: true,
    })

    chartRef.current = chart
    lineSeriesRef.current = lineSeries
    candleSeriesRef.current = candleSeries
    initedRef.current = true

    chart.timeScale().fitContent()
  }, [])

  useEffect(() => {
    initChart()
    const resizeObserver = new ResizeObserver(() => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    })
    if (containerRef.current) resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [initChart])

  useEffect(() => {
    if (!initedRef.current || ticks.length < 2) return

    const validTicks = ticks.filter(t => Number.isFinite(t.epoch) && t.epoch > 0)
    if (validTicks.length < 2) return

    const dedupeTimes = <T extends { time: number }>(items: T[]): T[] => {
      const result: T[] = []
      let lastTime = 0
      for (const item of items) {
        let t = item.time
        if (!Number.isFinite(t) || t <= 0) t = lastTime + 1
        if (t <= lastTime) t = lastTime + 1
        result.push({ ...item, time: t } as T)
        lastTime = t
      }
      return result
    }

    try {
      if (chartMode === 'candle') {
        lineSeriesRef.current?.applyOptions({ visible: false })
        candleSeriesRef.current?.applyOptions({ visible: true })

        const groupSize = 10
        const candleData: { time: number; open: number; high: number; low: number; close: number }[] = []
        for (let i = 0; i < validTicks.length; i += groupSize) {
          const group = validTicks.slice(i, i + groupSize)
          if (group.length === 0) continue
          const open = group[0].quote
          const close = group[group.length - 1].quote
          const high = Math.max(...group.map(g => g.quote))
          const low = Math.min(...group.map(g => g.quote))
          const midIdx = Math.floor(group.length / 2)
          candleData.push({
            time: group[midIdx].epoch,
            open, high, low, close,
          })
        }
        candleSeriesRef.current?.setData(dedupeTimes(candleData) as any[])
      } else {
        lineSeriesRef.current?.applyOptions({ visible: true })
        candleSeriesRef.current?.applyOptions({ visible: false })

        const isUp = currentPrice != null && validTicks.length > 1 && currentPrice >= validTicks[validTicks.length - 2].quote
        lineSeriesRef.current?.applyOptions({ color: isUp ? '#10b981' : '#ef4444' })

        const lineData = dedupeTimes(validTicks.map(t => ({
          time: t.epoch,
          value: t.quote,
        })))
        lineSeriesRef.current?.setData(lineData as any[])
      }

      chartRef.current?.timeScale().fitContent()
    } catch {
      // Lightweight-charts may throw on malformed time data — ignore safely
    }
  }, [ticks, chartMode, currentPrice])

  const isUp = currentPrice != null && ticks.length > 1 && currentPrice >= ticks[ticks.length - 2].quote

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center justify-between px-2 mb-1">
        <div className="flex items-center gap-1">
          {([
            { mode: 'line' as ChartMode, icon: <LineChart className="w-3 h-3" />, label: 'Line' },
            { mode: 'candle' as ChartMode, icon: <CandlestickChart className="w-3 h-3" />, label: 'Candle' },
          ]).map(({ mode, icon, label }) => (
            <button
              key={mode}
              onClick={() => setChartMode(mode)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all border',
                chartMode === mode
                  ? 'bg-violet-100 text-violet-700 border-violet-300'
                  : 'bg-gray-50 text-gray-400 border-transparent hover:bg-gray-100'
              )}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
        {currentPrice != null && (
          <div className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-mono font-bold border',
            isUp ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'
          )}>
            <span className={cn('w-1.5 h-1.5 rounded-full animate-pulse', isUp ? 'bg-emerald-500' : 'bg-red-500')} />
            {currentPrice.toFixed(5)}
          </div>
        )}
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  )
}
