# ADR 0051: Catálogo de productos, códigos únicos por negocio y unidad base fija

Estado: Aceptada · Fecha: 2026-11-10 · Concreta F0-16 (RF-001 y RF-002). Se apoya en los ADR 0011, 0028, 0034, 0035, 0036, 0038 y 0042. Deja listo el cursor de bajada de E1-18 y los precios y claves SAT de F0-17.

## Contexto
La caja ya tiene sus productos en SQLite (`product` y `product_barcode`, E1-07). El núcleo necesita el mismo modelo, como fuente de verdad del negocio: un rollo de 100 m se registra con unidad base metro y varios códigos (RF-002), escanear cualquier código encuentra el mismo producto (RF-001), y ningún código puede apuntar a dos productos del mismo negocio. Faltaba decidir cómo se guardan las unidades, qué pasa con los códigos de un producto borrado, cómo se hace segura una alta repetida y qué deja el núcleo preparado para que las cajas descarguen cambios (E1-18).

## Opciones
**Unidades y su tipo**
1. **Las cuatro unidades base del ADR 0011 como texto con `CHECK`**, y el tipo (conteo, peso, longitud, volumen) calculado en código con el enum `MeasurementKind`.
2. **Una tabla `unit` por negocio.** Permite unidades propias, pero cada unidad nueva toca la venta, el inventario y el SAT, y se perdería la garantía de que la caja y el núcleo cuenten igual.
3. **Una tabla global de unidades sin `tenant_id`.** La prueba de cobertura de RLS exige `tenant_id` en toda tabla de negocio; haría falta una excepción más.

**Un rollo, una caja**
1. **`product_presentation`:** nombre y cantidad en milésimas de la unidad base. El inventario siempre cuenta en la base y la presentación solo convierte (`Presentation.toBase`).
2. **Un producto distinto por presentación.** Duplica códigos y existencias y rompe el «una sola existencia».

**Códigos de un producto borrado**
1. **El código se queda con el producto borrado.** El `UNIQUE (tenant_id, code)` sigue siendo la única regla; una venta que usó el código conserva su significado.
2. **Liberar los códigos al borrar.** Permite reutilizarlos, pero un producto restaurado podría chocar y una caja con el catálogo viejo vendería el producto equivocado.

**Alta repetida**
1. **Llave de idempotencia en el encabezado `Idempotency-Key`** guardada en `product` con `UNIQUE (tenant_id, idempotency_key)` y `INSERT ... ON CONFLICT DO NOTHING`. Repetir devuelve el mismo producto.
2. **Sin llave y confiar en que los códigos choquen.** Un producto sin códigos se duplicaría en cada reintento.

**Cursor de cambios para E1-18**
1. **Un contador por negocio** (`catalog_change_counter`) y la columna `product.change_seq`. Cada cambio toma el siguiente número con un `UPDATE` que bloquea la fila hasta el commit.
2. **Una `SEQUENCE` global o `updated_at`.** Dos transacciones pueden confirmar en orden distinto al de sus números (o en el mismo milisegundo), y un lector con «dame lo posterior a N» se saltaría un cambio para siempre.
3. **Una tabla de bitácora de cambios aparte.** Cuesta una escritura más y el producto ya es la última versión de sí mismo.

**Búsqueda por nombre**
1. **Columna generada `search_text`** con `catalog_search_key()` (minúsculas y sin acentos) y `LIKE`.
2. **`pg_trgm` o búsqueda de texto completo.** Mejor con cientos de miles de productos; exige extensiones, y una tlapalería tiene unos miles.

## Decisión
- **Opción 1 en todo.**
- **Modelo (migración V11):** `product` (llave `(tenant_id, id)`, UUIDv7 generado por el núcleo, `name`, `status` `active` o `inactive`, `unit`, `deleted_at`, `idempotency_key`, `change_seq`), `product_code` (llave `(tenant_id, code)`, así un código apunta a un solo producto por negocio; `kind` `barcode` o `alternate`), `product_presentation` y `catalog_change_counter`. Las cuatro con `tenant_id`, RLS forzada y política de `current_tenant_id()`; la prueba de cobertura rompe CI si falta alguna. `pos_app` no puede borrar filas de `product`.
- **Unidad base fija.** `unit` no cambia después de la alta: las líneas de venta y el libro de inventario cuentan en ella. Un `PATCH` con otra unidad da 400. Las cantidades tienen 3 decimales y las piezas son enteras, con las mismas reglas de `Quantity` del ADR 0011; en la API viajan como texto (`"100.000"`) para que ningún cliente las redondee.
- **Códigos.** Sensibles a mayúsculas, de 1 a 64 caracteres sin espacios (igual que la caja), hasta 20 por producto. Usar un código de otro producto da 409 con el `productId` dueño. La alta y el cambio de códigos usan `INSERT ... ON CONFLICT DO UPDATE ... WHERE` en la misma transacción: dos peticiones que compiten por el mismo código dejan una sola ganadora, probado con seis hilos. Un `PATCH` con `codes` reemplaza la lista completa.
- **Borrado lógico.** `DELETE /products/{id}` pone `deleted_at`, responde 204 (repetirlo también), saca al producto de las lecturas y búsquedas (404) y conserva fila y códigos. Si se necesitara restaurar o reutilizar códigos, será un ADR nuevo.
- **Alta idempotente.** `POST /products` exige `Idempotency-Key` (un UUID). Misma llave: 200 con el producto de la primera vez, en vez de 201.
- **API.** `GET /products?q=&page=&size=` (`q` busca palabras del nombre sin importar mayúsculas ni acentos, o un código exacto; páginas desde 0, tamaño de 1 a 100, ordenado por nombre), `GET /products/{id}`, `POST /products`, `PATCH /products/{id}` y `DELETE /products/{id}`. Los permisos son los de F0-14: lectura para los tres roles y escritura para dueño y encargado (`product.read` y `product.write`); se agregaron `GET` y `DELETE` de `/products/{id}` a la tabla y a `docs/permisos.md`. El `PATCH` solo cambia lo que llega; una edición que no cambia nada no escribe, no audita y no emite evento. Las listas hijas se leen con una consulta por tabla para todos los productos de la página, nunca una por producto (sin N+1).
- **Bitácora y eventos en la misma transacción.** `product.created`, `product.updated` y `product.deleted` van a `audit_log` con el valor anterior y el nuevo (ADR 0038), y cada cambio publica `ProductCreated` o `ProductUpdated` (el borrado es un `ProductUpdated` con `deleted: true`) con el contrato `BusinessEvent` del ADR 0036: temas `pos.catalog.product-created.v1` y `pos.catalog.product-updated.v1`, llave `tenantId`, `schemaVersion` 1. `ProductUpdated` lleva el estado completo después del cambio, para que un consumidor lo aplique sin leer nada más. Si la transacción se revierte, no queda evento.
- **Cursor de E1-18 (preparado, no construido).** `catalog_change_counter.last_seq` es el último número entregado del negocio y cada producto guarda en `change_seq` el de su último cambio, también cuando cambian sus códigos o presentaciones o se borra. El número se toma con `INSERT ... ON CONFLICT DO UPDATE`, que bloquea la fila hasta el commit: los números salen y confirman en el mismo orden y no hay huecos (una alta rechazada devuelve el suyo con el rollback). El pull de E1-18 será «los productos con `change_seq` mayor que mi cursor, ordenados por `change_seq`», incluidos los borrados, y devolverá como nuevo cursor el mayor que vio. Hay una restricción `UNIQUE (tenant_id, change_seq)`. Mientras tanto el ADR 0048 (E1-18) creó el feed general `sync_change` con su propio contador y la interfaz `ChangePublisher`. F0-16 **no** publica allí a propósito: el contrato `product` del pull exige precio, impuesto y `baseUnit`, y sin F0-17 no habría un payload válido (la caja rechazaría la página). Por eso F0-17 debe llamar a `ChangePublisher.publish(PRODUCT, id, estado)` con precio e impuestos dentro de la misma transacción de cada cambio de producto, y entonces `catalog_change_counter` y `product.change_seq` quedan redundantes y se retiran en una migración (hoy solo dan un orden propio y el evento de dominio).
- **Qué no incluye.** Precios, impuestos, claves SAT (F0-17), importación (F0-18), cambio masivo de precios (F0-19) y el movimiento del inventario al recibir un rollo (el libro lo escribe E1-25). `Presentation.toBase` deja lista la conversión que el inventario usará.

## Consecuencias
- Un solo cliente, una sola regla: la caja y el núcleo cuentan en la misma unidad base, con el mismo formato de cantidad y la misma regla de códigos únicos, así el pull de E1-18 no tendrá que traducir.
- Todos los cambios de catálogo de un negocio se serializan un instante en la fila del contador, hasta el commit. Con decenas de cambios por minuto no pesa; una importación grande (F0-18) deberá tomar el número por lote o por producto con transacciones cortas, y cualquier carga masiva debe pensar en eso.
- Un producto borrado retiene sus códigos. Si el dueño borra un producto por error y quiere reutilizar su código, hoy no puede; es el costo de que una caja con el catálogo viejo no venda el producto equivocado.
- Los códigos distinguen mayúsculas de minúsculas, como la caja. Un lector físico entrega el código tal como está impreso, así que no hace falta normalizar.
- `LIKE '%texto%'` recorre los productos del negocio. Con miles de productos responde en milisegundos; si un negocio llegara a cientos de miles, se cambia a `pg_trgm` con un índice, sin tocar la API.
- Las pruebas de integración corren con Keycloak y PostgreSQL reales; los eventos se comprueban en la tabla del outbox, no en Redpanda (el contexto de la prueba no levanta el broker), y esa parte ya la cubre `OutboxTest`.
