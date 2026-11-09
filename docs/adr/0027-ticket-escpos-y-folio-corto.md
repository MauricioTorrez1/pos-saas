# ADR 0027: Ticket ESC/POS, folio corto y reimpresión

Estado: Aceptada · Fecha: 2026-11-08 · Concreta RF-018 y el ADR 0010.

## Contexto
E1-13 imprime el ticket de una venta completada. La impresora (Epson TM-T20) habla ESC/POS, que son bytes de comandos. El ticket lleva un folio que el cliente pueda dictar para pedir su factura o una devolución, y debe poder reimprimirse sin tocar la venta.

## Opciones
**Cómo llegan los bytes a la impresora**
1. **Impresora compartida de Windows (`\\equipo\nombre`).** Windows acepta bytes crudos escritos a esa ruta, como `copy /b`, y no hace falta un módulo nativo.
2. **Módulo nativo de USB.** Habla directo con el aparato, pero obliga a compilar para Electron y a reemplazar el controlador de Windows.
3. **Imprimir una página con el navegador.** No entiende ESC/POS ni corta el papel.

**De dónde sale el folio**
1. **Un contador por negocio que se asigna al completar la venta.** Corto, sin huecos y fácil de dictar.
2. **Los últimos caracteres del UUIDv7.** No necesita columna, pero puede repetirse y no se lee en voz alta.

**Qué pasa si la impresora falla**
1. **La venta queda registrada y se avisa.** El ticket se puede reimprimir (RF-018).
2. **Deshacer la venta.** El cliente ya pagó, así que sería peor.

## Decisión
- Opción 1 en las tres preguntas.
- `EscPosBuilder` arma los bytes y es lo único que conoce los comandos. El texto nunca lleva comandos: un carácter de control en el nombre de un producto se vuelve un espacio, así que un nombre no puede abrir el cajón ni cortar el papel. Usa la página de códigos 858, con los acentos y los signos de Spanish; lo que no puede dibujar sale como `?`.
- `layoutTicket` arma las líneas de 48 columnas (papel de 80 mm) y `renderTicket` las vuelve bytes. El mismo cálculo de IVA de las líneas (ADR 0023) sale en el ticket, y la misma venta da siempre los mismos bytes.
- **Folio:** `sale.folio` se asigna dentro de la transacción que completa la venta, como el máximo del negocio más uno. Una venta cancelada o pendiente no tiene folio, así que no deja huecos. La base exige que una venta completada tenga folio, que sea único por negocio y que nunca cambie (migración 6). Se escribe `T1-000123`; `T1` es un código provisional hasta que F0-15 registre cada caja.
- **Reimpresión:** F8 imprime la última venta completada, marcada «REIMPRESIÓN». No lleva cambio, porque el cambio no se guarda y no se inventa.
- **Impresora:** `WindowsSharedPrinter` escribe los bytes a la ruta que da `POS_PRINTER_SHARE`. Sin esa variable la caja vende normal y no imprime nada, porque una impresora ausente nunca debe detener una venta.
- Si la impresora falla, `SaleCheckout` ya lo convierte en un aviso (ADR 0010): la venta queda completada y se reimprime con F8.

## Consecuencias
- Probar la impresora real queda pendiente de Mauricio, porque en CI solo hay bytes y falsos: el texto con acentos, el corte y el ancho de las 48 columnas.
- El cajón sigue con el falso hasta E1-14. Su comando ESC/POS se agrega a este mismo generador.
- El folio es por caja. Con varias cajas (F4-05) habrá que anteponer el código de cada una, y por eso el formato ya lo lleva.
- E1-15 (devoluciones) y la factura (E1-31) buscarán por este folio.
- El nombre del negocio sale de la apariencia (ADR 0024). El RFC, la dirección y el leyendas fiscales llegan cuando existan en F0-17 y E1-31.
