# ADR 0054: Credencial de dispositivo en `/sync/push`, con el negocio dentro y revocación

Estado: Aceptada · Fecha: 2026-11-10 · Concreta E1-41 y RF-021. Se apoya en los ADR 0035, 0039, 0042, 0043 y 0046.

## Contexto
E1-17 dejó `/sync/push` abierto a cualquier persona con sesión de Keycloak y un permiso temporal `sync.push` por rol, y solo guardaba el `registerId` del lote. F0-15 ya entrega al enrolar una caja un token de dispositivo (con solo su hash guardado), pero nada lo exigía. Una caja no tiene usuario de Keycloak, y el servidor tiene que saber de qué negocio y de qué caja viene cada lote antes de que RLS pueda encontrar nada.

## Opciones
**Forma de la credencial**
1. **`<tenantId>.<secreto>`**: el negocio (que no es secreto) va dentro, y el secreto son 256 bits al azar. Se guarda el SHA-256 del token completo.
2. **Token opaco más un encabezado `X-Tenant-Id`.** Dos valores que la caja debe mantener juntos, y un encabezado que alguien puede cambiar sin invalidar el secreto.
3. **Una consulta que ignore RLS** (función `SECURITY DEFINER`) para buscar el hash en todos los negocios. Con `FORCE ROW LEVEL SECURITY` el dueño de la tabla también queda sujeto, así que dependería de un rol con `BYPASSRLS`; es frágil.
4. **JWT firmado por el núcleo (o un `client_credentials` de Keycloak por caja).** Más pesado: llaves o clientes por caja, y revocar exige lista de rechazo o introspección.

**Dónde se autentica**
1. **Un filtro propio** que lee `Authorization: Device <credencial>`, antes de la autorización.
2. **Un segundo `SecurityFilterChain` por ruta.** Más separación, pero duplica la configuración de CSRF, sesión y errores.

## Decisión
- **Opción 1 en ambas.** `DeviceCredentialFilter` va después de `UserRoleFilter`. Con la credencial válida deja una `DeviceAuthentication` (sin roles ni permisos) cuyo principal es `DeviceIdentity(registerId, tenantId)`, y corre el resto de la petición dentro de `TenantContext.runAs(tenant)`: RLS y los logs reciben el negocio como con una persona. Credencial malformada, desconocida o revocada: **401** con `WWW-Authenticate: Device` y el mismo cuerpo siempre. Una credencial de otro negocio no coincide: el hash se busca dentro del negocio que nombra.
- **Formato:** `<UUID del negocio>.<43 caracteres base64url>`. `DeviceToken.generate` lo crea al enrolar (F0-15 pasa de un token opaco a este); solo se guarda su SHA-256. No se guarda ni registra la credencial.
- **Tabla de endpoints (ADR 0042):** nuevo tipo de regla `DEVICE`. `POST /sync/push` es `DEVICE`: solo lo abre una caja, y **ninguna persona**, ni el dueño. A la inversa, una caja no abre ningún endpoint de persona. El permiso temporal `sync.push` por rol se **retiró**. Una persona que llama a `/sync/push` recibe 403 y queda en la bitácora (`device_credential_required`).
- **El lote debe ser de esa caja:** el `registerId` del cuerpo debe ser el de la credencial. Si nombra otro (de otro negocio, o que nadie enroló) la respuesta es **403** (la caja está identificada, pero no puede actuar como otra) y no se guarda nada. Se anota `sync.register_mismatch` en la bitácora con el id de la caja y el id que reclamó, nada más. Un `registerId` ausente o que no es UUID sigue siendo 400 como en E1-17.
- **Revocación:** `POST /registers/{id}/revoke` (dueño y encargado, permiso `register.revoke`) pone `revoked_at` y `revoked_by` en `register_device` (migración V13). Es idempotente (una sola entrada `register.revoked` en la bitácora). La credencial deja de funcionar en la siguiente petición, porque se consulta en cada una. Una caja que no existe o es de otro negocio da 404. «Desactivar» y «revocar» son lo mismo: la fila del dispositivo conserva la historia y la caja ya enviada queda intacta.
- **Se conserva lo de E1-17:** idempotencia por `op_id`, cuarentena, 400 con campos extra (incluido `tenantId` en el cuerpo) y una transacción por operación.
- **Caja (`apps/pos`):** `HttpSyncTransport` acepta `deviceToken` y manda `Authorization: Device <credencial>`. La credencial se lee de `POS_DEVICE_TOKEN` en el arranque de la sincronización; guardarla en el almacén cifrado de la caja al enrolar llega con la pantalla de enrolamiento (la caja todavía no llama a `/registers/enroll`).

## Consecuencias
- Sin credencial la caja no envía: el outbox local conserva todo y reintenta (E1-16), así que una caja sin enrolar no pierde ventas, solo no las sube.
- Una caja revocada recibe 401 en cada envío. La caja lo registra como espera y reintenta con retroceso (E1-16) hasta que se re-enrole; sus ventas locales siguen intactas en el outbox.
- Revocar no borra lo que la caja ya envió ni deshace nada; solo corta lo siguiente. Si una caja robada ya enviaba lotes falsos antes de revocarla, eso se ve con la bitácora y `sync_operation`.
- No hay rotación de credenciales: se revoca y se enrola de nuevo. La rotación sin reenrolar queda para cuando haga falta.
- No hay límite de intentos contra `/sync/push`: 256 bits de secreto y una respuesta uniforme hacen inútil adivinar, pero un límite por IP llegará con la puerta de entrada (Redis).
- `GET /sync/pull` (E1-18) usará la misma credencial: basta declarar su regla como `DEVICE`.
