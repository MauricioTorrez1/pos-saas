# Provider versions are pinned to a minor line; .terraform.lock.hcl pins the exact builds and their hashes.
terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.5"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # No backend block here on purpose: without one, state stays local (terraform.tfstate, ignored by Git).
  # To keep it in Cloud Storage instead, copy backend.tf.example to backend.tf (see README.md).
}
