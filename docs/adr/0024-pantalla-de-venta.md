# ADR 0024: Pantalla de venta con búsqueda FTS5 y apariencia acotada

Estado: Aceptada · Fecha: 2026-11-08 · Concreta RF-011, RNF-02 y RNF-13.

## Contexto
E1-07 hace la primera pantalla real de la caja. Agregar un producto debe tardar menos de 100 ms (p95) con 5,000 productos, y debe poder encontrarse por nombre si no tiene código. El lector de códigos funciona como un teclado, así que la pantalla no recibe nada que diga «esto viene del lector». RNF-13 pide que el dueño personalice la apariencia sin tocar código, y faltaba definir qué podrá cambiar. El catálogo real llega con F0-16, y hasta entonces los productos son de prueba (ADR 0019).

## Opciones
**Cómo buscar por nombre**
1. **FTS5 de SQLite.** Índice de palabras, con búsqueda por el principio de cada palabra y sin distinguir acentos.
2. **`LIKE '%texto%'`.** No usa índice, recorre todos los productos en cada tecla y no ignora acentos.
3. **Catálogo completo en la memoria de la pantalla.** Rápido, pero duplica 5,000 productos y hay que mantenerlos al día.

**Cómo distinguir el lector de una persona**
1. **Por la velocidad entre teclas.** No pide configurar el lector y funciona con cualquier modelo.
2. **Con un prefijo programado en el lector.** Es exacto, pero hay que configurar cada lector, y si se reinicia deja de funcionar.

**Qué puede cambiar el dueño**
1. **Un conjunto corto y seguro:** nombre del negocio, color de una paleta revisada, tamaño de letra y tema claro u oscuro.
2. **Lo anterior más logotipo.** Pide manejar archivos y abrir la política de seguridad de la pantalla.
3. **Todo: colores libres, acomodo y atajos.** Se puede romper la lectura de la pantalla, y soporte tendría cajas distintas entre sí.

## Decisión
- Opción 1 en las tres preguntas.
- La búsqueda vive en `src/main/local-store`, con sentencias preparadas. Cada palabra tecleada va entre comillas, así que `1/2"` o `AND` son solo texto a buscar. Con 5,000 productos no hace falta un `worker` (ver mediciones).
- `product` tiene una llave entera explícita (`local_rowid`) además de su UUIDv7, porque `VACUUM` puede renumerar una llave implícita y el índice de búsqueda apunta a ella. El índice se mantiene con disparadores.
- **Lector:** una lectura son al menos 4 caracteres con no más de 50 ms entre ellos, medidos con el momento en que se oprimió la tecla (`KeyboardEvent.timeStamp`). Una persona rápida tarda unos 100 ms. La búsqueda por nombre espera 80 ms sin teclas, así que una ráfaga del lector nunca llega a ella.
- **Enter:** primero se busca el código exacto, venga de donde venga. Si no existe y lo mandó el lector, se avisa y no se agrega nada. Si lo tecleó una persona, se agrega el resultado resaltado de la lista.
- La caja de búsqueda siempre tiene el teclado: al perderlo lo recupera, salvo con un diálogo abierto. No es un campo controlado de React, para no redibujar la pantalla en cada tecla de una ráfaga.
- **Teclado:** Enter agrega, flechas mueven, `+` y `−` cambian la cantidad, Supr quita, Esc limpia y F9 abre la apariencia. `+`, `−` y Supr solo actúan con la caja vacía, porque también son caracteres que se pueden teclear. La cantidad no baja de una unidad: quitar una línea requiere su propia tecla.
- **Apariencia:** nombre (hasta 40 caracteres), seis colores, tres tamaños y dos temas. Vive en la tabla `register_appearance`, por negocio y por caja. Se ve en vivo y solo queda al guardar. Una prueba revisa que el texto de cada color y de cada tema cumpla el contraste AA (4.5:1), así que un color nuevo no puede volver ilegible la caja.
- **Diseño:** la pantalla toma su lenguaje del mostrador: el total es una etiqueta de precio colgante, y los colores se eligen como en un muestrario de pintura. Usa Bahnschrift, que viene con Windows 10 y 11, y no agrega archivos de fuentes.
- **Productos de prueba:** una lista de 33 productos con códigos EAN-13 válidos que empiezan con 2, reservados para uso interno de una tienda. Se siembran solo si el catálogo está vacío y quedan con `is_sample = 1`. Todas las filas llevan un `tenant_id` provisional hasta que F0-15 registre la caja.

## Consecuencias
- Medido en la PC de desarrollo con Playwright, 5,000 productos y 200 lecturas, desde Enter hasta que la venta cambia en pantalla: p50 de 15.1 ms, p95 de 24.5 ms y máximo de 73.7 ms. La búsqueda por nombre, a través del puente: p95 de 4.0 ms. RNF-02 se verifica en la PC de la tienda, y eso queda pendiente antes del piloto.
- La medición llega hasta que la venta cambia en la página y no incluye el dibujado final, de unos 16 ms. No espera un cuadro de animación porque el navegador los detiene si la ventana queda tapada.
- Hasta que existan los roles (F0-14) y el PIN (E1-04), cualquiera en la caja puede cambiar la apariencia. Cuando existan, se limita al dueño.
- Un lector configurado con pausas largas entre caracteres se trataría como tecleo. La venta sigue funcionando, porque Enter busca primero el código exacto. Solo cambia que un código inexistente haría una búsqueda por nombre.
- Fuera de Windows no hay Bahnschrift y se usa la fuente del sistema. Las pruebas en Linux no revisan cómo se ve.
- `+` suma una unidad entera. Capturar 3.275 m o 1.250 kg llega con E1-08. El botón de cobro llega con E1-11.
- Agregar logotipo o más colores no rompe nada: los valores permitidos viven en el código, no en la tabla.
