# ADR 0039: Keycloak con OIDC, `tenant_id` en el token y tenant fijado por petición

Estado: Aceptada · Fecha: 2026-11-10 · Concreta F0-13. Aplica los ADR 0006, 0016 y 0035.

## Contexto
El ADR 0006 decidió Keycloak con un solo realm y `tenant_id` como claim, y el ADR 0035 dejó `TenantContext` como el punto donde F0-13 pondría el negocio. Falta decidir cómo se exporta el realm sin secretos, cómo valida el núcleo el token y cómo llega el negocio hasta RLS y los logs.

## Opciones
**Realm en el repositorio**
1. **Un archivo `pos-realm.json` importado con `--import-realm`.** El realm aparece solo al levantar Compose. La importación solo corre si el realm no existe: un cambio posterior del archivo no se aplica a un volumen ya creado.
2. **Configurarlo a mano en la consola.** No se puede repetir ni revisar.
3. **Terraform o la API de administración.** Más preciso para producción, pero pesado para esta fase; se retoma con la infraestructura.

**Validación del token**
1. **Servidor de recursos de Spring Security** (`spring-boot-starter-oauth2-resource-server`) con las llaves públicas de Keycloak (JWKS). Valida firma, vigencia, emisor y audiencia sin llamar a Keycloak en cada petición.
2. **Introspección** (preguntar a Keycloak por cada token). Permite revocar al instante, pero cada petición depende de Keycloak y la caja ya tiene su propia ruta sin internet.
3. **Validar a mano.** Riesgo de seguridad innecesario.

**Cómo llega el negocio a `TenantContext`**
1. **Un filtro dentro de la cadena de seguridad**, justo después de la autenticación del token. Envuelve el resto de la petición en `TenantContext.runAs`, así que RLS, los logs y las trazas lo reciben.
2. **Un `@ControllerAdvice` o un interceptor de MVC.** Corre después de la autorización y no cubre lo que se resuelva antes.
3. **Leer el claim en cada servicio.** Se olvida en algún lugar, y un olvido es una fuga entre negocios.

## Decisión
- **Realm `pos`** en `infra/compose/keycloak/pos-realm.json`, sin usuarios, sin contraseñas y sin secretos. Compose lo monta en `/opt/keycloak/data/import` y arranca con `--import-realm`.
- **Dos clientes.** `pos-core` representa el servidor de recursos (solo valida; todos sus flujos están apagados). `pos-panel` es un cliente público con código de autorización y PKCE `S256`, sin secreto; el login directo con contraseña está apagado. Los usuarios se crean en la consola de Keycloak o con su API de administración.
- **Claim `tenant_id`.** Es un atributo del usuario, declarado en el perfil de usuario del realm con permisos de edición solo para el administrador (nadie lo cambia desde su cuenta) y validado como UUIDv7. Un mapeador lo agrega al token de acceso, al de identidad y a `userinfo`. Otro mapeador agrega `pos-core` a la audiencia.
- **El núcleo** valida firma, vigencia, emisor (`CORE_OIDC_ISSUER_URI`) y audiencia `pos-core`. Las llaves se descargan de forma perezosa, así que el núcleo arranca aunque Keycloak esté caído. Sin token válido responde **401**.
- **`TenantFromTokenFilter`** corre justo después de `BearerTokenAuthenticationFilter`. Un token válido sin `tenant_id`, o con uno que no es UUID, recibe **403** sin cuerpo con datos. Con tenant, el resto de la petición corre dentro de `TenantContext.runAs`.
- Solo `GET /actuator/health` es público; todo lo demás exige token. Sin sesiones ni CSRF, porque el navegador nunca adjunta un bearer por su cuenta.
- `GET /me` devuelve `subject` (el id del usuario en Keycloak) y `tenantId`, sin nombre ni correo. Existe para probar la cadena completa.
- **Pruebas** con Keycloak real en Testcontainers: importan el mismo archivo del repositorio, crean usuarios por la API de administración y piden tokens reales. Cubren 401 (sin token, token basura, token de otro realm), 403 (sin tenant), 200 con el tenant fijado y el aislamiento entre dos negocios a través de RLS.

## Consecuencias
- Un JWT no se revoca: sigue válido hasta que vence. Se acepta con tokens de 5 minutos; quitar a alguien con efecto inmediato exigiría introspección y queda para cuando haga falta.
- Cambiar `pos-realm.json` no actualiza un Keycloak que ya importó el realm: en local hay que borrar el volumen de PostgreSQL; en producción, aplicar el cambio con la API o con Terraform.
- Un usuario sin `tenant_id` puede iniciar sesión pero el núcleo lo rechaza con 403. Dar de alta un negocio y su dueño (que fija el atributo) llega con F0-15 y el panel.
- Los roles y permisos (dueño, cajero, almacenista, técnico) son F0-14: el token ya trae lo necesario para agregarlos.
- Las pruebas del núcleo con Keycloak tardan cerca de un minuto por el arranque del contenedor.
