# PostgreSQL lives in Supabase free (ADR 0077). Terraform creates the project and both database passwords.
# Free plan: 500 MB of database, no instance size to choose, and the project pauses after a week without
# requests; the daily backup and the uptime check of the core keep it active.

# Password of the "postgres" role: it owns the tables, runs Flyway and takes the backups.
resource "random_password" "migrator" {
  length  = 32
  special = false
}

# Password of "pos_app", the role without BYPASSRLS that the core uses (ADR 0035). The V2 migration creates
# the role without a password; the runbook sets this one with ALTER ROLE after the first migration.
resource "random_password" "app" {
  length  = 32
  special = false
}

resource "supabase_project" "main" {
  organization_id   = var.supabase_organization_id
  name              = var.supabase_project_name
  database_password = random_password.migrator.result
  region            = var.supabase_region

  lifecycle {
    # Changing the password from Terraform would recreate the project. Rotate it in Supabase instead.
    ignore_changes  = [database_password]
    prevent_destroy = true
  }
}

# The provider reads the pooler connection strings of the project, so nobody copies a host by hand.
data "supabase_pooler" "main" {
  project_ref = supabase_project.main.id
}

locals {
  supabase_project_ref = supabase_project.main.id

  # Every pooler mode of a project shares one host; only the port changes. The variable wins when set.
  supabase_pooler_host = (
    var.supabase_pooler_host != ""
    ? var.supabase_pooler_host
    : regex("@([^:/]+)", values(data.supabase_pooler.main.url)[0])[0]
  )

  # Cloud Run has no IPv6 egress and the direct host of a free project is IPv6 only, so the core goes through
  # the Supavisor pooler in session mode (port 5432): it keeps prepared statements and SET LOCAL working.
  # Supavisor tells projects apart by the "<role>.<project ref>" user name.
  core_db_url  = "jdbc:postgresql://${local.supabase_pooler_host}:5432/postgres?sslmode=require"
  core_db_user = "pos_app.${local.supabase_project_ref}"
}
