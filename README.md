# NetApp Data Migrator (NDM)

NetApp Data Migrator (NDM) is a storage data migration platform used to orchestrate and execute file data movement across environments. It supports both `NFS` and `SMB` migration workflows and is designed around a centralized control plane with protocol-aware distributed workers.

## What This Repository Contains

This repository contains the full NDM platform, including:

- Control plane services (API and orchestration microservices)
- Protocol workers that execute migration/discovery actions
- Web user interface
- Deployment and infrastructure automation (Packer, Terraform, Ansible)
- Database schema management and upgrade utilities
- API and end-to-end test assets

## What NDM Does

At a high level, NDM enables teams to:

- Discover source and destination storage systems
- Configure migration jobs for NFS and SMB data
- Run migration workflows through staged orchestration
- Track progress, status, reporting, and support diagnostics
- Operate with a decoupled control plane and scalable worker model

## High-Level Architecture

NDM follows a control-plane + worker architecture:

1. Control Plane:
   - Hosts the API/UI and core orchestration services
   - Maintains configuration, job definitions, state, and reporting
   - Coordinates execution across available workers

2. Worker Plane:
   - Runs protocol-specific migration/discovery workloads
   - Executes task workflows for data movement and related operations
   - Supports deployment of multiple workers for scale-out execution

3. Data and State:
   - Persistent job/configuration state is managed through service data stores
   - Schema lifecycle is versioned through Liquibase

4. Deployment Footprint:
   - Supports image/build and infrastructure automation for multiple environments
   - Includes local and cloud-focused deployment tooling

## Repository Components

- `services/`
  - Core NDM microservices and UI, including:
    - `datamigrator-ui` (front-end)
    - `worker` (execution engine for migration/discovery workflows)
    - control-plane services such as `admin-service`, `config-service`, `jobs-service`, `reports-service`, `support-service`, and `db-writer`
- `app-deployment/`
  - Deployment automation and environment provisioning assets:
    - `packer/`, `terraform/`, `ansible/`, `local-deployment/`
- `liquibase/`
  - Database schema change management and migration scripts
- `ndm-api-tests/`
  - API and end-to-end test scenarios
- `upgrade/`
  - Upgrade playbooks and worker upgrade assets
- `docs/`
  - Additional product and engineering documentation
- `lib/`
  - Shared libraries and reusable modules

## Typical Flow (Conceptual)

1. User configures endpoints and migration options in the UI/API.
2. Control plane validates and persists job configuration.
3. Control plane assigns workflow execution to workers.
4. Workers execute protocol-specific operations (`NFS` or `SMB`).
5. Control plane aggregates progress, status, and reports for operators.

## Notes

- This README is a high-level overview intended for onboarding and context.
- Component-specific setup and operational instructions are documented within their respective directories.
