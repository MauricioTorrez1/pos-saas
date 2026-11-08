# ADR 0022: Librería de dinero como código fuente, piezas enteras y lectura estricta de texto

Estado: Aceptada · Fecha: 2026-11-07 · Concreta el ADR 0011 y completa el ADR 0020.

## Contexto
E1-05 convierte el cálculo mínimo de F0-23 en la librería de dinero y cantidades de los dos lenguajes. Faltaba decidir cómo llega `packages/money` a la caja, si una pieza puede llevar decimales y cómo se lee lo que teclea el cajero sin pasar por `float`. En JavaScript, `parseFloat("1.005") * 1000` da 1004.999..., y redondear hacia abajo vende un gramo menos.

## Opciones
**Cómo llega `packages/money` a la caja**
1. **Código fuente directo.** `exports` apunta a `src/index.ts`, y electron-vite lo empaca dentro de la caja. No hay paso de compilación.
2. **Compilar a `dist`.** Parece un paquete publicado, pero hay que compilar antes de probar la caja, y CI tiene un paso más.
3. **Rutas en `tsconfig`.** Es rápido, pero se salta las reglas del paquete, y Vite y TypeScript se pueden desalinear.

**Piezas**
1. **Solo enteras.** Así funcionan los productos por unidad de Eleventa.
2. **Con 3 decimales,** como las demás unidades.

**Lectura de texto**
1. **Estricta e igual en los dos lenguajes.** Solo dígitos ASCII y un punto opcional.
2. **Tolerante.** Acepta espacios, comas o el signo de pesos, pero cada lenguaje entiende distinto qué es un espacio.

## Decisión
- `packages/money` exporta su código fuente. Electron-vite no lo deja como dependencia externa, porque Node no ejecuta TypeScript dentro del instalador. Lo usan la pantalla y el proceso principal, así que no puede usar Node ni Electron.
- Una cantidad en piezas es entera: 0.5 pza falla con `fractional_piece` en los dos lenguajes. Metro, kilo y litro llevan 3 decimales.
- El texto se lee con dígitos ASCII y un punto opcional (`12`, `12.5`, `.5`, `12.`). Se rechazan signos, espacios, comas, `$` y exponentes. Cada tipo tiene un máximo de decimales: centavos 2, cantidades 3 y precios 4. Limpiar lo que teclea el cajero le toca a la pantalla.
- Ningún valor pasa de 2^53 − 1, que es el entero más grande que JavaScript guarda exacto. La suma de una venta falla con `overflow` en ese límite en los dos lenguajes.
- Los errores llevan el mismo código en los dos lenguajes (`MoneyError.code` y `MoneyException.code()`), y cada caso compartido dice cuál espera.
- TypeScript usa números con el sufijo de su escala y una `Quantity` de datos simples, porque así cruzan el puente de Electron y llegan a SQLite sin cambios. Java usa `record` (`Money`, `UnitPrice`, `Quantity`), que revisan sus valores al crearse.
- Por ahora, solo TypeScript da formato a los montos para mostrarlos (`$1,234.56`). Java lo agrega cuando lo necesite, por ejemplo para el reporte por correo (E1-24).

## Consecuencias
- Un cambio en `packages/money` se ve al instante en la caja, sin compilar. No se puede publicar en npm tal cual, y no hace falta, porque es privado.
- Vender media pieza requiere dar de alta el producto en otra unidad o como varios (E1-09).
- Un precio de Eleventa con `$` o con comas se limpia antes de leerlo (F0-18).
- Los casos compartidos pasan de 14 a 52: importe por línea, lectura de texto y suma.
