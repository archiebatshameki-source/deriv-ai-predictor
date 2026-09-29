/**
 * Reproduces what the GitHub Pages workflow does, so the subpath build can be verified
 * before it is relied on in CI:
 *   - base = /<repo>/        (assets must not point at the domain root)
 *   - index.html -> 404.html (deep links must boot the SPA)
 *   - the app must talk to Deriv directly (no serverless proxy, no OAuth leftovers)
 *
 * Builds to a temp dir so it never touches dist/ or races the runtime's build watcher.
 */
import { build } from 'vite'
import { cp, readFile, rm } from 'node:fs/promises'

const OUT = '/tmp/pages-verify'
const REPO = 'deriv-ai-predictor'

process.env.VITE_BASE_PATH = `/${REPO}/`

await rm(OUT, { recursive: true, force: true })
await build({ build: { outDir: OUT, emptyOutDir: true } })

const html = await readFile(`${OUT}/index.html`, 'utf8')
const srcs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])

let failures = 0
const check = (label, pass, detail = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

// Assets must be requested from the subpath, not the domain root.
const locals = srcs.filter(s => s.startsWith('/') && !s.startsWith('//'))
check('all root-relative refs sit under the base', locals.every(s => s.startsWith(`/${REPO}/`)), locals.join(' '))
check('no asset points at the domain root', !locals.some(s => s.startsWith('/assets/') || s === '/favicon.svg'))

const jsName = srcs.find(s => s.endsWith('.js'))
const js = await readFile(`${OUT}${jsName.replace(`/${REPO}`, '')}`, 'utf8')

// The new architecture is browser-only: REST calls go straight to Deriv, so the app
// works on a static host with no proxy.
check('Deriv REST base is in the bundle', js.includes('api.derivws.com'))
check('accounts endpoint is in the bundle', js.includes('/trading/v1/options/accounts'))
check('OTP endpoint is in the bundle', js.includes('/otp'))
check('Deriv-App-ID header is sent', js.includes('Deriv-App-ID'))

// The OAuth flow was removed at the user's request — none of it may ship, and no
// hardcoded OAuth client ID may be present in any form.
check('no OAuth remnants in the bundle', !/oauth2|pkce|code_verifier|client_id/i.test(js))
check(
  'no hardcoded UUID client ID ships',
  !/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(js)
)

// SPA fallback.
await cp(`${OUT}/index.html`, `${OUT}/404.html`)
const fallback = await readFile(`${OUT}/404.html`, 'utf8')
check('404.html fallback references the subpath assets', fallback.includes(`/${REPO}/assets/`))

console.log(failures === 0 ? '\nPages build verified.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
