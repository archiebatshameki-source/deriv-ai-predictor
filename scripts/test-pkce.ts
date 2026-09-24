/**
 * Verifies the PKCE implementation against RFC 7636 Appendix B's official
 * test vector, and checks the authorize URL matches Deriv's documented params.
 *
 * Run: bun run scripts/test-pkce.ts
 */
import {
  deriveChallenge,
  buildAuthorizeUrl,
  createPkcePair,
  OAUTH_SCOPES,
} from '../src/lib/deriv-oauth.ts'

let failures = 0

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) {
    console.log(`        expected: ${expected}`)
    console.log(`        actual:   ${actual}`)
  }
}

// RFC 7636 Appendix B
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

console.log('── PKCE (RFC 7636 Appendix B vector) ──')
check('deriveChallenge matches RFC challenge', await deriveChallenge(RFC_VERIFIER), RFC_CHALLENGE)

const pair = await createPkcePair()
console.log('\n── generated verifier ──')
check('verifier is 64 base64url chars (48 bytes)', pair.verifier.length, 64)
check('verifier has no padding/unsafe chars', /^[A-Za-z0-9\-_]+$/.test(pair.verifier), true)
check('challenge is 43 chars (SHA-256 base64url)', pair.challenge.length, 43)
check('challenge derives from its verifier', await deriveChallenge(pair.verifier), pair.challenge)
check('two calls produce different verifiers', pair.verifier !== (await createPkcePair()).verifier, true)

console.log('\n── authorize URL ──')
const REDIRECT = 'https://example.test/oauth/callback'
const url = new URL(
  buildAuthorizeUrl({
    clientId: 'test-client-id',
    challenge: 'CHALLENGE',
    state: 'STATE123',
    redirectUri: REDIRECT,
  })
)
check('host', url.host, 'auth.deriv.com')
check('path', url.pathname, '/oauth2/auth')
check('response_type', url.searchParams.get('response_type'), 'code')
check('client_id', url.searchParams.get('client_id'), 'test-client-id')
check('redirect_uri', url.searchParams.get('redirect_uri'), REDIRECT)
check('code_challenge_method', url.searchParams.get('code_challenge_method'), 'S256')
check('code_challenge', url.searchParams.get('code_challenge'), 'CHALLENGE')
check('state', url.searchParams.get('state'), 'STATE123')
check('scope', url.searchParams.get('scope'), OAUTH_SCOPES.join(' '))
check('no prompt on login', url.searchParams.get('prompt'), null)

const signupUrl = new URL(
  buildAuthorizeUrl({
    clientId: 'test-client-id',
    challenge: 'C',
    state: 'S',
    redirectUri: REDIRECT,
    prompt: 'registration',
  })
)
check('signup sets prompt=registration', signupUrl.searchParams.get('prompt'), 'registration')

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
