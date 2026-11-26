# ADR 0077: Retomar la caja sin corte de un día atrasado

Estado: Aceptada · Fecha: 2026-11-25 · Concreta E1-61. **Reemplaza** de la ADR 0076 las secciones «Una caja aparte para el día atrasado» y «Si ese día ya tuvo corte»; el resto de la 0076 sigue vigente. Se apoya en los ADR 0011 (dinero en enteros), 0029 (sesión de caja), 0030 (una venta nunca cambia), 0047 (`OwnerGate`), 0060 (zona horaria de la caja) y 0070 (fondo al entrar y corte al salir).

## Contexto
Con E1-60, elegir un día pasado al entrar abría **siempre una sesión nueva** con su propio fondo. Pero el caso real del dueño es otro: la cajera abrió la caja ayer, no alcanzó a registrar todas las ventas y salió con «No hacer corte y salir» (E1-54). Hoy quiere terminar **esa** caja: agregar lo que faltó y hacer su corte, sin fondo nuevo y sin otra sesión. Además, antes de E1-61 una caja que quedaba abierta de un día para otro se volvía la caja de hoy sin que nadie lo notara, y mezclaba el efectivo de dos días en un corte.

## Decisiones

**Cada sesión pertenece a un día.** `cash_session.session_day` guarda el día de la sesión: el que captura (si es atrasada) o el día local en que se abrió. La caja lo escribe al abrir, y la base lo exige: un disparador lo completa si alguien inserta una sesión sin él, otro impide que cambie, y el índice único pasa a «una abierta por negocio, día y tipo» (de hoy o suplementaria). La caja de hoy es la sesión abierta cuyo día es hoy; **una sesión de un día pasado nunca es la caja de hoy**, aunque siga abierta.

**Elegir un día con caja sin corte la retoma.** «Día de captura» muestra en cada día pasado «· caja sin corte» o «· ya tiene corte», y al elegirlo dice quién abrió esa caja, a qué hora y con qué fondo. Entrar a ese día **retoma esa misma sesión**: mismo id, mismo fondo, sin pedir fondo nuevo. Sigue la regla de E1-60: un día pasado lo autoriza un dueño (el dueño que entra, o el PIN de un dueño si entra una cajera). La bitácora guarda `session.backdated_capture` y además `cash_session.resumed` con quién retomó, quién abrió la caja, su fondo y quién autorizó. Se ve la franja de captura atrasada, y terminar es hacer el corte de esa sesión como siempre («Corte de caja del lunes 23»), que queda como `cash_session.closed_resumed`. Salir otra vez sin corte la deja pendiente para la próxima.

**Quién queda como vendedor.** Cada venta agregada lleva como cajero a **quien la registró al retomar** (`sale.cashier_id`), no a quien abrió la caja: la sesión conserva `opened_by` y la bitácora dice las dos personas. Así nadie aparece vendiendo lo que no vendió.

**El día de la venta.** Una venta toma el día de su sesión: si se registra en una sesión de un día anterior al de hoy, lleva `business_day` de ese día y `business_at` a la misma hora local (la regla de la 0076), y cuenta en ese día en todos los reportes y en la sincronización (`businessDate`). El disparador de la base acepta el día de la sesión, sea la atrasada de E1-60 o la retomada. Consecuencia buscada: una venta registrada después de medianoche en un turno que empezó el día anterior cuenta en el día del turno. La persona que entró con «Hoy» conserva su caja aunque pase la medianoche, porque el día de trabajo se fija al entrar.

**Si el día ya tuvo corte.** El corte nunca se edita. Si el día elegido no tiene caja sin corte pero ya tiene corte, la entrada **no abre nada en silencio**: explica que ese corte no cambia y ofrece una **captura suplementaria**, que hay que marcar («Agregar una captura suplementaria al …»); sin la marca, el proceso principal responde `day_already_cut` y no entra nadie. La captura suplementaria es una sesión aparte de ese día (fondo normalmente $0), ligada al último corte del día por `amends_cut_id`, y su corte, «Corte suplementario del …», muestra el **corte corregido del día**: lo que esperó y contó el corte original, intacto, y el día completo sumado. Un día sin ninguna sesión (la tienda no abrió la caja) abre una para él como en E1-60.

**Una a la vez y sin mezclar.** La persona trabaja sobre una sola sesión, la del día que eligió al entrar; para cambiar de día sale y vuelve a entrar. La caja de hoy y una sesión retomada nunca se mezclan: las devoluciones y los gastos pagados del cajón siguen saliendo de la caja de hoy. La entrada avisa cuando, al elegir «Hoy», quedan cajas sin corte de otros días.

**Cajas sin corte viejas.** Un día con caja sin corte se ofrece **aunque sea más viejo que la ventana de 7 días**, porque esa caja necesita su corte.

**Lo que pasa con lo de antes (migración local 24).** Las sesiones **abiertas** reciben su día al actualizar: el que capturan si son de E1-60, o el día local en que se abrieron (`date(opened_at, '-6 hours')`: America/Mexico_City no cambia de horario desde 2022, así que es exacto para cualquier sesión que siga abierta). Las cerradas se quedan sin día porque una sesión cerrada no cambia; su día se lee igual que en los reportes (el que capturan o el día local de apertura). Una caja que quedó abierta varios días antes de esta versión aparece como «caja sin corte» de su primer día: al retomarla se corta y su corte incluye lo que se vendió en ella esos días, como habría pasado antes. Una sesión atrasada de E1-60 que siga abierta se retoma igual que cualquier otra; las ya cortadas cuentan como cortes de su día.

**Núcleo.** No cambia: la sesión retomada ya viajó como `cash_session.opened` sin `businessDate` y el núcleo le da el día local de su apertura, que es el mismo; sus ventas viajan con `businessDate`, y su corte no lo necesita.

## Alternativas descartadas
- **Seguir abriendo una sesión nueva (E1-60):** obliga a un segundo fondo y un segundo corte para la misma caja física, y deja la primera abierta para siempre.
- **Cerrar automáticamente la caja de ayer al entrar hoy:** inventaría un corte que nadie contó.
- **Editar el corte original al agregar ventas a un día cortado:** rompe la regla de que un corte nunca cambia; el corte corregido se arma sumando, sin tocar el original.
- **Calcular el día de la sesión en cada consulta sin guardarlo:** SQLite no conoce zonas horarias y el índice único necesita una columna.

## Consecuencias
- Un día puede tener su caja retomada más de una vez hasta que se corte, y varios cortes suplementarios después.
- La pantalla de entrada recibe `pastDays` con el estado de cada día; el contrato de sincronización no cambia.
