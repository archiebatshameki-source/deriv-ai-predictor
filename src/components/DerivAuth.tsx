import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import {
  DerivClient,
  DERIV_DASHBOARD_URL,
  DERIV_TOKEN_URL,
  type DerivSession,
} from '../lib/deriv-api'
import {
  beginOAuth, getClientId, setClientId, getRedirectUri,
  isClientIdOverridden, resetClientId,
} from '../lib/deriv-oauth'
import {
  Brain, ShieldCheck, ExternalLink, KeyRound, Loader2,
  CheckCircle2, AlertTriangle, Wifi, Lock, Copy, Check, Settings2, ArrowRight,
} from 'lucide-react'

type Props = {
  onConnected: (session: DerivSession, client: DerivClient) => void
  /** Context from a failed session restore or OAuth callback, shown as a banner. */
  notice?: string | null
}

type Tab = 'oauth' | 'token'
type Stage = 'idle' | 'connecting' | 'authorizing' | 'done' | 'error'

const STAGE_LABEL: Record<Stage, string> = {
  idle: '',
  connecting: 'Connecting to Deriv servers…',
  authorizing: 'Verifying your account…',
  done: 'Connected!',
  error: '',
}

/**
 * Origin the Deriv redirect URI is registered against. Set with VITE_REGISTERED_ORIGIN
 * at build time. When unset the app treats the current origin as the registered one,
 * so a deploy does not warn before any redirect URI has been registered.
 */
const REGISTERED_ORIGIN = import.meta.env.VITE_REGISTERED_ORIGIN?.trim() || ''

/**
 * Set by the deploy workflow when hosting somewhere with no server runtime (GitHub
 * Pages). OAuth cannot complete without the /api/deriv/token exchange, so the tab that
 * does work is opened by default instead of leading with a dead end.
 */
const STATIC_HOSTING = import.meta.env.VITE_STATIC_HOSTING === '1'

export function DerivAuth({ onConnected, notice }: Props) {
  const [tab, setTab] = useState<Tab>(STATIC_HOSTING ? 'token' : 'oauth')
  const [token, setToken] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [clientId, setClientIdState] = useState('')
  const [clientIdDraft, setClientIdDraft] = useState('')
  const [overridden, setOverridden] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const [copied, setCopied] = useState(false)
  const clientRef = useRef<DerivClient | null>(null)

  useEffect(() => {
    // A client ID ships with the build, so setup is no longer required up front —
    // only surface the panel when no usable ID exists at all.
    const custom = isClientIdOverridden()
    const effective = getClientId()
    setClientIdState(effective)
    setOverridden(custom)
    setClientIdDraft(custom ? effective : '')
    if (!effective) setShowSetup(true)
  }, [])

  const busy = stage === 'connecting' || stage === 'authorizing'
  const reachedDeriv = stage === 'authorizing' || stage === 'done'
  const verified = stage === 'done'
  const redirectUri = getRedirectUri()
  const onRegisteredOrigin = !REGISTERED_ORIGIN || window.location.origin === REGISTERED_ORIGIN

  const saveClientId = useCallback(() => {
    const trimmed = clientIdDraft.trim()
    setClientId(trimmed)
    setClientIdState(getClientId())
    setOverridden(Boolean(trimmed))
    setError(null)
    if (trimmed) setShowSetup(false)
  }, [clientIdDraft])

  const useBuiltInClientId = useCallback(() => {
    resetClientId()
    setClientIdDraft('')
    setOverridden(false)
    setClientIdState(getClientId())
    setError(null)
  }, [])

  const startOAuth = useCallback(async (prompt?: 'registration') => {
    if (!clientId) {
      setShowSetup(true)
      setError('Add your Deriv OAuth client ID first — see the setup steps below.')
      return
    }
    setError(null)
    setRedirecting(true)
    try {
      const url = await beginOAuth({ clientId, redirectUri, prompt })
      // Same-tab redirect so Deriv's callback lands back in this app.
      window.location.assign(url)
    } catch (err) {
      setRedirecting(false)
      setError(err instanceof Error ? err.message : 'Could not start the Deriv login.')
    }
  }, [clientId])

  const connectWithToken = useCallback(async (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      setError('Paste your Deriv API token first.')
      setStage('error')
      return
    }
    if (trimmed.length < 15) {
      setError('That token looks too short. Copy the full token from your Deriv API token page.')
      setStage('error')
      return
    }

    setError(null)
    clientRef.current?.close()
    const client = new DerivClient()
    clientRef.current = client

    try {
      setStage('connecting')
      await client.connect()

      setStage('authorizing')
      const session = await client.authorize(trimmed)

      try {
        const balance = await client.getBalance()
        if (balance != null) {
          session.balance = balance
          const active = session.accounts.find(a => a.loginid === session.loginid)
          if (active) active.balance = balance
        }
      } catch { /* balance is nice-to-have; auth already succeeded */ }

      setStage('done')
      onConnected(session, client)
    } catch (err) {
      client.close()
      clientRef.current = null
      setError(err instanceof Error ? err.message : 'Could not connect to Deriv.')
      setStage('error')
    }
  }, [onConnected])

  const copyRedirectUri = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(redirectUri)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked */ }
  }, [redirectUri])

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 sm:p-6">
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
          <p className="text-xs text-gray-500 mt-2 max-w-sm">
            Connect your Deriv account to unlock live balances and one-click auto trading.
          </p>
        </div>

        <div className="bg-[#141422] border border-gray-800 rounded-2xl p-5 sm:p-6 shadow-xl">
          {notice && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300 leading-relaxed min-w-0 break-words">{notice}</p>
            </div>
          )}

          {/* Tabs */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#0c0c16] border border-gray-800 mb-5">
            <TabButton active={tab === 'oauth'} onClick={() => { setTab('oauth'); setError(null) }}>
              Login with Deriv
            </TabButton>
            <TabButton active={tab === 'token'} onClick={() => { setTab('token'); setError(null) }}>
              API token
            </TabButton>
          </div>

          {tab === 'oauth' ? (
            <>
              {STATIC_HOSTING && (
                <div className="mb-3 rounded-xl border border-amber-900/60 bg-amber-950/30 p-3">
                  <p className="text-[11px] text-amber-300/90 leading-relaxed">
                    This deployment is hosted statically, so OAuth cannot complete here — Deriv
                    requires the final token exchange to happen on a server, and a static host has
                    none. Use the <span className="font-semibold">API token</span> tab instead: it
                    connects straight to Deriv from your browser and supports the full app.
                  </p>
                </div>
              )}
              <button
                onClick={() => void startOAuth()}
                disabled={redirecting || !clientId}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm',
                  'bg-gradient-to-r from-emerald-600 to-green-600 text-white',
                  'hover:from-emerald-500 hover:to-green-500 transition-all shadow-lg shadow-green-600/20',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {redirecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                {redirecting ? 'Redirecting to Deriv…' : 'Login with Deriv'}
              </button>

              <button
                onClick={() => void startOAuth('registration')}
                disabled={redirecting || !clientId}
                className="w-full mt-2 py-2.5 rounded-xl border border-gray-700 bg-[#1c1c2e] text-gray-300 text-xs font-medium hover:bg-[#25253a] transition-all disabled:opacity-40"
              >
                Create a Deriv account
              </button>

              <p className="text-[11px] text-gray-500 text-center mt-2 leading-relaxed">
                You sign in on Deriv's own site and approve access. No password or token is shared with us.
              </p>

              {/* Client ID setup */}
              <div className="mt-4 rounded-xl border border-gray-800 bg-[#0c0c16] overflow-hidden">
                <button
                  onClick={() => setShowSetup(v => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
                >
                  <Settings2 className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-[11px] text-gray-400 flex-1">
                    OAuth setup
                    {clientId ? (
                      <span className="text-emerald-400 ml-1.5">
                        · {overridden ? 'custom' : 'built-in'}
                      </span>
                    ) : (
                      <span className="text-amber-400 ml-1.5">· required</span>
                    )}
                  </span>
                  <span className="text-[10px] text-gray-600">{showSetup ? 'Hide' : 'Show'}</span>
                </button>

                {showSetup && (
                  <div className="px-3 pb-3 space-y-3 border-t border-gray-800 pt-3">
                    <p className="text-[11px] text-gray-500 leading-relaxed">
                      This build ships with a registered Deriv OAuth client ID, so
                      the button above works out of the box. Paste a different client
                      ID here only if you registered your own Deriv application.
                    </p>

                    {overridden && (
                      <button
                        onClick={useBuiltInClientId}
                        className="text-[11px] text-emerald-400 hover:text-emerald-300 underline decoration-dotted"
                      >
                        Use the built-in client ID instead
                      </button>
                    )}

                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                        Register this redirect URI
                      </div>
                      <div className="flex items-center gap-2 rounded-lg bg-black/50 border border-gray-800 px-2.5 py-2">
                        <code className="text-[10px] text-emerald-300 font-mono break-all flex-1">
                          {redirectUri}
                        </code>
                        <button
                          onClick={() => void copyRedirectUri()}
                          className="shrink-0 text-gray-500 hover:text-gray-300 transition-colors"
                          title="Copy redirect URI"
                        >
                          {copied
                            ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                            : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-600 mt-1">
                        It must match exactly — including https, and no trailing slash.
                      </p>
                      {!onRegisteredOrigin && (
                        <p className="text-[10px] text-amber-400/80 mt-1 leading-relaxed">
                          You opened this app on{' '}
                          <span className="font-mono">{window.location.origin}</span>,
                          but the registered redirect URI is on{' '}
                          <span className="font-mono">{REGISTERED_ORIGIN}</span>. Start the
                          login from the registered address, or register this one too.
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                        OAuth client ID
                      </label>
                      <div className="flex gap-2">
                        <input
                          value={clientIdDraft}
                          onChange={e => setClientIdDraft(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveClientId() }}
                          placeholder="Leave blank to use the built-in client ID"
                          spellCheck={false}
                          className="flex-1 px-2.5 py-2 rounded-lg bg-black/50 border border-gray-800 text-[11px] font-mono text-gray-200 placeholder:text-gray-600 outline-none focus:border-emerald-500/60"
                        />
                        <button
                          onClick={saveClientId}
                          disabled={!clientIdDraft.trim()}
                          className="px-3 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-medium hover:bg-emerald-600/30 transition-all disabled:opacity-40"
                        >
                          Save
                        </button>
                      </div>
                    </div>

                    <a
                      href="https://developers.deriv.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
                    >
                      Open the Deriv developer dashboard
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2.5 mb-4">
                <Step
                  n={1}
                  title="Log in on Deriv"
                  body="Open your Deriv account and sign in."
                  link={{ href: DERIV_DASHBOARD_URL, label: 'Open Deriv' }}
                />
                <Step
                  n={2}
                  title="Create an API token"
                  body="Account → API token → Create, then tick the Read and Trade scopes."
                  link={{ href: DERIV_TOKEN_URL, label: 'Open API token page' }}
                />
                <Step
                  n={3}
                  title="Paste it below"
                  body="Your token stays in this browser — it is never sent to our servers."
                />
              </div>

              <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-2">
                Deriv API token
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={token}
                  onChange={e => { setToken(e.target.value); if (stage === 'error') setStage('idle') }}
                  onKeyDown={e => { if (e.key === 'Enter' && !busy) void connectWithToken(token) }}
                  placeholder="Paste your token"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  className={cn(
                    'w-full pl-9 pr-3 py-3 rounded-xl bg-[#0c0c16] border text-sm font-mono text-gray-200',
                    'placeholder:text-gray-600 outline-none transition-colors',
                    'focus:border-emerald-500/60 disabled:opacity-60',
                    stage === 'error' ? 'border-red-500/50' : 'border-gray-800'
                  )}
                />
              </div>

              <button
                onClick={() => void connectWithToken(token)}
                disabled={busy || !token.trim()}
                className={cn(
                  'w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm',
                  'bg-[#1c1c2e] border border-gray-700 text-gray-200',
                  'hover:bg-[#25253a] hover:border-gray-600 transition-all',
                  'disabled:opacity-40 disabled:cursor-not-allowed'
                )}
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {STAGE_LABEL[stage]}
                  </>
                ) : (
                  <>
                    <Wifi className="w-4 h-4" />
                    Connect to Deriv
                  </>
                )}
              </button>

              {busy && (
                <div className="mt-4 space-y-2">
                  <ProgressRow label="Reaching Deriv servers" done={reachedDeriv} active={stage === 'connecting'} />
                  <ProgressRow label="Verifying account" done={verified} active={stage === 'authorizing'} />
                </div>
              )}

              {stage === 'done' && (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <p className="text-xs text-emerald-300">Connected — loading your dashboard…</p>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs text-red-300 leading-relaxed break-words">{error}</p>
                {tab === 'token' && (
                  <p className="text-[10px] text-red-400/70 mt-1">
                    Make sure the token has Read + Trade scopes and that you are online.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-4 text-[10px] text-gray-600">
          <span className="flex items-center gap-1">
            <Lock className="w-3 h-3" /> Credentials never touch our servers
          </span>
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> Read + Trade scopes only
          </span>
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'py-2 rounded-lg text-[11px] font-medium transition-all',
        active
          ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
          : 'text-gray-500 hover:text-gray-300 border border-transparent'
      )}
    >
      {children}
    </button>
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
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
      ) : active ? (
        <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
      ) : (
        <div className="w-3.5 h-3.5 rounded-full border border-gray-700" />
      )}
      <span className={done ? 'text-gray-400' : active ? 'text-gray-300' : 'text-gray-600'}>
        {label}
      </span>
    </div>
  )
}
