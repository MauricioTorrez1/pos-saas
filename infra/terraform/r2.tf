# Encrypted database backups in Cloudflare R2 (free: 10 GB stored, no egress fees). The backup workflow writes
# every day under daily/ and, on the first day of each month, also under monthly/. These rules delete old
# objects, so retention needs no script and keeps working even if the workflow stops.

resource "cloudflare_r2_bucket" "backups" {
  account_id = var.cloudflare_account_id
  name       = var.backup_bucket_name
  location   = "enam"
}

resource "cloudflare_r2_bucket_lifecycle" "backups" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.backups.name

  rules = [
    {
      id      = "expire-daily-backups"
      enabled = true
      conditions = {
        prefix = "daily/"
      }
      delete_objects_transition = {
        condition = {
          type    = "Age"
          max_age = var.backup_daily_retention_days * 86400
        }
      }
    },
    {
      id      = "expire-monthly-backups"
      enabled = true
      conditions = {
        prefix = "monthly/"
      }
      delete_objects_transition = {
        condition = {
          type    = "Age"
          max_age = var.backup_monthly_retention_days * 86400
        }
      }
    },
    {
      # A multipart upload cut short by a failed run would otherwise stay billed forever.
      id      = "abort-unfinished-uploads"
      enabled = true
      conditions = {
        prefix = ""
      }
      abort_multipart_uploads_transition = {
        condition = {
          type    = "Age"
          max_age = 86400
        }
      }
    },
  ]
}
