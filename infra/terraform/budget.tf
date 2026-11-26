# The plan is to spend nothing. A budget does not cap spending, but it e-mails the billing admins as soon as
# anything is charged, so a free-tier overrun is noticed in days instead of at the end of the month.
resource "google_billing_budget" "zero_spend" {
  count = var.billing_account_id == "" ? 0 : 1

  billing_account = var.billing_account_id
  display_name    = "pos-saas: any spend"

  budget_filter {
    projects = ["projects/${data.google_project.current.number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.budget_alert_amount_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.01
  }

  threshold_rules {
    threshold_percent = 1.0
  }
}

data "google_project" "current" {
  project_id = var.gcp_project_id
}
