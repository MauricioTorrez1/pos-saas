# ADR 0065: Etiquetas de anaquel en PDF

Estado: Aceptada · Fecha: 2026-11-17 · Concreta F0-22 (RF-007). Se apoya en los ADR 0011, 0042, 0056 y 0062.

## Contexto
El dueño quiere imprimir etiquetas de anaquel (nombre, precio con IVA y código de barras) desde cualquier impresora, y que el lector de la tienda reconozca el código. Más adelante puede llegar una impresora de etiquetas térmica con su propio formato. Se trabajó en modo automático: se tomó la opción recomendada y queda aquí.

## Decisiones

**El núcleo arma el archivo: `POST /labels`.** Recibe `productIds` (en el orden de impresión) o `search` (nombre o código exacto, igual que `GET /products`), `copies` (1 a 24) y `layout`. Responde el archivo como descarga, con el número de etiquetas en `X-Label-Count`.
- Es `POST` porque una lista de ids puede ser larga para una URL, aunque no cambia nada.
- Un archivo lleva **240 etiquetas como máximo** (diez hojas). Si serían más, responde 400 con el número y no dibuja nada.
- Un id de otro negocio, o borrado, responde 404: RLS no deja leerlo.

**Permiso: `product.read`.** Una etiqueta solo muestra lo que el anaquel ya muestra, así que puede imprimirla quien puede ver productos (dueño, encargado y cajero). La tabla de permisos (ADR 0042) y `docs/permisos.md` ya la listan. En el panel, la pantalla vive bajo `/catalog`, que es del dueño y del encargado.

**Qué dice cada etiqueta.**
- Precio de **una unidad base** con IVA, redondeado al centavo con la misma regla de una línea de venta (`LineAmount`, ADR 0011): `$12.35 / m`, `$45.50 / kg`, `$135.50` por pieza. Sin precio dice «Sin precio».
- El código es el de tipo `barcode`; si no hay, el primer código alterno; si no hay ninguno, la etiqueta sale sin barras.
- Un nombre largo se corta en dos renglones con «…».

**Simbología del código.** El lector manda exactamente lo que lee, y eso debe coincidir con el código guardado.

Opciones:
1. Todo en Code 128.
2. EAN-13 cuando el código es un EAN-13 válido (13 dígitos con dígito verificador correcto) y Code 128 para todo lo demás.
3. También UPC-A y EAN-8.

Se eligió la 2. EAN-13 es lo que el lector ya lee en la mercancía y se ve igual que la etiqueta del fabricante. Un código de 12 dígitos (UPC-A) dibujado como EAN-13 llevaría un cero de más al leerse y no coincidiría; Code 128 lo conserva tal cual, con letras y símbolos.

**El formato está detrás de una interfaz (principio abierto-cerrado).** `LabelLayout` define `id`, tipo de contenido, extensión y `render(List<ShelfLabel>)`. Cada formato es un bean de Spring y `ShelfLabels` los recibe todos y los busca por `id`. Agregar una impresora térmica es una clase nueva; no se edita ni el servicio ni el controlador.

El primer formato es **`letter-24`**: hoja carta, 3 columnas por 8 renglones, línea punteada para recortar. Funciona con cualquier impresora de oficina y con papel normal o adhesivo.

**Librería: OpenPDF 3.0.5.**
- Es la última versión, con licencia LGPL/MPL, y OSV no le conoce vulnerabilidades.
- Trae Code 128 y EAN-13 sin otra dependencia.
- La versión 3 cambió el paquete a `org.openpdf`.
- Se excluye `brotli4j`: solo sirve para leer PDF 2.0 comprimidos con Brotli, el núcleo nunca lee PDF y trae bibliotecas nativas.
- Las fuentes son Helvetica estándar con Cp1252: tienen acentos y eñe y no hace falta incrustarlas.

Se descartaron JasperReports (demasiado para una hoja) y generar el PDF en el navegador (la caja y el panel tendrían que repetir la lógica de precio y código).

**Pruebas.**
- Unitarias: leen el texto del PDF con el extractor de OpenPDF (nombre, precio, código), cuentan los dibujos de barras por página y revisan el salto de hoja.
- Unitarias del lector: dibujan las mismas barras como imagen y las decodifican con ZXing (solo en pruebas), como lo haría un lector. Así se comprueba que un EAN-13 se lee con sus 13 dígitos y un Code 128 con letras y diagonales.
- De API, con Keycloak y PostgreSQL reales: búsqueda, orden y copias, permisos, aislamiento entre negocios y validaciones.

**Panel.** `/catalog/labels` busca en el servidor con el token de la sesión, lista las coincidencias con casillas (todas marcadas), pide las copias y descarga por `POST /catalog/labels/pdf`. Ese manejador llama al núcleo, así que el token nunca llega al navegador. La cookie es `SameSite=Lax`, así que otro sitio no puede disparar la descarga. La pantalla tiene sus propios archivos para no chocar con las pantallas de catálogo de F0-21.

## Consecuencias
- Imprimir una hoja y escanear sus códigos con el lector de la tienda queda en la lista de pruebas físicas de `progreso.md`. ZXing no sustituye al lector real, la impresora ni el papel.
- Una impresora térmica de etiquetas (por ejemplo ZPL) será otro `LabelLayout` con su propio `id`.
- El menú del catálogo (F0-21) enlaza «Etiquetas», y una búsqueda con resultados ofrece imprimir sus etiquetas.
