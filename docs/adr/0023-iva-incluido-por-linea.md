# ADR 0023: IVA incluido, con la base redondeada por línea y el IVA por diferencia

Estado: Aceptada · Fecha: 2026-11-07 · Concreta el ADR 0011 para el IVA.

## Contexto
Los precios públicos incluyen IVA (ADR 0011). La factura CFDI 4.0 necesita, por cada concepto, la base sin IVA y el IVA trasladado, y el ticket debe sumar exactamente lo que se cobró. E1-06 decide cómo se saca el IVA de un importe que ya lo incluye, dónde se redondea y cómo se representan 16%, 8%, 0% y exento.

## Opciones
**Cómo sacar el IVA**
1. **Base redondeada e IVA por diferencia.** `base = round_half_up(total × 10000 / (10000 + rate_bp))` e `IVA = total − base`. La base más el IVA siempre da el total cobrado.
2. **Base e IVA redondeados por separado.** Con algunos importes, la suma queda un centavo arriba o abajo de lo cobrado.
3. **Precio unitario sin IVA a 6 decimales,** como el `ValorUnitario` del CFDI, y recalcular desde ahí. El total de la factura puede no coincidir con el del ticket.

**Dónde se redondea**
1. **Por línea,** como el importe del ADR 0011. Cada línea queda lista como concepto del CFDI, y el IVA de la venta es la suma de los IVA de sus líneas, que es lo que pide el nodo de impuestos del CFDI.
2. **En el total de la venta.** Da un IVA por venta, pero las líneas no traen el suyo, y la factura tendría que repartirlo después.

**Cómo se representa la tasa**
1. **Factor y `rate_bp`,** como dice el [modelo de dominio](../plan/02-dominio.md): 16% es `rate` con 1600, 0% es `rate` con 0, y exento es `exempt` con 0.
2. **Solo `rate_bp`,** con exento igual a 0%. Pierde una diferencia que el CFDI sí hace: la tasa 0% lleva `TasaOCuota` 0.000000 e importe 0.00, y el exento lleva `TipoFactor` Exento sin importe.
3. **`rate_bp` nulo para exento.** Cada lector tiene que acordarse del nulo, en SQLite, en JSON y en los dos lenguajes.

## Decisión
- Opción 1 en las tres preguntas.
- `base = round_half_up(total × 10000 / (10000 + rate_bp))` e `IVA = total − base`, con el total de la línea ya redondeado (ADR 0011). Si el producto está exento, la base es el total y el IVA es 0. Ejemplo: 3.275 m de cable a $12.50 dan $40.94; la base es 4094 × 10000 / 11600 = 3529.31, que redondea a $35.29, y el IVA es $5.65.
- Se calcula sin multiplicar el total completo: `total = cociente × (10000 + rate_bp) + residuo`, y solo el residuo se multiplica por 10000. Así nada pasa de 2^53 − 1, ni siquiera con el total más grande, y ningún lenguaje necesita `BigInt` ni puede desbordarse.
- Con la base redondeada a medio centavo, el IVA queda a menos de medio centavo × (1 + tasa) de `base × tasa`. Como el IVA es un número entero de centavos, siempre queda entre los límites que el Anexo 20 del SAT acepta para el traslado de un concepto: `(base − 0.005) × tasa` truncado y `(base + 0.005) × tasa` redondeado hacia arriba. Una prueba lo revisa con todos los totales de $0 a $1,000 al 16% y al 8%.
- Los totales de la venta son la suma de sus líneas: base, IVA y total, más un grupo por cada combinación de factor y tasa, con su base y su IVA, que es lo que lleva el nodo de impuestos del CFDI. Los grupos van de la tasa más alta a la más baja, y el exento al final.
- La librería acepta cualquier tasa de 0 a 10000 puntos base (de 0% a 100%). Qué tasas ofrece el catálogo, 16%, 8% en la región fronteriza y 0%, lo decide F0-17. Una tasa arriba de 100%, un exento con tasa o un factor desconocido fallan con `invalid_tax_rate` en los dos lenguajes.
- Cada línea guarda la tasa con la que se vendió. Si la tasa de un producto cambia, las ventas anteriores no se recalculan.
- Los descuentos (F3-13) y el IEPS quedan fuera: hoy ningún producto de la tienda lleva IEPS.

## Consecuencias
- El ticket y la factura cuadran: en cada línea y en cada venta, la base más el IVA da el total cobrado.
- Redondear por línea puede dar un centavo distinto que calcular el IVA sobre el total. Tres tornillos a $1.00 dan $0.41 de IVA; dos líneas así dan $0.82, y sacarlo de los $6.00 daría $0.83. Manda la suma de líneas, como en el CFDI.
- Antes del piloto (E1-37), Mauricio compara 10 casos con el contador o con Facturapi en modo de prueba. Si Facturapi, al recibir precios con IVA incluido, calcula un centavo distinto en alguna línea, E1-31 le envía la base sin IVA de cada concepto para que respete la de la caja.
- En Java, `LineTotals` revisa al crearse que su base y su IVA salen de su total. Una línea que no cuadra es un error de programación (`IllegalArgumentException`), no un código compartido. E1-19 decide qué hacer cuando el servidor recibe una así de la caja.
- Los casos compartidos pasan de 54 a 81, en cinco archivos.
