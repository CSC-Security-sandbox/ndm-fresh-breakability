# Third-Party Docker Images Tarball Workflow

## Overview

The GitHub Actions workflow at `.github/workflows/build-push-third-party-images.yaml` automates building and uploading `ndm-docker-images.tar` — a tarball containing all third-party container images required by the NDM control plane.

This tarball is consumed by the VM image build workflow (`ndm-vm-image-build.yaml`), which downloads it from Artifactory and side-loads the images into MicroK8s via `microk8s images import`.

## Usage

Trigger the workflow manually from the GitHub Actions UI with one optional input:

- **dry_run** (default: `false`) — pull and save images without uploading to Artifactory

The Keycloak image tag is pinned in code (`KEYCLOAK_TAG` env var at the top of the `build-tarball` job, currently `26.6.1-debian-12-r0`). To bake a different tag into the tarball, edit that value and merge — there is no UI override.

## What it does

1. Pulls 28 third-party container images for `linux/amd64` from Docker Hub, Quay.io, GHCR, and registry.k8s.io
2. Saves all images into a single `ndm-docker-images.tar` via `docker save`
3. Generates a version string in the format `YYYYMMDD-HHMMSS-<7-char git SHA>` (e.g., `20260404-143022-a1b2c3d`)
4. Uploads the tarball and a `manifest.json` to a versioned directory in Artifactory
5. Updates `latest.json` to point to the new version
6. Uploads a backward-compatible copy at the flat path for unconverted consumers
7. Prints a summary with version, image count, and tarball size

If the Bitnami Keycloak image cannot be pulled from Docker Hub, the workflow automatically falls back to AWS ECR Public Gallery and retags the image so Helm references remain unchanged.

## Versioning

Each build produces a uniquely versioned tarball in Artifactory. The layout is:

```
cicd/ndm/docker-images/
  latest.json                              # pointer to the current version
  ndm-docker-images.tar                    # copy of current version (backward compat)
  20260404-143022-a1b2c3d/
    ndm-docker-images.tar                  # versioned tarball
    manifest.json                          # build metadata (images, commit, timestamp)
  20260401-091500-f4e5d6a/
    ndm-docker-images.tar
    manifest.json
```

### latest.json

Points to the most recent successful build:

```json
{
  "version": "20260404-143022-a1b2c3d",
  "tarball_url": "cicd/ndm/docker-images/20260404-143022-a1b2c3d/ndm-docker-images.tar",
  "image_count": 28,
  "tarball_size": "8.2G",
  "commit": "a1b2c3d...",
  "updated_at": "2026-04-04T14:30:22Z",
  "published_by": "github-actions"
}
```

### manifest.json

Contains full build metadata for each version:

```json
{
  "version": "20260404-143022-a1b2c3d",
  "commit": "a1b2c3d...",
  "build_time": "2026-04-04T14:30:22Z",
  "workflow_run_id": "12345678",
  "keycloak_tag": "26.6.1-debian-12-r0",
  "images": [
    "docker.io/bitnami/keycloak:26.6.1-debian-12-r0",
    "..."
  ]
}
```

## Pinning a version

The `ndm-vm-image-build` workflow accepts a `docker_images_version` input:

- **`latest`** (default) — fetches `latest.json` and resolves the current version automatically
- **`<version>`** — downloads directly from the specified version directory (e.g., `20260404-143022-a1b2c3d`)

To pin a VM image build to a specific tarball version, trigger the workflow with:

```
docker_images_version: 20260404-143022-a1b2c3d
```

## Rollback

If a newly uploaded tarball causes problems:

1. **Pin to a known-good version:** Re-trigger `ndm-vm-image-build` with `docker_images_version` set to the last working version string.
2. **Fix latest.json:** Manually overwrite `latest.json` in Artifactory to point to the known-good version, then re-trigger with `docker_images_version = latest`.

Previous versions are preserved indefinitely in Artifactory under their version directories.

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
