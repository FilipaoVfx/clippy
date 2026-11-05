# Desplegar Clippy en Cloudflare Workers

## Configuración actual de pastty.com

El repositorio también está conectado al proyecto **Cloudflare Pages `clippy`**,
que sirve la interfaz en `pastty.com`. El Worker `clippy-realtime` sigue siendo
necesario para el backend: Pages estático no implementa WebSockets ni crea el
Durable Object. Si se elimina ese Worker, vuelve a ejecutar **Deploy Cloudflare**
en GitHub Actions para recrearlo con su binding y migración.

El archivo raíz `wrangler.toml` configura las rutas `pastty.com/ws*` y
`pastty.com/health*` sobre la zona `pastty.com`. Estas rutas envían las peticiones
de API al Worker sobre el DNS proxied existente del dominio. El token de despliegue
necesita **Zone: Workers Routes (Edit)** y acceso de lectura a esa zona, además de
los permisos de Workers de la cuenta. No requiere eliminar el dominio de Pages.

GitHub Actions publica el backend y comprueba el dominio con:

```bash
npm run cf:verify -- https://pastty.com
```

La comprobación exige JSON de salud, estado 426 para HTTP normal en `/ws`, y un
upgrade WebSocket con respuesta `pong`. No crea sesiones ni envía contenido.
Si `/health` devuelve HTML, el dominio está sirviendo Pages sin enrutar el backend.

Las opciones siguientes describen también el despliegue autónomo del Worker
completo, que puede servir frontend y backend desde su URL `workers.dev`.

Usa **Workers**, con el nombre **`clippy-realtime`**. Un solo despliegue incluye
la PWA, los archivos estáticos, `/health`, `/ws` y el Durable Object.
No hace falta crear Pages, una base D1, KV, R2, ni configurar una URL de backend.

## Opción A: GitHub Actions (ya incluida)

1. En Cloudflare, copia el **Account ID** de tu cuenta.
2. Crea un API token desde **My Profile → API Tokens → Create Token**.
   Usa la plantilla **Edit Cloudflare Workers**, limitada a la cuenta de destino.
   Para este despliegue necesita permisos de escritura de Workers Scripts y
   lectura de Account Settings; conserva los permisos adicionales de la plantilla.
   Si luego agregas rutas de dominio por Wrangler, necesitarás también Workers Routes
   sobre esa zona. Para `workers.dev` no hace falta configurar una zona.
3. En GitHub → `FilipaoVfx/clippy` → **Settings → Secrets and variables → Actions**,
   configura `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`.
   Si ya existen, comprueba que apuntan a la cuenta correcta y siguen vigentes.
4. Abre **Actions → Deploy Cloudflare → Run workflow → main**.
   También se ejecuta automáticamente con cada push a `main`.
5. Espera los pasos de pruebas, validación y despliegue. El último imprime la URL
   `https://clippy-realtime.<tu-subdominio>.workers.dev`.
6. En Cloudflare → **Workers & Pages**, abre `clippy-realtime`.
   La vinculación `CLIPPY_COORDINATOR` y la clase `ClippyCoordinator` se crean
   automáticamente desde `wrangler.toml`.

Los nombres de ambos secretos ya existían al preparar esta configuración;
esto no comprueba por sí solo que sus valores o permisos sean válidos.

## Opción B: conectar GitHub desde Cloudflare

Usa esta alternativa si prefieres que Cloudflare construya y despliegue el repo.
Primero desactiva el workflow **Deploy Cloudflare** en GitHub Actions para evitar
dos publicaciones simultáneas. Si el Worker ya existe, conecta su repositorio en
**Settings → Builds**; si no, créalo mediante la opción de importar un repositorio.

1. En **Workers & Pages → Create application**, elige importar/conectar GitHub
   para crear un **Worker**.
2. Autoriza el acceso a `FilipaoVfx/clippy` y selecciona ese repositorio.
3. Usa estos valores:

| Campo | Valor |
| --- | --- |
| Nombre del Worker | `clippy-realtime` |
| Rama de producción | `main` |
| Root directory | `/` (raíz del repositorio) |
| Build command | `npm test` |
| Deploy command | `npm run deploy` |
| Node.js | `22` (también declarado en `.node-version`) |

`npm run deploy` ejecuta Wrangler, cuyo `[build]` genera `dist/` automáticamente.
El instalador usa `package-lock.json`; no es necesario añadir `npm install` al
Build command. No hay campo de directorio de salida Pages: Wrangler usa `dist/`.
El nombre en el dashboard debe coincidir con `name` en `wrangler.toml`.

4. Haz el primer despliegue desde `main`. Desactiva por ahora los despliegues de
   ramas no productivas: la primera creación de Durable Objects requiere aplicar
   la migración con `wrangler deploy`, y las vistas previas no deben compartir
   accidentalmente las sesiones de producción.
5. Cloudflare administra la autenticación del build. No publiques un token dentro
   del código ni agregues variables de backend al navegador.
6. Abre la URL `workers.dev` que indique Cloudflare.

## Si ya tenías Pages

Se conserva el nombre del Worker `clippy-realtime`, la clase `ClippyCoordinator`
y su migración `v1`, para actualizar el mismo namespace en la misma cuenta.
No borres el Worker anterior ni cambies su nombre al importar el proyecto.
La configuración separada `cloudflare/realtime/wrangler.toml` queda solo como
referencia del despliegue anterior; todos los comandos actuales usan el archivo raíz.

El sitio Pages anterior no se elimina ni se actualiza con este pipeline.
Usa la nueva URL del Worker. Si tenías la PWA instalada desde `pages.dev`, debes
instalarla desde el nuevo origen para usar esta versión. Un dominio propio permite
conservar un origen estable en futuros cambios de infraestructura.

## Dominio propio (opcional)

En el Worker → **Settings → Domains & Routes → Add → Custom Domain**, agrega
un subdominio de una zona de tu cuenta, por ejemplo `clippy.tudominio.com`.
Cloudflare configura HTTPS. Frontend y WebSockets usan automáticamente ese origen.

## Verificación

- Abre `/`: debe aparecer la app.
- Abre `/health`: debe devolver JSON.
- Abre la misma URL en dos dispositivos; crea una sesión y une el segundo por
  código o QR. Envía texto e imagen en ambos sentidos.
- Recarga uno de los dispositivos para comprobar la reconexión.
- En DevTools, `/ws?code=...` debe completar el upgrade WebSocket con estado 101.
- Tras un nuevo despliegue, comprueba que `sw.js` cambia de identificador cuando
  cambia el contenido del app shell. No hace falta reinstalar la PWA en el mismo origen.

## Desarrollo y validación local

Requiere Node.js 22 o posterior compatible con Wrangler.

```bash
npm ci
npm test
npm run cf:check
npm run cf:dev
```

`cf:dev` sirve la app y el Durable Object en un solo runtime local.
`npm run dev` mantiene la alternativa Express del proyecto.
`dist/` y `.wrangler/` son generados y no se versionan.

## Fuentes oficiales

- [Workers con archivos estáticos](https://developers.cloudflare.com/workers/static-assets/)
- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
