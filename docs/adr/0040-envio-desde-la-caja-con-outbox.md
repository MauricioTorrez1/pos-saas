# ADR 0040: Envío desde la caja con outbox local, lotes en orden y reintentos con retroceso

Estado: Aceptada · Fecha: 2026-11-09 · Concreta E1-16. Aplica los ADR 0010, 0019 y 0021, y fija el contrato que E1-17 implementa en Java.

## Contexto
La caja debe vender sin internet en cualquier fase (RF-020) y, cuando vuelve la red, entregar al núcleo cada venta una sola vez (RF-021). El diseño de `docs/plan/03-arquitectura.md` ya fija el esquema: una fila en `sync_outbox` dentro de la misma transacción, lotes de hasta 100 en orden de `device_seq`, y una respuesta por operación. Faltaba decidir cómo se escribe esa fila, cómo se sabe qué se entregó, cómo se reintenta y qué forma exacta tiene el lote, porque el servidor todavía no existe y se construye contra este contrato.

## Opciones
**Quién escribe la fila del outbox**
1. **Cada almacén la escribe en su propia transacción** con `SyncOutbox.enqueue`, que se niega a correr fuera de una transacción. El payload se arma en TypeScript, con los mismos datos que ya leyó el almacén.
2. **Disparadores (triggers) de SQLite.** Nadie puede olvidar escribirla, pero el JSON de una venta con líneas y pagos se arma en SQL, difícil de probar y de cambiar de versión.
3. **Un bus de eventos en memoria que escribe tras el commit.** Si la caja se apaga entre el commit y el evento, la venta existe y su operación no.

**Cómo se sabe que algo se entregó**
1. **Una confirmación por operación** en la respuesta (`accepted`, `duplicate` o `quarantined`). Solo lo confirmado se marca.
2. **Un HTTP 200 para todo el lote.** Si el servidor se detiene a la mitad, la caja marcaría como entregado lo que no lo fue.

**Reintentos**
1. **Retroceso exponencial con jitter (cada espera se duplica y lleva una parte aleatoria)**, con tope de un minuto.
2. **Intervalo fijo de 5 segundos.** Más simple, pero muchas cajas que pierden la red juntas vuelven en el mismo instante y saturan al núcleo al reconectar.

## Decisión
- **Outbox escrito por los almacenes (opción 1).** `SaleStore.markCompleted`, `ReturnStore.insert`, `CashSessionStore` (apertura, movimiento y corte) e `InventoryService.adjust` llaman a `enqueue` dentro de la transacción del cambio. Una prueba confirma que lo que escriben cumple el esquema JSON de `packages/contracts`. Quedan fuera las ventas pendientes o canceladas, el saldo inicial de la importación y los movimientos de inventario de ventas y devoluciones: el núcleo los deriva de la venta (E1-25).
- **Tabla `sync_outbox` (migración 12).** `device_seq` es `INTEGER PRIMARY KEY AUTOINCREMENT`, así que un número nunca se reutiliza. El núcleo ordena por él y nunca por el reloj; `occurred_at` es informativo. `op_id` (UUIDv7, único) es la llave de idempotencia. Solo cambian las columnas de entrega: disparadores impiden editar el contenido, volver de `delivered` a `pending` y borrar filas.
- **Contrato del lote** en `packages/contracts`: `schemas/sync-push-request.schema.json`, `schemas/sync-push-response.schema.json` y `cases/sync-push.json` (casos válidos y rechazos con la palabra clave de JSON Schema que los rechaza). Lo valida Ajv en TypeScript; E1-17 lo lee desde Java. Reglas para el servidor:
  - `POST /sync/push` recibe hasta 100 operaciones en `deviceSeq` ascendente. La unicidad es `(tenant, opId)`.
  - Con el sobre bien formado responde `200` con un resultado por operación atendida, y puede detenerse antes: lo que no aparece en `results` no está confirmado y la caja lo reenvía. Cualquier otro código significa que nada se confirmó.
  - `duplicate` es la respuesta a un `opId` ya guardado, y la caja lo trata como entrega correcta. `quarantined` (con `reason`) guarda la operación para el dueño, no se reintenta y no bloquea a las siguientes (RF-022).
  - Un tipo o una `schemaVersion` que el servidor no conoce se pone en cuarentena, no se rechaza el lote.
  - El orden se respeta por registro: una devolución solo llega después de la venta que devuelve, porque la caja sube siempre las más antiguas primero.
- **`SyncTransport` como interfaz.** `HttpSyncTransport` hace el `POST` con tiempo máximo de 15 s; las pruebas usan `FakeSyncTransport`, que guarda cada `opId` una sola vez y puede cortar la red antes de que llegue el lote o después de guardarlo y antes de contestar. Una respuesta que no cumple el contrato se descarta entera (`SyncProtocolError`), porque creerla marcaría una venta como entregada sin estarlo.
- **Marcado.** El sincronizador solo marca lo que aparece en `results` y estaba en el lote, en una sola transacción. Si falla el envío, las operaciones siguen pendientes, suben su contador `attempts` y guardan `last_error`. Si el núcleo no confirma ninguna de un lote, el ciclo se detiene en lugar de repetir sin fin. Un solo ciclo corre a la vez.
- **Retroceso (opción 1).** Base de 5 s, se duplica hasta 60 s, con la mitad de cada espera fija y la otra mitad aleatoria. Con éxito vuelve a empujar cada 5 s. `nudge()` empuja de inmediato y olvida los fallos, para cuando se detecte que volvió la red.
- **Arranque.** La caja solo envía si existe `POS_SYNC_URL`. Sin ella vende igual y acumula en el outbox. No hay credenciales ni cabeceras de autenticación hasta F0-15; `register_id` se genera una vez (UUIDv7) y se guarda en `register_setting`.
- La venta nunca espera a la red: solo escribe en SQLite, y el sincronizador es un ciclo aparte que solo lee el outbox.

## Consecuencias
- Si la caja muere entre la confirmación del núcleo y su propio marcado, reenvía y recibe `duplicate`. Es el costo de la entrega «al menos una vez» y por eso la idempotencia en el servidor es obligatoria (E1-17).
- Las filas entregadas no se borran, porque el disparador lo impide. Crecen unos cientos de bytes por operación; podarlas queda para cuando haya datos de uso reales y un ADR que cambie el disparador.
- Restaurar un respaldo antiguo hace retroceder `device_seq` y puede repetirlo con otro `opId`. La idempotencia se apoya en `opId`, no en `deviceSeq`, así que no se duplica nada, pero E1-17 no debe rechazar un `deviceSeq` menor al último visto.
- El payload no lleva datos de tarjeta ni el `tenant_id`: el núcleo lo toma de la autenticación del registro.
- No se probó contra un servidor real ni con una desconexión física de red. Las pruebas cubren los cortes con un falso y con `fetch` simulado; E1-20 hace la prueba de punta a punta con Testcontainers.
- Agregar un tipo de operación es un cambio del esquema y de `SYNC_OPERATION_TYPES`; cambiar la forma de uno existente sube su `schemaVersion`.
