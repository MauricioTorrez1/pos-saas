# ADR 0052: Reporte del corte por correo, asíncrono desde el outbox y sin duplicados

Estado: Aceptada · Fecha: 2026-11-10 · Concreta E1-24 (RF-028). Se apoya en los ADR 0032, 0036, 0038 y 0046.

## Contexto
Cuando una caja sube un corte (ADR 0046), el dueño debe recibir por correo el resumen: totales por forma de pago, diferencia del arqueo y retiros. El corte puede llegar tarde y repetido, el proveedor de correo puede caerse y nada de eso debe frenar `POST /sync/push` ni mandar dos correos.

## Opciones
**Quién dispara el correo**
1. **Un evento `CashCutRecorded` publicado en la misma transacción del corte** y consumido después del commit por un oyente asíncrono. El evento queda en el outbox de Modulith (ADR 0036): si el núcleo muere o el correo falla, el evento sigue pendiente.
2. **Enviar dentro de `/sync/push`.** Un proveedor lento o caído retrasa o rompe la recepción y la caja reintenta lotes enteros.
3. **Un cron que busca cortes sin correo.** Funciona, pero es una segunda vía de entrega que duplica lo que el outbox ya da.

**Proveedor**
1. **Resend por su API HTTPS** (nivel gratuito de 100 correos al día y 3,000 al mes, soporta `Idempotency-Key`). Una sola llave, sin servidor SMTP que mantener, se prueba con un servidor HTTP falso.
2. **SMTP con Spring Mail** (Gmail, Brevo). Exige usuario y contraseña de aplicación, mantiene una conexión y no tiene llave de idempotencia: un reintento tras un corte puede duplicar.
3. **Brevo o Mailgun por API.** Equivalentes; Brevo da 300 al día, pero Resend tiene la API más corta y la llave de idempotencia nativa.

**Cómo no mandar dos**
1. **Restricción `UNIQUE (tenant_id, cut_id)` en `cut_report_delivery`** y una toma condicional (`UPDATE ... WHERE status IN ('pending','failed')`). Lo decide la base de datos.
2. **Revisar el evento por `eventId` en memoria.** Se pierde al reiniciar y no sirve con dos procesos.

## Decisión
- **Evento y outbox.** `CashOperationRecorder` publica `CashCutRecorded` (solo ids, en `pos.events`, implementa `BusinessEvent`) en la transacción del corte. Si la operación revierte, no hay evento. No se externaliza a Redpanda: es un consumo interno.
- **Oyente asíncrono en `reporting`** (`@Async @TransactionalEventListener`): corre tras el commit y en otro hilo, así que `/sync/push` no espera al proveedor. El oyente fija el negocio del evento en `TenantContext`, porque en ese hilo no hay petición ni token. El evento se completa cuando el método termina bien; si lanza `ReportPendingException`, queda en `event_publication`.
- **Reintento acotado.** `ReportingConfiguration` programa cada 30 s `IncompleteEventPublications.resubmitIncompletePublicationsOlderThan`, lo que además cierra el pendiente del ADR 0036. `spring.modulith.events.republish-outstanding-events-on-restart` reenvía lo interrumpido por un reinicio. Hasta 5 intentos por corte con espera que se duplica (1, 2, 4 y 8 min, guardada en `next_attempt_at`); al quinto fallo el estado es `gave_up` y el evento se completa.
- **Estado del envío** en `cut_report_delivery` (V6): `pending`, `sending`, `sent`, `failed` (se reintentará), `gave_up`, `rejected` (el proveedor lo rechazó con 4xx: no se reintenta) y `skipped` (sin llave o sin destinatario). Guarda intentos, un código de error corto sin cuerpo ni dirección, y `sent_at`. Un `sending` de más de 5 minutos se puede retomar. La llamada al proveedor corre fuera de toda transacción.
- **Sin duplicados.** `INSERT ... ON CONFLICT DO NOTHING` crea la fila y la toma condicional la entrega a un solo trabajador. Un lote reenviado no publica otro evento (la operación es `duplicate`), un evento repetido no pasa la toma, y el envío lleva `Idempotency-Key: cut-report-<cutId>`, que cubre el caso de un correo enviado cuya respuesta se perdió.
- **Interfaz `EmailSender`** con tres errores: `EmailNotConfiguredException`, `EmailRejectedException` y `EmailUnavailableException`. `ResendEmailSender` usa `RestClient`, con tiempos de 3 s y 10 s. La llave sale solo de `RESEND_API_KEY` (y el remitente verificado de `RESEND_FROM`); `.env.example` los lista vacíos. **Sin llave el núcleo arranca**, avisa en el log al iniciar y cada corte queda `skipped` con `email_not_configured`.
- **Destinatario.** `tenant.owner_email` (V6) manda; si está vacío se usa `REPORT_DEFAULT_RECIPIENT`; sin ninguno, `skipped` con `no_recipient`. Hoy nadie escribe `owner_email`: el panel lo hará.
- **Contenido mínimo** (plantilla en español, texto plano, hora de `America/Mexico_City`): nombre del negocio, hora de cierre, ventas y total, cobros y devoluciones por forma de pago, entradas y salidas de efectivo con su motivo, fondo, esperado contra contado por forma de pago, diferencia y el motivo anotado. No hay datos de clientes, porque el núcleo no los guarda; no hay nombres de cajeros ni ids. Los importes salen de centavos enteros, sin `float`.
- **Lectura.** `CutReportQuery` lee las tablas del ADR 0046 con SQL de solo lectura bajo RLS; `reporting` es un modelo de lectura y no depende de Java de `sales` ni `cash`.

## Consecuencias
- Un correo caído nunca bloquea la recepción: lo prueba un proveedor falso que tarda 3 s mientras el lote vuelve en menos de 2.5.
- La entrega es «al menos una vez» hacia el proveedor y «una vez» hacia el dueño gracias a la llave de idempotencia, que Resend conserva 24 horas. Pasadas 24 horas de reintentos el riesgo de un duplicado existe, pero con 5 intentos que suman unos 15 minutos no se alcanza.
- Un corte `skipped` por falta de llave no se reenvía solo cuando después se agrega la llave: hoy no hay reenvío manual; lo dará el panel.
- El resumen se arma con lo recibido hasta ese momento. Si una venta del turno llega después del corte, el correo no la incluye; el reporte del día (ADR 0032) sí.
- La cuenta de Resend y el dominio remitente verificado los pone Mauricio. Todo lo probado usa un servidor HTTP falso: **no se envió un correo real**, no se verificó SPF/DKIM ni la entrega a una bandeja, y el formato de la API se tomó de su documentación pública.
- `@EnableScheduling` y `@EnableAsync` quedan activos en todo el núcleo; los oyentes futuros de eventos pueden usarlos.
