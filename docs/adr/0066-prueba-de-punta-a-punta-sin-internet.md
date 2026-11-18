# ADR 0066: Prueba de punta a punta de la venta sin internet

Estado: Aceptada · Fecha: 2026-11-17 · Concreta E1-20 (RF-020, RNF-01, RNF-05). Se apoya en los ADR 0040, 0054 y 0055.

> Los números 0064 y 0065 quedan para F0-21 y F0-22, que se trabajan al mismo tiempo.

## Contexto
La regla que nunca se rompe: la caja vende en efectivo sin internet, y al volver la red ninguna venta se pierde ni se guarda dos veces. Cada lado ya tenía sus pruebas:
- La caja prueba su outbox y su sincronizador contra un núcleo falso en memoria (`FakeSyncTransport`).
- El núcleo prueba `POST /sync/push` con lotes armados en Java (`SyncFixtures`).

Faltaba juntar los dos lados de verdad: el código real de la caja hablando por HTTP con un núcleo real sobre PostgreSQL, con la red fallando en los momentos que importan.

## Opciones
1. **Prueba solo en Java con Testcontainers.** Arma en Java los lotes con la forma de la caja y los manda al núcleo. Es rápida y cabe en el job de Java, pero no ejecuta ni el outbox ni el sincronizador ni el transporte HTTP de la caja: probaría una copia de la caja, no la caja.
2. **Prueba solo en Node.** Ejecuta la sincronización real de la caja contra un núcleo que levanta la propia prueba (`java -jar` y PostgreSQL en Docker). Ejecuta la caja de verdad, pero tendría que repetir en un script la configuración de base de datos, roles y RLS que ya resuelve `PostgresTestConfiguration`, y ningún job de CI tiene ambas cosas listas.
3. **Java orquesta y Node vende.** Una prueba de Spring Boot levanta el núcleo real en un puerto libre sobre PostgreSQL (Testcontainers), enrola una caja y ejecuta con Node el archivo de Vitest que usa el código real de la caja. Al final Java compara PostgreSQL con el resumen que escribe la caja.

## Decisión
Se eligió la **3**. Prueba las dos piezas reales y reutiliza lo que ya existe en cada lado.

**Dónde vive.**
- `services/core/.../sync/OfflineSyncEndToEndTest.java` levanta el núcleo con `webEnvironment = RANDOM_PORT`, enrola la caja con `DeviceFixtures` (credencial de dispositivo, ADR 0054) y ejecuta Node.
- `apps/pos/src/main/sync/offline-sync.e2e.ts` es el lado de la caja: `LocalStore` en SQLite, `SaleStore`, `SyncOutbox`, `OutboxSynchronizer` y `HttpSyncTransport`, sin dobles. Lo corre `vitest.e2e.config.ts`; `pnpm test` no lo incluye porque necesita el núcleo.
- `apps/pos/src/main/sync/fakes/flaky-network-proxy.ts` es un proxy TCP entre la caja y el núcleo que hace de internet de la tienda. Los errores que ve la caja son errores de socket reales.

**El escenario.**
1. Sin red, la caja abre la caja con $0 y cobra **1,000 ventas en efectivo** de una a tres líneas, con cantidades distintas. El intento de sincronizar falla y las 1,001 operaciones (las ventas y la apertura de caja) quedan pendientes.
2. Vuelve la red, pero el primer envío **se corta a la mitad de la petición**: el núcleo recibe medio cuerpo y no guarda nada.
3. El siguiente envío pasa. En el que sigue, el núcleo guarda el lote pero **la respuesta se pierde**: la caja lo deja pendiente.
4. Al reintentar, ese lote vuelve como `duplicate` y el resto como `accepted`.
5. Se **reenvían dos lotes ya entregados** (el primero y el último): todo vuelve como `duplicate`.
6. Java compara contra PostgreSQL: 1,000 ventas, los mismos ids, el mismo total en centavos en `sale`, en la suma de `sale_line` y en la suma de `sale_payment`, y 1,001 operaciones `accepted` en `sync_operation`, ninguna en cuarentena.

**Cuándo corre.** Solo con `POS_OFFLINE_E2E=true`, porque necesita Node y las dependencias de `apps/pos`:
- En CI la pone el job de Java, que ahora instala Node y esas dependencias sin el binario de Electron. La prueba tarda cerca de 75 s y el job sigue lejos de su límite de 10 minutos.
- En local se corre con `bash scripts/run-offline-sync-e2e.sh`.

La salida de Node se copia línea por línea a la de la prueba con el prefijo `[register]`. Heredar los descriptores escribía en el canal de Surefire con su JVM.

## Consecuencias
- Un cambio en el contrato, en la forma de la venta o en la idempotencia que rompa la sincronización real hace fallar el job de Java aunque las pruebas de cada lado sigan en verde.
- El job de Java depende ahora de Node y de `pnpm-lock.yaml`. Instalar solo `@pos-saas/pos` y sus paquetes del monorepo lo mantiene corto.
- El proxy no simula latencia ni pérdida parcial de paquetes; solo los dos cortes que deciden si una venta se pierde o se duplica. Si algún día hace falta probar latencia, se agrega al mismo proxy.
- No cubre devoluciones, cortes de caja ni ajustes de inventario. Sus reglas de idempotencia son las mismas y ya están probadas en `SyncPushTest`.
