# ADR 0068: Listas de precios de proveedores y comparador

Estado: Aceptada · Fecha: 2026-11-18 · Concreta E1-51 y E1-52, que cubre F2-15. Se apoya en los ADR 0011, 0059, 0063 y 0067.

## Contexto
El dueño compra lo mismo a varios proveedores y hoy compara a mano con listas en Excel, PDF o papel. E1-51 mete esas listas a la caja y las liga a los productos; E1-52 las compara y arma los pedidos. La sesión de E1-53 lee los catálogos en papel con Claude y entrega un CSV con encabezados acordados: `supplier_code,description,purchase_unit,pieces_per_unit,cost`.

## Decisiones

**Una tabla por artículo de lista, reemplazada completa.** La migración local 21 crea `supplier_catalog_item`:
- un renglón por código del proveedor, único por proveedor;
- `list_cost_e6`: costo de una presentación, siempre antes de IVA, en millonésimas de peso (ADR 0011);
- `pieces_per_unit_milli`: cuántas unidades base del producto trae la presentación (una caja de 12 son 12,000);
- `product_id` y `link_origin` (`supplier_code`, `barcode` o `manual`), nulos mientras está «sin ligar»;
- `list_date` y `source` (`file` o `paper`).

Importar borra los artículos de ese proveedor e inserta los nuevos en una sola transacción, con su entrada de auditoría (`supplier_price_list.import`). Si ningún renglón se puede leer, o falta una columna obligatoria, no se toca la lista anterior.

Opciones que se consideraron para guardar varias listas:
1. Historial de listas con versión.
2. Solo la lista vigente.

Se eligió la 2: el comparador necesita el precio de hoy, y el historial de lo que se compró ya está en los pedidos enviados, que nunca cambian.

**El costo por unidad base se calcula, no se guarda.** `baseUnitCostE6` divide con enteros y redondea a la mitad hacia arriba: $120.00 por caja de 12 son $10.00 por pieza. Así una corrección de las piezas por presentación no deja un costo viejo.

**IVA.** La pantalla pregunta si los costos del archivo incluyen IVA; por defecto «no». Si sí, se quita el 16 % al importar. Se eligió la tasa general porque casi todo lo que compra una tlapalería la lleva; un producto al 0 % se corrige con «no» en su lista. La respuesta se recuerda por proveedor.

**Columnas recordadas por proveedor.** `supplier_price_list_settings` guarda qué encabezado del archivo es cada dato. Al abrir un archivo se propone, en este orden:
1. el mapeo de la lista anterior del proveedor, si todos sus encabezados siguen ahí;
2. los encabezados acordados con E1-53;
3. una adivinanza por nombres comunes (clave, descripción, precio de lista…).

El encabezado se busca en los primeros 15 renglones, porque muchas listas empiezan con el nombre del proveedor y la fecha. Un archivo con los encabezados acordados se marca como catálogo en papel aunque sus columnas vengan recordadas.

**Ligado a los productos.** Al importar, cada artículo se liga con:
1. lo que el dueño ligó a mano antes (`supplier_catalog_link`);
2. el código que el producto ya tiene con ese proveedor (`supplier_product_code`, ADR 0059);
3. el código de barras, de la columna de barras o del propio código del proveedor (muchos usan el EAN).

Lo demás queda «sin ligar» y el dueño lo liga una vez desde la pantalla, con auditoría (`supplier_catalog.link` y `supplier_catalog.unlink`). El ligado manual vive en su propia tabla y no en `supplier_product_code`, para no mandar al núcleo operaciones que el dueño no pidió.

**Búsqueda sin acentos.** `supplier_catalog_search` es un índice FTS5 sobre la descripción y el código con `remove_diacritics 2`, igual que el de productos: «cinta de aislar» encuentra «CINTA DE AISLÁR 3/4"».

**Solo el dueño.** Los cinco canales `supplier-catalog:*` rechazan a una cajera, porque las listas llevan los costos del negocio. La pantalla se abre con «Lista de precios» (F5) en el administrador de proveedores y no aparece para una cajera.

**Archivos.** Excel (`.xlsx`, con el lector propio de E1-34, ahora con 6 decimales para costos) o CSV (coma, punto y coma o tabulador; UTF-8 o Windows-1252). Máximo 20 MB y 20,000 artículos. El archivo elegido se queda en memoria con una ficha (UUIDv7) hasta que el dueño confirma las columnas; solo se guarda el último.

## Decisiones del comparador (E1-52)

**Comparar en la unidad base.** «Comparar precios» (F6 en proveedores, solo dueño) busca con FTS5 en las listas de todos los proveedores activos. Los artículos se agrupan por el producto al que están ligados, y un producto que salió en la búsqueda trae también los artículos de otros proveedores ligados a él aunque los describan con otras palabras. Dentro de cada grupo:
- se ordena por costo por unidad base, el más barato primero;
- el más barato va en verde y el más caro en rojo, solo si hay más de una oferta y los precios difieren;
- cada oferta dice cuánto más cuesta que la más barata, en pesos y en porcentaje (centésimas de punto con enteros).

Los artículos sin ligar forman un grupo aparte que se compara pero no se puede pedir: primero hay que ligarlos.

**Carrito.** «Agregar» pone el producto con su proveedor más barato y cantidad 1; el dueño cambia la cantidad y el proveedor por renglón. La pantalla solo manda producto, cantidad y artículo elegido: el proceso principal vuelve a leer los costos de las listas, revisa que el artículo siga ligado al producto y que la cantidad sea entera para piezas, y calcula todo.

**Un borrador por proveedor con el `save` de siempre.** Confirmar agrupa los renglones por proveedor y llama a `PurchaseOrderService.save` una vez por proveedor, con el código del proveedor y el costo por unidad base. Así aplican las mismas reglas: PIN del dueño para una cajera, máximo de renglones, auditoría y folio sin huecos. Los borradores llevan la nota «Armado en el comparador de precios».

Opciones que se consideraron para varios proveedores:
1. Una transacción con todos los pedidos.
2. Un `save` por proveedor.

Se eligió la 2 porque `LocalStore` no anida transacciones y duplicar la lógica de `save` rompería ADR 0059. Si un pedido falla después de otros, la respuesta es `partial` con los que sí se guardaron, y la pantalla deja en el carrito solo los renglones que faltan.

**PDF.** Igual que la bitácora de faltantes (ADR 0063): HTML escapado sin JavaScript, política que bloquea scripts y red, impreso por Electron. Columnas: código del producto, producto, cantidad, precio elegido, proveedor elegido, precio más bajo, proveedor más barato e importe. Arriba el total, lo que costaría con lo más barato y el ahorro posible. Dos gráficas de barras en SVG dibujadas en el proceso principal: productos por proveedor y gasto por proveedor. `horizontalBars` acepta ahora el texto de cada valor para mostrar pesos.

**F2-15 queda cubierta.** El comparativo de proveedores de la fase 2 pedía comparar el último costo por proveedor; el comparador lo hace con las listas vigentes y en la unidad base. Cuando F2-13 registre recepciones, el último costo pagado puede sumarse como otra columna sin cambiar esta decisión.

## Consecuencias
- Comparar proveedores ya no necesita capturar costos producto por producto.
- La caja pasa a la versión 0.2.4.
- La lista no viaja al núcleo: es local, como los mínimos de reorden, hasta que F2-11 la reciba.
- Un artículo ligado a un producto que se borra queda sin ligar (`ON DELETE SET NULL`).
