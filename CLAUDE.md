# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NDM (NetApp Data Migrator) is a microservices-based data migration platform. It orchestrates file migrations between storage systems (NFS, SMB) using Temporal workflows, with a React frontend and multiple NestJS backend services.

## Repository Structure

The monorepo root contains `ndm/` (main source) and `ndm-docker-compose/` (local dev environment).

### Services (`services/`)

| Service | Stack | Port | Purpose |
|---------|-------|------|---------|
| admin-service | NestJS + TypeORM | 3001 | Accounts, projects, users, RBAC |
| config-service | NestJS + TypeORM + Mongoose | 3002 | System configs, Temporal workflows, Socket.io |
| jobs-service | NestJS + TypeORM | 3006 | Job orchestration, task scheduling, worker mgmt |
| db-writer | NestJS + TypeORM | 3005 | Redis queue consumer → PostgreSQL writer |
| reports-service | NestJS + TypeORM + Puppeteer | 3003 | PDF/CSV report generation via Temporal |
| support-service | NestJS + TypeORM | — | Support bundle generation via Temporal |
| worker | NestJS + Temporal SDK | — | Node.js Temporal worker for migration activities |
| go-worker | Go + Temporal SDK | — | High-perf file ops worker (NFS/SMB protocols) |
| datamigrator-ui | React 18 + Vite + MUI | 3111 | Frontend SPA |
| keycloak-customizations | Java 16 + Maven | — | Custom Keycloak mappers and themes |

### Shared Libraries (`lib/`)

Published to GitHub Packages under `@NetApp-Cloud-DataMigrate` scope:
- **auth-lib**: Keycloak JWT authentication, RBAC decorators
- **api-handler-lib**: Standardized API responses, error handling, request tracking
- **logger-lib**: Winston logging with daily rotation, request context
- **jobs-lib**: Redis producer/consumer, job queuing with msgpack serialization

### Infrastructure
- **liquibase/**: PostgreSQL schema migrations (changelog-master.xml, apply/, rollback/)
- **app-deployment/**: Ansible playbooks, Terraform (Azure/GCP/vSphere), Packer (VM images), Helm charts
- **ndm-api-tests/**: E2E/smoke/regression tests in Go (Ginkgo/Gomega)
- **monitoring/**: Prometheus/Grafana configs

## Build & Development Commands

### Prerequisites
All Node.js services require `GITOPS_USER_GITHUB_TOKEN` env var for npm install (GitHub Packages auth via `.npmrc`).

### NestJS Services (admin, config, jobs, db-writer, reports, support, worker)
```bash
cd services/<service-name>
npm install
npm run build          # nest build
npm run start:dev      # nest start --watch (dev mode)
npm run test           # jest
npm run test:cov       # jest --coverage
npm run lint           # eslint "{src,apps,libs,test}/**/*.ts" --fix
npm run format         # prettier --write
```

### datamigrator-ui (React Frontend)
```bash
cd services/datamigrator-ui
npm install
npm run dev            # vite --host 127.0.0.1 --port 3111
npm run build          # vite build
npm run lint           # eslint .
npm run type-check     # tsc --noEmit
```

### go-worker
```bash
cd services/go-worker
make build             # go build -o bin/go-worker .
make test              # go test ./... -v -count=1
make lint              # golangci-lint run ./...
make tidy              # go mod tidy
```

### Shared Libraries
```bash
cd lib/<lib-name>
npm run build          # tsc
```

### keycloak-customizations
```bash
cd services/keycloak-customizations
mvn clean package      # Maven build
```

### API Tests (ndm-api-tests)
```bash
cd ndm-api-tests
go test ./... -v       # Run all tests (Ginkgo/Gomega)
```

### Docker Compose (Full Local Stack)
```bash
cd ../ndm-docker-compose
docker compose up      # Starts postgres, redis, temporal, keycloak, liquibase, and all services
```
Requires a `git_token` file in `ndm-docker-compose/` with your GitHub token.

### Incremental Build & Deploy (MicroK8s)
```bash
# Requires AZ_USERNAME, AZ_PASSWORD, AZ_TENANT, GITOPS_USER_GITHUB_TOKEN
./inc_build.sh         # Builds all Docker images, pushes to local registry, runs Ansible helm-upgrade
```

## Architecture & Data Flow

1. **UI → Backend**: React SPA authenticates via Keycloak (OIDC), calls backend services through Nginx reverse proxy
2. **Backend → Temporal**: config-service and jobs-service create Temporal workflows for long-running migrations
3. **Temporal → Workers**: worker (Node.js) and go-worker (Go) execute Temporal activities for file operations
4. **Workers → Redis → db-writer**: Workers push results to Redis queues; db-writer consumes and persists to PostgreSQL
5. **Reports**: reports-service uses Temporal workflows + Puppeteer for async PDF/CSV generation

### Key Technology Decisions
- **Temporal.io** (v1.26.2): Workflow orchestration for all long-running ops (migrations, reports, support bundles)
- **Keycloak** (v26.4.3): Identity provider with custom protocol mappers for NDM-specific JWT claims
- **PostgreSQL**: Primary data store, managed via Liquibase migrations
- **Redis**: Inter-service messaging via queues (msgpack serialization)
- **MicroK8s**: Target Kubernetes runtime for deployment

## Database Migrations

Liquibase manages all PostgreSQL schema changes:
- Master changelog: `liquibase/changelog-master.xml`
- Forward migrations: `liquibase/apply/` (SQL files)
- Rollbacks: `liquibase/rollback/` (SQL files)
- Schemas managed: datamigrator (main), keycloak, liquibase (tracking)

## Deployment

- **Cloud targets**: Azure (primary), GCP, VMware vSphere
- **Container registry**: Azure Container Registry (`datamigratedev.azurecr.io`)
- **Kubernetes namespace**: `datamigrator`
- **CI/CD**: GitHub Actions workflows in `.github/workflows/`
