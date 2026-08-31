variable "project_id" {
  description = "The dedicated Google Cloud development project."
  type        = string

  validation {
    condition     = var.project_id == "glidelingo-development"
    error_message = "Development infrastructure may only target glidelingo-development."
  }
}

variable "region" {
  description = "The single region for Cloud Run, Cloud SQL, and Artifact Registry."
  type        = string
  default     = "us-west1"
}

variable "billing_account_id" {
  description = "Billing account attached to the development project, without the billingAccounts/ prefix."
  type        = string

  validation {
    condition     = can(regex("^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$", var.billing_account_id))
    error_message = "The billing account ID must use the XXXXXX-XXXXXX-XXXXXX format."
  }
}

variable "monthly_budget_usd" {
  description = "Alerts-only monthly development budget in USD."
  type        = number
  default     = 50

  validation {
    condition     = var.monthly_budget_usd >= 10
    error_message = "The monthly budget must be at least USD 10."
  }
}

variable "bootstrap_image" {
  description = "Public image used until the first application deployment workflow completes."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}
