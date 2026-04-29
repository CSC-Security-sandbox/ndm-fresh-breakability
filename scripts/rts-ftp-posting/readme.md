# rts-ftp-posting

Helper scripts for the `RTS FTP Posting` GitHub Actions workflow
(`.github/workflows/rts-ftp-posting.yaml`).

The workflow automates the post-RTS FTP posting process described in
[DEVTS/88387662 — 5. Posting to FTP](https://netapp.atlassian.net/wiki/spaces/DEVTS/pages/88387662):

1. Read the `<Project> <Version>-FTP-Components.csv` report that the
   RTS tool produced for a given project/version, directly off the
   data_retention filer mounted on the runner at
   `/x/eng/3rdparty/data_retention/<Project_Subdir>/<Version>/`.
2. **Classify every component in the CSV** as a *direct* dependency of
   this repo (declared in some local manifest — npm, Go, Maven,
   Dockerfile FROM) or a *ride-along* (transitively pulled in by an
   upstream image we redistribute, e.g. the Bitnami Keycloak Docker
   image, the Debian base layer of the NDM VM, or the Quarkus runtime).
   This step is **informational only** — the RTS CSV is the legal-
   authoritative list of what ships, so re-deriving "is this really
   ours?" from manifests cannot beat RTS. The classification is
   surfaced in the workflow log and in `dependency-check.json` so
   the operator can spot-check the breakdown. The lone fail-stop in
   the workflow is step 4 below.
3. **Materialise source archives per ecosystem.** The data_retention
   filer holds only RTS metadata (per-component breadcrumb
   directories that record where the SBOM saw each dep), not the
   actual source archives. So `stage-sources.py` materialises sources
   by ecosystem:
   - **npm** — walks every `package-lock.json` under the
     release-branch checkout, picks up each entry's `resolved`
     upstream URL + `integrity` SHA-512, and downloads bit-identical
     tarballs from the public registry (`registry.npmjs.org`).
     Because the lockfile recorded exactly the bytes npm installed
     when RTS was run, this is the same artifact the
     SBOM/VP-sign-off cleared. Lookup is keyed off the SBOM
     `source_path`'s trailing `<name>/<version>` pair (the canonical
     npm coordinate), with the CSV component column as a fallback
     for completeness — the column carries human display strings
     ("Long.js", "ReactiveX RxJS", "watchman") that don't always
     map cleanly to npm package names.
   - **maven** — parses the trailing `<group>:<artifact>:<version>`
     triple from the SBOM `source_path` and resolves each row to
     Maven Central (`repo1.maven.org/maven2/...`). Walks a small
     fallback ladder: `-sources.jar` first (the actual source code,
     SHA-1-verified against the sidecar Maven Central always
     publishes), POM next when the artifact is `<packaging>pom`
     (BOMs and aggregators have no compiled code so the POM itself
     is staged for traceability with `fallback=pom-only`), binary
     `.jar` last with `fallback=binary-jar` flagged loudly so the
     operator can review the rare miss.
   - **go** — parses the trailing `<module>:<version>` pair from
     SBOM rows tagged `:-go_mod/`, resolves to the public Go module
     proxy (`proxy.golang.org/<module>/@v/<version>.zip`),
     verifies the downloaded zip against the h1 hash published by
     the Go checksum database (`sum.golang.org`).
   - **debian** — for OS-level packages captured from a Docker
     base layer (SBOM rows tagged `-docker/<binary>/<version>/<arch>`)
     the harvester resolves the binary to its source package on
     `snapshot.debian.org`: it pulls per-arch binary file hashes,
     reads the source-package name out of the pool path
     (`/pool/<area>/<initial>/<source>`), strips the `+b<N>` binNMU
     suffix from the binary version to derive the source version,
     and downloads every source file (`.dsc` + upstream
     `.orig.tar.*` + Debian `.debian.tar.*`) with per-file SHA-1
     verification (the snapshot index hashes *are* the file SHA-1s,
     so verification is intrinsic to the fetch). Multiple binaries
     that share a single source (e.g. `libasound2-data` and
     `libasound2t64` both come from `alsa-lib`) dedup to one
     download.
   - PyPI / Rubygems / other niche rows are logged in
     `manifest.json` as `status=skipped, detail="harvester not yet
     implemented"` for completeness when the SBOM grows beyond
     today's ecosystems.
4. **Scan every staged file (and the contents of every archive) for
   NetApp / NDM intellectual-property markers** — copyright strings,
   the `@NetApp-Cloud-DataMigrate` npm scope, NDM source-tree paths,
   ... . Any hit blocks the publish; this is the last line of defence
   before bytes leave the runner. The scanner is *context-aware*:
   explicit copyright / proprietary statements and NDM source-tree
   paths trip the guard wherever they appear, but the
   `@NetApp-Cloud-DataMigrate` scope and the `NetApp Data Migrator`
   project name only count as leaks when they appear *inside an
   upstream third-party archive*. Both strings legitimately appear in
   the RTS-emitted SBOM at the staging root (the FTP-Components.csv
   literally enumerates every shipped `@NetApp-Cloud-DataMigrate/<lib>`
   under that project name) so flagging them there would be a
   structural false positive — but no third-party tarball
   legitimately depends on our private scope or carries our project
   name, so seeing those strings inside `lodash-x.y.z.tgz` is still a
   hard fail.
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

- `stage-sources.py` — parses the FTP-Components.csv and runs the
  per-ecosystem harvesters. For npm: walks every `package-lock.json`
  under the release-branch checkout to build a
  `(name, version) -> resolved-URL + integrity` inventory and
  fetches each matching CSV row's upstream tarball with SHA-512
  verification. For maven: extracts the trailing GAV from each
  CSV row's `source_path` and pulls
  `<group>/<artifact>/<version>/<artifact>-<version>-sources.jar`
  from Maven Central with SHA-1 verification (with `pom-only` and
  `binary-jar` fallbacks for artifacts that don't publish sources).
  For go: extracts the trailing `<module>:<version>` pair from
  go-tagged rows, fetches the module zip from `proxy.golang.org`,
  verifies the h1 hash from `sum.golang.org`. For debian: resolves
  Docker-captured binary packages to their source on
  `snapshot.debian.org` and stages every source file with per-file
  SHA-1 verification, deduplicating across binaries that share a
  single source package. Writes `manifest.json` summarising what
  was staged, failed, or skipped per row, including the resolved
  URL and integrity check for every successful download. See
  `--help` for arguments.
- `verify-components.py` — harvests every dependency name the repo
  declares across all languages (npm `package.json` +
  `package-lock.json`, Go `go.mod` + `go.sum`, Maven `pom.xml`, Docker
  `FROM` references in every `Dockerfile*`) and classifies each CSV
  row as *direct* (substring-matches some harvested token) or
  *ride-along* (no match — typically pulled in transitively by a
  base image we ship on top of). The classification is informational
  only; the workflow does not block on ride-along entries because the
  RTS CSV is itself authoritative for what ships. The script
  hard-fails only on structural CSV breakage (no recognisable
  component-name column, or zero rows after the header). Writes
  `dependency-check.json` containing the full per-row breakdown for
  the workflow artifact.
- `scan-for-netapp-ip.py` — recursively opens every staged archive
  (`.tar.gz/.tgz/.tar.bz2/.tar.xz/.zip/.jar/.war/.aar/.ear/.apk/...`)
  and grep-scans text content for NetApp-copyright markers + NDM
  identifiers, runs a `strings(1)`-style pass on binaries for the same
  markers, and checks every archive entry path against a list of NDM
  source-tree directory patterns (`services/*/src/`, `lib/*/src/`,
  `liquibase/apply/`, ...). The scanner partitions its patterns into
  two threat-model groups — high-confidence IP markers (copyright /
  proprietary text, NDM source-tree paths) that always fire, and
  NDM coordinate strings (`@NetApp-Cloud-DataMigrate`,
  `NetApp Data Migrator`) that only fire when they appear inside
  an extracted archive, since they're expected in the RTS-emitted
  SBOM at the staging root. The split is hardcoded; the operator
  has no toggle to weaken it. Any **IP / path pattern** hit hard-
  fails the run; **extraction failures** (archive too large to bound,
  unreadable tar member, …) are recorded separately in
  `ip-scan.json` under `extract_errors` and also block publish until
  resolved — they are not mis-labelled as IP contamination. Jars
  that trip CPython's zip overlap guard may be shallow-scanned on
  disk instead; clean outcomes appear under `extraction_skipped`.
  Writes `ip-scan.json`. The check is always enforced — there is no
  workflow-level allow-list; if the scanner flags a legitimate
  upstream reference to NetApp, fix it at the source (rename,
  redact, or exclude the offending file from the published
  archive) rather than bypassing the guard.

## Required repository configuration

The workflow no longer talks HTTP to the RTS tool — the CSV and every
source archive it references are read directly from the
`/x/eng/3rdparty/data_retention/` share that the runner has mounted.
That removes the need for any secrets.

The following **repository / org variables** are all optional; each has
a sensible default baked into the workflow, but they can be overridden
without editing YAML:

| Variable                  | Default                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `RTS_DATA_RETENTION_ROOT` | `/x/eng/3rdparty/data_retention`                              |
| `FTP_STAGING_ROOT`        | `/x/eng/3rdparty/ftpstaging`                                  |
| `COSINE_NOTIFY_EMAIL`     | `enghelp+blackduck@netapp.com`                                |

## Runner requirements

The workflow runs on the **`scs-v2`** scs-based custom self-hosted
runner. The runner must have **both** of the following NetApp shares
mounted on the same filesystem tree it uses today:

- `/x/eng/3rdparty/data_retention/` — read-only is fine; this is where
  the workflow reads the FTP-Components.csv and every source archive
  it references. The workflow refuses to run (with a clear error) if
  this directory is missing.
- `/x/eng/3rdparty/ftpstaging/` — must be writable; this is where
  COSINE picks up the staged sources to sync to the public FTP site.

`scs-v2` runners satisfy both today; `openlab` runners that mount the
same shares are a drop-in alternative if `scs-v2` ever loses access.

The runner does need outbound HTTPS to the public package registries
that `stage-sources.py` resolves against:

- `registry.npmjs.org` (npm tarballs)
- `repo1.maven.org` (Maven Central source jars)
- `proxy.golang.org` and `sum.golang.org` (Go module zips + checksums)
- `snapshot.debian.org` (Debian source packages for OS-level rows
  captured from Docker base layers)

No private credentials are needed; all four services serve their
public indexes.

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

  The branch is checked out under `release-branch/` and is used
  *only* for dependency-manifest inspection (npm / Go / Maven /
  Docker), so the verifier can confirm every component listed in
  the FTP-Components.csv is actually built into that release. The
  helper scripts themselves (verify-components.py,
  scan-for-netapp-ip.py, stage-sources.py) are intentionally
  loaded from the dispatch ref — i.e. the ref the workflow file
  was launched from, normally `main` — because older dated
  release branches were cut before these scripts existed and do
  not contain them.
- **rts_project_name** — exactly as it appears in the RTS tool. The
  workflow pre-fills this with the canonical NDM project name
  **`Netapp Data Migrator`**, which is the form RTS uses for our
  project; only override it if RTS has been re-keyed to a different
  string. Whatever value is passed must also match the project
  directory under `/x/eng/3rdparty/data_retention/`.
- **rts_project_version** — exactly as it appears in the RTS tool (e.g.
  `2026.04.0_GA`).
- **dry_run** — when `true`, the CSV and sources are still downloaded
  and the dependency-verification + IP-contamination scans still run,
  but the publish to `/x/eng/3rdparty/ftpstaging/` is skipped. Use this
  to validate CSV parsing and the guardrails before a real release.

## Runner disk and `TMPDIR`

Staged sources (CSV copy, downloaded archives, reports, logs) use
**`${STAGE_ROOT}`**, which defaults to **`/var/lib/rts-ftp-posting`** on
the runner — intended to live on the **root filesystem** (e.g. LVM
`ubuntu--vg-ubuntu--lv` mounted at `/`), not under **`RUNNER_TEMP`**
(which on scs-v2 can be a smaller mount). Override the directory with
the repo/org GitHub Actions variable **`RTS_FTP_RUNNER_STAGE_ROOT`**
if your layout differs. The workflow creates the directory with **`sudo
mkdir`** when the runner user cannot write there yet.

On typical scs-v2 hosts **`/var`** is tens of gigabytes; treating **on the
order of ~43 GB** on that filesystem as workable capacity for a full
RTS tree plus temporary unpack during the IP scan is reasonable. Always
check **`df -h /var`** (or the mount that contains **`/var/lib`**) ahead
of an unusually large posting.

The NetApp IP scanner unpacks each archive with Python `tempfile`,
which uses **`TMPDIR`** if set, otherwise the OS default (typically
**`/tmp`**). On some hosts **`/tmp`** is a small **tmpfs**, so unpacking
large upstream tarballs (e.g. Debian **`firefox-esr`** **`.orig.tar.xz`**)
can hit **`Errno 28`** even when the root volume has space.

The workflow sets **`TMPDIR="${STAGE_ROOT}/ip-scan-tmp"`** before
invoking `scan-for-netapp-ip.py` so extraction temp dirs sit on the same
filesystem as **`STAGE_ROOT`**. If you still run out of space, free
disk or grow the volume that holds **`RTS_FTP_RUNNER_STAGE_ROOT`**.

After each run, the workflow removes **`${STAGE_ROOT}`** with **`rm -rf`**
(step **`if: always()`**, after artifact upload) so self-hosted runners do not retain
gigabytes of staged sources between jobs. The Git checkout under
**`GITHUB_WORKSPACE`** (including **`release-branch/`**) is managed by
Actions and is not removed by that step.

## Output

Every run uploads a workflow artifact named
`rts-ftp-posting-<project>-<version>` that contains:

- `manifest.json` — per-component download status (`ok` / `failed` /
  `skipped` / `duplicate`).
- `dependency-check.json` — every component with its `matched_token`
  (which repo-declared dep it maps to) or `unknown` (no match).
- `ip-scan.json` — `hits` (IP / path pattern matches), optional
  `extract_errors` (archives that could not be opened for a full tree
  walk), and optional `extraction_skipped` (zip overlap guard bypassed
  via shallow head-only scan with no markers found). Empty `hits` and
  `extract_errors` when the staging tree is fully scanned and clean.
- `logs/publish-rsync.log` — the `rsync` transcript of the publish to
  `/x/eng/3rdparty/ftpstaging/<Project>/<Version>/`.
- `logs/cosine-notification.txt` — the exact subject + body to copy into
  your mail client and send to the COSINE team.
- The original `<Project> <Version>-FTP-Components.csv`.
