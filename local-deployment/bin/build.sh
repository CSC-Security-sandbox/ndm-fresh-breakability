#!/bin/bash
az login --service-principal \
  --username  "${AZ_USERNAME}" \
  --password "${AZ_PASSWORD}" \
  --tenant "${AZ_TENANT}"
 
az acr login --name datamigratedev


script_dir=$(dirname $0)
base_dir=$(realpath $script_dir/../../..)
services=()

if [ -z "$1" ]; then ## build all services
    services=( "keycloak-customizations" "admin-service" "config-service" "data-migrate-ui" "db-writer" "file-service" "jobs-service" "reports-service" )
else
    services=( "$1" )
fi

## TODO:: Loop through services and build them
for service in "${services[@]}"; do
    service_name=$service
    service_version=${2:-latest}

    ## define docker file name as variable and value as Dockerfile by default except for keycloak-customizations it will be dockerfile-microk8s
    docker_file_name="Dockerfile"
    if [ "$service_name" == "keycloak-customizations" ]; then
        docker_file_name="dockerfile-microk8s"
    fi


    echo "Building $service_name:$service_version"
    multipass_output=$(multipass list)
    ip_address=$(echo "$multipass_output" | awk '/datamigrator/ {print $3}')


    echo "Dockerfile: $base_dir/$service_name/$docker_file_name"
    docker build --build-arg GITOPS_USER_GITHUB_TOKEN=$GITOPS_USER_GITHUB_TOKEN -t ${ip_address}:32000/${service_name}:${service_version} -f "${base_dir}/${service_name}/${docker_file_name}" "${base_dir}/${service_name}"
    docker push ${ip_address}:32000/${service_name}:${service_version}

    if [ "$service_name" != "keycloak-customizations" ]; then
        docker build -t ${ip_address}:32000/${service_name}-migrations:${service_version} -f "${base_dir}/${service_name}/liquibase/Dockerfile" "${base_dir}/${service_name}/liquibase"
        docker push ${ip_address}:32000/${service_name}-migrations:${service_version}
    fi

done
