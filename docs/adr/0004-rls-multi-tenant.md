# ADR 0004: Una base de datos con Row-Level Security

Estado: Aceptada · Fecha: 2026-11-02

## Contexto
La tlapalería y la heladería no deben verse entre sí. Un solo error en un `WHERE` no puede filtrar datos, y el costo debe ser bajo con pocos negocios.

## Opciones
1. **Base de datos por negocio.** Aislamiento fuerte, con más costo y migraciones por negocio.
2. **Esquema por negocio.** Buen aislamiento, pero las migraciones se multiplican y hay más catálogos internos.
3. **Una base con `tenant_id` y RLS.** Barata y simple de migrar; exige disciplina en la conexión.

## Decisión
Una base de datos con `tenant_id` en cada tabla de negocio, `ENABLE` y `FORCE ROW LEVEL SECURITY`, y una política por tabla. El núcleo se conecta con un rol sin `BYPASSRLS` y fija `SET LOCAL app.tenant_id` al inicio de cada transacción. Las migraciones corren con otro rol. `branch_id` y `register_id` existen desde fase 0, aunque hoy haya una sola caja.

## Consecuencias
- Una prueba de integración recorre todas las tablas de negocio y falla si alguna no tiene política.
- Sin transacción no hay `tenant_id`, así que la consulta no devuelve filas: falla de forma segura.
- Hay que cuidar el pool de conexiones: `SET LOCAL` evita que el valor pase a otra petición.
- Los reportes entre negocios requieren un rol aparte y auditado.
