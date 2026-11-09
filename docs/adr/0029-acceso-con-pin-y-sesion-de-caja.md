# ADR 0029: Acceso con PIN, sesión de caja y corte con arqueo

Estado: Aceptada · Fecha: 2026-11-08 · Concreta RF-009, RF-024 a RF-027 y el ADR 0006.

## Contexto
Para sustituir a Eleventa, la caja tiene que saber quién vende, abrirse con un fondo, registrar entradas y salidas de efectivo y cerrar con un corte que compare lo contado con lo esperado. Todo debe funcionar sin internet y sin servidor, porque la caja manda (ADR 0019).

## Opciones
**Cómo se guarda el PIN**
1. **Argon2id.** Es el estándar, pero pide un módulo nativo que compilar para Electron.
2. **scrypt, que ya viene en Node.** También exige mucha memoria para adivinar, sin dependencias nuevas, y la configuración viaja con el hash para subirla después.

**Qué ve el cajero del efectivo**
1. **Todo, incluido lo que debería haber en el cajón.** Contar es solo confirmar.
2. **Solo el dueño ve lo esperado.** El cajero cuenta sin saber la respuesta (arqueo a ciegas), y la diferencia aparece al terminar.

**Quién puede sacar efectivo**
1. **Cualquiera con un motivo.** Rápido, pero nadie responde por el faltante.
2. **El cajero necesita el PIN del dueño.** Un paso más, y queda a nombre de los dos.

## Decisión
- Opción 2 en las tres preguntas.
- **PIN:** de 4 a 8 números, con scrypt (`N=16384`, `r=8`, `p=1`) y sal propia. Cinco PIN incorrectos seguidos bloquean a esa persona cinco minutos, y el bloqueo se guarda en la base, así que cerrar la caja no lo borra. La persona que entró vive solo en memoria: cerrar la caja la saca.
- **El primer arranque** pide crear al dueño. Después, solo el dueño agrega personas. Una persona se desactiva y nunca se borra, porque sus ventas llevan su nombre.
- **El proceso principal exige haber entrado** para vender, consultar el catálogo o tocar la caja. Una pantalla que se saltara el acceso no podría vender. Cambiar la apariencia es del dueño.
- **Sesión de caja:** `cash_session` abre con un fondo, y la base permite una sola abierta por negocio. Sin sesión abierta no se guarda ninguna venta. Cada venta lleva la sesión y el cajero.
- **Efectivo esperado:** fondo + ventas en efectivo + entradas − salidas − devoluciones en efectivo. La tarjeta y las transferencias nunca tocan el cajón.
- **Entradas y salidas** llevan monto y motivo. Una salida de un cajero pide el PIN del dueño y guarda quién la autorizó.
- **Aviso de retiro:** cuando el efectivo esperado pasa del límite (por omisión $5,000, y el dueño lo cambia), la caja avisa en la pantalla y nunca frena una venta.
- **Corte:** el cajero cuenta billete por billete y captura los vouchers de tarjeta y las transferencias. La caja calcula la diferencia de cada forma de pago. Si alguna no cuadra pide un motivo, y sin motivo no cierra. El corte guarda lo contado por denominación, se cierra junto con la sesión en una transacción y no se puede cambiar. No cierra mientras haya ventas pendientes, porque sus pagos no son finales.
- Un cajero pensado para equivocarse recibe mensajes que dicen qué hacer, y la pantalla tiene una red de seguridad: si algo falla al dibujarse, dice que las ventas están guardadas en lugar de quedar en blanco.

## Consecuencias
- Los casos compartidos del corte con Java llegan con la sincronización, cuando exista un servidor que los repita. Hoy el cálculo vive solo en TypeScript, con pruebas.
- Dar de baja a alguien aplica de inmediato en esta caja. Con varias cajas llegará con la sincronización de roles (ADR 0006).
- Un PIN corto tiene poca entropía: el bloqueo y el hash lento son la defensa, y no hay recuperación. Si el dueño olvida su PIN, hay que restaurar la base, y eso queda para E1-35.
- El corte solo existe en la caja. El correo y el reporte llegan con E1-24.
- Hasta el piloto, cualquiera con el PIN del dueño puede autorizar. Probar con las personas de la tienda queda en la lista de pendientes.
