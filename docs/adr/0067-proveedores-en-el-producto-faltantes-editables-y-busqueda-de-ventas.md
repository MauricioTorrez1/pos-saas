# ADR 0067: Proveedores en el producto, faltantes editables, encabezado del ticket y búsqueda de ventas

Estado: Aceptada · Fecha: 2026-11-17 · Concreta E1-50. Se apoya en los ADR 0059, 0060, 0061 y 0063. Cambia la inmutabilidad de `missing_item_request` del ADR 0063.

## Contexto
Antes de la siguiente tanda, Mauricio pidió:
1. Más de tres proveedores por producto, y en la pantalla del producto un botón verde «Pedir más» que lo agregue al pedido de su proveedor. Quitar la casilla «A la venta» y dejar solo «Dar de baja».
2. Editar las notas de un faltante y eliminarlo con un botón rojo. «Eliminar» reemplaza a «Descartar»; «Ya lo vendemos» se queda.
3. Editar en el diseño del ticket el nombre del negocio y la moneda.
4. Una barra de búsqueda en «Resumen» por ticket, nombre de producto o código.

## Decisiones

**Proveedores sin límite en la pantalla del producto.** El código nunca tuvo un tope de tres: la lista del administrador de proveedores crecía sin barra y escondía el formulario. Ahora:
- esa lista tiene su propia barra de desplazamiento;
- el panel del producto muestra todos sus proveedores, cada uno con su código y costo, y un formulario para ligar uno más (el código se propone con el código de barras).

**«Pedir más».** El canal `purchasing:order-more` busca el borrador más reciente del proveedor y le agrega el producto. Si no hay borrador, crea uno. La cantidad es la sugerida por el pedido (ADR 0059) o 1 unidad; el costo es el de lista del proveedor o el estimado. Responde `already_in_order` si el producto ya está y `full` si el borrador llegó al máximo de renglones. Pasa por el mismo `save` que la pantalla de pedidos, así que pide el PIN del dueño a una cajera igual que ella.

**Solo «Dar de baja».** La casilla «A la venta» hacía lo mismo que «Dar de baja» sin confirmación. Se quita; dar de baja pide confirmar y «Reactivar producto» lo regresa.

**Faltantes: las notas se editan, lo pedido no.** La migración local 20 cambia el disparador:
- antes nada del renglón podía cambiar;
- ahora solo las notas (`BEFORE UPDATE OF id, tenant_id, description, item_key, quantity, recorded_by, recorded_at`).

Al editar, las notas quedan en la vez más reciente y se borran de las anteriores, para que el faltante muestre exactamente lo escrito. Cualquiera con sesión puede editar notas (`missing_item.notes_edited` en auditoría).

**Eliminar en lugar de descartar.** «Eliminar» borra todas las veces del faltante y la decisión del dueño, solo lo hace el dueño, pide confirmar y queda en auditoría con cuántas veces se borraron (`missing_item.deleted`). El estado `dismissed` se conserva para leer datos viejos, pero la pantalla ya no lo ofrece.

Opciones que se consideraron para eliminar:
1. Marcar como eliminado y ocultarlo.
2. Borrar las filas y dejar el rastro en la auditoría.

Se eligió la 2: un faltante anotado por error no aporta a las tendencias, y la auditoría ya guarda quién lo borró y qué era.

**Nombre del negocio y moneda en el ticket.** `TicketDesign` suma dos campos:
- `businessName`: el nombre que va arriba en negritas. Vacío usa el nombre con el que se dio de alta la caja. Hasta 40 letras, sin caracteres de control.
- `currency`: `symbol` ($12.50), `symbol_code` ($12.50 MXN) o `code` (MXN 12.50). Solo cambia cómo se escribe: el importe siempre es en pesos, porque la caja no convierte monedas.

Un diseño guardado antes se lee con nombre vacío y signo de pesos, así que el ticket por defecto sale con los mismos bytes.

**Búsqueda de ventas en «Resumen».** `SalesHistory.list` ya buscaba por folio para «Ventas». Ahora también busca por producto:
- el texto se pasa al catálogo (búsqueda de nombre con FTS, que ignora acentos, y código de barras exacto), incluyendo productos dados de baja;
- un renglón coincide si es uno de esos productos o si el nombre impreso en el ticket contiene el texto, así un producto renombrado se sigue encontrando;
- `%` y `_` se escapan para que no funcionen como comodines;
- cada venta dice qué productos coincidieron.

Busca en todas las fechas, no en el periodo del tablero, porque quien busca un ticket no sabe de qué día es. La barra aparece en «Resumen» para el dueño o con el PIN del dueño; la cajera en su turno no la ve. El canal sigue siendo el de «Ventas», que ya estaba abierto a cualquiera con sesión.

## Consecuencias
- Sin dependencias nuevas. Una migración local nueva (20).
- El ticket, el panel del producto y la bitácora de faltantes cambian de pantalla; las pruebas de Playwright del panel usan «Dar de baja».
- La búsqueda por nombre en el texto del ticket usa `LIKE`, que distingue acentos; el nombre del catálogo no, por FTS.
- Comparar precios entre catálogos de varios proveedores queda como diseño para una tarea aparte; no entra aquí.
