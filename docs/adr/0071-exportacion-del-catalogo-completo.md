# ADR 0071: Exportación del catálogo completo en PDF, Excel y CSV

Estado: Aceptada · Fecha: 2026-11-18 · Concreta E1-55. Se apoya en los ADR 0011 (dinero en enteros), 0047 (`OwnerGate`), 0049 y 0060 (costo promedio ponderado), 0058 (borrado lógico del producto), 0059 (códigos del proveedor) y en el escritor de Excel de E1-47.

## Contexto
El dueño quiere sacar todo su catálogo a un archivo: para revisarlo con calma, mandárselo al contador o compararlo contra los proveedores. Cada producto debe traer sus códigos, sus proveedores con el código que ellos le dan, el costo sin y con IVA, el precio con IVA, la existencia del libro y sus márgenes. El catálogo de la tienda ronda los miles de productos, así que la caja no puede congelarse mientras lo arma.

## Decisiones

**Dónde y quién.** Administración (F1, solo el dueño) tiene **F12 · Exportar catálogo**, con **F2** PDF, **F3** Excel (`.xlsx`) y **F4** CSV, y la casilla «Solo activos» (F5), encendida al abrir. El canal `catalog:export` acepta a cualquier persona con sesión, pero el exportador pasa por `OwnerGate`: el dueño con sesión, o un cajero con el PIN de un dueño. Un rechazo queda en la bitácora como `catalog.export_denied` y cada archivo guardado como `catalog.export`, con el formato, el filtro, cuántos productos, quién aprobó y la ruta. Se pide el permiso **antes** de abrir la ventana de guardar, así que un cajero sin PIN ni siquiera la ve. El costo y el margen son información sensible del negocio; por eso la regla es la misma del resumen del negocio.

**Un renglón por producto.** Activo o dado de baja (columna «Estado»), ordenado por nombre. Columnas: estado, código principal, otros códigos, producto, unidad, proveedores con su código (`Truper (MART-16); Urrea (U-7)`), costo sin IVA, costo con IVA, precio con IVA, IVA, existencia, margen bruto, margen neto y origen del costo. El código principal es el primero en el orden del panel del producto (orden del texto del código), porque la base no marca uno como principal.

**El costo.** El que tecleó el dueño; si no hay, el promedio ponderado móvil de las entradas con costo del libro (la misma regla del tablero, ADR 0060); si tampoco hay, «sin costo». El costo con IVA se calcula con `costWithTaxE6`, redondeado a la millonésima. Un producto sin costo dice «sin costo» en el costo y en los dos márgenes: nunca se inventa un margen.

**Margen bruto y margen neto.** Con *P* el precio con IVA, *r* la tasa y *C* el costo sin IVA:
- **Margen bruto** = (P/(1+r) − C) ÷ (P/(1+r)). Lo que se gana de cada peso de venta antes de IVA. Es el margen que ya muestra el producto.
- **Margen neto** = (P/(1+r) − C) ÷ P. De cada peso que se cobra en caja, lo que queda ya repuesto el producto y pagado al SAT el IVA trasladado menos el acreditable.

Se eligió esta definición de neto porque la caja **no registra gastos** (renta, sueldos, luz) **ni comisiones de tarjeta**, así que no hay nada honesto que repartir por unidad. «Neto de IVA» es lo que el dueño ve en la mano: él piensa en precios con IVA, y la diferencia con el bruto es justo el IVA. La leyenda de cada archivo lo dice con estas palabras, y que el neto no descuenta gastos. Cuando la caja registre gastos o comisiones, el neto los restará con un ADR nuevo.

Las dos son una sola fracción de enteros (`BigInt`) redondeada una vez, a la centésima de punto porcentual (puntos base), alejándose del cero en el medio. El precio sin IVA nunca se redondea en el camino: con $9.99 y costo de $5.00 da 41.94 %, y con la base redondeada a $8.61 saldría 41.93 %. Un precio de cero dice «sin precio».

**Totales.** Al final: productos, activos, dados de baja, sin costo, valor del inventario a costo (existencia × costo sin IVA) y a precio (existencia × precio con IVA, redondeado como una línea de venta), y cuántos tienen existencia sin costo, que no suman al valor a costo. Una existencia en cero o negativa no suma: es un conteo por corregir, no dinero.

**CSV.** UTF-8 **con BOM** (`EF BB BF`), porque Excel en Windows solo así muestra los acentos; comas, fin de línea CRLF y comillas dobladas (RFC 4180). Un texto que empieza con `=`, `+`, `-`, `@`, tabulador o retorno lleva un apóstrofo delante, para que abrirlo en Excel nunca ejecute una fórmula (*CSV injection*). Los números que escribe la propia exportación (un margen negativo) no se tocan. Los totales y la leyenda van al final, después de una línea en blanco.

**Excel.** El escritor sin librerías de E1-47. Una hoja «Catálogo» con la fila de títulos fija al desplazarse, dinero, existencia y márgenes como números escritos desde enteros, y los códigos como texto, para que un código no pierda sus ceros a la izquierda. Una hoja «Leyenda» aparte. Los textos son cadenas en línea, así que un nombre que empieza con `=` se muestra y no se evalúa.

**PDF.** Carta horizontal (`@page size: letter landscape`), letra de 8 px, la fila de títulos en `thead`, que Chromium repite en cada página, y «Página X de Y» al pie. Todo texto se escapa y la página trae una política (`default-src 'none'`) que bloquea scripts y la red. La ventana que imprime no tiene JavaScript, Node ni acceso fuera del *sandbox*. A diferencia de los otros PDF de la caja, la página **no** viaja en una dirección `data:`: con 5,000 productos el HTML pasa de los 2 MB que acepta una dirección de Chromium. Se escribe en una carpeta temporal propia, se carga con `loadFile` y se borra al terminar o al fallar.

**Catálogos grandes.** El lector hace cinco consultas en total, sin importar el tamaño: productos, códigos, proveedores, existencias y entradas con costo; la existencia previa a cada entrada sale de una función de ventana (`SUM() OVER`) en una sola pasada del libro. Los renglones se arman de 500 en 500, cediendo el turno al ciclo de eventos entre cada bloque, y la impresión del PDF corre en el proceso de su propia ventana. La pantalla muestra «Exportando…» y desactiva los botones. Una prueba exporta 5,000 productos en los tres formatos en menos de 10 s y revisa que un temporizador alcanzó a correr mientras tanto.

## Alternativas descartadas
- **Un `worker_thread` para todo:** aislaría el trabajo por completo, pero `node:sqlite` tendría que abrir otra conexión y electron-vite necesitaría otra entrada. Con cinco consultas y bloques de 500, el proceso principal nunca queda ocupado lo suficiente para notarse.
- **Margen neto después de comisión de tarjeta:** la caja no guarda la tasa de la terminal, y aplicarla a todo producto lo castigaría aunque se pague en efectivo.
- **Margen sobre el costo (*markup*) como «neto»:** es otra medida, no un neto; llamarla así confundiría.
- **Cargar el PDF como `data:` igual que los otros:** falla en silencio con catálogos grandes.
- **Una librería de CSV o de PDF:** el formato es corto y ya hay escapado, escritor de Excel e impresión de Electron.

## Consecuencias
- El dueño saca el catálogo completo sin internet, en tres formatos, y cada exportación deja rastro.
- Pruebas en Vitest: márgenes con enteros y redondeo, falta de costo, IVA exento, varios proveedores, totales, lector contra SQLite real, CSV con BOM y escapado, contenido del `.xlsx` leído con `exceljs`, escapado del PDF, permisos, bitácora y 5,000 productos. Playwright exporta un CSV real desde la caja.
- Falta abrir los tres archivos con el catálogo real de la tienda en la PC de la tienda.
