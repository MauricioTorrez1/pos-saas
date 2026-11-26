# Values the runbook copies into GitHub (repository variables and secrets). The passwords are marked
# sensitive, so they only print with `terraform output -raw <name>`, never in a plan or apply log.

output "core_url" {
  description = "HTTPS address of the core on Cloud Run."
  value       = google_cloud_run_v2_service.core.uri
}

output "core_service_name" {
  description = "Cloud Run service the deploy workflow updates (repository variable GCP_RUN_SERVICE)."
  value       = var.core_service_name
}

output "gcp_region" {
  description = "Region of Cloud Run and Artifact Registry (repository variable GCP_REGION)."
  value       = var.gcp_region
}

output "artifact_registry_repository" {
  description = "Docker repository of the core images (repository variable GCP_ARTIFACT_REPOSITORY)."
  value       = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.core.repository_id}"
}

output "workload_identity_provider" {
  description = "Full name of the GitHub OIDC provider (repository variable GCP_WORKLOAD_IDENTITY_PROVIDER)."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account" {
  description = "Account the deploy workflow impersonates (repository variable GCP_DEPLOYER_SERVICE_ACCOUNT)."
  value       = google_service_account.deployer.email
}

output "supabase_pooler_host" {
  description = "Host of the Supavisor pooler (repository variable SUPABASE_POOLER_HOST)."
  value       = local.supabase_pooler_host
}

output "supabase_project_ref" {
  description = "Reference of the Supabase project; it is part of the pooler user names."
  value       = local.supabase_project_ref
}

output "migrator_db_user" {
  description = "Pooler user of the role that owns the tables, runs Flyway and takes backups."
  value       = "postgres.${local.supabase_project_ref}"
}

output "migrator_db_password" {
  description = "Password of the postgres role (GitHub secret SUPABASE_DB_PASSWORD)."
  value       = random_password.migrator.result
  sensitive   = true
}

output "app_db_user" {
  description = "Pooler user of pos_app, the role of the core."
  value       = local.core_db_user
}

output "app_db_password" {
  description = "Password of pos_app. The runbook sets it once with ALTER ROLE after the first migration."
  value       = random_password.app.result
  sensitive   = true
}

output "backup_bucket" {
  description = "R2 bucket of the backups (repository variable R2_BUCKET)."
  value       = cloudflare_r2_bucket.backups.name
}
