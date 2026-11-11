# ADR 0048: Cambios hacia la caja con cursor numerado por negocio, tombstones y aplicación atómica

Estado: Aceptada · Fecha: 2026-11-10 · Concreta E1-18 (RF-023). Se apoya en los ADR 0035, 0039, 0040 y 0046.

## Contexto
Cuando el dueño cambia un precio, da de baja un producto o cambia los permisos de una persona, la caja debe enterarse sin internet permanente y sin perder ni repetir nada (RF-023). El núcleo no puede empujar a las cajas (pueden estar apagadas o sin red), así que cada caja pregunta «¿qué cambió desde la última vez?» con un **cursor**. Había que decidir qué es el cursor, cómo se evita que un cambio en vuelo se salte, cómo llega lo borrado, qué viaja y cómo se aplica en la caja.

## Opciones
**Qué es el cursor**
1. **Un número por negocio (`seq`) asignado en orden de confirmación.** El cursor es el último número aplicado. Misma pregunta, mismas respuestas; avanzar es leer `seq > cursor`.
2. **Un `timestamp` (`updated_at > último`).** Dos cambios en el mismo milisegundo, un reloj desfasado o una transacción lenta que confirma después dejan filas atrás del cursor para siempre.
3. **Una secuencia de PostgreSQL (`bigserial`) sin más.** Las secuencias se asignan al empezar, no al confirmar: la transacción A toma el 10, la B toma el 11 y confirma primero; un lector que ve el 11 mueve el cursor y A, al confirmar, queda atrás del cursor. Es el salto silencioso clásico.
4. **Filtrar por `xmin` del snapshot** para leer solo lo ya confirmado. Funciona, pero acopla el cursor a detalles internos de PostgreSQL y complica la prueba.

**Cómo se evita el salto (opción 1)**
- **Fila contador por negocio** (`sync_change_counter`): tomar el siguiente número es un `UPDATE` de esa fila, que se queda bloqueada hasta confirmar o revertir. Dos transacciones del mismo negocio que publican cambios se forman en fila, así que el orden de `seq` es el orden de confirmación y no hay huecos (un `ROLLBACK` deshace también el número). Cuesta serializar las escrituras del catálogo de un negocio; con decenas de cambios por minuto, y una importación entera en una transacción, no pesa.

**Cómo llega lo borrado**
1. **Tombstone**: una fila del log con `deleted = true` y sin `payload`. La caja que estuvo apagada un mes lo recibe en orden y lo borra.
2. **Borrar la fila de origen y que la caja compare listas completas.** Cuesta bajar todo el catálogo cada vez y no distingue «borrado» de «aún no llegó».

**Qué viaja**
1. **El estado completo de la entidad** en cada cambio, no un diferencial. Aplicar dos veces da lo mismo (idempotente), y un cambio perdido se corrige con el siguiente de la misma entidad.
2. **Solo los campos que cambiaron.** Más pequeño, pero aplicar dos veces o fuera de orden da resultados distintos.

**Cómo aplica la caja una página**
1. **Una transacción local con los cambios y el avance del cursor juntos.** Si algo falla, no queda nada y el cursor no se mueve.
2. **Aplicar y luego guardar el cursor.** Un corte entre ambos deja datos nuevos con cursor viejo (se reaplican, es inocuo) o, al revés, un cursor adelantado que se salta cambios. Con una sola transacción ninguno de los dos puede pasar.

## Decisión
- **`GET /sync/pull?cursor=&limit=`.** Autenticado con el permiso `sync.pull` (dueño, encargado y cajero, como `sync.push`; F0-15 lo cambia por la credencial de dispositivo). El negocio sale del token y RLS lo impone; un parámetro que no sea `cursor` o `limit` se rechaza con 400, así que un cuerpo o consulta que nombre otro negocio no se obedece.
- **Respuesta** `{ changes, nextCursor, hasMore }` (esquema `sync-pull-response.schema.json`). `cursor` es un texto numérico que la caja guarda tal cual y nunca calcula; falta la primera vez y equivale a `0`. `limit` va de 1 a 500 (200 por omisión). `nextCursor` es el `seq` del último cambio de la página, o el mismo cursor recibido si no hay nada nuevo. `hasMore` se calcula pidiendo una fila más que el límite.
- **Estable y reanudable.** El mismo cursor devuelve los mismos cambios más lo que haya llegado después, nunca menos ni distintos (el log solo se agrega). No hay saltos por la fila contador ni duplicados porque `seq` es único por negocio. Un cursor mayor que el último cambio del negocio (un núcleo restaurado de un respaldo) contesta `409` con `code: cursor_ahead`; la caja reinicia su cursor en `0` y reaplica, lo cual es seguro por ser estados completos.
- **Tablas (migración V10), con `tenant_id` y RLS forzada:** `sync_change_counter` (último número por negocio) y `sync_change` (`PRIMARY KEY (tenant_id, seq)`, `entity_type`, `entity_id`, `deleted`, `schema_version`, `payload` jsonb, `changed_at`; `payload` existe si y solo si no está borrado). Solo se agrega: un disparador rechaza `UPDATE` y `DELETE` para cualquier rol y `pos_app` no tiene esos privilegios, porque un tombstone que desaparece deja a una caja atrasada con un producto fantasma.
- **Origen abstracto: `ChangePublisher`** (`pos.feed`, fuera de los módulos, como `OperationRecorder` y `money`). El módulo dueño del dato llama `publish(tipo, id, estado)` o `publishDeletion(tipo, id)` **dentro de la misma transacción** que cambia el dato, de modo que cambio y anuncio se guardan o se pierden juntos. `sync` lo implementa (`SyncChangeFeed`) y ningún módulo depende de `sync`. F0-16 (productos) aún no existe: los productos de las pruebas se publican por esta misma interfaz, y **F0-16 debe llamarla** al crear, editar, cambiar precio y dar de baja un producto.
- **Tipos de entidad (v1):** `product` (nombre, unidad, **precio**, impuesto y códigos de barras: un cambio de precio es un nuevo estado del producto, una sola entidad y un solo orden) y `staff_member` (nombre, rol, lista de permisos y activo: una persona que se va queda `active: false`, nunca se borra, porque sus ventas conservan su nombre). Un tipo que la caja no conoce **detiene la descarga sin mover el cursor** en lugar de saltarlo: saltarlo lo perdería para siempre al avanzar. La caja vieja sigue vendiendo con lo que ya tiene hasta que se actualice.
- **En la caja.** `ChangePuller` descarga página por página y `ChangeApplier` aplica cada página y su cursor en **una transacción de SQLite** (`sync_pull_state` guarda el cursor; la migración local 14). Una página que no cumple el contrato (forma, tipos, orden, un cursor que no es el de su último cambio) se rechaza entera antes de tocar la base, y una que haría **retroceder** el cursor también. El producto recibido reemplaza el local (y deja de ser «de muestra»); un código de barras que cambió de producto sigue al estado más nuevo; un tombstone borra el producto con sus códigos y su lugar en la búsqueda; borrar lo que no existe no es error. `staff_permission` guarda los permisos que el núcleo dice, aparte de `app_user`, que guarda el hash del PIN que el núcleo nunca ve.
- **Sin bloquear nada.** El pull es un segundo ciclo (`SyncScheduler`, cada 30 s con el mismo retroceso exponencial) independiente del de envío y de las ventas: solo lee la red y escribe en transacciones cortas. Un corte de red a media página no cambia nada y la siguiente corrida pide lo mismo.
- **Contrato compartido.** `packages/contracts/schemas/sync-pull-{query,response}.schema.json` y `cases/sync-pull.json`: Vitest valida los casos contra los esquemas y contra el lector de la caja; las pruebas del núcleo validan sus respuestas con el mismo esquema y recorren las mismas consultas buenas y malas.

## Consecuencias
- **Los cambios hechos en la caja y el catálogo del núcleo convergen por el núcleo.** El precio que cambia el dueño en la caja (E1-39, `product.price_changed`) sube por el outbox, pero el núcleo todavía no tiene tabla de productos que lo aplique ni lo republique (F0-16). Mientras tanto, un cambio del panel que llegue por el pull reemplaza el precio local: el núcleo manda.
- **El log crece.** Cada cambio es una fila para siempre. Una compactación (conservar el último estado de cada entidad y los tombstones recientes) es posible sin cambiar el contrato porque cada cambio es un estado completo, pero habría que avisar a las cajas más atrasadas que la fecha de su cursor ya no existe (`409`). No se hace ahora.
- **Un negocio serializa sus escrituras de catálogo** por el bloqueo de la fila contador. Una importación grande retiene el bloqueo durante su transacción; debe hacerse por trozos si pasa de unos miles de filas.
- **Los permisos solo se guardan en la caja;** hacer que el mostrador los aplique sin internet y que `UserRoleService` publique `staff_member` al cambiar un rol quedan para F0-14/F0-15 (el contrato y el origen ya existen, pero el módulo `identity` no los llama todavía).
- **No se probó** con dos procesos del núcleo ni con una caída del servidor a media respuesta; la prueba de concurrencia usa hilos y un pool de conexiones contra un solo PostgreSQL.
