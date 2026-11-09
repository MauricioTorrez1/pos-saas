# ADR 0028: Tarjeta tecleada, cajón por la impresora y cantidades medidas

Estado: Aceptada · Fecha: 2026-11-08 · Concreta RF-012, RF-016 y el ADR 0026.

## Contexto
Tres tareas de la caja se hicieron juntas: E1-12 (tarjeta cobrada en la terminal aparte, con el folio tecleado), E1-14 (cajón) y E1-08 (venta por peso y por metro). Cada una tuvo una decisión que valía anotar.

## Opciones
**Qué se guarda de una tarjeta tecleada**
1. **El folio que da la terminal.** Sirve para conciliar después contra el estado de cuenta, y no es dato de tarjeta.
2. **Folio y últimos cuatro dígitos.** Ayuda a conciliar, pero abre la puerta a que el cajero teclee el número completo.

**Cómo abre el cajón**
1. **Con un comando ESC/POS por la impresora.** Los cajones de las tlapalerías cuelgan de la impresora, sin conexión propia.
2. **Por un puerto aparte.** Hace falta otro aparato y otra configuración.

**Qué hace la caja con una cantidad medida**
1. **Pregunta cuánto antes de agregar, muestra el importe y pide confirmar lo que pasa del límite.**
2. **Agrega una unidad y deja corregir en la línea.** El 125 en lugar de 1.25 pasa desapercibido, y un escaneo agrega un kilo que nadie pesó.

## Decisión
- Opción 1 en las tres preguntas.
- **Tarjeta:** el método es `card_manual` y su folio es obligatorio en la pantalla, en el proceso principal y en la base (migración 7, que reemplaza los disparadores de la migración 5). Un folio con 13 dígitos seguidos o más, con o sin espacios y guiones, se rechaza como posible número de tarjeta: la caja nunca guarda uno (invariante 11). La tarjeta es un pago exacto, como la transferencia, así que no da cambio. F7 llena la parte que falta.
- **Cajón:** `PrinterCashDrawer` manda `ESC p 0 25 250` como un trabajo aparte. Como pasa por la impresora, sin impresora el cajón no abre, y `SaleCheckout` ya lo abre solo después de guardar la venta (ADR 0010): si la venta no se guardó, no se manda nada.
- **Cantidades:** un producto que no es pieza abre un diálogo de cantidad con el importe a la vista (3.275 m a $12.50 dan $40.94). El límite es 50 kg, 100 m o 50 L por línea: arriba de eso, Enter no agrega, y solo F2 confirma. Con eso el Enter de un escaneo, que escribe un código de 13 dígitos, nunca agrega una línea. La cantidad nueva se suma a la línea que ya existe.
- **`ManualScaleProvider`:** la ficha lo pedía, pero hoy la captura vive en la pantalla y no necesita una interfaz de aparato. `ScaleProvider` queda para la báscula USB, que llegará con el aparato.

## Consecuencias
- El corte (E1-23) separa efectivo, transferencia y tarjeta por `payment.method`. La tarjeta tecleada es neta, sin cambio.
- Si el folio está mal, la venta ya está cobrada: se concilia contra el estado de cuenta y se corrige con una nota, no editando el pago, porque un pago nunca cambia.
- La apertura del cajón no se audita todavía. Abrirlo sin venta y su bitácora llegan con los roles (F0-14) y el PIN (E1-04).
- Probar el cajón y la impresora juntos queda en la lista de pendientes antes del piloto, porque las pruebas solo ven bytes.
- Los límites de 50, 100 y 50 viven en el código. Si la tienda vende más de eso con frecuencia, se suben sin migración.
