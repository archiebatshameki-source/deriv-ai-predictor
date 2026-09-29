/**
 * Client-side Deriv REST client for the current-generation Options API.
 *
 * Deriv's current auth model is NOT the legacy WebSocket `authorize` handshake:
 *
 *   1. REST  GET  /trading/v1/options/accounts              → accounts on the token
 *   2. REST  POST /trading/v1/options/accounts/{id}/otp     → pre-authenticated WS URL
 *   3. Open that WebSocket URL — it is already authenticated, so no `authorize`
 *      message is sent and `switch_account` is unnecessary (sockets are account-scoped).
 *
 * Personal Access Tokens are the intended credential here: Deriv's docs describe the
 * PAT type as the choice "when browser redirects are not practical and manual token
 * entry is acceptable". A PAT needs both `Authorization: Bearer` AND a
 * `Deriv-App-ID` header; OAuth JWTs need only the bearer token.
 *
 * Everything runs in the browser. Deriv returns permissive CORS headers for these
 * endpoints (verified: the preflight echoes the caller's Origin and allows the
 * `authorization` and `deriv-app-id` headers), so a static host needs no proxy and
 * no serverless function.
 *
 * Scopes, per Deriv's OpenAPI spec: both endpoints below require `trade`.
 */

import type { DerivAccount, DerivSession } from './deriv-api'

export const DERIV_REST_BASE = 'https://api.derivws.com'

export const DERIV_DASHBOARD_URL = 'https://home.deriv.com/dashboard/'
export const DERIV_TOKEN_URL = 'https://app.deriv.com/account/api-token'
export const DERIV_APPS_URL = 'https://developers.deriv.com/'

const APP_ID_KEY = 'deriv_app_id'
const ACTIVE_ACCOUNT_KEY = 'deriv_active_account'

/** One trading account as returned by the Options accounts endpoint. */
export type DerivRestAccount = {
  accountId: string
  balance: number | null
  currency: string
  accountType: 'demo' | 'real'
  status: string
  group: string
}

export class DerivRestError extends Error {
  status?: number
  code?: string
  field?: string

  constructor(message: string, opts: { status?: number; code?: string; field?: string } = {}) {
    super(message)
    this.name = 'DerivRestError'
    this.status = opts.status
    this.code = opts.code
    this.field = opts.field
  }
}

const APP_ID_HINT =
  'Deriv requires your App ID alongside an API token. Copy it from your application ' +
  'on developers.deriv.com and paste it into the App ID field.'

/** Error codes Deriv's Options API can return, per its OpenAPI spec. */
function describeCode(code: string | undefined, message: string): string {
  switch (code) {
    case 'Unauthorized':
    case 'UnauthorizedAccess':
      return 'Deriv rejected this API token. Check you copied the whole token and that it still exists.'
    case 'AccessDenied':
      return 'This API token is not allowed to do that. Re-create it with the Trade and Account management scopes ticked.'
    case 'AccountNotFound':
      return 'Deriv does not recognise that account ID for this token.'
    case 'RateLimit':
      return 'Deriv is rate-limiting requests. Wait a few seconds and try again.'
    case 'ValidationError':
    case 'FieldIsRequired':
    case 'BadInputRequest':
      return message || 'Deriv rejected the request parameters.'
    case 'InternalServerError':
      return 'Deriv had a server error. Please retry in a moment.'
    default:
      return message || 'Deriv rejected the request.'
  }
}

/** Turns any Deriv failure payload into something a trader can act on. */
function toError(status: number, payload: unknown, rawText: string): DerivRestError {
  const body = (payload ?? {}) as Record<string, unknown>
  const errors = Array.isArray(body.errors) ? body.errors : []
  const first = (errors[0] ?? {}) as Record<string, unknown>

  const code = typeof first.code === 'string' ? first.code : undefined
  const field = typeof first.field === 'string' ? first.field : undefined
  const rawMessage =
    (typeof first.message === 'string' && first.message) ||
    (typeof body.message === 'string' && body.message) ||
    (typeof body.error === 'string' && body.error) ||
    rawText.trim()

  // Deriv answers some failures with plain text ("Invalid token format").
  if (field === 'Deriv-App-ID' || /deriv-app-id|app[\s_-]?id/i.test(rawMessage)) {
    return new DerivRestError(APP_ID_HINT, { status, code, field })
  }
  if (/token/i.test(rawMessage) && !code) {
    return new DerivRestError(
      'Deriv did not accept that API token. Copy the full token from your Deriv API token page and try again.',
      { status, code, field }
    )
  }

  return new DerivRestError(describeCode(code, rawMessage || `Deriv returned HTTP ${status}.`), {
    status,
    code,
    field,
  })
}

type RequestOptions = {
  token: string
  appId?: string
  method?: 'GET' | 'POST'
  body?: unknown
}

async function derivRequest(path: string, options: RequestOptions): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.token}`,
    Accept: 'application/json',
  }
  // Required for PAT auth, ignored for OAuth JWTs — only sent when we have one.
  const appId = options.appId?.trim()
  if (appId) headers['Deriv-App-ID'] = appId
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(`${DERIV_REST_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    })
  } catch {
    throw new DerivRestError(
      'Could not reach Deriv. Check your internet connection and try again.'
    )
  }

  const text = await response.text()
  let payload: unknown = null
  if (text.trim()) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!response.ok) throw toError(response.status, payload, text)
  if (payload === null) {
    throw new DerivRestError('Deriv returned a response this app could not read.')
  }
  return payload as Record<string, unknown>
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function normalizeAccount(raw: unknown): DerivRestAccount | null {
  const row = (raw ?? {}) as Record<string, unknown>
  const accountId = String(row.account_id ?? '').trim()
  if (!accountId) return null

  const isDemo = String(row.account_type ?? '').toLowerCase() === 'demo'
  return {
    accountId,
    balance: asNumber(row.balance),
    currency: String(row.currency ?? 'USD'),
    accountType: isDemo ? 'demo' : 'real',
    status: String(row.status ?? ''),
    group: String(row.group ?? ''),
  }
}

/** Lists every Options trading account the token can reach. Requires the `trade` scope. */
export async function listAccounts(params: {
  token: string
  appId?: string
}): Promise<DerivRestAccount[]> {
  const payload = await derivRequest('/trading/v1/options/accounts', {
    token: params.token,
    appId: params.appId,
  })
  const rows = Array.isArray(payload.data) ? payload.data : []
  return rows.map(normalizeAccount).filter((account): account is DerivRestAccount => account != null)
}

/**
 * Issues a one-time password and returns the ready-to-use WebSocket URL for one
 * account. The OTP is single-use and expires in 120 seconds, so connect immediately.
 * Requires the `trade` scope.
 */
export async function requestOtpUrl(params: {
  token: string
  accountId: string
  appId?: string
}): Promise<string> {
  const payload = await derivRequest(
    `/trading/v1/options/accounts/${encodeURIComponent(params.accountId)}/otp`,
    { method: 'POST', token: params.token, appId: params.appId }
  )

  const data = (payload.data ?? {}) as Record<string, unknown>
  const url = String(data.url ?? '').trim()
  if (!url) {
    throw new DerivRestError('Deriv did not return a trading connection for that account.')
  }
  return url
}

/* ── Session shaping ───────────────────────────────────────────────────── */

/**
 * Maps a REST account onto the shape the UI already consumes. `loginid` keeps its
 * name for continuity, but for the current API it holds the account ID.
 */
export function toDerivAccount(account: DerivRestAccount): DerivAccount {
  return {
    loginid: account.accountId,
    isVirtual: account.accountType === 'demo',
    currency: account.currency,
    balance: account.balance,
    accountType: account.accountType,
  }
}

/** Which account to open first: the last one used, else demo (safer default). */
export function pickDefaultAccount(
  accounts: DerivRestAccount[],
  preferredAccountId?: string | null
): DerivRestAccount {
  return (
    accounts.find(a => a.accountId === preferredAccountId) ??
    accounts.find(a => a.accountType === 'demo') ??
    accounts[0]
  )
}

/**
 * Shapes the REST account list into the session the UI consumes. Deriv's current
 * account endpoints expose no name, email or landing company, so those stay blank
 * rather than being invented.
 */
export function buildDerivSession(params: {
  token: string
  appId?: string
  accounts: DerivRestAccount[]
  activeAccountId: string
  balance: number | null
}): DerivSession {
  const { token, appId, accounts, activeAccountId, balance } = params
  const active = accounts.find(a => a.accountId === activeAccountId) ?? accounts[0]

  const mapped = accounts.map(account => {
    const shaped = toDerivAccount(account)
    return account.accountId === activeAccountId ? { ...shaped, balance } : shaped
  })

  return {
    loginid: active.accountId,
    fullname: '',
    email: '',
    currency: active.currency,
    balance,
    isVirtual: active.accountType === 'demo',
    company: '',
    accounts: mapped,
    token,
    appId: appId?.trim() || undefined,
  }
}

/* ── App ID and active account (remembered in this browser only) ───────── */

export function getSavedAccountId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ACCOUNT_KEY)
  } catch {
    return null
  }
}

export function saveAccountId(accountId: string) {
  try {
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountId)
  } catch {
    /* storage blocked (private mode) — the session still works */
  }
}

export function getSavedAppId(): string {
  try {
    return localStorage.getItem(APP_ID_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function saveAppId(value: string) {
  const trimmed = value.trim()
  try {
    if (trimmed) localStorage.setItem(APP_ID_KEY, trimmed)
    else localStorage.removeItem(APP_ID_KEY)
  } catch {
    /* storage blocked (private mode) — the field still works for this session */
  }
}
