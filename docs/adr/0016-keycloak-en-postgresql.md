# ADR 0016: Keycloak con base propia y stack local probado en cada PR

Estado: Aceptada · Fecha: 2026-11-02.

## Contexto
F0-04 levanta PostgreSQL 16, Keycloak, Redis y Redpanda con Docker Compose. Ningún documento decía dónde guarda Keycloak sus datos ni cuándo se prueba este stack en CI. El ADR 0006 pide respaldar Keycloak como cualquier servicio.

## Opciones
**Datos de Keycloak**
1. **Base propia en el mismo servidor PostgreSQL.** Funciona igual que en producción y se respalda con el resto. Requiere un script de inicio y que Keycloak espere a PostgreSQL.
2. **H2 interno.** No requiere script ni espera, pero Keycloak lo documenta solo para desarrollo y habría que cambiarlo antes de producción.

**Cuándo probar el stack en CI**
1. **En cada PR.** Detecta cualquier cambio que lo rompa y puede ser check obligatorio, a cambio de tiempo de CI en cada PR.
2. **Solo si cambian sus archivos.** Los demás PR terminan antes, pero GitHub deja pendiente un check obligatorio cuando un filtro de ruta omite el workflow, así que no podría ser obligatorio.

## Decisión
Keycloak usa la base `keycloak` con el rol `keycloak`, dentro del mismo servidor PostgreSQL. El rol no comparte contraseña con el administrador del servidor.

El trabajo `Compose core` corre en cada PR, sin filtros de ruta, y es check obligatorio. Falla si los cuatro servicios no están sanos en 120 segundos, sin contar la descarga de imágenes.

## Consecuencias
- El script de inicio solo corre con un volumen vacío. Si cambia `KEYCLOAK_DB_PASSWORD`, en local hay que borrar los volúmenes.
- Si PostgreSQL se cae, también se cae el login del panel y de la API. La caja sigue vendiendo con su PIN local (ADR 0006).
- Keycloak no necesita un volumen propio.
- Las imágenes se fijan con versión y digest. Las actualiza Dependabot, salvo los saltos mayores de PostgreSQL, que requieren un ADR.
