# ADR 0047: Editar el precio de un producto en la caja

Estado: Aceptada · Fecha: 2026-11-09 · Concreta E1-39 (requisito nuevo del dueño: «en la caja debe ser posible modificar el precio de un producto una vez ingresado»). Cumple RF-040 y aplica los ADR 0010, 0011, 0023, 0029, 0032, 0033 y 0040.

## Contexto
Hasta ahora el precio de un producto solo entraba con la importación de Eleventa (E1-29), y el proceso principal pone los precios de la venta con el catálogo, nunca la pantalla (ADR 0033). El dueño necesita corregir un precio en la caja misma, sin reimportar. Cambiar un precio es una acción sensible (RF-040 pide quién, cuándo, valor anterior y valor nuevo, sin posibilidad de editarlo) y toca tres reglas que no se rompen: el dinero va en enteros con las escalas del ADR 0011, toda operación que viaja por red lleva UUIDv7 e idempotencia (ADR 0040), y la caja vende sin internet.

## Opciones
**Quién puede cambiar un precio**
1. **Cualquier cajero.** Rápido, pero es la puerta para cobrar de menos sin que nadie lo sepa.
2. **Solo el dueño, con su sesión; un cajero necesita el PIN de un dueño.** Es lo mismo que ya se pide para sacar efectivo (ADR 0029), aprobar una devolución (ADR 0030) y vender un artículo varios (ADR 0033).
3. **Un permiso por persona.** Más flexible, pero no existe todavía; los roles son `owner` y `cashier`, y no hay rol de gerente.

**Qué pasa con la venta que se está armando cuando cambia el precio**
1. **Se recalcula con el precio nuevo.** El cajero ve cambiar el total debajo de las manos del cliente.
2. **La venta en curso conserva el precio de sus líneas ya agregadas** y la siguiente venta usa el nuevo. Es lo que ocurre en papel: el cliente ya vio el precio que le dijeron.

**Cómo llega el cambio al núcleo**
1. **El servidor lo deduce al ver una venta con otro precio.** No: un cambio sin ventas no se vería, y no hay quién lo aprobó.
2. **Una operación propia en el outbox, escrita en la misma transacción que el cambio** (ADR 0040), que lleva el precio anterior y el nuevo.

## Decisión
- Opción 2 en las tres preguntas.
- **Quién:** el dueño con sesión abierta cambia el precio sin más. Un cajero escribe el PIN de un dueño (el mismo conteo de intentos y bloqueo de siempre). No existe rol de gerente en la caja: si se agrega uno, se suma a la regla en un solo lugar, `PriceChangeService`.
- **Qué se valida** (en la pantalla y otra vez en el proceso principal): el precio es el texto de pesos con IVA incluido y hasta 4 decimales que lee `parseUnitPriceE4` (ADR 0011), sin signo ni comas; **cero no se permite** (un producto gratis casi siempre es un error de dedo, y el regalo se resuelve con un artículo varios o una promoción); el máximo es $1,000,000.00 (`MAX_UNIT_PRICE_E4`), muy por encima de cualquier producto de tlapalería, para atrapar un cero de más. El mismo precio que ya tiene el producto no escribe nada.
- **Pantalla:** F7 en la venta abre «Cambiar precio» sobre el producto señalado (el resultado resaltado de la búsqueda o la línea seleccionada) o, si no hay ninguno, pide buscar uno. En la vista de un producto del inventario hay un botón y F8. El diálogo muestra el precio actual y el margen, y al teclear el nuevo, «Antes → ahora» y el margen nuevo, con aviso si queda por debajo del costo. F2 guarda y Esc cancela, como en los demás diálogos. El margen usa el último costo conocido del libro de inventario, igual que el reporte del día; sin costo dice que no se puede calcular. Sale en base sin IVA, con aritmética entera (`marginBasisPoints`).
- **Una sola transacción** (`PriceChangeService.change`): `UPDATE product` solo si el precio sigue siendo el que vio la pantalla (si no, `stale` y no se pisa un cambio hecho mientras tanto), una fila en `product_price_change` (migración 13, solo se agrega), la entrada de bitácora `product.price_change` con quién, cuándo, antes y después, y la operación `product.price_changed` en `sync_outbox`. Si cualquiera falla, no queda nada. La caja sigue vendiendo en efectivo sin internet porque nada de esto la necesita.
- **Intentos negados:** un cajero sin PIN, con PIN incorrecto o bloqueado deja una entrada `product.price_change_denied` bajo su nombre, con el motivo y los precios que intentó. Un intento fallido también cuenta, no solo el exitoso.
- **Ventas cerradas y tickets:** no cambian. `sale_line` guarda su propio precio, así que no se toca ninguna fila de venta. El reimpreso y las devoluciones usan el precio de la línea.
- **La venta en curso conserva sus precios.** La pantalla manda `unitPriceE4` en las líneas del catálogo solo como segundo intento: la primera vez la venta se ofrece con los precios del catálogo, como siempre, y solo si el catálogo dice `catalog_changed` se repite una vez con el precio que mostraba cada línea. El proceso principal acepta ese precio únicamente si es el actual o el que el dueño acaba de reemplazar (el anterior del último cambio del producto); cualquier otro precio no es uno que el dueño haya aprobado y la venta no se guarda. Así la regla «los precios los pone el proceso principal» sigue en pie: la pantalla no puede inventar un precio. Si el dueño cambió el mismo producto dos veces durante la misma venta, el segundo intento se rechaza y el cajero vuelve a agregar el producto. La búsqueda se limpia al cambiar el precio, para que la siguiente muestre el nuevo, y un producto que ya está en la venta mantiene su precio aunque se agregue otra pieza.
- **Contrato** (`packages/contracts`, aditivo, versión 1): el tipo `product.price_changed` se agrega a `sync-push-request.schema.json` con el payload `{ changeId, productId, previousUnitPriceE4, newUnitPriceE4, changedBy, authorizedBy }`, todos UUIDv7 y enteros en la escala de precios. `newUnitPriceE4` es de 1 a 10,000,000,000. `changedBy` es quien tecleó y `authorizedBy` el dueño que lo aprobó (el mismo si fue el dueño). Hay dos casos válidos y tres rechazos en `cases/sync-push.json`. Se nombra con punto, como `stock.adjusted` y `sale.completed`, para mantener una sola convención en el contrato aunque el evento de dominio se llame `ProductPriceChanged`.
- **Reglas para el servidor** (las implementa E1-17 y la parte de catálogo F0-17 y F0-19; esta tarea no toca el núcleo): aplicar el cambio al catálogo del `tenant`; no tocar ventas ni líneas ya recibidas; guardar `changeId` una sola vez; si `previousUnitPriceE4` no es el precio que el núcleo tiene, aceptar el cambio igual (la caja es la fuente de verdad del precio que cobra) y anotar la discrepancia (E1-19); el orden lo da `deviceSeq`, nunca el reloj; publicar `ProductPriceChanged` a `sync` y `reporting`.

## Consecuencias
- Una venta que abarca el cambio puede tener un producto al precio viejo y otro al nuevo. Es lo correcto y queda así en la venta, el ticket y la operación `sale.completed`.
- Un cajero con el PIN del dueño puede cambiar precios; cada intento queda en la bitácora. Sin rol de gerente, la «aprobación de gerente» es la del dueño.
- Si el núcleo está caído, el cambio queda en el outbox y viaja después, en orden. La caja que lo hizo ya cobra el precio nuevo; otra caja lo verá cuando E1-18 baje los cambios.
- El panel (F0-21) tendrá su propia edición de precios con RF-008 (el cajero recibe 403); esta tarea es solo la de la caja.
- No hay deshacer: corregir un error es otro cambio de precio, y los dos quedan en la bitácora.
- Los precios por lista (mayoreo) siguen fuera, hasta tener clientes (ADR 0033).
