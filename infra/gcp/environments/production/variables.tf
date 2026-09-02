variable "project_id" {
  description = "The isolated Google Cloud production project."
  type        = string

  validation {
    condition     = var.project_id == "glidelingo-prod-50843312405"
    error_message = "Production may target only the single pinned project ID glidelingo-prod-50843312405."
  }
}

variable "region" {
  description = "Production region for Cloud Run, Cloud SQL, Secret Manager, and Artifact Registry."
  type        = string
  default     = "us-west1"
}

variable "billing_account_id" {
  description = "Billing account attached to the production project, without billingAccounts/."
  type        = string

  validation {
    condition     = can(regex("^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$", var.billing_account_id))
    error_message = "The billing account ID must use XXXXXX-XXXXXX-XXXXXX format."
  }
}

variable "monthly_budget_usd" {
  description = "Alerts-only monthly production budget."
  type        = number
  default     = 50

  validation {
    condition     = var.monthly_budget_usd >= 10
    error_message = "The monthly production budget must be at least USD 10."
  }
}

variable "bootstrap_image" {
  description = "Public image used until the first reviewed production deployment."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "clerk_issuer" {
  description = "Exact production Clerk issuer."
  type        = string
  default     = "https://clerk.glidelingo.com"

  validation {
    condition     = var.clerk_issuer == "https://clerk.glidelingo.com"
    error_message = "Production must use the canonical clerk.glidelingo.com issuer."
  }
}

variable "clerk_authorized_parties" {
  description = "Exact production desktop origins accepted for Clerk azp validation."
  type        = list(string)
  default     = ["https://desktop.glidelingo.com"]

  validation {
    condition     = length(var.clerk_authorized_parties) == 1 && var.clerk_authorized_parties[0] == "https://desktop.glidelingo.com"
    error_message = "Production authorized parties must contain only the canonical desktop HTTPS origin."
  }
}

variable "revenuecat_enabled" {
  description = "Enable RevenueCat only through a reviewed activation-manifest change."
  type        = bool
  default     = false
}

variable "revenuecat_environment" {
  description = "Provider event environment accepted by the production API."
  type        = string
  default     = "SANDBOX"

  validation {
    condition     = contains(["SANDBOX", "PRODUCTION"], var.revenuecat_environment)
    error_message = "RevenueCat environment must be SANDBOX or PRODUCTION."
  }
}

variable "revenuecat_secret_set" {
  description = "Separate Secret Manager container set selected by the activation manifest."
  type        = string
  default     = "sandbox"

  validation {
    condition     = contains(["sandbox", "production"], var.revenuecat_secret_set)
    error_message = "RevenueCat secret set must be sandbox or production."
  }
}

variable "revenuecat_secret_versions" {
  description = "Exact versions mounted into Cloud Run; null means billing remains disabled."
  type = object({
    api_key                = optional(string)
    pseudonym_key          = optional(string)
    webhook_authorization  = optional(string)
    webhook_signing_secret = optional(string)
  })
  default = {}

  validation {
    condition = alltrue([
      for version in values(var.revenuecat_secret_versions) :
      version == null || can(regex("^[1-9][0-9]*$", version))
    ])
    error_message = "RevenueCat versions must be null or immutable positive numbers."
  }
}

variable "desktop_public_secret_versions" {
  description = "Exact public build-input versions used by release jobs; public values remain versioned for provenance."
  type = object({
    clerk_publishable_key  = optional(string)
    revenuecat_web_api_key = optional(string)
  })
  default = {}

  validation {
    condition = alltrue([
      for version in values(var.desktop_public_secret_versions) :
      version == null || can(regex("^[1-9][0-9]*$", version))
    ])
    error_message = "Desktop build-input versions must be null or immutable positive numbers."
  }
}
