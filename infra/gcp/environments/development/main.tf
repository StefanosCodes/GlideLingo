locals {
  github_repository       = "StefanosCodes/GlideLingo"
  github_repository_id    = "1352030189"
  github_owner_id         = "309610265"
  database_password_epoch = 2
  revenuecat_secrets = {
    api_key = {
      secret_id = "glidelingo-revenuecat-api-key"
      env_name  = "GLIDELINGO_REVENUECAT_API_KEY"
    }
    pseudonym_key = {
      secret_id = "glidelingo-revenuecat-pseudonym-key"
      env_name  = "GLIDELINGO_REVENUECAT_PSEUDONYM_KEY"
    }
    webhook_authorization = {
      secret_id = "glidelingo-revenuecat-webhook-authorization"
      env_name  = "GLIDELINGO_REVENUECAT_WEBHOOK_AUTHORIZATION"
    }
    webhook_signing_secret = {
      secret_id = "glidelingo-revenuecat-webhook-signing-secret"
      env_name  = "GLIDELINGO_REVENUECAT_WEBHOOK_SIGNING_SECRET"
    }
  }
  labels = {
    application = "glidelingo"
    environment = "development"
    managed_by  = "terraform"
  }
  required_apis = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbuild.googleapis.com",
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
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_project_service" "required" {
  for_each = local.required_apis

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  location      = var.region
  repository_id = "glidelingo-containers"
  description   = "Immutable GlideLingo application container images"
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
    id     = "delete-old-tagged"
    action = "DELETE"
    condition {
      tag_state  = "TAGGED"
      older_than = "7776000s"
    }
  }

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_service_account" "api_runtime" {
  project      = var.project_id
  account_id   = "glidelingo-api-runtime"
  display_name = "GlideLingo API runtime"
  description  = "Least-privilege identity for the development Cloud Run API"

  depends_on = [google_project_service.required]
}

resource "google_service_account" "tutor_runtime" {
  project      = var.project_id
  account_id   = "glidelingo-tutor-runtime"
  display_name = "GlideLingo private tutor runtime"
  description  = "Least-privilege identity for the IAM-private development tutor"

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "api_cloud_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api_runtime.email}"
}

resource "google_sql_database_instance" "postgres" {
  project          = var.project_id
  name             = "glidelingo-development-db"
  region           = var.region
  database_version = "POSTGRES_17"

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

    ip_configuration {
      ipv4_enabled = true
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = false
      record_client_address   = false
    }

    user_labels = local.labels
  }

  lifecycle {
    ignore_changes = [settings[0].disk_size]
  }

  depends_on = [google_project_service.required]
}

resource "google_sql_database" "application" {
  project  = var.project_id
  name     = "glidelingo"
  instance = google_sql_database_instance.postgres.name
  charset  = "UTF8"
}

resource "random_password" "database" {
  length  = 32
  special = false

  keepers = {
    epoch = tostring(local.database_password_epoch)
  }
}

resource "google_sql_user" "application" {
  project             = var.project_id
  name                = "glidelingo_app"
  instance            = google_sql_database_instance.postgres.name
  password_wo         = random_password.database.result
  password_wo_version = local.database_password_epoch
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
}

resource "google_secret_manager_secret_version" "database_url" {
  secret                 = google_secret_manager_secret.database_url.id
  secret_data_wo         = "postgresql+psycopg://glidelingo_app:${random_password.database.result}@/glidelingo?host=/cloudsql/${google_sql_database_instance.postgres.connection_name}"
  secret_data_wo_version = local.database_password_epoch
  deletion_policy        = "DISABLE"
}

resource "google_secret_manager_secret_iam_member" "api_database_url" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_runtime.email}"
}

resource "google_secret_manager_secret" "tutor_pseudonym_key" {
  project   = var.project_id
  secret_id = "glidelingo-tutor-pseudonym-key"
  labels    = local.labels

  replication {
    user_managed {
      replicas { location = var.region }
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "tutor_openai_key" {
  project   = var.project_id
  secret_id = "glidelingo-tutor-openai-key"
  labels    = local.labels

  replication {
    user_managed {
      replicas { location = var.region }
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "revenuecat" {
  for_each = local.revenuecat_secrets

  project   = var.project_id
  secret_id = each.value.secret_id
  labels    = local.labels

  replication {
    user_managed {
      replicas { location = var.region }
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_binding" "api_pseudonym_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.tutor_pseudonym_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  members   = ["serviceAccount:${google_service_account.api_runtime.email}"]
}

resource "google_secret_manager_secret_iam_binding" "tutor_openai_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.tutor_openai_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  members   = ["serviceAccount:${google_service_account.tutor_runtime.email}"]
}

resource "google_secret_manager_secret_iam_member" "api_revenuecat" {
  for_each = google_secret_manager_secret.revenuecat

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_runtime.email}"
}

resource "google_cloud_run_v2_service" "api" {
  project             = var.project_id
  name                = "glidelingo-api"
  location            = var.region
  deletion_protection = false
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

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
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
        value = tostring(var.lesson_tutor_enabled)
      }

      env {
        name  = "GLIDELINGO_LESSON_TUTOR_SERVICE_URL"
        value = google_cloud_run_v2_service.tutor.uri
      }

      env {
        name  = "GLIDELINGO_LESSON_TUTOR_SERVICE_AUDIENCE"
        value = google_cloud_run_v2_service.tutor.uri
      }

      dynamic "env" {
        for_each = var.lesson_tutor_pseudonym_secret_version == null ? [] : [var.lesson_tutor_pseudonym_secret_version]
        content {
          name = "GLIDELINGO_LESSON_TUTOR_PSEUDONYM_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.tutor_pseudonym_key.secret_id
              version = env.value
            }
          }
        }
      }

      env {
        name  = "GLIDELINGO_CLERK_ISSUER"
        value = var.clerk_issuer
      }

      env {
        name  = "GLIDELINGO_CLERK_JWKS_URL"
        value = var.clerk_jwks_url
      }

      dynamic "env" {
        for_each = var.clerk_audience == null ? [] : [var.clerk_audience]
        content {
          name  = "GLIDELINGO_CLERK_AUDIENCE"
          value = env.value
        }
      }

      env {
        name  = "GLIDELINGO_CLERK_AUTHORIZED_PARTIES"
        value = jsonencode(var.clerk_authorized_parties)
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
        for_each = {
          for key, spec in local.revenuecat_secrets : key => {
            env_name = spec.env_name
            version  = var.revenuecat_secret_versions[key]
          } if var.revenuecat_secret_versions[key] != null
        }
        content {
          name = env.value.env_name
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.revenuecat[env.key].secret_id
              version = env.value.version
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

  depends_on = [
    google_project_iam_member.api_cloud_sql_client,
    google_secret_manager_secret_iam_member.api_revenuecat,
    google_secret_manager_secret_iam_binding.api_pseudonym_key,
    google_secret_manager_secret_iam_member.api_database_url,
    google_secret_manager_secret_version.database_url,
  ]

  lifecycle {
    ignore_changes = [template[0].containers[0].image]

    precondition {
      condition = !var.lesson_tutor_enabled || (
        var.private_lesson_tutor_enabled &&
        var.lesson_tutor_pseudonym_secret_version != null &&
        length(var.clerk_issuer) > 0 &&
        length(var.clerk_jwks_url) > 0
      )
      error_message = "The public tutor gateway requires the private service, pseudonym key, and complete Clerk configuration."
    }

    precondition {
      condition = !var.revenuecat_enabled || alltrue([
        for key in keys(local.revenuecat_secrets) : var.revenuecat_secret_versions[key] != null
      ])
      error_message = "RevenueCat authorization requires immutable versions for every RevenueCat configuration value."
    }
  }
}

resource "google_cloud_run_v2_service" "tutor" {
  project              = var.project_id
  name                 = "glidelingo-lesson-tutor"
  location             = var.region
  deletion_protection  = false
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = false
  labels               = local.labels

  template {
    service_account                  = google_service_account.tutor_runtime.email
    timeout                          = "6s"
    max_instance_request_concurrency = 4

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = var.bootstrap_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name  = "GLIDELINGO_TUTOR_ENABLED"
        value = tostring(var.private_lesson_tutor_enabled)
      }

      env {
        name  = "OPENAI_AGENTS_DONT_LOG_MODEL_DATA"
        value = "1"
      }

      env {
        name  = "OPENAI_AGENTS_DONT_LOG_TOOL_DATA"
        value = "1"
      }

      dynamic "env" {
        for_each = var.lesson_tutor_openai_secret_version == null ? [] : [var.lesson_tutor_openai_secret_version]
        content {
          name = "OPENAI_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.tutor_openai_key.secret_id
              version = env.value
            }
          }
        }
      }

      startup_probe {
        timeout_seconds   = 3
        period_seconds    = 5
        failure_threshold = 12
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
  }

  depends_on = [
    google_secret_manager_secret_iam_binding.tutor_openai_key,
    google_service_account.tutor_runtime,
  ]

  lifecycle {
    ignore_changes = [template[0].containers[0].image]

    precondition {
      condition     = !var.private_lesson_tutor_enabled || var.lesson_tutor_openai_secret_version != null
      error_message = "The private tutor cannot be enabled without an explicit OpenAI secret version."
    }
  }
}

resource "google_cloud_run_v2_service_iam_binding" "tutor_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.tutor.location
  name     = google_cloud_run_v2_service.tutor.name
  role     = "roles/run.invoker"
  members  = ["serviceAccount:${google_service_account.api_runtime.email}"]
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
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "OIDC identities from the GlideLingo GitHub repository"

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "glidelingo"
  display_name                       = "GlideLingo GitHub Actions"

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.actor"               = "assertion.actor"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
  }
  attribute_condition = "assertion.repository == '${local.github_repository}' && assertion.repository_id == '${local.github_repository_id}' && assertion.repository_owner_id == '${local.github_owner_id}' && assertion.ref == 'refs/heads/main'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com/"
  }
}

resource "google_service_account" "github_deployer" {
  project      = var.project_id
  account_id   = "glidelingo-github-deployer"
  display_name = "GlideLingo GitHub deployer"
  description  = "Short-lived GitHub OIDC identity for development API deployments"

  depends_on = [google_project_service.required]
}

resource "google_service_account_iam_member" "github_workload_identity" {
  service_account_id = google_service_account.github_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${local.github_repository}"
}

resource "google_artifact_registry_repository_iam_member" "github_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.containers.location
  repository = google_artifact_registry_repository.containers.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_project_iam_custom_role" "github_run_deployer" {
  project     = var.project_id
  role_id     = "glidelingoCloudRunDeployer"
  title       = "GlideLingo Cloud Run deployer"
  description = "Update and inspect existing Cloud Run services without invoke permission"
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

resource "google_project_iam_member" "github_run_deployer" {
  project = var.project_id
  role    = google_project_iam_custom_role.github_run_deployer.id
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_service_account_iam_member" "github_uses_runtime" {
  service_account_id = google_service_account.api_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_service_account_iam_member" "github_uses_tutor_runtime" {
  service_account_id = google_service_account.tutor_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_billing_budget" "development" {
  billing_account = var.billing_account_id
  display_name    = "GlideLingo development monthly budget"

  budget_filter {
    projects = ["projects/${data.google_project.current.number}"]
  }

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
