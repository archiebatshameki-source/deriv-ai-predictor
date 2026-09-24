/**
 * Reproduces what the GitHub Pages workflow does, so the subpath build can be verified
 * before it is relied on in CI:
 *   - base = /<repo>/        (assets must not point at the domain root)
 *   - VITE_STATIC_HOSTING=1  (login screen must open the API token tab)
 *   - index.html -> 404.html (deep links must boot the SPA)
 *
 * Builds to a temp dir so it never touches dist/ or races the runtime's build watcher.
 */
import { build } from 'vite'
import { cp, readFile, rm } from 'node:fs/promises'

const OUT = '/tmp/pages-verify'
const REPO = 'deriv-ai-predictor'

process.env.VITE_BASE_PATH = `/${REPO}/`
process.env.VITE_STATIC_HOSTING = '1'
process.env.VITE_REGISTERED_ORIGIN = 'https://example-user.github.io'

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

// The static-hosting branch must survive into the bundle (it is dead-code-eliminated
// when the flag is off, so its presence here proves the flag reached the build).
const jsName = srcs.find(s => s.endsWith('.js'))
const js = await readFile(`${OUT}${jsName.replace(`/${REPO}`, '')}`, 'utf8')
check('static-hosting notice is in the bundle', js.includes('hosted statically'))
check('registered origin is inlined', js.includes('example-user.github.io'))
check('OAuth-in-unavailable notice is in the bundle', js.includes('static, so the OAuth login is unavailable'))

// SPA fallback.
await cp(`${OUT}/index.html`, `${OUT}/404.html`)
const fallback = await readFile(`${OUT}/404.html`, 'utf8')
check('404.html fallback references the subpath assets', fallback.includes(`/${REPO}/assets/`))

console.log(failures === 0 ? '\nPages build verified.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
