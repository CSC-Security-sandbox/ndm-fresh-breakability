#!/bin/bash
set -e  # Exit on any error

# write function to execute command and check return code for errors
function execute_command() {
    local command=$1
    local error_message=$2
    eval $command
    if [ $? -ne 0 ]; then
        echo $error_message
        exit 1
    fi
}


# check if GITOPS_USER_GITHUB_TOKEN environment variable is set or not
if [ -z "$GITOPS_USER_GITHUB_TOKEN" ]
then
    echo "Please set the GITOPS_USER_GITHUB_TOKEN environment variable"
    exit 1
else
    echo "GITOPS_USER_GITHUB_TOKEN environment variable is set"
fi
 
script_dir=$(dirname "$0")
base_dir=$(realpath "$script_dir/../../..")
worker_dir="$base_dir/services/worker"
app_deployment_dir="$base_dir/app-deployment"

echo "Building worker image from $worker_dir"
execute_command "cd $worker_dir" "Failed to change directory to $worker_dir"
execute_command "npm install" "Failed to install npm packages"
execute_command "npm install -g pkg" "Failed to install pkg"
execute_command "npm run build" "Failed to build worker"
execute_command "npm run pkg" "Failed to package worker"

echo "Worker image built successfully"
worker_binary_path=`realpath $worker_dir/pkg/worker-linux-arm64`
echo "Worker binary is available at $worker_binary_path"

#execute_command "cd $app_deployment_dir && ansible-playbook -i ansible/worker/config/inventory.yaml ansible/worker/playbooks/master-playbook.yaml -e local_cluster=true -e local_worker_update=true -e local_binary_path=$worker_binary_path" "Failed to deploy new worker"

# COMMIT_SHA=$(git rev-parse HEAD | tail -c 7)
# execute_command "cd $worker_dir && zip -r $worker_dir/$COMMIT_SHA-worker.zip pkg" "Failed to zip worker"
# echo "Worker image built $worker_dir/$COMMIT_SHA-worker.zip successfully"