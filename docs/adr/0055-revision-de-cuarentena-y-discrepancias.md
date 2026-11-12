# ADR 0055: Revisión de cuarentena y discrepancias con resoluciones de solo agregar y aviso por el pull

Estado: Aceptada · Fecha: 2026-11-10 · Concreta E1-19 (RF-022). Se apoya en los ADR 0038, 0042, 0046, 0048 y 0053.

## Contexto
El núcleo no rechaza lo que la caja ya hizo (ADR 0046 y 0053): una operación que no puede aplicar queda en **cuarentena** con su motivo, y un cambio de precio cuyo precio anterior no es el que el núcleo tiene queda marcado como **discrepancia**. Ambas cosas esperan al dueño. Había que decidir qué puede hacer con cada una, cómo se registra de modo que no se pueda reescribir, cómo se evita que dos personas la resuelvan a la vez y cómo se entera la caja.

## Opciones
**Dónde queda registrada la resolución**
1. **Una tabla propia de solo agregar (`review_resolution`)** con `UNIQUE (tenant_id, kind, subject_id)`. `sync_operation` y `product_price_change` no cambian; quién resolvió qué y cuándo no se puede editar.
2. **Una columna de estado en cada tabla.** Obliga a quitar la protección de solo agregar de `product_price_change` y pierde el historial si se vuelve a resolver.

**Cómo se evita la doble resolución**
1. **Candado asesor por elemento (`pg_advisory_xact_lock`) más la restricción `UNIQUE`.** Quien llega segundo espera, ve la fila del primero y contesta igual (mismo resultado) o con conflicto (otro resultado). El candado es por elemento: no frena otras resoluciones.
2. **Solo la restricción `UNIQUE`.** El perdedor ya habría aplicado la venta de nuevo y tendría que deshacerla; es la restricción de último recurso, no el camino normal.
3. **Un candado de fila.** El rol de la aplicación no puede actualizar `product_price_change`, así que no se puede bloquear.

**Cómo se aplica de nuevo una operación aceptada**
1. **Por el mismo `OperationRecorder` de E1-17**, dentro de la transacción de la resolución. Una venta aceptada escribe exactamente las filas que habría escrito sin cuarentena, y las mismas restricciones la protegen.
2. **Una ruta paralela para la cuarentena.** Dos caminos para escribir una venta tarde o temprano difieren.

**Cómo se entera la caja**
1. **`ChangePublisher` con un tipo de entidad nuevo, `review_resolution`** (aditivo al contrato del pull, ADR 0048). La caja ya sabe pedir cambios y aplicarlos con su cursor; no hay un canal nuevo.
2. **Que la caja consulte un endpoint de revisión.** Otro ciclo, otra autenticación, y la caja no es quien revisa.

## Decisión
- **Dos listas, un solo patrón.** `GET /quarantine` (operaciones en cuarentena) y `GET /discrepancies` (cambios de precio con discrepancia), cada una con `status=open|resolved|all` (por omisión `open`), `limit` de 1 a 100 (50 por omisión) y un cursor de llave (`id` de `sync_operation`, `seq` de `product_price_change`), de modo que no hay saltos ni duplicados aunque lleguen más. Cada una tiene su detalle (`/quarantine/{opId}` con la operación tal como llegó; `/discrepancies/{id}`). Todo pasa por RLS: otro negocio no ve ni resuelve lo ajeno, y contesta 404.
- **Tres acciones**, `POST /quarantine/{opId}/resolution` con `accept`, `reject` o `correct`; las discrepancias solo aceptan `accept` y `reject`:
  - **accept (aceptar y aplicar):** reaplica la operación original. Si todavía rompe una regla contesta `422` con el motivo y **no cambia nada** (ni resolución, ni bitácora, ni aviso): sigue abierta para rechazarla o corregirla.
  - **correct (corregir y reaplicar):** el dueño manda el `payload` correcto; se aplica bajo el mismo `opId` con la misma validación. El original se conserva en `sync_operation.raw_operation` y el corregido en `review_resolution.corrected_payload`. Una discrepancia no se corrige: el cambio de precio es un hecho de la caja, que ya cobró con él.
  - **reject (rechazar):** exige un motivo de 1 a 500 caracteres; no se aplica nada.
  Aceptar una discrepancia deja el precio de la caja como el que vale; rechazarla lo deja marcado como erróneo. Hasta que exista el catálogo del servidor (F0-16), ninguna de las dos mueve un precio: la discrepancia se compara contra el último cambio recibido (ADR 0053) y F0-16 decide qué cambio manda.
- **Idempotente y definitiva.** Repetir la misma resolución contesta `200` con la ya guardada y no escribe nada; la primera contesta `201`. Resolver de otra manera algo ya resuelto es `409`. Entre dos peticiones simultáneas gana una sola (candado y `UNIQUE`): la venta se escribe una vez y la bitácora lleva una entrada.
- **Tabla `review_resolution` (migración V15):** `kind` (`quarantine` o `discrepancy`), `subject_id` (el `op_id` o el id del cambio), `action`, `reason`, `corrected_payload`, `resolved_by`, `resolved_at`; con `tenant_id`, RLS forzada y solo agregar (disparador y privilegios). Restricciones: el motivo es obligatorio salvo al aceptar, y solo una cuarentena se corrige.
- **Bitácora (ADR 0038).** En la misma transacción, `review.resolved` sobre `quarantined_operation` o `price_discrepancy`, con quien resolvió, el estado anterior y el nuevo. **El motivo no va a la bitácora**: es texto libre del dueño y puede traer nombres; se queda en `review_resolution`, a la que se llega por el id. Sin datos personales ni precios.
- **Aviso a la caja.** En la misma transacción se publica un cambio `review_resolution` (`entityId` = `opId` o id del cambio) con `kind`, `resolution`, `operationType`, `reason` si lo hay, y `resolvedAt`. El contrato (`sync-pull-response.schema.json`) y sus casos compartidos lo incluyen. La caja lo guarda en `operation_review` (migración local 16) y lo muestra; **no borra la venta rechazada**: la caja conserva sus propios registros y el dueño decide fuera del sistema qué hacer con el efectivo. Un tipo nuevo es aditivo: una caja vieja se detiene en él sin mover su cursor, como con cualquier tipo desconocido (ADR 0048).
- **Permisos (ADR 0042).** `discrepancy.view` (dueño y encargado) cubre las cuatro lecturas; el permiso nuevo `discrepancy.resolve` (dueño y encargado) cubre las dos resoluciones. El cajero ni ve ni resuelve: la venta en revisión puede ser la suya. `docs/permisos.md` lo muestra.
- **Fuera del módulo `identity` y del catálogo.** Todo vive en `sync` (su descripción ya incluía las discrepancias); lee `product_price_change` por SQL y no depende del módulo `catalog`.

## Consecuencias
- Una cuarentena rechazada sigue en `sync_operation` con su estado de llegada (`quarantined`); lo que vale es la resolución. La lista cruza ambas tablas.
- **La caja solo informa.** No hay todavía pantalla de la caja que muestre `operation_review` (la pantalla del dueño es parte del panel, F0-20 y siguientes); los datos ya llegan y están probados.
- Aceptar una venta de cuarentena no recalcula el inventario ni el costo promedio: los hace E1-25 desde `sale`, como con cualquier venta.
- Si la operación original no se puede aplicar nunca (tipo o versión desconocidos), el dueño solo puede rechazarla o corregirla; el motivo de la cuarentena se le muestra para decidir.
- **No se probó** con dos procesos del núcleo; la concurrencia usa hilos y un pool de conexiones contra un solo PostgreSQL. Tampoco hay paginación de las resoluciones en la caja ni compactación del log de avisos.
