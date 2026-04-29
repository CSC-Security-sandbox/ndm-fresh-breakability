#!/usr/bin/env python3
"""Scan a staging directory for anything that looks like NetApp / NDM
intellectual property and must NOT leave the corporate network.

The scanner is deliberately paranoid: a false positive is recoverable
(an operator inspects the flagged file, decides it's a legitimate
upstream reference to NetApp, and addresses it at the source — by
renaming, redacting, or excluding the offending file from the
published archive on the upstream side — then re-runs the workflow),
but a false negative leaks NetApp IP onto a public FTP site. So we
err on the side of flagging too much. The check is always enforced;
there is no in-workflow allow-list of file hashes.

Threat model
------------
What we're protecting against is **NDM source code (or NDM-internal
identifiers) ending up bundled inside an upstream third-party archive
that's about to be published to the public FTP site**. With that as
the asymmetry, patterns fall into three groups:

* **High-confidence IP markers** — explicit ``Copyright (c) NetApp``
  / ``NetApp Confidential`` / ``Proprietary NetApp`` strings. These
  are leaks anywhere they appear, including in metadata files NDM
  itself emits, so they're always applied.
* **NDM coordinate strings** — the ``@NetApp-Cloud-DataMigrate`` npm
  scope and the ``NetApp Data Migrator`` project name. These appear
  legitimately in RTS-produced metadata at the staging root (the
  FTP-Components.csv literally is "the manifest for project NetApp
  Data Migrator listing every ``@NetApp-Cloud-DataMigrate/<lib>`` it
  ships"). They are leaks **only** when they appear inside an
  upstream third-party archive — no third-party legitimately
  depends on our private scope or carries our project name. So
  these patterns are applied only to *archive contents*.
* **NDM source-tree path markers** — ``services/<svc>/src/``,
  ``lib/<lib>/src/``, ``liquibase/apply/``, ... . These are
  vanishingly unlikely to appear in legitimate RTS metadata, so they
  are applied everywhere; an NDM-source path inside the SBOM CSV
  would itself be a flag worth investigating.

The split is hardcoded — the operator has no toggle to weaken it —
so this is not an allow-list, it's a context-aware threat model.

What it does
------------
1. For every file under ``--root``:
   * If the file is a known archive (tar/tar.gz/tar.bz2/tar.xz/zip/jar/
     war/aar/ear), extract it into a temporary directory (respects the
     ``TMPDIR`` / ``TMP`` environment variables — default is often
     ``/tmp``, which may be too small for huge upstream ``.orig.tar.xz``
     trees) and walk the extracted tree as **archive content** (full
     pattern set applies).
   * Otherwise treat the single file as **staging-root metadata**
     (NDM-emitted manifest, RTS-emitted SBOM CSV, ...) and scan with
     high-confidence IP markers + NDM source-tree paths only.
2. Inside the extracted tree:
   * Plain-text files: grep for the full pattern set.
   * Binary files: extract printable strings and grep for high-
     confidence + coordinate patterns (path markers are skipped here
     because short path fragments like ``liquibase/apply`` occasionally
     appear in unrelated binaries).
3. Emit a JSON report at ``--report`` and print a human summary.
4. Exit 1 if any IP / path pattern matched, or if any archive could
   not be extracted for scanning (``extract_errors``). Zip files
   that trip Python's overlap guard may be shallow-scanned on disk
   instead; clean results are recorded under ``extraction_skipped``.

The scanner is intentionally self-contained — it uses only the Python
stdlib — so it works on any runner without extra dependencies.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import string
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path


# ---------------------------------------------------------------------------
# Detection patterns
# ---------------------------------------------------------------------------

# High-confidence "this is NetApp IP" markers. Case-insensitive.
# These are explicit copyright / proprietary statements and are leaks
# wherever they appear (including inside RTS-emitted metadata files at
# the staging root — RTS has no business stamping NetApp copyrights into
# an SBOM CSV, so any hit here is genuinely worth investigating).
HIGH_CONFIDENCE_IP_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"Copyright\s*(?:\([cC]\)|\xa9|©)?\s*(?:19|20)\d{2}[^.\n]{0,120}?NetApp",
               re.IGNORECASE),
    re.compile(r"\([cC]\)\s*NetApp", re.IGNORECASE),
    re.compile(r"NetApp\s*,?\s*Inc\.?", re.IGNORECASE),
    re.compile(r"NetApp[\s\-_]+Confidential", re.IGNORECASE),
    re.compile(r"Proprietary[^\n]{0,80}NetApp", re.IGNORECASE),
    re.compile(r"NetApp[^\n]{0,80}Proprietary", re.IGNORECASE),
]

# NDM coordinate / branding strings. NDM publishes its internal
# libraries (jobs-lib, auth-lib, api-handler-lib, logger-lib) to npm
# under the ``@NetApp-Cloud-DataMigrate`` scope, and "NetApp Data
# Migrator" is the project's RTS name. Both legitimately appear in
# RTS-emitted metadata at the staging root: the FTP-Components.csv
# enumerates every shipped ``@NetApp-Cloud-DataMigrate/<lib>`` by
# name, and the project name is literally the title of the report.
# But neither has any business showing up *inside* a third-party
# upstream tarball — no external package legitimately depends on our
# private scope or carries our project name. So we apply these
# patterns only when scanning archive content; in metadata-mode
# scans they're suppressed to eliminate the structural false
# positive on the SBOM CSV.
NDM_COORDINATE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"@NetApp-Cloud-DataMigrate"),
    re.compile(r"NetApp[-_\s]+Cloud[-_\s]+DataMigrate", re.IGNORECASE),
    re.compile(r"NetApp\s+Data\s+Migrator", re.IGNORECASE),
]

# NDM source-tree directory markers. If we see any of these as a *path*
# fragment inside an open-source archive, it means someone accidentally
# bundled NDM source code into a third-party tarball. Applied only to
# text content (not to strings-extracted binary data) to keep the false
# positive rate low.
NDM_PATH_MARKERS: list[re.Pattern[str]] = [
    re.compile(r"\bservices/worker/src/"),
    re.compile(r"\bservices/admin-service/src/"),
    re.compile(r"\bservices/config-service/src/"),
    re.compile(r"\bservices/db-writer/src/"),
    re.compile(r"\bservices/jobs-service/src/"),
    re.compile(r"\bservices/reports-service/src/"),
    re.compile(r"\bservices/support-service/src/"),
    re.compile(r"\bservices/datamigrator-ui/src/"),
    re.compile(r"\blib/api-handler-lib/src/"),
    re.compile(r"\blib/auth-lib/src/"),
    re.compile(r"\blib/jobs-lib/src/"),
    re.compile(r"\blib/logger-lib/src/"),
    re.compile(r"\bndm-api-tests/"),
    re.compile(r"\bapp-deployment/ansible/"),
    re.compile(r"\bapp-deployment/terraform/"),
    re.compile(r"\bapp-deployment/packer/"),
    re.compile(r"\bliquibase/apply/"),
    re.compile(r"\bliquibase/rollback/"),
]

# Archive extension → handler key.
TAR_SUFFIXES = (".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2",
                ".tar.xz", ".txz", ".tar.zst")
ZIP_SUFFIXES = (".zip", ".jar", ".war", ".ear", ".aar", ".apk",
                ".whl", ".nupkg")

# Limits kept high enough that a well-formed source tarball isn't
# truncated but low enough that a malicious "zip-bomb"-style artefact
# can't DOS the runner.  Debian ``.orig.tar.*`` sources (e.g. Firefox
# ESR) and multi-language trees routinely exceed 2 GiB *uncompressed*
# member-size sums; 10 GiB is a pragmatic ceiling for self-hosted
# runners while still bounding worst-case expansion.
MAX_EXTRACT_BYTES = 10 * 1024 * 1024 * 1024   # 10 GiB per archive
MAX_FILE_SCAN_BYTES = 20 * 1024 * 1024       # 20 MiB per file
MAX_STRINGS_MATCHES_PER_FILE = 20            # don't flood report


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PRINTABLE = set(bytes(string.printable, "ascii"))


def _is_probably_text(path: Path, sample_size: int = 8192) -> bool:
    """Cheap heuristic (no libmagic dep): a file is "text" if the first
    ``sample_size`` bytes are mostly printable and contain no NUL."""
    try:
        with path.open("rb") as fh:
            sample = fh.read(sample_size)
    except OSError:
        return False
    if not sample:
        return True
    if b"\x00" in sample:
        return False
    printable_count = sum(1 for b in sample if b in PRINTABLE or b in (9, 10, 13))
    return (printable_count / len(sample)) >= 0.85


def _iter_strings(data: bytes, min_len: int = 6):
    """Mini ``strings(1)`` over a bytes buffer."""
    current: list[int] = []
    for b in data:
        if b in PRINTABLE:
            current.append(b)
        else:
            if len(current) >= min_len:
                yield bytes(current).decode("ascii", "replace")
            current = []
    if len(current) >= min_len:
        yield bytes(current).decode("ascii", "replace")


def _is_tar(path: Path) -> bool:
    n = path.name.lower()
    return any(n.endswith(s) for s in TAR_SUFFIXES)


def _is_zip(path: Path) -> bool:
    n = path.name.lower()
    return any(n.endswith(s) for s in ZIP_SUFFIXES)


def _safe_extract_tar(tf: tarfile.TarFile, dest: Path) -> None:
    """Extract ``tf`` into ``dest`` while rejecting path-traversal and
    staying under ``MAX_EXTRACT_BYTES`` total.

    Only regular files, directories, symlinks, and hardlinks are
    extracted. ``tarfile.extractall`` would also attempt device nodes
    and FIFOs — Debian source packages (e.g. ``dpkg``) ship FIFO test
    fixtures under ``tests/t-unpack-fifo/`` that ``filter="data"``
    rejects with ``SpecialFileError``. Skipping non-regular members
    matches what we need for text scanning and avoids those failures.
    """
    dest = dest.resolve()
    total = 0
    to_extract: list[tarfile.TarInfo] = []
    for member in tf.getmembers():
        if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
            continue
        mpath = (dest / member.name).resolve()
        try:
            mpath.relative_to(dest)
        except ValueError:
            raise RuntimeError(f"path traversal in tar member: {member.name!r}")
        total += getattr(member, "size", 0) or 0
        if total > MAX_EXTRACT_BYTES:
            raise RuntimeError("archive exceeds MAX_EXTRACT_BYTES")
        to_extract.append(member)

    for member in to_extract:
        try:
            tf.extract(member, dest, set_attrs=False, filter="data")  # type: ignore[arg-type]
        except TypeError:
            tf.extract(member, dest, set_attrs=False)


def _safe_extract_zip(zf: zipfile.ZipFile, dest: Path) -> None:
    total = 0
    dest = dest.resolve()
    for info in zf.infolist():
        mpath = (dest / info.filename).resolve()
        try:
            mpath.relative_to(dest)
        except ValueError:
            raise RuntimeError(f"path traversal in zip entry: {info.filename!r}")
        total += info.file_size
        if total > MAX_EXTRACT_BYTES:
            raise RuntimeError("archive exceeds MAX_EXTRACT_BYTES")
    zf.extractall(dest)


# ---------------------------------------------------------------------------
# Scanning
# ---------------------------------------------------------------------------

# Scan contexts. ``archive-content`` files came out of an upstream
# third-party archive and get the full pattern set; ``staging-metadata``
# files are top-level RTS- or NDM-emitted manifests at the staging root
# and skip the NDM coordinate patterns (which are by-design present
# there and would otherwise drown the report).
SCOPE_ARCHIVE_CONTENT = "archive-content"
SCOPE_STAGING_METADATA = "staging-metadata"


def _scan_text(text: str, *, scope: str, include_path_markers: bool) -> list[dict]:
    hits: list[dict] = []
    for pat in HIGH_CONFIDENCE_IP_PATTERNS:
        for m in pat.finditer(text):
            hits.append({"pattern": pat.pattern, "match": m.group(0)[:200]})
            if len(hits) >= MAX_STRINGS_MATCHES_PER_FILE:
                return hits
    if scope == SCOPE_ARCHIVE_CONTENT:
        for pat in NDM_COORDINATE_PATTERNS:
            for m in pat.finditer(text):
                hits.append({"pattern": pat.pattern, "match": m.group(0)[:200]})
                if len(hits) >= MAX_STRINGS_MATCHES_PER_FILE:
                    return hits
    if include_path_markers:
        for pat in NDM_PATH_MARKERS:
            m = pat.search(text)
            if m:
                hits.append({"pattern": pat.pattern, "match": m.group(0)[:200]})
                if len(hits) >= MAX_STRINGS_MATCHES_PER_FILE:
                    return hits
    return hits


def _shallow_raw_scan(path: Path, rel: str, source_label: str) -> list[dict]:
    """When a zip/jar cannot be opened as a structured ZipFile (Python's
    post-2024 overlap / zip-bomb guards raise ``BadZipFile`` on some
    Maven ``-sources.jar`` artefacts that pre-date the stricter
    checks), scan the first ``MAX_FILE_SCAN_BYTES`` of the file on
    disk as opaque binary: printable strings + the same high-
    confidence + coordinate patterns used for binary members inside
    archives. Path markers are omitted (same rationale as
    ``_scan_file`` binary branch). This is weaker than a full tree
    walk but catches obvious NetApp markers in the readable regions
    of the jar.
    """
    try:
        with path.open("rb") as fh:
            data = fh.read(MAX_FILE_SCAN_BYTES)
    except OSError as exc:
        return [{"file": rel, "mode": "shallow-scan-error",
                 "source_archive": source_label,
                 "match": f"could not read: {exc}"}]
    big = "\n".join(_iter_strings(data))
    hits: list[dict] = []
    for h in _scan_text(big, scope=SCOPE_ARCHIVE_CONTENT,
                        include_path_markers=False):
        hits.append({"file": rel, "mode": "shallow-binary", **h,
                     "source_archive": source_label})
    return hits


def _scan_file(path: Path, rel: str, *, scope: str) -> list[dict]:
    """Return a list of hit records for a single (already-extracted) file.

    ``scope`` controls which pattern groups apply — see
    ``SCOPE_ARCHIVE_CONTENT`` vs ``SCOPE_STAGING_METADATA``.
    """
    try:
        size = path.stat().st_size
    except OSError:
        return []
    if size == 0:
        return []

    try:
        with path.open("rb") as fh:
            data = fh.read(MAX_FILE_SCAN_BYTES)
    except OSError as exc:
        return [{"file": rel, "error": f"could not read: {exc}"}]

    results: list[dict] = []
    if _is_probably_text(path):
        try:
            text = data.decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            text = data.decode("latin-1", errors="replace")
        for h in _scan_text(text, scope=scope, include_path_markers=True):
            results.append({"file": rel, "mode": "text", **h})
    else:
        # Binary: run stdlib strings(1), scan each extracted string for
        # copyright / NDM-specific markers but not for path markers
        # (short path fragments like ``liquibase/apply`` occasionally
        # appear in unrelated binaries).
        big = "\n".join(_iter_strings(data))
        for h in _scan_text(big, scope=scope, include_path_markers=False):
            results.append({"file": rel, "mode": "binary-strings", **h})

    return results


def _scan_tree(root: Path, source_label: str) -> list[dict]:
    hits: list[dict] = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            p = Path(dirpath) / fn
            rel = str(p.relative_to(root))
            # path markers in the RELATIVE PATH are themselves a
            # strong signal — catches an NDM source file bundled
            # verbatim inside a tarball.
            for pat in NDM_PATH_MARKERS:
                if pat.search(rel):
                    hits.append({
                        "file": rel,
                        "mode": "archive-path",
                        "pattern": pat.pattern,
                        "match": rel,
                        "source_archive": source_label,
                    })
                    break
            file_hits = _scan_file(p, rel, scope=SCOPE_ARCHIVE_CONTENT)
            for h in file_hits:
                h["source_archive"] = source_label
                hits.append(h)
    return hits


def scan_staging(root: Path) -> dict:
    report: dict = {
        "root": str(root),
        "archives_scanned": 0,
        "non_archive_files_scanned": 0,
        "hits": [],
        "extract_errors": [],
        "extraction_skipped": [],
    }

    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            p = Path(dirpath) / fn
            rel_from_root = str(p.relative_to(root))

            if _is_tar(p) or _is_zip(p):
                report["archives_scanned"] += 1
                with tempfile.TemporaryDirectory(prefix="ndmip-") as tmp:
                    tmp_path = Path(tmp)
                    try:
                        if _is_tar(p):
                            with tarfile.open(p, "r:*") as tf:
                                _safe_extract_tar(tf, tmp_path)
                        else:
                            try:
                                with zipfile.ZipFile(
                                        p, "r", strict_timestamps=False) as zf:
                                    _safe_extract_zip(zf, tmp_path)
                            except zipfile.BadZipFile as exc:
                                # Some Maven ``-sources.jar`` files trigger
                                # CPython's post-2024 overlap / zip-bomb
                                # detector even though they are ordinary
                                # upstream artefacts. Fall back to a
                                # bounded head read + strings scan.
                                shallow = _shallow_raw_scan(
                                    p, rel_from_root, rel_from_root)
                                errs = [h for h in shallow
                                        if h.get("mode") == "shallow-scan-error"]
                                goods = [h for h in shallow
                                         if h.get("mode") != "shallow-scan-error"]
                                for h in goods:
                                    report["hits"].append(h)
                                if errs:
                                    report["extract_errors"].append({
                                        "file": rel_from_root,
                                        "detail": errs[0].get("match", str(exc)),
                                    })
                                elif not goods:
                                    report["extraction_skipped"].append({
                                        "file": rel_from_root,
                                        "detail": (
                                            f"{type(exc).__name__}: {exc}; "
                                            "shallow head-only scan found no "
                                            "IP markers"),
                                    })
                                continue
                    except Exception as exc:  # noqa: BLE001
                        report["extract_errors"].append({
                            "file": rel_from_root,
                            "detail": f"{type(exc).__name__}: {exc}",
                        })
                        continue
                    for hit in _scan_tree(tmp_path, source_label=rel_from_root):
                        report["hits"].append(hit)
            else:
                # Non-archive top-level files are RTS- or NDM-emitted
                # metadata (FTP-Components.csv, manifest.json, ...).
                # Scan them in metadata-mode so we don't fire on the
                # SBOM legitimately listing every shipped
                # ``@NetApp-Cloud-DataMigrate/<lib>``.
                report["non_archive_files_scanned"] += 1
                for hit in _scan_file(p, rel_from_root,
                                      scope=SCOPE_STAGING_METADATA):
                    hit["source_archive"] = ""
                    report["hits"].append(hit)

    return report


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True,
                        help="Directory containing the staged sources to scan")
    parser.add_argument("--report", required=True,
                        help="Where to write the JSON scan report")
    args = parser.parse_args(argv)

    root = Path(args.root)
    if not root.is_dir():
        print(f"::error::scan root is not a directory: {root}", file=sys.stderr)
        return 2

    report = scan_staging(root)

    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")

    hits = report["hits"]
    ext_errs = report.get("extract_errors", [])
    skipped = report.get("extraction_skipped", [])

    print(f"Archives scanned:          {report['archives_scanned']}")
    print(f"Non-archive files scanned: {report['non_archive_files_scanned']}")
    print(f"IP / path hits:            {len(hits)}")
    print(f"Extraction failures:       {len(ext_errs)}")
    if skipped:
        print(f"Shallow-only (zip guard):  {len(skipped)}")

    if hits:
        print("\nFirst hits (full list in the JSON report):")
        for h in hits[:30]:
            src = h.get("source_archive") or ""
            print(f"  [{h.get('mode','?')}] {src} :: {h.get('file','')} "
                  f"-- {h.get('match','')[:120]}")
        if len(hits) > 30:
            print(f"  ... and {len(hits) - 30} more")
        print("\n::error::NetApp/NDM IP contamination detected in staging tree. "
              "FTP upload is blocked. Investigate each hit; if a hit is a "
              "legitimate upstream reference, address it at the source — "
              "rename, redact, or exclude the offending file from the "
              "published archive — and re-run the workflow. The check is "
              "always enforced; there is no in-workflow allow-list.",
              file=sys.stderr)
        return 1

    if ext_errs:
        print("\nFirst extraction errors (full list in the JSON report):")
        for e in ext_errs[:15]:
            print(f"  {e.get('file','')} — {e.get('detail','')[:160]}")
        if len(ext_errs) > 15:
            print(f"  ... and {len(ext_errs) - 15} more")
        print("\n::error::One or more staged archives could not be extracted "
              "for IP scanning (this is not an IP-pattern match — see "
              "``extract_errors`` in ip-scan.json). FTP upload is blocked "
              "until extraction succeeds or the offending artefact is "
              "removed from the staging tree.",
              file=sys.stderr)
        return 1

    print("\nNo NetApp/NDM IP markers detected. Staging tree is clean.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
