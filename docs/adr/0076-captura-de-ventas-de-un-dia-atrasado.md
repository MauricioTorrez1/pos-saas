# ADR 0076: Capturar las ventas de un día atrasado

Estado: Aceptada · Fecha: 2026-11-18 · Concreta E1-60. Se apoya en los ADR 0011 (dinero en enteros), 0029 (sesión de caja), 0030 (una venta nunca cambia), 0046 (recepción idempotente), 0047 (`OwnerGate`), 0060 (tablero y zona horaria de la caja), 0070 (fondo al entrar y corte al salir) y 0072 (estado de resultados).

## Contexto
Hay días en que la cajera no alcanza a registrar todas las ventas: se va la luz, hay fila o se cobra a mano. Al día siguiente quiere capturarlas, pero hoy cada venta cuenta en el día en que se registra, así que las de ayer se sumarían a hoy y descuadrarían las dos cajas, el resumen y el estado de resultados. La regla de dominio sigue: nada se edita ni se borra, solo se agrega.

## Decisiones

**El día se elige al entrar.** Si la caja tiene días para capturar, la pantalla de entrada muestra «Día de captura» con **Hoy** primero. Un día pasado lo autoriza un dueño: el dueño que entra lo autoriza al entrar, y una cajera escribe además el PIN de un dueño (la misma regla de `OwnerGate`, con sus intentos y su bloqueo). Si algo se rechaza, nadie queda dentro. La entrada a un día pasado queda en la bitácora como `session.backdated_capture`, con quién y quién autorizó. El día vive en memoria con la persona: salir lo olvida.

**Una ventana corta.** Se ofrecen hoy y hasta **7 días atrás**, nunca un día futuro y nunca antes del día de la **primera sesión de caja**. Esto cambia la recomendación «antes de la primera venta» por una razón: una caja que se estrenó ayer y no alcanzó a vender todavía merece capturar ese día, y como una venta siempre necesita una sesión, la primera sesión nunca es posterior a la primera venta. La lista la calcula el proceso principal (`CaptureDays`) con el reloj y la base; la pantalla solo la muestra, y un día fuera de la lista se rechaza aunque llegue por el puente.

**Un aviso que no se puede ignorar.** Mientras dura la sesión, una franja de color de advertencia dice «Capturando ventas del martes 17 de noviembre. No cobres aquí las ventas de hoy». La apertura de caja y el corte también nombran el día.

**Dos tiempos por venta.** La venta conserva `occurred_at` y `resolved_at`, el momento real en que se registró, que ordena la bitácora y la sincronización. Agrega `business_day` (el día elegido) y `business_at`: el momento real trasladado a ese día, a la misma hora local (`momentOnDay`). Los reportes leen `coalesce(business_at, resolved_at)`, así que el resumen, «Más vendidos», las horas, el estado de resultados y el reporte diario ponen la venta en su día sin cambiar cómo cuentan; una venta de hoy tiene los dos en `NULL` y nada cambia para ella. Un índice de expresión sobre ese mismo `coalesce` mantiene rápidas las consultas por periodo. Las horas del día atrasado son la hora en que se capturó: es lo único que se sabe y se dice aquí. Los movimientos de inventario de esas ventas llevan `business_day` y el kárdex lo muestra («· del martes 17 de noviembre»); la existencia sigue siendo la suma del libro.

**Una caja aparte para el día atrasado.** Una captura atrasada abre **su propia sesión de caja** con `business_day`, con su fondo (normalmente $0) y su corte, y nunca se mezcla con el cajón de hoy: las dos pueden estar abiertas a la vez, pero nunca dos del mismo día (el índice único pasa de «una abierta por negocio» a «una abierta por negocio y día»). La venta toma el día de su sesión, y un disparador lo exige en la base. La apertura queda como `cash_session.opened_backdated` y el corte como `cash_session.closed_backdated`; los eventos de sincronización llevan `businessDate`.

**Si ese día ya tuvo corte.** El corte de un día no se toca nunca. Las ventas capturadas después tienen su **corte suplementario**: el de la sesión atrasada, que la pantalla titula «Corte suplementario del …». El efectivo de esas ventas casi siempre ya está en el cajón (o salió como sobrante en el corte de ese día), así que se reconcilia así: se abre la captura con fondo $0, se registran las ventas, y al cortar se cuenta el efectivo que se apartó para ellas; si no se apartó, el corte suplementario sale con diferencia y la razón explica dónde quedó. El resumen del día suma el corte original y el suplementario. Si después hace falta otra captura del mismo día, se abre otra sesión suplementaria.

**Lo que sigue siendo de hoy.** Una devolución pasa hoy, así que su reembolso sale siempre del cajón de hoy, aun durante una captura atrasada. Un gasto pagado de la caja también sale del cajón de hoy. Las entradas y salidas a mano durante la captura son de la sesión atrasada, porque se apuntan en su corte.

**El ticket.** Bajo el folio y la hora real dice «Captura atrasada del martes 17 de noviembre»; en papel angosto el día baja a su propio renglón para no cortarse. La reimpresión lo repite.

**Sincronización y núcleo.** El contrato `sync-push-request` agrega `businessDate` **opcional** (`YYYY-MM-DD`) a `sale.completed`, `cash_session.opened` y `cash_session.closed`; sin él, todo significa lo de antes, así que el contrato no cambia de versión (`schemaVersion` sigue en 1) y una caja vieja sigue siendo válida. La idempotencia no cambia: la llave sigue siendo `opId`, y la misma venta enviada dos veces es `duplicate`. El núcleo (migración V16) guarda `sale.business_date` y `cash_session.business_date`: el día enviado o, si no viene, el día local de `completed_at` en America/Mexico_City; un día posterior al que se registró, o que no existe, va a cuarentena. Las filas de antes quedan en `NULL` y se leen con el mismo respaldo, porque las tablas son de solo agregar y no se rellenan. `SaleLookup.dailySales` y `SaleView.businessDate` agrupan y muestran por ese día.

**Facturación (regla del SAT).** La fecha de un CFDI es siempre el momento real en que se emite, nunca el día de negocio: el SAT pide que la fecha de emisión esté dentro de las 72 horas anteriores al timbrado, y no se puede fechar hacia atrás. Una factura individual de una venta atrasada se emite hoy con la fecha de hoy, igual que cualquier otra. Donde sí manda el día de negocio es en la **factura global**: el periodo (`InformacionGlobal`: periodicidad, mes y año) se elige por el día de negocio, así que una venta del 31 capturada el día 1 entra en la global del mes anterior si esa global todavía no se emitió. Si ya se emitió, no se reabre: se confirma con el contador si va en la global del periodo siguiente, y esa duda queda en los pendientes de Mauricio. La caja no factura; esta regla la aplica el núcleo cuando arme la global.

## Alternativas descartadas
- **Editar la fecha de la venta:** rompe la regla de dominio (una venta nunca cambia) y borraría el momento real que necesita la bitácora.
- **Guardar solo `business_day` y calcular el momento en cada consulta:** SQLite no conoce zonas horarias; cada reporte tendría que repetir la conversión por tramos de la zona. Guardar `business_at` una vez deja todas las consultas iguales.
- **Meter la captura en la caja de hoy:** mezclaría el efectivo de dos días en un corte, que es justo el error que la tarea quiere evitar.
- **Una ventana más larga o libre:** cuanto más atrás, más fácil equivocarse de día y menos se parece a la necesidad real (las ventas que no se alcanzaron a registrar ayer). Siete días cubren un fin de semana largo.
- **Un campo obligatorio en el contrato o `schemaVersion: 2`:** obligaría a actualizar todas las cajas al mismo tiempo; un campo opcional es compatible hacia atrás.

## Consecuencias
- El resumen, el estado de resultados, «Más vendidos», el reporte ilustrado y el reporte diario cuentan la venta en el día al que pertenece, y la bitácora y la sincronización siguen viendo cuándo se registró.
- Un día puede tener más de un corte; el reporte ilustrado ya lista los cortes uno por uno.
- La migración local 23 y la del núcleo V16 solo agregan columnas, un índice y disparadores: nada se rellena y una base vieja se lee igual.
