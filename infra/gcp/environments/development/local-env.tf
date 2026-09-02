variable "local_env_secret_versions" {
  description = "Pinned development Secret Manager versions used by the local environment sync command."
  type = object({
    clerk_publishable_key  = string
    revenuecat_web_api_key = string
  })

  validation {
    condition = alltrue([
      for version in values(var.local_env_secret_versions) : can(regex("^[1-9][0-9]*$", version))
    ])
    error_message = "Local environment secret versions must be immutable positive numbers."
  }
}

locals {
  local_env_public_config = {
    clerk_publishable_key  = "glidelingo-desktop-clerk-publishable-key"
    revenuecat_web_api_key = "glidelingo-revenuecat-sandbox-web-public-key"
  }
}

resource "google_secret_manager_secret" "local_env_public_config" {
  for_each = local.local_env_public_config

  project   = var.project_id
  secret_id = each.value
  labels = merge(local.labels, {
    data_class = "public-config"
    consumer   = "local-desktop"
  })

  replication {
    user_managed {
      replicas { location = var.region }
    }
  }

  depends_on = [google_project_service.required]
}

output "local_env_public_config_containers" {
  description = "Development client configuration containers; values are seeded out of band."
  value = {
    for key, secret in google_secret_manager_secret.local_env_public_config : key => secret.secret_id
  }
}
