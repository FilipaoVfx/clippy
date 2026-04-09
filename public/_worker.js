const SPA_ENTRY = "/index.html";
const HEALTH_PATH = "/health";
const WS_PATH = "/ws";

function getCoordinator(env) {
  const coordinatorName = env.CLIPPY_COORDINATOR_NAME || "global";
  const id = env.CLIPPY_COORDINATOR.idFromName(coordinatorName);
  return env.CLIPPY_COORDINATOR.get(id);
}

async function serveAsset(request, env) {
  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) {
    return assetResponse;
  }

  const acceptsHtml = (request.headers.get("accept") || "").includes("text/html");
  if (request.method === "GET" && acceptsHtml) {
    const url = new URL(request.url);
    return env.ASSETS.fetch(new Request(new URL(SPA_ENTRY, url), request));
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
