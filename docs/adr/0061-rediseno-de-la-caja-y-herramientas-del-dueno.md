# ADR 0061: Rediseño de la caja y herramientas del dueño

Estado: Aceptada · Fecha: 2026-11-15 · Concreta E1-48. Se apoya en los ADR 0024, 0025, 0029, 0031, 0047, 0057, 0058 y 0060. Cambia la tecla F7 del ADR 0047.

## Contexto
Mauricio pidió una tanda de cambios a la caja antes del piloto: un diseño más actual y claro, importar el catálogo desde Excel con costos y existencias, capturar el costo con IVA y ver el margen, un botón rojo para dar de baja, gráficas claras con filtros, que las casillas de números no acepten letras, cambiar el precio de un producto solo en la venta en curso, cancelar ventas, imprimir tickets con un diseño propio, elegir las teclas y barras de desplazamiento. Al revisar el código apareció además que la hoja de estilos de `main` estaba truncada por una fusión: las gráficas y los indicadores del Resumen no tenían estilos.

## Decisiones

**Diseño.** La hoja de estilos se reescribió completa conservando los nombres de clase y los tokens de la apariencia (ADR 0024): superficies claras, esquinas suaves, un solo color de acento para lo que importa (total, línea elegida, botón principal), rojo solo para lo que quita algo, y barras de desplazamiento visibles en cada lista. La prueba de contraste sigue cubriendo los seis acentos y los dos temas. No se agregaron fuentes ni librerías.

**Precio solo en esta venta (F7).** En la pantalla de venta, F7 cambia el precio de la línea elegida **solo para esa venta**; el catálogo no se toca. El precio base se cambia desde el panel del producto (F10 y luego F8), con la regla del ADR 0047 (dueño o PIN del dueño).
- Opciones: (1) seguir cambiando el catálogo desde la venta; (2) precio por línea sin tocar el catálogo; (3) pedir PIN del dueño para el precio por línea.
- Se eligió la 2, sin PIN: la etiqueta del anaquel dice un precio y el sistema otro, y la cajera tiene que poder cobrar lo que vio el cliente sin detener la fila. A cambio, cada línea cobrada a otro precio queda en la bitácora (`sale.price_override`) con quién, el precio del catálogo y el cobrado, y la línea se marca «solo esta venta». Esto relaja RF-008 para la venta en curso; el catálogo sigue siendo solo del dueño.
- El proceso principal acepta el precio en `saleUnitPriceE4` (entero positivo, tope de un millón de pesos) y recalcula el total; un total que no coincide rechaza la venta.

**Cancelar ventas.** La venta en curso se cancela con Mayús+Supr, con confirmación; como nunca se guardó, solo deja un renglón en la bitácora (`sale.dropped_before_payment`). Una venta pasada se cancela desde «Ventas» (Mayús+F4): es una devolución de todo lo que queda de la venta (ADR 0025), con motivo y aprobación del dueño. La venta no se borra: queda marcada como cancelada, el inventario regresa y el dinero sale por la misma forma de pago.

**Tickets.** La impresora se elige en Ajustes por su nombre compartido en Windows y se puede probar ahí mismo; antes solo se podía con una variable de entorno, que sigue sirviendo. El diseño del ticket (encabezado, pie, ancho de papel de 58, 72 u 80 mm, precio unitario, desglose de IVA, total grande, copias) se edita con vista previa. El diseño por defecto imprime exactamente el ticket de antes.

**Atajos configurables.** Las acciones de la pantalla de venta tienen una tecla que el dueño cambia en Ajustes. Sirven F1 a F12 solas o con Ctrl, Alt o Mayús, y letras con Ctrl o Alt. Enter, Esc, flechas, + y − no se pueden reasignar: el lector y las manos de la cajera cuentan con ellas. Los atajos dentro de cada diálogo (F2 guardar, Esc cerrar) no cambian.

**Casillas de números.** Las casillas de importes, cantidades y PIN solo aceptan dígitos y un punto decimal; las comas se descartan. Así un escaneo que cae en la casilla equivocada no deja letras.

**Productos.** Al dar de alta o editar se captura el **costo con IVA**; el costo sin IVA se calcula con la tasa del producto y es lo que se guarda (misma columna, sin migración). La ganancia sobre el costo se mueve con una casilla o un deslizador y fija el precio; teclear el precio muestra la ganancia. El panel tiene un botón rojo «Dar de baja» con confirmación (baja lógica, ADR 0058).

**Importación.** Se lee CSV y también Excel (.xlsx) con un lector propio sobre `node:zlib`, sin dependencias. Columnas: Código del producto, Nombre del producto, Precio de venta, Costo con IVA, Costo sin IVA, Existencias, Unidad, IVA. Antes de elegir el archivo, la pantalla muestra cómo escribir los títulos.

**Gráficas.** El Resumen muestra una gráfica grande con dos filtros: por qué se parte (día o mes, hora, día de la semana, forma de pago, cajero) y qué mide (importe, número de ventas, ticket promedio).

**Ajustes guardados.** Atajos, diseño del ticket e impresora viven en `register_setting`, que ya existía: no hay migración local.

## Consecuencias
- La caja pasa a la versión 0.2.0, para distinguir este instalador del anterior.
- Las pruebas del cambio de precio del catálogo ahora prueban su diálogo directamente, porque la venta ya no lo abre.
- Los Excel antiguos (.xls) no se leen: hay que guardarlos como .xlsx o CSV.
- Falta probar en la tienda: la impresora real, el lector, un Excel real de Eleventa y el diseño en la pantalla de la PC de la caja.
- El precio por venta no viaja al servidor como dato aparte: va en la línea de la venta, como cualquier precio.
