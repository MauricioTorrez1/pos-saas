# ADR 0081: Núcleo en Cloud Run, base en Supabase y respaldos en R2, todo con Terraform

Estado: Aceptada · Fecha: 2026-11-25 · Concreta F0-24. Resuelve la condición de revisión del ADR 0013 y reemplaza la parte de servidor de `docs/plan/06-infraestructura.md` (un VPS con el stack completo).

## Contexto
El ADR 0013 dejó el precio del servidor sin resolver: un VPS de 16 GB para el stack completo costaba varias veces el presupuesto de $300 a $700 MXN al mes. Mientras tanto la caja ya vende en la tienda, sin internet y sincronizando en segundo plano, así que lo que necesita la nube hoy es el **núcleo** (la API de Spring Boot) y su **PostgreSQL**, no Grafana, Redpanda ni n8n. Un arranque en frío de unos segundos no bloquea ninguna venta.

## Opciones
1. **VPS con el stack completo** (Hetzner u otro). Control total y todo en un equipo, pero $1,500 MXN o más al mes por 16 GB, y parches, firewall y respaldos a mano.
2. **VPS chico solo con el perfil `core`.** Unos $100 a $200 MXN al mes; sigue habiendo un sistema operativo que parchar y un disco que respaldar.
3. **Servicios administrados en nivel gratuito: Cloud Run + Supabase + Cloudflare R2.** $0 al mes mientras el uso quepa en los límites; sin sistema operativo que mantener; HTTPS y escalado incluidos. A cambio: arranques en frío, una base que se pausa si nadie la usa en una semana y sin respaldos descargables de Supabase en el plan gratuito.

## Decisión
**El dueño eligió la opción 3, con costo de $0.** Todo se declara con Terraform en `infra/terraform/`:

- **Núcleo en Google Cloud Run** (`us-east1`, región de nivel 1): mínimo 0 instancias, máximo 2, 1 vCPU y 1 GiB, CPU solo durante las peticiones (`cpu_idle`), arranque con CPU extra. Prueba de arranque en `/actuator/health/readiness` y de vida en `/actuator/health/liveness` (perfil `prod`).
- **Imágenes en Artifact Registry**, con limpieza automática: quedan las tres más recientes y se borra lo de más de una semana, para no pasar de 0.5 GB.
- **Cuenta de servicio de ejecución** `pos-core-runtime` cuyo único permiso es leer sus dos secretos (permiso por secreto, no por proyecto). **Cuenta de despliegue** `pos-core-deployer` que solo sube imágenes a su repositorio, despliega revisiones de un solo servicio y actúa como la cuenta de ejecución.
- **Workload Identity Federation (federación de identidades)** para GitHub Actions: el proveedor OIDC rechaza tokens de otro repositorio y solo los jobs del entorno `production` (el que lleva aprobación manual) pueden hacerse pasar por la cuenta de despliegue. No existe ninguna llave JSON.
- **Secret Manager** guarda la URL de la base y la contraseña de `pos_app`. Cloud Run las inyecta como variables de entorno.
- **PostgreSQL en Supabase** (`us-east-1`, cerca de `us-east1`), proyecto creado por Terraform con el proveedor `supabase/supabase`. Las dos contraseñas (`postgres`, dueño de las tablas, y `pos_app`, sin `BYPASSRLS`) las genera Terraform con `random_password`; nadie las teclea.
- **Conexión por el pooler Supavisor en modo sesión (puerto 5432)** con `sslmode=require`: Cloud Run no tiene salida IPv6 y el host directo de un proyecto gratuito solo tiene IPv6. El modo sesión conserva las sentencias preparadas y el `SET LOCAL` del ADR 0035; el modo transacción (6543) no.
- **Flyway no corre en el núcleo de producción** (`spring.flyway.enabled=false` en `application-prod.yaml`). Corre antes de cada despliegue desde el workflow (F0-25) con el rol `postgres`; así el núcleo en ejecución nunca tiene la contraseña del dueño de las tablas.
- **Bucket R2** `pos-saas-backups` con reglas de ciclo de vida: `daily/` se borra a los 30 días, `monthly/` a los 365, y las subidas incompletas al día. La retención no depende de ningún script.
- **Estado de Terraform:** local por omisión (`terraform.tfstate`, ignorado por Git) o remoto en un bucket de Cloud Storage con versiones, copiando `backend.tf.example`. El estado contiene las contraseñas generadas, por eso nunca va a Git.
- **Presupuesto de alerta** opcional (`google_billing_budget`) que avisa por correo al primer centavo cobrado.
- **CI** corre `terraform fmt -check` y `terraform validate` (con `init -backend=false` y el archivo de bloqueo en solo lectura) y construye la imagen, sin credenciales y sin `apply`. `plan` lo corre el dueño en su equipo: un plan real necesita credenciales de las tres nubes.

## Límites del nivel gratuito (noviembre de 2026)
| Servicio | Límite gratuito | Uso esperado de la tienda |
| --- | --- | --- |
| Cloud Run | 180,000 vCPU-s, 360,000 GiB-s y 2 millones de peticiones al mes | Sincronización de una caja y el panel: muy por debajo |
| Artifact Registry | 0.5 GB | Tres imágenes de ~200 MB comprimidas |
| Secret Manager | 6 versiones activas y 10,000 accesos al mes | 2 versiones; un acceso por arranque |
| Supabase Free | 500 MB de base, 5 GB de salida, 2 proyectos; se pausa tras 7 días sin actividad; sin respaldos descargables | Decenas de MB el primer año |
| Cloudflare R2 | 10 GB, 1 millón de escrituras y 10 millones de lecturas al mes, salida gratis | ~42 respaldos cifrados de pocos MB |

## Camino de crecimiento
1. **Base cerca de 400 MB o más de un negocio:** Supabase Pro (25 USD al mes): 8 GB, sin pausa y respaldos diarios propios. Solo cambia el plan, no el código.
2. **Arranques en frío molestos en el panel:** `min_instance_count = 1` en Cloud Run (unos 10 a 15 USD al mes con CPU solo en peticiones).
3. **Stack completo en producción** (Keycloak, Redpanda, observabilidad): se reabre el ADR 0013 con un VPS o con servicios administrados, cuando haya ingresos de un segundo negocio.

## Consecuencias
- **$0 al mes** mientras se respeten los límites, con la alerta de presupuesto como red.
- Un arranque en frío tarda segundos; la caja vende sin internet y reintenta, así que no se nota en el mostrador.
- **Supabase se pausa tras una semana sin actividad.** El respaldo diario (F0-25) y el monitoreo externo la mantienen activa; si se pausa, se reactiva desde el panel de Supabase.
- **Las tareas programadas del núcleo** (`@Scheduled`, como el reintento de eventos del ADR 0052) solo avanzan mientras hay una petición en curso, porque la CPU se apaga en reposo. Hoy basta; si un reporte necesita hora fija, se agrega Cloud Scheduler.
- **Keycloak no tiene casa en producción todavía.** El núcleo arranca sin él (las llaves se piden con el primer token) y la sincronización de la caja usa la credencial del dispositivo (ADR 0054). El panel en la nube queda para una tarea aparte.
- **Un solo entorno.** El roadmap pedía staging; con $0 hay un solo proyecto de Supabase útil y un solo servicio. El entorno `production` de GitHub con aprobación manual sustituye a staging como freno. Es un riesgo aceptado hasta tener ingresos.
- Supabase crea proyectos nuevos con PostgreSQL 17, no 16; las migraciones no usan nada que cambie entre esas versiones, y los respaldos se restauran con herramientas 17.
- Lo que la ficha F0-24 pedía de servidor, firewall y dominio cambia de forma: no hay servidor ni firewall que administrar, y el HTTPS lo da `*.run.app`. Un dominio propio queda opcional.
