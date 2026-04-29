#!/usr/bin/env python3
"""Classify every component in an RTS FTP-Components.csv as either a
*direct* dependency of this repo (declared in some local manifest) or a
*ride-along* component (transitively pulled in by an upstream image we
ship on top of, e.g. Bitnami's Keycloak Docker image, the Debian base
layer of the NDM VM, or a Quarkus runtime).

This script is **informational, not a fail-stop**. The RTS CSV is the
legal-authoritative list of what we ship — once a release has gone
through the SBOM + VP-sign-off process, every row in the CSV is by
definition shippable. The lone fail-stop in this workflow is the
NetApp-IP scan that runs over the staged bytes; that scan is what
keeps our own source code from leaking out. Re-deriving "is this
really our dep?" from manifests in the repo cannot beat RTS — it
will always lose to base-image transitives — so we settle for
classifying each row and surfacing the breakdown to the operator.

Mechanism: harvest dependency tokens from every language-specific
manifest in the repo (npm package.json/package-lock, Go go.mod/go.sum,
Maven pom.xml, Dockerfile FROMs). For each CSV row, build a small set
of candidate tokens (the full normalised name, every space/slash-
separated fragment ≥3 chars, and a vendor-prefix-stripped variant
when the name starts with a known vendor token like "google" or
"square"). A row is classified as direct when any candidate
substring-matches any harvested token in either direction.

Output:
  * prints a "direct vs ride-along" summary to stdout,
  * writes ``dependency-check.json`` containing the full classification
    per row (so the operator can spot-check ride-along entries via
    the workflow artifact),
  * exits 0 when the CSV was structurally parseable; exits non-zero
    only when the CSV header is malformed (no recognisable name
    column) or contains zero rows.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET

# Same column-name heuristics as stage-sources.py — deliberately a small,
# case-insensitive set so we tolerate the variations the RTS tool has
# produced over the years.
NAME_HEADERS = ("component name", "component", "name")
VERSION_HEADERS = ("component version name", "component version", "version")

# Directories we must NEVER descend into while harvesting dependency
# tokens — they pollute the token set with non-dependency noise.
SKIP_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    ".cache",
    "__pycache__",
    ".venv",
    "venv",
}

# Regex helpers.
NORMALISE_RE = re.compile(r"[^a-z0-9]+")

# Vendor-name prefixes that BlackDuck / RTS sometimes mash onto an
# artefact name with no separator: "googleguava" → "guava",
# "squareokio" → "okio", "apachecommonslang" → "commonslang". When the
# normalised CSV name starts with one of these, we *additionally*
# offer the suffix as a candidate — we never strip the prefix from
# repo-side tokens (those names come from authoritative manifests
# and we don't want to fabricate a "guava" candidate from a real
# package called "google-guava-something").
VENDOR_PREFIXES = (
    "google",
    "square",
    "apache",
    "jakarta",
    "eclipse",
    "jboss",
    "smallrye",
    "spring",
    "netflix",
    "redhat",
)


def _strip_vendor(s: str) -> str | None:
    """If ``s`` starts with a known vendor prefix, return the suffix
    (only when the suffix is at least 3 chars so we don't generate
    pathologically short candidates). Returns ``None`` if no prefix
    matches.
    """
    for prefix in VENDOR_PREFIXES:
        if s.startswith(prefix) and len(s) - len(prefix) >= 3:
            return s[len(prefix) :]
    return None


_HEADER_FLATTEN_RE = re.compile(r"[^a-z0-9]+")


def _match_header(fieldnames: Iterable[str], candidates: Iterable[str]) -> str | None:
    """Return the first field in ``fieldnames`` matching any of ``candidates``.

    Two-stage matching, deliberately permissive: the RTS tool has shipped
    several CSV header variants over the years (``Component Name``,
    ``Component Name (KB ID)``, ``BD Component Name``, ...) and we
    want all of them to resolve to the same logical column.

    1. Exact match on the trimmed lower-case header. Cheapest path.
    2. Substring match on a punctuation-flattened form
       (``Component Name (KB ID)`` -> ``component name kb id``) so the
       candidate ``component name`` still matches.

    ``candidates`` should be ordered most-specific-first so that, for
    example, ``component name`` wins over the ambiguous ``component``.
    """
    fields = [fn for fn in fieldnames if fn]
    exact = {fn.strip().lower(): fn for fn in fields}
    for cand in candidates:
        if cand in exact:
            return exact[cand]

    flattened: list[tuple[str, str]] = [
        (_HEADER_FLATTEN_RE.sub(" ", fn.lower()).strip(), fn) for fn in fields
    ]
    for cand in candidates:
        for flat, original in flattened:
            if cand in flat:
                return original
    return None


def _normalise(s: str) -> str:
    """Lower-case, collapse any non-alphanumeric run to a single dash."""
    return NORMALISE_RE.sub("-", s.lower()).strip("-")


def _iter_files(root: Path, names: set[str]):
    """Yield (Path) for every file under ``root`` whose name is in
    ``names``, skipping ``SKIP_DIRS`` entirely."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn in names:
                yield Path(dirpath) / fn


def _tokens_from_package_json(path: Path) -> set[str]:
    tokens: set[str] = set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"  warn: could not parse {path}: {exc}", file=sys.stderr)
        return tokens
    for section in (
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
        "bundledDependencies",
    ):
        deps = data.get(section) or {}
        if isinstance(deps, dict):
            tokens.update(deps.keys())
        elif isinstance(deps, list):
            tokens.update(x for x in deps if isinstance(x, str))
    return tokens


def _tokens_from_package_lock(path: Path) -> set[str]:
    """Harvest every transitive dependency name from an npm lockfile."""
    tokens: set[str] = set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"  warn: could not parse {path}: {exc}", file=sys.stderr)
        return tokens

    # lockfileVersion >= 2: "packages" is a map keyed by "node_modules/<pkg>".
    packages = data.get("packages") or {}
    for key, meta in packages.items():
        if not key:
            continue
        # key looks like "node_modules/foo" or "node_modules/@scope/bar".
        parts = key.split("node_modules/")
        if len(parts) > 1:
            tokens.add(parts[-1])
        if isinstance(meta, dict):
            name = meta.get("name")
            if isinstance(name, str):
                tokens.add(name)

    # lockfileVersion 1: "dependencies" is a nested map keyed by name.
    def _walk(d: dict) -> None:
        for name, meta in (d or {}).items():
            tokens.add(name)
            if isinstance(meta, dict):
                _walk(meta.get("dependencies") or {})

    _walk(data.get("dependencies") or {})
    return tokens


def _tokens_from_go_mod(path: Path) -> set[str]:
    tokens: set[str] = set()
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except Exception as exc:  # noqa: BLE001
        print(f"  warn: could not read {path}: {exc}", file=sys.stderr)
        return tokens
    in_require = False
    for raw in lines:
        line = raw.strip()
        if line.startswith("require ("):
            in_require = True
            continue
        if in_require and line == ")":
            in_require = False
            continue
        target = line
        if line.startswith("require "):
            target = line[len("require ") :].strip()
        elif not in_require:
            continue
        # "<module> <version>[ // indirect]"
        if "//" in target:
            target = target.split("//", 1)[0].strip()
        parts = target.split()
        if parts:
            tokens.add(parts[0])
    return tokens


def _tokens_from_go_sum(path: Path) -> set[str]:
    tokens: set[str] = set()
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            parts = raw.split()
            if parts:
                tokens.add(parts[0])
    except Exception as exc:  # noqa: BLE001
        print(f"  warn: could not read {path}: {exc}", file=sys.stderr)
    return tokens


def _tokens_from_pom_xml(path: Path) -> set[str]:
    tokens: set[str] = set()
    try:
        tree = ET.parse(path)
    except Exception as exc:  # noqa: BLE001
        print(f"  warn: could not parse {path}: {exc}", file=sys.stderr)
        return tokens
    # Drop XML namespaces so we don't have to thread them through XPath.
    for elem in tree.iter():
        if "}" in elem.tag:
            elem.tag = elem.tag.split("}", 1)[1]
    for dep in tree.iter("dependency"):
        group = (dep.findtext("groupId") or "").strip()
        artifact = (dep.findtext("artifactId") or "").strip()
        if artifact:
            tokens.add(artifact)
        if group and artifact:
            tokens.add(f"{group}:{artifact}")
    for parent in tree.iter("parent"):
        artifact = (parent.findtext("artifactId") or "").strip()
        if artifact:
            tokens.add(artifact)
    return tokens


DOCKER_FROM_RE = re.compile(r"^\s*FROM\s+(?:--platform=\S+\s+)?([^\s]+)", re.I | re.M)


def _tokens_from_dockerfile(path: Path) -> set[str]:
    tokens: set[str] = set()
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception as exc:  # noqa: BLE001
        print(f"  warn: could not read {path}: {exc}", file=sys.stderr)
        return tokens
    for m in DOCKER_FROM_RE.finditer(text):
        image = m.group(1).split(" AS ")[0].strip()
        if image.lower() == "scratch" or "$" in image:
            # Skip scratch and ARG-templated FROMs.
            continue
        # "docker.io/bitnami/keycloak:26.6.1-debian-12-r0" -> tokenise path+name.
        ref = image.split("@", 1)[0]  # drop digest
        ref = ref.split(":", 1)[0]    # drop tag
        tokens.add(ref)
        # Also add the last path segment ("keycloak") since BlackDuck
        # often lists just the image/project name.
        tokens.add(ref.rsplit("/", 1)[-1])
    return tokens


def harvest_repo_tokens(repo_root: Path) -> set[str]:
    raw: set[str] = set()

    for p in _iter_files(repo_root, {"package.json"}):
        raw |= _tokens_from_package_json(p)
    for p in _iter_files(repo_root, {"package-lock.json"}):
        raw |= _tokens_from_package_lock(p)
    for p in _iter_files(repo_root, {"go.mod"}):
        raw |= _tokens_from_go_mod(p)
    for p in _iter_files(repo_root, {"go.sum"}):
        raw |= _tokens_from_go_sum(p)
    for p in _iter_files(repo_root, {"pom.xml"}):
        raw |= _tokens_from_pom_xml(p)
    for p in _iter_files(repo_root, {"Dockerfile"}):
        raw |= _tokens_from_dockerfile(p)
    # Glob Dockerfiles with suffix (e.g. Dockerfile.dev).
    for dirpath, dirnames, filenames in os.walk(repo_root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn.startswith("Dockerfile.") or fn.endswith(".Dockerfile"):
                raw |= _tokens_from_dockerfile(Path(dirpath) / fn)

    # Normalise. One raw token can produce multiple normalised forms
    # (the whole path, the tail segment) to maximise the chance of
    # matching a BlackDuck-style name.
    tokens: set[str] = set()
    for r in raw:
        if not r:
            continue
        norm = _normalise(r)
        if norm:
            tokens.add(norm)
        # Also the tail after the last '/'.
        tail = r.rsplit("/", 1)[-1]
        norm_tail = _normalise(tail)
        if norm_tail:
            tokens.add(norm_tail)
        # And for "group:artifact" style, both sides.
        if ":" in r:
            g, a = r.split(":", 1)
            if a:
                tokens.add(_normalise(a))
            if g:
                tokens.add(_normalise(g))

    # Drop trivially short tokens ("go", "ui", ...) — they would match
    # too promiscuously in the substring test below.
    tokens = {t for t in tokens if len(t) >= 3}

    return tokens


class CsvHeaderError(RuntimeError):
    """Raised when the CSV's header row has no recognisable name column.
    This is a structural breakage — distinct from "every row classified
    as ride-along" — and the caller turns it into a hard fail-stop.
    """


def verify(csv_path: Path, repo_tokens: set[str]) -> tuple[list[dict], list[dict]]:
    """Classify each CSV row as either a *direct* dependency of this
    repo or a *ride-along* component. Returns ``(direct, ride_along)``.

    A row is *direct* when at least one of its normalised candidate
    tokens substring-matches a token harvested from the repo's
    manifests. A row is *ride-along* otherwise — RTS lists it because
    some upstream image we redistribute pulls it in transitively
    (Bitnami Keycloak, Debian base layer, Quarkus runtime, ...).
    Neither classification is "wrong"; both are shippable per the RTS
    CSV. The split is informational only.

    Raises ``CsvHeaderError`` if the CSV header row has no
    recognisable component-name column; that *is* a structural
    failure and the caller hard-fails.
    """
    with csv_path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames or []
        name_col = _match_header(fieldnames, NAME_HEADERS)
        version_col = _match_header(fieldnames, VERSION_HEADERS)
        rows = list(reader)

    print(f"CSV columns detected: {fieldnames}")
    print(f"  Name column:    {name_col!r}")
    print(f"  Version column: {version_col!r}")
    print(f"  Row count:      {len(rows)}")

    if name_col is None:
        raise CsvHeaderError(
            f"FTP-Components.csv has no recognisable component-name "
            f"column. Headers seen: {fieldnames}. Aliases recognised "
            f"(exact or substring, ordered most-specific-first): "
            f"{list(NAME_HEADERS)}. Add the actual RTS header to "
            f"NAME_HEADERS in scripts/rts-ftp-posting/verify-components.py "
            f"AND scripts/rts-ftp-posting/stage-sources.py, then re-run."
        )

    direct: list[dict] = []
    ride_along: list[dict] = []

    for i, row in enumerate(rows, start=1):
        name = (row.get(name_col) or "").strip() if name_col else ""
        version = (row.get(version_col) or "").strip() if version_col else ""
        if not name:
            ride_along.append({"row": i, "component": "", "version": version,
                               "reason": "component name column is empty"})
            continue

        # Build a small set of candidate tokens for this component.
        candidates: set[str] = set()
        norm_name = _normalise(name)
        if norm_name:
            candidates.add(norm_name)
            # Vendor-mashed names: "googleguava" -> also try "guava".
            stripped = _strip_vendor(norm_name)
            if stripped:
                candidates.add(stripped)
        # BlackDuck sometimes joins vendor + product ("apache commons lang")
        # or splits on "/". Try every `/`- or whitespace-separated
        # fragment of length >= 3 (after normalisation). Hyphens are
        # *not* treated as fragment separators — a candidate like
        # "agent" carved out of "byte-buddy-agent" would over-match
        # tokens such as "user-agent".
        fragments = re.split(r"[/\s]+", name)
        for frag in fragments:
            nf = _normalise(frag)
            if len(nf) >= 3:
                candidates.add(nf)
                stripped = _strip_vendor(nf)
                if stripped:
                    candidates.add(stripped)

        if not candidates:
            ride_along.append({"row": i, "component": name, "version": version,
                               "reason": "no usable tokens after normalisation"})
            continue

        # Match: substring in either direction. We intentionally keep
        # this fuzzy rather than exact — BlackDuck names rarely line
        # up byte-for-byte with manifest entries.
        matched_token: str | None = None
        for cand in candidates:
            for tok in repo_tokens:
                if cand in tok or tok in cand:
                    matched_token = tok
                    break
            if matched_token:
                break

        record = {
            "row": i,
            "component": name,
            "version": version,
            "matched_token": matched_token,
        }
        (direct if matched_token else ride_along).append(record)

    return direct, ride_along


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", required=True)
    parser.add_argument("--repo-root", required=True,
                        help="Root of the repo to harvest dependency manifests from")
    parser.add_argument("--report", required=True,
                        help="Where to write the JSON verdict report")
    args = parser.parse_args(argv)

    repo_root = Path(args.repo_root).resolve()
    csv_path = Path(args.csv)

    print(f"Harvesting dependency tokens from {repo_root} ...")
    tokens = harvest_repo_tokens(repo_root)
    print(f"  collected {len(tokens)} normalised tokens from "
          "package.json/package-lock/go.mod/go.sum/pom.xml/Dockerfile*")

    try:
        direct, ride_along = verify(csv_path, tokens)
    except CsvHeaderError as exc:
        # Structural CSV breakage is the one thing this script *does*
        # hard-fail on — without a name column we can't classify
        # anything, and silently passing would defeat the whole step.
        print(f"::error::{exc}", file=sys.stderr)
        Path(args.report).write_text(
            json.dumps(
                {
                    "csv": str(csv_path),
                    "repo_root": str(repo_root),
                    "token_count": len(tokens),
                    "error": str(exc),
                    "direct": [],
                    "ride_along": [],
                    "ok": [],
                    "unknown": [],
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return 2

    report = {
        "csv": str(csv_path),
        "repo_root": str(repo_root),
        "token_count": len(tokens),
        "direct": direct,
        "ride_along": ride_along,
        # Legacy keys kept for one cycle so any external consumer of
        # dependency-check.json doesn't break the moment this lands.
        "ok": direct,
        "unknown": ride_along,
    }
    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")

    total = len(direct) + len(ride_along)
    if total == 0:
        # Empty CSV body is also structural breakage — the file parsed,
        # but there's nothing to ship. Treat as a hard fail.
        print(
            "::error::FTP-Components.csv parsed but contained zero rows "
            "after the header. Refusing to proceed; the publish step "
            "would have nothing to upload.",
            file=sys.stderr,
        )
        return 2

    print(f"\nDirect-match dependencies: {len(direct)}")
    print(f"Ride-along components:     {len(ride_along)}")
    print(
        "  (Ride-along = listed in the RTS CSV but not declared in this "
        "repo's manifests. RTS is authoritative for what we ship; the "
        "NetApp-IP scan is the lone fail-stop.)"
    )

    if ride_along:
        print(
            "\nSample of ride-along components — verified by RTS, "
            "transitively pulled in by an upstream image:"
        )
        for u in ride_along[:50]:
            print(f"  - row {u['row']}: {u['component']} {u.get('version','')}")
        if len(ride_along) > 50:
            print(
                f"  ... and {len(ride_along) - 50} more "
                f"(full list in dependency-check.json)"
            )

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
