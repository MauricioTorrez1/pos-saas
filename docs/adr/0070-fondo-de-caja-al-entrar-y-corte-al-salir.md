# ADR 0070: Fondo de caja al entrar y pregunta de corte al salir

Estado: Aceptada · Fecha: 2026-11-18 · Concreta E1-54. Se apoya en los ADR 0011 (dinero en enteros) y 0029 (una transacción por cambio), y en la caja de E1-21 a E1-23 (apertura, movimientos y corte).

## Contexto
En la tienda, una cajera podía entrar y cerrar el diálogo de apertura con Esc, así que no quedaba claro con cuánto efectivo empezó el turno. Tampoco había nada que recordara hacer el corte al cerrar la caja: la X, Alt+F4 o el menú cerraban la ventana sin preguntar. El dueño, en cambio, a veces entra solo a revisar productos o el resumen y no quiere abrir caja.

## Decisiones

**Fondo al entrar.** Si al entrar no hay sesión de caja abierta, aparece «Abrir la caja» en modo apertura. Una cajera no puede saltárselo: Esc no hace nada y solo tiene «Abrir caja» o «Cambiar de persona». El dueño ve además «Solo administrar» (Esc). Se reutiliza la apertura que ya existía (`CashService.open`), que ahora escribe `cash_session.opened` en la bitácora con quién y cuánto, en la misma transacción que la sesión y la operación de sincronización. No se pide «una sesión por día»: si hay una sesión abierta, sea de otro turno o de antes de reiniciar, no se vuelve a preguntar y el encabezado dice quién la abrió y cuándo.

**Solo administrar.** Es un estado de la pantalla, no del proceso principal: la caja ya rechazaba guardar una venta sin sesión (`no_cash_session`). La pantalla además frena el cobro antes de guardar, con el aviso «No se puede cobrar… Ábrela con su fondo de caja (F3)» y abre el diálogo de apertura. Un aviso fijo con el botón «Abrir caja» queda visible mientras la caja no esté abierta.

**El cierre lo decide el proceso principal.** La X, Alt+F4 y salir del menú terminan en el evento `close` de la ventana, así que `ExitGuard` (`main/exit`) se pone ahí. Sin caja abierta deja cerrar. Con caja abierta cancela el cierre y le pregunta a la pantalla (`exit:requested`), que contesta `received` de inmediato y luego `leave_open`, `cut_done` o `cancel`.
- «No hacer corte y salir» deja la sesión abierta y escribe `cash_session.exit_without_cut` con quien está en la caja, o con quien la abrió si nadie ha entrado.
- «Hacer corte de caja» abre el corte de siempre; al terminarlo, el proceso principal revisa que la sesión sí quedó cerrada antes de cerrar la ventana. Salir del corte con Esc cancela el cierre. Desde la pantalla de entrada, el corte pide primero el PIN.
- Una respuesta que nadie pidió se ignora, así que la pantalla no puede cerrar la caja por su cuenta.

**Un cierre forzado nunca se bloquea ni pierde datos.** Cada venta, movimiento y corte ya está confirmado en SQLite cuando sucede, así que lo único que se pierde al cerrar es la pregunta. Por eso el guardia nunca detiene un cierre que no puede preguntar: si la pantalla no contestó `received` y llega un segundo cierre, está congelada y se deja cerrar; si la pantalla se cayó (`render-process-gone`) o Windows se apaga (`session-end`), también. En todos esos casos queda una línea en la bitácora con el motivo. Las ventas pendientes de pago conservan su guardia de siempre: se preguntan al volver a abrir.

## Alternativas descartadas
- **`beforeunload` en la pantalla:** no sirve para un cierre desde el menú ni deja contestar con dos botones, y una pantalla congelada impediría cerrar.
- **Cerrar la sesión de caja en automático al salir:** haría cortes sin contar el efectivo, que es justo lo que el corte cuida.
- **Pedir el fondo una vez por día calendario:** en la tienda un turno cruza la medianoche a veces y el corte es el que manda, no el reloj.
- **Bloquear el cobro en el proceso principal con un modo «solo administrar»:** ya está bloqueado sin sesión; otro estado del lado principal no añade seguridad.

## Consecuencias
- Las pruebas de Playwright que cierran la caja con la sesión abierta usan `quitRegister`, que contesta la pregunta como lo haría una persona.
- La bitácora ahora tiene la historia de cada turno: quién abrió, con cuánto, y si alguien salió sin corte.
- Si un cierre forzado deja la sesión abierta, el siguiente que entra la ve abierta y hace el corte normal.
