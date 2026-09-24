/**
 * Verifies that VITE_BASE_PATH actually drives Vite's `base`, which is what makes a
 * GitHub Pages project site (/<repo>/) load its assets instead of 404ing them.
 *
 * Uses resolveConfig rather than a full build so it never touches dist/ and cannot
 * race the runtime's own build watcher.
 */
import { resolveConfig } from 'vite'

const cases = [
  { env: undefined, expect: '/' },
  { env: '/', expect: '/' },
  { env: '/deriv-ai-predictor/', expect: '/deriv-ai-predictor/' },
]

let failures = 0

for (const { env, expect } of cases) {
  if (env === undefined) delete process.env.VITE_BASE_PATH
  else process.env.VITE_BASE_PATH = env

  const config = await resolveConfig({}, 'build')
  const ok = config.base === expect
  if (!ok) failures++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  VITE_BASE_PATH=${env ?? '(unset)'}  ->  base=${config.base}` +
      (ok ? '' : `  (expected ${expect})`)
  )
}

console.log(failures === 0 ? '\nAll base cases passed.' : `\n${failures} case(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
