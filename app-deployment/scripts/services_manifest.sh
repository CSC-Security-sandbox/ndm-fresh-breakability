#!/bin/bash
# generate_services_manifest.sh
# Usage: ./generate_services_manifest.sh <output_json> <ref_type> <ref_name>

set -euo pipefail

ARTIFACTORY_BASE="https://generic.repo.eng.netapp.com/artifactory/openlab-generic/cicd/ndm/manifests"
REF_TYPE=${2:-branches}
REF_NAME=${3:-main}
ACR_NAME="datamigratedev"
OUTPUT_JSON=${1:-services.json}

services=(
    "admin-service:admin_service_tag:ndm-admin-service"
    "config-service:config_service_tag:ndm-config-service"
    "datamigrator-ui:datamigrator_ui_tag:ndm-datamigrator-ui"
    "db-writer:db_writer_service_tag:ndm-db-writer"
    "db-migrations:db_migrations_tag:ndm-db-migrations"
    "jobs-service:jobs_service_tag:ndm-jobs-service"
    "reports-service:reports_service_tag:ndm-reports-service"
    "keycloak-customizations:keycloak_customizations_tag:ndm-keycloak-customizations"
)

SERVICES_JSON="["
for mapping in "${services[@]}"; do
    IFS=":" read -r artifactory_service tag_var acr_image_name <<< "$mapping"
    env_tag_var="$(echo "$tag_var" | tr '[:lower:]' '[:upper:]')"
    custom_tag="${!env_tag_var:-}"

    if [[ -n "$custom_tag" ]]; then
        short_sha="${custom_tag:0:7}"
        meta_url="${ARTIFACTORY_BASE}/services/${artifactory_service}/${REF_TYPE}/${REF_NAME}/${short_sha}/metadata.json"
        json=$(curl -sf "$meta_url")
    else
        latest_url="${ARTIFACTORY_BASE}/services/${artifactory_service}/${REF_TYPE}/${REF_NAME}/latest.json"
        latest_json=$(curl -sf "$latest_url")
        meta_path=$(echo "$latest_json" | jq -r '.metadata_path // empty')
        if [[ -n "$meta_path" ]]; then
            meta_url="${ARTIFACTORY_BASE}/services/${artifactory_service}/${REF_TYPE}/${REF_NAME}/${meta_path##*/services/${artifactory_service}/${REF_TYPE}/${REF_NAME}/}"
            json=$(curl -sf "$meta_url")
        else
            json="$latest_json"
        fi
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
