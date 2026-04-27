#!/usr/bin/env python3
"""Verify that every component in an RTS FTP-Components.csv really is a
dependency (direct or transitive) of this repo.

We iterate over every language-specific manifest in the repo and build a
set of normalised "dependency tokens" (package names / module paths /
Maven artefacts / Docker base images / ...). Then, for every component
row in the CSV, we check that at least one of its normalised name
tokens appears as a substring match in that set.

BlackDuck component names don't line up byte-for-byte with what a given
language's manifest says — e.g. BlackDuck may list an npm package as
"Lodash" while package-lock.json says "lodash@4.17.21" and Go says
"github.com/stretchr/testify". So we lower-case, strip common
separators/suffixes, and match on normalised substrings in both
directions. False negatives (a legit dep we fail to match) are more
likely than false positives, so the workflow exposes a
``skip_dependency_check`` input to let the operator bypass this guard
with an explicit decision.

Output:
  * prints a per-component verdict to stdout,
  * writes ``dependency-check.json`` next to the manifest, and
  * exits non-zero if any component could not be located in any
    manifest (unless --warn-only is passed).
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


def _match_header(fieldnames: Iterable[str], candidates: Iterable[str]) -> str | None:
    normalised = {(fn or "").strip().lower(): fn for fn in fieldnames}
    for cand in candidates:
        if cand in normalised:
            return normalised[cand]
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


def verify(csv_path: Path, repo_tokens: set[str]) -> tuple[list[dict], list[dict]]:
    with csv_path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames or []
        name_col = _match_header(fieldnames, NAME_HEADERS)
        version_col = _match_header(fieldnames, VERSION_HEADERS)
        rows = list(reader)

    ok: list[dict] = []
    unknown: list[dict] = []

    for i, row in enumerate(rows, start=1):
        name = (row.get(name_col) or "").strip() if name_col else ""
        version = (row.get(version_col) or "").strip() if version_col else ""
        if not name:
            unknown.append({"row": i, "component": "", "version": version,
                            "reason": "component name column is empty"})
            continue

        # Normalised candidate tokens for the component.
        candidates: set[str] = set()
        norm_name = _normalise(name)
        if norm_name:
            candidates.add(norm_name)
        # BlackDuck sometimes joins vendor + product ("apache commons lang")
        # or splits on "/". Try the tail, and every `/`- or ` `-separated
        # fragment of length >= 3.
        fragments = re.split(r"[/\s]+", name)
        for frag in fragments:
            nf = _normalise(frag)
            if len(nf) >= 3:
                candidates.add(nf)

        if not candidates:
            unknown.append({"row": i, "component": name, "version": version,
                            "reason": "no usable tokens after normalisation"})
            continue

        # Match: substring in either direction. We intentionally keep
        # this fuzzy rather than exact — see module docstring.
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
        (ok if matched_token else unknown).append(record)

    return ok, unknown


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", required=True)
    parser.add_argument("--repo-root", required=True,
                        help="Root of the repo to harvest dependency manifests from")
    parser.add_argument("--report", required=True,
                        help="Where to write the JSON verdict report")
    parser.add_argument("--warn-only", action="store_true",
                        help="Still exit 0 even if some components were not located")
    args = parser.parse_args(argv)

    repo_root = Path(args.repo_root).resolve()
    csv_path = Path(args.csv)

    print(f"Harvesting dependency tokens from {repo_root} ...")
    tokens = harvest_repo_tokens(repo_root)
    print(f"  collected {len(tokens)} normalised tokens from "
          "package.json/package-lock/go.mod/go.sum/pom.xml/Dockerfile*")

    ok, unknown = verify(csv_path, tokens)

    report = {
        "csv": str(csv_path),
        "repo_root": str(repo_root),
        "token_count": len(tokens),
        "ok": ok,
        "unknown": unknown,
    }
    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"\nVerified:  {len(ok)}")
    print(f"Unknown:   {len(unknown)}")
    if unknown:
        print("\nComponents that do NOT appear in any repo dependency manifest:")
        for u in unknown[:50]:
            print(f"  - row {u['row']}: {u['component']} {u.get('version','')}"
                  f" ({u.get('reason','no substring match')})")
        if len(unknown) > 50:
            print(f"  ... and {len(unknown) - 50} more")

    if unknown and not args.warn_only:
        print("\n::error::Dependency-verification failed — see list above. "
              "Investigate each component (is it really shipped by NDM?) "
              "or re-run the workflow with skip_dependency_check=true after "
              "recording the justification in the run summary.",
              file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
