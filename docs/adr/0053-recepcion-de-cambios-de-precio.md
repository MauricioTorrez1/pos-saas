# ADR 0053: Recepción de cambios de precio en el núcleo, sin rechazar lo que aún no se conoce

Estado: Aceptada · Fecha: 2026-11-10 · Concreta E1-40 (RF-022, RF-040). Completa el ADR 0047 (la caja que los envía) con el lado del servidor y aplica los ADR 0004, 0035, 0036, 0038 y 0046.

## Contexto
La caja encola `product.price_changed` en el outbox (ADR 0047) y el núcleo todavía lo mandaba a cuarentena como tipo desconocido. Hay que guardarlo, auditarlo y anunciarlo. Pero el núcleo no tiene tabla de productos (F0-16 no está fusionada) y no hay catálogo contra el que comparar el precio anterior. Había que decidir dónde se guarda, qué pasa con un producto que el núcleo no conoce, qué pasa con un precio anterior que no coincide y cómo se evita guardar dos veces el mismo cambio.

## Opciones
**Qué se hace con un cambio de un producto que el núcleo no conoce**
1. **Rechazarlo o mandarlo a cuarentena.** Bloquea una operación válida por algo que no es culpa de la caja, y la cuarentena no se aplica sola.
2. **Guardarlo de todos modos** en un registro de solo agregar y que el catálogo lo aplique cuando el producto exista.

**Qué se hace con un precio anterior que no coincide con el del núcleo (RF-022)**
1. **Rechazar el cambio.** La caja ya cobró con el precio nuevo; rechazarlo no lo deshace.
2. **Guardarlo y marcarlo como discrepancia**, para que el dueño lo revise (E1-19).

**Cómo se sabe qué se aplicó y qué no**
1. **Una columna de estado que se actualiza** cuando el producto aparece. Obliga a quitar la protección de solo agregar.
2. **El registro no cambia nunca**, y el catálogo aplica el último cambio de cada producto por `seq`.

## Decisión
- Opción 2 en las tres preguntas.
- **Tabla `product_price_change` (migración V7)** con `tenant_id`, RLS forzada y política de `current_tenant_id()`; la prueba de cobertura de RLS la cubre sola. Solo se agrega: un disparador rechaza `UPDATE` y `DELETE` para cualquier rol y `pos_app` no tiene esos privilegios. La llave es `(tenant_id, id)` con `id` igual al `changeId` de la caja, y `(tenant_id, op_id)` es única. Guarda el precio anterior y el nuevo en la escala del ADR 0011, quién lo hizo, quién lo aprobó, cuándo, y un `seq` de identidad que da el orden en que el núcleo los guardó. Ni el reloj de la caja ni `device_seq` ordenan nada (ADR 0040).
- **Idempotencia por `op_id` y por `changeId`.** El `op_id` lo reclama `sync_operation` como siempre: repetir la operación contesta `duplicate` y no escribe ni audita ni anuncia nada. El mismo `changeId` bajo otro `op_id` (una caja restaurada de un respaldo que reenvía con llaves nuevas) va a cuarentena con el motivo, igual que una venta ya registrada con otro `op_id` (ADR 0046), y no duplica el registro. La llave primaria cubre la carrera entre dos conexiones.
- **Producto desconocido.** El cambio se guarda. Mientras no exista la tabla de productos, el registro es la fuente: F0-16 (catálogo) debe, al crear o importar un producto, tomar el último cambio de ese producto por `seq` y usarlo como su precio, y E1-18 debe bajar esos precios a las cajas. Nada de esto se actualiza en el registro: lo aplicado se deduce de comparar con el catálogo.
- **Discrepancia (RF-022).** El precio que el núcleo tiene es el nuevo precio del último cambio guardado de ese producto (hasta que haya catálogo). Si el `previousUnitPriceE4` de la caja es distinto, el cambio se guarda tal como llegó con `discrepancy = true` y el precio del núcleo en `server_price_e4`. El primer cambio de un producto no tiene con qué compararse y no se marca. Dos cambios del mismo producto desde dos cajas se turnan con `pg_advisory_xact_lock`, así que cada uno compara con lo que dejó el anterior.
- **Bitácora (RF-040, ADR 0038).** En la misma transacción, `product.price_change` sobre la entidad `product`, con el usuario que lo hizo, el valor anterior (`unitPriceE4`) y el nuevo (`unitPriceE4`, `changeId`, `authorizedBy` y, si hay discrepancia, `serverPriceE4`). Solo ids y precios.
- **Evento (ADR 0036).** `ProductPriceChanged`, un `BusinessEvent` (`eventId` UUIDv7, `tenantId`, `schemaVersion` 1), se publica con `ApplicationEventPublisher` en la misma transacción y sale a Redpanda al confirmarse, por el tema `pos.catalog.product-price-changed.v1` con la llave `tenantId`. Lo consumen `sync` y `reporting` cuando existan. Si la transacción se deshace, no sale nada.
- **Un solo módulo, `catalog`**, con un `OperationRecorder` para el tipo, como el resto (ADR 0046). El contrato de `packages/contracts` ya traía el tipo (ADR 0047); no cambió.

## Consecuencias
- La tabla `product_price_change` crecerá sin tope como cualquier registro; un producto con miles de cambios es raro en una tlapalería.
- Hasta F0-16 no se puede saber si un producto existe, así que todas las discrepancias son contra el último cambio recibido y no contra el catálogo. Cuando haya catálogo, la comparación debe hacerse contra su precio, y esta regla se cambia con un ADR nuevo.
- Una discrepancia no se resuelve sola: queda marcada hasta que E1-19 construya la revisión.
- Si dos cajas cambian el mismo producto a la vez, gana el último en llegar y el otro queda marcado; no se intenta decidir cuál «debía» ganar.
- No se probó con dos procesos del núcleo ni con Redpanda caído en esta tarea; el outbox ya lo cubre el ADR 0036.
