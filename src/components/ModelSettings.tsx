import { useState } from 'react'
import { cn } from '../lib/cn'
import { Settings, ChevronDown, ChevronUp, RotateCcw, Zap } from 'lucide-react'

export type ModelParams = {
  learningRate: number
  iterations: number
  regularization: number
  recencyDecay: number
  ensembleWeight: number
  transitionWeight: number
  bigramWeight: number
  streakThreshold: number
  confidenceFloor: number
  confidenceCeiling: number
  windowSize: number
  tickOffset: number
  enableStatistical: boolean
  enableXGBoost: boolean
  enableRandomForest: boolean
  enableGRU: boolean
  enableTransformer: boolean
  enablePatternMining: boolean
  enableMarkovChain: boolean
  enableBaseFreq: boolean
}

export const DEFAULT_PARAMS: ModelParams = {
  learningRate: 0.15,
  iterations: 200,
  regularization: 0.01,
  recencyDecay: 0.008,
  ensembleWeight: 0.55,
  transitionWeight: 0.45,
  bigramWeight: 0.3,
  streakThreshold: 3,
  confidenceFloor: 25,
  confidenceCeiling: 92,
  windowSize: 200,
  tickOffset: 2,
  enableStatistical: true,
  enableXGBoost: true,
  enableRandomForest: true,
  enableGRU: true,
  enableTransformer: true,
  enablePatternMining: true,
  enableMarkovChain: true,
  enableBaseFreq: true,
}

type ModelSettingsProps = {
  params: ModelParams
  onChange: (params: ModelParams) => void
}

type ParamSliderProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}

function ParamSlider({ label, value, min, max, step, unit, onChange }: ParamSliderProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-500 font-medium">{label}</span>
        <span className="text-[11px] font-mono font-bold text-gray-300">
          {typeof value === 'number' && value < 1 ? value.toFixed(3) : value.toFixed(step < 0.1 ? 3 : step < 1 ? 2 : 0)}{unit ?? ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-violet-600"
      />
    </div>
  )
}

type ModelToggleProps = {
  label: string
  icon: string
  enabled: boolean
  onChange: (v: boolean) => void
}

function ModelToggle({ label, icon, enabled, onChange }: ModelToggleProps) {
  return (
    <label className={cn(
      'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all text-xs',
      enabled ? 'bg-violet-500/20 border-violet-500/30 text-violet-300' : 'bg-gray-800 border-gray-700 text-gray-400'
    )}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={e => onChange(e.target.checked)}
        className="sr-only"
      />
      <span>{icon}</span>
      <span className="font-medium">{label}</span>
      <span className={cn(
        'ml-auto w-7 h-4 rounded-full transition-all relative',
        enabled ? 'bg-violet-500' : 'bg-gray-300'
      )}>
        <span className={cn(
          'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all',
          enabled ? 'left-3.5' : 'left-0.5'
        )} />
      </span>
    </label>
  )
}

export function ModelSettings({ params, onChange }: ModelSettingsProps) {
  const [isOpen, setIsOpen] = useState(false)

  const update = (partial: Partial<ModelParams>) => {
    onChange({ ...params, ...partial })
  }

  return (
    <div className="bg-[#1a1a2e] rounded-xl border border-gray-700 shadow-sm overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-medium text-gray-300">Model Settings & Parameters</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-violet-500/20 text-violet-400 px-2 py-0.5 rounded-full font-medium">
            Advanced
          </span>
          {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-700 pt-3">
          {/* Model Selection */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Zap className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Active Models</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <ModelToggle label="Statistical" icon="📊" enabled={params.enableStatistical} onChange={v => update({ enableStatistical: v })} />
              <ModelToggle label="XGBoost" icon="🌳" enabled={params.enableXGBoost} onChange={v => update({ enableXGBoost: v })} />
              <ModelToggle label="Random Forest" icon="🌲" enabled={params.enableRandomForest} onChange={v => update({ enableRandomForest: v })} />
              <ModelToggle label="GRU" icon="🧠" enabled={params.enableGRU} onChange={v => update({ enableGRU: v })} />
              <ModelToggle label="Transformer" icon="⚡" enabled={params.enableTransformer} onChange={v => update({ enableTransformer: v })} />
              <ModelToggle label="Pattern Mining" icon="🔍" enabled={params.enablePatternMining} onChange={v => update({ enablePatternMining: v })} />
              <ModelToggle label="Markov Chain" icon="🔗" enabled={params.enableMarkovChain} onChange={v => update({ enableMarkovChain: v })} />
              <ModelToggle label="Base Frequency" icon="📐" enabled={params.enableBaseFreq} onChange={v => update({ enableBaseFreq: v })} />
            </div>
          </div>

          {/* Learning Parameters */}
          <div>
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-2">Learning Parameters</span>
            <div className="space-y-2.5">
              <ParamSlider label="Learning Rate" value={params.learningRate} min={0.01} max={0.5} step={0.01} onChange={v => update({ learningRate: v })} />
              <ParamSlider label="Iterations" value={params.iterations} min={50} max={500} step={10} onChange={v => update({ iterations: v })} />
              <ParamSlider label="Regularization (L2)" value={params.regularization} min={0} max={0.1} step={0.001} onChange={v => update({ regularization: v })} />
            </div>
          </div>

          {/* Pattern Weights */}
          <div>
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-2">Pattern Detection</span>
            <div className="space-y-2.5">
              <ParamSlider label="Recency Decay Rate" value={params.recencyDecay} min={0.001} max={0.05} step={0.001} onChange={v => update({ recencyDecay: v })} />
              <ParamSlider label="Bigram Weight" value={params.bigramWeight} min={0.05} max={0.8} step={0.05} onChange={v => update({ bigramWeight: v })} />
              <ParamSlider label="Streak Threshold" value={params.streakThreshold} min={2} max={8} step={1} onChange={v => update({ streakThreshold: v })} />
              <ParamSlider label="Analysis Window" value={params.windowSize} min={50} max={500} step={10} unit=" ticks" onChange={v => update({ windowSize: v })} />
            </div>
          </div>

          {/* Ensemble Tuning */}
          <div>
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-2">Ensemble Tuning</span>
            <div className="space-y-2.5">
              <ParamSlider label="Ensemble Weight" value={params.ensembleWeight} min={0.2} max={0.8} step={0.05} onChange={v => update({ ensembleWeight: v })} />
              <ParamSlider label="Transition Weight" value={params.transitionWeight} min={0.2} max={0.8} step={0.05} onChange={v => update({ transitionWeight: v })} />
              <ParamSlider label="Confidence Floor" value={params.confidenceFloor} min={10} max={50} step={1} unit="%" onChange={v => update({ confidenceFloor: v })} />
              <ParamSlider label="Confidence Ceiling" value={params.confidenceCeiling} min={70} max={99} step={1} unit="%" onChange={v => update({ confidenceCeiling: v })} />
            </div>
          </div>

          {/* Reset Button */}
          <button
            onClick={() => onChange(DEFAULT_PARAMS)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-gray-700 text-xs font-medium text-gray-500 hover:bg-gray-800/50 transition-all"
          >
            <RotateCcw className="w-3 h-3" />
            Reset to Defaults
          </button>
        </div>
      )}
    </div>
  )
}
