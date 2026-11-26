# ADR 0077: Cotizaciones en la caja

Estado: Aceptada · Fecha: 2026-11-25 · Concreta F2-07 (RF-046). Se apoya en los ADR 0010 (venta guardada antes de cobrar), 0011 (dinero en enteros), 0030 (una venta nunca cambia), 0047 (precio visto al cobrar), 0061 (precio solo en esta venta y diseño del ticket) y 0063 (bitácora de faltantes).

## Contexto
En la tienda se cotiza todos los días: un maestro de obra pide precio de una lista, se lleva el papel y regresa días después. Hoy eso se hace a mano o armando una venta que luego se cancela, lo que ensucia la bitácora y no deja rastro de qué se prometió. El dueño pidió «que exista un panel solo para cotizaciones». La ficha F2-07 pide que una cotización vigente se convierta en venta con sus precios, y la regla de dominio sigue: una cotización nunca mueve inventario ni cuenta como venta.

## Decisiones

**Un panel propio, fuera de la venta.** «Cotizaciones» en el encabezado (Mayús+F12 por defecto, configurable en Ajustes como cualquier tecla) abre un panel con la lista, la búsqueda, el detalle y el editor. Cajera y dueño pueden crear, editar, imprimir, duplicar y convertir. Todo vive en la base local (`node:sqlite`), así que funciona sin internet.

**Tablas aparte, nunca la tabla de ventas.** La migración local 24 crea `quote`, `quote_line`, `quote_status` y `quote_print`. Ningún reporte, corte, tablero ni sincronización lee esas tablas, y no se escribe `stock_movement`, `payment` ni `cash_movement`: por construcción una cotización no puede descuadrar la caja ni el inventario. No hay apartado de mercancía (eso es F2-08).

**Se copian los datos, no se referencian.** Cada línea guarda el nombre, la unidad, el precio unitario e4 y la tasa de IVA del producto en el momento de cotizar, más su importe en centavos. El precio lo pone siempre el proceso principal desde el catálogo; la pantalla solo manda producto y cantidad en milésimas. Así un cambio de precio posterior no cambia lo que se le dijo al cliente.

**Vigencia de 15 días por defecto.** La fecha «Válida hasta» se propone a 15 días (`QUOTE_VALIDITY_DAYS`), se puede cambiar entre hoy y un año, y vale hasta el final de ese día en la zona de la caja. «Vencida» no se escribe: se calcula al leer (`draft` con `valid_until` anterior a hoy), así que el paso del tiempo no genera escrituras ni tareas programadas.

**Estados con historial de solo agregar.** El estado es el último renglón de `quote_status` (`draft`, `converted`, `cancelled`), numerado por `sequence` dentro de la cotización. Disparadores impiden editar o borrar el historial, agregar algo después de vendida o cancelada, y cambiar las líneas o los datos de una cotización cerrada. Una cotización nunca se borra: se cancela con un motivo. Cada paso queda además en la bitácora de auditoría (`quote.created`, `quote.edited`, `quote.printed`, `quote.cancelled`, `quote.converted`).

**Editar solo mientras está abierta.** Una vigente se edita conservando el precio cotizado de los productos que ya tenía; los nuevos entran al precio de hoy. Una vencida que se edita se cotiza otra vez completa con los precios de hoy, porque su promesa ya terminó. Duplicar crea una cotización nueva, con folio nuevo y precios de hoy, y su historial dice «Copia de COT-…».

**Precio al convertir: manda el cotizado mientras esté vigente.** «Convertir en venta» cierra el panel y carga los productos en la venta en curso (si está vacía; si no, avisa que primero se cobre o se cancele). Mientras la cotización está vigente cada línea va al precio cotizado; si el de hoy es distinto, la línea usa el mecanismo existente de «precio solo en esta venta» (ADR 0061), que el cobro ya guarda en la bitácora, y la caja muestra «N precios de hoy son distintos: se respeta el precio cotizado». Una vencida se cobra con los precios de hoy y lo dice. Un producto que ya no se vende se queda fuera y se nombra. Las cantidades y el cobro son los de cualquier venta.

**La venta se liga al cobrarse, no antes.** La cotización pasa a `converted` solo cuando la venta quedó cobrada: al cerrar el cobro la pantalla llama `quotes:mark-converted` con la cotización y el id de la venta, y el proceso principal comprueba que la venta exista y esté `completed`, y que ninguna otra cotización la tenga (`sale_id` es único en `quote_status`). El historial guarda «Venta T1-…». Si la venta se cancela antes de cobrar, la cotización sigue abierta. Se eligió así, y no meter la cotización en la solicitud de la venta pendiente, para no tocar el flujo de cobro que protege contra apagones (ADR 0010); el costo es que un fallo justo entre el cobro y esa llamada deja la cotización abierta, lo que solo obliga a cancelarla a mano.

**Cancelar: el autor o el dueño.** Quien la hizo la cancela con un motivo; el dueño cancela cualquiera; una cajera que cancela la cotización de otra persona escribe el PIN del dueño, con los mismos intentos y bloqueo de siempre.

**Impresión en la impresora de tickets.** La cotización usa el diseño del ticket del dueño (papel, letra, encabezado, desglose de IVA y total grande) pero con el título «COTIZACIÓN», folio `COT-000001`, «Válida hasta el …», cliente y teléfono si los hay, notas, y al pie «Este documento no es una venta ni un comprobante fiscal. Precios sujetos a existencia.». No imprime pagos ni el pie del ticket de venta. Antes de imprimir se muestra una vista previa; cada impresión queda en `quote_print` y desde la segunda dice «REIMPRESIÓN». Para eso `renderTicket` se separó en `renderParts`, que comparten ventas y cotizaciones.

**Búsqueda.** Por folio (`COT-000012`, `cot 12`), cliente, teléfono o producto, sin importar acentos ni mayúsculas, y por estado (vigentes, vencidas, vendidas, canceladas).

## Alternativas descartadas
- **Guardar la cotización como una venta en otro estado:** cada consulta de ventas, corte y reporte tendría que excluirla, y un olvido la contaría como venta.
- **Referenciar el producto y leer el precio al convertir:** el cliente pagaría otro precio del que se le dio en papel.
- **Respetar el precio cotizado aunque haya vencido:** la vigencia dejaría de significar algo; el dueño puede extenderla editándola.
- **Marcar «vencida» con una tarea programada:** escribiría sin que nadie haga nada y no funcionaría con la caja apagada.
- **Ligar la cotización en `sales:save-pending`:** más atómico, pero cambia el contrato del cobro y su recuperación tras un apagón por un caso raro.

## Consecuencias
- Las cotizaciones no aparecen en ventas, cortes, resumen, estado de resultados ni inventario.
- La venta de una cotización con precio distinto deja en la bitácora el mismo rastro que un «precio solo en esta venta».
- La migración local 24 solo agrega tablas y disparadores; no toca datos existentes. No hay cambios en el núcleo ni en los contratos de sincronización: las cotizaciones viven en la caja hasta que F2 las lleve al servidor.
