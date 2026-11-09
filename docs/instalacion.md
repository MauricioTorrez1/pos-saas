# Instalar y actualizar la caja en Windows

Esta guía es para quien instala la caja en la computadora de la tienda. No hace falta saber de programación.

## Hacer el instalador (una vez por versión)
En la computadora de desarrollo, desde la carpeta del repositorio:

```bash
pnpm --filter @pos-saas/pos package
```

Genera `apps/pos/dist/Caja Setup <versión>.exe`, de unos 115 MB. Se pasa a la computadora de la tienda por USB.

## Instalar
1. Abre `Caja Setup.exe`. No pide administrador y se instala solo, con un acceso directo en el escritorio y otro en el menú de inicio.
2. **Aviso de Windows (SmartScreen).** La primera vez Windows dice «Windows protegió su PC» porque el instalador todavía no está firmado con un certificado de pago. Es normal. Oprime **Más información** y luego **Ejecutar de todas formas**.
3. Abre **Caja**. En el primer arranque pide crear al dueño: su nombre y un PIN de 4 a 8 números.
4. Oprime **F1** (Administración) y haz dos cosas antes de vender:
   - **F5:** cargar el catálogo y las existencias que exportaste de Eleventa (un archivo CSV).
   - **F6:** configurar los respaldos con una USB o carpeta y una contraseña. Guarda esa contraseña en un lugar seguro: sin ella no se puede abrir ninguna copia.

## Actualizar
Ejecuta el instalador nuevo encima. Los datos (ventas, productos, usuarios) viven en la carpeta de datos del usuario y no se tocan. La base se actualiza sola al abrir la caja. Si algo sale mal, vuelve a instalar la versión anterior.

## Dónde están los datos
En `%APPDATA%\Caja` (o `%APPDATA%\@pos-saas\pos` en versiones de desarrollo). Desinstalar la caja nunca borra esa carpeta.

## Restaurar un respaldo
1. **F1**, luego **F8**.
2. Escribe la contraseña con la que se hizo la copia y elige el archivo `.posbak`.
3. Cierra la caja y ábrela otra vez. La base anterior se guarda a su lado, con el nombre `pos.before-restore-...`, por si fue un error.

## Impresora y cajón
Comparte la impresora en Windows con un nombre sin espacios, por ejemplo `TM-T20`, y abre la caja con la variable de entorno `POS_PRINTER_SHARE` en `\\localhost\TM-T20`. El cajón se abre por la impresora. Sin esa variable la caja vende normal y no imprime.
