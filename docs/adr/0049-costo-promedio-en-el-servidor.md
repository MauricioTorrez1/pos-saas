# ADR 0049: Costo promedio ponderado móvil, recalculado en el servidor desde el libro

Estado: Aceptada · Fecha: 2026-11-10 · Concreta E1-28 (RF-033). Se apoya en los ADR 0011, 0031, 0032 y 0046.

## Contexto
El margen de ADR 0032 usa «el último costo que cargó Eleventa». Eso falla en cuanto una compra cambia el costo: la venta de ayer se valoraría con el costo de hoy. Además, las cajas pueden vender sin internet y sincronizar horas después, así que el servidor recibe ventas «viejas» después de compras «nuevas». Había que decidir cómo se valora el inventario, dónde se guarda el resultado y qué pasa con los casos raros (existencia en cero o negativa).

## Opciones
**Método de costeo**
1. **Promedio ponderado móvil.** Un solo número por producto, fácil de explicar y de reproducir. Es lo que asume la ficha y lo que espera la tlapalería.
2. **PEPS (primeras entradas, primeras salidas).** Exige guardar capas de compra y saber de qué capa salió cada venta; con ventas tardías hay que rehacer las capas.
3. **UEPS.** Poco usado y con problemas fiscales; sin ventaja aquí.

**Dónde vive el resultado**
1. **Calcularlo al pedirlo, repitiendo el libro por orden de ocurrencia.** Nunca queda desfasado: una venta tardía o una entrada capturada tarde se acomoda sola en el momento en que ocurrió. Cuesta una lectura del historial del producto.
2. **Guardar una tabla `product_cost` y actualizarla en cada operación.** Es rápido al leer, pero cada venta tardía obliga a recalcular desde el punto de inserción y a mantener la tabla en sincronía en tres módulos; un error la deja mal sin que nadie lo vea.
3. **Calcularlo en la caja.** Con ventas de otras cajas todavía sin sincronizar, cada caja vería un promedio distinto.

**Cómo se recibe una compra**
1. **Tabla propia `stock_receipt` (entrada con costo), con llave de idempotencia y de solo agregar.** El libro existente no tiene costo y los ajustes no lo necesitan.
2. **Ampliar `stock_movement` con un costo opcional.** Mezcla hechos distintos en una tabla que la caja ya llena con un contrato cerrado (ADR 0046).

## Decisión
- **Promedio ponderado móvil, calculado solo en el servidor,** repitiendo el libro de cada producto en orden `(momento en que ocurrió, tipo, id)`. Es una función pura (`AverageCostCalculator`): los mismos hechos dan siempre el mismo resultado, sin importar cuándo llegaron. «Recalcular desde cero» es la única forma de calcular, y por eso no puede haber una diferencia entre lo guardado y lo recalculado. Si el historial crece tanto que pese, el siguiente paso es una foto de `product_cost` con su punto de reanudación; hoy se evita esa complejidad.
- **Qué entra al cálculo (de dónde sale cada hecho):** entradas (`stock_receipt`, `occurred_at`), ventas (`sale_line` en `sale.completed_at`), devoluciones (`sale_return_line` en el `occurred_at` de su operación en `sync_operation`) y ajustes y mermas (`stock_movement`). Cuando E1-25 escriba sus propios movimientos de venta y devolución en el libro, solo cambia la consulta de origen, no el cálculo.
- **Reglas, con `existencia` y `prom` como estaban antes del hecho:**
  - **Entrada** de `q` a costo `c`: `prom = round_half_up((existencia × prom + q × c) / (existencia + q))`.
  - **Venta:** sale al `prom`, que no cambia; se recuerda el costo de esa partida.
  - **Devolución:** regresa al costo de su venta original. Si el promedio no se ha movido desde la venta, el promedio queda igual; si se movió, se mezcla a ese costo (si no, se falsearía el valor del inventario). Si el costo de la venta no se conoce, regresa al `prom` actual.
  - **Ajuste y merma:** se valoran al `prom` vigente, que no cambia.
- **Escala y redondeo (ADR 0011):** el promedio es un entero en millonésimas de peso (`unit_cost_e6`). La división redondea medio hacia arriba, con `BigInteger` en el producto intermedio, porque `existencia × costo` pasa de un `long` con cantidades y costos grandes. El valor del inventario es `round_half_up(existencia_milli × prom_e6 / 10,000,000)` en centavos, por producto, y el total es la suma de los productos ya redondeados (la misma regla de «redondeo por línea» del ADR 0011).
- **Existencia en cero o negativa** (se vendió sin haber recibido, algo que el sistema permite a propósito, RF-029):
  - El valor de existencia `<= 0` es cero: una falta no es un activo.
  - Al pasar a cero el promedio se conserva, para valorar la siguiente venta.
  - Mientras siga `<= 0` tras una entrada, el promedio se conserva: no hay existencia con la que mezclar.
  - Cuando una entrada la deja positiva, el promedio es el costo de lo que entró, porque las unidades que faltaban ya se vendieron.
  - Si nunca hubo un costo, el promedio es desconocido (`null`), el valor es cero y el producto se cuenta en `productsWithoutCost`. La primera entrada con costo lo fija.
- **Entrada de compras.** `stock_receipt` (migración V9): `tenant_id`, `op_id` único por negocio (idempotencia), producto, origen (`purchase` u `opening_balance`), cantidad `>= 1`, costo `>= 0` en `e6`, `occurred_at` y quién la capturó. Tiene RLS forzada con política de `current_tenant_id()` y es de solo agregar (disparador y sin privilegios de `UPDATE` ni `DELETE`): una entrada equivocada se corrige con otra entrada o con un ajuste, nunca se edita. `InventoryValuation.recordReceipt` la escribe junto con una entrada de `audit_log` (`stock.received`) en la misma transacción y es idempotente.
- **API interna** (`InventoryValuation`, en la raíz del módulo `inventory`): `recordReceipt`, `costOf(productId)` y `inventoryValue()`. Todo corre para el negocio de la transacción (ADR 0035), así que no hay forma de preguntar por el costo de otro negocio. No hay endpoint HTTP todavía: el permiso que lo protegería se decide con el reporte que lo consuma.

## Consecuencias
- El margen de ADR 0032 puede cambiar a este costo cuando se quiera; este ADR no toca la caja ni su reporte.
- `costOf` lee todo el historial del producto, e `inventoryValue()` el de todo el negocio. Para una tlapalería (miles de movimientos) es corto. Una tabla `product_cost` con foto es la salida cuando deje de serlo.
- Una devolución se ubica con la hora de su operación en `sync_operation`, porque `sale_return` no guarda su momento. Si una devolución trae una hora anterior a su venta (reloj mal puesto), regresa al promedio vigente.
- Dos eventos del mismo instante se ordenan por tipo (entrada, venta, devolución, ajuste) y luego por id UUIDv7: el orden es fijo y reproducible.
- Todavía no hay pantalla ni flujo para capturar compras ni para el saldo inicial de Eleventa (E1-29, F2): `recordReceipt` es lo que usarán. Las compras con IVA acreditable y costos de flete no se prorratean.
- Se verificó con PostgreSQL real y pruebas de la función pura. No se probó con millones de movimientos ni con dos procesos del núcleo que capturen entradas a la vez (el `UNIQUE` lo protege, pero no hay prueba de carga).
