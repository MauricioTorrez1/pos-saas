# ADR 0020: Casos en JSON y cálculo de Java fuera de los módulos

Estado: Aceptada · Fecha: 2026-11-03 · Concreta cómo se aplica el ADR 0009.

## Contexto
El ADR 0009 pide que caja y núcleo corran los mismos casos, y la ficha de F0-23 pide que un caso roto falle en ambos. Para eso hace falta que exista algo que calcular, aunque las librerías completas lleguen en E1-05. También hay que decidir dónde vive ese cálculo en Java, porque lo necesitarán ventas, corte, inventario y factura.

## Opciones
**Dónde vive el cálculo en Java**
1. **Dentro de `sales`.** Es lo más directo, pero los demás módulos dependerían de ventas solo para sacar una cuenta.
2. **Un décimo módulo `money`.** Spring Modulith lo vigila, pero cambia la lista de módulos del ADR 0001, y casi todos dependerían de él.
3. **Un paquete `pos.money`, fuera de `pos.core`.** Spring Modulith no lo ve como módulo, y cualquiera lo puede usar sin depender de otro módulo.

**Cómo se revisan los casos**
1. **JSON Schema en los dos lenguajes.** Es lo más completo, pero agrega una dependencia en Java para repetir una revisión que CI ya hace en cada PR.
2. **JSON Schema en TypeScript y lectura estricta en Java.** Una sola dependencia, Ajv, y un caso mal escrito también falla en Java.

## Decisión
- El cálculo de Java va en `io.github.mauriciotorrez1.pos.money`, fuera de los módulos. Solo admite cosas sin estado y sin Spring, como el cálculo de importes.
- `packages/contracts` guarda los esquemas y los casos. TypeScript valida con JSON Schema, y Java lee el archivo con Jackson estricto, sin convertir decimales ni aceptar campos desconocidos.
- Maven copia los casos a los recursos de prueba, así que las pruebas de Java necesitan el monorepo completo. CI ya hace ese checkout.
- F0-23 solo agrega `lineAmountCents` y `LineAmount.inCents`, lo mínimo para que los casos sean reales. E1-05 construye sobre eso.
- Ambos lenguajes rechazan los valores negativos. «Half up» con negativos se puede entender de dos formas, y una devolución no debe depender de esa diferencia. La decisión queda para E1-15.
- Ambos lenguajes fallan por encima del límite de un `long` de Java. `BigInt` podría seguir, pero entonces la caja daría un importe y el núcleo un error.

## Consecuencias
- Una diferencia de cálculo entre caja y núcleo pone CI en rojo, como pide RNF-10.
- Un `$schema` en el archivo de casos da autocompletado y revisión en el editor.
- `pos.money` queda fuera de la vigilancia de Spring Modulith, así que depende de la revisión de código que no acumule lógica de negocio.
- Por ahora la unidad se valida en los casos, pero no entra en el cálculo. El tipo `Quantity`, con su unidad, llega en E1-05.
