# ADR 0073: Reporte ilustrado del negocio en un solo PDF

Estado: Aceptada · Fecha: 2026-11-18 · Concreta E1-57. Se apoya en los ADR 0011 (dinero en enteros), 0047 (`OwnerGate`), 0060 (tablero de indicadores), 0068 (pedidos a proveedor), 0070 (fondo y corte de caja), 0071 (PDF largo desde un archivo temporal) y 0072 (estado de resultados y gastos).

## Contexto
Mauricio pidió «conocer el estado administrativo y contable detallado del negocio de manera clara, concisa, ilustrativa (gráficas e imágenes) e intuitiva», y aclaró que lo quiere **exportar como PDF**. La caja ya calcula casi todo: el resumen del negocio (F11), el estado de resultados, los gastos, el corte de caja, el inventario valuado y los pedidos a proveedores. Lo que falta es juntarlo en un documento que el dueño lea de corrido, sin ser contador, y que pueda imprimir o mandar.

## Decisiones

**Un PDF, no una pantalla nueva.** En el tablero (F11), **F5 · Reporte ilustrado** guarda un PDF del periodo elegido arriba (día, semana, mes, año o rango; no «Desde el inicio», porque el resumen no lo tiene). La ventana para guardar es la de Windows, como en las otras exportaciones. El botón solo aparece con acceso completo: el dueño, o una cajera que ya escribió el PIN de un dueño.

**Quién.** El canal `dashboard:export-business-report` acepta a cualquiera con sesión, pero el exportador pasa primero por `OwnerGate`, **antes** de abrir la ventana para guardar. Un rechazo queda en la bitácora como `report.business_report_denied`, y cada archivo guardado como `report.business_report`, con el periodo, quién aprobó y la ruta. Una cancelación no deja nada.

**Reutilizar, no recalcular.** `DashboardService` gana `businessView(request)`: el resumen del negocio y el estado de resultados del mismo periodo, **sin portón propio**, solo para quien ya tiene la aprobación del dueño. Así el PIN de una cajera se revisa y se cuenta una sola vez (con `summary` y `statement` se habría contado dos). `statement` ahora llama al mismo `#statementOf`, así que las dos rutas dan el mismo número. Lo que el tablero no tenía lo lee `ReportReader` en dos consultas: los turnos abiertos en el periodo por cajero (fondo inicial) con sus cortes (contado contra esperado en efectivo, tarjeta y transferencia), y los pedidos a proveedor (borradores vigentes y enviados en el periodo, a sus costos conocidos, con cuántos renglones no tienen costo).

**Secciones.** Portada con el nombre del negocio, una insignia con sus iniciales en el color de acento de la caja (la caja no guarda logotipo), el periodo, la fecha y el contenido. Luego, cada una en su página: De un vistazo (seis tarjetas con la comparación contra el periodo anterior y «lo más importante»), Estado de resultados (cascada de las ventas a la utilidad y la vista general con sus notas de IVA, descuentos y productos sin costo de ADR 0072), Ventas (por día o mes, por hora, por día de la semana y formas de pago en dona), Productos y costos (los diez que más dinero trajeron, lo que dejó cada uno y lo que más costó), Gastos (por concepto y lo pagado de la caja), Caja (fondos, entradas y salidas a mano, cortes y diferencias por cajero, ventas por cajero), Inventario (valor a costo, sin movimiento, agotados, por agotarse y sin costo, diez renglones por lista), Devoluciones y cancelaciones, Proveedores, y Notas y glosario.

**«Qué significa».** Debajo de cada gráfica va una frase en palabras sencillas, armada con los mismos enteros que la gráfica (`report-readings.ts`): nunca dice algo que los números no digan. La utilidad se lee como «de cada $100 que vendiste sin IVA, te quedaron $X»: una participación en puntos base es el mismo número que los centavos de cada $100 (1,234 pb = $12.34), así que no hay conversión ni redondeo extra. Una pérdida se dice como pérdida, en rojo, y su tamaño como porcentaje de las ventas netas.

**Gráficas en SVG escritas a mano.** Columnas, barras horizontales (con negativos a la izquierda del cero), dona con leyenda y cascada, todas como SVG en línea generado en TypeScript: sin librería, sin CDN y sin red, así que el PDF sale igual sin internet. Los montos nunca dejan de ser enteros; solo el dibujo los convierte en píxeles, con aritmética entera (`BigInt`, redondeo a la mitad hacia arriba, y al menos un píxel para que una venta chica no desaparezca). Los ángulos de la dona son geometría, no dinero. Las participaciones de la dona se reparten por el residuo mayor para que sumen exactamente 100 %. Todo texto se escapa: un nombre de producto o un concepto de gasto lo escribe una persona.

**Impresión.** Carta vertical (`@page size: letter portrait`), un salto de página antes de cada sección, tarjetas y gráficas que no se parten, y al pie de cada página el nombre del negocio, el periodo y «Página X de Y». La impresora de PDF de la caja se generaliza en `printPagedPdf` (horizontal o vertical, texto del pie escapado); `printLandscapePdf` del catálogo ahora la usa. La página va por un archivo temporal, como en ADR 0071, y trae la política `default-src 'none'` que bloquea scripts y red; la ventana no tiene JavaScript ni Node.

## Alternativas descartadas
- **Una librería de gráficas (Chart.js, ECharts) dentro de la página:** necesitaría JavaScript en la ventana que imprime, que hoy está apagado a propósito, y un archivo más que cuidar sin red.
- **Gráficas como imágenes PNG:** habría que dibujarlas en un `canvas` del proceso principal o con una librería nativa; el SVG pesa menos, se imprime nítido y se prueba como texto.
- **Llamar a `summary` y a `statement` desde el exportador:** contaría dos veces el PIN de una cajera y escribiría dos rechazos por un solo intento.
- **Un PDF con todas las filas del inventario:** el reporte quiere ser corto; las listas completas ya están en el Excel del resumen (F11, F3), y el reporte lo dice.
- **Comparar también la utilidad neta con el periodo anterior:** obligaría a calcular un segundo estado de resultados; queda la comparación de ventas, tickets, ticket promedio, utilidad bruta y margen, que ya trae el resumen.

## Consecuencias
- El dueño tiene un documento de una sola pieza para revisar el mes o mandárselo al contador, sin internet.
- Si la caja algún día guarda un logotipo, la portada lo usa en lugar de las iniciales sin cambiar el resto.
- Las cifras del reporte y las del tablero salen del mismo servicio: si una cambia, cambian las dos.
