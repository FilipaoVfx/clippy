import { coordinatorNameFor } from "./realtime/src/index.js";
export { ClippyCoordinator } from "./realtime/src/index.js";

const SPA_ENTRY = "/index.html";
// Served (with a 404 status) for any page that does not exist. Requested
// without the extension because asset html_handling redirects "/404.html".
const NOT_FOUND_PAGE = "/404";
const HEALTH_PATH = "/health";
const WS_PATH = "/ws";

/**
 * Sessions are sharded across Durable Objects by pairing code, so concurrent
 * sessions do not contend for a single object's request throughput.
 */
function getCoordinator(env, request) {
  const id = env.CLIPPY_COORDINATOR.idFromName(coordinatorNameFor(request));
  return env.CLIPPY_COORDINATOR.get(id);
}

// Content pages are served without an extension ("/faq") or as a directory
// ("/es/"), so anything whose last segment has no dot is an HTML page.
function isPagePath(pathname) {
  return pathname.endsWith("/") || !pathname.slice(pathname.lastIndexOf("/") + 1).includes(".");
}

// Files that must always be revalidated so a new deploy is picked up
// immediately (no stale PWA / no forced reinstall). Everything else may be
// briefly cached but still revalidates cheaply.
function cacheControlFor(pathname) {
  if (
    pathname === SPA_ENTRY ||
    isPagePath(pathname) ||
    pathname.endsWith(".html") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest"
  ) {
    return "no-cache";
  }
  // Static assets: cache but revalidate (unhashed filenames → keep them fresh).
  return "public, max-age=0, must-revalidate";
}

// pastty.com is the only canonical host; the workers.dev URL is a mirror.
function isMirror(url) {
  return url.hostname.endsWith(".workers.dev");
}

function withHeaders(response, pathname, url) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", cacheControlFor(pathname));
  if (url && isMirror(url)) headers.set("X-Robots-Tag", "noindex");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function serveAsset(request, env) {
  const url = new URL(request.url);
  const assetResponse = await env.ASSETS.fetch(request);
  // The 404 page itself is not a page: visiting it directly is still a 404.
  if (assetResponse.status !== 404 && url.pathname !== NOT_FOUND_PAGE) {
    return withHeaders(assetResponse, url.pathname, url);
  }

  const readable = request.method === "GET" || request.method === "HEAD";

  // Pairing links have always been "/?code=…"; keep any other path that
  // carries a code working instead of answering it with a 404.
  const code = url.searchParams.get("code");
  if (readable && code) {
    return Response.redirect(new URL(`/?code=${encodeURIComponent(code)}`, url).toString(), 302);
  }

  // Unknown pages get a real 404 (not the app with a 200, which search
  // engines report as a soft 404). Missing assets stay plain 404s.
  const acceptsHtml = (request.headers.get("accept") || "").includes("text/html");
  if (readable && acceptsHtml) {
    const page = await env.ASSETS.fetch(new Request(new URL(NOT_FOUND_PAGE, url), request));
    const headers = new Headers(page.headers);
    headers.set("Cache-Control", "no-cache");
    headers.set("X-Robots-Tag", "noindex");
    return new Response(page.body, { status: 404, statusText: "Not Found", headers });
  }

  return assetResponse;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // One canonical host: www.pastty.com → pastty.com (path and query kept).
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === WS_PATH) {
      const upgrade = request.headers.get("Upgrade");
      if (!upgrade || upgrade.toLowerCase() !== "websocket") {
        return new Response("Expected websocket upgrade.", { status: 426 });
      }

      return getCoordinator(env, request).fetch(request);
    }

    if (url.pathname === HEALTH_PATH) {
      // Preserve the code so the probe reaches the shard being asked about.
      const probeUrl = new URL("https://clippy.internal/health");
      const code = url.searchParams.get("code");
      if (code) probeUrl.searchParams.set("code", code);

      return getCoordinator(env, request).fetch(
        new Request(probeUrl, {
          method: "GET",
        })
      );
    }

    return serveAsset(request, env);
  },
};

