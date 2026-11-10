# ADR 0034: Flyway, UUIDv7 generado por el núcleo y modelo base

Estado: Aceptada · Fecha: 2026-11-09 · Concreta F0-08. Se apoya en los ADR 0004, 0006 y 0008.

## Contexto
El núcleo necesita su primera base de datos: `tenant`, `branch`, `register` y `app_user`, todas con UUIDv7 (regla de dominio de `CLAUDE.md`). PostgreSQL 16 no trae `uuidv7()` (llega en la 18) y Java 21 tampoco genera UUIDv7. Además, ya hay que decidir cómo se versiona el esquema para que una base vacía quede al día sin pasos manuales.

## Opciones
**Migraciones**
1. **Flyway con SQL plano.** Se lee igual que lo que ejecuta la base, y Spring Boot lo aplica al arrancar.
2. **Liquibase.** Más abstracto (XML/YAML), pero el SQL real queda escondido.

**Generación del UUIDv7**
1. **En Java (`Uuid7`) y una función SQL solo de respaldo.** El núcleo conoce el id antes de insertar (lo necesita para la llave de idempotencia y el outbox) y funciona en PostgreSQL 16.
2. **Solo en SQL, con `DEFAULT`.** La aplicación no conoce el id hasta después del `INSERT`.
3. **Extensión de PostgreSQL (`pg_uuidv7`).** Obliga a una imagen propia de la base.

## Decisión
- Flyway con SQL plano en `services/core/src/main/resources/db/migration` (`V<n>__<descripción>.sql`). Una migración aplicada **nunca se edita**: el cambio va en una migración nueva. Flyway lo comprueba con el checksum y rompe el arranque si alguien la toca.
- El núcleo genera los ids con `Uuid7` (RFC 9562: 48 bits de milisegundos Unix y bits aleatorios). La migración V1 también crea `uuid_v7()` como `DEFAULT` de respaldo y `is_uuid_v7(uuid)`, que cada tabla usa en un `CHECK` sobre su `id`: la base rechaza un UUIDv4.
- `tenant` es la raíz; `branch`, `register` y `app_user` llevan `tenant_id NOT NULL`. `register` apunta a `branch` con una llave compuesta `(tenant_id, branch_id)`, así que una caja no puede colgar de la sucursal de otro negocio. `branch` y `register` tienen `code` único por negocio (el de `register` prefija el folio).
- `app_user` guarda `display_name`, `role` (`owner`, `manager`, `cashier`), `active` y `keycloak_subject` (vacío mientras el usuario solo tenga PIN local, ADR 0006). El PIN y las credenciales no están aquí: llegan con su tarea.
- La conexión sale de `CORE_DB_URL`, `CORE_DB_USER` y `CORE_DB_PASSWORD`; la contraseña no tiene valor por defecto. Las pruebas usan PostgreSQL 16.15 en Testcontainers, la misma versión de `infra/compose`.
- El rol sin `BYPASSRLS`, `ENABLE`/`FORCE ROW LEVEL SECURITY` y las políticas llegan en F0-09 (ADR 0004). `tenant` se protegerá con una política sobre su propio `id`.

## Consecuencias
- Una base vacía queda al día al arrancar el núcleo, sin pasos manuales, y una prueba con Testcontainers lo comprueba.
- Los ids ordenados por tiempo mantienen compactos los índices B-tree, a diferencia de UUIDv4. La hora de creación queda visible en el id.
- El generador existe dos veces (Java y SQL), y una prueba comprueba que coinciden en versión y variante.
- Subir a PostgreSQL 18 permitiría cambiar el `DEFAULT` por el `uuidv7()` nativo, con una migración nueva.
- Sin Docker no corren las pruebas de base de datos, ni en local ni en CI.
