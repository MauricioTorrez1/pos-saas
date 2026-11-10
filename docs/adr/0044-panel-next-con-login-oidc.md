# ADR 0044: Panel Next.js con login OIDC del lado del servidor y sesión en cookie cifrada

Estado: Aceptada · Fecha: 2026-11-10 · Concreta F0-20. Aplica los ADR 0006 y 0039.

## Contexto
El dueño debe entrar al panel por Keycloak. El ADR 0039 ya dejó el cliente público `pos-panel` (código de autorización con PKCE, sin secreto), el claim `tenant_id` y la audiencia `pos-core`. Falta decidir qué biblioteca hace el login, dónde viven los tokens, quién renueva el token vencido y cómo se prueba el flujo en CI sin un Keycloak de un minuto de arranque.

## Opciones
**Biblioteca de login**
1. **`openid-client` 6 (de Filip Skokan, certificada por OpenID).** Hace descubrimiento, PKCE, `state`, validación del id token, renovación y cierre de sesión. No impone sesión ni rutas: la sesión es nuestra.
2. **Auth.js (`next-auth`).** Más cómoda, pero la rama estable (4) no es para App Router y la 5 sigue en beta. Un login es el peor lugar para depender de una beta.
3. **`oidc-client-ts`.** Está hecha para el navegador: guardaría los tokens en `localStorage` o `sessionStorage`, justo lo que queremos evitar.

**Dónde viven los tokens**
1. **Cookie `HttpOnly` cifrada (JWE, AES-256-GCM) con los tokens dentro.** Sin estado en el servidor, un XSS no puede leerla.
2. **Sesión en el servidor (Redis) con un id en la cookie.** Permite revocar al instante, pero agrega una pieza que operar antes de que haga falta.
3. **`localStorage`.** Cualquier script de la página lo lee. Descartada.

**Quién renueva el token vencido**
1. **El `proxy` de Next** (antes `middleware`), antes de que la página se renderice. Es de los pocos lugares, junto con los Route Handlers, donde se pueden escribir cookies.
2. **La página (Server Component).** No puede escribir cookies, así que la renovación se perdería.
3. **El navegador.** Obligaría a darle el refresh token. Descartada.

**Prueba del flujo en CI**
1. **Playwright contra un proveedor OIDC falso** (`e2e/fake-oidc.ts`, unos 150 renglones) que firma JWT con RS256, comprueba el verificador PKCE como Keycloak y responde `/me`. Arranca en milisegundos.
2. **Playwright contra Keycloak real en Compose.** Más fiel, pero suma cerca de un minuto de arranque y una importación del realm al trabajo `TypeScript`, que hoy es el más rápido.
3. **Solo pruebas de componentes.** No prueban redirecciones ni cookies, que es donde viven los errores de un login.

## Decisión
- **`openid-client` 6** con descubrimiento en `PANEL_OIDC_ISSUER_URL`. Cliente público sin secreto (`None()`); se acepta HTTP solo si el emisor es HTTP (Keycloak local).
- **Login** en `GET /auth/login`: crea verificador PKCE (`S256`) y `state`, los guarda en una cookie sellada de 10 minutos y redirige. `GET /auth/callback` revisa `state`, canjea el código en el servidor y valida el id token. Los errores llevan a `/` con un código fijo (`?error=`) que la pantalla traduce; la URL nunca escribe texto propio.
- **Sesión** en una cookie `pos_session` `HttpOnly`, `SameSite=Lax` y `Secure` con HTTPS, cifrada con `jose` (clave derivada de `PANEL_SESSION_SECRET`, mínimo 32 caracteres). Guarda el token de acceso, el de renovación, el de identidad, el vencimiento, el negocio y los roles. Si crece más de 3.6 KB se parte en hasta ocho cookies, porque los tokens crecen con los roles.
- **Renovación** en `proxy.ts`: si al token le quedan menos de 30 segundos, pide uno nuevo con el refresh token y reescribe la cookie para esa petición y para el navegador. Si Keycloak lo rechaza (sesión inactiva o cerrada en otro lado), borra la sesión y manda a `/?error=session_expired`.
- **Rutas protegidas** por el mismo `proxy`: sin sesión va a `/`; con sesión, `canAccess` compara los roles del token con una tabla de prefijos. Un rol no permitido ve una página de "sin permiso" (el rewrite del proxy no puede cambiar el código HTTP de una página, así que responde 200; no es una barrera de seguridad, la barrera es el 403 del núcleo). Hoy `/catalog` exige `owner` o `manager` y `/settings` exige `owner`; el resto solo pide sesión. Los nombres de rol (`owner`, `manager`, `cashier`) son los del ADR 0042. El rol real vive en la base del núcleo (`app_user.role`) y `GET /me` aún no lo devuelve, así que el panel lee `realm_access.roles` e ignora los roles por defecto de Keycloak; los roles del realm deben reflejar el de la base hasta que `/me` lo incluya (pendiente de seguimiento). No hay `storekeeper` ni `technician`: el técnico entra como cajero y el encargado cubre al almacenista. **El panel oculta; el núcleo decide.** La autorización real sigue en el servidor del núcleo (F0-14).
- **Qué muestra** `/dashboard`: el negocio (identificador abreviado) y el rol. No muestra nombre ni correo, y la sesión tampoco los guarda.
- **Llamada al núcleo** `GET /me` con el token de acceso, solo desde un Server Component. 401 se muestra como sesión no válida con un enlace para entrar de nuevo, 403 como usuario sin negocio, y un fallo de red o 5xx como núcleo sin conexión, con la sesión intacta. Tiene tope de 5 segundos.
- **Cierre de sesión** con `POST /auth/logout` (un GET podría dispararse desde una imagen de otro sitio): borra las cookies y redirige al `end_session_endpoint` de Keycloak con el id token, así que Keycloak no pide confirmación y la sesión de single sign-on también se cierra. Vuelve a `/`, que ya está en `post.logout.redirect.uris` del realm.
- **Pruebas.** Vitest para la lógica (configuración, sellado y rotura de la cookie, partición en trozos, identidad del token, tabla de rutas, cliente del núcleo) y para los componentes. Playwright con el proveedor falso para el flujo: ruta protegida sin sesión, login con PKCE, tokens fuera del alcance de scripts, cierre con Keycloak, renovación, renovación rechazada, 401 del núcleo, usuario sin negocio y página de sin permiso por rol. El trabajo `TypeScript` instala solo Chromium y corre esa prueba después de las de Vitest.
- **Archivos.** `apps/web` pasa a ser el panel (`@pos-saas/web`); ya existía como carpeta reservada. Variables `PANEL_*` en `apps/web/.env.example` sin valores reales. Cabeceras `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` y `Permissions-Policy` desde `next.config.ts`.

## Consecuencias
- Un token no se revoca al instante: tras cerrar la sesión en otro lado, la cookie sigue sirviendo hasta que el token de acceso vence (5 minutos) y la renovación falla. Es el mismo trato del ADR 0039. Si hace falta cortar de inmediato, se pasa a sesión en servidor (opción 2).
- Cualquiera que tenga la cookie y el secreto puede suplantar. Cambiar `PANEL_SESSION_SECRET` cierra todas las sesiones, y hay que guardarlo en el gestor de secretos al desplegar (F0-24).
- Los roles dependen de que el realm refleje el rol de la base: mientras no, todos entran como "sin rol" y solo ven el inicio. Seguimiento: que `GET /me` devuelva el rol y el panel deje de leer `realm_access`.
- Aún no hay una Content Security Policy con nonce; queda para cuando el panel tenga pantallas con contenido de terceros (F0-21).
- El proveedor falso no detecta cambios del realm real (por ejemplo, que un mapeador se quite). Eso lo cubren las pruebas con Keycloak real del núcleo y la comprobación manual con el Compose.
- La prueba de Playwright agrega unos 20 a 40 segundos al trabajo `TypeScript` (descarga de Chromium y `next build`).
