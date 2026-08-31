output "api_url" {
  description = "Public development API origin for EXPO_PUBLIC_API_BASE_URL."
  value       = google_cloud_run_v2_service.api.uri
}

output "tutor_url" {
  description = "IAM-private development tutor origin used only by the public API."
  value       = google_cloud_run_v2_service.tutor.uri
}

output "tutor_pseudonym_secret" {
  description = "Development-only pseudonym-key secret container; contains no value after apply."
  value       = google_secret_manager_secret.tutor_pseudonym_key.secret_id
}

output "tutor_openai_secret" {
  description = "Development-only OpenAI-key secret container; contains no value after apply."
  value       = google_secret_manager_secret.tutor_openai_key.secret_id
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
