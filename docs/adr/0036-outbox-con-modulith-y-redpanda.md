# ADR 0036: Outbox con Spring Modulith, tabla por Flyway y eventos con contrato

Estado: Aceptada · Fecha: 2026-11-09 · Concreta F0-10. Aplica el ADR 0005 y se apoya en los ADR 0034 y 0035.

## Contexto
El ADR 0005 decidió un outbox transaccional (una tabla donde el evento se guarda junto con el cambio de negocio) con el registro de eventos de Spring Modulith y Redpanda como bus. Faltaba decidir quién crea la tabla, cómo se publica al broker, dónde viven los eventos y cómo convive el outbox con la RLS del ADR 0035.

## Opciones
**Tabla del outbox**
1. **Migración de Flyway (V3)** con las columnas que Modulith 2.1 espera. Queda versionada con el resto.
2. **El inicializador de esquema de Modulith.** Crea la tabla al arrancar con el rol de la aplicación y se salta el control de versiones.

**Publicación al broker**
1. **`@Externalized` de Modulith** (`spring-modulith-events-kafka`): publica tras el commit y deja la fila incompleta si falla.
2. **Un productor propio con un `@Scheduled`.** Más código para lo que Modulith ya resuelve.

**RLS en el outbox**
1. **Tabla de infraestructura sin RLS**, con una lista explícita de excepciones en la prueba de cobertura. El evento lleva su `tenant_id` dentro.
2. **`tenant_id` y política en el outbox.** El reenvío de pendientes corre fuera de una transacción de negocio y no vería nada.

## Decisión
- V3 crea `event_publication` (esquema v2 de Modulith) y `spring.modulith.events.jdbc.schema-initialization.enabled=false`. La tabla es infraestructura: no lleva `tenant_id` ni RLS, y la prueba de cobertura la exime por nombre junto con `flyway_schema_history`. Cualquier otra tabla sin política sigue rompiendo CI.
- Todo evento que salga del núcleo implementa `BusinessEvent` (`eventId` UUIDv7, `tenantId`, `schemaVersion`) y se anota con `@Externalized("tema::llave")`. La llave es el `tenantId`, para conservar el orden por negocio. Los tipos externalizados viven en el paquete raíz de la aplicación o en un módulo (Modulith solo escanea ahí).
- Los eventos publicados dentro de una transacción se guardan con ella: si se revierte, no queda fila ni mensaje. Si Redpanda está caído, la fila queda incompleta y se reenvía con `IncompleteEventPublications`.
- Entrega «al menos una vez»: un reenvío puede duplicar un mensaje, por eso el consumidor debe ser idempotente con `eventId`.

## Consecuencias
- La venta no se detiene si el broker cae, y el evento espera en `event_publication`.
- Pruebas con Testcontainers (PostgreSQL 16.15 y Redpanda v26.2.6): evento confirmado llega; transacción revertida no publica nada; con el broker pausado el evento espera y llega al reanudarlo.
- Falta programar el reenvío periódico de pendientes en producción; hoy se llama a mano. Se hará con la observabilidad (F0-11).
- El outbox lo ve cualquier consulta del rol `pos_app`: no guarda datos sensibles más allá del payload del evento, que cada tarea debe mantener sin datos personales.
