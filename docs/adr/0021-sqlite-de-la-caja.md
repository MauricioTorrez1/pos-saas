# ADR 0021: SQLite de la caja con `node:sqlite`

Estado: Aceptada · Fecha: 2026-11-03 · Concreta la parte de SQLite del ADR 0002.

## Contexto
E1-02 necesita una base local que sobreviva a un cierre forzado sin perder ventas confirmadas. Hay que elegir con qué biblioteca se habla con SQLite, y cómo se actualiza el esquema en cajas que pueden pasar mucho tiempo sin conexión. La caja usa Electron 45.2.1, que trae Node 24.22.1 y SQLite 3.53.4.

## Opciones
**Biblioteca**
1. **`node:sqlite`, incluida en Electron.** No agrega ninguna dependencia ni nada que empacar aparte en el instalador. Se probó en el proceso principal real de Electron: WAL, búsqueda FTS5 y enteros grandes funcionan, y también funciona con Vitest y con el build. En contra, Node la marca como *release candidate* desde 24.15.0, y SQLite solo se actualiza al subir Electron.
2. **`better-sqlite3` 13.** API más madura y SQLite actualizable por separado. Desde 13.0.0 (julio de 2026) ya no pide compilar: usa N-API y trae binarios en el paquete, que según su autor «en teoría» sirven en Node y en Electron. No se probó en Electron 45. Suma 27 MB, un binario de terceros y un paso más en el instalador.

**Cómo se actualiza el esquema**
1. **Una lista de migraciones en TypeScript y `PRAGMA user_version`.** Viaja dentro del build, sin archivos que copiar, y la versión se guarda en la misma transacción que los cambios.
2. **Archivos `.sql` sueltos.** Se leen mejor, pero hay que empacarlos y encontrarlos en tiempo de ejecución.

## Decisión
- La caja usa `node:sqlite`, y solo `src/main/local-store` la conoce. Si da problemas, cambiarla toca ese módulo.
- WAL es obligatorio: si SQLite no puede activarlo, la caja no arranca. Se usa `synchronous = FULL`, porque aquí una venta confirmada pesa más que la velocidad de escritura.
- Cada migración corre en su propia transacción, junto con su fila en `schema_history` y la nueva versión. Si falla, se deshace completa, la base queda en la versión anterior y la caja no abre la ventana.
- Una migración publicada no se cambia: una corrección es una migración nueva.
- La caja se niega a abrir una base de una versión más nueva de la app, porque podría dañar un esquema que no conoce.
- Si al abrir SQLite responde `SQLITE_IOERR_TRUNCATE` (1546), la caja reintenta hasta por 15 segundos. Tras un cierre forzado, Windows mantiene ocupado el archivo `-shm` entre 0.2 y 4.9 segundos en lo medido, y sin reintento la caja falló 8 de 30 veces al reabrir enseguida. Con reintento falló 0 de 30. Ese archivo es un índice que SQLite reconstruye desde el WAL, así que esperar no arriesga las ventas. Ningún otro error se reintenta.
- E1-02 no agrega tablas de negocio. Las primeras llegan con la tarea que las usa, y cumplen las reglas del ADR 0019.

## Consecuencias
- No hay dependencia nueva que escanear ni actualizar. Los parches de SQLite llegan con cada actualización de Electron.
- La API es síncrona y corre en el proceso principal: una consulta lenta congela la ventana. Las consultas deben ser cortas, y lo que no lo sea se moverá a un `worker`. E1-07 lo mide con 5,000 productos.
- Vitest usa el SQLite de Node (3.53.0 en esta PC) y Electron el suyo (3.53.4). Las pruebas con Playwright cubren el que corre de verdad.
- Si la API cambia al subir de Electron, las pruebas lo muestran en CI antes de llegar a una caja.
- La ruta de la base depende del nombre de la app en `package.json`. E1-36 no debe cambiar ese nombre sin mover el archivo.
- CI corre en Linux, donde esa espera de Windows no ocurre. Solo las pruebas locales y la PC de la tienda la cubren.
- Las pruebas matan el proceso de verdad, pero un proceso muerto no es un corte de luz: el sistema operativo aún puede terminar de escribir. El corte de luz solo se simula truncando el WAL. Probarlo de verdad queda para la PC de la tienda.
