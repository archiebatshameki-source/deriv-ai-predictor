/**
 * Client-side Deriv WebSocket client.
 *
 * Deriv's WebSocket API is only reachable from a real user's browser/device —
 * the cloud sandbox cannot open outbound sockets to Deriv. So every call in
 * this module runs in the browser, straight against Deriv.
 *
 * Transport: `connectTo()` attaches to a pre-authenticated socket obtained from
 * Deriv's REST OTP endpoint (see ./deriv-rest.ts). The OTP in the URL performs
 * authentication, so no `authorize` message is sent.
 */

export type DerivAccount = {
  loginid: string
  isVirtual: boolean
  currency: string
  balance: number | null
  /** 'demo' | 'real' as reported by the REST accounts endpoint. */
  accountType?: 'demo' | 'real'
}

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
  /** Deriv-App-ID the session was opened with (required for PAT auth). */
  appId?: string
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
  AuthorizationRequired:
    'Deriv rejected this connection. Reconnect your account, or re-create the API token with the Trade scope ticked.',
  InvalidToken: 'That token is not valid. Copy the full token from your Deriv API token page.',
  InvalidAppID: 'Deriv rejected this app ID. Check the App ID on developers.deriv.com.',
  RateLimit: 'Deriv is rate-limiting requests. Wait a few seconds and retry.',
  WrongResponse: 'Deriv returned an unexpected response. Please retry.',
  InputValidationFailed: 'Deriv rejected the request parameters.',
  UnrecognisedRequest:
    'Deriv did not recognise this request. The app may be sending a field name from the older API — please report this.',
  ContractBuyValidationError: 'Deriv rejected this trade (stake, duration or barrier).',
  InsufficientBalance: 'Not enough balance in this account for that stake.',
  PleaseAuthenticate: 'Not logged in to Deriv. Reconnect your account.',
}

export function describeDerivError(code?: string, fallback?: string): string {
  if (code && ERROR_HINTS[code]) return ERROR_HINTS[code]
  return fallback || 'Deriv connection failed.'
}

/** Detaches every handler before closing, so a retired socket can't fire again. */
function detachAndClose(ws: WebSocket) {
  ws.onopen = null
  ws.onmessage = null
  ws.onerror = null
  ws.onclose = null
  try {
    ws.close()
  } catch {
    /* already closing */
  }
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

  /**
   * Attaches to a pre-authenticated socket obtained from Deriv's REST OTP endpoint.
   * The OTP in the URL performs authentication, so no `authorize` message is sent.
   *
   * Sockets are account-scoped, so switching accounts means fetching a fresh OTP.
   * The outgoing socket is only closed once the replacement is open, so a failed
   * switch leaves the working connection intact.
   */
  async connectTo(wsUrl: string, timeoutMs = 12000): Promise<void> {
    const previous = this.ws
    // In-flight requests belong to the outgoing account. Settle them now rather
    // than let them resolve later against the wrong one.
    this.failAllPending(new DerivApiError('Account changed — request cancelled.'))

    await this.openSocket(wsUrl, timeoutMs)
    this.endpoint = wsUrl

    if (previous && previous !== this.ws) detachAndClose(previous)
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
        detachAndClose(ws)
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
        // Without this the rejected attempt stays open and leaks a socket.
        detachAndClose(ws)
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

  async getBalance(): Promise<number | null> {
    const res = await this.request<{ balance?: { balance?: number } }>({ balance: 1 })
    const value = res.balance?.balance
    return typeof value === 'number' ? value : null
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
    // The current Deriv WS API names these differently from the legacy API:
    // the request key is `proposal` (not `propose`) and the market is
    // `underlying_symbol` (not `symbol`). Both are validated by
    // `additionalProperties: false`, so the legacy spellings are rejected with
    // `UnrecognisedRequest` / `InputValidationFailed`. Verified against
    // Deriv's published websocket schemas — see scripts/probe-deriv-proposal-shape.mjs.
    const proposal = await this.request<{
      proposal?: { id?: string; ask_price?: number; payout?: number }
    }>({
      proposal: 1,
      amount: params.stake,
      basis: 'stake',
      contract_type: params.contractType,
      currency: params.currency,
      duration: params.duration ?? 1,
      duration_unit: params.durationUnit ?? 't',
      underlying_symbol: params.symbol,
      ...(params.barrier != null ? { barrier: params.barrier } : {}),
    })

    const offer = proposal.proposal
    if (!offer?.id) throw new DerivApiError('Deriv did not return a contract proposal.')

    const purchased = await this.request<{
      buy?: { contract_id?: number | string; buy_price?: number; payout?: number }
    }>({
      buy: offer.id,
      price: offer.ask_price ?? params.stake,
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
    if (ws) detachAndClose(ws)
  }
}
