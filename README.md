# ApexFitness — 3-Day Strength Masterclass funnel

Static landing page plus a serverless reservation endpoint. The same site can
run locally, on Vercel, or on Cloudflare Pages.

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

## Cloudflare Pages

### Build settings

| Setting | Value |
| --- | --- |
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | leave blank |
| Production branch | your branch, usually `main` |

`npm run build` runs `build.sh`, which copies only the public site files,
`_headers`, and `_redirects` into `dist`. Pages Functions are loaded from the
top-level `functions/` directory automatically.

If you prefer no build script, use the build command `exit 0` and the output
directory `/`. That works too, but it also publishes `server.py`, `api/`, and
`tools/` as static files.

### Environment variables

Add these in **Workers & Pages → your Pages project → Settings → Variables and
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
2. In Cloudflare, go to **Workers & Pages → Create → Pages → Connect to Git**.
3. Select the repository.
4. Use the build settings above.
5. Add the environment variables.
6. Save and deploy.

### Test the Cloudflare Function locally

```bash
cp .dev.vars.example .dev.vars   # fill in a destination or set ALLOW_UNCONFIGURED_LEADS=true
npm run preview:cloudflare
```

This runs `build.sh` and starts `wrangler pages dev dist`. Wrangler loads
`functions/` from the repository root.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/reserve` | Validate and deliver a reservation |
| `OPTIONS` | `/api/reserve` | Preflight/method-discovery response |
| `GET` | `/api/health` | Health check (Cloudflare Pages Function) |

Cloudflare's per-isolate rate limit is best-effort. Add a WAF rate-limiting rule
for `/api/reserve` if the site receives real traffic.

## Deployment notes

- `_headers` and `_redirects` are Cloudflare Pages files. They are copied into
  `dist` by `build.sh`. Headers do not apply to Pages Functions, so the function
  sets its own security headers.
- Cloudflare Pages automatically serves `/privacy` and `/terms` from
  `privacy.html` and `terms.html`, and redirects `*.html` to the clean URL.
  `_redirects` makes those redirects permanent (301).
- Vercel remains supported through `vercel.json` and `api/reserve.js`. The
  Cloudflare implementation lives in `functions/api/reserve.js`.
- Never commit `.env`, `.dev.vars`, or real API keys.
