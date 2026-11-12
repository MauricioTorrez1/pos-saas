# ADR 0059: Pedido al proveedor en la caja, con archivo de Excel y PDF, sin mover inventario

Estado: Aceptada · Fecha: 2026-11-11 · Concreta E1-44 (requisito nuevo del dueño: «armar un pedido a un proveedor y sacar un archivo para mandarlo»). Es la versión mínima útil de la caja de F2-11, F2-12, F2-13 y F2-15, y aplica los ADR 0003, 0011, 0031, 0032, 0040, 0047, 0057 y 0058.

## Contexto
Hoy el dueño arma sus pedidos a mano: mira qué se acabó, busca en el catálogo del proveedor el código de cada cosa y se lo escribe por correo o por WhatsApp. La caja ya sabe qué hay y qué cuesta, pero no puede ordenar nada. El dueño pidió poder armar el pedido en la caja y sacar un archivo listo para mandar, sin internet y sin que eso toque el inventario.

La Fase 2 ya planea proveedores (F2-11), órdenes de compra sugeridas (F2-12), recepción de mercancía (F2-13) y comparativo de proveedores (F2-15), pero en el servidor y para después. Esta tarea no las adelanta: pone en la caja lo mínimo que el dueño usa hoy, con una forma que esas tareas puedan recibir sin rehacerla.

## Opciones
**Qué es un pedido en el sistema**
1. **Un documento de la caja** (cabecera y renglones, con un estado), que no mueve existencia.
2. **Un movimiento «por llegar» en el libro de inventario.** Haría que la existencia dijera lo que todavía no llegó, y rompería la regla de que el libro solo cuenta lo que pasó (ADR 0031).

**Cómo se guarda lo que el pedido dice**
1. **Apuntar al producto y leer su nombre y su código al abrirlo.** Si el producto cambia de nombre, un pedido enviado hace un año cambia con él.
2. **Copiar en el renglón el nombre, el código de barras y el código del proveedor** al guardar, como hace una línea de venta (ADR 0003). El pedido enviado se lee igual para siempre.

**Cuándo deja de poder cambiarse**
1. **Nunca se cierra**, y el dueño lo edita cuando quiera. Un pedido que ya se mandó y se cambió después no coincide con lo que recibió el proveedor.
2. **Borrador editable y, al marcarlo como enviado, solo se agrega.** Una vez enviado, ni el pedido ni sus renglones cambian (disparadores como los de la bitácora). Para pedir otra cosa se hace otro pedido.

**El código del proveedor**
1. **Una columna del producto.** No sirve: un producto lo venden varios proveedores, cada uno con su código, y a veces varios códigos (una caja y una pieza).
2. **Una tabla de «códigos del proveedor por producto»**, con costo de lista y presentación opcionales, aparte del código de barras propio.

**El archivo**
1. **Excel con una librería mantenida y PDF con una librería de PDF.** Más dependencias, y una librería de PDF es la parte más pesada de instalar y de revisar.
2. **Excel con `exceljs`, y PDF con la impresión a PDF de Electron** (`webContents.printToPDF`) sobre una página HTML que la propia caja arma. El PDF no agrega ninguna dependencia, y la página se puede probar como texto.

**Cuánto sugerir**
1. **Pedir solo lo que el dueño escribe.** Sin ayuda cuando son cien productos.
2. **Sugerir a partir de mínimos, sin forzar:** una lista aparte de lo que está bajo, que el dueño agrega o no, con la cantidad que puede cambiar.

## Decisión
- Opción 2 en las cinco preguntas, y la opción 1 de la primera (el pedido es un documento).
- **Proveedores mínimos** (`supplier`): nombre (único sin importar mayúsculas), contacto y notas opcionales, y estado. Se dan de baja, nunca se borran, porque los pedidos enviados apuntan a ellos. Cada cambio sube un número de revisión que la pantalla manda (control optimista, como en ADR 0058).
- **Códigos del proveedor** (`supplier_product_code`): por proveedor y producto, uno o varios códigos o SKU, cada uno con **costo de lista** (en millonésimos de peso, ADR 0011) y **presentación** («Caja con 12») opcionales. Un mismo código de un proveedor puede apuntar a varios productos (un código por paquete), y el mismo código puede existir en dos proveedores. Se guardan como una lista completa por proveedor y producto, y una lista vacía quita todos. Los códigos no sustituyen al código de barras propio: ese sigue en `product_barcode`.
- **Mínimos** (`product_reorder_level`): un mínimo mayor que cero y un máximo opcional mayor que el mínimo, en milésimos de la unidad (las piezas, enteras). Existencia ≤ mínimo cuenta como baja. La sugerencia pide lo que falta para llegar al máximo o, sin máximo, al doble del mínimo (máximo − existencia). Una existencia negativa (ADR 0003) pide de más a propósito. Los mínimos solo se capturan desde el renglón del pedido («Mínimo»); la configuración completa de mínimos y máximos es de F2-16.
- **Pedido** (`purchase_order`, `purchase_order_line`): folio entero por negocio, que empieza en 1 y no se reutiliza (`PED-0001`); proveedor con su nombre copiado; estado `draft` o `sent`; renglones con descripción, código de barras, código del proveedor, unidad, cantidad (milésimos, mayor que cero, hasta 100,000 unidades), costo estimado (millonésimos, o sin costo) e importe en centavos. El importe es `costo × cantidad / 10⁷` redondeado a la mitad hacia arriba con enteros (`BigInt`), como cada línea de venta; el total es la suma de los importes que existen, y un renglón sin costo se cuenta aparte y no suma. Nunca hay `float`.
- **Un pedido no mueve inventario.** No escribe en `stock_movement`, y hay una prueba que lo comprueba. Lo que llegue lo registrará la recepción de F2-13.
- **Borrador y enviado.** El borrador se guarda, se reabre, se edita (reemplaza sus renglones con un control de revisión) y se puede descartar. Marcarlo como enviado pide confirmación, exige al menos un renglón y lo cierra: los disparadores de la migración 18 impiden cambiar o borrar un pedido enviado y sus renglones, hasta con SQL a mano. El historial es lo enviado.
- **Quién.** Todo lo que escribe, y la exportación (porque lleva los costos fuera de la caja), usa `OwnerGate` (ADR 0047): el dueño con sesión lo hace, y un cajero **ve** todo y necesita el PIN de un dueño para guardar, enviar, descartar, exportar o capturar un mínimo. Cada intento negado queda en la bitácora con su motivo (`supplier.save_denied`, `purchase_order.send_denied`, etcétera).
- **Una transacción por cambio.** Cada escritura junta el cambio, su entrada de bitácora (`supplier.create/update`, `supplier_codes.set`, `purchase_order.create/update/send/discard`, `reorder_level.set`) con quién lo pidió y quién aprobó, y, cuando se envía algo al núcleo, su operación en `sync_outbox`. Si cualquiera falla, no queda nada.
- **Contrato** (`packages/contracts`, aditivo, versión 1) con tres tipos nuevos en `sync-push-request.schema.json`:
  - `supplier.upserted`: el estado completo de un proveedor `{ supplierId, name, contact, notes, isActive, revision, savedBy, authorizedBy }`.
  - `supplier_product.upserted`: la lista completa de códigos de un proveedor para un producto `{ supplierId, productId, codes[], savedBy, authorizedBy }`; vacía quiere decir «ya no los tiene». Es un tercer tipo, además de los dos que pidió el dueño, porque los códigos nacen en la caja y el servidor los necesita para F2-11 y F2-12.
  - `purchase_order.sent`: el pedido enviado, con sus renglones copiados y su total `{ orderId, folio, supplierId, supplierName, notes, lines[], totalCents, sentBy, authorizedBy }`.
  Hay seis casos válidos y diecisiete rechazos en `cases/sync-push.json`. **Los borradores no viajan**: son del dueño hasta que los envía. Los mínimos tampoco: se quedan en la caja hasta F2-16.
- **Archivos.** El dueño elige dónde guardar con la ventana de Windows (`dialog.showSaveDialog`) y puede abrir la carpeta (`shell.showItemInFolder`, solo de un archivo que la caja acaba de escribir). El encabezado lleva el nombre del negocio, el proveedor, la fecha, el folio, una tabla con código del proveedor, descripción, código de barras, cantidad, unidad, costo estimado e importe, y el total; las notas y el aviso de renglones sin costo van debajo.
  - **Excel** (`exceljs`): los códigos se escriben como texto (un cero a la izquierda no se pierde), la cantidad y el dinero como números, y los importes los calcula la caja con enteros, no la hoja. Un texto que escribió una persona nunca se vuelve fórmula. La prueba lo lee de vuelta con la misma librería.
  - **PDF**: la página HTML (`renderOrderHtml`) escapa todo lo que viene de la base, no lleva scripts ni carga nada (`Content-Security-Policy: default-src 'none'`), y se imprime con `webContents.printToPDF` en una ventana oculta, sin Node, sin scripts y destruida al terminar. La prueba revisa el HTML que se imprime; la de pantalla comprueba que lo impreso empieza con `%PDF-`.
- **Dependencia nueva: `exceljs` 4.4.0.** Revisada contra OSV antes de subirla. Arrastraba `uuid` 8.3.2 con GHSA-w5hq-g745-h8pq (`v3`, `v5` y `v6` con un búfer de salida; `exceljs` solo usa `v4`, que nunca estuvo afectado), pero el escaneo lee el archivo de bloqueo, así que `pnpm-workspace.yaml` lo sustituye por 11.1.1 (corregida) con una nota. Va en `dependencies` y se **incluye en el paquete de `main`** (`externalizeDeps.exclude`), porque el instalador no lleva `node_modules` (E1-36); se comprobó que el paquete solo `require` módulos de Node y que el Excel y el PDF salen de la aplicación empaquetada por el motor.
- **Pantallas** (RNF-13): **Mayús+F11** en la venta y **F11** en la administración (en el resumen y en la búsqueda del inventario) abren «Pedido al proveedor». F11 solo, en la venta, es el resumen del negocio de E1-45, y no quedaba otra tecla F libre. La lista muestra los pedidos con folio, estado y total; **F2** pedido nuevo, **F3** proveedores. En el pedido: **F2** guarda el borrador, **F4** lo marca como enviado (pide confirmar con otro F4), **F5** Excel, **F6** PDF, **F7** sugerencias por existencia baja, **F8** descartar, **F9** abrir la carpeta, **Esc** vuelve. Se agregan renglones por nombre, por código de barras (el lector escribe directo en la caja de búsqueda y cada lectura agrega el producto, o suma una pieza si ya está) o por código del proveedor; cada renglón tiene cantidad (hasta 3 decimales, con su unidad), costo estimado (el de la lista del proveedor, o el del producto), importe, y botones para quitar y para fijar el mínimo. Sin cambios, exportar o enviar no vuelve a guardar. Usa los estilos y el sistema de apariencia del dueño.
- **Sin internet:** todo es local. Exportar solo necesita el disco.

## Cómo se convierte en las tareas de la Fase 2
Esta tarea es la caja; el servidor llega después y no se toca ahora. Lo que se queda y lo que se sustituye:
- **F2-11 · Proveedores (servidor).** El servidor recibe `supplier.upserted` y `supplier_product.upserted` y arma sus tablas (`supplier`, y la relación muchos a muchos con atributos entre producto y proveedor: código, costo de lista, presentación). Son el estado completo, así que la regla es quedarse con la revisión más alta y con el orden de `deviceSeq`. Los UUIDv7 nacen en la caja, así que no cambian de identidad al llegar. El «último costo» por proveedor, que F2-11 pide, nace de F2-13, no de esta tarea: el costo de lista de aquí es solo una referencia.
- **F2-12 · Órdenes de compra sugeridas.** El cálculo de la caja (`suggestedQuantity`: ≤ mínimo, hasta el máximo o el doble del mínimo) pasa al servidor con los mínimos y máximos de F2-16, y el servidor genera la orden sugerida con su propio aprobador. En la caja, la lista de «Sugerir» pasa a leer esa sugerencia en lugar de calcularla, y el dueño sigue decidiendo cuánto pedir.
- **F2-13 · Recepción de mercancía.** Una recepción apunta a `purchase_order.sent` (por `orderId`), y recibe parcial o de más contra sus renglones. Es la única que escribe movimientos `purchase` en el libro y que actualiza el costo (con E1-28). Por eso el pedido guarda `lines` con cantidades copiadas: son lo que se pidió, y lo recibido es otra cosa. Un pedido enviado nunca cambia, así que una recepción puede compararse con él sin dudar. Habrá que agregar el estado «recibido» (parcial o total) en el servidor; en la caja será un dato que baja con `GET /sync/pull` y nunca un cambio del pedido enviado.
- **F2-15 · Comparativo de proveedores.** Compara el último costo por proveedor con funciones de ventana sobre las recepciones. Los costos de lista de `supplier_product.upserted` sirven de segunda columna («lo que dice la lista») junto a «lo que realmente se pagó».
- **Borradores.** Siguen siendo de la caja. Si en el futuro hay varias cajas o un panel web que arme pedidos, el borrador tendrá que viajar con su propio tipo; para eso el contrato de hoy no se mueve: se agrega un tipo y la caja que no lo conoce lo ignora.
- **Qué se rehace:** nada de lo guardado. Si la tabla de códigos del servidor necesita más columnas (un SKU de marca, una unidad de compra con factor de conversión), se agregan con tipos nuevos y la caja de hoy sigue funcionando. La presentación de hoy es informativa: la cantidad y el costo siempre son por unidad del producto, y una conversión real (una caja de 12 a 12 piezas) es de F2-13, que conocerá el factor.

## Consecuencias
- El dueño arma un pedido en minutos, lo manda por correo o WhatsApp y lo conserva como historial, sin internet y sin ensuciar el inventario.
- Un pedido enviado nunca cambia. Si se equivocó, se hace otro y la bitácora cuenta la historia; no hay «deshacer enviado».
- Un cajero con el PIN del dueño puede hacerlo, y cada intento queda en la bitácora. Sin rol de gerente, la aprobación es la del dueño.
- Los mínimos viven solo en la caja hasta F2-16, así que otra caja no los ve. Con una sola caja es lo correcto, y se anota aquí para no olvidarlo.
- El servidor aún no conoce estos tres tipos: mientras tanto `POST /sync/push` los deja en cuarentena como tipos que no conoce (ADR 0040), y no se pierden.
- Se agrega una dependencia (`exceljs`) y una anulación de `uuid`. Quien actualice `exceljs` debe revisar si su `uuid` ya viene corregido para quitar la anulación.
- No se probó abrir los archivos en Excel ni en el visor de PDF de la PC de la tienda: se comprueba que se leen con la misma librería y que el PDF empieza bien, pero la presentación real (anchos, tipografía, saltos de página con muchos renglones) debe verla Mauricio.
