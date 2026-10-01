import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { DerivClient, type DerivSession } from '../lib/deriv-api'
import {
  DerivRestError,
  DERIV_APPS_URL,
  buildDerivSession,
  getSavedAccountId,
  getSavedAppId,
  listAccounts,
  pickDefaultAccount,
  requestOtpUrl,
  saveAccountId,
  saveAppId,
} from '../lib/deriv-rest'
import {
  Brain, ShieldCheck, ExternalLink, KeyRound, Loader2, Eye, EyeOff,
  CheckCircle2, AlertTriangle, Wifi, Lock, BadgeCheck, Fingerprint, Sparkles,
} from 'lucide-react'

type Props = {
  onConnected: (session: DerivSession, client: DerivClient) => void
  /** Context from a failed session restore, shown as a banner. */
  notice?: string | null
}

type Stage = 'idle' | 'accounts' | 'socket' | 'done' | 'error'

const STAGE_LABEL: Record<Stage, string> = {
  idle: 'Connect to Deriv',
  accounts: 'Loading your accounts…',
  socket: 'Opening trading connection…',
  done: 'Connected!',
  error: 'Connect to Deriv',
}

export function DerivAuth({ onConnected, notice }: Props) {
  const [token, setToken] = useState('')
  const [appId, setAppId] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const clientRef = useRef<DerivClient | null>(null)

  useEffect(() => {
    setAppId(getSavedAppId())
  }, [])

  const busy = stage === 'accounts' || stage === 'socket'
  const reachedDeriv = stage === 'socket' || stage === 'done'
  const loadedAccounts = stage === 'done'

  const connect = useCallback(
    async (rawToken: string, rawAppId: string) => {
      const trimmedToken = rawToken.trim()
      const trimmedAppId = rawAppId.trim()

      if (!trimmedToken) {
        setError('Paste your Deriv API token first.')
        setStage('error')
        return
      }

      setError(null)
      clientRef.current?.close()
      const client = new DerivClient()
      clientRef.current = client

      try {
        setStage('accounts')
        const accounts = await listAccounts({ token: trimmedToken, appId: trimmedAppId })
        if (accounts.length === 0) {
          throw new DerivRestError(
            'This API token has no trading accounts yet. Create one on Deriv, then try again.'
          )
        }

        saveAppId(trimmedAppId)

        // Demo first unless this browser already chose an account, so an accidental
        // click can't place a real-money trade on a fresh login.
        const active = pickDefaultAccount(accounts, getSavedAccountId())

        setStage('socket')
        const wsUrl = await requestOtpUrl({
          token: trimmedToken,
          accountId: active.accountId,
          appId: trimmedAppId,
        })
        await client.connectTo(wsUrl)

        let balance = active.balance
        try {
          balance = (await client.getBalance()) ?? balance
        } catch {
          /* the REST balance is good enough to open the dashboard with */
        }

        setStage('done')
        saveAccountId(active.accountId)
        onConnected(
          buildDerivSession({
            token: trimmedToken,
            appId: trimmedAppId,
            accounts,
            activeAccountId: active.accountId,
            balance,
          }),
          client
        )
      } catch (err) {
        client.close()
        clientRef.current = null
        setError(err instanceof Error ? err.message : 'Could not connect to Deriv.')
        setStage('error')
      }
    },
    [onConnected]
  )

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg">
        {/* Brand */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg shadow-green-500/25 mb-3">
            <Brain className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-red-400 via-white to-green-400 bg-clip-text text-transparent">
              Deriv AI
            </span>{' '}
            <span className="text-gray-400 font-normal">Matches Predictor</span>
          </h1>
          <p className="text-xs text-gray-500 mt-2 max-w-sm leading-relaxed">
            Connect your Deriv account with an API token to unlock live balances and one-click
            auto trading.
          </p>
        </div>

        <div className="bg-[#141422] border border-gray-800 rounded-2xl p-4 sm:p-6 shadow-xl">
          {notice && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300 leading-relaxed min-w-0 break-words">{notice}</p>
            </div>
          )}

          {/* Steps */}
          <div className="space-y-2.5 mb-5">
            <Step
              n={1}
              title="Open your Deriv API tokens"
              body="Sign in to your Deriv account, then open the API tokens section."
              link={{ href: DERIV_APPS_URL, label: 'Open Deriv for developers' }}
            />
            <Step
              n={2}
              title="Create a token"
              body="Tick Trade and Account management. Those two cover live balances and trading."
            />
            <Step
              n={3}
              title="Paste it below"
              body="Your token stays in this browser — it is never sent to any server of ours."
            />
          </div>

          {/* Token */}
          <label
            htmlFor="deriv-token"
            className="block text-[11px] uppercase tracking-wider text-gray-400 mb-2"
          >
            Deriv API token
          </label>
          <div className="relative">
            <KeyRound className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="deriv-token"
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={e => {
                setToken(e.target.value)
                if (stage === 'error') setStage('idle')
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !busy) void connect(token, appId)
              }}
              placeholder="Paste your token"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
              className={cn(
                'w-full pl-9 pr-11 py-3 rounded-xl bg-[#0c0c16] border text-sm font-mono text-gray-200',
                'placeholder:text-gray-600 outline-none transition-colors',
                'focus:border-emerald-500/60 disabled:opacity-60',
                stage === 'error' ? 'border-red-500/50' : 'border-gray-800'
              )}
            />
            <button
              type="button"
              onClick={() => setShowToken(v => !v)}
              aria-label={showToken ? 'Hide token' : 'Show token'}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* App ID */}
          <div className="mt-3">
            <label
              htmlFor="deriv-app-id"
              className="block text-[11px] uppercase tracking-wider text-gray-400 mb-2"
            >
              App ID <span className="text-gray-600 normal-case tracking-normal">— from your Deriv application</span>
            </label>
            <div className="relative">
              <Fingerprint className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="deriv-app-id"
                type="text"
                value={appId}
                onChange={e => setAppId(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !busy) void connect(token, appId)
                }}
                placeholder="Registered app ID"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy}
                className={cn(
                  'w-full pl-9 pr-3 py-3 rounded-xl bg-[#0c0c16] border border-gray-800 text-sm font-mono text-gray-200',
                  'placeholder:text-gray-600 outline-none transition-colors',
                  'focus:border-emerald-500/60 disabled:opacity-60'
                )}
              />
            </div>
            <button
              type="button"
              onClick={() => setShowHelp(v => !v)}
              className="mt-2 text-[11px] text-emerald-400/90 hover:text-emerald-300 underline decoration-emerald-400/40 underline-offset-4 decoration-1"
            >
              {showHelp ? 'Hide' : 'Where do I find this?'}
            </button>
            {showHelp && (
              <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">
                Deriv requires an App ID alongside an API token. Register an application (type{' '}
                <span className="font-medium text-gray-400">PAT</span>) on developers.deriv.com —
                its App ID is shown on the application page. It is remembered in this browser
                after your first sign-in.
              </p>
            )}
          </div>

          <button
            onClick={() => void connect(token, appId)}
            disabled={busy || !token.trim()}
            className={cn(
              'w-full mt-4 flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm',
              'bg-gradient-to-r from-emerald-600 to-green-600 text-white',
              'hover:from-emerald-500 hover:to-green-500 transition-all shadow-lg shadow-green-600/20',
              'disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            {STAGE_LABEL[stage]}
          </button>

          {busy && (
            <div className="mt-4 space-y-2">
              <ProgressRow
                label="Contacting Deriv"
                done={reachedDeriv}
                active={stage === 'accounts'}
              />
              <ProgressRow
                label="Loading your accounts"
                done={loadedAccounts}
                active={stage === 'accounts' || stage === 'socket'}
              />
              <ProgressRow
                label="Opening trading connection"
                done={loadedAccounts}
                active={stage === 'socket'}
              />
            </div>
          )}

          {stage === 'done' && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <p className="text-xs text-emerald-300">Connected — loading your dashboard…</p>
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs text-red-300 leading-relaxed break-words">{error}</p>
                <p className="text-[10px] text-red-400/70 mt-1 leading-relaxed">
                  Check the token is pasted in full, that Trade and Account management are ticked,
                  and that your App ID is correct.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-4 text-[10px] text-gray-600">
          <span className="flex items-center gap-1">
            <Lock className="w-3 h-3" /> Token never leaves your browser
          </span>
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> Trade &amp; account management only
          </span>
          <span className="flex items-center gap-1">
            <BadgeCheck className="w-3 h-3" /> Official Deriv API
          </span>
        </div>

        <p className="flex items-center justify-center gap-1.5 mt-3 text-[10px] text-gray-700 text-center">
          <Sparkles className="w-3 h-3" />
          Works on phone and desktop — add it to your home screen for one-tap access.
        </p>
      </div>
    </div>
  )
}

function Step({ n, title, body, link }: {
  n: number
  title: string
  body: string
  link?: { href: string; label: string }
}) {
  return (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold flex items-center justify-center shrink-0">
        {n}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-200">{title}</p>
        <p className="text-[11px] text-gray-500 leading-relaxed">{body}</p>
        {link && (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 mt-0.5"
          >
            {link.label}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  )
}

function ProgressRow({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {done ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
      ) : active ? (
        <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />
      ) : (
        <div className="w-3.5 h-3.5 rounded-full border border-gray-700 shrink-0" />
      )}
      <span className={done ? 'text-gray-400' : active ? 'text-gray-300' : 'text-gray-600'}>
        {label}
      </span>
    </div>
  )
}
