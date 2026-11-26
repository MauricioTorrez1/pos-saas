# Despliegue en la nube: guía paso a paso

Esta guía pone el núcleo en internet con costo de $0 (ADR 0081): **Cloud Run** corre el núcleo, **Supabase** guarda PostgreSQL y **Cloudflare R2** guarda los respaldos cifrados. Terraform crea casi todo; tú creas las cuentas, verificas la facturación y guardas las llaves. Ninguna contraseña ni token se escribe en un archivo del repositorio.

> Analogía: Terraform es el plano de la casa. Tú compras el terreno (las cuentas) y le das las llaves al albañil (los tokens en variables de entorno); él construye según el plano y anota en una libreta (el *state*, estado) qué construyó. Esa libreta tiene contraseñas, por eso nunca va a Git.

Todos los comandos son de PowerShell y se corren desde la raíz del repositorio, salvo que se diga otra cosa.

## 0. Herramientas en tu PC
1. **Google Cloud CLI** (`gcloud`): instálalo desde https://cloud.google.com/sdk/docs/install.
2. **Terraform 1.14**: `winget install Hashicorp.Terraform`, o usa la imagen de Docker `hashicorp/terraform:1.14.9` como en CI.
3. **Docker Desktop**, que ya usas para Compose.
4. **GitHub CLI** (`gh`), que ya usas.

## 1. Cuenta de Google Cloud
1. Entra a https://console.cloud.google.com con tu cuenta de Google y acepta los términos.
2. Crea una **cuenta de facturación** (Billing) con tu tarjeta. Google la pide para verificar identidad; con el uso de la tienda el cobro es $0. Si te ofrece el crédito de prueba de 300 USD, no afecta al nivel gratuito permanente.
3. Crea un **proyecto**, por ejemplo `pos-saas-prod`. Anota su **ID** (puede llevar un número al final).
4. Inicia sesión en tu PC:

```powershell
gcloud auth login
```

```powershell
gcloud auth application-default login
```

```powershell
gcloud config set project TU-PROYECTO-ID
```

5. Liga la facturación al proyecto (si la consola no lo hizo) y anota el ID de la cuenta de facturación para la alerta de presupuesto:

```powershell
gcloud billing accounts list
```

```powershell
gcloud billing projects link TU-PROYECTO-ID --billing-account=XXXXXX-XXXXXX-XXXXXX
```

## 2. Cuenta de Supabase
1. Crea la cuenta en https://supabase.com (puedes entrar con GitHub). El plan **Free** no pide tarjeta.
2. Crea una **organización** en plan Free. No crees el proyecto a mano: lo crea Terraform.
3. Anota el **slug** de la organización: Dashboard > Organization settings > General.
4. Crea un **token personal**: Account > Access Tokens > Generate new token, con nombre `terraform`. Cópialo una sola vez a tu gestor de contraseñas.

## 3. Cuenta de Cloudflare y R2
1. Crea la cuenta en https://dash.cloudflare.com.
2. Entra a **R2 Object Storage** y actívalo. Cloudflare pide una tarjeta aunque el uso quede en los 10 GB gratuitos.
3. Anota el **Account ID** (columna derecha de la página de inicio de la cuenta).
4. Crea un **token de API para Terraform**: My Profile > API Tokens > Create Token > Custom token, con el permiso *Account · Workers R2 Storage · Edit* y solo tu cuenta. Guárdalo en tu gestor de contraseñas.

El token de R2 que usará el respaldo diario (llave de acceso S3) se crea en la tarea F0-25, con permiso solo sobre el bucket.

## 4. Los tokens van en variables de entorno, no en archivos
En cada ventana de PowerShell donde corras Terraform:

```powershell
$env:SUPABASE_ACCESS_TOKEN = Read-Host -MaskInput "Token de Supabase"
```

```powershell
$env:CLOUDFLARE_API_TOKEN = Read-Host -MaskInput "Token de Cloudflare"
```

Google no necesita variable: usa la sesión de `gcloud auth application-default login`.

## 5. Estado remoto (recomendado)
El estado local funciona, pero si se pierde tu PC se pierde la libreta. Para guardarlo en Cloud Storage con versiones:

```powershell
gcloud storage buckets create gs://TU-PROYECTO-ID-tfstate --location=us-east1 --uniform-bucket-level-access --public-access-prevention
```

```powershell
gcloud storage buckets update gs://TU-PROYECTO-ID-tfstate --versioning
```

Después copia `infra/terraform/backend.tf.example` a `infra/terraform/backend.tf` y cambia el nombre del bucket. Si prefieres empezar con estado local, omite este paso: el archivo `terraform.tfstate` queda en `infra/terraform/`, ignorado por Git, y debes respaldarlo tú.

## 6. Aplicar Terraform
1. Copia `infra/terraform/terraform.tfvars.example` a `infra/terraform/terraform.tfvars` y llena el ID del proyecto, el slug de Supabase, el Account ID de Cloudflare y, si quieres la alerta, la cuenta de facturación.
2. Corre:

```powershell
terraform -chdir=infra/terraform init
```

```powershell
terraform -chdir=infra/terraform plan -out=tfplan
```

3. Lee el plan (*plan*: la lista de lo que va a crear, sin tocar nada todavía). Debe crear APIs, el repositorio de imágenes, dos cuentas de servicio, la federación con GitHub, dos secretos con su versión, el proyecto de Supabase, el bucket R2 con sus reglas y el servicio `pos-core` con una imagen de muestra. No debe destruir nada.

```powershell
terraform -chdir=infra/terraform apply tfplan
```

Crear el proyecto de Supabase tarda unos minutos. Si el `apply` falla al leer el pooler (`supabase_pooler`), copia el host de Supabase > proyecto > **Connect** > **Session pooler** (algo como `aws-0-us-east-1.pooler.supabase.com`) a `supabase_pooler_host` en `terraform.tfvars` y repite `plan` y `apply`.

## 7. Revisar el servicio

```powershell
terraform -chdir=infra/terraform output core_url
```

Al abrir esa dirección ves la página de muestra de Cloud Run: el núcleo real llega con el primer despliegue (F0-25).

## 8. Primera migración y contraseña de `pos_app`
La migración V2 crea el rol `pos_app` sin contraseña (ADR 0035). Desde F0-25 el workflow de despliegue migra antes de cada versión; la contraseña de `pos_app` se fija **una sola vez**, después de la primera migración. Los comandos leen las contraseñas de `terraform output`, así no las ves ni las tecleas.

```powershell
$pooler = terraform -chdir=infra/terraform output -raw supabase_pooler_host
```

```powershell
$env:PGPASSWORD = terraform -chdir=infra/terraform output -raw migrator_db_password
```

```powershell
$migrator = terraform -chdir=infra/terraform output -raw migrator_db_user
```

Primera migración. Hazla **antes** de activar el despliegue automático: si el primer despliegue migra y `pos_app` todavía no tiene contraseña, la prueba de humo falla y el workflow regresa el tráfico a la versión anterior.

```powershell
docker run --rm -e FLYWAY_PASSWORD=$env:PGPASSWORD -v "${PWD}/services/core/src/main/resources/db/migration:/flyway/sql:ro" flyway/flyway:12.11.0 -url="jdbc:postgresql://${pooler}:5432/postgres?sslmode=require" -user="$migrator" migrate
```

Contraseña de `pos_app` (la variable de psql evita escribirla dentro del SQL):

```powershell
"ALTER ROLE pos_app PASSWORD :'pw';" | docker run --rm -i -e PGPASSWORD postgres:17 psql "host=$pooler port=5432 dbname=postgres user=$migrator sslmode=require" -v ON_ERROR_STOP=1 -v pw="$(terraform -chdir=infra/terraform output -raw app_db_password)"
```

```powershell
Remove-Item Env:PGPASSWORD
```

Comprueba que `postgres` puede respaldar tablas con RLS forzada (debe responder `t`):

```powershell
"select rolbypassrls from pg_roles where rolname = 'postgres';" | docker run --rm -i -e PGPASSWORD=$(terraform -chdir=infra/terraform output -raw migrator_db_password) postgres:17 psql "host=$pooler port=5432 dbname=postgres user=$migrator sslmode=require" -tA
```

## 9. Comprobaciones finales
- La consola de Cloud Run muestra `pos-core` sano y con mínimo 0 instancias.
- Secret Manager muestra `core-db-url` y `core-db-password`, cada uno con una versión.
- R2 muestra el bucket `pos-saas-backups` con tres reglas de ciclo de vida.
- Billing > Budgets muestra la alerta “pos-saas: any spend”, si diste la cuenta de facturación.

## 10. Llave de cifrado de los respaldos (`age`)
Los respaldos se cifran con una llave pública que vive en el repositorio. Solo la llave privada, que **nunca** sube a Git ni a GitHub, puede abrirlos (ADR 0082).

> Analogía: la llave pública es un buzón con ranura: cualquiera puede meter cartas, nadie puede sacarlas. La privada es la única llave del buzón.

1. Instala `age` (`winget install FiloSottile.age`) y crea el par:

```powershell
age-keygen -o pos-backup.key
```

2. Guarda `pos-backup.key` en tu gestor de contraseñas **y** en una USB que se quede en la tienda. Sin ella ningún respaldo se puede restaurar.
3. Copia la línea `Public key: age1...` (solo la parte `age1...`) al final de `infra/backup/age-recipients.txt`, haz commit y PR. Borra `pos-backup.key` de la carpeta del repositorio.

## 11. Token de R2 para el respaldo
En Cloudflare > R2 > **Manage API tokens** > Create API token: permiso **Object Read & Write**, aplicado **solo** al bucket `pos-saas-backups`. Copia el *Access Key ID* y el *Secret Access Key*; van como secretos de GitHub en el paso 12.

## 12. Configurar GitHub
1. **Entorno con aprobación manual:** Settings > Environments > New environment `production` > *Required reviewers*: tú. Marca también *Prevent self-review* solo si otra persona puede aprobar.
2. **Variables del repositorio** (Settings > Secrets and variables > Actions > Variables). Los valores salen de `terraform -chdir=infra/terraform output`:

| Variable | De dónde sale |
| --- | --- |
| `GCP_PROJECT_ID` | Tu ID de proyecto |
| `GCP_REGION` | `output gcp_region` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `output workload_identity_provider` |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | `output deployer_service_account` |
| `GCP_ARTIFACT_REPOSITORY` | `output artifact_registry_repository` |
| `GCP_RUN_SERVICE` | `output core_service_name` |
| `SUPABASE_POOLER_HOST` | `output supabase_pooler_host` |
| `SUPABASE_PROJECT_REF` | `output supabase_project_ref` |
| `R2_ACCOUNT_ID` | Tu Account ID de Cloudflare |
| `R2_BUCKET` | `output backup_bucket` |
| `CORE_URL` | `output core_url` |

3. **Secretos del repositorio.** El de la base se pasa directo de Terraform a GitHub, sin que lo veas:

```powershell
terraform -chdir=infra/terraform output -raw migrator_db_password | gh secret set SUPABASE_DB_PASSWORD
```

```powershell
gh secret set R2_ACCESS_KEY_ID
```

```powershell
gh secret set R2_SECRET_ACCESS_KEY
```

4. **Primer despliegue:** Actions > **Deploy** > *Run workflow*, y aprueba el entorno `production` cuando lo pida. Al final verás la dirección del núcleo y el job verde.
5. **Primer respaldo:** Actions > **Backups** > *Run workflow*. En R2 debe aparecer `daily/pos-saas-<fecha>.dump.age`.

Mientras falte algo de esto, los workflows **Deploy**, **Backups** y **Uptime** se saltan solos (aparecen grises o con un aviso), no fallan.

## 13. Simulacro de restauración (cada trimestre)
Un respaldo que nunca se restauró no es un respaldo. CI ya prueba cada día la ida y vuelta con datos de prueba (job *Backup restore test*); el simulacro prueba **tu** llave con **tu** respaldo real, en tu PC y nunca contra producción.

1. Descarga el respaldo más reciente de R2 (Dashboard > R2 > `pos-saas-backups` > `daily/`) a una carpeta fuera del repositorio, por ejemplo `C:espaldos`.
2. Copia ahí también `pos-backup.key`.
3. Levanta un PostgreSQL 17 desechable y restaura con la imagen de herramientas:

```powershell
docker build -t pos-backup-tools infra/backup
```

```powershell
docker network create drill; docker run -d --name drill-db --network drill -e POSTGRES_PASSWORD=solo-simulacro postgres:17
```

```powershell
docker run --rm --network drill -v C:espaldos:/work -e PGHOST=drill-db -e PGUSER=postgres -e PGPASSWORD=solo-simulacro -e PGDATABASE=postgres -e AGE_IDENTITY_FILE=/work/pos-backup.key pos-backup-tools restore-backup.sh /work/NOMBRE-DEL-RESPALDO.dump.age
```

4. Debe imprimir algo como `tables: 32, policies: 30, migrations: 16`. Revisa a mano que estén tus productos y las ventas de ayer:

```powershell
docker exec drill-db psql -U postgres -c "select count(*) from product"
```

5. Borra todo al terminar (cierra antes cualquier programa conectado a `drill-db`):

```powershell
docker rm -f drill-db; docker network rm drill
```

**RPO** (*Recovery Point Objective*, cuánto puedes perder): hasta un día de datos del servidor; la caja conserva sus ventas en SQLite y las vuelve a sincronizar. **RTO** (*Recovery Time Objective*, cuánto tardas en volver): unos 30 minutos siguiendo este simulacro contra un proyecto nuevo de Supabase.

## Mantenimiento
- **Rotar la contraseña de `pos_app`:** `terraform -chdir=infra/terraform apply -replace=random_password.app`, repite el `ALTER ROLE` del paso 8 y despliega una revisión nueva para que Cloud Run lea el secreto nuevo.
- **Supabase pausado:** Dashboard > proyecto > Restore. Pasa si en una semana no hubo respaldo ni peticiones.
- **Nunca** subas `terraform.tfstate` ni `terraform.tfvars`; `.gitignore` ya los cubre y el check “Sensitive files” lo vigila. `backend.tf` solo tiene el nombre del bucket y puede quedarse fuera de Git también.
