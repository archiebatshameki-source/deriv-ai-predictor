/**
 * POST /api/deriv/otp
 *
 * Requests a one-time password plus the pre-authenticated WebSocket URL for an
 * account. Per Deriv's docs this is how an authenticated socket is established —
 * the returned URL embeds the OTP, so no `authorize` message is needed.
 *
 * The OTP is single-use and expires in 120 seconds, so the client must connect
 * immediately.
 *
 * Body: { token, accountId, app_id? }
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
  const accountId = String(body.accountId ?? body.account_id ?? '').trim()
  const appId = String(body.app_id ?? process.env.DERIV_APP_ID ?? '').trim()

  if (!token) {
    res.status(400).json({ error: 'Missing token' })
    return
  }
  if (!accountId) {
    res.status(400).json({ error: 'Missing accountId' })
    return
  }

  const url = `${DERIV_REST_BASE}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: authHeaders(token, appId),
    })

    const text = await upstream.text()
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text) as Record<string, unknown>
    } catch {
      parsed = {}
    }

    if (!upstream.ok) {
      const detail =
        (typeof parsed.error === 'string' && parsed.error) ||
        (typeof parsed.message === 'string' && parsed.message) ||
        `Deriv returned HTTP ${upstream.status}`
      res.status(upstream.status).json({ error: detail, status: upstream.status, details: parsed })
      return
    }

    const data = ((parsed.data ?? parsed) as Record<string, unknown>)
    const wsUrl = String(data.url ?? data.websocket_url ?? data.ws_url ?? '')

    if (!wsUrl) {
      res.status(502).json({
        error: 'Deriv did not return an authenticated WebSocket URL.',
        details: parsed,
      })
      return
    }

    res.status(200).json({ url: wsUrl })
  } catch (err) {
    res.status(502).json({
      error: `Could not reach Deriv: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}
