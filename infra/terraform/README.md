# Terraform

Production infrastructure of the core at $0 a month ([ADR 0079](../../docs/adr/0079-nucleo-en-cloud-run-y-base-en-supabase.md)): the core on **Google Cloud Run**, PostgreSQL on **Supabase** free, and encrypted backups on **Cloudflare R2**. The step-by-step guide for the owner, in Spanish, is [docs/despliegue-en-la-nube.md](../../docs/despliegue-en-la-nube.md).

| File | What it declares |
| --- | --- |
| `gcp.tf` | APIs, Artifact Registry with cleanup, runtime and deployer service accounts, Workload Identity Federation for GitHub Actions |
| `secrets.tf` | Secret Manager entries for the database URL and the `pos_app` password, readable only by the runtime account |
| `cloud_run.tf` | The `pos-core` service: min 0 / max 2 instances, CPU only during requests, startup and liveness probes |
| `supabase.tf` | The Supabase project and both generated database passwords |
| `r2.tf` | The backup bucket and its lifecycle rules (`daily/` 30 days, `monthly/` 365 days) |
| `budget.tf` | Optional e-mail alert on the first cent charged |
| `outputs.tf` | Values the runbook copies into GitHub variables and secrets |

## Credentials
No file holds a credential. Each provider reads its own from the environment of whoever runs Terraform:

| Provider | Source |
| --- | --- |
| `google` | Application Default Credentials (`gcloud auth application-default login`) |
| `supabase` | `SUPABASE_ACCESS_TOKEN` |
| `cloudflare` | `CLOUDFLARE_API_TOKEN` |

Database passwords are generated with `random_password` and land in the state, which is why the state never goes to Git (`*.tfstate` and `*.tfvars` are ignored, and the `Sensitive files` check enforces it).

## State
- **Local (default):** no `backend.tf`, so the state stays in `terraform.tfstate` next to the code. Back it up yourself.
- **Remote (recommended):** copy `backend.tf.example` to `backend.tf`, set the bucket created in step 5 of the runbook, and run `terraform init -migrate-state`. The bucket has versioning and public access prevention.

## One apply
The `supabase_pooler` data source reads the pooler host of the new project, so a single `apply` creates the project, the connection secrets and the Cloud Run service. If the provider ever fails to read it, set `supabase_pooler_host` by hand from Supabase > Connect > Session pooler.

## CI
The `Infrastructure` workflow runs `terraform fmt -check`, `terraform init -backend=false -lockfile=readonly` and `terraform validate`, and builds the core image. It never runs `plan` or `apply`: those need real credentials and run on the owner's machine.

```bash
docker run --rm -v "$PWD/infra/terraform:/tf" -w /tf hashicorp/terraform:1.14.9 fmt -check -recursive
docker run --rm -v "$PWD/infra/terraform:/tf" -w /tf hashicorp/terraform:1.14.9 init -backend=false
docker run --rm -v "$PWD/infra/terraform:/tf" -w /tf hashicorp/terraform:1.14.9 validate
```
