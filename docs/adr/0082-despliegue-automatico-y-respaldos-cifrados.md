# ADR 0082: Despliegue automático con aprobación, respaldos cifrados en R2 y monitoreo externo

Estado: Aceptada · Fecha: 2026-11-26 · Concreta F0-25. Se apoya en el ADR 0081 (Cloud Run, Supabase y R2) y en el ADR 0034 (migraciones que solo agregan).

## Contexto
Con la infraestructura de F0-24 falta lo que la ficha pide: que un merge a `main` llegue a producción, un respaldo diario probado y monitoreo externo (RNF-04, RNF-09). Supabase Free no ofrece respaldos descargables, así que el respaldo es responsabilidad nuestra. Todo debe costar $0 y no fallar mientras el dueño no haya creado las cuentas.

## Opciones
**Cómo autentica GitHub Actions con Google**
1. **Workload Identity Federation (WIF):** un token OIDC de GitHub se cambia por uno de Google que dura una hora. No hay llave que robar.
2. **Llave JSON de la cuenta de servicio en un secreto:** sencillo, pero la llave no caduca y una filtración da acceso permanente.

**Dónde corre Flyway**
1. **En el workflow, antes de la revisión nueva**, con el rol `postgres`, usando la imagen oficial de Flyway.
2. **Al arrancar el núcleo:** cada instancia necesitaría la contraseña del dueño de las tablas, y dos instancias arrancando a la vez compiten por la migración.
3. **Un Cloud Run Job aparte:** otra pieza que mantener y otra cuenta con la contraseña.

**Cifrado de respaldos**
1. **`age` con la llave pública en el repositorio:** una sola herramienta moderna, llaves cortas, sin anillos de llaves.
2. **GPG:** más extendido, pero con más formas de equivocarse (anillos, confianza, caducidad).

**Retención (30 diarios + 12 mensuales)**
1. **Reglas de ciclo de vida de R2 por prefijo** (`daily/` 30 días, `monthly/` 365), declaradas en Terraform.
2. **Un script que liste y borre:** más código, y si deja de correr se acumulan respaldos.

**Monitoreo externo**
1. **Un workflow cada hora que pide `/actuator/health`**; si falla, GitHub le escribe al dueño. $0 y sin otra cuenta.
2. **Uptime check de Cloud Monitoring:** nativo, pero sus alertas pueden empezar a cobrarse y la notificación requiere más configuración.
3. **Un servicio externo (UptimeRobot u otro):** otra cuenta fuera del repositorio.

## Decisión
- **`Deploy` (`.github/workflows/deploy.yml`)**: en cada push a `main` que toque el núcleo (o a mano), en el entorno `production` con revisores obligatorios. Autentica con WIF (opción 1). Construye la imagen con `services/core/Dockerfile`, la sube a Artifact Registry con la etiqueta del commit y migra con Flyway 12.11 en el workflow (opción 1). Guarda la revisión que sirve, despliega solo la imagen nueva (`gcloud run deploy --image`), regresa el tráfico a la más nueva y corre `scripts/check-core-health.sh` hasta tres minutos. Si la prueba de humo falla, manda el tráfico a la revisión anterior y el job queda en rojo. La migración no se revierte: como solo agrega (ADR 0034), la revisión anterior sigue funcionando con el esquema nuevo.
- **`Backups` (`.github/workflows/backup.yml`)**, cada día a las 03:17 de la Ciudad de México. Corre `pg_dump` 17 del esquema `public` en formato *custom*, revisa el volcado con `pg_restore --list`, lo cifra con `age` para las llaves de `infra/backup/age-recipients.txt` (opción 1) y lo sube a `daily/` en R2. El día primero también lo sube a `monthly/`. La retención la hacen las reglas de R2 (opción 1). El volcado sin cifrar solo existe dentro del contenedor de herramientas (`infra/backup/Dockerfile`, PostgreSQL 17 con `age`).
- **Restauración probada:** el job *Backup restore test* corre a diario, en cada PR que toque migraciones o respaldos, y con los mismos scripts e imagen. Migra un PostgreSQL 17, siembra datos, respalda con una llave desechable, restaura en otro PostgreSQL 17 vacío y compara filas por tabla, políticas de RLS, historial de Flyway y `FORCE ROW LEVEL SECURITY`. Al final comprueba que `pos_app` no ve ningún negocio sin fijarlo. El simulacro con el respaldo real y la llave del dueño está en `docs/despliegue-en-la-nube.md`, paso 13.
- **`Uptime` (`.github/workflows/uptime.yml`)**, cada hora (opción 1). Además mantiene activo el proyecto gratuito de Supabase, que se pausa tras una semana sin uso.
- **Sin secretos, todo se salta:** `Deploy` y `Uptime` tienen condiciones sobre variables del repositorio y aparecen como omitidos. `Backups` revisa variables, secretos y la llave pública, y deja un aviso en vez de fallar. La prueba de restauración no necesita nada y siempre corre.
- **Secretos a nivel repositorio:** `SUPABASE_DB_PASSWORD`, `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`. El token de R2 se limita al bucket. La llave privada de `age` nunca entra a GitHub.

## Consecuencias
- **RPO** de hasta 24 horas para el servidor; la caja conserva sus ventas y las vuelve a sincronizar. **RTO** de unos 30 minutos siguiendo el simulacro.
- El primer despliegue necesita la primera migración y la contraseña de `pos_app` antes (paso 8 de la guía); si no, la prueba de humo falla y se queda la versión anterior.
- Si `postgres` de Supabase no tuviera `BYPASSRLS`, `pg_dump` fallaría en las tablas con RLS forzada; la guía lo verifica antes del primer respaldo.
- Perder la llave privada de `age` vuelve inútiles todos los respaldos. Por eso la guía pide guardarla en dos lugares.
- La ficha pedía Caddy y un dominio: Cloud Run ya da HTTPS en `*.run.app`, así que Caddy no hace falta. El panel en la nube espera a que Keycloak tenga casa en producción (ADR 0081).
- Los workflows programados de GitHub se desactivan tras 60 días sin actividad en el repositorio; con commits frecuentes no pasa, pero si el proyecto se queda quieto hay que reactivarlos.
- Cada job gasta minutos de Actions, que son gratis en un repositorio público.
