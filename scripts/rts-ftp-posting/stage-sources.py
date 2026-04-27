#!/usr/bin/env python3
"""Stage open-source archives referenced in an RTS FTP-Components.csv report.

Used by .github/workflows/rts-ftp-posting.yaml. Given:

  * the FTP-Components.csv that the RTS tool produced for an <RTS Project,
    RTS Version> pair, and
  * the URL of the RTS tool (rts.rtp.openenglab.netapp.com by default),

the script downloads every source archive referenced by that CSV into a
local staging tree rooted at ``<output_dir>`` and writes a JSON manifest
describing what was (and wasn't) fetched.

The CSV schema produced by RTS has varied slightly over time. Rather than
hard-coding a column layout the script tries a small set of likely column
names in priority order:

  * an explicit download URL column ("Download URL", "Source URL", ...),
  * a filename column ("Source File Name", "File Name", "Archive", ...).

When only a filename is known the archive is fetched from
``<rts_base>/download?file=<data_retention_root>/<Project>/<Version>/<filename>``
(the same path convention the FTP-Components.csv itself lives at).

The script never aborts on a single missing archive: it records the failure
in the manifest and moves on, so the operator can see the full list of
problems in one workflow run instead of one-at-a-time.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Iterable

import urllib.request

# Header names we will recognise (lower-cased, stripped) as holding a full
# URL to download the source archive directly. First match wins.
URL_HEADERS = (
    "source download url",
    "download url",
    "source url",
    "ftp source url",
    "url",
)

# Header names we will recognise as holding just a file name relative to
# the RTS data_retention/<Project>/<Version>/ directory.
FILENAME_HEADERS = (
    "source file name",
    "source file",
    "archive name",
    "archive",
    "file name",
    "filename",
    "ftp staging file",
    "ftp staging path",
    "source path",
)

# Header names used purely for annotating the manifest.
NAME_HEADERS = ("component name", "component", "name")
VERSION_HEADERS = ("component version name", "component version", "version")
LICENSE_HEADERS = ("license name", "license")


def _match_header(fieldnames: Iterable[str], candidates: Iterable[str]) -> str | None:
    """Return the first field in ``fieldnames`` whose lower-cased name matches
    any of ``candidates``. Matching is exact after strip() + lower()."""
    normalised = {(fn or "").strip().lower(): fn for fn in fieldnames}
    for cand in candidates:
        if cand in normalised:
            return normalised[cand]
    return None


def _sanitise_filename(name: str) -> str:
    """Strip any directory components and reject traversal."""
    name = name.strip().strip("/").strip("\\")
    # If the CSV gave us a path like "source_jars/foo.jar", keep the tail
    # directory as a sub-folder but disallow '..' segments.
    parts = [p for p in name.replace("\\", "/").split("/") if p and p != "."]
    if any(p == ".." for p in parts):
        raise ValueError(f"path traversal in filename: {name!r}")
    return "/".join(parts)


def _build_url_from_filename(
    rts_base_url: str,
    data_retention_root: str,
    project: str,
    version: str,
    filename: str,
) -> str:
    remote_path = f"{data_retention_root.rstrip('/')}/{project}/{version}/{filename}"
    query = urllib.parse.urlencode({"file": remote_path})
    return f"{rts_base_url.rstrip('/')}/download?{query}"


def _download(url: str, dest: Path, *, auth: tuple[str, str] | None, retries: int = 3) -> int:
    """Download ``url`` to ``dest``. Returns the number of bytes written.

    Raises the last exception seen if all retry attempts fail.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)

    opener = urllib.request.build_opener()
    if auth is not None:
        mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        mgr.add_password(None, url, auth[0], auth[1])
        opener.add_handler(urllib.request.HTTPBasicAuthHandler(mgr))

    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with opener.open(url, timeout=120) as resp:
                status = getattr(resp, "status", 200)
                if status >= 400:
                    raise RuntimeError(f"HTTP {status} for {url}")
                written = 0
                with dest.open("wb") as out:
                    while True:
                        chunk = resp.read(1024 * 64)
                        if not chunk:
                            break
                        out.write(chunk)
                        written += len(chunk)
                if written == 0:
                    raise RuntimeError(f"empty body for {url}")
                return written
        except Exception as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(2 * attempt)
    assert last_exc is not None
    raise last_exc


def process_csv(args: argparse.Namespace) -> int:
    csv_path = Path(args.csv)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    auth: tuple[str, str] | None = None
    if args.rts_user and args.rts_password:
        auth = (args.rts_user, args.rts_password)

    # Try utf-8-sig first to strip any BOM the RTS tool may add.
    with csv_path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames or []
        url_col = _match_header(fieldnames, URL_HEADERS)
        filename_col = _match_header(fieldnames, FILENAME_HEADERS)
        name_col = _match_header(fieldnames, NAME_HEADERS)
        version_col = _match_header(fieldnames, VERSION_HEADERS)
        license_col = _match_header(fieldnames, LICENSE_HEADERS)

        print(f"CSV columns detected: {fieldnames}")
        print(f"  URL column:      {url_col!r}")
        print(f"  Filename column: {filename_col!r}")
        print(f"  Name column:     {name_col!r}")
        print(f"  Version column:  {version_col!r}")

        if not url_col and not filename_col:
            print(
                "::error::Could not find a recognisable URL or filename column in "
                f"FTP-Components.csv. Headers seen: {fieldnames}",
                file=sys.stderr,
            )
            return 2

        rows = list(reader)

    print(f"Rows in CSV: {len(rows)}")

    manifest: dict[str, object] = {
        "project": args.project,
        "version": args.version,
        "csv": str(csv_path),
        "rts_base_url": args.rts_base_url,
        "data_retention_root": args.data_retention_root,
        "components": [],
    }

    seen: set[str] = set()
    for i, row in enumerate(rows, start=1):
        name = (row.get(name_col) or "").strip() if name_col else ""
        version = (row.get(version_col) or "").strip() if version_col else ""
        license_ = (row.get(license_col) or "").strip() if license_col else ""

        url: str | None = None
        filename: str | None = None
        if url_col:
            raw_url = (row.get(url_col) or "").strip()
            if raw_url:
                url = raw_url
        if not url and filename_col:
            raw_name = (row.get(filename_col) or "").strip()
            if raw_name:
                try:
                    filename = _sanitise_filename(raw_name)
                except ValueError as e:
                    manifest["components"].append(  # type: ignore[attr-defined]
                        {
                            "row": i,
                            "component": name,
                            "version": version,
                            "license": license_,
                            "status": "skipped",
                            "detail": str(e),
                        }
                    )
                    continue
                url = _build_url_from_filename(
                    args.rts_base_url,
                    args.data_retention_root,
                    args.project,
                    args.version,
                    filename,
                )

        if not url:
            manifest["components"].append(  # type: ignore[attr-defined]
                {
                    "row": i,
                    "component": name,
                    "version": version,
                    "license": license_,
                    "status": "skipped",
                    "detail": "no URL and no filename in row",
                }
            )
            continue

        # De-duplicate: several BOM rows sometimes point at the same archive.
        if url in seen:
            manifest["components"].append(  # type: ignore[attr-defined]
                {
                    "row": i,
                    "component": name,
                    "version": version,
                    "license": license_,
                    "url": url,
                    "status": "duplicate",
                    "detail": "already downloaded in this run",
                }
            )
            continue
        seen.add(url)

        if not filename:
            # Derive a local file name from the URL path.
            parsed = urllib.parse.urlparse(url)
            qs = urllib.parse.parse_qs(parsed.query)
            if "file" in qs and qs["file"]:
                filename = os.path.basename(qs["file"][0])
            else:
                filename = os.path.basename(parsed.path) or f"component-{i}.bin"
            filename = _sanitise_filename(filename)

        dest = out_dir / filename
        try:
            size = _download(url, dest, auth=auth)
            status = "ok"
            detail = f"{size} bytes"
        except Exception as exc:  # noqa: BLE001 — surface to manifest
            status = "failed"
            detail = f"{type(exc).__name__}: {exc}"

        print(f"[{i}/{len(rows)}] {name} {version}: {status} ({detail})")

        manifest["components"].append(  # type: ignore[attr-defined]
            {
                "row": i,
                "component": name,
                "version": version,
                "license": license_,
                "url": url,
                "local_path": str(dest.relative_to(out_dir.parent.parent))
                if out_dir.parent.parent in dest.parents
                else str(dest),
                "status": status,
                "detail": detail,
            }
        )

    manifest_path = Path(args.manifest)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)

    failed = [
        c
        for c in manifest["components"]  # type: ignore[index]
        if c.get("status") == "failed"  # type: ignore[attr-defined]
    ]
    ok = [
        c
        for c in manifest["components"]  # type: ignore[index]
        if c.get("status") == "ok"  # type: ignore[attr-defined]
    ]

    print(
        f"\nDone. downloaded={len(ok)} failed={len(failed)} total_rows={len(rows)}. "
        f"Manifest: {manifest_path}"
    )

    # A non-zero exit here would abort the workflow before the caller can
    # decide what to do (and before the manifest artifact is uploaded), so we
    # always return 0 when the CSV itself was parseable. The workflow's
    # "Sanity-check staged content" step decides whether the run as a whole
    # should fail.
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", required=True, help="Path to FTP-Components.csv")
    parser.add_argument("--project", required=True, help="RTS Project Name")
    parser.add_argument("--version", required=True, help="RTS Project Version")
    parser.add_argument("--rts-base-url", required=True)
    parser.add_argument("--data-retention-root", required=True)
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Local directory to stage source archives in",
    )
    parser.add_argument("--manifest", required=True, help="Where to write manifest.json")
    parser.add_argument("--log-dir", required=True)
    parser.add_argument("--rts-user", default=None)
    parser.add_argument("--rts-password", default=None)
    args = parser.parse_args(argv)

    log_dir = Path(args.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)

    return process_csv(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
