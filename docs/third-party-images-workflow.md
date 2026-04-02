# Third-Party Docker Images Tarball Workflow

## Overview

The GitHub Actions workflow at `.github/workflows/build-push-third-party-images.yaml` automates building and uploading `ndm-docker-images.tar` — a tarball containing all third-party container images required by the NDM control plane.

This tarball is consumed by the VM image build workflow (`ndm-vm-image-build.yaml`), which downloads it from Artifactory and side-loads the images into MicroK8s via `microk8s images import`.

## Usage

Trigger the workflow manually from the GitHub Actions UI with two optional inputs:

- **dry_run** (default: `false`) — pull and save images without uploading to Artifactory
- **keycloak_tag** (default: `26.5.6-debian-12-r0`) — override the Keycloak image tag

## What it does

1. Pulls 28 third-party container images for `linux/amd64` from Docker Hub, Quay.io, GHCR, and registry.k8s.io
2. Saves all images into a single `ndm-docker-images.tar` via `docker save`
3. Uploads the tarball to Artifactory at `cicd/ndm/docker-images/ndm-docker-images.tar`
4. Prints a summary with image count and tarball size

If the Bitnami Keycloak image cannot be pulled from Docker Hub, the workflow automatically falls back to AWS ECR Public Gallery and retags the image so Helm references remain unchanged.

## Image sources

The image list is extracted from the Helm values templates under `app-deployment/ansible/control-plane/roles/`:

| Component | Template |
|-----------|----------|
| Keycloak | `configure-keycloak/templates/keycloak-values.j2` |
| PostgreSQL | `configure-postgres/setup-postgres/templates/postgres-values.j2` |
| Redis | `configure-redis-standalone/setup-redis/templates/redis-values.j2` |
| Grafana | `configure-grafana/setup-grafana/templates/grafana-values.yaml.j2` |
| Loki | `configure-grafana/setup-grafana/templates/loki-values.yaml.j2` |
| Temporal | `configure-temporal/templates/temporal-values.j2` |
| OpenBao | `configure-openbao/install-openbao/templates/openbao-values.j2` |
| Prometheus | `configure-prometheus/setup-prometheus/templates/prometheus-values.j2` |
| OpenTelemetry | `configure-otel/templates/otel-values.j2` |

## Updating images

When a Helm values template is updated with a new image tag, the workflow's image list must be updated to match. The list is intentionally hardcoded to ensure full visibility into what goes into the tarball.
