# Deployment

Hosted on **GitHub Pages** via `.github/workflows/deploy-pages.yml`. Every push to
`main` builds the app and publishes it. No manual step needed.

## Live URL

A project site is served from a subpath:

```
https://<owner>.github.io/<repo>/
```

The workflow sets `VITE_BASE_PATH=/<repo>/` so asset URLs resolve correctly. A repo
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

## Serverless endpoints — read this before enabling OAuth

`api/deriv/*.ts` implements the Deriv OAuth 2.0 code→token exchange, the account
list, and the OTP socket URL. **GitHub Pages is static-only and cannot run them**, so
on this host those paths 404 and the OAuth login is unavailable.

The **API token** tab is unaffected — it talks to Deriv directly from the browser
over WebSocket and needs no server.

To make OAuth work you need a host with a Node/serverless runtime (Vercel, Netlify,
Cloudflare Workers) plus these environment variables:

| Variable | Purpose |
|---|---|
| `DERIV_CLIENT_ID` | Deriv OAuth app client ID |
| `DERIV_CLIENT_SECRET` | Deriv OAuth app secret — server-side only, never send to the client |

Two build-time variables control how the client behaves on a subpath host:

| Variable | Purpose |
|---|---|
| `VITE_BASE_PATH` | Asset base. `/<repo>/` for a project site, `/` for a user site |
| `VITE_REGISTERED_ORIGIN` | Origin the redirect URI is registered on (no path). When unset the app assumes the current origin is registered, so it does not nag before any URI exists |
| `VITE_STATIC_HOSTING` | Set to `1` when there is no server runtime. The login screen then opens the API token tab by default and explains why OAuth is unavailable here |

The redirect URI registered with Deriv must match exactly, including the base path:

```
https://<owner>.github.io/<repo>/oauth/callback
```

`getRedirectUri()` derives it from `window.location.origin` + `BASE_URL`, so it
follows the deploy automatically.

## Deep links

Pages has no rewrite rules, so the build copies `index.html` to `404.html`. An
unknown path such as `/oauth/callback` then boots the SPA and the app's own router
handles it, instead of returning a GitHub 404.
