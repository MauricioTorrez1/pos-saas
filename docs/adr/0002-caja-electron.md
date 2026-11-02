# ADR 0002: Caja en Electron, pantalla separada del hardware

Estado: Aceptada · Fecha: 2026-11-02

## Contexto
La caja debe vender sin internet, imprimir ESC/POS, abrir el cajón por la impresora y correr en una PC con Windows 10 u 11. Como será SaaS, también conviene llegar a negocios sin impresora ni cajón.

## Opciones
1. **Electron.** Node, SQLite y USB disponibles; instaladores pesados y más RAM.
2. **Tauri.** Binario ligero, pero la capa nativa va en Rust y hay menos ejemplos para este hardware.
3. **PWA (app web instalable).** Sin instalación, pero el acceso a USB y el almacenamiento local son menos confiables para vender sin internet.

## Decisión
Caja en Electron con React, TypeScript y SQLite, descargable desde un solo dominio. La pantalla no conoce el hardware: usa las interfaces `LocalStore`, `PrinterProvider`, `CashDrawer`, `ScaleProvider` y `LabelPrinter`. El panel es web desde fase 0. En fase 4 se evaluará una caja web con otras implementaciones de esas interfaces, para negocios sin hardware. Cada negocio entra por el mismo dominio con su login, sin subdominio propio.

## Consecuencias
- Una sola base de código de pantalla sirve para Electron y para la futura versión web.
- Hay que reconstruir módulos nativos por versión de Electron.
- La firma de código en Windows tiene costo; sin firma, SmartScreen muestra una advertencia. Se decide antes de la fase 4.
- Hay que probar la caja en Windows 10 y en Windows 11.
