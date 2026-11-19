# ADR 0074: Preguntar si imprimir el ticket después de cada venta

Estado: Aceptada · Fecha: 2026-11-18 · Concreta E1-59. Se apoya en los ADR 0010 (orden del cobro: guardar, cobrar, completar, cajón, impresora), 0028 (impresora compartida y cajón colgado de ella), 0061 (diseño del ticket y teclas configurables) y 0067 (búsqueda de ventas).

## Contexto
Hasta la caja 0.2.7, cada venta imprimía su ticket en cuanto quedaba registrada, con las copias del diseño. En la tienda muchos clientes no quieren ticket: se gasta papel y el cajero lo tira. Mauricio pidió que, después de cobrar, la caja pregunte «¿Imprimir ticket?», que el dueño elija si pregunta, imprime siempre o nunca imprime, y que una venta sin ticket se pueda imprimir después. La venta no se puede perder ni registrar dos veces por la pregunta, y la caja sigue vendiendo sin impresora y sin internet.

## Decisiones

**La venta se guarda antes de la pregunta.** El cobro sigue el orden de ADR 0010 hasta abrir el cajón; lo único que cambia es si el paso de la impresora corre en ese momento. `SaleCheckout.checkout` recibe `{ printTicket }` y `SalePayments` decide con la preferencia del dueño. La respuesta del cajero no toca la venta: solo decide si sale papel. Cerrar la caja con la pregunta abierta deja la venta cobrada y sin ticket.

**La preferencia vive en el diseño del ticket.** `TicketDesign.printPolicy` es `ask` («Preguntar siempre»), `always` («Imprimir siempre», lo de antes) o `never` («Nunca imprimir»), en «Ajustes → Diseño del ticket → Al cobrar». El valor de fábrica es `ask`. Un diseño guardado antes de E1-59 no trae el campo; `ToolsStore` ya mezcla lo guardado sobre el diseño de fábrica, así que se lee como `ask` sin migración. Se eligió `ask` y no `always` para los diseños viejos porque es lo que Mauricio pidió para la tienda y porque preguntar no pierde nada: Enter imprime igual que antes con una tecla más.

**El diálogo.** Con `ask`, el diálogo de cobro cambia a «Venta registrada»: folio, cambio a entregar (sigue a la vista), avisos de otros aparatos y «¿Imprimir ticket?». «Imprimir» tiene el foco y responde a **Enter**; «No imprimir» responde a **Esc** o **N**. Responder termina la venta y abre la siguiente, sin otra pantalla. Si la impresora falla, el diálogo pasa a la vista de «Venta cobrada» con el aviso de siempre («La venta quedó registrada, pero falló un aparato: …») y el cambio a la vista; Enter abre la siguiente venta. Un segundo Enter mientras se imprime no manda otro ticket. Con `always` y `never` no hay pregunta y se queda la vista de antes.

**El cambio de la respuesta.** El cambio no se guarda en la venta (ADR 0010), pero el primer ticket lo lleva. `SalePayments` recuerda en memoria solo la última venta que espera respuesta, con su cambio; al imprimirla con `printSaleTicket` el ticket sale como si se hubiera impreso al cobrar, con todas sus copias. Una venta anterior, o la misma después de reiniciar, se imprime sin cambio: un ticket nunca inventa el cambio.

**Se anota en la bitácora, no en la venta.** La venta es inmutable, así que «salió el ticket» es un hecho aparte en `audit_log` (entidad `sale`): `sale.ticket_not_printed` cuando se registra sin ticket (se pregunta, nunca se imprime, la impresora falló o es una venta recuperada tras un corte de luz) y `sale.ticket_printed` cada vez que el ticket llega a la impresora. Una venta **sin** entradas se imprimió: todas las anteriores a E1-59 imprimían al cobrar. Una venta tiene su ticket si no tiene `ticket_not_printed` o tiene algún `ticket_printed` (`ticketPrintedSql`, el mismo SQL para `TicketPrintLog.wasPrinted` y para la lista de ventas). La entrada de «sin ticket» se escribe al cobrar, antes de la respuesta, para que una pregunta nunca contestada se lea como sin ticket. Se usa la bitácora que ya existe, con su índice por entidad, y no una tabla nueva: no hay migración que choque con las de otras tareas.

**Imprimir después.** «Reimprimir» (F8) y la lista de «Ventas» imprimen el ticket de una venta sin ticket como su **primer** ticket, sin la marca «REIMPRESIÓN» y con las copias del diseño; una venta que ya tuvo ticket sale marcada como reimpresión y en una sola copia, como antes. En «Ventas», una venta sin ticket lleva la etiqueta «Sin ticket» y el botón «Imprimir ticket»; las demás, «Reimprimir». El canal `sales:print-ticket` recibe el UUID de la venta y responde `printed`, `not_found` o `printer_failed`.

## Alternativas descartadas
- **Una columna `ticket_printed` en `sale`:** rompe la regla de que la venta no cambia después de completarse y obliga a una migración local que chocaría con las de las tareas que corren a la vez.
- **Una tabla nueva de impresiones:** sería el registro ideal si se consultara mucho, pero la bitácora ya es solo de agregar, tiene índice por entidad y se respalda con la caja; si algún día pesa, se pasa a una tabla con un ADR nuevo.
- **Preguntar antes de cobrar:** el cajero contestaría antes de saber si el cobro pasó, y una venta rechazada habría hecho una pregunta inútil.
- **Guardar el cambio en la venta para imprimirlo siempre:** cambiaría lo que la venta guarda solo para el papel; el cambio de un ticket impreso después se omite, como en las reimpresiones de siempre.
- **No preguntar cuando no hay impresora configurada:** se descartó para que la caja se comporte igual con y sin impresora; sin impresora el trabajo va a la de respaldo en memoria, como desde ADR 0028.

## Consecuencias
- El cajero contesta con una tecla y el cambio sigue a la vista; con «Imprimir siempre» la caja se comporta como en 0.2.7.
- El dueño ve en «Ventas» qué ventas se fueron sin ticket y puede imprimirlas cuando el cliente regresa.
- Las ventas recuperadas tras un corte de luz se leen como sin ticket, porque nunca lo imprimieron.
- Si una caja se cierra entre el cobro y la anotación de «sin ticket», la venta se lee como impresa; es la misma ventana de un instante que ya tienen los avisos de los aparatos y no pierde la venta.
