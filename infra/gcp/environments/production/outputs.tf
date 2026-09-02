output "api_url" {
  description = "Canonical production API origin used by desktop releases."
  value       = google_cloud_run_v2_service.api.uri
}

output "artifact_repository" {
  description = "Production Docker repository."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.repository_id}"
}

output "deploy_workload_identity_provider" {
  description = "Non-secret WIF provider identifier for production-staging deployment."
  value       = google_iam_workload_identity_pool_provider.deploy.name
}

output "deploy_service_account" {
  description = "Non-secret production deployment service-account identifier."
  value       = google_service_account.github_deployer.email
}

output "release_workload_identity_provider" {
  description = "Non-secret WIF provider identifier for protected desktop tags."
  value       = google_iam_workload_identity_pool_provider.release.name
}

output "release_service_account" {
  description = "Non-secret desktop release service-account identifier."
  value       = google_service_account.desktop_releaser.email
}

output "production_contract" {
  description = "Non-secret resolved production activation contract."
  value = {
    project_id              = var.project_id
    project_number          = data.google_project.current.number
    identity_contract       = local.production_identity
    region                  = var.region
    clerk_issuer            = var.clerk_issuer
    revenuecat_enabled      = var.revenuecat_enabled
    revenuecat_environment  = var.revenuecat_environment
    revenuecat_secret_set   = var.revenuecat_secret_set
    server_secret_versions  = var.revenuecat_secret_versions
    desktop_secret_versions = var.desktop_public_secret_versions
  }
}
