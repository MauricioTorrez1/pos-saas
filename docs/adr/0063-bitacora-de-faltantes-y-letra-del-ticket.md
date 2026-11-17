# ADR 0063: Bitácora de faltantes y letra del ticket

Estado: Aceptada · Fecha: 2026-11-17 · Concreta E1-49. Se apoya en los ADR 0028, 0059, 0060 y 0061. Amplía el diseño del ticket del ADR 0061.

## Contexto
Mauricio pidió dos cosas antes de la siguiente tanda:
1. Una bitácora de **faltantes**: la mercancía que un cliente pide y la tlapalería no tiene. Sirve para decidir qué empezar a vender y debe poder descargarse en PDF con gráficas.
2. Elegir en el diseño del ticket la **fuente** y el **tamaño de letra**.

## Decisiones

**Faltantes: un renglón por cada vez que se pide.** La tabla local `missing_item_request` (migración 19) guarda cada vez como un hecho que no cambia, igual que una venta. Cada renglón lleva:
- qué pidió el cliente;
- cuántos quería (opcional, entero);
- notas (marca, medida, color);
- quién lo anotó y cuándo.

Un disparador impide editar un renglón.

Opciones que se consideraron:
1. Un renglón por producto con un contador.
2. Un renglón por cada vez que se pide.
3. Ligar cada faltante a un producto del catálogo.

Se eligió la 2. Contar al leer deja ver tendencias por semana y por día, y una edición nunca borra una vez. Lo que se pide casi nunca está en el catálogo, así que no se liga a un producto.

Las veces del mismo producto se juntan por una **llave** sin acentos, mayúsculas ni espacios de más: «Pintura VINÍLICA» y «pintura vinilica» cuentan juntas.

**Lo que decide el dueño.**
- «Ya lo vendemos» y «Descartar» se guardan aparte, en `missing_item_status` (una fila por llave).
- «Volver a pendiente» borra esa fila.
- Cada decisión queda en la bitácora de auditoría (`missing_item.resolved`).
- Cualquiera con sesión iniciada puede anotar un faltante; solo el dueño decide.

**Dónde se anota.**
- Botón «Faltantes» en el encabezado.
- Atajo Mayús+F2, que se puede cambiar (ADR 0061).
- Cuando una búsqueda por nombre no encuentra nada, el aviso ofrece «Anotar como faltante» con el texto ya escrito. Con un escaneo no se ofrece, porque un código suelto no dice qué pidió el cliente.

**Lectura y PDF.** La pantalla se lee por periodo: 30 días, 3 meses, un año o desde el principio. Muestra:
- los totales;
- lo más pedido, con una barra proporcional;
- una gráfica por semana, que incluye las semanas sin faltantes (máximo 52);
- una gráfica por día de la semana.

El PDF usa la impresión de Electron, como el Resumen (ADR 0060). La página no corre scripts, así que el proceso principal dibuja las tres gráficas como SVG. Todo texto escrito por personas se escapa, y la página bloquea la red.

**Sin sincronizar todavía.** La bitácora vive en la caja. Subirla al núcleo queda con E1-46, junto con los demás eventos locales que hoy van a cuarentena.

**Letra del ticket.** El diseño suma dos campos:
- `font`: `a` (normal) o `b` (compacta). Usa el comando ESC M.
- `textSize`: `normal`, `tall` (doble de alto) o `large` (doble de alto y de ancho). Usa el comando GS !.

`ticketLineWidth` calcula cuántas letras caben por renglón:
- En la fuente B cabe un tercio más: 32→42, 42→56 y 48→64 letras.
- Con letra grande cabe la mitad.
- El total grande es el doble de ancho que el resto del ticket.

Compatibilidad:
- Un diseño guardado antes de este cambio se lee con fuente A y tamaño normal.
- El ticket por defecto produce los mismos bytes que antes.

La vista previa achica o agranda la letra y estira las líneas altas para parecerse al papel.

## Consecuencias
- Hay una migración local nueva (19), que solo agrega tablas.
- La caja pasa a la versión 0.2.1.
- Falta probar en la tienda:
  - la fuente B y los tamaños en la impresora real, porque hay modelos que ignoran ESC M;
  - el PDF abierto en la PC de la tienda.
