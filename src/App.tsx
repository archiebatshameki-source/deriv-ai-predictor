import { useCallback, useEffect, useRef, useState } from 'react'
import { LiveDashboard } from './components/LiveDashboard'
import { DerivAuth } from './components/DerivAuth'
import { DerivClient, type DerivAccount, type DerivSession } from './lib/deriv-api'
import {
  OAUTH_CALLBACK_PATH,
  consumeOAuthState,
  describeOAuthError,
  exchangeCodeForToken,
  fetchDerivAccounts,
  fetchOtpWebSocketUrl,
  getClientId,
  parseOAuthCallback,
  stripBase,
} from './lib/deriv-oauth'
import { Loader2 } from 'lucide-react'

const TOKEN_KEY = 'deriv_api_token'
const AUTH_MODE_KEY = 'deriv_auth_mode'

/** Never leave the user staring at the loader if Deriv is slow or unreachable. */
const RESTORE_DEADLINE_MS = 12000

export default function App() {
  const [session, setSession] = useState<DerivSession | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [reconnectError, setReconnectError] = useState<string | null>(null)
  const clientRef = useRef<DerivClient | null>(null)

  /** Opens the OTP-authenticated socket for a specific account (OAuth mode). */
  const attachOAuthSocket = useCallback(
    async (client: DerivClient, accessToken: string, accountId: string) => {
      const { url } = await fetchOtpWebSocketUrl({ token: accessToken, accountId })
      await client.connectTo(url)
    },
    []
  )

  /** Builds a full session from an OAuth access token: REST accounts + OTP socket. */
  const buildOAuthSession = useCallback(
    async (client: DerivClient, accessToken: string): Promise<DerivSession> => {
      const { accounts } = await fetchDerivAccounts({ token: accessToken })
      if (accounts.length === 0) {
        throw new Error('Deriv returned no trading accounts for this login.')
      }

      const preferred = accounts.find(a => a.isVirtual) ?? accounts[0]
      await attachOAuthSocket(client, accessToken, preferred.loginid)

      const mapped: DerivAccount[] = accounts.map(a => ({
        loginid: a.loginid,
        isVirtual: a.isVirtual,
        currency: a.currency,
        balance: a.balance,
      }))

      return {
        loginid: preferred.loginid,
        fullname: '',
        email: '',
        currency: preferred.currency,
        balance: preferred.balance,
        isVirtual: preferred.isVirtual,
        company: '',
        accounts: mapped,
        token: accessToken,
        authMode: 'oauth',
      }
    },
    [attachOAuthSocket]
  )

  /* ── boot: OAuth callback first, then saved-session restore ─────────── */

  useEffect(() => {
    const finish = () => setRestoring(false)

    const handleOAuthCallback = async () => {
      const clientId = getClientId()
      const { code, state, error, errorDescription } = parseOAuthCallback(window.location.search)

      // Strip the code from the address bar immediately. BASE_URL, not '/', so a
      // subpath deploy (/<repo>/) keeps the user inside the app instead of jumping
      // to the domain root.
      window.history.replaceState({}, '', import.meta.env.BASE_URL)

      if (error) {
        setNotice(`Deriv login was not completed: ${errorDescription || error}`)
        finish()
        return
      }
      if (!code) {
        setNotice('Deriv did not return an authorization code. Please try again.')
        finish()
        return
      }
      if (!clientId) {
        setNotice('No OAuth client ID is configured, so the login could not be completed.')
        finish()
        return
      }

      try {
        const verifier = consumeOAuthState(state)
        const tokens = await exchangeCodeForToken({ code, verifier, clientId })
        if (!tokens.access_token) throw new Error('Deriv did not return an access token.')

        const client = new DerivClient()
        const next = await buildOAuthSession(client, tokens.access_token)
        clientRef.current?.close()
        clientRef.current = client

        localStorage.setItem(TOKEN_KEY, tokens.access_token)
        localStorage.setItem(AUTH_MODE_KEY, 'oauth')
        setSession(next)
      } catch (err) {
        setNotice(describeOAuthError(err))
      } finally {
        finish()
      }
    }

    const restoreSavedSession = async () => {
      const saved = localStorage.getItem(TOKEN_KEY)
      const mode = localStorage.getItem(AUTH_MODE_KEY) === 'oauth' ? 'oauth' : 'pat'

      if (!saved) {
        finish()
        return
      }

      const client = new DerivClient()
      const deadline = setTimeout(finish, RESTORE_DEADLINE_MS)
      let cancelled = false

      try {
        const next =
          mode === 'oauth'
            ? await buildOAuthSession(client, saved)
            : await restorePatSession(client, saved)

        clearTimeout(deadline)
        if (cancelled) {
          client.close()
          return
        }
        clientRef.current = client
        setSession(next)
      } catch (err) {
        clearTimeout(deadline)
        client.close()
        if (cancelled) return
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(AUTH_MODE_KEY)
        setNotice(
          err instanceof Error
            ? `Your saved Deriv session could not be restored: ${err.message}`
            : 'Your saved Deriv session could not be restored.'
        )
      } finally {
        if (!cancelled) finish()
      }
    }

    if (stripBase(window.location.pathname).startsWith(OAUTH_CALLBACK_PATH)) {
      void handleOAuthCallback()
    } else {
      void restoreSavedSession()
    }
  }, [buildOAuthSession])

  /* ── handlers ───────────────────────────────────────────────────────── */

  const handleConnected = useCallback((next: DerivSession, client: DerivClient) => {
    clientRef.current?.close()
    clientRef.current = client
    localStorage.setItem(TOKEN_KEY, next.token)
    localStorage.setItem(AUTH_MODE_KEY, next.authMode ?? 'pat')
    setNotice(null)
    setReconnectError(null)
    setSession(next)
  }, [])

  const handleDisconnect = useCallback(() => {
    clientRef.current?.close()
    clientRef.current = null
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(AUTH_MODE_KEY)
    setSession(null)
  }, [])

  const handleUpdateSession = useCallback((patch: Partial<DerivSession>) => {
    setSession(prev => (prev ? { ...prev, ...patch } : prev))
  }, [])

  /** Rebuilds a dropped connection without making the user log in again. */
  const handleReconnect = useCallback(async () => {
    const client = clientRef.current
    const credential = session?.token ?? localStorage.getItem(TOKEN_KEY)
    if (!client || !credential || !session) {
      setReconnectError('No saved credentials — please log in again.')
      return
    }

    setReconnecting(true)
    setReconnectError(null)
    try {
      if (session.authMode === 'oauth') {
        const next = await buildOAuthSession(client, credential)
        setSession({ ...next, loginid: session.loginid })
      } else {
        const next = await restorePatSession(client, credential)
        setSession(next)
      }
    } catch (err) {
      setReconnectError(err instanceof Error ? err.message : 'Could not reconnect to Deriv.')
    } finally {
      setReconnecting(false)
    }
  }, [buildOAuthSession, session])

  /**
   * OAuth sockets are bound to one account, so switching means requesting a new
   * OTP for the target account. PAT sessions can switch in place.
   */
  const handleSwitchAccount = useCallback(async (account: DerivAccount) => {
    const client = clientRef.current
    const current = session
    if (!client || !current) throw new Error('Not connected to Deriv.')
    if (account.loginid === current.loginid) return

    if (current.authMode === 'oauth') {
      await attachOAuthSocket(client, current.token, account.loginid)
      let balance = account.balance
      try {
        balance = (await client.getBalance()) ?? balance
      } catch { /* keep the REST balance */ }

      setSession({
        ...current,
        loginid: account.loginid,
        currency: account.currency,
        isVirtual: account.isVirtual,
        balance,
        accounts: current.accounts.map(a =>
          a.loginid === account.loginid ? { ...a, balance } : a
        ),
      })
      return
    }

    await client.switchAccount(account.loginid)
    const balance = await client.getBalance().catch(() => null)
    setSession({
      ...current,
      loginid: account.loginid,
      currency: account.currency,
      isVirtual: account.isVirtual,
      balance: balance ?? account.balance,
      accounts: current.accounts.map(a =>
        a.loginid === account.loginid ? { ...a, balance: balance ?? a.balance } : a
      ),
    })
  }, [attachOAuthSocket, session])

  /* ── render ─────────────────────────────────────────────────────────── */

  if (restoring) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
        <p className="text-xs text-gray-500">Connecting to Deriv…</p>
      </div>
    )
  }

  if (!session || !clientRef.current) {
    return <DerivAuth onConnected={handleConnected} notice={notice} />
  }

  return (
    <LiveDashboard
      session={session}
      client={clientRef.current}
      onDisconnect={handleDisconnect}
      onUpdateSession={handleUpdateSession}
      onReconnect={handleReconnect}
      reconnecting={reconnecting}
      reconnectError={reconnectError}
      onSwitchAccount={handleSwitchAccount}
    />
  )
}

/** Restores a Personal Access Token session via the `authorize` handshake. */
async function restorePatSession(client: DerivClient, token: string): Promise<DerivSession> {
  await client.connect()
  const session = await client.authorize(token)
  session.authMode = 'pat'
  try {
    const balance = await client.getBalance()
    if (balance != null) {
      session.balance = balance
      const active = session.accounts.find(a => a.loginid === session.loginid)
      if (active) active.balance = balance
    }
  } catch { /* balance is best-effort */ }
  return session
}
