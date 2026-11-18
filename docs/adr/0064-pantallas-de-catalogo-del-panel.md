# ADR 0064: Pantallas de catálogo del panel con Server Components y Server Actions

Estado: Aceptada · Fecha: 2026-11-17 · Concreta F0-21. Se apoya en los ADR 0011, 0042, 0044 y 0062.

## Contexto
El dueño debe crear, buscar, editar e importar productos desde el navegador, y cambiar precios en bloque con vista previa. Los endpoints ya existen en el núcleo (`/products`, `POST /imports/catalog`, `POST /price-changes`). Falta decidir cómo habla el panel con el núcleo sin exponer el token, cómo se pagina un catálogo de 5,000 productos, dónde se valida el formulario y cómo se respetan los permisos del ADR 0042.

## Opciones
**Cómo llama el panel al núcleo**
1. **Server Components para leer y Server Actions para escribir.** El token sigue solo en el servidor, como en el ADR 0044; el navegador recibe HTML y el resultado de cada acción. Sin API propia que mantener.
2. **Un Route Handler que reenvía `/api/core/*` y `fetch` desde el navegador.** Más parecido a una SPA, pero es un proxy abierto que hay que limitar ruta por ruta y duplica la autorización.
3. **Dar el token al navegador.** Descartada por el ADR 0044.

**Paginación**
1. **Por desplazamiento (`page` y `size`) en el servidor, con la página en la URL.** Es lo que ofrece `GET /products`, permite saltar a una página y compartir el enlace. Con 5,000 productos el costo del `OFFSET` es despreciable.
2. **Por cursor.** Mejor para listas enormes o que cambian mientras se recorren, pero el núcleo no lo ofrece y no se puede saltar a la página 40.
3. **Cargar todo y filtrar en el navegador.** 5,000 filas con precios y códigos son megas de JSON en cada visita. Descartada.

**Dónde se valida el formulario**
1. **Una función pura (`parseProductForm`) que corre en la Server Action antes de llamar al núcleo; el núcleo valida de nuevo y tiene la última palabra.** Una sola regla en el panel, probada con Vitest, y todos los errores junto a su campo a la vez.
2. **Solo atributos HTML (`required`, `pattern`).** No cubre códigos repetidos ni presentaciones, y los mensajes del navegador no son los nuestros.
3. **Solo el núcleo.** Responde un error a la vez y en inglés.

## Decisión
- **Rutas** bajo `/catalog`: lista y búsqueda (`/catalog?q=&page=`), alta (`/catalog/new`), edición (`/catalog/{id}`), importación (`/catalog/import`) y cambio masivo (`/catalog/price-changes`). Un `layout` comparte la barra y el menú.
- **Lectura** en Server Components con `createCoreApi` (`src/lib/catalog/core-api.ts`), que pone el token como `Bearer` y convierte un fallo de red en `status: 0` para explicarlo en pantalla. `GET /me` se pide una vez por petición (`cache` de React) y lo comparten el layout y la página.
- **Escritura** en Server Actions (`src/app/catalog/actions.ts`). Los formularios envían con `startTransition` en lugar de `<form action>`, porque React limpia el formulario después de la acción y el dueño perdería lo escrito cuando el núcleo rechaza un campo. Crear y guardar redirigen al producto con `?created=1` o `?saved=1`.
- **Paginación** por desplazamiento de 50 productos por página; la URL cuenta desde 1 y el núcleo desde 0. La búsqueda (por nombre sin importar acentos o por código exacto) la hace el núcleo. El navegador nunca tiene más de una página.
- **Dinero y cantidades como texto.** Los precios viajan como `"12.3450"` (ADR 0011) y las presentaciones como `"100.000"`; el panel los lee y los muestra con operaciones de texto, sin `number`. `$12.345` se muestra con sus milésimas.
- **Alta idempotente.** La página escribe en el formulario un UUIDv7 que va como `Idempotency-Key`: un doble clic o un reintento devuelve el mismo producto.
- **Permisos (ADR 0042).** El proxy deja `/catalog` al dueño y al encargado y `/catalog/price-changes` solo al dueño (la regla más específica va primero). En pantalla, el precio al crear, el formulario de precio de la edición y el enlace al cambio masivo solo se muestran al dueño (`price.change`). El encargado crea productos sin precio e importa; el reporte le avisa cuántos quedaron sin precio. **El panel oculta; el núcleo decide**: si algo se cuela, el núcleo responde 403 y la pantalla lo explica.
- **Importación en dos pasos.** El navegador lee el archivo (UTF-8 o, si no lo es, Windows-1252, como guarda Excel) y lo guarda en memoria; primero manda `dryRun=true` y muestra el reporte, y solo al confirmar lo manda de nuevo para cargarlo. Las filas con error se descargan como CSV con las columnas de `report=csv` (`linea,motivo`), armado en el navegador con el reporte que ya llegó, para no volver a procesar el archivo. El límite de una Server Action sube a 10 MB (el núcleo acepta 8 millones de caracteres).
- **Cambio masivo.** Vista previa con los primeros 500 productos y el total; aplicar manda la misma petición con `expectedCount`. Si el núcleo responde 409, la acción pide una vista previa nueva y la muestra con el aviso «antes eran N, ahora son M»; ningún precio cambió.
- **Renovación del token en un POST.** Si el `proxy` renueva el token durante una Server Action, reenvía la cookie nueva en la petición (no solo en la respuesta); si no, la acción usaría el token viejo y no podría renovarlo porque el refresh token ya se gastó.
- **Pruebas.** Vitest para la lógica (texto decimal, formulario, CSV, UUIDv7, cliente del núcleo) y los componentes. Playwright contra `e2e/fake-core.ts`, un núcleo en memoria con importes en `bigint`: crear, errores del formulario, código repetido, editar y cambiar precio, baja, 5,000 productos paginados, importar con revisión y carga, el encargado sin precios y el cambio masivo con vista previa vencida.

## Consecuencias
- Las pantallas necesitan JavaScript para enviar formularios (no hay mejora progresiva). Es un panel para el dueño en un navegador moderno; la caja es la que debe funcionar sin red.
- La paginación por desplazamiento puede saltarse o repetir un producto si alguien crea uno mientras otro recorre las páginas. Con un solo dueño editando es aceptable; si llega a molestar, el núcleo puede ofrecer cursor por nombre.
- La importación manda el archivo dos veces (revisión y carga). Es el precio de no guardar archivos a medias en el servidor.
- El núcleo falso puede separarse del real. Las pruebas del núcleo cubren los contratos; un cambio de contrato debe actualizar `fake-core.ts` en el mismo PR.
- Sigue sin Content Security Policy con nonce (ADR 0044); estas pantallas no cargan contenido de terceros.
