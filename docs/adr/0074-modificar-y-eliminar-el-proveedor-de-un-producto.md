# ADR 0074: Modificar y eliminar el proveedor de un producto desde su panel

Estado: Aceptada · Fecha: 2026-11-18 · Concreta E1-58. Se apoya en los ADR 0011 (dinero en enteros), 0047 (`OwnerGate`), 0059 (proveedores y códigos de proveedor) y 0067 (proveedores en el producto y «Pedir más»).

## Contexto
Desde E1-50 el panel del producto lista a todos sus proveedores con su código y su costo de lista, tiene un «Pedir más» verde por proveedor y un formulario corto para ligar uno más. Lo que no tenía era corregir: si el dueño ligó el producto al proveedor equivocado, o el proveedor cambió el código o el precio, había que ir a Pedido → Proveedores → Códigos. Y no había forma de quitar un proveedor del producto desde el panel.

## Decisiones

**Dos botones junto a «Pedir más».** Cada renglón tiene un **«Modificar» amarillo** y un **«Eliminar» rojo**. El amarillo es un estilo nuevo, `button-warning`: texto casi negro sobre amarillo `#facc15`, que se lee igual en tema claro y oscuro (con la regla de siempre: verde agrega, amarillo cambia, rojo quita).

**Modificar es un formulario en el mismo renglón.** El renglón se vuelve un formulario con el proveedor (el actual y los activos que todavía no venden el producto), y por cada código su código y su costo de lista. La presentación no se edita aquí: se conserva y se cambia en la pantalla de códigos del proveedor. Mientras se edita, el formulario de «Agregar proveedor» y los demás botones se esconden o se apagan, para que no haya dos formularios a la vez.

**Cambiar de proveedor es una sola operación.** `SupplierService.changeLink` borra los códigos del proveedor anterior e inserta los del nuevo en **una transacción**, con su entrada `supplier_codes.change` en la bitácora (antes y después, con códigos y costos en millonésimas) y dos operaciones `supplier_product.upserted` para el núcleo: el anterior sin códigos y el nuevo con los suyos. Así el producto nunca queda con los dos proveedores ni con ninguno. Si el proveedor no cambia, es igual que `setCodes` y responde `unchanged` cuando nada difiere. Se rechaza: un proveedor que ya vende el producto (`already_linked`, para no mezclar dos renglones), uno dado de baja o desconocido, una lista vacía (eso es eliminar) y un renglón que otra pantalla ya cambió (`not_linked`).

**Eliminar pregunta primero y nunca toca lo enviado.** «Eliminar» abre `ConfirmDialog` en rojo. Antes de abrirlo, la pantalla pregunta al proceso principal en qué **borradores** de ese proveedor está el producto (`draftsWithProduct`) y, si hay, lo dice: «Está en el borrador PED-0007 de …. Se queda ahí a menos que marques la casilla». La casilla «Quitarlo también del borrador» viene **apagada**: lo seguro es conservar. Los pedidos **enviados** nunca cambian (ya lo garantizan los disparadores de la migración 18) y cada renglón conserva la copia del código y el costo que tomó al escribirse. Si el dueño marca la casilla, en la misma transacción se quitan esas líneas, las restantes se numeran de nuevo desde 1 y el borrador sube una revisión, para que una pantalla de Pedido abierta vea que cambió. La bitácora escribe `supplier_codes.remove` con los códigos, y si el producto se quedó en los borradores o se quitó de ellos.

**Mismas reglas de permiso.** Las dos operaciones pasan por `OwnerGate`: el dueño directo, una cajera con el PIN del dueño escrito en el panel. Cada rechazo queda en la bitácora (`supplier_codes.change_denied`, `supplier_codes.remove_denied`). Consultar los borradores es solo lectura y no pide PIN.

## Alternativas descartadas
- **Cambiar de proveedor como «eliminar y luego agregar» desde la pantalla:** dos llamadas, dos aprobaciones y un momento en que el producto no tiene proveedor; si la segunda falla, se pierde el código.
- **Quitar siempre el producto de los borradores:** el dueño pudo haber hecho el pedido a propósito; borrar sin avisar rompe lo que ya armó.
- **No ofrecer quitarlo de los borradores:** obliga a ir a Pedido a buscar la línea; la casilla lo resuelve en el mismo paso sin ser la opción por defecto.
- **Dejar huecos en la numeración del borrador:** el PDF y el Excel del pedido muestran el número de línea; numerar de nuevo cuesta una consulta y deja el borrador como si se hubiera guardado desde Pedido.

## Consecuencias
- El dueño corrige un proveedor, un código o un precio de lista sin salir del producto.
- El núcleo recibe el cambio como dos `supplier_product.upserted`, el mismo contrato de siempre: no hizo falta versión nueva.
- Las listas de precios de E1-51 no cambian: ligan por código, y el siguiente import vuelve a ligar con el código nuevo.
