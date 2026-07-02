const SPA_ENTRY = "/index.html";
const HEALTH_PATH = "/health";
const WS_PATH = "/ws";

function getCoordinator(env) {
  const coordinatorName = env.CLIPPY_COORDINATOR_NAME || "global";
  const id = env.CLIPPY_COORDINATOR.idFromName(coordinatorName);
  return env.CLIPPY_COORDINATOR.get(id);
}

// Files that must always be revalidated so a new deploy is picked up
// immediately (no stale PWA / no forced reinstall). Everything else may be
// briefly cached but still revalidates cheaply.
function cacheControlFor(pathname) {
  if (
    pathname === "/" ||
    pathname === SPA_ENTRY ||
    pathname.endsWith(".html") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest"
  ) {
    return "no-cache";
  }
  // Static assets: cache but revalidate (unhashed filenames → keep them fresh).
  return "public, max-age=0, must-revalidate";
}

function withHeaders(response, pathname) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", cacheControlFor(pathname));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function serveAsset(request, env) {
  const url = new URL(request.url);
  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) {
    return withHeaders(assetResponse, url.pathname);
  }

  const acceptsHtml = (request.headers.get("accept") || "").includes("text/html");
  if (request.method === "GET" && acceptsHtml) {
    const fallback = await env.ASSETS.fetch(new Request(new URL(SPA_ENTRY, url), request));
    return withHeaders(fallback, SPA_ENTRY);
  }

  return assetResponse;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === WS_PATH) {
      const upgrade = request.headers.get("Upgrade");
      if (!upgrade || upgrade.toLowerCase() !== "websocket") {
        return new Response("Expected websocket upgrade.", { status: 426 });
      }

      return getCoordinator(env).fetch(request);
    }

    if (url.pathname === HEALTH_PATH) {
      return getCoordinator(env).fetch(
        new Request("https://clippy.internal/health", {
          method: "GET",
        })
      );
    }

    return serveAsset(request, env);
  },
};
