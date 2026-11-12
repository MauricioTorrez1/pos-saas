# ADR 0058: Panel de modificación de productos en la caja

Estado: Aceptada · Fecha: 2026-11-11 · Concreta E1-43 (requisito nuevo del dueño: «un panel para modificar un producto ya dado de alta»). Cumple RF-008 y RF-040 y aplica los ADR 0003, 0011, 0023, 0031, 0032, 0040, 0047, 0051 y 0057.

## Contexto
Con E1-42 el dueño puede dar de alta un producto en la caja, y con E1-39 cambiar su precio. Falta corregir todo lo demás: un nombre mal escrito, un código que se agrega o se quita, el IVA, el costo, dar de baja un producto que ya no se vende, y revisar su existencia con sus últimos movimientos. El panel junta esas cosas en una sola pantalla, sin duplicar lo que ya existe (el cambio de precio y los ajustes de inventario) y sin tocar la historia: las ventas cerradas, los tickets y el libro de movimientos no se editan.

## Opciones
**Qué hace «borrar» un producto**
1. **Borrarlo de la tabla.** Rompe el historial: las líneas de venta, el libro y la bitácora apuntan a él.
2. **Borrado lógico (`is_active`).** El producto se oculta de la venta y se conserva. Se puede activar de nuevo.

**Cómo se evita que dos cambios se pisen**
1. **El último que guarda gana.** Es lo más simple y lo que borra, sin aviso, un cambio que alguien más hizo.
2. **Control de concurrencia optimista con un número de revisión.** La pantalla manda la revisión que vio; si el producto cambió mientras se editaba, no se escribe nada y se avisa. Es lo que ya hace E1-39 con el precio, ahora para todo el producto.
3. **Bloquear el producto mientras alguien lo edita.** Una pantalla abandonada lo deja bloqueado, y la caja no puede depender de eso.

**La unidad de medida**
1. **Siempre editable.** Cambiar de pieza a metro con 40 movimientos en el libro cambia el significado de cada uno.
2. **Editable solo mientras el producto no tenga movimientos.** Un producto recién creado sin existencia puede corregirse; uno con historial, no.
3. **Nunca editable.** Obliga a crear otro producto por un error de dedo al dar de alta.

**El precio y el inventario**
1. **Repetir sus reglas en el panel.** Dos copias de las reglas de dinero y de existencia, que tarde o temprano se separan.
2. **Llamar a los mismos servicios** (`PriceChangeService` de E1-39 y `InventoryService.adjust` de E1-26/E1-27).

## Decisión
- Opción 2 en las cuatro preguntas.
- **Quién:** igual que en E1-39 y E1-42, con `OwnerGate`. El dueño con sesión edita. Un cajero **ve** todo (la búsqueda, la existencia, el costo, el margen y los movimientos) y, para guardar un cambio, escribe el PIN de un dueño. Un intento negado deja `product.update_denied` (o `stock.adjust_denied` en el inventario) con el motivo. RF-008 se respeta: un cajero no cambia precios por su cuenta, y la bitácora dice quién lo pidió y quién aprobó.
- **Qué se edita en el panel** y qué reglas tiene cada campo (en la pantalla y otra vez en `ProductService.update`):
  - **Nombre**, **IVA** y **costo opcional**: las mismas reglas que al dar de alta (ADR 0057).
  - **Códigos de barras**: se agregan o se quitan de la lista, con la regla de unicidad por negocio. Un código que otro producto ya usa (activo o dado de baja) se rechaza diciendo cuál. Quitar un código lo libera; nunca se reasigna uno que usa otro producto.
  - **Unidad:** solo se cambia si el producto **no tiene ningún movimiento** en el libro (`movementCount = 0`). Con movimientos, el panel muestra la unidad bloqueada con el motivo, y el proceso principal responde `unit_locked`. Así una cantidad guardada nunca cambia de significado.
  - **Estado:** activar o dar de baja. Dar de baja es `is_active = 0`: el producto desaparece de la búsqueda, de los códigos que lee la venta y de las ventas nuevas, pero se queda en el catálogo, el libro, las ventas cerradas y la bitácora. Nunca se hace `DELETE`. Si un producto que se está vendiendo se da de baja, la venta que lo trae responde `catalog_changed`, como con un precio que cambió.
  - **Precio:** el botón «Cambiar precio» (F8) abre el mismo `PriceChangeDialog` de E1-39 y llama a `PriceChangeService.change`: mismas reglas, mismo PIN, mismo `product.price_changed`. El panel no escribe precios. Un producto dado de baja no cambia de precio hasta activarlo.
  - **Inventario:** el botón «Ajustar existencia» (F9) llama a `InventoryService.adjust` (merma, sobrante o faltante, con motivo). Ahora acepta el PIN de un dueño, para que un cajero pueda pedirlo. **La existencia no se escribe nunca**: se calcula del libro y se muestra, junto con el último costo, el margen y los últimos movimientos.
- **Una sola transacción por cambio** (`ProductService.update`): `UPDATE product` guardado por la revisión, los códigos que se agregan y se quitan, la entrada de bitácora `product.update` con el valor anterior y el nuevo de cada campo, y la operación `product.updated` en `sync_outbox`. Si cualquiera falla, no queda nada. Un cambio que no cambia nada responde `unchanged` y no escribe nada.
- **Concurrencia:** `product.revision` sube en 1 con cada cambio, con un disparador de la migración 15 (ADR 0057), así que no lo puede olvidar ningún camino: ni el panel, ni el cambio de precio, ni el que baja del núcleo. La pantalla manda la `expectedRevision` que cargó. Si ya no es la del producto, la respuesta es `stale` con el producto como está ahora, no se escribe nada, y el panel avisa y carga lo más reciente para que la persona revise y vuelva a intentar. No se pisa un cambio sin que nadie se entere.
- **Pantalla:** **F10** en la venta abre «Producto» sobre el producto señalado (el resultado resaltado o la línea seleccionada) o, sin ninguno, pide buscar uno. En la vista de un producto del inventario hay un botón y F9. La búsqueda también encuentra los productos dados de baja y los marca. **F2** guarda, **Esc** cierra, y cada diálogo hijo (precio, ajuste) tiene su propio F2 y Esc. Reutiliza los campos del formulario de E1-42 (`ProductFields`), así que pregunta las mismas cosas con las mismas palabras, y el sistema de apariencia del dueño (RNF-13) sin estilos propios.
- **Ventas cerradas y tickets:** no cambian. El panel nunca toca `sale`, `sale_line`, `payment` ni un movimiento del libro; las líneas guardan su propio nombre y precio.
- **Contrato** (`packages/contracts`, aditivo, versión 1): el tipo `product.updated` se agrega a `sync-push-request.schema.json` con el payload `{ changeId, productId, changes, changedBy, authorizedBy }`. `changes` tiene al menos uno de estos campos, cada uno con su valor anterior y su nuevo: `name`, `unit`, `tax` (`{ taxFactor, taxRateBp }`), `unitCostE6` (o `null`) e `isActive`, además de las listas `barcodesAdded` y `barcodesRemoved`. **El precio no viaja aquí:** un cambio de precio sigue usando `product.price_changed`. Hay tres casos válidos y diez rechazos en `cases/sync-push.json`.
- **Reglas para el servidor** (las implementa una tarea del núcleo; esta tarea no lo toca): aplicar los cambios al producto del negocio y guardar `changeId` una sola vez; si el valor anterior no es el que el núcleo tiene, aceptar el cambio igual (la caja es la fuente de verdad de lo que cobra y de lo que vende) y anotar la discrepancia para E1-19; un código agregado que ya es de otro producto va a cuarentena con el motivo; `isActive: false` oculta el producto sin borrarlo; el orden lo da `deviceSeq`, nunca el reloj. Mientras el núcleo no conozca `product.updated`, `POST /sync/push` lo deja en cuarentena como un tipo que no conoce (ADR 0040) y no se pierde. Ojo: el estado que baja con `GET /sync/pull` todavía no lleva el estado activo, así que la caja conserva el suyo y un pull no vuelve a activar un producto dado de baja.

## Consecuencias
- Un error de dedo en el nombre, el IVA o el código ya no obliga a reimportar ni a crear otro producto. Un producto con historial conserva su unidad: un error ahí se corrige dándolo de baja y creando otro.
- Un producto dado de baja ocupa sus códigos para siempre (hasta que alguien los quite del producto), así que un lector nunca apunta a un producto distinto del que mencionan las ventas viejas.
- Un cajero con el PIN del dueño puede editar un producto, y cada intento queda en la bitácora. Sin rol de gerente, la aprobación es la del dueño.
- Dos pantallas que editan el mismo producto se avisan: la segunda que guarda ve «cambió mientras lo editabas» y no pierde ni pisa nada. Es un aviso, no una mezcla automática: la persona decide.
- El panel de la web (F0-21) tendrá su propia edición con RF-008 (el cajero recibe 403); esta tarea es solo la de la caja.
- No hay deshacer: corregir es otro cambio, y los dos quedan en la bitácora.
