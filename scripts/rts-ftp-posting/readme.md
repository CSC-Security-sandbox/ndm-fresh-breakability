# rts-ftp-posting

Helper scripts for the `RTS FTP Posting` GitHub Actions workflow
(`.github/workflows/rts-ftp-posting.yaml`).

The workflow automates the post-RTS FTP posting process described in
[DEVTS/88387662 — 5. Posting to FTP](https://netapp.atlassian.net/wiki/spaces/DEVTS/pages/88387662):

1. Download the `<Project> <Version>-FTP-Components.csv` report that the
   RTS tool produced for a given project/version.
2. **Verify every component in the CSV is actually a dependency of this
   repo** (direct or transitive, in any language the repo uses — npm,
   Go, Maven, Docker base images). Unknown components block the
   publish.
3. Download every source archive referenced by that CSV from
   `rts.rtp.openenglab.netapp.com/x/eng/3rdparty/data_retention/...` into
   a local staging tree.
4. **Scan every staged file (and the contents of every archive) for
   NetApp / NDM intellectual-property markers** — copyright strings,
   the `@NetApp-Cloud-DataMigrate` npm scope, NDM source-tree paths,
   ... . Any hit blocks the publish; this is the last line of defence
   before bytes leave the runner.
5. Copy the staging tree onto the VED FTP staging filesystem at
   `/x/eng/3rdparty/ftpstaging/<Project>/<Version>/` using `rsync`.
   This filesystem is mounted directly on the `scs-v2` runners and is
   what COSINE syncs from to the public FTP site, so we do **not**
   push to `ftp.netapp.com` directly — no FTP credentials needed.
6. Render the COSINE notification e-mail (subject + body) in the
   workflow summary and job log so the operator can paste it into their
   mail client and send it to `enghelp+blackduck@netapp.com`. The
   workflow does **not** send the e-mail itself — COSINE treats the
   message as a Service-Now ticket request and wants it to come from a
   real human's NetApp mailbox.

## Contents

- `stage-sources.py` — parses the FTP-Components.csv, downloads each
  referenced source archive, and writes `manifest.json` summarising what
  was downloaded and what failed. See `--help` for arguments.
- `verify-components.py` — harvests every dependency name the repo
  declares across all languages (npm `package.json` +
  `package-lock.json`, Go `go.mod` + `go.sum`, Maven `pom.xml`, Docker
  `FROM` references in every `Dockerfile*`) and verifies every component
  listed in the CSV maps to at least one of them (fuzzy, case-
  insensitive substring matching). Unknown components fail the run
  unless `skip_dependency_check=true` is set on the workflow input.
  Writes `dependency-check.json`.
- `scan-for-netapp-ip.py` — recursively opens every staged archive
  (`.tar.gz/.tgz/.tar.bz2/.tar.xz/.zip/.jar/.war/.aar/.ear/.apk/...`)
  and grep-scans text content for NetApp-copyright markers + NDM
  identifiers, runs a `strings(1)`-style pass on binaries for the same
  markers, and checks every archive entry path against a list of NDM
  source-tree directory patterns (`services/*/src/`, `lib/*/src/`,
  `liquibase/apply/`, ...). Any hit hard-fails the run. Writes
  `ip-scan.json`. Known-clean false positives can be allow-listed by
  sha256 via the `allow_ip_hit_sha256s` workflow input (record Legal
  sign-off before doing this).

## Required repository configuration

The workflow needs the following **secrets** (only when the RTS tool
itself requires HTTP auth — the publish step is filesystem-based and
needs no credentials):

| Secret                    | Purpose                                                     | Required                  |
| ------------------------- | ----------------------------------------------------------- | ------------------------- |
| `RTS_USER`                | Credentials for the RTS download endpoint                   | only if RTS requires auth |
| `RTS_PASSWORD`            | (ditto)                                                     | only if RTS requires auth |

And the following **repository / org variables** (all have sensible
defaults in the workflow, but can be overridden without editing YAML):

| Variable                  | Default                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `RTS_BASE_URL`            | `https://rts.rtp.openenglab.netapp.com`                       |
| `RTS_DATA_RETENTION_ROOT` | `/x/eng/3rdparty/data_retention`                              |
| `FTP_STAGING_ROOT`        | `/x/eng/3rdparty/ftpstaging`                                  |
| `COSINE_NOTIFY_EMAIL`     | `enghelp+blackduck@netapp.com`                                |

## Runner requirements

The workflow runs on the **`scs-v2`** scs-based custom self-hosted
runner. The runner must have:

- network reachability to `rts.rtp.openenglab.netapp.com` (HTTPS) for
  the CSV + source-archive downloads, and
- the `/x/eng/3rdparty/ftpstaging/` share **mounted as a writable
  filesystem** for the publish step — the workflow refuses to run
  (with a clear error) if this directory is missing.

`scs-v2` runners satisfy both today; `openlab` runners that mount the
same share are a drop-in alternative if `scs-v2` ever loses access.

## Manual invocation

From the GitHub UI: **Actions → RTS FTP Posting → Run workflow**.

Inputs:

- **branch_name** — release branch to check out. **Must match
  `release/YYYY.MM[.DD][-suffix]`** — accepted shapes are:
  - `release/2026.04`
  - `release/2026.04-1`, `release/2026.04-alpha`
  - `release/2025.08.03`, `release/2025.08.03-testing`

  The workflow refuses to run on `main`, `develop`, feature branches,
  or generic named release branches like `release/preview` —
  FTP posting is only legal from a *dated* release branch whose
  third-party dependencies have been legally cleared at RTS. The
  guard is enforced as the very first job step, before any RTS
  download or repo checkout.
  This input only affects which revision of the helper scripts is
  used — the data being published is entirely determined by the next
  two inputs.
- **rts_project_name** — exactly as it appears in the RTS tool. The
  workflow pre-fills this with the canonical NDM project name
  **`Netapp Data Migrator`**, which is the form RTS uses for our
  project; only override it if RTS has been re-keyed to a different
  string. Whatever value is passed must also match the project
  directory under `/x/eng/3rdparty/data_retention/`.
- **rts_project_version** — exactly as it appears in the RTS tool (e.g.
  `2026.04`).
- **dry_run** — when `true`, the CSV and sources are still downloaded
  and the dependency-verification + IP-contamination scans still run,
  but the publish to `/x/eng/3rdparty/ftpstaging/` is skipped. Use this
  to validate CSV parsing and the guardrails before a real release.
- **skip_dependency_check** — when `true`, the "is this component really
  an NDM dependency?" verification runs in warn-only mode instead of
  failing the job. Use sparingly and record your justification in the
  run summary; the intent of this input is to let you unblock a release
  when the verifier has a known false negative (e.g. the CSV names a
  component differently than any of our manifests).
- **allow_ip_hit_sha256s** — comma-separated list of sha256 hashes to
  exclude from the NetApp-IP contamination scan. Use only for files
  that have been individually reviewed and approved by Legal. Each
  exemption must be recorded in the PR description or release notes.

## Output

Every run uploads a workflow artifact named
`rts-ftp-posting-<project>-<version>` that contains:

- `manifest.json` — per-component download status (`ok` / `failed` /
  `skipped` / `duplicate`).
- `dependency-check.json` — every component with its `matched_token`
  (which repo-declared dep it maps to) or `unknown` (no match).
- `ip-scan.json` — every scan hit (archive, file inside that archive,
  mode, regex pattern, matched substring). Empty when the staging tree
  is clean.
- `logs/publish-rsync.log` — the `rsync` transcript of the publish to
  `/x/eng/3rdparty/ftpstaging/<Project>/<Version>/`.
- `logs/cosine-notification.txt` — the exact subject + body to copy into
  your mail client and send to the COSINE team.
- The original `<Project> <Version>-FTP-Components.csv`.
