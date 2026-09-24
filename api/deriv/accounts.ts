/**
 * POST /api/deriv/accounts
 *
 * Lists the authenticated user's Options trading accounts. Proxied through the
 * server because the Deriv REST API does not guarantee CORS headers for
 * browser-originated calls.
 *
 * Body: { token, app_id? }
 *
 * Self-contained on purpose: no relative imports, because this package is
 * "type": "module" and Node's ESM resolver rejects extensionless specifiers.
 */

const DERIV_REST_BASE = 'https://api.derivws.com'

type ApiRequest = {
  method?: string
  body?: unknown
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (body: unknown) => void
}

function readJsonBody(req: ApiRequest): Record<string, unknown> {
  const raw = req.body
  if (raw == null) return {}
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>
  return {}
}

/** `Deriv-App-ID` is required for PAT tokens and ignored for OAuth tokens. */
function authHeaders(token: string, appId: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }
  if (appId) headers['Deriv-App-ID'] = appId
  return headers
}

function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Deriv's account payload has shifted field names across versions, so accept
 * the plausible spellings rather than betting on one.
 */
function normalizeAccounts(payload: unknown) {
  const root = payload as Record<string, unknown> | null
  if (!root || typeof root !== 'object') return []

  const nested = root.data as Record<string, unknown> | undefined
  const candidates =
    (Array.isArray(root.data) && root.data) ||
    (Array.isArray(root.accounts) && root.accounts) ||
    (nested && Array.isArray(nested.accounts) && nested.accounts) ||
    []

  return (candidates as unknown[])
    .map(raw => {
      const a = (raw ?? {}) as Record<string, unknown>
      const loginid = String(a.loginid ?? a.account_id ?? a.id ?? a.accountId ?? '')
      const type = String(a.account_type ?? a.type ?? '')
      const explicitVirtual = a.is_virtual
      const isVirtual =
        explicitVirtual != null
          ? Number(explicitVirtual) === 1 || explicitVirtual === true
          : /demo|virtual|vrtc/i.test(type) || /^VRTC/i.test(loginid)

      const balanceSource =
        a.balance ??
        (a.balances as Record<string, unknown>)?.balance ??
        (a.wallet as Record<string, unknown>)?.balance

      return {
        loginid,
        isVirtual,
        currency: String(a.currency ?? a.currency_code ?? 'USD'),
        balance: toNumber(balanceSource),
        accountType: type,
      }
    })
    .filter(a => a.loginid !== '')
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === 'OPTIONS') {
    res.status(204).json({})
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = readJsonBody(req)
  const token = String(body.token ?? '').trim()
  const appId = String(body.app_id ?? process.env.DERIV_APP_ID ?? '').trim()

  if (!token) {
    res.status(400).json({ error: 'Missing token' })
    return
  }

  const url = `${DERIV_REST_BASE}/trading/v1/options/accounts`
  const headers = authHeaders(token, appId)

  try {
    // GET lists accounts. Verified by probing: GET returns 401 "Invalid token
    // format" for a bad token, whereas POST on this same path demands a
    // `currency` field — it is the account CREATION endpoint and must never be
    // used here, or a valid token would silently open a new account.
    const upstream = await fetch(url, { method: 'GET', headers })

    const text = await upstream.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { raw: text.slice(0, 500) }
    }

    if (!upstream.ok) {
      const errBody = parsed as Record<string, unknown>
      const detail =
        (typeof errBody.error === 'string' && errBody.error) ||
        (typeof errBody.message === 'string' && errBody.message) ||
        `Deriv returned HTTP ${upstream.status}`
      res.status(upstream.status).json({ error: detail, status: upstream.status, details: parsed })
      return
    }

    res.status(200).json({ accounts: normalizeAccounts(parsed), raw: parsed })
  } catch (err) {
    res.status(502).json({
      error: `Could not reach Deriv: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}
