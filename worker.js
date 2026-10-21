import { onRequest as reserve } from "./functions/api/reserve.js";
import { onRequest as health } from "./functions/api/health.js";

const API_ROUTES = new Map([
  ["/api/reserve", reserve],
  ["/api/health", health],
]);

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const route = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
    const handler = API_ROUTES.get(route);

    if (handler) {
      return handler({ request, env, ctx });
    }

    // Serve the static site from dist. Workers serves existing assets before
    // invoking this Worker by default; this fallback handles 404s and any
    // future run_worker_first configuration.
    return env.ASSETS.fetch(request);
  },
};
