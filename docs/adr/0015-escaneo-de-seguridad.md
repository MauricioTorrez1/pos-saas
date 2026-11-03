# ADR 0015: Gitleaks, OSV-Scanner y Dependabot

Estado: Aceptada · Fecha: 2026-11-02.

## Contexto
RNF-08 pide que no haya secretos ni datos de tarjeta en el repositorio, y escaneo de secretos y dependencias en CI. La tarea F0-03 menciona secret scanning y Dependabot de GitHub, pero ningún documento elegía el escáner de CI. Tres hechos, revisados en noviembre de 2026, condicionan la decisión:

- Un check en rojo no impide fusionar si `main` no tiene una regla que lo exija.
- GitHub no genera alertas de Dependabot para un `pnpm-lock.yaml` de dos documentos, el formato predeterminado de pnpm 12 con versión fijada. El nuestro tiene ese formato.
- El envío automático de dependencias de Maven, que agrega las transitivas, está documentado para un `pom.xml` en la raíz. El nuestro está en `services/core`.

## Opciones
**Secretos en CI**
1. **Gitleaks.** Estable, muy conocido y con licencia MIT. Su README anuncia que solo recibirá parches de seguridad.
2. **Betterleaks.** Mismo autor, muy activo y con licencia MIT. Su v2 sigue en versión candidata y trae cambios incompatibles.
3. **TruffleHog.** Comprueba si una llave sigue viva, pero un secreto falso no bloquea si solo cuenta las verificadas, y sin ese filtro hay más ruido.
4. **Solo GitHub.** No requiere mantenimiento, pero no corre en CI y quien sube puede saltárselo.

**Cómo correr Gitleaks**
1. **El programa, con versión fija y checksum.** No depende de terceros y revisa todo el historial.
2. **`gitleaks-action`.** Tiene licencia propietaria, pide llave si el repositorio pasa a una organización y solo revisa los commits del PR.

**Dependencias**
1. **Dependabot y OSV-Scanner.** Un solo programa lee `pom.xml`, `pnpm-lock.yaml` y `uv.lock`, incluidas las transitivas de Maven.
2. **Solo Dependabot.** TypeScript quedaría sin alertas y no habría escaneo en CI.

## Decisión
Dos filtros. GitHub detiene al subir los secretos con formato conocido. En CI, Gitleaks 8.30.1 revisa todos los commits alcanzables desde el cambio y es un check obligatorio para fusionar. Se agregan reglas propias para números de tarjeta.

Dependabot abre actualizaciones semanales. OSV-Scanner 2.7.0 avisa en cada PR sin bloquear y falla en `main` y en la corrida semanal, para que GitHub notifique. Si no logra terminar, siempre falla: un escaneo que no ocurrió no debe parecer limpio.

## Consecuencias
- Dependabot no actualiza estos dos programas: su versión y su checksum se cambian a mano en `security.yml`.
- Gitleaks ya no agregará funciones. Cuando la v2 de Betterleaks sea estable se puede evaluar, con un ADR nuevo.
- Gitleaks no trae reglas de Mercado Pago ni de Facturapi. Se agregan en E2-02 y E1-30.
- Solo se revisan los commits alcanzables desde el cambio, para que una rama abandonada no ponga en rojo a los demás PR. Las otras ramas las cubre el escaneo de GitHub.
- Las reglas de tarjeta no calculan el dígito de Luhn, así que puede haber falsas alarmas. Se aceptan con `.gitleaksignore`.
- OSV-Scanner no resuelve las transitivas de las dependencias de prueba en Maven, así que Java tiene poca cobertura hasta F0-07.
- Dependabot declara soporte para uv v0.11 y usamos la 0.13.6. Su primera corrida terminó en verde.
- Si el repositorio se vuelve privado, el filtro de GitHub tiene costo. Gitleaks y OSV-Scanner siguen funcionando igual.
