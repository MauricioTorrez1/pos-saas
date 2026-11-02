# ADR 0009: Lógica local en TypeScript con casos compartidos

Estado: Aceptada · Fecha: 2026-11-02 · Matiza la decisión 6 de la especificación.

## Contexto
La decisión 6 pone la lógica de negocio en Java, pero sin internet la caja debe calcular precios, IVA, cambio y corte. Si la caja vende cable a $12.50 y el precio ya subió a $13, el dinero ya entró: el servidor no puede rechazar esa venta.

## Opciones
1. **Solo Java, con la caja como terminal tonta.** Rompe la regla de vender sin internet.
2. **Java compartido en la caja.** Agrega una JVM a cada caja.
3. **Lógica local en TypeScript, con Java como autoridad del resto.** Dos implementaciones de los cálculos, protegidas por casos compartidos.

## Decisión
La caja calcula en TypeScript lo que opera sin internet: importes, IVA, cambio, movimientos y corte. Java es la autoridad para todo lo demás: catálogo, facturación, reportes y sincronización. Ambos corren los mismos casos en JSON de `packages/contracts`. El servidor nunca rechaza una venta cerrada: la acepta y, si no coincide con su cálculo, crea una `sync_discrepancy` para que el dueño la revise. «Manda el servidor» aplica solo a catálogo, precios y promociones.

## Consecuencias
- Vender sin internet es posible sin duplicar reglas a ciegas: una diferencia rompe CI.
- Hay que mantener los cálculos en dos lenguajes.
- El dueño necesita una pantalla de discrepancias.
