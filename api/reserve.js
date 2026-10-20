"use strict";

/**
 * POST /api/reserve — Vercel serverless reservation endpoint.
 *
 * The page is fully static. This function validates a reservation request,
 * then delivers it to one or both of:
 *
 *   LEADS_WEBHOOK_URL  — any endpoint that accepts JSON (Zapier, Make, Airtable,
 *                        Google Apps Script, your CRM, …). Recommended.
 *   RESEND_API_KEY     — Resend transactional email (admin notification and,
 *                        optionally, a confirmation to the athlete).
 *
 * Configure at least one destination in production. With none configured the
 * endpoint deliberately fails in production instead of discarding a lead.
 *
 * Node 18+ (Vercel default). No npm dependencies.
 */

const crypto = require("node:crypto");
const https = require("node:https");

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

// Best-effort, per-instance limiter. Also configure rate limiting at the edge
// (Vercel Firewall, Cloudflare, or your reverse proxy) for real protection.
const rateBuckets = new Map();

function clean(value, maxLength) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxLength);
}

function parseBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body;
  }
  if (typeof request.body === "string") {
    return JSON.parse(request.body);
  }
  if (Buffer.isBuffer(request.body)) {
    return JSON.parse(request.body.toString("utf8"));
  }
  return null;
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
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return request.socket?.remoteAddress || "unknown";
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

function postJson(urlString, headers, payload) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      reject(new Error("Invalid destination URL."));
      return;
    }
    if (url.protocol !== "https:") {
      reject(new Error("Destination must use HTTPS."));
      return;
    }

    const body = JSON.stringify(payload);
    const request = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "ApexFitness-Reserve/1.0",
          ...headers,
        },
        timeout: 8_000,
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          const ok = response.statusCode >= 200 && response.statusCode < 300;
          if (ok) {
            resolve({ status: response.statusCode, data });
          } else {
            reject(new Error(`Destination responded ${response.statusCode}: ${data.slice(0, 300)}`));
          }
        });
      }
    );

    request.on("timeout", () => request.destroy(new Error("Destination timed out.")));
    request.on("error", reject);
    request.write(body);
    request.end();
  });
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

async function sendWithResend(lead, id) {
  const apiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.LEADS_EMAIL;
  if (!apiKey || !adminEmail) return { adminSent: false, confirmationSent: false };

  const from = process.env.RESERVATION_FROM_EMAIL || "ApexFitness <reservations@apexfitness.com>";
  const { text, html } = leadEmail(lead, id);
  const headers = { Authorization: `Bearer ${apiKey}` };

  await postJson(
    "https://api.resend.com/emails",
    headers,
    {
      from,
      to: [adminEmail],
      reply_to: lead.email,
      subject: `Reservation — ${lead.name} — ${id}`,
      text,
      html,
    }
  );

  let confirmationSent = false;
  if (process.env.SEND_LEAD_CONFIRMATION === "true") {
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

async function sendToWebhook(lead, id, request) {
  const url = process.env.LEADS_WEBHOOK_URL;
  if (!url) return false;

  const headers = {};
  if (process.env.LEADS_WEBHOOK_SECRET) {
    headers.Authorization = `Bearer ${process.env.LEADS_WEBHOOK_SECRET}`;
  }

  await postJson(url, headers, {
    event: "masterclass.reservation",
    id,
    receivedAt: new Date().toISOString(),
    lead,
    meta: {
      source: "apexfitness.com",
      cohort: "014",
      userAgent: clean(request.headers["user-agent"], 300),
      referer: clean(request.headers.referer, 300),
      ip: clientIp(request),
    },
  });
  return true;
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    response.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  const ip = clientIp(request);
  if (isRateLimited(ip)) {
    response.setHeader("Retry-After", "60");
    response.status(429).json({ ok: false, error: "Too many attempts. Please try again shortly." });
    return;
  }

  let payload;
  try {
    payload = parseBody(request);
  } catch {
    response.status(400).json({ ok: false, error: "Invalid request." });
    return;
  }

  if (!payload || JSON.stringify(payload).length > MAX_BODY_BYTES) {
    response.status(400).json({ ok: false, error: "Invalid request." });
    return;
  }

  const { lead, error } = validate(payload);
  if (error || !lead) {
    response.status(422).json({ ok: false, error: error || "Invalid request." });
    return;
  }

  const id = `APX-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const hasWebhook = Boolean(process.env.LEADS_WEBHOOK_URL);
  const hasResend = Boolean(process.env.RESEND_API_KEY && process.env.LEADS_EMAIL);
  const isProduction = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

  if (!hasWebhook && !hasResend && isProduction) {
    console.error("Reservation endpoint is not configured: set LEADS_WEBHOOK_URL or RESEND_API_KEY + LEADS_EMAIL.");
    response.status(503).json({
      ok: false,
      error: "Reservations are temporarily unavailable. Please email hello@apexfitness.com.",
    });
    return;
  }

  let emailSent = false;
  try {
    if (hasWebhook) {
      await sendToWebhook(lead, id, request);
    }
    if (hasResend) {
      const result = await sendWithResend(lead, id);
      emailSent = result.confirmationSent;
    }
  } catch (destinationError) {
    console.error("Reservation delivery failed:", destinationError.message);
    response.status(502).json({
      ok: false,
      error: "We couldn’t deliver your reservation just now. Please try again or email hello@apexfitness.com.",
    });
    return;
  }

  if (!hasWebhook && !hasResend) {
    // Development / preview without integrations: keep the lead visible in logs.
    console.log("Reservation received (no destination configured):", JSON.stringify({ id, lead }));
  }

  response.status(201).json({
    ok: true,
    id,
    emailSent,
    message: "Reservation received.",
  });
};
