# Deployment

Hosted on **GitHub Pages** via `.github/workflows/deploy-pages.yml`. Every push to
`main` builds the app and publishes it. No manual step needed.

## Live URL

```
https://archiebatshameki-source.github.io/deriv-ai-predictor/
```

Repo: `archiebatshameki-source/deriv-ai-predictor` (public — Pages on a private repo
needs GitHub Pro). Pages is enabled with **Source = GitHub Actions**.

A project site is served from a subpath, so the workflow sets
`VITE_BASE_PATH=/deriv-ai-predictor/` and asset URLs resolve correctly. A repo
named `<owner>.github.io` is a *user site* served from the domain root, and the
workflow detects that and sets `VITE_BASE_PATH=/` instead.

> Getting this wrong produces a blank white page with no useful console error: a
> `/` base on a project site makes the browser request assets from the domain root,
> where they 404.

## Deploying

The workflow runs on push to `main`, or on demand:

```
gh workflow run deploy-pages.yml
```

Pages must be enabled once, with **Source = GitHub Actions** (Settings → Pages).
A private repo needs GitHub Pro or higher for Pages; a public repo does not.

## How the app talks to Deriv

**Everything runs in the browser.** There is no proxy, no serverless function and no
server-side secret, so a static host is sufficient.

```
1. REST   GET  https://api.derivws.com/trading/v1/options/accounts
          Authorization: Bearer <API token>   +   Deriv-App-ID: <app id>
2. REST   POST https://api.derivws.com/trading/v1/options/accounts/{accountId}/otp
          → { data: { url } }   a pre-authenticated WebSocket URL, valid 120s, single use
3. WS     open that url → already authenticated, so no `authorize` message is sent
4. WS     { balance: 1 } / { propose: … } / { buy: … } / { proposal_open_contract: … }
```

Deriv sends permissive CORS headers for these endpoints — the preflight echoes the
caller's `Origin` and allows the `authorization` and `deriv-app-id` headers — which is
what makes step 1 and 2 possible straight from the browser. Confirm it any time with:

```
bun run scripts/probe-deriv-rest.mjs
```

Scopes required (per Deriv's OpenAPI spec): `trade` covers both the accounts list and
the OTP call. An API token with **Trade** and **Account management** ticked is enough.

### Why not OAuth

OAuth was implemented and then removed. It needs a registered OAuth-type application
*and* a server to perform the code→token exchange (Deriv forbids doing it in the
browser), which a static host cannot provide. The API-token flow needs neither.

### Why an App ID is required

Deriv requires a `Deriv-App-ID` header whenever a **Personal Access Token** is used
(an OAuth JWT does not need one). Register an application on
[developers.deriv.com](https://developers.deriv.com/) and paste its App ID into the
login screen; it is remembered in the browser. Without it, Deriv rejects the request
and the app says so explicitly.

## Build-time variables

| Variable | Purpose |
|---|---|
| `VITE_BASE_PATH` | Asset base. `/<repo>/` for a project site, `/` for a user site |

## Deep links

Pages has no rewrite rules, so the build copies `index.html` to `404.html`. An
unknown path then boots the SPA instead of showing a Pages error.

Expect the **HTTP status to still be `404`** on such a path — that is how Pages
signals "no file at this path", and it serves `404.html` as the body. The page renders
normally regardless, because the body is the real app. This matters when debugging: a
`404` from `curl` on a deep link is *not* a deployment failure — check the response
body for `id="root"`.

## Verification scripts

```
bun run scripts/test-base-path.mjs      # VITE_BASE_PATH drives Vite's base
bun run scripts/test-deriv-rest.ts      # REST layer: live endpoints, CORS, parsing, error mapping
bun run scripts/verify-pages-build.mjs  # reproduces the CI build and checks what ships
bun run scripts/probe-deriv-rest.mjs    # probes Deriv's live REST surface
bun run scripts/probe-deriv-ws.mjs      # probes which Deriv WebSocket hosts open
```

`verify-pages-build.mjs` builds to a temp dir on purpose: building into `dist/` would
race the runtime's own build watcher.
