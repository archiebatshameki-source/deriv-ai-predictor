import { useCallback, useEffect, useState } from 'react'
import { cn } from '../lib/cn'
import type { DerivAccount, DerivClient, DerivSession } from '../lib/deriv-api'
import {
  Wallet, RefreshCw, Loader2, LogOut, TrendingUp, TrendingDown,
  Minus, BadgeCheck, FlaskConical, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react'

export type QuickTradeKind = 'match' | 'differ' | 'over' | 'under'

type Props = {
  session: DerivSession
  client: DerivClient
  onDisconnect: () => void
  onUpdateSession: (patch: Partial<DerivSession>) => void
  onQuickTrade: (kind: QuickTradeKind) => void
  quickTradeBusy: string | null
  quickTradeMessage: { kind: 'ok' | 'err'; text: string } | null
  lastDigit: number | null
  connected: boolean
  onReconnect: () => void
  reconnecting: boolean
  reconnectError: string | null
  onSwitchAccount: (account: DerivAccount) => Promise<void>
}

const STAKES = [0.35, 1, 2, 5, 10]

function money(value: number | null, currency: string): string {
  if (value == null) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

export function DerivBroker({
  session, client, onDisconnect, onUpdateSession, onQuickTrade,
  quickTradeBusy, quickTradeMessage, lastDigit, connected,
  onReconnect, reconnecting, reconnectError, onSwitchAccount,
}: Props) {
  const [refreshing, setRefreshing] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  // Tracks this panel's own connection health, not the tick stream's.
  const [brokerOnline, setBrokerOnline] = useState(connected)

  const live = session.accounts.filter(a => !a.isVirtual)
  const demo = session.accounts.filter(a => a.isVirtual)
  const visibleAccounts = showAll ? session.accounts : session.accounts.slice(0, 4)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setSwitchError(null)
    try {
      const balance = await client.getBalance()
      setBrokerOnline(true)
      if (balance != null) {
        // Rebuild the list rather than mutating session.accounts in place.
        const accounts = session.accounts.map(account =>
          account.loginid === session.loginid ? { ...account, balance } : account
        )
        onUpdateSession({ balance, accounts })
      }
    } catch (err) {
      setBrokerOnline(false)
      setSwitchError(err instanceof Error ? err.message : 'Could not refresh balance.')
    } finally {
      setRefreshing(false)
    }
  }, [client, onUpdateSession, session.accounts, session.loginid])

  // Keep the balance fresh without hammering Deriv.
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, 30000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  const switchTo = useCallback(async (account: DerivAccount) => {
    if (account.loginid === session.loginid) return
    setSwitching(account.loginid)
    setSwitchError(null)
    try {
      // Delegated upward: OAuth sockets are account-scoped and need a fresh OTP,
      // while PAT sessions switch in place. The parent knows which mode we're in.
      await onSwitchAccount(account)
    } catch (err) {
      setSwitchError(
        err instanceof Error ? `Could not switch account: ${err.message}` : 'Could not switch account.'
      )
    } finally {
      setSwitching(null)
    }
  }, [onSwitchAccount, session.loginid])

  return (
    <div className="bg-[#1a1a2e] rounded-xl border border-gray-700 p-4 shadow-sm space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Wallet className="w-4 h-4 text-emerald-500" />
        <span className="text-sm font-medium text-gray-300">Deriv Broker</span>
        <span
          className={cn(
            'ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border',
            brokerOnline
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
          )}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', brokerOnline ? 'bg-emerald-500' : 'bg-amber-500')} />
          {brokerOnline ? 'Online' : 'Offline'}
        </span>
      </div>

      {!brokerOnline && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span className="text-[11px] text-amber-300 leading-relaxed min-w-0 break-words">
              {reconnectError ?? 'Deriv connection is down — the balances below may be stale.'}
            </span>
          </div>
          <button
            onClick={onReconnect}
            disabled={reconnecting}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[11px] font-medium hover:bg-amber-500/20 transition-all disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3 h-3', reconnecting && 'animate-spin')} />
            {reconnecting ? 'Reconnecting…' : 'Reconnect to Deriv'}
          </button>
        </div>
      )}

      {/* Active account */}
      <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-transparent p-3.5">
        <div className="flex items-center justify-between mb-2">
          <span
            className={cn(
              'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold',
              session.isVirtual
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            )}
          >
            {session.isVirtual ? 'Demo account' : 'Live account'}
          </span>
          <button
            onClick={() => void refresh()}
            disabled={refreshing}
            className="text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
            title="Refresh balance"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
          </button>
        </div>

        <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
          {money(session.balance, session.currency)}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-gray-400">
          <span className="flex items-center gap-1 font-mono text-gray-300">
            <BadgeCheck className="w-3 h-3 text-emerald-500" />
            {session.loginid}
          </span>
          <span>{session.currency}</span>
          {session.company && <span className="truncate max-w-[11rem]">{session.company}</span>}
        </div>

        {session.fullname && (
          <div className="text-[10px] text-gray-500 mt-1">{session.fullname}</div>
        )}
      </div>

      {quickTradeMessage && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px]',
            quickTradeMessage.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          )}
        >
          {quickTradeMessage.kind === 'ok'
            ? <TrendingUp className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
          <span className="min-w-0 break-words">{quickTradeMessage.text}</span>
        </div>
      )}

      {/* Quick trade */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">Quick trade</span>
          <span className="text-[10px] text-gray-600 font-mono">
            last digit: {lastDigit ?? '—'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <QuickTradeButton label="Digit Match" hint="predicts repeats" kind="match" busy={quickTradeBusy} onTrade={onQuickTrade} tone="emerald" />
          <QuickTradeButton label="Digit Differ" hint="predicts change" kind="differ" busy={quickTradeBusy} onTrade={onQuickTrade} tone="blue" />
          <QuickTradeButton label="Over 4" hint="digits 5–9" kind="over" busy={quickTradeBusy} onTrade={onQuickTrade} tone="amber" />
          <QuickTradeButton label="Under 5" hint="digits 0–4" kind="under" busy={quickTradeBusy} onTrade={onQuickTrade} tone="rose" />
        </div>
        <p className="text-[10px] text-gray-600 mt-1.5">
          Uses the stake from Auto Trade settings below. Trades go to your{' '}
          {session.isVirtual ? 'demo' : 'live'} account.
        </p>
      </div>

      {/* Accounts */}
      {(live.length > 0 || demo.length > 0) && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">Your accounts</span>
            {session.accounts.length > 4 && (
              <button
                onClick={() => setShowAll(v => !v)}
                className="ml-auto flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-gray-300"
              >
                {showAll ? 'Show less' : `Show all ${session.accounts.length}`}
                {showAll ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>

          {live.length > 0 && (
            <AccountGroup
              title="Live"
              icon={<TrendingUp className="w-3 h-3" />}
              tone="emerald"
              accounts={showAll ? live : visibleAccounts.filter(a => !a.isVirtual)}
              session={session}
              switching={switching}
              onSwitch={switchTo}
            />
          )}
          {demo.length > 0 && (
            <AccountGroup
              title="Demo"
              icon={<FlaskConical className="w-3 h-3" />}
              tone="blue"
              accounts={showAll ? demo : visibleAccounts.filter(a => a.isVirtual)}
              session={session}
              switching={switching}
              onSwitch={switchTo}
            />
          )}
        </div>
      )}

      {switchError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <span className="text-[11px] text-amber-300 leading-relaxed break-words">{switchError}</span>
        </div>
      )}

      <button
        onClick={onDisconnect}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-gray-700 bg-gray-800/60 text-gray-400 text-xs hover:bg-gray-700/60 hover:text-gray-200 transition-all"
      >
        <LogOut className="w-3 h-3" />
        Disconnect Deriv account
      </button>
    </div>
  )
}

function QuickTradeButton({ label, hint, kind, busy, onTrade, tone }: {
  label: string
  hint: string
  kind: QuickTradeKind
  busy: string | null
  onTrade: (kind: QuickTradeKind) => void
  tone: 'emerald' | 'blue' | 'amber' | 'rose'
}) {
  const tones = {
    emerald: 'border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300',
    blue: 'border-blue-500/25 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300',
    amber: 'border-amber-500/25 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300',
    rose: 'border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300',
  }
  const isBusy = busy === kind
  return (
    <button
      onClick={() => onTrade(kind)}
      disabled={busy != null}
      className={cn(
        'flex flex-col items-start px-2.5 py-2 rounded-lg border transition-all text-left',
        tones[tone],
        'disabled:opacity-50 disabled:cursor-not-allowed'
      )}
    >
      <span className="text-[11px] font-semibold leading-tight flex items-center gap-1">
        {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
        {label}
      </span>
      <span className="text-[9px] opacity-70 leading-tight">{hint}</span>
    </button>
  )
}

function AccountGroup({ title, icon, tone, accounts, session, switching, onSwitch }: {
  title: string
  icon: React.ReactNode
  tone: 'emerald' | 'blue'
  accounts: DerivAccount[]
  session: DerivSession
  switching: string | null
  onSwitch: (account: DerivAccount) => void
}) {
  if (accounts.length === 0) return null
  const accent = tone === 'emerald' ? 'text-emerald-400' : 'text-blue-400'

  return (
    <div>
      <div className={cn('flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider mb-1', accent)}>
        {icon}
        {title}
        <span className="text-gray-600 font-normal normal-case tracking-normal">({accounts.length})</span>
      </div>
      <div className="space-y-1">
        {accounts.map(account => {
          const isActive = account.loginid === session.loginid
          return (
            <button
              key={account.loginid}
              onClick={() => void onSwitch(account)}
              disabled={switching != null}
              className={cn(
                'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-all',
                isActive
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : 'border-gray-700 bg-gray-800/40 hover:bg-gray-700/50',
                'disabled:opacity-60'
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={cn('text-[11px] font-mono truncate', isActive ? 'text-emerald-300' : 'text-gray-300')}>
                    {account.loginid}
                  </span>
                  {isActive && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      Active
                    </span>
                  )}
                </span>
                <span className="block text-[10px] text-gray-500">{account.currency}</span>
              </span>
              <span className="text-[11px] font-mono tabular-nums text-gray-300 shrink-0">
                {switching === account.loginid
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : money(account.balance, account.currency)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export { STAKES, money }
