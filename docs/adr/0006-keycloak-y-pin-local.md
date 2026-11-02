# ADR 0006: Keycloak en la nube y PIN local en la caja

Estado: Aceptada · Fecha: 2026-11-02

## Contexto
El panel y la API necesitan identidad y roles. La caja debe poder iniciar sesión sin internet, cuando Keycloak no responde.

## Opciones
1. **Proveedor administrado (Auth0, Cognito, Clerk).** Menos operación, con costo por usuario y dependencia del proveedor.
2. **Keycloak propio.** Gratuito, estándar OIDC y buen portafolio, pero consume RAM y hay que operarlo.
3. **Autenticación propia.** Riesgo de seguridad innecesario.

## Decisión
Keycloak propio con OpenID Connect, un solo realm y `tenant_id` como claim del token, para panel y API. La caja se registra una vez en línea y recibe credenciales de dispositivo. Cada persona entra con un PIN local guardado con Argon2id. Roles y permisos llegan por sincronización y quedan en caché.

## Consecuencias
- Cada venta y corte queda a nombre de quien lo hizo, incluso sin internet.
- Dar de baja a alguien sin internet aplica hasta la siguiente sincronización. Es un límite aceptado.
- Un PIN tiene poca entropía: se bloquea tras varios intentos y su hash nunca sale de la caja como texto plano.
- Hay que respaldar y actualizar Keycloak como cualquier servicio.
