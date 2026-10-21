# ApexFitness — 3-Day Strength Masterclass funnel

Production landing page for the ApexFitness 3-Day Strength Masterclass. The
public site is static HTML/CSS/JS, built into `dist/`, and served by a
Cloudflare Worker that also handles reservation delivery.

The `static-page` branch is intentionally deploy-only: it contains the static
page, its assets, the Worker API handlers, and the minimal build/deployment
configuration. Development servers and Python tooling are kept off this branch.

## Requirements

- Node.js 22 or newer
- npm

A `.nvmrc` pins Node 22 for local tooling and Cloudflare Workers Builds.

## Local preview

```bash
npm install
cp .dev.vars.example .dev.vars   # set a destination or ALLOW_UNCONFIGURED_LEADS=true
npm run preview
```

`npm run preview` runs the build and starts `wrangler dev`, serving the Worker
and `dist/` at <http://localhost:8787>.

For a visual-only preview without the API, run `npm run build` and serve
`dist/` with any static file server.

## Build

```bash
npm run build
```

`build.sh` clears `dist/` and copies only public files:

- `index.html`, `privacy.html`, `terms.html`, `404.html`
- `assets/` (CSS, JS, images, fonts, icons, social image)
- `robots.txt`, `sitemap.xml`, `site.webmanifest`
- `_headers`, `_redirects`, `.assetsignore`

Worker source, `node_modules`, and repository tooling are never copied into
`dist/`. The build also fails if any public asset exceeds Cloudflare's 25 MiB
per-file limit.

## Cloudflare Workers deployment

### Root cause of the failed build

The failed build used Wrangler's auto-detected project root as the asset
directory. Workers Builds had installed Wrangler under `node_modules`, so the
upload included:

```text
node_modules/workerd/bin/workerd (134 MiB)
```

Cloudflare rejects any asset larger than 25 MiB. The deployment must therefore
use an explicit, isolated asset directory and exclude `node_modules`.

### Fix

- `wrangler.jsonc` pins `assets.directory` to `./dist` and points `main` at
  `./worker.js`.
- Wrangler is pinned to `4.151.3` in `devDependencies`; Workers Builds uses that
  version instead of an unknown default.
- `dist/.assetsignore` excludes control files and any dependency folders from
  the upload.
- A repository-root `.assetsignore` is also committed as a fail-safe if
  Wrangler is ever auto-configured with `./` as the asset directory.
- `build.sh` only copies the public site into `dist/`, so `node_modules` and
  Worker source cannot become public assets.
- The deployment uses the `static-page` branch.

### Build settings

In **Workers & Pages → your Worker → Settings → Build**:

| Setting | Value |
| --- | --- |
| Git branch | `static-page` |
| Framework preset | `None` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | leave blank |
| Node version | 22 |

Then push to `static-page`. Workers Builds will install the pinned Wrangler,
build `dist/`, and deploy only the contents of `./dist`.

### Environment variables

Add these in **Workers & Pages → your Worker → Settings → Variables and
Secrets**. Set at least one delivery destination:

| Variable | Required | Purpose |
| --- | --- | --- |
| `LEADS_WEBHOOK_URL` | one destination | HTTPS endpoint that accepts JSON (Zapier, Make, Airtable, CRM, …) |
| `LEADS_WEBHOOK_SECRET` | optional | Sent as `Authorization: Bearer …` to the webhook |
| `RESEND_API_KEY` | one destination | Resend API key for email delivery |
| `LEADS_EMAIL` | with Resend | Admin address that receives the reservation |
| `RESERVATION_FROM_EMAIL` | optional | Verified Resend sender |
| `SEND_LEAD_CONFIRMATION` | optional | `true` sends the athlete a confirmation email |
| `ALLOW_UNCONFIGURED_LEADS` | preview only | `true` returns 201 without a destination; the lead is only logged |

If no destination is configured, `POST /api/reserve` returns **503** by design,
so a lead is never silently discarded. `ALLOW_UNCONFIGURED_LEADS=true` must not
be used in production.

## Routing and endpoints

- `/` — landing page
- `/privacy`, `/terms` — legal pages (clean canonical URLs)
- `/privacy.html`, `/terms.html`, `/index.html` — permanent 301 redirects
- `/api/reserve` — validate and deliver a reservation
- `/api/health` — `{"ok": true, "service": "apex-reserve"}`

Cloudflare serves `privacy.html` and `terms.html` at the clean URLs and applies
the explicit redirects in `_redirects`. `_headers` adds security and cache
headers to static responses; the Worker sets its own API headers.

## Attribution, analytics, and deep links

Campaign values are captured on first landing and kept in `sessionStorage` under
`apex_attribution_v1` (they clear when the tab closes):

- `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`
- `gclid`, `fbclid`, `msclkid`, `ttclid`, `ref`
- sanitized referrer, landing path, and first/last-seen timestamps

The reservation payload includes this object plus the current `page`. The API
accepts only known fields, caps each value at 160 characters, and strips unknown
keys before storage, email, or webhook delivery.

Supported campaign links:

| URL | Behaviour |
| --- | --- |
| `/?reserve=1` | Opens the reservation dialog after load |
| `/?plan=installments` | Preselects the two-payment plan |
| `/#reserve` | Also opens the reservation dialog |
| `/?reserve=1&plan=installments` | Combines both deep links |

The page pushes `view_item`, `reserve_open`, `begin_checkout`, `generate_lead`,
`scroll_depth`, `calendar_download`, and other interaction events to
`window.dataLayer` (and to `gtag` when present). Update `CONFIG.spotsLeft` and
`CONFIG.capacity` in `assets/js/main.js` to change displayed availability; the
static HTML values remain as no-JavaScript fallbacks.

## Verification

```bash
npm install
npm run build
npx wrangler deploy --dry-run
```

`--dry-run` must report `Read N files from the assets directory …/dist` and must
not report any file over 25 MiB. For end-to-end checks, run `npm run preview`
and submit the reservation form with `ALLOW_UNCONFIGURED_LEADS=true`; then test
desktop/mobile layouts, keyboard access, deep links, and `/api/health`.

## Security notes

- Never commit `.env`, `.dev.vars`, or real API keys.
- The per-isolate API rate limit is best-effort. Add a Cloudflare WAF
  rate-limiting rule for `/api/reserve` if the page receives real traffic.
- Both API handlers validate email, consent, and the honeypot, cap request
  bodies at 32 KiB, and sanitize attribution before delivery.
