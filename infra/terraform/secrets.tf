# Database connection of the core in Secret Manager. Cloud Run reads them at start as environment variables.
# The free tier covers 6 active secret versions; these use 2.
#
# The values pass through the Terraform state, which is why the state never goes to Git and, when remote,
# lives in a private bucket with versioning (README.md).

resource "google_secret_manager_secret" "core_db_url" {
  secret_id = "core-db-url"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "core_db_password" {
  secret_id = "core-db-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "core_db_url" {
  secret      = google_secret_manager_secret.core_db_url.id
  secret_data = local.core_db_url
}

resource "google_secret_manager_secret_version" "core_db_password" {
  secret      = google_secret_manager_secret.core_db_password.id
  secret_data = random_password.app.result
}

# Read access per secret, not per project: the runtime account cannot list or read any other secret.
resource "google_secret_manager_secret_iam_member" "runtime_reads_db_url" {
  secret_id = google_secret_manager_secret.core_db_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.core_runtime.member
}

resource "google_secret_manager_secret_iam_member" "runtime_reads_db_password" {
  secret_id = google_secret_manager_secret.core_db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.core_runtime.member
}
