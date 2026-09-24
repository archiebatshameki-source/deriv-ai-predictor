/**
 * POST /api/deriv/token
 *
 * Exchanges an OAuth 2.0 authorization code for an access token. Deriv requires
 * this to run server-side, and the client secret must never reach the browser —
 * so the secret is read from the DERIV_CLIENT_SECRET env var only.
 *
 * Body: { code, code_verifier, redirect_uri, client_id }
 *
 * Self-contained on purpose: no relative imports, because this package is
 * "type": "module" and Node's ESM resolver rejects extensionless specifiers.
 */

const DERIV_TOKEN_URL = 'https://auth.deriv.com/oauth2/token'

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
  const code = String(body.code ?? '').trim()
  const codeVerifier = String(body.code_verifier ?? '').trim()
  const redirectUri = String(body.redirect_uri ?? '').trim()
  const clientId = String(body.client_id ?? process.env.DERIV_CLIENT_ID ?? '').trim()
  const clientSecret = process.env.DERIV_CLIENT_SECRET ?? ''

  const missing = [
    !code && 'code',
    !codeVerifier && 'code_verifier',
    !redirectUri && 'redirect_uri',
    !clientId && 'client_id',
  ].filter(Boolean)

  if (missing.length > 0) {
    res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` })
    return
  }

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    client_id: clientId,
  })
  if (clientSecret) form.set('client_secret', clientSecret)

  try {
    const upstream = await fetch(DERIV_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    })

    const text = await upstream.text()
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text) as Record<string, unknown>
    } catch {
      parsed = { raw: text.slice(0, 500) }
    }

    if (!upstream.ok) {
      const errorCode = typeof parsed.error === 'string' ? parsed.error : undefined
      const description =
        typeof parsed.error_description === 'string' ? parsed.error_description : undefined
      res.status(upstream.status).json({
        error: description || errorCode || `Deriv token exchange failed (HTTP ${upstream.status})`,
        deriv_error: errorCode,
        status: upstream.status,
      })
      return
    }

    res.status(200).json({
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      expires_in: parsed.expires_in,
      token_type: parsed.token_type,
      scope: parsed.scope,
    })
  } catch (err) {
    res.status(502).json({
      error: `Could not reach Deriv's token endpoint: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}
