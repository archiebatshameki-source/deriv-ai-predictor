/**
 * Client-side Deriv API client.
 *
 * Deriv's WebSocket API is only reachable from a real user's browser/device —
 * the cloud sandbox cannot open outbound sockets to Deriv. So every call in
 * this module runs in the browser, straight against Deriv.
 */

// Verified reachable from real browsers. The classic ws.binaryws.com host and
// the non-/public path both fail to open, so they stay as last-resort fallbacks.
const AUTH_ENDPOINTS = [
  'wss://api.derivws.com/trading/v1/options/ws/public?app_id=1089',
  'wss://ws.binaryws.com/websockets/v3?app_id=1089',
]

export const DERIV_APP_ID = 1089
export const DERIV_TOKEN_URL = 'https://app.deriv.com/account/api-token'
export const DERIV_DASHBOARD_URL = 'https://home.deriv.com/dashboard/'

export type DerivAccount = {
  loginid: string
  isVirtual: boolean
  currency: string
  balance: number | null
}

/** 'oauth' = Bearer access token + OTP socket; 'pat' = API token via `authorize`. */
export type DerivAuthMode = 'pat' | 'oauth'

export type DerivSession = {
  loginid: string
  fullname: string
  email: string
  currency: string
  balance: number | null
  isVirtual: boolean
  company: string
  accounts: DerivAccount[]
  token: string
  authMode?: DerivAuthMode
}

export class DerivApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'DerivApiError'
    this.code = code
  }
}

type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Human-readable messages for the Deriv error codes users actually hit. */
const ERROR_HINTS: Record<string, string> = {
  AuthorizationRequired: 'Your token was rejected by Deriv. Create a new one with Read + Trade scopes.',
  InvalidToken: 'That token is not valid. Copy the full token from your Deriv API token page.',
  InvalidAppID: 'Deriv rejected this app ID. Try again, or create the token from app.deriv.com.',
  RateLimit: 'Deriv is rate-limiting requests. Wait a few seconds and retry.',
  WrongResponse: 'Deriv returned an unexpected response. Please retry.',
  InputValidationFailed: 'Deriv rejected the request parameters.',
  ContractBuyValidationError: 'Deriv rejected this trade (stake, duration or barrier).',
  InsufficientBalance: 'Not enough balance in this account for that stake.',
  PleaseAuthenticate: 'Not logged in to Deriv. Reconnect your account.',
}

export function describeDerivError(code?: string, fallback?: string): string {
  if (code && ERROR_HINTS[code]) return ERROR_HINTS[code]
  return fallback || 'Deriv connection failed.'
}

/**
 * A single-shot request/response Deriv WebSocket client.
 * Requests are correlated by `req_id` so concurrent calls don't cross wires.
 */
export class DerivClient {
  private ws: WebSocket | null = null
  private pending = new Map<number, PendingRequest>()
  private nextReqId = 1
  private endpoint = ''
  private subscriptions = new Set<(payload: Record<string, unknown>) => void>()

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  get activeEndpoint(): string {
    return this.endpoint
  }

  /** Opens a socket to the first reachable Deriv endpoint. */
  async connect(timeoutMs = 12000): Promise<void> {
    const errors: string[] = []

    for (const url of AUTH_ENDPOINTS) {
      try {
        await this.openSocket(url, timeoutMs)
        this.endpoint = url
        return
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
        this.teardown()
      }
    }

    throw new DerivApiError(
      errors[0] ?? 'Could not reach Deriv. Check your internet connection and retry.'
    )
  }

  /**
   * Attaches to a pre-authenticated socket obtained from Deriv's OTP endpoint.
   * The OTP in the URL performs authentication, so no `authorize` call is needed.
   */
  async connectTo(wsUrl: string, timeoutMs = 12000): Promise<void> {
    await this.openSocket(wsUrl, timeoutMs)
    this.endpoint = wsUrl
  }

  private openSocket(url: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch (err) {
        reject(new DerivApiError(err instanceof Error ? err.message : 'WebSocket blocked'))
        return
      }

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try { ws.close() } catch { /* noop */ }
        reject(new DerivApiError('Timed out reaching Deriv. Check your internet connection.'))
      }, timeoutMs)

      ws.onopen = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.ws = ws
        this.attachHandlers(ws)
        resolve()
      }

      ws.onerror = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new DerivApiError('Could not connect to Deriv servers.'))
      }
    })
  }

  private attachHandlers(ws: WebSocket) {
    ws.onmessage = (event) => {
      let data: Record<string, unknown>
      try {
        data = JSON.parse(event.data)
      } catch {
        return
      }

      const reqId = typeof data.req_id === 'number' ? data.req_id : undefined
      if (reqId != null) {
        const pending = this.pending.get(reqId)
        if (pending) {
          this.pending.delete(reqId)
          clearTimeout(pending.timer)
          if (data.error) {
            const err = data.error as { code?: string; message?: string }
            pending.reject(new DerivApiError(describeDerivError(err.code, err.message), err.code))
          } else {
            pending.resolve(data)
          }
          return
        }
      }

      for (const sub of this.subscriptions) sub(data)
    }

    ws.onclose = () => {
      this.failAllPending(new DerivApiError('Deriv connection closed. Please reconnect.'))
    }

    ws.onerror = () => {
      this.failAllPending(new DerivApiError('Deriv WebSocket error.'))
    }
  }

  private failAllPending(error: Error) {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  /** Sends a request and resolves with the raw Deriv response. */
  request<T = Record<string, unknown>>(
    payload: Record<string, unknown>,
    timeoutMs = 15000
  ): Promise<T> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new DerivApiError('Not connected to Deriv. Please reconnect.'))
    }

    const reqId = this.nextReqId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new DerivApiError('Deriv did not respond in time.'))
      }, timeoutMs)

      this.pending.set(reqId, {
        resolve: resolve as PendingRequest['resolve'],
        reject,
        timer,
      })

      try {
        ws.send(JSON.stringify({ ...payload, req_id: reqId }))
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(reqId)
        reject(new DerivApiError(err instanceof Error ? err.message : 'Failed to send request'))
      }
    })
  }

  /** Streams every unsolicited message (subscriptions such as open contracts). */
  onMessage(handler: (payload: Record<string, unknown>) => void): () => void {
    this.subscriptions.add(handler)
    return () => this.subscriptions.delete(handler)
  }

  authorize(token: string): Promise<DerivSession> {
    return this.request<{ authorize: Record<string, unknown> }>({ authorize: token }).then(res => {
      const a = res.authorize
      const rawList = Array.isArray(a.account_list) ? a.account_list : []
      const accounts: DerivAccount[] = rawList.map(item => {
        const acc = item as Record<string, unknown>
        const loginid = String(acc.loginid ?? '')
        return {
          loginid,
          isVirtual: Number(acc.is_virtual ?? loginid.startsWith('VRTC') ? 1 : 0) === 1,
          currency: String(acc.currency ?? a.currency ?? 'USD'),
          balance: null,
        }
      })

      const isVirtual = Number(a.is_virtual ?? 0) === 1
      const loginid = String(a.loginid ?? '')
      const balance = typeof a.balance === 'number' ? a.balance : Number(a.balance ?? NaN)
      const primary: DerivAccount = {
        loginid,
        isVirtual,
        currency: String(a.currency ?? 'USD'),
        balance: Number.isFinite(balance) ? balance : null,
      }

      if (!accounts.some(acc => acc.loginid === loginid)) accounts.unshift(primary)
      else accounts.forEach(acc => { if (acc.loginid === loginid) acc.balance = primary.balance })

      return {
        loginid,
        fullname: String(a.fullname ?? ''),
        email: String(a.email ?? ''),
        currency: primary.currency,
        balance: primary.balance,
        isVirtual,
        company: String(a.landing_company_fullname ?? ''),
        accounts,
        token,
      }
    })
  }

  async getBalance(): Promise<number | null> {
    const res = await this.request<{ balance?: { balance?: number } }>({ balance: 1 })
    const value = res.balance?.balance
    return typeof value === 'number' ? value : null
  }

  async switchAccount(loginid: string): Promise<void> {
    await this.request({ switch_account: 1, loginid })
  }

  /**
   * Proposes then buys a contract. Returns the Deriv contract id and economics.
   */
  async buyContract(params: {
    symbol: string
    contractType: string
    stake: number
    currency: string
    barrier?: string
    duration?: number
    durationUnit?: string
  }): Promise<{ contractId: string; buyPrice: number; payout: number }> {
    const proposal = await this.request<{
      propose?: { id?: string; ask_price?: number; payout?: number }
    }>({
      propose: 1,
      amount: params.stake,
      basis: 'stake',
      contract_type: params.contractType,
      currency: params.currency,
      duration: params.duration ?? 1,
      duration_unit: params.durationUnit ?? 't',
      symbol: params.symbol,
      ...(params.barrier != null ? { barrier: params.barrier } : {}),
    })

    const propose = proposal.propose
    if (!propose?.id) throw new DerivApiError('Deriv did not return a contract proposal.')

    const purchased = await this.request<{
      buy?: { contract_id?: number | string; buy_price?: number; payout?: number }
    }>({
      buy: propose.id,
      price: propose.ask_price ?? params.stake,
    })

    const buy = purchased.buy
    if (!buy?.contract_id) throw new DerivApiError('Deriv did not confirm the purchase.')

    return {
      contractId: String(buy.contract_id),
      buyPrice: typeof buy.buy_price === 'number' ? buy.buy_price : params.stake,
      payout: typeof buy.payout === 'number' ? buy.payout : 0,
    }
  }

  close() {
    this.teardown()
  }

  private teardown() {
    this.failAllPending(new DerivApiError('Deriv connection closed.'))
    const ws = this.ws
    this.ws = null
    if (!ws) return
    ws.onopen = null
    ws.onmessage = null
    ws.onerror = null
    ws.onclose = null
    try { ws.close() } catch { /* noop */ }
  }
}
