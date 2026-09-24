/**
 * Deriv OAuth 2.0 (Authorization Code + PKCE).
 *
 * Split of responsibility:
 *   - PKCE generation, the authorize redirect, and callback/state validation all
 *     happen in the browser.
 *   - The code→token exchange and all further REST calls go through
 *     `/api/deriv/*` because Deriv requires the exchange to be server-side and
 *     its REST API does not guarantee CORS for browsers.
 */

export const DERIV_AUTHORIZE_URL = 'https://auth.deriv.com/oauth2/auth'
export const DERIV_SIGNUP_URL = 'https://auth.deriv.com/oauth2/auth'

/** Least privilege: read the app, trade, and manage account selection. */
export const OAUTH_SCOPES = ['trade', 'account_manage', 'application_read']

const CLIENT_ID_KEY = 'deriv_oauth_client_id'
const STATE_KEY = 'deriv_oauth_state'
const VERIFIER_KEY = 'deriv_oauth_verifier'
const RETURN_TO_KEY = 'deriv_oauth_return_to'

/**
 * Registered Deriv OAuth client ID for this app. A client_id is public by
 * design — it travels in the authorize URL and is visible in the browser — so
 * shipping it in the bundle is safe. A value saved from the in-app setup panel
 * takes precedence, so it can still be changed without a redeploy.
 */
export const DEFAULT_CLIENT_ID = '019e85a3-95b5-7326-8952-0ae373061815'

export const OAUTH_CALLBACK_PATH = '/oauth/callback'

export type OAuthTokens = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
}

/* ── configuration ────────────────────────────────────────────────────── */

/** The client_id is public, so it can be configured in-app without a redeploy. */
export function getClientId(): string {
  try {
    const override = localStorage.getItem(CLIENT_ID_KEY)?.trim()
    return override || DEFAULT_CLIENT_ID
  } catch {
    return DEFAULT_CLIENT_ID
  }
}

/** True when the client ID came from the setup panel rather than the built-in default. */
export function isClientIdOverridden(): boolean {
  try {
    return Boolean(localStorage.getItem(CLIENT_ID_KEY)?.trim())
  } catch {
    return false
  }
}

/** Drops the in-app override so the built-in client ID applies again. */
export function resetClientId(): void {
  try {
    localStorage.removeItem(CLIENT_ID_KEY)
  } catch { /* storage unavailable */ }
}

export function setClientId(clientId: string): void {
  try {
    localStorage.setItem(CLIENT_ID_KEY, clientId.trim())
  } catch { /* storage unavailable */ }
}

/**
 * Must exactly match a redirect URI registered with Deriv. BASE_URL is '/' on a root
 * deploy but '/<repo>/' on a GitHub Pages project site, so the callback is built from
 * it rather than from the bare path — a URI that omits the base gets rejected by Deriv
 * as non-matching.
 */
export function getRedirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}${OAUTH_CALLBACK_PATH.slice(1)}`
}

/**
 * Removes the deploy base from a pathname so route checks work unchanged on a
 * subpath deploy: '/<repo>/oauth/callback' -> '/oauth/callback'. On a root deploy
 * it is a no-op.
 *
 * `base` is injectable so the logic can be tested without a bundler, which is the
 * only reason it is not read inline.
 */
export function stripBase(pathname: string, base: string = import.meta.env.BASE_URL): string {
  if (base !== '/' && pathname.startsWith(base)) {
    return `/${pathname.slice(base.length)}`
  }
  return pathname
}

/* ── PKCE ─────────────────────────────────────────────────────────────── */

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomUrlSafeString(byteLength = 48): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

/** code_challenge = BASE64URL(SHA256(code_verifier)), per RFC 7636. */
export async function deriveChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(new Uint8Array(digest))
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomUrlSafeString(48)
  return { verifier, challenge: await deriveChallenge(verifier) }
}

/* ── authorize ────────────────────────────────────────────────────────── */

export function buildAuthorizeUrl(options: {
  clientId: string
  challenge: string
  state: string
  /** Injected so this stays a pure, testable function. */
  redirectUri: string
  prompt?: 'registration'
}): string {
  const url = new URL(options.prompt ? DERIV_SIGNUP_URL : DERIV_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', options.clientId)
  url.searchParams.set('redirect_uri', options.redirectUri)
  url.searchParams.set('scope', OAUTH_SCOPES.join(' '))
  url.searchParams.set('state', options.state)
  url.searchParams.set('code_challenge', options.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (options.prompt) url.searchParams.set('prompt', options.prompt)
  return url.toString()
}

/** Generates PKCE + state, persists them, and returns the URL to redirect to. */
export async function beginOAuth(options: {
  clientId: string
  redirectUri: string
  prompt?: 'registration'
  returnTo?: string
}): Promise<string> {
  const { verifier, challenge } = await createPkcePair()
  const state = randomUrlSafeString(24)

  sessionStorage.setItem(STATE_KEY, state)
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  if (options.returnTo) sessionStorage.setItem(RETURN_TO_KEY, options.returnTo)

  return buildAuthorizeUrl({
    clientId: options.clientId,
    challenge,
    state,
    redirectUri: options.redirectUri,
    prompt: options.prompt,
  })
}

export type OAuthCallback = {
  code?: string
  state?: string
  error?: string
  errorDescription?: string
}

export function parseOAuthCallback(search: string): OAuthCallback {
  const params = new URLSearchParams(search)
  return {
    code: params.get('code') ?? undefined,
    state: params.get('state') ?? undefined,
    error: params.get('error') ?? undefined,
    errorDescription: params.get('error_description') ?? undefined,
  }
}

/**
 * Validates the returned state against the stored value (CSRF defence) and
 * returns the PKCE verifier. Throws with a user-facing message on any mismatch.
 */
export function consumeOAuthState(returnedState?: string): string {
  const expectedState = sessionStorage.getItem(STATE_KEY)
  const verifier = sessionStorage.getItem(VERIFIER_KEY)

  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(RETURN_TO_KEY)

  if (!expectedState || !verifier) {
    throw new Error('This login attempt expired. Please start the Deriv login again.')
  }
  if (!returnedState || returnedState !== expectedState) {
    throw new Error('Deriv login failed a security check (state mismatch). Please try again.')
  }
  return verifier
}

/* ── server-side exchanges ────────────────────────────────────────────── */

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  let payload: Record<string, unknown> = {}
  try {
    payload = (await response.json()) as Record<string, unknown>
  } catch { /* non-JSON error body */ }

  if (!response.ok) {
    // Static hosting (GitHub Pages) has no server runtime, so /api/* does not exist
    // there and the 404 body is index.html. Saying so beats "HTTP 404", which reads
    // like a bug in the app rather than a hosting limitation.
    if (response.status === 404 && !payload.error) {
      throw new Error(
        'This deployment is static, so the OAuth login is unavailable: it needs the ' +
          'server-side endpoint at /api/deriv/token. Use the API token tab instead — ' +
          'it works entirely in the browser.'
      )
    }
    const message =
      typeof payload.error === 'string'
        ? payload.error
        : `Request failed (HTTP ${response.status})`
    // Deriv's OAuth prose is unhelpful on its own, so keep the machine code.
    const error = new Error(message) as Error & { code?: string }
    error.code = typeof payload.deriv_error === 'string' ? payload.deriv_error : undefined
    throw error
  }
  return payload as T
}

/**
 * Turns Deriv's opaque OAuth failures into something actionable. `invalid_client`
 * means the registered app is missing, is not an OAuth-type app (an App ID from a
 * PAT-type app is not a valid OAuth client), or has not been approved yet — none of
 * which the user can infer from "Client authentication failed".
 */
export function describeOAuthError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string } | null)?.code

  if (code === 'invalid_client' || /unknown client|client authentication failed/i.test(message)) {
    return (
      'Deriv rejected this app’s OAuth client ID, so the OAuth login could not complete. ' +
      'That usually means the registered app is missing, is not registered as an OAuth-type ' +
      'app, or has not been approved yet. The API token tab works without any app registration.'
    )
  }
  return message
}

export function exchangeCodeForToken(params: {
  code: string
  verifier: string
  clientId: string
}): Promise<OAuthTokens> {
  return postJson<OAuthTokens>('/api/deriv/token', {
    code: params.code,
    code_verifier: params.verifier,
    redirect_uri: getRedirectUri(),
    client_id: params.clientId,
  })
}

export type DerivRestAccount = {
  loginid: string
  isVirtual: boolean
  currency: string
  balance: number | null
  accountType: string
}

export function fetchDerivAccounts(params: {
  token: string
  appId?: string
}): Promise<{ accounts: DerivRestAccount[]; raw?: unknown }> {
  return postJson('/api/deriv/accounts', { token: params.token, app_id: params.appId })
}

/** Returns the OTP-authenticated WebSocket URL. Single-use, expires in 120s. */
export function fetchOtpWebSocketUrl(params: {
  token: string
  accountId: string
  appId?: string
}): Promise<{ url: string }> {
  return postJson('/api/deriv/otp', {
    token: params.token,
    accountId: params.accountId,
    app_id: params.appId,
  })
}
