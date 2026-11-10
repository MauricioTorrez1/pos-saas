# ADR 0035: RLS, rol de aplicación y `tenant_id` fijado en cada transacción

Estado: Aceptada · Fecha: 2026-11-09 · Concreta F0-09. Aplica el ADR 0004 y se apoya en el ADR 0034.

## Contexto
El ADR 0004 decidió una sola base con Row-Level Security (RLS, seguridad a nivel de fila). Falta concretar cómo se crea el rol de la aplicación, cómo se fija el negocio en cada transacción y cómo se garantiza que una tabla nueva no llegue sin política.

## Opciones
**Quién fija `app.tenant_id`**
1. **Un administrador de transacciones propio** (`TenantAwareTransactionManager`) que ejecuta `set_config('app.tenant_id', ?, true)` justo después de abrir la transacción. Cubre `@Transactional`, `TransactionTemplate` y cualquier otra forma de abrir una, sin depender de una anotación.
2. **Un aspecto (AOP, programación orientada a aspectos) sobre `@Transactional`.** Se salta las transacciones que no usan la anotación, y el orden del aspecto frente al de la transacción es frágil.
3. **Un `SET` al sacar la conexión del pool.** Riesgo alto: el valor sobrevive y pasa a otra petición.

**Rol de la aplicación**
1. **La migración V2 crea `pos_app`** (sin `SUPERUSER` ni `BYPASSRLS`, dueño de ninguna tabla) y la contraseña la pone el despliegue con `ALTER ROLE`.
2. **Crear el rol a mano en la infraestructura.** La base queda dependiendo de un paso fuera del repositorio.
3. **Contraseña en la migración.** Rechazada: un secreto no se versiona (`CLAUDE.md`).

## Decisión
- **V2** crea `current_tenant_id()` (lee `app.tenant_id` con `nullif` para tolerar la cadena vacía que deja `SET LOCAL` al terminar), el rol `pos_app` y, en `tenant`, `branch`, `register` y `app_user`, `ENABLE` y `FORCE ROW LEVEL SECURITY` con una política `FOR ALL` con `USING` y `WITH CHECK`. En `tenant` la política compara `id`; en el resto, `tenant_id`. Los privilegios por defecto dan a `pos_app` las operaciones `SELECT/INSERT/UPDATE/DELETE` de las tablas futuras: una tabla nueva sin política la detecta la prueba, no el privilegio.
- Las migraciones corren con otro rol (`CORE_MIGRATION_DB_USER`, dueño de las tablas); el núcleo se conecta como `pos_app` (`CORE_DB_USER`). `FORCE` hace que ni el dueño se salte las políticas.
- `TenantAwareTransactionManager` fija el negocio con `set_config(..., true)` (equivale a `SET LOCAL`, pero con parámetro, sin concatenar texto) leyéndolo de `TenantContext`. Si no hay negocio no fija nada y la base no devuelve filas. `SET LOCAL` y no `SET`: el valor muere con el `COMMIT` o el `ROLLBACK`, así que una conexión del pool no lo lleva a otra petición.
- `TenantContext` (un `ThreadLocal` con `callAs`/`runAs`) es el punto donde F0-13 pondrá el negocio que sale del token.
- La prueba de cobertura recorre `pg_class` (no una lista de nombres): toda tabla del esquema `public` debe tener RLS activa y forzada, una política con `current_tenant_id()` en `USING` y `WITH CHECK`, y las de negocio, `tenant_id NOT NULL`. Si no, CI falla.
- Crear un negocio nuevo exige fijar antes su propio `id` como negocio de la transacción (la política de `tenant` compara con `id`); el alta desde el panel llegará con F0-13/F0-15.

## Consecuencias
- Una consulta sin negocio fijado devuelve cero filas, y un `INSERT` o `UPDATE` hacia otro negocio falla con `row-level security`.
- Las pruebas usan `pos_app` para la aplicación y el superusuario del contenedor solo para sembrar datos.
- El pool tiene un riesgo residual: código que use la conexión fuera de una transacción verá cero filas, nunca las de otro negocio.
- Los reportes entre negocios necesitarán un rol aparte y auditado (ADR 0004), todavía sin construir.
- La contraseña de `pos_app` se fija fuera de las migraciones; en compose y en producción es un paso del despliegue.
