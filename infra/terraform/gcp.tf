# Google Cloud side of the core: APIs, image registry, service accounts and the trust with GitHub Actions.

locals {
  required_apis = [
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sts.googleapis.com",
    "monitoring.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "billingbudgets.googleapis.com",
  ]
}

resource "google_project_service" "required" {
  for_each = toset(local.required_apis)

  service = each.value
  # Turning an API off on destroy could break things that Terraform does not manage.
  disable_on_destroy = false
}

# --- Image registry -------------------------------------------------------------------------------------

# The free tier of Artifact Registry is 0.5 GB, so only the latest images stay.
resource "google_artifact_registry_repository" "core" {
  repository_id = "pos-core"
  location      = var.gcp_region
  format        = "DOCKER"
  description   = "Images of the core, pushed by the deploy workflow."

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-latest-three"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }

  cleanup_policies {
    id     = "delete-older-than-a-week"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "604800s"
    }
  }

  depends_on = [google_project_service.required]
}

# --- Service accounts -----------------------------------------------------------------------------------

# Identity of the running core. Its only permission is reading its own secrets (see secrets.tf).
resource "google_service_account" "core_runtime" {
  account_id   = "pos-core-runtime"
  display_name = "POS core (Cloud Run runtime)"
  description  = "Runs the core. Reads only the secrets of the core."

  depends_on = [google_project_service.required]
}

# Identity of the deploy workflow. It pushes images and rolls out new revisions of one service, nothing else.
resource "google_service_account" "deployer" {
  account_id   = "pos-core-deployer"
  display_name = "POS core deployer (GitHub Actions)"
  description  = "Used only by the production environment of the GitHub repository, through Workload Identity Federation."

  depends_on = [google_project_service.required]
}

resource "google_artifact_registry_repository_iam_member" "deployer_writes_images" {
  repository = google_artifact_registry_repository.core.name
  location   = google_artifact_registry_repository.core.location
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.deployer.member
}

# Deploying a revision that runs as the runtime account needs permission to act as that account.
resource "google_service_account_iam_member" "deployer_acts_as_runtime" {
  service_account_id = google_service_account.core_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deployer.member
}

# --- Workload Identity Federation: GitHub Actions without JSON keys ------------------------------------

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "Short-lived tokens for the workflows of ${var.github_repository}."

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.repository"  = "assertion.repository"
    "attribute.environment" = "assertion.environment"
    "attribute.ref"         = "assertion.ref"
  }

  # Tokens from any other repository are rejected before any binding is looked at.
  attribute_condition = "assertion.repository == '${var.github_repository}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Only jobs that run in the protected environment (the one with the manual approval) become the deployer.
resource "google_service_account_iam_member" "github_impersonates_deployer" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment/${var.github_deploy_environment}"
}
