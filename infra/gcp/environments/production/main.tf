locals {
  production_identity        = jsondecode(file("${path.module}/identity.json"))
  github_oidc_subject_prefix = local.production_identity.github_oidc_subject_prefix
  github_repository          = "StefanosCodes/GlideLingo"
  github_repository_id       = "1352030189"
  github_owner_id            = "309610265"
  labels = {
    application = "glidelingo"
    environment = "production"
    managed_by  = "terraform"
  }
  required_apis = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "sqladmin.googleapis.com",
    "sts.googleapis.com",
  ])
  revenuecat_fields = {
    api_key                = "GLIDELINGO_REVENUECAT_API_KEY"
    pseudonym_key          = "GLIDELINGO_REVENUECAT_PSEUDONYM_KEY"
    webhook_authorization  = "GLIDELINGO_REVENUECAT_WEBHOOK_AUTHORIZATION"
    webhook_signing_secret = "GLIDELINGO_REVENUECAT_WEBHOOK_SIGNING_SECRET"
  }
  revenuecat_secret_specs = merge([
    for mode in ["sandbox", "production"] : {
      for field, env_name in local.revenuecat_fields : "${mode}_${field}" => {
        mode      = mode
        field     = field
        env_name  = env_name
        secret_id = "glidelingo-revenuecat-${mode}-${replace(field, "_", "-")}"
      }
    }
  ]...)
  selected_revenuecat_secrets = {
    for key, spec in local.revenuecat_secret_specs : spec.field => spec
    if spec.mode == var.revenuecat_secret_set
  }
  desktop_public_config = {
    clerk_publishable_key = {
      secret_id = "glidelingo-desktop-clerk-publishable-key"
      mode      = "shared"
    }
    revenuecat_sandbox_web_key = {
      secret_id = "glidelingo-revenuecat-sandbox-web-public-key"
      mode      = "sandbox"
    }
    revenuecat_production_web_key = {
      secret_id = "glidelingo-revenuecat-production-web-public-key"
      mode      = "production"
    }
  }
  desktop_signing_secrets = toset([
    "glidelingo-desktop-macos-certificate-base64",
    "glidelingo-desktop-macos-certificate-password",
    "glidelingo-desktop-apple-id",
    "glidelingo-desktop-apple-team-id",
    "glidelingo-desktop-apple-app-specific-password",
  ])
  revenuecat_versions_complete = alltrue([
    for field in keys(local.revenuecat_fields) : var.revenuecat_secret_versions[field] != null
  ])
  desktop_versions_complete = alltrue([
    for field in ["clerk_publishable_key", "revenuecat_web_api_key"] :
    var.desktop_public_secret_versions[field] != null
  ])
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_project_service" "required" {
  for_each = local.required_apis

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false

  lifecycle {
    precondition {
      condition = (
        local.production_identity.project_id == var.project_id &&
        local.production_identity.project_number == tostring(data.google_project.current.number) &&
        local.production_identity.github_oidc_subject_prefix == "repo:StefanosCodes@309610265/GlideLingo@1352030189"
      )
      error_message = "The committed production project identity and immutable GitHub OIDC subject prefix must match the reviewed contract."
    }
  }
}

resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  location      = var.region
  repository_id = "glidelingo-containers"
  description   = "Immutable production GlideLingo container images"
  format        = "DOCKER"
  labels        = local.labels

  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "2592000s"
    }
  }

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions { keep_count = 30 }
  }

  depends_on = [google_project_service.required]
}

resource "google_service_account" "api_runtime" {
  project      = var.project_id
  account_id   = "glidelingo-api-runtime"
  display_name = "GlideLingo production API runtime"
  description  = "Least-privilege runtime identity for the isolated production API"

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "api_cloud_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api_runtime.email}"
}

resource "google_sql_database_instance" "postgres" {
  project             = var.project_id
  name                = "glidelingo-production-db"
  region              = var.region
  database_version    = "POSTGRES_17"
  deletion_protection = true

  settings {
    edition                     = "ENTERPRISE"
    tier                        = "db-f1-micro"
    availability_type           = "ZONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = 10
    disk_autoresize             = true
    disk_autoresize_limit       = 50
    activation_policy           = "ALWAYS"
    deletion_protection_enabled = true

    database_flags {
      name  = "cloudsql.enable_pg_cron"
      value = "on"
    }
    database_flags {
      name  = "cron.database_name"
      value = "glidelingo"
    }
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "04:00"
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }
    ip_configuration { ipv4_enabled = true }
    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = false
      record_client_address   = false
    }
    user_labels = local.labels
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [settings[0].disk_size]
  }

  depends_on = [google_project_service.required]
}

resource "google_sql_database" "application" {
  project  = var.project_id
  name     = "glidelingo"
  instance = google_sql_database_instance.postgres.name
  charset  = "UTF8"

  lifecycle {
    prevent_destroy = true
  }
}

resource "random_password" "database" {
  length  = 32
  special = false
}

resource "google_sql_user" "application" {
  project             = var.project_id
  name                = "glidelingo_app"
  instance            = google_sql_database_instance.postgres.name
  password_wo         = random_password.database.result
  password_wo_version = 1
}

resource "google_secret_manager_secret" "database_url" {
  project   = var.project_id
  secret_id = "glidelingo-database-url"
  labels    = local.labels
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.required]

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret                 = google_secret_manager_secret.database_url.id
  secret_data_wo         = "postgresql+psycopg://glidelingo_app:${random_password.database.result}@/glidelingo?host=/cloudsql/${google_sql_database_instance.postgres.connection_name}"
  secret_data_wo_version = 1
  deletion_policy        = "DISABLE"
}

resource "google_secret_manager_secret_iam_member" "api_database_url" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_runtime.email}"
}

resource "google_secret_manager_secret" "revenuecat" {
  for_each = local.revenuecat_secret_specs

  project   = var.project_id
  secret_id = each.value.secret_id
  labels = merge(local.labels, {
    billing_mode = each.value.mode
    consumer     = "api"
  })
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.required]

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret_iam_member" "api_revenuecat" {
  for_each = var.revenuecat_enabled ? local.selected_revenuecat_secrets : {}

  project   = var.project_id
  secret_id = google_secret_manager_secret.revenuecat["${var.revenuecat_secret_set}_${each.key}"].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_runtime.email}"
}

resource "google_secret_manager_secret" "desktop_public_config" {
  for_each = local.desktop_public_config

  project   = var.project_id
  secret_id = each.value.secret_id
  labels = merge(local.labels, {
    billing_mode = each.value.mode
    data_class   = "public-config"
    consumer     = "desktop-release"
  })
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.required]

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret" "desktop_signing" {
  for_each = local.desktop_signing_secrets

  project   = var.project_id
  secret_id = each.value
  labels = merge(local.labels, {
    data_class = "credential"
    consumer   = "desktop-release"
  })
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.required]

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_cloud_run_v2_service" "api" {
  project             = var.project_id
  name                = "glidelingo-api-production"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  labels              = local.labels

  template {
    service_account                  = google_service_account.api_runtime.email
    timeout                          = "15s"
    max_instance_request_concurrency = 20
    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
    containers {
      image = var.bootstrap_image
      ports { container_port = 8080 }
      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      env {
        name = "GLIDELINGO_DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = google_secret_manager_secret_version.database_url.version
          }
        }
      }
      env {
        name  = "GLIDELINGO_LESSON_TUTOR_ENABLED"
        value = "false"
      }
      env {
        name  = "GLIDELINGO_CLERK_ISSUER"
        value = var.clerk_issuer
      }
      env {
        name  = "GLIDELINGO_CLERK_JWKS_URL"
        value = "${var.clerk_issuer}/.well-known/jwks.json"
      }
      env {
        name  = "GLIDELINGO_CLERK_AUTHORIZED_PARTIES"
        value = jsonencode(var.clerk_authorized_parties)
      }
      env {
        name  = "GLIDELINGO_CORS_ORIGINS"
        value = jsonencode(["https://desktop.glidelingo.com"])
      }
      env {
        name  = "GLIDELINGO_REVENUECAT_ENABLED"
        value = tostring(var.revenuecat_enabled)
      }
      env {
        name  = "GLIDELINGO_REVENUECAT_ENVIRONMENT"
        value = var.revenuecat_environment
      }
      dynamic "env" {
        for_each = var.revenuecat_enabled ? local.selected_revenuecat_secrets : {}
        content {
          name = env.value.env_name
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.revenuecat["${var.revenuecat_secret_set}_${env.key}"].secret_id
              version = var.revenuecat_secret_versions[env.key]
            }
          }
        }
      }
      env {
        name  = "GLIDELINGO_DATABASE_POOL_SIZE"
        value = "3"
      }
      env {
        name  = "GLIDELINGO_DATABASE_MAX_OVERFLOW"
        value = "0"
      }
      env {
        name  = "GLIDELINGO_DATABASE_POOL_TIMEOUT_SECONDS"
        value = "1"
      }
      env {
        name  = "GLIDELINGO_DATABASE_STATEMENT_TIMEOUT_SECONDS"
        value = "2"
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 12
        http_get {
          path = "/health/live"
          port = 8080
        }
      }
      liveness_probe {
        initial_delay_seconds = 10
        timeout_seconds       = 3
        period_seconds        = 30
        failure_threshold     = 3
        http_get {
          path = "/health/live"
          port = 8080
        }
      }
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }
  }

  lifecycle {
    ignore_changes = [traffic, template[0].containers[0].image]
    precondition {
      condition = (
        var.revenuecat_environment == "SANDBOX" && var.revenuecat_secret_set == "sandbox"
        ) || (
        var.revenuecat_environment == "PRODUCTION" && var.revenuecat_secret_set == "production"
      )
      error_message = "RevenueCat event environment and isolated secret-container set must match."
    }
    precondition {
      condition     = !var.revenuecat_enabled || (local.revenuecat_versions_complete && local.desktop_versions_complete)
      error_message = "RevenueCat activation requires exact versions for all server and desktop inputs."
    }
  }

  depends_on = [
    google_project_iam_member.api_cloud_sql_client,
    google_secret_manager_secret_iam_member.api_database_url,
    google_secret_manager_secret_iam_member.api_revenuecat,
    google_secret_manager_secret_version.database_url,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public_api" {
  project  = var.project_id
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = local.production_identity.workload_identity_pool_id
  display_name              = "GitHub Actions production"
  description               = "Short-lived GitHub identities for reviewed production operations"
  depends_on                = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "deploy" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = local.production_identity.deploy_provider_id
  display_name                       = "Production deploy"
  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
  }
  attribute_condition = "assertion.repository == '${local.github_repository}' && assertion.repository_id == '${local.github_repository_id}' && assertion.repository_owner_id == '${local.github_owner_id}' && assertion.sub in ['${local.github_oidc_subject_prefix}:environment:production-staging', '${local.github_oidc_subject_prefix}:environment:production'] && assertion.ref == 'refs/heads/main'"
  oidc { issuer_uri = "https://token.actions.githubusercontent.com/" }
}

resource "google_iam_workload_identity_pool_provider" "release" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = local.production_identity.release_provider_id
  display_name                       = "Desktop release"
  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
  }
  attribute_condition = "assertion.repository == '${local.github_repository}' && assertion.repository_id == '${local.github_repository_id}' && assertion.repository_owner_id == '${local.github_owner_id}' && assertion.sub == '${local.github_oidc_subject_prefix}:environment:desktop-release-signing' && (assertion.ref == 'refs/heads/main' || assertion.ref.startsWith('refs/tags/desktop-v'))"
  oidc { issuer_uri = "https://token.actions.githubusercontent.com/" }
}

resource "google_service_account" "github_deployer" {
  project      = var.project_id
  account_id   = local.production_identity.deploy_service_account_id
  display_name = "GlideLingo production deployer"
  depends_on   = [google_project_service.required]
}

resource "google_service_account" "desktop_releaser" {
  project      = var.project_id
  account_id   = local.production_identity.release_service_account_id
  display_name = "GlideLingo desktop releaser"
  depends_on   = [google_project_service.required]
}

resource "google_service_account_iam_member" "github_deploy_identity" {
  for_each = toset([
    "${local.github_oidc_subject_prefix}:environment:production-staging",
    "${local.github_oidc_subject_prefix}:environment:production",
  ])

  service_account_id = google_service_account.github_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principal://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/subject/${each.value}"
}

resource "google_service_account_iam_member" "github_release_identity" {
  service_account_id = google_service_account.desktop_releaser.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principal://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/subject/${local.github_oidc_subject_prefix}:environment:desktop-release-signing"
}

resource "google_artifact_registry_repository_iam_member" "deployer_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.containers.location
  repository = google_artifact_registry_repository.containers.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_project_iam_custom_role" "cloud_run_deployer" {
  project     = var.project_id
  role_id     = "glidelingoProductionDeployer"
  title       = "GlideLingo production Cloud Run deployer"
  description = "Inspect and update the existing production API without broad project administration"
  permissions = [
    "run.operations.get",
    "run.revisions.get",
    "run.revisions.list",
    "run.routes.get",
    "run.routes.list",
    "run.services.get",
    "run.services.list",
    "run.services.update",
  ]
}

resource "google_project_iam_member" "cloud_run_deployer" {
  project = var.project_id
  role    = google_project_iam_custom_role.cloud_run_deployer.id
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_service_account_iam_member" "deployer_uses_runtime" {
  service_account_id = google_service_account.api_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_secret_manager_secret_iam_member" "releaser_public_config" {
  for_each = google_secret_manager_secret.desktop_public_config

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.desktop_releaser.email}"
}

resource "google_secret_manager_secret_iam_member" "releaser_signing" {
  for_each = google_secret_manager_secret.desktop_signing

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.desktop_releaser.email}"
}

resource "google_billing_budget" "production" {
  billing_account = var.billing_account_id
  display_name    = "GlideLingo production monthly budget"
  budget_filter { projects = ["projects/${data.google_project.current.number}"] }
  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }
  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 0.8
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }
  depends_on = [google_project_service.required]
}
