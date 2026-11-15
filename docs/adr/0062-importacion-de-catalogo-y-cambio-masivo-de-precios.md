# ADR 0062: Importación de catálogo y cambio masivo de precios en el núcleo

Estado: Aceptada · Fecha: 2026-11-15 · Concreta F0-18 y F0-19. Se apoya en los ADR 0038, 0042, 0048, 0051 y 0056.

## Contexto
RF-005 pide cargar un CSV y que dos filas malas de mil no impidan las otras 998, con un reporte de las que fallaron. RF-006 pide subir un porcentaje a muchos productos con vista previa, bitácora y llegada a las cajas. Los permisos y las rutas ya estaban en la tabla (ADR 0042): `POST /imports/catalog` y `POST /price-changes`.

## Opciones
**Importación**
1. **Una transacción por fila**, con un lector de CSV propio. Una fila mala no arrastra a las demás.
2. **Todo o nada.** Más simple, pero un error en la fila 999 obliga a repetir todo.
3. **Spring Batch y Commons CSV.** Lo que nombra la ficha; es mucha maquinaria para un archivo de una tienda.

**Cambio masivo**
1. **Vista previa y confirmación en la misma ruta**, todo o nada en una transacción.
2. **Aplicar por lotes.** Deja el catálogo a medias si algo falla.

## Decisión
- **Importación (`POST /imports/catalog`, cuerpo `text/csv`).** Cada fila se valida y se guarda sola con `ProductCatalog.create`, así que conserva bitácora, evento y aviso a las cajas. Un producto se reconoce por su código: si ya existe, la fila cuenta como «ya estaba» y no se toca. La llave de idempotencia sale del código, así que dos cargas simultáneas del mismo archivo crean cada producto una vez. `dryRun=true` revisa sin guardar y `report=csv` devuelve las filas fallidas como archivo. Tope: 20,000 filas.
- **Columnas:** las mismas que la caja (código, nombre, precio de venta, unidad, IVA) más las claves SAT. Costos y existencias se leen y se reportan como columnas ignoradas: pertenecen al libro de la caja, no al catálogo del servidor.
- **Precios (RF-008):** el encargado puede importar, pero solo el dueño pone precios; sus productos entran sin precio y el reporte dice cuántos.
- **Cambio masivo (`POST /price-changes`).** El cuerpo lleva `search` (palabras del nombre; el catálogo todavía no tiene marca), `percent` con hasta dos decimales, `rounding` (`cent`, `half_peso`, `peso`) y `preview`. Aplicar exige `expectedCount`, el número que mostró la vista previa: si el catálogo se movió, responde 409 y no cambia nada. Todo ocurre en una transacción; cada producto pasa por `changePrice`, con su historial, su bitácora y su aviso a las cajas, y además queda un renglón `price.bulk_change`. Límites: de −90 % a 500 %, 5,000 productos por cambio; un precio nunca baja de un paso del redondeo.
- No se agregaron dependencias: el lector de CSV es una clase pequeña.

## Consecuencias
- Repetir una importación no duplica productos.
- «Subir 5 % a Truper» funciona mientras la marca esté en el nombre; un campo de marca sería una migración aparte.
- La importación no actualiza productos que ya existen; cambiar precios en bloque es el otro endpoint.
- Falta la pantalla del panel web para ambas operaciones (F0-21) y probar con un archivo real de Eleventa.
