# ADR 0072: Estado de resultados, registro de gastos de operación y «Resumen» por grupos

Estado: Aceptada · Fecha: 2026-11-18 · Concreta E1-56. Se apoya en los ADR 0029 (caja), 0047 (PIN del dueño), 0060 (resumen del negocio) y 0067 (búsqueda de ventas).

## Contexto
El «Resumen del negocio» ya calcula ventas con y sin IVA, devoluciones, costo de lo vendido por costo promedio, utilidad bruta y margen. Mauricio pidió:
1. Ordenar «Resumen» en grupos con nombre, para que los números que se leen juntos estén juntos.
2. Un **estado de resultados** que lea alguien que no es contador, con vista general y detallada, por periodo y «Desde el inicio».
3. Un registro de **gastos de operación**, porque la caja no tenía dónde anotar la renta, la luz o los sueldos. Los retiros de la caja (`cash_movement`) dicen «salió dinero», pero no si fue un gasto, un depósito al banco o un pago a un proveedor.

## Decisiones

**Gastos en su propia tabla.** La migración local 21 crea `expense`:
- concepto (texto), monto en centavos (entero mayor que cero), día local `YYYY-MM-DD`, nota opcional;
- `paid_from_drawer` y, si se pagó de la caja, `cash_movement_id`;
- quién lo anotó y quién lo autorizó;
- `voided_at`, `voided_by` y `void_reason` para anularlo.

Un gasto nunca se borra ni cambia: solo se **anula** con un motivo. Así la auditoría conserva lo que se escribió por error, igual que una venta se cancela y no se borra. Los disparadores impiden cambiar los hechos del gasto, anularlo dos veces y borrarlo.

**Conceptos en una lista corta y editable.** La lista vive en `register_setting` (`expense_concepts`, JSON). Si el dueño no la ha tocado, es: Renta, Luz, Agua, Sueldos, Internet y teléfono, Mantenimiento, Comisiones del banco, Otros. El gasto guarda el texto del concepto, no un id: si el dueño renombra «Luz» a «CFE», los gastos viejos siguen diciendo «Luz», que es lo que se anotó.

Opciones que se consideraron para los conceptos:
- **Tabla `expense_concept` con id.** Permite renombrar en cascada, pero necesita sembrar filas por negocio y una pantalla de catálogo. Es más de lo que una lista de ocho palabras pide.
- **Texto libre sin lista.** Rápido, pero «luz», «Luz CFE» y «recibo de luz» saldrían como tres renglones en el detalle.
- **Lista en `register_setting` y texto en el gasto (elegida).** Sencilla, y el detalle agrupa por el texto exacto.

**Solo el dueño.** Anotar, anular, ver gastos y cambiar la lista lo hace el dueño con su sesión, o una cajera con el PIN del dueño (ADR 0047). Cada alta, anulación y cambio de lista queda en `audit_log` (`expense.recorded`, `expense.voided`, `expense.concepts_changed`), y cada PIN rechazado también (`expense.denied`).

**Pagado de la caja sin contarlo dos veces.** Un gasto pagado de la caja escribe, en **la misma transacción**, un `cash_movement` de salida con el motivo «Gasto: <concepto>» y lo liga en `cash_movement_id`. Entonces:
- el **corte de caja** lo resta una vez, porque solo suma `cash_movement`;
- el **estado de resultados** lo cuenta una vez, porque solo suma `expense`;
- los retiros que no son gasto (llevar dinero al banco) siguen en `cash_movement` y **nunca** entran al estado de resultados.

Un gasto pagado de la caja necesita una caja abierta y su día es hoy, porque el efectivo sale en ese momento. Uno pagado por otro medio (transferencia, tarjeta del dueño) puede llevar cualquier día que no sea futuro.

Si se anula un gasto pagado de la caja **mientras la sesión sigue abierta**, se escribe una entrada a la caja por el mismo monto («Anulación de gasto: <concepto>»), para que el corte vuelva a cuadrar. Si la sesión ya cerró, el efectivo no se toca: el corte ya se hizo con ese dinero fuera, y la pantalla lo avisa.

Los gastos no viajan al núcleo todavía: no hay contrato de evento para ellos. El `cash_movement` que crean sí viaja, como cualquier retiro. Subirlos al núcleo queda para cuando el núcleo tenga estado de resultados.

**Qué es el estado de resultados.** Es **antes de impuestos sobre la renta** (ISR) y se calcula todo sin IVA:

| Renglón | Cómo se calcula |
|---|---|
| Ventas netas | Ventas sin IVA − devoluciones sin IVA − descuentos |
| Costo de lo vendido | Unidades netas × costo (capturado o promedio ponderado, ADR 0060) |
| Utilidad bruta | Ventas netas − costo de lo vendido |
| Gastos de operación | Suma de los gastos no anulados cuyo día cae en el periodo |
| Utilidad de operación | Utilidad bruta − gastos de operación |
| Utilidad neta (antes de ISR) | Igual a la de operación: la caja no tiene otros ingresos ni gastos financieros |

Cada renglón lleva su porcentaje de las ventas netas en puntos base, redondeado a la mitad hacia arriba. Si no hay ventas netas, el porcentaje es «sin datos» en lugar de dividir entre cero.

**El IVA no es ingreso.** El IVA que se cobra se le debe al SAT: el estado de resultados lo muestra aparte, como dato («IVA cobrado, no es tuyo»), y nunca lo suma a las ventas. Los gastos se anotan por lo que se pagó. Si el negocio acredita el IVA de sus gastos, el dueño debe escribirlos sin IVA; la pantalla lo dice junto al monto.

**Comisiones de la tarjeta.** La caja solo guarda el resultado del cobro (ADR de pagos): no sabe cuánto cobra el banco por cada venta. Las comisiones se anotan como gasto con el concepto «Comisiones del banco» cuando llega el estado de cuenta. Calcularlas por venta con una tasa configurada se descartó: la tasa cambia por tipo de tarjeta y promoción, y un número inventado haría ver una utilidad que no es.

**Costos que faltan se marcan, no se adivinan.** Las ventas de productos sin costo (y las de «Varios») **sí** cuentan en las ventas netas, porque sí entraron, pero su costo no está. El estado lo dice con el número de productos y cuánto vendieron, y avisa que la utilidad sale más alta de lo real hasta que se capturen. En el resumen (ADR 0060) la utilidad bruta se calcula solo con los productos con costo; en el estado de resultados se calcula con todas las ventas, porque es lo que se compara con los gastos. Por eso pueden diferir, y el aviso lo explica.

**Vista general y detallada.**
- *General*: los seis renglones, cada uno con una frase corta debajo que dice qué es.
- *Detallado*: ventas por tasa de IVA (16 %, 8 %, 0 % y exentos), devoluciones y descuentos (la caja todavía no maneja descuentos, así que es cero con su aviso), costo de los diez productos que más costaron más «Otros productos», y cada gasto agrupado por concepto.

No hay costo por categoría porque los productos no tienen categoría todavía.

**Periodos.** Los mismos del resumen (día, semana, mes, año, rango) y «Desde el inicio», que va del primer día con una venta, devolución o gasto hasta hoy. Se elige en la pestaña.

**Exportar.** El Excel del resumen lleva una hoja «Estado de resultados» y el PDF una sección con él, para el mismo periodo, cuando quien exporta ve el negocio completo. Desde la pestaña, F3 y F4 exportan solo el estado de resultados del periodo elegido, incluido «Desde el inicio».

**«Resumen» por grupos.** Los indicadores se agrupan en secciones con encabezado: Ventas, Clientes y tickets, Rentabilidad, Devoluciones y cancelaciones, Formas de pago, Caja (entradas, salidas, gastos pagados de la caja y ventas por cajero) y Cuándo se vende (las gráficas). La comparación con el periodo anterior y la barra de búsqueda (ADR 0067) se quedan.

## Consecuencias
- El dueño ve por primera vez si el negocio gana después de la renta y los sueldos, sin saber contabilidad.
- Un retiro hecho antes de esta versión con el motivo «pago de luz» no cuenta como gasto: hay que anotarlo en «Gastos» con un día del periodo y **sin** marcar «de la caja», para no restarlo dos veces del corte.
- La utilidad del estado de resultados es tan buena como los costos capturados: el aviso de productos sin costo es parte del renglón, no una nota al pie.
- Con E1-54 y otras tareas tocando la caja al mismo tiempo, el número de la migración local se ajusta al siguiente libre al fusionar.
