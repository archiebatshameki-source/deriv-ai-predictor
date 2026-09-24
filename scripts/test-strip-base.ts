/**
 * Regression test for stripBase, the helper that lets the app's route checks work on
 * a GitHub Pages subpath deploy. Getting this wrong makes the OAuth callback silently
 * fall through to the session-restore path instead of exchanging the code.
 *
 * `base` is passed explicitly because import.meta.env only exists inside a Vite build.
 */
import { stripBase, OAUTH_CALLBACK_PATH } from '../src/lib/deriv-oauth.ts'

let failures = 0

function check(label: string, actual: string, expected: string) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ->  ${actual}${ok ? '' : `  (expected ${expected})`}`)
}

// Root deploy: unchanged.
check('root + callback', stripBase('/oauth/callback', '/'), '/oauth/callback')
check('root + nested', stripBase('/oauth/callback/x', '/'), '/oauth/callback/x')
check('root + app root', stripBase('/', '/'), '/')

// Project site: base stripped so the route check still matches.
check('subpath + callback', stripBase('/deriv-ai-predictor/oauth/callback', '/deriv-ai-predictor/'), '/oauth/callback')
check('subpath + app root', stripBase('/deriv-ai-predictor/', '/deriv-ai-predictor/'), '/')
check('subpath + 404 shell path', stripBase('/deriv-ai-predictor/anything/deep', '/deriv-ai-predictor/'), '/anything/deep')

// A path that merely shares a prefix must NOT be treated as base-prefixed.
check('prefix lookalike', stripBase('/deriv-ai-predictor-extra/oauth', '/deriv-ai-predictor/'), '/deriv-ai-predictor-extra/oauth')

// The actual integration point: the callback must be detected on both host shapes.
const hostShapes: Array<[string, string]> = [
  ['https://example.com/oauth/callback', '/'],
  ['https://user.github.io/deriv-ai-predictor/oauth/callback', '/deriv-ai-predictor/'],
]
for (const [pathname, base] of hostShapes) {
  const detected = stripBase(new URL(pathname).pathname, base).startsWith(OAUTH_CALLBACK_PATH)
  if (!detected) failures++
  console.log(`${detected ? 'PASS' : 'FAIL'}  callback detected on ${hostShapes.find(h => h[0] === pathname)![0]}`)
}

console.log(failures === 0 ? '\nAll stripBase cases passed.' : `\n${failures} case(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
