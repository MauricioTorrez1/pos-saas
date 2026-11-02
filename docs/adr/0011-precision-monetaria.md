# ADR 0011: Centavos en totales y mayor escala en unitarios

Estado: Aceptada · Fecha: 2026-11-02 · Precisa la decisión 3 de la especificación.

## Contexto
Una caja de 1,000 tornillos a $153 da $0.153 por pieza, y eso no cabe en centavos enteros. Tampoco 3.275 m de cable a $12.50, que dan $40.9375. `float` y `double` siguen prohibidos.

## Opciones
1. **Todo en centavos.** Pierde precisión en unitarios y en costo promedio.
2. **`BigDecimal` en todas partes.** Preciso en Java, pero sin equivalente directo en TypeScript y SQLite.
3. **Enteros con escalas distintas.** Portátil y exacto, con una regla documentada.

## Decisión
| Dato | Unidad | Tipo | Ejemplo |
| --- | --- | --- | --- |
| Totales y pagos | centavo | entero | $40.94 = `4094` |
| Precio unitario | diezmilésima de peso | entero | $12.50 = `125000` |
| Costo unitario | millonésima de peso | entero | $0.153 = `153000` |
| Cantidad | milésima de unidad | entero | 3.275 m = `3275` |

Importe de línea en centavos: `round_half_up(unit_price_e4 × quantity_milli / 100000)`. Ejemplo: `125000 × 3275 / 100000 = 4093.75`, que redondea a `4094`. El redondeo es por línea y los totales son la suma de las líneas. Los precios públicos incluyen IVA, y el cobro en efectivo es al centavo. TypeScript usa `BigInt` en la multiplicación intermedia, y Java usa `long` con `Math.multiplyExact`, que falla en lugar de desbordarse.

## Consecuencias
- Caja y servidor redondean igual, verificado por los casos compartidos.
- Hay que validar el desglose de IVA contra lo que acepta Facturapi antes de la Entrega 1.
- Los nombres de columna llevan el sufijo de escala: `unit_price_e4`, `unit_cost_e6`, `quantity_milli`, `amount_cents`.
