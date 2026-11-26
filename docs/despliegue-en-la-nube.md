# Despliegue en la nube: guía paso a paso

Esta guía pone el núcleo en internet con costo de $0 (ADR 0080): **Cloud Run** corre el núcleo, **Supabase** guarda PostgreSQL y **Cloudflare R2** guarda los respaldos cifrados. Terraform crea casi todo; tú creas las cuentas, verificas la facturación y guardas las llaves. Ninguna contraseña ni token se escribe en un archivo del repositorio.

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

Primera migración (solo si todavía no corrió el workflow de despliegue):

```powershell
docker run --rm -v "${PWD}/services/core/src/main/resources/db/migration:/flyway/sql:ro" flyway/flyway:12 -url="jdbc:postgresql://${pooler}:5432/postgres?sslmode=require" -user="$migrator" -password="$env:PGPASSWORD" migrate
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

## Mantenimiento
- **Rotar la contraseña de `pos_app`:** `terraform -chdir=infra/terraform apply -replace=random_password.app`, repite el `ALTER ROLE` del paso 8 y despliega una revisión nueva para que Cloud Run lea el secreto nuevo.
- **Supabase pausado:** Dashboard > proyecto > Restore. Pasa si en una semana no hubo respaldo ni peticiones.
- **Nunca** subas `terraform.tfstate` ni `terraform.tfvars`; `.gitignore` ya los cubre y el check “Sensitive files” lo vigila. `backend.tf` solo tiene el nombre del bucket y puede quedarse fuera de Git también.
