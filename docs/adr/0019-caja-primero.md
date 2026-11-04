# ADR 0019: Empezar por la caja y conectar el servidor después

Estado: Aceptada · Fecha: 2026-11-03 · Cambia el orden del roadmap, no sus fichas.

## Contexto
Al terminar F0-07 quedaban 18 tareas de Fase 0 (83 horas) antes de la Entrega 1 (160 horas), y hasta entonces no habría nada que usar en el mostrador. Mauricio pidió llegar antes a un sistema funcionando. Las dependencias de las fichas ya permiten construir la venta en efectivo sin el servidor.

## Opciones
1. **Seguir el orden numérico, con F0-08.** El servidor queda completo primero, pero la caja llega al final.
2. **Caja primero.** F0-23, E1-01, E1-02, E1-03, E1-05, E1-06, E1-07, E1-10, E1-11, E1-13 y E1-14, unas 47 horas. Da pronto una caja que vende en efectivo sin internet, con ticket y cajón, y deja el riesgo de conectarla al servidor para más adelante.

## Decisión
Opción 2. Después de ese tramo se retoman las tareas pendientes de Fase 0 y Entrega 1, según las dependencias de cada ficha. No cambia ninguna ficha ni ninguna regla de dominio.

## Consecuencias
- El total sigue siendo de unas 243 horas para salir de Eleventa. Este orden adelanta lo que se puede probar, pero no reduce el trabajo.
- Ese primer tramo no sirve para ventas reales: no tiene sincronización, factura ni login con PIN, porque E1-04 necesita F0-15. Sus productos son de prueba hasta conectar el catálogo. Eleventa sigue en uso hasta E1-38.
- El ticket y el cajón se prueban con falsos hasta tener el equipo físico.
- Las reglas de dominio aplican desde la primera venta local: dinero en enteros, UUIDv7, llave de idempotencia y `tenant_id`. Así la sincronización no obliga a rehacer datos.
- F0-23 va primero para que la caja y el núcleo compartan casos de cálculo. E1-20 prueba después la conexión de punta a punta.
