# ADR 0057: Dar de alta un producto nuevo en la caja

Estado: Aceptada · Fecha: 2026-11-11 · Concreta E1-42 (requisito nuevo del dueño: «en la caja debe ser posible dar de alta un producto que no existe»). Cumple RF-040 y aplica los ADR 0003, 0011, 0023, 0031, 0040, 0047 y 0051.

## Contexto
Hasta ahora un producto solo entraba a la caja con la importación de Eleventa (E1-29) o bajando del núcleo (E1-18). Si un cliente trae algo que no está en el catálogo, el cajero solo puede cobrarlo como artículo varios (ADR 0033), que no deja existencia, ni código, ni historial. El dueño necesita darlo de alta en el momento, con todo lo que un producto real lleva, sin internet y sin salirse del flujo de venta. Dar de alta toca reglas que no se rompen: el dinero va en enteros con las escalas del ADR 0011, la existencia es un libro de movimientos inmutable que nunca se edita (ADR 0003 y 0031), y toda operación que viaja por red lleva UUIDv7 e idempotencia (ADR 0040).

## Opciones
**Quién puede dar de alta**
1. **Cualquier cajero.** Rápido, pero llena el catálogo de duplicados y de precios sin dueño.
2. **Solo el dueño, con su sesión; un cajero necesita el PIN de un dueño.** Es la regla de cambiar un precio (ADR 0047), sacar efectivo (ADR 0029) y aprobar una devolución (ADR 0030).
3. **Un permiso por persona.** Más flexible, pero no existe: los roles son `owner` y `cashier`.

**La existencia inicial**
1. **Una columna `stock` en el producto.** Rompe el libro: no hay historial ni se puede verificar contra las ventas.
2. **Un movimiento `opening_balance` en el libro, en la misma transacción que el producto.** Es lo que ya hace la importación de Eleventa; el kardex y la verificación del libro funcionan sin cambios.
3. **Obligar a un ajuste aparte después.** Dos pasos y un hueco entre ellos en el que el producto existe sin existencia.

**Dónde se genera la identidad del producto**
1. **El núcleo, al recibirlo.** La caja no podría vender el producto, ni registrar su movimiento, hasta tener internet.
2. **La caja, con un UUIDv7 propio.** El producto existe y se vende sin conexión; el núcleo lo reconoce por su `productId`.

**Códigos de barras repetidos**
1. **Permitirlos y avisar.** El lector ya no sabría a cuál producto apuntar.
2. **Un código es de un solo producto por negocio, incluso si ese producto fue dado de baja**, y el rechazo dice cuál lo tiene. Es lo mismo que exige el núcleo (ADR 0051) y lo que ya impone la llave `(tenant_id, code)` de `product_barcode`.

## Decisión
- Opción 2 en las cuatro preguntas.
- **Quién:** el dueño con sesión abierta da de alta sin más. Un cajero escribe el PIN de un dueño (el mismo conteo de intentos y bloqueo). Toda la regla vive en `OwnerGate`, que ahora comparten E1-39, E1-42 y E1-43: si algún día hay rol de gerente, se suma en un solo lugar. Un intento negado (sin PIN, PIN incorrecto o bloqueado) deja una entrada `product.create_denied` bajo el nombre de quien lo pidió, con el motivo y lo que intentó.
- **Qué se pide** (en la pantalla y otra vez en el proceso principal, `ProductService.create`):
  - **Nombre:** de 1 a 200 letras, sin contar los espacios de los lados. Dos productos pueden llamarse igual (dos marcas), porque lo que los distingue es el código.
  - **Unidad de medida** explícita: pieza, metro, kilo o litro (la unidad base de los ADR 0011 y 0051). No hay valor por omisión escondido: la pantalla empieza en «Pieza», que es lo más común, y la persona la ve.
  - **Precio** con IVA incluido, el texto de pesos que lee `parseUnitPriceE4` (hasta 4 decimales, sin signo ni comas), **mayor que cero** y de máximo $1,000,000.00, igual que el cambio de precio (ADR 0047).
  - **IVA:** 16 %, 8 %, 0 % o exento (ADR 0023). Un exento siempre lleva tasa 0.
  - **Costo** opcional, en pesos con hasta 6 decimales (`unit_cost_e6`, la escala de costos del ADR 0011). Cero se permite, porque algo recibido gratis sí cuesta cero. El máximo es el mismo $1,000,000.00.
  - **Códigos de barras:** cero a veinte, de 1 a 64 caracteres sin espacios ni caracteres de control (los límites del contrato con el núcleo). El campo recibe al lector: el lector termina cada código con Enter, que lo agrega a la lista y deja el campo listo para el siguiente. Al agregarlo se consulta si otro producto activo ya lo usa, y al guardar se revisa otra vez contra todos, también los dados de baja.
  - **Existencia inicial** opcional, con la clase `Quantity`: hasta 3 decimales y piezas enteras. Vacío significa que no hay movimiento. Cero se rechaza (usa el campo vacío).
  - **Estado:** activo o no. Un producto dado de alta como inactivo no se vende ni aparece en la búsqueda de la venta hasta activarlo (E1-43).
- **Una sola transacción** (`ProductService.create`): `INSERT` del producto con un UUIDv7 que genera el proceso principal de la caja, sus códigos, el movimiento `opening_balance` con `source = 'product_creation'` y `source_id = productId` (así un producto no puede publicar su saldo inicial dos veces, y lleva el costo si se conoce), la entrada de bitácora `product.create` con quién, cuándo y todos los valores, y la operación `product.created` en `sync_outbox`. Si cualquiera falla, no queda nada. El proceso principal revisa los códigos repetidos **antes** de pedir el PIN, para que un cajero no gaste intentos del PIN por un problema que el PIN no arregla.
- **Pantalla:** en la venta, cuando una búsqueda o un escaneo no encuentra nada, el aviso ofrece «Dar de alta «lo tecleado»» y **F5** abre «Producto nuevo» con eso ya cargado: un texto escaneado, o de una palabra con dígitos y al menos 6 caracteres, va al campo de códigos; lo demás va al nombre. F5 sin búsqueda abre el formulario vacío. **F2** guarda y **Esc** cancela, como en los demás diálogos. Los errores salen todos juntos, caja por caja, en rojo y en español. Si el producto salió de una búsqueda y quedó activo, se agrega a la venta que se está armando, porque es justo lo que el cliente trajo. Usa los colores y tamaños del sistema de apariencia del dueño (RNF-13), sin estilos propios.
- **Migración 15 de la caja:** `product` gana `is_active` (borrado lógico, que usa E1-43), `unit_cost_e6` (el costo que el dueño escribió) y `revision` (sube en 1 con cada cambio, con un disparador, para el control de concurrencia de E1-43). El margen de «Cambiar precio» prefiere el costo escrito sobre el último costo del libro.
- **El catálogo de la venta no ve los productos inactivos** (`ProductCatalog`: `findById`, `findByCode` y `search` los excluyen salvo que se pida `includeInactive`, que usan las pantallas de producto). Un código de un producto inactivo sigue ocupado.
- **Ventas cerradas y tickets:** no cambian. Nada de esto toca `sale`, `sale_line`, `payment` ni un ticket.
- **Contrato** (`packages/contracts`, aditivo, versión 1): el tipo `product.created` se agrega a `sync-push-request.schema.json` con el payload `{ productId, name, unit, unitPriceE4, taxFactor, taxRateBp, unitCostE6, barcodes, isActive, initialStock, createdBy, authorizedBy }`. `unitPriceE4` va de 1 a 10,000,000,000, `unitCostE6` es `null` o un entero de 0 a 1,000,000,000,000, `barcodes` tiene hasta 20 códigos únicos, `initialStock` es `null` o `{ quantityMilli, unitCostE6 }` con `quantityMilli` de 1 en adelante, y `createdBy` y `authorizedBy` son UUIDv7 (el mismo si lo hizo el dueño). Hay dos casos válidos y diez rechazos en `cases/sync-push.json`.
- **Reglas para el servidor** (las implementa una tarea del núcleo; esta tarea no lo toca): crear el producto en el catálogo del negocio con ese `productId` y guardarlo una sola vez (la llave `opId` ya hace idempotente el envío, y `productId` identifica al producto); publicar **un** movimiento `opening_balance` con `source = 'product_creation'` y `source_id = productId` si hay `initialStock`, y nunca un segundo; si un código ya pertenece a otro producto del núcleo (otra caja lo dio de alta primero), **no** rechazar la operación: guardarla en cuarentena con el motivo, para que el dueño decida en E1-19; el orden lo da `deviceSeq`, nunca el reloj. Mientras el núcleo no conozca `product.created`, `POST /sync/push` la deja en cuarentena como un tipo que no conoce (ADR 0040) y no se pierde.

## Consecuencias
- Un producto creado sin internet se vende al instante y viaja después, en orden. Otra caja lo verá cuando el núcleo lo publique con E1-18.
- Un cajero con el PIN del dueño puede dar de alta productos, y cada intento queda en la bitácora. Sin rol de gerente, la aprobación es la del dueño.
- Dos cajas sin internet pueden dar de alta el mismo código. El conflicto no se resuelve en la caja (no puede saberlo): lo ve el dueño como cuarentena en el núcleo.
- No hay «deshacer»: un error se corrige con el panel de producto (E1-43), y los dos pasos quedan en la bitácora.
- El nombre repetido no se bloquea. Si en el piloto se ven duplicados reales, se agrega un aviso, no una prohibición.
- Las unidades de compra (caja, rollo, presentación) siguen fuera: el producto se cuenta en su unidad base (ADR 0051).
