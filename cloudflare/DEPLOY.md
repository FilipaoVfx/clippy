# Cloudflare Pages deployment

## Estructura

- `public/` contiene los assets estaticos.
- `public/_worker.js` sirve el SPA, expone `/health` y redirige `/ws` al Durable Object.
- `cloudflare/realtime/` contiene el Worker `clippy-realtime` con el Durable Object `ClippyCoordinator`.

## Por que hay dos despliegues

Cloudflare Pages puede usar bindings de Durable Objects, pero el Durable Object debe existir en un Worker aparte. Por eso este repo queda dividido en:

1. Pages para frontend y edge routing.
2. Worker aparte para el realtime.

## Despliegue

1. Despliega el Worker realtime:

```bash
npm run cf:realtime:deploy
```

2. Despliega Pages:

```bash
npm run cf:pages:deploy
```

3. Si usas Git integration, deja `wrangler.toml` en la raiz como source of truth del proyecto Pages.

## Desarrollo local

En una terminal:

```bash
npm run cf:realtime:dev
```

En otra:

```bash
npm run cf:pages:dev
```

## Configuracion incluida

- `wrangler.toml` enlaza Pages con el Worker `clippy-realtime`.
- `cloudflare/realtime/wrangler.toml` crea la migracion inicial del Durable Object.
- Los valores de TTL, rate limit y tamano maximo del mensaje quedan configurados en el Worker realtime y se pueden ajustar desde sus `vars`.
