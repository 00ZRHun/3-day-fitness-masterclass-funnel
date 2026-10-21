/**
 * POST /api/reserve — Cloudflare Pages Function.
 *
 * The page is fully static. This function validates a reservation request and
 * delivers it to one or both of:
 *
 *   LEADS_WEBHOOK_URL  — any endpoint that accepts JSON (Zapier, Make,
 *                        Airtable, Google Apps Script, your CRM, …).
 *   RESEND_API_KEY     — Resend transactional email (admin notification and,
 *                        optionally, a confirmation to the athlete).
 *
 * Configure the values in Cloudflare Pages → Settings → Variables and Secrets,
 * or in `.dev.vars` for `npx wrangler pages dev`.
 *
 * If no destination is configured, the function returns 503 instead of
 * silently discarding a lead. Set ALLOW_UNCONFIGURED_LEADS=true only for a
 * preview/testing deployment where losing the lead is acceptable.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const ALLOWED_GOALS = new Set([
  "get-stronger",
  "master-technique",
  "move-pain-free",
  "build-consistency",
]);
const ALLOWED_EXPERIENCE = new Set(["new", "intermediate", "advanced"]);
const ALLOWED_PLANS = new Set(["full", "installments"]);
const MAX_BODY_BYTES = 32 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 8;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

// Best-effort, per-isolate limiter. Cloudflare may run several isolates, so
// also configure a rate-limiting rule at the edge (WAF) for real protection.
const rateBuckets = new Map();

function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function clean(value, maxLength) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxLength);
}

function validate(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Invalid request." };
  }

  // Honeypot. Real people never fill this field.
  if (clean(payload.company, 100)) {
    return { error: "Invalid request." };
  }

  const name = clean(payload.name, 80);
  const email = clean(payload.email, 160).toLowerCase();
  const phone = clean(payload.phone, 32);
  const note = clean(payload.note, 800);
  const goal = clean(payload.goal, 40);
  const experience = clean(payload.experience, 20);
  let plan = clean(payload.plan, 20) || "full";

  if (name.length < 2) {
    return { error: "Please enter your full name." };
  }
  if (!EMAIL_RE.test(email)) {
    return { error: "Please enter a valid email address." };
  }
  if (goal && !ALLOWED_GOALS.has(goal)) {
    return { error: "Please choose a training goal." };
  }
  if (experience && !ALLOWED_EXPERIENCE.has(experience)) {
    return { error: "Please choose your experience level." };
  }
  if (!ALLOWED_PLANS.has(plan)) plan = "full";
  if (payload.consent !== true) {
    return { error: "Please accept the cancellation policy to continue." };
  }

  return {
    lead: {
      name,
      email,
      phone,
      note,
      goal: goal || null,
      experience: experience || null,
      plan,
      cohort: "014",
    },
  };
}

function clientIp(request) {
  // CF-Connecting-IP is set by Cloudflare and cannot be spoofed by the client.
  const connectingIp = request.headers.get("cf-connecting-ip");
  if (connectingIp) return connectingIp;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = (rateBuckets.get(ip) || []).filter((time) => now - time < RATE_WINDOW_MS);
  if (bucket.length >= RATE_MAX_REQUESTS) {
    rateBuckets.set(ip, bucket);
    return true;
  }
  bucket.push(now);
  rateBuckets.set(ip, bucket);

  if (rateBuckets.size > 5_000) {
    for (const [key, times] of rateBuckets) {
      if (!times.some((time) => now - time < RATE_WINDOW_MS)) rateBuckets.delete(key);
    }
  }
  return false;
}

function reservationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `APX-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

async function postJson(urlString, headers, payload) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Invalid destination URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Destination must use HTTPS.");
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "ApexFitness-Reserve/1.0",
      ...headers,
    },
    body: JSON.stringify(payload),
    // Do not follow redirects. Workers forwards headers (including
    // Authorization) across redirects, which could leak the webhook secret.
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  });

  const data = await response.text();
  if (!response.ok) {
    throw new Error(`Destination responded ${response.status}: ${data.slice(0, 300)}`);
  }
  return { status: response.status, data };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plain(value) {
  return String(value || "—");
}

function leadEmail(lead, id) {
  const rows = [
    ["Reference", id],
    ["Name", lead.name],
    ["Email", lead.email],
    ["Phone", lead.phone || "—"],
    ["Plan", lead.plan === "installments" ? "2 × $159" : "$299 in full"],
    ["Goal", lead.goal || "—"],
    ["Experience", lead.experience || "—"],
    ["Note", lead.note || "—"],
    ["Cohort", "014 · Nov 6–8, 2026"],
  ];

  const text = rows.map(([label, value]) => `${label}: ${plain(value)}`).join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f2efe6;color:#111827;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px">
    <div style="background:#070d1d;color:#fff;padding:24px 26px;border-radius:10px 10px 0 0">
      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#d8ff6b">ApexFitness · Cohort 014</div>
      <h1 style="margin:10px 0 0;font-size:26px;line-height:1.1">New reservation request</h1>
    </div>
    <div style="background:#fff;padding:24px 26px;border:1px solid #e5e2d9;border-top:0;border-radius:0 0 10px 10px">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:8px 0;color:#6b7280;width:120px;vertical-align:top">${escapeHtml(
                label
              )}</td><td style="padding:8px 0;font-weight:600">${escapeHtml(plain(value))}</td></tr>`
          )
          .join("")}
      </table>
      <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#6b7280">No payment has been taken. Reply to this email to reach ${escapeHtml(
        lead.name
      )} at ${escapeHtml(lead.email)}.</p>
    </div>
  </div>
</body></html>`;

  return { text, html };
}

function confirmationEmail(lead, id) {
  const first = lead.name.split(/\s+/)[0];
  return {
    subject: `Your ApexFitness reservation — ${id}`,
    text: [
      `Hi ${first},`,
      "",
      "We received your request for Cohort 014 of the ApexFitness 3-Day Strength Masterclass (November 6–8, 2026).",
      "",
      `Reference: ${id}`,
      `Plan selected: ${lead.plan === "installments" ? "2 payments of $159" : "$299 in full"}`,
      "",
      "No payment has been taken. A coach will confirm your spot by email within one business day, along with the secure enrollment link and the exact SoHo address.",
      "",
      "If anything changes, just reply to this email.",
      "",
      "— The ApexFitness team",
      "Apex Strength Lab · SoHo, New York",
    ].join("\n"),
  };
}

async function sendWithResend(lead, id, env) {
  const apiKey = env.RESEND_API_KEY;
  const adminEmail = env.LEADS_EMAIL;
  if (!apiKey || !adminEmail) return { adminSent: false, confirmationSent: false };

  const from =
    env.RESERVATION_FROM_EMAIL || "ApexFitness <reservations@apexfitness.com>";
  const { text, html } = leadEmail(lead, id);
  const headers = { Authorization: `Bearer ${apiKey}` };

  await postJson("https://api.resend.com/emails", headers, {
    from,
    to: [adminEmail],
    reply_to: lead.email,
    subject: `Reservation — ${lead.name} — ${id}`,
    text,
    html,
  });

  let confirmationSent = false;
  if (env.SEND_LEAD_CONFIRMATION === "true") {
    const confirmation = confirmationEmail(lead, id);
    await postJson("https://api.resend.com/emails", headers, {
      from,
      to: [lead.email],
      subject: confirmation.subject,
      text: confirmation.text,
    });
    confirmationSent = true;
  }

  return { adminSent: true, confirmationSent };
}

async function sendToWebhook(lead, id, request, env) {
  const url = env.LEADS_WEBHOOK_URL;
  if (!url) return false;

  const headers = {};
  if (env.LEADS_WEBHOOK_SECRET) {
    headers.Authorization = `Bearer ${env.LEADS_WEBHOOK_SECRET}`;
  }

  await postJson(url, headers, {
    event: "masterclass.reservation",
    id,
    receivedAt: new Date().toISOString(),
    lead,
    meta: {
      source: "apexfitness.com",
      cohort: "014",
      userAgent: clean(request.headers.get("user-agent"), 300),
      referer: clean(request.headers.get("referer"), 300),
      ip: clientIp(request),
    },
  });
  return true;
}

export async function onRequest(context) {
  const { request, env = {} } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        Allow: "POST, OPTIONS",
      },
    });
  }

  if (request.method !== "POST") {
    return json(
      405,
      { ok: false, error: "Method not allowed." },
      { Allow: "POST, OPTIONS" }
    );
  }

  const ip = clientIp(request);
  if (isRateLimited(ip)) {
    return json(
      429,
      { ok: false, error: "Too many attempts. Please try again shortly." },
      { "Retry-After": "60" }
    );
  }

  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_BODY_BYTES) {
    return json(400, { ok: false, error: "Invalid request." });
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return json(400, { ok: false, error: "Invalid request." });
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json(400, { ok: false, error: "Invalid request." });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { ok: false, error: "Invalid request." });
  }

  const { lead, error } = validate(payload);
  if (error || !lead) {
    return json(422, { ok: false, error: error || "Invalid request." });
  }

  const id = reservationId();
  const hasWebhook = Boolean(env.LEADS_WEBHOOK_URL);
  const hasResend = Boolean(env.RESEND_API_KEY && env.LEADS_EMAIL);
  const allowUnconfigured =
    String(env.ALLOW_UNCONFIGURED_LEADS || "").toLowerCase() === "true";

  if (!hasWebhook && !hasResend && !allowUnconfigured) {
    console.error(
      "Reservation endpoint is not configured: set LEADS_WEBHOOK_URL or RESEND_API_KEY + LEADS_EMAIL."
    );
    return json(503, {
      ok: false,
      error:
        "Reservations are temporarily unavailable. Please email hello@apexfitness.com.",
    });
  }

  let emailSent = false;
  try {
    if (hasWebhook) {
      await sendToWebhook(lead, id, request, env);
    }
    if (hasResend) {
      const result = await sendWithResend(lead, id, env);
      emailSent = result.confirmationSent;
    }
  } catch (destinationError) {
    console.error("Reservation delivery failed:", destinationError.message);
    return json(502, {
      ok: false,
      error:
        "We couldn’t deliver your reservation just now. Please try again or email hello@apexfitness.com.",
    });
  }

  if (!hasWebhook && !hasResend) {
    // ALLOW_UNCONFIGURED_LEADS is for preview/testing only. The lead is not
    // persisted anywhere; it is only visible in the Pages function logs.
    console.log("Reservation received (no destination configured):", JSON.stringify({ id, lead }));
  }

  return json(201, {
    ok: true,
    id,
    emailSent,
    message: "Reservation received.",
  });
}
