#!/usr/bin/env python3
"""Scan a staging directory for anything that looks like NetApp / NDM
intellectual property and must NOT leave the corporate network.

The scanner is deliberately paranoid: a false positive is recoverable (an
operator inspects the flagged file, decides it's a legitimate upstream
reference to NetApp, re-runs with --allow-hits <sha256>), but a false
negative leaks NetApp IP onto a public FTP site. So we err on the side
of flagging too much.

What it does:

1. For every file under ``--root``:
   * If the file is a known archive (tar/tar.gz/tar.bz2/tar.xz/zip/jar/
     war/aar/ear), extract it into a temporary directory.
   * Otherwise treat the single file as the content to scan.
2. Inside the extracted tree:
   * Plain-text files: grep for NetApp-copyright / NDM-specific markers
     AND for any of NDM's source-tree directory names.
   * Binary files: extract printable strings and grep for the same
     copyright / NDM markers (path markers are skipped here because
     short path fragments like ``liquibase/apply`` occasionally appear
     in unrelated binaries).
3. Emit a JSON report at ``--report`` and print a human summary.
4. Exit 1 if anything matched.

The scanner is intentionally self-contained — it uses only the Python
stdlib — so it works on any runner without extra dependencies.
"""

from __future__ import annotations

import argparse
import hashlib
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

# High-signal "this is NetApp IP" markers. Case-insensitive.
NETAPP_IP_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"Copyright\s*(?:\([cC]\)|\xa9|©)?\s*(?:19|20)\d{2}[^.\n]{0,120}?NetApp",
               re.IGNORECASE),
    re.compile(r"\([cC]\)\s*NetApp", re.IGNORECASE),
    re.compile(r"NetApp\s*,?\s*Inc\.?", re.IGNORECASE),
    re.compile(r"NetApp[\s\-_]+Confidential", re.IGNORECASE),
    re.compile(r"Proprietary[^\n]{0,80}NetApp", re.IGNORECASE),
    re.compile(r"NetApp[^\n]{0,80}Proprietary", re.IGNORECASE),
    # NDM-specific — these are unique to this product and are by
    # definition NetApp IP when they appear outside this repo.
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
# can't DOS the runner.
MAX_EXTRACT_BYTES = 2 * 1024 * 1024 * 1024   # 2 GiB per archive
MAX_FILE_SCAN_BYTES = 20 * 1024 * 1024       # 20 MiB per file
MAX_STRINGS_MATCHES_PER_FILE = 20            # don't flood report


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PRINTABLE = set(bytes(string.printable, "ascii"))


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 64), b""):
            h.update(chunk)
    return h.hexdigest()


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
    staying under ``MAX_EXTRACT_BYTES`` total."""
    total = 0
    dest = dest.resolve()
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
    # Python 3.12+ supports filter="data"; fall back silently on older.
    try:
        tf.extractall(dest, filter="data")  # type: ignore[arg-type]
    except TypeError:
        tf.extractall(dest)


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

def _scan_text(text: str, *, include_path_markers: bool) -> list[dict]:
    hits: list[dict] = []
    for pat in NETAPP_IP_PATTERNS:
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


def _scan_file(path: Path, rel: str) -> list[dict]:
    """Return a list of hit records for a single (already-extracted) file."""
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
        for h in _scan_text(text, include_path_markers=True):
            results.append({"file": rel, "mode": "text", **h})
    else:
        # Binary: run stdlib strings(1), scan each extracted string for
        # copyright / NDM-specific markers but not for path markers.
        big = "\n".join(_iter_strings(data))
        for h in _scan_text(big, include_path_markers=False):
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
                    })
                    break
            file_hits = _scan_file(p, rel)
            for h in file_hits:
                h["source_archive"] = source_label
                hits.append(h)
    return hits


def scan_staging(
    root: Path,
    allow_hits: set[str],
) -> dict:
    report: dict = {
        "root": str(root),
        "archives_scanned": 0,
        "non_archive_files_scanned": 0,
        "hits": [],
        "allow_listed": sorted(allow_hits),
    }

    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            p = Path(dirpath) / fn
            rel_from_root = str(p.relative_to(root))

            sha = _file_sha256(p)
            if sha in allow_hits:
                print(f"[allow-list] skipping {rel_from_root} (sha256={sha})")
                continue

            if _is_tar(p) or _is_zip(p):
                report["archives_scanned"] += 1
                with tempfile.TemporaryDirectory(prefix="ndmip-") as tmp:
                    tmp_path = Path(tmp)
                    try:
                        if _is_tar(p):
                            with tarfile.open(p, "r:*") as tf:
                                _safe_extract_tar(tf, tmp_path)
                        else:
                            with zipfile.ZipFile(p, "r") as zf:
                                _safe_extract_zip(zf, tmp_path)
                    except Exception as exc:  # noqa: BLE001
                        report["hits"].append({
                            "file": rel_from_root,
                            "mode": "extract-error",
                            "match": f"{type(exc).__name__}: {exc}",
                        })
                        continue
                    for hit in _scan_tree(tmp_path, source_label=rel_from_root):
                        report["hits"].append(hit)
            else:
                report["non_archive_files_scanned"] += 1
                for hit in _scan_file(p, rel_from_root):
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
    parser.add_argument("--allow-hits", default="",
                        help="Comma-separated sha256 hashes to skip (e.g. a file "
                             "that legitimately references NetApp and has been "
                             "reviewed by Legal)")
    args = parser.parse_args(argv)

    root = Path(args.root)
    if not root.is_dir():
        print(f"::error::scan root is not a directory: {root}", file=sys.stderr)
        return 2

    allow = {h.strip().lower() for h in args.allow_hits.split(",") if h.strip()}

    report = scan_staging(root, allow)

    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"Archives scanned:          {report['archives_scanned']}")
    print(f"Non-archive files scanned: {report['non_archive_files_scanned']}")
    print(f"Hits:                      {len(report['hits'])}")

    if report["hits"]:
        print("\nFirst hits (full list in the JSON report):")
        for h in report["hits"][:30]:
            src = h.get("source_archive") or ""
            print(f"  [{h.get('mode','?')}] {src} :: {h.get('file','')} "
                  f"-- {h.get('match','')[:120]}")
        if len(report["hits"]) > 30:
            print(f"  ... and {len(report['hits']) - 30} more")
        print("\n::error::NetApp/NDM IP contamination detected in staging tree. "
              "FTP upload is blocked. Investigate each hit; if a hit is a "
              "legitimate upstream reference, allow-list its sha256 via the "
              "``allow_ip_hit_sha256s`` workflow input after Legal sign-off.",
              file=sys.stderr)
        return 1

    print("\nNo NetApp/NDM IP markers detected. Staging tree is clean.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
