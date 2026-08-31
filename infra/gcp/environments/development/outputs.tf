output "api_url" {
  description = "Public development API origin for EXPO_PUBLIC_API_BASE_URL."
  value       = google_cloud_run_v2_service.api.uri
}

output "artifact_repository" {
  description = "Docker repository used by the API deployment workflow."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.repository_id}"
}

output "deploy_service_account" {
  description = "Non-secret GitHub Actions service-account identifier."
  value       = google_service_account.github_deployer.email
}

output "workload_identity_provider" {
  description = "Non-secret provider identifier for google-github-actions/auth."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "region" {
  description = "Region shared by the development runtime resources."
  value       = var.region
}
