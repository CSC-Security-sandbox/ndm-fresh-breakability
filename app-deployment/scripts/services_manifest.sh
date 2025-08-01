#!/bin/bash
# generate_services_manifest.sh
# Usage: ./generate_services_manifest.sh <output_json> <ref_type> <ref_name>

set -euo pipefail

ARTIFACTORY_BASE="https://generic.repo.eng.netapp.com/artifactory/openlab-generic/cicd/ndm/manifests"
OUTPUT_JSON=$1
REF_TYPE=$2
REF_NAME=$3

services=(
    "admin-service:admin_service_tag:admin_service_branch:ndm-admin-service"
    "config-service:config_service_tag:config_service_branch:ndm-config-service"
    "datamigrator-ui:datamigrator_ui_tag:datamigrator_ui_branch:ndm-datamigrator-ui"
    "db-writer:db_writer_service_tag:db_writer_service_branch:ndm-db-writer"
    "db-migrations:db_migrations_tag:db_migrations_branch:ndm-db-migrations"
    "jobs-service:jobs_service_tag:jobs_service_branch:ndm-jobs-service"
    "reports-service:reports_service_tag:reports_service_branch:ndm-reports-service"
    "support-service:support_service_tag:support_service_branch:ndm-support-service"
    "keycloak-customizations:keycloak_customizations_tag:keycloak_customizations_branch:ndm-keycloak-customizations"
)

SERVICES_JSON="["
for mapping in "${services[@]}"; do
    IFS=":" read -r artifactory_service tag_var branch_var acr_image_name <<< "$mapping"

    env_tag_var="$(echo "$tag_var" | tr '[:lower:]' '[:upper:]')"
    env_branch_var="$(echo "$branch_var" | tr '[:lower:]' '[:upper:]')"
    tag="${!env_tag_var:-}"
    branch="${!env_branch_var:-}"

    if [[ "$tag" == "latest" ]]; then
        if [[ "$REF_TYPE" == "releases" ]]; then
            latest_url="${ARTIFACTORY_BASE}/services/${artifactory_service}/${REF_TYPE}/${REF_NAME}/latest.json"
        else
            latest_url="${ARTIFACTORY_BASE}/services/${artifactory_service}/${REF_TYPE}/${branch}/latest.json"
        fi
        latest_json=$(curl -sf "$latest_url")
        meta_path=$(echo "$latest_json" | jq -r '.metadata_path // empty')
        if [[ -n "$meta_path" ]]; then
            meta_url="${ARTIFACTORY_BASE}/${meta_path}"
            json=$(curl -sf "$meta_url")
        else
            json="$latest_json"
        fi
    else
        short_sha="${tag:0:7}"
        if [[ "$REF_TYPE" == "releases" ]]; then
            meta_url="${ARTIFACTORY_BASE}/services/${artifactory_service}/${REF_TYPE}/${REF_NAME}/${short_sha}/metadata.json"
        else
            meta_url="${ARTIFACTORY_BASE}/services/${artifactory_service}/${REF_TYPE}/${branch}/${short_sha}/metadata.json"
        fi
        json=$(curl -sf "$meta_url")
    fi
    
    # Extract fields from metadata.json
    commit=$(echo "$json" | jq -r '.commit // empty')
    short_commit=$(echo "$json" | jq -r '.short_commit // empty')
    branch=$(echo "$json" | jq -r '.branch // empty')
    image=$(echo "$json" | jq -r '.image // empty')
    build_time=$(echo "$json" | jq -r '.build_time // empty')
    workflow=$(echo "$json" | jq -r '.workflow // empty')
    workflow_run_id=$(echo "$json" | jq -r '.run_id // empty')

    # Compose JSON object for this service
    SERVICES_JSON="${SERVICES_JSON}{\"service\":\"$artifactory_service\",\"commit\":\"$commit\",\"short_commit\":\"$short_commit\",\"branch\":\"$branch\",\"image\":\"$image\",\"build_time\":\"$build_time\",\"workflow\":\"$workflow\",\"workflow_run_id\":\"$workflow_run_id\"},"
done
SERVICES_JSON="${SERVICES_JSON%,}]"
echo "$SERVICES_JSON" > "$OUTPUT_JSON"
echo "[INFO] Wrote services array to $OUTPUT_JSON"
