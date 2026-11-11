# ADR 0042: Roles y permisos por endpoint, con rol leído de la base

Estado: Aceptada · Fecha: 2026-11-10 · Concreta F0-14 y RF-008. Se apoya en los ADR 0006, 0035, 0038 y 0039.

## Contexto
El núcleo ya sabe quién llama (token de Keycloak) y de qué negocio es (ADR 0039). Falta decidir qué puede hacer cada quien: un cajero no cambia precios (RF-008), y cada intento y cada cambio de rol deben quedar en la bitácora (ADR 0038). Mauricio revisa la tabla con su familia, así que tiene que existir como documento y como código, sin que se contradigan.

## Opciones
**De dónde sale el rol**
1. **De `app_user.role` en la base**, buscando al usuario por el `sub` del token. El cambio aplica en la siguiente petición y se audita en la misma transacción que lo cambia. Cuesta una consulta por petición.
2. **De un claim `roles` del token de Keycloak.** Sin consulta, pero un cambio de rol no aplica hasta que vence el token (hasta 5 minutos) y hay dos fuentes de verdad (la base ya tiene la columna y la caja la sincroniza).
3. **Ambos.** Más piezas y más formas de que difieran.

**Dónde se aplica la tabla**
1. **Una tabla única de endpoints en código, evaluada por un `AuthorizationManager` de Spring Security**, con rechazo por omisión: lo que no está listado da 403.
2. **`@PreAuthorize` en cada método.** Es el patrón común, pero un endpoint nuevo sin anotación queda abierto a cualquier usuario con sesión, y no hay un solo lugar para revisar.
3. **Reglas dispersas en `requestMatchers`.** Se pierde el vínculo con el permiso.

**Rol o permiso**
1. **Permisos como unidad de la API y roles como conjuntos de permisos** (RBAC con permisos). Cambiar quién puede algo es una línea; el código pregunta por lo que se hace, no por quién es.
2. **Solo roles en el código** (`if role == owner`). Más simple hoy, y cada regla nueva obliga a tocar muchos sitios.
3. **ABAC** (atributos y contexto). Se justifica con reglas como «solo hasta cierto monto»; hoy no hay ninguna.

## Decisión
- **Opción 1 en las tres preguntas.** `UserRoleFilter` corre justo después de `TenantFromTokenFilter` (ya con el negocio fijado), busca al usuario activo por `keycloak_subject` y deja una `PosAuthentication` con las autoridades de su rol. Gracias a RLS, un `sub` de otro negocio no se encuentra.
- **Roles:** `owner`, `manager` y `cashier`, los tres que ya admite `app_user.role`. «Encargado» cubre al almacenista. El técnico de taller no tiene rol hasta el módulo de taller; hasta entonces entra como cajero.
- **Permisos como código:** el enum `Permission` lista, por cada permiso, los roles que lo tienen. Esa es toda la matriz. `EndpointPermissions.RULES` liga método y ruta a un permiso. Los endpoints de tareas futuras (productos, importaciones, precios, facturas, reportes) se listan desde ahora para que la familia los revise; hasta que existan responden 404 a quien puede y 403 a quien no.
- **Rechazo por omisión:** `EndpointAuthorizationManager` decide todo lo que no es `GET /actuator/health`. Una ruta sin regla da 403 (a quien tiene sesión; sin sesión da 401). Otros módulos o pruebas agregan reglas con un bean `EndpointRule`.
- **Tres tipos de regla:** `PERMISSION` (el rol debe tenerlo), `AUTHENTICATED` (cualquier token válido, incluso sin fila de usuario: `GET /me`) y `PUBLIC` (sin sesión; el endpoint verifica su propia credencial, como el código de enrolamiento de F0-15).
- **Documento:** `docs/permisos.md` lleva la tabla entre marcadores. Una prueba la genera desde el código y falla si no coincide, así que la versión que revisa la familia es la que se ejecuta.
- **Auditoría:** cada acceso denegado a una persona con sesión escribe `access.denied` (`entity_type` `endpoint`) con método, regla, permiso, rol y motivo (`missing_permission`, `no_user`, `unlisted_endpoint`). Nunca guarda la ruta real ni el cuerpo, que podrían traer datos personales; el `entity_id` es un UUID derivado de método y regla, para contar intentos por endpoint. Si la bitácora falla, el acceso se niega igual y el error queda en el log.
- **Cambio de rol:** `PUT /users/{id}/role` (solo `owner`). El cambio y `user.role_changed` (rol anterior y nuevo, actor) se guardan en una transacción. Un negocio no puede quedarse sin dueño activo (409, con bloqueo de fila para que dos cambios simultáneos no lo burlen). Dar el mismo rol no escribe nada.
- **401 o 403:** sin token válido es 401 (no sabemos quién eres); con token válido pero sin permiso es 403 (sabemos quién eres y no puedes).

## Consecuencias
- Una consulta de lectura a `app_user` por cada petición con token. Es un índice por `keycloak_subject` único; si pesa, se agrega caché corta con invalidación al cambiar el rol.
- El token sigue sin revocarse (ADR 0039): desactivar a alguien sí corta el acceso al instante a las rutas con permiso, porque el rol sale de la base, pero `GET /me` sigue respondiendo hasta que el token venza.
- Validar en el servidor es lo que protege: ocultar un botón en el panel o la caja solo mejora la experiencia (la caja aplica los mismos permisos sin conexión con el rol que sincroniza, ADR 0006).
- `PATCH /products/{id}` exige `product.write`; cuando F0-17 permita cambiar el precio por ahí, el servicio debe exigir además `price.change`. Queda anotado para esa tarea.
- Las acciones que dependen del dato y no solo del rol (por ejemplo un cajero que solo verifica su propio PIN) las revisa el servicio del módulo, no la tabla.
- Las preguntas abiertas para la familia están al final de `docs/permisos.md`; sus respuestas pueden cambiar el enum sin tocar nada más.
- Nota (F0-26): `GET /me` devuelve también `role` (el de `app_user`, o `null` sin usuario activo) para que el panel y la caja muestren y decidan con el mismo rol que usa esta autorización. Sigue siendo una ayuda para la pantalla: el servidor decide.
