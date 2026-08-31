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

variable "clerk_issuer" {
  description = "Exact public Clerk development issuer used to validate session JWTs."
  type        = string
  default     = "https://vast-gator-9531.clerk.accounts.dev"

  validation {
    condition     = can(regex("^https://[a-z0-9-]+\\.clerk\\.accounts\\.dev$", var.clerk_issuer))
    error_message = "The development Clerk issuer must be an exact HTTPS clerk.accounts.dev origin."
  }
}

variable "clerk_jwks_url" {
  description = "Public Clerk JWKS endpoint paired with the development issuer."
  type        = string
  default     = "https://vast-gator-9531.clerk.accounts.dev/.well-known/jwks.json"

  validation {
    condition     = var.clerk_jwks_url == "${var.clerk_issuer}/.well-known/jwks.json"
    error_message = "The Clerk JWKS URL must be the well-known endpoint for clerk_issuer."
  }
}

variable "clerk_audience" {
  description = "Optional exact Clerk JWT audience used by the development API."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.clerk_audience == null || length(trimspace(var.clerk_audience)) > 0
    error_message = "Clerk audience cannot be blank."
  }
}

variable "clerk_authorized_parties" {
  description = "Exact authorized-party origins accepted when a Clerk token contains azp."
  type        = list(string)
  default = [
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "glidelingo://app",
  ]

  validation {
    condition = length(var.clerk_authorized_parties) > 0 && alltrue([
      for party in var.clerk_authorized_parties :
      party == "glidelingo://app" || (
        can(regex("^https?://[^/?#]+$", party)) && !strcontains(party, "@")
      )
    ])
    error_message = "Clerk authorized parties must contain credential-free exact HTTP(S) origins or glidelingo://app."
  }
}

variable "revenuecat_enabled" {
  description = "Enable server-owned RevenueCat authorization only after every documented sandbox gate passes."
  type        = bool
  default     = false
}

variable "revenuecat_environment" {
  description = "RevenueCat sandbox purchase environment accepted by the development entitlement boundary."
  type        = string
  default     = "SANDBOX"

  validation {
    condition     = var.revenuecat_environment == "SANDBOX"
    error_message = "The development platform may only use the RevenueCat SANDBOX environment."
  }
}

variable "revenuecat_secret_versions" {
  description = "Immutable Secret Manager version numbers for RevenueCat configuration; null mounts no value."
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
    error_message = "RevenueCat secret versions must be immutable positive version numbers."
  }
}

variable "lesson_tutor_enabled" {
  description = "Enable the public gateway only after every documented activation gate is satisfied."
  type        = bool
  default     = false
}

variable "private_lesson_tutor_enabled" {
  description = "Enable the private runtime only after all documented security and operational gates pass."
  type        = bool
  default     = false
}

variable "lesson_tutor_pseudonym_secret_version" {
  description = "Existing development pseudonym-key secret version; null mounts no secret."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.lesson_tutor_pseudonym_secret_version == null || can(regex("^[1-9][0-9]*$", var.lesson_tutor_pseudonym_secret_version))
    error_message = "The pseudonym-key secret version must be an immutable positive version number."
  }
}

variable "lesson_tutor_openai_secret_version" {
  description = "Existing development OpenAI-key secret version; null mounts no secret."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.lesson_tutor_openai_secret_version == null || can(regex("^[1-9][0-9]*$", var.lesson_tutor_openai_secret_version))
    error_message = "The OpenAI-key secret version must be an immutable positive version number."
  }
}
