# ADR 0046: Recepción idempotente de lotes en el núcleo, una transacción por operación

Estado: Aceptada · Fecha: 2026-11-10 · Concreta E1-17 (RF-021). Cumple el contrato del ADR 0040 y se apoya en los ADR 0035, 0036, 0038 y 0039.

## Contexto
La caja entrega al núcleo cada venta «al menos una vez» (ADR 0040): si muere entre la confirmación y su propio marcado, reenvía. Por eso el núcleo debe guardar cada operación una sola vez aunque el mismo lote llegue dos veces, o a la vez desde dos conexiones, y debe contestar por operación para que la caja marque solo lo confirmado. Había que decidir dónde se aplica la unicidad, cuántas transacciones lleva un lote, qué se hace con lo inválido y dónde viven las tablas.

## Opciones
**Dónde se aplica la idempotencia**
1. **Restricción `UNIQUE (tenant_id, op_id)` en PostgreSQL**, con `INSERT ... ON CONFLICT DO NOTHING`. La base es el árbitro, así que dos hilos, dos procesos o dos núcleos futuros no pueden duplicar.
2. **Consultar primero y luego insertar.** Entre la consulta y el `INSERT` caben dos peticiones: ambas ven «no existe» y ambas guardan.
3. **Un candado en memoria por `op_id`.** Solo sirve con un proceso y se pierde al reiniciar.

**Transacciones del lote**
1. **Una transacción por operación.** Cada operación reclama su `op_id` y escribe sus registros juntos; lo anterior ya está confirmado cuando algo falla.
2. **Una transacción por lote.** Una operación mala o una falla a medias deshace las buenas, y la respuesta por operación dejaría de ser verdad: no se puede decir «aceptada» de algo que se revirtió.

**Qué se hace con una operación inválida**
1. **Cuarentena** (ADR 0040, RF-022): se guarda tal como llegó, con su motivo, y el lote sigue.
2. **Rechazar el lote con 400.** Una venta mala bloquearía a todas las que la siguen en la cola de la caja para siempre.

**Dónde viven los registros recibidos**
1. **Cada módulo guarda lo suyo** (`sales`, `cash`, `inventory`) y `sync` solo reparte por tipo, a través de una interfaz neutral `OperationRecorder`. `sync` no depende de los módulos de destino y Modulith no ve ciclos.
2. **`sync` guarda todo.** Un solo módulo conoce ventas, efectivo e inventario, y el siguiente módulo que necesite sus propias reglas lo tendría que desarmar.

## Decisión
- **Unicidad en la base.** La migración V5 crea `sync_operation` con `UNIQUE (tenant_id, op_id)`. Cada operación la reclama con `INSERT ... ON CONFLICT DO NOTHING`: si inserta una fila, la operación es nueva; si no, ya existía y la respuesta es `duplicate`. Una segunda transacción que inserta la misma llave espera a la primera: si esta confirma ve el conflicto, y si revierte guarda ella. `device_seq` se guarda por información y **nunca** se usa para rechazar, porque puede retroceder al restaurar un respaldo (ADR 0040).
- **Una transacción por operación** con `TransactionTemplate`: reclamar la llave y escribir los registros se guardan o se pierden juntos. Si falla la mitad del lote, las operaciones anteriores quedan confirmadas y aparecen en `results`, y las siguientes no se tocan ni aparecen: la caja las reenvía y el `UNIQUE` hace seguro el reenvío. Es lo que el contrato ya prometía («puede detenerse antes»).
- **Tres destinos por operación**, todos con respuesta en `results`: `accepted` (guardada ahora), `duplicate` (ya estaba, también si estaba en cuarentena) y `quarantined` con `reason`. Va a cuarentena lo que la caja no puede arreglar reintentando: tipo o `schemaVersion` desconocidos, forma que no cumple el esquema compartido, una fecha que no existe, una regla de negocio (líneas o pagos que no suman, devolución de más de lo vendido o de una venta desconocida, una venta ya registrada con otro `op_id`) o una restricción de datos. La operación se guarda entera en `sync_operation.raw_operation`, así que nunca se pierde.
- **Una falla inesperada detiene el lote** (la base se fue, un error de programación): se contesta con lo ya procesado y, si ni la primera operación pasó, con `503`. No se pone en cuarentena, porque reintentar puede funcionar y una cuarentena por un fallo pasajero escondería una venta buena.
- **Sobre inválido, `400` y nada se confirma.** JSON roto, `registerId` que no es UUIDv7, de 1 a 100 operaciones, una operación sin `opId` UUIDv7 (sin él no se puede nombrar ni confirmar) o cualquier campo extra en el cuerpo. Así, **un cuerpo que nombra otro negocio se rechaza**: el negocio sale solo del token (ADR 0039), nunca del cuerpo.
- **Validación con el esquema compartido.** `packages/contracts/schemas` se copia al classpath con Maven y `networknt/json-schema-validator` valida cada operación contra `sync-push-request.schema.json`, sin copiar reglas a mano. Una prueba corre los casos de `cases/sync-push.json` que también corre Vitest.
- **`OperationRecorder`.** Interfaz en `pos.ingest` (fuera de los módulos, como `money` e `id`): cada módulo implementa un recorder con los tipos que le tocan, y `sync` los junta por inyección. Agregar un tipo es agregar un recorder.
- **Tablas (V5), todas con `tenant_id`, RLS forzada y política de `current_tenant_id()`:** `sync_operation`; `sale`, `sale_line`, `sale_payment`, `sale_return`, `sale_return_line`, `sale_return_refund`; `cash_session`, `cash_movement`, `cash_cut`; `stock_movement`. Llaves `(tenant_id, id)`: un id enviado por una caja no choca con el de otro negocio y no revela que existe. Sin llave foránea a `tenant` (como `audit_log`) ni al catálogo, que llega con E1-18. Dinero en centavos, cantidades en milésimas.
- **Solo agregar.** Todas menos `sync_operation` rechazan `UPDATE` y `DELETE` con un disparador para cualquier rol y `pos_app` no tiene esos privilegios: una venta completada no se edita (ADR 0030) y el libro de inventario es un libro (RF-029). `sync_operation` solo pierde `DELETE`, porque el dueño resolverá cuarentenas (E1-19).
- **Revisión de números en el servidor.** Aunque la caja ya lo revisó, el núcleo no confía en un cliente: líneas contra totales, pagos contra total, reembolsos contra el total de la devolución y cantidad devuelta contra la vendida. Dos devoluciones de la misma venta se turnan con `pg_advisory_xact_lock`, porque no se puede bloquear una fila que el rol no puede actualizar.
- **Bitácora.** El corte de caja y los ajustes y mermas de inventario llaman a `AuditLog.record` dentro de la transacción de la operación (ADR 0038), con el usuario que actuó. Si la operación revierte, la entrada también.

## Consecuencias
- El `registerId` se guarda pero todavía no se compara con una caja enrolada: el enrolamiento y el token de dispositivo llegan con F0-15, y entonces `POST /sync/push` debe exigir que el `registerId` sea el de la credencial. Hoy cualquier token válido con `tenant_id` puede subir, y F0-14 debe restringirlo por rol.
- Un lote de 100 son hasta 100 transacciones cortas en lugar de una. Es el costo de que la respuesta sea verdad, y a decenas de ventas por minuto no pesa.
- Una cuarentena no se reintenta ni se aplica sola: queda en `sync_operation` con su `raw_operation` hasta que E1-19 construya su revisión. Una venta en cuarentena no cuenta en `sale`; el dueño debe poder verla antes del piloto.
- Las discrepancias de precio (RF-022) y el cursor de bajada (E1-18) no se hacen aquí. Los movimientos de inventario de ventas y devoluciones los deriva E1-25 de `sale` y `sale_return`; por eso `stock_movement` solo recibe ajustes y mermas.
- No hay límite de tamaño de cuerpo en el núcleo: lo pone el proxy inverso. Un lote de 100 ventas pesa decenas de kilobytes.
- La prueba de concurrencia usa un pool de 12 conexiones y 8 hilos con el mismo lote; la del pool de una conexión que usan las demás pruebas no demostraría nada. No se probó con dos procesos del núcleo ni con una caída del servidor a media petición, solo con una excepción forzada en un recorder.
