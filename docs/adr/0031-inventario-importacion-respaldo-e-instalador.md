# ADR 0031: Inventario por movimientos, carga desde Eleventa, respaldo cifrado e instalador

Estado: Aceptada · Fecha: 2026-11-08 · Concreta RF-029, RF-032, RF-034 y RNF-09 en la parte local, y el ADR 0003.

## Contexto
Para sustituir a Eleventa la caja necesita productos y existencias reales, saber cuánto queda de cada cosa, no perder las ventas si la computadora falla y poder instalarse sin ayuda técnica. Todo debe funcionar sin servidor, porque la caja manda (ADR 0019).

## Opciones
**Cómo se guarda la existencia**
1. **Una columna `existencia` que se actualiza.** Simple, pero un fallo a la mitad la deja mal y no deja rastro.
2. **Un libro de movimientos inmutable, y la existencia es su suma.** Un poco más de trabajo, y cada cambio queda explicado.

**Cómo se entra el catálogo de Eleventa**
1. **Esperar el formato exacto de su exportación.** Seguro, pero no se puede avanzar sin el archivo.
2. **Un lector de CSV que busca las columnas por nombre y reporta cada fila que no entiende.** Funciona con lo que Eleventa exporte, y se ajusta con el archivo real.

**Cómo se hace el respaldo**
1. **Copiar el archivo de la base.** Puede copiar una base a medio escribir.
2. **Una copia consistente con `VACUUM INTO`, cifrada con una contraseña.** La USB que se pierda no regala las ventas.

**Cómo se instala**
1. **Instalador `.exe` sin firmar, por usuario, con electron-builder (NSIS).** Gratis, y Windows muestra un aviso la primera vez.
2. **Firmarlo con un certificado.** Quita el aviso, pero cuesta dinero cada año y exige trámite.

## Decisión
- Opción 2 en las tres primeras preguntas y opción 1 en la última.
- **Inventario:** `stock_movement` guarda `opening_balance`, `sale`, `return`, `adjustment` y `waste`, con cantidad con signo en milésimas, sin permitir cambios ni borrados (disparadores). Una venta que se completa y una devolución escriben sus movimientos en la misma transacción. Un movimiento que ya publicó su origen se ignora, con `ON CONFLICT DO NOTHING` y no con `OR IGNORE`, porque éste también se tragaba los errores de `CHECK`. La existencia puede quedar negativa, porque la venta ya ocurrió.
- **Carga de Eleventa:** el lector acepta comas, punto y coma o tabulador, y también archivos guardados por Excel en la página de códigos de Windows. Encuentra las columnas por nombre, sin importar acentos ni mayúsculas. Las filas malas se reportan con su línea y su motivo, y las demás se cargan. Cada producto con su existencia inicial se carga en una transacción. Un código que ya está en la caja se deja como está, así que cargar el mismo archivo otra vez no duplica nada, y un precio que alguien cambió en la caja no se pisa. El reporte da el costo de lo cargado para compararlo con el inventario de Eleventa. Al cargar productos reales se quitan los de prueba.
- **Respaldo:** `VACUUM INTO` toma una foto consistente aunque se esté vendiendo. Se cifra con AES-256-GCM y una llave de scrypt derivada de la contraseña, se escribe en un archivo temporal y se renombra, y se conservan las 48 copias más recientes. Una copia corre cada hora hacia la carpeta o USB que el dueño elige. La contraseña se guarda cifrada por Windows para el usuario, nunca en la base. Si una copia falla, el estado lo conserva y el dueño lo ve en pantalla.
- **Restauración:** se pide la contraseña, se abre el respaldo, se revisa que su base esté sana y se deja esperando. Al reiniciar la caja se cambia por la actual, que se conserva a su lado por si fue un error.
- **Instalador:** electron-builder arma un instalador NSIS por usuario, sin administrador, que instala y actualiza ejecutándolo otra vez. Desinstalar nunca borra los datos de la caja. Las migraciones de la base corren al abrir.

## Consecuencias
- El formato real de Eleventa puede traer columnas que este lector no conoce. Con el archivo real se agregan sus nombres a la lista, sin tocar el resto.
- La contraseña del respaldo no se puede recuperar. Si el dueño la olvida, las copias no se abren.
- Sin certificado, Windows muestra «Windows protegió su PC» la primera vez. La guía de instalación explica cómo continuar. Firmar queda para cuando haya presupuesto o más tiendas.
- No hay actualización automática: actualizar es instalar el nuevo `.exe` encima. Si falla, se vuelve a instalar la versión anterior, y los datos siguen en su lugar.
- El kardex, los ajustes y mermas (E1-26, E1-27) y el costo promedio (E1-28) se apoyan en este libro.
- Probar el instalador en la computadora de la tienda con Windows 10 y restaurar un respaldo de verdad quedan en la lista de pendientes antes del piloto.
