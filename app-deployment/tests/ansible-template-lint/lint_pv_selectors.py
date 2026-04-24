#!/usr/bin/env python3
"""Static consistency check for pre-provisioned PV templates against their Helm-values selectors.

Why this exists
---------------
Ansible roles under app-deployment/ansible/control-plane/roles/ ship pairs of
Jinja2 templates where one renders a Kubernetes PersistentVolume with a
hardcoded ``metadata.labels`` dict and another renders Helm values that pick
that volume up via ``persistentVolume.selector.matchLabels`` or
``persistence.selector.matchLabels``. When the two drift, the PVC never binds,
the pod sits Pending, and the build's ``wait for pods`` step burns ~9 minutes
before anyone notices (see commit c589fef7b).

Scope
-----
This linter renders the declared (PV template, values template) pairs with a
stub variable set, parses the resulting YAML, and asserts that every
(key, value) in the Helm selector appears on the PV's ``metadata.labels``.
Additional pairs are added by appending to ``CHECKS`` below.

Usage
-----
    python lint_pv_selectors.py               # lint all declared pairs
    python lint_pv_selectors.py --self-test   # run negative fixtures to validate the linter itself

Exit code 0 on success, 1 on any mismatch or rendering error.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import yaml
from jinja2 import Environment, FileSystemLoader, StrictUndefined

REPO_ROOT = Path(__file__).resolve().parents[3]
ROLES_ROOT = REPO_ROOT / "app-deployment" / "ansible" / "control-plane" / "roles"
FIXTURES_ROOT = Path(__file__).resolve().parent / "fixtures"

# Stub vars that keep the templates renderable. Values don't matter for the
# label/selector comparison, they just need to be parseable YAML.
DEFAULT_STUB_VARS: dict[str, Any] = {
    "prometheus_data_volume_size": "10Gi",
    "prometheus_alertmanager_data_volume_size": "2Gi",
    "vm_uid": 1000,
    "vm_gid": 1000,
    "customScrapeConfigs": "",
    "customAlertingRules": "",
}


@dataclass
class SelectorCheck:
    """One (PV template, values template) consistency check."""

    name: str
    pv_template: Path
    values_template: Path
    # Callable that picks the ``matchLabels`` dict out of the parsed values doc.
    # Using a callable instead of a dotted string keeps the chart's varying
    # nesting (``server.persistentVolume.selector.matchLabels`` vs
    # ``alertmanager.persistence.selector.matchLabels``) readable at the call
    # site.
    select_match_labels: Callable[[dict[str, Any]], dict[str, str]]
    # Many PV files render as multi-document YAML or include a trailing ``---``;
    # the name lets us pick the right document deterministically.
    pv_name: str
    stub_vars: dict[str, Any] = None  # type: ignore[assignment]


CHECKS: list[SelectorCheck] = [
    SelectorCheck(
        name="prometheus-server PV <-> prometheus chart selector",
        pv_template=ROLES_ROOT
        / "configure-prometheus/setup-prometheus/templates/prometheus-pv.j2",
        values_template=ROLES_ROOT
        / "configure-prometheus/setup-prometheus/templates/prometheus-values.j2",
        select_match_labels=lambda v: v["server"]["persistentVolume"]["selector"][
            "matchLabels"
        ],
        pv_name="prometheus-data",
    ),
    SelectorCheck(
        name="alertmanager PV <-> prometheus chart selector",
        pv_template=ROLES_ROOT
        / "configure-prometheus/setup-prometheus/templates/alertmanager-pv.j2",
        values_template=ROLES_ROOT
        / "configure-prometheus/setup-prometheus/templates/prometheus-values.j2",
        select_match_labels=lambda v: v["alertmanager"]["persistence"]["selector"][
            "matchLabels"
        ],
        pv_name="alertmanager-data",
    ),
]


def render(template_path: Path, stub_vars: dict[str, Any]) -> str:
    env = Environment(
        loader=FileSystemLoader(str(template_path.parent)),
        undefined=StrictUndefined,
        keep_trailing_newline=True,
    )
    tmpl = env.get_template(template_path.name)
    return tmpl.render(**stub_vars)


def parse_yaml_docs(rendered: str) -> list[dict[str, Any]]:
    return [doc for doc in yaml.safe_load_all(rendered) if doc is not None]


def find_pv_labels(docs: list[dict[str, Any]], pv_name: str) -> dict[str, str]:
    for doc in docs:
        if doc.get("kind") == "PersistentVolume" and doc.get("metadata", {}).get(
            "name"
        ) == pv_name:
            return doc["metadata"].get("labels", {}) or {}
    raise LookupError(
        f"PersistentVolume with metadata.name={pv_name!r} not found in rendered template"
    )


def run_check(check: SelectorCheck) -> list[str]:
    """Returns a list of error strings; empty list means the check passed."""
    stub = {**DEFAULT_STUB_VARS, **(check.stub_vars or {})}
    errors: list[str] = []

    try:
        pv_docs = parse_yaml_docs(render(check.pv_template, stub))
        values_doc_list = parse_yaml_docs(render(check.values_template, stub))
    except Exception as exc:  # noqa: BLE001 — we want to surface *any* render failure
        return [f"[{check.name}] failed to render templates: {exc}"]

    if not values_doc_list:
        return [f"[{check.name}] values template rendered to an empty document"]
    values = values_doc_list[0]

    try:
        selector = check.select_match_labels(values)
    except (KeyError, TypeError) as exc:
        return [
            f"[{check.name}] selector path not found in {check.values_template.relative_to(REPO_ROOT)}: {exc}"
        ]

    try:
        pv_labels = find_pv_labels(pv_docs, check.pv_name)
    except LookupError as exc:
        return [f"[{check.name}] {exc}"]

    for key, expected_value in (selector or {}).items():
        actual = pv_labels.get(key)
        if actual != expected_value:
            errors.append(
                f"[{check.name}] PV {check.pv_name!r} "
                f"(from {check.pv_template.relative_to(REPO_ROOT)}) has "
                f"labels[{key!r}]={actual!r}, but "
                f"{check.values_template.relative_to(REPO_ROOT)} selector requires "
                f"{expected_value!r}"
            )

    return errors


def lint_all(checks: list[SelectorCheck]) -> int:
    failures: list[str] = []
    for check in checks:
        errs = run_check(check)
        if errs:
            failures.extend(errs)
        else:
            print(f"PASS  {check.name}")
    if failures:
        print()
        print(f"FAIL  {len(failures)} mismatch(es):", file=sys.stderr)
        for err in failures:
            print(f"  - {err}", file=sys.stderr)
        return 1
    print()
    print(f"All {len(checks)} PV/selector pair(s) are consistent.")
    return 0


def self_test() -> int:
    """Exercise the linter against hand-crafted fixtures that *should* fail."""
    good = SelectorCheck(
        name="self-test: matched labels",
        pv_template=FIXTURES_ROOT / "good_pv.j2",
        values_template=FIXTURES_ROOT / "good_values.j2",
        select_match_labels=lambda v: v["server"]["persistentVolume"]["selector"][
            "matchLabels"
        ],
        pv_name="good-data",
    )
    bad = SelectorCheck(
        name="self-test: mismatched labels",
        pv_template=FIXTURES_ROOT / "bad_pv.j2",
        values_template=FIXTURES_ROOT / "good_values.j2",
        select_match_labels=lambda v: v["server"]["persistentVolume"]["selector"][
            "matchLabels"
        ],
        pv_name="bad-data",
    )

    failed = False

    good_errs = run_check(good)
    if good_errs:
        print("self-test FAIL: good fixture produced errors:", file=sys.stderr)
        for err in good_errs:
            print(f"  - {err}", file=sys.stderr)
        failed = True
    else:
        print("self-test PASS: good fixture clean")

    bad_errs = run_check(bad)
    if not bad_errs:
        print(
            "self-test FAIL: bad fixture did NOT produce errors "
            "(linter is not catching real drift)",
            file=sys.stderr,
        )
        failed = True
    else:
        print(f"self-test PASS: bad fixture correctly flagged ({len(bad_errs)} error(s))")
        for err in bad_errs:
            print(f"  - {err}")

    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run the linter against fixtures to validate the linter itself.",
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    return lint_all(CHECKS)


if __name__ == "__main__":
    raise SystemExit(main())
