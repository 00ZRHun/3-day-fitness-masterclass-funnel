const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed." }), {
      status: 405,
      headers: { ...HEADERS, Allow: "GET" },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, service: "apex-reserve", runtime: "cloudflare-pages" }),
    { status: 200, headers: HEADERS }
  );
}
