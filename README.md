# ApexFitness — 3-Day Strength Masterclass funnel

Static landing page plus a serverless reservation endpoint. The same site can
run locally, on Vercel, or on Cloudflare Workers.

## Local development

The page can be opened directly from `index.html` for a visual preview, but the
reservation form needs a server. From the repository root, use the included
zero-dependency Python server:

```bash
python3 server.py --port 4173
```

Open <http://127.0.0.1:4173>.

If Node.js is installed, `npm run dev` runs the same server.

The local server handles both the static site and `POST /api/reserve`, appending
each reservation to `data/leads.jsonl`.

- `GET /api/health` → `{"ok": true, "service": "apex-reserve"}`
- `POST /api/reserve` → validates and stores a reservation

`python3 -m http.server` only serves static files and will not accept the form
submission.

## Cloudflare Workers (Workers Builds)

The failing Cloudflare project is a **Worker**, not a Pages project. Workers
Builds runs `npx wrangler deploy`; without an explicit Wrangler config, Wrangler
auto-detected the repository root as the static assets directory. That tried to
upload `node_modules/workerd/bin/workerd` (134 MiB), which is above Cloudflare's
25 MiB asset limit.

`wrangler.jsonc` now pins the asset directory to `./dist` and provides a Worker
entrypoint for the API routes. This prevents `node_modules` and other repository
files from ever becoming deployment assets.

### Build settings

| Setting | Value |
| --- | --- |
| Framework preset | `None` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` (default) |
| Root directory | leave blank |
| Production branch | your branch, usually `main` |

`wrangler.jsonc` defines:

- `main`: `./worker.js`
- `assets.directory`: `./dist`
- `assets.binding`: `ASSETS`
- `assets.not_found_handling`: `404-page`

`npm run build` runs `build.sh`, which copies only the public site files,
`_headers`, and `_redirects` into `dist`. `worker.js` routes `/api/reserve` and
`/api/health` to the handlers in `functions/api/`, then falls back to
`env.ASSETS.fetch(request)` for the static site.

Do not remove `wrangler.jsonc`. Without it, Workers autoconfig can select the
repository root and include `node_modules` in the asset upload.

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
| `ALLOW_UNCONFIGURED_LEADS` | preview only | `true` allows a 201 response without any destination; the lead is only logged |

If no destination is configured, `POST /api/reserve` returns **503** by design,
so a lead is never silently discarded. `ALLOW_UNCONFIGURED_LEADS=true` exists
only for preview/testing deployments.

### Deploy from Git

1. Push the repository to GitHub/GitLab.
2. In Cloudflare, go to **Workers & Pages → Create application → Workers → Connect to Git**.
3. Select the repository.
4. Use the build settings above.
5. Add the environment variables.
6. Save and deploy.

### Test locally

```bash
cp .dev.vars.example .dev.vars   # fill in a destination or set ALLOW_UNCONFIGURED_LEADS=true
npm run preview:cloudflare
```

This runs `build.sh` and starts `wrangler dev`, which reads `wrangler.jsonc` and
serves the Worker plus the files in `dist`.

### Cloudflare Pages alternative

The handlers in `functions/api/` remain compatible with Cloudflare Pages. If you
intended to create a Pages project instead, use the Pages Git integration, set
its build output directory to `dist`, and use `functions/` for the API. Do not
add `pages_build_output_dir` to `wrangler.jsonc`; it is the Workers config.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/reserve` | Validate and deliver a reservation |
| `OPTIONS` | `/api/reserve` | Preflight/method-discovery response |
| `GET` | `/api/health` | Health check (Cloudflare Worker/Pages Function) |

Cloudflare's per-isolate rate limit is best-effort. Add a WAF rate-limiting rule
for `/api/reserve` if the site receives real traffic.

## Deployment notes

- `_headers` and `_redirects` are Cloudflare static-asset files. They are copied
  into `dist` by `build.sh`. Workers applies them to static asset responses;
  Worker/API responses set their own security headers.
- Cloudflare serves `/privacy` and `/terms` from `privacy.html` and
  `terms.html`, and `_redirects` makes the `.html` redirects permanent (301).
- `worker.js` routes `/api/reserve` and `/api/health` to the handlers in
  `functions/api/`; all other requests fall through to `env.ASSETS`.
- Vercel remains supported through `vercel.json` and `api/reserve.js`.
- Never commit `.env`, `.dev.vars`, or real API keys.
