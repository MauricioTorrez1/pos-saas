# No provider block holds a credential. Each one reads it from the environment of whoever runs Terraform:
#   google     -> Application Default Credentials (gcloud auth application-default login)
#   supabase   -> SUPABASE_ACCESS_TOKEN
#   cloudflare -> CLOUDFLARE_API_TOKEN
provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

provider "supabase" {}

provider "cloudflare" {}
