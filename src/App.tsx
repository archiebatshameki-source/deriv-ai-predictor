import { useCallback, useEffect, useRef, useState } from 'react'
import { LiveDashboard } from './components/LiveDashboard'
import { DerivAuth } from './components/DerivAuth'
import { DerivClient, type DerivAccount, type DerivSession } from './lib/deriv-api'
import {
  buildDerivSession,
  getSavedAccountId,
  getSavedAppId,
  listAccounts,
  pickDefaultAccount,
  requestOtpUrl,
  saveAccountId,
} from './lib/deriv-rest'
import { Loader2 } from 'lucide-react'

const TOKEN_KEY = 'deriv_api_token'

/** Never leave the user staring at the loader if Deriv is slow or unreachable. */
const RESTORE_DEADLINE_MS = 12000

type OpenedAccount = {
  accounts: Awaited<ReturnType<typeof listAccounts>>
  activeAccountId: string
  balance: number | null
}

export default function App() {
  const [session, setSession] = useState<DerivSession | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [reconnectError, setReconnectError] = useState<string | null>(null)
  const clientRef = useRef<DerivClient | null>(null)

  /**
   * Authenticates against the current Deriv API: the REST accounts call lists what
   * the token can reach, then an OTP gives a pre-authenticated socket for one
   * account. Sockets are account-scoped, so every account switch repeats the OTP step.
   */
  const openAccount = useCallback(
    async (
      client: DerivClient,
      params: { token: string; appId?: string; accountId?: string | null }
    ): Promise<OpenedAccount> => {
      const accounts = await listAccounts({ token: params.token, appId: params.appId })
      if (accounts.length === 0) {
        throw new Error('This API token has no trading accounts yet.')
      }

      const active = pickDefaultAccount(accounts, params.accountId)
      const wsUrl = await requestOtpUrl({
        token: params.token,
        accountId: active.accountId,
        appId: params.appId,
      })
      await client.connectTo(wsUrl)

      let balance = active.balance
      try {
        balance = (await client.getBalance()) ?? balance
      } catch {
        /* the REST balance is enough to open the dashboard with */
      }

      return { accounts, activeAccountId: active.accountId, balance }
    },
    []
  )

  /* ── boot: restore a saved session ──────────────────────────────────── */

  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY)
    if (!saved) {
      setRestoring(false)
      return
    }

    const client = new DerivClient()
    let cancelled = false
    const deadline = setTimeout(() => {
      if (!cancelled) setRestoring(false)
    }, RESTORE_DEADLINE_MS)

    void (async () => {
      const appId = getSavedAppId()
      try {
        const opened = await openAccount(client, {
          token: saved,
          appId,
          accountId: getSavedAccountId(),
        })
        if (cancelled) return

        clientRef.current = client
        setSession(
          buildDerivSession({
            token: saved,
            appId,
            accounts: opened.accounts,
            activeAccountId: opened.activeAccountId,
            balance: opened.balance,
          })
        )
      } catch (err) {
        client.close()
        if (cancelled) return
        localStorage.removeItem(TOKEN_KEY)
        setNotice(
          err instanceof Error
            ? `Your saved Deriv session could not be restored: ${err.message}`
            : 'Your saved Deriv session could not be restored.'
        )
      } finally {
        clearTimeout(deadline)
        if (!cancelled) setRestoring(false)
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(deadline)
      client.close()
    }
  }, [openAccount])

  /* ── handlers ───────────────────────────────────────────────────────── */

  const handleConnected = useCallback((next: DerivSession, client: DerivClient) => {
    clientRef.current?.close()
    clientRef.current = client
    localStorage.setItem(TOKEN_KEY, next.token)
    saveAccountId(next.loginid)
    setNotice(null)
    setReconnectError(null)
    setSession(next)
  }, [])

  const handleDisconnect = useCallback(() => {
    clientRef.current?.close()
    clientRef.current = null
    localStorage.removeItem(TOKEN_KEY)
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
    const appId = session.appId ?? getSavedAppId()
    try {
      const opened = await openAccount(client, {
        token: credential,
        appId,
        accountId: session.loginid,
      })
      setSession(
        buildDerivSession({
          token: credential,
          appId,
          accounts: opened.accounts,
          activeAccountId: opened.activeAccountId,
          balance: opened.balance,
        })
      )
    } catch (err) {
      setReconnectError(err instanceof Error ? err.message : 'Could not reconnect to Deriv.')
    } finally {
      setReconnecting(false)
    }
  }, [openAccount, session])

  /** An OTP socket is bound to one account, so switching opens a fresh connection. */
  const handleSwitchAccount = useCallback(
    async (account: DerivAccount) => {
      const client = clientRef.current
      const current = session
      if (!client || !current) throw new Error('Not connected to Deriv.')
      if (account.loginid === current.loginid) return

      const wsUrl = await requestOtpUrl({
        token: current.token,
        accountId: account.loginid,
        appId: current.appId ?? getSavedAppId(),
      })
      await client.connectTo(wsUrl)

      let balance = account.balance
      try {
        balance = (await client.getBalance()) ?? balance
      } catch {
        /* keep the last known balance rather than blanking it */
      }

      saveAccountId(account.loginid)
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
    },
    [session]
  )

  /* ── render ─────────────────────────────────────────────────────────── */

  if (restoring) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-3 px-6">
        <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
        <p className="text-xs text-gray-500 text-center">Connecting to Deriv…</p>
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
