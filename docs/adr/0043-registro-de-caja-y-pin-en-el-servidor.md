# ADR 0043: Registro de caja con código de un solo uso y PIN con Argon2id en el servidor

Estado: Aceptada · Fecha: 2026-11-10 · Concreta F0-15 y RF-009. Se apoya en los ADR 0006, 0029, 0035, 0038 y 0042.

## Contexto
Una caja física debe unirse a un negocio una sola vez y en línea, y recibir lo necesario para trabajar sin internet (ADR 0006). Los PIN del servidor deben guardarse de forma que una copia de la base no los revele en texto plano, y el bloqueo tras 5 errores (RF-009) debe sobrevivir a reinicios.

## Opciones
**Cómo se identifica una caja nueva**
1. **Código de un solo uso con caducidad**, que un dueño o encargado genera con sesión y que la caja canjea sin sesión por una credencial de dispositivo.
2. **Que la caja inicie sesión con un usuario de Keycloak.** Deja una contraseña de persona en un aparato compartido.
3. **Una llave fija en la instalación.** No caduca ni se puede atribuir.

**Cómo se guarda el PIN**
1. **Argon2id** (memoria 19 MiB, 2 iteraciones, 1 carril: la configuración mínima de OWASP), con sal propia y parámetros dentro del hash (cadena PHC).
2. **bcrypt.** Aceptable, pero con costo fijo en memoria bajo y límite de 72 bytes.
3. **SHA-256 con sal.** Rápido: justo lo que no se quiere para adivinar.

**Dónde vive el bloqueo**
1. **En la fila del PIN en PostgreSQL**, con bloqueo de fila al verificar.
2. **En memoria o en Redis.** Un reinicio o una pérdida del caché lo borraría, y un atacante podría provocarlo.

## Decisión
- **Opción 1 en las tres preguntas.**
- **Código de enrolamiento:** `POST /registers/enrollment-codes` (dueño y encargado) genera 16 caracteres al azar de un alfabeto sin letras confusas (80 bits, formato `XXXX-XXXX-XXXX-XXXX`), válido 15 minutos y ligado a una sucursal y al código y nombre de la caja futura. Solo se guarda su SHA-256 (con 80 bits al azar basta un hash rápido; Argon2 es para lo que tiene poca entropía, como el PIN) y se muestra una vez, con `Cache-Control: no-store`.
- **Canje:** `POST /registers/enroll` no pide sesión; recibe `tenantId` y el código. Un solo `UPDATE ... WHERE redeemed_at IS NULL AND expires_at > ahora RETURNING` gasta el código, así que dos peticiones simultáneas no pueden ganar las dos. Código desconocido, usado, caducado o de otro negocio dan la misma respuesta 400. Se crea la `register` (ligada a negocio y sucursal) y su `register_device` con el SHA-256 de un token de 256 bits, que se entrega una sola vez. Si el código de caja ya lo ocupó otra (409), todo se revierte y el código sigue sin gastar. El negocio viaja en la petición porque la caja aún no tiene token y RLS necesita saberlo para encontrar el código.
- **Lo que recibe la caja:** id de la caja, sucursal, token de dispositivo y los hashes de PIN de las personas activas que tienen uno, para verificar sin internet. El hash Argon2id es una cadena PHC; la caja usa hoy scrypt para su PIN local (ADR 0029). Mientras las dos no se unifiquen, la sincronización de usuarios (E1-17 en adelante) debe decidir si la caja verifica Argon2id o rehace el hash al primer PIN correcto.
- **PIN:** de 4 a 8 dígitos. `PUT /users/{id}/pin` (dueño a cualquiera; encargado a cajeros y a sí mismo) y `POST /users/{id}/pin/verify` (cada quien el suyo; dueño y encargado el de cualquiera, que es como un dueño aprueba algo). Tabla `user_pin`, separada de `app_user`, con el hash, el contador de fallos y `locked_until`.
- **Bloqueo:** 5 fallos seguidos bloquean 5 minutos. Mientras dura, el PIN ni se compara: ni el correcto entra. Al verificar se toma `SELECT ... FOR UPDATE`, así que los intentos en paralelo cuentan uno por uno. Un PIN correcto pone el contador en cero; fijar un PIN nuevo también quita el bloqueo.
- **Respuestas de verificación:** 200 con `valid` (verdadero o falso y `attemptsLeft`) porque preguntar si un PIN es correcto no es un error de autenticación; 423 con `Retry-After` mientras está bloqueado; 404 si la persona no tiene PIN.
- **Nada sensible en logs ni bitácora:** los registros de petición redactan el PIN y el código en `toString`, los mensajes de error son textos fijos, y la bitácora guarda `user.pin_set`, `user.pin_locked`, `register.enrollment_code_issued` y `register.enrolled` solo con ids y valores de negocio. Una prueba busca el PIN y su hash en los logs capturados y otra en toda la bitácora.
- **RLS:** `user_pin`, `enrollment_code` y `register_device` llevan `tenant_id`, RLS forzada y la política del ADR 0035; la prueba de cobertura recorre el catálogo. La migración es V8.

## Consecuencias
- Un PIN de 4 a 8 dígitos tiene como máximo 10^8 combinaciones: si alguien copia la base, ningún hash lo protege de verdad. El bloqueo defiende la ruta en línea; el hash solo encarece la ruta fuera de línea. Un pimienta (clave en el entorno) lo mitigaría, pero impediría que la caja verifique el hash sin internet, que es el objetivo; queda anotado.
- El bloqueo del servidor y el de la caja (ADR 0029) son independientes: una persona puede gastar 5 intentos en cada uno.
- Un atacante puede bloquear a alguien adivinando mal a propósito; por eso solo dueño y encargado verifican el PIN de otros.
- No hay límite de intentos contra `POST /registers/enroll` más allá de los 80 bits del código y su caducidad; un límite por IP llegará con la puerta de entrada (Redis).
- El token de dispositivo todavía no autentica nada. Pendiente (tarea siguiente de sincronización): que `/sync/push` y `/sync/pull` lo exijan en lugar del permiso `sync.push` por rol, y que `/sync/push` compare el `registerId` del lote con la caja enrolada (hoy solo lo guarda). Como el token no lleva el negocio, deberá llevarlo dentro (`<tenantId>.<secreto>`) para que RLS encuentre la fila. Rotarlo o revocarlo queda para entonces.
- Un código emitido y nunca canjeado queda en la tabla caducado; una limpieza periódica queda pendiente.
