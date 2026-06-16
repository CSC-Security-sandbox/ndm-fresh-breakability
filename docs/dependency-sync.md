# Dependency Version Sync (syncpack)

The NDM monorepo has twelve Node sub-projects, each with its own
`package.json` and `package-lock.json` (the Java `services/keycloak-customizations`
is Maven-based and out of scope):

| Path                                | Type                              |
| ----------------------------------- | --------------------------------- |
| `services/admin-service/`           | NestJS backend                    |
| `services/config-service/`          | NestJS backend                    |
| `services/db-writer/`               | NestJS backend                    |
| `services/jobs-service/`            | NestJS backend                    |
| `services/reports-service/`         | NestJS backend                    |
| `services/support-service/`         | NestJS backend                    |
| `services/worker/`                  | NestJS backend (packaged binary)  |
| `services/datamigrator-ui/`         | React + Vite frontend             |
| `lib/api-handler-lib/`              | Shared NestJS library             |
| `lib/auth-lib/`                     | Shared NestJS library             |
| `lib/jobs-lib/`                     | Shared TS library                 |
| `lib/logger-lib/`                   | Shared NestJS library             |

Because each sub-project resolves its dependencies independently, the same
package can end up at different versions across services. That causes:

- Inconsistent runtime behavior (e.g. one service on `@nestjs/common@11.1.18`,
  another on `^11.1.26`).
- Security overrides that exist in one service but not another.
- Confusing Dependabot PRs that fix the same CVE in only some lockfiles.

`syncpack` enforces version alignment without requiring a workspaces
migration. The config lives at [`.syncpackrc.json`](../.syncpackrc.json) and is
driven from the repo-root [`package.json`](../package.json).

## Local commands

From the repository root:

```bash
npm install                # one-time, installs syncpack into /node_modules
npm run deps:lint          # fail if any shared dependency is out of sync
npm run deps:list          # print every dependency & its current versions
npm run deps:fix           # auto-fix mismatches and re-sort fields
npm run deps:format        # only re-sort fields, no version changes
```

`deps:fix` will rewrite the affected `package.json` files. After running it,
re-install in each touched sub-project so the lockfile is regenerated:

```bash
cd services/<changed-service>
npm install
```

## What is enforced

`.syncpackrc.json` defines **version groups** (deps that must be at the same
version everywhere they appear) and **semver groups** (range-prefix policy).

### Version groups (must match across the listed package.json files)

| Group                              | Examples of deps included                                  |
| ---------------------------------- | ---------------------------------------------------------- |
| Internal libs                      | `@netapp-cloud-datamigrate/*`, `@NetApp-Cloud-DataMigrate/*` |
| NestJS framework                   | `@nestjs/common`, `@nestjs/core`, `@nestjs/config`, …      |
| Temporal SDK                       | `@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow` |
| TypeScript toolchain               | `typescript`, `ts-jest`, `ts-loader`, `ts-node`, `@typescript-eslint/*` |
| Jest                               | `jest`, `jest-junit`, `@types/jest`, `supertest`           |
| ESLint + Prettier                  | `eslint`, `eslint-config-prettier`, `prettier`, `@eslint/*` |
| Shared `@types/*`                  | `@types/node`, `@types/express`                            |
| Common runtime libraries           | `axios`, `pg`, `rxjs`, `reflect-metadata`, `uuid`, `redis`, `winston` |
| Security overrides                 | `form-data`, `lodash`, `qs`, `multer`, `serialize-javascript`, `sha.js`, … |

`services/datamigrator-ui/package.json` and all `peerDependencies` are
intentionally excluded — UI runs an independent React toolchain, and library
peer-deps are deliberately declared with loose ranges.

### Semver groups (range-prefix policy)

| Policy        | Applies to                                                |
| ------------- | --------------------------------------------------------- |
| Exact pin (`1.2.3`)   | NestJS, Temporal, internal libs, `axios`, `pg`, `uuid`, plus every `overrides` entry |
| Caret (`^1.2.3`)      | Dev tooling: `typescript`, `jest`, `eslint*`, `prettier`, `@types/*`, `ts-*` |
| Left as-is            | `datamigrator-ui`, `peerDependencies` in `lib/*`     |

The pin policy mirrors what the codebase already does in most places — it just
catches the drift.

## CI enforcement

[`.github/workflows/dependency-sync.yaml`](../.github/workflows/dependency-sync.yaml)
runs `npm run deps:lint` on every PR that touches:

- `package.json` (root)
- `services/*/package.json`
- `lib/*/package.json`
- `.syncpackrc.json`
- the workflow file itself

A failed run posts a step-summary with the full list of drift and uploads the
syncpack report as an artifact. The fix is always the same: run
`npm run deps:fix` locally and commit the updated `package.json` files.

## Relationship to Dependabot / vulnerability automation

Syncpack does **not** open dependency-update PRs. It only enforces that, once
Dependabot (or a human) updates a shared dep in one service, every other
service holding the same dep is updated in the same PR. That removes the
"why is `@nestjs/common` at three different versions?" failure mode that the
NDM repo accumulates today (231 mismatches at the time this was introduced).

For a longer-term fix that also reduces *install* duplication, consider
migrating `services/*` and `lib/*` to npm workspaces — see the section on
"Layer 1" in any future vulnerability-automation design doc. Syncpack is the
incremental, no-restructuring step that buys time until then.

## Adding a new dependency to a sync group

When a new package becomes "shared" (used by more than one sub-project), add
it to the appropriate `versionGroups[*].dependencies` array in
[`.syncpackrc.json`](../.syncpackrc.json). The first matching group wins, so
order matters — put the more specific groups first and leave the catch-all
`Everything else may drift independently` group last.
