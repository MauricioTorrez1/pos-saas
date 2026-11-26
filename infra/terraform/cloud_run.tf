# The core on Cloud Run: scales to zero, so an idle store costs nothing and the first request after a quiet
# spell waits for a cold start. The register syncs in the background and sells offline, so that wait never
# blocks a sale (ADR 0080).

locals {
  core_plain_env = merge(
    {
      SPRING_PROFILES_ACTIVE = "prod"
      CORE_ENVIRONMENT       = "production"
      CORE_DB_USER           = local.core_db_user
    },
    var.oidc_issuer_uri == "" ? {} : { CORE_OIDC_ISSUER_URI = var.oidc_issuer_uri },
  )

  core_secret_env = {
    CORE_DB_URL      = google_secret_manager_secret.core_db_url.secret_id
    CORE_DB_PASSWORD = google_secret_manager_secret.core_db_password.secret_id
  }
}

resource "google_cloud_run_v2_service" "core" {
  name                = var.core_service_name
  location            = var.gcp_region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true

  template {
    service_account                  = google_service_account.core_runtime.email
    max_instance_request_concurrency = 40
    timeout                          = "60s"

    scaling {
      min_instance_count = 0
      max_instance_count = var.core_max_instances
    }

    containers {
      image = var.core_initial_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = var.core_memory
        }
        # CPU only while a request is being served: that is what keeps the core inside the free tier.
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.core_plain_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.core_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }

      # Traffic arrives only after Spring reports itself ready. Two minutes cover a cold JVM start.
      startup_probe {
        initial_delay_seconds = 0
        period_seconds        = 5
        timeout_seconds       = 3
        failure_threshold     = 24
        http_get {
          path = "/actuator/health/readiness"
        }
      }

      # Restarts an instance whose JVM stopped answering. It does not look at the database on purpose:
      # a paused Supabase must not turn into a restart loop.
      liveness_probe {
        period_seconds    = 30
        timeout_seconds   = 3
        failure_threshold = 3
        http_get {
          path = "/actuator/health/liveness"
        }
      }
    }
  }

  lifecycle {
    # The deploy workflow rolls out each new image; Terraform owns everything else of the service.
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_version.core_db_url,
    google_secret_manager_secret_version.core_db_password,
    google_secret_manager_secret_iam_member.runtime_reads_db_url,
    google_secret_manager_secret_iam_member.runtime_reads_db_password,
  ]
}

# The register and the panel call the core over the internet; the core checks its own tokens and device
# credentials, so Cloud Run lets every caller through.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  name     = google_cloud_run_v2_service.core.name
  location = google_cloud_run_v2_service.core.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# The deployer may roll out revisions of this service only, not of any other service of the project.
resource "google_cloud_run_v2_service_iam_member" "deployer_deploys_core" {
  name     = google_cloud_run_v2_service.core.name
  location = google_cloud_run_v2_service.core.location
  role     = "roles/run.developer"
  member   = google_service_account.deployer.member
}
