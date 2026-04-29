#!/usr/bin/env python3
"""Stage open-source archives referenced in an RTS FTP-Components.csv report.

Used by .github/workflows/rts-ftp-posting.yaml.

Strategy: per-ecosystem harvest, all keyed off the same SBOM CSV.

* **npm** — lockfile-driven. The RTS data_retention filer holds only
  metadata (per-component breadcrumbs in the SBOM), not the actual
  source tarballs, so we materialise sources by reading the release
  branch's package-lock.json files directly. Every entry in a
  lockfileVersion-3 ``packages`` map carries:

  - a ``resolved`` URL pointing at the exact upstream tarball that
    npm downloaded when it produced the lockfile, and
  - an ``integrity`` SHA-512 (sometimes SHA-256) we can verify
    against the bytes we fetch.

  That's the same tarball RTS scanned, by definition, so fetching
  from ``resolved`` and verifying ``integrity`` gives us a
  bit-identical copy of what RTS already vouched for. No
  ``npm install`` runs (no post-install scripts, no native compile,
  no auth surface for private registries).

* **maven** — Maven-Central-driven. Every Maven row in the CSV
  carries a parseable ``<group>:<artifact>:<version>`` triple at the
  tail of its ``source_path``. We resolve that to Maven Central
  (``https://repo1.maven.org/maven2/...``) and walk a small fallback
  ladder: ``-sources.jar`` first, then the POM (recorded as-is when
  packaging is ``pom``, since POM-only artifacts have no compiled
  code to ship), then the binary ``.jar`` with a loud
  ``fallback=binary-jar`` flag in the manifest. Integrity is
  verified against the ``.sha1`` sidecar Maven Central always
  publishes.

* **other ecosystems** (Go, Debian system packages from container
  base layers, PyPI, ...) get a structured "harvester not yet
  implemented" record in the manifest so the operator can see what
  to pick up next; harvesters are added incrementally as each
  ecosystem lands cleanly.

The script never aborts on a single missing archive — the workflow's
"Sanity-check staged content" step decides whether the run as a whole
should fail. We always return 0 when the CSV itself parsed, so the
caller can upload the manifest artifact for inspection.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Iterable

NAME_HEADERS = ("component name", "component", "name")
VERSION_HEADERS = ("component version name", "component version", "version")
LICENSE_HEADERS = ("license name", "license")
SOURCE_PATH_HEADERS = ("source path",)

# Filenames we never descend into when scanning for lockfiles.
SKIP_DIRS = {".git", "node_modules", "dist", "build", ".next", ".cache",
             "__pycache__", ".venv", "venv"}

_HEADER_FLATTEN_RE = re.compile(r"[^a-z0-9]+")

# How many bytes to stream per read when downloading + hashing.
_CHUNK = 64 * 1024


def _match_header(fieldnames: Iterable[str], candidates: Iterable[str]) -> str | None:
    """Return the first field in ``fieldnames`` matching any of ``candidates``.

    Two-stage permissive match: exact (lower-case, stripped) first,
    then substring-on-flattened-form. RTS has shipped many CSV header
    variants over the years and we want all of them to resolve to the
    same logical column. Keep in sync with verify-components.py.
    """
    fields = [fn for fn in fieldnames if fn]
    exact = {fn.strip().lower(): fn for fn in fields}
    for cand in candidates:
        if cand in exact:
            return exact[cand]
    flattened = [(_HEADER_FLATTEN_RE.sub(" ", fn.lower()).strip(), fn) for fn in fields]
    for cand in candidates:
        for flat, original in flattened:
            if cand in flat:
                return original
    return None


def _flat_filename(name: str, version: str) -> str:
    """Turn an npm package coordinate into a filesystem-safe filename.

    Scoped packages collapse "@scope/name" to "_at_scope__name" so the
    whole thing fits on one path segment without leading "@" or "/"
    that some downstream tools (older tar implementations on the FTP
    staging filer, mainly) dislike.
    """
    safe = name.replace("@", "_at_").replace("/", "__")
    return f"{safe}-{version}.tgz"


# A semver-shaped path segment: numeric major.minor[.patch][-pre][+build].
# We anchor strictly to digits-and-dots in the leading triple to avoid
# matching ad-hoc strings like ``latest`` or ``main`` that occasionally
# appear in SBOM source paths for Docker / Go entries.
_NPM_SEMVER_SEG_RE = re.compile(r"^\d+(?:\.\d+)+(?:[-+][\w.]+)?$")


def _extract_npm_coord_from_source_path(source_path: str) -> tuple[str, str] | None:
    """Find the deepest ``(name, version)`` npm coordinate at the tail
    of an RTS source_path.

    RTS records the dependency *chain* in the path (e.g.
    ``.../eslint/8.57.1/doctrine/3.0.0``), so the canonical npm
    coordinate of a row is the LAST ``<name>/<version>`` pair, not
    any earlier link in the chain. Scoped packages widen the pair to
    a triple ``<@scope>/<name>/<version>`` (e.g.
    ``.../@grpc/grpc-js/1.14.3``).

    Walks segments backwards from the end of the path until it finds
    a semver-shaped segment; the segment immediately before it is the
    package basename, and if the segment before THAT begins with
    ``@``, it's the scope. Returns ``None`` when the tail doesn't
    look npm-shaped (so callers can fall through to other harvesters
    or the structured-skip path).
    """
    if "-npm" not in source_path:
        return None
    parts = [p for p in source_path.split("/") if p]
    for i in range(len(parts) - 1, 0, -1):
        if _NPM_SEMVER_SEG_RE.match(parts[i]):
            basename = parts[i - 1]
            if i >= 2 and parts[i - 2].startswith("@"):
                return f"{parts[i - 2]}/{basename}", parts[i]
            return basename, parts[i]
    return None


def _candidate_npm_keys(component: str, csv_version: str,
                        source_path: str) -> list[tuple[str, str]]:
    """Build an ordered list of ``(name_lower, version)`` keys to try
    against the npm inventory. Higher-priority keys come first.

    The CSV ``Component`` column carries human display strings ("Long.js",
    "ReactiveX RxJS", "siimon/prom-client", "watchman" — none of which are
    actual npm package names). The SBOM ``source_path`` always carries
    the canonical npm coordinate at its tail, so we try that first and
    fall back to the CSV column (with a leading-``v`` strip on the
    version) only when the source_path doesn't yield one.
    """
    candidates: list[tuple[str, str]] = []

    sp_coord = _extract_npm_coord_from_source_path(source_path)
    if sp_coord is not None:
        candidates.append((sp_coord[0].lower(), sp_coord[1]))

    if component and csv_version:
        candidates.append((component.lower(), csv_version))
        # Strip leading ``v`` from versions like ``v3.0.0`` — RTS records
        # some npm components with that prefix even though npm itself
        # never uses it.
        if (csv_version.startswith("v") and len(csv_version) >= 2
                and csv_version[1].isdigit()):
            candidates.append((component.lower(), csv_version[1:]))

    # Deduplicate while preserving order.
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str]] = []
    for k in candidates:
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out


def _verify_integrity(path: Path, integrity: str | None) -> tuple[bool, str]:
    """Verify ``path`` against an npm ``integrity`` string of the form
    ``<algo>-<base64>``. Returns ``(ok, detail)``. When integrity is
    falsy, returns ``(True, "no integrity provided")`` — we trust the
    URL in that case since lockfile entries without integrity are rare
    and hard-failing on them would block legitimate runs.
    """
    if not integrity:
        return True, "no integrity provided"
    algo, sep, b64 = integrity.partition("-")
    if not sep or not b64:
        return False, f"malformed integrity: {integrity!r}"
    algo = algo.lower()
    if algo not in hashlib.algorithms_available:
        return False, f"unsupported integrity algorithm: {algo!r}"
    h = hashlib.new(algo)
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(_CHUNK), b""):
            h.update(chunk)
    actual = base64.b64encode(h.digest()).decode()
    if actual == b64:
        return True, f"{algo} verified"
    return False, f"{algo} mismatch (expected {b64[:16]}..., got {actual[:16]}...)"


def _download_tarball(url: str, dest: Path, integrity: str | None) -> tuple[int, str]:
    """Download ``url`` to ``dest``, verifying integrity on success.

    Returns ``(bytes_written, detail)``. Raises on any HTTP/IO error.
    Removes the partial file on integrity mismatch so a re-run from
    the workflow can't accidentally publish a corrupt tarball.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "ndm-rts-ftp-posting"})
    written = 0
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status >= 400:
            raise RuntimeError(f"HTTP {resp.status} for {url}")
        with dest.open("wb") as out:
            while True:
                chunk = resp.read(_CHUNK)
                if not chunk:
                    break
                out.write(chunk)
                written += len(chunk)
    if written == 0:
        dest.unlink(missing_ok=True)
        raise RuntimeError(f"empty body for {url}")
    ok, detail = _verify_integrity(dest, integrity)
    if not ok:
        dest.unlink(missing_ok=True)
        raise RuntimeError(f"integrity verification failed: {detail}")
    return written, detail


# ---------------------------------------------------------------------------
# Maven Central harvesting
# ---------------------------------------------------------------------------

# Public Maven Central mirror. ``repo1.maven.org`` is the canonical
# host; ``search.maven.org`` is a separate metadata API that we don't
# need here — we already know the GAV from the SBOM.
_MAVEN_CENTRAL = "https://repo1.maven.org/maven2"

# A trailing ``<groupId>:<artifactId>:<version>`` triple at the end of
# the RTS source_path. We anchor to end-of-string because the SBOM may
# nest several GAVs along the path (the dependency chain that pulled
# the artifact in); only the last one is the artifact this row is
# actually about.
_MAVEN_GAV_TAIL_RE = re.compile(
    r"([A-Za-z0-9_.\-]+):([A-Za-z0-9_.\-]+):([A-Za-z0-9_.\-+]+)\s*$"
)


def _parse_maven_gav(source_path: str) -> tuple[str, str, str] | None:
    """Extract ``(groupId, artifactId, version)`` from an RTS Maven
    source_path. Returns ``None`` if the path does not look like a
    Maven SBOM entry or the trailing GAV is malformed.
    """
    if "-maven/" not in source_path and "/-maven" not in source_path \
            and not source_path.startswith("-maven/"):
        return None
    m = _MAVEN_GAV_TAIL_RE.search(source_path)
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3)


def _maven_central_url(group: str, artifact: str, version: str,
                       *, classifier: str = "", ext: str = "jar") -> str:
    """Compose a Maven Central URL for the given coordinate.

    ``classifier`` is e.g. ``"sources"``; ``ext`` is e.g. ``"jar"`` or
    ``"pom"``. The groupId's dots are flattened to slashes per Maven's
    layout convention.
    """
    g = group.replace(".", "/")
    suffix = f"-{classifier}" if classifier else ""
    return f"{_MAVEN_CENTRAL}/{g}/{artifact}/{version}/{artifact}-{version}{suffix}.{ext}"


def _verify_sha1(path: Path, expected_hex: str) -> tuple[bool, str]:
    """Verify ``path`` against an expected SHA-1 hex digest. Returns
    ``(ok, detail)``. Maven Central's sidecar files always carry SHA-1;
    SHA-256 / SHA-512 are also published for newer artifacts but
    SHA-1 is the universally-available baseline.
    """
    h = hashlib.sha1()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(_CHUNK), b""):
            h.update(chunk)
    actual = h.hexdigest().lower()
    expected = expected_hex.strip().lower()
    if actual == expected:
        return True, "sha1 verified"
    return (False,
            f"sha1 mismatch (expected {expected[:16]}..., got {actual[:16]}...)")


def _http_get_text(url: str, *, timeout: float = 30) -> str | None:
    """GET ``url`` and return the body as text. Returns ``None`` on
    HTTP 404 (so callers can probe for optional artifacts), raises on
    any other error.
    """
    req = urllib.request.Request(url, headers={"User-Agent": "ndm-rts-ftp-posting"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def _http_download(url: str, dest: Path, *, timeout: float = 60) -> int:
    """Download ``url`` to ``dest`` and return bytes written. Raises
    on any HTTP error including 404 — caller is expected to probe for
    existence (e.g. via the ``.sha1`` sidecar) before calling.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "ndm-rts-ftp-posting"})
    written = 0
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status >= 400:
            raise RuntimeError(f"HTTP {resp.status} for {url}")
        with dest.open("wb") as out:
            while True:
                chunk = resp.read(_CHUNK)
                if not chunk:
                    break
                out.write(chunk)
                written += len(chunk)
    if written == 0:
        dest.unlink(missing_ok=True)
        raise RuntimeError(f"empty body for {url}")
    return written


def _maven_safe_filename(group: str, artifact: str, version: str,
                         *, classifier: str = "", ext: str = "jar") -> str:
    """Flatten a Maven GAV into a single filesystem-safe filename.

    Mirrors npm's ``_flat_filename`` convention so the FTP staging
    layout is uniformly flat: ``<group>__<artifact>-<version>[-<cls>].<ext>``.
    """
    suffix = f"-{classifier}" if classifier else ""
    return f"{group}__{artifact}-{version}{suffix}.{ext}"


def _harvest_maven_artifact(group: str, artifact: str, version: str,
                            out_root: Path) -> dict:
    """Fetch an artifact from Maven Central with a small fallback
    ladder. Returns a dict suitable for merging into a manifest record:

    Successful keys: ``status="ok"``, ``resolved_url``, ``local_path``,
    ``size``, ``integrity``, ``integrity_check``, ``detail``,
    optionally ``fallback`` (``"pom-only"`` or ``"binary-jar"``).

    Failed keys: ``status="failed"``, ``resolved_url`` (last URL
    attempted), ``detail`` (human-readable reason).

    Ladder:

    1. ``-sources.jar`` (preferred — actual upstream source code)
    2. POM, if ``<packaging>pom</packaging>`` (BOM / aggregator —
       there is no compiled code to ship; record the POM itself for
       traceability with ``fallback="pom-only"``)
    3. binary ``.jar`` (rare; recorded with ``fallback="binary-jar"``
       so the operator can spot-check whether any need manual
       sourcing from the upstream Git tag)
    """
    sources_url = _maven_central_url(group, artifact, version, classifier="sources")
    sources_sha1_url = sources_url + ".sha1"

    try:
        sha1_text = _http_get_text(sources_sha1_url)
    except Exception as exc:  # noqa: BLE001 — surface to manifest
        return {"status": "failed",
                "resolved_url": sources_url,
                "detail": f"sha1 fetch error: {type(exc).__name__}: {exc}"}

    if sha1_text is not None:
        dest = out_root / "maven" / _maven_safe_filename(
            group, artifact, version, classifier="sources")
        try:
            size = _http_download(sources_url, dest)
        except Exception as exc:  # noqa: BLE001
            return {"status": "failed",
                    "resolved_url": sources_url,
                    "detail": f"download error: {type(exc).__name__}: {exc}"}
        expected_sha1 = sha1_text.strip().split()[0]
        ok, detail = _verify_sha1(dest, expected_sha1)
        if not ok:
            dest.unlink(missing_ok=True)
            return {"status": "failed",
                    "resolved_url": sources_url,
                    "detail": f"integrity verification failed: {detail}"}
        return {"status": "ok",
                "resolved_url": sources_url,
                "local_path": str(dest),
                "size": size,
                "integrity": f"sha1-{expected_sha1}",
                "integrity_check": detail,
                "detail": f"{size} bytes"}

    # No -sources.jar published. Inspect the POM to decide whether
    # this is a POM-only aggregator or a binary-only artifact.
    pom_url = _maven_central_url(group, artifact, version, ext="pom")
    pom_sha1_url = pom_url + ".sha1"
    try:
        pom_text = _http_get_text(pom_url)
    except Exception as exc:  # noqa: BLE001
        return {"status": "failed",
                "resolved_url": pom_url,
                "detail": f"pom fetch error: {type(exc).__name__}: {exc}"}
    if pom_text is None:
        return {"status": "failed",
                "resolved_url": pom_url,
                "detail": (f"artifact not on Maven Central "
                           f"(no -sources.jar, no .pom): "
                           f"{group}:{artifact}:{version}")}

    if re.search(r"<packaging>\s*pom\s*</packaging>", pom_text, re.IGNORECASE):
        # POM-only: ship the POM itself for traceability.
        try:
            pom_sha1_text = _http_get_text(pom_sha1_url)
        except Exception as exc:  # noqa: BLE001
            return {"status": "failed",
                    "resolved_url": pom_sha1_url,
                    "detail": f"pom sha1 fetch error: {type(exc).__name__}: {exc}"}
        dest = out_root / "maven" / _maven_safe_filename(
            group, artifact, version, ext="pom")
        try:
            size = _http_download(pom_url, dest)
        except Exception as exc:  # noqa: BLE001
            return {"status": "failed",
                    "resolved_url": pom_url,
                    "detail": f"pom download error: {type(exc).__name__}: {exc}"}
        rec: dict = {"status": "ok",
                     "resolved_url": pom_url,
                     "local_path": str(dest),
                     "size": size,
                     "fallback": "pom-only",
                     "detail": (f"{size} bytes (POM-only artifact: no "
                                f"compiled code to redistribute)")}
        if pom_sha1_text is not None:
            ok, integrity_detail = _verify_sha1(dest, pom_sha1_text.strip().split()[0])
            if not ok:
                dest.unlink(missing_ok=True)
                return {"status": "failed",
                        "resolved_url": pom_url,
                        "detail": f"pom integrity verification failed: {integrity_detail}"}
            rec["integrity"] = f"sha1-{pom_sha1_text.strip().split()[0]}"
            rec["integrity_check"] = integrity_detail
        return rec

    # Binary jar fallback.
    binary_url = _maven_central_url(group, artifact, version)
    binary_sha1_url = binary_url + ".sha1"
    try:
        bin_sha1_text = _http_get_text(binary_sha1_url)
    except Exception as exc:  # noqa: BLE001
        return {"status": "failed",
                "resolved_url": binary_sha1_url,
                "detail": f"binary sha1 fetch error: {type(exc).__name__}: {exc}"}
    if bin_sha1_text is None:
        return {"status": "failed",
                "resolved_url": binary_url,
                "detail": (f"no -sources.jar and no binary .jar published on "
                           f"Maven Central for {group}:{artifact}:{version}")}
    dest = out_root / "maven" / _maven_safe_filename(group, artifact, version)
    try:
        size = _http_download(binary_url, dest)
    except Exception as exc:  # noqa: BLE001
        return {"status": "failed",
                "resolved_url": binary_url,
                "detail": f"binary download error: {type(exc).__name__}: {exc}"}
    expected_sha1 = bin_sha1_text.strip().split()[0]
    ok, integrity_detail = _verify_sha1(dest, expected_sha1)
    if not ok:
        dest.unlink(missing_ok=True)
        return {"status": "failed",
                "resolved_url": binary_url,
                "detail": f"binary integrity verification failed: {integrity_detail}"}
    return {"status": "ok",
            "resolved_url": binary_url,
            "local_path": str(dest),
            "size": size,
            "integrity": f"sha1-{expected_sha1}",
            "integrity_check": integrity_detail,
            "fallback": "binary-jar",
            "detail": (f"{size} bytes (no -sources.jar published; binary "
                       f"jar shipped for redistribution)")}


# ---------------------------------------------------------------------------
# Go module harvesting
# ---------------------------------------------------------------------------

# Public Go module proxy and checksum database. Both are operated by
# Google and have been the canonical resolution path for Go modules
# since 1.13; they require no auth and serve every public module
# any contemporary ``go.mod`` could reference.
_GO_PROXY = "https://proxy.golang.org"
_GO_SUMDB = "https://sum.golang.org"

# Canonical Go semver: ``vMAJOR.MINOR.PATCH[-prerelease][+build]``.
_GO_SEMVER_RE = re.compile(r"^v\d+(?:\.\d+)*(?:[-+][\w.\-]+)?$")


def _is_go_source_path(source_path: str) -> bool:
    """Recognise the SBOM tags RTS uses for Go modules. We've seen
    both ``-go_mod`` and the legacy ``-go`` form across releases, and
    in either case the segment is preceded by a ``:`` separator
    rather than ``/`` (the WASM build's ``go.mod`` path style).
    """
    return ("-go_mod/" in source_path
            or ":-go_mod/" in source_path
            or "/-go/" in source_path
            or ":-go/" in source_path)


def _parse_go_coord(source_path: str) -> tuple[str, str] | None:
    """Extract the trailing ``(module-path, version)`` pair from a Go
    SBOM source_path. Returns ``None`` when the path doesn't look
    like a Go module entry.

    The Go SBOM source_path uses ``:`` to separate ``<module>:<version>``
    pairs along the dependency chain, e.g.::

        .../redis-jwt-auth:-go_mod/github.com/tetratelabs/proxy-wasm-go-sdk:v0.24.0/github.com/tetratelabs/wazero:v1.7.2

    The last colon delimits the row's own ``(module, version)``; the
    preceding pair is whatever importing module pulled it in. The
    candidate module string we extract often carries a leading
    ``-go_mod/`` ecosystem tag (when the row is a top-level
    ``go.mod`` direct) or a leading ``vX.Y.Z/`` chain link (when the
    row is a transitive). Both are stripped before returning.
    """
    if not _is_go_source_path(source_path):
        return None
    head, sep, version = source_path.rpartition(":")
    if not sep or not _GO_SEMVER_RE.match(version.strip()):
        return None
    # ``head`` may itself end in ``...:<this-module>``; pick the
    # final colon-separated segment as the candidate module path.
    candidate = head.rsplit(":", 1)[-1].lstrip("/")
    # Strip the ecosystem tag if present.
    candidate = re.sub(r"^-go(?:_mod)?/", "", candidate)
    # Strip a leading ``<chain-version>/`` link if the SBOM nested a
    # version inside the candidate (the common case for transitives).
    chain_strip = re.match(
        r"^v\d+(?:\.\d+)*(?:[-+][\w.\-]+)?/(.+)$", candidate)
    if chain_strip is not None:
        candidate = chain_strip.group(1)
    candidate = candidate.strip().rstrip("/")
    if not candidate or "/" not in candidate:
        return None
    return candidate, version.strip()


def _go_proxy_case_encode(s: str) -> str:
    """Apply the Go module proxy's case-encoding rule: every uppercase
    letter is escaped as ``!<lower>`` so the proxy can serve from a
    case-insensitive filesystem unambiguously. See
    https://go.dev/ref/mod#goproxy-protocol.
    """
    out: list[str] = []
    for ch in s:
        if ch.isupper():
            out.append("!" + ch.lower())
        else:
            out.append(ch)
    return "".join(out)


def _go_module_zip_url(module: str, version: str) -> str:
    return (f"{_GO_PROXY}/{_go_proxy_case_encode(module)}/@v/"
            f"{_go_proxy_case_encode(version)}.zip")


def _go_sumdb_lookup_url(module: str, version: str) -> str:
    return (f"{_GO_SUMDB}/lookup/{_go_proxy_case_encode(module)}"
            f"@{_go_proxy_case_encode(version)}")


def _verify_go_h1(zip_path: Path, expected_h1: str) -> tuple[bool, str]:
    """Verify a Go module zip against the ``h1:<base64>`` hash the
    checksum database publishes. The ``h1`` algorithm is
    ``base64(SHA-256( concat( hex(SHA-256(content)) + "  " + name + "\\n"
    for name in sorted(zip-entries) ) ))`` — see
    https://pkg.go.dev/golang.org/x/mod/sumdb/dirhash.HashZip.
    Re-implementing it in pure stdlib keeps this script
    dependency-free, matching the rest of the harvester.
    """
    if not expected_h1.startswith("h1:"):
        return False, f"unsupported go hash algo (expected h1:): {expected_h1!r}"
    expected_b64 = expected_h1[3:]
    outer = hashlib.sha256()
    with zipfile.ZipFile(zip_path, "r") as zf:
        for name in sorted(zf.namelist()):
            inner = hashlib.sha256()
            with zf.open(name) as fh:
                for chunk in iter(lambda: fh.read(_CHUNK), b""):
                    inner.update(chunk)
            outer.update((inner.hexdigest() + "  " + name + "\n").encode("utf-8"))
    actual_b64 = base64.b64encode(outer.digest()).decode()
    if actual_b64 == expected_b64:
        return True, "h1 verified"
    return (False,
            f"h1 mismatch (expected {expected_b64[:16]}..., "
            f"got {actual_b64[:16]}...)")


def _harvest_go_module(module: str, version: str, out_root: Path) -> dict:
    """Download a Go module zip from ``proxy.golang.org`` and verify
    integrity against the corresponding ``sum.golang.org`` h1 hash.

    Returns a dict suitable for merging into a manifest record:

    Successful keys: ``status="ok"``, ``resolved_url``, ``local_path``,
    ``size``, ``integrity`` (the ``h1:<b64>`` string), ``integrity_check``,
    ``detail``.

    Failed keys: ``status="failed"``, ``resolved_url``, ``detail``.

    sum.golang.org may legitimately not have a hash for very old or
    rate-limited lookups; in that case we record ``integrity_check =
    "skipped (no sumdb hash available)"`` and stage the zip anyway,
    so the operator can manually verify against ``go.sum`` at the
    release-branch checkout if they want to. Genuine integrity
    *mismatches* (sumdb has a hash and it doesn't match what we
    downloaded) hard-fail the row, same as every other ecosystem.
    """
    zip_url = _go_module_zip_url(module, version)
    sumdb_url = _go_sumdb_lookup_url(module, version)

    expected_h1: str | None = None
    sumdb_status = "not attempted"
    try:
        sumdb_text = _http_get_text(sumdb_url)
        if sumdb_text is None:
            sumdb_status = "404 (module not in sumdb)"
        else:
            mh = re.search(r"\bh1:[A-Za-z0-9+/=]+", sumdb_text)
            if mh:
                expected_h1 = mh.group(0)
                sumdb_status = "looked up"
            else:
                sumdb_status = "no h1 line in sumdb response"
    except Exception as exc:  # noqa: BLE001
        sumdb_status = f"sumdb lookup error: {type(exc).__name__}: {exc}"

    safe_name = (module.replace("/", "__").replace("@", "_at_")
                 + f"-{version}.zip")
    dest = out_root / "go" / safe_name
    try:
        size = _http_download(zip_url, dest)
    except Exception as exc:  # noqa: BLE001
        return {"status": "failed",
                "resolved_url": zip_url,
                "detail": f"download error: {type(exc).__name__}: {exc}"}

    integrity_check = f"skipped ({sumdb_status})"
    integrity: str | None = None
    if expected_h1 is not None:
        ok, integrity_check = _verify_go_h1(dest, expected_h1)
        if not ok:
            dest.unlink(missing_ok=True)
            return {"status": "failed",
                    "resolved_url": zip_url,
                    "integrity": expected_h1,
                    "detail": f"integrity verification failed: {integrity_check}"}
        integrity = expected_h1

    return {"status": "ok",
            "resolved_url": zip_url,
            "local_path": str(dest),
            "size": size,
            "integrity": integrity,
            "integrity_check": integrity_check,
            "detail": f"{size} bytes (sumdb: {sumdb_status})"}


# ---------------------------------------------------------------------------
# Debian source-package harvesting
# ---------------------------------------------------------------------------

# Public, no-auth Debian snapshot service. Retains every binary and
# source archive the Debian project has ever published, indexed by
# both upload time and SHA-1. We intentionally use snapshot rather
# than a current mirror because the SBOM may reference Debian
# package versions that have rotated out of Debian's main archive.
_DEBIAN_SNAPSHOT = "https://snapshot.debian.org"

# Debian binary version suffixes that don't appear in the source
# package's own version. ``+b<N>`` is a binNMU mark added by the
# build infra when only the binary needs rebuilding (libc bump,
# arch-specific fix); the source stays at the unsuffixed version.
_DEB_BINNMU_RE = re.compile(r"\+b\d+$")

# Architectures Debian publishes today, plus ``all`` for arch-
# independent packages. Used to disambiguate the trailing segment
# of a Docker SBOM source_path: when present, the binary version
# is in the second-to-last position rather than the last.
_DEBIAN_KNOWN_ARCHES = {
    "amd64", "arm64", "armhf", "armel", "i386", "mips64el",
    "ppc64el", "riscv64", "s390x", "all", "any",
}


def _is_debian_source_path(source_path: str) -> bool:
    """Recognise the SBOM tags RTS uses for OS-level Debian packages
    captured from a Docker base image. The
    ``-docker/<binary>/<version>/<arch>`` shape is what Bitnami /
    Debian-derived images produce in the SBOM; we also accept the
    explicit ``-debian`` / ``-deb`` tags in case RTS retags later.
    """
    return ("/-docker/" in source_path
            or source_path.startswith("-docker/")
            or "-docker/" in source_path
            or "/-debian/" in source_path
            or "-debian/" in source_path
            or "/-deb/" in source_path
            or source_path.startswith("-deb/"))


def _parse_debian_binary_coord(source_path: str) -> tuple[str, str] | None:
    """Extract ``(binary-package, binary-version)`` from a Docker /
    Debian SBOM source_path. Returns ``None`` if the path doesn't
    look like an OS-level Debian package entry.

    The tail of the path is normally
    ``.../-docker/<binary>/<version>/<arch>``; we tolerate the
    arch being absent (some SBOM rows omit it) by detecting the
    arch from a known list and walking back accordingly.
    """
    if not _is_debian_source_path(source_path):
        return None
    parts = [p for p in source_path.split("/") if p]
    if len(parts) < 2:
        return None
    last = parts[-1]
    if last in _DEBIAN_KNOWN_ARCHES:
        if len(parts) < 3:
            return None
        return parts[-3], parts[-2]
    return parts[-2], last


def _strip_debian_binnmu(version: str) -> str:
    """Drop a trailing ``+b<N>`` binNMU mark, returning the source
    version. A no-op for versions without the mark.
    """
    return _DEB_BINNMU_RE.sub("", version)


def _http_get_json(url: str) -> object | None:
    """GET ``url`` and decode JSON. Returns ``None`` on HTTP 404."""
    text = _http_get_text(url)
    if text is None:
        return None
    return json.loads(text)


def _harvest_debian_source(binary: str, binary_version: str, out_root: Path,
                           source_cache: dict[tuple[str, str], dict] | None = None
                           ) -> dict:
    """Resolve a Debian binary ``<package>:<version>`` to its
    upstream + Debian-revision source package on snapshot.debian.org
    and stage every source file (``.dsc``, ``.orig.tar.*``,
    ``.debian.tar.*`` / ``.diff.gz``) under
    ``out_root/debian/<source>-<source-version>/``. Each file is
    SHA-1 verified against the snapshot index — the snapshot's hash
    *is* the file's SHA-1, so verification is intrinsic to the
    fetch path and requires no separate sidecar.

    Multi-step resolution:

    1. ``/mr/binary/<binary>/<version>/binfiles?fileinfo=1`` →
       per-arch list of binary file hashes plus their pool path
       (``/pool/<area>/<initial>/<source-name>``). The source name
       falls out of the pool path directly.
    2. Source version is ``<binary-version>`` minus any trailing
       ``+b<N>`` binNMU suffix; if that doesn't resolve, we fall
       back to the binary version verbatim (covers the rare
       ``+dfsg``-style cases where the source kept the suffix
       but the binary didn't get a binNMU).
    3. ``/mr/package/<source>/<source-version>/srcfiles?fileinfo=1``
       → list of source files keyed by SHA-1.
    4. Download each file from ``/file/<sha1>``, SHA-1-verify
       against the key. Hard-fail on mismatch.
    """
    bin_v = urllib.parse.quote(binary_version, safe="")
    bin_url = f"{_DEBIAN_SNAPSHOT}/mr/binary/{binary}/{bin_v}/binfiles?fileinfo=1"

    try:
        binfiles = _http_get_json(bin_url)
    except Exception as exc:  # noqa: BLE001
        return {"status": "failed",
                "resolved_url": bin_url,
                "detail": f"binfiles fetch error: {type(exc).__name__}: {exc}"}
    if binfiles is None:
        return {"status": "failed",
                "resolved_url": bin_url,
                "detail": (f"binary not on snapshot.debian.org: "
                           f"{binary} {binary_version}")}
    fileinfo = binfiles.get("fileinfo") if isinstance(binfiles, dict) else None
    if not isinstance(fileinfo, dict) or not fileinfo:
        return {"status": "failed",
                "resolved_url": bin_url,
                "detail": (f"no binary fileinfo for "
                           f"{binary} {binary_version}")}

    # Pull the source-package name out of the pool path of any
    # arch's .deb. Different arches all live in the same pool dir,
    # so any one of them works.
    source_name: str | None = None
    for entries in fileinfo.values():
        if not isinstance(entries, list) or not entries:
            continue
        first = entries[0]
        if not isinstance(first, dict):
            continue
        pool = first.get("path", "")
        if pool.startswith("/pool/"):
            source_name = pool.rsplit("/", 1)[-1]
            break
    if not source_name:
        return {"status": "failed",
                "resolved_url": bin_url,
                "detail": (f"could not derive source name from binfiles for "
                           f"{binary} {binary_version}")}

    # Try the canonical (binNMU-stripped) source version first; fall
    # back to the binary version verbatim if that 404s. We don't
    # exhaustively probe every possible source version because the
    # Debian build invariants make exactly these two candidates
    # cover the vast majority of cases.
    candidate_src_versions: list[str] = []
    stripped = _strip_debian_binnmu(binary_version)
    candidate_src_versions.append(stripped)
    if stripped != binary_version:
        candidate_src_versions.append(binary_version)

    srcfiles: dict | None = None
    src_version: str | None = None
    last_url = ""
    for cv in candidate_src_versions:
        url = (f"{_DEBIAN_SNAPSHOT}/mr/package/{source_name}/"
               f"{urllib.parse.quote(cv, safe='')}/srcfiles?fileinfo=1")
        last_url = url
        try:
            data = _http_get_json(url)
        except Exception as exc:  # noqa: BLE001
            return {"status": "failed",
                    "resolved_url": url,
                    "detail": (f"srcfiles fetch error: "
                               f"{type(exc).__name__}: {exc}")}
        if data is not None:
            srcfiles = data if isinstance(data, dict) else None
            src_version = cv
            break

    if srcfiles is None or src_version is None:
        return {"status": "failed",
                "resolved_url": last_url,
                "detail": (f"no source-package version on snapshot for "
                           f"{source_name} (tried {candidate_src_versions})")}

    # Source-level dedup: if some other binary has already pulled
    # this exact source package, reuse the staged files rather than
    # re-fetching ``.orig.tar.*`` (which can be tens of MB).
    src_key = (source_name, src_version)
    if source_cache is not None and src_key in source_cache:
        cached = source_cache[src_key]
        return {**cached,
                "binary_package": binary,
                "binary_version": binary_version,
                "duplicate_source": True}

    src_fileinfo = srcfiles.get("fileinfo")
    if not isinstance(src_fileinfo, dict) or not src_fileinfo:
        return {"status": "failed",
                "resolved_url": last_url,
                "detail": (f"no srcfiles fileinfo for "
                           f"{source_name} {src_version}")}

    out_pkg_dir = out_root / "debian" / f"{source_name}-{src_version}"
    out_pkg_dir.mkdir(parents=True, exist_ok=True)

    total_size = 0
    files_downloaded: list[dict] = []
    for sha1_hex, entries in src_fileinfo.items():
        if not isinstance(entries, list) or not entries:
            continue
        # Pick the most informative entry name we can find; entries
        # for the same hash differ only in archive (debian /
        # debian-debug) and first_seen, so name is identical.
        fname = entries[0].get("name") if isinstance(entries[0], dict) else None
        if not fname:
            fname = f"{sha1_hex}.bin"
        url = f"{_DEBIAN_SNAPSHOT}/file/{sha1_hex}"
        dest = out_pkg_dir / fname
        try:
            size = _http_download(url, dest)
        except Exception as exc:  # noqa: BLE001
            return {"status": "failed",
                    "resolved_url": url,
                    "detail": (f"download error for {fname}: "
                               f"{type(exc).__name__}: {exc}")}
        ok, integrity_detail = _verify_sha1(dest, sha1_hex)
        if not ok:
            dest.unlink(missing_ok=True)
            return {"status": "failed",
                    "resolved_url": url,
                    "detail": (f"integrity verification failed for {fname}: "
                               f"{integrity_detail}")}
        total_size += size
        files_downloaded.append({"name": fname, "sha1": sha1_hex, "size": size})

    result = {"status": "ok",
              "source_package": source_name,
              "source_version": src_version,
              "binary_package": binary,
              "binary_version": binary_version,
              "resolved_url": (f"{_DEBIAN_SNAPSHOT}/mr/package/{source_name}/"
                               f"{src_version}/"),
              "local_path": str(out_pkg_dir),
              "size": total_size,
              "files": files_downloaded,
              "integrity": "sha1 (per-file, snapshot index)",
              "integrity_check": (f"sha1 verified for {len(files_downloaded)} "
                                  f"source file(s)"),
              "detail": (f"{total_size} bytes across "
                         f"{len(files_downloaded)} source file(s)")}
    if source_cache is not None:
        source_cache[src_key] = result
    return result


def _walk_lockfiles(root: Path) -> Iterable[Path]:
    """Yield every package-lock.json under ``root``, skipping nested
    node_modules trees and obvious build/output directories.
    """
    stack: list[Path] = [root]
    while stack:
        cur = stack.pop()
        try:
            entries = list(cur.iterdir())
        except (PermissionError, OSError):
            continue
        for entry in entries:
            if entry.is_dir():
                if entry.name in SKIP_DIRS:
                    continue
                stack.append(entry)
            elif entry.name == "package-lock.json":
                yield entry


def _build_npm_inventory(release_branch: Path) -> dict[tuple[str, str], dict]:
    """Walk every package-lock.json under ``release_branch`` and build
    a ``(name_lower, version) -> {url, integrity, name, version,
    from_lockfile}`` map. Same coordinate appearing in multiple
    lockfiles is deduplicated; we record the first lockfile that
    introduces it.
    """
    inventory: dict[tuple[str, str], dict] = {}
    lockfile_count = 0
    pkg_count = 0

    for lockfile in _walk_lockfiles(release_branch):
        lockfile_count += 1
        try:
            data = json.loads(lockfile.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            print(f"  warn: could not parse {lockfile}: {exc}", file=sys.stderr)
            continue
        packages = data.get("packages") or {}
        if not isinstance(packages, dict):
            continue
        for pkg_path, meta in packages.items():
            if not isinstance(meta, dict):
                continue
            resolved = meta.get("resolved")
            if not isinstance(resolved, str):
                continue
            if not resolved.startswith(("http://", "https://")):
                continue
            # The lockfile's own root has key '' — skip it; it's the
            # service itself, not a downloadable dep.
            if not pkg_path:
                continue
            # Prefer the explicit ``name`` field (set when the package
            # name doesn't match the directory in node_modules); fall
            # back to the last "node_modules/..." segment.
            name = meta.get("name")
            if not isinstance(name, str) or not name:
                if "node_modules/" in pkg_path:
                    name = pkg_path.rsplit("node_modules/", 1)[-1]
                else:
                    continue
            version = meta.get("version")
            if not isinstance(version, str) or not version:
                continue
            key = (name.lower(), version)
            if key in inventory:
                continue
            inventory[key] = {
                "name": name,
                "version": version,
                "url": resolved,
                "integrity": meta.get("integrity"),
                "from_lockfile": str(lockfile),
            }
            pkg_count += 1

    print(
        f"  walked {lockfile_count} package-lock.json file(s); "
        f"{len(inventory)} unique (name, version) entries with resolved URLs"
    )
    return inventory


def process_csv(args: argparse.Namespace) -> int:
    csv_path = Path(args.csv)
    out_dir = Path(args.output_dir)
    release_branch = Path(args.release_branch).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if not release_branch.is_dir():
        print(f"::error::release branch checkout not found: {release_branch}",
              file=sys.stderr)
        return 2

    print(f"Building npm inventory from {release_branch} ...")
    inventory = _build_npm_inventory(release_branch)

    # Read CSV.
    with csv_path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames or []
        name_col = _match_header(fieldnames, NAME_HEADERS)
        version_col = _match_header(fieldnames, VERSION_HEADERS)
        license_col = _match_header(fieldnames, LICENSE_HEADERS)
        source_path_col = _match_header(fieldnames, SOURCE_PATH_HEADERS)

        print(f"CSV columns detected: {fieldnames}")
        print(f"  Name column:        {name_col!r}")
        print(f"  Version column:     {version_col!r}")
        print(f"  Source path column: {source_path_col!r}")

        if not name_col or not version_col:
            print(
                "::error::FTP-Components.csv lacks a recognisable name or "
                f"version column. Headers: {fieldnames}.",
                file=sys.stderr,
            )
            return 2

        rows = list(reader)

    print(f"Rows in CSV: {len(rows)}")

    manifest: dict[str, object] = {
        "project": args.project,
        "version": args.version,
        "csv": str(csv_path),
        "release_branch": str(release_branch),
        "npm_inventory_size": len(inventory),
        "components": [],
    }

    # Cache Maven downloads by (group, artifact, version). The same GAV
    # often appears in multiple SBOM rows (the dependency chains
    # Keycloak pulls in have heavy overlap); we want one download per
    # GAV but every row in the manifest still gets its own record so
    # the per-row provenance survives.
    maven_cache: dict[tuple[str, str, str], dict] = {}

    # Same idea for Go modules: the WASM build's go.mod transitive
    # closure can name the same ``<module>@<version>`` from multiple
    # importing chains.
    go_cache: dict[tuple[str, str], dict] = {}

    # For Debian, dedup is primarily by source package because many
    # binary packages share a single source: ``libasound2-data`` and
    # ``libasound2t64`` both come from ``alsa-lib``, and ``libdb5.3``
    # /  ``libdb5.3t64`` both come from ``db5.3``. Caching by source
    # avoids re-downloading the (sometimes large) ``.orig.tar.*``
    # archive for every binary subpackage. We additionally cache by
    # binary so the binfiles + path lookup runs once per
    # ``(binary, version)`` even if the same binary appears in
    # multiple Docker base images.
    debian_binary_cache: dict[tuple[str, str], dict] = {}
    debian_source_cache: dict[tuple[str, str], dict] = {}

    n_ok = 0
    n_failed = 0
    n_skipped = 0
    for i, row in enumerate(rows, start=1):
        name = (row.get(name_col) or "").strip()
        version = (row.get(version_col) or "").strip()
        license_ = (row.get(license_col) or "").strip() if license_col else ""
        source_path = (row.get(source_path_col) or "").strip() if source_path_col else ""

        record: dict[str, object] = {
            "row": i,
            "component": name,
            "version": version,
            "license": license_,
            "source_path": source_path,
        }

        if not name or not version:
            record.update(status="skipped",
                          detail="empty name or version in CSV row")
            n_skipped += 1
            manifest["components"].append(record)  # type: ignore[attr-defined]
            continue

        # Look up in npm inventory. Try the source_path's trailing
        # canonical npm coordinate first, then fall back to the CSV
        # ``Component`` column with a leading-``v`` strip — see
        # ``_candidate_npm_keys`` for rationale.
        entry = None
        matched_via: tuple[str, str] | None = None
        for cand in _candidate_npm_keys(name, version, source_path):
            if cand in inventory:
                entry = inventory[cand]
                matched_via = cand
                break
        if entry is None:
            # Component is not in any release-branch lockfile. Try
            # ecosystem-specific harvesters before giving up. Maven
            # is keyed off the source_path's trailing GAV (the CSV
            # "Component" column is a human display name like
            # "Apache Commons Codec" that does not map cleanly to a
            # Maven coordinate; the SBOM source_path always carries
            # the canonical ``<group>:<artifact>:<version>`` triple).
            gav = _parse_maven_gav(source_path)
            if gav is not None:
                if gav in maven_cache:
                    cached = maven_cache[gav]
                    dup_record = {**cached, "duplicate_of_row": cached.get("row")}
                    # Replace the cached row's "row" with this row's
                    # number for the duplicate marker, but keep the
                    # rest of the cached payload.
                    record.update(ecosystem="maven",
                                  gav=f"{gav[0]}:{gav[1]}:{gav[2]}",
                                  **{k: v for k, v in dup_record.items()
                                     if k not in ("row", "component", "version",
                                                  "license", "source_path")})
                else:
                    result = _harvest_maven_artifact(*gav, out_root=out_dir)
                    record.update(ecosystem="maven",
                                  gav=f"{gav[0]}:{gav[1]}:{gav[2]}",
                                  **result)
                    maven_cache[gav] = {**result, "row": i}
                if record.get("status") == "ok":
                    n_ok += 1
                    print(f"[{i}/{len(rows)}] {name} {version}: "
                          f"maven ok ({record.get('detail','')})")
                else:
                    n_failed += 1
                    print(f"[{i}/{len(rows)}] {name} {version}: "
                          f"maven failed ({record.get('detail','')})",
                          file=sys.stderr)
                manifest["components"].append(record)  # type: ignore[attr-defined]
                continue

            # Debian source-package harvester — for OS-level packages
            # captured from a Docker base image. Resolves the binary
            # ``(<binary>, <version>)`` to its source package on
            # snapshot.debian.org and stages every source file
            # (``.dsc`` + upstream ``.orig.tar.*`` + Debian
            # ``.debian.tar.*``) under ``out_dir/debian/``.
            deb_coord = _parse_debian_binary_coord(source_path)
            if deb_coord is not None:
                if deb_coord in debian_binary_cache:
                    cached = debian_binary_cache[deb_coord]
                    record.update(ecosystem="debian",
                                  debian_binary=f"{deb_coord[0]}={deb_coord[1]}",
                                  duplicate_of_row=cached.get("row"),
                                  **{k: v for k, v in cached.items()
                                     if k not in ("row", "component", "version",
                                                  "license", "source_path")})
                else:
                    result = _harvest_debian_source(
                        *deb_coord, out_root=out_dir,
                        source_cache=debian_source_cache)
                    record.update(ecosystem="debian",
                                  debian_binary=f"{deb_coord[0]}={deb_coord[1]}",
                                  **result)
                    debian_binary_cache[deb_coord] = {**result, "row": i}
                if record.get("status") == "ok":
                    n_ok += 1
                    print(f"[{i}/{len(rows)}] {name} {version}: "
                          f"debian ok ({record.get('detail','')})")
                else:
                    n_failed += 1
                    print(f"[{i}/{len(rows)}] {name} {version}: "
                          f"debian failed ({record.get('detail','')})",
                          file=sys.stderr)
                manifest["components"].append(record)  # type: ignore[attr-defined]
                continue

            # Go module harvester — same shape as Maven: parse the
            # canonical coordinate from source_path, fall back to
            # the structured-skip path if the path doesn't yield
            # one.
            go_coord = _parse_go_coord(source_path)
            if go_coord is not None:
                if go_coord in go_cache:
                    cached = go_cache[go_coord]
                    record.update(ecosystem="go",
                                  go_module=f"{go_coord[0]}@{go_coord[1]}",
                                  duplicate_of_row=cached.get("row"),
                                  **{k: v for k, v in cached.items()
                                     if k not in ("row", "component", "version",
                                                  "license", "source_path")})
                else:
                    result = _harvest_go_module(*go_coord, out_root=out_dir)
                    record.update(ecosystem="go",
                                  go_module=f"{go_coord[0]}@{go_coord[1]}",
                                  **result)
                    go_cache[go_coord] = {**result, "row": i}
                if record.get("status") == "ok":
                    n_ok += 1
                    print(f"[{i}/{len(rows)}] {name} {version}: "
                          f"go ok ({record.get('detail','')})")
                else:
                    n_failed += 1
                    print(f"[{i}/{len(rows)}] {name} {version}: "
                          f"go failed ({record.get('detail','')})",
                          file=sys.stderr)
                manifest["components"].append(record)  # type: ignore[attr-defined]
                continue

            # No ecosystem-specific harvester — fall through to a
            # structured skip so the operator can see what to pick
            # up next.
            ecosystem_hint = "unknown"
            if "-npm" in source_path or "/-npm/" in source_path:
                ecosystem_hint = "npm (not in any release-branch lockfile)"
            elif "-maven" in source_path:
                ecosystem_hint = "maven (source_path lacks a parseable G:A:V triple)"
            elif _is_go_source_path(source_path):
                ecosystem_hint = "go (source_path lacks a parseable module:version tail)"
            elif _is_debian_source_path(source_path):
                ecosystem_hint = "debian (source_path lacks a parseable binary:version tail)"
            elif "-pypi" in source_path:
                ecosystem_hint = "pypi (harvester not yet implemented)"
            elif "-rubygems" in source_path:
                ecosystem_hint = "rubygems (harvester not yet implemented)"
            else:
                ecosystem_hint = "unknown ecosystem (harvester not yet implemented)"
            record.update(status="skipped",
                          detail=f"no source archive harvested: {ecosystem_hint}",
                          ecosystem=ecosystem_hint)
            n_skipped += 1
            manifest["components"].append(record)  # type: ignore[attr-defined]
            continue

        # Fetch from the lockfile-recorded URL, verify integrity, drop
        # in output_dir/npm/.
        dest = out_dir / "npm" / _flat_filename(entry["name"], entry["version"])
        try:
            size, integrity_detail = _download_tarball(
                entry["url"], dest, entry.get("integrity"),
            )
            record.update(
                ecosystem="npm",
                resolved_url=entry["url"],
                integrity=entry.get("integrity"),
                integrity_check=integrity_detail,
                local_path=str(dest.relative_to(out_dir.parent.parent))
                if out_dir.parent.parent in dest.parents else str(dest),
                size=size,
                from_lockfile=entry["from_lockfile"],
                status="ok",
                detail=f"{size} bytes",
                npm_resolved_name=entry["name"],
                matched_via=(f"{matched_via[0]}@{matched_via[1]}"
                             if matched_via else None),
            )
            n_ok += 1
            print(f"[{i}/{len(rows)}] {name} {version}: ok ({size} bytes, "
                  f"{integrity_detail})")
        except Exception as exc:  # noqa: BLE001 — surface to manifest
            record.update(
                ecosystem="npm",
                resolved_url=entry["url"],
                integrity=entry.get("integrity"),
                from_lockfile=entry["from_lockfile"],
                status="failed",
                detail=f"{type(exc).__name__}: {exc}",
            )
            n_failed += 1
            print(f"[{i}/{len(rows)}] {name} {version}: failed ({exc})",
                  file=sys.stderr)
        manifest["components"].append(record)  # type: ignore[attr-defined]

    manifest_path = Path(args.manifest)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)

    print()
    print(f"Done. ok={n_ok}  failed={n_failed}  skipped={n_skipped}  total={len(rows)}")
    print(f"Manifest: {manifest_path}")

    # Always return 0 when the CSV itself was parseable. The workflow's
    # "Sanity-check staged content" step decides whether the run as a
    # whole should fail (so the manifest artifact uploads first and the
    # operator can see exactly what survived).
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", required=True, help="Path to FTP-Components.csv")
    parser.add_argument("--project", required=True, help="RTS Project Name (annotation only)")
    parser.add_argument("--version", required=True, help="RTS Project Version (annotation only)")
    parser.add_argument(
        "--release-branch",
        required=True,
        help=(
            "Path to the release-branch checkout that contains every "
            "service's package-lock.json. The harvester reads the "
            "lockfiles to resolve each CSV row to its upstream tarball."
        ),
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Local directory to stage source archives in",
    )
    parser.add_argument("--manifest", required=True, help="Where to write manifest.json")
    parser.add_argument("--log-dir", required=True)
    args = parser.parse_args(argv)

    log_dir = Path(args.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)

    return process_csv(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
